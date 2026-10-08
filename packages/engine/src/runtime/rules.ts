import type { EnvironmentConfig, RoundEntry } from '@marl/shared'
import { extractJson } from '../llm/structured'

/** 规则判定上下文 */
export interface RuleOutcomeContext {
  env: EnvironmentConfig
  /** 每轮行动记录 */
  entries: Array<{ round: number; entries: RoundEntry[] }>
  /** 环境判定参数（由具体判定器自定义，如阈值、评分权重等） */
  params: Record<string, unknown>
}

export interface RuleOutcome {
  scores: Record<string, number>
  winnerAgentId: string | null
  reasoning?: string
}

export type RuleEvaluator = (ctx: RuleOutcomeContext) => RuleOutcome

/** 从回答中提取辨别结论 {verdict: 'ai'|'human'}（优先最后一个 fenced 块，其次整体提取的 JSON） */
export function parseDetectorVerdict(content: string): 'ai' | 'human' | null {
  const candidates: string[] = []
  for (const m of content.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    candidates.push(m[1]!.trim())
  }
  const bare = extractJson(content)
  if (bare) candidates.push(bare)
  for (const candidate of [...candidates].reverse()) {
    try {
      const parsed = JSON.parse(candidate) as { verdict?: unknown }
      if (parsed?.verdict === 'ai' || parsed?.verdict === 'human') return parsed.verdict
    } catch {
      /* 尝试下一候选 */
    }
  }
  return null
}

/**
 * 内置「AI 味对抗」判定器（零和互斥）：写作者是 AI，真实判定恒为 "ai"。
 * 辨别者识破（verdict=ai）→ 辨别者得该轮；被蒙骗（verdict=human）→ 写作者得该轮。
 * 得分：detector = 识破率，writers = 被蒙骗率（两者之和恒为 1，严格互斥）。
 * 胜者：识破率 > 0.5 判别者胜，< 0.5 写作者胜，恰好 0.5（或无可判定轮次）为平局。
 */
export const aiFlavorEvaluator: RuleEvaluator = ({ env, entries }) => {
  const detector =
    env.agents.find((a) => env.roles.find((r) => r.id === a.roleId)?.answerFormat === 'json') ??
    env.agents[env.agents.length - 1]!
  const writers = env.agents.map((a) => a.id).filter((id) => id !== detector.id)

  let caught = 0
  let total = 0
  for (const { entries: roundEntries } of entries) {
    const det = [...roundEntries].reverse().find((e) => e.agentId === detector.id)
    if (!det) continue
    const verdict = parseDetectorVerdict(det.content)
    if (verdict == null) continue
    total++
    // 真实答案恒为 "ai"：辨别者说出 "ai" 即识破
    if (verdict === 'ai') caught++
  }

  const catchRate = total === 0 ? 0 : caught / total
  const scores: Record<string, number> = {}
  for (const id of writers) scores[id] = 1 - catchRate
  scores[detector.id] = catchRate

  let winnerAgentId: string | null = null
  if (total > 0) {
    if (catchRate > 0.5) winnerAgentId = detector.id
    else if (catchRate < 0.5) winnerAgentId = writers[0] ?? null
  }
  return { scores, winnerAgentId, reasoning: `识破率 ${caught}/${total}（互斥判定：识破 = 辨别者胜，被蒙骗 = 写作者胜）` }
}

/** 内置规则判定器注册表（可用 opts.ruleEvaluators 扩展/覆盖） */
export const builtinRuleEvaluators: Record<string, RuleEvaluator> = {
  'ai-flavor': aiFlavorEvaluator,
}
