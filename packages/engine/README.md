# @arlaf/engine

ARLAF 对局引擎核心库：事件驱动的纯库，无 HTTP 依赖，可独立测试与复用。
行为契约见 `openspec/specs/`（match-engine / workspace-isolation / experience-evolution / adversarial-environments）。

## 核心概念

- **EnvironmentConfig**（`@arlaf/shared`）：声明式对抗环境——角色、拓扑（symmetric/asymmetric/melee）、回合结构、交换物协议、判定方式。
- **MatchHandle**：`createMatch(env, opts)` 返回，含 `id` / `bus`（事件总线）/ `events`（AsyncIterable）/ `run()`。
- **MatchEventBus**：全量事件缓冲 + 单调递增 `seq`；`subscribe()` 实时订阅，`snapshot(sinceSeq)` 回放/补发。
- **AgentRuntime**：框架构造上下文（角色提示 + 经验注入 + 协议投递物），Agent 无自选信息通道（设计 D4）。
- **WorkspaceController**：每 Agent 独立工作区；越界路径一律拒绝并记 `access.denied` 事件。
- **ExperienceStore**：MEMORY/SKILLS 文档的存储抽象；默认 `FileExperienceStore`（Markdown 落盘 + index.json 索引）。

## 快速开始

```ts
import { createMatch, FileExperienceStore } from '@arlaf/engine'
import type { EnvironmentConfig, AgentBinding } from '@arlaf/shared'

const env: EnvironmentConfig = /* 环境配置（经 shared schema 校验） */
const bindings: AgentBinding[] = [
  { agentId: 'writer-a', modelConfig: { id: 'm1', name: 'Demo', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-...', model: 'demo', params: {} } },
  { agentId: 'detector-a', modelConfig: /* 可与上一份相同 → 自对抗 self-play */ },
]

const match = createMatch(env, {
  matchId: 'match_demo',
  bindings,
  dataDir: './data',
  experienceStore: new FileExperienceStore('./data/experience'),
  options: { concurrency: 4 },
})

// 实时消费事件流
for await (const envelope of match.events) {
  console.log(envelope.seq, envelope.event.type, envelope.event.payload)
}

const result = await match.run() // MatchResult：winnerAgentId / scores / rounds
```

## 扩展点

- **规则判定器**：`opts.ruleEvaluators = { myEvaluator: (ctx) => ({scores, winnerAgentId}) }`，与内置 `ai-flavor`（零和互斥判定：写作者被识破则辨别者得分，蒙骗成功则写作者得分）合并。
- **AI 裁判**：`env.outcome.mode = 'judge'` 且绑定 `agentId: 'judge'`；判定为结构化 JSON（重问上限 2 次，异常显式入事件流）。
- **经验存储**：实现 `ExperienceStore` 接口接入任意后端；`injectExperience`（token 预算注入）与 `summarizeExperience`（对局后复盘）均面向该接口。
- **LLM Provider**：`createLLMClient` 按 `baseUrl` 协议分发——`mock:` 走 `MockProvider`（脚本化测试/离线演示），其余走 OpenAI 兼容 client（超时/指数退避/429 退避内置）。

## Mock 协议

`baseUrl: 'mock://arlaf'` 时，`apiKey` 字段携带 JSON 脚本：
`'["回复一", {"failure": {"status": 429, "message": "rate"}}, "回复二"]'`。
脚本按调用顺序消费，耗尽抛出显式错误；`MockProvider.calls` 记录全部请求供测试断言。
