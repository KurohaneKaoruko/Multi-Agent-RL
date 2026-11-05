// 训练趋势统计（纯函数）：对既有对局结果做批次/多批次维度的量化聚合。
// 数据源为现有存储（matches + experience_index），不新增采集；本模块不依赖任何 IO。
// 输入为服务端映射后的最小记录形状（TrainingMatchInput），跨范式按环境分组天然不混合。
import type { Paradigm } from './schema'
import type { BatchStats, BatchTrendReport, MatchStatus, TrendPoint, WinRateByAgentEntry } from './dto'

/** 趋势统计输入：单场对局的最小量化形状（由服务端从 matches 行 + result_json 派生） */
export interface TrainingMatchInput {
  id: string
  environmentId: string
  environmentName: string
  paradigm: Paradigm
  status: MatchStatus
  winnerAgentId: string | null
  /** 协作范式团队评分（0-100），无则 null */
  teamScore: number | null
  agentIds: string[]
  /** 批量连续训练批次 id；单场对局为 null（不参与批次统计） */
  batchId: string | null
  createdAt: number
  finishedAt: number | null
  /** 完成场次的回合数（result.rounds.length）；未完成为 null */
  rounds: number | null
}

const average = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length

/**
 * 单批次聚合：同批次（同环境）全部对局 → 胜负平分布、按 Agent 胜率、
 * 平均回合数、平均团队评分与经验沉淀量。
 * 分母约定：胜率/回合数只统计完成场次；失败场次仅计入 matchCount/failedCount。
 */
export function computeBatchStats(
  batchId: string,
  matches: readonly TrainingMatchInput[],
  experienceCount = 0,
): BatchStats {
  const completed = matches.filter((m) => m.status === 'completed')
  const pendingOrRunning = matches.filter((m) => m.status === 'pending' || m.status === 'running').length
  const failedCount = matches.length - completed.length - pendingOrRunning
  const wins = completed.filter((m) => m.winnerAgentId != null).length
  const draws = completed.length - wins

  // 按 Agent 聚合：分母 = 该 Agent 参与的完成场次（平局计入分母不计胜场）
  const agg = new Map<string, { wins: number; participations: number }>()
  for (const m of completed) {
    for (const agentId of m.agentIds) {
      const cur = agg.get(agentId) ?? { wins: 0, participations: 0 }
      cur.participations += 1
      if (m.winnerAgentId === agentId) cur.wins += 1
      agg.set(agentId, cur)
    }
  }
  const winRateByAgent: WinRateByAgentEntry[] = [...agg.entries()]
    .map(([agentId, v]) => ({
      agentId,
      wins: v.wins,
      participations: v.participations,
      winRate: v.participations > 0 ? v.wins / v.participations : null,
    }))
    .sort((a, b) => a.agentId.localeCompare(b.agentId))

  const first = matches.reduce<TrainingMatchInput | null>(
    (min, m) => (min == null || m.createdAt < min.createdAt ? m : min),
    null,
  )
  const headParadigm = first?.paradigm ?? 'adversarial'
  // 主角 Agent（首场对局的首个槽位）胜率：批次演进的主指标（每场必有胜者时全场占比恒为 1，无意义）
  // 协作范式无胜者概念，恒为 null
  const protagonistId = first?.agentIds[0] ?? null
  const protagonist = protagonistId != null ? (agg.get(protagonistId) ?? null) : null
  const protagonistWinRate =
    protagonist && protagonist.participations > 0 && headParadigm !== 'cooperative'
      ? protagonist.wins / protagonist.participations
      : null

  const finished = matches.map((m) => m.finishedAt).filter((t): t is number => t != null)

  const head = first
  return {
    batchId,
    environmentId: head?.environmentId ?? '',
    environmentName: head?.environmentName ?? '',
    paradigm: headParadigm,
    matchCount: matches.length,
    completedCount: completed.length,
    failedCount,
    wins,
    draws,
    /** 主角 Agent（首场首槽位）胜率 0-1；无完成为 null（协作范式每场无胜者也为 null） */
    protagonistWinRate,
    winRateByAgent,
    avgRounds: average(completed.map((m) => m.rounds).filter((r): r is number => r != null)),
    avgTeamScore: average(completed.map((m) => m.teamScore).filter((s): s is number => s != null)),
    experienceCount,
    startedAt: head?.createdAt ?? 0,
    finishedAt: finished.length > 0 ? Math.max(...finished) : null,
  }
}

/**
 * 批次总体胜率：主角 Agent（批次内首场对局的首个 Agent 槽位）的胜率。
 * 对抗/靶场每场必有胜者，全场胜者占比恒为 1 无趋势意义；主角胜率才随训练演进。
 * 协作范式无胜者概念恒为 null。
 */
