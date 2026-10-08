# Design / 技术设计

> 语言说明：本产出物为中英双语，以中文为主，保留英文技术术语。

## Context / 背景

绿地项目，当前仓库无任何业务代码。动机见 proposal.md 的 Why；行为契约见 5 份 spec delta。已确认约束：全栈 Node.js + TypeScript；Web 控制台 React + Vite；LLM 访问走用户自配的 OpenAI 兼容 API；训练产物（skills/docs）需长期保存且人类可读。

关键负载特征：整个系统是 **I/O 密集**的（等待 LLM 响应占绝对大头），无 CPU 密集计算，单机单进程即可承载 MVP 的并发规模。

## Goals / Non-Goals

**Goals / 目标：**

- 分层清晰的单体架构：引擎核心（纯库）与 API 服务（进程入口）解耦，引擎可独立测试与复用
- 环境配置、事件协议、数据模型在前后端间共享单一类型来源（single source of truth）
- 隔离在框架层强制（上下文由框架构造，而非信任提示词自觉），并有审计记录
- 全链路可观测：结构化事件流实时可见、可回放；经验产物 Markdown 落盘
- 中文优先的界面与开发者体验

**Non-Goals / 非目标：**

- 容器/VM 级代码执行沙箱（MVP 隔离仅覆盖信息流与文件访问层）
- 分布式多机调度、对局横向扩容
- 数值 RL（梯度训练）、Elo 等级分（MVP 用胜率统计，接口预留扩展）
- 多用户账号体系与权限（MVP 单用户本地部署）

## Decisions / 决策

### D1. 全栈 TypeScript monorepo，pnpm workspaces

包结构：

```
apps/
  server/        # Fastify API 服务（进程入口，编排引擎）
  web/           # React + Vite 控制台
packages/
  engine/        # 对局引擎核心库（无 HTTP 依赖，可独立测试）
  shared/        # Zod schema：环境配置、事件协议、DTO（前后端共用）
```

**备选**：Rust 引擎（已被否决——负载 I/O 密集，跨语言边界（FFI/IPC）带来的复杂度远超收益）；单包应用（否决——引擎库需要独立单测与未来复用，边界值得付出）。

### D2. 引擎为事件驱动的纯库（packages/engine）

引擎对外只暴露两个入口：`createMatch(envConfig, agentBindings)` 与异步事件流（AsyncIterable）。回合循环：按环境定义的 turn policy 将每轮无依赖的 Agent 行动作为一批并发调度（`Promise.all`），有依赖（如「辨别者需等待写作者作品」）的按交换物协议的投递点分批。AI 裁判与经验总结都是特殊的「行动阶段」，复用同一调度器。

**备选**：引擎内嵌 HTTP 服务（否决——生命周期管理与测试都更重）；全顺序执行（否决——spec 要求无依赖行动可并发，且混战场景顺序执行延迟明显）。

### D3. LLM Provider：OpenAI 兼容协议为唯一 MVP 协议

自封装轻量 client（fetch + JSON，非流式为主）：`baseUrl + apiKey + model + params`，覆盖 OpenAI/DeepSeek/Qwen/Ollama/vLLM 等几乎全部主流服务。内置超时、指数退避重试（可配置次数）、429 限流退避。裁判与经验总结使用 JSON 结构化输出（response_format 或提示词约束 + Zod 校验 + 失败重问，上限 2 次）。

**备选**：Vercel AI SDK（否决——额外抽象层，MVP 一个协议即可覆盖；接口上预留 adapter 扩展位）；各服务原生 SDK（否决——多套依赖，收益低）。

### D4. 隔离模型：框架构造上下文 + 受控工具访问

