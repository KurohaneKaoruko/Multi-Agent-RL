import { describe, expect, it } from 'vitest'
import type { EnvironmentConfig, RoundEntry } from '@marl/shared'
import {
  aiFlavorEvaluator,
  attackDefenseEvaluator,
  builtinRuleEvaluators,
  flagCheckEvaluator,
  parseAttackDetection,
  parseDetectorVerdict,
} from './rules'

/** 构造最小对抗环境：writer 自由文本 + detector JSON 作答（answerFormat 识别防守方） */
function adversarialEnv(): EnvironmentConfig {
  return {
    id: 'env-test',
    name: '测试对抗环境',
    description: '',
    paradigm: 'adversarial',
    topology: 'asymmetric',
    roles: [
      { id: 'writer', name: '写作者', systemPrompt: 's', goal: 'g', answerFormat: 'free' },
      { id: 'detector', name: '辨别者', systemPrompt: 's', goal: 'g', answerFormat: 'json' },
    ],
    agents: [
      { id: 'writer-a', name: '写作者', roleId: 'writer', startRound: 1 },
      { id: 'detector-a', name: '辨别者', roleId: 'detector', startRound: 1 },
    ],
    turns: { rounds: 2, order: ['writer-a', 'detector-a'] },
    workspaceTemplate: { mode: 'private', files: [] },
    toolsEnabled: true,
    exchanges: [],
    outcome: { mode: 'rule', evaluator: 'ai-flavor', params: {} },
    experience: { enabled: false, tokenBudget: 2000, recentMemoryLimit: 3 },
  }
}

const entry = (agentId: string, content: string): RoundEntry => ({ agentId, content, ts: 0 })

describe('parseDetectorVerdict（辨别结论解析）', () => {
  it('解析裸 JSON 与 fenced JSON 块', () => {
    expect(parseDetectorVerdict('{"verdict": "ai"}')).toBe('ai')
    expect(parseDetectorVerdict('```json\n{"verdict": "human"}\n```')).toBe('human')
  })

  it('优先取最后一个 fenced 块', () => {
    const content = '前文 {"verdict": "ai"}\n```json\n{"verdict": "human"}\n```'
    expect(parseDetectorVerdict(content)).toBe('human')
  })

  it('非法或缺失 verdict 返回 null', () => {
    expect(parseDetectorVerdict('不是 JSON')).toBeNull()
    expect(parseDetectorVerdict('{"verdict": "unknown"}')).toBeNull()
    expect(parseDetectorVerdict('{"reason": "缺少结论"}')).toBeNull()
  })
})

describe('parseAttackDetection（攻防识别解析）', () => {
  it('支持 is_phishing / detected / repelled 多种字段', () => {
    expect(parseAttackDetection('{"is_phishing": true}')).toBe(true)
    expect(parseAttackDetection('{"detected": false}')).toBe(false)
    expect(parseAttackDetection('{"repelled": true}')).toBe(false)
  })

  it('支持 verdict 枚举与非法输入', () => {
    expect(parseAttackDetection('{"verdict": "phishing"}')).toBe(true)
    expect(parseAttackDetection('{"verdict": "safe"}')).toBe(false)
    expect(parseAttackDetection('完全无法解析')).toBeNull()
  })
})

