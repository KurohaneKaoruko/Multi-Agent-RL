import type { ReactNode } from 'react'
import Card from 'antd/es/card/Card'

/** 图标统计卡：彩色图标气泡 + 标题 + 数值 */
export default function StatCard({
  icon,
  color,
  title,
  value,
  description,
}: {
  icon: ReactNode
  color: string
  title: string
  value: ReactNode
  description?: string
}) {
  return (
    <Card className="arlaf-card" styles={{ body: { padding: '18px 20px' } }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="arlaf-stat-bubble" style={{ background: `${color}1c`, color }}>
          {icon}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#6b7280', fontSize: 13 }}>{title}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#1f2333', lineHeight: 1.35 }}>{value}</div>
          {description ? (
            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{description}</div>
          ) : null}
        </div>
      </div>
    </Card>
  )
}
