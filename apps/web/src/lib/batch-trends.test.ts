// 训练趋势面板纯逻辑单测：数字卡 / 迷你条形 / Agent 演进行 / 批次报告查找
import { describe, expect, it } from 'vitest'
import type { BatchTrendReport, TrendPoint } from '@marl/shared'
import { buildTrendPanelView, findReportForBatch, toTrendBars } from './batch-trends'

const point = (value: number | null): TrendPoint => ({ batchId: 'b', batchIndex: 1, value })

/** 构造最小趋势报告（字段可覆盖） */
function report(overrides: Partial<BatchTrendReport> = {}): BatchTrendReport {
  return {
    environmentId: 'env-a',
    environmentName: '环境A',
    paradigm: 'adversarial',
    batches: [],
    winRateTrend: [point(0.5)],
    avgRoundsTrend: [point(4)],
    avgTeamScoreTrend: [],
    experienceCumulativeTrend: [point(3)],
    winRateByAgentTrend: [],
    summary: {
      batchCount: 1,
      winRateDelta: null,
      avgRoundsDelta: null,
      avgTeamScoreDelta: null,
      experienceTotal: 3,
    },
    ...overrides,
  }
}

describe('buildTrendPanelView', () => {
  it('单批次：只出数字卡，无条形与 Agent 行，delta 为 null', () => {
    const view = buildTrendPanelView(report())
    expect(view.cards).toHaveLength(3) // 胜率 / 回合数 / 经验（对抗范式无评分卡）
    expect(view.cards.every((c) => c.delta === null)).toBe(true)
    expect(view.bars).toEqual([])
    expect(view.agentLines).toEqual([])
    expect(view.cards[0]).toEqual({ label: '批次总体胜率', value: '50%', delta: null, direction: 'flat' })
    expect(view.cards[1]).toEqual({ label: '平均回合数', value: '4 轮', delta: null, direction: 'flat' })
  })

  it('多批次对抗：胜率/回合 delta 与方向（回合数下降=up 改善）', () => {
    const view = buildTrendPanelView(
      report({
        batches: [{}, {}] as BatchTrendReport['batches'],
        winRateTrend: [point(0.5), point(0.75)],
        avgRoundsTrend: [point(4), point(2)],
        experienceCumulativeTrend: [point(3), point(8)],
        summary: { batchCount: 2, winRateDelta: 0.25, avgRoundsDelta: -2, avgTeamScoreDelta: null, experienceTotal: 8 },
      }),
    )
    const winRate = view.cards.find((c) => c.label === '批次总体胜率')!
    expect(winRate).toEqual({ label: '批次总体胜率', value: '75%', delta: '+0.25', direction: 'up' })
    const rounds = view.cards.find((c) => c.label === '平均回合数')!
    expect(rounds).toEqual({ label: '平均回合数', value: '2 轮', delta: '-2 轮', direction: 'up' })
    const exp = view.cards.find((c) => c.label === '经验沉淀')!
    expect(exp.delta).toBe('+5 条')
    expect(view.bars.map((b) => b.percent)).toEqual([50, 75])
    expect(view.bars.map((b) => b.label)).toEqual(['批 1', '批 2'])
  })

  it('胜率下降标记 down；协作范式主条形用团队评分', () => {
    const down = buildTrendPanelView(
      report({
        batches: [{}, {}] as BatchTrendReport['batches'],
        winRateTrend: [point(0.6), point(0.3)],
        summary: { batchCount: 2, winRateDelta: -0.3, avgRoundsDelta: null, avgTeamScoreDelta: null, experienceTotal: 0 },
      }),
    )
    expect(down.cards.find((c) => c.label === '批次总体胜率')!.direction).toBe('down')

    const coop = buildTrendPanelView(
      report({
        paradigm: 'cooperative',
        batches: [{}, {}] as BatchTrendReport['batches'],
        winRateTrend: [point(null), point(null)],
        avgTeamScoreTrend: [point(60), point(85)],
        summary: { batchCount: 2, winRateDelta: null, avgRoundsDelta: null, avgTeamScoreDelta: 25, experienceTotal: 0 },
      }),
    )
    // 团队评分卡出现；主条形为评分（0-100 直接归一）
    expect(coop.cards.some((c) => c.label === '平均团队评分')).toBe(true)
    expect(coop.bars.map((b) => b.percent)).toEqual([60, 85])
  })

  it('多批次 Agent 胜率演进行：null 记 —', () => {
    const view = buildTrendPanelView(
      report({
        batches: [{}, {}] as BatchTrendReport['batches'],
        winRateByAgentTrend: [
          { agentId: 'a', points: [point(1), point(0.5)] },
          { agentId: 'b', points: [point(0), point(null)] },
        ],
      }),
    )
    expect(view.agentLines).toEqual([
      { agentId: 'a', text: '批1 100% → 批2 50%' },
      { agentId: 'b', text: '批1 0% → 批2 —' },
    ])
  })
})

describe('toTrendBars / findReportForBatch', () => {
  it('toTrendBars：null 值与越界归一化；score 刻度直接采用 0-100', () => {
    const bars = toTrendBars([point(null), point(1.5), point(0.25)])
    expect(bars.map((b) => b.percent)).toEqual([null, 100, 25])
    const scoreBars = toTrendBars([point(60), point(85), point(120)], '', 'score')
    expect(scoreBars.map((b) => b.percent)).toEqual([60, 85, 100])
  })

  it('findReportForBatch：按 batchId 命中报告；单场对局（null）与未命中返回 null', () => {
    const reports = [
      report({ batches: [{ batchId: 'batch_1' }] as BatchTrendReport['batches'] }),
      report({ environmentId: 'env-b', batches: [{ batchId: 'batch_2' }] as BatchTrendReport['batches'] }),
    ]
    expect(findReportForBatch(reports, 'batch_2')?.environmentId).toBe('env-b')
    expect(findReportForBatch(reports, 'batch_404')).toBeNull()
    expect(findReportForBatch(reports, null)).toBeNull()
    expect(findReportForBatch(reports, undefined)).toBeNull()
  })
})
