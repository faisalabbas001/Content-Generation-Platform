# OGz Studios Database — Educational Diagram

A visual guide to understand every table, its fields, and how they connect.

---

## 1. THE BIG PICTURE — 3 Layers + System

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         OPENCLAW DATABASE                                │
│                                                                          │
│  ┌─────────────────┐   ┌──────────────────┐   ┌──────────────────────┐ │
│  │   LAYER 1       │   │   LAYER 2        │   │   LAYER 3            │ │
│  │  Private Brand  │   │  Sector Intel    │   │  Global Anonymous    │ │
│  │  (per-tenant)   │   │  (read-only)     │   │  (NO brand link)     │ │
│  │                 │   │                  │   │                      │ │
│  │  brand_profiles │   │  sector_baselines│   │  content_perf_       │ │
│  │  audience       │   │  sector_weights  │   │     patterns         │ │
│  │  visual_style   │   │  sector_trends   │   │  negative_pattern_   │ │
│  │  channel        │   │                  │   │     library          │ │
│  │  source_records │   │                  │   │  occasion_intel      │ │
│  │  evidence       │   │                  │   │  visual_perf_global  │ │
│  │  ...            │   │                  │   │  onboarding_intel    │ │
│  └────────┬────────┘   └────────┬─────────┘   └──────────────────────┘ │
│           │                      │                                       │
│           │      ┌───────────────┘                                       │
│           ▼      ▼                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │   SYSTEM TABLES (Orchestration + Audit + Deliverables)          │   │
│  │                                                                  │   │
│  │   routing_decisions  branddna_event_log  memory_controller_queue│   │
│  │   confidence_class   qa_review_queue     usage_logs             │   │
│  │   anomaly_records    calendars           calendar_posts         │   │
│  │   deletion_audit_log leads                                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. CENTRAL TABLE — `brand_profiles` (the heart of everything)

```
┌──────────────────────────────────────────────────────────┐
│                   brand_profiles                          │
│           "ONE row per brand customer"                    │
├──────────────────────────────────────────────────────────┤
│ PK  brand_id              UUID                            │
│     brand_name_ar         TEXT       (Arabic name)        │
│     brand_name_en         TEXT       (English name)       │
│     sector                ENUM       (F&B, Retail...)     │
│     city_primary          TEXT                            │
│     arabic_dialect        ENUM       (Najdi, Hejazi...)   │
│                                                           │
│  ── BRAND VOICE ──                                        │
│     formality_level       ENUM       (casual..formal)     │
│     humor_tolerance       ENUM       (none/light/mod)     │
│     religious_sensitivity ENUM       (Low/Med/High)       │
│     bilingual_ratio       ENUM       (ar_only..en_prim)   │
│                                                           │
│  ── OCCASION RELEVANCE ──                                 │
│     ramadan_relevance     ENUM                            │
│     eid_fitr_relevance    ENUM                            │
│     national_day_relev.   ENUM                            │
│                                                           │
│  ── BUSINESS ──                                           │
│     tier                  ENUM   (free/starter/pro)       │
│     pipeline_tier         ENUM   (Starter/Pro)            │
│     batch_shard           INT    (0-6, for parallel jobs) │
│     completeness_score    FLOAT  (0-100, DNA fullness)    │
│                                                           │
│  ── BRANDING ──                                           │
│     logo_url              TEXT                            │
│     primary_color_hex     CHAR(7) (#RRGGBB)               │
│     client_slug           TEXT   (URL-friendly, UNIQUE)   │
│                                                           │
│  ── AUTH LINK ──                                          │
│     auth_user_id          UUID   → Supabase auth.users    │
│ FK  sector_baseline_id    UUID   → sector_baselines       │
│                                                           │
│     created_at / updated_at                               │
└──────────────────────────────────────────────────────────┘
                         │
                         │ ONE brand has MANY of these:
                         ▼
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   audience_         visual_style_    channel_
   profiles          profiles         profiles
   (1:1)             (1:1)            (1 per platform)
```

---

## 3. SATELLITE TABLES (around `brand_profiles`)

