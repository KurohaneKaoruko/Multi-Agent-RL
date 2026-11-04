// 契约测试（防漂移）：服务端路由 handler 的实际响应必须与 web client.ts 引用的
// @marl/shared DTO 类型在 shape 上完全一致。上轮「发起对局 404」bug 的根源即
// client.ts 内联类型与服务端响应漂移（created.id vs firstId）——本文件把两类
// 响应（批量训练 API、发起对局响应）钉在共享 DTO 上，任何一侧漂移都会在此显式失败。
import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import {
  MatchCreateResponseSchema,
  MatchDetailSchema,
  MatchEventsResponseSchema,
  MatchStartResponseSchema,
  MatchSummarySchema,
  type MatchCreateResponse,
  type MatchDetail,
  type MatchEventsResponse,
  type MatchStartResponse,
  type MatchSummary,
} from '@marl/shared'
import { buildApp, closeApp } from './app'
import type { EnvironmentConfig } from '@marl/shared'

/** 运行时 shape 断言：要求对象恰好具备 DTO 的全部键（多余键也视为契约漂移） */
function expectExactKeys(value: object, expected: readonly string[], label: string): void {
  expect(Object.keys(value).sort(), `${label} 键集合漂移`).toEqual([...expected].sort())
}

function mockModelConfig(name: string, script: unknown[]) {
  return {
    name,
    baseUrl: 'mock://arlaf',
    apiKey: JSON.stringify(script),
    model: 'mock',
    params: { temperature: 0.7 },
  }
}

function envFixture(): EnvironmentConfig {
  return {
    id: 'env-contract',
    name: '契约测试环境',
    description: '1v1 无交换',
    topology: 'asymmetric',
    roles: [
      { id: 'r1', name: '角色一', systemPrompt: 's1', goal: 'g1', answerFormat: 'free' },
      { id: 'r2', name: '角色二', systemPrompt: 's2', goal: 'g2', answerFormat: 'free' },
    ],
    agents: [
      { id: 'a', name: 'A', roleId: 'r1', startRound: 1 },
      { id: 'b', name: 'B', roleId: 'r2', startRound: 1 },
    ],
    turns: { rounds: 1, order: ['a', 'b'] },
    toolsEnabled: true,
    workspaceTemplate: { mode: 'private', files: [] },
    exchanges: [],
    outcome: { mode: 'rule', evaluator: 'ai-flavor', params: {} },
    experience: { enabled: false, tokenBudget: 2000, recentMemoryLimit: 3 },
  }
}

const MATCH_SUMMARY_KEYS = [
  'id',
  'environmentId',
  'environmentName',
  'status',
  'winnerAgentId',
  'teamScore',
  'agentCount',
  'createdAt',
  'finishedAt',
] as const

const MATCH_DETAIL_KEYS = [...MATCH_SUMMARY_KEYS, 'agentIds', 'error', 'result'] as const

const MATCH_CREATE_KEYS = ['ids', 'firstId', 'status', 'episodes'] as const

const MATCH_START_KEYS = ['id', 'status'] as const

const MATCH_START_BATCH_KEYS = ['id', 'status', 'batchId'] as const

const MATCH_EVENTS_KEYS = ['events', 'latestSeq'] as const

