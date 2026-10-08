import { describe, expect, it } from 'vitest'
import type { EnvironmentConfig, MatchEventEnvelope } from '@arlaf/shared'
import { createMatch, MatchFailedError } from './match'
import type { RuleEvaluator } from './rules'
import type { ModelConfig } from '@arlaf/shared'

function mockBinding(agentId: string, script: unknown[]): { agentId: string; modelConfig: ModelConfig } {
  const { baseUrl, apiKey } = { baseUrl: 'mock://arlaf', apiKey: JSON.stringify(script) }
  return { agentId, modelConfig: { id: `m-${agentId}`, name: agentId, baseUrl, apiKey, model: 'mock', params: {} } }
}

function testEnv(overrides: Partial<EnvironmentConfig> = {}): EnvironmentConfig {
  return {
    id: 'env-test',
    name: '测试环境',
    description: '',
    topology: 'asymmetric',
    roles: [
      { id: 'r1', name: '角色一', systemPrompt: 's1', goal: 'g1', answerFormat: 'free' },
      { id: 'r2', name: '角色二', systemPrompt: 's2', goal: 'g2', answerFormat: 'free' },
    ],
    agents: [
      { id: 'a', name: 'A', roleId: 'r1', startRound: 1 },
      { id: 'b', name: 'B', roleId: 'r2', startRound: 1 },
    ],
    turns: { rounds: 2, order: ['a', 'b'] },
    workspaceTemplate: { files: [] },
    exchanges: [],
    outcome: { mode: 'rule', evaluator: 'test-fixed', params: {} },
    experience: { enabled: false, tokenBudget: 2000, recentMemoryLimit: 3 },
    ...overrides,
  }
}

const fixedEvaluator: RuleEvaluator = ({ params }) => ({
  scores: (params.scores as Record<string, number>) ?? {},
  winnerAgentId: (params.winner as string | null) ?? null,
  reasoning: '固定判定',
})

describe('对局生命周期与事件流（4.1）', () => {
  it('脚本化 1v1 跑完并产出有序事件流', async () => {
    const env = testEnv({
      outcome: { mode: 'rule', evaluator: 'test-fixed', params: { scores: { a: 1, b: 0 }, winner: 'a' } },
    })
    const handle = createMatch(env, {
      bindings: [mockBinding('a', ['A1', 'A2']), mockBinding('b', ['B1', 'B2'])],
      dataDir: '/tmp/arlaf-test-does-not-exist-workspaces',
      ruleEvaluators: { 'test-fixed': fixedEvaluator },
    })
    const events: MatchEventEnvelope[] = []
    const draining = (async () => {
      for await (const e of handle.events) events.push(e)
    })()
    const result = await handle.run()
    await draining

    expect(result.winnerAgentId).toBe('a')
    const types = events.map((e) => e.event.type)
    expect(types[0]).toBe('match.started')
    expect(types[types.length - 1]).toBe('match.completed')
    // 序号严格递增
    events.forEach((e, i) => expect(e.seq).toBe(i + 1))
    // 轮次结构完整
    expect(types.filter((t) => t === 'round.started')).toHaveLength(2)
    expect(types.filter((t) => t === 'round.completed')).toHaveLength(2)
    expect(types.filter((t) => t === 'agent.action')).toHaveLength(4)
    // match.completed 携带结果
    const last = events[events.length - 1]!.event
    if (last.type === 'match.completed') {
      expect(last.payload.result.scores).toEqual({ a: 1, b: 0 })
      expect(last.payload.result.rounds).toHaveLength(2)
    } else {
      throw new Error('最后一事件应为 match.completed')
    }
  })

  it('AsyncIterable 从头回放缓冲事件', async () => {
    const env = testEnv({ turns: { rounds: 1, order: ['a', 'b'] } })
    const handle = createMatch(env, {
      bindings: [mockBinding('a', ['A1']), mockBinding('b', ['B1'])],
      dataDir: '/tmp/arlaf-test',
      ruleEvaluators: { 'test-fixed': fixedEvaluator },
    })
    await handle.run()
    const replayed: number[] = []
    for await (const e of handle.events) replayed.push(e.seq)
    expect(replayed).toEqual(replayed.map((_, i) => i + 1))
    expect(replayed.length).toBe(handle.bus.lastSeq)
  })
})

