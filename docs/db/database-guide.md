# Database Guide — Every Table, Every Field, In Plain Words

> **Audience:** anyone reading or writing code that touches Supabase.
> **Companion to:** [agents-and-memory.md](../api/agents-and-memory.md), [architecture/brand_dna_layers.md](../architecture/brand_dna_layers.md).
> **Status:** matches the live schema as of migration `0013` (30 application tables + `schema_migrations`).

---

## 1. The mental model

OGz Studios's database is shaped around three rules from Doc §1.4:

1. **A brand owns nothing it can corrupt.** Brand-scoped tables (Layer 1) are RLS-isolated to `auth_user_id = auth.uid()`.
2. **No agent writes BrandDNA directly.** All BrandDNA writes funnel through `memory_controller_queue` → Memory Controller.
3. **Decisions are append-only.** `routing_decisions` and `branddna_event_log` can never be updated or deleted (RLS enforces this).

Tables fall into **5 buckets**:

| Bucket | Tables | RLS scope |
|---|---|---|
| **Layer 1 — Brand-private** | brand_profiles, audience_profiles, visual_style_profiles, channel_profiles, source_records, evidence_bundles, negative_patterns, override_rules, onboarding_responses, brand_performance_log, brand_snapshots | Owner only (`auth.uid()`) |
| **Layer 2 — Sector intelligence** | sector_baselines, sector_question_weights, sector_trends | All authenticated read; service-role write |
| **Layer 3 — Global anonymous** | content_performance_patterns, global_negative_patterns, onboarding_intelligence, visual_performance_global, occasion_intelligence, onboarding_questions | All authenticated read; service-role write |
| **System / Audit** | routing_decisions, branddna_event_log, memory_controller_queue, confidence_classifications, qa_review_queue, usage_logs, anomaly_records, deletion_audit_log | Append-only (logs) or admin-only |
| **Content delivery** | calendars, calendar_posts | Owner read; service-role write |

When you write code, ask three questions:
1. **Which bucket does this table live in?** → tells you what client to use (user-scoped, admin, anon).
2. **Who is allowed to write to it?** → if it's Layer 1, you're not — Memory Controller is.
3. **Is it append-only?** → if yes, you can never UPDATE or DELETE; emit a new row instead.

---

## 2. Quick "I need to write X" lookup

| You want to... | Touch this table | How |
|---|---|---|
| Save a new brand from the onboarding form | `brand_profiles` | Server action with user-scoped client; RLS allows INSERT where `auth_user_id = auth.uid()` (migration 0007) |
| Update a brand's `formality_level` | `brand_profiles` | NEVER directly. CEO emits a `field_update` nomination → Memory Controller writes |
| Add a per-brand negative pattern | `negative_patterns` | NEVER directly. CEO emits a `negative_pattern_add` nomination |
| Record that the CEO routed something | `routing_decisions` | Already done by `@repo/ai`'s retry wrapper — it writes one row per CEO call |
| Write an audit row for a BrandDNA change | `branddna_event_log` | NEVER directly. Memory Controller writes one per applied nomination |
| Hold a post for human review | `qa_review_queue` | n8n Supabase node INSERT after CEO confidence-gate marks `hold` |
| Record API cost for a call | `usage_logs` | Already done by `@repo/ai`'s retry wrapper |
| Save a generated calendar | `calendars` + `calendar_posts` | n8n Supabase node INSERT after N8N-V01 returns storage URLs |
| Track the user's brand snapshot during onboarding | `brand_snapshots` | n8n Supabase node INSERT (partial in 60s, full when scrape completes) |
| Log an anomaly | `anomaly_records` | Already done by `@repo/ai`'s retry wrapper on final-fail; or n8n N8N-S03 |
| Track a PDPL deletion request | `deletion_audit_log` | Server action via `cascade_delete_brand()` SQL function |
| Read sector-wide content patterns to inform a new brand | `sector_baselines`, `content_performance_patterns` | Read-only via JS client (RLS allows authenticated read) |
| Pre-load Saudi calendar dates | `occasion_intelligence` | Already seeded (migration 0002); read-only |

---

## 3. Layer 1 — Brand-private tables

Every Layer 1 row belongs to exactly one brand. RLS guarantees no client can ever see another brand's data, even via direct DB query (Doc §4.2).

### 3.1 `brand_profiles` — the master brand record

The "header" record. One row per brand. Created by the onboarding server action (one of the few places where Layer 1 INSERT is allowed without going through the Memory Controller, because the brand has to exist before nominations can target it).

