import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { MatchEventEnvelope, ModelConfig } from '@arlaf/shared'
import { WorkspaceController, WorkspaceAccessError } from './workspace'
import { AgentRuntime } from './agent'
import { MockProvider } from '../llm/mock'
import { createMatch } from './match'

function mockBinding(agentId: string, script: unknown[]): { agentId: string; modelConfig: ModelConfig } {
  return {
    agentId,
    modelConfig: {
      id: `m-${agentId}`,
      name: agentId,
      baseUrl: 'mock://arlaf',
      apiKey: JSON.stringify(script),
      model: 'mock',
      params: {},
    },
  }
}

function env1v1(deliverAtRound = 1) {
  return {
    id: 'env-iso',
    name: '隔离测试',
    description: '',
    topology: 'asymmetric' as const,
    roles: [
      { id: 'writer', name: '写作者', systemPrompt: 's', goal: 'g', answerFormat: 'free' as const },
      { id: 'detector', name: '辨别者', systemPrompt: 's', goal: 'g', answerFormat: 'free' as const },
    ],
    agents: [
      { id: 'a', name: 'A', roleId: 'writer', startRound: 1 },
      { id: 'b', name: 'B', roleId: 'detector', startRound: 1 },
    ],
    turns: { rounds: 2, order: ['a', 'b'] },
    workspaceTemplate: { files: [{ path: 'brief.md', content: '任务说明' }] },
    exchanges: [{ id: 'ex1', artifact: 'manuscript', fromAgentId: 'a', toAgentId: 'b', deliverAtRound }],
    outcome: { mode: 'rule' as const, evaluator: 'fixed', params: {} },
    experience: { enabled: false, tokenBudget: 2000, recentMemoryLimit: 3 },
  }
}

