import type {
  AgentBinding,
  EnvironmentConfig,
  EnvironmentView,
  ExperienceDocMeta,
  MatchStatus,
  MatchSummary,
  ModelConfig,
  ModelConfigInput,
  ModelConfigView,
  WinStatEntry,
} from '@marl/shared'
import { newId } from '@marl/shared'
import type { Db } from '../db/db'

/* ---------------- environments ---------------- */

interface EnvRow {
  id: string
  name: string
  description: string
  config_json: string
  is_builtin_template: number
  created_at: number
}

function toView(row: EnvRow): EnvironmentView {
  const config = JSON.parse(row.config_json) as EnvironmentConfig
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    paradigm: config.paradigm ?? 'adversarial',
    topology: config.topology,
    isBuiltinTemplate: row.is_builtin_template === 1,
    createdAt: row.created_at,
    config,
  }
}

export function insertEnvironment(db: Db, config: EnvironmentConfig, isBuiltinTemplate = false): EnvironmentView {
  const now = Date.now()
  db.prepare(
    'INSERT INTO environments (id, name, description, config_json, is_builtin_template, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(config.id, config.name, config.description, JSON.stringify(config), isBuiltinTemplate ? 1 : 0, now)
  return getEnvironment(db, config.id)!
}

export function getEnvironment(db: Db, id: string): EnvironmentView | null {
  const row = db.prepare('SELECT * FROM environments WHERE id = ?').get(id) as EnvRow | undefined
  return row ? toView(row) : null
}

export function listEnvironments(db: Db): EnvironmentView[] {
  return (db.prepare('SELECT * FROM environments ORDER BY created_at ASC').all() as EnvRow[]).map(toView)
}

export function updateEnvironment(db: Db, config: EnvironmentConfig): void {
  db.prepare('UPDATE environments SET name = ?, description = ?, config_json = ? WHERE id = ?').run(
    config.name,
    config.description,
    JSON.stringify(config),
    config.id,
  )
}

export function deleteEnvironment(db: Db, id: string): boolean {
  const info = db.prepare('DELETE FROM environments WHERE id = ?').run(id)
  return info.changes > 0
}

/* ---------------- model configs ---------------- */

interface ModelRow {
  id: string
  name: string
  base_url: string
  api_key: string
  model: string
  params_json: string
  created_at: number
}

function maskKey(key: string): string {
  const tail = key.slice(-4)
  // 尾缀含非常规字符（如 mock 脚本 JSON）时不展示，避免暴露配置内容
  if (!/^[\w@-]{4}$/.test(tail)) return '****'
  return `****${tail}`
}

function toModelView(row: ModelRow): ModelConfigView {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    model: row.model,
    params: JSON.parse(row.params_json) as Record<string, unknown>,
    apiKeyTail: maskKey(row.api_key),
    createdAt: row.created_at,
  }
}

export function insertModelConfig(db: Db, input: ModelConfigInput): ModelConfigView {
  const id = newId('model')
  const now = Date.now()
  db.prepare(
    'INSERT INTO model_configs (id, name, base_url, api_key, model, params_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, input.name, input.baseUrl, input.apiKey, input.model, JSON.stringify(input.params ?? {}), now)
  const row = db.prepare('SELECT * FROM model_configs WHERE id = ?').get(id) as ModelRow
  return toModelView(row)
}

export function listModelConfigs(db: Db): ModelConfigView[] {
  return (db.prepare('SELECT * FROM model_configs ORDER BY created_at ASC').all() as ModelRow[]).map(toModelView)
}

/** 内部使用：含完整密钥的模型配置（开赛绑定快照） */
export function getFullModelConfig(db: Db, id: string): ModelConfig | null {
  const row = db.prepare('SELECT * FROM model_configs WHERE id = ?').get(id) as ModelRow | undefined
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    apiKey: row.api_key,
    model: row.model,
    params: JSON.parse(row.params_json) as ModelConfig['params'],
  }
}

export function updateModelConfig(db: Db, id: string, input: ModelConfigInput): ModelConfigView | null {
  const existing = db.prepare('SELECT * FROM model_configs WHERE id = ?').get(id) as ModelRow | undefined
  if (!existing) return null
  const apiKey = input.apiKey === '' || input.apiKey == null ? existing.api_key : input.apiKey
  db.prepare('UPDATE model_configs SET name = ?, base_url = ?, api_key = ?, model = ?, params_json = ? WHERE id = ?').run(
    input.name,
    input.baseUrl,
    apiKey,
    input.model,
    JSON.stringify(input.params ?? {}),
    id,
  )
  const row = db.prepare('SELECT * FROM model_configs WHERE id = ?').get(id) as ModelRow
  return toModelView(row)
}

export function deleteModelConfig(db: Db, id: string): boolean {
  const info = db.prepare('DELETE FROM model_configs WHERE id = ?').run(id)
  return info.changes > 0
}

/* ---------------- matches ---------------- */

export interface MatchRow {
  id: string
  environment_id: string
  environment_name: string
  status: MatchStatus
  bindings_json: string
  agent_ids: string
  winner_agent_id: string | null
  result_json: string | null
  error: string | null
  created_at: number
  finished_at: number | null
}

