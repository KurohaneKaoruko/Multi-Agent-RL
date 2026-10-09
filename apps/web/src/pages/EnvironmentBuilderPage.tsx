// 环境构建器：全要素零代码配置（范式/角色提示词/智能体/交换物/工作区/经验/判定），支持新建与编辑，可由 AI 生成草稿
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Alert, Button, Card, Divider, Form, Input, InputNumber, Modal, Select, Space, Switch, Typography } from 'antd'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, api, type EnvironmentConfig, type TemplateInfo } from '../api/client'
import { COMMON_MESSAGES, describeFieldErrors } from '../i18n'
import PageHeader from '../components/PageHeader'

interface BuilderForm {
  name: string
  description?: string
  paradigm: 'adversarial' | 'cooperative' | 'drill'
  topology: 'symmetric' | 'asymmetric' | 'melee'
  rounds: number
  toolsEnabled: boolean
  workspaceMode: 'private' | 'shared'
  workspaceFiles: Array<{ path: string; content: string }>
  roles: Array<{ id: string; name: string; systemPrompt: string; goal: string; answerFormat: 'free' | 'json' }>
  agents: Array<{
    id: string
    name: string
    roleId: string
    defaultModelConfigId?: string
    startRound?: number
  }>
  exchanges: Array<{ artifact: string; fromAgentId: string; toAgentId: string; deliverAtRound: number }>
  experienceEnabled: boolean
  tokenBudget: number
  recentMemoryLimit: number
  outcomeMode: 'rule' | 'judge'
  ruleEvaluator: 'ai-flavor' | 'attack-defense' | 'flag-check'
  flagFlags?: string
  rubric?: string
}

function blankForm(): BuilderForm {
  return {
    name: '',
    description: '',
    paradigm: 'adversarial',
    topology: 'asymmetric',
    rounds: 2,
    toolsEnabled: true,
    workspaceMode: 'private',
    workspaceFiles: [],
    roles: [
      { id: 'role-a', name: '角色 A', systemPrompt: '', goal: '', answerFormat: 'free' },
      { id: 'role-b', name: '角色 B', systemPrompt: '', goal: '', answerFormat: 'free' },
    ],
    agents: [
      { id: 'agent-a', name: 'Agent A', roleId: 'role-a' },
      { id: 'agent-b', name: 'Agent B', roleId: 'role-b' },
    ],
    exchanges: [],
    experienceEnabled: true,
    tokenBudget: 2000,
    recentMemoryLimit: 3,
    outcomeMode: 'rule',
    ruleEvaluator: 'ai-flavor',
    flagFlags: '',
    rubric: '',
  }
}

/** 表单值 → 环境配置（id 由调用方覆盖：新建生成随机 id，编辑沿用原 id） */
function formToConfig(values: BuilderForm, id: string): Record<string, unknown> {
  const outcome =
    values.paradigm === 'cooperative' || values.outcomeMode === 'judge'
      ? { mode: 'judge', rubric: values.rubric ?? '' }
      : {
          mode: 'rule',
          evaluator: values.ruleEvaluator ?? 'ai-flavor',
          params:
            values.ruleEvaluator === 'flag-check'
              ? { flags: (values.flagFlags ?? '').split('\n').map((s) => s.trim()).filter(Boolean) }
              : {},
        }
  return {
    id,
    name: values.name,
    description: values.description ?? '',
    paradigm: values.paradigm,
    topology: values.paradigm !== 'adversarial' ? 'melee' : values.topology,
    roles: values.roles,
    agents: values.agents,
    turns: { rounds: values.rounds, order: values.agents.map((a) => a.id) },
    toolsEnabled: values.toolsEnabled,
    workspaceTemplate: { mode: values.workspaceMode, files: values.workspaceFiles },
    exchanges: values.exchanges.map((e, i) => ({ id: `ex-${i + 1}`, ...e })),
    outcome,
    experience: {
      enabled: values.experienceEnabled,
      tokenBudget: values.tokenBudget,
      recentMemoryLimit: values.recentMemoryLimit,
    },
  }
}

