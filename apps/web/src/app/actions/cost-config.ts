'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { adminQ } from '@repo/db'
import { requireAdmin } from '@/lib/admin-session'

export interface CostConfigResult {
  ok: boolean
  error?: string
}

// ── System ceiling ────────────────────────────────────────────────────────────

const SystemCostConfigSchema = z.object({
  monthly_ceiling_usd: z.coerce.number().min(1).max(100000),
  alert_at_pct:        z.coerce.number().int().min(1).max(99),
  halt_at_pct:         z.coerce.number().int().min(1).max(200),
})

export async function saveSystemCostConfig(
  _prev: CostConfigResult,
  formData: FormData,
): Promise<CostConfigResult> {
  await requireAdmin()
  const parsed = SystemCostConfigSchema.safeParse({
    monthly_ceiling_usd: formData.get('monthly_ceiling_usd'),
    alert_at_pct:        formData.get('alert_at_pct'),
    halt_at_pct:         formData.get('halt_at_pct'),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors.map((e) => e.message).join(', ') }
  }
  try {
    await adminQ.upsertSystemCostConfig(parsed.data)
    revalidatePath('/admin/cost')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

const CostConfigSchema = z.object({
  brand_id:            z.string().uuid(),
  monthly_ceiling_usd: z.coerce.number().min(1).max(10000),
  tier:                z.enum(['starter', 'standard', 'professional', 'enterprise']),
  alert_at_pct:        z.coerce.number().int().min(1).max(99),
  halt_at_pct:         z.coerce.number().int().min(1).max(200),
})

export async function saveBrandCostConfig(
  _prev: CostConfigResult,
  formData: FormData,
): Promise<CostConfigResult> {
  await requireAdmin()

  const parsed = CostConfigSchema.safeParse({
    brand_id:            formData.get('brand_id'),
    monthly_ceiling_usd: formData.get('monthly_ceiling_usd'),
    tier:                formData.get('tier'),
    alert_at_pct:        formData.get('alert_at_pct'),
    halt_at_pct:         formData.get('halt_at_pct'),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors.map((e) => e.message).join(', ') }
  }

  try {
    await adminQ.upsertBrandCostConfig(parsed.data)
    revalidatePath('/admin/cost')
    revalidatePath(`/admin/cost/${parsed.data.brand_id}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
