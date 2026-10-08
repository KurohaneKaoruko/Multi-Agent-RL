import type { MatchEventEnvelope } from '@marl/shared'

type Listener = (envelope: MatchEventEnvelope) => void

/** 进程内实时总线：对局事件 → WebSocket 订阅者（跨进程扩展不在 MVP 范围） */
const listeners = new Map<string, Set<Listener>>()

export function publish(matchId: string, envelope: MatchEventEnvelope): void {
  for (const listener of listeners.get(matchId) ?? []) {
    try {
      listener(envelope)
    } catch {
      /* 单个订阅者异常不影响其他订阅者 */
    }
  }
}

export function subscribe(matchId: string, listener: Listener): () => void {
  let set = listeners.get(matchId)
  if (!set) {
    set = new Set()
    listeners.set(matchId, set)
  }
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(matchId)
  }
}
