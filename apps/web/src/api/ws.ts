import type { MatchEventEnvelope } from '@marl/shared'

export interface WsMessage {
  seq?: number
  ts?: number
  event?: MatchEventEnvelope['event']
  type?: string
  latestSeq?: number
  message?: string
}

/**
 * 订阅对局事件流（15.1）：连接即补发 since 之后的历史事件，随后实时推送；
 * 断线自动重连并按最后收到的 seq 补齐缺口，直到收到 done（对局终结）。
 */
export function subscribeMatchEvents(
  matchId: string,
  handlers: {
    onEnvelope: (envelope: MatchEventEnvelope) => void
    onDone?: (latestSeq: number) => void
    onError?: (message: string) => void
  },
): () => void {
  let ws: WebSocket | null = null
  let lastSeq = 0
  let closedByUs = false
  let finished = false

  const connect = (): void => {
    if (closedByUs || finished) return
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${window.location.host}/api/ws/matches/${matchId}?since=${lastSeq}`)
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as WsMessage
      if (msg.type === 'error') {
        handlers.onError?.(msg.message ?? '订阅失败')
        finished = true
        ws?.close()
        return
      }
      if (msg.type === 'done') {
        finished = true
        if (msg.latestSeq != null) handlers.onDone?.(msg.latestSeq)
        ws?.close()
        return
      }
      if (msg.seq != null && msg.event) {
        lastSeq = Math.max(lastSeq, msg.seq)
        handlers.onEnvelope({ seq: msg.seq, ts: msg.ts ?? 0, event: msg.event })
      }
    }
    ws.onclose = () => {
      if (!closedByUs && !finished) {
        setTimeout(connect, 1000) // 断线重连，按 lastSeq 补齐缺口
      }
    }
  }

  connect()
  return () => {
    closedByUs = true
    ws?.close()
  }
}
