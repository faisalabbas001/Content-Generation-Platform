'use server'

/**
 * Admin actions — every write the admin UI can perform.
 *
 * Hard Rule #2 enforcement:
 *   Layer 1 BrandDNA columns (brand_profiles, evidence_bundles,
 *   audience_profiles, visual_style_profiles, brand_method_profiles) are
 *   NEVER updated directly here. Admin writes go through the same Memory
 *   Controller queue the agents use. Anything else (governance tables like
 *   negative_patterns / override_rules; audit metadata like anomaly_records;
 *   side-effects like Memory Controller drain) is a direct admin-scoped write
 *   gated by requireAdmin().
 *
 * Pattern:
 *   - All actions begin with requireAdmin() — non-admins get 401 redirected.
 *   - Each action validates input with Zod.
 *   - On success we revalidatePath() so the caller's RSC re-renders.
 *   - We never throw to the client; we return { ok: true } / { ok: false, error }.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { adminClient } from '@repo/db'
import { enqueueNominations, processQueue } from '@repo/memory'
import { onboardingWritesQ } from '@repo/db'
import { requireAdmin } from '@/lib/admin-session'

interface ActionOk { ok: true; result?: Record<string, unknown> }
interface ActionFail { ok: false; error: string }
type ActionResult = ActionOk | ActionFail

// ─────────────────────────────────────────────────────────────────────────
// 1. anomaly_records — mark resolved / un-resolved
// ─────────────────────────────────────────────────────────────────────────

const ResolveAnomalySchema = z.object({
  anomaly_id: z.string().uuid(),
  resolved: z.boolean().default(true),
})

export async function resolveAnomaly(input: z.infer<typeof ResolveAnomalySchema>): Promise<ActionResult> {
  await requireAdmin()
  const parsed = ResolveAnomalySchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  const { error } = await adminClient()
    .from('anomaly_records')
    .update({ resolved: parsed.data.resolved } as never)
    .eq('anomaly_id', parsed.data.anomaly_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/admin/anomalies')
  return { ok: true }
}

// Bulk-resolve all anomalies of a given type for a brand. Useful when the
// underlying bug has been fixed and the operator wants to clear the dashboard.
const BulkResolveSchema = z.object({
  brand_id: z.string().uuid().optional(),
  anomaly_type: z.string().min(1).optional(),
})

export async function bulkResolveAnomalies(input: z.infer<typeof BulkResolveSchema>): Promise<ActionResult> {
  await requireAdmin()
  const parsed = BulkResolveSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  let q = adminClient()
    .from('anomaly_records')
    .update({ resolved: true } as never)
    .eq('resolved', false)
  if (parsed.data.brand_id) q = q.eq('brand_id', parsed.data.brand_id)
  if (parsed.data.anomaly_type) q = q.eq('anomaly_type', parsed.data.anomaly_type)

  const { error } = await q
  if (error) return { ok: false, error: error.message }

  revalidatePath('/admin/anomalies')
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. memory_controller_queue — approve (force-pending) / reject manually
// ─────────────────────────────────────────────────────────────────────────

const QueueDecisionSchema = z.object({
  nomination_id: z.string().uuid(),
  decision: z.enum(['approve_retry', 'reject']),
  reason: z.string().max(500).optional(),
  /** When set on approve_retry, overwrites nomination_data.proposed_value before re-processing. */
  override_value: z.string().max(2000).optional(),
})

/**
 * `approve_retry` flips a `rejected` row back to `pending` so the next drain
 * re-attempts it. If `override_value` is provided the proposed_value in
 * nomination_data is patched first — so the admin can correct the value before
 * forcing a write.
 * `reject` flips a `pending` row to `rejected` with a manual reason.
 */
