import path from 'node:path'
import type { AgentBinding, EnvironmentConfig, MatchResult } from '@arlaf/shared'
import { createMatch, FileExperienceStore, MatchFailedError } from '@arlaf/engine'
import type { Db } from '../db/db'
import { appendEvents } from '../db/events'
import { publish } from '../realtime'
import {
  getMatchRow,
  insertExperienceRecord,
  settleMatchRow,
  updateMatchStatus,
  updateWinStats,
} from './repos'

/**
 * 对局执行管理器（9.4）：引擎编排 + 持久化 + 实时广播。
 * start() 幂等：同一对局并发 start 只执行一次；事件经 bus 订阅写入 DB 并 publish 给 WS。
 */
export class MatchManager {
  private readonly settled = new Map<string, Promise<'completed' | 'failed'>>()

  constructor(
    private readonly db: Db,
    private readonly dataDir: string,
  ) {}

  start(matchId: string): Promise<'completed' | 'failed'> {
    const existing = this.settled.get(matchId)
    if (existing) return existing
    const promise = this.doStart(matchId)
    this.settled.set(matchId, promise)
    void promise.finally(() => this.settled.delete(matchId))
    return promise
  }

  whenSettled(matchId: string): Promise<'completed' | 'failed'> | undefined {
    return this.settled.get(matchId)
  }

  private async doStart(matchId: string): Promise<'completed' | 'failed'> {
    const row = getMatchRow(this.db, matchId)
    if (!row) throw new Error(`对局不存在：${matchId}`)
    const env = JSON.parse(
      (
        this.db.prepare('SELECT config_json FROM environments WHERE id = ?').get(row.environment_id) as {
          config_json: string
        }
      ).config_json,
    ) as EnvironmentConfig
    const bindings = JSON.parse(row.bindings_json) as AgentBinding[]
    const experienceStore = new FileExperienceStore(path.join(this.dataDir, 'experience'))

    updateMatchStatus(this.db, matchId, 'running')
    const match = createMatch(env, { matchId, bindings, dataDir: this.dataDir, experienceStore })
    const unsubscribe = match.bus.subscribe((envelope) => {
      appendEvents(this.db, matchId, [envelope])
      publish(matchId, envelope)
    })

    try {
      const result: MatchResult = await match.run()
      settleMatchRow(this.db, matchId, {
        status: 'completed',
        result,
        winnerAgentId: result.winnerAgentId,
      })
      updateWinStats(this.db, env.id, env.agents.map((a) => a.id), result.winnerAgentId)
      await this.indexExperience(experienceStore, env.id, env.agents.map((a) => a.id))
      return 'completed'
    } catch (err) {
      const message =
        err instanceof MatchFailedError
          ? `${err.message}（原因：${err.payload.reason}）`
          : err instanceof Error
            ? err.message
            : String(err)
      settleMatchRow(this.db, matchId, { status: 'failed', error: message })
      return 'failed'
    } finally {
      unsubscribe()
    }
  }

  /** 对局结束后将新增经验文档写入索引（幂等） */
  private async indexExperience(
    store: FileExperienceStore,
    environmentId: string,
    agentIds: string[],
  ): Promise<void> {
    for (const agentId of agentIds) {
      const records = await store.list(environmentId, agentId)
      for (const record of records) {
        insertExperienceRecord(this.db, {
          id: record.id,
          environmentId: record.environmentId,
          agentId: record.agentId,
          kind: record.kind,
          path: record.path,
          summary: record.summary,
          matchId: record.matchId,
          round: record.round,
          ts: record.ts,
        })
      }
    }
  }
}
