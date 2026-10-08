import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { EnvironmentConfig, ModelConfig } from '@marl/shared'
import { EnvironmentConfigSchema, validateEnvironmentRefs } from '@marl/shared'
import { buildApp, closeApp } from './app'
import { BUILTIN_TEMPLATES, instantiateTemplate } from './templates'

describe('内置模板定义（11.1）', () => {
  it('模板通过 shared 校验（schema + 引用一致性）', () => {
    for (const template of BUILTIN_TEMPLATES) {
      const parsed = EnvironmentConfigSchema.safeParse(template.config)
      expect(parsed.success, template.templateId).toBe(true)
      expect(validateEnvironmentRefs(template.config), template.templateId).toEqual([])
    }
  })

  it('一键实例化生成新 id 且不改动模板本体', () => {
    const before = JSON.stringify(BUILTIN_TEMPLATES[0]!.config)
    const config = instantiateTemplate('ai-flavor-adversarial')
    expect(config.id).not.toBe('tpl-ai-flavor')
    expect(config.id).toMatch(/^env_/)
    expect(config.agents.map((a) => a.id)).toEqual(['writer-a', 'detector-a'])
    expect(JSON.stringify(BUILTIN_TEMPLATES[0]!.config)).toBe(before)
    expect(() => instantiateTemplate('nope')).toThrow('不存在')
  })

  it('engine 用 mock provider 跑通模板完整对局（互斥胜负：识破→辨别者胜）', async () => {
    const { createMatch } = await import('@marl/engine')
    const env = instantiateTemplate('ai-flavor-adversarial', { id: 'env-tpl-run', name: '模板对局验证' })
    const mock = (script: unknown[]): ModelConfig => ({
      id: 'm',
      name: 'mock',
      baseUrl: 'mock://arlaf',
      apiKey: JSON.stringify(script),
      model: 'mock',
      params: {},
    })
    const summary = JSON.stringify({ memory: '记忆', skills: '技能', changesSummary: '总结' })
    const handle = createMatch(env, {
      matchId: 'match-tpl',
      bindings: [
        { agentId: 'writer-a', modelConfig: mock(['第一轮：生活观察文本。', '第二轮：另一段文本。', summary]) },
        {
          agentId: 'detector-a',
          modelConfig: mock(['{"verdict":"ai","reason":"句式过于工整"}', '{"verdict":"ai","reason":"模板痕迹明显"}', summary]),
        },
      ],
      dataDir: await mkdtemp(path.join(tmpdir(), 'arlaf-tpl-')),
    })
    const result = await handle.run()
    // 辨别者两轮均识破（判 ai）→ 辨别者胜
    expect(result.winnerAgentId).toBe('detector-a')
    expect(result.scores['detector-a']).toBe(1)
    expect(result.scores['writer-a']).toBe(0)
    // 交换物按协议在第 1 轮结束投递一次，第 2 轮辨别者上下文已含作品
    const delivered = handle.bus.snapshot().filter((e) => e.event.type === 'artifact.delivered')
    expect(delivered).toHaveLength(1)
  })

  it('协作全流程（Agent-RLCF）：作者初稿 → 编辑意见 → 修订终稿 → 裁判团队评分', async () => {
    const { createMatch } = await import('@marl/engine')
    const env = instantiateTemplate('writing-workshop', { id: 'env-workshop-run', name: '工坊对局验证' })
    const mock = (script: unknown[]): ModelConfig => ({
      id: 'm',
      name: 'mock',
      baseUrl: 'mock://arlaf',
      apiKey: JSON.stringify(script),
      model: 'mock',
      params: {},
    })
    const summary = JSON.stringify({ memory: '记忆', skills: '技能', changesSummary: '总结' })
    const handle = createMatch(env, {
      matchId: 'match-workshop',
      bindings: [
        {
          agentId: 'author-a',
          modelConfig: mock([
            '初稿：今天去了菜市场，很有生活气息。',
            '终稿：清晨的菜市场人声鼎沸，鱼贩的吆喝、塑料袋的窸窣、秤盘碰撞的脆响混在一起。我拎着刚买的鲫鱼往家走，阳光落在水珠上，亮得晃眼。（已采纳编辑建议：补充感官细节与具体意象）',
            summary,
          ]),
        },
        {
          agentId: 'editor-a',
          modelConfig: mock([
            '{"suggestions": ["补充感官细节", "加入具体意象"], "overall": "骨架不错，细节不足"}',
            summary,
          ]),
        },
        {
          agentId: 'judge',
          modelConfig: mock([
            JSON.stringify({
              teamScore: 88,
              strengths: '编辑意见具体且被充分采纳，终稿画面感明显增强',
              shortcomings: '终稿篇幅略有不足',
              reasoning: '迭代幅度大，协作有效',
            }),
          ]),
        },
      ],
      dataDir: await mkdtemp(path.join(tmpdir(), 'arlaf-ws-run-')),
    })
    const result = await handle.run()
    // 协作模式：无胜负，全队共享裁判团队评分
    expect(result.winnerAgentId).toBeNull()
    expect(result.scores['author-a']).toBe(result.scores['editor-a'])
    const events = handle.bus.snapshot().map((e) => e.event)
    // 投递链完整：初稿 → 编辑；修改意见 → 作者
    const delivered = events.filter((e) => e.type === 'artifact.delivered')
    expect(delivered.map((e) => (e as { payload: { artifact: string } }).payload.artifact)).toEqual(['初稿', '修改意见'])
    // 裁判给出团队评分
    const verdict = events.find((e) => e.type === 'judge.verdict')
    expect(verdict).toBeDefined()
  })

  it('互斥性：辨别者被蒙骗（判 human）→ 写作者胜，双方得分之和恒为 1', async () => {
    const { createMatch } = await import('@marl/engine')
    const env = instantiateTemplate('ai-flavor-adversarial', { id: 'env-tpl-run2', name: '蒙骗验证' })
    const mock = (script: unknown[]): ModelConfig => ({
      id: 'm',
      name: 'mock',
      baseUrl: 'mock://arlaf',
      apiKey: JSON.stringify(script),
      model: 'mock',
      params: {},
    })
    const summary = JSON.stringify({ memory: '记忆', skills: '技能', changesSummary: '总结' })
    const handle = createMatch(env, {
      matchId: 'match-tpl-fool',
      bindings: [
        { agentId: 'writer-a', modelConfig: mock(['第一轮：文本。', '第二轮：文本。', summary]) },
        {
          agentId: 'detector-a',
          modelConfig: mock(['{"verdict":"human","reason":"被蒙骗"}', '{"verdict":"human","reason":"又被蒙骗"}', summary]),
        },
      ],
      dataDir: await mkdtemp(path.join(tmpdir(), 'arlaf-tpl2-')),
    })
    const result = await handle.run()
    // 辨别者两轮都被蒙骗 → 写作者胜（互斥：辨别者失分即写作者得分）
    expect(result.winnerAgentId).toBe('writer-a')
    expect(result.scores['writer-a']).toBe(1)
    expect(result.scores['detector-a']).toBe(0)
    expect(result.scores['writer-a'] + result.scores['detector-a']).toBe(1)
  })
})

