// 经验库浏览器（在对抗/协作/演练环境详情页内使用）：按 Agent 浏览 MEMORY/SKILLS、进化时间线、胜率
import { useQuery } from '@tanstack/react-query'
import {
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Input,
  List,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from 'antd'
import { DownloadOutlined, FileTextOutlined } from '@ant-design/icons'
import { useMemo, useState } from 'react'
import type { EnvironmentConfig, ExperienceDocDetail } from '@marl/shared'
import { api } from '../api/client'
import { KIND_LABELS } from '../i18n'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** 经验文档 Markdown 渲染（GFM 表格/任务列表） */
function Markdown({ content }: { content: string }) {
  return (
    <div className="arlaf-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

export default function ExperienceBrowser({
  environmentId,
  env,
}: {
  environmentId: string
  env: EnvironmentConfig
}) {
  const [agentId, setAgentId] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<'all' | 'memory' | 'skills'>('all')
  const [keyword, setKeyword] = useState('')
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
    enabled: agentId != null,
    refetchInterval: 15_000,
  })

  const allDocs = docsQuery.data?.docs ?? []
  const docs = useMemo(() => {
    return allDocs
      .filter((d) => kindFilter === 'all' || d.kind === kindFilter)
      .filter((d) => !keyword || d.summary.includes(keyword) || d.path.includes(keyword))
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [allDocs, kindFilter, keyword])

  const agentStat = (statsQuery.data?.stats ?? []).find((s) => s.agentId === agentId)
  const winRate = agentStat && agentStat.total > 0 ? Math.round((agentStat.wins / agentStat.total) * 100) : null
  const timeline = timelineQuery.data?.timeline ?? []

  const openDoc = async (id: string): Promise<void> => {
    const detail = await api.experience.get(id)
    setViewing(detail)
  }

  /** 时间线条目 → 对应的经验文档（按 kind + 创建时间匹配） */
  const openTimelineDoc = (kind: string, ts: number): void => {
    const doc = allDocs.find((d) => d.kind === kind && d.createdAt === ts)
    if (doc) void openDoc(doc.id)
  }

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          style={{ width: 260 }}
          placeholder="选择智能体"
          value={agentId}
          onChange={(v) => {
            setAgentId(v)
            setKindFilter('all')
            setKeyword('')
          }}
          options={agentOptions}
        />
        {agentId ? (
          <Segmented
            value={kindFilter}
            onChange={(v) => setKindFilter(v as 'all' | 'memory' | 'skills')}
            options={[
              { value: 'all', label: '全部' },
              { value: 'skills', label: 'SKILLS' },
              { value: 'memory', label: 'MEMORY' },
            ]}
          />
        ) : null}
      </Space>

      {!agentId ? (
        <Empty description="选择智能体后，浏览其对局沉淀的经验文档与进化轨迹" />
      ) : (
        <Row gutter={16}>
          <Col span={15}>
            <Card
              title="经验文档（训练产出 skills / docs）"
              size="small"
              extra={
                <Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {docs.length} 份
                  </Typography.Text>
                </Space>
              }
            >
              <Input.Search
                allowClear
                placeholder="按变更摘要 / 文件路径搜索"
                style={{ marginBottom: 12 }}
                onChange={(e) => setKeyword(e.target.value)}
              />
              {docsQuery.isLoading ? (
                <Spin style={{ display: 'block', margin: '24px auto' }} />
              ) : docs.length === 0 ? (
                <Empty description="暂无符合条件的经验文档（先去跑几场对局吧）" />
              ) : (
                <List
                  dataSource={docs}
                  renderItem={(doc) => (
                    <List.Item
                      style={{ cursor: 'pointer', padding: '10px 4px' }}
                      onClick={() => void openDoc(doc.id)}
                      actions={[
                        <Tooltip title="查看" key="view">
                          <Button
                            size="small"
                            icon={<FileTextOutlined />}
                            onClick={(e) => {
                              e.stopPropagation()
                              void openDoc(doc.id)
                            }}
                          />
                        </Tooltip>,
                        <Tooltip title="导出 Markdown" key="export">
                          <Button
                            size="small"
                            icon={<DownloadOutlined />}
                            onClick={(e) => {
                              e.stopPropagation()
                              window.open(api.experience.exportUrl(doc.id), '_blank')
                            }}
                          />
                        </Tooltip>,
                      ]}
                    >
                      <List.Item.Meta
                        title={
                          <Space size={6}>
                            <Tag color={doc.kind === 'skills' ? 'purple' : 'blue'} style={{ marginRight: 0 }}>
                              {KIND_LABELS[doc.kind] ?? doc.kind}
                            </Tag>
                            <Typography.Text strong style={{ fontSize: 13 }}>
                              {doc.summary || '（无变更摘要）'}
                            </Typography.Text>
                          </Space>
                        }
                        description={
                          <Space size={10} style={{ fontSize: 12, color: '#9ca3af' }}>
                            <span>{new Date(doc.createdAt).toLocaleString('zh-CN')}</span>
                            <span>对局 {doc.matchId}</span>
                            <span>{doc.path}</span>
                          </Space>
                        }
                      />
                    </List.Item>
                  )}
                />
              )}
            </Card>
          </Col>
          <Col span={9}>
            <Card size="small" style={{ marginBottom: 16 }}>
              <Row gutter={12}>
                <Col span={8}>
                  <Statistic title="累计对局" value={agentStat?.total ?? 0} />
                </Col>
                <Col span={10}>
                  <Statistic title="胜率（本环境）" value={winRate == null ? '—' : winRate} suffix={winRate == null ? '' : '%'} />
                </Col>
                <Col span={6}>
                  <Statistic title="经验文档" value={allDocs.length} />
                </Col>
              </Row>
              {winRate != null ? (
                <Progress
                  percent={winRate}
                  size="small"
                  strokeColor={winRate >= 50 ? '#10b981' : '#f59e0b'}
                  style={{ marginTop: 4, marginBottom: 4 }}
                />
              ) : null}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                经验按「环境 × 智能体」积累：同一智能体在不同环境的经验相互独立。
              </Typography.Text>
            </Card>
            <Card title="进化时间线（点击查看当次沉淀的文档）" size="small">
              {timelineQuery.isLoading ? (
                <Spin style={{ display: 'block', margin: '16px auto' }} />
              ) : timeline.length === 0 ? (
                <Empty description="暂无进化记录" />
              ) : (
                <Timeline
                  items={timeline.map((entry) => ({
                    color: entry.kind === 'skills' ? 'purple' : 'blue',
                    children: (
                      <Space direction="vertical" size={0} style={{ cursor: 'pointer' }} onClick={() => openTimelineDoc(entry.kind, entry.ts)}>
                        <Space size={6}>
                          <Tag style={{ marginRight: 0 }} color={entry.kind === 'skills' ? 'purple' : 'blue'}>
                            {KIND_LABELS[entry.kind] ?? entry.kind}
                          </Tag>
                          <Typography.Text style={{ fontSize: 12, color: '#6b7280' }}>
                            {new Date(entry.ts).toLocaleString('zh-CN')}
                          </Typography.Text>
                        </Space>
                        <Typography.Text style={{ fontSize: 13 }}>{entry.changesSummary}</Typography.Text>
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
        title={
          viewing ? (
            <Space>
              <Tag color={viewing.meta.kind === 'skills' ? 'purple' : 'blue'}>
                {KIND_LABELS[viewing.meta.kind] ?? viewing.meta.kind}
              </Tag>
              <Typography.Text strong>{viewing.meta.summary || viewing.meta.agentId}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                {new Date(viewing.meta.createdAt).toLocaleString('zh-CN')} · {viewing.content.length} 字符
              </Typography.Text>
            </Space>
          ) : (
            ''
          )
        }
        open={viewing != null}
        onClose={() => setViewing(null)}
        width={720}
        extra={
          viewing ? (
            <Space>
              <Button icon={<DownloadOutlined />} href={api.experience.exportUrl(viewing.meta.id)} target="_blank">
                导出 Markdown
              </Button>
            </Space>
          ) : null
        }
      >
        {viewing ? <Markdown content={viewing.content} /> : null}
      </Drawer>
    </div>
  )
}
