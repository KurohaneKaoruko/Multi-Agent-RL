# Tasks / 实施任务

> 验证方式已写入各任务描述。engine 层测试一律使用 mock provider（D3），不依赖真实 LLM API。

## 1. 脚手架与工程基线 (Scaffold & Tooling)

- [x] 1.1 创建 pnpm monorepo：`apps/server`、`apps/web`、`packages/engine`、`packages/shared`，配置根 `tsconfig`（strict + ESM）、ESLint、Prettier；验证 `pnpm install` 与 `pnpm -r exec tsc --noEmit` 全绿
- [x] 1.2 配置 vitest workspace（engine/server/shared 各自测试项目）与根脚本；验证示例占位测试 `pnpm test` 可运行

## 2. shared：领域模型与协议 (Domain Schemas & Protocols)

- [x] 2.1 在 `packages/shared` 实现 Zod schema：环境配置（角色、拓扑 symmetric/asymmetric/melee、回合结构、工作区模板、交换物协议、判定方式）、Agent 模型绑定、API 配置；验证 schema 单测覆盖合法/非法用例
- [x] 2.2 定义事件协议类型（回合开始、Agent 行动、投递、越权拒绝、裁判判定、注入记录、对局结束，含单调递增序号）与 DTO（结果摘要、经验索引、进化时间线）；验证单测断言事件类型完备且可 JSON 序列化往返

## 3. engine：模型调用层 (LLM Client)

- [x] 3.1 实现 OpenAI 兼容 client（fetch + baseUrl/apiKey/model/params，超时、指数退避重试、429 限流退避，可配置）与 `MockProvider` 测试替身；验证单测：瞬时错误重试成功、重试耗尽抛出可诊断错误、mock 可脚本化响应
- [x] 3.2 实现结构化输出封装（JSON 约束 + Zod 校验 + 失败重问上限 2 次）；验证单测：合法输出直通、畸形输出触发重问、两次失败后返回显式错误

## 4. engine：对局调度与生命周期 (Match Runner)

- [x] 4.1 实现对局生命周期状态机（创建→运行→完成/失败）与事件流（AsyncIterable + 序号）；验证单测：脚本化 1v1 环境跑完并产出有序事件流
- [x] 4.2 实现回合调度器：按交换物投递点分批、批内无依赖行动并发（`Promise.all`，并发上限可配置）；验证单测：三方混战按序完成且批内并发、并发上限生效
- [x] 4.3 实现结果摘要产出（胜者、各 Agent 评分、每轮日志）与失败路径（保留已完成回合记录与错误诊断）；验证单测：完成与失败两路径的事件与摘要正确
- [x] 4.4 编写 engine README（核心概念、扩展点）；验证文档中示例代码与导出 API 一致

## 5. engine：AI 裁判 (Judge Execution)

- [x] 5.1 实现裁判执行阶段：按环境定义收集裁判输入（双方产出、评分标准），调用模型产出结构化判定并记录事件；验证单测：判定事件含结构化结果
- [x] 5.2 实现裁判异常路径：输出不合规时按 3.2 策略重试，超限判定失败并入事件流；验证单测覆盖两条路径

## 6. engine：工作区隔离 (Workspace Isolation)

- [x] 6.1 实现每局每 Agent 独立工作区分配与环境模板初始化（`workspaces/<agentId>/`）；验证单测：目录隔离与模板文件就位
- [x] 6.2 实现交换物投递机制：按协议在规定回合将产出投递给目标 Agent 并产生投递事件；验证单测：辨别者仅在投递点后收到写作者作品
- [x] 6.3 实现受控文件工具（限自身工作区路径，越界拒绝）与隔离审计记录（投递 + 越权拒绝均入事件流）；验证单测：跨工作区读取被拒且审计事件存在

## 7. engine：经验进化 (Experience Evolution)

- [x] 7.1 实现对局后经验总结阶段：以各 Agent 绑定模型生成 MEMORY/SKILLS 增量（Markdown）；验证单测：mock 下每 Agent 产出结构化文档
- [x] 7.2 实现经验文件落盘与索引记录（`data/experience/<envId>/<agentId>/`）；验证单测：文件按约定路径写入、索引条目正确
- [x] 7.3 实现经验注入：后续对局按 token 预算注入 SKILLS + 近期 MEMORY（滑动窗口）并记录注入事件；验证单测：第二局上下文含首局经验、超预算时按策略裁剪且不超限
- [x] 7.4 实现进化时间线事件（每次总结的变更摘要）供上层查询；验证单测：两局后时间线含两次记录