```
                    ┌────────────────────┐
                    │  brand_profiles    │
                    │  (brand_id PK)     │
                    └────────┬───────────┘
                             │
   ┌─────────────────────────┼─────────────────────────────┐
   │                         │                             │
   ▼                         ▼                             ▼
┌──────────────┐      ┌──────────────┐           ┌──────────────────┐
│ audience_    │      │ visual_style │           │ channel_profiles │
│ profiles     │      │ _profiles    │           │                  │
├──────────────┤      ├──────────────┤           ├──────────────────┤
│ description  │      │ style_descr. │           │ channel (IG/TT)  │
│ gender_mix   │      │ color_palette│           │ handle           │
│ age_range    │      │ platform_spec│           │ followers        │
│ language_pref│      │              │           │ engagement_rate  │
└──────────────┘      └──────────────┘           └──────────────────┘
   "Who follows         "Visual identity            "Per-platform
    the brand?"          and style guide"            stats"


   ┌─────────────────────────┼─────────────────────────────┐
   │                         │                             │
   ▼                         ▼                             ▼
┌──────────────┐      ┌──────────────┐           ┌──────────────────┐
│source_records│      │evidence_     │           │negative_patterns │
│              │      │bundles       │           │                  │
├──────────────┤      ├──────────────┤           ├──────────────────┤
│ source_type  │─────▶│field_name    │           │ pattern_text     │
│ (form/scrape)│      │supporting_ids│           │ severity         │
│ raw_payload  │      │contradict_ids│           │  (SOFT_WARN..    │
│ recency_score│      │agreement_rat │           │   HARD_BLOCK)    │
│ captured_at  │      │confidence    │           │                  │
└──────────────┘      └──────────────┘           └──────────────────┘
  "Raw data IN"        "Decision engine:          "Don't say THIS
                        is this fact reliable?"    for this brand"


   ┌─────────────────────────┼─────────────────────────────┐
   ▼                         ▼                             ▼
┌──────────────┐      ┌──────────────┐           ┌──────────────────┐
│override_rules│      │onboarding_   │           │brand_performance │
│              │      │responses     │           │_log              │
├──────────────┤      ├──────────────┤           ├──────────────────┤
│ rule_key     │      │ question_id  │           │ post_id          │
│ rule_value   │      │ answer_raw   │           │ metric_key       │
│ (jsonb)      │      │ answer_proc. │           │ metric_value     │
│              │      │ source       │           │ captured_at      │
└──────────────┘      └──────────────┘           └──────────────────┘
  "Manual brand        "Brand's answers           "How well are
   override rules"      to onboarding Q's"         posts performing?"


                              │
                              ▼
                    ┌──────────────────┐
                    │ brand_snapshots  │
                    ├──────────────────┤
                    │ is_partial       │
                    │ snapshot_data    │  "Frozen state of
                    │ (jsonb)          │   BrandDNA at time T"
                    └──────────────────┘
```

---

## 4. THE EVIDENCE ENGINE (most important concept)

```
   How does OGz Studios decide if a fact about the brand is reliable?

   1. Data comes IN ───────────────────────┐
                                            │
   ┌─────────────────────┐    ┌────────────▼──────────┐
   │  Form submission    │───▶│   source_records      │
   │  Instagram scrape   │───▶│                       │
   │  Website crawl      │───▶│  raw_payload (jsonb)  │
   │  Google Places      │───▶│  source_type, recency │
   └─────────────────────┘    └────────────┬──────────┘
                                            │
                                            ▼
                              ┌─────────────────────────┐
                              │  evidence_bundles       │
                              │  (one per BRAND+FIELD)  │
                              ├─────────────────────────┤
                              │  field_name             │
                              │  supporting_source_ids  │ ← agree
                              │  contradicting_ids      │ ← disagree
                              │  agreement_ratio  0..1  │
                              │  recency_score    0..1  │
                              │  conflict_score   0..1  │
                              │  field_confidence       │
                              │   ┌─────────────────┐   │
                              │   │ explicitly_conf │   │ HIGHEST
                              │   │ inferred_high   │   │
                              │   │ inferred_medium │   │
                              │   │ inferred_low    │   │
                              │   │ rejected        │   │
                              │   │ deprecated      │   │ LOWEST
                              │   └─────────────────┘   │
                              └─────────────────────────┘
                                          │
                                          ▼
                              "AI uses this field with X confidence"
```

---

## 5. THE ONLY WAY TO WRITE BRAND DNA (Hard Rule #2)

