import { describe, expect, it } from 'vitest'
import { MatchStatusSchema, ParadigmSchema } from '@marl/shared'
import { describeFieldErrors, KIND_LABELS, MATCH_STATUS_LABELS, PARADIGM_LABELS } from './i18n'

describe('文案契约（与 shared 协议保持同步）', () => {
  it('PARADIGM_LABELS 覆盖 shared 全部范式枚举', () => {
    for (const paradigm of ParadigmSchema.options) {
      expect(PARADIGM_LABELS[paradigm], `缺少范式文案：${paradigm}`).toBeTruthy()
    }
  })

  it('MATCH_STATUS_LABELS 覆盖 shared 全部对局状态', () => {
    for (const status of MatchStatusSchema.options) {
      expect(MATCH_STATUS_LABELS[status], `缺少状态文案：${status}`).toBeTruthy()
    }
  })

  it('KIND_LABELS 覆盖 memory/skills 两类经验文档', () => {
    expect(Object.keys(KIND_LABELS).sort()).toEqual(['memory', 'skills'])
  })
})

describe('describeFieldErrors（后端字段错误 → 中文提示）', () => {
  it('多条错误用中文分号拼接', () => {
    const text = describeFieldErrors([
      { path: 'name', message: '缺少必填字段' },
      { path: 'agents', message: '至少需要 2 名智能体' },
    ])
    expect(text).toBe('name: 缺少必填字段；agents: 至少需要 2 名智能体')
  })

  it('空错误列表得到空字符串', () => {
    expect(describeFieldErrors([])).toBe('')
  })
})
