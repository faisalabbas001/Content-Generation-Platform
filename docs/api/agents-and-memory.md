# Agents & Memory — Complete API Guide

> **Audience:** anyone wiring n8n flows, server actions, or admin scripts to the OGz Studios backend.
> **Companion to:** [n8n-integration.md](../n8n-integration.md) (high-level + HMAC recipe), [webhook_contracts.md](./webhook_contracts.md) (n8n → Next.js status callbacks).
> **Source of truth for all endpoints + payloads.** Every example below has been smoke-tested.

---

## 1. The big picture

OGz Studios exposes **three families** of HTTP endpoints. n8n calls them in well-defined sequences per flow.

```
┌────────────────┐       ┌─────────────────────────────────┐       ┌──────────────────┐
│   n8n flows    │  ───▶ │   /api/agents/*  (AI calls)     │  ───▶ │  Anthropic /     │
│   (CronWebhook)│       │   /api/memory/*  (BrandDNA)     │       │  OpenAI /        │
│                │       │   /api/webhooks/n8n  (status)   │       │  DeepSeek / fal  │
└────────────────┘       └─────────────────────────────────┘       └──────────────────┘
                                          │
                                          ▼
                              ┌────────────────────────┐
                              │ Supabase: BrandDNA +   │
                              │ usage_logs +           │
                              │ branddna_event_log     │
                              └────────────────────────┘
```

**Hard rules (Doc §1.4) enforced by these endpoints:**
1. n8n never calls Anthropic / OpenAI / DeepSeek directly. Goes through `/api/agents/*`.
2. No agent writes BrandDNA directly. Memory Controller (`/api/memory/process`) is the sole writer.
3. Arabic text never enters image prompts. DeepSeek's `visual_brief_en` is English only.
4. Weavy / fal.ai CDN URLs never enter the database. Re-uploaded to Supabase Storage first.
5. n8n routes payloads only — never makes creative decisions.

---

## 2. Authentication — every request

Every request to **every endpoint below** must carry these four headers (one optional). See [n8n-integration.md §2](../n8n-integration.md) for the full HMAC recipe and an n8n Function-node snippet.

| Header | Required | Value |
|---|---|---|
| `content-type` | yes | `application/json` |
| `x-n8n-signature` | yes | `sha256(N8N_WEBHOOK_SECRET, raw_body).hex` |
| `x-n8n-request-id` | yes | UUID v4, unique per call (10-min replay-protection window) |
| `x-n8n-timestamp` | yes | ISO-8601 timestamp; rejected if drift > 5 min |
| `x-n8n-idempotency-key` | optional | 5-min cached response on duplicates |

Failure modes:

| HTTP | `error` code | What's wrong | n8n action |
|---|---|---|---|
| 400 | `invalid_json` | body isn't JSON | Fix; do not retry |
| 400 | `invalid_input` | body fails Zod validation | Fix; do not retry |
| 401 | `missing_headers` | a required header is absent | Fix; do not retry |
| 401 | `bad_signature` | HMAC mismatch | Fix the secret; do not retry |
| 401 | `timestamp_drift` | clock drift > 5 min | Fix clock |
| 409 | `replay_detected` | duplicate request_id within 10 min | Already processed — ignore |
| 413 | `body_too_large` | > 256 KB | Trim payload |
| 502 | `agent_call_failed` | provider failed after 2× retry | Skip + N8N-S03 |
| 500 | `internal_error` | unexpected | N8N-S03 + page Tech Copilot |

**Standard success envelope:**

```json
HTTP 200
{
  "ok": true,
  "request_id": "7f3a8d92-...",
  "result": { /* endpoint-specific */ }
}
```

---

## 3. AI Agents — `/api/agents/*`

Seven endpoints. Each accepts the same outer envelope:

```json
{
  "flow_id": "N8N-A01",       // for usage_logs filtering — pass the n8n flow ID
  "brand_id": "<uuid|null>",  // null only for system-level CEO calls
  "payload": { /* per-endpoint */ }
}
```

The `result` field returned matches the Zod schemas in [`packages/core/src/schemas/`](../../packages/core/src/schemas/) — they are the canonical source.

### 3.1 `POST /api/agents/ceo/classify`

**Doc:** §6.1 Steps 1-6 of the 8-step CEO protocol.
**Called by:** every flow as the FIRST step (N8N-A01 / A02 / A03 / A04 / A05 / B03).
**What it does:** classifies the trigger, picks confidence_mode, checks cost ceiling, returns `agents_to_dispatch`.
**Side effect:** auto-enqueues any `memory_nominations` the CEO emits.

**Request body:**

```json
{
  "flow_id": "N8N-A02",
  "brand_id": "11111111-1111-1111-1111-111111111111",
  "payload": {
    "request_type": "calendar_ondemand",
    "trigger_payload": { "post_id_hint": null, "source": "client_click" },
    "evidence_bundle_states": {
      "arabic_dialect":            "inferred_high",
      "brand_differentiator":      "explicitly_confirmed",
      "price_position":            "explicitly_confirmed",
      "primary_channel":           "explicitly_confirmed",
      "ramadan_relevance":         "inferred_high",
      "primary_audience.gender":   "inferred_medium",
      "primary_kpi_type":          "explicitly_confirmed",
      "religious_sensitivity":     "inferred_medium",
      "tone_anti_attribute_ids":   "explicitly_confirmed",
      "bilingual_ratio":           "explicitly_confirmed"
    },
    "occasion_flags": ["none"],
    "current_month_spend_usd": 5.0,
    "monthly_ceiling_usd": 50.0
  }
}
```

