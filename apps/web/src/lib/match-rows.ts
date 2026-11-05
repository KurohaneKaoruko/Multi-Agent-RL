// 对局列表展示纯逻辑：状态配色与批量连续训练分组（与组件解耦，便于单测）

/** 与组件解耦的最小对局形状（MatchSummary 满足该结构） */
export interface MatchRowLike {
  id: string
  batchId?: string | null
  batchIndex?: number | null
  batchSize?: number | null
}

/** 展开行：批量行携带本批次全部对局 */
export type MatchRowLikeWithMembers<T> = T & { batchMembers?: T[] }

export const statusColor = (status: string): string =>
  status === 'completed' ? 'green' : status === 'failed' ? 'red' : status === 'running' ? 'blue' : 'default'

/**
 * 分组：batchId 相同且 batchSize>1 的对局合并为一行（在首个成员的位置出现，
 * batchMembers 保持列表顺序 = 场次顺序）；其余每场一行。
 */
export function groupMatchesIntoRows<T extends MatchRowLike>(matches: readonly T[]): Array<MatchRowLikeWithMembers<T>> {
  const result: Array<MatchRowLikeWithMembers<T>> = []
  const batchMap = new Map<string, MatchRowLikeWithMembers<T>>()
  for (const m of matches) {
    if (m.batchId && m.batchSize && m.batchSize > 1) {
      const existing = batchMap.get(m.batchId)
      if (existing) {
        existing.batchMembers!.push(m)
      } else {
        const row: MatchRowLikeWithMembers<T> = { ...m, batchMembers: [m] }
        batchMap.set(m.batchId, row)
        result.push(row)
      }
    } else {
      result.push({ ...m })
    }
  }
  return result
}
