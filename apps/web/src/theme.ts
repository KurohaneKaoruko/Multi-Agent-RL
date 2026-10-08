import type { ThemeConfig } from 'antd'

/** ARLAF 品牌色板 */
export const BRAND = {
  primary: '#6366f1',
  primaryDark: '#4f46e5',
  violet: '#7c3aed',
  blue: '#2563eb',
  cyan: '#06b6d4',
  emerald: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
  text: '#1f2333',
  textSecondary: '#6b7280',
  bgLayout: '#f5f6fa',
}

/** AntD 主题令牌（美化：统一品牌色、圆角、阴影基调） */
export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: BRAND.primary,
    colorInfo: BRAND.primary,
    colorSuccess: BRAND.emerald,
    colorWarning: BRAND.amber,
    colorError: BRAND.red,
    colorTextBase: BRAND.text,
    colorBgLayout: BRAND.bgLayout,
    borderRadius: 10,
    fontSize: 14,
    wireframe: false,
  },
  components: {
    Layout: {
      bodyBg: BRAND.bgLayout,
      siderBg: 'transparent',
      headerBg: 'transparent',
    },
    Menu: {
      darkItemBg: 'transparent',
      darkItemColor: 'rgba(255, 255, 255, 0.72)',
      darkItemHoverBg: 'rgba(255, 255, 255, 0.08)',
      darkItemSelectedBg: 'rgba(99, 102, 241, 0.4)',
      darkItemSelectedColor: '#ffffff',
      itemBorderRadius: 10,
      itemMarginInline: 12,
      itemHeight: 42,
    },
    Card: {
      borderRadiusLG: 14,
    },
    Table: {
      headerBg: '#f8f9fd',
      headerColor: '#4b5563',
    },
    Button: {
      controlHeight: 36,
      borderRadius: 8,
    },
    Statistic: {
      titleFontSize: 13,
      contentFontSize: 22,
    },
  },
}
