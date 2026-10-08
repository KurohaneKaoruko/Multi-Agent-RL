// 首页：品牌 Hero（双范式）+ 实时统计 + 快速上手指引
import {
  ThunderboltFilled,
  ApartmentOutlined,
  ApiOutlined,
  TrophyOutlined,
  TeamOutlined,
  RightOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, Col, Row, Space, Typography } from 'antd'
import { Link } from 'react-router-dom'
import { api } from './api/client'
import StatCard from './components/StatCard'

const STEPS = [
  {
    title: '① 配置模型 API',
    desc: '接入任意 OpenAI 兼容端点（OpenAI / DeepSeek / Qwen / Ollama…）',
    to: '/models',
    link: '去配置',
  },
  {
    title: '② 构建对抗或协作环境',
    desc: '对抗（Agent-RLAF）互斥胜负；协作（Agent-RLCF）团队评分——都可让 AI 帮你生成',
    to: '/environments',
    link: '去构建',
  },
  {
    title: '③ 发起对局并观察',
    desc: '实时观看智能体过招或协作，隔离审计保证公平',
    to: '/matches',
    link: '去开赛',
  },
  {
    title: '④ 收获进化经验',
    desc: '对局沉淀 MEMORY / SKILLS，在环境详情内查看胜率与团队评分',
    to: '/environments',
    link: '去查看',
  },
]

export default function App() {
  const envQuery = useQuery({ queryKey: ['environments'], queryFn: api.environments.list })
  const modelQuery = useQuery({ queryKey: ['models'], queryFn: api.models.list })
  const matchQuery = useQuery({ queryKey: ['matches'], queryFn: api.matches.list })

  const envs = envQuery.data?.environments ?? []
  const adversarialCount = envs.filter((e) => e.paradigm !== 'cooperative').length
  const cooperativeCount = envs.filter((e) => e.paradigm === 'cooperative').length
  const modelCount = modelQuery.data?.models.length ?? 0
  const matches = matchQuery.data?.matches ?? []
  const completed = matches.filter((m) => m.status === 'completed').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="arlaf-hero">
        <h1 className="arlaf-hero-title">让智能体在反馈中进化</h1>
        <p className="arlaf-hero-desc">
          Multi-Agent-RL 支持两大范式：<b>Agent-RLAF</b>（对抗反馈）——智能体在互斥胜负的仿真环境中对抗切磋；
          <b>Agent-RLCF</b>（协作反馈）——多个智能体围绕共同目标分工协作，由 AI 裁判为团队评分、复盘短板。
          从「生成-辨别」文本对抗到「作者 × 编辑结对写作工坊」，一个框架全部承载。
        </p>
        <Space size="middle">
          <Link to="/environments">
            <Button
              size="large"
              style={{ background: '#ffffff', borderColor: '#ffffff', color: '#4f46e5', fontWeight: 600 }}
            >
              构建对抗环境
            </Button>
          </Link>
          <Link to="/cooperative">
            <Button
              size="large"
              style={{
                background: 'rgba(16,185,129,0.9)',
                borderColor: '#ffffff',
                color: '#ffffff',
                fontWeight: 600,
              }}
            >
              构建协作环境
            </Button>
          </Link>
          <Link to="/matches">
            <Button
              size="large"
              ghost
              style={{ borderColor: 'rgba(255,255,255,0.85)', color: '#ffffff', background: 'transparent' }}
            >
              发起一场对局
            </Button>
          </Link>
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Link to="/environments" style={{ display: 'block' }}>
            <StatCard
              icon={<ApartmentOutlined />}
              color="#6366f1"
              title="对抗环境 · Agent-RLAF"
              value={adversarialCount}
              description="互斥胜负，对抗进化"
            />
          </Link>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Link to="/cooperative" style={{ display: 'block' }}>
            <StatCard
              icon={<TeamOutlined />}
              color="#10b981"
              title="协作环境 · Agent-RLCF"
              value={cooperativeCount}
              description="团队评分，协作共赢"
            />
          </Link>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Link to="/models" style={{ display: 'block' }}>
            <StatCard
              icon={<ApiOutlined />}
              color="#06b6d4"
              title="模型 Models"
              value={modelCount}
              description="OpenAI 兼容端点"
            />
          </Link>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Link to="/matches" style={{ display: 'block' }}>
            <StatCard
              icon={<TrophyOutlined />}
              color="#f59e0b"
              title="对局记录 Matches"
              value={matches.length}
              description={`已完成 ${completed} 场`}
            />
          </Link>
        </Col>
      </Row>

      <Card
        title={
          <Space>
            <ThunderboltFilled style={{ color: '#6366f1' }} />
            快速上手
          </Space>
        }
      >
        <Row gutter={[16, 16]}>
          {STEPS.map((step) => (
            <Col xs={24} sm={12} lg={6} key={step.title}>
              <Card
                size="small"
                className="arlaf-card arlaf-card-hover"
                style={{ height: '100%', background: '#fafbff' }}
              >
                <Typography.Text strong>{step.title}</Typography.Text>
                <Typography.Paragraph
                  type="secondary"
                  style={{ fontSize: 12, minHeight: 40, marginTop: 6, marginBottom: 8 }}
                >
                  {step.desc}
                </Typography.Paragraph>
                <Link to={step.to} style={{ fontSize: 13 }}>
                  {step.link} <RightOutlined style={{ fontSize: 11 }} />
                </Link>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>
    </div>
  )
}
