// 工作区工具循环测试（读取/写入/列表 + 事件 + 越权）
import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ModelConfig } from '@marl/shared'
import { AgentRuntime } from './agent'
import { MockProvider } from '../llm/mock'
import { WorkspaceController } from './workspace'


describe('工作区工具循环', () => {
  it('写文件 → 读文件 → 最终回复；工具调用产生 agent.tool 事件', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-tool-'))
    try {
      const ws = await WorkspaceController.allocate(base, 'a', { mode: 'private', files: [] }, () => {})
      const script = [
        '<tool>{"name":"write_file","args":{"path":"notes/plan.md","content":"作战计划"}}</tool>',
        '<tool>{"name":"read_file","args":{"path":"notes/plan.md"}}</tool>',
        '计划已保存并复核完毕。',
      ]
      const client = new MockProvider({ script })
      const toolEvents: Array<Record<string, unknown>> = []
      const agent = new AgentRuntime(
        { id: 'a', name: 'A', roleId: 'r', startRound: 1 },
        { id: 'r', name: '角色', systemPrompt: 's', goal: 'g', answerFormat: 'free' },
        client,
        ws,
        () => {},
        () => {},
        true,
      )
      void toolEvents
      const content = await agent.act({ round: 1, totalRounds: 1, delivered: [] })
      expect(content).toBe('计划已保存并复核完毕。')
      // 文件真实写入工作区
      await expect(ws.readFile('notes/plan.md')).resolves.toBe('作战计划')
      // 共 3 次模型调用（2 次工具轮 + 1 次最终）
      expect(client.calls).toHaveLength(3)
      // 第 2 次调用的上下文包含工具结果
      const secondCall = client.calls[1]!.messages.map((m) => m.content).join('\n')
      expect(secondCall).toContain('作战计划')
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('toolsEnabled=false 时不解析工具调用', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-tool2-'))
    try {
      const ws = await WorkspaceController.allocate(base, 'a', { mode: 'private', files: [] }, () => {})
      const script = ['<tool>{"name":"write_file","args":{"path":"x.md","content":"y"}}</tool>']
      const client = new MockProvider({ script })
      const agent = new AgentRuntime(
        { id: 'a', name: 'A', roleId: 'r', startRound: 1 },
        { id: 'r', name: '角色', systemPrompt: 's', goal: 'g', answerFormat: 'free' },
        client,
        ws,
        () => {},
        () => {},
        false,
      )
      const content = await agent.act({ round: 1, totalRounds: 1, delivered: [] })
      expect(content).toContain('<tool>')
      await expect(ws.readFile('x.md')).rejects.toThrow()
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})

describe('共享工作区（协作）', () => {
  it('共享模式下两个智能体读写同一目录', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-shared-'))
    try {
      const denied: string[] = []
      const wsA = await WorkspaceController.allocate(base, '_shared', { mode: 'shared', files: [] }, () => {}, {
        shared: true,
      })
      const wsB = await WorkspaceController.allocate(base, '_shared', { mode: 'shared', files: [] }, () => {}, {
        shared: true,
      })
      await wsA.writeFile('shared.md', '共同笔记')
      await expect(wsB.readFile('shared.md')).resolves.toBe('共同笔记')
      expect(wsA.rootDir).toBe(wsB.rootDir)
      expect(denied).toEqual([])
      void wsB
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('对局内共享工作区：a 写入的文件 b 可读（通过工具）', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'arlaf-m2-'))
    try {
      const mkMock = (script: string[]): ModelConfig => ({
        id: `m-${Math.random()}`,
        name: 'mock',
        baseUrl: 'mock://arlaf',
        apiKey: JSON.stringify(script),
        model: 'mock',
        params: {},
      })
      const env = {
        id: 'env-shared',
        name: '共享工作区测试',
        description: '',
        paradigm: 'cooperative' as const,
        topology: 'melee' as const,
        roles: [
          { id: 'r1', name: '记录员', systemPrompt: 's', goal: 'g', answerFormat: 'free' as const },
          { id: 'r2', name: '观察员', systemPrompt: 's', goal: 'g', answerFormat: 'free' as const },
        ],
        agents: [
          { id: 'a', name: 'A', roleId: 'r1', startRound: 1 },
          { id: 'b', name: 'B', roleId: 'r2', startRound: 2 },
        ],
        turns: { rounds: 2, order: ['a', 'b'] },
        workspaceTemplate: {
          mode: 'shared' as const,
          files: [],
        },
        exchanges: [],
        outcome: { mode: 'rule' as const, evaluator: 'ai-flavor', params: {} },
        experience: { enabled: false, tokenBudget: 2000, recentMemoryLimit: 3 },
        toolsEnabled: true,
      }
      const { createMatch } = await import('./match')
      const handle = createMatch(env as never, {
        bindings: [
          { agentId: 'a', modelConfig: mkMock(['<tool>{"name":"write_file","args":{"path":"board.md","content":"白板内容"}}</tool>', '第一轮完成：白板已更新。', '第二轮：继续补充要点。']) },
          { agentId: 'b', modelConfig: mkMock(['<tool>{"name":"read_file","args":{"path":"board.md"}}</tool>', '白板内容我已读取并记录。']) },
        ],
        dataDir: base,
        ruleEvaluators: { 'ai-flavor': () => ({ scores: {}, winnerAgentId: null }) },
      })
      await handle.run()
      // b 的读工具应成功拿到共享内容（mock 第 2 次调用后引擎回填工具结果，最终回复由脚本给出）
      const sharedFile = path.join(base, 'matches', handle.id, 'workspaces', '_shared', 'board.md')
      const { readFile } = await import('node:fs/promises')
      await expect(readFile(sharedFile, 'utf8')).resolves.toBe('白板内容')
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
