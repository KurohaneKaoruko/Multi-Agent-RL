// ARLAF Web API client：以 @marl/shared 的 DTO 为单一类型来源（前后端同源类型）。
// OpenAPI 产物（src/api/schema.d.ts，由 `pnpm gen:api` 生成）作为接口契约快照保留。
import type {
  EnvironmentConfig,
  EnvironmentView,
  ExperienceDocDetail,
  ExperienceDocMeta,
  FieldError,
  MatchDetail,
  MatchEventsResponse,
  MatchSummary,
  ModelConfigInput,
  ModelConfigView,
  WinStatEntry,
  EvolutionTimelineEntry,
} from '@marl/shared'

export type { FieldError as FieldErrorDto }

/** 统一错误：携带中文 message 与字段级 errors */
export class ApiError extends Error {
  readonly fields?: FieldError[]
  constructor(message: string, fields?: FieldError[]) {
    super(message)
    this.name = 'ApiError'
    this.fields = fields
  }
}

async function http<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const hasBody = init?.body != null
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? 'GET',
    headers: hasBody ? { 'content-type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(init.body) : undefined,
  })
  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : null
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; fields?: FieldError[] }
    throw new ApiError(err.error ?? `请求失败（HTTP ${res.status}）`, err.fields)
  }
  return data as T
}

export interface TemplateInfo {
  templateId: string
  name: string
  description: string
  paradigm: 'adversarial' | 'cooperative'
}

export const api = {
  environments: {
    list: () => http<{ environments: EnvironmentView[] }>('/environments'),
    get: (id: string) => http<EnvironmentView>(`/environments/${id}`),
    create: (config: unknown) => http<EnvironmentView>('/environments', { method: 'POST', body: config }),
    createFromTemplate: (input: { templateId: string; id?: string; name?: string }) =>
      http<EnvironmentView>('/environments/from-template', { method: 'POST', body: input }),
    update: (id: string, config: unknown) => http<EnvironmentView>(`/environments/${id}`, { method: 'PUT', body: config }),
    remove: (id: string) => http<{ ok: boolean }>(`/environments/${id}`, { method: 'DELETE' }),
    validate: (id: string, bindings: Array<{ agentId: string; modelConfigId: string }>) =>
      http<{ ok: boolean; fields: FieldError[] }>(`/environments/${id}/validate`, { method: 'POST', body: { bindings } }),
    templates: () => http<{ templates: TemplateInfo[] }>('/templates'),
    generateDraft: (input: { idea: string; modelConfigId: string }) =>
      http<{ draft: EnvironmentConfig }>('/environments/generate-draft', { method: 'POST', body: input }),
  },
  models: {
    list: () => http<{ models: ModelConfigView[] }>('/models'),
    create: (input: ModelConfigInput) => http<ModelConfigView>('/models', { method: 'POST', body: input }),
    update: (id: string, input: ModelConfigInput) => http<ModelConfigView>(`/models/${id}`, { method: 'PUT', body: input }),
    remove: (id: string) => http<{ ok: boolean }>(`/models/${id}`, { method: 'DELETE' }),
    test: (id: string) => http<{ ok: boolean; message: string }>(`/models/${id}/test`, { method: 'POST' }),
  },
  matches: {
    list: () => http<{ matches: MatchSummary[] }>('/matches'),
    create: (input: { environmentId: string; bindings: Array<{ agentId: string; modelConfigId: string }> }) =>
      http<{ id: string; status: string }>('/matches', { method: 'POST', body: input }),
    start: (id: string) => http<{ id: string; status: string }>(`/matches/${id}/start`, { method: 'POST' }),
    get: (id: string) => http<MatchDetail>(`/matches/${id}`),
    events: (id: string, since = 0) => http<MatchEventsResponse>(`/matches/${id}/events?since=${since}`),
  },
  stats: (environmentId: string) => http<{ stats: WinStatEntry[] }>(`/stats?environmentId=${environmentId}`),
  experience: {
    list: (query: { environmentId?: string; agentId?: string }) => {
      const params = new URLSearchParams()
      if (query.environmentId) params.set('environmentId', query.environmentId)
      if (query.agentId) params.set('agentId', query.agentId)
      return http<{ docs: ExperienceDocMeta[] }>(`/experience?${params.toString()}`)
    },
    timeline: (environmentId: string, agentId: string) =>
      http<{ timeline: EvolutionTimelineEntry[] }>(
        `/experience/timeline?environmentId=${environmentId}&agentId=${agentId}`,
      ),
    get: (id: string) => http<ExperienceDocDetail>(`/experience/${id}`),
    /** 导出：直接以浏览器下载（走 GET /api/experience/:id/export） */
    exportUrl: (id: string) => `/api/experience/${id}/export`,
  },
}

export type { EnvironmentConfig, EnvironmentView, ExperienceDocDetail, ExperienceDocMeta, MatchDetail, MatchSummary, ModelConfigView, WinStatEntry, EvolutionTimelineEntry }