## 8. server：持久化 (Persistence)

- [x] 8.1 集成 better-sqlite3（WAL）与迁移脚本，建表：environments、model_configs（密钥仅存库）、matches、match_events、experience_index、win_stats；验证：迁移脚本在临时库上执行成功且表结构符合设计
- [x] 8.2 实现事件批量写入与查询（按对局、按序号区间）；验证集成测试：写入回放一致、区间查询正确

## 9. server：REST API (HTTP API)

- [x] 9.1 Fastify 应用骨架 + `@fastify/swagger`（OpenAPI 文档输出）；验证：`/api/docs` 可访问且 schema 与 shared DTO 一致
- [x] 9.2 环境 CRUD + 对局前校验接口（复用 shared Zod 校验，错误信息中文定位到字段）；验证集成测试：非法配置返回字段级中文错误
- [x] 9.3 模型配置 CRUD + 连通性测试接口，密钥脱敏（响应仅尾 4 位）；验证集成测试：新增/测试/脱敏三条路径
- [x] 9.4 对局生命周期接口（创建/启动/查询/列表）与胜率统计接口；验证集成测试：mock 对局从创建到结果查询全流程
- [x] 9.5 经验查询接口（按环境/Agent 列文档、时间线、导出 Markdown）；验证集成测试：索引查询与导出内容一致

## 10. server：WebSocket 实时事件流 (Realtime Stream)

- [x] 10.1 实现 `/api/ws/matches/:id`：引擎事件实时推送 + 断线重连按序号补发；验证集成测试：订阅收到全部事件、模拟断线重连后补齐缺口

## 11. 内置示例环境 (Built-in Template)

- [x] 11.1 实现「AI 味对抗」内置模板（Writer/Detector 角色、回合结构、辨别准确率规则判定）与模板一键实例化；验证：模板通过 shared 校验，engine 用 mock provider 跑通完整对局
- [x] 11.2 模板种子数据导入服务端（首次启动写入）；验证集成测试：冷启动后模板出现在环境列表

## 12. web：前端基线 (Frontend Baseline)

- [x] 12.1 搭建 React 18 + Vite + AntD 5 + Router + TanStack Query + Zustand，openapi-typescript 生成类型化 client；验证：dev server 渲染中文骨架页，client 类型生成成功
- [x] 12.2 全局中文文案与错误提示约定（术语保留英文）落地为共享常量/组件；验证：示例页面错误提示为中文

## 13. web：模型与 API 管理 (Model Management Page)

- [x] 13.1 模型配置列表/新增/编辑页：表单校验、连通性测试按钮、密钥脱敏展示；验证：Mock 下完成增改测三条路径且界面不出现完整密钥

## 14. web：环境构建器 (Environment Builder)

- [x] 14.1 模板选择 + 分区表单（角色/回合/判定/交换物）+ 字段级校验错误展示 + 保存；验证：从「AI 味对抗」模板创建环境成功且非法输入有中文字段级提示

## 15. web：对局实时视图 (Live Match View)

- [x] 15.1 对局发起入口 + 实时视图：按回合分组渲染行动/投递/判定事件流，断线重连续传；验证：mock 对局实时滚动呈现且不展示对手工作区等隔离信息
- [x] 15.2 对局历史列表与详情（回放全部事件、结果摘要）；验证：已完成对局可完整回放

## 16. web：结果与经验库 (Results & Experience Library)

- [x] 16.1 结果页：胜者、评分、每轮日志、隔离审计记录；验证：与 server 数据一致呈现
- [x] 16.2 经验库页：按环境/Agent 浏览 MEMORY/SKILLS 文档、进化时间线、胜率走势、导出；验证：两局 mock 对局后时间线与走势正确渲染、导出内容完整

## 17. 端到端集成验证 (End-to-End Integration)

- [x] 17.1 端到端冒烟（mock provider）：构建器创建环境 → 发起对局 → 实时观察 → 查看结果 → 经验库看到新经验；验证：全流程无需手动刷新且各页面数据一致
- [ ] 17.2 端到端冒烟（真实 OpenAI 兼容端点，手动）：单 API 自对抗与双模型对抗各一局；验证：两种绑定均正常完成并产出经验
- [x] 17.3 对照 5 份 spec 逐条核对验收场景并记录核对清单；验证：每个 Scenario 有对应通过证据（测试或手动记录）