describe('aiFlavorEvaluator（AI 味对抗判定）', () => {
  it('全部识破 → 辨别者以识破率 1 获胜', () => {
    const outcome = aiFlavorEvaluator({
      env: adversarialEnv(),
      entries: [
        { round: 1, entries: [entry('writer-a', '文本一'), entry('detector-a', '{"verdict":"ai"}')] },
        { round: 2, entries: [entry('writer-a', '文本二'), entry('detector-a', '{"verdict":"ai"}')] },
      ],
      params: {},
    })
    expect(outcome.scores).toEqual({ 'writer-a': 0, 'detector-a': 1 })
    expect(outcome.winnerAgentId).toBe('detector-a')
  })

  it('全部被蒙骗 → 写作者获胜（得分互补且恒为 1）', () => {
    const outcome = aiFlavorEvaluator({
      env: adversarialEnv(),
      entries: [{ round: 1, entries: [entry('writer-a', '文本'), entry('detector-a', '{"verdict":"human"}')] }],
      params: {},
    })
    expect(outcome.scores).toEqual({ 'writer-a': 1, 'detector-a': 0 })
    expect(outcome.winnerAgentId).toBe('writer-a')
  })

  it('无法解析的轮次不计入分母（识破 1/1 → 获胜）', () => {
    const outcome = aiFlavorEvaluator({
      env: adversarialEnv(),
      entries: [
        { round: 1, entries: [entry('writer-a', '文本'), entry('detector-a', '{"verdict":"ai"}')] },
        { round: 2, entries: [entry('writer-a', '文本'), entry('detector-a', '胡言乱语')] },
      ],
      params: {},
    })
    // 仅 1 个可判定轮次且识破 → 识破率 1
    expect(outcome.scores['detector-a']).toBe(1)
    expect(outcome.winnerAgentId).toBe('detector-a')
  })

  it('恰好 0.5 识破率为平局', () => {
    const outcome = aiFlavorEvaluator({
      env: adversarialEnv(),
      entries: [
        { round: 1, entries: [entry('writer-a', '文本'), entry('detector-a', '{"verdict":"ai"}')] },
        { round: 2, entries: [entry('writer-a', '文本'), entry('detector-a', '{"verdict":"human"}')] },
      ],
      params: {},
    })
    expect(outcome.scores['detector-a']).toBe(0.5)
    expect(outcome.winnerAgentId).toBeNull()
  })

  it('全部轮次无法解析 → 无可判定轮次，判平局', () => {
    const outcome = aiFlavorEvaluator({
      env: adversarialEnv(),
      entries: [{ round: 1, entries: [entry('writer-a', '文本'), entry('detector-a', '胡言乱语')] }],
      params: {},
    })
    expect(outcome.scores).toEqual({ 'writer-a': 1, 'detector-a': 0 })
    expect(outcome.winnerAgentId).toBeNull()
  })

  it('answerFormat 无 json 角色时回退为最后一个 Agent 判定', () => {
    const env = adversarialEnv()
    const outcome = aiFlavorEvaluator({
      env: { ...env, roles: env.roles.map((r) => ({ ...r, answerFormat: 'free' as const })) },
      entries: [{ round: 1, entries: [entry('writer-a', '文本'), entry('detector-a', '{"verdict":"ai"}')] }],
      params: {},
    })
    expect(outcome.winnerAgentId).toBe('detector-a')
  })
})

describe('attackDefenseEvaluator（攻防对抗判定）', () => {
  it('防守方识别攻击 → 识别率计分并定胜负', () => {
    const outcome = attackDefenseEvaluator({
      env: adversarialEnv(),
      entries: [
        { round: 1, entries: [entry('writer-a', '钓鱼邮件'), entry('detector-a', '{"is_phishing": true}')] },
        { round: 2, entries: [entry('writer-a', '正常邮件'), entry('detector-a', '{"is_phishing": false}')] },
      ],
      params: {},
    })
    expect(outcome.scores).toEqual({ 'writer-a': 0.5, 'detector-a': 0.5 })
    expect(outcome.winnerAgentId).toBeNull()
    expect(outcome.reasoning).toContain('识别率')
  })
})

describe('flagCheckEvaluator（夺旗判定）', () => {
  it('按找到旗标比例计分，全部找到即通关', () => {
    const outcome = flagCheckEvaluator({
      env: adversarialEnv(),
      entries: [{ round: 1, entries: [entry('detector-a', '侦察发现 FLAG{one}，继续深挖得到 FLAG{two}')] }],
      params: { flags: ['FLAG{one}', 'FLAG{two}'] },
    })
    expect(outcome.scores).toEqual({ 'detector-a': 1 })
    expect(outcome.winnerAgentId).toBe('detector-a')
  })

  it('部分找到按比例计分且不判胜', () => {
    const outcome = flagCheckEvaluator({
      env: adversarialEnv(),
      entries: [{ round: 1, entries: [entry('detector-a', '只拿到 FLAG{one}')] }],
      params: { flags: ['FLAG{one}', 'FLAG{two}'] },
    })
    expect(outcome.scores).toEqual({ 'detector-a': 0.5 })
    expect(outcome.winnerAgentId).toBeNull()
  })

  it('非法/空旗标被忽略；无可判定旗标时得 0 分', () => {
    const outcome = flagCheckEvaluator({
      env: adversarialEnv(),
      entries: [{ round: 1, entries: [entry('detector-a', 'FLAG{one}')] }],
      params: { flags: ['', 42, 'FLAG{one}'] },
    })
    // 42 会被过滤为非字符串 → 有效旗标仅 FLAG{one}
    expect(outcome.scores).toEqual({ 'detector-a': 1 })
    const empty = flagCheckEvaluator({
      env: adversarialEnv(),
      entries: [{ round: 1, entries: [entry('detector-a', 'FLAG{one}')] }],
      params: { flags: [] },
    })
    expect(empty.scores).toEqual({ 'detector-a': 0 })
    expect(empty.winnerAgentId).toBeNull()
  })
})

describe('builtinRuleEvaluators（注册表）', () => {
  it('包含三个内置判定器，可按 evaluator 名取用', () => {
    expect(Object.keys(builtinRuleEvaluators).sort()).toEqual(['ai-flavor', 'attack-defense', 'flag-check'])
    expect(builtinRuleEvaluators['ai-flavor']).toBe(aiFlavorEvaluator)
    expect(builtinRuleEvaluators['attack-defense']).toBe(attackDefenseEvaluator)
    expect(builtinRuleEvaluators['flag-check']).toBe(flagCheckEvaluator)
  })
})
