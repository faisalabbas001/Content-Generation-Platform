/**
 * Prompt loader — the ONLY module allowed to read `*_SYSTEM_PROMPT` env vars
 * (CLAUDE.md import restriction). Centralising access here lets us:
 *
 *   1. Enforce SEC-06 ("AI prompts in env vars only — never in source") by keeping
 *      every `process.env.X_SYSTEM_PROMPT` access in one auditable place.
 *   2. Provide a developer-friendly fallback that reads from the local
 *      `prompts/` folder when the env var is empty, so devs don't need to paste
 *      multi-hundred-line prompts onto a single line.
 *   3. Cache resolved prompts in-process so reads are cheap.
 *   4. Fail loudly with an actionable message when neither source has the prompt.
 *
 * Production path:
 *   - Vercel + n8n credential objects hold the prompt as a single env value
 *     (newlines preserved; both platforms support multi-line env vars).
 *   - The `pnpm prompts:pack` script (scripts/pack-prompts.mjs) emits ready-to-paste
 *     env strings from the `prompts/` folder.
 *
 * Local dev path:
 *   - Leave `*_SYSTEM_PROMPT` empty in .env.local; the loader reads the markdown
 *     file from `prompts/<file>.md` instead.
 *
 * Server-only module — never imported from a client component.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

export type PromptKey =
  | 'CEO_SYSTEM_PROMPT'
  | 'COO_SYSTEM_PROMPT'
  | 'CCO_SYSTEM_PROMPT'
  | 'DEEPSEEK_SYSTEM_PROMPT'
  | 'VISUAL_PROMPT_SYSTEM_PROMPT'
  | 'COPILOT_MANAGEMENT_PROMPT'
  | 'COPILOT_TECH_PROMPT'
  | 'COPILOT_PRODUCTION_PROMPT'
  | 'EXTRACTION_PREFILL_SYSTEM_PROMPT'

/**
 * Map of env var → ordered list of markdown file candidates in `prompts/`.
 *
 * The loader tries each filename in order and returns the first that exists.
 * v2 files come first; v1 are kept as a safety fallback so the system never
 * breaks during a partial upgrade. To pin to v1, paste the v1 markdown into
 * the env var directly (env always wins over file fallback).
 */
const FILE_FALLBACKS: Record<PromptKey, readonly string[]> = {
  CEO_SYSTEM_PROMPT:        ['OGzStudios_CEO_Prompt_v2.md',      'OGzStudios_CEO_Prompt_v1.md'],
  // v1 first (smaller ~4.5k vs v2 ~11.6k tokens): COO's input (system + large
  // schedule_dates payload) + max_tokens must stay under the OpenAI Tier-1 30k TPM.
  // v2 pushed the request to ~40k → 429. Restore v2-first once on a higher OpenAI tier.
  COO_SYSTEM_PROMPT:        ['OGzStudios_COO_Prompt_v1.md',      'OGzStudios_COO_Prompt_v2.md'],
  CCO_SYSTEM_PROMPT:        ['OGzStudios_CCO_Prompt_v2.md',      'OGzStudios_CCO_Prompt_v1.md'],
  DEEPSEEK_SYSTEM_PROMPT:   ['OGzStudios_DeepSeek_Prompt_v2.md', 'OGzStudios_DeepSeek_Prompt_v1.md'],
  VISUAL_PROMPT_SYSTEM_PROMPT: ['OGzStudios_VisualPrompt_Prompt_v1.md'],
  COPILOT_MANAGEMENT_PROMPT: ['OGzStudios_Copilot_Management_Prompt_v1.md'],
  COPILOT_TECH_PROMPT:       ['OGzStudios_Copilot_Tech_Prompt_v1.md'],
  COPILOT_PRODUCTION_PROMPT: ['OGzStudios_Copilot_Production_Prompt_v1.md'],
  EXTRACTION_PREFILL_SYSTEM_PROMPT: ['OpenClaw_ExtractionPrefill_Prompt_v1.md', 'OGz Studios_ExtractionPrefill_Prompt_v1.md'],
}

const cache = new Map<PromptKey, string>()

export class PromptNotConfiguredError extends Error {
  constructor(key: PromptKey, fallbackFiles: readonly string[]) {
    super(
      `Prompt "${key}" is not configured. Either:\n` +
        `  • set ${key} in .env.local (preserves newlines), or\n` +
        `  • place the markdown at one of: ${fallbackFiles.map((f) => `prompts/${f}`).join(' OR ')} for local dev.\n` +
        `Production: run \`pnpm prompts:pack\` to emit env strings for Vercel/n8n.`,
    )
    this.name = 'PromptNotConfiguredError'
  }
}

/**
 * Resolve a prompt by env-var name. Order:
 *   1. process.env[key] (trimmed; non-empty)
 *   2. workspace `prompts/<file>.md`
 * Throws PromptNotConfiguredError if neither has content.
 *
 * NOTE: `process.env[<dynamic>]` works on the server (Node) — this module is
 * server-only. Do not import from a `'use client'` boundary.
 */
export function loadPrompt(key: PromptKey): string {
  const cached = cache.get(key)
  if (cached) return cached

  const fromEnv = process.env[key]?.trim()
  if (fromEnv && fromEnv.length > 0) {
    cache.set(key, fromEnv)
    return fromEnv
  }

  // Try each candidate filename in order — v2 first, fall back to v1.
  const candidates = FILE_FALLBACKS[key]
  for (const fileName of candidates) {
    const fromFile = readFromWorkspace(fileName)
    if (fromFile) {
      cache.set(key, fromFile)
      return fromFile
    }
  }

  throw new PromptNotConfiguredError(key, candidates)
}

/** True if either env var or any fallback file is present. */
export function isPromptConfigured(key: PromptKey): boolean {
  if (process.env[key]?.trim()) return true
  return FILE_FALLBACKS[key].some((f) => Boolean(readFromWorkspace(f)))
}

function readFromWorkspace(fileName: string): string | null {
  let dir = process.cwd()
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'prompts', fileName)
    if (existsSync(candidate)) {
      const content = readFileSync(candidate, 'utf-8').trim()
      return content.length > 0 ? content : null
    }
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** Test-only — clear the in-process cache. Never call in app code. */
export function __resetPromptCacheForTests(): void {
  cache.clear()
}
