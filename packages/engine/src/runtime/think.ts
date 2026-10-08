/** 清洗模型输出：剥离 <think>…</think> 推理块（含未闭合的 <think>…到结尾），
 * 避免模型内部推理进入作品、投递物与界面展示。 */
export function stripThinkTags(text: string): string {
  const withoutClosed = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const withoutOpen = withoutClosed.replace(/<think>[\s\S]*$/i, '')
  return withoutOpen.trim()
}
