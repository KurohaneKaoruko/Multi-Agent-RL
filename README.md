# Multi-Agent-RL（ARLAF）

多智能体强化学习训练平台：让多个 LLM 智能体在可配置的环境中反复对局，从对局反馈中沉淀经验、迭代进化。核心思想是把「训练信号」交给智能体之间的互动本身——对抗范式以互斥胜负计分（Agent-RLAF），协作范式由 AI 裁判为团队成果评分（Agent-RLCF），演练靶场则以沙盒任务完成度计分。

## 三大范式

| 范式 | paradigm | 计分方式 | 内置模板 |
| --- | --- | --- | --- |
| 对抗（Agent-RLAF） | `adversarial` | 互斥胜负：一方得分即另一方失分（规则判定器或 AI 裁判） | AI 味对抗（写作者 vs 辨别者）、钓鱼攻防（红队 vs 蓝队） |
| 协作（Agent-RLCF） | `cooperative` | 团队评分：AI 裁判对协作成果打 0-100 团队分 | 结对写作工坊（作者 + 编辑 + AI 裁判） |
| 演练靶场（drill） | `drill` | 任务完成度：守卫抵御率、夺旗比例等沙盒指标 | 提示词防护靶场（带 AI 守卫）、CTF 夺旗纯靶场（无 AI） |

三类环境共用同一套声明式配置（`EnvironmentConfig`）：角色、拓扑（symmetric / asymmetric / melee）、回合结构、工具开关、工作区隔离策略与判定方式。

## 架构

pnpm monorepo，全栈 Node.js + TypeScript：

```
apps/
  server/   @marl/server —— Fastify API 服务
            REST（/api/*）+ WebSocket 实时事件流（/api/ws/matches/:id）+
            OpenAPI 文档（/api/docs）+ SQLite（better-sqlite3）持久化
  web/      @marl/web —— React 18 + Vite + Ant Design 控制台
            环境构建器、对局发起与实时回放、经验库、进化时间线
packages/
  engine/   @marl/engine —— 对局引擎核心库（纯库，无 HTTP 依赖）
            事件总线（单调 seq + 回放/订阅）、AgentRuntime、工作区隔离、
            经验注入/复盘、规则判定器 + AI 结构化裁判、LLM Provider（OpenAI 兼容 + Mock）
  shared/   @marl/shared —— 单一类型来源
            Zod schema（EnvironmentConfig / AgentBinding / MatchResult）、
            事件信封、REST/WS DTO，前后端与引擎三方共用
```

数据流：`web → server（REST/WS）→ engine（createMatch）→ 事件流落库 → 经验沉淀（MEMORY/SKILLS Markdown）→ 注入后续对局`。批量连续训练（`episodes ≤ 20`）同批次共享 `batch_id`，前一场经验注入后一场，形成跨对局进化。

## 快速上手

环境要求：Node.js ≥ 22、pnpm。

```bash
pnpm install        # 安装依赖（workspace 全量）

pnpm dev:server     # 启动 API 服务（默认 http://localhost:3000，API 文档 /api/docs）
pnpm dev:web        # 启动 Web 控制台（http://localhost:5173，/api 代理至 3000，含 WS）
```

常用配置（环境变量）：

- `PORT`：API 服务端口（默认 3000）
- `ARLAF_DATA`：数据目录（默认 `./data`，SQLite 库 + 经验库 + 工作区）

首次使用：打开控制台 → 「模型配置」添加一个 OpenAI 兼容模型（测试可用 `baseUrl: mock://arlaf` 的 Mock Provider，无需真实密钥）→ 从内置模板实例化一个环境 → 发起对局，在详情页实时观看事件流与判定结果。

## 开发

```bash
pnpm typecheck      # 全 workspace 类型检查
pnpm test           # vitest 全量测试
pnpm lint           # eslint
pnpm format         # prettier
```

行为契约与规格驱动开发流程见 `openspec/`；引擎行为契约见 `packages/engine/README.md` 与 `openspec/changes/core-framework-foundation/`。
