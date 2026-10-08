import type { AgentSlot, MatchEvent, ModelConfig, Role } from '@marl/shared'
import type { LLMClient, CompleteOptions, RetryInfo, ChatMessage } from '../llm/types'
import { MockProvider, decodeMockScript } from '../llm/mock'
import { OpenAICompatibleClient } from '../llm/openai'
import { stripThinkTags } from './think'
import type { WorkspaceController } from './workspace'

/** 可解析的智能体工具调用 */
export interface ParsedToolCall {
  name: 'read_file' | 'write_file' | 'list_files'
  args: { path?: string; content?: string }
}

/** 从模型回复中解析 <tool>{...}</tool> 工具调用块 */
export function parseToolCalls(text: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = []
  for (const match of text.matchAll(/<tool>\s*([\s\S]*?)\s*<\/tool>/gi)) {
    try {
      const parsed = JSON.parse(match[1]!) as { name?: string; args?: Record<string, unknown> }
      if (parsed.name === 'read_file' || parsed.name === 'write_file' || parsed.name === 'list_files') {
        calls.push({
          name: parsed.name,
          args: (parsed.args ?? {}) as { path?: string; content?: string },
        })
      }
    } catch {
      /* 无法解析的工具块忽略 */
    }
  }
  return calls
}

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
    readonly toolsEnabled = true,
  ) {}

  systemPrompt(): string {
    const parts = [
      this.role.systemPrompt.trim(),
      `你的目标：${this.role.goal}`,
      this.workspace.hint(),
      [
        '【工作区工具】你可以在回复中嵌入如下工具调用块来使用工作区（一次可包含多个块；引擎会执行并把结果发回给你，得到所需内容后，再输出不带工具调用的最终回复）：',
        '<tool>{"name":"list_files","args":{}}</tool> —— 列出工作区内的全部文件',
        '<tool>{"name":"read_file","args":{"path":"notes/plan.md"}}</tool> —— 读取文件内容',
        '<tool>{"name":"write_file","args":{"path":"notes/plan.md","content":"要写入的内容"}}</tool> —— 写入/覆盖文件',
      ].join('\n'),
    ]
    if (this.role.answerFormat === 'json') {
      parts.push('最终回答必须包含一个 JSON 对象作为结论（可置于 ```json 代码块中）。')
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

  /** 执行单个工具调用；越权/失败不抛出，返回给智能体可读的结果文本 */
  private async runTool(
    call: ParsedToolCall,
    round: number,
  ): Promise<string> {
    const emitTool = (ok: boolean, detail: string): void => {
      this.emit({
        type: 'agent.tool',
        payload: { agentId: this.slot.id, round, tool: call.name, path: call.args.path, ok, detail },
      })
    }
    try {
      if (call.name === 'list_files') {
        const files = await this.workspace.listFiles()
        emitTool(true, `${files.length} 个文件`)
        return files.length > 0 ? files.join('\n') : '（工作区暂无文件）'
      }
      const relPath = call.args.path ?? ''
      if (call.name === 'read_file') {
        const content = await this.workspace.readFile(relPath)
        emitTool(true, `${content.length} 字符`)
        return content
      }
      if (call.name === 'write_file') {
        await this.workspace.writeFile(relPath, call.args.content ?? '')
        emitTool(true, '已写入')
        return `已写入 ${relPath}`
      }
      emitTool(false, `未知工具 ${call.name}`)
      return `未知工具：${call.name}`
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      emitTool(false, message)
      return message
    }
  }

  /** 执行回复中的全部工具调用，返回拼接的工具结果文本（供下一轮对话） */
  private async executeToolCalls(
    calls: ParsedToolCall[],
    round: number,
  ): Promise<string> {
    const results: string[] = []
    for (const [i, call] of calls.entries()) {
      const result = await this.runTool(call, round)
      results.push(`[工具 ${i + 1}] ${call.name}${call.args.path ? `(${call.args.path})` : ''}\n${result}`)
    }
    return results.join('\n\n')
  }

  async act(ctx: AgentRoundContext): Promise<string> {
    const opts: CompleteOptions = { onRetry: (info) => this.onRetry(info) }
    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt() },
      { role: 'user', content: this.userPrompt(ctx) },
    ]
    // 工具循环（最多 4 轮）：解析 <tool> 调用 → 执行 → 结果回填 → 继续，直到给出最终回复
    const MAX_TOOL_ROUNDS = 4
    for (let i = 0; i <= MAX_TOOL_ROUNDS; i++) {
      const res = await this.client.complete({ messages }, opts)
      const calls = this.toolsEnabled ? parseToolCalls(res.text) : []
      if (calls.length === 0 || i === MAX_TOOL_ROUNDS) {
        return stripThinkTags(res.text)
      }
      messages.push({ role: 'assistant', content: res.text })
      const results = await this.executeToolCalls(calls, ctx.round)
      messages.push({
        role: 'user',
        content: `【工具结果】\n${results}\n\n如已获得所需内容，请输出最终回复（不要再调用工具）。`,
      })
    }
    throw new Error('unreachable')
  }
}