`request_type` is one of: `calendar_scheduled | calendar_ondemand | onboarding_new | revision | brand_correction | anomaly_alert | upgrade_signal`.

**Response:**

```json
{
  "ok": true,
  "request_id": "7f3a8d92-...",
  "result": {
    "decision": {
      "decision_id": "<uuid>",
      "brand_id": "11111111-1111-1111-1111-111111111111",
      "request_type": "calendar_ondemand",
      "pipeline": "A",
      "confidence_mode": "Standard",
      "occasion_flags": ["none"],
      "cost_status": "normal",
      "agents_to_dispatch": ["COO", "DeepSeek", "CCO", "COO"],
      "constraint_payload": {
        "brand_id": "11111111-...",
        "namespace": "qdrant-namespace-...",
        "confidence_mode": "Standard",
        "occasion_flags": ["none"],
        "cost_constraint": "normal",
        "sector_baseline_id": "<uuid>",
        "prohibited_patterns": [],
        "platform_spec": "instagram_1080x1080",
        "arabic_dialect": "Najdi",
        "tone_attribute_ids": ["warm","family_focused"],
        "visual_style_ids": ["food_photography_warm"],
        "content_mix": { "emotional": 0.4, "lifestyle": 0.35, "offer": 0.25 },
        "watermark_required": false
      },
      "human_gate_required": false,
      "human_gate_reasons": [],
      "anomaly_flag": null,
      "reasoning": "Standard mode; all 10 critical fields ≥ inferred_medium. No occasion active.",
      "memory_nominations": [
        { "nomination_type": "decision_trace", "family": "Memory", "field_path": "audit",
          "proposed_value": null, "source": "system_inference",
          "confidence_delta": "", "human_review_required": false }
      ]
    },
    "memory": { "enqueued": 0, "dropped": 1 }
  }
}
```

**How n8n uses the response:**

```
Read result.decision.confidence_mode
  ├─ "Blocked"  → write to qa_review_queue, skip this brand
  └─ otherwise   → continue to result.decision.agents_to_dispatch[0] (next agent)

Read result.decision.cost_status
  └─ "breached" → halt; write override_rules cost_halt=true via Supabase node

Read result.decision.human_gate_required
  └─ true       → route post(s) to qa_review_queue with reasons

result.memory.enqueued / dropped → log to your dashboard for visibility
```

---

### 3.2 `POST /api/agents/ceo/confidence-gate`

**Doc:** §6.1 Step 7 + §6.4 (the 11 human-gate triggers).
**Called by:** N8N-A01 / A02 / B03 *after* the CCO returns Arabic QC scores.
**What it does:** per-post routing decision (`clean` / `watermark_required` / `hold`) + checks all 11 override conditions.

**Request body:**

```json
{
  "flow_id": "N8N-A01",
  "brand_id": "11111111-...",
  "payload": {
    "request_type": "calendar_scheduled",
    "trigger_payload": { "month": "2026-05" },
    "cco_results": [
      { "post_id": "post_001", "score": 91, "brave_route_flag": false, "negpat_flag": "NONE" },
      { "post_id": "post_007", "score": 63, "brave_route_flag": false, "negpat_flag": "SOFT_WARN" },
      { "post_id": "post_018", "score": 42, "brave_route_flag": true,  "negpat_flag": "STRONG_WARN" }
    ],
    "evidence_bundle_states": {
      "arabic_dialect": "inferred_high",
      "brand_differentiator": "explicitly_confirmed"
    },
    "occasion_flags": ["none"]
  }
}
```

**Response:**

```json
{
  "ok": true,
  "request_id": "...",
  "result": {
    "decision": {
      "decision_id": "<uuid>",
      "brand_id": "11111111-...",
      "request_type": "calendar_scheduled",
      "confidence_mode": "Standard",
      "human_gate_required": true,
      "human_gate_reasons": ["brave_route_flagged", "cco_low_confidence"],
      "constraint_payload": {
        "post_routing": {
          "post_001": "clean",
          "post_007": "watermark_required",
          "post_018": "hold"
        }
      },
      "memory_nominations": [
        { "nomination_type": "global_signal",
          "family": "Learning",
          "field_path": "content_performance_patterns",
          "proposed_value": { "sector": "F&B", "dialect": "Najdi", "outcome": "approved" },
          "source": "cco_qc", "confidence_delta": "", "human_review_required": false }
      ]
    },
    "memory": { "enqueued": 1, "dropped": 0 }
  }
}
```

**How n8n uses the response:**

For each post:
- `clean` → continue to N8N-V01
- `watermark_required` → continue to N8N-V01 with `watermark_required: true`
- `hold` → INSERT `qa_review_queue` row, skip N8N-V01

---

