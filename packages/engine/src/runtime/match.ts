import path from 'node:path'
import type {
  AgentBinding,
  EnvironmentConfig,
  MatchEvent,
  MatchOptions,
  MatchResult,
  RoundEntry,
} from '@marl/shared'
import { JUDGE_AGENT_ID, MatchOptionsSchema, newId } from '@marl/shared'
import type { ExperienceStore } from './experience'
import { injectExperience, summarizeExperience, writeExperienceToWorkspace } from './experience'
import { JudgeFailureError, runJudge } from './judge'
import { builtinRuleEvaluators, type RuleEvaluator, type RuleOutcome } from './rules'
import { AgentRuntime, createLLMClient, type EmitEvent } from './agent'
import { MatchEventBus } from './eventbus'
import { mapWithConcurrency } from './concurrency'
import { WorkspaceController } from './workspace'

type Bus = MatchEventBus

export interface CreateMatchOptions {
  matchId?: string
  /** 全量模型绑定快照（多 Agent 可共用同一份 → self-play） */
  bindings: AgentBinding[]
  /** 数据根目录：工作区与经验文件写在其下 */
  dataDir: string
  options?: Partial<MatchOptions>
  /** 经验存储（注入 + 总结）。省略则按环境配置决定是否禁用经验 */
  experienceStore?: ExperienceStore
  /** 规则判定器扩展/覆盖（key 为 env.outcome.evaluator） */
  ruleEvaluators?: Record<string, RuleEvaluator>
  now?: () => number
}

export interface MatchHandle {
  readonly id: string
  readonly bus: Bus
  readonly events: AsyncIterable<{ seq: number; ts: number; event: MatchEvent }>
  run(): Promise<MatchResult>
}

/** 对局失败（携带已完成回合的部分记录，供诊断/审计） */
export class MatchFailedError extends Error {
  constructor(
    message: string,
    readonly payload: { error: string; failedAgentId: string | null; reason: string },
    readonly partialRounds: Array<{ round: number; entries: RoundEntry[] }>,
  ) {
    super(message)
    this.name = 'MatchFailedError'
  }
}

interface DeliveredArtifact {
  artifact: string
  fromAgentId: string
  content: string
  round: number
}

/**
 * 创建对局（4.1）：事件驱动纯库入口。
 * 调用 run() 启动对局；事件经 bus 实时可见，run() resolve 时总线关闭。
 */
export function createMatch(env: EnvironmentConfig, opts: CreateMatchOptions): MatchHandle {
  const id = opts.matchId ?? newId('match')
  const bus = new MatchEventBus()
  const handle: MatchHandle = {
    id,
    bus,
    events: bus.asAsyncIterable(),
    run: () => runMatch(env, id, opts, bus),
  }
  return handle
}