function overallWinRate(batch: BatchStats): number | null {
  if (batch.paradigm === 'cooperative') return null
  return batch.protagonistWinRate
}

interface EnvAccumulator {
  environmentName: string
  paradigm: Paradigm
  batches: BatchStats[]
}

/**
 * 多批次趋势报告：按环境分组（同 batchId 不同环境绝不混合），
 * 批次按开始时间升序排列；产出各指标随批次的演进序列与首末批对比摘要。
 * experienceByMatch：matchId → 该场沉淀的经验条数（服务端从 experience_index 派生）。
 */
export function buildBatchTrendReports(
  matches: readonly TrainingMatchInput[],
  experienceByMatch: ReadonlyMap<string, number>,
): BatchTrendReport[] {
  // 分组：环境 + 批次（跨范式/跨环境不混合）
  const groups = new Map<string, TrainingMatchInput[]>()
  for (const m of matches) {
    if (!m.batchId) continue
    const key = `${m.environmentId}\u0000${m.batchId}`
    const list = groups.get(key)
    if (list) list.push(m)
    else groups.set(key, [m])
  }

  const byEnv = new Map<string, EnvAccumulator>()
  for (const [key, groupMatches] of groups) {
    const batchId = key.split('\u0000')[1]!
    const experienceCount = groupMatches.reduce((sum, m) => sum + (experienceByMatch.get(m.id) ?? 0), 0)
    const stats = computeBatchStats(batchId, groupMatches, experienceCount)
    const env = byEnv.get(stats.environmentId)
    if (env) {
      env.batches.push(stats)
    } else {
      byEnv.set(stats.environmentId, {
        environmentName: stats.environmentName,
        paradigm: stats.paradigm,
        batches: [stats],
      })
    }
  }

  const reports: BatchTrendReport[] = []
  for (const [environmentId, env] of byEnv) {
    const batches = [...env.batches].sort((a, b) => a.startedAt - b.startedAt || a.batchId.localeCompare(b.batchId))

    const toPoints = (pick: (batch: BatchStats, index: number) => number | null): TrendPoint[] =>
      batches.map((batch, index) => ({ batchId: batch.batchId, batchIndex: index + 1, value: pick(batch, index) }))

    const winRateTrend = toPoints((batch) => overallWinRate(batch))
    const avgRoundsTrend = toPoints((batch) => batch.avgRounds)
    const avgTeamScoreTrend = toPoints((batch) => batch.avgTeamScore)

    // 经验沉淀量：逐批增量累计
    let cumulative = 0
    const experienceCumulativeTrend = toPoints((batch) => (cumulative += batch.experienceCount))

    // 关键 Agent 胜率演进：批次间出现的全部 Agent（并集），缺席批次记 null
    const agentIds = [...new Set(batches.flatMap((b) => b.winRateByAgent.map((e) => e.agentId)))].sort()
    const winRateByAgentTrend = agentIds.map((agentId) => ({
      agentId,
      points: batches.map((batch, index) => ({
        batchId: batch.batchId,
        batchIndex: index + 1,
        value: batch.winRateByAgent.find((e) => e.agentId === agentId)?.winRate ?? null,
      })),
    }))

    const firstBatch = batches[0]
    const lastBatch = batches[batches.length - 1]
    const firstValue = (points: TrendPoint[]): number | null => points[0]?.value ?? null
    const lastValue = (points: TrendPoint[]): number | null => points[points.length - 1]?.value ?? null
    const delta = (points: TrendPoint[]): number | null => {
      const first = firstValue(points)
      const last = lastValue(points)
      return batches.length > 1 && first != null && last != null ? last - first : null
    }

    reports.push({
      environmentId,
      environmentName: env.environmentName,
      paradigm: env.paradigm,
      batches,
      winRateTrend,
      avgRoundsTrend,
      avgTeamScoreTrend,
      experienceCumulativeTrend,
      winRateByAgentTrend,
      summary: {
        batchCount: batches.length,
        winRateDelta: delta(winRateTrend),
        avgRoundsDelta: delta(avgRoundsTrend),
        avgTeamScoreDelta: delta(avgTeamScoreTrend),
        experienceTotal: firstBatch ? experienceCumulativeTrend[experienceCumulativeTrend.length - 1]!.value ?? 0 : 0,
      },
    })
  }

  // 环境按首个批次开始时间排序（最早的在前）
  return reports.sort((a, b) => (a.batches[0]?.startedAt ?? 0) - (b.batches[0]?.startedAt ?? 0))
}
