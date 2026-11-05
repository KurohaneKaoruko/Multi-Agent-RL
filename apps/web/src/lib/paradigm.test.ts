import { describe, expect, it } from 'vitest'
import { filterByParadigm } from './paradigm'

describe('filterByParadigm（范式过滤）', () => {
  it('按 paradigm 挑选列表项', () => {
    const items = [
      { id: 'e1', paradigm: 'adversarial' },
      { id: 'e2', paradigm: 'drill' },
      { id: 'e3', paradigm: 'cooperative' },
      { id: 'e4', paradigm: 'drill' },
    ]
    expect(filterByParadigm(items, 'drill').map((i) => i.id)).toEqual(['e2', 'e4'])
    expect(filterByParadigm(items, 'cooperative').map((i) => i.id)).toEqual(['e3'])
    expect(filterByParadigm(items, 'adversarial').map((i) => i.id)).toEqual(['e1'])
  })

  it('缺失 paradigm 字段的项不匹配任何范式', () => {
    const items = [{ id: 'e1' }, { id: 'e2', paradigm: 'drill' }]
    expect(filterByParadigm(items, 'drill')).toHaveLength(1)
    expect(filterByParadigm(items, 'adversarial')).toEqual([])
  })

  it('空列表返回空数组且不修改原数组', () => {
    const items = [{ id: 'e1', paradigm: 'drill' }]
    const snapshot = JSON.stringify(items)
    expect(filterByParadigm([], 'drill')).toEqual([])
    expect(filterByParadigm(items, 'drill')).toHaveLength(1)
    expect(JSON.stringify(items)).toBe(snapshot)
  })
})
