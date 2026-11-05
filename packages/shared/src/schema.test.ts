import { describe, expect, it } from 'vitest'
import {
  EnvironmentConfigSchema,
  AgentBindingSchema,
  ModelConfigSchema,
  validateEnvironmentRefs,
  validateBindingsForMatch,
  JUDGE_AGENT_ID,
  newId,
  estimateTokens,
  type EnvironmentConfig,
} from './index'

function validEnv(): EnvironmentConfig {
  return {
    id: 'env-1',
    name: 'AI 味对抗',
    description: '写作者 vs 辨别者',
    topology: 'asymmetric',
    roles: [
      { id: 'writer', name: '写作者', systemPrompt: '你是写作者', goal: '写出不像 AI 的文本', answerFormat: 'free' },
      {
        id: 'detector',
        name: '辨别者',
        systemPrompt: '你是辨别者',
        goal: '判断文本是否 AI 生成',
        answerFormat: 'json',
      },
    ],
    agents: [
      { id: 'writer-a', name: '写作者 A', roleId: 'writer', startRound: 1 },
      { id: 'detector-a', name: '辨别者 A', roleId: 'detector', startRound: 3 },
    ],
    turns: { rounds: 3, order: ['writer-a', 'detector-a'] },
    toolsEnabled: true,
    workspaceTemplate: { mode: 'private', files: [] },
    exchanges: [
      { id: 'ex-1', artifact: 'manuscript', fromAgentId: 'writer-a', toAgentId: 'detector-a', deliverAtRound: 2 },
    ],
    outcome: { mode: 'rule', evaluator: 'ai-flavor', params: {} },
    experience: { enabled: true, tokenBudget: 2000, recentMemoryLimit: 3 },
  }
}

describe('EnvironmentConfigSchema', () => {
  it('接受合法配置', () => {
    const parsed = EnvironmentConfigSchema.safeParse(validEnv())
    expect(parsed.success).toBe(true)
  })

  it('拒绝缺少角色的配置并给出字段路径', () => {
    const env = validEnv()
    delete (env as Partial<typeof env>).roles
    const parsed = EnvironmentConfigSchema.safeParse(env)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path.join('.'))
      expect(paths).toContain('roles')
    }
  })

  it('拒绝非法拓扑枚举', () => {
    const env = { ...validEnv(), topology: 'cooperative' }
    expect(EnvironmentConfigSchema.safeParse(env).success).toBe(false)
  })

  it('拒绝少于两个 Agent 的配置', () => {
    const env = validEnv()
    env.agents = [env.agents[0]!]
    expect(EnvironmentConfigSchema.safeParse(env).success).toBe(false)
  })

  it('默认值填充：workspaceTemplate/exchanges/experience', () => {
    const env = validEnv()
    delete (env as Record<string, unknown>).workspaceTemplate
    delete (env as Record<string, unknown>).exchanges
    const parsed = EnvironmentConfigSchema.parse(env)
    expect(parsed.workspaceTemplate.files).toEqual([])
    expect(parsed.exchanges).toEqual([])
    expect(parsed.experience.tokenBudget).toBe(2000)
  })
})

describe('范式约束（paradigmRefine）', () => {
  /** 单角色单 Agent 的演练靶场配置（CTF 纯靶场形状） */
  function drillEnv(): EnvironmentConfig {
    return {
      id: 'env-drill',
      name: '夺旗靶场',
      description: '',
      paradigm: 'drill',
      topology: 'melee',
      roles: [{ id: 'investigator', name: '调查员', systemPrompt: 's', goal: 'g', answerFormat: 'free' }],
      agents: [{ id: 'challenger-a', name: '挑战者', roleId: 'investigator', startRound: 1 }],
      turns: { rounds: 2, order: ['challenger-a'] },
      workspaceTemplate: { mode: 'private', files: [] },
      toolsEnabled: true,
      exchanges: [],
      outcome: { mode: 'rule', evaluator: 'flag-check', params: { flags: ['FLAG{x}'] } },
      experience: { enabled: false, tokenBudget: 2000, recentMemoryLimit: 3 },
    }
  }

  it('演练靶场允许仅 1 名外部挑战者（单 Agent 合法）', () => {
    const parsed = EnvironmentConfigSchema.safeParse(drillEnv())
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.paradigm).toBe('drill')
    // 引用一致性校验同样通过（无交换物的单 Agent 环境）
    expect(validateEnvironmentRefs(drillEnv())).toEqual([])
  })

  it('同一单 Agent 配置切回对抗范式则被拒绝', () => {
    const env = { ...drillEnv(), paradigm: 'adversarial' as const }
    const parsed = EnvironmentConfigSchema.safeParse(env)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      const messages = parsed.error.issues.map((i) => i.message)
      expect(messages.some((m) => m.includes('至少需要 2 名智能体'))).toBe(true)
    }
  })

  it('协作环境判定方式必须为 AI 裁判（rule 被拒绝且指向 outcome 字段）', () => {
    const env = {
      ...validEnv(),
      paradigm: 'cooperative' as const,
      outcome: { mode: 'rule', evaluator: 'ai-flavor', params: {} },
    }
    const parsed = EnvironmentConfigSchema.safeParse(env)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.path.join('.') === 'outcome')
      expect(issue?.message).toContain('AI 裁判')
    }
  })

  it('协作环境 + judge 判定 + 多 Agent 合法', () => {
    const env = { ...validEnv(), paradigm: 'cooperative' as const, outcome: { mode: 'judge', rubric: '按质量打分' } }
    expect(EnvironmentConfigSchema.safeParse(env).success).toBe(true)
  })
})

