// 训练趋势面板展示纯逻辑：把 BatchTrendReport（含单批或多批）整理为面板数字卡与迷你条形数据
import type { BatchStats, BatchTrendReport } from '@marl/shared'

/** 面板顶部的摘要数字卡 */
export interface TrendStatCard {
  label: string
  value: string
  /** 相对首批的变化说明（如「+0.20」「−1.5 轮」）；单批/无数据为 null */
  delta: string | null
  /** delta 方向：up=改善（绿）、down=退步（红）、flat=无变化/未知 */
  direction: 'up' | 'down' | 'flat'
}

/** 单指标迷你条形（每个批次一根） */
export interface TrendBar {
  batchId: string
  label: string
  /** 0-100（展示用百分比）；null 表示该批无此指标 */
  percent: number | null
  /** 条形旁的数值文字 */
  text: string
}

export interface TrendPanelView {
  /** 摘要数字卡（胜率 / 平均回合数 / 团队评分 / 经验沉淀） */
  cards: TrendStatCard[]
  /** 迷你条形图组（仅多批次时非空） */
  bars: TrendBar[]
  /** 按 Agent 胜率演进的文字行（多批次时非空） */
  agentLines: Array<{ agentId: string; text: string }>
}

const pct = (v: number | null | undefined): string => (v == null ? '—' : `${Math.round(v * 100)}%`)
const num = (v: number | null | undefined, unit = ''): string => (v == null ? '—' : `${Math.round(v * 100) / 100}${unit}`)

const signed = (v: number, unit = ''): string => `${v >= 0 ? '+' : ''}${Math.round(v * 100) / 100}${unit}`

/** 方向判定：winRate/团队评分/经验 越大越好；rounds 越小越好（越快收敛） */
const deltaDirection = (delta: number | null, lowerIsBetter = false): 'up' | 'down' | 'flat' => {
  if (delta == null || delta === 0) return 'flat'
  const improved = lowerIsBetter ? delta < 0 : delta > 0
  return improved ? 'up' : 'down'
}

/** 从演进序列取首末值 */
function endpoints(points: Array<{ value: number | null }>): { first: number | null; last: number | null } {
  const values = points.map((p) => p.value)
  return { first: values[0] ?? null, last: values[values.length - 1] ?? null }
}

/** 把单指标演进序列转为迷你条形。scale：ratio=0-1 比例（乘 100），score=0-100 直接用 */
export function toTrendBars(
  points: BatchTrendReport['winRateTrend'],
  unit = '',
  scale: 'ratio' | 'score' = 'ratio',
): TrendBar[] {
  return points.map((p, i) => ({
    batchId: p.batchId,
    label: `批 ${i + 1}`,
    percent:
      p.value == null
        ? null
        : scale === 'score'
          ? Math.max(0, Math.min(100, p.value))
          : Math.max(0, Math.min(100, p.value * 100)),
    text: p.value == null ? '—' : `${Math.round(p.value * 100) / 100}${unit}`,
  }))
}

/** 面板完整视图：兼容单批（无趋势线，只出数字卡）与多批（含条形与 delta） */
export function buildTrendPanelView(report: BatchTrendReport): TrendPanelView {
  const multi = report.batches.length > 1
  const { first: wrFirst, last: wrLast } = endpoints(report.winRateTrend)
  const { first: roundsFirst, last: roundsLast } = endpoints(report.avgRoundsTrend)
  const { first: scoreFirst, last: scoreLast } = endpoints(report.avgTeamScoreTrend)
  const experienceFirst = report.experienceCumulativeTrend[0]?.value ?? null

  const cards: TrendStatCard[] = [
    {
      label: '批次总体胜率',
      value: pct(wrLast),
      delta: multi && wrFirst != null && wrLast != null ? signed(wrLast - wrFirst) : null,
      direction: deltaDirection(multi && wrFirst != null && wrLast != null ? wrLast - wrFirst : null),
    },
    {
      label: '平均回合数',
      value: num(roundsLast, ' 轮'),
      delta:
        multi && roundsFirst != null && roundsLast != null ? signed(roundsLast - roundsFirst, ' 轮') : null,
      direction: deltaDirection(multi && roundsFirst != null && roundsLast != null ? roundsLast - roundsFirst : null, true),
    },
  ]
  // 协作范式才有团队评分卡
  if (scoreLast != null) {
    cards.push({
      label: '平均团队评分',
      value: num(scoreLast),
      delta: multi && scoreFirst != null ? signed(scoreLast - scoreFirst) : null,
      direction: deltaDirection(multi && scoreFirst != null && scoreLast != null ? scoreLast - scoreFirst : null),
    })
  }
  cards.push({
    label: '经验沉淀',
    value: `${report.summary.experienceTotal} 条`,
    delta: multi && experienceFirst != null && report.summary.experienceTotal !== experienceFirst
      ? signed(report.summary.experienceTotal - experienceFirst, ' 条')
      : null,
    direction: deltaDirection(
      multi && experienceFirst != null ? report.summary.experienceTotal - experienceFirst : null,
    ),
  })

  // 迷你条形：胜率为主指标；协作范式用团队评分（0-100 直接刻度）
  const primaryBars = report.paradigm === 'cooperative' && scoreLast != null
    ? toTrendBars(report.avgTeamScoreTrend, '', 'score')
    : toTrendBars(report.winRateTrend)

  const agentLines = report.winRateByAgentTrend.map((t) => ({
    agentId: t.agentId,
    text: t.points.map((p, i) => `批${i + 1} ${pct(p.value)}`).join(' → '),
  }))

  return { cards, bars: multi ? primaryBars : [], agentLines: multi ? agentLines : [] }
}

/** 批次列表行 → 趋势报告查找：行代表批次首场，batchId 匹配对应报告 */
export function findReportForBatch(reports: readonly BatchTrendReport[], batchId: string | null | undefined): BatchTrendReport | null {
  if (!batchId) return null
  return reports.find((r) => r.batches.some((b: BatchStats) => b.batchId === batchId)) ?? null
}
