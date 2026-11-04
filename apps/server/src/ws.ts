import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { listEvents, latestSeq } from './db/events'
import { subscribe } from './realtime'
import { getMatchRow } from './services/repos'
import type { Db } from './db/db'

/**
 * /api/ws/matches/:id（10.1）：实时推送对局事件。
 * 连接即补发 seq > since（默认 0）的全部历史事件，随后跟随实时流；
 * 断线重连携带 ?since=<最后收到的 seq> 即可补齐缺口。
 * 消息格式：JSON 一行一个信封 {seq, ts, event}；流末尾发送 {type: "done", latestSeq}。
 */
export function registerMatchWs(app: FastifyInstance, db: Db): void {
  app.get('/api/ws/matches/:id', { websocket: true }, (socket: WebSocket, request) => {
    const { id } = request.params as { id: string }
    const query = request.query as { since?: string }
    const since = Math.max(0, Number(query.since ?? 0) || 0)

    // 安全发送：socket 已关闭/正在关闭时跳过（ws 库对非 OPEN 状态 send 会抛异常，
    // 从心跳定时器回调抛出会成为 uncaughtException 击穿进程）
    const safeSend = (payload: string): boolean => {
      if (socket.readyState !== socket.OPEN) return false
      try {
        socket.send(payload)
        return true
      } catch {
        return false
      }
    }

    if (!getMatchRow(db, id)) {
      safeSend(JSON.stringify({ type: 'error', message: `对局不存在：${id}` }))
      socket.close()
      return
    }

    const sendSince = (from: number): number => {
      const backlog = listEvents(db, id, from)
      for (const envelope of backlog) safeSend(JSON.stringify(envelope))
      return backlog.length > 0 ? backlog[backlog.length - 1]!.seq : from
    }

    let lastSeq = sendSince(since)

    // 订阅实时事件（写入 DB 与 publish 之间天然有序；此处再按 seq 过滤防重复）
    const unsubscribe = subscribe(id, (envelope) => {
      if (envelope.seq <= lastSeq) return
      lastSeq = envelope.seq
      safeSend(JSON.stringify(envelope))
    })

    // 对局已终结（事件流不再增长）→ 发送 done 并关闭
    const finish = (): void => {
      safeSend(JSON.stringify({ type: 'done', latestSeq: latestSeq(db, id) }))
      socket.close()
    }
    const row = getMatchRow(db, id)!
    if (row.status === 'completed' || row.status === 'failed') {
      finish()
      unsubscribe()
      return
    }

    const heartbeat = setInterval(() => {
      const current = getMatchRow(db, id)
      if (current && (current.status === 'completed' || current.status === 'failed')) {
        finish()
      }
    }, 300)

    socket.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
    socket.on('error', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })
}
