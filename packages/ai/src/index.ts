/**
 * @repo/ai — public API.
 *
 * Subpath imports are preferred (`@repo/ai/ceo`) for tree-shaking, but the
 * barrel below is convenient for scripts and tests.
 */
export * as ceo from './providers/ceo'
export * as coo from './providers/coo'
export * as cco from './providers/cco'
export * as deepseek from './providers/deepseek'
export * as visualPrompt from './providers/visual-prompt'
export * as copilot from './providers/copilot'
export * as extractionPrefill from './providers/extraction-prefill'
export type { CopilotRole, ClaudeMessage, CopilotCallInput, CopilotResult } from './providers/copilot'
export { loadPrompt, isPromptConfigured, PromptNotConfiguredError, type PromptKey } from './prompts'
export { AiCallFailedError, withRetryAndLogging, type RetryContext, type UsageLogRow } from './retry'
export { parseStructuredJson, StructuredJsonError } from './json'
export { getAnthropicClient } from './providers/anthropic'
export { getOpenAIClient } from './providers/openai'
export { getDeepSeekClient, DEEPSEEK_MODEL } from './providers/deepseek-client'
export { checkHardBlocks, checkHardBlocksWithContext, type HardBlockResult, type HardBlockViolation } from './compliance'
export {
  applyHumanOverrides,
  shouldAlertAdmin,
  type OverridePost,
  type OverrideContext,
  type OverrideResult,
  type FiredTrigger,
} from './human-overrides'
