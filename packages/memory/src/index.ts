/**
 * @repo/memory — Memory Controller (Doc §4 + §6.1 Step 8).
 *
 * The ONLY module allowed to write BrandDNA tables. Hard Rule #2 (Doc §1.4):
 *   "No AI agent writes to BrandDNA tables directly. All writes are
 *    nominated by CEO, queued in memory_controller_queue, validated by
 *    Memory Controller, then written."
 *
 * Public API:
 *   - enqueueNominations(db, nominations[])  → write to queue (idempotent)
 *   - processQueue(db, { batch_size })       → drain pending → write/reject
 *   - validateNomination(db, nom)            → pure validator (testable)
 *   - Nomination, NominationType, ...        → Zod schemas + types
 */
export { enqueueNominations, summarize, type EnqueueResult, type EnqueueOptions } from './enqueue'
export { processQueue, type ProcessOptions } from './process'
export { validateNomination, validateAnonymousSignal, type ValidationResult } from './validate'
export {
  Nomination,
  NominationType,
  ConfidenceState,
  FieldUpdateData,
  ConfidenceUpgradeData,
  NegativePatternAddData,
  OverrideRuleAddData,
  SectorSignalData,
  GlobalSignalData,
  ALLOWED_FIELD_PATHS,
  type AllowedFieldPath,
  type RejectionCode,
  type ProcessResult,
  type NominationProcessed,
} from './types'
export type { EventType } from './event-log'
export { translateCeoNominations, type TranslateResult } from './translate'
export { closeSharedPgClient } from './pg-bypass'
