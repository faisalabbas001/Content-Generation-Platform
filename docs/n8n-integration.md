# n8n → OGz Studios integration guide

This is the contract between **n8n** (orchestration) and **OGz Studios** (Next.js
backend). Per Doc §1.4 Hard Rule #5: *"n8n NEVER makes creative or strategic
decisions — it routes payloads between agents only."* Every AI call goes
through one of our HTTP endpoints; n8n never calls Anthropic / OpenAI /
DeepSeek directly.

---

## 1. Endpoint catalogue

All routes are `POST` only, JSON in / JSON out, on `https://<your-vercel-host>`.

| Endpoint | Used by | What it does |
|---|---|---|
| `/api/agents/ceo/classify` | every flow (FIRST step) | Steps 1-6 of CEO 8-step protocol — returns a `RoutingDecision` with `agents_to_dispatch` |
| `/api/agents/ceo/confidence-gate` | N8N-A01, N8N-A02, N8N-B03 | Step 7 — applies the 11 human-gate triggers after CCO QC |
| `/api/agents/coo/build-branddna` | N8N-A03 | Job 1 — maps form + scrapers to 10 BrandDNA field nominations |
| `/api/agents/coo/compile-caption-context` | N8N-A01, N8N-A02 | Job 2 — assembles the 800-1200 token brief for DeepSeek |
| `/api/agents/coo/score-confidence` | N8N-A01, N8N-A02 | Job 3 — final 0-100 score per post |
| `/api/agents/cco/qc` | N8N-A01, N8N-A02 | Arabic QC — score + 4 flags + issues per caption |
| `/api/agents/deepseek/generate` | N8N-A01, N8N-A02 | 20 (or 8) Arabic captions per call |
| `/api/webhooks/n8n` | every flow (status callback) | Audit log + future event router (sprint S7.06) |

---

## 2. Authentication — every request must be signed

We use **HMAC-SHA256** of the raw body with `N8N_WEBHOOK_SECRET`. n8n calls
that miss any of the three headers below get a 401.

### Required headers

| Header | Value | Purpose |
|---|---|---|
| `x-n8n-signature` | `sha256(secret, body).hex` | Authenticity (constant-time compared) |
| `x-n8n-request-id` | UUID v4, unique per call | Replay protection (10-min in-memory dedupe) |
| `x-n8n-timestamp` | ISO-8601 (e.g. `2026-04-28T15:42:11.000Z`) | Drift check (rejected if > 5 min off) |

### Optional header

| Header | Value | Purpose |
|---|---|---|
| `x-n8n-idempotency-key` | any string | Replay-safe — duplicate calls within 5 min return the cached response |

### How n8n computes the signature

In an n8n **HTTP Request** node, set the body via the "Raw / JSON" mode and
add a Function node before it that produces the headers. Example:

```js
// n8n Function node — signs the body for OGz Studios HTTP nodes.
// Reads N8N_WEBHOOK_SECRET from $env.
const crypto = require('crypto');
const body = JSON.stringify($json.body);            // EXACTLY what you'll send
const ts = new Date().toISOString();
const reqId = crypto.randomUUID();
const sig = crypto.createHmac('sha256', $env.N8N_WEBHOOK_SECRET)
                  .update(body)
                  .digest('hex');
return {
  json: {
    body,                                            // raw string — pass to "Body Content Type: Raw"
    headers: {
      'content-type': 'application/json',
      'x-n8n-signature': sig,
      'x-n8n-request-id': reqId,
      'x-n8n-timestamp': ts,
      // Optional — set when retrying a transient failure:
      // 'x-n8n-idempotency-key': $node['previous-step'].json.idempotency_key,
    },
  },
};
```

The HTTP Request node that follows reads `body` and `headers` from this output.
**Critical:** the `body` string passed to the HTTP node must be byte-identical
to what was signed. Don't re-stringify — pass `body` directly as Raw.

### Storing the secret

Per Doc §2.2 + SEC-02: `N8N_WEBHOOK_SECRET` lives in **Vercel env vars** (our
side) and the **n8n credential object** (their side). Never in source.
Generate a fresh value with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

To rotate:
1. Generate a new secret.
2. Update Vercel **and** n8n simultaneously (2-window process).
3. Old secret invalidates all in-flight requests within ~5 min (timestamp
   drift bound). For zero-downtime rotation, support both old + new on our
   side for 10 min — not implemented in Phase 1; brief outage acceptable.

---

## 3. Standard response shapes

### Success

```json
HTTP 200
{ "ok": true, "request_id": "uuid-v4", "result": { /* agent output */ } }
```

