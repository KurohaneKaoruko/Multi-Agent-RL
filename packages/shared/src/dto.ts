/** REST/WS 层 DTO —— 与存储结构解耦的对外视图 */

export type MatchStatus = 'pending' | 'running' | 'completed' | 'failed'

/** 对局列表项/摘要 */
export interface MatchSummary {
  id: string
  environmentId: string
  environmentName: string
  status: MatchStatus
  winnerAgentId: string | null
  /** 协作环境（Agent-RLCF）：团队评分（0-100） */
  teamScore?: number | null
  agentCount: number
  createdAt: number
  finishedAt: number | null
  /** 批量连续训练：所属批次 id（单场对局为 null） */
  batchId?: string | null
  /** 批量连续训练：本场在批次中的序号（从 1 开始；单场对局为 null） */
  batchIndex?: number | null
  /** 批量连续训练：批次总场数（单场对局为 null） */
  batchSize?: number | null
}

/** 对局详情（含结果与诊断） */
export interface MatchDetail extends MatchSummary {
  agentIds: string[]
  error: string | null
  result: import('./events').MatchResult | null
}

/** 事件流查询响应 */
export interface MatchEventsResponse {
  events: import('./events').MatchEventEnvelope[]
  latestSeq: number
}

/** 创建对局响应（episodes>1 时为批量连续训练）：ids 为同批次全部对局，firstId 为首场 */
export interface MatchCreateResponse {
  ids: string[]
  firstId: string
  status: MatchStatus
  /** 实际创建场数（1-20；episodes=1 时 ids 长度也为 1） */
  episodes: number
}

/** 启动对局响应（202）；批量批次启动时额外携带 batchId */
export interface MatchStartResponse {
  id: string
  status: Extract<MatchStatus, 'running'>
  batchId?: string
}

/** 经验文档详情（含内容） */
export interface ExperienceDocDetail {
  meta: ExperienceDocMeta
  content: string
}

/** 经验文档索引条目 */
export interface ExperienceDocMeta {
  id: string
  environmentId: string
  agentId: string
  kind: 'memory' | 'skills'
  /** 相对 data 目录的文件路径（可读 Markdown） */
  path: string
  summary: string
  matchId: string
  round: number | null
  createdAt: number
}

/** 进化时间线条目 */
export interface EvolutionTimelineEntry {
  ts: number
  matchId: string
  environmentId: string
  agentId: string
  kind: 'memory' | 'skills'
  changesSummary: string
}

/** 胜率统计 */
export interface WinStatEntry {
  agentId: string
  wins: number
  total: number
}

/** 模型配置对外视图（密钥脱敏：仅尾 4 位） */
export interface ModelConfigView {
  id: string
  name: string
  baseUrl: string
  model: string
  params: Record<string, unknown>
  apiKeyTail: string
  createdAt: number
}

/* ---------------- 训练趋势统计（批量对局量化反馈） ---------------- */

/** 按 Agent 的胜率条目（批次内） */
export interface WinRateByAgentEntry {
  agentId: string
  wins: number
  /** 参与的完成场次（分母；平局计入分母） */
  participations: number
  /** 胜率 0-1；无完成场次为 null */
  winRate: number | null
}

/** 单批次聚合统计（同环境同 batchId 的全部对局） */
export interface BatchStats {
  batchId: string
  environmentId: string
  environmentName: string
  paradigm: import('./schema').Paradigm
  /** 批次内全部场数（含失败/进行中） */
  matchCount: number
  completedCount: number
  failedCount: number
  /** 有胜者的完成场次（对抗/靶场） */
  wins: number
  /** 完成但无胜者（协作范式无胜者概念，平局语义） */
  draws: number
  /** 主角 Agent（首场首槽位）胜率 0-1；无完成场次或协作范式（每场无胜者）为 null */
  protagonistWinRate: number | null
  winRateByAgent: WinRateByAgentEntry[]
  /** 平均回合数（完成场次）；无完成为 null */
  avgRounds: number | null
  /** 平均团队评分（协作范式）；无数据为 null */
  avgTeamScore: number | null
  /** 本批次沉淀的经验条数 */
  experienceCount: number
  startedAt: number
  finishedAt: number | null
}

/** 趋势数据点：x 轴为批次序号（按开始时间升序） */
export interface TrendPoint {
  batchId: string
  batchIndex: number
  /** null 表示该批次无此指标数据（如协作范式的胜率） */
  value: number | null
}

/** 按 Agent 的胜率演进序列 */
export interface WinRateByAgentTrend {
  agentId: string
  points: TrendPoint[]
}

/** 首末批对比摘要：训练是否有效的量化结论 */
export interface BatchTrendSummary {
  /** 演进中出现的批次总数（同环境） */
  batchCount: number
  /** 末批总体胜率 − 首批（0-1）；单批或数据不足为 null */
  winRateDelta: number | null
  /** 末批平均回合数 − 首批（负值=收敛变快） */
  avgRoundsDelta: number | null
  /** 末批平均团队评分 − 首批（协作范式） */
  avgTeamScoreDelta: number | null
  /** 全部批次经验沉淀累计条数 */
  experienceTotal: number
}

/** 单环境的批次趋势报告：该环境全部批次的时间序列聚合 */
export interface BatchTrendReport {
  environmentId: string
  environmentName: string
  paradigm: import('./schema').Paradigm
  /** 批次统计（按开始时间升序） */
  batches: BatchStats[]
  /** 批次总体胜率演进（有胜者完成场次占比；协作范式恒 null） */
  winRateTrend: TrendPoint[]
  /** 平均回合数演进 */
  avgRoundsTrend: TrendPoint[]
  /** 平均团队评分演进（协作范式） */
  avgTeamScoreTrend: TrendPoint[]
  /** 经验沉淀累计演进（逐批累加） */
  experienceCumulativeTrend: TrendPoint[]
  /** 关键 Agent 胜率演进（跨批次出现的全部 Agent） */
  winRateByAgentTrend: WinRateByAgentTrend[]
  summary: BatchTrendSummary
}

/** GET /api/stats/batch-trends 响应 */
export interface BatchTrendsResponse {
  reports: BatchTrendReport[]
}

/** 环境对外视图（含模板标记） */
export interface EnvironmentView {
  id: string
  name: string
  description: string
  paradigm: import('./schema').Paradigm
  topology: import('./schema').Topology
  isBuiltinTemplate: boolean
  createdAt: number
  config: import('./schema').EnvironmentConfig
}

/** 字段级校验错误（中文提示，定位到具体字段路径） */
export interface FieldError {
  path: string
  message: string
}
