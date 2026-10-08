import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { MatchEventEnvelope, ModelConfig } from '@marl/shared'
import { createMatch } from './match'
import { FileExperienceStore } from './experience'

function mockBinding(agentId: string, script: unknown[]): { agentId: string; modelConfig: ModelConfig } {
  return {
    agentId,
    modelConfig: {
      id: `m-${agentId}`,
      name: agentId,
      baseUrl: 'mock://arlaf',
      apiKey: JSON.stringify(script),
      model: 'mock',
      params: {},
    },
  }
}

const summaryOf = (tag: string) =>
  JSON.stringify({ memory: `记忆-${tag}`, skills: `技能-${tag}`, changesSummary: `总结-${tag}` })

function envWithExperience(overrides: Record<string, unknown> = {}) {
  return {
    id: 'env-exp',
    name: '进化测试',
    description: '',
    topology: 'asymmetric' as const,
    roles: [
      { id: 'r1', name: '角色一', systemPrompt: 's', goal: 'g', answerFormat: 'free' as const },
      { id: 'r2', name: '角色二', systemPrompt: 's', goal: 'g', answerFormat: 'free' as const },
    ],
    agents: [
      { id: 'a', name: 'A', roleId: 'r1', startRound: 1 },
      { id: 'b', name: 'B', roleId: 'r2', startRound: 1 },
    ],
    turns: { rounds: 1, order: ['a', 'b'] },
    workspaceTemplate: { files: [] },
    exchanges: [],
    outcome: { mode: 'rule' as const, evaluator: 'fixed', params: {} },
    experience: { enabled: true, tokenBudget: 2000, recentMemoryLimit: 3 },
    ...overrides,
  }
}

async function runOne(store: FileExperienceStore, base: string, env: ReturnType<typeof envWithExperience>, scriptA: unknown[], scriptB: unknown[]) {
  const handle = createMatch(env, {
    bindings: [mockBinding('a', scriptA), mockBinding('b', scriptB)],
    dataDir: base,
    experienceStore: store,
    ruleEvaluators: { fixed: () => ({ scores: { a: 1, b: 0 }, winnerAgentId: 'a' }) },
  })
  const events: MatchEventEnvelope[] = []
  const draining = (async () => {
    for await (const e of handle.events) events.push(e)
  })()
  const result = await handle.run()
  await draining
  return { result, events }
}

describe('经验总结与落盘（7.1/7.2）', () => {
  it('mock 下每 Agent 产出 MEMORY/SKILLS 文档与索引', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-exp-'))
    try {
      const store = new FileExperienceStore(path.join(base, 'experience'))
      const { events } = await runOne(store, base, envWithExperience(), ['A1', summaryOf('A')], ['B1', summaryOf('B')])

      const summarized = events.filter((e) => e.event.type === 'experience.summarized')
      // 每Agent 2 类文档 × 2 Agent = 4
      expect(summarized).toHaveLength(4)
      for (const agentId of ['a', 'b']) {
        const records = await store.list('env-exp', agentId)
        expect(records.map((r) => r.kind).sort()).toEqual(['memory', 'skills'])
        for (const record of records) {
          const content = await store.readContent(record)
          expect(content).toContain(agentId.toUpperCase())
          // 文件确实写在约定路径 data/experience/<envId>/<agentId>/
          expect(record.path).toContain(`env-exp/${agentId}/`)
        }
        const memory = records.find((r) => r.kind === 'memory')
        expect(memory?.summary).toBe(`总结-${agentId.toUpperCase()}`)
      }
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})

describe('经验注入（7.3）', () => {
  it('第二局上下文包含首局经验，且注入事件被记录', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-exp2-'))
    try {
      const store = new FileExperienceStore(path.join(base, 'experience'))
      await runOne(store, base, envWithExperience(), ['A1', summaryOf('A')], ['B1', summaryOf('B')])
      const { events } = await runOne(store, base, envWithExperience(), ['A2', summaryOf('A2')], ['B2', summaryOf('B2')])

      const injections = events.filter((e) => e.event.type === 'injection.recorded')
      expect(injections).toHaveLength(2) // 每Agent 一次
      const inj = injections[0]
      if (inj?.event.type === 'injection.recorded') {
        const payload = inj.event.payload
        expect(payload.memoryCount).toBe(1)
        expect(payload.skillsChars).toBeGreaterThan(0)
        expect(payload.injectedChars).toBeLessThanOrEqual(payload.budgetChars)
      }
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('超出 token 预算时按策略裁剪且不超限', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-exp3-'))
    try {
      const store = new FileExperienceStore(path.join(base, 'experience'))
      const env = envWithExperience({
        experience: { enabled: true, tokenBudget: 4, recentMemoryLimit: 3 }, // 4 tokens ≈ 10 chars
      })
      await runOne(store, base, env, ['A1', summaryOf('很长很长很长的记忆内容超出预算')], ['B1', summaryOf('B')])
      const { events } = await runOne(store, base, env, ['A2', summaryOf('A2')], ['B2', summaryOf('B2')])
      const inj = events.find((e) => e.event.type === 'injection.recorded')
      if (inj?.event.type === 'injection.recorded') {
        const payload = inj.event.payload
        expect(payload.injectedChars).toBeLessThanOrEqual(payload.budgetChars)
        expect(payload.budgetChars).toBe(10)
      } else {
        throw new Error('应有注入事件')
      }
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})

describe('进化时间线（7.4）', () => {
  it('两局后每 Agent 的经验记录含两次变更', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-exp4-'))
    try {
      const store = new FileExperienceStore(path.join(base, 'experience'))
      await runOne(store, base, envWithExperience(), ['A1', summaryOf('A1')], ['B1', summaryOf('B1')])
      await runOne(store, base, envWithExperience(), ['A2', summaryOf('A2')], ['B2', summaryOf('B2')])
      const skills = await store.list('env-exp', 'a', 'skills')
      const memories = await store.list('env-exp', 'a', 'memory')
      expect(skills).toHaveLength(2)
      expect(memories).toHaveLength(2)
      // 时间线：两条 SKILLS 变更摘要分别为两局的总结
      expect(skills.map((r) => r.summary)).toEqual(['总结-A1', '总结-A2'])
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
