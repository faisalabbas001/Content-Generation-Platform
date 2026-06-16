'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { adminClient } from '@repo/db/client'
import { requireUser } from '@repo/auth/server'

export interface PolicyActionResult {
  ok: boolean
  error?: string
}

// ── resolve brand_id from slug + verify ownership ─────────────────────────
async function resolveBrandId(slug: string): Promise<{ brand_id: string } | { error: string }> {
  const user = await requireUser()
  if (!user) return { error: 'not_authenticated' }

  const { data, error } = await adminClient()
    .from('brand_profiles')
    .select('brand_id, auth_user_id')
    .eq('client_slug', slug)
    .maybeSingle()

  if (error || !data) return { error: 'brand_not_found' }
  if ((data as { auth_user_id: string }).auth_user_id !== user.id) return { error: 'forbidden' }
  return { brand_id: (data as { brand_id: string }).brand_id }
}

async function invalidateVectorCache(brand_id: string): Promise<void> {
  try {
    const { isVectorsConfigured, invalidateBrandCache } = await import('@repo/vectors')
    if (!isVectorsConfigured()) return
    await invalidateBrandCache(brand_id)
  } catch {
    // non-fatal
  }
}

// ── 1. Add negative pattern ───────────────────────────────────────────────

const AddPatternSchema = z.object({
  slug: z.string().min(1),
  pattern_text: z.string().min(2).max(300),
  severity: z.enum(['SOFT_WARN', 'STRONG_WARN', 'HARD_BLOCK']).default('STRONG_WARN'),
  reasoning: z.string().max(300).optional(),
})

export async function addBrandNegativePattern(
  input: z.infer<typeof AddPatternSchema>,
): Promise<PolicyActionResult> {
  const parsed = AddPatternSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  const brand = await resolveBrandId(parsed.data.slug)
  if ('error' in brand) return { ok: false, error: brand.error }

  const { error } = await adminClient()
    .from('negative_patterns')
    .insert({
      brand_id: brand.brand_id,
      pattern_text: parsed.data.pattern_text,
      severity: parsed.data.severity,
      reasoning: parsed.data.reasoning ?? null,
      source: 'user',
    } as never)

  // 23505 = unique violation — pattern already exists, treat as success
  if (error && (error as { code?: string }).code !== '23505') {
    return { ok: false, error: error.message }
  }

  await invalidateVectorCache(brand.brand_id)
  revalidatePath(`/${parsed.data.slug}/profile`)
  return { ok: true }
}

// ── 2. Delete negative pattern ────────────────────────────────────────────

const DeletePatternSchema = z.object({
  slug: z.string().min(1),
  pattern_id: z.string().uuid(),
  brand_id: z.string().uuid(),
})

export async function deleteBrandNegativePattern(
  input: z.infer<typeof DeletePatternSchema>,
): Promise<PolicyActionResult> {
  const parsed = DeletePatternSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  const brand = await resolveBrandId(parsed.data.slug)
  if ('error' in brand) return { ok: false, error: brand.error }
  if (brand.brand_id !== parsed.data.brand_id) return { ok: false, error: 'forbidden' }

  const { error } = await adminClient()
    .from('negative_patterns')
    .delete()
    .eq('pattern_id', parsed.data.pattern_id)
    .eq('brand_id', brand.brand_id)

  if (error) return { ok: false, error: error.message }

  await invalidateVectorCache(brand.brand_id)
  revalidatePath(`/${parsed.data.slug}/profile`)
  return { ok: true }
}

// ── 3. Add override rule ──────────────────────────────────────────────────

const AddRuleSchema = z.object({
  slug: z.string().min(1),
  rule_key: z.string().min(2).max(120),
  rule_value: z.string().min(1), // JSON-encoded
  description: z.string().max(300).optional(),
  reasoning: z.string().max(300).optional(),
})

export async function addBrandOverrideRule(
  input: z.infer<typeof AddRuleSchema>,
): Promise<PolicyActionResult> {
  const parsed = AddRuleSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  const brand = await resolveBrandId(parsed.data.slug)
  if ('error' in brand) return { ok: false, error: brand.error }

  let ruleValue: unknown
  try { ruleValue = JSON.parse(parsed.data.rule_value) }
  catch { ruleValue = parsed.data.rule_value }

  // Check if rule_key already exists for this brand — upsert manually since
  // the unique constraint on (brand_id, rule_key) is a plain index.
  const db = adminClient()
  const { data: existing } = await db
    .from('override_rules')
    .select('rule_id')
    .eq('brand_id', brand.brand_id)
    .eq('rule_key', parsed.data.rule_key)
    .maybeSingle()

  let writeError: unknown
  if (existing) {
    const { error } = await db
      .from('override_rules')
      .update({
        rule_value: ruleValue,
        description: parsed.data.description ?? null,
        reasoning: parsed.data.reasoning ?? null,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('rule_id', (existing as { rule_id: string }).rule_id)
    writeError = error
  } else {
    const { error } = await db
      .from('override_rules')
      .insert({
        brand_id: brand.brand_id,
        rule_key: parsed.data.rule_key,
        rule_value: ruleValue,
        description: parsed.data.description ?? null,
        reasoning: parsed.data.reasoning ?? null,
      } as never)
    writeError = error
  }

  if (writeError) return { ok: false, error: (writeError as { message: string }).message }

  await invalidateVectorCache(brand.brand_id)
  revalidatePath(`/${parsed.data.slug}/profile`)
  return { ok: true }
}

// ── 4. Delete override rule ───────────────────────────────────────────────

const DeleteRuleSchema = z.object({
  slug: z.string().min(1),
  rule_id: z.string().uuid(),
  brand_id: z.string().uuid(),
})

export async function deleteBrandOverrideRule(
  input: z.infer<typeof DeleteRuleSchema>,
): Promise<PolicyActionResult> {
  const parsed = DeleteRuleSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  const brand = await resolveBrandId(parsed.data.slug)
  if ('error' in brand) return { ok: false, error: brand.error }
  if (brand.brand_id !== parsed.data.brand_id) return { ok: false, error: 'forbidden' }

  const { error } = await adminClient()
    .from('override_rules')
    .delete()
    .eq('rule_id', parsed.data.rule_id)
    .eq('brand_id', brand.brand_id)

  if (error) return { ok: false, error: error.message }

  await invalidateVectorCache(brand.brand_id)
  revalidatePath(`/${parsed.data.slug}/profile`)
  return { ok: true }
}
