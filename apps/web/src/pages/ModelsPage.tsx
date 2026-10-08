// 模型与 API 管理（13.1）：列表/新增/编辑、连通性测试、密钥脱敏
import { PlusOutlined, ApiOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Form, Input, Modal, Popconfirm, Space, Table, Tag, Typography } from 'antd'
import { useState } from 'react'
import { ApiError, api, type ModelConfigView } from '../api/client'
import { COMMON_MESSAGES } from '../i18n'
import PageHeader from '../components/PageHeader'
import { MENU_LABELS } from '../i18n'

interface ModelFormValues {
  name: string
  baseUrl: string
  apiKey?: string
  model: string
  temperature?: number
}

function toInput(values: ModelFormValues) {
  return {
    name: values.name,
    baseUrl: values.baseUrl,
    apiKey: values.apiKey ?? '',
    model: values.model,
    params: { temperature: values.temperature },
  }
}

export default function ModelsPage() {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm<ModelFormValues>()
  const [editing, setEditing] = useState<ModelConfigView | null>(null)
  const [open, setOpen] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)

  const modelsQuery = useQuery({ queryKey: ['models'], queryFn: api.models.list })
  const models = modelsQuery.data?.models ?? []

  const invalidate = (): void => void queryClient.invalidateQueries({ queryKey: ['models'] })
  const showApiError = (err: unknown): void => {
    if (err instanceof ApiError && err.fields && err.fields.length > 0) {
      message.error(`${COMMON_MESSAGES.validationFailed}：${err.fields.map((f) => `${f.path} ${f.message}`).join('；')}`)
    } else {
      message.error(err instanceof Error ? err.message : COMMON_MESSAGES.operationFailed)
    }
  }

  const createMutation = useMutation({
    mutationFn: (values: ModelFormValues) => api.models.create(toInput(values)),
    onSuccess: () => {
      message.success(COMMON_MESSAGES.saveSuccess)
      setOpen(false)
      invalidate()
    },
    onError: showApiError,
  })
  const updateMutation = useMutation({
    mutationFn: (input: { id: string; values: ModelFormValues }) => api.models.update(input.id, toInput(input.values)),
    onSuccess: () => {
      message.success(COMMON_MESSAGES.saveSuccess)
      setOpen(false)
      invalidate()
    },
    onError: showApiError,
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.models.remove(id),
    onSuccess: () => {
      message.success(COMMON_MESSAGES.deleted)
      invalidate()
    },
    onError: showApiError,
  })
  const testMutation = useMutation({
    mutationFn: (id: string) => api.models.test(id),
    onSuccess: (res) => {
      setTesting(null)
      if (res.ok) message.success(res.message)
      else modal.warning({ title: '连通性测试失败', content: res.message })
    },
    onError: (err) => {
      setTesting(null)
      showApiError(err)
    },
  })

  const openCreate = (): void => {
    setEditing(null)
    form.resetFields()
    setOpen(true)
  }
  const openEdit = (record: ModelConfigView): void => {
    setEditing(record)
    form.setFieldsValue({
      name: record.name,
      baseUrl: record.baseUrl,
      model: record.model,
      apiKey: undefined, // 编辑时不回显密钥；留空表示保留原密钥
      temperature: (record.params as { temperature?: number }).temperature,
    })
    setOpen(true)
  }

  const submit = async (): Promise<void> => {
    const values = await form.validateFields()
    if (editing) await updateMutation.mutateAsync({ id: editing.id, values })
    else await createMutation.mutateAsync(values)
  }

  return (
    <div>
      <PageHeader
        title={MENU_LABELS.models}
        description="「模型」= 一套可复用的模型接入配置（OpenAI 兼容端点 + 密钥 + 参数）。密钥仅保存于服务端，界面只显示尾 4 位。"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            添加模型
          </Button>
        }
      />
      <Card className="arlaf-card">
      <Table<ModelConfigView>
        rowKey="id"
        loading={modelsQuery.isLoading}
        dataSource={models}
        pagination={false}
        columns={[
          {
            title: '名称',
            dataIndex: 'name',
            width: 170,
            render: (name: string) => <Typography.Text strong>{name}</Typography.Text>,
          },
          { title: '模型', dataIndex: 'model', width: 170, ellipsis: true },
          { title: 'Base URL', dataIndex: 'baseUrl', ellipsis: true },
          {
            title: 'API Key',
            dataIndex: 'apiKeyTail',
            width: 120,
            render: (tail: string) => <Tag>{tail}</Tag>,
          },
          {
            title: '操作',
            width: 235,
            render: (_, record) => (
              <Space size={4}>
                <Button
                  size="small"
                  icon={<ApiOutlined />}
                  loading={testing === record.id}
                  onClick={() => {
                    setTesting(record.id)
                    testMutation.mutate(record.id)
                  }}
                >
                  测试连通
                </Button>
                <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
                  编辑
                </Button>
                <Popconfirm
                  title={COMMON_MESSAGES.deleteConfirm}
                  onConfirm={() => deleteMutation.mutate(record.id)}
                >
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      </Card>
      <Modal
        title={editing ? '编辑模型配置' : '新增模型配置'}
        open={open}
        onOk={submit}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        onCancel={() => setOpen(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入配置名称' }]}
          >
            <Input placeholder="如 DeepSeek-V3" />
          </Form.Item>
          <Form.Item
            name="baseUrl"
            label="Base URL（OpenAI 兼容端点）"
            rules={[{ required: true, message: '请输入 Base URL' }]}
          >
            <Input placeholder="https://api.deepseek.com/v1" />
          </Form.Item>
          <Form.Item
            name="model"
            label="模型名（model）"
            rules={[{ required: true, message: '请输入模型名' }]}
          >
            <Input placeholder="deepseek-chat" />
          </Form.Item>
          <Form.Item
            name="apiKey"
            label={editing ? 'API Key（留空表示保留原密钥）' : 'API Key（本地服务可为空）'}
          >
            <Input.Password placeholder={editing ? '留空保留原密钥' : 'sk-...'} autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="temperature" label="Temperature（可选）">
            <Input type="number" min={0} max={2} step={0.1} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
