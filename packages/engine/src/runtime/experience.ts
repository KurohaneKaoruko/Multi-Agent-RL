import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { EnvironmentConfig, Role } from '@marl/shared'
import { newId } from '@marl/shared'
import { completeStructured, StructuredOutputError } from '../llm/structured'
import type { LLMClient } from '../llm/types'
import type { EmitEvent } from './agent'
import type { WorkspaceController } from './workspace'

export interface ExperienceDocRecord {
  id: string
  environmentId: string
  agentId: string
  kind: 'memory' | 'skills'
  /** 相对经验根目录的文件路径（Markdown，人类可读） */
  path: string
  summary: string
  matchId: string
  round: number | null
  ts: number
}

export interface AppendInput {
  environmentId: string
  agentId: string
  kind: 'memory' | 'skills'
  content: string
  summary: string
  matchId: string
  round: number | null
}

/** 经验存储抽象（engine 落盘；server 负责入库索引） */
export interface ExperienceStore {
  append(input: AppendInput): Promise<ExperienceDocRecord>
  list(environmentId: string, agentId: string, kind?: 'memory' | 'skills'): Promise<ExperienceDocRecord[]>
  readContent(record: ExperienceDocRecord): Promise<string>
}

/**
 * 文件经验存储（7.2）：data/experience/<envId>/<agentId>/<kind>-<id>.md，
 * 索引存同目录 index.json。重启后依旧完整可读（spec: 经验持久化）。
 */
export class FileExperienceStore implements ExperienceStore {
  constructor(readonly rootDir: string) {}

  private dirOf(environmentId: string, agentId: string): string {
    return path.join(this.rootDir, environmentId, agentId)
  }

  private async readIndex(dir: string): Promise<ExperienceDocRecord[]> {
    try {
      const raw = await readFile(path.join(dir, 'index.json'), 'utf8')
      return JSON.parse(raw) as ExperienceDocRecord[]
    } catch {
      return []
    }
  }

  private async writeIndex(dir: string, records: ExperienceDocRecord[]): Promise<void> {
    await writeFile(path.join(dir, 'index.json'), JSON.stringify(records, null, 2), 'utf8')
  }

  async append(input: AppendInput): Promise<ExperienceDocRecord> {
    const dir = this.dirOf(input.environmentId, input.agentId)
    await mkdir(dir, { recursive: true })
    const record: ExperienceDocRecord = {
      id: newId('exp'),
      environmentId: input.environmentId,
      agentId: input.agentId,
      kind: input.kind,
      path: path.join(input.environmentId, input.agentId, `${input.kind}-${Date.now()}.md`),
      summary: input.summary,
      matchId: input.matchId,
      round: input.round,
      ts: Date.now(),
    }
    const abs = path.join(this.rootDir, record.path)
    await writeFile(abs, input.content, 'utf8')
    const records = await this.readIndex(dir)
    records.push(record)
    await this.writeIndex(dir, records)
    return record
  }

  async list(
    environmentId: string,
    agentId: string,
    kind?: 'memory' | 'skills',
  ): Promise<ExperienceDocRecord[]> {
    const records = await this.readIndex(this.dirOf(environmentId, agentId))
    return kind ? records.filter((r) => r.kind === kind) : records
  }

  async readContent(record: ExperienceDocRecord): Promise<string> {
    return readFile(path.join(this.rootDir, record.path), 'utf8')
  }
}

/** 读取某 Agent 全部 SKILLS 文档内容 */
export async function readAllSkills(
  store: ExperienceStore,
  environmentId: string,
  agentId: string,
): Promise<Array<{ record: ExperienceDocRecord; content: string }>> {
  const records = await store.list(environmentId, agentId, 'skills')
  return Promise.all(records.map(async (record) => ({ record, content: await store.readContent(record) })))
}

