# Spec Delta — adversarial-environments / 对抗环境定义

## Purpose

定义对抗环境的声明式配置能力：用户通过结构化配置描述角色、目标、回合结构、胜负判定方式与交换物协议，支持对称对抗、不对称对抗与多方混战，并提供可校验、可复用的环境模板。

## ADDED Requirements

### Requirement: 声明式环境定义 (Declarative Environment Definition)
系统 SHALL 支持以结构化配置（YAML/JSON）完整定义一个对抗环境，包含：角色列表及其目标提示、回合结构、工作区初始模板、交换物协议（谁在何时向谁交付什么）与胜负判定方式。配置 SHALL 可保存、可复用。

#### Scenario: 从配置创建环境
- **WHEN** 用户提交一份合法的环境配置
- **THEN** 系统保存该环境并返回唯一环境 ID，该环境可直接用于发起对局

#### Scenario: 非法配置被拒绝
- **WHEN** 用户提交缺少必要字段（如无角色定义）的环境配置
- **THEN** 系统拒绝创建，并返回指明缺失或错误字段的可读错误信息

### Requirement: 对抗拓扑支持 (Adversarial Topologies)
环境配置 SHALL 支持三种对抗拓扑：对称对抗（双方为同一角色定义的实例）、不对称对抗（双方为不同角色）、多方混战（三个及以上 Agent 自由对抗，无固定队伍）。环境定义 SHALL 不因拓扑类型而需要不同的配置格式。

#### Scenario: 对称对抗环境
- **WHEN** 环境配置声明两个实例均绑定同一角色定义
- **THEN** 对局中两个 Agent 使用相同的角色目标与规则，互为对手

#### Scenario: 不对称对抗环境
- **WHEN** 环境配置为两个 Agent 分别绑定不同角色定义
- **THEN** 对局中各 Agent 按各自角色的目标与规则行动

#### Scenario: 多方混战环境
- **WHEN** 环境配置声明三个及以上 Agent 参与且无队伍划分
- **THEN** 对局中所有 Agent 按环境定义的回合顺序行动，并以环境定义的判定方式决出名次或胜者

### Requirement: 胜负判定方式 (Outcome Determination)
每个环境 SHALL 声明其胜负判定方式：基于规则的程序判定，或 AI 裁判判定。声明为「需要裁判」的环境，若未配置裁判，SHALL 无法通过对局前校验。

#### Scenario: 规则判定环境
- **WHEN** 一个规则判定环境的对局结束
- **THEN** 引擎按环境内置的判定规则产出胜负结果，无需调用裁判

#### Scenario: 需裁判但未配置裁判
- **WHEN** 用户发起一个声明需要 AI 裁判但未绑定裁判模型的环境对局
- **THEN** 系统拒绝发起，并提示需要配置裁判

### Requirement: 内置环境模板 (Built-in Environment Templates)
系统 SHALL 内置「AI 味对抗」（AI-Flavor Adversarial：写作者 Writer vs 辨别者 Detector）示例环境模板：写作者每轮产出文本，辨别者判断其是否为 AI 生成。双方胜负条件 SHALL 互斥（零和）：辨别者识破（判为 AI）得该轮，被蒙骗（判为人类）则写作者得该轮，总胜负以识破率判定。用户 SHALL 能基于内置模板一键创建可直接开赛的环境。

#### Scenario: 基于内置模板创建环境
- **WHEN** 用户在模板列表中选择「AI 味对抗」并确认创建
- **THEN** 系统生成一份已填好角色、回合结构与判定规则的环境配置，用户补充模型绑定后即可开赛

### Requirement: 对局前环境校验 (Pre-Match Environment Validation)
发起对局前，系统 SHALL 校验环境完整性：所有参与 Agent 已绑定可用模型 API、需裁判的环境已绑定裁判、交换物协议中引用的角色均存在。校验失败 SHALL 阻止开赛并列出全部问题。

#### Scenario: 校验失败阻止开赛
- **WHEN** 用户尝试开赛一个有 Agent 未绑定模型的环境
- **THEN** 系统返回校验失败，错误信息指出具体哪个 Agent 缺少模型绑定