### 3.3 `POST /api/agents/coo/build-branddna`

**Doc:** §6.2 Job 1.
**Called by:** N8N-A03 (onboarding), AFTER the 3 scrapers complete.
**What it does:** maps form + scraper data to 10 BrandDNA field nominations.

**Request body:**

```json
{
  "flow_id": "N8N-A03",
  "brand_id": "<uuid of just-created brand>",
  "payload": {
    "form_answers": {
      "brand_name_ar": "مطعم نجد",
      "brand_name_en": "Najd Restaurant",
      "sector": "F&B",
      "city_primary": "Riyadh",
      "arabic_dialect": "Najdi",
      "price_position": "mid_market",
      "brand_differentiator": "authentic Najdi home-style cooking served by Saudi family staff",
      "formality_level": "casual",
      "humor_tolerance": "light",
      "religious_sensitivity": "Medium",
      "bilingual_ratio": "arabic_primary",
      "primary_channel": "Instagram",
      "primary_kpi_type": "engagement",
      "tone_anti_attribute_ids": ["aggressive", "western_casual"]
    },
    "instagram_extraction": {
      "handle": "najdrestaurant",
      "followers": 12450,
      "post_count_30d": 18,
      "captions_sample": ["...", "..."],
      "engagement_rate": 0.038
    },
    "website_extraction": {
      "url": "https://najdrestaurant.sa",
      "fetched_at": "2026-04-29T10:15:00Z",
      "title": "مطعم نجد",
      "meta_description": "...",
      "primary_text": "..."
    },
    "google_business_extraction": {
      "place_id": "ChIJ...",
      "rating": 4.6,
      "review_count": 312,
      "category": "Restaurant"
    }
  }
}
```

**Response:**

```json
{
  "ok": true,
  "request_id": "...",
  "result": {
    "task_type": "build_branddna",
    "brand_id": "...",
    "field_nominations": [
      { "field_path": "VoiceProfile.arabic_dialect",
        "proposed_value": "Najdi",
        "confidence_state": "inferred_high",
        "confidence_score": 0.87,
        "sources": ["form_answer","instagram_caption_analysis"],
        "agreement_ratio": 1.0,
        "conflict_flag": false },
      { "field_path": "VoiceProfile.price_position",
        "proposed_value": "mid_market",
        "confidence_state": "explicitly_confirmed",
        "confidence_score": 0.95,
        "sources": ["form_answer"],
        "agreement_ratio": 1.0,
        "conflict_flag": false }
      // ... 8 more, exactly 10 total per Doc §6.2
    ],
    "completeness_score": 82,
    "dialect_confirmed": true,
    "critical_fields_missing": [],
    "source_records_to_create": [
      { "source_type": "INSTAGRAM_SCRAPE",
        "source_origin": "instagram.com/najdrestaurant",
        "reliability_score": 0.75,
        "field_contributions": ["VoiceProfile.arabic_dialect","BrandProfile.color_palette"] }
    ],
    "reasoning": "Form answers explicitly confirmed 7/10 fields; Instagram captions corroborated 3 more."
  }
}
```

**How n8n uses the response:**

1. Read `result.dialect_confirmed` — if `false`, set state in `brand_snapshots` and surface the dialect-confirmation prompt to the client.
2. Read `result.completeness_score` — used for routing readiness in subsequent flows.
3. **Don't write anything yet** — the Memory Controller will pick up the field_nominations on the next `/api/memory/process` call.

---

### 3.4 `POST /api/agents/coo/compile-caption-context`

**Doc:** §6.2 Job 2.
**Called by:** N8N-A01 / A02 *before* DeepSeek.
**What it does:** assembles the 800-1200 token brief DeepSeek consumes.

**Request body:**

```json
{
  "flow_id": "N8N-A01",
  "brand_id": "11111111-...",
  "payload": {
    "confidence_mode": "Standard",
    "occasion_flags": ["none"],
    "platform_spec": "Instagram 1080x1080, bottom-third safe zone, caption ≤220 chars",
    "content_mix": { "emotional": 0.4, "lifestyle": 0.35, "offer": 0.25 },
    "post_count": 20,
    "brand": {
      "brand_name_ar": "مطعم نجد",
      "brand_name_en": "Najd Restaurant",
      "sector": "F&B",
      "subsector": "casual_dining",
      "city_primary": "Riyadh",
      "arabic_dialect": "Najdi",
      "price_position": "mid_market",
      "formality_level": "casual",
      "humor_tolerance": "light",
      "religious_sensitivity": "Medium",
      "bilingual_ratio": "arabic_primary",
      "tone_attribute_ids": ["warm","family_focused","proud_saudi"],
      "tone_anti_attribute_ids": ["aggressive","western_casual"],
      "brand_differentiator": "authentic Najdi home-style cooking ..."
    },
    "negative_patterns": [
      { "text": "استمتع بالعروض", "severity": "SOFT_WARN" }
    ],
    "cost_constraint": "normal"
  }
}
```

**Response:**