/** 环境配置 → 表单值（编辑已有环境 / AI 草稿预填共用） */
function configToForm(config: EnvironmentConfig): BuilderForm {
  const outcome = config.outcome
  return {
    name: config.name,
    description: config.description,
    paradigm: config.paradigm ?? 'adversarial',
    topology: config.topology,
    rounds: config.turns.rounds,
    toolsEnabled: config.toolsEnabled ?? true,
    workspaceMode: config.workspaceTemplate.mode ?? 'private',
    workspaceFiles: config.workspaceTemplate.files.map((f) => ({ ...f })),
    roles: config.roles.map((r) => ({ ...r })),
    agents: config.agents.map((a) => ({
      id: a.id,
      name: a.name,
      roleId: a.roleId,
      startRound: a.startRound,
      defaultModelConfigId: a.defaultModelConfigId,
    })),
    exchanges: config.exchanges.map((e) => ({
      artifact: e.artifact,
      fromAgentId: e.fromAgentId,
      toAgentId: e.toAgentId,
      deliverAtRound: e.deliverAtRound,
    })),
    experienceEnabled: config.experience.enabled,
    tokenBudget: config.experience.tokenBudget,
    recentMemoryLimit: config.experience.recentMemoryLimit,
    outcomeMode: outcome.mode === 'judge' ? 'judge' : 'rule',
    ruleEvaluator: outcome.mode === 'rule' ? (outcome.evaluator as BuilderForm['ruleEvaluator']) : 'ai-flavor',
    flagFlags:
      outcome.mode === 'rule' && Array.isArray(outcome.params.flags)
        ? (outcome.params.flags as string[]).join('\n')
        : '',
    rubric: outcome.mode === 'judge' ? outcome.rubric : '',
  }
}