| Column | Type | Nullable | Meaning |
|---|---|---|---|
| `brand_id` | uuid (PK) | no | Stable identifier; all child tables reference this |
| `brand_name_ar` | text | no | Brand name in Arabic — the canonical display name on captions and emails |
| `brand_name_en` | text | yes | Optional English name (used for fal.ai prompts where Arabic is forbidden) |
| `sector` | enum `sector_type` | no | One of: F&B, Retail, Beauty_Wellness, Healthcare, Finance, Government, Other |
| `city_primary` | text | yes | Primary city (e.g. Riyadh, Jeddah, Dammam) — informs sector_baseline lookup |
| `arabic_dialect` | enum `dialect_type` | yes | Najdi / Hejazi / Gulf / MSA_formal / MSA_accessible / Mixed — **the most important field** (Doc §8.4) |
| `price_position` | enum `price_position_type` | yes | budget / mid_market / premium / luxury — drives tone calibration |
| `brand_differentiator` | text | yes | Free-text "what makes this brand special" (≥ 20 chars in onboarding) |
| `formality_level` | enum `formality_type` | yes | casual / semi_formal / formal |
| `humor_tolerance` | enum `humor_tolerance_type` | yes | none / light / moderate |
| `religious_sensitivity` | enum `religious_sensitivity_type` | yes | Low / Medium / High — High triggers human gate on religious content |
| `bilingual_ratio` | enum `bilingual_ratio_type` | yes | arabic_only / arabic_primary / balanced / english_primary |
| `ramadan_relevance`, `eid_fitr_relevance`, `eid_adha_relevance`, `national_day_relevance`, `founding_day_relevance` | enum `relevance_type` | yes | Critical / High / Medium / Low / Not_relevant — drives occasion lead-time logic |
| `primary_channel` | enum `channel_type` | yes | Instagram / Snapchat / TikTok / Twitter |
| `tier` | enum `tier_type` | no, default `free` | free / paid_starter / paid_pro — gates 8 vs 20 posts and Stripe upgrade |
| `pipeline_tier` | enum `pipeline_tier_type` | no, default `Starter` | Starter / Pro — internal pipeline routing |
| `batch_shard` | int | no, default 0 | 0-6, assigned at signup; determines which night the Sunday batch processes this brand (Doc §5.5) |
| `sector_baseline_id` | uuid (FK → sector_baselines) | yes | Pre-resolved baseline lookup — used by COO when compiling caption context |
| `client_slug` | text (UNIQUE) | no | URL-safe slug (`/[slug]/dashboard`); auto-generated by `@repo/auth/slug` |
| `logo_url` | text | yes | Supabase Storage URL — never a Weavy/fal.ai URL |
| `primary_color_hex` | char(7) | yes | `#RRGGBB` — used as Sharp overlay color |
| `completeness_score` | float | no, default 0 | 0-100; % of 10 critical fields with confidence ≥ inferred_medium |
| `total_calendars_generated` | int | no, default 0 | Used by override #1 (first-ever output check) |
| `auth_user_id` | uuid | yes | FK to `auth.users.id` — the supabase auth user who owns this brand |
| `created_at` / `updated_at` | timestamptz | no | Audit |

**Used in:** every flow. **Written by:** server action (INSERT only, on signup) + Memory Controller (UPDATE for all subsequent field changes).

### 3.2 `audience_profiles` — who this brand sells to

One row per brand (`UNIQUE (brand_id)`). Captures the audience picture that informs DeepSeek's tone.

| Column | Type | Meaning |
|---|---|---|
| `audience_id` | uuid (PK) | |
| `brand_id` | uuid (FK, UNIQUE) | One audience profile per brand |
| `description_ar` | text | Free-form Arabic description ("نساء سعوديات 25-45") |
| `gender_mix` | jsonb | `{ "female": 0.6, "male": 0.4 }` |
| `age_range` | jsonb | `{ "min": 25, "max": 45 }` |
| `language_preference` | enum `bilingual_ratio_type` | Same enum as brand_profiles.bilingual_ratio |

**Written by:** Memory Controller via `field_update` nominations (paths like `AudienceProfile.gender_mix`).

### 3.3 `visual_style_profiles` — how this brand looks

One row per brand (`UNIQUE (brand_id)`). Drives N8N-V01's `visual_brief_en`.

| Column | Type | Meaning |
|---|---|---|
| `style_id` | uuid (PK) | |
| `brand_id` | uuid (FK, UNIQUE) | |
| `style_descriptor` | text | English-only descriptor ("warm food photography, natural light") |
| `color_palette` | text[] | Array of hex strings; first is primary |
| `platform_specs` | jsonb | `{ "instagram": { "canvas": "1080x1080", "safe_zone": "bottom-third" } }` |

**Written by:** Memory Controller. **Read by:** N8N-V01 sub-flow when packaging the visual context.

### 3.4 `channel_profiles` — per-platform brand metadata

Multiple rows per brand allowed (`UNIQUE (brand_id, channel)`). Stores follower counts and engagement signals from Apify scrapes.

| Column | Type | Meaning |
|---|---|---|
| `channel_id` | uuid (PK) | |
| `brand_id` | uuid (FK) | |
| `channel` | enum `channel_type` | Instagram / Snapchat / TikTok / Twitter |
| `handle` | text | "@najdrestaurant" (without the @) |
| `followers` | int | Last-known count |
| `engagement_rate` | float | (likes + comments) / followers, from Apify |
| `last_scraped_at` | timestamptz | When Apify last refreshed this row |

**Written by:** Memory Controller after N8N-A03 onboarding scrapes complete.

### 3.5 `source_records` — every external signal we've ever ingested

Captures one row per discrete piece of evidence: a form field, an Instagram caption analysis, a Google Places lookup. Referenced by `evidence_bundles.supporting_source_ids`.

| Column | Type | Meaning |
|---|---|---|
| `source_id` | uuid (PK) | |
| `brand_id` | uuid (FK) | |
| `source_type` | enum `source_type_enum` | form / correction / scrape / instagram / website / google_places |
| `raw_payload` | jsonb | The full raw extraction — kept verbatim for re-processing |
| `recency_score` | float | 0-1; decays with age — used by COO confidence math |
| `captured_at` | timestamptz | When the signal was first observed |

**Written by:** N8N-A03 after each scraper finishes (one row per scraper). Server action also writes one for the form submission. **Read by:** Memory Controller validators (`validateConfidenceUpgrade` cross-checks that referenced source_ids belong to this brand).

### 3.6 `evidence_bundles` — confidence per BrandDNA field

The single most important Layer 1 table. One row per (brand_id, field_name); captures the auto-derived confidence state and which sources support / contradict it.

