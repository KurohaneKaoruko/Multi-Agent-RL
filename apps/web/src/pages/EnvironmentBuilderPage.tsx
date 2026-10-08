// 环境构建器（14.1 + AI 生成）：模板/空白/AI 生成起步，分区表单（角色/Agent/回合/交换物/判定），字段级中文校验错误
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Alert, Button, Card, Divider, Form, Input, InputNumber, Modal, Select, Space, Typography } from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, api, type EnvironmentConfig, type TemplateInfo } from '../api/client'
import { COMMON_MESSAGES, describeFieldErrors } from '../i18n'
import PageHeader from '../components/PageHeader'

interface BuilderForm {
  name: string
  description?: string
  paradigm: 'adversarial' | 'cooperative'
  topology: 'symmetric' | 'asymmetric' | 'melee'
  rounds: number
  roles: Array<{ id: string; name: string; systemPrompt: string; goal: string; answerFormat: 'free' | 'json' }>
  agents: Array<{ id: string; name: string; roleId: string; defaultModelConfigId?: string; startRound?: number }>
  exchanges: Array<{ artifact: string; fromAgentId: string; toAgentId: string; deliverAtRound: number }>
  outcomeMode: 'rule' | 'judge'
  rubric?: string
}

function blankForm(): BuilderForm {
  return {
    name: '',
    description: '',
    paradigm: 'adversarial',
    topology: 'asymmetric',
    rounds: 2,
    roles: [
      { id: 'role-a', name: '角色 A', systemPrompt: '', goal: '', answerFormat: 'free' },
      { id: 'role-b', name: '角色 B', systemPrompt: '', goal: '', answerFormat: 'free' },
    ],
    agents: [
      { id: 'agent-a', name: 'Agent A', roleId: 'role-a' },
      { id: 'agent-b', name: 'Agent B', roleId: 'role-b' },
    ],
    exchanges: [],
    outcomeMode: 'rule',
    rubric: '',
  }
}

function formToConfig(values: BuilderForm): Record<string, unknown> {
  const outcome =
    values.paradigm === 'cooperative' || values.outcomeMode === 'judge'
      ? { mode: 'judge', rubric: values.rubric ?? '' }
      : { mode: 'rule', evaluator: 'ai-flavor', params: {} }
  return {
    id: `env_${Math.random().toString(36).slice(2, 10)}`,
    name: values.name,
    description: values.description ?? '',
    paradigm: values.paradigm,
    topology: values.paradigm === 'cooperative' ? 'melee' : values.topology,
    roles: values.roles,
    agents: values.agents,
    turns: { rounds: values.rounds, order: values.agents.map((a) => a.id) },
    workspaceTemplate: { files: [] },
    exchanges: values.exchanges.map((e, i) => ({ id: `ex-${i + 1}`, ...e })),
    outcome,
    experience: { enabled: true, tokenBudget: 2000, recentMemoryLimit: 3 },
  }
}

