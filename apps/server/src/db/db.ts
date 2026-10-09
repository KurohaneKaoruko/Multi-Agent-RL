import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

export type Db = Database.Database

const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS environments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  config_json TEXT NOT NULL,
  is_builtin_template INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS model_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  params_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL,
  environment_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  bindings_json TEXT NOT NULL,
  agent_ids TEXT NOT NULL,
  winner_agent_id TEXT,
  result_json TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS match_events (
  match_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  event_json TEXT NOT NULL,
  PRIMARY KEY (match_id, seq)
);

CREATE TABLE IF NOT EXISTS experience_index (
  id TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  summary TEXT NOT NULL,
  match_id TEXT NOT NULL,
  round INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_experience_env_agent ON experience_index (environment_id, agent_id);

CREATE TABLE IF NOT EXISTS win_stats (
  environment_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (environment_id, agent_id)
);
`

/**
 * 打开数据库（WAL 模式，见设计 D5）并执行幂等迁移。
 * 以 PRAGMA user_version 记录 schema 版本。
 */
export function openDb(dataDir: string): Db {
  mkdirSync(dataDir, { recursive: true })
  const db = new Database(path.join(dataDir, 'arlaf.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export function migrate(db: Db): void {
  const version = (db.pragma('user_version', { simple: true }) as number) ?? 0
  if (version < 1) {
    db.exec(MIGRATION_V1)
    db.pragma('user_version = 1')
  }
  if (version < 2) {
    // 批量连续训练：同批次对局共享 batch_id，按顺序执行
    db.exec(
      'ALTER TABLE matches ADD COLUMN batch_id TEXT;\n' +
        'CREATE INDEX IF NOT EXISTS idx_matches_batch ON matches (batch_id);',
    )
    db.pragma('user_version = 2')
  }
}

export function closeDb(db: Db): void {
  db.close()
}

export function listTables(db: Db): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>
  ).map((r) => r.name)
}
