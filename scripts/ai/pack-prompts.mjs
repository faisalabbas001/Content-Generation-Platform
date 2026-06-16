#!/usr/bin/env node
/**
 * Emit single-line env strings for each prompt file in `prompts/`.
 * Use this when configuring Vercel / n8n / staging environments where the
 * prompts must live as env vars (SEC-06).
 *
 * Usage:
 *   pnpm prompts:pack          # prints to stdout
 *   pnpm prompts:pack > .env.prompts.local   # capture
 *
 * Each file becomes one `KEY="..."` line with newlines escaped as `\n`. The
 * loader in packages/ai unescapes via process.env (no manual decoding) — the
 * shell handles it during dotenv parsing.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const promptsDir = join(root, 'prompts')

const FILE_TO_KEY = [
  ['OGzStudios_CEO_Prompt_v1.md',                 'CEO_SYSTEM_PROMPT'],
  ['OGzStudios_COO_Prompt_v1.md',                 'COO_SYSTEM_PROMPT'],
  ['OGzStudios_CCO_Prompt_v1.md',                 'CCO_SYSTEM_PROMPT'],
  ['OGzStudios_DeepSeek_Prompt_v1.md',            'DEEPSEEK_SYSTEM_PROMPT'],
  ['OGzStudios_Copilot_Management_Prompt_v1.md',  'COPILOT_MANAGEMENT_PROMPT'],
  ['OGzStudios_Copilot_Tech_Prompt_v1.md',        'COPILOT_TECH_PROMPT'],
  ['OGzStudios_Copilot_Production_Prompt_v1.md',  'COPILOT_PRODUCTION_PROMPT'],
]

const present = new Set(readdirSync(promptsDir))
for (const [file, key] of FILE_TO_KEY) {
  if (!present.has(file)) continue
  const content = readFileSync(join(promptsDir, file), 'utf-8').trim()
  const escaped = content
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
  process.stdout.write(`${key}="${escaped}"\n`)
}
