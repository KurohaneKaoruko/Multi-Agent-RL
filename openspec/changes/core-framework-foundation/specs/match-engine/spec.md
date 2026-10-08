# Spec Delta — match-engine / 对局执行引擎

## Purpose

提供对局的执行能力：按环境定义驱动回合循环，调度多个 LLM Agent 并发行动，调用模型 API，执行 AI 裁判，输出结构化事件流与最终对局结果。

## ADDED Requirements

### Requirement: 对局生命周期管理 (Match Lifecycle)
系统 SHALL 管理对局的完整生命周期：创建 → 运行中（多轮回合）→ 完成/失败。生命周期状态变更 SHALL 通过事件流对外可见，失败的对局 SHALL 保留已产生的日志与经验产物。

#### Scenario: 对局从创建到完成
- **WHEN** 用户对一个通过校验的环境发起对局并启动
- **THEN** 系统按环境定义执行全部回合，最终将对局标记为「完成」并产出结果摘要

#### Scenario: 对局失败可诊断
- **WHEN** 对局过程中发生无法恢复的错误
- **THEN** 对局被标记为「失败」，错误信息与已完成回合的记录可被查询

### Requirement: Agent 与模型绑定 (Agent-Model Binding)
对局中每个 Agent SHALL 绑定独立的模型 API 配置（端点、模型名、参数）。多个 Agent SHALL 允许绑定同一份 API 配置（自对抗 self-play），也 SHALL 允许绑定不同模型。

#### Scenario: 单 API 自对抗
- **WHEN** 对局中所有 Agent 绑定同一份模型 API 配置
- **THEN** 各 Agent 独立调用该模型，形成同一模型自己对抗自己

#### Scenario: 多模型对抗
- **WHEN** 对局中两个 Agent 分别绑定不同的模型 API 配置
- **THEN** 各 Agent 的请求分别使用各自绑定的模型

### Requirement: 多 Agent 调度 (Multi-Agent Orchestration)
引擎 SHALL 支持 1v1 至 N 个 Agent 的对局，按环境定义的回合顺序调度 Agent 行动，并 SHALL 支持无依赖的 Agent 行动并发执行。

#### Scenario: 三方混战按序执行
- **WHEN** 一个三方混战对局启动
- **THEN** 引擎按环境定义的顺序调度三个 Agent，每轮各 Agent 均获得行动机会

### Requirement: 模型调用容错 (LLM Call Resilience)
模型调用遇到瞬时错误（网络抖动、限流）SHALL 按可配置策略自动重试；持续失败 SHALL 使对局失败并记录诊断信息，而不是无响应挂起。

#### Scenario: 瞬时错误自动重试
- **WHEN** 某 Agent 的模型调用返回可重试错误
- **THEN** 引擎按重试策略自动重试，成功后对局继续，重试情况记录在事件流中

#### Scenario: 持续失败终止对局
- **WHEN** 某 Agent 的模型调用在重试耗尽后仍失败
- **THEN** 对局标记为失败，事件流中包含失败的 Agent、模型与错误原因

### Requirement: AI 裁判执行 (AI Judge Execution)
对于需要裁判的环境，引擎 SHALL 在判定时刻将环境定义的裁判输入（双方产出、评分标准）提交给裁判 Agent，并要求其返回结构化判定结果；判定结果 SHALL 记入对局记录。

#### Scenario: 裁判产出结构化判定
- **WHEN** 一个需裁判的环境对局到达判定时刻
- **THEN** 裁判 Agent 返回包含胜者/评分的结构化结果并被记录

#### Scenario: 裁判输出不合规
- **WHEN** 裁判 Agent 返回无法解析为结构化判定的内容
- **THEN** 引擎按策略重试或判定失败，并在事件流中记录该异常

### Requirement: 结构化事件流 (Structured Event Stream)
引擎 SHALL 在对局过程中输出结构化事件流（回合开始、Agent 行动内容、交换物投递、裁判判定、对局结束等），事件按发生顺序编号，供上层服务实时转发与事后回放。

#### Scenario: 事件按序可回放
- **WHEN** 一个对局完成
- **THEN** 其全部事件可按序号顺序完整回放，包含每轮各 Agent 的行动内容

### Requirement: 对局结果与战绩统计 (Match Results & Win-Rate Tracking)
对局完成时，系统 SHALL 产出结果摘要：胜者与各 Agent 评分、每轮日志。跨多次对局（episodes），系统 SHALL 按环境维度统计各 Agent 的胜率。

#### Scenario: 查询对局结果
- **WHEN** 用户查询一个已完成对局
- **THEN** 系统返回胜者、各 Agent 评分与每轮日志

#### Scenario: 查询跨局胜率
- **WHEN** 同一环境下已累计多次对局
- **THEN** 系统可返回每个参与 Agent 在该环境下的累计胜率
