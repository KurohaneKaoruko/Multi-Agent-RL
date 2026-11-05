// 训练趋势统计纯函数单测：空批 / 单场批 / 多批演进 / 胜负平分布 / 跨范式不混合
import { describe, expect, it } from 'vitest'
import { buildBatchTrendReports, computeBatchStats, type TrainingMatchInput } from './stats'

/** 快速构造对局输入（批量场默认同批次同环境） */
function match(overrides: Partial<TrainingMatchInput> & { id: string }): TrainingMatchInput {
  return {
    environmentId: 'env-a',
    environmentName: '环境A',
    paradigm: 'adversarial',
    status: 'completed',
    winnerAgentId: null,
    teamScore: null,
    agentIds: ['a', 'b'],
    batchId: 'batch_1',
    createdAt: 1000,
    finishedAt: 2000,
    rounds: 3,
    ...overrides,
  }
}

describe('computeBatchStats（单批次聚合）', () => {
  it('空批次：各计数为 0，均值与胜率为 null', () => {
    const stats = computeBatchStats('batch_empty', [], 0)
    expect(stats.batchId).toBe('batch_empty')
    expect(stats.matchCount).toBe(0)
    expect(stats.completedCount).toBe(0)
    expect(stats.failedCount).toBe(0)
    expect(stats.wins).toBe(0)
    expect(stats.draws).toBe(0)
    expect(stats.winRateByAgent).toEqual([])
    expect(stats.avgRounds).toBeNull()
    expect(stats.avgTeamScore).toBeNull()
    expect(stats.experienceCount).toBe(0)
    expect(stats.finishedAt).toBeNull()
  })

  it('单场批：胜负平分布与按 Agent 胜率正确', () => {
    const stats = computeBatchStats(
      'batch_solo',
      [match({ id: 'm1', winnerAgentId: 'a', agentIds: ['a', 'b'], rounds: 4 })],
      2,
    )
    expect(stats.matchCount).toBe(1)
    expect(stats.completedCount).toBe(1)
    expect(stats.wins).toBe(1)
    expect(stats.draws).toBe(0)
    expect(stats.protagonistWinRate).toBe(1)
    expect(stats.avgRounds).toBe(4)
    expect(stats.experienceCount).toBe(2)
    expect(stats.winRateByAgent).toEqual([
      { agentId: 'a', wins: 1, participations: 1, winRate: 1 },
      { agentId: 'b', wins: 0, participations: 1, winRate: 0 },
    ])
  })

  it('胜负平混合分布：平局计入分母不计胜场；失败/进行中只计场数', () => {
    const stats = computeBatchStats('batch_mix', [
      match({ id: 'm1', winnerAgentId: 'a' }),
      match({ id: 'm2', winnerAgentId: 'b' }),
      match({ id: 'm3', winnerAgentId: null }), // 平局
      match({ id: 'm4', status: 'failed', finishedAt: 2500, rounds: null }),
      match({ id: 'm5', status: 'running', finishedAt: null, rounds: null }),
    ])
    expect(stats.matchCount).toBe(5)
    expect(stats.completedCount).toBe(3)
    expect(stats.failedCount).toBe(1)
    expect(stats.wins).toBe(2)
    expect(stats.draws).toBe(1)
    // 主角 = a：完成 3 场胜 1 场
    expect(stats.protagonistWinRate).toBe(1 / 3)
    const agentA = stats.winRateByAgent.find((e) => e.agentId === 'a')!
    expect(agentA).toEqual({ agentId: 'a', wins: 1, participations: 3, winRate: 1 / 3 })
    expect(stats.avgRounds).toBe(3) // 仅完成场次的均值；失败场无 rounds
  })

  it('协作范式：团队评分均值；无胜者完成场次记平局', () => {
    const stats = computeBatchStats('batch_coop', [
      match({ id: 'm1', paradigm: 'cooperative', teamScore: 80 }),
      match({ id: 'm2', paradigm: 'cooperative', teamScore: 90 }),
    ])
    expect(stats.wins).toBe(0)
    expect(stats.draws).toBe(2)
    expect(stats.protagonistWinRate).toBeNull()
    expect(stats.avgTeamScore).toBe(85)
    expect(stats.avgRounds).toBe(3)
  })
})

