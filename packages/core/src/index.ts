/** @repo/core — domain model + schemas. */
// ── Calendar Engine — Occasion Logic (Phase 0 spine) ────────────────────────
export {
  computeAdjustedOccasion,
  computeActiveOccasions,
  getDominantContentMix,
  type ContentMix,
  type OccasionPhase,
  type OccasionContext,
  type AdjustedOccasion,
} from './occasions/occasion-logic'
export * as schemas from './schemas'
export {
  validateInput,
  validateOutput,
  makeValidationError,
  CeoClassifyRequestBody,
  CooBuildBrandDnaRequestBody,
  CooCompileCaptionContextRequestBody,
  CooScoreConfidenceRequestBody,
  DeepSeekGenerateRequestBody,
  CcoQcRequestBody,
  ImageGenerateRequestBody,
  type ValidOk,
  type ValidFail,
  type ValidResult,
  type AgentErrorResponse,
} from './schemas/validator'

// ── Single-source-of-truth constants for BrandDNA Lite (10 fields) ────
// + the v2 axis additions (12 critical fields total)
export {
  CRITICAL_BRANDDNA_FIELDS,
  COMPLETENESS_QUALIFYING_STATES,
  computeCompletenessScore,
  fieldPathToCriticalName,
  type CriticalBrandDnaField,
  type CompletenessQualifyingState,
} from './brand/critical-fields'

// ── Single source of truth for CCO score → band thresholds ──────────────────
export {
  SCORE_BANDS,
  scoreBand,
  scoreBandLabel,
  type ScoreBand,
} from './scoring/bands'

// ── v2: Three-axis creative-direction framework ──────────────────────
export { SECTORS, isSector, type Sector } from './brand/sectors'
export {
  ARCHETYPES,
  ARCHETYPE_FREQUENCY,
  ARCHETYPE_DEFINITIONS,
  SECTOR_DEFAULT_ARCHETYPE,
  isArchetype,
  type Archetype,
  type ArchetypeDefinition,
} from './brand/archetypes'
export {
  LIFECYCLE_STAGES,
  isLifecycleStage,
  inferLifecycleStage,
  type LifecycleStage,
  type LifecycleSignals,
} from './brand/lifecycle'
export {
  INTENT_STATES,
  INTENT_CHAIN_MIX,
  INTENT_LABELS,
  isIntentState,
  type IntentState,
  type ChainMix,
} from './brand/intent'
export {
  VOICE_REGISTERS,
  DIAGNOSTIC_PATTERNS,
  VISUAL_IDIOMS,
  CADENCE_RULES,
  CLOSING_PATTERNS,
  CREATIVE_METHODS,
  COMPONENT_LABELS,
  isVoiceRegister,
  isDiagnosticPattern,
  isVisualIdiom,
  isCadenceRule,
  isClosingPattern,
  isCreativeMethod,
  type VoiceRegister,
  type DiagnosticPattern,
  type VisualIdiom,
  type CadenceRule,
  type ClosingPattern,
  type CreativeMethod,
  type MethodProfile,
  type MethodComponentSlot,
} from './brand/method-anatomy'
export {
  scoreMethodsForTuple,
  decideComposition,
  SINGLE_METHOD_THRESHOLD,
  COMPOSITION_FLOOR,
  type CompositionTuple,
  type MatrixRow,
  type CompositionDecision,
} from './brand/composition'
