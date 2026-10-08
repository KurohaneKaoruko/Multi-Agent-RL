// 发起对局弹窗（对局记录页与环境详情页共用）
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Form, Modal, Select } from 'antd'
import { useNavigate } from 'react-router-dom'
import { ApiError, api } from '../api/client'
import { COMMON_MESSAGES } from '../i18n'

interface LaunchFormValues {
  environmentId: string
  [key: `model_${string}`]: string | undefined
  judgeModel?: string
}

export default function LaunchMatchModal({
  open,
  onClose,
  defaultEnvironmentId,
}: {
  open: boolean
  onClose: () => void
  defaultEnvironmentId?: string
}) {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form] = Form.useForm<LaunchFormValues>()

  const envQuery = useQuery({
    queryKey: ['environments'],
    queryFn: api.environments.list,
    enabled: open,
  })
  const modelsQuery = useQuery({
    queryKey: ['models'],
    queryFn: api.models.list,
    enabled: open,
  })
  const environments = envQuery.data?.environments ?? []
  const models = modelsQuery.data?.models ?? []

  const selectedEnvId = defaultEnvironmentId ?? Form.useWatch('environmentId', form)
  const selectedEnv = environments.find((e) => e.id === selectedEnvId)
  const modelOptions = models.map((m) => ({ value: m.id, label: `${m.name}（${m.model}）` }))

  const launch = useMutation({
    mutationFn: async (values: LaunchFormValues) => {
      const envId = selectedEnvId
      const env = environments.find((e) => e.id === envId)
      if (!env) throw new Error('请选择环境')
      const record = values as unknown as Record<string, string | undefined>
      const bindings = env.config.agents.map((agent) => ({
        agentId: agent.id,
        // 默认模型：环境内智能体自带的绑定优先，其次表单填写
        modelConfigId:
          record[`model_${agent.id}`] ?? agent.defaultModelConfigId ?? '',
      }))
      const judgeBinding =
        env.config.outcome.mode === 'judge'
          ? [{ agentId: 'judge', modelConfigId: record.judgeModel ?? '' }]
          : []
      const validation = await api.environments.validate(envId, [...bindings, ...judgeBinding])
      if (!validation.ok) {
        throw new ApiError('对局前校验未通过', validation.fields)
      }
      const created = await api.matches.create({
        environmentId: envId,
        bindings: [...bindings, ...judgeBinding.filter((b) => b.modelConfigId)],
      })
      await api.matches.start(created.id)
      return created.id
    },
    onSuccess: (matchId) => {
      message.success('对局已启动')
      void queryClient.invalidateQueries({ queryKey: ['matches'] })
      onClose()
      navigate(`/matches/${matchId}`)
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields && err.fields.length > 0) {
        message.error(
          `${COMMON_MESSAGES.validationFailed}：${err.fields.map((f) => `${f.path} ${f.message}`).join('；')}`,
        )
      } else {
        message.error(err instanceof Error ? err.message : COMMON_MESSAGES.operationFailed)
      }
    },
  })

  return (
    <Modal
      title="发起对局"
      open={open}
      onCancel={onClose}
      onOk={async () => {
        const values = await form.validateFields()
        launch.mutate(values)
      }}
      confirmLoading={launch.isPending}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" initialValues={{ environmentId: defaultEnvironmentId }}>
        <Form.Item name="environmentId" label="环境" rules={[{ required: true, message: '请选择环境' }]}>
          <Select
            placeholder="选择对抗环境"
            options={environments.map((e) => ({ value: e.id, label: e.name }))}
            disabled={defaultEnvironmentId != null}
          />
        </Form.Item>
        {selectedEnv ? (
          <>
            {selectedEnv.config.agents.map((agent) => (
              <Form.Item
                key={agent.id}
                name={`model_${agent.id}`}
                label={`Agent「${agent.name}」（${agent.id}）绑定模型`}
                initialValue={agent.defaultModelConfigId}
                rules={[{ required: true, message: '请为该 Agent 选择模型' }]}
              >
                <Select placeholder="选择模型配置" options={modelOptions} />
              </Form.Item>
            ))}
            {selectedEnv.config.outcome.mode === 'judge' ? (
              <Form.Item
                name="judgeModel"
                label="裁判模型（judge）"
                rules={[{ required: true, message: '该环境需要 AI 裁判' }]}
              >
                <Select placeholder="选择裁判模型" options={modelOptions} />
              </Form.Item>
            ) : null}
          </>
        ) : null}
      </Form>
    </Modal>
  )
}
