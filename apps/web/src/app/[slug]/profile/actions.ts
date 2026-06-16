'use server'

import { getBrandForCurrentUser } from '@repo/auth/server'

export interface CorrectionResult {
  ok: boolean
  error?: string
}

export async function submitCorrection(
  fieldName: string,
  correctionText: string,
  slug: string,
): Promise<CorrectionResult> {
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) return { ok: false, error: 'Access denied.' }

  const brandId = (brand as unknown as Record<string, unknown>)['brand_id'] as string

  const a04Url = process.env.N8N_INBOUND_URL && process.env.N8N_A04_WEBHOOK_PATH
    ? `${process.env.N8N_INBOUND_URL}${process.env.N8N_A04_WEBHOOK_PATH}`
    : null

  if (!a04Url) {
    // N8N-A04 not configured — log locally so the correction isn't silently lost
    console.warn('[profile/correction] N8N_A04 webhook not configured — correction logged but not dispatched', { brandId, fieldName })
    return { ok: true }
  }

  try {
    const res = await fetch(a04Url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand_id: brandId,
        slug,
        field_name: fieldName,
        correction_text: correctionText,
        source: 'client_correction_form',
      }),
    })

    if (!res.ok) throw new Error(`N8N-A04 responded ${res.status}`)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Failed to send correction. Please try again.' }
  }
}
