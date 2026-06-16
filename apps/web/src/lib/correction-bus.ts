/**
 * Stub — correction-bus replaced by DB polling in submitBrandCorrection.
 * Kept so the webhooks/n8n import compiles without changes; publishOutcome
 * is now a no-op (the server action reads outcome directly from the DB).
 */

export interface CorrectionOutcome {
  status: 'written' | 'rejected'
  rejection_reason?: string
  memory_written?: number
}

export function waitForOutcome(_brand_id: string, _field_name: string): Promise<CorrectionOutcome | null> {
  return Promise.resolve(null)
}

export function publishOutcome(_brand_id: string, _field_name: string, _outcome: CorrectionOutcome): void {
  // no-op — outcome is read from DB, not in-memory bus
}
