import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { MatchEvent, MatchEventEnvelope, ModelConfig } from '@marl/shared'
import { createMatch } from './match'
import {
  FileExperienceStore,
  injectExperience,
  readAllSkills,
  readRecentMemories,
  writeExperienceToWorkspace,
} from './experience'
import { WorkspaceController } from './workspace'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

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

function envWithExperience(overrides: Record<string, unknown> = {}): import('@marl/shared').EnvironmentConfig {
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
    toolsEnabled: true,
    workspaceTemplate: { mode: 'private' as const, files: [] },
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

describe('经验库存储单元（append/list/readContent）', () => {
  it('写入 → 列表 → 读回内容 round-trip，kind 过滤与路径归属正确', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-exp-unit-'))
    try {
      const store = new FileExperienceStore(path.join(base, 'experience'))
      const memory = await store.append({
        environmentId: 'env-a',
        agentId: 'agent-1',
        kind: 'memory',
        content: '记忆内容一',
        summary: '摘要一',
        matchId: 'match-1',
        round: 1,
      })
      const skills = await store.append({
        environmentId: 'env-a',
        agentId: 'agent-1',
        kind: 'skills',
        content: '技能内容',
        summary: '摘要二',
        matchId: 'match-1',
        round: null,
      })
      expect(memory.id).toMatch(/^exp_/)
      expect(skills.id).not.toBe(memory.id)
      // 文件路径归属：<envId>/<agentId>/<kind>-<ts>.md
      expect(memory.path.startsWith(path.join('env-a', 'agent-1', 'memory-'))).toBe(true)
      expect(skills.path.startsWith(path.join('env-a', 'agent-1', 'skills-'))).toBe(true)
      // 索引完整可读
      const all = await store.list('env-a', 'agent-1')
      expect(all).toHaveLength(2)
      expect(all.map((r) => r.kind).sort()).toEqual(['memory', 'skills'])
      // kind 过滤
      const onlyMemory = await store.list('env-a', 'agent-1', 'memory')
      expect(onlyMemory).toHaveLength(1)
      expect(onlyMemory[0]!.summary).toBe('摘要一')
      expect(onlyMemory[0]!.matchId).toBe('match-1')
      // 读回内容与写入一致
      expect(await store.readContent(memory)).toBe('记忆内容一')
      expect(await store.readContent(skills)).toBe('技能内容')
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('跨环境/跨对局隔离：同一 Agent 在不同环境的经验互不可见', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-exp-iso-'))
    try {
      const store = new FileExperienceStore(path.join(base, 'experience'))
      await store.append({
        environmentId: 'env-1',
        agentId: 'agent-1',
        kind: 'memory',
        content: '环境一的记忆',
        summary: 's1',
        matchId: 'match-1',
        round: 1,
      })
      await store.append({
        environmentId: 'env-2',
        agentId: 'agent-1',
        kind: 'skills',
        content: '环境二的技能',
        summary: 's2',
        matchId: 'match-2',
        round: null,
      })
      // 各环境只看到自己的记录
      expect((await store.list('env-1', 'agent-1')).map((r) => r.environmentId)).toEqual(['env-1'])
      expect((await store.list('env-2', 'agent-1')).map((r) => r.environmentId)).toEqual(['env-2'])
      // 召回同样按环境隔离：env-2 无记忆可召回，skills 只召回 env-2 自己的
      expect(await readRecentMemories(store, 'env-2', 'agent-1', 3)).toEqual([])
      const skillsOfEnv2 = await readAllSkills(store, 'env-2', 'agent-1')
      expect(skillsOfEnv2).toHaveLength(1)
      expect(skillsOfEnv2[0]!.content).toBe('环境二的技能')
      expect(skillsOfEnv2[0]!.record.environmentId).toBe('env-2')
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})

describe('经验召回（readRecentMemories 滑动窗口）', () => {
  it('按时间倒序召回最近 limit 条，skills 不混入', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-exp-win-'))
    try {
      const store = new FileExperienceStore(path.join(base, 'experience'))
      // 间隔写入确保 ts 严格递增
      for (let i = 1; i <= 5; i++) {
        await store.append({
          environmentId: 'env-a',
          agentId: 'agent-1',
          kind: 'memory',
          content: `记忆-${i}`,
          summary: `摘要-${i}`,
          matchId: `match-${i}`,
          round: i,
        })
        await sleep(4)
      }
      await store.append({
        environmentId: 'env-a',
        agentId: 'agent-1',
        kind: 'skills',
        content: '技能文档',
        summary: '技能摘要',
        matchId: 'match-x',
        round: null,
      })
      const recent = await readRecentMemories(store, 'env-a', 'agent-1', 3)
      expect(recent.map((r) => r.content)).toEqual(['记忆-5', '记忆-4', '记忆-3'])
      // ts 严格倒序
      expect(recent[0]!.record.ts).toBeGreaterThanOrEqual(recent[1]!.record.ts)
      expect(recent[1]!.record.ts).toBeGreaterThanOrEqual(recent[2]!.record.ts)
      // limit 超出总数 → 全量返回且不含 skills
      const all = await readRecentMemories(store, 'env-a', 'agent-1', 10)
      expect(all).toHaveLength(5)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})

describe('工作区「活文件」优先注入（7.3）', () => {
  async function workspaceWith(base: string, files: Record<string, string>): Promise<WorkspaceController> {
    const ws = await WorkspaceController.allocate(path.join(base, 'ws'), 'agent-1', { mode: 'private', files: [] }, () => {})
    for (const [p, content] of Object.entries(files)) await ws.writeFile(p, content)
    return ws
  }

  it('工作区 SKILLS/MEMORY 优先于经验存储，source 记为 workspace，memoryCount 按 ## 条目计', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-exp-ws1-'))
    try {
      const store = new FileExperienceStore(path.join(base, 'experience'))
      await store.append({
        environmentId: 'env-exp',
        agentId: 'a',
        kind: 'memory',
        content: '存储中的旧记忆',
        summary: '旧',
        matchId: 'match-0',
        round: 1,
      })
      const workspace = await workspaceWith(base, {
        'SKILLS.md': '# 攒下的技能\n抢答节奏要稳',
        'MEMORY.md': '## 条目一\n内容一\n\n## 条目二\n内容二',
      })
      const events: MatchEvent[] = []
      const result = await injectExperience({
        env: envWithExperience(),
        agentId: 'a',
        store,
        workspace,
        emit: (e) => {
          events.push(e)
        },
      })
      expect(result).toBeDefined()
      expect(result!.block).toContain('攒下的技能')
      expect(result!.block).toContain('条目二')
      expect(result!.block).not.toContain('存储中的旧记忆')
      expect(result!.memoryCount).toBe(2)
      expect(result!.injectedChars).toBe(result!.skillsChars + '## 条目一\n内容一\n\n## 条目二\n内容二'.length)
      const event = events.find((e) => e.type === 'injection.recorded')
      expect(event).toBeDefined()
      if (event?.type === 'injection.recorded') expect(event.payload.source).toBe('workspace')
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('工作区无经验文件时回退到经验存储（source=store），且按预算裁剪', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-exp-ws2-'))
    try {
      const store = new FileExperienceStore(path.join(base, 'experience'))
      await store.append({
        environmentId: 'env-exp',
        agentId: 'a',
        kind: 'memory',
        content: '存储记忆内容',
        summary: 's',
        matchId: 'match-1',
        round: 1,
      })
      await store.append({
        environmentId: 'env-exp',
        agentId: 'a',
        kind: 'skills',
        content: '存储技能内容',
        summary: 's',
        matchId: 'match-1',
        round: null,
      })
      const workspace = await workspaceWith(base, {})
      const events: MatchEvent[] = []
      const result = await injectExperience({
        env: envWithExperience(),
        agentId: 'a',
        store,
        workspace,
        emit: (e) => {
          events.push(e)
        },
      })
      expect(result).toBeDefined()
      expect(result!.block).toContain('存储记忆内容')
      expect(result!.block).toContain('存储技能内容')
      expect(result!.memoryCount).toBe(1)
      expect(result!.injectedChars).toBeLessThanOrEqual(result!.budgetChars)
      const event = events.find((e) => e.type === 'injection.recorded')
      if (event?.type === 'injection.recorded') expect(event.payload.source).toBe('store')
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('环境禁用经验时返回 undefined 且不发事件', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-exp-off-'))
    try {
      const store = new FileExperienceStore(path.join(base, 'experience'))
      const env = envWithExperience({ experience: { enabled: false, tokenBudget: 2000, recentMemoryLimit: 3 } })
      const events: MatchEvent[] = []
      const result = await injectExperience({
        env,
        agentId: 'a',
        store,
        emit: (e) => {
          events.push(e)
        },
      })
      expect(result).toBeUndefined()
      expect(events).toEqual([])
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})

describe('工作区经验写回（writeExperienceToWorkspace）', () => {
  it('SKILLS.md 覆盖为最新技能，MEMORY.md 追加带时间戳条目且保留旧内容', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-exp-back1-'))
    try {
      const ws = await WorkspaceController.allocate(path.join(base, 'ws'), 'a', { mode: 'private', files: [] }, () => {})
      await ws.writeFile('MEMORY.md', '## 旧条目\n旧内容')
      await writeExperienceToWorkspace(ws, { memory: '新记忆', skills: '# 新技能', changesSummary: '总结' })
      const memory = await ws.readFile('MEMORY.md')
      expect(memory).toContain('## 旧条目')
      expect(memory).toContain('新记忆')
      // 追加条目带时间戳标题：## <zh-CN 时间>\n<记忆>
      expect(memory).toMatch(/## .+\n新记忆/)
      expect(await ws.readFile('SKILLS.md')).toBe('# 新技能')

      // 第二次写回：SKILLS 覆盖、MEMORY 在旧条目之上继续追加
      await writeExperienceToWorkspace(ws, { memory: '再记忆', skills: '# 技能v2', changesSummary: 'x' })
      const memory2 = await ws.readFile('MEMORY.md')
      expect(memory2).toContain('旧条目')
      expect(memory2).toContain('新记忆')
      expect(memory2).toContain('再记忆')
      expect(memory2.indexOf('新记忆')).toBeLessThan(memory2.indexOf('再记忆'))
      expect(await ws.readFile('SKILLS.md')).toBe('# 技能v2')
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('MEMORY.md 超长（>20000 字符）时仅保留尾部 20000 字符再追加', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-exp-back2-'))
    try {
      const ws = await WorkspaceController.allocate(path.join(base, 'ws'), 'a', { mode: 'private', files: [] }, () => {})
      await ws.writeFile('MEMORY.md', 'O'.repeat(25000))
      await writeExperienceToWorkspace(ws, { memory: '截断后的新记忆', skills: 'S', changesSummary: 'c' })
      const memory = await ws.readFile('MEMORY.md')
      // 旧内容被裁剪到尾部 20000 个 'O'
      expect(memory.slice(0, 20000)).toBe('O'.repeat(20000))
      expect(memory).toContain('截断后的新记忆')
      expect(memory.length).toBeLessThan(20100)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
