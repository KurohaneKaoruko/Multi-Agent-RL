import type { MatchEventEnvelope } from '@marl/shared'
import type { Db } from './db'

/**
 * 事件存取（8.2）：批量写入（事务内）与按对局/序号区间查询。
 * 事件以完整信封 JSON 存储，读回即为可回放流。
 */
export function appendEvents(db: Db, matchId: string, envelopes: MatchEventEnvelope[]): void {
  if (envelopes.length === 0) return
  const insert = db.prepare(
    'INSERT OR REPLACE INTO match_events (match_id, seq, ts, type, event_json) VALUES (?, ?, ?, ?, ?)',
  )
  const tx = db.transaction((rows: MatchEventEnvelope[]) => {
    for (const e of rows) {
      insert.run(matchId, e.seq, e.ts, e.event.type, JSON.stringify(e))
    }
  })
  tx(envelopes)
}

export function listEvents(db: Db, matchId: string, sinceSeq = 0, limit?: number): MatchEventEnvelope[] {
  const rows = (
    limit != null
      ? db
          .prepare(
            'SELECT event_json FROM match_events WHERE match_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?',
          )
          .all(matchId, sinceSeq, limit)
      : db
          .prepare('SELECT event_json FROM match_events WHERE match_id = ? AND seq > ? ORDER BY seq ASC')
          .all(matchId, sinceSeq)
  ) as Array<{ event_json: string }>
  return rows.map((r) => JSON.parse(r.event_json) as MatchEventEnvelope)
}

export function latestSeq(db: Db, matchId: string): number {
  const row = db
    .prepare('SELECT MAX(seq) AS maxSeq FROM match_events WHERE match_id = ?')
    .get(matchId) as { maxSeq: number | null }
  return row.maxSeq ?? 0
}
