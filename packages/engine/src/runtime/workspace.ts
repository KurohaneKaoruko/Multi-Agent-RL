import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { WorkspaceTemplate } from '@marl/shared'

/** 越权访问错误（Agent 视角收到的是提示文案，事件层记录详情） */
export class WorkspaceAccessError extends Error {
  constructor(
    readonly agentId: string,
    readonly relPath: string,
    readonly operation: 'read' | 'write',
  ) {
    super(`越权访问被拒绝：不允许${operation === 'read' ? '读取' : '写入'}自身工作区之外的路径 "${relPath}"`)
    this.name = 'WorkspaceAccessError'
  }
}

/**
 * 单个 Agent 的独立工作区（6.1）与受控文件访问（6.3）。
 * 一切路径解析限制在自身工作区内；越界操作抛 WorkspaceAccessError 并触发审计回调。
 */
export class WorkspaceController {
  private constructor(
    readonly agentId: string,
    readonly rootDir: string,
    readonly shared: boolean,
    private readonly onDenied: (operation: 'read' | 'write', relPath: string) => void,
  ) {}

  static async allocate(
    matchWorkspaceBaseDir: string,
    agentId: string,
    template: WorkspaceTemplate,
    onDenied: (operation: 'read' | 'write', relPath: string) => void,
    options: { shared?: boolean; seedFromDir?: string } = {},
  ): Promise<WorkspaceController> {
    // resolve 为绝对路径：调用方可能传入相对 dataDir（如 './data'）
    const rootDir = path.resolve(matchWorkspaceBaseDir, agentId)
    await mkdir(rootDir, { recursive: true })
    const ws = new WorkspaceController(agentId, rootDir, options.shared ?? false, onDenied)
    // 种子目录：把持久化工作区内容复制进本场工作区（用户编辑过的文件对智能体可见）
    if (options.seedFromDir) {
      const seed = await WorkspaceController.openExisting(options.seedFromDir, agentId)
      await seed.copyTo(rootDir)
    }
    for (const file of template.files) {
      const abs = ws.resolveSafe(file.path)
      if (abs == null) {
        throw new Error(`环境工作区模板路径越界："${file.path}"（模板必须位于工作区内）`)
      }
      await mkdir(path.dirname(abs), { recursive: true })
      await writeFile(abs, file.content, 'utf8')
    }
    return ws
  }

  /** 相对路径 → 工作区内绝对路径；越界返回 null */
  resolveSafe(relPath: string): string | null {
    const abs = path.resolve(this.rootDir, relPath)
    if (abs === this.rootDir || abs.startsWith(this.rootDir + path.sep)) return abs
    return null
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const abs = this.resolveSafe(relPath)
    if (abs == null) {
      this.onDenied('write', relPath)
      throw new WorkspaceAccessError(this.agentId, relPath, 'write')
    }
    await mkdir(path.dirname(abs), { recursive: true })
    await writeFile(abs, content, 'utf8')
  }

  async readFile(relPath: string): Promise<string> {
    const abs = this.resolveSafe(relPath)
    if (abs == null) {
      this.onDenied('read', relPath)
      throw new WorkspaceAccessError(this.agentId, relPath, 'read')
    }
    return readFile(abs, 'utf8')
  }

  /** 打开已存在（或即将创建）的工作区目录，不写入模板——服务端工作区管理复用 */
  static async openExisting(
    rootDir: string,
    agentId: string,
    onDenied: (operation: 'read' | 'write', relPath: string) => void = () => {},
  ): Promise<WorkspaceController> {
    const root = path.resolve(rootDir)
    await mkdir(root, { recursive: true })
    return new WorkspaceController(agentId, root, false, onDenied)
  }

  /** 递归列出工作区内全部文件（相对路径，按名称排序） */
  async listFiles(): Promise<string[]> {
    const out: string[] = []
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) await walk(abs)
        else out.push(path.relative(this.rootDir, abs).split(path.sep).join('/'))
      }
    }
    await walk(this.rootDir)
    return out.sort()
  }

  /** 递归复制工作区内容到目标目录（目标自动创建；同名覆盖） */
  async copyTo(destDir: string): Promise<void> {
    const copy = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) await copy(abs)
        else {
          const rel = path.relative(dir, abs)
          const dest = path.join(destDir, rel)
          await mkdir(path.dirname(dest), { recursive: true })
          await writeFile(dest, await readFile(abs))
        }
      }
    }
    await mkdir(destDir, { recursive: true })
    await copy(this.rootDir)
  }

  /** 注入角色上下文的工作区说明（框架构造，见设计 D4） */
  hint(): string {
    if (this.shared) {
      return '你所在的团队共享一个协作工作区：你可以用文件工具读写其中的文件（如 notes/、SKILLS.md 等），所有成员都能看到这些文件。请主动把对协作有价值的产出写入工作区。'
    }
    return '你拥有一个仅属于你的独立工作区（相对路径 ./workspace）：可用文件工具读写其中的文件（如 SKILLS.md、MEMORY.md、笔记等）。对其他 Agent 工作区的任何访问都会被拒绝并记录；你收到的对手信息仅限框架按协议投递给你的内容。'
  }
}
