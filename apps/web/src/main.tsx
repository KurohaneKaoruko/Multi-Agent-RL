import { ThunderboltFilled } from '@ant-design/icons'
import { App as AntdApp, Button, ConfigProvider, Result } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { Layout, Menu } from 'antd'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, Outlet, Route, Routes, BrowserRouter } from 'react-router-dom'
import App from './App'
import CooperativeEnvironmentsPage from './pages/CooperativeEnvironmentsPage'
import DrillEnvironmentsPage from './pages/DrillEnvironmentsPage'
import EnvironmentsPage from './pages/EnvironmentsPage'
import EnvironmentBuilderPage from './pages/EnvironmentBuilderPage'
import EnvironmentDetailPage from './pages/EnvironmentDetailPage'
import MatchDetailPage from './pages/MatchDetailPage'
import MatchesPage from './pages/MatchesPage'
import ModelsPage from './pages/ModelsPage'
import { MENU_LABELS } from './i18n'
import { antdTheme } from './theme'
import './global.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
})

const { Header, Sider, Content } = Layout

function Shell() {
  const items = [
    { key: '/', label: <Link to="/">{MENU_LABELS.dashboard}</Link> },
    { key: '/environments', label: <Link to="/environments">{MENU_LABELS.environments}</Link> },
    { key: '/cooperative', label: <Link to="/cooperative">{MENU_LABELS.cooperative}</Link> },
    { key: '/drills', label: <Link to="/drills">{MENU_LABELS.drills}</Link> },
    { key: '/models', label: <Link to="/models">{MENU_LABELS.models}</Link> },
    { key: '/matches', label: <Link to="/matches">{MENU_LABELS.matches}</Link> },
  ]
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider className="arlaf-sider" width={216} style={{ position: 'sticky', top: 0, height: '100vh' }}>
        <div className="arlaf-logo">
          <div className="arlaf-logo-badge">
            <ThunderboltFilled />
          </div>
          <div>
            <div className="arlaf-logo-title">Multi-Agent-RL</div>
            <div className="arlaf-logo-sub">智能体强化学习 · 对抗 × 协作</div>
          </div>
        </div>
        <Menu theme="dark" mode="inline" items={items} selectable={false} />
        <div
          style={{
            position: 'absolute',
            bottom: 18,
            left: 0,
            right: 0,
            textAlign: 'center',
            color: 'rgba(255,255,255,0.35)',
            fontSize: 11,
          }}
        >
          Agent-RL · Multi-Agent-RL v0.1
        </div>
      </Sider>
      <Layout>
        <Header className="arlaf-header">
          <span style={{ fontSize: 15, fontWeight: 700, color: '#1f2333' }}>
            多智能体强化学习框架（Multi-Agent-RL）
            <span style={{ fontWeight: 400, color: '#9ca3af', marginLeft: 10, fontSize: 13 }}>
              Agent-RLAF 对抗反馈 ｜ Agent-RLCF 协作反馈
            </span>
          </span>
          <span style={{ color: '#6b7280', fontSize: 13 }}>让智能体在反馈中进化</span>
        </Header>
        <Content style={{ padding: '24px 28px', maxWidth: 1280, width: '100%', margin: '0 auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}

function NotFound() {
  return (
    <Result
      status="404"
      title="页面不存在"
      subTitle="你访问的页面不存在"
      extra={
        <Button type="primary">
          <Link to="/">返回首页</Link>
        </Button>
      }
    />
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={antdTheme}>
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
              <Route element={<Shell />}>
                <Route index element={<App />} />
                <Route path="/environments" element={<EnvironmentsPage />} />
                <Route path="/environments/new" element={<EnvironmentBuilderPage />} />
                <Route path="/environments/:id" element={<EnvironmentDetailPage />} />
                <Route path="/cooperative" element={<CooperativeEnvironmentsPage />} />
                <Route path="/drills" element={<DrillEnvironmentsPage />} />
                <Route path="/models" element={<ModelsPage />} />
                <Route path="/matches" element={<MatchesPage />} />
                <Route path="/matches/:id" element={<MatchDetailPage />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
)
