// 对局详情（15.1 实时观察 + 15.2 回放 + 16.1 结果与隔离审计）
import { useQuery } from '@tanstack/react-query'
import { Alert, Card, Col, Descriptions, Row, Space, Spin, Statistic, Tag, Timeline, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { MatchEventEnvelope } from '@marl/shared'
import { api } from '../api/client'
import { subscribeMatchEvents } from '../api/ws'
import { MATCH_STATUS_LABELS } from '../i18n'
import PageHeader from '../components/PageHeader'

const EVENT_LABELS: Record<string, string> = {
  'match.started': '对局开始',
  'round.started': '回合开始',
  'round.completed': '回合结束',
  'agent.action_started': 'Agent 开始行动',
  'agent.action': 'Agent 行动',
  'artifact.delivered': '交换物投递',
  'access.denied': '越权访问被拒',
  'injection.recorded': '经验注入',
  'llm.retry': '模型重试',
  'judge.invalid_output': '裁判输出异常',
  'judge.verdict': '裁判判定',
  'experience.summarized': '经验总结',
  'match.completed': '对局完成',
  'match.failed': '对局失败',
}

function describeEvent(
  envelope: MatchEventEnvelope,
): { label: string; detail: string; color?: string; agentId?: string } {
  const { event } = envelope
  const p = event.payload as Record<string, unknown>
  const agentId = typeof p.agentId === 'string' ? p.agentId : undefined
  switch (event.type) {
    case 'agent.action_started':
      return { label: `${String(p.agentId)} 开始行动`, detail: '', agentId }
    case 'round.started':
      return { label: `第 ${String(p.round)} 轮开始`, detail: '' }
    case 'round.completed':
      return { label: `第 ${String(p.round)} 轮结束`, detail: '' }
    case 'agent.action':
      return { label: `${String(p.agentId)} 的行动`, detail: String(p.content ?? ''), agentId }
    case 'artifact.delivered':
      return {
        label: `📨 投递 ${String(p.artifact)}：${String(p.fromAgentId)} → ${String(p.toAgentId)}`,
        detail: String(p.preview ?? ''),
        color: 'orange',
      }
    case 'access.denied':
      return {
        label: `🚫 越权访问被拒：${String(p.agentId)}`,
        detail: `${String(p.operation)} "${String(p.path)}"（${String(p.reason)}）`,
        color: 'red',
      }
    case 'injection.recorded':
      return {
        label: `🧠 经验注入：${String(p.agentId)}`,
        detail: `注入 ${String(p.injectedChars)}/${String(p.budgetChars)} 字符（SKILLS ${String(p.skillsChars)}，MEMORY ${String(p.memoryCount)} 条）`,
        color: 'purple',
        agentId,
      }
    case 'llm.retry':
      return { label: `⏳ 模型调用重试（${String(p.purpose)}）`, detail: `第 ${String(p.attempt)} 次：${String(p.error)}`, color: 'gray' }
    case 'judge.verdict':
      return {
        label: `⚖️ 裁判判定：胜者 ${String(p.winnerAgentId ?? '无（平局）')}`,
        detail: String(p.reasoning ?? ''),
        color: 'gold',
      }
    case 'judge.invalid_output':
      return { label: '⚠️ 裁判输出不合规', detail: String(p.error ?? ''), color: 'red' }
    case 'experience.summarized':
      return { label: `📚 经验总结：${String(p.agentId)}`, detail: String(p.changesSummary ?? ''), color: 'purple', agentId }
    case 'match.completed':
      return { label: '🏁 对局完成', detail: '', color: 'green' }
    case 'match.failed':
      return { label: '❌ 对局失败', detail: String(p.error ?? ''), color: 'red' }
    default:
      return { label: EVENT_LABELS[event.type] ?? event.type, detail: '' }
  }
}

/** 尝试把行动内容解析为 JSON 对象（fenced 块 / 裸 JSON 均可），失败返回 null */
function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const candidates: string[] = []
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  if (fenced?.[1]) candidates.push(fenced[1].trim())
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1))
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate)
      if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      /* 尝试下一候选 */
    }
  }
  return null
}

const JSON_KEY_LABELS: Record<string, string> = {
  verdict: '判定',
  reason: '理由',
  confidence: '置信度',
  winner: '胜者',
  score: '评分',
  is_phishing: '识别结论',
  detected: '识别结论',
  red_flags: '识别到的攻击特征',
  defense_recommendation: '防御建议',
  analysis: '分析',
  suggestions: '修改建议',
  overall: '总体评价',
}

