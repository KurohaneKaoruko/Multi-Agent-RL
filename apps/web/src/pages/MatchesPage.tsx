// 对局记录（全局）：所有环境的对局历史；发起对局入口
import { PlayCircleOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, Table, Tag } from 'antd'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type MatchSummary } from '../api/client'
import { MATCH_STATUS_LABELS, MENU_LABELS } from '../i18n'
import LaunchMatchModal from '../components/LaunchMatchModal'
import PageHeader from '../components/PageHeader'

const statusColor = (status: string): string =>
  status === 'completed' ? 'green' : status === 'failed' ? 'red' : status === 'running' ? 'blue' : 'default'

export default function MatchesPage() {
  const [open, setOpen] = useState(false)
  const matchesQuery = useQuery({ queryKey: ['matches'], queryFn: api.matches.list, refetchInterval: 5000 })
  const matches = matchesQuery.data?.matches ?? []

  return (
    <div>
      <PageHeader
        title={MENU_LABELS.matches}
        description="全部环境的对局历史；点击对局 ID 查看实时事件流、结果与隔离审计。"
        extra={
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => setOpen(true)}>
            发起对局
          </Button>
        }
      />
      <Card className="arlaf-card">
        <Table<MatchSummary>
          rowKey="id"
          loading={matchesQuery.isLoading}
          dataSource={matches}
          pagination={{ pageSize: 10 }}
          columns={[
            {
              title: '对局 ID',
              dataIndex: 'id',
              render: (id: string) => <Link to={`/matches/${id}`}>{id}</Link>,
            },
            { title: '环境', dataIndex: 'environmentName', ellipsis: true },
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
            { title: 'Agent 数', dataIndex: 'agentCount' },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              render: (ts: number) => new Date(ts).toLocaleString('zh-CN'),
            },
          ]}
        />
      </Card>
      <LaunchMatchModal open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