```
   AGENT (CEO)                MEMORY CONTROLLER         LAYER 1 TABLES
   ───────────                ──────────────────        ──────────────

   ┌──────────┐ nominate     ┌─────────────────┐    write   ┌─────────┐
   │  CEO     │─────────────▶│ memory_         │───────────▶│ brand_  │
   │  Agent   │              │ controller_queue│            │ profiles│
   └──────────┘              ├─────────────────┤            │ ...     │
                             │ status:         │            └─────────┘
                             │   pending       │
                             │   validated     │            ❌ DIRECT
                             │   written       │               WRITES
                             │   rejected      │               BLOCKED
                             ├─────────────────┤
                             │ nomination_type │            (RLS enforced)
                             │ (field_update,  │
                             │  conf_upgrade,  │
                             │  override_add..)│
                             └─────────────────┘
                                      │
                                      ▼
                           ┌─────────────────────┐
                           │ branddna_event_log  │  APPEND-ONLY
                           │ (audit trail)       │  no UPDATE/DELETE
                           └─────────────────────┘
```

---

## 6. THE PRODUCT — Calendars & Posts

```
   ┌──────────────────┐
   │  brand_profiles  │
   └────────┬─────────┘
            │ 1:N (one per month)
            ▼
   ┌──────────────────────────┐
   │       calendars          │
   ├──────────────────────────┤
   │ calendar_id  PK          │
   │ brand_id     FK          │
   │ month        "2026-04"   │
   │ status       draft|deliv │
   │ delivered_at             │
   │ UNIQUE(brand_id, month)  │
   └────────────┬─────────────┘
                │ 1:20 (exactly 20 posts per calendar)
                ▼
   ┌──────────────────────────────────────┐
   │         calendar_posts               │  ◄── THE DELIVERABLE
   ├──────────────────────────────────────┤
   │ post_id          PK                  │
   │ calendar_id      FK                  │
   │ brand_id         FK                  │
   │ position         1..20  (ordered)    │
   │ caption_ar       (Arabic copy)       │
   │ hashtags         text[]              │
   │ content_type     promo|edu|...       │
   │ posting_time     timestamptz         │
   │ storage_url      Supabase Storage    │
   │                  ❌ NO weavy.ai URLs │
   │                  (CHECK constraint)  │
   │ confidence_score 0..1                │
   │ watermark        bool (free tier)    │
   │ status           draft|approved      │
   │ approved_at                          │
   └──────────────────────────────────────┘
```

---

## 7. SUPPORT / SYSTEM TABLES

```
┌─────────────────────────┐    ┌─────────────────────────┐
│  routing_decisions      │    │  branddna_event_log     │
│  (APPEND-ONLY)          │    │  (APPEND-ONLY)          │
├─────────────────────────┤    ├─────────────────────────┤
│ flow_id                 │    │ event_type              │
│ pipeline_assigned       │    │  source_ingested        │
│ agents_dispatched       │    │  contradiction_detected │
│ confidence_mode         │    │  client_confirmed       │
│ outcome                 │    │  override_added         │
│ "Every CEO routing      │    │  confidence_upgraded    │
│  decision is logged"    │    │  brand_graduated        │
└─────────────────────────┘    └─────────────────────────┘


┌─────────────────────────┐    ┌─────────────────────────┐
│ confidence_classific.   │    │  qa_review_queue        │
├─────────────────────────┤    ├─────────────────────────┤
│ mode                    │    │ post_id                 │
│  Standard               │    │ caption_ar              │
│  Cautious               │    │ cco_score (AI score)    │
│  Minimal                │    │ flags (jsonb)           │
│  Blocked                │    │ status                  │
│ reasons (jsonb)         │    │  pending|approved|      │
│ superseded_at           │    │  rejected|edited        │
│ "Current AI mood"       │    │ "Posts needing human"   │
└─────────────────────────┘    └─────────────────────────┘


┌─────────────────────────┐    ┌─────────────────────────┐
│      usage_logs         │    │   anomaly_records       │
├─────────────────────────┤    ├─────────────────────────┤
│ flow_id                 │    │ anomaly_type            │
│ node_name               │    │ severity                │
│ cost_usd  numeric(10,4) │    │ details (jsonb)         │
│ duration_ms             │    │ resolved (bool)         │
│ status                  │    │ "Things gone wrong"     │
│ "Cost & perf metering"  │    │                         │
└─────────────────────────┘    └─────────────────────────┘


┌─────────────────────────┐    ┌─────────────────────────┐
│  deletion_audit_log     │    │       leads             │
│  (PDPL compliance)      │    │   (Marketing form)      │
├─────────────────────────┤    ├─────────────────────────┤
│ brand_id (kept)         │    │ brand_name_ar/en        │
│ phase1_complete         │    │ full_name, email, phone │
│ phase2_complete         │    │ status                  │
│ retries                 │    │  new|contacted|         │
│ error_details           │    │  converted|dropped      │
│ "Two-phase right-to-    │    │ ip_hash (sha256)        │
│  be-forgotten log"      │    │  ❌ never raw IP        │
└─────────────────────────┘    └─────────────────────────┘
```