```json
{
  "ok": true,
  "request_id": "...",
  "result": {
    "task_type": "compile_caption_context",
    "brand_id": "...",
    "caption_context": "BRAND: Najd Restaurant — F&B casual dining in Riyadh. Dialect: Najdi (warm, direct). Tone: warm, family-focused, proud Saudi. AVOID: aggressive CTAs, translation smell, English marketing clichés. CONTENT MIX: 40% emotional, 35% lifestyle, 25% offer. PLATFORM: Instagram 1080x1080. POLICY: never use 'استمتع بالعروض' (catalog English smell)...",
    "token_count": 1080,
    "layers_included": ["identity","constraints","policy"],
    "watermark_flag": false,
    "cautious_register_flag": false,
    "cache_prefix_hash": "a1b2c3...",
    "reasoning": "Full 3-layer context; cost not constrained."
  }
}
```

**How n8n uses it:** pass `result.caption_context` directly into the next call to DeepSeek.

---

### 3.5 `POST /api/agents/deepseek/generate`

**Doc:** §6 + DeepSeek prompt.
**Called by:** N8N-A01 / A02 *after* COO compile-context, *before* CCO.
**What it does:** generates exactly `post_count` Arabic captions with metadata.

**Request body:**

```json
{
  "flow_id": "N8N-A01",
  "brand_id": "11111111-...",
  "payload": {
    "month": "2026-05",
    "caption_context": "<the entire string returned by COO>",
    "post_count": 20,
    "occasion_context": { "name": "Ramadan", "lead_weeks": 2, "priority": "Critical" },
    "watermark_required": false
  }
}
```

`post_count` is `20` for paid tier, `8` for free.

**Response:**

```json
{
  "ok": true,
  "request_id": "...",
  "result": {
    "brand_id": "...",
    "month": "2026-05",
    "posts": [
      {
        "post_id": "post_001",
        "caption_ar": "بيت نجد يجمعكم الليلة على قهوة سعودية وتمر — تعالوا تذوّقوا الجلسة الأصيلة.",
        "hashtags": ["#مطعم_نجدي","#الرياض"],
        "content_type": "lifestyle",
        "objective": "engagement",
        "posting_time": "2026-05-03 19:30",
        "platform": "Instagram",
        "visual_brief_en": "warm food photography of dates and Saudi coffee dallah on a wooden majlis tray, family setting, golden-hour lighting",
        "watermark_required": false
      }
      // ... 19 more
    ],
    "reasoning": "Distributed 8 emotional / 7 lifestyle / 5 offer; lead-up posts emphasise hospitality."
  }
}
```

**Hard contract:** the wrapper validates `result.posts.length === payload.post_count`. Any mismatch counts as a retry attempt and eventually surfaces as 502 if the model can't comply.

**How n8n uses it:**

```
For each post in result.posts:
  Hold caption_ar + hashtags + posting_time → will go to CCO next
  Hold visual_brief_en + watermark_required → will go to N8N-V01 later
```

---

### 3.6 `POST /api/agents/cco/qc`

**Doc:** §6.3.
**Called by:** N8N-A01 / A02 *after* DeepSeek, *before* `/api/agents/coo/score-confidence`.
**What it does:** Arabic QC — score 0-100 + 4 flags + issue tags per post.

**Request body:**

```json
{
  "flow_id": "N8N-A01",
  "brand_id": "11111111-...",
  "payload": {
    "caption_context_excerpt": "Brand: Najd Restaurant (مطعم نجد), F&B casual dining in Riyadh. Dialect: Najdi. Tone: warm, family_focused, proud_saudi.",
    "posts": [
      { "post_id": "post_001",
        "caption_ar": "بيت نجد يجمعكم الليلة على قهوة سعودية وتمر — تعالوا تذوّقوا الجلسة الأصيلة.",
        "content_type": "lifestyle",
        "posting_time": "19:30" },
      { "post_id": "post_002",
        "caption_ar": "استمتع بخصوماتنا الحصرية المحدودة! اكتشف سحر النكهات.",
        "content_type": "offer",
        "posting_time": "20:00" }
    ]
  }
}
```

**Response:**

```json
{
  "ok": true,
  "request_id": "...",
  "result": [
    { "post_id": "post_001", "score": 91, "dialect_flag": false, "negpat_flag": "NONE",
      "cultural_flag": false, "brave_route_flag": false, "issues": [] },
    { "post_id": "post_002", "score": 42, "dialect_flag": false, "negpat_flag": "STRONG_WARN",
      "cultural_flag": false, "brave_route_flag": false,
      "issues": ["translation_smell","anti_attribute_violation"] }
  ]
}
```

**How n8n uses it:** the array maps 1:1 to the DeepSeek posts. Pass `result` into the next two calls (`/api/agents/coo/score-confidence` then `/api/agents/ceo/confidence-gate`).

---

### 3.7 `POST /api/agents/coo/score-confidence`

**Doc:** §6.2 Job 3.
**Called by:** N8N-A01 / A02 *after* CCO, *before* CEO confidence-gate.
**What it does:** computes the final 0-100 score per post via the fixed formula:
`field_floor*0.40 + arabic_qc*0.30 + occasion*0.15 + policy*0.15`.

**Request body:**

