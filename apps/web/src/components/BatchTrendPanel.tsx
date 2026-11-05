// 批次训练趋势小面板：数字卡 + 纯 CSS 迷你条形（无图表库），嵌入对局列表批次展开行
import { Card, Empty, Tag, Typography } from 'antd'
import type { BatchTrendReport } from '@marl/shared'
import { buildTrendPanelView, type TrendStatCard } from '../lib/batch-trends'

const DIRECTION_COLOR: Record<TrendStatCard['direction'], string> = {
  up: '#16a34a',
  down: '#dc2626',
  flat: '#6b7280',
}

const DIRECTION_ARROW: Record<TrendStatCard['direction'], string> = { up: '↑', down: '↓', flat: '' }

/** 单张摘要数字卡 */
function StatCard({ card }: { card: TrendStatCard }) {
  return (
    <div
      style={{
        flex: '1 1 120px',
        minWidth: 120,
        padding: '10px 14px',
        borderRadius: 8,
        background: '#f9fafb',
        border: '1px solid #f0f0f0',
      }}
    >
      <div style={{ fontSize: 12, color: '#6b7280' }}>{card.label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, lineHeight: '32px' }}>{card.value}</div>
      {card.delta != null && (
        <div style={{ fontSize: 12, color: DIRECTION_COLOR[card.direction] }}>
          {DIRECTION_ARROW[card.direction]} 较首批 {card.delta}
        </div>
      )}
    </div>
  )
}

/** 迷你条形图（每批一根，纯 div 实现） */
function MiniBars({ bars }: { bars: Array<{ batchId: string; label: string; percent: number | null; text: string }> }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, height: 88, paddingTop: 4 }}>
      {bars.map((bar) => (
        <div key={bar.batchId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#374151' }}>{bar.text}</span>
          <div
            style={{
              width: 36,
              height: bar.percent == null ? 4 : Math.max(4, bar.percent * 0.6),
              background: bar.percent == null ? '#e5e7eb' : '#6366f1',
              borderRadius: 4,
            }}
            title={`${bar.label}: ${bar.text}`}
          />
          <span style={{ fontSize: 12, color: '#9ca3af' }}>{bar.label}</span>
        </div>
      ))}
    </div>
  )
}

export default function BatchTrendPanel({ report }: { report: BatchTrendReport | null }) {
  if (!report || report.batches.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="该批次暂无趋势统计（需已完成至少一场对局）"
        style={{ padding: 8 }}
      />
    )
  }
  const view = buildTrendPanelView(report)
  const paradigmLabel = report.paradigm === 'cooperative' ? '协作' : report.paradigm === 'drill' ? '靶场' : '对抗'
  return (
    <Card
      size="small"
      title={
        <span>
          训练趋势 · {report.environmentName}
          <Tag color="geekblue" style={{ marginLeft: 8 }}>
            {paradigmLabel}
          </Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
            {view.cards.length > 0 && report.summary.batchCount} 个批次（同环境全部批次演进）
          </Typography.Text>
        </span>
      }
      style={{ marginBottom: 12, background: '#fafafa' }}
    >
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {view.cards.map((card) => (
          <StatCard key={card.label} card={card} />
        ))}
      </div>
      {view.bars.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
            {report.paradigm === 'cooperative' ? '团队评分随批次演进' : '总体胜率随批次演进'}
          </div>
          <MiniBars bars={view.bars} />
        </div>
      )}
      {view.agentLines.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>按 Agent 胜率演进</div>
          {view.agentLines.map((line) => (
            <div key={line.agentId} style={{ fontSize: 13 }}>
              <Tag style={{ marginRight: 8 }}>{line.agentId}</Tag>
              <Typography.Text type="secondary">{line.text}</Typography.Text>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