- 每个 Agent 每局分配独立工作区目录：`data/matches/<matchId>/workspaces/<agentId>/`，按环境模板初始化
- Agent 的输入上下文完全由框架拼装（角色提示 + 注入的经验 + 按协议投递的交换物），**不存在**「Agent 自己决定看什么」的通道
- 若环境定义了文件类工具（读/写自己工作区），通过受控接口执行：越界路径（含对手工作区）一律拒绝并记审计事件
- 交换物投递 = 框架把 A 的产出写入事件流并注入 B 的下一轮上下文；全部投递与拒绝均入审计记录

### D5. 持久化：SQLite（better-sqlite3，WAL 模式）+ 经验 Markdown 落盘

- DB 存结构化数据：环境、模型配置（密钥仅存服务端）、对局与事件（JSON 列）、胜负统计
- 经验产物（MEMORY/SKILLS）以 Markdown 文件存 `data/experience/<envId>/<agentId>/`，DB 建索引（供查询、时间线、导出）；人类可直接阅读，符合「训练结果 = skills/docs」的定位
- 单文件库、零部署负担；WAL 模式规避读写互斥

**备选**：Postgres（否决——MVP 单机场景部署过重，ORM 层保留迁移可能）；纯文件无 DB（否决——事件流查询与统计需要索引）。

### D6. API：Fastify + WebSocket，OpenAPI 驱动前后端契约

REST：`/api/environments`、`/api/models`、`/api/matches`、`/api/experience`；WS：`/api/ws/matches/:id` 推送引擎事件流。`@fastify/swagger` 生成 OpenAPI 文档，前端用 `openapi-typescript` 生成类型化 client。密钥接口一律脱敏（响应仅返回尾 4 位）。

### D7. 前端：React 18 + Vite + Ant Design 5

状态与数据：TanStack Query（服务端状态）+ Zustand（局部 UI 状态）。AntD 提供成熟的中文生态、表单/表格/布局组件，契合「美观、表单密集的环境构建器」诉求。页面：环境列表/构建器、模型管理、对局实时视图、对局历史、经验库。

**备选**：shadcn/ui + Tailwind（否决——组装成本高，MVP 阶段 AntD 开箱即用性更好）。

### D8. 工程基线

Node.js 22 LTS、TypeScript strict + ESM、ESLint + Prettier、vitest（engine 单测 + server 集成测试，LLM 调用以 mock provider 注入）。对局执行器并发数默认上限 4（可配置），防止单进程被大量并发 LLM 请求拖垮。

## Risks / Trade-offs / 风险与权衡

- [经验无限膨胀撑爆上下文] → 注入走 token 预算：SKILLS 全量但每条限长 + 近期 MEMORY 优先滑动窗口；后续可加「技能精炼/合并」任务
- [LLM 输出不稳定导致裁判/总结解析失败] → Zod 校验 + 限定重试（2 次）+ 失败显式入事件流，绝不静默丢弃
- [Agent 对抗性提示注入（套取对手信息、操纵裁判）] → 上下文由框架构造 + 工具越权拒绝 + 审计三重防线；提示词只作补充防线
- [长对局前端断线丢实时视图] → 事件持久化，WS 重连后按序号补发缺口事件
- [SQLite 单写者瓶颈] → MVP 并发规模内无碍；写入集中在事件批量插入，WAL 缓解；规模超出时迁移 Postgres（ORM 层已隔离方言）
- [同模型自对抗的经验同质化] → 阵营视角独立总结 + 各自独立经验库；效果问题留待实测调优（open question）

## Migration Plan / 迁移

绿地无需迁移。落地顺序见 tasks.md：脚手架 → shared schema → engine（含 mock provider 测试）→ server → web → 内置示例环境端到端打通。回滚即删除新增代码，无数据兼容问题。

## Open Questions / 待定问题

- 胜率之外是否引入 Elo 等级分？不影响 MVP 行为（spec 只要求胜率），留待首个环境实测后决定
- 「AI 味对抗」的辨别者判定形式（直接二分类 or 附置信度）？实现期定，不改 spec 结构化判定契约
- 经验文档的中英文语言（跟随模型输出）？非契约问题，实测后统一默认值
