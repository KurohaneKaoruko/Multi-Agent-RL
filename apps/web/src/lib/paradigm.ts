// 范式过滤纯逻辑：对抗/协作/演练三个环境页与首页统计共用

/** 按 paradigm 挑选列表项（environments / templates 均适用） */
export function filterByParadigm<T extends { paradigm?: string }>(items: readonly T[], paradigm: string): T[] {
  return items.filter((item) => item.paradigm === paradigm)
}