/** 读取近期 MEMORY（按时间倒序取 limit 条，滑动窗口） */
export async function readRecentMemories(
  store: ExperienceStore,
  environmentId: string,
  agentId: string,
  limit: number,
): Promise<Array<{ record: ExperienceDocRecord; content: string }>> {
  const records = (await store.list(environmentId, agentId, 'memory'))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit)
  return Promise.all(records.map(async (record) => ({ record, content: await store.readContent(record) })))
}

/** 经验注入结果 */
export interface InjectionResult {
  block: string
  skillsChars: number
  memoryCount: number
  injectedChars: number
  budgetChars: number
}

/**
 * 经验注入（7.3）：优先读取工作区中的 SKILLS.md / MEMORY.md（用户可直接编辑的「活的」经验文件）；
 * 工作区没有时回退到经验存储（ExperienceStore 历史）。
 * 总量受 token 预算约束（chars ≈ tokens × 2.5），注入概况记入事件流。
 */
export async function injectExperience(deps: {
  env: EnvironmentConfig
  agentId: string
  store?: ExperienceStore
  workspace?: WorkspaceController
  emit: EmitEvent
}): Promise<InjectionResult | undefined> {
  const { env, agentId, store, workspace, emit } = deps
  if (!env.experience.enabled) return undefined
  const budgetChars = Math.floor(env.experience.tokenBudget * 2.5)

  let skillsText = ''
  let memoryText = ''
  let memoryCount = 0
  let source: 'workspace' | 'store' = 'store'

  // 1) 工作区文件优先（用户可直接编辑的活文件）
  if (workspace) {
    const skillsFile = await workspace.readFile('SKILLS.md').catch(() => '')
    const memoryFile = await workspace.readFile('MEMORY.md').catch(() => '')
    if (skillsFile.trim() || memoryFile.trim()) {
      skillsText = skillsFile
      memoryText = memoryFile
      memoryCount = memoryFile.split(/\n##\s/).filter((s) => s.trim()).length
      source = 'workspace'
    }
  }
  // 2) 回退：经验存储
  if (!skillsText && !memoryText && store) {
    const skills = await readAllSkills(store, env.id, agentId)
    const memories = await readRecentMemories(store, env.id, agentId, env.experience.recentMemoryLimit)
    skillsText = skills.map((s) => s.content).join('\n\n')
    memoryText = memories.map((m) => m.content).join('\n\n')
    memoryCount = memories.length
  }
  if (!skillsText && !memoryText) return undefined

  if (memoryText.length > budgetChars) memoryText = memoryText.slice(0, budgetChars)
  const remaining = Math.max(0, budgetChars - memoryText.length)
  if (skillsText.length > remaining) skillsText = skillsText.slice(0, remaining)

  const injectedChars = memoryText.length + skillsText.length
  const parts: string[] = []
  if (skillsText) parts.push(`【SKILLS｜积累的技能】\n${skillsText}`)
  if (memoryText) parts.push(`【MEMORY｜近期对局记忆】\n${memoryText}`)
  const result: InjectionResult = {
    block: parts.join('\n\n'),
    skillsChars: skillsText.length,
    memoryCount,
    injectedChars,
    budgetChars,
  }
  emit({
    type: 'injection.recorded',
    payload: {
      agentId,
      skillsChars: result.skillsChars,
      memoryCount: result.memoryCount,
      injectedChars: result.injectedChars,
      budgetChars: result.budgetChars,
      source,
    },
  })
  return result
}

/** 把总结产物写入工作区（「活的」经验文件）：SKILLS.md 覆盖为最新技能，MEMORY.md 追加带时间戳的情景条目 */
/** 把总结产物写入工作区（「活的」经验文件）：SKILLS.md 覆盖为最新技能，MEMORY.md 追加带时间戳的情景条目 */
export async function writeExperienceToWorkspace(
  workspace: WorkspaceController,
  summary: ExperienceSummary,
): Promise<void> {
  const existingMemory = await workspace.readFile('MEMORY.md').catch(() => '')
  // MEMORY.md 过长时仅保留最近一半，避免无限膨胀
  const trimmed = existingMemory.length > 20000 ? existingMemory.slice(existingMemory.length - 20000) : existingMemory
  const dated = `## ${new Date().toLocaleString('zh-CN')}\n${summary.memory}`
  await workspace.writeFile('MEMORY.md', trimmed ? `${trimmed}\n\n${dated}` : dated)
  await workspace.writeFile('SKILLS.md', summary.skills)
}

/** 经验总结结构（7.1） */
const SummarySchema = z.object({
  memory: z.string(),
  skills: z.string(),
  changesSummary: z.string(),
})
export type ExperienceSummary = z.infer<typeof SummarySchema>

/** 对局后经验总结（7.1/7.4）：以该 Agent 绑定的模型复盘本局，
 * 产出 MEMORY（情景记忆增量）与 SKILLS（完整技能文档更新），落盘并产生 experience.summarized 事件。
 * 总结失败不以异常中断对局结果——以 experience.summarized 事件显式记录失败原因（绝不静默丢弃）。
 */
export async function summarizeExperience(deps: {
  env: EnvironmentConfig
  matchId: string
  agentId: string
  role: Role
  client: LLMClient
  store: ExperienceStore
  /** 本局该 Agent 的行动记录 */
  ownActions: string[]
  /** 收到的投递物（对手可观测行为） */
  received: Array<{ artifact: string; preview: string }>
  outcomeLine: string
  emit: EmitEvent
}): Promise<ExperienceSummary | undefined> {
  const { env, matchId, agentId, role, client, store, ownActions, received, outcomeLine, emit } = deps
  if (!env.experience.enabled) return undefined
  const llm = 'complete' in client ? client : undefined
  if (!llm) return undefined

  const existingSkills = await readAllSkills(store, env.id, agentId)
  const skillsExcerpt = existingSkills
    .map((s) => s.content)
    .join('\n\n')
    .slice(0, 3000)

  let summary: ExperienceSummary
  try {
    summary = await completeStructured(
      llm,
      {
        messages: [
          {
            role: 'system',
            content: `你是「${role.name}」，正在对抗环境中通过复盘积累经验。请基于本局经历总结教训与可复用技巧。`,
          },
          {
            role: 'user',
            content: [
              `本局结果：${outcomeLine}`,
              `你的行动记录：\n${ownActions.map((a, i) => `${i + 1}. ${a}`).join('\n') || '（无）'}`,
              received.length > 0
                ? `你收到的对手内容：\n${received.map((r) => `- [${r.artifact}] ${r.preview}`).join('\n')}`
                : '（本局未收到对手内容）',
              skillsExcerpt ? `你现有的 SKILLS 文档：\n${skillsExcerpt}` : '（你尚无 SKILLS 文档）',
              '请输出 JSON：{"memory": "本局情景记忆（Markdown，记录本局得失）", "skills": "更新后的完整 SKILLS 技能文档（Markdown，可复用技巧）", "changesSummary": "一句话总结本次经验变更"}',
            ].join('\n\n'),
          },
        ],
        responseFormatJson: true,
      },
      SummarySchema,
      { maxReprompts: 2 },
    )
  } catch (err) {
    const message = err instanceof StructuredOutputError ? err.message : String(err)
    emit({
      type: 'experience.summarized',
      payload: {
        agentId,
        environmentId: env.id,
        matchId,
        kind: 'memory',
        path: '',
        changesSummary: `经验总结失败：${message}`,
      },
    })
    return undefined
  }

  for (const kind of ['memory', 'skills'] as const) {
    const content = kind === 'memory' ? summary.memory : summary.skills
    const record = await store.append({
      environmentId: env.id,
      agentId,
      kind,
      content,
      summary: summary.changesSummary,
      matchId,
      round: null,
    })
    emit({
      type: 'experience.summarized',
      payload: {
        agentId,
        environmentId: env.id,
        matchId,
        kind,
        path: record.path,
        changesSummary: summary.changesSummary,
      },
    })
  }
  return summary
}
