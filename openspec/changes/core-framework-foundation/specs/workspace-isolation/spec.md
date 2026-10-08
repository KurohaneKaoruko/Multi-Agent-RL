# Spec Delta — workspace-isolation / 工作区隔离

## Purpose

保证对抗双方信息对等可控：每个 Agent 拥有独立工作区，框架强制信息流控制，Agent 只能通过环境定义的交换物协议获取对手信息，杜绝偷窥对方工作区与内部状态。

## ADDED Requirements

### Requirement: 独立工作区分配 (Per-Agent Workspace Allocation)
对局启动时，框架 SHALL 为每个参与 Agent 分配独立的专用工作区，工作区按环境模板初始化。任一 Agent 的工作区对其他 Agent SHALL 不可见、不可访问。

#### Scenario: 双方工作区相互独立
- **WHEN** 一个 1v1 对局启动
- **THEN** 两个 Agent 各自拥有独立初始化的工作区，且彼此无法读取对方工作区内容

### Requirement: 信息流控制 (Information Flow Control)
Agent 获取的一切信息 SHALL 来自两个渠道：环境注入的角色上下文，以及按交换物协议投递的交换物。框架 MUST NOT 向 Agent 泄露对手的工作区内容、系统提示词或未按协议投递的内部信息。

#### Scenario: 交换物是唯一对手信息来源
- **WHEN** 写作者 Agent 按协议提交作品且对局尚未到达投递时刻
- **THEN** 辨别者 Agent 的上下文中不包含该作品的任何内容，直到协议规定的投递时刻

#### Scenario: 请求越权访问被拒绝
- **WHEN** 某 Agent 在行动中试图读取对手的工作区文件
- **THEN** 该访问被拒绝，Agent 仅收到越权提示，且该事件被记录

### Requirement: 交换物投递 (Artifact Exchange)
框架 SHALL 按环境定义的交换物协议执行投递：在协议规定的回合，将指定 Agent 产出的指定内容投递给目标 Agent，投递行动 SHALL 产生事件流记录。

#### Scenario: 按协议投递作品
- **WHEN** 对局到达协议规定的投递回合且写作者已提交作品
- **THEN** 框架将作品内容投递给辨别者，并产生一条投递事件（含内容摘要与时间）

### Requirement: 隔离审计 (Isolation Auditing)
框架 SHALL 记录全部隔离相关事件（投递、越权拒绝），供事后审计确认对局公平性。

#### Scenario: 审计对局信息流
- **WHEN** 用户查看一个已完成对局的隔离审计记录
- **THEN** 可以看到该对局中全部交换物投递记录与全部被拒绝的越权访问记录
