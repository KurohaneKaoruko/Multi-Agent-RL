// @arlaf/engine — 对局引擎核心库（纯库，无 HTTP 依赖）。
export const ENGINE_VERSION = '0.1.0'

// LLM 调用层（任务 3.x）
export { OpenAICompatibleClient, type OpenAIClientOptions } from './llm/openai'
export { MockProvider, encodeMockConfig, decodeMockScript, type MockStep } from './llm/mock'
export { completeStructured, extractJson, StructuredOutputError } from './llm/structured'
export type {
  LLMClient,
  ChatRequest,
  ChatResponse,
  ChatMessage,
  CompleteOptions,
  RetryInfo,
} from './llm/types'
export { isRetryableStatus, LlmHttpError } from './llm/types'

// 运行时（任务 4.x–7.x）
export { MatchEventBus } from './runtime/eventbus'
export { mapWithConcurrency } from './runtime/concurrency'
export { WorkspaceController, WorkspaceAccessError } from './runtime/workspace'
export {
  AgentRuntime,
  createLLMClient,
  type AgentRoundContext,
  type EmitEvent,
} from './runtime/agent'
export {
  aiFlavorEvaluator,
  builtinRuleEvaluators,
  parseDetectorVerdict,
  type RuleEvaluator,
  type RuleOutcome,
  type RuleOutcomeContext,
} from './runtime/rules'
export { runJudge, JudgeFailureError } from './runtime/judge'
export {
  FileExperienceStore,
  injectExperience,
  readAllSkills,
  readRecentMemories,
  summarizeExperience,
  type ExperienceStore,
  type ExperienceDocRecord,
  type AppendInput,
  type InjectionResult,
  type ExperienceSummary,
} from './runtime/experience'
export {
  createMatch,
  MatchFailedError,
  type CreateMatchOptions,
  type MatchHandle,
} from './runtime/match'