```json
{
  "flow_id": "N8N-A01",
  "brand_id": "11111111-...",
  "payload": {
    "field_confidence_floor": 0.9,
    "occasion_flags": ["none"],
    "posts": [
      { "post_id": "post_001",
        "caption_ar": "بيت نجد يجمعكم الليلة...",
        "cco_qc_score": 0.91,
        "cco_flags": { "dialect_flag": false, "negpat_flag": "NONE",
                       "cultural_flag": false, "brave_route_flag": false } },
      { "post_id": "post_002",
        "caption_ar": "استمتع بخصوماتنا...",
        "cco_qc_score": 0.42,
        "cco_flags": { "dialect_flag": false, "negpat_flag": "STRONG_WARN",
                       "cultural_flag": false, "brave_route_flag": false } }
    ]
  }
}
```

**Response:**

```json
{
  "ok": true,
  "request_id": "...",
  "result": {
    "task_type": "score_confidence",
    "brand_id": "...",
    "post_scores": [
      { "post_id": "post_001", "confidence_score": 89, "gate_result": "clean",
        "components": { "field_confidence_floor": 0.9, "arabic_qc_score": 0.91,
                        "occasion_alignment": 1.0, "policy_compliance": 1.0 },
        "floor_triggered": null },
      { "post_id": "post_002", "confidence_score": 60, "gate_result": "watermark_required",
        "components": { "field_confidence_floor": 0.9, "arabic_qc_score": 0.42,
                        "occasion_alignment": 1.0, "policy_compliance": 0.7 },
        "floor_triggered": "cco_low_arabic_qc" }
    ],
    "batch_summary": { "total_posts": 2, "clean_count": 1, "watermark_count": 1, "hold_count": 0, "blocked_count": 0 },
    "reasoning": "Post_002 floored on low CCO score; STRONG_WARN drops policy to 0.7."
  }
}
```

**How n8n uses it:** feed `result.post_scores` into CEO confidence-gate, OR map `gate_result` directly to N8N-V01 / qa_review_queue without another CEO call (when no override-trigger checks are needed). The standard chain still calls CEO confidence-gate so all 11 override triggers run.

---

## 4. Memory Controller — `/api/memory/*`