/** JSON 值渲染：布尔/数组转友好文本 */
function renderJsonValue(key: string, value: unknown): { tag?: string; text?: string } {
  if (typeof value === 'boolean') {
    if (key === 'is_phishing' || key === 'detected') {
      return { tag: value ? '🚨 识别为攻击' : '⚠️ 未识别出攻击' }
    }
    return { text: value ? '是' : '否' }
  }
  if (Array.isArray(value)) return { text: value.map((v) => String(v)).join('；') }
  return { text: String(value) }
}

/** JSON 行动内容渲染：verdict 类结论转彩色徽标，其余键值对平铺 */
function JsonActionContent({ text }: { text: string }) {
  const obj = tryParseJsonObject(text)
  if (!obj) {
    return (
      <Typography.Paragraph type="secondary" style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
        {text}
      </Typography.Paragraph>
    )
  }
  return (
    <Space direction="vertical" size={4} style={{ width: '100%' }}>
      {Object.entries(obj).map(([key, value]) => {
        const label = JSON_KEY_LABELS[key] ?? key
        if (key === 'verdict') {
          const isAi = value === 'ai'
          return (
            <div key={key}>
              <Tag color={isAi ? 'red' : value === 'human' ? 'green' : 'default'}>
                {label}：{isAi ? 'AI 生成' : value === 'human' ? '人类撰写' : String(value)}
              </Tag>
            </div>
          )
        }
        const { tag, text: textValue } = renderJsonValue(key, value)
        if (tag) {
          return (
            <div key={key}>
              <Tag color={tag.startsWith('🚨') ? 'volcano' : 'green'}>{tag}</Tag>
            </div>
          )
        }
        return (
          <div key={key} style={{ fontSize: 13, lineHeight: 1.6 }}>
            <Typography.Text type="secondary">{label}：</Typography.Text>
            <Typography.Text>{textValue}</Typography.Text>
          </div>
        )
      })}
    </Space>
  )
}

