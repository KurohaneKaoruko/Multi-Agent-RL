import type { ModelParams } from '@marl/shared'

/** OpenAI 兼容聊天消息 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  messages: ChatMessage[]
  params?: ModelParams
  /** 请求模型输出 JSON（映射 response_format，部分端点不支持则忽略） */
  responseFormatJson?: boolean
}

export interface ChatResponse {
  text: string
  usage?: { promptTokens: number; completionTokens: number }
}

export interface RetryInfo {
  attempt: number
  delayMs: number
  error: string
}

export interface CompleteOptions {
  /** 重试时回调（engine 将其转为 llm.retry 事件） */
  onRetry?: (info: RetryInfo) => void
  signal?: AbortSignal
}

export interface LLMClient {
  complete(req: ChatRequest, opts?: CompleteOptions): Promise<ChatResponse>
}

/** 可重试判定：429 与 5xx 及网络错误视为瞬时错误 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

/** HTTP 层错误（含状态码与响应摘要，供诊断） */
export class LlmHttpError extends Error {
  readonly status: number
  /** 429 时从 Retry-After 解析的建议等待时间 */
  retryAfterMs?: number
  constructor(status: number, message: string) {
    super(`LLM HTTP ${status}: ${message}`)
    this.name = 'LlmHttpError'
    this.status = status
  }
}
