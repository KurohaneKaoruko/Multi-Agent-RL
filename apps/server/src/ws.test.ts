import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import WebSocket from 'ws'
import type { EnvironmentConfig, MatchEventEnvelope } from '@marl/shared'
import { buildApp, closeApp } from './app'

function mockModel(name: string, script: unknown[]) {
  return { name, baseUrl: 'mock://arlaf', apiKey: JSON.stringify(script), model: 'mock', params: {} }
}

function envFixture(): EnvironmentConfig {
  return {
    id: 'env-ws',
    name: 'WS 测试环境',
    description: '',
    topology: 'asymmetric',
    roles: [
      { id: 'r1', name: '角色一', systemPrompt: 's', goal: 'g', answerFormat: 'free' },
      { id: 'r2', name: '角色二', systemPrompt: 's', goal: 'g', answerFormat: 'free' },
    ],
    agents: [
      { id: 'a', name: 'A', roleId: 'r1', startRound: 1 },
      { id: 'b', name: 'B', roleId: 'r2', startRound: 1 },
    ],
    turns: { rounds: 2, order: ['a', 'b'] },
    workspaceTemplate: { files: [] },
    exchanges: [],
    outcome: { mode: 'rule', evaluator: 'ai-flavor', params: {} },
    experience: { enabled: false, tokenBudget: 2000, recentMemoryLimit: 3 },
  }
}

function collectWs(url: string, until: (msg: Record<string, unknown>) => boolean): {
  messages: Promise<Array<Record<string, unknown>>>
  close: () => void
} {
  const ws = new WebSocket(url)
  const messages: Array<Record<string, unknown>> = []
  const messagesPromise = new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
    ws.on('message', (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>
      messages.push(msg)
      if (until(msg)) {
        resolve([...messages])
        ws.close()
      }
    })
    ws.on('error', reject)
    ws.on('close', () => resolve([...messages]))
  })
  return { messages: messagesPromise, close: () => ws.close() }
}

describe('WebSocket 实时事件流（10.1）', () => {
  it('订阅收到全部事件；断线重连按 since 补齐缺口', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'arlaf-ws-'))
    const app: FastifyInstance = await buildApp({ dataDir })
    try {
      await app.listen({ port: 0, host: '127.0.0.1' })
      const addr = app.server.address() as AddressInfo
      const base = `ws://127.0.0.1:${addr.port}`

      // 准备环境 + 模型
      await app.inject({ method: 'POST', url: '/api/environments', payload: envFixture() })
      const m1 = (
        await app.inject({ method: 'POST', url: '/api/models', payload: mockModel('A', ['A1', 'A2']) })
      ).json() as { id: string }
      const m2 = (
        await app.inject({ method: 'POST', url: '/api/models', payload: mockModel('B', ['B1', 'B2']) })
      ).json() as { id: string }
      const { id: matchId } = (
        await app.inject({
          method: 'POST',
          url: '/api/matches',
          payload: {
            environmentId: 'env-ws',
            bindings: [
              { agentId: 'a', modelConfigId: m1.id },
              { agentId: 'b', modelConfigId: m2.id },
            ],
          },
        })
      ).json() as { id: string }

      // 订阅先于开赛：应实时收到全部事件直至 done
      const sub = collectWs(`${base}/api/ws/matches/${matchId}`, (msg) => msg.type === 'done')
      await new Promise((r) => setTimeout(r, 100)) // 等待 WS 握手
      await app.inject({ method: 'POST', url: `/api/matches/${matchId}/start` })

      const manager = (app as unknown as { arlaf: { manager: { whenSettled: (id: string) => Promise<string> | undefined } } })
        .arlaf.manager
      expect(await manager.whenSettled(matchId)).toBe('completed')

      const messages = await sub.messages
      const envelopes = messages.filter((m) => m.seq != null) as unknown as MatchEventEnvelope[]
      expect(envelopes.length).toBeGreaterThanOrEqual(8)
      expect(envelopes[0]!.event.type).toBe('match.started')
      expect(envelopes.map((e) => e.seq)).toEqual(envelopes.map((_, i) => i + 1)) // seq 连续递增
      const done = messages.find((m) => m.type === 'done')
      expect(done).toBeDefined()

      // 断线重连：since=2 → 从 seq 3 补发，不重不漏
      const resume = await collectWs(`${base}/api/ws/matches/${matchId}?since=2`, (msg) => msg.type === 'done')
      const resumed = (await resume.messages).filter((m) => m.seq != null) as unknown as MatchEventEnvelope[]
      expect(resumed[0]!.seq).toBe(3)
      const all = (await app.inject({ method: 'GET', url: `/api/matches/${matchId}/events` })).json() as {
        events: MatchEventEnvelope[]
      }
      expect(resumed.map((e) => e.seq)).toEqual(all.events.slice(2).map((e) => e.seq))
    } finally {
      await closeApp(app)
      await rm(dataDir, { recursive: true, force: true })
    }
  }, 20000)

  it('订阅不存在的对局返回错误并关闭', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'arlaf-ws2-'))
    const app: FastifyInstance = await buildApp({ dataDir })
    try {
      await app.listen({ port: 0, host: '127.0.0.1' })
      const addr = app.server.address() as AddressInfo
      const messages = await new Promise<Array<Record<string, unknown>>>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/api/ws/matches/nope`)
        const got: Array<Record<string, unknown>> = []
        ws.on('message', (d: WebSocket.RawData) => {
          got.push(JSON.parse(d.toString()) as Record<string, unknown>)
          resolve(got)
        })
        ws.on('error', () => resolve(got))
      })
      expect(messages[0]).toMatchObject({ type: 'error' })
    } finally {
      await closeApp(app)
      await rm(dataDir, { recursive: true, force: true })
    }
  }, 15000)
})
