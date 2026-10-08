import { describe, expect, it } from 'vitest'
import { MatchEventSchema, MatchResultSchema, type MatchEvent, type MatchEventEnvelope } from './index'

/** 全部事件类型（2.2 验证：事件类型完备） */
const ALL_TYPES = [
  'match.started',
  'round.started',
  'round.completed',
  'agent.action_started',
  'agent.action',
  'artifact.delivered',
  'access.denied',
  'injection.recorded',
  'llm.retry',
  'judge.invalid_output',
  'judge.verdict',
  'experience.summarized',
  'match.completed',
  'match.failed',
] as const

function sampleEvent(type: (typeof ALL_TYPES)[number]): MatchEvent {
  switch (type) {
    case 'match.started':
      return { type, payload: { environmentId: 'e', environmentName: 'n', agentIds: ['a', 'b'] } }
    case 'round.started':
    case 'round.completed':
      return { type, payload: { round: 1 } }
    case 'agent.action_started':
      return { type, payload: { agentId: 'a', round: 1 } }
    case 'agent.action':
      return { type, payload: { agentId: 'a', round: 1, content: '文本' } }
    case 'artifact.delivered':
      return {
        type,
        payload: { exchangeId: 'ex', artifact: 'manuscript', fromAgentId: 'a', toAgentId: 'b', round: 1, preview: '...' },
      }
    case 'access.denied':
      return { type, payload: { agentId: 'a', round: 1, path: '/x', operation: 'read', reason: '越权' } }
    case 'injection.recorded':
      return { type, payload: { agentId: 'a', skillsChars: 10, memoryCount: 2, injectedChars: 100, budgetChars: 200 } }
    case 'llm.retry':
      return { type, payload: { purpose: 'agent', agentId: 'a', attempt: 1, delayMs: 100, error: '429' } }
    case 'judge.invalid_output':
      return { type, payload: { attempt: 1, error: 'bad json' } }
    case 'judge.verdict':
      return { type, payload: { winnerAgentId: 'a', scores: { a: 1 }, reasoning: 'r' } }
    case 'experience.summarized':
      return {
        type,
        payload: { agentId: 'a', environmentId: 'e', matchId: 'm', kind: 'skills', path: 'p', changesSummary: 's' },
      }
    case 'match.completed':
      return {
        type,
        payload: {
          result: {
            matchId: 'm',
            environmentId: 'e',
            winnerAgentId: 'a',
            scores: { a: 1, b: 0 },
            rounds: [{ round: 1, entries: [{ agentId: 'a', content: 'c', ts: 1 }] }],
            finishedAt: 2,
          },
        },
      }
    case 'match.failed':
      return { type, payload: { error: 'e', failedAgentId: 'a', reason: '模型持续失败' } }
  }
}

describe('MatchEventSchema', () => {
  it('覆盖全部事件类型且均可 JSON 序列化往返', () => {
    expect(ALL_TYPES).toHaveLength(MatchEventSchema.options.length)
    for (const type of ALL_TYPES) {
      const event = sampleEvent(type)
      const roundTrip = JSON.parse(JSON.stringify(event))
      expect(MatchEventSchema.safeParse(roundTrip).success, `type=${type}`).toBe(true)
    }
  })

  it('拒绝未知事件类型', () => {
    expect(MatchEventSchema.safeParse({ type: 'unknown', payload: {} }).success).toBe(false)
  })

  it('MatchResult 校验：胜者可为 null', () => {
    const result = {
      matchId: 'm',
      environmentId: 'e',
      winnerAgentId: null,
      scores: {},
      rounds: [],
      finishedAt: 1,
    }
    expect(MatchResultSchema.safeParse(result).success).toBe(true)
  })

  it('envelope 形状（seq 单调递增由引擎保证，类型仅约束结构）', () => {
    const env: MatchEventEnvelope = { seq: 1, ts: Date.now(), event: sampleEvent('round.started') }
    expect(env.seq).toBeGreaterThanOrEqual(1)
  })
})
