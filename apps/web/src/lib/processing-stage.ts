/**
 * Server-side helper: emit a brand_snapshots stage row directly via the
 * admin client. Used by the onboarding server action + the retry endpoint
 * — both of which run inside the same Node process as the API route, so
 * there's no need to round-trip through HMAC.
 *
 * For external callers (n8n flows), use POST /api/processing/stage which
 * does the same thing but verifies HMAC.
 */
import { adminClient } from '@repo/db/client'

export type ProcessingStage =
  // v2 onboarding section markers
  | 'section_1_submitted'
  | 'section_2_submitted'
  | 'extraction_started'
  | 'extraction.instagram_complete'
  | 'extraction.website_complete'
  | 'extraction.places_complete'
  | 'extraction_complete'
  // legacy + main A03 pipeline stages
  | 'form_submitted'
  | 'ceo_classified'
  | 'scraping'
  | 'scraping_complete'
  | 'coo_branddna_built'
  | 'memory_drained'
  | 'snapshot_ready'
  | 'failed'

export interface EmitStageOptions {
  brand_id: string
  stage: ProcessingStage
  metadata?: Record<string, unknown>
  /** When true, marks is_partial=false → triggers UI redirect. */
  mark_complete?: boolean
}

export async function emitProcessingStage(opts: EmitStageOptions): Promise<{ ok: boolean; error?: string }> {
  const db = adminClient()
  const { error } = await db.from('brand_snapshots').insert({
    brand_id: opts.brand_id,
    is_partial: !opts.mark_complete,
    snapshot_data: {
      stage: opts.stage,
      ...(opts.metadata ?? {}),
      stage_at: new Date().toISOString(),
    },
  } as never)

  if (error) return { ok: false, error: error.message }

  if (opts.mark_complete) {
    await db
      .from('brand_profiles')
      .update({ onboarding_status: 'complete', onboarding_completed_at: new Date().toISOString() } as never)
      .eq('brand_id', opts.brand_id)
  } else if (opts.stage === 'failed') {
    await db
      .from('brand_profiles')
      .update({ onboarding_status: 'failed' } as never)
      .eq('brand_id', opts.brand_id)
  }

  return { ok: true }
}
