import path from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import websocket from '@fastify/websocket'
import { z } from 'zod'
import {
  completeStructured,
  createLLMClient,
  FileExperienceStore,
  MockProvider,
  OpenAICompatibleClient,
} from '@marl/engine'
import {
  EnvironmentConfigSchema,
  EnvironmentDraftSchema,
  MatchResultSchema,
  ModelConfigInputSchema,
  newId,
  validateBindingsForMatch,
  validateEnvironmentRefs,
  type AgentBinding,
  type EnvironmentConfig,
  type FieldError,
} from '@marl/shared'
import { closeDb, openDb, type Db } from './db/db'
import { latestSeq, listEvents } from './db/events'
import { MatchManager } from './services/match-manager'
import * as repos from './services/repos'
import { registerWorkspaceRoutes } from './services/workspace-routes'
import { parseBody, zodBody } from './validation'
import { registerMatchWs } from './ws'
import { BUILTIN_TEMPLATES, instantiateTemplate, type BuiltinTemplate } from './templates'
import { z as zod } from 'zod'

const FromTemplateSchema = zod.object({
  templateId: zod.string().min(1),
  id: zod.string().min(1).optional(),
  name: zod.string().min(1).optional(),
})

export interface BuildAppOptions {
  dataDir: string
  logger?: boolean
}

const MatchCreateSchema = z.object({
  environmentId: z.string().min(1),
  bindings: z
    .array(
      z.object({
        agentId: z.string().min(1),
        modelConfigId: z.string().min(1),
      }),
    )
    .min(1),
  /** 批量连续训练：一次创建并按顺序执行 N 场（前一场经验注入后一场） */
  episodes: z.number().int().min(1).max(20).default(1),
})

const ValidateBodySchema = z.object({
  bindings: z
    .array(
      z.object({
        agentId: z.string().min(1),
        modelConfigId: z.string().min(1),
      }),
    )
    .default([]),
})

const TimelineQuerySchema = z.object({
  environmentId: z.string().min(1),
  agentId: z.string().min(1),
})

const GenerateDraftSchema = z.object({
  idea: z.string().min(4).max(2000),
  modelConfigId: z.string().min(1),
})