describe('工作区分配（6.1）', () => {
  it('每 Agent 独立目录且模板文件就位', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-ws-'))
    try {
      const wsA = await WorkspaceController.allocate(
        base,
        'a',
        { files: [{ path: 'brief.md', content: '任务说明' }] },
        () => {},
      )
      const wsB = await WorkspaceController.allocate(base, 'b', { files: [] }, () => {})
      expect(wsA.rootDir).not.toBe(wsB.rootDir)
      await expect(wsA.readFile('brief.md')).resolves.toBe('任务说明')
      // b 的工作区无此文件 → 物理隔离
      await expect(wsB.readFile('brief.md')).rejects.toThrow()
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('相对路径的 baseDir 也能正确解析（服务端 ./data 场景）', async () => {
    const base = './.tmp-arlaf-ws-rel'
    try {
      const denied: string[] = []
      const ws = await WorkspaceController.allocate(base, 'a', { files: [{ path: 'README.md', content: 'x' }] }, () => {
        denied.push('x')
      })
      expect(path.isAbsolute(ws.rootDir)).toBe(true)
      await expect(ws.readFile('README.md')).resolves.toBe('x')
      expect(denied).toEqual([])
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})

describe('受控文件工具与审计（6.3）', () => {
  it('自身工作区读写放行，越界路径拒绝并触发审计回调', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-ws2-'))
    try {
      const denied: Array<{ op: string; path: string }> = []
      const ws = await WorkspaceController.allocate(base, 'a', { files: [] }, (op, p) => denied.push({ op, path: p }))
      await ws.writeFile('notes/a.md', '内容')
      await expect(ws.readFile('notes/a.md')).resolves.toBe('内容')
      // 路径逃逸（对手工作区/系统目录）
      await expect(ws.readFile('../b/secret.txt')).rejects.toBeInstanceOf(WorkspaceAccessError)
      await expect(ws.writeFile('../../etc/evil', 'x')).rejects.toBeInstanceOf(WorkspaceAccessError)
      expect(denied).toEqual([
        { op: 'read', path: '../b/secret.txt' },
        { op: 'write', path: '../../etc/evil' },
      ])
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('正常对局无越权事件，且工作区目录按 agentId 分离', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-m-'))
    try {
      const handle = createMatch(env1v1(), {
        bindings: [mockBinding('a', ['A1', 'A2']), mockBinding('b', ['B1', 'B2'])],
        dataDir: base,
        ruleEvaluators: { fixed: () => ({ scores: { a: 1, b: 0 }, winnerAgentId: 'a' }) },
      })
      const events: MatchEventEnvelope[] = []
      const draining = (async () => {
        for await (const e of handle.events) events.push(e)
      })()
      await handle.run()
      await draining
      expect(events.some((e) => e.event.type === 'access.denied')).toBe(false)
      for (const id of ['a', 'b']) {
        const dir = path.join(base, 'matches', handle.id, 'workspaces', id)
        const s = await stat(dir)
        expect(s.isDirectory()).toBe(true)
      }
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})

describe('交换物投递（6.2）', () => {
  it('投递事件含摘要、先于目标下一轮行动、内容进入其上下文', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-d-'))
    try {
      const handle = createMatch(env1v1(1), {
        bindings: [mockBinding('a', ['第一轮作品-机密内容XYZ', '第二轮作品']), mockBinding('b', ['B1', 'B2'])],
        dataDir: base,
        ruleEvaluators: { fixed: () => ({ scores: {}, winnerAgentId: null }) },
      })
      const events: MatchEventEnvelope[] = []
      const draining = (async () => {
        for await (const e of handle.events) events.push(e)
      })()
      await handle.run()
      await draining

      const delivered = events.find((e) => e.event.type === 'artifact.delivered')
      expect(delivered).toBeDefined()
      if (delivered?.event.type === 'artifact.delivered') {
        expect(delivered.event.payload.preview).toContain('机密内容XYZ')
        expect(delivered.event.payload.round).toBe(1)
        expect(delivered.event.payload.toAgentId).toBe('b')
      }
      // 投递发生在 b 第 2 轮行动之前
      const deliveredSeq = delivered!.seq
      const bRound2Start = events.find(
        (e) =>
          e.event.type === 'agent.action_started' &&
          (e.event as { payload: { agentId: string; round: number } }).payload.agentId === 'b' &&
          (e.event as { payload: { agentId: string; round: number } }).payload.round === 2,
      )!
      expect(deliveredSeq).toBeLessThan(bRound2Start.seq)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('投递内容注入目标 Agent 的下一轮上下文（MockProvider.calls 断言）', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-c-'))
    try {
    const client = new MockProvider({ script: ['B1', 'B2'] })
      const ws = await WorkspaceController.allocate(base, 'b', { files: [] }, () => {})
      const agent = new AgentRuntime(
        { id: 'b', name: 'B', roleId: 'detector', startRound: 1 },
        { id: 'detector', name: '辨别者', systemPrompt: 's', goal: 'g', answerFormat: 'free' },
        client,
        ws,
        () => {},
        () => {},
      )
      // 第 1 轮：无投递物
      await agent.act({ round: 1, totalRounds: 2, delivered: [] })
      // 第 2 轮：含第 1 轮交付的作品
      await agent.act({
        round: 2,
        totalRounds: 2,
        delivered: [{ artifact: 'manuscript', fromAgentId: 'a', content: '第一轮作品-机密内容XYZ', round: 1 }],
      })
      const first = client.calls[0]!.messages.map((m) => m.content).join('\n')
      const second = client.calls[1]!.messages.map((m) => m.content).join('\n')
      expect(first).not.toContain('机密内容XYZ')
      expect(second).toContain('机密内容XYZ')
      expect(second).toContain('manuscript')
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('act 清洗模型输出的 <think> 推理块（stripThinkTags）', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-think-'))
    try {
      const ws = await WorkspaceController.allocate(base, 'a', { files: [] }, () => {})
      const mkAgent = (script: string[]): AgentRuntime =>
        new AgentRuntime(
          { id: 'a', name: 'A', roleId: 'r', startRound: 1 },
          { id: 'r', name: '角色', systemPrompt: 's', goal: 'g', answerFormat: 'free' },
          new MockProvider({ script }),
          ws,
          () => {},
          () => {},
        )
      const content = await mkAgent(['<think>先想想怎么写。</think>这是正文内容。']).act({
        round: 1,
        totalRounds: 1,
        delivered: [],
      })
      expect(content).toBe('这是正文内容。')
      const content2 = await mkAgent(['<think>思考到一半没有收尾……']).act({
        round: 1,
        totalRounds: 1,
        delivered: [],
      })
      expect(content2).toBe('')
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