The `result` shape matches the Zod schemas in `@repo/core/schemas`:
- CEO routes return a `RoutingDecision`
- COO routes return one of `BuildBrandDnaResponse` / `CompileCaptionContextResponse` / `ScoreConfidenceResponse`
- CCO returns a `CcoPostEvaluation[]`
- DeepSeek returns a `DeepSeekResponse`

### Errors

```json
HTTP 400  { "ok": false, "error": "invalid_input",     "message": "...", "issues": [...] }
HTTP 401  { "ok": false, "error": "bad_signature",     "message": "HMAC mismatch" }
HTTP 401  { "ok": false, "error": "missing_headers",   "message": "..." }
HTTP 401  { "ok": false, "error": "timestamp_drift",   "message": "..." }
HTTP 409  { "ok": false, "error": "replay_detected",   "message": "..." }
HTTP 413  { "ok": false, "error": "body_too_large",    "message": "..." }
HTTP 502  { "ok": false, "error": "agent_call_failed", "message": "...", "node": "ceo", "attempts": 3 }
HTTP 500  { "ok": false, "error": "internal_error",    "message": "..." }
```

| Status | What n8n should do |
|---|---|
| 4xx (except 409) | Log + skip the brand/post. Do **not** retry — the request is malformed. |
| 409 (replay) | Means n8n sent the same request twice; ignore the duplicate. |
| 502 | Provider already retried 2× our side (Doc §5.4) — log + skip the brand/post; don't retry n8n-side. |
| 500 | Bug — page Tech Copilot via N8N-S03. Don't retry. |

---

## 4. Per-flow integration recipes

### N8N-A01 (Sunday batch — full chain)

```
TRIGGER (Cron Sunday 23:00 AST)
  ↓
1. Supabase Query: get active Starter clients (paginated)
  ↓
2. POST /api/agents/ceo/classify
   body: { flow_id: "N8N-A01", brand_id: <uuid>, payload: { request_type: "calendar_scheduled", ... } }
   → returns RoutingDecision; if confidence_mode === "Blocked", skip this brand
  ↓
3. POST /api/agents/coo/compile-caption-context
   body: { flow_id: "N8N-A01", brand_id, payload: { confidence_mode, occasion_flags, ... } }
   → returns CaptionContext
  ↓
4. POST /api/agents/deepseek/generate
   body: { flow_id: "N8N-A01", brand_id, payload: { month, caption_context, post_count: 20, watermark_required } }
   → returns 20 captions
  ↓
5. POST /api/agents/cco/qc
   body: { flow_id: "N8N-A01", brand_id, payload: { caption_context_excerpt, posts: [{ post_id, caption_ar }, ...] } }
   → returns evaluations[]
  ↓
6. POST /api/agents/coo/score-confidence
   body: { flow_id: "N8N-A01", brand_id, payload: { posts: [...], field_confidence_floor, occasion_flags } }
   → returns final 0-100 per post
  ↓
7. POST /api/agents/ceo/confidence-gate
   body: { flow_id: "N8N-A01", brand_id, payload: { request_type: "calendar_scheduled", cco_results: [...] } }
   → returns clean / watermark / hold per post
  ↓
8. (For non-held posts) Execute N8N-V01 sub-flow (Weavy + Sharp)
  ↓
9. Supabase write: calendars + calendar_posts
  ↓
10. Resend email
  ↓
11. POST /api/webhooks/n8n
    body: { event_type: "batch_complete", flow_id: "N8N-A01", brand_id, payload: { calendar_id, summary } }
```

### N8N-A02 (on-demand — same chain, 1 post)

Identical to A01 with `request_type: "calendar_ondemand"` and `post_count: 1`.
Higher priority queue — bypass batch shard.

### N8N-A03 (onboarding)

```
TRIGGER (Webhook from /onboarding-start form)
  ↓
1. Validate payload, write source_records
  ↓
2. Launch 3 parallel scrapers (Apify Instagram, website, Google Places)
  ↓
3. POST /api/agents/ceo/classify
   body: { flow_id: "N8N-A03", brand_id, payload: { request_type: "onboarding_new", trigger_payload: { form_answers, ... } } }
  ↓
4. POST /api/agents/coo/build-branddna
   body: { flow_id: "N8N-A03", brand_id, payload: { form_answers, instagram_extraction, website_extraction, google_business_extraction } }
   → returns 10 field_nominations + dialect_confirmed + completeness_score
  ↓
5. Memory Controller writes brand_profiles + evidence_bundles (sprint TBD — currently we'd write directly via service role)
  ↓
6. POST /api/webhooks/n8n
   body: { event_type: "onboarding_complete", flow_id: "N8N-A03", brand_id, payload: { completeness_score, dialect_confirmed } }
   → frontend's /processing page sees the brand_snapshots row appear via Supabase realtime
```

