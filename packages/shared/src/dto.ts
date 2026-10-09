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
