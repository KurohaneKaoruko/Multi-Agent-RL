import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { FieldError } from '@marl/shared'

/** 由 shared Zod schema 生成 JSON Schema（draft-07，兼容 fastify ajv 与 OpenAPI 文档） */
export function zodBody(schema: z.ZodType): Record<string, unknown> {
  return zodToJsonSchema(schema) as Record<string, unknown>
}

/** Zod issue → 中文可读消息（字段级） */
function zhMessage(issue: z.ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined' ? '缺少必填字段' : '字段类型不正确'
    case 'too_small':
      return `取值过小（最小 ${String(issue.minimum)}）`
    case 'too_big':
      return `取值过大（最大 ${String(issue.maximum)}）`
    case 'invalid_enum_value':
      return `取值不合法，允许：${issue.options.join(' / ')}`
    case 'unrecognized_keys':
      return `包含未知字段：${issue.keys.join(', ')}`
    default:
      return '字段校验未通过'
  }
}

export function fieldErrorsFromZod(err: z.ZodError): FieldError[] {
  return err.issues.map((i) => ({
    path: i.path.length > 0 ? i.path.join('.') : '(root)',
    message: zhMessage(i),
  }))
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; fields: FieldError[] }

/** 请求体验证：返回数据（zod 输出类型，含默认值填充）或中文字段级错误 */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): ParseResult<z.output<S>> {
  const parsed = schema.safeParse(body)
  if (parsed.success) return { ok: true, data: parsed.data }
  return { ok: false, fields: fieldErrorsFromZod(parsed.error) }
}
