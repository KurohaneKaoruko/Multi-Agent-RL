import type { AgentSlot, MatchEvent, ModelConfig, Role } from '@arlaf/shared'
import type { LLMClient, CompleteOptions, RetryInfo } from '../llm/types'
import { MockProvider, decodeMockScript } from '../llm/mock'
import { OpenAICompatibleClient } from '../llm/openai'
import { stripThinkTags } from './think'
import type { WorkspaceController } from './workspace'

/** Agent 单轮上下文（全部由框架拼装，D4：不存在 Agent 自选信息的通道） */
export interface AgentRoundContext {
  round: number
  totalRounds: number
  /** 经验注入块（无则省略） */
  experienceBlock?: string
  /** 此前按协议投递给该 Agent 的交换物 */
  delivered: Array<{ artifact: string; fromAgentId: string; content: string; round: number }>
}

export type EmitEvent = (event: MatchEvent) => void

/** 依据 baseUrl 协议创建 client：mock: → MockProvider，否则 OpenAI 兼容 client */
export function createLLMClient(config: ModelConfig): LLMClient {
  if (config.baseUrl.startsWith('mock:')) {
    return new MockProvider({ script: decodeMockScript(config.apiKey) })
  }
  return new OpenAICompatibleClient(config)
}

/**
 * Agent 运行时：绑定槽位/角色/模型 client/工作区，负责单轮行动。
 * 上下文完全由框架构造并按轮注入。
 */
export class AgentRuntime {
  constructor(
    readonly slot: AgentSlot,
    readonly role: Role,
    readonly client: LLMClient,
    readonly workspace: WorkspaceController,
    private readonly emit: EmitEvent,
    private readonly onRetry: (info: RetryInfo) => void,
  ) {}

  systemPrompt(): string {
    const parts = [
      this.role.systemPrompt.trim(),
      `你的目标：${this.role.goal}`,
      this.workspace.hint(),
    ]
    if (this.role.answerFormat === 'json') {
      parts.push('每次回答必须包含一个 JSON 对象作为结论（可置于 ```json 代码块中）。')
    }
    return parts.join('\n\n')
  }

  userPrompt(ctx: AgentRoundContext): string {
    const lines: string[] = [`第 ${ctx.round}/${ctx.totalRounds} 轮。`]
    if (ctx.experienceBlock) {
      lines.push('【你的历史经验（MEMORY/SKILLS）】', ctx.experienceBlock, '')
    }
    if (ctx.delivered.length > 0) {
      lines.push('【按协议投递给你的内容】')
      for (const d of ctx.delivered) {
        lines.push(`- [${d.artifact}｜来自 ${d.fromAgentId}｜第 ${d.round} 轮交付]`, d.content, '')
      }
    }
    lines.push('请根据以上信息完成本轮行动。')
    return lines.join('\n')
  }

  async act(ctx: AgentRoundContext): Promise<string> {
    const opts: CompleteOptions = { onRetry: (info) => this.onRetry(info) }
    const res = await this.client.complete(
      {
        messages: [
          { role: 'system', content: this.systemPrompt() },
          { role: 'user', content: this.userPrompt(ctx) },
        ],
      },
      opts,
    )
    return stripThinkTags(res.text)
  }
}
