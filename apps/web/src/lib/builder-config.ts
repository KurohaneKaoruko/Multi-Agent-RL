// 环境构建器纯逻辑：表单 ↔ 环境配置的双向转换（与 antd 组件解耦，便于单测）
import type { EnvironmentConfig } from '../api/client'

export interface BuilderForm {
  name: string
  description?: string
  paradigm: 'adversarial' | 'cooperative' | 'drill'
  topology: 'symmetric' | 'asymmetric' | 'melee'
  rounds: number
  toolsEnabled: boolean
  workspaceMode: 'private' | 'shared'
  workspaceFiles: Array<{ path: string; content: string }>
  roles: Array<{ id: string; name: string; systemPrompt: string; goal: string; answerFormat: 'free' | 'json' }>
  agents: Array<{
    id: string
    name: string
    roleId: string
    defaultModelConfigId?: string
    startRound?: number
  }>
  exchanges: Array<{ artifact: string; fromAgentId: string; toAgentId: string; deliverAtRound: number }>
  experienceEnabled: boolean
  tokenBudget: number
  recentMemoryLimit: number
  outcomeMode: 'rule' | 'judge'
  ruleEvaluator: 'ai-flavor' | 'attack-defense' | 'flag-check'
  flagFlags?: string
  rubric?: string
}

export function blankForm(): BuilderForm {
  return {
    name: '',
    description: '',
    paradigm: 'adversarial',
    topology: 'asymmetric',
    rounds: 2,
    toolsEnabled: true,
    workspaceMode: 'private',
    workspaceFiles: [],
    roles: [
      { id: 'role-a', name: '角色 A', systemPrompt: '', goal: '', answerFormat: 'free' },
      { id: 'role-b', name: '角色 B', systemPrompt: '', goal: '', answerFormat: 'free' },
    ],
    agents: [
      { id: 'agent-a', name: 'Agent A', roleId: 'role-a' },
      { id: 'agent-b', name: 'Agent B', roleId: 'role-b' },
    ],
    exchanges: [],
    experienceEnabled: true,
    tokenBudget: 2000,
    recentMemoryLimit: 3,
    outcomeMode: 'rule',
    ruleEvaluator: 'ai-flavor',
    flagFlags: '',
    rubric: '',
  }
}

/** 表单值 → 环境配置（id 由调用方覆盖：新建生成随机 id，编辑沿用原 id） */
export function formToConfig(values: BuilderForm, id: string): Record<string, unknown> {
  const outcome =
    values.paradigm === 'cooperative' || values.outcomeMode === 'judge'
      ? { mode: 'judge', rubric: values.rubric ?? '' }
      : {
          mode: 'rule',
          evaluator: values.ruleEvaluator ?? 'ai-flavor',
          params:
            values.ruleEvaluator === 'flag-check'
              ? { flags: (values.flagFlags ?? '').split('\n').map((s) => s.trim()).filter(Boolean) }
              : {},
        }
  return {
    id,
    name: values.name,
    description: values.description ?? '',
    paradigm: values.paradigm,
    topology: values.paradigm !== 'adversarial' ? 'melee' : values.topology,
    roles: values.roles,
    agents: values.agents,
    turns: { rounds: values.rounds, order: values.agents.map((a) => a.id) },
    toolsEnabled: values.toolsEnabled,
    workspaceTemplate: { mode: values.workspaceMode, files: values.workspaceFiles },
    exchanges: values.exchanges.map((e, i) => ({ id: `ex-${i + 1}`, ...e })),
    outcome,
    experience: {
      enabled: values.experienceEnabled,
      tokenBudget: values.tokenBudget,
      recentMemoryLimit: values.recentMemoryLimit,
    },
  }
}

/** 环境配置 → 表单值（编辑已有环境 / AI 草稿预填共用） */
export function configToForm(config: EnvironmentConfig): BuilderForm {
  const outcome = config.outcome
  return {
    name: config.name,
    description: config.description,
    paradigm: config.paradigm ?? 'adversarial',
    topology: config.topology,
    rounds: config.turns.rounds,
    toolsEnabled: config.toolsEnabled ?? true,
    workspaceMode: config.workspaceTemplate.mode ?? 'private',
    workspaceFiles: config.workspaceTemplate.files.map((f) => ({ ...f })),
    roles: config.roles.map((r) => ({ ...r })),
    agents: config.agents.map((a) => ({
      id: a.id,
      name: a.name,
      roleId: a.roleId,
      startRound: a.startRound,
      defaultModelConfigId: a.defaultModelConfigId,
    })),
    exchanges: config.exchanges.map((e) => ({
      artifact: e.artifact,
      fromAgentId: e.fromAgentId,
      toAgentId: e.toAgentId,
      deliverAtRound: e.deliverAtRound,
    })),
    experienceEnabled: config.experience.enabled,
    tokenBudget: config.experience.tokenBudget,
    recentMemoryLimit: config.experience.recentMemoryLimit,
    outcomeMode: outcome.mode === 'judge' ? 'judge' : 'rule',
    ruleEvaluator: outcome.mode === 'rule' ? (outcome.evaluator as BuilderForm['ruleEvaluator']) : 'ai-flavor',
    flagFlags:
      outcome.mode === 'rule' && Array.isArray(outcome.params.flags)
        ? (outcome.params.flags as string[]).join('\n')
        : '',
    rubric: outcome.mode === 'judge' ? outcome.rubric : '',
  }
}
