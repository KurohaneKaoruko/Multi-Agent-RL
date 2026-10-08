import { describe, expect, it } from 'vitest'
import { OpenAICompatibleClient } from './openai'
import { MockProvider, encodeMockConfig, decodeMockScript, type MockStep } from './mock'
import type { LLMClient, RetryInfo } from './types'
import type { ModelConfig } from '@arlaf/shared'

function fakeConfig(baseUrl: string, apiKey = 'sk-test'): ModelConfig {
  return { id: 'm', name: 'Test', baseUrl, apiKey, model: 'test-model', params: {} }
}

describe('MockProvider', () => {
  it('按脚本顺序返回响应', async () => {
    const mock = new MockProvider({ script: ['第一响应', '第二响应'] })
    const r1 = await mock.complete({ messages: [{ role: 'user', content: 'q1' }] })
    const r2 = await mock.complete({ messages: [{ role: 'user', content: 'q2' }] })
    expect(r1.text).toBe('第一响应')
    expect(r2.text).toBe('第二响应')
    expect(mock.calls.map((c) => c.messages[0]?.content)).toEqual(['q1', 'q2'])
  })

  it('脚本耗尽时抛出显式错误', async () => {
    const mock = new MockProvider({ script: ['only'] })
    await mock.complete({ messages: [] })
    await expect(mock.complete({ messages: [] })).rejects.toThrow('script exhausted')
  })

  it('脚本编解码往返', () => {
    const script: MockStep[] = ['ok', { failure: { status: 429, message: 'rate' } }]
    const { baseUrl, apiKey } = encodeMockConfig(script)
    expect(baseUrl.startsWith('mock:')).toBe(true)
    expect(decodeMockScript(apiKey)).toEqual(script)
  })
})

describe('LLM client 重试语义（经 MockProvider 验证脚本化重试路径）', () => {
  it('瞬时错误后重试成功并上报 onRetry', async () => {
    const retries: RetryInfo[] = []
    const mock = new MockProvider({
      script: [{ failure: { status: 500, message: 'boom' } }, '恢复'],
      retryBaseDelayMs: 1,
    })
    const res = await mock.complete({ messages: [] }, { onRetry: (r) => retries.push(r) })
    expect(res.text).toBe('恢复')
    expect(retries).toHaveLength(1)
    expect(retries[0]?.attempt).toBe(1)
  })

  it('重试耗尽后抛出可诊断错误', async () => {
    const retries: RetryInfo[] = []
    const mock = new MockProvider({
      script: [
        { failure: { status: 503, message: 'down-1' } },
        { failure: { status: 503, message: 'down-2' } },
      ],
      maxRetries: 1,
      retryBaseDelayMs: 1,
    })
    await expect(
      mock.complete({ messages: [] }, { onRetry: (r) => retries.push(r) }),
    ).rejects.toThrow('Mock failure 503: down-2')
    expect(retries).toHaveLength(1)
  })

  it('4xx 非瞬时错误不重试直接抛出', async () => {
    const mock = new MockProvider({
      script: [
        { failure: { status: 401, message: 'unauthorized' } },
        '不应到达',
      ],
    })
    await expect(mock.complete({ messages: [] })).rejects.toThrow('401')
    expect(mock.calls).toHaveLength(1)
  })
})

describe('OpenAICompatibleClient（本地 HTTP 服务验证真实请求路径）', () => {
  it('发出 chat/completions 请求并解析响应', async () => {
    const { createServer } = await import('node:http')
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c: Buffer) => (body += c))
      req.on('end', () => {
        const parsed = JSON.parse(body) as { model: string; messages: unknown[] }
        expect(parsed.model).toBe('test-model')
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            choices: [{ message: { content: '你好' } }],
            usage: { prompt_tokens: 5, completion_tokens: 2 },
          }),
        )
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    const client: LLMClient = new OpenAICompatibleClient(fakeConfig(`http://127.0.0.1:${port}/v1`), {
      timeoutMs: 2000,
      maxRetries: 0,
    })
    const res = await client.complete({
      messages: [{ role: 'user', content: 'hi' }],
      params: { temperature: 0.5 },
    })
    expect(res.text).toBe('你好')
    expect(res.usage?.completionTokens).toBe(2)
    await new Promise<void>((r) => server.close(() => r()))
  })
})