| Column | Type | Meaning |
|---|---|---|
| `bundle_id` | uuid (PK) | |
| `brand_id` | uuid (FK) | |
| `field_name` | text | e.g. `arabic_dialect`, `price_position` |
| `supporting_source_ids` | uuid[] | Array of source_record IDs that agree |
| `contradicting_source_ids` | uuid[] | Array of source_record IDs that disagree |
| `agreement_ratio` | float (0-1) | 1 = all sources agree |
| `recency_score` | float (0-1) | Newer = higher |
| `conflict_score` | float (0-1) | 0 = no conflict |
| `field_confidence` | enum `field_confidence_type` | The auto-derived state — see below |
| `last_evaluated` | timestamptz | When confidence was last computed |

**Confidence states (Doc §4.2 + §14.2):**
| State | Meaning |
|---|---|
| `explicitly_confirmed` | Client typed/selected directly. Highest. |
| `inferred_high` | 3+ sources agree, ratio > 0.8 |
| `inferred_medium` | 2+ sources, ratio > 0.6 |
| `inferred_low` | 1 source or ratio < 0.6 (CEO caps generation confidence at 74) |
| `rejected` | Client said "this is wrong" via correction flow |
| `deprecated` | Source too old or no longer valid |

**Written by:** Memory Controller (`confidence_upgrade` nominations). **The 10 generation-critical fields per Doc §4.2:** `arabic_dialect`, `brand_differentiator`, `price_position`, `primary_channel`, `ramadan_relevance`, `primary_audience.gender`, `primary_kpi_type`, `religious_sensitivity`, `tone_anti_attribute_ids`, `bilingual_ratio`.

### 3.7 `negative_patterns` — per-brand "never say this"

Phrases the brand has explicitly forbidden, with severity. CCO checks against these every QC pass.

| Column | Type | Meaning |
|---|---|---|
| `pattern_id` | uuid (PK) | |
| `brand_id` | uuid (FK) | |
| `pattern_text` | text | The actual phrase to avoid |
| `severity` | enum `negpat_severity_type` | SOFT_WARN / STRONG_WARN / HARD_BLOCK |
| `created_at` | timestamptz | |

