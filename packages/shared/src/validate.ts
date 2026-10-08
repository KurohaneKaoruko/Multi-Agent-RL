import { randomUUID } from 'node:crypto'
import type { AgentBinding, EnvironmentConfig, Exchange, Role, AgentSlot } from './schema'
import { JUDGE_AGENT_ID } from './schema'
import type { FieldError } from './dto'

/** 引用校验所需的最小结构（完整配置与 AI 草稿均满足） */
export interface RefCheckEnv {
  roles: Array<Pick<Role, 'id'>>
  agents: Array<Pick<AgentSlot, 'id' | 'startRound' | 'name' | 'roleId'>>
  turns: { rounds: number; order: string[] }
  exchanges: Array<Pick<Exchange, 'id' | 'fromAgentId' | 'toAgentId' | 'deliverAtRound'>>
}

/** 短 id：prefix + 12 位随机 */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

/** 粗略 token 估算：中文约 1.5~2 字符/token，英文约 4 字符/token，取 2.5 折中偏保守 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2.5)
}

/**
 * 环境配置结构校验之外的引用一致性校验（对局前校验的一部分）。
 * 返回字段级中文错误列表；空数组表示通过。
 */
/** 环境配置结构校验之外的引用一致性校验（对局前校验的一部分）。
 * 接受完整配置或 AI 生成的草稿（仅需四个引用相关字段）。 */
export function validateEnvironmentRefs(env: RefCheckEnv): FieldError[] {
  const errors: FieldError[] = []
  const roleIds = new Set(env.roles.map((r) => r.id))
  const agentIds = new Set(env.agents.map((a) => a.id))

  for (const agent of env.agents) {
    if (!roleIds.has(agent.roleId)) {
      errors.push({ path: `agents[${agent.id}].roleId`, message: `引用了不存在的角色 "${agent.roleId}"` })
    }
  }
  for (const agentId of env.turns.order) {
    if (!agentIds.has(agentId)) {
      errors.push({ path: 'turns.order', message: `行动顺序引用了不存在的 Agent "${agentId}"` })
    }
  }
  for (const agent of env.agents) {
    if (!env.turns.order.includes(agent.id)) {
      errors.push({
        path: 'turns.order',
        message: `Agent "${agent.id}" 未出现在行动顺序中，每轮所有 Agent 均须获得行动机会`,
      })
    }
  }
  for (const exchange of env.exchanges) {
    if (!agentIds.has(exchange.fromAgentId)) {
      errors.push({
        path: `exchanges[${exchange.id}].fromAgentId`,
        message: `引用了不存在的 Agent "${exchange.fromAgentId}"`,
      })
    }
    if (!agentIds.has(exchange.toAgentId)) {
      errors.push({
        path: `exchanges[${exchange.id}].toAgentId`,
        message: `引用了不存在的 Agent "${exchange.toAgentId}"`,
      })
    }
    if (exchange.deliverAtRound > env.turns.rounds) {
      errors.push({
        path: `exchanges[${exchange.id}].deliverAtRound`,
        message: `投递轮次 ${exchange.deliverAtRound} 超出总轮数 ${env.turns.rounds}`,
      })
    }
    // 起始轮次与投递时序的一致性：产出方须在投递轮次前已登场（否则无内容可投递）
    const from = env.agents.find((a) => a.id === exchange.fromAgentId)
    if (from != null && from.startRound > exchange.deliverAtRound) {
      errors.push({
        path: `exchanges[${exchange.id}].deliverAtRound`,
        message: `产出方 "${from.id}" 起始轮次（第 ${from.startRound} 轮）晚于投递轮次（第 ${exchange.deliverAtRound} 轮），将无内容可投递`,
      })
    }
  }
  // 投递不能发生在最后一轮结束：那样接收方永远没有使用该内容的机会
  for (const exchange of env.exchanges) {
    if (exchange.deliverAtRound >= env.turns.rounds && env.agents.some((a) => a.id === exchange.toAgentId)) {
      errors.push({
        path: `exchanges[${exchange.id}].deliverAtRound`,
        message: `投递轮次（第 ${exchange.deliverAtRound} 轮）为最后一轮，接收方 "${exchange.toAgentId}" 将没有后续轮次使用该内容，请提前投递轮次`,
      })
    }
  }
  return errors
}

/**
 * 开赛前绑定校验：所有参战 Agent 均已绑定模型；需裁判的环境必须绑定裁判（agentId='judge'）。
 */
export function validateBindingsForMatch(
  env: EnvironmentConfig,
  bindings: AgentBinding[],
): FieldError[] {
  const errors: FieldError[] = []
  const bound = new Set(bindings.map((b) => b.agentId))
  for (const agent of env.agents) {
    if (!bound.has(agent.id)) {
      errors.push({
        path: `bindings.${agent.id}`,
        message: `Agent "${agent.id}"（${agent.name}）未绑定模型 API`,
      })
    }
  }
  if (env.outcome.mode === 'judge' && !bound.has(JUDGE_AGENT_ID)) {
    errors.push({ path: 'bindings.judge', message: '该环境需要 AI 裁判，但未绑定裁判模型（agentId="judge"）' })
  }
  if (env.outcome.mode === 'rule' && bound.has(JUDGE_AGENT_ID)) {
    errors.push({ path: 'bindings.judge', message: '规则判定环境无需绑定裁判' })
  }
  const unknown = bindings.filter((b) => b.agentId !== JUDGE_AGENT_ID && !env.agents.some((a) => a.id === b.agentId))
  for (const b of unknown) {
    errors.push({ path: `bindings.${b.agentId}`, message: `绑定了环境中不存在的 Agent "${b.agentId}"` })
  }
  return errors
}
