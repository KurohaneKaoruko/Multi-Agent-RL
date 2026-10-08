import type { ModelConfig } from '@arlaf/shared'
import {
  isRetryableStatus,
  LlmHttpError,
  type ChatRequest,
  type ChatResponse,
  type CompleteOptions,
  type LLMClient,
} from './types'

export interface OpenAIClientOptions {
  timeoutMs?: number
  maxRetries?: number
  retryBaseDelayMs?: number
}

const DEFAULTS: Required<OpenAIClientOptions> = {
  timeoutMs: 60_000,
  maxRetries: 3,
  retryBaseDelayMs: 500,
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new Error('aborted'))
      },
      { once: true },
    )
  })
}

/** 指数退避 + 抖动；429 优先使用 Retry-After */
function computeDelay(attempt: number, baseMs: number, retryAfterMs?: number): number {
  if (retryAfterMs != null) return retryAfterMs
  const exp = baseMs * 2 ** (attempt - 1)
  const jitter = exp * 0.2 * Math.random()
  return Math.min(30_000, Math.round(exp + jitter))
}

/**
 * OpenAI 兼容 client：POST {baseUrl}/chat/completions。
 * 内置超时、指数退避重试（429/5xx/网络错误），重试经 onRetry 上报。
 */
export class OpenAICompatibleClient implements LLMClient {
  private readonly cfg: Required<OpenAIClientOptions>

  constructor(
    private readonly config: ModelConfig,
    options: OpenAIClientOptions = {},
  ) {
    this.cfg = { ...DEFAULTS, ...options }
  }

  async complete(req: ChatRequest, opts: CompleteOptions = {}): Promise<ChatResponse> {
    let lastError: unknown
    for (let attempt = 1; attempt <= this.cfg.maxRetries + 1; attempt++) {
      try {
        return await this.attemptOnce(req, opts.signal)
      } catch (err) {
        lastError = err
        const retryable =
          (err instanceof LlmHttpError && isRetryableStatus(err.status)) ||
          (err instanceof TypeError /* fetch 网络错误 */)
        const exhausted = attempt > this.cfg.maxRetries
        if (!retryable || exhausted) break
        const retryAfterMs =
          err instanceof LlmHttpError && err.status === 429 ? err.retryAfterMs : undefined
        const delayMs = computeDelay(attempt, this.cfg.retryBaseDelayMs, retryAfterMs)
        opts.onRetry?.({
          attempt,
          delayMs,
          error: err instanceof Error ? err.message : String(err),
        })
        await sleep(delayMs, opts.signal)
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  private async attemptOnce(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const base = this.config.baseUrl.replace(/\/+$/, '')
    const params = req.params ?? {}
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs)
    const onOuterAbort = () => controller.abort()
    signal?.addEventListener('abort', onOuterAbort, { once: true })
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: req.messages,
          ...(params.temperature != null ? { temperature: params.temperature } : {}),
          ...(params.topP != null ? { top_p: params.topP } : {}),
          ...(params.maxTokens != null ? { max_tokens: params.maxTokens } : {}),
          ...(req.responseFormatJson ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const bodyText = await res.text().catch(() => '')
        const err = new LlmHttpError(res.status, bodyText.slice(0, 300) || res.statusText)
        const ra = res.headers.get('retry-after')
        if (ra != null) err.retryAfterMs = Number(ra) * 1000 || undefined
        throw err
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const text = data.choices?.[0]?.message?.content ?? ''
      return {
        text,
        usage: data.usage
          ? { promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0 }
          : undefined,
      }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onOuterAbort)
    }
  }
}
