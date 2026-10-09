import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { MatchEventEnvelope } from '@marl/shared'
import { openDb, closeDb, migrate, listTables } from './db'
import { appendEvents, listEvents, latestSeq } from './events'

function envelope(seq: number, type = 'agent.action'): MatchEventEnvelope {
  return {
    seq,
    ts: 1000 + seq,
    event: { type, payload: { agentId: 'a', round: 1, content: `内容-${seq}` } } as never,
  }
}

function withTempDb<T>(fn: (db: ReturnType<typeof openDb>, dir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'arlaf-db-'))
  const db = openDb(dir)
  try {
    return fn(db, dir)
  } finally {
    closeDb(db)
  }
}

describe('迁移（8.1）', () => {
  it('在临时库上建立全部表且可重复执行（幂等）', () => {
    withTempDb((db) => {
      expect(listTables(db).sort()).toEqual([
        'environments',
        'experience_index',
        'match_events',
        'matches',
        'model_configs',
        'win_stats',
      ])
      expect(() => migrate(db)).not.toThrow() // 幂等
      expect(db.pragma('user_version', { simple: true })).toBe(2)
    })
  })

  it('WAL 模式生效', () => {
    withTempDb((db) => {
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    })
  })

  it('重复打开同一数据目录不重复建表', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'arlaf-db2-'))
    try {
      const db1 = openDb(dir)
      closeDb(db1)
      const db2 = openDb(dir)
      expect(listTables(db2).length).toBe(6)
      closeDb(db2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('事件批量写入与查询（8.2）', () => {
  it('写入后回放一致（顺序与内容）', () => {
    withTempDb((db) => {
      const envelopes = [1, 2, 3].map((i) => envelope(i))
      appendEvents(db, 'm1', envelopes)
      const replay = listEvents(db, 'm1')
      expect(replay).toHaveLength(3)
      expect(replay.map((e) => e.seq)).toEqual([1, 2, 3])
      expect(replay).toEqual(envelopes) // JSON 往返一致
      expect(latestSeq(db, 'm1')).toBe(3)
    })
  })

  it('按序号区间查询（断线补发场景）', () => {
    withTempDb((db) => {
      appendEvents(db, 'm2', [1, 2, 3, 4, 5].map((i) => envelope(i)))
      expect(listEvents(db, 'm2', 2).map((e) => e.seq)).toEqual([3, 4, 5])
      expect(listEvents(db, 'm2', 0, 2).map((e) => e.seq)).toEqual([1, 2])
      expect(listEvents(db, 'm2', 5)).toEqual([])
      // 对局间隔离
      appendEvents(db, 'm3', [envelope(1)])
      expect(listEvents(db, 'm2')).toHaveLength(5)
      expect(latestSeq(db, 'm3')).toBe(1)
    })
  })

  it('重复写入幂等（INSERT OR REPLACE）', () => {
    withTempDb((db) => {
      const envelopes = [envelope(1), envelope(2)]
      appendEvents(db, 'm4', envelopes)
      expect(() => appendEvents(db, 'm4', envelopes)).not.toThrow()
      expect(listEvents(db, 'm4')).toHaveLength(2)
    })
  })

  it('空批量写入为无操作', () => {
    withTempDb((db) => {
      expect(() => appendEvents(db, 'm5', [])).not.toThrow()
      expect(latestSeq(db, 'm5')).toBe(0)
    })
  })
})