**Severity meaning:**
- `SOFT_WARN` — flag only, may still deliver
- `STRONG_WARN` — review required
- `HARD_BLOCK` — never deliver, even after review (override #11 fires)

**Written by:** Memory Controller via `negative_pattern_add` nominations.

### 3.8 `override_rules` — per-brand business rules

A flexible key/value table for brand-specific business rules: cost halts, custom hashtag whitelists, posting-time windows, etc.

| Column | Type | Meaning |
|---|---|---|
| `rule_id` | uuid (PK) | |
| `brand_id` | uuid (FK) | |
| `rule_key` | text | e.g. `cost_halt`, `posting_window`, `hashtag_whitelist` |
| `rule_value` | jsonb | Free-form value |

**Examples:**
```json
{ "rule_key": "cost_halt",        "rule_value": { "halted_at": "2026-04-15", "reason": "ceiling_breached" } }
{ "rule_key": "posting_window",   "rule_value": { "earliest": "08:00", "latest": "22:00" } }
{ "rule_key": "hashtag_whitelist","rule_value": { "tags": ["#مطعم_نجدي", "#الرياض"] } }
```

**Written by:** Memory Controller via `override_rule_add`. **Read by:** N8N-S02 (cost monitor reads `cost_halt` to decide whether to skip this brand on the next batch).

### 3.9 `onboarding_responses` — what the user actually answered

One row per (brand_id, question_id) — the raw answers from the 15-question intake form. Linked to `onboarding_questions` (Layer 3 — global question definitions).

| Column | Type | Meaning |
|---|---|---|
| `response_id` | uuid (PK) | |
| `brand_id` | uuid (FK) | |
| `question_id` | uuid (FK → onboarding_questions) | |
| `answer_raw` | text | Exact text the user typed |
| `answer_processed` | jsonb | Structured by COO during BrandDNA build |
| `confidence_weight` | float | Used by COO scoring |
| `source` | enum `source_type_enum` | form (default) / correction / scrape |
| `answered_at` | timestamptz | |

**Written by:** the onboarding server action (form submission) + Memory Controller (`source: 'correction'` rows from N8N-A04).

### 3.10 `brand_performance_log` — post-level metrics

Captures real-world performance metrics (likes, comments, reach) from Phase 2's Postiz/Meta integration. Phase 1 = empty.

| Column | Type | Meaning |
|---|---|---|
| `perf_id` | uuid (PK) | |
| `brand_id` | uuid (FK) | |
| `post_id` | uuid | The calendar_posts row this metric is for |
| `metric_key` | text | e.g. `likes`, `reach`, `engagement_rate` |
| `metric_value` | float | The numeric value |
| `captured_at` | timestamptz | When the metric was observed |

**Phase 2 work** — left empty in Phase 1. Schema is here so we can add the data ingestion flow without a migration.

### 3.11 `brand_snapshots` — what the user sees during processing

The "Brand Snapshot Card" data (Doc §8.4). Realtime-subscribed by the `/processing` page so users see a partial card in 60s and a full card when scrapers finish.

| Column | Type | Meaning |
|---|---|---|
| `snapshot_id` | uuid (PK) | |
| `brand_id` | uuid (FK) | |
| `is_partial` | bool | true = form-only data (60s after submit), false = full (5 min after) |
| `snapshot_data` | jsonb | The full card payload — sector, dialect, confidence, voice, audience, etc. |
| `created_at` | timestamptz | |

**Written by:** N8N-A03 (one INSERT for the partial row, one for the full row). **Read by:** the frontend via Supabase realtime.

---

## 4. Layer 2 — Sector Intelligence

Pre-loaded once per (sector, dialect). Updated monthly by CIO in Phase 2; read-only for all agents in Phase 1.

### 4.1 `sector_baselines` — the "default brand" per sector

The defaults that COO falls back to when a new brand has `inferred_low` critical fields.

| Column | Type | Meaning |
|---|---|---|
| `baseline_id` | uuid (PK) | |
| `sector` | enum `sector_type` | F&B, Retail, Beauty_Wellness, ... |
| `dialect` | enum `dialect_type` | Najdi, Hejazi, ... |
| `last_updated` | timestamptz | When CIO last refreshed |
| `sample_size` | int | How many brands inform this baseline |
| `recommended_content_mix` | jsonb | `{ "emotional": 0.40, "lifestyle": 0.35, "offer": 0.25 }` |
| `top_performing_tones` | jsonb | `[{ "tone_id": "warm_casual", "approval_rate": 0.91, "sample": 234 }]` |
| `worst_performing_tones` | jsonb | Same shape — tones that DON'T work in this sector |
| `occasion_insights` | jsonb | `{ "ramadan": { "best_type": "emotional", "optimal_lead_weeks": 2, "avg_score": 88 } }` |
| `common_negative_patterns` | jsonb | Phrases known to underperform sector-wide |
| `confidence_benchmarks` | jsonb | `{ "emotional": { "avg": 84, "p25": 71, "p75": 92 } }` — used by COO scoring |

**Pre-loaded:** 3 rows (F&B/Najdi, Retail/Najdi, Beauty_Wellness/Najdi) by migration `0003`.
**Written by:** Memory Controller via `sector_signal` nominations (after every approved/rejected post).

### 4.2 `sector_question_weights` — which onboarding questions matter most per sector

Lets CIO learn that "humor_tolerance" matters a lot for F&B but not for Government.

| Column | Type | Meaning |
|---|---|---|
| `weight_id` | uuid (PK) | |
| `sector` | enum `sector_type` | |
| `question_key` | text | Matches `onboarding_questions.maps_to_field` |
| `weight` | float | 0-1 importance multiplier |
| `last_updated` | timestamptz | |

**Phase 2 work.** Empty in Phase 1.

### 4.3 `sector_trends` — temporal signals

Captures "what's hot in F&B/Najdi this quarter" — used by CIO to nudge content_mix recommendations.

| Column | Type | Meaning |
|---|---|---|
| `trend_id` | uuid (PK) | |
| `sector` | enum `sector_type` | |
| `dialect` | enum `dialect_type` | |
| `trend_key` | text | e.g. `summer_2026_pricing_pressure` |
| `signal` | jsonb | Free-form trend data |
| `observed_at` | timestamptz | |

**Phase 2 work.** Empty in Phase 1.

---

## 5. Layer 3 — Global Anonymous Intelligence

Zero foreign keys to `brand_profiles` (Doc §4.4 PRIVACY rule). Cannot be linked to any specific brand even by direct DB query. CEO extracts anonymized signals only.

### 5.1 `content_performance_patterns` — "this combination works"

The single most valuable Layer 3 table. Aggregates outcome signals across all brands by (sector, dialect, occasion, content_type, objective).

| Column | Type | Meaning |
|---|---|---|
| `pattern_id` | uuid (PK) | |
| `sector` | enum `sector_type` | |
| `dialect` | enum `dialect_type` | |
| `occasion` | text | `ramadan`, `eid_fitr`, `none`, ... |
| `content_type` | text | `emotional`, `lifestyle`, `offer`, `educational`, ... |
| `objective` | text | `awareness`, `engagement`, `conversion`, ... |
| `avg_confidence` | float | Rolling-mean confidence_score across this group |
| `approval_rate` | float | Rolling-mean approval rate |
| `revision_rate` | float | Rolling-mean revision rate |
| `hard_block_rate` | float | Rolling-mean HARD_BLOCK rate |
| `sample_size` | int | Number of posts contributing |
| `last_updated` | timestamptz | |

**Written by:** Memory Controller via `global_signal` nominations (rolling-mean update). **Read by:** COO when compiling caption context — "F&B Najdi brands: warm_casual lifestyle = 91% approval" comes from here.

### 5.2 `negative_pattern_library` — global "don'ts"

Sector-tagged forbidden phrases. Brand-specific negatives live in `negative_patterns`.

| Column | Type | Meaning |
|---|---|---|
| `entry_id` | uuid (PK) | |
| `pattern_text` | text | The phrase |
| `severity` | enum `negpat_severity_type` | SOFT_WARN / STRONG_WARN / HARD_BLOCK |
| `sectors` | sector_type[] | Which sectors this pattern applies to |
| `description` | text | Human-readable rationale |

**Pre-loaded:** seeded by migration `0001` (initial set). **Read by:** CCO during QC; brand-specific overrides in `negative_patterns` take precedence.

### 5.3 `onboarding_intelligence` — which questions predict which outcomes

CIO's working memory: "in F&B/Najdi, brands that answer 'family-focused' to question Q5 have 87% approval rate." Used to prioritize/drop onboarding questions over time.

| Column | Type | Meaning |
|---|---|---|
| `intel_id` | uuid (PK) | |
| `question_key` | text | |
| `sector` | enum `sector_type` | Optional — null for cross-sector patterns |
| `answer_pattern` | jsonb | `{ "answer_value": "family-focused" }` |
| `outcome_signal` | jsonb | `{ "approval_rate": 0.87, "sample": 156 }` |
| `sample_size` | int | |
| `last_updated` | timestamptz | |

**Phase 2 work.** Empty in Phase 1.

### 5.4 `visual_performance_global` — which visual styles work

Same idea as content_performance_patterns but for visuals.

| Column | Type | Meaning |
|---|---|---|
| `visual_id` | uuid (PK) | |
| `sector` | enum `sector_type` | |
| `style_key` | text | e.g. `warm_food_photography` |
| `approval_rate` | float | |
| `sample_size` | int | |
| `last_updated` | timestamptz | |

**Phase 2 work.** Empty in Phase 1.

### 5.5 `occasion_intelligence` — pre-seeded Saudi calendar

The hardcoded occasion calendar. CEO checks this in Step 2 of the routing protocol to set `occasion_flags`.

| Column | Type | Meaning |
|---|---|---|
| `occasion_id` | uuid (PK) | |
| `occasion_key` | text | `ramadan`, `eid_fitr`, `eid_adha`, `national_day`, `founding_day` |
| `occasion_name_ar` | text | "رمضان" |
| `occasion_name_en` | text | "Ramadan" |
| `year` | int | 2026, 2027, 2028 |
| `gregorian_date` | date | Real-world date |
| `lead_weeks` | int | How far in advance to start content (Doc §4.3) |
| `priority` | enum `relevance_type` | Critical / High / ... |
| `recommended_mix` | jsonb | `{ "emotional": 0.55, "lifestyle": 0.30, "offer": 0.15 }` for that occasion |
| `sector_applicability` | jsonb | `{ "F&B": true, "Government": false }` |

**Pre-loaded:** 15 rows (5 occasions × 3 years 2026-2028) by migration `0002`. Read-only.

### 5.6 `onboarding_questions` — the question bank

Source of truth for the 15-question intake form.

| Column | Type | Meaning |
|---|---|---|
| `question_id` | uuid (PK) | |
| `question_text_ar` | text | The Arabic question shown to the user |
| `question_text_en` | text | English copy |
| `maps_to_field` | text | Which BrandDNA field this answer populates (e.g. `arabic_dialect`) |
| `sector_relevance` | jsonb | `{ "F&B": true, "Government": false }` |
| `importance_score` | float | Updated by CIO based on quality correlation |
| `introduced_at` | timestamptz | When this question was added |
| `introduced_because` | text | Audit trail — why was this question added? |

**Pre-loaded:** 15 questions seeded by migration `0003`. Read-only in Phase 1; CIO will append in Phase 2.

---

## 6. System / Audit tables

### 6.1 `routing_decisions` — every CEO decision (APPEND-ONLY)

The permanent audit trail of every CEO call. **Cannot be UPDATEd or DELETEd** — RLS enforces this with `using (false)` on UPDATE and DELETE policies.

| Column | Type | Meaning |
|---|---|---|
| `decision_id` | uuid (PK) | |
| `brand_id` | uuid | nullable — system-level decisions don't belong to a brand |
| `flow_id` | text | e.g. `N8N-A01` |
| `request_type` | text | `calendar_scheduled`, `onboarding_new`, ... |
| `pipeline_assigned` | text | `A` for now |
| `agents_dispatched` | jsonb | `["COO","DeepSeek","CCO","COO"]` |
| `constraints_applied` | jsonb | The full constraint payload |
| `confidence_mode` | enum `confidence_mode_type` | Standard / Cautious / Minimal / Blocked |
| `outcome` | text | Free-text outcome label |
| `timestamp` | timestamptz | |

**Written by:** the AI provider wrapper (`@repo/ai/retry.ts`) — every successful CEO call writes one row. **Read by:** admin panel routing log; auditors.

### 6.2 `branddna_event_log` — every BrandDNA change (APPEND-ONLY)

The single most important audit table per Doc §4. Every successful Memory Controller apply produces one row here.

| Column | Type | Meaning |
|---|---|---|
| `event_id` | uuid (PK) | |
| `brand_id` | uuid | nullable — anonymized to NULL on PDPL deletion |
| `event_type` | enum `event_type_enum` | source_ingested / contradiction_detected / client_confirmed / override_added / confidence_upgraded / brand_graduated |
| `event_data` | jsonb | Full context — what changed and why |
| `created_at` | timestamptz | |

**Cannot be UPDATEd or DELETEd. Even on PDPL deletion** — Doc §4.2: "On account deletion: anonymize brand_id field, retain event data for audit. Rollback: re-process event stream to reconstruct any past BrandDNA state."

**Written by:** Memory Controller only (`appendEvent` in `@repo/memory/event-log.ts`).

### 6.3 `memory_controller_queue` — the BrandDNA write queue

The ONLY path to BrandDNA writes (Doc §4.2). Filled by `enqueueNominations`, drained by `processQueue` in `@repo/memory`.

| Column | Type | Meaning |
|---|---|---|
| `nomination_id` | uuid (PK) | |
| `brand_id` | uuid | nullable for sector_signal/global_signal |
| `nomination_type` | enum `nomination_type_enum` | field_update / confidence_upgrade / negative_pattern_add / override_rule_add / sector_signal / global_signal |
| `nomination_data` | jsonb | Type-specific payload (incl. `_fingerprint` hash for idempotency) |
| `nominated_by` | text | default `'CEO'` — could be `'COO'`, `'admin'` |
| `nominated_at` | timestamptz | |
| `status` | enum `nomination_status_type` | pending / validated / written / rejected |
| `processed_at` | timestamptz | When the row was finalised |
| `rejection_reason` | text | Set when status = rejected |

**Written by:** `enqueueNominations` (CEO route side-effect) and `processQueue` (status updates). **Read by:** `processQueue` (claims pending rows in batches), admin panel.

### 6.4 `confidence_classifications` — per-brand current mode

Tracks the brand's current `confidence_mode` (Standard / Cautious / Minimal / Blocked) over time. When a new mode is set, the previous row is "superseded" rather than overwritten.

| Column | Type | Meaning |
|---|---|---|
| `classification_id` | uuid (PK) | |
| `brand_id` | uuid (FK) | |
| `mode` | enum `confidence_mode_type` | Standard / Cautious / Minimal / Blocked |
| `reasons` | jsonb | Array of reason strings |
| `created_at` | timestamptz | When this mode was set |
| `superseded_at` | timestamptz | When this row was replaced (null = still current) |

**Index:** `WHERE superseded_at IS NULL` — efficient "current mode" lookup.

**Written by:** the AI provider wrapper after each CEO classify call.

### 6.5 `qa_review_queue` — posts held for human review

When CEO confidence-gate decides `hold` or fires any of the 11 override triggers, the post lands here.

| Column | Type | Meaning |
|---|---|---|
| `queue_id` | uuid (PK) | |
| `brand_id` | uuid (FK) | |
| `post_id` | uuid | The calendar_posts row, if it exists |
| `caption_ar` | text | The caption that triggered review |
| `cco_score` | float | The CCO score that flagged it |
| `flags` | jsonb | All CCO flags (dialect_flag, negpat_flag, cultural_flag, brave_route_flag) |
| `trigger_reason` | text | Which override fired (e.g. `cco_low_confidence`) |
| `status` | enum `qa_status_type` | pending / approved / rejected / edited |
| `created_at` / `resolved_at` | timestamptz | |

**Written by:** n8n flows (Supabase node INSERT after CEO confidence-gate). **Read by:** Production Copilot + admin QA queue page.

### 6.6 `usage_logs` — every API call

Every CEO/COO/CCO/DeepSeek call writes ≥1 row here (one per attempt). Drives N8N-S02 cost monitor.

| Column | Type | Meaning |
|---|---|---|
| `log_id` | uuid (PK) | |
| `brand_id` | uuid (FK, nullable) | |
| `flow_id` | text | `N8N-A01`, `smoke_test`, ... |
| `node_name` | text | `ceo`, `coo`, `cco`, `deepseek`, `n8n_callback`, `memory_controller` |
| `cost_usd` | numeric(10,4) | Computed by `priceClaudeUsage` / `priceOpenAIUsage` / `priceDeepSeekUsage` |
| `duration_ms` | int | |
| `status` | text | Free-form label (often unused; payload.failed is the truth) |
| `payload` | jsonb | `{ attempt, tokens_in, tokens_out, cache_read, failed, error }` |
| `created_at` | timestamptz | |

**Written by:** `@repo/ai/retry.ts` (every attempt, success or failure) + `/api/webhooks/n8n` (one per status callback). **Read by:** admin cost page, N8N-S02 cost monitor, N8N-S01 health check.

### 6.7 `anomaly_records` — final-fail incidents

Written when a provider call fails after 2× retry, or when N8N-S03 receives an anomaly trigger.

| Column | Type | Meaning |
|---|---|---|
| `anomaly_id` | uuid (PK) | |
| `brand_id` | uuid (FK, nullable) | |
| `anomaly_type` | text | `ceo_call_failed`, `cost_spike_detected`, `pii_in_anonymous_signal`, ... |
| `severity` | text | default `'warning'`; we use `info` / `warning` / `error` / `critical` |
| `details` | jsonb | Stack trace, flow_id, attempt count, etc. |
| `resolved` | bool | Admin-flipped when handled |
| `created_at` | timestamptz | |

**Written by:** `@repo/ai/retry.ts` on final-fail + n8n N8N-S03. **Read by:** Tech Copilot + admin anomalies page.

### 6.8 `deletion_audit_log` — PDPL two-phase deletion

Tracks the two-phase cascade delete (Doc §7.4 + migration `0005`).

| Column | Type | Meaning |
|---|---|---|
| `audit_id` | uuid (PK) | |
| `brand_id` | uuid | nullable — anonymized post-deletion |
| `phase1_complete` | bool | DB cascade done |
| `phase2_complete` | bool | Qdrant + Storage purged |
| `last_attempt_at` | timestamptz | When pdpl-janitor last retried |
| `retries` | int | Phase 2 retry count |
| `error_details` | jsonb | If phase 2 failed |
| `deleted_at` | timestamptz | |

**Written by:** `cascade_delete_brand()` SQL function + the `pdpl-janitor` service. **Special RLS:** clients can INSERT their own deletion request and SELECT their own row (migration `0008`).

---

## 7. Content delivery tables

### 7.1 `calendars` — one per brand per month

| Column | Type | Meaning |
|---|---|---|
| `calendar_id` | uuid (PK) | |
| `brand_id` | uuid (FK) | |
| `month` | text | `YYYY-MM` (e.g. `2026-05`) — UNIQUE with brand_id |
| `status` | text | `draft` / `delivered` |
| `created_at` / `delivered_at` | timestamptz | |

**Written by:** N8N-A01 / A02 after the full chain completes. **Read by:** the calendar dashboard.

### 7.2 `calendar_posts` — individual posts

| Column | Type | Meaning |
|---|---|---|
| `post_id` | uuid (PK) | |
| `calendar_id` | uuid (FK) | |
| `brand_id` | uuid (FK) | denormalised for easier querying |
| `position` | int | 1-20 |
| `caption_ar` | text | What the user sees |
| `hashtags` | text[] | |
| `content_type` | text | `emotional`, `lifestyle`, ... |
| `posting_time` | timestamptz | |
| `storage_url` | text | **MUST be a Supabase Storage URL — never fal.ai** (Hard Rule #4, enforced by CHECK constraint) |
| `confidence_score` | float | 0-100 from COO score-confidence |
| `watermark` | bool | true if "Beta AI draft" overlay applied |
| `status` | text | `draft` / `approved` / `rejected` / `edited` |
| `approved_at` | timestamptz | When client approved (if applicable) |
| `created_at` | timestamptz | |

**Written by:** N8N-A01 / A02 after N8N-V01 returns Supabase Storage URLs. **Read by:** calendar dashboard, qa_review_queue page.

---

## 8. Enum reference (cheat sheet)

| Enum | Values |
|---|---|
| `sector_type` | F&B, Retail, Beauty_Wellness, Healthcare, Finance, Government, Other |
| `dialect_type` | Najdi, Hejazi, Gulf, MSA_formal, MSA_accessible, Mixed |
| `price_position_type` | budget, mid_market, premium, luxury |
| `formality_type` | casual, semi_formal, formal |
| `humor_tolerance_type` | none, light, moderate |
| `religious_sensitivity_type` | Low, Medium, High |
| `bilingual_ratio_type` | arabic_only, arabic_primary, balanced, english_primary |
| `relevance_type` | Critical, High, Medium, Low, Not_relevant |
| `channel_type` | Instagram, Snapchat, TikTok, Twitter |
| `tier_type` | free, paid_starter, paid_pro |
| `pipeline_tier_type` | Starter, Pro |
| `field_confidence_type` | explicitly_confirmed, inferred_high, inferred_medium, inferred_low, rejected, deprecated |
| `confidence_mode_type` | Standard, Cautious, Minimal, Blocked |
| `nomination_type_enum` | field_update, confidence_upgrade, negative_pattern_add, override_rule_add, sector_signal, global_signal |
| `nomination_status_type` | pending, validated, written, rejected |
| `event_type_enum` | source_ingested, contradiction_detected, client_confirmed, override_added, confidence_upgraded, brand_graduated |
| `qa_status_type` | pending, approved, rejected, edited |
| `negpat_severity_type` | SOFT_WARN, STRONG_WARN, HARD_BLOCK |
| `source_type_enum` | form, correction, scrape, instagram, website, google_places |

---

## 9. RLS at a glance

| Table family | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| Layer 1 (brand_profiles + children) | Owner only (`auth_user_id = auth.uid()`) | Owner (migration 0007) + service_role | Memory Controller via service-role policies (0011) | service_role only (PDPL cascade) |
| Layer 2 / 3 | All authenticated read | service_role (Memory Controller) | service_role | service_role |
| `routing_decisions` | Owner read | Anyone authenticated (`with check (true)`) | **BLOCKED** (`using (false)`) | **BLOCKED** |
| `branddna_event_log` | Owner read | Anyone authenticated | **BLOCKED** | **BLOCKED** even on PDPL |
| `memory_controller_queue` | service_role | service_role | service_role | service_role |
| `usage_logs` | Owner reads own + admin | service_role | none | none |
| `anomaly_records` | admin + Tech Copilot | service_role | none | none |
| `qa_review_queue` | Owner read + admin + Production Copilot | service_role | service_role | none |
| `calendars` / `calendar_posts` | Owner read + admin | service_role | service_role | service_role |
| `deletion_audit_log` | Owner reads own + service_role | Owner (PDPL request) + service_role | service_role | none |

**Source:** migrations `0001` (initial), `0007` (Layer 1 INSERT), `0008` (deletion self-request), `0010` (observability), `0011`-`0013` (Memory Controller policies).

---

## 10. Common queries

### "Which brands need attention this month?"

```sql
select bp.brand_id, bp.brand_name_ar, bp.completeness_score, cc.mode
from brand_profiles bp
left join lateral (
  select mode from confidence_classifications
  where brand_id = bp.brand_id and superseded_at is null
  order by created_at desc limit 1
) cc on true
where bp.tier != 'free'
  and (cc.mode in ('Cautious','Minimal','Blocked') or bp.completeness_score < 60)
order by bp.completeness_score asc;
```

### "How much did each agent cost this month?"

```sql
select node_name, count(*), sum(cost_usd) as cost
from usage_logs
where created_at >= date_trunc('month', now())
  and (payload->>'failed') is null
group by node_name
order by cost desc;
```

### "Which posts are stuck in QA queue?"

```sql
select queue_id, brand_id, trigger_reason, cco_score, age(now(), created_at) as waiting
from qa_review_queue
where status = 'pending'
order by created_at asc;
```

### "Reconstruct a brand's BrandDNA from the event log"

```sql
select event_type, event_data->>'applied_to' as field, event_data->'data'->>'proposed_value' as value, created_at
from branddna_event_log
where brand_id = $1
order by created_at asc;
```

### "What's pending in the Memory Controller queue?"

```sql
select status, nomination_type, count(*)
from memory_controller_queue
group by status, nomination_type
order by status, count(*) desc;
```

### "Cost per brand this month vs ceiling"

```sql
select
  bp.brand_id, bp.brand_name_ar, bp.tier,
  coalesce(sum(ul.cost_usd), 0) as month_spend,
  case bp.tier
    when 'free' then 5
    when 'paid_starter' then 25
    when 'paid_pro' then 50
  end as ceiling_usd
from brand_profiles bp
left join usage_logs ul on ul.brand_id = bp.brand_id
  and ul.created_at >= date_trunc('month', now())
  and (ul.payload->>'failed') is null
group by bp.brand_id, bp.brand_name_ar, bp.tier
order by month_spend desc;
```

---

## 11. Things you should NEVER do

| Don't | Why | Do instead |
|---|---|---|
| `UPDATE brand_profiles SET ... WHERE brand_id = ...` from app code | Hard Rule #2 — only Memory Controller writes | Have CEO emit a `field_update` nomination |
| `DELETE FROM branddna_event_log` | Append-only — RLS will reject | Anonymize `brand_id` to NULL via PDPL cascade if needed |
| Insert a Weavy / fal.ai URL into `calendar_posts.storage_url` | Hard Rule #4 + DB CHECK constraint | Download in `/api/visual/render` and re-upload to Supabase Storage |
| Put Arabic text in `visual_style_profiles.style_descriptor` | Hard Rule #3 | English descriptors only — Arabic is applied via Sharp post-generation |
| Read a Layer 1 table with the anon key | RLS will return empty | Use the service-role admin client (server only) or the user-scoped client (after auth) |
| Hardcode `'service_role'` policy checks at the app layer | RLS already enforces it; double-checking is just bug surface | Trust RLS; if data leaks, the bug is in the policy, fix the policy |

---

## 12. Where each table is referenced in code

| Table | Primary code site |
|---|---|
| `brand_profiles` | `apps/web/src/app/actions/onboarding.ts`, `@repo/memory/apply-brand.ts` (UPDATE), `@repo/db/queries/brands.ts` (READ) |
| `audience_profiles` | `@repo/memory/apply-brand.ts` |
| `visual_style_profiles` | `@repo/memory/apply-brand.ts`, N8N-V01 reads |
| `evidence_bundles` | `@repo/memory/apply-brand.ts` (`applyConfidenceUpgrade`) |
| `negative_patterns` | `@repo/memory/apply-brand.ts` (`applyNegativePatternAdd`), CCO reads |
| `override_rules` | `@repo/memory/apply-brand.ts` (`applyOverrideRuleAdd`), N8N-S02 reads |
| `source_records` | n8n N8N-A03 (INSERT after each scraper), `@repo/memory/validate.ts` (cross-brand check) |
| `routing_decisions` | `@repo/ai/retry.ts` (auto-INSERT) |
| `branddna_event_log` | `@repo/memory/event-log.ts` (`appendEvent`) |
| `memory_controller_queue` | `@repo/memory/{enqueue,process}.ts` |
| `confidence_classifications` | `@repo/ai` (auto-INSERT after CEO classify) |
| `qa_review_queue` | n8n flows (INSERT after CEO confidence-gate marks `hold`) |
| `usage_logs` | `@repo/ai/retry.ts` + `apps/web/src/app/api/webhooks/n8n/route.ts` |
| `anomaly_records` | `@repo/ai/retry.ts` (final-fail) + n8n N8N-S03 |
| `deletion_audit_log` | `cascade_delete_brand()` SQL function (migration 0005) + `services/pdpl-janitor` |
| `calendars` / `calendar_posts` | n8n N8N-A01/A02 (INSERT), `@repo/db/queries/calendars.ts` (READ) |
| `brand_snapshots` | n8n N8N-A03 (INSERT), `apps/web/src/app/[slug]/processing/page.tsx` (realtime SELECT) |
| `sector_baselines` | `@repo/memory/apply-anonymous.ts`, COO compile-caption-context reads |
| `content_performance_patterns` | `@repo/memory/apply-anonymous.ts`, COO reads |
| `occasion_intelligence` | `@repo/db/queries/occasions.ts` (READ — pre-seeded) |
| `onboarding_questions` / `onboarding_responses` | `apps/web/src/app/actions/onboarding.ts` |
| `negative_pattern_library` | CCO reads at QC time |

---

## 13. Migration history (chronological)

| File | Purpose |
|---|---|
| `0001_init.sql` | All 30 tables, 17 enums, RLS enabled on all, append-only policies, indexes, dummy data fixtures |
| `0002_seed_occasions.sql` | 5 occasions × 3 years (2026-2028) = 15 rows in `occasion_intelligence` |
| `0003_seed_baselines.sql` | 3 sector_baselines (F&B/Najdi, Retail/Najdi, Beauty/Najdi) + 15 onboarding_questions |
| `0005_pdpl_cascade.sql` | `cascade_delete_brand(uuid)` function for two-phase PDPL deletion |
| `0006_leads.sql` | Marketing apply-form leads table (later dropped) |
| `0007_layer1_insert_policies.sql` | Allows owner-INSERT on Layer 1 child tables for the onboarding flow |
| `0008_deletion_audit_self_request.sql` | Allows clients to request their own deletion |
| `0009_drop_leads.sql` | Drops the `leads` table — apply form removed |
| `0010_observability_policies.sql` | INSERT policies for `usage_logs` + `anomaly_records` |
| `0011_memory_controller_policies.sql` | INSERT/UPDATE policies for the 16 Memory Controller target tables |
| `0012_memory_queue_read.sql` | SELECT policies for the queue + Layer 2/3 |
| `0013_revert_layer1_open_read.sql` | Reverts an over-broad SELECT to preserve Layer 1 isolation |

To regenerate types: `pnpm db:types`. To run a fresh migrate: `pnpm db:migrate`. To verify: `pnpm db:verify`.

---

## 14. Where to look when something's off

| Symptom | First place to check |
|---|---|
| BrandDNA not updating | `memory_controller_queue` for status='rejected' or stuck 'validated' rows |
| Calendar email not arriving | `calendars.delivered_at` is null and `usage_logs` has no `n8n_callback` for `event_type=brand_complete` |
| Brand stuck on Cautious mode | `evidence_bundles` for that brand — find the `inferred_low` field |
| QA queue exploding | `qa_review_queue` GROUP BY trigger_reason — look for systemic CCO failures |
| Cost ceiling not firing | Compare `usage_logs` aggregation vs the tier ceilings table in N8N-S02 |
| Onboarding hung | `brand_snapshots` count for that brand_id — should have 1 partial + 1 full row within 5 min |
| Mysterious data showing in admin panel | `routing_decisions` + `branddna_event_log` are immutable — they're your time machine |
| RLS rejecting writes that "should" work | Check `auth.role()` on the JWT — anon JWT in service-role slot is the #1 culprit (HANDOVER known issue) |
