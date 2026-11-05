import { describe, expect, it } from 'vitest'
import type { EnvironmentConfig } from '../api/client'
import { blankForm, configToForm, formToConfig, type BuilderForm } from './builder-config'

/** 演练靶场（flag-check 规则判定）的完整配置 */
const drillConfig: EnvironmentConfig = {
  id: 'env-ctf',
  name: '夺旗靶场',
  description: '纯沙盒靶场',
  paradigm: 'drill',
  topology: 'melee',
  roles: [{ id: 'investigator', name: '调查员', systemPrompt: '排查旗标', goal: '找出全部 FLAG', answerFormat: 'free' }],
  agents: [{ id: 'challenger-a', name: '挑战者', roleId: 'investigator', startRound: 1 }],
  turns: { rounds: 2, order: ['challenger-a'] },
  toolsEnabled: true,
  workspaceTemplate: { mode: 'private', files: [{ path: 'docs/log.txt', content: 'FLAG{x}' }] },
  exchanges: [],
  outcome: { mode: 'rule', evaluator: 'flag-check', params: { flags: ['FLAG{a}', 'FLAG{b}'] } },
  experience: { enabled: false, tokenBudget: 1500, recentMemoryLimit: 2 },
}

/** 协作环境（judge 团队评分）的完整配置 */
const coopConfig: EnvironmentConfig = {
  id: 'env-coop',
  name: '写作工坊',
  description: '协作范式',
  paradigm: 'cooperative',
  topology: 'melee',
  roles: [
    { id: 'author', name: '作者', systemPrompt: 's', goal: 'g', answerFormat: 'free' },
    { id: 'editor', name: '编辑', systemPrompt: 's', goal: 'g', answerFormat: 'json' },
  ],
  agents: [
    { id: 'author-a', name: '作者', roleId: 'author', startRound: 1 },
    { id: 'editor-a', name: '编辑', roleId: 'editor', startRound: 2 },
  ],
  turns: { rounds: 3, order: ['author-a', 'editor-a'] },
  toolsEnabled: true,
  workspaceTemplate: { mode: 'shared', files: [] },
  exchanges: [{ id: 'ex-1', artifact: '初稿', fromAgentId: 'author-a', toAgentId: 'editor-a', deliverAtRound: 1 }],
  outcome: { mode: 'judge', rubric: '按终稿质量打团队分' },
  experience: { enabled: true, tokenBudget: 2000, recentMemoryLimit: 3 },
}

describe('blankForm（构建器默认表单）', () => {
  it('默认对抗范式 + ai-flavor 规则判定 + 双角色双 Agent', () => {
    const form = blankForm()
    expect(form.paradigm).toBe('adversarial')
    expect(form.topology).toBe('asymmetric')
    expect(form.outcomeMode).toBe('rule')
    expect(form.ruleEvaluator).toBe('ai-flavor')
    expect(form.roles).toHaveLength(2)
    expect(form.agents).toHaveLength(2)
    expect(form.experienceEnabled).toBe(true)
    expect(form.tokenBudget).toBe(2000)
  })
})

describe('formToConfig（表单 → 配置）', () => {
  it('flag-check：旗标按行拆分、去空白、过滤空行', () => {
    const config = formToConfig(
      {
        ...blankForm(),
        ruleEvaluator: 'flag-check',
        flagFlags: 'FLAG{a}\n  FLAG{b}  \n\n   \nFLAG{c}',
      },
      'env-new',
    )
    expect(config.outcome).toEqual({
      mode: 'rule',
      evaluator: 'flag-check',
      params: { flags: ['FLAG{a}', 'FLAG{b}', 'FLAG{c}'] },
    })
  })

  it('演练范式强制 melee 拓扑（即使表单选了对称）', () => {
    const config = formToConfig({ ...blankForm(), paradigm: 'drill', topology: 'asymmetric' }, 'env-drill')
    expect(config.paradigm).toBe('drill')
    expect(config.topology).toBe('melee')
  })

  it('协作范式强制 AI 裁判判定（即使表单选了规则判定）', () => {
    const config = formToConfig(
      { ...blankForm(), paradigm: 'cooperative', outcomeMode: 'rule', rubric: '团队评分规则' },
      'env-coop',
    )
    expect(config.outcome).toEqual({ mode: 'judge', rubric: '团队评分规则' })
  })

  it('对抗范式 + 手选 judge 判定携带 rubric；规则判定 params 为空对象', () => {
    const judgeConfig = formToConfig({ ...blankForm(), outcomeMode: 'judge', rubric: '按质量打分' }, 'env-j')
    expect(judgeConfig.outcome).toEqual({ mode: 'judge', rubric: '按质量打分' })
    const ruleConfig = formToConfig(blankForm(), 'env-r')
    expect(ruleConfig.outcome).toEqual({ mode: 'rule', evaluator: 'ai-flavor', params: {} })
  })

  it('turns.order 取自 Agent 顺序；exchange 补充 ex-N id', () => {
    const form = blankForm()
    form.agents = [
      { id: 'alpha', name: 'A', roleId: 'role-a', startRound: 1 },
      { id: 'beta', name: 'B', roleId: 'role-b' },
    ]
    form.exchanges = [{ artifact: '稿', fromAgentId: 'alpha', toAgentId: 'beta', deliverAtRound: 1 }]
    const config = formToConfig(form, 'env-x')
    expect(config.turns).toEqual({ rounds: form.rounds, order: ['alpha', 'beta'] })
    expect(config.exchanges).toEqual([{ id: 'ex-1', artifact: '稿', fromAgentId: 'alpha', toAgentId: 'beta', deliverAtRound: 1 }])
    expect(config.id).toBe('env-x')
  })
})

describe('configToForm（配置 → 表单）', () => {
  it('演练靶场配置还原 flag-check 表单（旗标回填为多行文本）', () => {
    const form = configToForm(drillConfig)
    expect(form.paradigm).toBe('drill')
    expect(form.outcomeMode).toBe('rule')
    expect(form.ruleEvaluator).toBe('flag-check')
    expect(form.flagFlags).toBe('FLAG{a}\nFLAG{b}')
    expect(form.experienceEnabled).toBe(false)
    expect(form.workspaceFiles).toEqual([{ path: 'docs/log.txt', content: 'FLAG{x}' }])
    expect(form.rubric).toBe('')
  })

  it('协作配置还原 judge 表单（rubric 回填，evaluator 复位为默认）', () => {
    const form = configToForm(coopConfig)
    expect(form.paradigm).toBe('cooperative')
    expect(form.outcomeMode).toBe('judge')
    expect(form.rubric).toBe('按终稿质量打团队分')
    expect(form.ruleEvaluator).toBe('ai-flavor')
    expect(form.flagFlags).toBe('')
    expect(form.workspaceMode).toBe('shared')
    expect(form.rounds).toBe(3)
  })
})

describe('round-trip（配置 ↔ 表单 ↔ 配置）', () => {
  it('演练靶场配置 round-trip 逐字段一致', () => {
    expect(formToConfig(configToForm(drillConfig), drillConfig.id)).toEqual(drillConfig)
  })

  it('协作配置 round-trip 逐字段一致', () => {
    expect(formToConfig(configToForm(coopConfig), coopConfig.id)).toEqual(coopConfig)
  })

  it('BuilderForm 类型被两个方向共用（编译期契约）', () => {
    const form: BuilderForm = configToForm(drillConfig)
    expect(formToConfig(form, 'env-again').id).toBe('env-again')
  })
})
