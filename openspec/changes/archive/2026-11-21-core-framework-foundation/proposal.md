# Proposal

> 语言说明：本产出物为中英双语，以中文为主，保留英文技术术语。

## Why / 背景与动机

让 LLM Agent 变强的主流路径之一是**对抗进化**：两个或多个 Agent 在同一仿真环境中相互对抗，通过总结经验（MEMORY/SKILLS）不断变强。目前缺少一个通用的、可配置的框架来承载这类对抗——每个场景（生成-辨别式文本对抗、红队蓝队安全攻防、多方辩论混战）都要从零搭建运行时、隔离机制和经验总结管线。本项目（ARLAF，Adversarial Reinforcement Learning Agent Framework）要把这套能力沉淀为通用框架，并提供美观的 Web 界面让用户零代码构建对抗环境。

## What Changes / 变更内容

本次变更为**绿地框架骨架**，从零建立全部核心子系统，并以「AI 味对抗」（写作者 vs 辨别者）作为首个内置示例环境端到端验证框架：

- **对抗环境定义**：声明式环境配置，支持对称对抗（双方同角色）、不对称对抗（双方不同角色）与多方混战；可选 AI 裁判。
- **对局执行引擎**：回合制/轮次制对局循环，1v1 至 N 个 Agent；Agent 可绑定同一 API（自对抗 self-play）或多个不同模型。
- **工作区隔离**：每个 Agent 独立工作区，框架强制信息流控制，禁止偷窥对方工作区；仅通过环境定义的交换物（作品/消息）交互。
- **经验进化机制**：每轮对局结束后由各 Agent 总结经验，沉淀为 MEMORY（情景记忆）与 SKILLS（技能文档），在后续对局中注入上下文，形成进化闭环；训练产物即 Agent 留下的 skills 与 docs。
- **Web 控制台**：环境构建器（表单/模板化配置）、模型与 API 管理、对局运行与实时观察、经验库浏览。

## Capabilities / 能力

### New Capabilities / 新增能力

- `adversarial-environments`: 对抗环境的声明式定义——角色、目标、胜负判定方式（规则判定或 AI 裁判）、回合结构、工作区模板、交换物协议；内置「AI 味对抗」示例环境。
- `match-engine`: 对局执行引擎——Agent 调度与并发、LLM Provider 调用（OpenAI 兼容 API 优先）、多模型/自对抗绑定、AI 裁判执行、结构化事件流输出。
- `workspace-isolation`: Agent 工作区隔离——独立工作区分配、跨 Agent 信息流控制、交换物投递机制。
- `experience-evolution`: 经验进化——对局后经验总结（MEMORY/SKILLS 生成）、持久化存储、后续对局的上下文注入、进化过程的可观测记录。
- `web-console`: Web 控制台——环境构建器、模型/API 管理、对局发起与实时事件观察、对局结果与经验库浏览。

### Modified Capabilities / 修改能力

（无——绿地项目，尚无既有能力。）

## Impact / 影响

- **代码**：全部为新建。预期 monorepo 结构（全栈 TypeScript）：核心引擎库（engine）、API 服务（server）、Web 前端（React + Vite）（详见 design.md）。
- **API**：新增 REST + WebSocket 接口（环境 CRUD、对局生命周期、实时事件流、经验库查询）。
- **依赖**：Node.js/TypeScript（Fastify、WebSocket、OpenAI 兼容 SDK、SQLite 驱动等）；前端（React、Vite）。LLM 访问走用户自配的 OpenAI 兼容 API。
- **系统**：无既有系统受影响；训练产物（skills/docs）以本地文件 + SQLite 持久化。
- **范围外（本次不做）**：容器级代码执行沙箱（工作区隔离仅覆盖信息流与文件访问层面）、分布式多机调度、RL 数值训练（本框架的"强化"指经验总结进化，非梯度训练）、用户账号体系。
