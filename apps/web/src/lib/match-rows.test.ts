import { describe, expect, it } from 'vitest'
import { groupMatchesIntoRows, statusColor, type MatchRowLike } from './match-rows'

function match(id: string, overrides: Partial<MatchRowLike> = {}): MatchRowLike {
  return { id, ...overrides }
}

describe('groupMatchesIntoRows（批量连续训练分组）', () => {
  it('单场对局（无 batchId 或 batchSize=1）各自独立成行', () => {
    const rows = groupMatchesIntoRows([
      match('m1'),
      match('m2', { batchId: 'batch-1', batchSize: 1 }),
      match('m3', { batchId: null, batchSize: null }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['m1', 'm2', 'm3'])
    expect(rows.every((r) => r.batchMembers === undefined)).toBe(true)
  })

  it('同批次对局（batchSize>1）折叠为首场一行，batchMembers 保持场次顺序', () => {
    const rows = groupMatchesIntoRows([
      match('m1'),
      match('b1', { batchId: 'batch-1', batchSize: 3, batchIndex: 1 }),
      match('b2', { batchId: 'batch-1', batchSize: 3, batchIndex: 2 }),
      match('b3', { batchId: 'batch-1', batchSize: 3, batchIndex: 3 }),
      match('m2'),
    ])
    expect(rows.map((r) => r.id)).toEqual(['m1', 'b1', 'm2'])
    expect(rows[1]!.batchMembers!.map((r) => r.id)).toEqual(['b1', 'b2', 'b3'])
    expect(rows[1]!.batchSize).toBe(3)
  })

  it('不同批次各自成行互不合并', () => {
    const rows = groupMatchesIntoRows([
      match('a1', { batchId: 'batch-a', batchSize: 2 }),
      match('b1', { batchId: 'batch-b', batchSize: 2 }),
      match('a2', { batchId: 'batch-a', batchSize: 2 }),
      match('b2', { batchId: 'batch-b', batchSize: 2 }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['a1', 'b1'])
    expect(rows[0]!.batchMembers!.map((r) => r.id)).toEqual(['a1', 'a2'])
    expect(rows[1]!.batchMembers!.map((r) => r.id)).toEqual(['b1', 'b2'])
  })

  it('不修改输入数组（纯函数）', () => {
    const input = [match('b1', { batchId: 'batch-1', batchSize: 2 }), match('b2', { batchId: 'batch-1', batchSize: 2 })]
    const snapshot = JSON.stringify(input)
    groupMatchesIntoRows(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('空列表返回空行', () => {
    expect(groupMatchesIntoRows([])).toEqual([])
  })
})

describe('statusColor（状态配色）', () => {
  it('completed/failed/running/未知 状态映射', () => {
    expect(statusColor('completed')).toBe('green')
    expect(statusColor('failed')).toBe('red')
    expect(statusColor('running')).toBe('blue')
    expect(statusColor('pending')).toBe('default')
    expect(statusColor('unknown-status')).toBe('default')
  })
})
