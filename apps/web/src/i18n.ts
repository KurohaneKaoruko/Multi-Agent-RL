/** 全局中文文案常量（12.2）：界面以中文为主，专业术语保留英文 */

export const MENU_LABELS = {
  dashboard: '首页',
  environments: '对抗环境',
  cooperative: '协作环境',
  models: '模型设置',
  matches: '对局记录',
} as const

export const PARADIGM_LABELS: Record<string, string> = {
  adversarial: '对抗 · Agent-RLAF',
  cooperative: '协作 · Agent-RLCF',
}

export const COMMON_MESSAGES = {
  loadFailed: '加载失败',
  saveSuccess: '保存成功',
  saveFailed: '保存失败',
  deleteConfirm: '确认删除？此操作不可恢复',
  deleted: '已删除',
  operationFailed: '操作失败',
  none: '暂无数据',
  validationFailed: '请求参数校验失败',
} as const

export const MATCH_STATUS_LABELS: Record<string, string> = {
  pending: '待启动',
  running: '运行中',
  completed: '已完成',
  failed: '已失败',
}

export const TOPOLOGY_LABELS: Record<string, string> = {
  symmetric: '对称对抗（同角色）',
  asymmetric: '不对称对抗（不同角色）',
  melee: '多方混战',
}

export const KIND_LABELS: Record<string, string> = {
  memory: 'MEMORY 情景记忆',
  skills: 'SKILLS 技能文档',
}

/** 将后端字段级错误转换为表单可见的中文提示 */
export function describeFieldErrors(fields: Array<{ path: string; message: string }>): string {
  return fields.map((f) => `${f.path}: ${f.message}`).join('；')
}
