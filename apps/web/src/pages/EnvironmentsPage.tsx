// 对抗环境列表（14.1 一部分）：模板一键实例化 / 管理
import { PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Col, Modal, Popconfirm, Row, Select, Space, Tag, Typography } from 'antd'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, api } from '../api/client'
import { COMMON_MESSAGES, TOPOLOGY_LABELS, MENU_LABELS } from '../i18n'
import PageHeader from '../components/PageHeader'

export default function EnvironmentsPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [templateOpen, setTemplateOpen] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)

  const envQuery = useQuery({ queryKey: ['environments'], queryFn: api.environments.list })
  const templatesQuery = useQuery({ queryKey: ['templates'], queryFn: api.environments.templates })
  const environments = (envQuery.data?.environments ?? []).filter((e) => e.paradigm !== 'cooperative')
  const templates = (templatesQuery.data?.templates ?? []).filter((t) => t.paradigm !== 'cooperative')

  const invalidate = (): void => void queryClient.invalidateQueries({ queryKey: ['environments'] })
  const showApiError = (err: unknown): void => {
    if (err instanceof ApiError && err.fields && err.fields.length > 0) {
      message.error(`${COMMON_MESSAGES.validationFailed}：${err.fields.map((f) => `${f.path} ${f.message}`).join('；')}`)
    } else {
      message.error(err instanceof Error ? err.message : COMMON_MESSAGES.operationFailed)
    }
  }

  const createFromTemplate = useMutation({
    mutationFn: (templateId: string) => api.environments.createFromTemplate({ templateId }),
    onSuccess: (view) => {
      message.success('环境已创建，可发起对局')
      setTemplateOpen(false)
      invalidate()
      void view
    },
    onError: showApiError,
  })
  const deleteEnv = useMutation({
    mutationFn: (id: string) => api.environments.remove(id),
    onSuccess: () => {
      message.success(COMMON_MESSAGES.deleted)
      invalidate()
    },
    onError: showApiError,
  })

  const confirmTemplate = (): void => {
    if (!selectedTemplate) {
      message.warning('请先选择一个模板')
      return
    }
    createFromTemplate.mutate(selectedTemplate)
  }

  return (
    <div>
      <PageHeader
        title={MENU_LABELS.environments}
        description="对抗范式（Agent-RLAF）：智能体在互斥胜负下对抗进化——从内置模板一键起步，或用构建器自定义角色、回合与规则。"
        extra={
          <>
            <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => setTemplateOpen(true)}>
              从内置模板一键创建
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => navigate('/environments/new')}>
              自定义环境构建器
            </Button>
          </>
        }
      />
      <Row gutter={[16, 16]}>
        {environments.map((env) => (
          <Col xs={24} sm={12} lg={8} key={env.id}>
            <Card
              className="arlaf-card arlaf-card-hover"
              style={{ position: 'relative', overflow: 'hidden' }}
              title={
                <span>
                  {env.name}
                  {env.isBuiltinTemplate ? <Tag style={{ marginLeft: 8 }} color="gold">内置模板</Tag> : null}
                </span>
              }
              extra={<Tag color="processing">{TOPOLOGY_LABELS[env.topology] ?? env.topology}</Tag>}
              actions={[
                <Link to={`/environments/${env.id}`} key="detail">
                  详情 / 经验
                </Link>,
                <Link to={`/environments/${env.id}?launch=1`} key="run">
                  发起对局
                </Link>,
                <Popconfirm
                  key="del"
                  title={COMMON_MESSAGES.deleteConfirm}
                  onConfirm={() => deleteEnv.mutate(env.id)}
                  disabled={env.isBuiltinTemplate}
                >
                  <span style={{ color: env.isBuiltinTemplate ? '#ccc' : '#ff4d4f' }}>删除</span>
                </Popconfirm>,
              ]}
            >
              <div className="arlaf-env-strip" style={{ position: 'absolute', top: 0, left: 0, right: 0 }} />
              <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ minHeight: 44 }}>
                {env.description || '（无描述）'}
              </Typography.Paragraph>
              <Space size={6} wrap>
                {env.config.roles.map((role) => (
                  <Tag key={role.id} color="geekblue">
                    {role.name}
                  </Tag>
                ))}
                <Tag>{env.config.agents.length} 个 Agent</Tag>
                <Tag>{env.config.turns.rounds} 轮</Tag>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
      <Modal
        title="从内置模板创建环境"
        open={templateOpen}
        onOk={confirmTemplate}
        confirmLoading={createFromTemplate.isPending}
        onCancel={() => setTemplateOpen(false)}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Select
            style={{ width: '100%' }}
            placeholder="选择内置模板"
            value={selectedTemplate}
            onChange={setSelectedTemplate}
            options={templates.map((t) => ({ value: t.templateId, label: t.name }))}
          />
          {templates.find((t) => t.templateId === selectedTemplate)?.description}
        </Space>
      </Modal>
    </div>
  )
}
