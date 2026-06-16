/**
 * Memory Controller — nomination types (Doc §4.2 + §6.1 Step 8).
 *
 * Six nomination_type values mirror the `nomination_type_enum` in the DB:
 *   field_update           → write a Layer 1 BrandDNA field (audience/visual/etc.)
 *   confidence_upgrade     → bump an evidence_bundles.field_confidence state
 *   negative_pattern_add   → insert a per-brand negative_patterns row
 *   override_rule_add      → insert a per-brand override_rules row
 *   sector_signal          → update Layer 2 (sector_baselines)
 *   global_signal          → update Layer 3 (content_performance_patterns)
 *
 * The CEO returns a `memory_nominations[]` array on every call (per the CEO
 * prompt). The Memory Controller is the ONLY thing allowed to interpret +
 * apply them. CEO never writes — even though it has service-role access via
 * the AI provider wrapper.
 */
import { z } from 'zod'

// ── Confidence states (mirrors the field_confidence_type DB enum) ─────────
export const ConfidenceState = z.enum([
  'explicitly_confirmed',
  'inferred_high',
  'inferred_medium',
  'inferred_low',
  'rejected',
  'deprecated',
])
export type ConfidenceState = z.infer<typeof ConfidenceState>

// ── Severity for negative_patterns (mirrors negpat_severity_type) ─────────
export const NegPatSeverity = z.enum(['SOFT_WARN', 'STRONG_WARN', 'HARD_BLOCK'])

// ── Sector + dialect (used by sector_signal + global_signal) ──────────────
export const SectorType = z.enum([
  'F&B', 'Retail', 'Beauty_Wellness', 'Healthcare', 'Finance', 'Government', 'Other',
])
export const DialectType = z.enum([
  'Najdi', 'Hejazi', 'Gulf', 'MSA_formal', 'MSA_accessible', 'Mixed',
])

// ─────────────────────────────────────────────────────────────────────────
// Per-nomination data schemas. Each is the SHAPE of `nomination_data` for
// the corresponding `nomination_type`. The Memory Controller validates every
// inbound nomination against the matching schema before doing anything.
// ─────────────────────────────────────────────────────────────────────────

