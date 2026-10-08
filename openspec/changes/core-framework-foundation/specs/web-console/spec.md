# Spec Delta — web-console / Web 控制台

## Purpose

提供美观易用的 Web 控制台，让用户零代码构建对抗环境、管理模型 API、发起并实时观察对局、浏览训练产出的经验资产；控制台通过 REST + WebSocket 与后端服务交互。

## ADDED Requirements

### Requirement: 环境构建器 (Environment Builder)
控制台 SHALL 提供环境构建器：基于内置模板（含「AI 味对抗」）以表单方式创建环境，编辑角色、回合结构、判定方式等配置；保存前执行校验，错误以中文可读提示定位到具体字段。

#### Scenario: 从模板创建环境
- **WHEN** 用户在构建器中选择「AI 味对抗」模板并填写必要配置后保存
- **THEN** 控制台展示新建环境的详情，该环境出现在环境列表中且可发起对局

#### Scenario: 校验错误可定位
- **WHEN** 用户保存一份缺少模型绑定的环境配置
- **THEN** 表单中对应字段显示中文错误提示，保存被阻止

### Requirement: 模型与 API 管理 (Model & API Management)
控制台 SHALL 支持管理模型 API 配置（名称、兼容 OpenAI 的端点、密钥、默认参数），提供连通性测试；密钥 SHALL 脱敏展示，任何界面不得明文回显完整密钥。

#### Scenario: 新增并测试 API 配置
- **WHEN** 用户新增一份模型 API 配置并点击测试
- **THEN** 控制台展示连通性测试结果（成功或具体错误原因）

#### Scenario: 密钥脱敏
- **WHEN** 用户查看已保存的 API 配置
- **THEN** 密钥以脱敏形式展示，无法在界面上读出完整密钥

### Requirement: 对局发起与实时观察 (Match Launch & Live View)
控制台 SHALL 支持从环境发起对局，并以实时流方式展示对局进展：回合、各 Agent 行动内容、交换物投递、裁判判定与结果；实时视图 SHALL 不展示被隔离信息（对手工作区、系统提示词）。

#### Scenario: 实时观察对局
- **WHEN** 用户发起对局并进入实时视图
- **THEN** 随对局进行，回合与双方行动、判定结果逐步实时呈现，无需手动刷新

### Requirement: 结果与经验库浏览 (Results & Experience Library)
控制台 SHALL 提供对局结果页（胜者、评分、每轮日志、隔离审计）与经验库页面：按环境和 Agent 浏览 MEMORY、SKILLS 文档，查看进化时间线与胜率走势，并支持导出经验文档。

#### Scenario: 浏览训练产出
- **WHEN** 用户在经验库中选择某环境下的某 Agent
- **THEN** 可以看到该 Agent 的 SKILLS/MEMORY 文档列表与内容、进化时间线及胜率走势，并可导出文档

### Requirement: 中文界面 (Chinese-First Interface)
控制台界面 SHALL 以中文为主要语言，专业术语保留英文原文；所有面向用户的错误提示 SHALL 为中文。

#### Scenario: 界面语言
- **WHEN** 用户打开控制台任意页面
- **THEN** 界面文案以中文呈现，错误与校验提示均为中文

### Requirement: 智能体工作区管理 (Workspace Management)
控制台 SHALL 提供智能体持久化工作区管理：按环境与智能体浏览文件列表、查看并编辑文件内容、批量导入文本文件、整包导出为 zip；用户的修改 SHALL 作用于其后的对局。

#### Scenario: 查看、编辑与保存工作区文件
- **WHEN** 用户在环境详情的工作区页选择一个智能体并编辑某文件保存
- **THEN** 内容写入持久化工作区，其后的对局以修改后的工作区启动

#### Scenario: 导入与导出
- **WHEN** 用户导入若干文本文件或点击导出
- **THEN** 导入的文件出现在工作区文件列表；导出得到包含全部工作区文件的 zip 压缩包
