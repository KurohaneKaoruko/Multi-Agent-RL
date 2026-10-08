import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { MockProvider } from './mock'
import { completeStructured, extractJson, StructuredOutputError } from './structured'

const VerdictSchema = z.object({ winner: z.string(), score: z.number() })

describe('extractJson', () => {
  it('提取 fenced json 块', () => {
    expect(extractJson('说明\n```json\n{"a":1}\n```\n尾注')).toBe('{"a":1}')
  })
  it('提取裸 JSON 片段', () => {
    expect(extractJson('前置文字 {"a":1} 后置')).toBe('{"a":1}')
  })
})

describe('completeStructured', () => {
  it('合法输出直通', async () => {
    const mock = new MockProvider({ script: ['{"winner":"a","score":3}'] })
    const v = await completeStructured(mock, { messages: [{ role: 'user', content: 'judge' }] }, VerdictSchema)
    expect(v).toEqual({ winner: 'a', score: 3 })
  })

  it('fenced JSON 输出直通', async () => {
    const mock = new MockProvider({ script: ['```json\n{"winner":"b","score":1}\n```'] })
    const v = await completeStructured(mock, { messages: [{ role: 'user', content: 'x' }] }, VerdictSchema)
    expect(v.winner).toBe('b')
  })

  it('畸形输出触发重问后成功', async () => {
    const attempts: Array<{ attempt: number }> = []
    const mock = new MockProvider({ script: ['抱歉我无法输出 JSON', '{"winner":"a","score":2}'] })
    const v = await completeStructured(
      mock,
      { messages: [{ role: 'user', content: 'x' }] },
      VerdictSchema,
      { onRetryAttempt: (i) => attempts.push(i) },
    )
    expect(v.winner).toBe('a')
    expect(attempts).toHaveLength(1)
    // 第二次请求携带了纠错消息
    const second = mock.calls[1]
    expect(second?.messages.some((m) => m.role === 'user' && m.content.includes('不符合要求'))).toBe(true)
  })

  it('校验失败（字段缺失）也触发重问', async () => {
    const mock = new MockProvider({ script: ['{"winner":"a"}', '{"winner":"a","score":9}'] })
    const v = await completeStructured(mock, { messages: [{ role: 'user', content: 'x' }] }, VerdictSchema)
    expect(v.score).toBe(9)
  })

  it('两次重问后仍失败则抛出显式错误', async () => {
    const mock = new MockProvider({ script: ['bad1', 'bad2', 'bad3'] })
    await expect(
      completeStructured(mock, { messages: [{ role: 'user', content: 'x' }] }, VerdictSchema),
    ).rejects.toBeInstanceOf(StructuredOutputError)
    expect(mock.calls).toHaveLength(3) // 1 次初始 + 2 次重问
  })
})
