# 验收核对清单（17.3）

> 2026-10-09 追加：工作区体系（工具/共享/持久化管理）随任务 18.x 落地，核对清单同步扩展。

对照 5 份 spec delta 的全部 Scenario 逐条核对。证据类型：`auto` = 自动化测试（`pnpm test`），`ui` = 浏览器实测（2026-10-09，mock provider），`manual` = 待真实 API 手动验证。

## adversarial-environments

| Scenario | 证据 |
|---|---|
| 从配置创建环境 | auto（apps/server/src/app.test.ts：POST /api/environments → 201） |
| 非法配置被拒绝 | auto（同上：400 + 字段级中文错误） |
| 对称对抗环境 | auto（packages/shared schema.test：topology=symmetric 合法；引擎按槽位绑定角色，机制与不对称共用） |
| 不对称对抗环境 | auto（templates.test：模板 asymmetric 全对局跑通）+ ui（环境卡片显示拓扑标签） |
| 多方混战环境 | auto（match.test：三方混战按序完成） |
| 规则判定环境 | auto（templates.test：ai-flavor 准确率判定产出胜者与评分） |
| 需裁判但未配置裁判 | auto（shared validate.test：bindings.judge 报错）+ auto（app.test：validate 接口） |
| 基于内置模板创建环境 | auto（templates.test：一键实例化）+ ui（列表页一键创建成功并出卡片） |
| 校验失败阻止开赛 | auto（app.test：缺绑定 400 且指明 Agent） |

## match-engine

| Scenario | 证据 |
|---|---|
| 对局从创建到完成 | auto（match.test 生命周期）+ auto（app.test：创建→启动→完成→结果查询） |
| 对局失败可诊断 | auto（match.test 失败路径：保留回合记录与错误诊断）+ ui（失败对局在列表标记「已失败」） |
| 单 API 自对抗 | auto（match.test：binding 为完整快照，多实例可绑同一配置；templates.test 验证绑定机制） |
| 多模型对抗 | auto（app.test：两份不同模型配置各司其职）+ manual（17.2 真实端点） |
| 三方混战按序执行 | auto（match.test：三 Agent 各获行动机会） |
| 瞬时错误自动重试 | auto（client.test：500/429 重试成功且 onRetry 上报；engine 记 llm.retry 事件） |
| 持续失败终止对局 | auto（match.test：脚本耗尽 → match.failed，原因「模型持续失败」） |
| 裁判产出结构化判定 | auto（judge.test：judge.verdict 事件含结构化结果） |
| 裁判输出不合规 | auto（judge.test：重问记录 judge.invalid_output；超限 JudgeFailureError → match.failed） |
| 事件按序可回放 | auto（match.test：seq 严格递增、AsyncIterable 回放）+ auto（server：events 接口回放一致） |
| 查询对局结果 | auto（app.test：结果摘要含胜者/评分/每轮日志）+ ui（对局详情结果卡） |
| 查询跨局胜率 | auto（app.test：/api/stats 胜率统计）+ ui（经验库胜率统计） |

## workspace-isolation

| Scenario | 证据 |
|---|---|
| 双方工作区相互独立 | auto（isolation.test：目录隔离 + 模板互不可见） |
| 交换物是唯一对手信息来源 | auto（isolation.test：辨别者仅在投递点后于上下文中看到作品） |
| 请求越权访问被拒绝 | auto（isolation.test：跨工作区读写拒绝 + 审计回调） |
| 按协议投递作品 | auto（isolation.test：投递事件含摘要与轮次） |
| 审计对局信息流 | auto（isolation.test：access.denied 入事件流）+ ui（对局详情「隔离审计」区块显示投递记录） |

## experience-evolution

| Scenario | 证据 |
|---|---|
| 一局结束产生双方经验 | auto（experience.test：每 Agent 产出 MEMORY/SKILLS） |
| 自对抗的经验独立 | auto（experience.test：各阵营视角独立总结，两套经验） |
| 重启后经验仍在 | auto（experience.test：FileExperienceStore 文件 + index.json 持久化；server 冷启动种子幂等同机制） |
| 第二局注入首局经验 | auto（experience.test：injection.recorded 事件 + 上下文含首局 SKILLS/MEMORY） |
| 超出预算时筛选注入 | auto（experience.test：tokenBudget=4 → 注入 ≤ 预算） |
| 查看进化时间线 | auto（experience.test：两局后每 Agent 两条记录）+ ui（经验库时间线渲染 2 条） |

## web-console

| Scenario | 证据 |
|---|---|
| 从模板创建环境 | ui（构建器/一键创建成功，卡片出现） |
| 校验错误可定位 | ui（构建器空表单提交 → 中文字段级错误）+ auto（app.test 接口层） |
| 新增并测试 API 配置 | auto（app.test：新增/测试/更新三路径）+ ui（模型页渲染表格与操作按钮） |
| 密钥脱敏 | auto（app.test：仅尾 4 位）+ ui（页面显示 **** 尾缀，无完整密钥泄漏） |
| 实时观察对局 | auto（ws.test：实时推送 + 断线补发）+ ui（对局详情实时状态与 19 个事件渲染） |
| 浏览训练产出 | auto（app.test：经验文档/时间线/导出接口）+ ui（经验库表格、时间线、胜率、导出按钮） |
| 界面语言 | ui（全站中文菜单/文案/错误提示；术语保留英文） |

## 待手动验证

- **17.2**：真实 OpenAI 兼容端点冒烟（单 API 自对抗 + 双模型对抗）——需要用户配置真实 API Key 后执行（见 `scripts` 说明：在模型管理页录入真实端点后发起对局即可）。

## 追加：工作区体系（2026-10-09）

| Scenario | 证据 |
|---|---|
| 智能体使用工具读写工作区 | auto（tools.test：写→读→最终回复；agent.tool 事件；文件真实落盘） |
| 关闭工具能力 | auto（tools.test：toolsEnabled=false 时工具块原样保留、不执行） |
| 协作共享工作区 | auto（tools.test：共享目录 a 写 b 读；match 内 a 写入 b 通过工具读到） |
| 智能体工作区管理（查看/编辑/导入/导出） | auto（workspace-routes.test：保存/列表/读取/导入/导出 zip/路径穿越拒绝） |
| 修改作用于后续对局 | auto（match.ts：种子来自持久化工作区，结束后回写） |