The Memory Controller is the **sole writer for BrandDNA** (Hard Rule #2). Per Doc §4.2, no agent ever writes to `brand_profiles`, `evidence_bundles`, `negative_patterns`, `override_rules`, `audience_profiles`, `visual_style_profiles`, `sector_baselines`, or `content_performance_patterns` directly.

### 4.1 How nominations get on the queue

**You don't enqueue them by HTTP.** They are produced as a side effect of every `/api/agents/ceo/*` call:

```
n8n → /api/agents/ceo/classify
        ↓
      route handler:
        decision = ceo.classify(...)
        translateCeoNominations(decision)        // CEO-prompt shape → DB shape
        enqueueNominations(db, ...)              // INSERT pending rows
        return { decision, memory: { enqueued: 4 } }
```

After a typical Sunday batch (60 brands × ~3 nominations / brand = ~180 rows), the queue has ~180 `pending` rows.

> If you need to enqueue from a server-only context (admin panel, server action), import `enqueueNominations` from `@repo/memory` directly — there is **no public HTTP enqueue endpoint** by design.

### 4.2 `POST /api/memory/process`

**Doc:** §4.2.
**Called by:** N8N-D02 (monthly), N8N-A01 / A02 / A03 (end-of-batch), admin panel.
**What it does:** drains `pending` rows from the queue — validates → applies → appends to `branddna_event_log` → marks `written` or `rejected`.

**Request body:**

```json
{
  "flow_id": "N8N-D02",
  "batch_size": 100
}
```

| Field | Type | Default | Purpose |
|---|---|---|---|
| `flow_id` | string | `"memory_controller"` | Audit label only — written to `usage_logs.flow_id`. Use the n8n flow ID. |
| `batch_size` | int 1-500 | 50 | Cap on rows claimed per call. Smaller = faster response; larger = fewer round-trips for monthly sweeps. |

**Response:**

```json
{
  "ok": true,
  "request_id": "...",
  "result": {
    "total": 178,
    "written": 175,
    "rejected": 3,
    "details": [
      { "nomination_id": "0d39ad8f-...", "status": "written",  "applied_to": "evidence_bundles.arabic_dialect" },
      { "nomination_id": "68657917-...", "status": "written",  "applied_to": "sector_baselines.F&B.Najdi" },
      { "nomination_id": "b88ee439-...", "status": "rejected", "rejection_reason": "forbidden_field_path: BrandProfile.tier" }
      // ... 175 more
    ]
  }
}
```

**Rejection codes you might see:**

| `rejection_reason` prefix | Meaning | n8n action |
|---|---|---|
| `forbidden_field_path` | CEO tried to write a non-whitelisted field | Tighten the CEO prompt |
| `value_out_of_enum` | proposed value not in allowed enum | Tighten the CEO prompt |
| `value_out_of_range` | regex / range / type mismatch | Tighten the CEO prompt |
| `pii_in_anonymous_signal` | UUID / email / Arabic in a Layer 2/3 signal | Bug — alert via N8N-S03 |
| `brand_not_found` | brand_id deleted between enqueue and process | Rare — log and continue |
| `evidence_sources_not_found` | confidence_upgrade referenced unknown source_id | Tighten CEO + check Apify writes |
| `apply_failed` | DB error during the write | Retry next call; alert if persistent |
| `invalid_data_shape` | Zod re-validation failed | Bug — alert via N8N-S03 |

**How n8n uses it:**

1. Loop until `result.total === 0` (or set a hard cap, e.g. 10 iterations).
2. If `result.rejected > 0`, query the queue or the response details for reasons; aggregate-alert via N8N-S03 if any are critical (`pii_in_anonymous_signal`, `invalid_data_shape`).
3. The route is **idempotent and safe to retry** — duplicate `request_id` returns 409, and the queue's claim-update guard prevents double-processing across parallel callers.

### 4.3 What gets written where

When a nomination is applied, here's exactly what changes:

| `nomination_type` | Tables written | `branddna_event_log.event_type` |
|---|---|---|
| `field_update` | `brand_profiles` OR `audience_profiles` OR `visual_style_profiles` (column updated) | `client_confirmed` (if source=client_confirmation) else `confidence_upgraded` |
| `confidence_upgrade` | `evidence_bundles` (UPSERT on (brand_id, field_name)) | `confidence_upgraded` |
| `negative_pattern_add` | `negative_patterns` (INSERT, dedupe on text) | `override_added` |
| `override_rule_add` | `override_rules` (UPSERT on (brand_id, rule_key)) | `override_added` |
| `sector_signal` | `sector_baselines` (rolling-mean update) | `source_ingested` |
| `global_signal` | `content_performance_patterns` (rolling-mean update) | `source_ingested` |

**The event log is the canonical audit trail.** Doc §4 promises that BrandDNA state can be re-derived by replaying this log alone.

---

## 5. Status callbacks — `/api/webhooks/n8n`

**Called by:** every flow at completion / on error / for health pulses.
**What it does:** logs a row in `usage_logs` (`node_name='n8n_callback'`) so admins can see what each flow did. Sprint S7.06 will branch on `event_type` to update calendars / qa_review_queue / brand_snapshots.

**Request body:**

```json
{
  "event_type": "batch_complete",
  "flow_id": "N8N-A01",
  "brand_id": "<uuid|null>",
  "payload": { /* free-form per event_type */ }
}
```

**Suggested `event_type` vocabulary:**

| `event_type` | Emitted by | Typical payload |
|---|---|---|
| `onboarding_complete` | N8N-A03 | `{ completeness_score, dialect_confirmed, duration_ms }` |
| `dialect_unconfirmed` | N8N-A03 | `{ inferred_value }` |
| `brand_complete` | N8N-A01 / A02 (per brand) | `{ calendar_id, posts_clean, posts_watermark, posts_held, cost_usd }` |
| `batch_complete` | N8N-A01 (whole shard) | `{ brands_processed, total_posts, total_cost_usd, duration_ms }` |
| `revision_ready` | N8N-B03 | `{ post_id, attempt }` |
| `correction_applied` | N8N-A04 | `{ field_path }` |
| `cost_alert` | N8N-S02 | `{ brand_id, pct, ceiling, spend }` |
| `health_pulse` | N8N-S01 | `{ ceo_fails, ds_fails, avg_ms }` |
| `anomaly` | N8N-S03 | `{ source_flow, anomaly_type, severity, details }` |
| `maintenance_complete` | N8N-D02 | `{ memory_drained, stale_flagged }` |

**Response:** `{ ok: true, request_id }` — fire-and-forget from n8n's POV.

---

## 6. End-to-end flow walkthroughs

Below: every flow translated into a step-by-step list of HTTP calls. Pair with the recipes in [n8n-integration.md](../n8n-integration.md).

### 6.1 N8N-A03 — Onboarding (the foundational flow)

```
1. Webhook trigger ← Next.js form server action posts here
   { brand_id, slug, form_answers, instagram_handle, website_url }

2. Supabase node — INSERT brand_snapshots (is_partial=true, snapshot_data=form_answers)
   ↳ frontend's /processing page sees this in <1s via realtime

3. POST /api/agents/ceo/classify
   → if confidence_mode == "Blocked" → branch to N8N-S03

4. Run 3 scrapers in parallel:
   4a. Apify node                → instagram_extraction
   4b. HTTP Request → Google Places  → google_business_extraction
   4c. HTTP Request → website + Cheerio Code node → website_extraction

5. Merge node combines into one payload

6. POST /api/agents/coo/build-branddna
   ← form_answers + 3 extractions
   → field_nominations (10), completeness_score, dialect_confirmed

7. POST /api/memory/process { flow_id: "N8N-A03", batch_size: 50 }
   → 10 field nominations → brand_profiles + audience/visual_style_profiles
   → evidence_bundles upserted
   → branddna_event_log appended

8. Supabase node — UPDATE brand_snapshots (is_partial=false, full data)

9. IF !dialect_confirmed → POST /api/webhooks/n8n event_type=dialect_unconfirmed

10. POST /api/webhooks/n8n event_type=onboarding_complete
```

### 6.2 N8N-A01 — Sunday batch (the production workhorse)

```
1. Cron trigger (Sunday 23:00 AST, with shard filter)

2. Supabase node — SELECT * FROM brand_profiles WHERE batch_shard = $shard

3. SplitInBatches (size: 5) — parallelism cap

4. FOR EACH brand:
   a. POST /api/agents/ceo/classify
   b. IF confidence_mode == "Blocked" → skip + qa_review_queue
   c. POST /api/agents/coo/compile-caption-context
   d. POST /api/agents/deepseek/generate (post_count = 20 paid / 8 free)
   e. POST /api/agents/cco/qc
   f. POST /api/agents/coo/score-confidence
   g. POST /api/agents/ceo/confidence-gate
   h. Switch per post:
      - clean / watermark_required → Execute Sub-Workflow N8N-V01
      - hold → Supabase INSERT qa_review_queue
   i. Supabase INSERT calendars + calendar_posts
   j. HTTP Request → Resend (calendar-ready email)
   k. POST /api/webhooks/n8n event_type=brand_complete

5. After all brands:
   POST /api/memory/process { flow_id: "N8N-A01", batch_size: 500 }
   Loop until result.total === 0

6. POST /api/webhooks/n8n event_type=batch_complete
```

### 6.3 N8N-A02 — On-demand single post

Same as A01 but: webhook trigger, 1 brand, `post_count: 1`, no shard logic, < 5 min SLA.

### 6.4 N8N-A04 — Brand correction

```
1. Webhook trigger ← /[slug]/profile "Flag correction" button
   { brand_id, field_path, old_value, new_value, reasoning }

2. POST /api/agents/ceo/classify
   payload.request_type = "brand_correction"
   payload.trigger_payload = { field_path, old_value, new_value, reasoning }
   → CEO emits memory_nomination with source: "client_confirmation"

3. POST /api/memory/process

4. POST /api/webhooks/n8n event_type=correction_applied
```

### 6.5 N8N-A05 — Upgrade signal

```
1. Cron trigger (1st of month 06:00)

2. Supabase node — SELECT free-tier brands with total_calendars_generated >= 2 AND completeness_score >= 70

3. FOR EACH eligible brand:
   a. POST /api/agents/ceo/classify (request_type=upgrade_signal)
   b. HTTP Request → Resend (upgrade-prompt email)
   c. HTTP Request → PostHog (track upgrade_eligible)

4. POST /api/webhooks/n8n event_type=upgrade_eligible
```

### 6.6 N8N-B03 — Revision

```
1. Webhook trigger ← /[slug]/calendar "Request revision" button
   { brand_id, post_id, revision_reason }

2. POST /api/agents/ceo/classify (request_type=revision)
   → if human_gate_required (revision_count ≥ 3) → qa_review_queue + exit

3. POST /api/agents/coo/compile-caption-context
4. POST /api/agents/deepseek/generate (post_count=1)
5. POST /api/agents/cco/qc
6. POST /api/agents/ceo/confidence-gate
7. Execute Sub-Workflow → N8N-V01 (1 post)
8. Supabase UPDATE calendar_posts (revision_count++)
9. HTTP Request → Resend ("Revision ready")
10. POST /api/webhooks/n8n event_type=revision_ready
```

### 6.7 N8N-V01 — fal.ai visual chain (sub-workflow)

> **Note:** the spec originally specified Weavy. The codebase uses **fal.ai** instead — `WEAVY_API_KEY` etc. are deprecated in favour of `FAL_KEY`. Behaviour is identical from n8n's perspective (one HTTP node per call instead of Weavy's chain) and the same Hard Rules apply (no Arabic in prompts, no fal.ai CDN URL in DB).