/**
 * 构建 ARLAF API 服务（9.1–9.5）。
 * 路由体 schema 由 shared Zod 派生（文档一致性）；校验错误统一中文字段级提示。
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const db: Db = openDb(options.dataDir)
  const manager = new MatchManager(db, options.dataDir)
  const experienceStore = new FileExperienceStore(path.join(options.dataDir, 'experience'))

  const app = Fastify({ logger: options.logger ?? false, ajv: { customOptions: { allErrors: true, strict: false } } })
  app.decorate('arlaf', { db, manager, experienceStore })

  // 内置模板种子数据（11.2）：冷启动写入；已存在时随代码升级配置（内置模板由代码所有权管理）
  for (const template of BUILTIN_TEMPLATES) {
    const existing = repos.getEnvironment(db, template.config.id)
    if (!existing) {
      repos.insertEnvironment(db, template.config, true)
    } else if (existing.isBuiltinTemplate) {
      repos.updateEnvironment(db, template.config)
    }
  }

  await app.register(swagger, {
    openapi: {
      info: { title: 'ARLAF API', description: '通用对抗进化智能体框架 API', version: '0.1.0' },
      tags: [
        { name: 'environments', description: '对抗环境' },
        { name: 'models', description: '模型与 API 配置' },
        { name: 'matches', description: '对局' },
        { name: 'experience', description: '经验库' },
      ],
    },
  })
  await app.register(swaggerUi, { routePrefix: '/api/docs' })
  await app.register(websocket)
  registerMatchWs(app, db)
  registerWorkspaceRoutes(app, options.dataDir)

  // ---- 校验错误：中文、字段级（复用 shared Zod） ----
  const zodSchemas = new Map<string, z.ZodType>()
  const withBody = (method: 'POST' | 'PUT', url: string, schema: z.ZodType) => {
    zodSchemas.set(`${method} ${url}`, schema)
    return { schema: { body: zodBody(schema) } }
  }

  app.setErrorHandler((error, request, reply) => {
    if (Array.isArray((error as { validation?: unknown[] }).validation)) {
      const key = `${request.method} ${request.routeOptions.url}`
      const schema = zodSchemas.get(key)
      let fields: FieldError[] | undefined
      if (schema) {
        const parsed = parseBody(schema, request.body)
        if (!parsed.ok) fields = parsed.fields
      }
      if (!fields) {
        fields = (error as { validation: Array<{ instancePath?: string; message?: string }> }).validation.map((v) => ({
          path: (v.instancePath ?? '').replace(/\//g, '.').replace(/^\./, '') || '(body)',
          message: '请求体不符合要求的结构',
        }))
      }
      void reply.code(400).send({ error: '请求参数校验失败', fields })
      return
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500
    if (status >= 500) console.error('[ARLAF][500]', error)
    const message = (error as { message?: string }).message ?? '未知错误'
    void reply.code(status).send({ error: status >= 500 ? '服务器内部错误' : message })
  })

  const notFound = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, what: string) =>
    reply.code(404).send({ error: `${what}不存在` })

  /* ---------------- environments ---------------- */

  app.get('/api/environments', async () => ({ environments: repos.listEnvironments(db) }))

  // 内置模板列表（供环境构建器一键实例化）
  app.get('/api/templates', async () => ({
    templates: BUILTIN_TEMPLATES.map((t: BuiltinTemplate) => ({
      templateId: t.templateId,
      description: t.description,
      name: t.config.name,
      paradigm: t.config.paradigm ?? ('adversarial' as const),
    })),
  }))

  app.post(
    '/api/environments/from-template',
    withBody('POST', '/api/environments/from-template', FromTemplateSchema),
    async (request, reply) => {
      const parsed = parseBody(FromTemplateSchema, request.body)
      if (!parsed.ok) return reply.code(400).send({ error: '请求参数校验失败', fields: parsed.fields })
      try {
        const config = instantiateTemplate(parsed.data.templateId, { id: parsed.data.id, name: parsed.data.name })
        const view = repos.insertEnvironment(db, config, false)
        return reply.code(201).send(view)
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
      }
    },
  )

  app.post(
    '/api/environments',
    withBody('POST', '/api/environments', EnvironmentConfigSchema),
    async (request, reply) => {
      const parsed = parseBody(EnvironmentConfigSchema, request.body)
      if (!parsed.ok) return reply.code(400).send({ error: '环境配置校验失败', fields: parsed.fields })
      const refErrors = validateEnvironmentRefs(parsed.data)
      if (refErrors.length > 0) return reply.code(400).send({ error: '环境配置存在引用错误', fields: refErrors })
      const view = repos.insertEnvironment(db, parsed.data)
      return reply.code(201).send(view)
    },
  )

  // 环境配置导出（JSON 文件下载，可分享/导入）
  app.get('/api/environments/:id/export', async (request, reply) => {
    const { id } = request.params as { id: string }
    const view = repos.getEnvironment(db, id)
    if (!view) return notFound(reply, '环境')
    const payload = {
      kind: 'marl-environment',
      version: 1,
      exportedAt: new Date().toISOString(),
      config: view.config,
    }
    reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="env-${view.id}.json"`)
    return reply.send(JSON.stringify(payload, null, 2))
  })

  // 环境配置导入：分配新 id，避免与既有环境冲突
  app.post(
    '/api/environments/import',
    { schema: { body: { type: 'object' } } },
    async (request, reply) => {
      const body = request.body as { config?: unknown }
      const configBody = body?.config ?? body
      const parsed = parseBody(EnvironmentConfigSchema, configBody)
      if (!parsed.ok) return reply.code(400).send({ error: '环境配置校验失败', fields: parsed.fields })
      const config: EnvironmentConfig = { ...parsed.data, id: newId('env') }
      const refErrors = validateEnvironmentRefs(config)
      if (refErrors.length > 0) return reply.code(400).send({ error: '环境配置存在引用错误', fields: refErrors })
      const view = repos.insertEnvironment(db, config, false)
      return reply.code(201).send(view)
    },
  )

  app.get('/api/environments/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const view = repos.getEnvironment(db, id)
    if (!view) return notFound(reply, '环境')
    return view
  })

  // AI 生成环境配置草稿（构建器「让 LLM 自己构建」）：按用户构想生成可编辑草稿，不入库
  app.post(
    '/api/environments/generate-draft',
    withBody('POST', '/api/environments/generate-draft', GenerateDraftSchema),
    async (request, reply) => {
      const parsed = parseBody(GenerateDraftSchema, request.body)
      if (!parsed.ok) return reply.code(400).send({ error: '请求参数校验失败', fields: parsed.fields })
      const modelConfig = repos.getFullModelConfig(db, parsed.data.modelConfigId)
      if (!modelConfig) {
        return reply.code(400).send({
          error: '模型配置校验失败',
          fields: [{ path: 'modelConfigId', message: '引用的模型配置不存在，请先在「模型设置」添加' }],
        })
      }
      const client = createLLMClient(modelConfig)
      try {
        const draft = await completeStructured(
          client,
          {
            messages: [
              {
                role: 'system',
                content: `你是对抗环境设计师，为 ARLAF（对抗进化智能体框架）设计环境。环境概念：
- roles：参战身份，每个含 systemPrompt（身份设定）、goal（本轮任务指令）、answerFormat（free=自由文本，json=需输出 JSON 结论，判断类角色用 json）
- agents：智能体槽位（角色的实例），id 用英文短横线命名
- turns：总轮数与每轮行动顺序（order 必须包含全部智能体）
- exchanges：交换物协议，deliverAtRound 表示"该轮结束时"投递；产出方 startRound 须 ≤ 投递轮次，接收方 startRound 须 > 投递轮次
- outcome：判定方式，"rule" 配 evaluator:"ai-flavor"（辨别准确率）或 "judge"（AI 裁判 + rubric）
- startRound：智能体起始轮次，判断类智能体应在收到投递后才行动
所有提示词用中文撰写，具体、可执行、有对抗张力。`,
              },
              {
                role: 'user',
                content: `请为以下构想设计一个对抗环境：\n【构想】${parsed.data.idea}\n\n输出 JSON 对象（不要包含 id 字段）：{"name","description","topology":"symmetric|asymmetric|melee","roles":[...],"agents":[...],"turns":{"rounds",order},"workspaceTemplate":{"files":[]},"exchanges":[...],"outcome":{...},"experience":{"enabled":true,"tokenBudget":2000,"recentMemoryLimit":3}}`,
              },
            ],
            responseFormatJson: true,
          },
          EnvironmentDraftSchema,
          { maxReprompts: 2 },
        )
        const refErrors = validateEnvironmentRefs(draft)
        if (refErrors.length > 0) {
          return reply.code(422).send({ error: 'AI 生成的配置存在一致性问题，请重试或手动调整', fields: refErrors })
        }
        return { draft }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return reply.code(502).send({ error: `AI 生成失败：${message}` })
      }
    },
  )

  app.put(
    '/api/environments/:id',
    withBody('PUT', '/api/environments/:id', EnvironmentConfigSchema),
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const existing = repos.getEnvironment(db, id)
      if (!existing) return notFound(reply, '环境')
      const parsed = parseBody(EnvironmentConfigSchema, request.body)
      if (!parsed.ok) return reply.code(400).send({ error: '环境配置校验失败', fields: parsed.fields })
      const config: EnvironmentConfig = { ...parsed.data, id }
      const refErrors = validateEnvironmentRefs(config)
      if (refErrors.length > 0) return reply.code(400).send({ error: '环境配置存在引用错误', fields: refErrors })
      repos.updateEnvironment(db, config)
      return repos.getEnvironment(db, id)
    },
  )

  app.delete('/api/environments/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!repos.deleteEnvironment(db, id)) return notFound(reply, '环境')
    return { ok: true }
  })

  // 对局前校验（9.2）：需裁判的环境必须绑定裁判、所有 Agent 必须绑定模型
  app.post(
    '/api/environments/:id/validate',
    withBody('POST', '/api/environments/:id/validate', ValidateBodySchema),
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const view = repos.getEnvironment(db, id)
      if (!view) return notFound(reply, '环境')
      const parsed = parseBody(ValidateBodySchema, request.body)
      if (!parsed.ok) return reply.code(400).send({ error: '请求参数校验失败', fields: parsed.fields })
      const bindings: Array<{ agentId: string; modelConfigId: string }> = parsed.data.bindings
      const missing = bindings.find((b) => !repos.getFullModelConfig(db, b.modelConfigId))
      if (missing) {
        return reply.code(400).send({
          error: '模型配置校验失败',
          fields: [{ path: `bindings.${missing.agentId}`, message: '引用的模型配置不存在' }],
        })
      }
      const resolved = resolveBindings(db, bindings)
      const errors = validateBindingsForMatch(view.config, resolved)
      return { ok: errors.length === 0, fields: errors }
    },
  )

  /* ---------------- models ---------------- */

  app.get('/api/models', async () => ({ models: repos.listModelConfigs(db) }))

  app.post(
    '/api/models',
    withBody('POST', '/api/models', ModelConfigInputSchema),
    async (request, reply) => {
      const parsed = parseBody(ModelConfigInputSchema, request.body)
      if (!parsed.ok) return reply.code(400).send({ error: '模型配置校验失败', fields: parsed.fields })
      return reply.code(201).send(repos.insertModelConfig(db, parsed.data))
    },
  )

  app.put(
    '/api/models/:id',
    withBody('PUT', '/api/models/:id', ModelConfigInputSchema),
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const parsed = parseBody(ModelConfigInputSchema, request.body)
      if (!parsed.ok) return reply.code(400).send({ error: '模型配置校验失败', fields: parsed.fields })
      const view = repos.updateModelConfig(db, id, parsed.data)
      if (!view) return notFound(reply, '模型配置')
      return view
    },
  )

  app.delete('/api/models/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!repos.deleteModelConfig(db, id)) return notFound(reply, '模型配置')
    return { ok: true }
  })

  // 连通性测试（9.3）
  app.post('/api/models/:id/test', async (request, reply) => {
    const { id } = request.params as { id: string }
    const config = repos.getFullModelConfig(db, id)
    if (!config) return notFound(reply, '模型配置')
    const client = config.baseUrl.startsWith('mock:')
      ? new MockProvider({ script: ['pong'] })
      : new OpenAICompatibleClient(config, { timeoutMs: 10_000, maxRetries: 1, retryBaseDelayMs: 200 })
    try {
      const res = await client.complete({
        messages: [{ role: 'user', content: '回复 pong（连通性测试）' }],
        params: { maxTokens: 8 },
      })
      return { ok: true, message: `连接成功，模型返回：${res.text.slice(0, 40)}` }
    } catch (err) {
      return { ok: false, message: `连接失败：${err instanceof Error ? err.message : String(err)}` }
    }
  })

  /* ---------------- matches ---------------- */

  app.get('/api/matches', async () => ({ matches: repos.listMatchRows(db).map(repos.matchRowToSummary) }))

  app.post(
    '/api/matches',
    withBody('POST', '/api/matches', MatchCreateSchema),
    async (request, reply) => {
      const parsed = parseBody(MatchCreateSchema, request.body)
      if (!parsed.ok) return reply.code(400).send({ error: '请求参数校验失败', fields: parsed.fields })
      const view = repos.getEnvironment(db, parsed.data.environmentId)
      if (!view) return notFound(reply, '环境')
      const missingModel = parsed.data.bindings.find((b) => !repos.getFullModelConfig(db, b.modelConfigId))
      if (missingModel) {
        return reply.code(400).send({
          error: '模型配置校验失败',
          fields: [{ path: `bindings.${missingModel.agentId}`, message: '引用的模型配置不存在' }],
        })
      }
      const resolved = resolveBindings(db, parsed.data.bindings)
      const errors = validateBindingsForMatch(view.config, resolved)
      if (errors.length > 0) return reply.code(400).send({ error: '无法开赛：对局前校验未通过', fields: errors })

      // 批量连续训练：一次创建 N 场同批次对局（顺序执行，前一场经验注入后一场）
      const batchId = parsed.data.episodes > 1 ? newId('batch') : null
      const ids: string[] = []
      for (let i = 0; i < parsed.data.episodes; i++) {
        const id = newId('match')
        repos.insertMatchRow(db, { id, env: view, bindings: resolved, batchId: batchId ?? undefined })
        ids.push(id)
      }
      return reply.code(201).send({ ids, firstId: ids[0]!, status: 'pending', episodes: parsed.data.episodes })
    },
  )

  app.post('/api/matches/:id/start', async (request, reply) => {
    const { id } = request.params as { id: string }
    const row = repos.getMatchRow(db, id)
    if (!row) return notFound(reply, '对局')
    if (row.status === 'running') return reply.code(202).send({ id, status: 'running' })
    if (row.status !== 'pending') {
      return reply.code(409).send({ error: `对局已结束（${row.status}），无法重复启动` })
    }
    // 批量连续训练：同批次后续对局由引擎按顺序接续执行
    if (row.batch_id) {
      manager.startSequenceForBatch(row.batch_id)
      return reply.code(202).send({ id, status: 'running', batchId: row.batch_id })
    }
    void manager.start(id)
    return reply.code(202).send({ id, status: 'running' })
  })

  app.get('/api/matches/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const row = repos.getMatchRow(db, id)
    if (!row) return notFound(reply, '对局')
    const summary = repos.matchRowToSummary(row)
    let result: unknown = null
    if (row.result_json) {
      const parsedResult = MatchResultSchema.safeParse(JSON.parse(row.result_json))
      if (parsedResult.success) result = parsedResult.data
    }
    return { ...summary, agentIds: JSON.parse(row.agent_ids) as string[], error: row.error, result }
  })

  app.get('/api/matches/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!repos.getMatchRow(db, id)) return notFound(reply, '对局')
    const query = request.query as { since?: string }
    const since = Math.max(0, Number(query.since ?? 0) || 0)
    return { events: listEvents(db, id, since), latestSeq: latestSeq(db, id) }
  })

  /* ---------------- stats ---------------- */

  app.get('/api/stats', async (request, reply) => {
    const query = request.query as { environmentId?: string }
    if (!query.environmentId) {
      return reply.code(400).send({ error: '缺少 environmentId 查询参数' })
    }
    return { stats: repos.listWinStats(db, query.environmentId) }
  })

  /* ---------------- experience ---------------- */

  app.get('/api/experience/timeline', async (request, reply) => {
    const query = request.query as { environmentId?: string; agentId?: string }
    const parsed = TimelineQuerySchema.safeParse(query)
    if (!parsed.success) return reply.code(400).send({ error: '缺少 environmentId 或 agentId 查询参数' })
    const docs = repos.listExperienceIndex(db, { environmentId: parsed.data.environmentId, agentId: parsed.data.agentId })
    return {
      timeline: docs.map((d) => ({
        ts: d.createdAt,
        matchId: d.matchId,
        environmentId: d.environmentId,
        agentId: d.agentId,
        kind: d.kind,
        changesSummary: d.summary,
      })),
    }
  })

  app.get('/api/experience', async (request) => {
    const query = request.query as { environmentId?: string; agentId?: string }
    return {
      docs: repos.listExperienceIndex(db, { environmentId: query.environmentId, agentId: query.agentId }),
    }
  })

  app.get('/api/experience/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const record = repos.getExperienceRecord(db, id)
    if (!record) return notFound(reply, '经验文档')
    const content = await experienceStore.readContent({
      id: record.id,
      environmentId: record.environmentId,
      agentId: record.agentId,
      kind: record.kind,
      path: record.path,
      summary: record.summary,
      matchId: record.matchId,
      round: record.round,
      ts: record.ts,
    })
    return {
      meta: {
        id: record.id,
        environmentId: record.environmentId,
        agentId: record.agentId,
        kind: record.kind,
        path: record.path,
        summary: record.summary,
        matchId: record.matchId,
        round: record.round,
        createdAt: record.ts,
      },
      content,
    }
  })

  // 导出（9.5）：Markdown 文件下载
  app.get('/api/experience/:id/export', async (request, reply) => {
    const { id } = request.params as { id: string }
    const record = repos.getExperienceRecord(db, id)
    if (!record) return notFound(reply, '经验文档')
    const content = await experienceStore.readContent({
      id: record.id,
      environmentId: record.environmentId,
      agentId: record.agentId,
      kind: record.kind,
      path: record.path,
      summary: record.summary,
      matchId: record.matchId,
      round: record.round,
      ts: record.ts,
    })
    reply
      .header('content-type', 'text/markdown; charset=utf-8')
      .header('content-disposition', `attachment; filename="${record.kind}-${record.agentId}.md"`)
      .send(content)
  })

  return app
}

function resolveBindings(db: Db, bindings: Array<{ agentId: string; modelConfigId: string }>): AgentBinding[] {
  return bindings.map((b) => {
    const modelConfig = repos.getFullModelConfig(db, b.modelConfigId)
    if (!modelConfig) throw new Error(`模型配置不存在：${b.modelConfigId}`)
    return { agentId: b.agentId, modelConfig }
  })
}

export async function closeApp(app: FastifyInstance): Promise<void> {
  const db = (app as unknown as { arlaf: { db: Db } }).arlaf.db
  await app.close()
  closeDb(db)
}