export function insertMatchRow(db: Db, input: { id: string; env: EnvironmentView; bindings: AgentBinding[] }): void {
  db.prepare(
    'INSERT INTO matches (id, environment_id, environment_name, status, bindings_json, agent_ids, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    input.id,
    input.env.id,
    input.env.name,
    'pending',
    JSON.stringify(input.bindings),
    JSON.stringify(input.env.config.agents.map((a) => a.id)),
    Date.now(),
  )
}

export function getMatchRow(db: Db, id: string): MatchRow | null {
  return (db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as MatchRow | undefined) ?? null
}

export function listMatchRows(db: Db): MatchRow[] {
  return db.prepare('SELECT * FROM matches ORDER BY created_at DESC').all() as MatchRow[]
}

export function updateMatchStatus(db: Db, id: string, status: MatchStatus): void {
  db.prepare('UPDATE matches SET status = ? WHERE id = ?').run(status, id)
}

export function settleMatchRow(
  db: Db,
  id: string,
  outcome: { status: 'completed'; result: unknown; winnerAgentId: string | null } | { status: 'failed'; error: string },
): void {
  const finishedAt = Date.now()
  if (outcome.status === 'completed') {
    db.prepare(
      'UPDATE matches SET status = ?, winner_agent_id = ?, result_json = ?, finished_at = ? WHERE id = ?',
    ).run('completed', outcome.winnerAgentId, JSON.stringify(outcome.result), finishedAt, id)
  } else {
    db.prepare('UPDATE matches SET status = ?, error = ?, finished_at = ? WHERE id = ?').run(
      'failed',
      outcome.error,
      finishedAt,
      id,
    )
  }
}

export function matchRowToSummary(row: MatchRow): MatchSummary {
  return {
    id: row.id,
    environmentId: row.environment_id,
    environmentName: row.environment_name,
    status: row.status,
    winnerAgentId: row.winner_agent_id,
    agentCount: (JSON.parse(row.agent_ids) as string[]).length,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  }
}

/* ---------------- win stats ---------------- */

export function updateWinStats(db: Db, environmentId: string, agentIds: string[], winnerAgentId: string | null): void {
  const upsert = db.prepare(
    `INSERT INTO win_stats (environment_id, agent_id, wins, total) VALUES (?, ?, ?, 1)
     ON CONFLICT(environment_id, agent_id) DO UPDATE SET wins = wins + ?, total = total + 1`,
  )
  const tx = db.transaction((ids: string[]) => {
    for (const agentId of ids) {
      const win = agentId === winnerAgentId ? 1 : 0
      upsert.run(environmentId, agentId, win, win)
    }
  })
  tx(agentIds)
}

export function listWinStats(db: Db, environmentId: string): WinStatEntry[] {
  return (
    db
      .prepare('SELECT agent_id, wins, total FROM win_stats WHERE environment_id = ? ORDER BY total DESC')
      .all(environmentId) as Array<{ agent_id: string; wins: number; total: number }>
  ).map((r) => ({ agentId: r.agent_id, wins: r.wins, total: r.total }))
}

/* ---------------- experience index ---------------- */

export interface ExperienceRecord {
  id: string
  environmentId: string
  agentId: string
  kind: 'memory' | 'skills'
  path: string
  summary: string
  matchId: string
  round: number | null
  ts: number
}

export function insertExperienceRecord(db: Db, record: ExperienceRecord): void {
  db.prepare(
    `INSERT OR IGNORE INTO experience_index
     (id, environment_id, agent_id, kind, path, summary, match_id, round, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.environmentId,
    record.agentId,
    record.kind,
    record.path,
    record.summary,
    record.matchId,
    record.round,
    record.ts,
  )
}

interface ExperienceDbRow {
  id: string
  environment_id: string
  agent_id: string
  kind: 'memory' | 'skills'
  path: string
  summary: string
  match_id: string
  round: number | null
  created_at: number
}

function expRowToRecord(row: ExperienceDbRow): ExperienceRecord {
  return {
    id: row.id,
    environmentId: row.environment_id,
    agentId: row.agent_id,
    kind: row.kind,
    path: row.path,
    summary: row.summary,
    matchId: row.match_id,
    round: row.round,
    ts: row.created_at,
  }
}

function expRowToMeta(row: ExperienceDbRow): ExperienceDocMeta {
  return {
    id: row.id,
    environmentId: row.environment_id,
    agentId: row.agent_id,
    kind: row.kind,
    path: row.path,
    summary: row.summary,
    matchId: row.match_id,
    round: row.round,
    createdAt: row.created_at,
  }
}

export function getExperienceRecord(db: Db, id: string): ExperienceRecord | null {
  const row = db.prepare('SELECT * FROM experience_index WHERE id = ?').get(id) as ExperienceDbRow | undefined
  return row ? expRowToRecord(row) : null
}

export function listExperienceIndex(
  db: Db,
  filter: { environmentId?: string; agentId?: string },
): ExperienceDocMeta[] {
  const clauses: string[] = []
  const params: string[] = []
  if (filter.environmentId) {
    clauses.push('environment_id = ?')
    params.push(filter.environmentId)
  }
  if (filter.agentId) {
    clauses.push('agent_id = ?')
    params.push(filter.agentId)
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = db
    .prepare(`SELECT * FROM experience_index ${where} ORDER BY created_at DESC`)
    .all(...params) as ExperienceDbRow[]
  return rows.map(expRowToMeta)
}