async function runMatch(
  env: EnvironmentConfig,
  matchId: string,
  opts: CreateMatchOptions,
  bus: Bus,
): Promise<MatchResult> {
  const now = opts.now ?? (() => Date.now())
  const emit: EmitEvent = (event) => void bus.emit(event)
  const matchOptions = MatchOptionsSchema.parse({ concurrency: 4, ...opts.options })
  const concurrency = matchOptions.concurrency

  const bindingMap = new Map(opts.bindings.map((b) => [b.agentId, b.modelConfig]))
  const currentRoundRef = { round: 0 }
  const roundLogs: Array<{ round: number; entries: RoundEntry[] }> = []
  const deliveredByAgent = new Map<string, DeliveredArtifact[]>(
    env.agents.map((a) => [a.id, []]),
  )
  let failedAgentId: string | null = null

  try {
    // ---- 开局 ----
    emit({
      type: 'match.started',
      payload: {
        environmentId: env.id,
        environmentName: env.name,
        agentIds: env.agents.map((a) => a.id),
      },
    })

    // ---- 工作区分配（6.1 + 共享模式 + 持久化种子）----
    const workspaceMode = env.workspaceTemplate.mode ?? 'private'
    const persistentBase = path.join(opts.dataDir, 'workspaces', env.id)
    const workspaceBase = path.join(opts.dataDir, 'matches', matchId, 'workspaces')
    const workspaces = new Map<string, WorkspaceController>()
    if (workspaceMode === 'shared') {
      // 协作共享工作区：全体智能体读写同一目录；种子来自该环境的共享持久化工作区
      const shared = await WorkspaceController.allocate(
        workspaceBase,
        '_shared',
        env.workspaceTemplate,
        (op, relPath) => {
          emit({
            type: 'access.denied',
            payload: {
              agentId: '_shared',
              round: currentRoundRef.round,
              path: relPath,
              operation: op,
              reason: '越权访问工作区外路径',
            },
          })
        },
        { shared: true, seedFromDir: path.join(persistentBase, '_shared') },
      )
      for (const agent of env.agents) workspaces.set(agent.id, shared)
    } else {
      for (const agent of env.agents) {
        workspaces.set(
          agent.id,
          await WorkspaceController.allocate(
            workspaceBase,
            agent.id,
            env.workspaceTemplate,
            (op, relPath) => {
              emit({
                type: 'access.denied',
                payload: {
                  agentId: agent.id,
                  round: currentRoundRef.round,
                  path: relPath,
                  operation: op,
                  reason: '越权访问其他 Agent 工作区或工作区外路径',
                },
              })
            },
            { seedFromDir: path.join(persistentBase, agent.id) },
          ),
        )
      }
    }

    // ---- Agent 运行时 + 模型绑定（3.1 / self-play 支持同一配置多实例）----
    const agents = new Map<string, AgentRuntime>()
    for (const agent of env.agents) {
      const modelConfig = bindingMap.get(agent.id)
      if (!modelConfig) throw new Error(`Agent "${agent.id}" 未绑定模型 API`)
      const role = env.roles.find((r) => r.id === agent.roleId)
      if (!role) throw new Error(`Agent "${agent.id}" 引用了不存在的角色 "${agent.roleId}"`)
      agents.set(
        agent.id,
        new AgentRuntime(
          agent,
          role,
          createLLMClient(modelConfig),
          workspaces.get(agent.id)!,
          emit,
          (info) => {
            emit({
              type: 'llm.retry',
              payload: { purpose: 'agent', agentId: agent.id, attempt: info.attempt, delayMs: info.delayMs, error: info.error },
            })
          },
          env.toolsEnabled ?? true,
        ),
      )
    }

    // ---- 经验注入（7.3）：工作区「活的」经验文件优先，存储历史兜底 ----
    const experienceBlocks = new Map<string, string | undefined>()
    if (opts.experienceStore) {
      for (const agent of env.agents) {
        const injected = await injectExperience({
          env,
          agentId: agent.id,
          store: opts.experienceStore,
          workspace: workspaces.get(agent.id),
          emit,
        })
        experienceBlocks.set(agent.id, injected?.block)
      }
    }

    // ---- 回合循环（4.1/4.2）----
    for (let round = 1; round <= env.turns.rounds; round++) {
      currentRoundRef.round = round
      emit({ type: 'round.started', payload: { round } })
      const entries: RoundEntry[] = []

      // 依赖分批：本轮结束时投递的交换 → 目标 Agent 依赖产出方（4.2）
      const depsOf = new Map<string, Set<string>>(env.agents.map((a) => [a.id, new Set<string>()]))
      for (const ex of env.exchanges) {
        if (ex.deliverAtRound === round) depsOf.get(ex.toAgentId)?.add(ex.fromAgentId)
      }
      // 起始轮次：尚未登场的智能体（startRound > 当前轮）不参与本轮行动
      const participants = env.turns.order.filter((agentId) => {
        const slot = env.agents.find((a) => a.id === agentId)
        return (slot?.startRound ?? 1) <= round
      })
      const batches = topoBatches(participants, (id) => depsOf.get(id) ?? new Set())

      for (const batch of batches) {
        await mapWithConcurrency(batch, concurrency, async (agentId) => {
          const agent = agents.get(agentId)
          if (!agent) throw new Error(`行动顺序引用了不存在的 Agent "${agentId}"`)
          failedAgentId = agentId
          emit({ type: 'agent.action_started', payload: { agentId, round } })
          const ctx = {
            round,
            totalRounds: env.turns.rounds,
            experienceBlock: experienceBlocks.get(agentId),
            delivered: deliveredByAgent.get(agentId) ?? [],
          }
          const content = await agent.act(ctx)
          const entry: RoundEntry = { agentId, content, ts: now() }
          entries.push(entry)
          emit({ type: 'agent.action', payload: { agentId, round, content } })
        })
      }

      roundLogs.push({ round, entries })
      emit({ type: 'round.completed', payload: { round } })

      // ---- 交换物投递（6.2）：回合结束时投递本轮规定交付物 ----
      for (const ex of env.exchanges) {
        if (ex.deliverAtRound !== round) continue
        const produced = entries.filter((e) => e.agentId === ex.fromAgentId)
        const latest = produced[produced.length - 1]
        if (!latest) {
          throw new Error(`交换物 "${ex.id}" 缺少产出：${ex.fromAgentId} 在第 ${round} 轮结束前未产出任何内容`)
        }
        const list = deliveredByAgent.get(ex.toAgentId) ?? []
        list.push({ artifact: ex.artifact, fromAgentId: ex.fromAgentId, content: latest.content, round })
        deliveredByAgent.set(ex.toAgentId, list)
        emit({
          type: 'artifact.delivered',
          payload: {
            exchangeId: ex.id,
            artifact: ex.artifact,
            fromAgentId: ex.fromAgentId,
            toAgentId: ex.toAgentId,
            round,
            preview: latest.content.slice(0, 160),
          },
        })
      }
    }

    // ---- 判定（4.3 / 5.x）----
    let scores: Record<string, number>
    let winnerAgentId: string | null
    let outcomeLine: string
    if (env.outcome.mode === 'rule') {
      const evaluator = { ...builtinRuleEvaluators, ...(opts.ruleEvaluators ?? {}) }[env.outcome.evaluator]
      if (!evaluator) throw new Error(`未注册的规则判定器："${env.outcome.evaluator}"`)
      const outcome: RuleOutcome = evaluator({ env, entries: roundLogs, params: env.outcome.params })
      scores = outcome.scores
      winnerAgentId = outcome.winnerAgentId
      outcomeLine = outcome.reasoning ?? `规则判定：胜者 ${winnerAgentId ?? '无（平局）'}`
    } else {
      const judgeModel = bindingMap.get(JUDGE_AGENT_ID)
      if (!judgeModel) throw new Error('该环境需要 AI 裁判，但未绑定裁判模型')
      const isCooperative = env.paradigm === 'cooperative'
      const submissions = env.agents.map((a) => {
        const all = roundLogs.flatMap((r) => r.entries).filter((e) => e.agentId === a.id)
        return { agentId: a.id, content: all[all.length - 1]?.content ?? '' }
      })
      let verdict
      try {
        verdict = await runJudge({
          rubric: env.outcome.rubric,
          client: createLLMClient(judgeModel),
          submissions,
          teamMode: isCooperative,
          emit,
        })
      } catch (err) {
        if (err instanceof JudgeFailureError) {
          throw new Error(`裁判输出持续不合规：${err.cause2.lastError}`)
        }
        throw err
      }
      if (isCooperative) {
        // 协作范式（Agent-RLCF）：无胜负，全体共享团队评分
        const teamScore = verdict.teamScore ?? 0
        scores = {}
        for (const a of env.agents) scores[a.id] = teamScore
        winnerAgentId = null
        outcomeLine = `团队评分 ${teamScore}/100；${verdict.reasoning}`
      } else {
        scores = {}
        for (const a of env.agents) scores[a.id] = verdict.scores?.[a.id] ?? 0
        winnerAgentId = verdict.winnerAgentId ?? null
        outcomeLine = `AI 裁判判定：胜者 ${verdict.winnerAgentId ?? '无（平局）'}；${verdict.reasoning}`
      }
      // verdict 已由 runJudge 记入事件流（judge.verdict）
    }

    // ---- 经验总结（7.1/7.2/7.4）+ 工作区写回 ----
    if (opts.experienceStore && env.experience.enabled) {
      for (const agent of env.agents) {
        const agentRuntime = agents.get(agent.id)!
        const allOwn = roundLogs.flatMap((r) => r.entries).filter((e) => e.agentId === agent.id)
        const received = (deliveredByAgent.get(agent.id) ?? []).map((d) => ({
          artifact: d.artifact,
          preview: d.content.slice(0, 160),
        }))
        const summary = await summarizeExperience({
          env,
          matchId,
          agentId: agent.id,
          role: agentRuntime.role,
          client: agentRuntime.client,
          store: opts.experienceStore,
          ownActions: allOwn.map((e) => e.content),
          received,
          outcomeLine,
          emit,
        })
        if (summary) {
          // 写回「活的」工作区文件：本场工作区 + 持久化工作区（用户可查看/编辑，影响下一场）
          const agentWs = workspaces.get(agent.id)!
          await writeExperienceToWorkspace(agentWs, summary)
          const persistent = await WorkspaceController.openExisting(
            path.join(persistentBase, workspaceMode === 'shared' ? '_shared' : agent.id),
            agent.id,
          )
          await writeExperienceToWorkspace(persistent, summary)
        }
      }
      // 对局工作区整体回写持久化工作区（智能体工具写入的文件得以保留）
      for (const agent of env.agents) {
        if (workspaceMode === 'shared') break // 共享工作区在总结阶段已写回
        const ws = workspaces.get(agent.id)!
        await ws.copyTo(path.join(persistentBase, agent.id))
      }
      if (workspaceMode === 'shared') {
        const sharedWs = workspaces.get(env.agents[0]!.id)!
        await sharedWs.copyTo(path.join(persistentBase, '_shared'))
      }
    }

    // ---- 结果与终局（4.3）----
    const result: MatchResult = {
      matchId,
      environmentId: env.id,
      winnerAgentId,
      scores,
      rounds: roundLogs,
      finishedAt: now(),
    }
    emit({ type: 'match.completed', payload: { result } })
    bus.close()
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emit({
      type: 'match.failed',
      payload: { error: message, failedAgentId, reason: classifyFailure(message) },
    })
    bus.close()
    throw new MatchFailedError(message, { error: message, failedAgentId, reason: classifyFailure(message) }, roundLogs)
  }
}

/** 依赖拓扑分批：无依赖者优先成批，批内保持 order 顺序（4.2） */
function topoBatches(order: string[], depsOf: (id: string) => Set<string>): string[][] {
  const done = new Set<string>()
  const remaining = [...order]
  const batches: string[][] = []
  while (remaining.length > 0) {
    const batch = remaining.filter((id) => [...depsOf(id)].every((d) => done.has(d)))
    if (batch.length === 0) {
      // 循环依赖兜底：按原序放到最后一批（配置校验层已在 ref 校验拦截常见问题）
      batches.push(...remaining.map((id) => [id]))
      break
    }
    for (const id of batch) done.add(id)
    batches.push(batch)
    for (const id of batch) {
      const idx = remaining.indexOf(id)
      remaining.splice(idx, 1)
    }
  }
  return batches
}

function classifyFailure(message: string): string {
  if (message.includes('script exhausted') || message.includes('Mock failure')) return '模型持续失败'
  if (message.includes('未绑定模型')) return '配置错误：缺少模型绑定'
  if (message.includes('裁判')) return '裁判判定失败'
  if (message.includes('交换物')) return '配置错误：交换物协议无法满足'
  return '运行时错误'
}
