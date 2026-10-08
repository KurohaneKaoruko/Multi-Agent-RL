import type {
  ChatRequest,
  ChatResponse,
  CompleteOptions,
  LLMClient,
} from './types'

/** Mock 脚本条目：字符串 = 正常响应；{failure} = 抛出错误 */
export type MockStep = string | { failure: { status: number; message: string } }

export interface MockProviderOptions {
  /** 按调用顺序消费的脚本 */
  script: MockStep[]
  /** 记录每次收到的请求（供测试断言提示词内容） */
  maxRetries?: number
  retryBaseDelayMs?: number
}

/**
 * 测试替身 / 离线演示：脚本化响应，记录请求。
 * 服务端以 baseUrl='mock:' 协议创建（脚本经 JSON 编码存放于 apiKey 字段）。
 */
export class MockProvider implements LLMClient {
  private index = 0
  readonly calls: ChatRequest[] = []
  private readonly maxRetries: number
  private readonly retryBaseDelayMs: number

  constructor(private readonly options: MockProviderOptions) {
    this.maxRetries = options.maxRetries ?? 3
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1
  }

  get exhausted(): boolean {
    return this.index >= this.options.script.length
  }

  async complete(req: ChatRequest, opts: CompleteOptions = {}): Promise<ChatResponse> {
    this.calls.push(req)
    let lastError: unknown
    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      const step = this.options.script[this.index]
      this.index++
      if (step == null) {
        throw new Error('MockProvider script exhausted（脚本耗尽，无法继续响应）')
      }
      if (typeof step === 'string') {
        return { text: step }
      }
      lastError = new Error(`Mock failure ${step.failure.status}: ${step.failure.message}`)
      const retryable = step.failure.status === 429 || step.failure.status >= 500
      if (!retryable) throw lastError
      if (attempt > this.maxRetries) break
      const delayMs = this.retryBaseDelayMs * 2 ** (attempt - 1)
      opts.onRetry?.({
        attempt,
        delayMs,
        error: lastError instanceof Error ? lastError.message : String(lastError),
      })
      await new Promise((r) => setTimeout(r, delayMs))
    }
    throw lastError instanceof Error ? lastError : new Error('mock failed')
  }
}

/** 将脚本编码为 mock: baseUrl + apiKey 载荷（服务端/测试共用） */
export function encodeMockConfig(script: MockStep[]): { baseUrl: string; apiKey: string } {
  return { baseUrl: 'mock://arlaf', apiKey: JSON.stringify(script) }
}

/** 从 apiKey 载荷解码脚本（非法 JSON 视为单条空响应，便于快速排错） */
export function decodeMockScript(apiKey: string): MockStep[] {
  try {
    const parsed: unknown = JSON.parse(apiKey)
    if (Array.isArray(parsed)) return parsed as MockStep[]
  } catch {
    /* fallthrough */
  }
  return ['']
}
