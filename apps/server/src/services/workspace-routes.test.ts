// 智能体工作区管理 API 测试（查看/编辑/导入/导出）
import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp, closeApp } from '../app'

describe('工作区管理 API', () => {
  it('保存/列表/读取/导入/导出全流程；路径穿越被拒', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'arlaf-wsapi-'))
    const app: FastifyInstance = await buildApp({ dataDir })
    try {
      await app.ready()

      // 保存文件
      const saveRes = await app.inject({
        method: 'PUT',
        url: '/api/workspaces/tpl-ai-flavor/writer-a/file',
        payload: { path: 'notes/plan.md', content: '我的作战计划' },
      })
      expect(saveRes.statusCode).toBe(200)

      // 列表
      const listRes = await app.inject({ method: 'GET', url: '/api/workspaces/tpl-ai-flavor/writer-a/files' })
      expect(listRes.statusCode).toBe(200)
      const { files } = listRes.json() as { files: Array<{ path: string; size: number }> }
      expect(files.map((f) => f.path)).toContain('notes/plan.md')

      // 读取
      const readRes = await app.inject({
        method: 'GET',
        url: '/api/workspaces/tpl-ai-flavor/writer-a/file',
        query: { path: 'notes/plan.md' },
      })
      expect(readRes.json() as { content: string }).toMatchObject({ content: '我的作战计划' })

      // 路径穿越被拒
      const evil = await app.inject({
        method: 'PUT',
        url: '/api/workspaces/tpl-ai-flavor/writer-a/file',
        payload: { path: '../evil.md', content: 'x' },
      })
      expect(evil.statusCode).toBe(400)

      // 非法 agentId 被拒
      const evilId = await app.inject({ method: 'GET', url: '/api/workspaces/env/../secret/files' })
      expect(evilId.statusCode).toBeGreaterThanOrEqual(400)

      // 导入
      const importRes = await app.inject({
        method: 'POST',
        url: '/api/workspaces/tpl-ai-flavor/writer-a/import',
        payload: { files: [{ path: 'imported/a.md', content: '导入A' }, { path: 'imported/b.md', content: '导入B' }] },
      })
      expect(importRes.statusCode).toBe(200)
      const imported = (importRes.json() as { imported: number }).imported
      expect(imported).toBe(2)

      // 导出 zip
      const exportRes = await app.inject({
        method: 'GET',
        url: '/api/workspaces/tpl-ai-flavor/writer-a/export',
      })
      expect(exportRes.headers['content-type']).toContain('application/zip')
      expect(exportRes.rawPayload!.length).toBeGreaterThan(0)

      // 删除环境后…环境与工作区目录无关联校验，此处仅验证不存在文件的 404
      const missing = await app.inject({
        method: 'GET',
        url: '/api/workspaces/tpl-ai-flavor/writer-a/file',
        query: { path: 'nope.md' },
      })
      expect(missing.statusCode).toBe(404)
    } finally {
      await closeApp(app)
      await rm(dataDir, { recursive: true, force: true })
    }
  }, 20000)
})
