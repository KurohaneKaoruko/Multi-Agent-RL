import path from 'node:path'
import type { AgentBinding, EnvironmentConfig, MatchResult } from '@marl/shared'
import { createMatch, FileExperienceStore, MatchFailedError } from '@marl/engine'
import type { Db } from '../db/db'
import { appendEvents } from '../db/events'
import { publish } from '../realtime'
import {
  getMatchRow,
  insertExperienceRecord,
  listMatchRowsByBatch,
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
  private readonly batchPromises = new Map<string, Promise<void>>()

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

  /** 批量连续训练：同批次对局按创建顺序逐场执行（前一场的经验注入后一场） */
  startSequenceForBatch(batchId: string): void {
    if (this.batchPromises.has(batchId)) return
    const sequence = (async () => {
      const rows = listMatchRowsByBatch(this.db, batchId).filter((r) => r.status === 'pending')
      for (const row of rows) {
        const promise = this.doStart(row.id)
        this.settled.set(row.id, promise)
        try {
          await promise
        } catch {
          /* doStart 内部已落库失败状态，继续下一场 */
        } finally {
          this.settled.delete(row.id)
        }
      }
    })()
    this.batchPromises.set(batchId, sequence)
    void sequence.finally(() => this.batchPromises.delete(batchId))
  }

  whenSettled(matchId: string): Promise<'completed' | 'failed'> | undefined {
    const direct = this.settled.get(matchId)
    if (direct) return direct
    const row = getMatchRow(this.db, matchId)
    if (!row) return undefined
    if (row.status === 'completed' || row.status === 'failed') {
      return Promise.resolve(row.status)
    }
    // 批量训练进行中：等待整批执行完毕后按最终状态返回
    const batch = row.batch_id ? this.batchPromises.get(row.batch_id) : undefined
    if (batch) {
      return batch.then(() => {
        const latest = getMatchRow(this.db, matchId)
        return latest?.status === 'failed' ? ('failed' as const) : ('completed' as const)
      })
    }
    return undefined
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
