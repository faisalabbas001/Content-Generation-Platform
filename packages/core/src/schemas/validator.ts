/**
 * Schema Validator — Spine component (Phase 0, spec §9.2)
 *
 * Single entry point for all AI agent request/response validation.
 * Every route calls validateInput() / validateOutput() here instead of
 * doing ad-hoc Zod parsing inline. Centralises:
 *   - Error message formatting
 *   - Parse failure logging
 *   - Schema mismatch detection
 *
 * Usage:
 *   const result = validateInput(CeoClassifyRequest, rawBody)
 *   if (!result.ok) return errorResponse(400, result.code, result.message)
 *   const input = result.data
 */
import { z } from 'zod'

// ── Result types ────────────────────────────────────────────────────────────

export interface ValidOk<T> { ok: true;  data: T }
export interface ValidFail   { ok: false; code: string; message: string; issues: string[] }
export type ValidResult<T> = ValidOk<T> | ValidFail

// ── Core validator ──────────────────────────────────────────────────────────

export function validateInput<T>(
  schema: z.ZodSchema<T>,
  raw: unknown,
  label = 'input',
): ValidResult<T> {
  const result = schema.safeParse(raw)
  if (result.success) return { ok: true, data: result.data }
  const issues = result.error.issues.map(
    (i) => `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`,
  )
  return {
    ok:      false,
    code:    'invalid_input',
    message: `${label} validation failed: ${issues[0] ?? 'unknown error'}`,
    issues,
  }
}

export function validateOutput<T>(
  schema: z.ZodSchema<T>,
  raw: unknown,
  label = 'output',
): ValidResult<T> {
  const result = schema.safeParse(raw)
  if (result.success) return { ok: true, data: result.data }
  const issues = result.error.issues.map(
    (i) => `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`,
  )
  console.warn(
    `[schema-validator] ${label} mismatch — issues: ${issues.slice(0, 3).join(' | ')}` +
    ` raw_excerpt: ${JSON.stringify(raw)?.slice(0, 200)}`,
  )
  return {
    ok:      false,
    code:    'invalid_output',
    message: `${label} schema mismatch: ${issues[0] ?? 'unknown error'}`,
    issues,
  }
}

// ── Route-level request body schemas ────────────────────────────────────────
// One schema per API route. These are the authoritative shapes that n8n must
// conform to. Every route imports from here instead of defining inline.

import { RequestType, ConfidenceMode, CostStatus } from './ceo'

export const CeoClassifyRequestBody = z.object({
  flow_id:  z.string().min(1),
  brand_id: z.string().uuid().nullable(),
  payload: z.object({
    request_type:           RequestType,
    trigger_payload:        z.record(z.unknown()).default({}),
    evidence_bundle_states: z.record(z.string()).optional(),
    occasion_flags:         z.array(z.string()).optional(),
    current_month_spend_usd: z.number().nonnegative().optional(),
    monthly_ceiling_usd:     z.number().positive().optional(),
  }),
})

export const CooBuildBrandDnaRequestBody = z.object({
  flow_id:  z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    task_type:        z.literal('build_branddna'),
    form_answers:     z.record(z.unknown()).optional(),
    instagram:        z.unknown().optional(),
    website:          z.unknown().optional(),
    places:           z.unknown().optional(),
    occasion_flags:   z.array(z.string()).optional(),
    cost_status:      CostStatus.optional(),
  }),
})

export const CooCompileCaptionContextRequestBody = z.object({
  flow_id:  z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    task_type:       z.literal('compile_caption_context'),
    month:           z.string(),
    post_count:      z.number().int().min(1).max(30).optional(),
    occasion_flags:  z.array(z.string()).optional(),
    cost_status:     CostStatus.optional(),
    cost_constraint: z.string().optional(),
  }),
})

export const CooScoreConfidenceRequestBody = z.object({
  flow_id:  z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    task_type:       z.literal('score_confidence'),
    cco_results:     z.array(z.unknown()),
    occasion_flags:  z.array(z.string()).optional(),
    cost_status:     CostStatus.optional(),
  }),
})

export const DeepSeekGenerateRequestBody = z.object({
  flow_id:  z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    caption_context:      z.string().min(1),
    post_count:           z.number().int().min(1).max(30),
    schedule_dates:       z.array(z.unknown()).optional(),
    occasion_flags:       z.array(z.string()).optional(),
    watermark_required:   z.boolean().optional(),
    is_first_ever_post:   z.boolean().optional(),
    cost_status:          CostStatus.optional(),
  }),
})

export const CcoQcRequestBody = z.object({
  flow_id:  z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    captions:        z.array(z.unknown()).min(1),
    brand_context:   z.record(z.unknown()).optional(),
    occasion_flags:  z.array(z.string()).optional(),
    cost_status:     CostStatus.optional(),
  }),
})

export const ImageGenerateRequestBody = z.object({
  flow_id:       z.string().min(1),
  brand_id:      z.string().uuid(),
  post_id:       z.string().uuid(),
  prompt_en:     z.string().min(1),
  brand_name_ar: z.string().min(1),
  dialect:       z.string(),
  channel:       z.string(),
  confidence_flag: z.enum(['clean', 'watermark_required', 'hold']),
  chain_id:      z.string().optional(),
  month:         z.string(),
  score:         z.number().min(0).max(100).optional(),
})

// ── Shared error response shape ──────────────────────────────────────────────

export interface AgentErrorResponse {
  error:   string
  code:    string
  issues?: string[]
}

export function makeValidationError(result: ValidFail): AgentErrorResponse {
  return { error: result.message, code: result.code, issues: result.issues }
}