### N8N-A04 (brand correction)

Same as A03 but `request_type: "brand_correction"` and the trigger payload
contains the corrected field. CEO nominates the change to
memory_controller_queue.

### N8N-B03 (revision)

Like A02 but with `request_type: "revision"`. CEO checks override #9
(revision_count ≥ 3 → human gate).

### N8N-S01 (health check, every 15 min)

Doesn't call AI agents. Calls `/api/webhooks/n8n` with
`event_type: "health_pulse"` so the dashboard can show "n8n alive".

### N8N-S02 (cost ceiling alert)

Polls `usage_logs` directly via Supabase, not via our routes. Calls
`/api/webhooks/n8n` with `event_type: "cost_alert"` when threshold breached.

### N8N-S03 (anomaly router)

Receives anomalies from any flow's error branch; calls
`/api/webhooks/n8n` with `event_type: "anomaly"` and routes to the right
Copilot via the response.

---

## 5. Where the prompts live (SEC-06)

Per Doc §11.3 + the SEC-06 audit row at M3:

- **System prompts** (`CEO_SYSTEM_PROMPT`, `COO_SYSTEM_PROMPT`,
  `CCO_SYSTEM_PROMPT`, `DEEPSEEK_SYSTEM_PROMPT`) live ONLY in **our Vercel env**.
  They are loaded by `packages/ai/src/prompts.ts` — the only module allowed to
  read these env vars (CLAUDE.md import rule).
- **n8n** never sees the system prompts. n8n only sends the per-call user
  payload. This is a deliberate isolation: if n8n is compromised, the
  prompts (OGz IP) are not.
- For local dev, `packages/ai/src/prompts.ts` falls back to reading
  `prompts/<file>.md` from disk.
- For staging/prod, run `pnpm prompts:pack` to emit ready-to-paste env strings.

---

## 6. Observability

Every agent call writes:

- One row to `usage_logs` per attempt (success or failure)
  - `flow_id` (matches the n8n flow ID)
  - `node_name` ('ceo', 'coo', 'cco', 'deepseek', 'n8n_callback')
  - `cost_usd` (computed per provider's pricing — see `packages/ai/src/providers/*.ts`)
  - `duration_ms`
  - `payload.attempt`, `payload.tokens_in`, `payload.tokens_out`, `payload.failed`

On 2-retry exhaustion, one row to `anomaly_records`:
- `anomaly_type: "<node>_call_failed"` (e.g. `cco_call_failed`)
- `severity: "error"`
- `details: { flow_id, attempts, error: { name, message, stack } }`

Query examples:

```sql
-- Last hour of CEO costs
select sum(cost_usd) from usage_logs
where node_name = 'ceo' and created_at >= now() - interval '1 hour';

-- Anomalies for a specific brand today
select * from anomaly_records
where brand_id = $1 and created_at >= current_date
order by created_at desc;

-- Average duration per node across the last batch
select node_name, avg(duration_ms)::int as avg_ms, count(*)
from usage_logs where flow_id = 'N8N-A01' and (payload->>'failed') is null
group by node_name;
```

---

## 7. Smoke testing

```bash
# 1. Start the web app
pnpm --filter web dev

# 2. In another shell — exercise the auth layer (no AI cost)
pnpm ai:http-smoke -- --only=auth

# 3. Once Anthropic / DeepSeek keys are filled in .env.local — full chain
pnpm ai:http-smoke

# 4. Direct library smoke (bypasses HTTP, useful for prompt tuning)
pnpm ai:smoke
```

Expected output for `--only=auth`:

```
✓ rejects request with no signature
✓ rejects request with bad signature
✓ rejects timestamp older than 5 minutes
✓ rejects body that fails Zod validation
✓ blocks duplicate request_id (replay)
✓ idempotency replay returns cached body
6 / 6 passed
```

---

## 8. Phase 3 migration path

Doc §11.2 says: *"When brand count > 2000, extract AI chain into dedicated
Node.js service."* Because our routes are thin wrappers over `@repo/ai`, that
migration is a lift-and-shift:

1. Spin up a standalone `services/generation-worker/` (already stubbed).
2. Move `apps/web/src/app/api/agents/*` route handlers into the new service
   (verbatim — they only depend on `@repo/ai` + `@repo/db`).
3. Keep the same HMAC scheme; n8n flips its base URL from
   `https://web.openclaw.dev` to `https://api.openclaw.dev`.
4. Zero changes to the Zod contracts — n8n sends identical bodies.

The OGz Studios API surface is intentionally stable.
