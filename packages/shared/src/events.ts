import { z } from 'zod'
import { JUDGE_AGENT_ID } from './schema'

/** 裁判结构化判定：对抗模式产出胜者；协作模式产出团队得分（0-100）与优劣势复盘 */
export const JudgeVerdictSchema = z.object({
  winnerAgentId: z.string().nullable().optional(),
  teamScore: z.number().min(0).max(100).optional(),
  scores: z.record(z.number()).optional(),
  reasoning: z.string(),
  strengths: z.string().optional(),
  shortcomings: z.string().optional(),
})
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>

/** 单轮单 Agent 行动记录（结果摘要的每轮日志） */
export const RoundEntrySchema = z.object({
  agentId: z.string(),
  content: z.string(),
  ts: z.number(),
})
export type RoundEntry = z.infer<typeof RoundEntrySchema>

/** 对局结果摘要 */
export const MatchResultSchema = z.object({
  matchId: z.string(),
  environmentId: z.string(),
  winnerAgentId: z.string().nullable(),
  scores: z.record(z.number()),
  rounds: z.array(z.object({ round: z.number().int(), entries: z.array(RoundEntrySchema) })),
  verdict: JudgeVerdictSchema.optional(),
  finishedAt: z.number(),
})
export type MatchResult = z.infer<typeof MatchResultSchema>

/** 裁判输入（engine 内部构造，判定的可审计依据） */
export interface JudgeInput {
  rubric: string
  /** 每个参战 Agent 的最终产出 */
  submissions: Array<{ agentId: string; content: string }>
}

/** 事件载荷（discriminated union on `type`） */
export const MatchStartedPayload = z.object({
  environmentId: z.string(),
  environmentName: z.string(),
  agentIds: z.array(z.string()),
})
export const RoundStartedPayload = z.object({ round: z.number().int() })
export const RoundCompletedPayload = z.object({ round: z.number().int() })
export const AgentActionStartedPayload = z.object({ agentId: z.string(), round: z.number().int() })
export const AgentActionPayload = z.object({
  agentId: z.string(),
  round: z.number().int(),
  content: z.string(),
})
export const ArtifactDeliveredPayload = z.object({
  exchangeId: z.string(),
  artifact: z.string(),
  fromAgentId: z.string(),
  toAgentId: z.string(),
  round: z.number().int(),
  /** 内容摘要（审计用，非全文） */
  preview: z.string(),
})
export const AccessDeniedPayload = z.object({
  agentId: z.string(),
  round: z.number().int(),
  path: z.string(),
  operation: z.enum(['read', 'write']),
  reason: z.string(),
})
export const InjectionRecordedPayload = z.object({
  agentId: z.string(),
  skillsChars: z.number().int(),
  memoryCount: z.number().int(),
  injectedChars: z.number().int(),
  budgetChars: z.number().int(),
})
export const LlmRetryPayload = z.object({
  purpose: z.enum(['agent', 'judge', 'summarize']),
  agentId: z.string().nullable(),
  attempt: z.number().int(),
  delayMs: z.number(),
  error: z.string(),
})
export const JudgeInvalidOutputPayload = z.object({
  attempt: z.number().int(),
  error: z.string(),
})
export const JudgeVerdictPayload = JudgeVerdictSchema
export const ExperienceSummarizedPayload = z.object({
  agentId: z.string(),
  environmentId: z.string(),
  matchId: z.string(),
  kind: z.enum(['memory', 'skills']),
  path: z.string(),
  changesSummary: z.string(),
})
export const MatchCompletedPayload = z.object({ result: MatchResultSchema })
export const MatchFailedPayload = z.object({
  error: z.string(),
  failedAgentId: z.string().nullable(),
  reason: z.string(),
})

export const MatchEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('match.started'), payload: MatchStartedPayload }),
  z.object({ type: z.literal('round.started'), payload: RoundStartedPayload }),
  z.object({ type: z.literal('round.completed'), payload: RoundCompletedPayload }),
  z.object({ type: z.literal('agent.action_started'), payload: AgentActionStartedPayload }),
  z.object({ type: z.literal('agent.action'), payload: AgentActionPayload }),
  z.object({ type: z.literal('artifact.delivered'), payload: ArtifactDeliveredPayload }),
  z.object({ type: z.literal('access.denied'), payload: AccessDeniedPayload }),
  z.object({ type: z.literal('injection.recorded'), payload: InjectionRecordedPayload }),
  z.object({ type: z.literal('llm.retry'), payload: LlmRetryPayload }),
  z.object({ type: z.literal('judge.invalid_output'), payload: JudgeInvalidOutputPayload }),
  z.object({ type: z.literal('judge.verdict'), payload: JudgeVerdictPayload }),
  z.object({ type: z.literal('experience.summarized'), payload: ExperienceSummarizedPayload }),
  z.object({ type: z.literal('match.completed'), payload: MatchCompletedPayload }),
  z.object({ type: z.literal('match.failed'), payload: MatchFailedPayload }),
])
/** 事件类型字面量集合 */
export type MatchEventType = MatchEvent['type']
export type MatchEventPayloads = {
  [K in MatchEventType]: Extract<MatchEvent, { type: K }>['payload']
}

/** 带单调递增序号与时间戳的事件信封（WS 补发/回放以 seq 为准） */
export interface MatchEventEnvelope {
  seq: number
  ts: number
  event: MatchEvent
}

export type MatchEvent = z.infer<typeof MatchEventSchema>

/** 判定事件使用的胜者字段与 judge 绑定 id 保持一致 */
export const judgeAgentId = JUDGE_AGENT_ID