---

## 8. LAYER 2 — Sector Intelligence

```
   "What works for THIS sector in general?"

   ┌──────────────────────────────────┐
   │      sector_baselines            │  ← brand_profiles points here
   ├──────────────────────────────────┤
   │ sector + dialect (UNIQUE)        │
   │ recommended_content_mix (jsonb)  │  e.g. {promo:40%, edu:30%}
   │ top_performing_tones    (jsonb)  │
   │ worst_performing_tones  (jsonb)  │
   │ occasion_insights       (jsonb)  │
   │ common_negative_patterns(jsonb)  │
   │ confidence_benchmarks   (jsonb)  │
   │ sample_size                      │
   └──────────────────────────────────┘

   ┌──────────────────────────────────┐
   │   sector_question_weights        │
   ├──────────────────────────────────┤   "Religious-sensitivity Q
   │ sector + question_key (UNIQUE)   │    weighted heavier for F&B
   │ weight  float (default 1.0)      │    than for Tech sector"
   └──────────────────────────────────┘

   ┌──────────────────────────────────┐
   │       sector_trends              │
   ├──────────────────────────────────┤   "Riyadh Beauty sector
   │ sector + dialect + trend_key     │    spike: nude-tone palette
   │ signal (jsonb)                   │    +400% engagement"
   │ observed_at                      │
   └──────────────────────────────────┘
```

---

## 9. LAYER 3 — Global Anonymous Intelligence (NO brand FK)

```
   "What works ACROSS ALL brands?" — completely anonymous, PDPL-safe

   ┌─────────────────────────────────┐
   │  content_performance_patterns   │
   ├─────────────────────────────────┤
   │ sector, dialect, occasion       │
   │ content_type, objective         │
   │ avg_confidence                  │
   │ approval_rate                   │
   │ revision_rate                   │
   │ hard_block_rate                 │
   │ sample_size                     │
   └─────────────────────────────────┘

   ┌─────────────────────────────────┐    ┌──────────────────────────┐
   │  negative_pattern_library       │    │ visual_performance_global│
   ├─────────────────────────────────┤    ├──────────────────────────┤
   │ pattern_text                    │    │ sector + style_key       │
   │ severity (SOFT/STRONG/HARD)     │    │ approval_rate            │
   │ sectors[]                       │    │ sample_size              │
   │ description                     │    └──────────────────────────┘
   └─────────────────────────────────┘

   ┌─────────────────────────────────┐    ┌──────────────────────────┐
   │  onboarding_intelligence        │    │   occasion_intelligence  │
   ├─────────────────────────────────┤    ├──────────────────────────┤
   │ question_key + sector           │    │ occasion_key + year UNIQ │
   │ answer_pattern   (jsonb)        │    │ occasion_name_ar/en      │
   │ outcome_signal   (jsonb)        │    │ gregorian_date           │
   │ sample_size                     │    │ lead_weeks               │
   └─────────────────────────────────┘    │ priority                 │
                                          │ recommended_mix (jsonb)  │
                                          │ sector_applicability     │
                                          └──────────────────────────┘
```

---

## 10. ROW LEVEL SECURITY (RLS) — Who Can See What?

```
   ┌────────────────────────────────────────────────────────┐
   │   USER TYPE      │  CAN SEE                            │
   ├──────────────────┼─────────────────────────────────────┤
   │  anon            │  global Layer 2/3 read              │
   │                  │  (sector baselines, occasions)      │
   │                  │  + INSERT into leads                │
   ├──────────────────┼─────────────────────────────────────┤
   │  authenticated   │  same as anon                       │
   │  (regular user)  │  + own brand row                    │
   │                  │    (brand_profiles.auth_user_id     │
   │                  │     = auth.uid())                   │
   │                  │  + everything FK'd to that brand    │
   ├──────────────────┼─────────────────────────────────────┤
   │  service_role    │  EVERYTHING (admin bypass)          │
   │  (backend / n8n) │  + can write Layer 1                │
   ├──────────────────┼─────────────────────────────────────┤
   │  admin JWT       │  reads leads (sales pipeline)       │
   └──────────────────┴─────────────────────────────────────┘

   APPEND-ONLY tables (routing_decisions, branddna_event_log):
     INSERT ✅      UPDATE ❌      DELETE ❌
```

