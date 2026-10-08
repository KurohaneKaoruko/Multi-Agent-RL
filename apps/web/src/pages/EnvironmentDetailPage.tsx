// 对抗环境详情（环境枢纽页）：环境信息 + 本环境对局记录 + 经验库
import { PlayCircleOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, Descriptions, Space, Spin, Table, Tabs, Tag, Typography } from 'antd'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { MatchSummary } from '@arlaf/shared'
import { api } from '../api/client'
import ExperienceBrowser from '../components/ExperienceBrowser'
import LaunchMatchModal from '../components/LaunchMatchModal'
import PageHeader from '../components/PageHeader'
import { MATCH_STATUS_LABELS, TOPOLOGY_LABELS } from '../i18n'

function EnvMatchesTable({ environmentId }: { environmentId: string }) {
  const matchesQuery = useQuery({ queryKey: ['matches'], queryFn: api.matches.list, refetchInterval: 5000 })
  const matches = (matchesQuery.data?.matches ?? []).filter((m) => m.environmentId === environmentId)

  const statusColor = (status: string): string =>
    status === 'completed' ? 'green' : status === 'failed' ? 'red' : status === 'running' ? 'blue' : 'default'

  return (
    <Card className="arlaf-card">
      <Table<MatchSummary>
        rowKey="id"
        loading={matchesQuery.isLoading}
        dataSource={matches}
        pagination={{ pageSize: 8 }}
        size="small"
        columns={[
          {
            title: '对局 ID',
            dataIndex: 'id',
            render: (id: string) => <Link to={`/matches/${id}`}>{id}</Link>,
          },
          {
            title: '状态',
            dataIndex: 'status',
            render: (status: string) => <Tag color={statusColor(status)}>{MATCH_STATUS_LABELS[status] ?? status}</Tag>,
          },
          {
            title: '胜者',
            dataIndex: 'winnerAgentId',
            render: (winner: string | null) =>
              winner ? <Tag color="gold">🏆 {winner}</Tag> : <span style={{ color: '#9ca3af' }}>—</span>,
          },
          {
            title: '创建时间',
            dataIndex: 'createdAt',
            render: (ts: number) => new Date(ts).toLocaleString('zh-CN'),
          },
        ]}
      />
    </Card>
  )
}

export default function EnvironmentDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [launchOpen, setLaunchOpen] = useState(searchParams.get('launch') === '1')

  const envQuery = useQuery({ queryKey: ['environment', id], queryFn: () => api.environments.get(id) })
  const env = envQuery.data

  const closeLaunch = (): void => {
    setLaunchOpen(false)
    if (searchParams.get('launch')) {
      searchParams.delete('launch')
      setSearchParams(searchParams, { replace: true })
    }
  }

  if (envQuery.isLoading) return <Spin tip="加载环境…" />
  if (!env) {
    return (
      <Card>
        <Typography.Text type="secondary">环境不存在或已被删除。</Typography.Text>
        <Button type="link" onClick={() => navigate('/environments')}>
          返回环境列表
        </Button>
      </Card>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        title={env.name}
        description={env.description || '（无描述）'}
        extra={
          <>
            <Tag color="processing">{TOPOLOGY_LABELS[env.topology] ?? env.topology}</Tag>
            {env.isBuiltinTemplate ? <Tag color="gold">内置模板</Tag> : null}
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => {
                setLaunchOpen(true)
                setSearchParams(searchParams)
              }}
            >
              发起对局
            </Button>
          </>
        }
      />

      <Card className="arlaf-card">
        <Descriptions column={3} size="small">
          <Descriptions.Item label="角色">
            <Space size={4} wrap>
              {env.config.roles.map((r) => (
                <Tag key={r.id} color="geekblue">
                  {r.name}
                </Tag>
              ))}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="智能体">
            <Space size={4} wrap>
              {env.config.agents.map((a) => (
                <Tag key={a.id}>
                  {a.name}
                  {a.defaultModelConfigId ? '（已绑默认模型）' : ''}
                </Tag>
              ))}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="判定方式">
            {env.config.outcome.mode === 'judge' ? 'AI 裁判' : `规则判定（${env.config.outcome.evaluator}）`}
          </Descriptions.Item>
          <Descriptions.Item label="轮次">{env.config.turns.rounds} 轮</Descriptions.Item>
          <Descriptions.Item label="交换物">{env.config.exchanges.length} 项协议</Descriptions.Item>
          <Descriptions.Item label="经验进化">
            {env.config.experience.enabled ? `开启（预算 ${env.config.experience.tokenBudget} tokens）` : '关闭'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card className="arlaf-card" styles={{ body: { paddingTop: 8 } }}>
        <Tabs
          defaultActiveKey="matches"
          items={[
            {
              key: 'matches',
              label: '对局记录',
              children: <EnvMatchesTable environmentId={env.id} />,
            },
            {
              key: 'experience',
              label: '经验库',
              children: <ExperienceBrowser environmentId={env.id} env={env.config} />,
            },
          ]}
        />
      </Card>

      <LaunchMatchModal open={launchOpen} onClose={closeLaunch} defaultEnvironmentId={env.id} />
    </div>
  )
}
