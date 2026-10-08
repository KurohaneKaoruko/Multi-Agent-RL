import { describe, expect, it } from 'vitest'
import type { MatchEvent, MatchEventEnvelope } from '@arlaf/shared'
import { MockProvider } from '../llm/mock'
import { runJudge, JudgeFailureError } from './judge'

function collect(): { events: MatchEvent[]; emit: (e: MatchEvent) => void } {
  const events: MatchEvent[] = []
  return { events, emit: (e) => events.push(e) }
}

describe('AI 裁判执行（5.1）', () => {
  it('产出结构化判定并记录 judge.verdict 事件', async () => {
    const { events, emit } = collect()
    const client = new MockProvider({
      script: ['```json\n{"winnerAgentId":"a","scores":{"a":1,"b":0},"reasoning":"A 的论证更充分"}\n```'],
    })
    const verdict = await runJudge({
      rubric: '按论证质量评分',
      client,
      submissions: [
        { agentId: 'a', content: 'A 的产出' },
        { agentId: 'b', content: 'B 的产出' },
      ],
      emit,
    })
    expect(verdict.winnerAgentId).toBe('a')
    const event = events.find((e) => e.type === 'judge.verdict')
    expect(event).toBeDefined()
    if (event?.type === 'judge.verdict') {
      expect(event.payload.scores).toEqual({ a: 1, b: 0 })
    }
    // 裁判输入包含 rubric 与双方产出
    const prompt = client.calls[0]!.messages.map((m) => m.content).join('\n')
    expect(prompt).toContain('按论证质量评分')
    expect(prompt).toContain('A 的产出')
    expect(prompt).toContain('B 的产出')
  })
})

describe('裁判异常路径（5.2）', () => {
  it('输出不合规触发重问（judge.invalid_output 事件）后成功', async () => {
    const { events, emit } = collect()
    const client = new MockProvider({ script: ['我判 A 赢（自然语言）', '{"winnerAgentId":null,"scores":{},"reasoning":"平局"}'] })
    const verdict = await runJudge({ rubric: 'r', client, submissions: [], emit })
    expect(verdict.winnerAgentId).toBeNull()
    const invalid = events.filter((e) => e.type === 'judge.invalid_output')
    expect(invalid).toHaveLength(1)
    expect(invalid[0]).toMatchObject({ payload: { attempt: 1 } })
  })

  it('持续不合规：抛 JudgeFailureError 且异常入事件流', async () => {
    const { events, emit } = collect()
    const client = new MockProvider({ script: ['x1', 'x2', 'x3'] })
    await expect(runJudge({ rubric: 'r', client, submissions: [], emit })).rejects.toBeInstanceOf(
      JudgeFailureError,
    )
    const invalid = events.filter((e) => e.type === 'judge.invalid_output')
    expect(invalid.length).toBeGreaterThanOrEqual(3) // 2 次重问 + 1 次最终失败记录
    const last = invalid[invalid.length - 1]
    expect(last).toMatchObject({ payload: { attempt: 3 } })
  })
})

describe('envelope 形状辅助（事件序号由总线保证）', () => {
  it('collect 的 emit 产出可被 MatchEventEnvelope 包裹', () => {
    const env: MatchEventEnvelope = { seq: 1, ts: 0, event: { type: 'judge.verdict', payload: { winnerAgentId: null, scores: {}, reasoning: '' } } }
    expect(env.seq).toBe(1)
  })
})
