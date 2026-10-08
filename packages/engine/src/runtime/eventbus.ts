import type { MatchEvent, MatchEventEnvelope } from '@marl/shared'

type Listener = (envelope: MatchEventEnvelope) => void

/**
 * 对局事件总线：分配单调递增 seq，缓存全量事件（供回放/补发），
 * 支持监听订阅与 AsyncIterable 消费（对局结束时关闭）。
 */
export class MatchEventBus {
  private nextSeq = 0
  private readonly buffer: MatchEventEnvelope[] = []
  private readonly listeners = new Set<Listener>()
  private readonly pullQueue: Array<(value: IteratorResult<MatchEventEnvelope>) => void> = []
  private closed = false

  emit(event: MatchEvent): MatchEventEnvelope {
    if (this.closed) throw new Error('MatchEventBus already closed')
    const envelope: MatchEventEnvelope = { seq: ++this.nextSeq, ts: Date.now(), event }
    this.buffer.push(envelope)
    for (const listener of [...this.listeners]) listener(envelope)
    const resolver = this.pullQueue.shift()
    resolver?.({ value: envelope, done: false })
    return envelope
  }

  get lastSeq(): number {
    return this.nextSeq
  }

  /** 一次性获取全部已发事件（回放/断线补发） */
  snapshot(sinceSeq = 0): MatchEventEnvelope[] {
    return this.buffer.filter((e) => e.seq > sinceSeq)
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 关闭总线（对局终结后调用），AsyncIterable 随之结束 */
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const resolver of this.pullQueue.splice(0)) resolver({ value: undefined, done: true })
  }

  /** AsyncIterable 消费：新迭代器从首个事件回放，实时事件随后流出 */
  asAsyncIterable(): AsyncIterable<MatchEventEnvelope> {
    let cursor = 0
    const next = (): Promise<IteratorResult<MatchEventEnvelope>> => {
      if (cursor < this.buffer.length) {
        return Promise.resolve({ value: this.buffer[cursor++]!, done: false })
      }
      if (this.closed) return Promise.resolve({ value: undefined, done: true })
      return new Promise((resolve) => {
        this.pullQueue.push((result) => {
          if (!result.done) cursor++
          resolve(result)
        })
      })
    }
    return {
      [Symbol.asyncIterator](): AsyncIterator<MatchEventEnvelope> {
        return { next }
      },
    }
  }
}
