import type { z } from 'zod'
import type { ChatMessage, ChatRequest, LLMClient } from './types'

/** 结构化输出失败（重问耗尽后抛出，调用方转为显式事件） */
export class StructuredOutputError extends Error {
  readonly attempts: number
  readonly lastRaw: string
  readonly lastError: string
  constructor(attempts: number, lastRaw: string, lastError: string) {
    super(`结构化输出失败（共 ${attempts} 次尝试）: ${lastError}`)
    this.name = 'StructuredOutputError'
    this.attempts = attempts
    this.lastRaw = lastRaw
    this.lastError = lastError
  }
}

const JSON_INSTRUCTION =
  '你必须只输出一个合法的 JSON 对象，不要输出任何其他文字、解释或 Markdown 代码块之外的内容。'

/** 从模型回复中提取 JSON：优先 fenced ```json 块，否则取首个 { 到末个 } 的片段 */
export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  if (fenced?.[1]) return fenced[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) return text.slice(start, end + 1)
  return text.trim()
}

export interface StructuredOptions {
  /** 失败重问次数上限（默认 2，符合设计 D3：上限 2 次） */
  maxReprompts?: number
  onRetryAttempt?: (info: { attempt: number; error: string }) => void
}

/**
 * 带校验重问的结构化输出：要求 JSON → 提取 → Zod 校验 → 失败则携带错误重问。
 */
export async function completeStructured<S extends z.ZodType>(
  client: LLMClient,
  req: ChatRequest,
  schema: S,
  options: StructuredOptions = {},
): Promise<z.output<S>> {
  const maxReprompts = options.maxReprompts ?? 2
  const messages: ChatMessage[] = [
    ...req.messages.map((m) => ({ ...m })),
  ]
  const first = messages[messages.length - 1]
  if (first && first.role === 'user') {
    first.content = `${first.content}\n\n${JSON_INSTRUCTION}`
  } else {
    messages.push({ role: 'user', content: JSON_INSTRUCTION })
  }

  let attempt = 0
  let lastRaw = ''
  let lastError = ''
  for (;;) {
    attempt++
    lastError = ''
    const res = await client.complete({ ...req, messages })
    lastRaw = res.text
    let parsed: unknown
    try {
      parsed = JSON.parse(extractJson(res.text))
    } catch (e) {
      lastError = `JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`
    }
    if (lastError === '') {
      const validated = schema.safeParse(parsed)
      if (validated.success) return validated.data
      lastError = validated.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')
    }
    if (attempt > maxReprompts) {
      throw new StructuredOutputError(attempt, lastRaw, lastError)
    }
    options.onRetryAttempt?.({ attempt, error: lastError })
    messages.push({ role: 'assistant', content: res.text })
    messages.push({
      role: 'user',
      content: `你的输出不符合要求（${lastError}）。请重新只输出一个符合要求的合法 JSON 对象。`,
    })
  }
}