describe('ModelConfigSchema / AgentBindingSchema', () => {
  it('接受合法模型配置', () => {
    const parsed = ModelConfigSchema.safeParse({
      id: 'm1',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-x',
      model: 'deepseek-chat',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.params).toEqual({})
  })

  it('拒绝空模型名', () => {
    const parsed = ModelConfigSchema.safeParse({ id: 'm1', name: 'x', baseUrl: 'https://a.b', model: '' })
    expect(parsed.success).toBe(false)
  })

  it('接受 Agent 绑定', () => {
    const parsed = AgentBindingSchema.safeParse({
      agentId: 'writer-a',
      modelConfig: { id: 'm1', name: 'GPT', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
    })
    expect(parsed.success).toBe(true)
  })
})

describe('validateEnvironmentRefs', () => {
  it('合法配置无错误', () => {
    expect(validateEnvironmentRefs(validEnv())).toEqual([])
  })

  it('发现引用不存在的角色', () => {
    const env = validEnv()
    env.agents[1]!.roleId = 'ghost'
    const errors = validateEnvironmentRefs(env)
    expect(errors.some((e) => e.path.includes('detector-a') && e.message.includes('ghost'))).toBe(true)
  })

  it('发现行动顺序遗漏的 Agent', () => {
    const env = validEnv()
    env.turns.order = ['writer-a']
    const errors = validateEnvironmentRefs(env)
    expect(errors.some((e) => e.message.includes('detector-a'))).toBe(true)
  })

  it('发现投递轮次超出总轮数', () => {
    const env = validEnv()
    env.exchanges[0]!.deliverAtRound = 99
    expect(validateEnvironmentRefs(env).length).toBeGreaterThan(0)
  })
})

describe('validateBindingsForMatch', () => {
  const mc = { id: 'm', name: 'M', baseUrl: 'mock://test', model: 'mock', apiKey: '', params: {} }
  it('全部绑定且规则判定时通过', () => {
    const env = validEnv()
    const bindings = [
      { agentId: 'writer-a', modelConfig: mc },
      { agentId: 'detector-a', modelConfig: mc },
    ]
    expect(validateBindingsForMatch(env, bindings)).toEqual([])
  })

  it('缺绑定时报出具体 Agent', () => {
    const env = validEnv()
    const bindings = [{ agentId: 'writer-a', modelConfig: mc }]
    const errors = validateBindingsForMatch(env, bindings)
    expect(errors.some((e) => e.message.includes('detector-a'))).toBe(true)
  })

  it('需裁判而未绑裁判时报错', () => {
    const env = validEnv()
    env.outcome = { mode: 'judge', rubric: '按质量评分' }
    const bindings = ['writer-a', 'detector-a'].map((agentId) => ({ agentId, modelConfig: mc }))
    const errors = validateBindingsForMatch(env, bindings)
    expect(errors.some((e) => e.path === 'bindings.judge')).toBe(true)
  })

  it('规则判定环境绑定裁判时报错', () => {
    const env = validEnv()
    const errors = validateBindingsForMatch(env, [
      { agentId: 'writer-a', modelConfig: mc },
      { agentId: 'detector-a', modelConfig: mc },
      { agentId: JUDGE_AGENT_ID, modelConfig: mc },
    ])
    expect(errors.some((e) => e.path === 'bindings.judge')).toBe(true)
  })
})

describe('utils', () => {
  it('newId 生成带前缀的唯一 id', () => {
    const a = newId('match')
    const b = newId('match')
    expect(a).toMatch(/^match_[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
  })

  it('estimateTokens 随长度增长', () => {
    expect(estimateTokens('abcdefghij')).toBe(4)
    expect(estimateTokens('a'.repeat(100))).toBeGreaterThan(estimateTokens('a'.repeat(10)))
  })
})