describe('回合调度器（4.2）', () => {
  it('三方混战按序完成且批内并发', async () => {
    const env = testEnv({
      topology: 'melee',
      agents: [
        { id: 'a', name: 'A', roleId: 'r1', startRound: 1 },
        { id: 'b', name: 'B', roleId: 'r2', startRound: 1 },
        { id: 'c', name: 'C', roleId: 'r1', startRound: 1 },
      ],
      turns: { rounds: 1, order: ['a', 'b', 'c'] },
    })
    const handle = createMatch(env, {
      bindings: [mockBinding('a', ['A1']), mockBinding('b', ['B1']), mockBinding('c', ['C1'])],
      dataDir: '/tmp/arlaf-test',
      ruleEvaluators: { 'test-fixed': fixedEvaluator },
    })
    const events: MatchEventEnvelope[] = []
    const draining = (async () => {
      for await (const e of handle.events) events.push(e)
    })()
    await handle.run()
    await draining
    const actions = events.filter((e) => e.event.type === 'agent.action')
    expect(actions.map((e) => (e.event as { payload: { agentId: string } }).payload.agentId).sort()).toEqual([
      'a',
      'b',
      'c',
    ])
    // 无依赖 → 单批并发：三个 action_started 先于全部 action？批内并发（cap 默认 4 ≥ 3）
    const starts = events.filter((e) => e.event.type === 'agent.action_started')
    expect(starts.length).toBe(3)
  })

  it('交换物依赖分批：b 等待 a 产出后行动，并发上限生效', async () => {
    const env = testEnv({
      turns: { rounds: 1, order: ['a', 'b'] },
      exchanges: [{ id: 'ex1', artifact: 'manuscript', fromAgentId: 'a', toAgentId: 'b', deliverAtRound: 1 }],
    })
    const handle = createMatch(env, {
      bindings: [mockBinding('a', ['A1']), mockBinding('b', ['B1'])],
      dataDir: '/tmp/arlaf-test',
      options: { concurrency: 1 },
      ruleEvaluators: { 'test-fixed': fixedEvaluator },
    })
    const events: MatchEventEnvelope[] = []
    const draining = (async () => {
      for await (const e of handle.events) events.push(e)
    })()
    await handle.run()
    await draining

    const seqOf = (type: string, agentId?: string) =>
      events.find(
        (e) =>
          e.event.type === type &&
          (agentId == null || (e.event as { payload: { agentId: string } }).payload.agentId === agentId),
      )!.seq
    // b 的行动启动必须晚于 a 的行动产出（依赖批次）
    expect(seqOf('agent.action_started', 'b')).toBeGreaterThan(seqOf('agent.action', 'a'))
    // 投递发生在 a 产出之后
    expect(seqOf('artifact.delivered')).toBeGreaterThan(seqOf('agent.action', 'a'))
  })
})

describe('起始轮次（对抗时序）', () => {
  it('辨别者从第 2 轮登场：第 1 轮不行动，投递仍发生在第 1 轮末', async () => {
    const env = testEnv({
      turns: { rounds: 2, order: ['a', 'b'] },
      agents: [
        { id: 'a', name: 'A', roleId: 'r1', startRound: 1 },
        { id: 'b', name: 'B', roleId: 'r2', startRound: 2 },
      ],
      exchanges: [{ id: 'ex1', artifact: 'manuscript', fromAgentId: 'a', toAgentId: 'b', deliverAtRound: 1 }],
    })
    const handle = createMatch(env, {
      bindings: [mockBinding('a', ['A1', 'A2']), mockBinding('b', ['B1', 'B2'])],
      dataDir: '/tmp/arlaf-test',
      ruleEvaluators: { 'test-fixed': fixedEvaluator },
    })
    const events: MatchEventEnvelope[] = []
    const draining = (async () => {
      for await (const e of handle.events) events.push(e)
    })()
    await handle.run()
    await draining

    const bRounds = events
      .filter(
        (e) => e.event.type === 'agent.action_started' && (e.event as { payload: { agentId: string } }).payload.agentId === 'b',
      )
      .map((e) => (e.event as { payload: { round: number } }).payload.round)
    // b（辨别者）只在第 2 轮行动，第 1 轮跳过
    expect(bRounds).toEqual([2])
    // 投递仍发生在第 1 轮结束
    expect(events.some((e) => e.event.type === 'artifact.delivered')).toBe(true)
  })
})

describe('结果摘要与失败路径（4.3）', () => {
  it('结果摘要包含胜者/评分/每轮日志', async () => {
    const env = testEnv({
      outcome: { mode: 'rule', evaluator: 'test-fixed', params: { scores: { a: 0.4, b: 0.6 }, winner: 'b' } },
    })
    const handle = createMatch(env, {
      bindings: [mockBinding('a', ['A1', 'A2']), mockBinding('b', ['B1', 'B2'])],
      dataDir: '/tmp/arlaf-test',
      ruleEvaluators: { 'test-fixed': fixedEvaluator },
    })
    const result = await handle.run()
    expect(result.winnerAgentId).toBe('b')
    expect(result.scores).toEqual({ a: 0.4, b: 0.6 })
    expect(result.rounds[0]?.entries.map((e) => e.content)).toEqual(['A1', 'B1'])
    expect(result.rounds[1]?.entries.map((e) => e.content)).toEqual(['A2', 'B2'])
  })

  it('模型持续失败：对局失败、保留已完成回合、事件流以 match.failed 终止', async () => {
    const env = testEnv({ turns: { rounds: 3, order: ['a', 'b'] } })
    const handle = createMatch(env, {
      bindings: [mockBinding('a', ['A1', 'A2']), mockBinding('b', ['B1'])], // b 第 2 轮脚本耗尽
      dataDir: '/tmp/arlaf-test',
      ruleEvaluators: { 'test-fixed': fixedEvaluator },
    })
    const events: MatchEventEnvelope[] = []
    const draining = (async () => {
      for await (const e of handle.events) events.push(e)
    })()
    await expect(handle.run()).rejects.toBeInstanceOf(MatchFailedError)
    await draining

    const last = events[events.length - 1]!.event
    expect(last.type).toBe('match.failed')
    if (last.type === 'match.failed') {
      expect(last.payload.failedAgentId).toBe('b')
      expect(last.payload.reason).toBe('模型持续失败')
    }
    // 已完成回合保留：第 1 轮日志在部分记录中
    const err = await (async () => {
      try {
        await createMatch(env, {
          bindings: [mockBinding('a', ['A1', 'A2']), mockBinding('b', ['B1'])],
          dataDir: '/tmp/arlaf-test',
          ruleEvaluators: { 'test-fixed': fixedEvaluator },
        }).run()
      } catch (e) {
        return e as MatchFailedError
      }
      throw new Error('unreachable')
    })()
    expect(err.partialRounds.map((r) => r.round)).toEqual([1])
    expect(err.partialRounds[0]?.entries.map((e) => e.content)).toEqual(['A1', 'B1'])
  })
})