```
1. Sub-workflow trigger
   { brand_id, post_id, visual_brief_en, watermark_required, brand_name_ar,
     primary_color_hex, dialect, platform, content_type, first_ever_post }

2. Switch — model selection
   first_ever_post=true OR (content_type=awareness AND score>80) OR cultural/trust
     → fal-ai/flux-pro/v1.1-ultra
   default → fal-ai/nano-banana

3. HTTP Request → fal.ai queue
   POST https://queue.fal.run/<model>
   headers: { authorization: "Key {{$env.FAL_KEY}}" }
   body: { prompt: visual_brief_en, image_size: "square_hd", negative_prompt, num_inference_steps: 28 }
   → { request_id }

4. Wait + poll status
   GET https://queue.fal.run/<model>/requests/{{request_id}}/status
   Loop until status="COMPLETED" or 60s timeout

5. HTTP Request → fal.ai result
   GET https://queue.fal.run/<model>/requests/{{request_id}}
   → { images: [{ url: "https://fal.media/files/..." }] }

6. POST /api/visual/render
   ← { post_id, brand_id, source_image_url, brand_name_ar, primary_color_hex,
       dialect, platform, watermark_required }
   → /api/visual/render does (server-side):
     • Download from fal.ai
     • Sharp Arabic overlay (font by dialect)
     • Safe-zone mask (Instagram bottom-third)
     • Watermark if required
     • Upload to Supabase Storage at /clients/{brand_id}/calendars/{YYYY-MM}/{post_id}.jpg
   → { storage_url }

7. Return { post_id, storage_url } to caller (N8N-A01 / A02 / B03)
```