describe('模板种子数据（11.2）', () => {
  it('冷启动后模板出现在环境列表且标记为内置', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'arlaf-seed-'))
    const app: FastifyInstance = await buildApp({ dataDir })
    try {
      await app.ready()
      const list = (await app.inject({ method: 'GET', url: '/api/environments' })).json() as {
        environments: Array<{ id: string; isBuiltinTemplate: boolean }>
      }
      const builtin = list.environments.find((e) => e.id === 'tpl-ai-flavor')
      expect(builtin).toBeDefined()
      expect(builtin!.isBuiltinTemplate).toBe(true)

      // 模板列表接口
      const templates = (await app.inject({ method: 'GET', url: '/api/templates' })).json() as {
        templates: Array<{ templateId: string }>
      }
      expect(templates.templates.map((t) => t.templateId)).toContain('ai-flavor-adversarial')

      // 一键实例化接口 → 出现在环境列表（非内置标记）
      const created = await app.inject({
        method: 'POST',
        url: '/api/environments/from-template',
        payload: { templateId: 'ai-flavor-adversarial' },
      })
      expect(created.statusCode).toBe(201)
      const newInstance = created.json() as { id: string }
      expect(newInstance.id).not.toBe('tpl-ai-flavor')
      const list2 = (await app.inject({ method: 'GET', url: '/api/environments' })).json() as {
        environments: Array<{ id: string; isBuiltinTemplate: boolean }>
      }
      const inst = list2.environments.find((e) => e.id === newInstance.id)
      expect(inst?.isBuiltinTemplate).toBe(false)

      // 重启（同一 dataDir 再次 buildApp）→ 模板仍只有一份（幂等）
      await closeApp(app)
      const app2 = await buildApp({ dataDir })
      const list3 = (await app2.inject({ method: 'GET', url: '/api/environments' })).json() as {
        environments: Array<{ id: string }>
      }
      expect(list3.environments.filter((e) => e.id === 'tpl-ai-flavor')).toHaveLength(1)
      await closeApp(app2)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  }, 20000)
})

// 保留类型引用（envFixture 供未来扩展）
export type { EnvironmentConfig }
