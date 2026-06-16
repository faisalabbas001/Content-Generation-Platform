// Generated database typings (re-run `pnpm db:types` to refresh)
export type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
  Enums,
} from './schema/database.types'

// Hand-written domain types (kept for back-compat — gradually migrate
// callers to `Tables<'brand_profiles'>` etc.)
export * from './types'

// Supabase client factories
export * from './client'

// Query modules (server-side only)
export * as brandsQ from './queries/brands'
export * as brandDnaQ from './queries/brand-dna'
export * as calendarsQ from './queries/calendars'
export * as adminQ from './queries/admin'
export * as adminRegenQ from './queries/admin-regenerations'
export * as snapshotsQ from './queries/snapshots'
export * as occasionsQ from './queries/occasions'
export * as onboardingWritesQ from './queries/onboarding-writes'
export * as onDemandQ from './queries/on-demand'
export * as copilotContextQ from './queries/copilot-context'
export * as copilotThreadsQ from './queries/copilot-threads'
export * as chainsQ from './queries/chains'
export { openCopilotClient, withCopilotClient, type CopilotPgClient } from './copilot-pg'

// Named type exports — let callers import without going through namespace aliases.
export type { CalendarForRelease, CalendarReleasePost, CalendarQaGroup, CalendarQaPostRow, OnDemandQaGroup } from './queries/admin'
export { getPendingCalendarQaIdsForBrand } from './queries/admin'

// DTO types — let consumers import the BrandDnaView type without going
// through the namespace alias.
export type {
  BrandDnaView,
  AudienceProfile,
  VisualStyleProfile,
  ChannelProfile,
  NegativePattern,
  OverrideRule,
  SourceRecordSummary,
  ConfidenceClassification,
  EvidenceSummary,
  MethodProfileSummary,
} from './queries/brand-dna'

export type {
  ChainRow,
  ChainBrandOverride,
  ChainInsert,
  ChainUpdate,
} from './queries/chains'