---

## 11. THE DATA FLOW (END-TO-END)

```
   Step 1                Step 2                Step 3
   ──────                ──────                ──────
   ┌────────┐           ┌─────────────┐       ┌──────────────┐
   │ leads  │──convert─▶│brand_profiles│──────▶│  onboarding_  │
   │/apply  │           │ + auth user │       │  responses    │
   └────────┘           └──────┬──────┘       └──────┬────────┘
                               │                      │
                               ▼                      ▼
   Step 4                ┌────────────┐        ┌──────────────┐
   ──────                │ source_    │        │              │
                         │ records    │        │              │
                         │ (scrape,   │        │              │
                         │  IG, web)  │        │              │
                         └─────┬──────┘        │              │
                               │                │              │
                               ▼                ▼              │
   Step 5                ┌─────────────────────────┐           │
   ──────                │   evidence_bundles      │◄──────────┘
                         │   (confidence engine)   │
                         └────────────┬────────────┘
                                      │
                                      ▼
   Step 6                ┌─────────────────────────┐
   ──────                │   memory_controller_    │   (CEO nominates)
                         │   queue                 │
                         └────────────┬────────────┘
                                      │ validate + write
                                      ▼
   Step 7                ┌─────────────────────────┐
   ──────                │   Layer 1 fields        │
                         │   updated               │
                         │   + branddna_event_log  │
                         └────────────┬────────────┘
                                      │
                                      ▼
   Step 8                ┌─────────────────────────┐
   ──────                │   routing_decisions     │   (CEO routes)
                         │   confidence_classific. │
                         └────────────┬────────────┘
                                      │
                                      ▼
   Step 9                ┌─────────────────────────┐
   ──────                │   calendars +           │   ◄── PRODUCT!
                         │   calendar_posts (×20)  │
                         └────────────┬────────────┘
                                      │
                                      ▼
   Step 10               ┌─────────────────────────┐
   ──────                │   qa_review_queue       │   (human QA)
                         │   brand_performance_log │   (track results)
                         │   usage_logs            │   (cost meter)
                         └─────────────────────────┘
                                      │
                                      ▼
   Step 11               ┌─────────────────────────┐
   ──────                │   Layer 3 aggregation   │   (anonymous learning)
                         │   feeds back to all     │
                         └─────────────────────────┘
```

---

## 12. QUICK REFERENCE — Field Naming Conventions

```
   _id      = UUID primary key or foreign key
   _at      = timestamptz timestamp column
   _ar / _en= Arabic / English text variants
   _hex     = 7-char color (#RRGGBB)
   _ratio   = float 0..1
   _score   = float (range varies; see CHECK constraint)
   _ids     = uuid array (e.g. supporting_source_ids)
   _payload = jsonb raw data
   _data    = jsonb structured data
   _key     = text identifier (e.g. question_key, occasion_key)
```

---

## 13. THE 4 HARD RULES (enforced via DB)

```
   ┌────────────────────────────────────────────────────────────────┐
   │ #1  CEO always routes first.                                    │
   │     → Logged in routing_decisions (append-only)                │
   ├────────────────────────────────────────────────────────────────┤
   │ #2  Memory Controller is the SOLE BrandDNA writer.              │
   │     → memory_controller_queue is the only path to Layer 1      │
   │     → RLS blocks direct writes for non-service_role             │
   ├────────────────────────────────────────────────────────────────┤
   │ #3  Arabic text NEVER in image prompts.                         │
   │     → Applied via Sharp overlay in n8n flow N8N-V01            │
   ├────────────────────────────────────────────────────────────────┤
   │ #4  Weavy CDN URLs NEVER in the database.                       │
   │     → CHECK (storage_url NOT LIKE '%weavy.ai%')                │
   │       on calendar_posts                                         │
   └────────────────────────────────────────────────────────────────┘
```