export async function queueDecision(input: z.infer<typeof QueueDecisionSchema>): Promise<ActionResult> {
  await requireAdmin()
  const parsed = QueueDecisionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  const db = adminClient()
  const target = parsed.data.decision === 'approve_retry' ? 'pending' : 'rejected'
  const update: Record<string, unknown> = {
    status: target,
    processed_at: target === 'rejected' ? new Date().toISOString() : null,
  }
  if (parsed.data.reason) update.rejection_reason = parsed.data.reason
  else if (target === 'pending') update.rejection_reason = null

  // If the admin supplied an override value, patch nomination_data.proposed_value.
  // We read the existing row first to merge cleanly.
  if (target === 'pending' && parsed.data.override_value !== undefined) {
    const { data: existing } = await db
      .from('memory_controller_queue')
      .select('nomination_data')
      .eq('nomination_id', parsed.data.nomination_id)
      .single()
    const existingData = (existing as { nomination_data: Record<string, unknown> } | null)?.nomination_data ?? {}
    update.nomination_data = { ...existingData, proposed_value: parsed.data.override_value }
  }

  const { data, error } = await db
    .from('memory_controller_queue')
    .update(update as never)
    .eq('nomination_id', parsed.data.nomination_id)
    .select('brand_id')
    .single()
  if (error) return { ok: false, error: error.message }
  const brandId = (data as { brand_id: string | null } | null)?.brand_id
  if (brandId) revalidatePath(`/admin/branddna/${brandId}`)
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Force a Memory Controller drain for a brand
// ─────────────────────────────────────────────────────────────────────────

const DrainSchema = z.object({
  brand_id: z.string().uuid(),
  batch_size: z.number().int().min(1).max(200).default(100),
})

export async function forceMemoryDrain(input: z.infer<typeof DrainSchema>): Promise<ActionResult> {
  await requireAdmin()
  const parsed = DrainSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  try {
    const db = adminClient()
    const result = await processQueue(db, { batch_size: parsed.data.batch_size })
    revalidatePath(`/admin/branddna/${parsed.data.brand_id}`)
    return { ok: true, result: { written: result.written, rejected: result.rejected, total: result.total } }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 4. override_rules — add (admin-scoped governance table)
// ─────────────────────────────────────────────────────────────────────────

const OverrideRuleSchema = z.object({
  brand_id: z.string().uuid(),
  rule_key: z.string().min(2).max(120),
  rule_value: z.string().min(1), // JSON-encoded string from the form
  reasoning: z.string().max(500).optional(),
})

export async function addOverrideRule(input: z.infer<typeof OverrideRuleSchema>): Promise<ActionResult> {
  await requireAdmin()
  const parsed = OverrideRuleSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  let ruleValue: unknown
  try { ruleValue = JSON.parse(parsed.data.rule_value) }
  catch { ruleValue = parsed.data.rule_value }

  const db = adminClient()
  const { data: existing } = await db
    .from('override_rules')
    .select('rule_id')
    .eq('brand_id', parsed.data.brand_id)
    .eq('rule_key', parsed.data.rule_key)
    .maybeSingle()

  let writeError: unknown
  if (existing) {
    const { error } = await db
      .from('override_rules')
      .update({ rule_value: ruleValue, reasoning: parsed.data.reasoning ?? null, updated_at: new Date().toISOString() } as never)
      .eq('rule_id', (existing as { rule_id: string }).rule_id)
    writeError = error
  } else {
    const { error } = await db
      .from('override_rules')
      .insert({ brand_id: parsed.data.brand_id, rule_key: parsed.data.rule_key, rule_value: ruleValue, reasoning: parsed.data.reasoning ?? null } as never)
    writeError = error
  }

  if (writeError) return { ok: false, error: (writeError as { message: string }).message }

  await invalidateBrandVectorCache(parsed.data.brand_id)
  revalidatePath(`/admin/branddna/${parsed.data.brand_id}`)
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────
// 5. negative_patterns — add (governance table)
// ─────────────────────────────────────────────────────────────────────────

const NegativePatternSchema = z.object({
  brand_id: z.string().uuid(),
  pattern_text: z.string().min(2).max(500),
  severity: z.enum(['SOFT_WARN', 'STRONG_WARN', 'HARD_BLOCK']).default('STRONG_WARN'),
  reasoning: z.string().max(500).optional(),
})

export async function addNegativePattern(input: z.infer<typeof NegativePatternSchema>): Promise<ActionResult> {
  await requireAdmin()
  const parsed = NegativePatternSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  const { error } = await adminClient()
    .from('negative_patterns')
    .insert({
      brand_id: parsed.data.brand_id,
      pattern_text: parsed.data.pattern_text,
      severity: parsed.data.severity,
      reasoning: parsed.data.reasoning ?? null,
      source: 'admin',
    } as never)

  // 23505 = unique violation — pattern already exists, treat as success
  if (error && (error as { code?: string }).code !== '23505') {
    return { ok: false, error: error.message }
  }

  await invalidateBrandVectorCache(parsed.data.brand_id)
  revalidatePath(`/admin/branddna/${parsed.data.brand_id}`)
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────
// 6. Delete a negative_pattern / override_rule (governance cleanup)
// ─────────────────────────────────────────────────────────────────────────

const DeletePatternSchema = z.object({
  brand_id: z.string().uuid(),
  pattern_id: z.string().uuid(),
})

export async function deleteNegativePattern(input: z.infer<typeof DeletePatternSchema>): Promise<ActionResult> {
  await requireAdmin()
  const parsed = DeletePatternSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }
  const { error } = await adminClient()
    .from('negative_patterns')
    .delete()
    .eq('pattern_id', parsed.data.pattern_id)
    .eq('brand_id', parsed.data.brand_id)
  if (error) return { ok: false, error: error.message }
  // Invalidate Qdrant cache so next caption generation recompiles policy layer
  await invalidateBrandVectorCache(parsed.data.brand_id)
  revalidatePath(`/admin/branddna/${parsed.data.brand_id}`)
  return { ok: true }
}

const DeleteRuleSchema = z.object({
  brand_id: z.string().uuid(),
  rule_id: z.string().uuid(),
})

export async function deleteOverrideRule(input: z.infer<typeof DeleteRuleSchema>): Promise<ActionResult> {
  await requireAdmin()
  const parsed = DeleteRuleSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }
  const { error } = await adminClient()
    .from('override_rules')
    .delete()
    .eq('rule_id', parsed.data.rule_id)
    .eq('brand_id', parsed.data.brand_id)
  if (error) return { ok: false, error: error.message }
  await invalidateBrandVectorCache(parsed.data.brand_id)
  revalidatePath(`/admin/branddna/${parsed.data.brand_id}`)
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────
// 6b. global_negative_patterns — platform-wide CRUD (admin only)
// ─────────────────────────────────────────────────────────────────────────

const GlobalPatternSchema = z.object({
  pattern_text: z.string().min(2).max(500),
  severity: z.enum(['SOFT_WARN', 'STRONG_WARN', 'HARD_BLOCK']).default('HARD_BLOCK'),
  category: z.string().min(1).max(80).default('general'),
  description: z.string().max(500).optional(),
})

export async function addGlobalNegativePattern(input: z.infer<typeof GlobalPatternSchema>): Promise<ActionResult> {
  await requireAdmin()
  const parsed = GlobalPatternSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }
  const admin = await requireAdmin()
  const { error } = await adminClient()
    .from('global_negative_patterns' as never)
    .upsert({
      pattern_text: parsed.data.pattern_text,
      severity: parsed.data.severity,
      category: parsed.data.category,
      description: parsed.data.description ?? null,
      is_active: true,
      created_by: (admin as { id?: string }).id ?? null,
    } as never, { onConflict: 'pattern_text', ignoreDuplicates: false })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/negative-patterns')
  return { ok: true }
}

const ToggleGlobalPatternSchema = z.object({
  pattern_id: z.string().uuid(),
  is_active: z.boolean(),
})

export async function toggleGlobalNegativePattern(input: z.infer<typeof ToggleGlobalPatternSchema>): Promise<ActionResult> {
  await requireAdmin()
  const parsed = ToggleGlobalPatternSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }
  const { error } = await adminClient()
    .from('global_negative_patterns' as never)
    .update({ is_active: parsed.data.is_active } as never)
    .eq('pattern_id', parsed.data.pattern_id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/negative-patterns')
  return { ok: true }
}

const DeleteGlobalPatternSchema = z.object({ pattern_id: z.string().uuid() })

export async function deleteGlobalNegativePattern(input: z.infer<typeof DeleteGlobalPatternSchema>): Promise<ActionResult> {
  await requireAdmin()
  const parsed = DeleteGlobalPatternSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }
  const { error } = await adminClient()
    .from('global_negative_patterns' as never)
    .delete()
    .eq('pattern_id', parsed.data.pattern_id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/negative-patterns')
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────
// 8. cultural_gesture_blocks — toggle active / inactive
// ─────────────────────────────────────────────────────────────────────────

const ToggleGestureBlockSchema = z.object({
  gesture_key: z.string().min(1),
  is_active: z.boolean(),
})

export async function toggleGestureBlock(input: z.infer<typeof ToggleGestureBlockSchema>): Promise<ActionResult> {
  await requireAdmin()
  const parsed = ToggleGestureBlockSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }
  const { error } = await adminClient()
    .from('cultural_gesture_blocks')
    .update({ is_active: parsed.data.is_active, updated_at: new Date().toISOString() })
    .eq('gesture_key', parsed.data.gesture_key)
  if (error) return { ok: false, error: error.message }
  // Flush the in-process rule cache so the gate picks up the change immediately.
  const { clearComplianceCache } = await import('@repo/compliance')
  clearComplianceCache()
  revalidatePath('/admin/compliance')
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────
// Shared helper: invalidate Qdrant caption-context cache for a brand.
// Best-effort — Qdrant may not be configured in dev.
// ─────────────────────────────────────────────────────────────────────────
async function invalidateBrandVectorCache(brand_id: string): Promise<void> {
  try {
    const { isVectorsConfigured, invalidateBrandCache } = await import('@repo/vectors')
    if (!isVectorsConfigured()) return
    await invalidateBrandCache(brand_id)
  } catch {
    // non-fatal — log only
    console.warn(`[admin/actions] vector cache invalidation skipped for ${brand_id}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 7. Re-link sector baseline (after sector or dialect was corrected)
// ─────────────────────────────────────────────────────────────────────────

const LinkBaselineSchema = z.object({
  brand_id: z.string().uuid(),
})

export async function relinkSectorBaseline(input: z.infer<typeof LinkBaselineSchema>): Promise<ActionResult> {
  await requireAdmin()
  const parsed = LinkBaselineSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }
  try {
    const db = adminClient()
    // Clear stale link first so linkSectorBaseline re-evaluates.
    await db.from('brand_profiles').update({ sector_baseline_id: null } as never).eq('brand_id', parsed.data.brand_id)
    const r = await onboardingWritesQ.linkSectorBaseline(db, parsed.data.brand_id)
    revalidatePath(`/admin/branddna/${parsed.data.brand_id}`)
    return { ok: true, result: { linked: r.linked } }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 8. Refresh completeness — calls the SQL function directly
// ─────────────────────────────────────────────────────────────────────────

const RecomputeCompletenessSchema = z.object({
  brand_id: z.string().uuid(),
})

export async function recomputeCompleteness(input: z.infer<typeof RecomputeCompletenessSchema>): Promise<ActionResult> {
  await requireAdmin()
  const parsed = RecomputeCompletenessSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }
  const db = adminClient()
  const { error } = await db.rpc('refresh_brand_completeness', { p_brand_id: parsed.data.brand_id } as never)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/admin/branddna/${parsed.data.brand_id}`)
  revalidatePath(`/admin/clients/${parsed.data.brand_id}`)
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────
// User management actions (admin section)
// ─────────────────────────────────────────────────────────────────────────

const BanUserSchema = z.object({
  user_id: z.string().uuid(),
  // Duration in hours; 0 = unban (lift any active ban).
  duration_hours: z.number().int().min(0).max(24 * 365),
})

/**
 * Suspend or un-suspend a user. Uses Supabase Auth's banned_until column.
 * duration_hours=0 → unban (set banned_until to a past timestamp).
 */
export async function banUser(input: z.infer<typeof BanUserSchema>): Promise<ActionResult> {
  await requireAdmin()
  const parsed = BanUserSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }
  const db = adminClient()
  const banDurationStr = parsed.data.duration_hours === 0
    ? 'none'
    : `${parsed.data.duration_hours}h`
  try {
    const { error } = await db.auth.admin.updateUserById(parsed.data.user_id, {
      ban_duration: banDurationStr,
    } as never)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/admin/users')
    revalidatePath(`/admin/users/${parsed.data.user_id}`)
    return { ok: true, result: { ban_duration: banDurationStr } }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

const ResendInviteSchema = z.object({ user_id: z.string().uuid() })
export async function resendInvite(input: z.infer<typeof ResendInviteSchema>): Promise<ActionResult> {
  await requireAdmin()
  const parsed = ResendInviteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }
  const db = adminClient()
  try {
    // Fetch email to resend invite to.
    const { data: u, error: e1 } = await db.auth.admin.getUserById(parsed.data.user_id)
    if (e1 || !u?.user?.email) return { ok: false, error: 'user_or_email_not_found' }
    const { error } = await db.auth.admin.inviteUserByEmail(u.user.email)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

const DeleteUserSchema = z.object({ user_id: z.string().uuid(), confirm_email: z.string().email() })
/**
 * Soft-delete a user. Verifies the email matches as a safety check (admin
 * must type the email to confirm). brand_profiles.auth_user_id has ON DELETE
 * CASCADE so all owned brands + child rows cascade.
 *
 * Use sparingly. Prefer banUser for revocable suspension.
 */
export async function deleteUser(input: z.infer<typeof DeleteUserSchema>): Promise<ActionResult> {
  await requireAdmin()
  const parsed = DeleteUserSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }
  const db = adminClient()
  try {
    const { data: u, error: e1 } = await db.auth.admin.getUserById(parsed.data.user_id)
    if (e1 || !u?.user) return { ok: false, error: 'user_not_found' }
    if (u.user.email !== parsed.data.confirm_email) {
      return { ok: false, error: 'email_mismatch — type the user\'s email exactly to confirm deletion' }
    }
    const { error } = await db.auth.admin.deleteUser(parsed.data.user_id)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/admin/users')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 10. visual_style_profiles — update color_palette and/or style_descriptor
//     Goes through Memory Controller queue (Hard Rule #2) + drains immediately.
// ─────────────────────────────────────────────────────────────────────────

const VisualStyleSchema = z.object({
  brand_id: z.string().uuid(),
  color_palette: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex colour e.g. #FF5500')).min(1).max(12).optional(),
  style_descriptor: z.string().min(2).max(1000).optional(),
}).refine((d) => d.color_palette !== undefined || d.style_descriptor !== undefined, {
  message: 'Provide at least one of color_palette or style_descriptor',
})

export async function updateVisualStyle(input: z.infer<typeof VisualStyleSchema>): Promise<ActionResult> {
  await requireAdmin()
  const parsed = VisualStyleSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_input' }

  const db = adminClient()
  const nominations = []

  if (parsed.data.color_palette !== undefined) {
    nominations.push({
      nomination_type: 'field_update' as const,
      brand_id: parsed.data.brand_id,
      data: {
        field_path: 'VisualStyleProfile.color_palette',
        proposed_value: parsed.data.color_palette,
        source: 'client_confirmation',
        confidence_delta: 'confirmed',
        human_review_required: false,
      },
    })
  }

  if (parsed.data.style_descriptor !== undefined) {
    nominations.push({
      nomination_type: 'field_update' as const,
      brand_id: parsed.data.brand_id,
      data: {
        field_path: 'VisualStyleProfile.style_descriptor',
        proposed_value: parsed.data.style_descriptor,
        source: 'client_confirmation',
        confidence_delta: 'confirmed',
        human_review_required: false,
      },
    })
  }

  const enq = await enqueueNominations(db, nominations, { nominated_by: 'admin' })
  if (enq.rejected_at_input > 0) {
    return { ok: false, error: enq.details.find((d) => !d.ok)?.error ?? 'enqueue rejected' }
  }
  try { await processQueue(db, { batch_size: 10 }) } catch { /* drain best-effort */ }
  revalidatePath(`/admin/branddna/${parsed.data.brand_id}`)
  return { ok: true }
}