// Whitelist of dotted field paths the Memory Controller is allowed to write.
// Matches the prompt vocabulary (`VoiceProfile.arabic_dialect`) but each entry
// names the actual SQL table + column the writer will hit. Anything not in
// this list is rejected (defensive default — no CEO can invent a new field).
export const ALLOWED_FIELD_PATHS = {
  // brand_profiles columns
  // NOTE: the COO prompt emits `VoiceProfile.arabic_dialect` (legacy naming
  // matching the JS-side ConfidenceBundle layout), while everyone else uses
  // `BrandProfile.arabic_dialect`. Both forms point at the same column.
  'VoiceProfile.arabic_dialect':         { table: 'brand_profiles',     column: 'arabic_dialect',         enum: ['Najdi','Hejazi','Gulf','MSA_formal','MSA_accessible','Mixed'] },
  'BrandProfile.arabic_dialect':         { table: 'brand_profiles',     column: 'arabic_dialect',         enum: ['Najdi','Hejazi','Gulf','MSA_formal','MSA_accessible','Mixed'] },
  'BrandProfile.price_position':         { table: 'brand_profiles',     column: 'price_position',         enum: ['budget','mid_market','premium','luxury'] },
  'BrandProfile.formality_level':        { table: 'brand_profiles',     column: 'formality_level',        enum: ['casual','semi_formal','formal'] },
  'BrandProfile.humor_tolerance':        { table: 'brand_profiles',     column: 'humor_tolerance',        enum: ['none','light','moderate'] },
  'BrandProfile.religious_sensitivity':  { table: 'brand_profiles',     column: 'religious_sensitivity',  enum: ['Low','Medium','High'] },
  'BrandProfile.bilingual_ratio':        { table: 'brand_profiles',     column: 'bilingual_ratio',        enum: ['arabic_only','arabic_primary','balanced','english_primary'] },
  'BrandProfile.brand_differentiator':   { table: 'brand_profiles',     column: 'brand_differentiator',   enum: null },
  'BrandProfile.primary_color_hex':      { table: 'brand_profiles',     column: 'primary_color_hex',      enum: null, regex: /^#[0-9A-Fa-f]{6}$/ },
  'BrandProfile.completeness_score':     { table: 'brand_profiles',     column: 'completeness_score',     enum: null, type: 'number', min: 0, max: 100 },
  // audience_profiles
  'AudienceProfile.description_ar':      { table: 'audience_profiles',  column: 'description_ar',         enum: null },
  'AudienceProfile.gender_mix':          { table: 'audience_profiles',  column: 'gender_mix',             enum: null, type: 'jsonb' },
  'AudienceProfile.age_range':           { table: 'audience_profiles',  column: 'age_range',              enum: null, type: 'jsonb' },
  'AudienceProfile.language_preference': { table: 'audience_profiles',  column: 'language_preference',    enum: ['arabic_only','arabic_primary','balanced','english_primary'] },
  // visual_style_profiles
  'VisualStyleProfile.style_descriptor': { table: 'visual_style_profiles', column: 'style_descriptor',    enum: null },
  'VisualStyleProfile.color_palette':    { table: 'visual_style_profiles', column: 'color_palette',       enum: null, type: 'text[]' },
  'VisualStyleProfile.style_register':   { table: 'visual_style_profiles', column: 'style_register',      enum: ['traditional','modern','youth','mixed'] },
  // LoRA storage is on brand_profiles (migration 0077), not visual_style_profiles
  'BrandProfile.lora_model_id':          { table: 'brand_profiles', column: 'lora_model_id',              enum: null },
  'BrandProfile.lora_training_status':   { table: 'brand_profiles', column: 'lora_training_status',       enum: ['not_started','collecting_photos','training','ready','failed'] },
  'BrandProfile.lora_training_photo_count': { table: 'brand_profiles', column: 'lora_training_photo_count', enum: null, type: 'number' },
  // ── v2 axis fields (Doc framework v2) ───────────────────────────
  'BrandProfile.archetype_primary':   { table: 'brand_profiles', column: 'archetype_primary',   enum: ['Innocent','Sage','Explorer','Outlaw','Magician','Hero','Lover','Jester','Everyman','Caregiver','Ruler','Creator'] },
  'BrandProfile.archetype_secondary': { table: 'brand_profiles', column: 'archetype_secondary', enum: ['Innocent','Sage','Explorer','Outlaw','Magician','Hero','Lover','Jester','Everyman','Caregiver','Ruler','Creator'] },
  'BrandProfile.lifecycle_stage':     { table: 'brand_profiles', column: 'lifecycle_stage',     enum: ['pre_launch','launch','growth','maturity','recovery'] },
  'BrandProfile.intent_state':        { table: 'brand_profiles', column: 'intent_state',        enum: ['launch','grow','defend','harvest','recover'] },
  // Remaining critical fields that COO nominates (Doc §6.2). Without these
  // entries, `field_update` nominations are rejected as `forbidden_field_path`
  // and the 10 critical fields never land on brand_profiles.
  'BrandProfile.primary_channel':         { table: 'brand_profiles', column: 'primary_channel',         enum: ['Instagram','Snapchat','TikTok','Twitter'] },
  'BrandProfile.primary_kpi_type':        { table: 'brand_profiles', column: 'primary_kpi_type',        enum: ['engagement','conversion','awareness','trust'] },
  'BrandProfile.ramadan_relevance':       { table: 'brand_profiles', column: 'ramadan_relevance',       enum: ['Critical','High','Medium','Low','Not_relevant'] },
  'BrandProfile.tone_anti_attribute_ids': { table: 'brand_profiles', column: 'tone_anti_attribute_ids', enum: null, type: 'text[]' },

  // VoiceProfile.* aliases — COO occasionally emits the legacy/incorrect
  // `VoiceProfile.X` prefix for fields that actually live on brand_profiles.
  // Rather than fail validation 9 times per onboarding, accept either form
  // and route to the same underlying column. We already have arabic_dialect
  // aliased above; mirror that for the rest.
  'VoiceProfile.brand_differentiator':   { table: 'brand_profiles', column: 'brand_differentiator',   enum: null },
  'VoiceProfile.price_position':         { table: 'brand_profiles', column: 'price_position',         enum: ['budget','mid_market','premium','luxury'] },
  'VoiceProfile.primary_channel':        { table: 'brand_profiles', column: 'primary_channel',        enum: ['Instagram','Snapchat','TikTok','Twitter'] },
  'VoiceProfile.primary_kpi_type':       { table: 'brand_profiles', column: 'primary_kpi_type',       enum: ['engagement','conversion','awareness','trust'] },
  'VoiceProfile.ramadan_relevance':      { table: 'brand_profiles', column: 'ramadan_relevance',      enum: ['Critical','High','Medium','Low','Not_relevant'] },
  'VoiceProfile.religious_sensitivity':  { table: 'brand_profiles', column: 'religious_sensitivity',  enum: ['Low','Medium','High'] },
  'VoiceProfile.bilingual_ratio':        { table: 'brand_profiles', column: 'bilingual_ratio',        enum: ['arabic_only','arabic_primary','balanced','english_primary'] },
  'VoiceProfile.formality_level':        { table: 'brand_profiles', column: 'formality_level',        enum: ['casual','semi_formal','formal'] },
  'VoiceProfile.humor_tolerance':        { table: 'brand_profiles', column: 'humor_tolerance',        enum: ['none','light','moderate'] },
  'VoiceProfile.tone_anti_attribute_ids':{ table: 'brand_profiles', column: 'tone_anti_attribute_ids',enum: null, type: 'text[]' },
  // COO sometimes emits without _ids suffix — alias to same column
  'VoiceProfile.tone_anti_attributes':   { table: 'brand_profiles', column: 'tone_anti_attribute_ids',enum: null, type: 'text[]' },
  // v2 axis fields under VoiceProfile.* prefix — CEO occasionally emits these.
  'VoiceProfile.archetype_primary':      { table: 'brand_profiles', column: 'archetype_primary',   enum: ['Innocent','Sage','Explorer','Outlaw','Magician','Hero','Lover','Jester','Everyman','Caregiver','Ruler','Creator'] },
  'VoiceProfile.archetype_secondary':    { table: 'brand_profiles', column: 'archetype_secondary', enum: ['Innocent','Sage','Explorer','Outlaw','Magician','Hero','Lover','Jester','Everyman','Caregiver','Ruler','Creator'] },
  'VoiceProfile.lifecycle_stage':        { table: 'brand_profiles', column: 'lifecycle_stage',     enum: ['pre_launch','launch','growth','maturity','recovery'] },
  'VoiceProfile.intent_state':           { table: 'brand_profiles', column: 'intent_state',        enum: ['launch','grow','defend','harvest','recover'] },

  // AudienceProfile.primary_gender_mix — COO sometimes emits this name
  // instead of `AudienceProfile.gender_mix`. Same target column.
  'AudienceProfile.primary_gender_mix':  { table: 'audience_profiles',  column: 'gender_mix',          enum: null, type: 'jsonb' },

  // More COO/CEO drift: AudienceProfile.* for fields that actually live on
  // brand_profiles. Route to brand_profiles columns.
  'AudienceProfile.bilingual_ratio':     { table: 'brand_profiles', column: 'bilingual_ratio',     enum: ['arabic_only','arabic_primary','balanced','english_primary'] },
  'AudienceProfile.primary_kpi_type':    { table: 'brand_profiles', column: 'primary_kpi_type',    enum: ['engagement','conversion','awareness','trust'] },

  // CEO brand_correction emits these with BrandDNA.* prefix or bare name.
  // All route to audience_profiles.language_preference (same enum as bilingual_ratio).
  'BrandDNA.audience_language_preference':    { table: 'audience_profiles', column: 'language_preference', enum: ['arabic_only','arabic_primary','balanced','english_primary'] },
  'BrandDNALite.audience_language_preference':{ table: 'audience_profiles', column: 'language_preference', enum: ['arabic_only','arabic_primary','balanced','english_primary'] },
  'brand_profiles.audience_language_preference':{ table: 'audience_profiles', column: 'language_preference', enum: ['arabic_only','arabic_primary','balanced','english_primary'] },
  'audience_language_preference':             { table: 'audience_profiles', column: 'language_preference', enum: ['arabic_only','arabic_primary','balanced','english_primary'] },
  // Bare audience description + age_range for CEO bare-name nominations
  'audience_description_ar':  { table: 'audience_profiles', column: 'description_ar', enum: null },
  'audience_age_range':        { table: 'audience_profiles', column: 'age_range',      enum: null, type: 'jsonb' },

  // Catch-all variant where COO uses "primary_audience.gender" (dotted) or
  // "primary_audience_gender" (snake) — both route to audience_profiles.gender_mix
  'AudienceProfile.gender':              { table: 'audience_profiles', column: 'gender_mix', enum: null, type: 'jsonb' },
  'BrandProfile.primary_audience_gender':{ table: 'audience_profiles', column: 'gender_mix', enum: null, type: 'jsonb' },

  // AxisInference.* — COO's Pass 2 sometimes emits the axis fields with the
  // `AxisInference.` namespace rather than `BrandProfile.`. Route to the same
  // brand_profiles columns. Avoids 3 rejections per onboarding.
  'AxisInference.archetype_primary':     { table: 'brand_profiles', column: 'archetype_primary',   enum: ['Innocent','Sage','Explorer','Outlaw','Magician','Hero','Lover','Jester','Everyman','Caregiver','Ruler','Creator'] },
  'AxisInference.archetype_secondary':   { table: 'brand_profiles', column: 'archetype_secondary', enum: ['Innocent','Sage','Explorer','Outlaw','Magician','Hero','Lover','Jester','Everyman','Caregiver','Ruler','Creator'] },
  'AxisInference.lifecycle_stage':       { table: 'brand_profiles', column: 'lifecycle_stage',     enum: ['pre_launch','launch','growth','maturity','recovery'] },
  'AxisInference.intent_state':          { table: 'brand_profiles', column: 'intent_state',        enum: ['launch','grow','defend','harvest','recover'] },

  // BrandDNA.* aliases — CEO prompt v2 emits field_path with "BrandDNA." prefix
  // for brand_correction nominations (e.g. "BrandDNA.price_position").
  'BrandDNA.arabic_dialect':         { table: 'brand_profiles', column: 'arabic_dialect',         enum: ['Najdi','Hejazi','Gulf','MSA_formal','MSA_accessible','Mixed'] },
  'BrandDNA.price_position':         { table: 'brand_profiles', column: 'price_position',         enum: ['budget','mid_market','premium','luxury'] },
  'BrandDNA.formality_level':        { table: 'brand_profiles', column: 'formality_level',        enum: ['casual','semi_formal','formal'] },
  'BrandDNA.humor_tolerance':        { table: 'brand_profiles', column: 'humor_tolerance',        enum: ['none','light','moderate'] },
  'BrandDNA.religious_sensitivity':  { table: 'brand_profiles', column: 'religious_sensitivity',  enum: ['Low','Medium','High'] },
  'BrandDNA.bilingual_ratio':        { table: 'brand_profiles', column: 'bilingual_ratio',        enum: ['arabic_only','arabic_primary','balanced','english_primary'] },
  'BrandDNA.brand_differentiator':   { table: 'brand_profiles', column: 'brand_differentiator',   enum: null },
  'BrandDNA.primary_channel':        { table: 'brand_profiles', column: 'primary_channel',        enum: ['Instagram','Snapchat','TikTok','Twitter'] },
  'BrandDNA.primary_kpi_type':       { table: 'brand_profiles', column: 'primary_kpi_type',       enum: ['engagement','conversion','awareness','trust'] },
  'BrandDNA.ramadan_relevance':      { table: 'brand_profiles', column: 'ramadan_relevance',      enum: ['Critical','High','Medium','Low','Not_relevant'] },
  'BrandDNA.tone_anti_attribute_ids':{ table: 'brand_profiles', column: 'tone_anti_attribute_ids',enum: null, type: 'text[]' },
  'BrandDNA.archetype_primary':      { table: 'brand_profiles', column: 'archetype_primary',      enum: ['Innocent','Sage','Explorer','Outlaw','Magician','Hero','Lover','Jester','Everyman','Caregiver','Ruler','Creator'] },
  'BrandDNA.archetype_secondary':    { table: 'brand_profiles', column: 'archetype_secondary',    enum: ['Innocent','Sage','Explorer','Outlaw','Magician','Hero','Lover','Jester','Everyman','Caregiver','Ruler','Creator'] },
  'BrandDNA.lifecycle_stage':        { table: 'brand_profiles', column: 'lifecycle_stage',        enum: ['pre_launch','launch','growth','maturity','recovery'] },
  'BrandDNA.intent_state':           { table: 'brand_profiles', column: 'intent_state',           enum: ['launch','grow','defend','harvest','recover'] },

  // BrandDNALite.* aliases — CEO prompt sometimes emits "BrandDNALite." prefix
  // for brand_correction nominations. Route to the same brand_profiles columns.
  'BrandDNALite.arabic_dialect':         { table: 'brand_profiles', column: 'arabic_dialect',         enum: ['Najdi','Hejazi','Gulf','MSA_formal','MSA_accessible','Mixed'] },
  'BrandDNALite.price_position':         { table: 'brand_profiles', column: 'price_position',         enum: ['budget','mid_market','premium','luxury'] },
  'BrandDNALite.formality_level':        { table: 'brand_profiles', column: 'formality_level',        enum: ['casual','semi_formal','formal'] },
  'BrandDNALite.humor_tolerance':        { table: 'brand_profiles', column: 'humor_tolerance',        enum: ['none','light','moderate'] },
  'BrandDNALite.religious_sensitivity':  { table: 'brand_profiles', column: 'religious_sensitivity',  enum: ['Low','Medium','High'] },
  'BrandDNALite.bilingual_ratio':        { table: 'brand_profiles', column: 'bilingual_ratio',        enum: ['arabic_only','arabic_primary','balanced','english_primary'] },
  'BrandDNALite.brand_differentiator':   { table: 'brand_profiles', column: 'brand_differentiator',   enum: null },
  'BrandDNALite.primary_channel':        { table: 'brand_profiles', column: 'primary_channel',        enum: ['Instagram','Snapchat','TikTok','Twitter'] },
  'BrandDNALite.primary_kpi_type':       { table: 'brand_profiles', column: 'primary_kpi_type',       enum: ['engagement','conversion','awareness','trust'] },
  'BrandDNALite.ramadan_relevance':      { table: 'brand_profiles', column: 'ramadan_relevance',      enum: ['Critical','High','Medium','Low','Not_relevant'] },
  'BrandDNALite.tone_anti_attribute_ids':{ table: 'brand_profiles', column: 'tone_anti_attribute_ids',enum: null, type: 'text[]' },
  'BrandDNALite.archetype_primary':      { table: 'brand_profiles', column: 'archetype_primary',      enum: ['Innocent','Sage','Explorer','Outlaw','Magician','Hero','Lover','Jester','Everyman','Caregiver','Ruler','Creator'] },
  'BrandDNALite.archetype_secondary':    { table: 'brand_profiles', column: 'archetype_secondary',    enum: ['Innocent','Sage','Explorer','Outlaw','Magician','Hero','Lover','Jester','Everyman','Caregiver','Ruler','Creator'] },
  'BrandDNALite.lifecycle_stage':        { table: 'brand_profiles', column: 'lifecycle_stage',        enum: ['pre_launch','launch','growth','maturity','recovery'] },
  'BrandDNALite.intent_state':           { table: 'brand_profiles', column: 'intent_state',           enum: ['launch','grow','defend','harvest','recover'] },

  // brand_profiles.* — CEO occasionally emits fully-qualified table.column paths.
  // Route to the same brand_profiles columns.
  'brand_profiles.price_position':         { table: 'brand_profiles', column: 'price_position',         enum: ['budget','mid_market','premium','luxury'] },
  'brand_profiles.arabic_dialect':         { table: 'brand_profiles', column: 'arabic_dialect',         enum: ['Najdi','Hejazi','Gulf','MSA_formal','MSA_accessible','Mixed'] },
  'brand_profiles.formality_level':        { table: 'brand_profiles', column: 'formality_level',        enum: ['casual','semi_formal','formal'] },
  'brand_profiles.humor_tolerance':        { table: 'brand_profiles', column: 'humor_tolerance',        enum: ['none','light','moderate'] },
  'brand_profiles.religious_sensitivity':  { table: 'brand_profiles', column: 'religious_sensitivity',  enum: ['Low','Medium','High'] },
  'brand_profiles.bilingual_ratio':        { table: 'brand_profiles', column: 'bilingual_ratio',        enum: ['arabic_only','arabic_primary','balanced','english_primary'] },
  'brand_profiles.brand_differentiator':   { table: 'brand_profiles', column: 'brand_differentiator',   enum: null },
  'brand_profiles.primary_channel':        { table: 'brand_profiles', column: 'primary_channel',        enum: ['Instagram','Snapchat','TikTok','Twitter'] },
  'brand_profiles.primary_kpi_type':       { table: 'brand_profiles', column: 'primary_kpi_type',       enum: ['engagement','conversion','awareness','trust'] },
  'brand_profiles.ramadan_relevance':      { table: 'brand_profiles', column: 'ramadan_relevance',      enum: ['Critical','High','Medium','Low','Not_relevant'] },
  'brand_profiles.tone_anti_attribute_ids':{ table: 'brand_profiles', column: 'tone_anti_attribute_ids',enum: null, type: 'text[]' },
  'brand_profiles.archetype_primary':      { table: 'brand_profiles', column: 'archetype_primary',      enum: ['Innocent','Sage','Explorer','Outlaw','Magician','Hero','Lover','Jester','Everyman','Caregiver','Ruler','Creator'] },
  'brand_profiles.archetype_secondary':    { table: 'brand_profiles', column: 'archetype_secondary',    enum: ['Innocent','Sage','Explorer','Outlaw','Magician','Hero','Lover','Jester','Everyman','Caregiver','Ruler','Creator'] },
  'brand_profiles.lifecycle_stage':        { table: 'brand_profiles', column: 'lifecycle_stage',        enum: ['pre_launch','launch','growth','maturity','recovery'] },
  'brand_profiles.intent_state':           { table: 'brand_profiles', column: 'intent_state',           enum: ['launch','grow','defend','harvest','recover'] },

  // ── Layer 1 additions (migration 0060) ──────────────────────────────
  // All prefix variants covered so CEO can emit any of them without rejection.
  'BrandProfile.sub_sector':           { table: 'brand_profiles', column: 'sub_sector',           enum: null },
  'BrandProfile.region_primary':       { table: 'brand_profiles', column: 'region_primary',       enum: ['Najdi','Hejazi','Eastern','Southern','Other'] },
  'BrandProfile.founded_year':         { table: 'brand_profiles', column: 'founded_year',         enum: null, type: 'number' },
  'BrandProfile.tone_register':        { table: 'brand_profiles', column: 'tone_register',        enum: ['Traditional','Modern','Youth','Mixed'] },
  'BrandDNA.sub_sector':              { table: 'brand_profiles', column: 'sub_sector',           enum: null },
  'BrandDNA.region_primary':          { table: 'brand_profiles', column: 'region_primary',       enum: ['Najdi','Hejazi','Eastern','Southern','Other'] },
  'BrandDNA.founded_year':            { table: 'brand_profiles', column: 'founded_year',         enum: null, type: 'number' },
  'BrandDNA.tone_register':           { table: 'brand_profiles', column: 'tone_register',        enum: ['Traditional','Modern','Youth','Mixed'] },
  'BrandDNALite.sub_sector':          { table: 'brand_profiles', column: 'sub_sector',           enum: null },
  'BrandDNALite.region_primary':      { table: 'brand_profiles', column: 'region_primary',       enum: ['Najdi','Hejazi','Eastern','Southern','Other'] },
  'BrandDNALite.founded_year':        { table: 'brand_profiles', column: 'founded_year',         enum: null, type: 'number' },
  'BrandDNALite.tone_register':       { table: 'brand_profiles', column: 'tone_register',        enum: ['Traditional','Modern','Youth','Mixed'] },
  'brand_profiles.sub_sector':        { table: 'brand_profiles', column: 'sub_sector',           enum: null },
  'brand_profiles.region_primary':    { table: 'brand_profiles', column: 'region_primary',       enum: ['Najdi','Hejazi','Eastern','Southern','Other'] },
  'brand_profiles.founded_year':      { table: 'brand_profiles', column: 'founded_year',         enum: null, type: 'number' },
  'brand_profiles.tone_register':     { table: 'brand_profiles', column: 'tone_register',        enum: ['Traditional','Modern','Youth','Mixed'] },
  'sub_sector':    { table: 'brand_profiles', column: 'sub_sector',    enum: null },
  'region_primary':{ table: 'brand_profiles', column: 'region_primary',enum: ['Najdi','Hejazi','Eastern','Southern','Other'] },
  'founded_year':  { table: 'brand_profiles', column: 'founded_year',  enum: null, type: 'number' },
  'tone_register': { table: 'brand_profiles', column: 'tone_register', enum: ['Traditional','Modern','Youth','Mixed'] },

  // ── Layer 2 — Owner Profile (migration 0043) ────────────────────────
  'BrandProfile.founding_story':            { table: 'brand_profiles', column: 'founding_story',            enum: null },
  'BrandProfile.comfort_on_camera':         { table: 'brand_profiles', column: 'comfort_on_camera',         enum: ['willing','hesitant','not_interested'] },
  'BrandProfile.physical_appearance_notes': { table: 'brand_profiles', column: 'physical_appearance_notes', enum: null },
  'BrandProfile.way_of_speaking':           { table: 'brand_profiles', column: 'way_of_speaking',           enum: ['formal','casual','storytelling','direct'] },
  'BrandProfile.content_preferences':       { table: 'brand_profiles', column: 'content_preferences',       enum: null, type: 'jsonb' },
  'BrandProfile.owner_values':              { table: 'brand_profiles', column: 'owner_values',              enum: null },
  'BrandProfile.communication_style':      { table: 'brand_profiles', column: 'communication_style',      enum: null },
  'BrandProfile.brand_goals':              { table: 'brand_profiles', column: 'brand_goals',              enum: null },
  'BrandProfile.posting_rhythm':           { table: 'brand_profiles', column: 'posting_rhythm',           enum: ['daily','3x_week','weekly','biweekly','monthly'] },
  'BrandProfile.caption_style':            { table: 'brand_profiles', column: 'caption_style',            enum: ['short_punchy','long_storytelling','question_hook','cta_heavy'] },
  // bare names
  'founding_story':            { table: 'brand_profiles', column: 'founding_story',            enum: null },
  'comfort_on_camera':         { table: 'brand_profiles', column: 'comfort_on_camera',         enum: ['willing','hesitant','not_interested'] },
  'physical_appearance_notes': { table: 'brand_profiles', column: 'physical_appearance_notes', enum: null },
  'way_of_speaking':           { table: 'brand_profiles', column: 'way_of_speaking',           enum: ['formal','casual','storytelling','direct'] },
  'content_preferences':       { table: 'brand_profiles', column: 'content_preferences',       enum: null, type: 'jsonb' },
  'owner_values':              { table: 'brand_profiles', column: 'owner_values',              enum: null },
  'communication_style':       { table: 'brand_profiles', column: 'communication_style',       enum: null },
  'brand_goals':               { table: 'brand_profiles', column: 'brand_goals',               enum: null },
  'posting_rhythm':            { table: 'brand_profiles', column: 'posting_rhythm',            enum: ['daily','3x_week','weekly','biweekly','monthly'] },
  'caption_style':             { table: 'brand_profiles', column: 'caption_style',             enum: ['short_punchy','long_storytelling','question_hook','cta_heavy'] },

  // ── Layer 4 — Strategic Intelligence (migration 0043) ───────────────
  'BrandProfile.permission_level':          { table: 'brand_profiles', column: 'permission_level',          enum: ['category_leader','challenger','institutional','purpose','launch','sme_local'] },
  'BrandProfile.cultural_tension_owned':    { table: 'brand_profiles', column: 'cultural_tension_owned',    enum: null },
  'BrandProfile.creative_formulas_approved':{ table: 'brand_profiles', column: 'creative_formulas_approved',enum: ['manifesto_build','paradox_play','freeze_then_action','scene_pair','number_reframe','gamified_hook','metaphor_system'], type: 'text[]' },
  'BrandProfile.brave_safe_default':        { table: 'brand_profiles', column: 'brave_safe_default',        enum: null, type: 'boolean' },
  'BrandProfile.strategy_version':          { table: 'brand_profiles', column: 'strategy_version',          enum: null, type: 'number', min: 0 },
  'BrandProfile.content_mix_ratios':        { table: 'brand_profiles', column: 'content_mix_ratios',        enum: null, type: 'jsonb' },
  'BrandProfile.platform_weights':          { table: 'brand_profiles', column: 'platform_weights',          enum: null, type: 'jsonb' },
  'BrandProfile.goal_phase':                { table: 'brand_profiles', column: 'goal_phase',                enum: ['awareness','conversion','retention','launch'] },
  'BrandProfile.occasion_approach':         { table: 'brand_profiles', column: 'occasion_approach',         enum: null, type: 'jsonb' },
  'BrandProfile.business_events':           { table: 'brand_profiles', column: 'business_events',           enum: null, type: 'jsonb' },
  // bare names
  'permission_level':           { table: 'brand_profiles', column: 'permission_level',          enum: ['category_leader','challenger','institutional','purpose','launch','sme_local'] },
  'cultural_tension_owned':     { table: 'brand_profiles', column: 'cultural_tension_owned',    enum: null },
  'creative_formulas_approved': { table: 'brand_profiles', column: 'creative_formulas_approved',enum: ['manifesto_build','paradox_play','freeze_then_action','scene_pair','number_reframe','gamified_hook','metaphor_system'], type: 'text[]' },
  'brave_safe_default':         { table: 'brand_profiles', column: 'brave_safe_default',        enum: null, type: 'boolean' },
  'strategy_version':           { table: 'brand_profiles', column: 'strategy_version',          enum: null, type: 'number', min: 0 },
  'content_mix_ratios':         { table: 'brand_profiles', column: 'content_mix_ratios',        enum: null, type: 'jsonb' },
  'platform_weights':           { table: 'brand_profiles', column: 'platform_weights',          enum: null, type: 'jsonb' },
  'goal_phase':                 { table: 'brand_profiles', column: 'goal_phase',                enum: ['awareness','conversion','retention','launch'] },
  'occasion_approach':          { table: 'brand_profiles', column: 'occasion_approach',         enum: null, type: 'jsonb' },
  'business_events':            { table: 'brand_profiles', column: 'business_events',           enum: null, type: 'jsonb' },

  // BrandDNA.* + brand_profiles.* aliases for Layer 2/4 fields (CEO may use any prefix)
  'BrandDNA.permission_level':         { table: 'brand_profiles', column: 'permission_level',          enum: ['category_leader','challenger','institutional','purpose','launch','sme_local'] },
  'BrandDNA.cultural_tension_owned':   { table: 'brand_profiles', column: 'cultural_tension_owned',    enum: null },
  'BrandDNA.brave_safe_default':       { table: 'brand_profiles', column: 'brave_safe_default',        enum: null, type: 'boolean' },
  'BrandDNA.goal_phase':               { table: 'brand_profiles', column: 'goal_phase',                enum: ['awareness','conversion','retention','launch'] },
  'BrandDNA.founding_story':           { table: 'brand_profiles', column: 'founding_story',            enum: null },
  'BrandDNA.owner_values':             { table: 'brand_profiles', column: 'owner_values',              enum: null },
  'BrandDNA.comfort_on_camera':        { table: 'brand_profiles', column: 'comfort_on_camera',         enum: ['willing','hesitant','not_interested'] },
  'BrandDNA.way_of_speaking':          { table: 'brand_profiles', column: 'way_of_speaking',           enum: ['formal','casual','storytelling','direct'] },
  'BrandDNA.communication_style':      { table: 'brand_profiles', column: 'communication_style',       enum: null },
  'BrandDNA.brand_goals':              { table: 'brand_profiles', column: 'brand_goals',               enum: null },
  'BrandDNA.posting_rhythm':           { table: 'brand_profiles', column: 'posting_rhythm',            enum: ['daily','3x_week','weekly','biweekly','monthly'] },
  'BrandDNA.caption_style':            { table: 'brand_profiles', column: 'caption_style',             enum: ['short_punchy','long_storytelling','question_hook','cta_heavy'] },
  'BrandDNA.respected_brands':         { table: 'brand_profiles', column: 'respected_brands',          enum: null },
  'BrandDNA.respected_why':            { table: 'brand_profiles', column: 'respected_why',             enum: null },
  'BrandDNA.social':                   { table: 'brand_profiles', column: 'social',                    enum: null },
  'BrandDNA.custom_restriction':       { table: 'brand_profiles', column: 'custom_restriction',        enum: null },
  'BrandDNA.custom_occasion':          { table: 'brand_profiles', column: 'custom_occasion',           enum: null },
  'BrandDNA.eid_fitr_relevance':       { table: 'brand_profiles', column: 'eid_fitr_relevance',        enum: ['Critical','High','Medium','Low','Not_relevant'] },
  'BrandDNA.eid_adha_relevance':       { table: 'brand_profiles', column: 'eid_adha_relevance',        enum: ['Critical','High','Medium','Low','Not_relevant'] },
  'BrandDNA.founding_day_relevance':   { table: 'brand_profiles', column: 'founding_day_relevance',    enum: ['Critical','High','Medium','Low','Not_relevant'] },
  'BrandDNA.scale_minmax':             { table: 'brand_profiles', column: 'scale_minmax',              enum: null, type: 'number', min: 0, max: 100 },
  'BrandDNA.scale_quietloud':          { table: 'brand_profiles', column: 'scale_quietloud',           enum: null, type: 'number', min: 0, max: 100 },
  'BrandDNA.scale_localglobal':        { table: 'brand_profiles', column: 'scale_localglobal',         enum: null, type: 'number', min: 0, max: 100 },
  'BrandDNA.scale_tradmod':            { table: 'brand_profiles', column: 'scale_tradmod',             enum: null, type: 'number', min: 0, max: 100 },
  'brand_profiles.permission_level':   { table: 'brand_profiles', column: 'permission_level',          enum: ['category_leader','challenger','institutional','purpose','launch','sme_local'] },
  'brand_profiles.cultural_tension_owned':{ table: 'brand_profiles', column: 'cultural_tension_owned', enum: null },
  'brand_profiles.brave_safe_default': { table: 'brand_profiles', column: 'brave_safe_default',        enum: null, type: 'boolean' },
  'brand_profiles.goal_phase':         { table: 'brand_profiles', column: 'goal_phase',                enum: ['awareness','conversion','retention','launch'] },
  'brand_profiles.scale_minmax':       { table: 'brand_profiles', column: 'scale_minmax',              enum: null, type: 'number', min: 0, max: 100 },
  'brand_profiles.scale_quietloud':    { table: 'brand_profiles', column: 'scale_quietloud',           enum: null, type: 'number', min: 0, max: 100 },
  'brand_profiles.scale_localglobal':  { table: 'brand_profiles', column: 'scale_localglobal',         enum: null, type: 'number', min: 0, max: 100 },
  'brand_profiles.scale_tradmod':      { table: 'brand_profiles', column: 'scale_tradmod',             enum: null, type: 'number', min: 0, max: 100 },

  // Bare field names — CEO brand_correction flow emits field_path without a
  // namespace prefix (e.g. "price_position" instead of "BrandProfile.price_position").
  // Accept bare names and route to the same brand_profiles columns.
  'arabic_dialect':         { table: 'brand_profiles', column: 'arabic_dialect',         enum: ['Najdi','Hejazi','Gulf','MSA_formal','MSA_accessible','Mixed'] },
  'price_position':         { table: 'brand_profiles', column: 'price_position',         enum: ['budget','mid_market','premium','luxury'] },
  'formality_level':        { table: 'brand_profiles', column: 'formality_level',        enum: ['casual','semi_formal','formal'] },
  'humor_tolerance':        { table: 'brand_profiles', column: 'humor_tolerance',        enum: ['none','light','moderate'] },
  'religious_sensitivity':  { table: 'brand_profiles', column: 'religious_sensitivity',  enum: ['Low','Medium','High'] },
  'bilingual_ratio':        { table: 'brand_profiles', column: 'bilingual_ratio',        enum: ['arabic_only','arabic_primary','balanced','english_primary'] },
  'brand_differentiator':   { table: 'brand_profiles', column: 'brand_differentiator',   enum: null },
  'primary_channel':        { table: 'brand_profiles', column: 'primary_channel',        enum: ['Instagram','Snapchat','TikTok','Twitter'] },
  'primary_kpi_type':       { table: 'brand_profiles', column: 'primary_kpi_type',       enum: ['engagement','conversion','awareness','trust'] },
  'ramadan_relevance':      { table: 'brand_profiles', column: 'ramadan_relevance',      enum: ['Critical','High','Medium','Low','Not_relevant'] },
  'tone_anti_attribute_ids':{ table: 'brand_profiles', column: 'tone_anti_attribute_ids',enum: null, type: 'text[]' },
  'archetype_primary':      { table: 'brand_profiles', column: 'archetype_primary',      enum: ['Innocent','Sage','Explorer','Outlaw','Magician','Hero','Lover','Jester','Everyman','Caregiver','Ruler','Creator'] },
  'archetype_secondary':    { table: 'brand_profiles', column: 'archetype_secondary',    enum: ['Innocent','Sage','Explorer','Outlaw','Magician','Hero','Lover','Jester','Everyman','Caregiver','Ruler','Creator'] },
  'lifecycle_stage':        { table: 'brand_profiles', column: 'lifecycle_stage',        enum: ['pre_launch','launch','growth','maturity','recovery'] },
  'intent_state':           { table: 'brand_profiles', column: 'intent_state',           enum: ['launch','grow','defend','harvest','recover'] },

  // ── BrandDNA v6 new fields (migration 0072) ──────────────────────────────
  // All prefixes (BrandProfile.*, BrandDNA.*, BrandDNALite.*, bare) for
  // agent compatibility. Without these, COO/CEO nominations are rejected
  // with `forbidden_field_path` and the v6 columns never get written.
  'BrandProfile.name_meaning':           { table: 'brand_profiles', column: 'name_meaning',           enum: null },
  'BrandProfile.hero_why':               { table: 'brand_profiles', column: 'hero_why',               enum: null },
  'BrandProfile.lifecycle':              { table: 'brand_profiles', column: 'lifecycle',              enum: ['launch','growth','established','mature','legacy'] },
  'BrandProfile.lifestyle':              { table: 'brand_profiles', column: 'lifestyle',              enum: ['family_home','coffee_solo','mall_friends','gym','gathering','outdoor'] },
  'BrandProfile.price_nums':             { table: 'brand_profiles', column: 'price_nums',             enum: null },
  'BrandProfile.archetype_family':       { table: 'brand_profiles', column: 'archetype_family',       enum: ['hero','caregiver','explorer','creator'] },
  'BrandProfile.music':                  { table: 'brand_profiles', column: 'music',                  enum: ['acoustic','arabic','pop','cinematic','lofi','energy'] },
  'BrandProfile.music_link':             { table: 'brand_profiles', column: 'music_link',             enum: null },
  'BrandProfile.custom_restriction':     { table: 'brand_profiles', column: 'custom_restriction',     enum: null },
  'BrandProfile.respected_brands':       { table: 'brand_profiles', column: 'respected_brands',       enum: null },
  'BrandProfile.respected_why':          { table: 'brand_profiles', column: 'respected_why',          enum: null },
  'BrandProfile.goal':                   { table: 'brand_profiles', column: 'goal',                   enum: ['orders','awareness','launch','community','trust'] },
  'BrandProfile.social':                 { table: 'brand_profiles', column: 'social',                 enum: null },
  'BrandProfile.vision':                 { table: 'brand_profiles', column: 'vision',                 enum: ['customers','recognition','community','premium'] },
  'BrandProfile.vision_text':            { table: 'brand_profiles', column: 'vision_text',            enum: null },
  'BrandProfile.tagline':                { table: 'brand_profiles', column: 'tagline',                enum: null },
  'BrandProfile.cust_quote':             { table: 'brand_profiles', column: 'cust_quote',             enum: null },
  'BrandProfile.caption_ex':             { table: 'brand_profiles', column: 'caption_ex',             enum: null },
  'BrandProfile.metric':                 { table: 'brand_profiles', column: 'metric',                 enum: null },
  'BrandProfile.national_day_relevance': { table: 'brand_profiles', column: 'national_day_relevance', enum: ['Critical','High','Medium','Low','Not_relevant'] },
  'BrandProfile.anything':               { table: 'brand_profiles', column: 'anything',               enum: null },
  'BrandProfile.brand_name_en':          { table: 'brand_profiles', column: 'brand_name_en',          enum: null },
  'BrandProfile.brand_name_ar':          { table: 'brand_profiles', column: 'brand_name_ar',          enum: null },
  'BrandProfile.city_primary':           { table: 'brand_profiles', column: 'city_primary',           enum: null },
  'BrandProfile.sector':                 { table: 'brand_profiles', column: 'sector',                 enum: null },
  // Array fields
  'BrandProfile.platforms':              { table: 'brand_profiles', column: 'platforms',              enum: null, type: 'text[]' },
  'BrandProfile.brand_refs':             { table: 'brand_profiles', column: 'brand_refs',             enum: null, type: 'text[]' },
  'BrandProfile.emotions':               { table: 'brand_profiles', column: 'emotions',              enum: null, type: 'text[]' },
  'BrandProfile.restrictions':           { table: 'brand_profiles', column: 'restrictions',           enum: null, type: 'text[]' },
  'BrandProfile.occasions_ranked':       { table: 'brand_profiles', column: 'occasions_ranked',       enum: null, type: 'text[]' },
  'BrandProfile.problems':               { table: 'brand_profiles', column: 'problems',               enum: null, type: 'text[]' },
  // Slider scale fields (smallint 0-100)
  'BrandProfile.scale_minmax':           { table: 'brand_profiles', column: 'scale_minmax',           enum: null, type: 'number', min: 0, max: 100 },
  'BrandProfile.scale_quietloud':        { table: 'brand_profiles', column: 'scale_quietloud',        enum: null, type: 'number', min: 0, max: 100 },
  'BrandProfile.scale_localglobal':      { table: 'brand_profiles', column: 'scale_localglobal',      enum: null, type: 'number', min: 0, max: 100 },
  'BrandProfile.scale_tradmod':          { table: 'brand_profiles', column: 'scale_tradmod',          enum: null, type: 'number', min: 0, max: 100 },

  // BrandDNA.* aliases for v6 fields
  'BrandDNA.name_meaning':           { table: 'brand_profiles', column: 'name_meaning',           enum: null },
  'BrandDNA.hero_why':               { table: 'brand_profiles', column: 'hero_why',               enum: null },
  'BrandDNA.lifecycle':              { table: 'brand_profiles', column: 'lifecycle',              enum: ['launch','growth','established','mature','legacy'] },
  'BrandDNA.lifestyle':              { table: 'brand_profiles', column: 'lifestyle',              enum: ['family_home','coffee_solo','mall_friends','gym','gathering','outdoor'] },
  'BrandDNA.archetype_family':       { table: 'brand_profiles', column: 'archetype_family',       enum: ['hero','caregiver','explorer','creator'] },
  'BrandDNA.music':                  { table: 'brand_profiles', column: 'music',                  enum: ['acoustic','arabic','pop','cinematic','lofi','energy'] },
  'BrandDNA.goal':                   { table: 'brand_profiles', column: 'goal',                   enum: ['orders','awareness','launch','community','trust'] },
  'BrandDNA.vision':                 { table: 'brand_profiles', column: 'vision',                 enum: ['customers','recognition','community','premium'] },
  'BrandDNA.vision_text':            { table: 'brand_profiles', column: 'vision_text',            enum: null },
  'BrandDNA.tagline':                { table: 'brand_profiles', column: 'tagline',                enum: null },
  'BrandDNA.national_day_relevance': { table: 'brand_profiles', column: 'national_day_relevance', enum: ['Critical','High','Medium','Low','Not_relevant'] },
  'BrandDNA.anything':               { table: 'brand_profiles', column: 'anything',               enum: null },
  'BrandDNA.brand_name_en':          { table: 'brand_profiles', column: 'brand_name_en',          enum: null },
  'BrandDNA.brand_name_ar':          { table: 'brand_profiles', column: 'brand_name_ar',          enum: null },
  'BrandDNA.city_primary':           { table: 'brand_profiles', column: 'city_primary',           enum: null },
  'BrandDNA.sector':                 { table: 'brand_profiles', column: 'sector',                 enum: null },
  'BrandDNA.price_nums':             { table: 'brand_profiles', column: 'price_nums',             enum: null },
  'BrandDNA.cust_quote':             { table: 'brand_profiles', column: 'cust_quote',             enum: null },
  'BrandDNALite.brand_name_en':      { table: 'brand_profiles', column: 'brand_name_en',          enum: null },
  'BrandDNALite.brand_name_ar':      { table: 'brand_profiles', column: 'brand_name_ar',          enum: null },
  'BrandDNALite.city_primary':       { table: 'brand_profiles', column: 'city_primary',           enum: null },
  'BrandDNALite.sector':             { table: 'brand_profiles', column: 'sector',                 enum: null },
  'BrandDNALite.price_nums':         { table: 'brand_profiles', column: 'price_nums',             enum: null },
  'brand_profiles.brand_name_en':    { table: 'brand_profiles', column: 'brand_name_en',          enum: null },
  'brand_profiles.brand_name_ar':    { table: 'brand_profiles', column: 'brand_name_ar',          enum: null },
  'brand_profiles.city_primary':     { table: 'brand_profiles', column: 'city_primary',           enum: null },
  'brand_profiles.sector':           { table: 'brand_profiles', column: 'sector',                 enum: null },
  'brand_profiles.price_nums':       { table: 'brand_profiles', column: 'price_nums',             enum: null },

  // VoiceProfile.* aliases for v6 fields (COO drift)
  'VoiceProfile.name_meaning':           { table: 'brand_profiles', column: 'name_meaning',           enum: null },
  'VoiceProfile.lifecycle':              { table: 'brand_profiles', column: 'lifecycle',              enum: ['launch','growth','established','mature','legacy'] },
  'VoiceProfile.archetype_family':       { table: 'brand_profiles', column: 'archetype_family',       enum: ['hero','caregiver','explorer','creator'] },
  'VoiceProfile.music':                  { table: 'brand_profiles', column: 'music',                  enum: ['acoustic','arabic','pop','cinematic','lofi','energy'] },
  'VoiceProfile.goal':                   { table: 'brand_profiles', column: 'goal',                   enum: ['orders','awareness','launch','community','trust'] },
  'VoiceProfile.vision':                 { table: 'brand_profiles', column: 'vision',                 enum: ['customers','recognition','community','premium'] },
  'VoiceProfile.national_day_relevance': { table: 'brand_profiles', column: 'national_day_relevance', enum: ['Critical','High','Medium','Low','Not_relevant'] },

  // Bare field names for v6 (CEO brand_correction flow)
  'name_meaning':           { table: 'brand_profiles', column: 'name_meaning',           enum: null },
  'hero_why':               { table: 'brand_profiles', column: 'hero_why',               enum: null },
  'lifecycle':              { table: 'brand_profiles', column: 'lifecycle',              enum: ['launch','growth','established','mature','legacy'] },
  'lifestyle':              { table: 'brand_profiles', column: 'lifestyle',              enum: ['family_home','coffee_solo','mall_friends','gym','gathering','outdoor'] },
  'price_nums':             { table: 'brand_profiles', column: 'price_nums',             enum: null },
  'archetype_family':       { table: 'brand_profiles', column: 'archetype_family',       enum: ['hero','caregiver','explorer','creator'] },
  'music':                  { table: 'brand_profiles', column: 'music',                  enum: ['acoustic','arabic','pop','cinematic','lofi','energy'] },
  'music_link':             { table: 'brand_profiles', column: 'music_link',             enum: null },
  'custom_restriction':     { table: 'brand_profiles', column: 'custom_restriction',     enum: null },
  'respected_brands':       { table: 'brand_profiles', column: 'respected_brands',       enum: null },
  'respected_why':          { table: 'brand_profiles', column: 'respected_why',          enum: null },
  'goal':                   { table: 'brand_profiles', column: 'goal',                   enum: ['orders','awareness','launch','community','trust'] },
  'social':                 { table: 'brand_profiles', column: 'social',                 enum: null },
  'vision':                 { table: 'brand_profiles', column: 'vision',                 enum: ['customers','recognition','community','premium'] },
  'vision_text':            { table: 'brand_profiles', column: 'vision_text',            enum: null },
  'tagline':                { table: 'brand_profiles', column: 'tagline',                enum: null },
  'cust_quote':             { table: 'brand_profiles', column: 'cust_quote',             enum: null },
  'caption_ex':             { table: 'brand_profiles', column: 'caption_ex',             enum: null },
  'metric':                 { table: 'brand_profiles', column: 'metric',                 enum: null },
  'national_day_relevance': { table: 'brand_profiles', column: 'national_day_relevance', enum: ['Critical','High','Medium','Low','Not_relevant'] },
  'anything':               { table: 'brand_profiles', column: 'anything',               enum: null },
  'brand_name_en':          { table: 'brand_profiles', column: 'brand_name_en',          enum: null },
  'brand_name_ar':          { table: 'brand_profiles', column: 'brand_name_ar',          enum: null },
  'city_primary':           { table: 'brand_profiles', column: 'city_primary',           enum: null },
  'sector':                 { table: 'brand_profiles', column: 'sector',                 enum: null },
  'platforms':              { table: 'brand_profiles', column: 'platforms',              enum: null, type: 'text[]' },
  'brand_refs':             { table: 'brand_profiles', column: 'brand_refs',             enum: null, type: 'text[]' },
  'emotions':               { table: 'brand_profiles', column: 'emotions',              enum: null, type: 'text[]' },
  'restrictions':           { table: 'brand_profiles', column: 'restrictions',           enum: null, type: 'text[]' },
  'occasions_ranked':       { table: 'brand_profiles', column: 'occasions_ranked',       enum: null, type: 'text[]' },
  'problems':               { table: 'brand_profiles', column: 'problems',               enum: null, type: 'text[]' },
  // Scale / slider fields (0-100 smallint)
  'scale_minmax':           { table: 'brand_profiles', column: 'scale_minmax',           enum: null, type: 'number', min: 0, max: 100 },
  'scale_quietloud':        { table: 'brand_profiles', column: 'scale_quietloud',        enum: null, type: 'number', min: 0, max: 100 },
  'scale_localglobal':      { table: 'brand_profiles', column: 'scale_localglobal',      enum: null, type: 'number', min: 0, max: 100 },
  'scale_tradmod':          { table: 'brand_profiles', column: 'scale_tradmod',          enum: null, type: 'number', min: 0, max: 100 },
  // Relevance fields (additional occasions)
  'eid_fitr_relevance':     { table: 'brand_profiles', column: 'eid_fitr_relevance',     enum: ['Critical','High','Medium','Low','Not_relevant'] },
  'eid_adha_relevance':     { table: 'brand_profiles', column: 'eid_adha_relevance',     enum: ['Critical','High','Medium','Low','Not_relevant'] },
  'founding_day_relevance': { table: 'brand_profiles', column: 'founding_day_relevance', enum: ['Critical','High','Medium','Low','Not_relevant'] },
  // Miscellaneous
  'custom_occasion':        { table: 'brand_profiles', column: 'custom_occasion',        enum: null },

  // ── Brand-insight wizard fields (migration 0072 + 0081) ─────────────────────
  // products_list and cust_desc were added late and missing from the whitelist.
  // Without these entries every brand-insight save for these fields is rejected
  // with forbidden_field_path and no event_log row is written.
  'BrandProfile.products_list':  { table: 'brand_profiles', column: 'products_list',  enum: null },
  'BrandProfile.cust_desc':      { table: 'brand_profiles', column: 'cust_desc',      enum: null },
  'BrandDNA.products_list':      { table: 'brand_profiles', column: 'products_list',  enum: null },
  'BrandDNA.cust_desc':          { table: 'brand_profiles', column: 'cust_desc',      enum: null },
  'products_list':  { table: 'brand_profiles', column: 'products_list',  enum: null },
  'cust_desc':      { table: 'brand_profiles', column: 'cust_desc',      enum: null },

  // ── Instagram analytics (migration 0094) ────────────────────────────────
  // Extracted from Apify Instagram scrape and nominated by COO. All prefixes
  // covered so COO/CEO naming drift doesn't cause silent rejections.
  'BrandProfile.followers_count':             { table: 'brand_profiles', column: 'followers_count',             enum: null, type: 'number' },
  'BrandProfile.ig_post_count':               { table: 'brand_profiles', column: 'ig_post_count',               enum: null, type: 'number' },
  'BrandProfile.ig_verified':                 { table: 'brand_profiles', column: 'ig_verified',                 enum: null, type: 'boolean' },
  'BrandProfile.account_type':                { table: 'brand_profiles', column: 'account_type',                enum: ['personal','business','creator'] },
  'BrandProfile.bio_text':                    { table: 'brand_profiles', column: 'bio_text',                    enum: null },
  'BrandProfile.bio_link':                    { table: 'brand_profiles', column: 'bio_link',                    enum: null },
  'BrandProfile.avg_engagement_rate':         { table: 'brand_profiles', column: 'avg_engagement_rate',         enum: null, type: 'number' },
  'BrandProfile.posting_frequency_per_week':  { table: 'brand_profiles', column: 'posting_frequency_per_week',  enum: null, type: 'number' },
  'BrandProfile.primary_content_format':      { table: 'brand_profiles', column: 'primary_content_format',      enum: ['image','video','carousel','reel'] },
  'BrandProfile.content_type_distribution':   { table: 'brand_profiles', column: 'content_type_distribution',   enum: null, type: 'jsonb' },
  'BrandProfile.caption_avg_length':          { table: 'brand_profiles', column: 'caption_avg_length',          enum: null, type: 'number' },
  'BrandProfile.top_hashtags':                { table: 'brand_profiles', column: 'top_hashtags',                enum: null, type: 'text[]' },
  'BrandProfile.top_mentioned_accounts':      { table: 'brand_profiles', column: 'top_mentioned_accounts',      enum: null, type: 'text[]' },
  // audience_profiles analytics
  'AudienceProfile.audience_location_primary':  { table: 'audience_profiles', column: 'audience_location_primary',  enum: null },
  'AudienceProfile.audience_age_range_estimated':{ table: 'audience_profiles', column: 'audience_age_range_estimated', enum: null },
  'AudienceProfile.follower_quality_signal':    { table: 'audience_profiles', column: 'follower_quality_signal',    enum: ['authentic','mixed','inflated'] },
  // visual_style_profiles analytics
  'VisualStyleProfile.avg_video_duration_secs': { table: 'visual_style_profiles', column: 'avg_video_duration_secs', enum: null, type: 'number' },
  'VisualStyleProfile.aspect_ratio_primary':    { table: 'visual_style_profiles', column: 'aspect_ratio_primary',    enum: ['1:1','4:5','9:16','16:9'] },
  'VisualStyleProfile.filter_style':            { table: 'visual_style_profiles', column: 'filter_style',            enum: ['warm','cool','vibrant','muted','bw','natural'] },
  'VisualStyleProfile.has_arabic_overlay':      { table: 'visual_style_profiles', column: 'has_arabic_overlay',      enum: null, type: 'boolean' },
  'VisualStyleProfile.has_logo_watermark':      { table: 'visual_style_profiles', column: 'has_logo_watermark',      enum: null, type: 'boolean' },
  // Bare name aliases for all new analytics fields
  'followers_count':            { table: 'brand_profiles', column: 'followers_count',            enum: null, type: 'number' },
  'ig_post_count':              { table: 'brand_profiles', column: 'ig_post_count',              enum: null, type: 'number' },
  'ig_verified':                { table: 'brand_profiles', column: 'ig_verified',                enum: null, type: 'boolean' },
  'account_type':               { table: 'brand_profiles', column: 'account_type',               enum: ['personal','business','creator'] },
  'bio_text':                   { table: 'brand_profiles', column: 'bio_text',                   enum: null },
  'avg_engagement_rate':        { table: 'brand_profiles', column: 'avg_engagement_rate',        enum: null, type: 'number' },
  'posting_frequency_per_week': { table: 'brand_profiles', column: 'posting_frequency_per_week', enum: null, type: 'number' },
  'primary_content_format':     { table: 'brand_profiles', column: 'primary_content_format',     enum: ['image','video','carousel','reel'] },
  'content_type_distribution':  { table: 'brand_profiles', column: 'content_type_distribution',  enum: null, type: 'jsonb' },
  'caption_avg_length':         { table: 'brand_profiles', column: 'caption_avg_length',         enum: null, type: 'number' },
  'top_hashtags':               { table: 'brand_profiles', column: 'top_hashtags',               enum: null, type: 'text[]' },
  'top_mentioned_accounts':     { table: 'brand_profiles', column: 'top_mentioned_accounts',     enum: null, type: 'text[]' },
  'audience_location_primary':  { table: 'audience_profiles', column: 'audience_location_primary',  enum: null },
  'follower_quality_signal':    { table: 'audience_profiles', column: 'follower_quality_signal',    enum: ['authentic','mixed','inflated'] },
  'aspect_ratio_primary':       { table: 'visual_style_profiles', column: 'aspect_ratio_primary',    enum: ['1:1','4:5','9:16','16:9'] },
  'filter_style':               { table: 'visual_style_profiles', column: 'filter_style',            enum: ['warm','cool','vibrant','muted','bw','natural'] },
  'has_arabic_overlay':         { table: 'visual_style_profiles', column: 'has_arabic_overlay',      enum: null, type: 'boolean' },
} as const

export type AllowedFieldPath = keyof typeof ALLOWED_FIELD_PATHS

// 1. field_update
export const FieldUpdateData = z.object({
  field_path: z.string(),                 // validated against ALLOWED_FIELD_PATHS at runtime
  proposed_value: z.unknown(),            // shape depends on the field — checked in validate.ts
  source: z.enum(['client_confirmation', 'cco_qc', 'deepseek_output', 'system_inference']),
  evidence_source_ids: z.array(z.string().uuid()).optional(),
  reasoning: z.string().min(1).optional(),
})
export type FieldUpdateData = z.infer<typeof FieldUpdateData>

// 2. confidence_upgrade
export const ConfidenceUpgradeData = z.object({
  field_name: z.string().min(1),          // matches evidence_bundles.field_name
  new_state: ConfidenceState,
  evidence_source_ids: z.array(z.string().uuid()).default([]),
  agreement_ratio: z.number().min(0).max(1).optional(),
  reasoning: z.string().min(1).optional(),
})
export type ConfidenceUpgradeData = z.infer<typeof ConfidenceUpgradeData>

// 3. negative_pattern_add
export const NegativePatternAddData = z.object({
  pattern_text: z.string().min(2).max(500),
  severity: NegPatSeverity,
  reasoning: z.string().min(1).optional(),
  source: z.string().optional(),          // 'admin' | 'user' | 'onboarding' — defaults to 'admin' in applier
})
export type NegativePatternAddData = z.infer<typeof NegativePatternAddData>

// 4. override_rule_add
export const OverrideRuleAddData = z.object({
  rule_key: z.string().min(2).max(120),
  rule_value: z.unknown(),                // free-form JSON; we just enforce non-null below
  reasoning: z.string().min(1).optional(),
  description: z.string().optional(),     // human-readable label shown in UI
})
export type OverrideRuleAddData = z.infer<typeof OverrideRuleAddData>

// 5. sector_signal — Layer 2
// CEO sends ANONYMIZED outcome data per Doc §4.5. Brand_id is forbidden here.
export const SectorSignalData = z.object({
  sector: SectorType,
  dialect: DialectType,
  outcome: z.enum(['approved', 'revised', 'hard_blocked']),
  content_type: z.string().optional(),
  tone: z.string().optional(),
  confidence_score: z.number().min(0).max(100).optional(),
  occasion: z.string().optional(),
  reasoning: z.string().min(1).optional(),
})
export type SectorSignalData = z.infer<typeof SectorSignalData>

// 6. global_signal — Layer 3 (content_performance_patterns)
// Same shape as sector_signal but stored in the global table.
export const GlobalSignalData = SectorSignalData
export type GlobalSignalData = z.infer<typeof GlobalSignalData>

// ── 7. method_profile_update — v2 creative-direction layer ────────────
// COO Pass 3 emits this after scoring the Composition Matrix. The Memory
// Controller upserts brand_method_profiles + appends to history.
export const MethodProfileUpdateData = z.object({
  voice_register:     z.enum(['intimate_humble','authoritative_warm','ironic_observer','devotional_serene','playful_curious','crafted_precise']),
  diagnostic_pattern: z.enum(['story_opener','question_opener','claim_opener','contradiction_opener','observation_opener']),
  visual_idiom:       z.enum(['minimal_natural_light','archive_film_grain','flat_graphic_warm','editorial_dramatic','documentary_unposed','studio_polished']),
  cadence_rule:       z.enum(['steady_drumbeat','burst_then_quiet','narrative_arc','occasion_aligned','reactive_responsive']),
  closing_pattern:    z.enum(['soft_invitation','direct_ask','open_question','no_close','community_call']),
  composition_blend:  z.record(
    z.enum(['voice', 'diagnostic', 'visual', 'cadence', 'closing']),
    z.enum(['Authenticity','Heritage','Metaphor','Paradox','Diagnostic','Vulnerability']),
  ),
  composition_score:  z.number().int().min(0).max(100),
  creative_direction_text: z.string().min(500).max(4000),
  change_reason:      z.enum(['onboarding','correction','maintenance','manual']).default('onboarding'),
  reasoning:          z.string().min(1).optional(),
})
export type MethodProfileUpdateData = z.infer<typeof MethodProfileUpdateData>

// ─────────────────────────────────────────────────────────────────────────
// Discriminated union — what an inbound nomination looks like.
// ─────────────────────────────────────────────────────────────────────────
export const NominationType = z.enum([
  'field_update',
  'confidence_upgrade',
  'negative_pattern_add',
  'override_rule_add',
  'sector_signal',
  'global_signal',
  'method_profile_update',
])
export type NominationType = z.infer<typeof NominationType>

export const Nomination = z.discriminatedUnion('nomination_type', [
  z.object({ nomination_type: z.literal('field_update'),          brand_id: z.string().uuid(), data: FieldUpdateData }),
  z.object({ nomination_type: z.literal('confidence_upgrade'),    brand_id: z.string().uuid(), data: ConfidenceUpgradeData }),
  z.object({ nomination_type: z.literal('negative_pattern_add'),  brand_id: z.string().uuid(), data: NegativePatternAddData }),
  z.object({ nomination_type: z.literal('override_rule_add'),     brand_id: z.string().uuid(), data: OverrideRuleAddData }),
  z.object({ nomination_type: z.literal('method_profile_update'), brand_id: z.string().uuid(), data: MethodProfileUpdateData }),
  // sector + global signals MUST NOT carry brand_id (Doc §4.4 PRIVACY rule).
  z.object({ nomination_type: z.literal('sector_signal'),         brand_id: z.null(),          data: SectorSignalData }),
  z.object({ nomination_type: z.literal('global_signal'),         brand_id: z.null(),          data: GlobalSignalData }),
])
export type Nomination = z.infer<typeof Nomination>

// ─────────────────────────────────────────────────────────────────────────
// Outcomes
// ─────────────────────────────────────────────────────────────────────────
export type RejectionCode =
  | 'unknown_nomination_type'
  | 'invalid_data_shape'
  | 'forbidden_field_path'
  | 'value_out_of_enum'
  | 'value_out_of_range'
  | 'pii_in_anonymous_signal'
  | 'brand_not_found'
  | 'evidence_sources_not_found'
  | 'idempotent_skip'
  | 'apply_failed'

export interface NominationProcessed {
  nomination_id: string
  status: 'written' | 'rejected'
  rejection_reason?: string
  /** When applied, the dotted path or table:column we wrote (for audit). */
  applied_to?: string
}

export interface ProcessResult {
  total: number
  written: number
  rejected: number
  details: NominationProcessed[]
}