export default function EnvironmentBuilderPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const editId = searchParams.get('id') // 有值 = 编辑已有环境

  const [form] = Form.useForm<BuilderForm>()
  const rolesWatch = Form.useWatch('roles', form) as BuilderForm['roles'] | undefined
  const roleOptions = (rolesWatch ?? []).filter((r) => r?.id).map((r) => ({ value: r.id, label: r.name || r.id }))
  const paradigmWatch = Form.useWatch('paradigm', form) as BuilderForm['paradigm'] | undefined
  const isDrill = paradigmWatch === 'drill'
  const [fieldErrors, setFieldErrors] = useState<Array<{ path: string; message: string }>>([])
  const [genOpen, setGenOpen] = useState(false)
  const [genIdea, setGenIdea] = useState('')
  const [genModelId, setGenModelId] = useState<string | undefined>(undefined)
  const [loaded, setLoaded] = useState(false)
  const templatesQuery = useQuery({ queryKey: ['templates'], queryFn: api.environments.templates })
  const modelsQuery = useQuery({ queryKey: ['models'], queryFn: api.models.list })
  const modelOptions = (modelsQuery.data?.models ?? []).map((m) => ({
    value: m.id,
    label: `${m.name}（${m.model}）`,
  }))
  const templates: TemplateInfo[] = templatesQuery.data?.templates ?? []

  // 编辑模式：加载既有环境配置预填表单
  const envQuery = useQuery({
    queryKey: ['environment-edit', editId],
    queryFn: () => api.environments.get(editId!),
    enabled: editId != null,
  })
  const applyConfig = (config: EnvironmentConfig): void => {
    form.setFieldsValue(configToForm(config))
  }
  if (editId != null && !loaded && envQuery.data) {
    applyConfig(envQuery.data.config)
    setLoaded(true)
  }

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
  const updateMutation = useMutation({
    mutationFn: (input: { id: string; config: unknown }) => api.environments.update(input.id, input.config),
    onSuccess: () => {
      message.success(COMMON_MESSAGES.saveSuccess)
      void queryClient.invalidateQueries({ queryKey: ['environments'] })
      void queryClient.invalidateQueries({ queryKey: ['environment-edit', editId] })
      navigate(`/environments/${editId}`)
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
      applyConfig({ ...draft, id: draft.id ?? editId ?? 'draft' })
      setGenOpen(false)
      message.success('AI 已生成环境配置（含每个智能体的提示词），可继续手动微调')
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields && err.fields.length > 0) {
        message.error(`${COMMON_MESSAGES.validationFailed}：${err.fields.map((f) => `${f.path} ${f.message}`).join('；')}`)
      } else {
        message.error(err instanceof Error ? err.message : 'AI 生成失败')
      }
    },
  })

  const applyTemplate = (templateId: string): void => {
    void api.environments
      .templates()
      .then(({ templates: list }) => {
        const tpl = list.find((t) => t.templateId === templateId)
        if (tpl) message.info(`已选择模板「${tpl.name}」：推荐在对应环境列表页一键创建后进入编辑模式微调。`)
      })
  }

  const submitGen = async (): Promise<void> => {
    if (!genIdea || genIdea.trim().length < 4) {
      message.warning('请先描述你的环境构想（至少 4 个字）')
      return
    }
    if (!genModelId) {
      message.warning('请选择用于生成配置的模型')
      return
    }
    genMutation.mutate({ idea: genIdea.trim(), modelConfigId: genModelId })
  }

  const submit = async (): Promise<void> => {
    setFieldErrors([])
    try {
      const values = await form.validateFields()
      const config = formToConfig(values, editId ?? `env_${Math.random().toString(36).slice(2, 10)}`)
      if (editId) updateMutation.mutate({ id: editId, config })
      else createMutation.mutate(config)
    } catch {
      /* 表单校验失败（客户端） */
    }
  }

  return (
    <div>
      <PageHeader
        title={editId ? '编辑环境' : '环境构建器'}
        description="零代码全要素配置：学习范式、角色提示词、智能体、交换物协议、工作区、经验进化与结局判定，全部可调；可让 LLM 生成草稿后手动微调。"
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
                onChange={(value: BuilderForm['paradigm']) => {
                  if (value === 'cooperative') {
                    form.setFieldsValue({ topology: 'melee', outcomeMode: 'judge' })
                  } else if (value === 'drill') {
                    form.setFieldsValue({ topology: 'melee', outcomeMode: 'rule' })
                  }
                }}
                options={[
                  { value: 'adversarial', label: '对抗 · Agent-RLAF' },
                  { value: 'cooperative', label: '协作 · Agent-RLCF' },
                  { value: 'drill', label: '演练 · 靶场' },
                ]}
              />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(prev, cur) => prev.paradigm !== cur.paradigm}>
              {({ getFieldValue }) => (
                <Form.Item
                  name="topology"
                  label={getFieldValue('paradigm') === 'cooperative' ? '编组方式' : getFieldValue('paradigm') === 'drill' ? '靶场编组' : '对抗拓扑'}
                  rules={[{ required: true }]}
                >
                  <Select
                    style={{ width: 220 }}
                    disabled={getFieldValue('paradigm') !== 'adversarial'}
                    options={[
                      { value: 'symmetric', label: '对称对抗（同角色）' },
                      { value: 'asymmetric', label: '不对称对抗（不同角色）' },
                      { value: 'melee', label: getFieldValue('paradigm') === 'cooperative' ? '自由协作（无固定编组）' : getFieldValue('paradigm') === 'drill' ? '自由演练' : '多方混战' },
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
        <Card type="inner" title="角色定义（智能体的目标与提示词在此全量配置）">
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
                      label="系统提示（身份设定）"
                      rules={[{ required: true, message: '请输入系统提示' }]}
                    >
                      <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'goal']}
                      label="目标（每轮任务指令）"
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
        <Card type="inner" title="智能体槽位（角色实例；按顺序行动，支持设置默认模型与起始轮次）">
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
                    <Button danger size="small" onClick={() => remove(field.name)}>
                      移除
                    </Button>
                  </Space>
                ))}
                <Button size="small" onClick={() => add({ id: `agent-${fields.length + 1}`, name: '', roleId: '' })}>
                  添加智能体
                </Button>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {isDrill ? '演练靶场允许仅 1 名外部挑战者。' : '对抗/协作至少 2 名智能体。'}
                </Typography.Text>
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
        <Card type="inner" title="工作区（智能体的文件空间，可含 SKILLS/MEMORY/工具文件）">
          <Space wrap align="start">
            <Form.Item name="workspaceMode" label="工作区模式" initialValue="private" rules={[{ required: true }]}>
              <Select
                style={{ width: 220 }}
                options={[
                  { value: 'private', label: '独立工作区（各智能体私有）' },
                  { value: 'shared', label: '共享工作区（协作可写）' },
                ]}
              />
            </Form.Item>
            <Form.Item name="toolsEnabled" label="文件工具" valuePropName="checked" initialValue={true}>
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
          </Space>
          <Form.List name={['workspaceTemplate', 'files']}>
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} wrap align="start">
                    <Form.Item
                      name={[field.name, 'path']}
                      label="文件路径"
                      rules={[{ required: true, message: '请输入文件路径' }]}
                    >
                      <Input placeholder="docs/brief.md" style={{ width: 220 }} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'content']}
                      label="初始内容"
                      rules={[{ required: true, message: '请输入初始内容' }]}
                    >
                      <Input.TextArea rows={1} style={{ width: 360 }} />
                    </Form.Item>
                    <Button danger size="small" onClick={() => remove(field.name)}>
                      移除
                    </Button>
                  </Space>
                ))}
                <Button size="small" onClick={() => add({ path: '', content: '' })}>
                  添加初始文件
                </Button>
              </>
            )}
          </Form.List>
        </Card>

        <Divider />
        <Card type="inner" title="经验进化（MEMORY / SKILLS）">
          <Space wrap align="start">
            <Form.Item name="experienceEnabled" label="经验进化" valuePropName="checked" initialValue={true}>
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(prev, cur) => prev.experienceEnabled !== cur.experienceEnabled}>
              {({ getFieldValue }) =>
                getFieldValue('experienceEnabled') ? (
                  <>
                    <Form.Item name="tokenBudget" label="注入 Token 预算" initialValue={2000} rules={[{ required: true }]}>
                      <InputNumber min={100} max={100000} step={100} />
                    </Form.Item>
                    <Form.Item name="recentMemoryLimit" label="近期记忆条数" initialValue={3} rules={[{ required: true }]}>
                      <InputNumber min={1} max={50} />
                    </Form.Item>
                  </>
                ) : null
              }
            </Form.Item>
          </Space>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
            对局后各智能体总结 MEMORY（情景记忆）与 SKILLS（技能文档）写入工作区；下一场自动注入。
          </Typography.Paragraph>
        </Card>

        <Divider />
        <Card type="inner" title="结局判定">
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.paradigm !== cur.paradigm || prev.outcomeMode !== cur.outcomeMode}>
            {({ getFieldValue }) => {
              const isCooperative = getFieldValue('paradigm') === 'cooperative'
              const isDrill = getFieldValue('paradigm') === 'drill'
              const outcomeMode = getFieldValue('outcomeMode')
              return (
                <Space wrap>
                  <Form.Item
                    name="outcomeMode"
                    label={isCooperative ? '团队评分方式' : isDrill ? '演练计分方式' : '判定方式'}
                    initialValue="rule"
                    rules={[{ required: true }]}
                    extra={
                      isCooperative
                        ? '协作环境（Agent-RLCF）必须使用 AI 裁判为团队评分（0-100），所有成员共享团队得分。'
                        : isDrill
                          ? '演练靶场：以挑战者的旗标/识别结果计分。'
                          : undefined
                    }
                  >
                    <Select
                      style={{ width: 260 }}
                      disabled={isCooperative}
                      onChange={(value: string) => {
                        if (value === 'rule') form.setFieldsValue({ ruleEvaluator: 'ai-flavor' })
                      }}
                      options={
                        isCooperative
                          ? [{ value: 'judge', label: 'AI 裁判团队评分（0-100）' }]
                          : isDrill
                            ? [
                                { value: 'rule', label: '规则判定（零和互斥 / 夺旗）' },
                                { value: 'judge', label: 'AI 裁判评审' },
                              ]
                            : [
                                { value: 'rule', label: '规则判定（零和互斥，按下方判定器）' },
                                { value: 'judge', label: 'AI 裁判（需绑定裁判模型）' },
                              ]
                      }
                    />
                  </Form.Item>
                  {!isCooperative && outcomeMode === 'rule' ? (
                    <Form.Item
                      name="ruleEvaluator"
                      label="规则判定器"
                      initialValue="ai-flavor"
                      rules={[{ required: true }]}
                    >
                      <Select
                        style={{ width: 300 }}
                        options={[
                          { value: 'ai-flavor', label: 'ai-flavor（AI 文本辨别，零和）' },
                          { value: 'attack-defense', label: 'attack-defense（攻防识别，零和）' },
                          { value: 'flag-check', label: 'flag-check（CTF 夺旗比例）' },
                        ]}
                      />
                    </Form.Item>
                  ) : null}
                  {!isCooperative && outcomeMode === 'rule' && getFieldValue('ruleEvaluator') === 'flag-check' ? (
                    <Form.Item
                      noStyle
                      shouldUpdate={(prev, cur) => prev.ruleEvaluator !== cur.ruleEvaluator}
                    >
                      {() => (
                        <Form.Item
                          name="flagFlags"
                          label="旗标列表（每行一个 FLAG{...}）"
                          style={{ minWidth: 320 }}
                        >
                          <Input.TextArea rows={2} placeholder={'FLAG{log_anomaly_2026}\nFLAG{temp_cred_rotated}'} />
                        </Form.Item>
                      )}
                    </Form.Item>
                  ) : null}
                  {isCooperative || outcomeMode === 'judge' ? (
                    <Form.Item
                      name="rubric"
                      label={isCooperative ? '团队评分标准（rubric）' : isDrill ? '演练评审标准（rubric）' : '裁判评分标准（rubric）'}
                      rules={[{ required: true, message: 'AI 裁判模式必须填写评分标准' }]}
                      style={{ minWidth: 320 }}
                    >
                      <Input.TextArea
                        rows={2}
                        placeholder={
                          isCooperative
                            ? '例：方案完整性 30 分、多学科协同度 30 分'
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
          <Button type="primary" loading={createMutation.isPending || updateMutation.isPending} onClick={submit}>
            {editId ? '保存修改' : '保存环境'}
          </Button>
          <Button onClick={() => navigate(editId ? `/environments/${editId}` : '/environments')}>取消</Button>
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
            <Typography.Text strong>环境构想</Typography.Text>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                例如：正反两方就「AI 是否有利于长期安全」展开辩论攻防；或构建靶场让外部挑战者尝试突破提示防护
              </Typography.Text>
            </div>
            <Input.TextArea
              rows={4}
              value={genIdea}
              onChange={(e) => setGenIdea(e.target.value)}
              placeholder="描述你想要的玩法：角色、目标、判定方式……"
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
