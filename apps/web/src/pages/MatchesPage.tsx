// 对局记录（全局）：所有环境的对局历史；发起对局入口
// 批量连续训练的同批次对局（batchId 相同）合并为一行展开展示
import { PlayCircleOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, Table, Tag } from 'antd'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type MatchSummary } from '../api/client'
import { groupMatchesIntoRows, statusColor, type MatchRowLikeWithMembers } from '../lib/match-rows'
import { MATCH_STATUS_LABELS, MENU_LABELS } from '../i18n'
import LaunchMatchModal from '../components/LaunchMatchModal'
import PageHeader from '../components/PageHeader'

/** 列表行：单场对局直接一行；同批次对局折叠为首场一行（batchSize>1 时可展开） */
type MatchRowView = MatchRowLikeWithMembers<MatchSummary>

export default function MatchesPage() {
  const [open, setOpen] = useState(false)
  const matchesQuery = useQuery({ queryKey: ['matches'], queryFn: api.matches.list, refetchInterval: 5000 })
  const matches = matchesQuery.data?.matches ?? []

  // 分组：batchId 相同的连续对局合并（后端按 createdAt DESC 返回，批次成员保持相邻）
  const rows = useMemo<MatchRowView[]>(() => groupMatchesIntoRows(matches), [matches])

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
        <Table<MatchRowView>
          rowKey="id"
          loading={matchesQuery.isLoading}
          dataSource={rows}
          pagination={{ pageSize: 10 }}
          columns={[
            {
              title: '对局 ID',
              dataIndex: 'id',
              render: (id: string, row) =>
                row.batchMembers && row.batchMembers.length > 1 ? (
                  <span>
                    <Link to={`/matches/${id}`}>{id}</Link>
                    <Tag color="purple" style={{ marginLeft: 8 }}>
                      批量 {row.batchMembers.length} 场
                    </Tag>
                  </span>
                ) : (
                  <Link to={`/matches/${id}`}>{id}</Link>
                ),
            },
            { title: '环境', dataIndex: 'environmentName', ellipsis: true },
            {
              title: '状态',
              dataIndex: 'status',
              render: (status: string, row) => {
                const tag = <Tag color={statusColor(status)}>{MATCH_STATUS_LABELS[status] ?? status}</Tag>
                if (row.batchMembers && row.batchMembers.length > 1) {
                  const done = row.batchMembers.filter((m) => m.status === 'completed').length
                  const failed = row.batchMembers.filter((m) => m.status === 'failed').length
                  return (
                    <span>
                      {tag}
                      <span style={{ color: '#6b7280', marginLeft: 6 }}>
                        {done}/{row.batchMembers.length} 完成
                        {failed > 0 ? ` · ${failed} 败` : ''}
                      </span>
                    </span>
                  )
                }
                return tag
              },
            },
            {
              title: '胜者',
              dataIndex: 'winnerAgentId',
              render: (winner: string | null, row) => {
                if (row.batchMembers && row.batchMembers.length > 1) {
                  const winners = row.batchMembers
                    .map((m) => m.winnerAgentId)
                    .filter((w): w is string => w != null)
                  if (winners.length === 0) return <span style={{ color: '#9ca3af' }}>—</span>
                  return <Tag color="gold">🏆 {winners.join(' → ')}</Tag>
                }
                return winner ? (
                  <Tag color="gold">🏆 {winner}</Tag>
                ) : (
                  <span style={{ color: '#9ca3af' }}>—</span>
                )
              },
            },
            { title: 'Agent 数', dataIndex: 'agentCount' },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              render: (ts: number) => new Date(ts).toLocaleString('zh-CN'),
            },
          ]}
          expandable={{
            rowExpandable: (row) => (row.batchMembers?.length ?? 0) > 1,
            expandedRowRender: (row) => (
              <Table<MatchSummary>
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={row.batchMembers}
                columns={[
                  {
                    title: '场次',
                    render: (_: unknown, m) =>
                      m.batchIndex != null ? `第 ${m.batchIndex} 场` : '—',
                  },
                  {
                    title: '对局 ID',
                    dataIndex: 'id',
                    render: (id: string) => <Link to={`/matches/${id}`}>{id}</Link>,
                  },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    render: (status: string) => (
                      <Tag color={statusColor(status)}>{MATCH_STATUS_LABELS[status] ?? status}</Tag>
                    ),
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
            ),
          }}
        />
      </Card>
      <LaunchMatchModal open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