export default function MatchDetailPage() {
  const { id = '' } = useParams()
  const [live, setLive] = useState<MatchEventEnvelope[]>([])
  const [wsStatus, setWsStatus] = useState<'connecting' | 'live' | 'done' | 'error'>('connecting')

  const detailQuery = useQuery({ queryKey: ['match', id], queryFn: () => api.matches.get(id), refetchInterval: 3000 })

  // 初始拉取全量事件（回放），随后 WebSocket 实时续传（断线重连按 seq 补齐）
  useEffect(() => {
    let cancelled = false
    void api.matches
      .events(id)
      .then((res) => {
        if (cancelled) return
        setLive(res.events)
        const detail = detailQuery.data
        if (detail && (detail.status === 'completed' || detail.status === 'failed')) {
          setWsStatus('done')
        }
      })
      .catch(() => setWsStatus('error'))
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (wsStatus === 'done') return
    const unsubscribe = subscribeMatchEvents(id, {
      onEnvelope: (envelope) => {
        setWsStatus('live')
        setLive((prev) => (prev.some((e) => e.seq >= envelope.seq) ? prev : [...prev, envelope]))
      },
      onDone: () => {
        setWsStatus('done')
        void detailQuery.refetch()
      },
      onError: () => setWsStatus('error'),
    })
    return unsubscribe
  }, [id, wsStatus === 'done'])

  const detail = detailQuery.data
  const grouped = useMemo(() => {
    const rounds = new Map<number, MatchEventEnvelope[]>()
    for (const envelope of live) {
      let key = 0
      if (envelope.event.type === 'round.started') key = Number((envelope.event.payload as { round: number }).round)
      else if (envelope.event.type.startsWith('round.')) key = Number((envelope.event.payload as { round: number }).round)
      else {
        // 归入最近一个已开始的回合
        for (const k of rounds.keys()) if (k > key) key = k
        if (key === 0 && envelope.event.type !== 'match.started') key = 0
      }
      const list = rounds.get(key) ?? []
      list.push(envelope)
      rounds.set(key, list)
    }
    return [...rounds.entries()].sort((a, b) => a[0] - b[0])
  }, [live])

  if (detailQuery.isLoading || !detail) return <Spin tip="加载对局详情…" />

  // 智能体配色（可视化：按 Agent 着色事件与图例）
  const agentColors = new Map<string, string>()
  const PALETTE = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ec4899']
  detail.agentIds.forEach((aid, i) => agentColors.set(aid, PALETTE[i % PALETTE.length]!))

  const auditEvents = live.filter(
    (e) => e.event.type === 'artifact.delivered' || e.event.type === 'access.denied',
  )

  return (
    <div>
      <PageHeader
        title={`对局详情 · ${id}`}
        description="实时事件流按回合分组展示；被隔离的信息（对手工作区、系统提示词）不会在此出现。"
        extra={
          <Tag color={detail?.status === 'completed' ? 'green' : detail?.status === 'failed' ? 'red' : 'processing'}>
            {MATCH_STATUS_LABELS[detail?.status ?? 'pending'] ?? '加载中'}
          </Tag>
        }
      />
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={6}>
            <Statistic title="状态" value={MATCH_STATUS_LABELS[detail.status] ?? detail.status} />
          </Col>
          <Col span={6}>
            <Statistic title="胜者" value={detail.winnerAgentId ?? '无（平局/未出）'} />
          </Col>
          <Col span={6}>
            <Statistic title="实时状态" value={wsStatus === 'live' ? '已连接' : wsStatus === 'done' ? '已终结' : wsStatus === 'error' ? '连接失败' : '连接中'} />
          </Col>
          <Col span={6}>
            <Statistic title="事件数" value={live.length} />
          </Col>
        </Row>
        {detail.error ? (
          <Alert style={{ marginTop: 12 }} type="error" message="失败诊断" description={detail.error} />
        ) : null}
      </Card>

      {detail.result ? (
        <Card title="对局结果" style={{ marginBottom: 16 }} size="small">
          <Descriptions column={2} size="small">
            <Descriptions.Item label="胜者">{detail.result.winnerAgentId ?? '无（平局）'}</Descriptions.Item>
            {detail.result.verdict ? (
              <Descriptions.Item label="裁判理由">{detail.result.verdict.reasoning}</Descriptions.Item>
            ) : null}
            {Object.entries(detail.result.scores).map(([agentId, score]) => (
              <Descriptions.Item key={agentId} label={`评分 ${agentId}`}>
                <Tag color={score === Math.max(...Object.values(detail.result!.scores)) ? 'green' : 'default'}>
                  {score}
                </Tag>
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Card>
      ) : null}

      <Card title="对局时间线（按回合分组；不展示被隔离的信息）" size="small" styles={{ body: { paddingTop: 12 } }}>
        {detail.agentIds.length > 0 ? (
          <Space size={6} wrap style={{ marginBottom: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              智能体配色：
            </Typography.Text>
            {detail.agentIds.map((aid) => (
              <Tag key={aid} color={agentColors.get(aid)}>
                {aid}
              </Tag>
            ))}
          </Space>
        ) : null}
        {grouped.map(([round, envelopes]) => (
          <div key={round} style={{ marginBottom: 16 }}>
            {round > 0 ? (
              <div
                style={{
                  display: 'inline-block',
                  background: '#eef0ff',
                  color: '#4f46e5',
                  borderRadius: 999,
                  padding: '2px 14px',
                  fontWeight: 700,
                  fontSize: 13,
                  marginBottom: 10,
                }}
              >
                第 {round} 轮
              </div>
            ) : (
              <Typography.Title level={5} style={{ marginTop: 0 }}>
                对局级事件
              </Typography.Title>
            )}
            <Timeline
              items={envelopes.map((envelope) => {
                const { label, detail: detailText, color, agentId } = describeEvent(envelope)
                const agentColor = agentId != null ? agentColors.get(agentId) : undefined
                const isAction = envelope.event.type === 'agent.action'
                return {
                  color: agentColor ?? color ?? 'blue',
                  children: (
                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                      <Typography.Text strong style={agentColor ? { color: agentColor } : undefined}>
                        #{envelope.seq} {label}
                      </Typography.Text>
                      {detailText && isAction ? (
                        <div
                          style={{
                            background: '#f8f9fc',
                            border: '1px solid #eef0f6',
                            borderRadius: 8,
                            padding: '8px 12px',
                            width: '100%',
                          }}
                        >
                          <JsonActionContent text={detailText} />
                        </div>
                      ) : detailText ? (
                        <Typography.Paragraph type="secondary" style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                          {detailText}
                        </Typography.Paragraph>
                      ) : null}
                    </Space>
                  ),
                }
              })}
            />
          </div>
        ))}
      </Card>

      <Card title="隔离审计（投递与越权拒绝记录）" size="small" style={{ marginTop: 16 }}>
        {auditEvents.length === 0 ? (
          <Typography.Text type="secondary">本局暂无隔离相关事件。</Typography.Text>
        ) : (
          <Timeline
            items={auditEvents.map((e) => {
              const { label, detail: detailText } = describeEvent(e)
              return { color: e.event.type === 'access.denied' ? 'red' : 'orange', children: `${label}｜${detailText}` }
            })}
          />
        )}
      </Card>
    </div>
  )
}
