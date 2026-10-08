import { JudgeVerdictSchema, type JudgeVerdict } from '@arlaf/shared'
import type { LLMClient } from '../llm/types'
import { completeStructured, StructuredOutputError } from '../llm/structured'
import type { EmitEvent } from './agent'

/** 裁判持续输出不合规（重问耗尽） */
export class JudgeFailureError extends Error {
  constructor(readonly cause2: StructuredOutputError) {
    super(`裁判判定失败：${cause2.message}`)
    this.name = 'JudgeFailureError'
  }
}

/**
 * AI 裁判执行（5.1/5.2）：按 rubric 收集双方产出 → 结构化判定。
 * 输出不合规时经 completeStructured 重问（上限 2 次，每次记 judge.invalid_output 事件）；
 * 超限抛 JudgeFailureError（由对局层转为 match.failed 事件）。
 */
export async function runJudge(deps: {
  rubric: string
  client: LLMClient
  submissions: Array<{ agentId: string; content: string }>
  /** 协作模式（Agent-RLCF）：不判胜负，输出团队评分（0-100）与优劣势复盘 */
  teamMode?: boolean
  emit: EmitEvent
}): Promise<JudgeVerdict> {
  const { rubric, client, submissions, emit, teamMode = false } = deps
  const submissionText = submissions
    .map((s) => `【Agent ${s.agentId} 的产出】\n${s.content}`)
    .join('\n\n')
  const schema = JudgeVerdictSchema
  const system = teamMode
    ? '你是协作环境的公正 AI 评审。你的任务不是分出胜负，而是评估整个团队的产出质量并帮助团队改进。'
    : '你是对抗环境的公正 AI 裁判。你只能依据给出的评分标准与双方产出做判定，不偏袒任何一方。'
  const instruction = teamMode
    ? `评分标准（rubric）：\n${rubric}\n\n团队各成员产出：\n${submissionText}\n\n请输出 JSON：{"teamScore": 0-100 的团队总分, "strengths": "本次协作的亮点", "shortcomings": "短板与改进方向", "reasoning": "评分理由"}`
    : `评分标准（rubric）：\n${rubric}\n\n双方产出：\n${submissionText}\n\n请输出 JSON：{"winnerAgentId": 胜者 agentId 或 null（平局）, "scores": {agentId: 分数}, "reasoning": "判定理由"}`
  let verdict
  try {
    verdict = await completeStructured(
      client,
      {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: instruction },
        ],
        responseFormatJson: true,
      },
      schema,
      {
        maxReprompts: 2,
        onRetryAttempt: ({ attempt, error }) => {
          emit({ type: 'judge.invalid_output', payload: { attempt, error } })
        },
      },
    )
  } catch (err) {
    if (err instanceof StructuredOutputError) {
      emit({
        type: 'judge.invalid_output',
        payload: { attempt: err.attempts, error: err.lastError },
      })
      throw new JudgeFailureError(err)
    }
    throw err
  }
  emit({ type: 'judge.verdict', payload: verdict })
  return verdict
}
