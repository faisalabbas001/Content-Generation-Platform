/**
 * Structured-JSON parser used by every AI agent wrapper.
 *
 * AI providers occasionally wrap their JSON in markdown fences or trailing prose
 * despite the system prompt's instructions. This helper:
 *   1. Strips ```json … ``` fences if present.
 *   2. Locates the outermost {…} or […] block by bracket counting (skips strings).
 *   3. Parses + Zod-validates.
 *   4. Throws a descriptive error so retry.ts can count it as one attempt.
 *
 * Doing this in one place means the providers stay tiny and we never duplicate
 * fence-stripping logic.
 */
import type { ZodType, ZodTypeDef } from 'zod'

export class StructuredJsonError extends Error {
  constructor(message: string, public readonly raw: string) {
    super(message)
    this.name = 'StructuredJsonError'
  }
}

export function parseStructuredJson<T>(
  raw: string,
  schema: ZodType<T, ZodTypeDef, unknown>,
): T {
  const stripped = stripFences(raw).trim()
  const block = extractFirstJsonBlock(stripped)
  if (!block) {
    throw new StructuredJsonError('No JSON object/array found in model response', raw)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(block)
  } catch (e) {
    // DeepSeek V3 produces invalid JSON in a few recurring ways for Arabic content:
    //   1. unquoted hashtag tokens in arrays:  [#مقرمش, #عشاء_الرياض]
    //   2. raw control chars (newlines/tabs) inside string literals
    // Try a best-effort repair and re-parse before giving up. Only runs on the
    // error path, so already-valid JSON is never altered.
    try {
      parsed = JSON.parse(repairLooseJson(block))
    } catch {
      throw new StructuredJsonError(`JSON.parse failed: ${(e as Error).message}`, raw)
    }
  }
  const result = schema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new StructuredJsonError(`Schema validation failed: ${issues}`, raw)
  }
  return result.data
}

/**
 * Best-effort repair of malformed JSON DeepSeek V3 emits for Arabic content.
 * Runs ONLY on the parse-error path, so valid JSON is never altered. Two fixes:
 *   1. Unquoted hashtag tokens in value/element position: [#a, #b] -> ["#a","#b"]
 *   2. Raw control chars (newline/CR/tab) INSIDE string literals -> escaped.
 */
function repairLooseJson(s: string): string {
  return escapeControlCharsInStrings(repairSingleQuotedStrings(repairUnquotedHashtags(s)))
}

/**
 * Convert JS-style single-quoted string literals to valid JSON double-quoted
 * ones. DeepSeek V3 sometimes emits  "caption_ar": 'شاورما ا...'  — a single-
 * quoted VALUE. We only touch single quotes in structural string position (right
 * after `:` `,` `[` or `{`, ignoring whitespace) so apostrophes inside already-
 * valid double-quoted strings are never altered. Inner `"` are escaped; an inner
 * `\'` is unescaped to a plain `'`.
 */
function repairSingleQuotedStrings(s: string): string {
  let result = ''
  let inDouble = false
  let escape = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (inDouble) {
      result += ch
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inDouble = false
      continue
    }
    if (ch === '"') { inDouble = true; result += ch; continue }
    if (ch === "'") {
      // Only treat as a string opener if the previous non-space char marks a
      // value/element position. Otherwise leave it (stray apostrophe in junk).
      const prev = lastNonSpace(result)
      if (prev === ':' || prev === ',' || prev === '[' || prev === '{' || prev === '') {
        const { content, next } = readSingleQuoted(s, i)
        result += '"' + content + '"'
        i = next
        continue
      }
    }
    result += ch
  }
  return result
}

function lastNonSpace(s: string): string {
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s[i]!
    if (c !== ' ' && c !== '\n' && c !== '\r' && c !== '\t') return c
  }
  return ''
}

/** Read a single-quoted literal starting at index `open`; return JSON-safe inner
 *  content (inner `"` escaped, `\'` -> `'`) and the index of the closing quote. */
function readSingleQuoted(s: string, open: number): { content: string; next: number } {
  let content = ''
  let i = open + 1
  for (; i < s.length; i++) {
    const ch = s[i]!
    if (ch === '\\') {
      const nx = s[i + 1]
      if (nx === "'") { content += "'"; i++; continue } // \' -> '
      content += ch
      if (nx !== undefined) { content += nx; i++ }
      continue
    }
    if (ch === "'") break // closing quote
    if (ch === '"') { content += '\\"'; continue } // escape inner "
    content += ch
  }
  return { content, next: i }
}

/** Quote bare #tokens after [ , or : . Token chars include Arabic ranges. */
function repairUnquotedHashtags(s: string): string {
  return s
    // Case A: a stray '#' DIRECTLY before an already-quoted string after a delimiter,
    // e.g. [ "#a", #"b" ]  →  the model emitted `#"b"` (hash + quoted). Fold the # INTO
    // the string: #"b" → "#b". (This was the "Unexpected token '#'" parse failure.)
    .replace(/([\[,:]\s*)#(")/g, (_m: string, lead: string, q: string) => `${lead}${q}#`)
    // Case B: a fully bare #token (no quotes) after a delimiter → wrap in quotes.
    .replace(
      /([\[,:]\s*)(#[\w؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿-]+)/g,
      (_m: string, lead: string, tag: string) => `${lead}"${tag}"`,
    )
}

/**
 * Escape raw control chars that appear INSIDE a JSON string literal (DeepSeek
 * sometimes emits real newlines in multi-line Arabic captions). Chars outside
 * strings (structural whitespace) are left untouched.
 */
function escapeControlCharsInStrings(s: string): string {
  let result = ''
  let inString = false
  let escape = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (escape) { result += ch; escape = false; continue }
    if (ch === '\\') { result += ch; escape = true; continue }
    if (ch === '"') { inString = !inString; result += ch; continue }
    if (inString) {
      if (ch === '\n') { result += '\\n'; continue }
      if (ch === '\r') { result += '\\r'; continue }
      if (ch === '\t') { result += '\\t'; continue }
      const code = ch.charCodeAt(0)
      if (code < 0x20) { result += '\\u' + code.toString(16).padStart(4, '0'); continue }
    }
    result += ch
  }
  return result
}

function stripFences(s: string): string {
  // Strip a leading ```json or ``` opener if present. We deliberately do NOT
  // require a matching closing fence — Claude responses occasionally hit
  // max_tokens mid-JSON, leaving the closing ``` missing. As long as we
  // remove the opener, extractFirstJsonBlock can still find the {…} inside.
  const trimmed = s.trim()
  const opener = /^```(?:json)?\s*\n?/i
  const stripped = trimmed.replace(opener, '')
  // Also strip a trailing ``` if it exists.
  return stripped.replace(/\n?```\s*$/, '')
}

/** Find the first balanced {...} or [...] block, ignoring brackets inside strings. */
function extractFirstJsonBlock(s: string): string | null {
  const start = firstBracket(s)
  if (start === -1) return null
  const open = s[start]!
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]!!
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

function firstBracket(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '{' || c === '[') return i
  }
  return -1
}