describe('API 契约（服务端响应 ↔ @marl/shared DTO ↔ web client 类型）', () => {
  let dataDir: string
  let app: FastifyInstance

  async function prepare(): Promise<{ envId: string; modelId: string }> {
    dataDir = await mkdtemp(path.join(tmpdir(), 'arlaf-contract-'))
    app = await buildApp({ dataDir })
    await app.ready()
    const envRes = await app.inject({ method: 'POST', url: '/api/environments', payload: envFixture() })
    expect(envRes.statusCode).toBe(201)
    const modelRes = await app.inject({ method: 'POST', url: '/api/models', payload: mockModelConfig('A', ['A1']) })
    expect(modelRes.statusCode).toBe(201)
    return { envId: 'env-contract', modelId: (modelRes.json() as { id: string }).id }
  }

  async function teardown(): Promise<void> {
    await closeApp(app)
    for (let i = 0; i < 3; i++) {
      try {
        await rm(dataDir, { recursive: true, force: true })
        return
      } catch {
        await new Promise((r) => setTimeout(r, 150))
      }
    }
  }

  it('POST /api/matches（episodes=1 边界）响应符合 MatchCreateResponse 契约', async () => {
    const { envId, modelId } = await prepare()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/matches',
        payload: {
          environmentId: envId,
          bindings: [
            { agentId: 'a', modelConfigId: modelId },
            { agentId: 'b', modelConfigId: modelId },
          ],
          // episodes 缺省（默认 1）：client.ts 不传该字段，响应必须仍满足契约
        },
      })
      expect(res.statusCode).toBe(201)
      const body = res.json() as MatchCreateResponse

      // ① 运行时层：键集合精确匹配（多余/缺失键都视为漂移）
      expectExactKeys(body, MATCH_CREATE_KEYS, 'MatchCreateResponse')
      expect(body.ids).toHaveLength(1)
      expect(body.firstId).toBe(body.ids[0])
      expect(body.status).toBe('pending')
      expect(body.episodes).toBe(1)

      // ② Zod schema 层：共享 schema 校验通过
      // （编译期契约由服务端 handler 返回值 satisfies MatchCreateResponse 保证）
      expect(MatchCreateResponseSchema.parse(body)).toBeDefined()
    } finally {
      await teardown()
    }
  })

  it('POST /api/matches（episodes=20 上界）与非法值（0/21）边界', async () => {
    const { envId, modelId } = await prepare()
    try {
      const ok = await app.inject({
        method: 'POST',
        url: '/api/matches',
        payload: {
          environmentId: envId,
          bindings: [
            { agentId: 'a', modelConfigId: modelId },
            { agentId: 'b', modelConfigId: modelId },
          ],
          episodes: 20,
        },
      })
      expect(ok.statusCode).toBe(201)
      const body = ok.json() as MatchCreateResponse
      expectExactKeys(body, MATCH_CREATE_KEYS, 'MatchCreateResponse(episodes=20)')
      expect(body.episodes).toBe(20)
      expect(body.ids).toHaveLength(20)
      expect(body.firstId).toBe(body.ids[0])
      expect(MatchCreateResponseSchema.parse(body).episodes).toBe(20)

      for (const episodes of [0, 21, 1.5]) {
        const bad = await app.inject({
          method: 'POST',
          url: '/api/matches',
          payload: {
            environmentId: envId,
            bindings: [
              { agentId: 'a', modelConfigId: modelId },
              { agentId: 'b', modelConfigId: modelId },
            ],
            episodes,
          },
        })
        expect(bad.statusCode, `episodes=${episodes} 应被 400 拦截`).toBe(400)
      }
    } finally {
      await teardown()
    }
  })

  it('POST /api/matches/:id/start 响应符合 MatchStartResponse 契约（含批量 batchId）', async () => {
    const { envId, modelId } = await prepare()
    try {
      const bindings = [
        { agentId: 'a', modelConfigId: modelId },
        { agentId: 'b', modelConfigId: modelId },
      ]
      const single = await app.inject({
        method: 'POST',
        url: '/api/matches',
        payload: { environmentId: envId, bindings },
      })
      const singleId = (single.json() as MatchCreateResponse).firstId

      // 单场启动：无 batchId 键
      const startRes = await app.inject({ method: 'POST', url: `/api/matches/${singleId}/start` })
      expect(startRes.statusCode).toBe(202)
      const startBody = startRes.json() as MatchStartResponse
      expectExactKeys(startBody, MATCH_START_KEYS, 'MatchStartResponse')
      expect(startBody.status).toBe('running')
      expect(MatchStartResponseSchema.parse(startBody)).toBeDefined()

      // 批量启动：响应多出可选 batchId 键（DTO 中声明为可选）
      const batch = await app.inject({
        method: 'POST',
        url: '/api/matches',
        payload: { environmentId: envId, bindings, episodes: 2 },
      })
      const batchIds = (batch.json() as MatchCreateResponse).ids
      const batchStart = await app.inject({ method: 'POST', url: `/api/matches/${batchIds[0]}/start` })
      expect(batchStart.statusCode).toBe(202)
      const batchBody = batchStart.json() as MatchStartResponse
      expectExactKeys(batchBody, MATCH_START_BATCH_KEYS, 'MatchStartResponse(批量)')
      expect(batchBody.batchId).toBeTruthy()
      expect(MatchStartResponseSchema.parse(batchBody).batchId).toBe(batchBody.batchId)

      // 等待批次全部结算后再 teardown（startSequenceForBatch 为 fire-and-forget，
      // 不等待会在关库后仍写库，触发 "database connection is not open"）
      const mgr = (
        app as unknown as { arlaf: { manager: { whenSettled: (id: string) => Promise<string> | undefined } } }
      ).arlaf.manager
      for (const mid of batchIds) {
        expect(await mgr.whenSettled(mid)).toBe('completed')
      }
    } finally {
      await teardown()
    }
  })

  it('GET /api/matches 列表项与 GET /api/matches/:id 详情符合 MatchSummary/MatchDetail 契约', async () => {
    const { envId, modelId } = await prepare()
    try {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/matches',
        payload: {
          environmentId: envId,
          bindings: [
            { agentId: 'a', modelConfigId: modelId },
            { agentId: 'b', modelConfigId: modelId },
          ],
        },
      })
      const matchId = (createRes.json() as MatchCreateResponse).firstId
      await app.inject({ method: 'POST', url: `/api/matches/${matchId}/start` })
      const manager = (
        app as unknown as { arlaf: { manager: { whenSettled: (id: string) => Promise<string> | undefined } } }
      ).arlaf.manager
      expect(await manager.whenSettled(matchId)).toBe('completed')

      // 列表项 ↔ MatchSummary
      const listRes = await app.inject({ method: 'GET', url: '/api/matches' })
      expect(listRes.statusCode).toBe(200)
      const listBody = listRes.json() as { matches: MatchSummary[] }
      expectExactKeys(listBody, ['matches'], 'matches 列表响应')
      for (const item of listBody.matches) {
        expectExactKeys(item, MATCH_SUMMARY_KEYS, 'MatchSummary')
        expect(MatchSummarySchema.parse(item)).toBeDefined()
      }

      // 详情 ↔ MatchDetail
      const detailRes = await app.inject({ method: 'GET', url: `/api/matches/${matchId}` })
      expect(detailRes.statusCode).toBe(200)
      const detail = detailRes.json() as MatchDetail
      expectExactKeys(detail, MATCH_DETAIL_KEYS, 'MatchDetail')
      expect(MatchDetailSchema.parse(detail)).toBeDefined()
      expect(detail.agentIds).toEqual(['a', 'b'])
      expect(detail.result).not.toBeNull()

      // 事件流 ↔ MatchEventsResponse
      const eventsRes = await app.inject({ method: 'GET', url: `/api/matches/${matchId}/events` })
      expect(eventsRes.statusCode).toBe(200)
      const events = eventsRes.json() as MatchEventsResponse
      expectExactKeys(events, MATCH_EVENTS_KEYS, 'MatchEventsResponse')
      expect(MatchEventsResponseSchema.parse(events)).toBeDefined()
      expect(events.events.length).toBeGreaterThan(0)
    } finally {
      await teardown()
    }
  })
})
