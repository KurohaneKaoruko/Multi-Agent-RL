# Spec Delta — experience-evolution / 经验进化

## Purpose

实现对抗进化的核心闭环：每场对局结束后由各 Agent 总结经验，沉淀为 MEMORY（情景记忆）与 SKILLS（技能文档）并持久化，在后续对局中注入上下文，使 Agent 随对局次数增长而变强；经验产物即训练成果。

## ADDED Requirements

### Requirement: 对局后经验总结 (Post-Episode Experience Summarization)
每场对局（episode）结束后，框架 SHALL 触发各参与 Agent 的经验总结：由该 Agent 绑定的模型基于本局完整经历（自身行动、对手可观测行为、胜负结果）产出 MEMORY 增量（本局情景得失）与 SKILLS 增量（可复用技巧）。总结产物 SHALL 为结构化、人类可读的文档（Markdown）。

#### Scenario: 一局结束产生双方经验
- **WHEN** 一个 1v1 对局完成
- **THEN** 两个 Agent 各自生成 MEMORY 与 SKILLS 的更新文档，内容对应各自视角的本局经历

#### Scenario: 自对抗的经验独立
- **WHEN** 自对抗对局中双方绑定同一模型 API
- **THEN** 双方按各自阵营视角独立总结，形成两套互不混淆的经验

### Requirement: 经验持久化 (Experience Persistence)
经验产物 SHALL 持久化保存：以文件形式（Markdown）按环境与 Agent 归档存储，并在数据库中建立索引（环境、Agent、对局、时间）。框架重启后既有经验 SHALL 仍然完整可用。

#### Scenario: 重启后经验仍在
- **WHEN** 框架重启后用户查看某 Agent 在某环境下的经验
- **THEN** 历史全部 MEMORY 与 SKILLS 文档可浏览，内容与重启前一致

### Requirement: 后续对局经验注入 (Experience Injection)
后续对局中，框架 SHALL 将该 Agent 在该环境下积累的 SKILLS 与近期 MEMORY 注入其上下文，注入内容 SHALL 受 token 预算约束（按策略筛选与截断），并在对局事件流中记录注入概况。

#### Scenario: 第二局注入首局经验
- **WHEN** 某 Agent 在同一环境下进行第二场对局
- **THEN** 其上下文包含首局总结的 SKILLS 与 MEMORY 摘要，事件流中有注入记录

#### Scenario: 超出预算时筛选注入
- **WHEN** 某 Agent 积累的经验总量超过配置的上下文预算
- **THEN** 框架按既定策略（如 SKILLS 全量精简 + 近期 MEMORY 优先）裁剪后注入，注入不超出预算

### Requirement: 进化过程可观测 (Evolution Observability)
框架 SHALL 记录进化时间线：每次总结发生于哪场对局、SKILLS 新增或修订了哪些条目、各 Agent 在该环境下的胜率随对局次数的变化，供用户在控制台查看。

#### Scenario: 查看进化时间线
- **WHEN** 用户查看某环境下某 Agent 的进化记录
- **THEN** 可以按时间看到每场对局后的经验变更摘要与胜率走势