describe('buildBatchTrendReports（多批次演进）', () => {
  it('空输入：无报告', () => {
    expect(buildBatchTrendReports([], new Map())).toEqual([])
  })

  it('单场批（batchSize=1）也参与趋势；单批无 delta', () => {
    const reports = buildBatchTrendReports([match({ id: 'm1', winnerAgentId: 'a' })], new Map([['m1', 1]]))
    expect(reports).toHaveLength(1)
    const report = reports[0]!
    expect(report.summary.batchCount).toBe(1)
    expect(report.summary.winRateDelta).toBeNull()
    expect(report.summary.avgRoundsDelta).toBeNull()
    expect(report.summary.experienceTotal).toBe(1)
    expect(report.winRateTrend).toEqual([{ batchId: 'batch_1', batchIndex: 1, value: 1 }])
  })

  it('多批演进：胜率/回合数/经验累计按批次升序，delta 为末批 − 首批', () => {
    const matches = [
      // 批次1（更早）：a 全胜，4 轮
      match({ id: 'm1', batchId: 'batch_1', winnerAgentId: 'a', rounds: 4, createdAt: 1000 }),
      match({ id: 'm2', batchId: 'batch_1', winnerAgentId: 'a', rounds: 4, createdAt: 1100 }),
      // 批次2（更晚）：a 半胜，2 轮
      match({ id: 'm3', batchId: 'batch_2', winnerAgentId: 'a', rounds: 2, createdAt: 2000 }),
      match({ id: 'm4', batchId: 'batch_2', winnerAgentId: 'b', rounds: 2, createdAt: 2100 }),
    ]
    const reports = buildBatchTrendReports(matches, new Map([['m1', 2], ['m3', 3]]))
    expect(reports).toHaveLength(1)
    const report = reports[0]!
    expect(report.summary.batchCount).toBe(2)
    expect(report.winRateTrend).toEqual([
      { batchId: 'batch_1', batchIndex: 1, value: 1 },
      { batchId: 'batch_2', batchIndex: 2, value: 0.5 },
    ])
    expect(report.avgRoundsTrend.map((p) => p.value)).toEqual([4, 2])
    expect(report.summary.winRateDelta).toBeCloseTo(-0.5)
    expect(report.summary.avgRoundsDelta).toBe(-2)
    expect(report.experienceCumulativeTrend.map((p) => p.value)).toEqual([2, 5])
    expect(report.summary.experienceTotal).toBe(5)
    // Agent 胜率演进：两批均含 a、b
    expect(report.winRateByAgentTrend.map((t) => t.agentId)).toEqual(['a', 'b'])
    const trendA = report.winRateByAgentTrend.find((t) => t.agentId === 'a')!
    expect(trendA.points.map((p) => p.value)).toEqual([1, 0.5])
  })

  it('跨范式不混合：同 batchId 不同环境（范式）各自成报告', () => {
    const matches = [
      match({ id: 'm1', batchId: 'batch_x', paradigm: 'adversarial', winnerAgentId: 'a' }),
      match({ id: 'm2', batchId: 'batch_x', paradigm: 'cooperative', environmentId: 'env-b', environmentName: '环境B', teamScore: 88 }),
    ]
    const reports = buildBatchTrendReports(matches, new Map())
    expect(reports).toHaveLength(2)
    expect(reports.map((r) => r.paradigm).sort()).toEqual(['adversarial', 'cooperative'])
    for (const report of reports) expect(report.batches).toHaveLength(1)
    const coop = reports.find((r) => r.paradigm === 'cooperative')!
    expect(coop.winRateTrend[0]!.value).toBeNull() // 协作范式无胜率
    expect(coop.avgTeamScoreTrend[0]!.value).toBe(88)
  })

  it('单场对局（batchId=null）不参与批次趋势', () => {
    const reports = buildBatchTrendReports([match({ id: 'm1', batchId: null })], new Map())
    expect(reports).toEqual([])
  })

  it('多环境多批次：报告按环境首批开始时间排序', () => {
    const matches = [
      match({ id: 'm1', environmentId: 'env-late', batchId: 'batch_l1', createdAt: 5000 }),
      match({ id: 'm2', environmentId: 'env-early', environmentName: '早环境', batchId: 'batch_e1', createdAt: 1000 }),
      match({ id: 'm3', environmentId: 'env-early', environmentName: '早环境', batchId: 'batch_e2', createdAt: 2000 }),
    ]
    const reports = buildBatchTrendReports(matches, new Map())
    expect(reports.map((r) => r.environmentId)).toEqual(['env-early', 'env-late'])
    expect(reports[0]!.summary.batchCount).toBe(2)
  })

  it('关键 Agent 缺席批次：胜率演进记 null 而非 0', () => {
    const matches = [
      match({ id: 'm1', batchId: 'batch_1', agentIds: ['a', 'b'], winnerAgentId: 'a', createdAt: 1000 }),
      match({ id: 'm2', batchId: 'batch_2', agentIds: ['a', 'c'], winnerAgentId: 'c', createdAt: 2000 }),
    ]
    const reports = buildBatchTrendReports(matches, new Map())
    const trendB = reports[0]!.winRateByAgentTrend.find((t) => t.agentId === 'b')!
    expect(trendB.points.map((p) => p.value)).toEqual([0, null])
  })
})
