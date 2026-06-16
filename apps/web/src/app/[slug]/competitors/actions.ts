'use server'

import { adminClient } from '@repo/db'
import { requireBrandAccess } from '@repo/auth/server'

export async function markAlertRead(alertId: string, brandId: string): Promise<{ ok: boolean }> {
  try { await requireBrandAccess(brandId) } catch { return { ok: false } }

  await adminClient()
    .from('competitor_alerts')
    .update({ is_read: true } as never)
    .eq('alert_id', alertId)
    .eq('brand_id', brandId)

  return { ok: true }
}

export async function markAllAlertsRead(brandId: string): Promise<{ ok: boolean }> {
  try { await requireBrandAccess(brandId) } catch { return { ok: false } }

  await adminClient()
    .from('competitor_alerts')
    .update({ is_read: true } as never)
    .eq('brand_id', brandId)
    .eq('is_read', false)

  return { ok: true }
}
