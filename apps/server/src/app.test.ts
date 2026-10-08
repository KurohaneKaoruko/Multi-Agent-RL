import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { EnvironmentConfig } from '@marl/shared'
import { buildApp, closeApp } from './app'
import * as engine from '@marl/engine'

let dataDir: string
let app: FastifyInstance

async function setup(): Promise<void> {
  dataDir = await mkdtemp(path.join(tmpdir(), 'arlaf-app-'))
  console.log('PROBE typeof FileExperienceStore:', typeof engine.FileExperienceStore)
  app = await buildApp({ dataDir })
  await app.ready()
}

async function teardown(): Promise<void> {
  await closeApp(app)
  await rm(dataDir, { recursive: true, force: true })
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
    id: 'env-app',
    name: '应用测试环境',
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
    experience: { enabled: true, tokenBudget: 2000, recentMemoryLimit: 3 },
  }
}

const summaryOf = (tag: string) => JSON.stringify({ memory: `记忆-${tag}`, skills: `技能-${tag}`, changesSummary: `总结-${tag}` })

describe('ARLAF API 集成（9.1–9.5）', () => {
  it('完整流程：文档/环境/模型/对局/经验', async () => {
    await setup()
    try {
      // ---- 9.1 OpenAPI 文档可访问 ----
      const docs = await app.inject({ method: 'GET', url: '/api/docs' })
      expect(docs.statusCode).toBe(200)
      const docsJson = await app.inject({ method: 'GET', url: '/api/docs/json' })
      expect(docsJson.statusCode).toBe(200)
      const openapi = docsJson.json() as { paths: Record<string, unknown> }
      expect(Object.keys(openapi.paths)).toContain('/api/environments')

      // ---- 9.2 环境 CRUD + 中文字段级校验错误 ----
      const badEnv = { ...(envFixture() as Record<string, unknown>) }
      delete badEnv.name
      badEnv.topology = 'cooperative'
      const badRes = await app.inject({ method: 'POST', url: '/api/environments', payload: badEnv })
      expect(badRes.statusCode).toBe(400)
      const badBody = badRes.json() as { error: string; fields: Array<{ path: string; message: string }> }
      expect(badBody.error).toContain('校验')
      const nameError = badBody.fields.find((f) => f.path === 'name')
      expect(nameError?.message).toBe('缺少必填字段')
      expect(badBody.fields.find((f) => f.path === 'topology')).toBeDefined()

      const createRes = await app.inject({ method: 'POST', url: '/api/environments', payload: envFixture() })
      expect(createRes.statusCode).toBe(201)
      const listRes = await app.inject({ method: 'GET', url: '/api/environments' })
      // 内置模板（冷启动种子：对抗 + 协作）+ 新建环境
      expect((listRes.json() as { environments: unknown[] }).environments).toHaveLength(3)

      // 对局前校验：缺绑定报具体 Agent；规则环境绑裁判报错
      const validateRes = await app.inject({
        method: 'POST',
        url: '/api/environments/env-app/validate',
        payload: { bindings: [{ agentId: 'a', modelConfigId: 'model_x' }] },
      })
      expect(validateRes.statusCode).toBe(400) // 引用不存在的模型配置
      const validateRes2 = await app.inject({
        method: 'POST',
        url: '/api/environments/env-app/validate',
        payload: { bindings: [] },
      })
      const v2Body = validateRes2.json() as { ok: boolean; fields: Array<{ path: string; message: string }> }
      expect(v2Body.ok).toBe(false)
      expect(v2Body.fields.some((f) => f.message.includes('a'))).toBe(true)

      // ---- 9.3 模型配置：新增/测试/脱敏 ----
      const modelARes = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: mockModelConfig('模型A', ['A1', summaryOf('A')]),
      })
      expect(modelARes.statusCode).toBe(201)
      const modelA = modelARes.json() as { id: string; apiKeyTail: string }
      const modelBRes = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: mockModelConfig('模型B', ['B1', summaryOf('B')]),
      })
      const modelB = modelBRes.json() as { id: string; apiKeyTail: string }
      // 密钥脱敏：完整密钥（JSON 脚本）绝不回显；mock 脚本尾缀非常规字符时只显示 ****
      expect(modelA.apiKeyTail).toMatch(/^\*{4}.{0,4}$/s)
      const listModels = (await app.inject({ method: 'GET', url: '/api/models' })).json() as {
        models: Array<Record<string, unknown>>
      }
      for (const m of listModels.models) {
        expect(m.apiKey).toBeUndefined()
        expect(JSON.stringify(m)).not.toContain('mock://arlaf"apiKey') // 不会出现完整密钥字段
      }
      // 连通性测试（mock 端点）
      const testRes = await app.inject({ method: 'POST', url: `/api/models/${modelA.id}/test` })
      expect(testRes.statusCode).toBe(200)
      expect((testRes.json() as { ok: boolean }).ok).toBe(true)
      // 更新（不传 apiKey → 保留旧密钥）
      const updateRes = await app.inject({
        method: 'PUT',
        url: `/api/models/${modelA.id}`,
        payload: { ...mockModelConfig('模型A改名', []), apiKey: '' },
      })
      expect((updateRes.json() as { name: string }).name).toBe('模型A改名')

      // ---- 9.4 对局生命周期 + 胜率统计 ----
      const createMatchRes = await app.inject({
        method: 'POST',
        url: '/api/matches',
        payload: {
          environmentId: 'env-app',
          bindings: [
            { agentId: 'a', modelConfigId: modelA.id },
            { agentId: 'b', modelConfigId: modelB.id },
          ],
        },
      })
      expect(createMatchRes.statusCode).toBe(201)
      const { id: matchId } = createMatchRes.json() as { id: string }

      const startRes = await app.inject({ method: 'POST', url: `/api/matches/${matchId}/start` })
      expect(startRes.statusCode).toBe(202)
      const manager = (app as unknown as { arlaf: { manager: { whenSettled: (id: string) => Promise<string> | undefined } } }).arlaf.manager
      const outcome = await manager.whenSettled(matchId)
      expect(outcome).toBe('completed')

      const detail = (await app.inject({ method: 'GET', url: `/api/matches/${matchId}` })).json() as {
        status: string
        winnerAgentId: string | null
        result: { scores: Record<string, number> } | null
      }
      expect(detail.status).toBe('completed')
      expect(detail.result).not.toBeNull()

      const events = (await app.inject({ method: 'GET', url: `/api/matches/${matchId}/events` })).json() as {
        events: Array<{ seq: number; event: { type: string } }>
      }
      expect(events.events[0]!.event.type).toBe('match.started')
      expect(events.events[events.events.length - 1]!.event.type).toBe('match.completed')
      // 断线补发：since=1 起跳过首事件
      const partial = (await app.inject({ method: 'GET', url: `/api/matches/${matchId}/events?since=1` })).json() as {
        events: Array<{ seq: number }>
      }
      expect(partial.events[0]!.seq).toBe(2)

      const stats = (await app.inject({ method: 'GET', url: '/api/stats?environmentId=env-app' })).json() as {
        stats: Array<{ agentId: string; total: number }>
      }
      expect(stats.stats).toHaveLength(2)
      expect(stats.stats.every((s) => s.total === 1)).toBe(true)

      // ---- 9.5 经验查询与导出 ----
      const docsList = (await app.inject({ method: 'GET', url: '/api/experience?environmentId=env-app' })).json() as {
        docs: Array<{ id: string; kind: string; agentId: string; path: string }>
      }
      expect(docsList.docs).toHaveLength(4) // 2 Agent × (memory + skills)
      const firstDoc = docsList.docs[0]!
      const docDetail = (
        await app.inject({ method: 'GET', url: `/api/experience/${firstDoc.id}` })
      ).json() as { content: string; meta: { kind: string } }
      expect(docDetail.content).toContain(firstDoc.agentId.toUpperCase())
      const exportRes = await app.inject({ method: 'GET', url: `/api/experience/${firstDoc.id}/export` })
      expect(exportRes.headers['content-type']).toContain('text/markdown')
      expect(exportRes.body.length).toBeGreaterThan(0)
      const timeline = (
        await app.inject({ method: 'GET', url: '/api/experience/timeline?environmentId=env-app&agentId=a' })
      ).json() as { timeline: Array<{ kind: string; changesSummary: string }> }
      expect(timeline.timeline).toHaveLength(2)
      expect(timeline.timeline[0]!.changesSummary).toBe('总结-A')

      // ---- 环境删除 ----
      const delRes = await app.inject({ method: 'DELETE', url: '/api/environments/env-app' })
      expect(delRes.statusCode).toBe(200)
      expect((await app.inject({ method: 'GET', url: '/api/environments/env-app' })).statusCode).toBe(404)
    } finally {
      await teardown()
    }
  }, 30000)

  it('AI 生成环境草稿（generate-draft）：mock 模型返回合法草稿；非法引用被 422 拦截', async () => {
    await setup()
    try {
      const badDraft = {
        name: '坏草稿',
        description: '',
        topology: 'asymmetric',
        roles: [
          { id: 'r1', name: 'A 角', systemPrompt: 's', goal: 'g', answerFormat: 'free' },
          { id: 'r2', name: 'B 角', systemPrompt: 's', goal: 'g', answerFormat: 'free' },
        ],
        agents: [
          { id: 'a', name: 'A', roleId: 'ghost-role', startRound: 1 },
          { id: 'b', name: 'B', roleId: 'r2', startRound: 1 },
        ],
        turns: { rounds: 1, order: ['a', 'b'] },
        toolsEnabled: true,
        workspaceTemplate: { mode: 'private', files: [] },
        exchanges: [],
        outcome: { mode: 'rule', evaluator: 'ai-flavor', params: {} },
        experience: { enabled: false, tokenBudget: 1000, recentMemoryLimit: 2 },
      }
      const genModelRes = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: { name: '生成模型', baseUrl: 'mock://arlaf', apiKey: JSON.stringify([JSON.stringify(badDraft)]), model: 'mock', params: {} },
      })
      const genModel = genModelRes.json() as { id: string }

      const res = await app.inject({
        method: 'POST',
        url: '/api/environments/generate-draft',
        payload: { idea: '设计一个红队蓝队安全攻防的对抗环境', modelConfigId: genModel.id },
      })
      expect(res.statusCode).toBe(422) // 形状合法但引用不一致 → 422 + 字段级错误
      const body = res.json() as { fields: Array<{ path: string; message: string }> }
      expect(body.fields.some((f) => f.message.includes('ghost-role'))).toBe(true)

      // 合法草稿 → 200
      const goodDraft = { ...badDraft, agents: [badDraft.agents[0]!.roleId !== 'r1' ? badDraft.agents[0]! : { ...badDraft.agents[0]!, roleId: 'r1' }, badDraft.agents[1]!] }
      void goodDraft
      const genModel2Res = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: {
          name: '生成模型2',
          baseUrl: 'mock://arlaf',
          apiKey: JSON.stringify([
            JSON.stringify({
              ...badDraft,
              agents: [
                { id: 'a', name: 'A', roleId: 'r1', startRound: 1 },
                { id: 'b', name: 'B', roleId: 'r2', startRound: 1 },
              ],
            }),
          ]),
          model: 'mock',
          params: {},
        },
      })
      const genModel2 = genModel2Res.json() as { id: string }
      const okRes = await app.inject({
        method: 'POST',
        url: '/api/environments/generate-draft',
        payload: { idea: '设计一个写作对抗环境', modelConfigId: genModel2.id },
      })
      expect(okRes.statusCode).toBe(200)
      const okBody = okRes.json() as { draft: { name: string; agents: unknown[] } }
      expect(okBody.draft.name).toBe('坏草稿')

      // 不存在的模型 → 400
      const noModel = await app.inject({
        method: 'POST',
        url: '/api/environments/generate-draft',
        payload: { idea: '随便来一个', modelConfigId: 'model_missing' },
      })
      expect(noModel.statusCode).toBe(400)
    } finally {
      await teardown()
    }
  }, 20000)
})
