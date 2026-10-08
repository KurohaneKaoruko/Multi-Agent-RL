// 经验库浏览器（在对抗环境详情页内使用）：按 Agent 浏览 MEMORY/SKILLS、进化时间线、胜率
import { useQuery } from '@tanstack/react-query'
import { Button, Card, Col, Drawer, Empty, Row, Select, Space, Spin, Statistic, Table, Tag, Timeline, Typography } from 'antd'
import { useState } from 'react'
import type { EnvironmentConfig } from '@marl/shared'
import { api, type ExperienceDocDetail } from '../api/client'
import { KIND_LABELS } from '../i18n'

/** 在指定对抗环境内浏览经验（环境由详情页锁定，此处仅选择 Agent） */
export default function ExperienceBrowser({
  environmentId,
  env,
}: {
  environmentId: string
  env: EnvironmentConfig
}) {
  const [agentId, setAgentId] = useState<string | null>(null)
  const [viewing, setViewing] = useState<ExperienceDocDetail | null>(null)

  const agentOptions = env.agents.map((a) => ({ value: a.id, label: `${a.name}（${a.id}）` }))

  const docsQuery = useQuery({
    queryKey: ['experience', environmentId, agentId],
    queryFn: () => api.experience.list({ environmentId, agentId: agentId ?? undefined }),
    enabled: agentId != null,
  })
  const timelineQuery = useQuery({
    queryKey: ['experience-timeline', environmentId, agentId],
    queryFn: () => api.experience.timeline(environmentId, agentId!),
    enabled: agentId != null,
  })
  const statsQuery = useQuery({
    queryKey: ['stats', environmentId],
    queryFn: () => api.stats(environmentId),
    refetchInterval: 15_000, // 对局进行中胜率会变化，定时刷新
  })

  const docs = docsQuery.data?.docs ?? []
  const agentStat = (statsQuery.data?.stats ?? []).find((s) => s.agentId === agentId)
  const winRate = agentStat && agentStat.total > 0 ? Math.round((agentStat.wins / agentStat.total) * 100) : null
  const timeline = timelineQuery.data?.timeline ?? []

  const openDoc = async (id: string): Promise<void> => {
    const detail = await api.experience.get(id)
    setViewing(detail)
  }

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          style={{ width: 260 }}
          placeholder="选择 Agent"
          value={agentId}
          onChange={setAgentId}
          options={agentOptions}
        />
        {!agentId ? (
          <Typography.Text type="secondary">选择 Agent 以查看其训练产出的经验。</Typography.Text>
        ) : null}
      </Space>

      {!agentId ? (
        <Empty description="请选择 Agent" />
      ) : (
        <Row gutter={16}>
          <Col span={14}>
            <Card title="经验文档（训练产出 skills / docs）" size="small">
              <Table
                rowKey="id"
                loading={docsQuery.isLoading}
                dataSource={docs}
                pagination={{ pageSize: 8 }}
                size="small"
                columns={[
                  {
                    title: '类型',
                    dataIndex: 'kind',
                    width: 140,
                    render: (kind: string) => (
                      <Tag color={kind === 'skills' ? 'purple' : 'blue'}>{KIND_LABELS[kind] ?? kind}</Tag>
                    ),
                  },
                  { title: '变更摘要', dataIndex: 'summary', ellipsis: true },
                  {
                    title: '时间',
                    dataIndex: 'createdAt',
                    width: 160,
                    render: (ts: number) => new Date(ts).toLocaleString('zh-CN'),
                  },
                  {
                    title: '操作',
                    width: 140,
                    render: (_, record) => (
                      <Space>
                        <Button size="small" onClick={() => void openDoc(record.id)}>
                          查看
                        </Button>
                        <Button size="small" href={api.experience.exportUrl(record.id)} target="_blank">
                          导出
                        </Button>
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>
          </Col>
          <Col span={10}>
            <Card size="small" style={{ marginBottom: 16 }}>
              <Row gutter={16}>
                <Col span={12}>
                  <Statistic title="累计对局" value={agentStat?.total ?? 0} />
                </Col>
                <Col span={12}>
                  <Statistic title="胜率（本环境）" value={winRate == null ? '—' : `${winRate}%`} />
                </Col>
              </Row>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                经验按「环境 × Agent」积累：同一智能体在不同环境的经验相互独立。
              </Typography.Text>
            </Card>
            <Card title="进化时间线（MEMORY/SKILLS 变更）" size="small">
              {timelineQuery.isLoading ? (
                <Spin />
              ) : timeline.length === 0 ? (
                <Empty description="暂无进化记录" />
              ) : (
                <Timeline
                  items={timeline.map((entry) => ({
                    color: entry.kind === 'skills' ? 'purple' : 'blue',
                    children: (
                      <Space direction="vertical" size={0}>
                        <Typography.Text>
                          {new Date(entry.ts).toLocaleString('zh-CN')}｜{KIND_LABELS[entry.kind] ?? entry.kind}
                        </Typography.Text>
                        <Typography.Text type="secondary">{entry.changesSummary}</Typography.Text>
                      </Space>
                    ),
                  }))}
                />
              )}
            </Card>
          </Col>
        </Row>
      )}

      <Drawer
        title={viewing ? `${KIND_LABELS[viewing.meta.kind]}｜${viewing.meta.agentId}` : ''}
        open={viewing != null}
        onClose={() => setViewing(null)}
        width={640}
        extra={
          viewing ? (
            <Button type="primary" href={api.experience.exportUrl(viewing.meta.id)} target="_blank">
              导出 Markdown
            </Button>
          ) : null
        }
      >
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{viewing?.content}</pre>
      </Drawer>
    </div>
  )
}