export default function EnvironmentBuilderPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form] = Form.useForm<BuilderForm>()
  const rolesWatch = Form.useWatch('roles', form) as BuilderForm['roles'] | undefined
  const roleOptions = (rolesWatch ?? []).filter((r) => r?.id).map((r) => ({ value: r.id, label: r.name || r.id }))
  const [fieldErrors, setFieldErrors] = useState<Array<{ path: string; message: string }>>([])
  const [genOpen, setGenOpen] = useState(false)
  const [genIdea, setGenIdea] = useState('')
  const [genModelId, setGenModelId] = useState<string | undefined>(undefined)
  const templatesQuery = useQuery({ queryKey: ['templates'], queryFn: api.environments.templates })
  const modelsQuery = useQuery({ queryKey: ['models'], queryFn: api.models.list })
  const modelOptions = (modelsQuery.data?.models ?? []).map((m) => ({
    value: m.id,
    label: `${m.name}（${m.model}）`,
  }))
  const templates: TemplateInfo[] = templatesQuery.data?.templates ?? []

  const createMutation = useMutation({
    mutationFn: (config: unknown) => api.environments.create(config),
    onSuccess: () => {
      message.success(COMMON_MESSAGES.saveSuccess)
      void queryClient.invalidateQueries({ queryKey: ['environments'] })
      navigate('/environments')
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields)
      message.error(err instanceof Error ? err.message : COMMON_MESSAGES.saveFailed)
    },
  })

  // AI 生成环境配置草稿（让 LLM 自己构建）→ 预填表单，仍可手动微调
  const genMutation = useMutation({
    mutationFn: (input: { idea: string; modelConfigId: string }) => api.environments.generateDraft(input),
    onSuccess: ({ draft }) => {
      applyDraft(draft)
      setGenOpen(false)
      message.success('AI 已生成环境配置（含智能体提示词），可继续手动微调')
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields && err.fields.length > 0) {
        message.error(`${COMMON_MESSAGES.validationFailed}：${err.fields.map((f) => `${f.path} ${f.message}`).join('；')}`)
      } else {
        message.error(err instanceof Error ? err.message : 'AI 生成失败')
      }
    },
  })

  const applyDraft = (draft: EnvironmentConfig): void => {
    form.setFieldsValue({
      name: draft.name,
      description: draft.description,
      paradigm: draft.paradigm ?? 'adversarial',
      topology: draft.topology,
      rounds: draft.turns.rounds,
      roles: draft.roles.map((r) => ({ ...r })),
      agents: draft.agents.map((a) => ({
        id: a.id,
        name: a.name,
        roleId: a.roleId,
        startRound: a.startRound,
        defaultModelConfigId: undefined,
      })),
      exchanges: draft.exchanges.map((e) => ({ ...e })),
      outcomeMode: draft.outcome.mode,
      rubric: draft.outcome.mode === 'judge' ? draft.outcome.rubric : undefined,
    })
  }

  const submitGen = async (): Promise<void> => {
    if (!genIdea || genIdea.trim().length < 4) {
      message.warning('请先描述你的对抗环境构想（至少 4 个字）')
      return
    }
    if (!genModelId) {
      message.warning('请选择用于生成配置的模型')
      return
    }
    genMutation.mutate({ idea: genIdea.trim(), modelConfigId: genModelId })
  }

  const applyTemplate = (templateId: string): void => {
    // 以模板内容预填表单（构建器起步）
    void api.environments
      .templates()
      .then(({ templates: list }) => {
        const tpl = list.find((t) => t.templateId === templateId)
        if (!tpl) return
        // 模板完整配置经实例化接口获取成本高，这里以「复制模板为草稿」的方式拉取：
        // 直接读取模板列表中的描述并提示用户；真正预填走 from-template 创建后再编辑（MVP 提供模板直建按钮）。
        message.info(`已选择模板「${tpl.name}」：如需完整预填，推荐在环境列表页一键创建后修改。`)
      })
  }

  const submit = async (): Promise<void> => {
    setFieldErrors([])
    try {
      const values = await form.validateFields()
      createMutation.mutate(formToConfig(values))
    } catch {
      /* 表单校验失败（客户端） */
    }
  }

  return (
    <div>
      <PageHeader
        title="环境构建器"
        description="以表单描述角色、回合与规则——保存后即可反复开赛；推荐从内置模板一键创建后微调。"
      />
      <Card>
      {fieldErrors.length > 0 ? (
        <Alert
          style={{ marginBottom: 16 }}
          type="error"
          showIcon
          message={COMMON_MESSAGES.validationFailed}
          description={describeFieldErrors(fieldErrors)}
        />
      ) : null}
      <Form form={form} layout="vertical" initialValues={blankForm()}>
        <Card type="inner" title="基本信息">
          <Space wrap>
            <Form.Item name="name" label="环境名称" rules={[{ required: true, message: '请输入环境名称' }]}>
              <Input placeholder="如：红队蓝队安全攻防" style={{ width: 240 }} />
            </Form.Item>
            <Form.Item name="paradigm" label="学习范式" initialValue="adversarial" rules={[{ required: true }]}>
              <Select
                style={{ width: 230 }}
                onChange={(value: 'adversarial' | 'cooperative') => {
                  if (value === 'cooperative') {
                    // 协作范式：无对抗拓扑（全员混战编组），必须使用 AI 裁判团队评分
                    form.setFieldsValue({ topology: 'melee', outcomeMode: 'judge' })
                  }
                }}
                options={[
                  { value: 'adversarial', label: '对抗 · Agent-RLAF' },
                  { value: 'cooperative', label: '协作 · Agent-RLCF' },
                ]}
              />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(prev, cur) => prev.paradigm !== cur.paradigm}>
              {({ getFieldValue }) => (
                <Form.Item
                  name="topology"
                  label={getFieldValue('paradigm') === 'cooperative' ? '编组方式' : '对抗拓扑'}
                  rules={[{ required: true }]}
                >
                  <Select
                    style={{ width: 220 }}
                    disabled={getFieldValue('paradigm') === 'cooperative'}
                    options={[
                      { value: 'symmetric', label: '对称对抗（同角色）' },
                      { value: 'asymmetric', label: '不对称对抗（不同角色）' },
                      { value: 'melee', label: getFieldValue('paradigm') === 'cooperative' ? '自由协作（无固定编组）' : '多方混战' },
                    ]}
                  />
                </Form.Item>
              )}
            </Form.Item>
            <Form.Item name="rounds" label="总轮数" rules={[{ required: true }]}>
              <InputNumber min={1} max={200} />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="环境的目标与玩法说明" />
          </Form.Item>
          <Form.Item label="AI 生成配置">
            <Space>
              <Button onClick={() => setGenOpen(true)}>✨ 让 LLM 生成环境配置</Button>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                描述你的构想，由模型生成角色提示词、回合与投递协议，生成后仍可手动微调
              </Typography.Text>
            </Space>
          </Form.Item>
          <Form.Item label="从模板起步">
            <Select
              style={{ width: 320 }}
              placeholder="选择内置模板预览"
              onChange={applyTemplate}
              options={templates.map((t) => ({ value: t.templateId, label: t.name }))}
            />
          </Form.Item>
        </Card>

        <Divider />
        <Card type="inner" title="角色定义（智能体的提示词在此配置，可手动编辑或由 AI 生成）">
          <Form.List name="roles">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Card key={field.key} size="small" style={{ marginBottom: 8 }}>
                    <Space wrap align="start">
                      <Form.Item
                        name={[field.name, 'id']}
                        label="角色 ID"
                        rules={[{ required: true, message: '请输入角色 ID' }]}
                      >
                        <Input placeholder="writer" style={{ width: 120 }} />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'name']}
                        label="名称"
                        rules={[{ required: true, message: '请输入角色名称' }]}
                      >
                        <Input placeholder="写作者" style={{ width: 120 }} />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'answerFormat']}
                        label="回答格式"
                        rules={[{ required: true }]}
                        initialValue="free"
                      >
                        <Select
                          style={{ width: 140 }}
                          options={[
                            { value: 'free', label: '自由文本' },
                            { value: 'json', label: 'JSON（判定类）' },
                          ]}
                        />
                      </Form.Item>
                    </Space>
                    <Form.Item
                      name={[field.name, 'systemPrompt']}
                      label="系统提示"
                      rules={[{ required: true, message: '请输入系统提示' }]}
                    >
                      <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'goal']}
                      label="目标"
                      rules={[{ required: true, message: '请输入角色目标' }]}
                    >
                      <Input.TextArea rows={2} />
                    </Form.Item>
                    <Button danger size="small" onClick={() => remove(field.name)} disabled={fields.length <= 1}>
                      移除角色
                    </Button>
                  </Card>
                ))}
                <Button size="small" onClick={() => add({ id: `role-${fields.length + 1}`, name: '', systemPrompt: '', goal: '', answerFormat: 'free' })}>
                  添加角色
                </Button>
              </>
            )}
          </Form.List>
        </Card>

        <Divider />
        <Card type="inner" title="Agent 槽位（每轮均按顺序行动）">
          <Form.List name="agents">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} wrap align="start">
                    <Form.Item
                      name={[field.name, 'id']}
                      label="Agent ID"
                      rules={[{ required: true, message: '请输入 Agent ID' }]}
                    >
                      <Input placeholder="writer-a" style={{ width: 140 }} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'name']}
                      label="显示名"
                      rules={[{ required: true, message: '请输入显示名' }]}
                    >
                      <Input placeholder="写作者 A" style={{ width: 140 }} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'roleId']}
                      label="绑定角色"
                      rules={[{ required: true, message: '请选择角色' }]}
                    >
                      <Select style={{ width: 140 }} options={roleOptions} placeholder="选择角色" />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'defaultModelConfigId']}
                      label="默认模型（可选）"
                      tooltip="发起对局时自动预填该模型，可临时更换"
                    >
                      <Select style={{ width: 170 }} placeholder="开赛时选择" allowClear options={modelOptions} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'startRound']}
                      label="起始轮次"
                      initialValue={1}
                      tooltip="判断类智能体应在收到投递后的轮次才登场"
                    >
                      <InputNumber min={1} style={{ width: 110 }} placeholder="默认 1" />
                    </Form.Item>
                    <Button danger size="small" onClick={() => remove(field.name)} disabled={fields.length <= 2}>
                      移除
                    </Button>
                  </Space>
                ))}
                <Button size="small" onClick={() => add({ id: `agent-${fields.length + 1}`, name: '', roleId: '' })}>
                  添加 Agent
                </Button>
              </>
            )}
          </Form.List>
        </Card>

        <Divider />
        <Card type="inner" title="交换物协议（规定回合结束时投递）">
          <Form.List name="exchanges">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} wrap align="start">
                    <Form.Item name={[field.name, 'artifact']} label="交换物名" rules={[{ required: true, message: '请输入交换物名' }]}>
                      <Input placeholder="manuscript" style={{ width: 140 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'fromAgentId']} label="产出方" rules={[{ required: true, message: '请输入产出方 Agent ID' }]}>
                      <Input placeholder="writer-a" style={{ width: 140 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'toAgentId']} label="接收方" rules={[{ required: true, message: '请输入接收方 Agent ID' }]}>
                      <Input placeholder="detector-a" style={{ width: 140 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'deliverAtRound']} label="投递轮次" rules={[{ required: true, message: '请输入投递轮次' }]}>
                      <InputNumber min={1} />
                    </Form.Item>
                    <Button danger size="small" onClick={() => remove(field.name)}>
                      移除
                    </Button>
                  </Space>
                ))}
                <Button size="small" onClick={() => add({})}>
                  添加交换物
                </Button>
              </>
            )}
          </Form.List>
        </Card>

        <Divider />
        <Card type="inner" title="结局判定">
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.paradigm !== cur.paradigm || prev.outcomeMode !== cur.outcomeMode}>
            {({ getFieldValue }) => {
              const isCooperative = getFieldValue('paradigm') === 'cooperative'
              const outcomeMode = getFieldValue('outcomeMode')
              return (
                <Space wrap>
                  <Form.Item
                    name="outcomeMode"
                    label={isCooperative ? '团队评分方式' : '判定方式'}
                    initialValue="rule"
                    rules={[{ required: true }]}
                    extra={isCooperative ? '协作环境（Agent-RLCF）必须使用 AI 裁判为团队评分（0-100），所有成员共享团队得分。' : undefined}
                  >
                    <Select
                      style={{ width: 260 }}
                      disabled={isCooperative}
                      options={
                        isCooperative
                          ? [{ value: 'judge', label: 'AI 裁判团队评分（0-100）' }]
                          : [
                              { value: 'rule', label: '规则判定（内置 ai-flavor 零和互斥）' },
                              { value: 'judge', label: 'AI 裁判（需绑定裁判模型）' },
                            ]
                      }
                    />
                  </Form.Item>
                  {isCooperative || outcomeMode === 'judge' ? (
                    <Form.Item
                      name="rubric"
                      label={isCooperative ? '团队评分标准（rubric）' : '裁判评分标准（rubric）'}
                      rules={[{ required: true, message: 'AI 裁判模式必须填写评分标准' }]}
                      style={{ minWidth: 320 }}
                    >
                      <Input.TextArea
                        rows={2}
                        placeholder={
                          isCooperative
                            ? '例：诊断准确性 40 分、方案完整性 30 分、多学科协同度 30 分'
                            : '例：按文本质量与策略水平打分，胜者给更高分'
                        }
                      />
                    </Form.Item>
                  ) : null}
                </Space>
              )
            }}
          </Form.Item>
        </Card>

        <Divider />
        <Space>
          <Button type="primary" loading={createMutation.isPending} onClick={submit}>
            保存环境
          </Button>
          <Button onClick={() => navigate('/environments')}>取消</Button>
        </Space>
      </Form>
      </Card>
      <Modal
        title="✨ 让 LLM 生成环境配置"
        open={genOpen}
        onOk={submitGen}
        confirmLoading={genMutation.isPending}
        onCancel={() => setGenOpen(false)}
        okText="生成"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Typography.Text strong>对抗环境构想</Typography.Text>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                例如：正反两方就「AI 是否有利于长期安全」展开辩论攻防；或红队智能体尝试诱导、蓝队智能体防御并复盘
              </Typography.Text>
            </div>
            <Input.TextArea
              rows={4}
              value={genIdea}
              onChange={(e) => setGenIdea(e.target.value)}
              placeholder="描述你想要的对抗玩法：角色、目标、判定方式……"
            />
          </div>
          <div>
            <Typography.Text strong>生成所用模型</Typography.Text>
            <Select
              style={{ width: '100%', marginTop: 6 }}
              placeholder="选择一个已配置的模型"
              value={genModelId}
              onChange={setGenModelId}
              options={modelOptions}
            />
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            生成结果会预填到下方表单（含每个智能体的提示词），可继续手动微调后保存。
          </Typography.Text>
        </Space>
      </Modal>
    </div>
  )
}