### 6.8 N8N-D02 — Memory + maintenance

```
1. Cron trigger (1st of month 04:00)

2. POST /api/memory/process { batch_size: 500 }
   Loop until result.total === 0

3. Supabase node — UPDATE evidence_bundles SET field_confidence='deprecated'
   WHERE last_evaluated < now() - interval '90 days' AND field_confidence IN ('inferred_low','inferred_medium')

4. POST /api/webhooks/n8n event_type=maintenance_complete
```

### 6.9 N8N-S01 — Health pulse

```
1. Cron trigger (every 15 min)

2. Supabase node — SELECT counts/avgs from usage_logs WHERE created_at > now() - interval '15 min'

3. IF ceo_fails > 3 OR ds_fails > 5 OR avg_ms > 60_000:
   a. HTTP Request → Resend (Tech Copilot alert)
   b. POST /api/webhooks/n8n event_type=anomaly source=N8N-S01
```

### 6.10 N8N-S02 — Cost monitor

```
1. Cron trigger (every 1 hour) OR webhook on every batch_complete

2. Supabase node — SELECT brand_id, sum(cost_usd) FROM usage_logs WHERE created_at >= date_trunc('month', now()) GROUP BY brand_id

3. FOR EACH brand:
   a. Read brand_profiles.tier → ceiling: free=$5, paid_starter=$25, paid_pro=$50
   b. pct = month_spend / ceiling
   c. Switch:
      pct >= 100% → urgent alert + halt generation (write override_rules cost_halt=true via Supabase node)
      pct >=  90% → urgent alert
      pct >=  70% → warning
   d. HTTP Request → Resend (Management Copilot)
   e. POST /api/webhooks/n8n event_type=cost_alert
```

### 6.11 N8N-S03 — Anomaly router

```
1. Webhook trigger ← any flow's error branch
   { source_flow, brand_id, anomaly_type, details }

2. Supabase node — INSERT anomaly_records

3. Switch by anomaly_type → route to right Copilot:
   cost_spike_detected           → Management
   namespace_breach_attempt      → Tech (CRITICAL)
   cco_systematic_failure        → Production
   fal_api_unavailable           → Tech
   deepseek_call_failed          → Tech
   pii_in_anonymous_signal       → Tech (CRITICAL)
   arabic_qa_regression          → Production

4. HTTP Request → Resend (routed Copilot's email)
5. POST /api/webhooks/n8n event_type=anomaly
```

---

## 7. Quick reference card

Stick this on your monitor while building n8n flows:

```
ALWAYS sign  : x-n8n-signature, x-n8n-request-id, x-n8n-timestamp
RETRY on 502 : never — let our wrapper retry + skip
RETRY on 500 : never — alert via N8N-S03
RETRY on 4xx : never — fix and rerun
RETRY on 409 : never — duplicate already processed

CEO routes return    { decision, memory: { enqueued, dropped } }
COO routes return    { task_type, ... }
CCO route returns    [evaluations]    (top-level array)
DeepSeek returns     { posts: [exact post_count], ... }
Memory process       { total, written, rejected, details }

Hard rules to enforce in flows:
  1. CEO is always called FIRST
  2. Never call /api/memory/process without prior CEO calls in the same batch
  3. Never call any /api/agents/* route from outside n8n in production
     (server actions can use @repo/ai directly — no HTTP round-trip needed)
  4. visual_brief_en is ENGLISH ONLY — never let Arabic leak in
  5. Only Supabase Storage URLs go into calendar_posts.storage_url
```

---

## 8. Smoke testing your wiring

Before publishing a new n8n flow:

```bash
# Auth + agents wiring (no AI cost)
pnpm ai:http-smoke -- --only=auth

# AI agents end-to-end (~$0.01 per run)
pnpm ai:http-smoke

# Library-level AI smoke (bypasses HTTP)
pnpm ai:smoke

# Memory Controller end-to-end against live DB
pnpm memory:smoke
```

Once all four pass on your laptop, your n8n flow's only failure mode is signing-related — and that's caught by the 401 in the very first call.

---

## 9. Where to look when something breaks

| Symptom | First place to check |
|---|---|
| 401 on every call | `N8N_WEBHOOK_SECRET` mismatch between Vercel and n8n |
| 401 timestamp_drift | n8n cloud clock skew (rare) — re-sign with fresh timestamp |
| 502 agent_call_failed | `usage_logs.payload.failed=true` rows for that flow_id |
| 500 internal_error | Vercel function logs |
| Memory Controller writes nothing | Query `memory_controller_queue` for status='pending' or rejected reasons |
| BrandDNA fields not updating | `branddna_event_log` for the brand_id; if no event row, the nomination was rejected |
| Cost ceiling not firing | `usage_logs` aggregation query in N8N-S02; check tier ceiling table |
| Calendar email not arriving | `usage_logs` row with `node_name='n8n_callback'` and `event_type='brand_complete'`; if missing, the flow died before email step |

For full incident playbooks see [`docs/runbooks/`](../runbooks/).
