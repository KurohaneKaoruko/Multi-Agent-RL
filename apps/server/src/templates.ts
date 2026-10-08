import { EnvironmentConfigSchema, newId, validateEnvironmentRefs, type EnvironmentConfig } from '@arlaf/shared'

export interface BuiltinTemplate {
  templateId: string
  description: string
  config: EnvironmentConfig
}

/**
 * 内置环境模板（11.1）：一键实例化即可开赛。
 * 「AI 味对抗」：写作者产出难以被识别为 AI 的文本，辨别者判断真伪，辨别准确率定胜负。
 */
export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    templateId: 'ai-flavor-adversarial',
    description: '写作者 Writer vs 辨别者 Detector：辨别者判断文本是否 AI 生成，以辨别准确率判定胜负。',
    config: EnvironmentConfigSchema.parse({
      id: 'tpl-ai-flavor',
      name: 'AI 味对抗（写作者 vs 辨别者）',
      description: '不对称对抗示例环境（Agent-RLAF）：写作者每轮产出一段文本，辨别者判断其是否为 AI 生成。双方胜负互斥：识破则辨别者胜，被蒙骗则写作者胜。',
      paradigm: 'adversarial',
      topology: 'asymmetric',
      roles: [
        {
          id: 'writer',
          name: '写作者',
          systemPrompt:
            '你是一名经验丰富的文字创作者，擅长写出自然流畅、有个人风格、细节丰富的文本，完全不带“AI 味”。',
          goal: '每轮写一段 150~250 字的文本（题材不限，可写生活观察、短评或叙事）。让辨别者无法判断它是否为 AI 生成：多用具体细节、口语化表达和不规则节奏。',
          answerFormat: 'free',
        },
        {
          id: 'detector',
          name: '辨别者',
          systemPrompt: '你是一名 AI 生成内容鉴别专家，熟悉各类模型（LLM）的行文特征与破绽。',
          goal: '对投递给你的文本判断它是否为 AI 生成。必须以 JSON 作答：{"verdict": "ai" 或 "human", "reason": "一句话理由"}。',
          answerFormat: 'json',
        },
      ],
      agents: [
        { id: 'writer-a', name: '写作者', roleId: 'writer' },
        { id: 'detector-a', name: '辨别者', roleId: 'detector', startRound: 2 },
      ],
      turns: { rounds: 2, order: ['writer-a', 'detector-a'] },
      workspaceTemplate: {
        files: [
          {
            path: 'README.md',
            content: '# 对抗环境\n\n写作者与辨别者各自拥有独立工作区，互不可见。写作者的作品在每轮结束后按协议投递给辨别者。\n',
          },
        ],
      },
      exchanges: [
        { id: 'ex-manuscript', artifact: 'manuscript', fromAgentId: 'writer-a', toAgentId: 'detector-a', deliverAtRound: 1 },
      ],
      outcome: {
        mode: 'rule',
        evaluator: 'ai-flavor',
        params: {},
      },
      experience: { enabled: true, tokenBudget: 2000, recentMemoryLimit: 3 },
    }),
  },
  {
    templateId: 'writing-workshop',
    description: '结对写作工坊（Agent-RLCF）：作者产出初稿，编辑给出修改意见，作者据意见修订终稿，AI 裁判为协作成果打分。',
    config: EnvironmentConfigSchema.parse({
      id: 'tpl-writing-workshop',
      name: '结对写作工坊（协作）',
      description: '协作环境范例：作者每轮产出与修订文本，编辑基于稿件给出具体修改意见，AI 裁判为协作成果（终稿质量、意见有效性、迭代幅度）打团队分。',
      paradigm: 'cooperative',
      topology: 'melee',
      roles: [
        {
          id: 'author',
          name: '作者',
          systemPrompt: '你是一名认真的写作者，能够根据编辑反馈快速改进文稿。',
          goal: '第 1 轮写一篇 150~250 字的短文（主题自选）；收到编辑意见后，在第 3 轮输出吸收意见后的修订终稿，并说明采纳了哪些建议。',
          answerFormat: 'free',
        },
        {
          id: 'editor',
          name: '编辑',
          systemPrompt: '你是一名专业编辑，审稿眼光挑剔，给出的意见具体、可执行、对事不对人。',
          goal: '基于投递给你的稿件输出修改意见，必须以 JSON 作答：{"suggestions": ["建议1", "建议2", ...], "overall": "总体评价"}，建议至少 2 条。',
          answerFormat: 'json',
        },
      ],
      agents: [
        { id: 'author-a', name: '作者', roleId: 'author', startRound: 1 },
        { id: 'editor-a', name: '编辑', roleId: 'editor', startRound: 2 },
      ],
      turns: { rounds: 3, order: ['author-a', 'editor-a'] },
      workspaceTemplate: {
        files: [
          {
            path: 'README.md',
            content: '# 结对写作工坊\n\n协作模式：作者写稿 → 编辑给意见 → 作者修订终稿。团队共同目标是让终稿质量尽可能高。\n',
          },
        ],
      },
      exchanges: [
        { id: 'ex-draft', artifact: '初稿', fromAgentId: 'author-a', toAgentId: 'editor-a', deliverAtRound: 1 },
        { id: 'ex-feedback', artifact: '修改意见', fromAgentId: 'editor-a', toAgentId: 'author-a', deliverAtRound: 2 },
      ],
      outcome: {
        mode: 'judge',
        rubric: '按以下维度为这个「作者 × 编辑」团队打 0-100 分：终稿质量（40 分，对比初稿是否有提升）、编辑意见的有效性（30 分，意见是否具体且被采纳）、协作迭代流畅度（30 分）。同时指出协作亮点与仍可改进之处。',
      },
      experience: { enabled: true, tokenBudget: 2000, recentMemoryLimit: 3 },
    }),
  },
]

/** 一键实例化：深拷贝模板配置并分配新环境 id/名称 */
export function instantiateTemplate(
  templateId: string,
  overrides: { id?: string; name?: string } = {},
): EnvironmentConfig {
  const template = BUILTIN_TEMPLATES.find((t) => t.templateId === templateId)
  if (!template) throw new Error(`内置模板不存在：${templateId}`)
  const config: EnvironmentConfig = {
    ...structuredClone(template.config),
    id: overrides.id ?? newId('env'),
    name: overrides.name ?? template.config.name,
  }
  const parsed = EnvironmentConfigSchema.parse(config)
  const refErrors = validateEnvironmentRefs(parsed)
  if (refErrors.length > 0) {
    throw new Error(`模板配置存在引用错误：${refErrors.map((e) => e.message).join('；')}`)
  }
  return parsed
}
