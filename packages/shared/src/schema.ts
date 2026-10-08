import { z } from 'zod'

/** 对抗拓扑：symmetric 对称（同角色实例）| asymmetric 不对称（不同角色）| melee 多方混战 */
export const TopologySchema = z.enum(['symmetric', 'asymmetric', 'melee'])
export type Topology = z.infer<typeof TopologySchema>

/** 模型调用参数（OpenAI 兼容） */
export const ModelParamsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().positive().optional(),
})
export type ModelParams = z.infer<typeof ModelParamsSchema>

/** 模型 API 配置（OpenAI 兼容端点；baseUrl 亦支持 mock: 协议供测试/离线演示） */
export const ModelConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().min(1),
  apiKey: z.string().default(''),
  model: z.string().min(1),
  params: ModelParamsSchema.default({}),
})
export type ModelConfig = z.infer<typeof ModelConfigSchema>

/** 新建模型配置时的输入（id 由服务端生成） */
export const ModelConfigInputSchema = ModelConfigSchema.omit({ id: true })
export type ModelConfigInput = z.infer<typeof ModelConfigInputSchema>

/** 角色：环境中可被实例化的参战身份 */
export const RoleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** 角色系统提示（框架拼装上下文的一部分） */
  systemPrompt: z.string().min(1),
  /** 角色目标（会随轮次注入） */
  goal: z.string().min(1),
  /** 回答格式：free 自由文本 | json 要求以 JSON 作答（判定/辨别类角色） */
  answerFormat: z.enum(['free', 'json']).default('free'),
})
export type Role = z.infer<typeof RoleSchema>

/** Agent 槽位：角色的一次实例化（对称对抗=两个槽位绑同一角色）。
 * defaultModelConfigId：环境内智能体的默认模型绑定（可选项），发起对局时自动预填。
 * startRound：起始轮次（默认 1）——在该轮之前该智能体不行动（如辨别者等首份作品投递后再登场）。 */
export const AgentSlotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  roleId: z.string().min(1),
  defaultModelConfigId: z.string().min(1).optional(),
  startRound: z.number().int().min(1).default(1),
})
export type AgentSlot = z.infer<typeof AgentSlotSchema>

/** 回合结构：总轮数与每轮行动顺序（须覆盖全部 Agent） */
export const TurnStructureSchema = z.object({
  rounds: z.number().int().min(1).max(200),
  order: z.array(z.string().min(1)).min(1),
})
export type TurnStructure = z.infer<typeof TurnStructureSchema>

/** 工作区模板：开赛时写入各 Agent 工作区的初始文件 */
export const WorkspaceFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
})
/** 工作区模式：private=各智能体独立工作区（对抗默认）；shared=全体共享（协作） */
export const WorkspaceModeSchema = z.enum(['private', 'shared'])

export const WorkspaceTemplateSchema = z.object({
  mode: WorkspaceModeSchema.default('private'),
  files: z.array(WorkspaceFileSchema).default([]),
})
export type WorkspaceTemplate = z.infer<typeof WorkspaceTemplateSchema>

/** 交换物协议：from 产出的 artifact 在 deliverAtRound 开始时投递给 to */
export const ExchangeSchema = z.object({
  id: z.string().min(1),
  artifact: z.string().min(1),
  fromAgentId: z.string().min(1),
  toAgentId: z.string().min(1),
  deliverAtRound: z.number().int().min(1),
})
export type Exchange = z.infer<typeof ExchangeSchema>

/** 规则判定：由注册的规则判定器产出胜负（如「AI 味对抗」的辨别准确率） */
export const RuleOutcomeSchema = z.object({
  mode: z.literal('rule'),
  evaluator: z.string().min(1),
  params: z.record(z.unknown()).default({}),
})

/** AI 裁判判定：裁判 Agent（bindings 中 agentId='judge'）按 rubric 产出结构化判定 */
export const JudgeOutcomeSchema = z.object({
  mode: z.literal('judge'),
  rubric: z.string().min(1),
})

export const OutcomeSchema = z.discriminatedUnion('mode', [RuleOutcomeSchema, JudgeOutcomeSchema])
export type Outcome = z.infer<typeof OutcomeSchema>

/** 经验进化配置 */
export const ExperienceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** 注入上下文的 token 预算 */
  tokenBudget: z.number().int().positive().default(2000),
  /** 注入近期 MEMORY 的条数上限（滑动窗口） */
  recentMemoryLimit: z.number().int().positive().default(3),
})
export type ExperienceConfig = z.infer<typeof ExperienceConfigSchema>

/** 项目范式：对抗（Agent-RLAF）或协作（Agent-RLCF）；缺省为对抗 */
export const ParadigmSchema = z.enum(['adversarial', 'cooperative'])
export type Paradigm = z.infer<typeof ParadigmSchema>

/** 对抗环境配置（完整描述一个可开赛的环境） */
/** 协作环境的结局约束：必须使用 AI 裁判做团队评分 */
function paradigmRefine(
  env: { paradigm?: 'adversarial' | 'cooperative'; outcome: { mode: string } },
  ctx: z.RefinementCtx,
): void {
  if (env.paradigm === 'cooperative' && env.outcome.mode !== 'judge') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['outcome'],
      message: '协作环境（Agent-RLCF）的判定方式必须为 AI 裁判（团队评分）',
    })
  }
}

const EnvironmentConfigObject = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  paradigm: ParadigmSchema.optional(),
  topology: TopologySchema,
  roles: z.array(RoleSchema).min(1),
  agents: z.array(AgentSlotSchema).min(2),
  turns: TurnStructureSchema,
  workspaceTemplate: WorkspaceTemplateSchema.default({ mode: 'private', files: [] }),
  /** 是否允许智能体在工作区内使用文件工具（读/写/列表），默认开启 */
  toolsEnabled: z.boolean().default(true),
  exchanges: z.array(ExchangeSchema).default([]),
  outcome: OutcomeSchema,
  experience: ExperienceConfigSchema.default({}),
})

export const EnvironmentConfigSchema = EnvironmentConfigObject.superRefine(paradigmRefine)
export type EnvironmentConfig = z.infer<typeof EnvironmentConfigSchema>

/** 环境配置草稿（AI 生成用）：与完整配置一致但不含 id（由前端/服务端分配） */
export const EnvironmentDraftSchema = EnvironmentConfigObject.omit({ id: true }).superRefine(paradigmRefine)
export type EnvironmentDraft = z.infer<typeof EnvironmentDraftSchema>

/** 对局模型绑定：Agent → 模型配置快照（多 Agent 可绑定同一份配置实现 self-play） */
export const AgentBindingSchema = z.object({
  agentId: z.string().min(1),
  modelConfig: ModelConfigSchema,
})
export type AgentBinding = z.infer<typeof AgentBindingSchema>

/** 裁判绑定的保留 agentId */
export const JUDGE_AGENT_ID = 'judge'

/** 对局运行选项 */
export const MatchOptionsSchema = z.object({
  concurrency: z.number().int().min(1).max(16).default(4),
})
export type MatchOptions = z.infer<typeof MatchOptionsSchema>
