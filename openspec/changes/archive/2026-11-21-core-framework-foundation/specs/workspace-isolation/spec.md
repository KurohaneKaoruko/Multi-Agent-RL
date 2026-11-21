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

### Requirement: 工作区文件工具 (Workspace File Tools)
智能体 SHALL 能通过工具协议（read_file / write_file / list_files）读写自己工作区内的文件；每轮工具调用次数有上限；全部调用（含越权拒绝）SHALL 记入事件流。环境 SHALL 可按需关闭工具能力。

#### Scenario: 智能体使用工具读写工作区
- **WHEN** 智能体在行动中调用 write_file 写入自己工作区的文件，随后调用 read_file 读取
- **THEN** 两次调用均成功且产生 agent.tool 事件，文件内容真实写入工作区

#### Scenario: 关闭工具能力
- **WHEN** 环境配置关闭工具能力（toolsEnabled=false）
- **THEN** 智能体回复中的工具调用块不被执行，原样作为行动内容

### Requirement: 共享工作区 (Shared Workspace)
环境 SHALL 支持配置共享工作区模式（workspaceTemplate.mode = "shared"）：全体智能体读写同一目录，用于协作场景。对抗环境默认使用独立工作区。

#### Scenario: 协作共享工作区
- **WHEN** 协作环境配置为共享工作区，智能体 A 写入共享文件，智能体 B 读取
- **THEN** B 能读到 A 写入的内容，且不产生越权拒绝记录
