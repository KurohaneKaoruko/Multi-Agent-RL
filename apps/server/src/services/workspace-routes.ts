import type { FastifyInstance } from 'fastify'
import archiver from 'archiver'
import { mkdir, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { WorkspaceController, WorkspaceAccessError } from '@marl/engine'

/**
 * 智能体持久化工作区管理（用户可查看/修改/导入/导出）。
 * 目录：data/workspaces/<envId>/<agentId|_shared>/（对下一场对局生效）。
 */

export function workspaceRoot(dataDir: string, envId: string, agentId: string): string {
  // 防目录穿越：envId / agentId 仅允许安全字符
  if (!/^[\w.-]+$/.test(envId) || !/^[\w.-]+$/.test(agentId)) {
    throw new Error('非法的环境或智能体标识')
  }
  return path.resolve(dataDir, 'workspaces', envId, agentId)
}

function open(root: string): Promise<WorkspaceController> {
  return WorkspaceController.openExisting(root, path.basename(root))
}

interface FileEntry {
  path: string
  size: number
}

async function listRecursive(root: string): Promise<FileEntry[]> {
  const out: FileEntry[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(abs)
      else {
        const info = await stat(abs)
        out.push({ path: path.relative(root, abs).split(path.sep).join('/'), size: info.size })
      }
    }
  }
  await walk(root)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

const SaveFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
})
const ImportSchema = z.object({
  files: z
    .array(z.object({ path: z.string().min(1), content: z.string() }))
    .min(1)
    .max(200),
})

export function registerWorkspaceRoutes(app: FastifyInstance, dataDir: string): void {
  const fileErrors = (err: unknown): { code: number; message: string; fields?: Array<{ path: string; message: string }> } => {
    if (err instanceof WorkspaceAccessError) return { code: 400, message: err.message }
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('ENOENT')) return { code: 404, message: '文件或路径不存在' }
    return { code: 400, message }
  }

  // 文件列表
  app.get('/api/workspaces/:envId/:agentId/files', async (request, reply) => {
    const { envId, agentId } = request.params as { envId: string; agentId: string }
    try {
      const root = workspaceRoot(dataDir, envId, agentId)
      const files: FileEntry[] = await listRecursive(root)
      return { files }
    } catch (err) {
      const e = fileErrors(err)
      return reply.code(e.code).send({ error: e.message })
    }
  })

  // 读取单个文件
  app.get('/api/workspaces/:envId/:agentId/file', async (request, reply) => {
    const { envId, agentId } = request.params as { envId: string; agentId: string }
    const query = request.query as { path?: string }
    if (!query.path) return reply.code(400).send({ error: '缺少 path 查询参数' })
    try {
      const root = workspaceRoot(dataDir, envId, agentId)
      const ws = await open(root)
      const content = await ws.readFile(query.path)
      return { path: query.path, content }
    } catch (err) {
      const e = fileErrors(err)
      return reply.code(e.code).send({ error: e.message })
    }
  })

  // 保存（写入/覆盖）文件
  app.put(
    '/api/workspaces/:envId/:agentId/file',
    { schema: { body: { type: 'object' } } },
    async (request, reply) => {
      const { envId, agentId } = request.params as { envId: string; agentId: string }
      const parsed = SaveFileSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: '请求参数校验失败' })
      try {
        const root = workspaceRoot(dataDir, envId, agentId)
        const ws = await open(root)
        await ws.writeFile(parsed.data.path, parsed.data.content)
        return { ok: true }
      } catch (err) {
        const e = fileErrors(err)
        return reply.code(e.code).send({ error: e.message })
      }
    },
  )

  // 导入：批量写入文件（覆盖同名）
  app.post(
    '/api/workspaces/:envId/:agentId/import',
    { schema: { body: { type: 'object' } } },
    async (request, reply) => {
      const { envId, agentId } = request.params as { envId: string; agentId: string }
      const parsed = ImportSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: '请求参数校验失败' })
      try {
        const root = workspaceRoot(dataDir, envId, agentId)
        const ws = await open(root)
        let imported = 0
        for (const file of parsed.data.files) {
          await ws.writeFile(file.path, file.content)
          imported++
        }
        return { ok: true, imported }
      } catch (err) {
        const e = fileErrors(err)
        return reply.code(e.code).send({ error: e.message })
      }
    },
  )

  // 导出：zip 下载整个工作区
  app.get('/api/workspaces/:envId/:agentId/export', async (request, reply) => {
    const { envId, agentId } = request.params as { envId: string; agentId: string }
    let root: string
    try {
      root = workspaceRoot(dataDir, envId, agentId)
      await mkdir(root, { recursive: true })
    } catch (err) {
      const e = fileErrors(err)
      return reply.code(e.code).send({ error: e.message })
    }
    reply.header('content-type', 'application/zip')
    reply.header('content-disposition', `attachment; filename="workspace-${agentId}.zip"`)
    const archive = archiver('zip', { zlib: { level: 9 } })
    archive.directory(root, false)
    archive.finalize()
    void request
    return reply.send(archive)
  })
}
