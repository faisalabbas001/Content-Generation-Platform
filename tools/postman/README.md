# OGz Studios — Postman Collection

Complete Postman collection covering **every API route** in the OGz Studios backend, with **74 pre-built requests** organized into 11 folders. Auto-signs every request with HMAC-SHA256 — you never compute headers manually.

---

## Files

| File | What it is |
|---|---|
| `openclaw.postman_collection.json` | The collection — 74 requests in 11 folders, plus a collection-level pre-request script that signs every request automatically. |
| `openclaw.postman_environment.json` | Environment template — copy of the variables you need to fill before sending. |

---

## 1. Import into Postman (90 seconds)

1. Open Postman → **File → Import** (or just drag both files in).
2. Drop both `openclaw.postman_collection.json` and `openclaw.postman_environment.json` into the import dialog → **Import**.
3. Top-right environment selector → choose **OGz Studios — Local**.

---

## 2. Fill the environment variables

Click the eye icon next to the environment selector → **Edit**. Set:

| Variable | Where to get it | Required for |
|---|---|---|
| `base_url` | Already set to `http://localhost:3000` | All requests |
| `webhook_secret` | Copy `N8N_WEBHOOK_SECRET` from `.env.local` | All `/api/agents/*`, `/api/memory/*`, `/api/webhooks/n8n` |
| `brand_id` | Already set to seed F&B brand UUID. Override if you want to test a different brand. | Most agent + memory requests |
| `admin_email` | Your admin user's email (the one in `ADMIN_ALLOWLIST_EMAILS`) | `10 — Admin Auth` folder only |
| `admin_password` | The admin password you provisioned via `pnpm db:create-admin` | `10 — Admin Auth` folder only |

⚠️ **`webhook_secret` is the only one truly required.** Without it, every signed request will return `401 bad_signature`.

---

## 3. Start the dev server

```bash
pnpm --filter web dev
```

Wait for `▲ Next.js 16.x` then `Ready in <ms>`. Server runs on `http://localhost:3000`.

---

## 4. Click Send on any request

The collection-level pre-request script does all of this automatically:

1. Generates a fresh `x-n8n-request-id` (UUID v4) per call
2. Generates a fresh `x-n8n-timestamp` (ISO-8601, current time)
3. Computes `x-n8n-signature` = HMAC-SHA256(raw body, webhook_secret)
4. Resolves `{{variables}}` inside the body **before** signing (so the signature matches what's actually sent)
5. Adds `content-type: application/json`
6. Cleans up any one-off overrides (used by negative tests)

Routes that don't take HMAC (`/api/admin/auth/*`, `/api/copilot/*`, stub `/api/webhooks/{stripe,correction}`) are auto-detected and skip signing.

Every request also has a **Tests script** that asserts the response shape — you'll see green/red checkmarks in the Test Results tab.

---

## 5. Folder map

| Folder | Requests | Purpose |
|---|---|---|
| **00 — Health** | 1 | Sanity check (GET / no auth) |
| **01 — Negative tests** | 6 | Should-fail tests: no signature, bad signature, drift, invalid JSON, schema fail, replay |
| **02 — CEO** | 20 | All 7 `request_type` values + 4 confidence modes + 4 cost-status levels + occasion + 6 confidence-gate scenarios |
| **03 — COO** | 15 | build-branddna (5), compile-caption-context (5), score-confidence (5) — all with realistic Arabic data |
| **04 — CCO** | 6 | clean / translation_smell / wrong dialect / brave route / HARD_BLOCK / batch of 5 |
| **05 — DeepSeek** | 5 | 8 / 20 / 1 posts + Ramadan context + watermarked |
| **06 — Memory Controller** | 4 | drain default / small batch / monthly sweep / end-of-A01 |
| **07 — n8n status callbacks** | 7 | onboarding_complete / brand_complete / batch_complete / anomaly / cost_alert / health_pulse / maintenance_complete |
| **08 — Stub routes** | 2 | Stripe + Correction (501 placeholders — verify they correctly stub) |
| **09 — Admin Copilot** | 4 | management / tech / production / unknown role |
| **10 — Admin Auth** | 4 | login success + bad creds + missing fields + logout |

**Total: 74 requests.**

---

## 6. Recommended test sequence (first time)

Run in this order to verify everything end-to-end:

1. **00 — Health → GET /** — confirms dev server is up
2. **01 — Negative tests** (run all 6) — confirms HMAC + replay + schema validation work
3. **02 — CEO → classify · 1. calendar_scheduled** — your first signed call should return 200 with a `RoutingDecision`
4. **02 — CEO → classify · 10. Blocked mode** — verifies confidence_mode logic
5. **03 — COO → build-branddna · 1. full extraction** — the onboarding pipeline
6. **04 — CCO → qc · 1. clean caption** — first OpenAI call (needs OPENAI_API_KEY with credit)
7. **05 — DeepSeek → generate · 3. 1 post** — cheapest DeepSeek call (~$0.001)
8. **06 — Memory Controller → process · 1. drain default** — drains everything CEO enqueued
9. **07 — n8n status callbacks → callback · 1. onboarding_complete** — exercises the audit log

If steps 1-9 all return 200, **your APIs are wired correctly.**

---

## 7. Run the whole collection at once

Postman → click the collection → **Run** (top-right) → **Run OGz Studios — Full API Collection**.

You'll get a pass/fail report for every test in every request. With all keys set, expect ~70 of 74 to pass (the 4 admin auth ones need a real provisioned admin password; the 2 stubs intentionally return 501).

---

## 8. Common errors

| Error | Cause | Fix |
|---|---|---|
| `401 bad_signature` | `webhook_secret` mismatch | Re-paste from `.env.local` |
| `401 missing_headers` | Pre-request script disabled or broken | Click collection → Pre-request Script tab → confirm code is present |
| `502 agent_call_failed` | AI provider key missing/broken/out of credit | Check `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` in `.env.local` |
| `409 replay_detected` | You hit Send twice on the same request | Each Send generates a new request_id — except in negative tests #5 and #6 which use overrides |
| `400 invalid_input` | Body shape wrong | Check the matching example in `docs/api/agents-and-memory.md` |
| Timeout in CCO calls | OpenAI quota exceeded | Top up at platform.openai.com or set `OPENAI_CCO_MODEL=gpt-4o` |

---

## 9. How to add your own request

1. Right-click the matching folder → **Add Request**.
2. Set **Method = POST**, paste the URL with `{{base_url}}` prefix.
3. Body → **raw → JSON** → paste your payload (use `{{brand_id}}` for brand variable).
4. Hit **Send** — the pre-request script signs it automatically.

To use **idempotency-key** on a specific request, add a **Pre-request Script** at the request level:
```js
pm.variables.set('idempotencyKey', 'my-unique-key-' + Date.now())
```

To skip signing (e.g. for cookie-based admin routes), add a header:
```
x-skip-sign: true
```

To force a specific timestamp (drift testing):
```js
pm.variables.set('overrideTimestamp', new Date(Date.now() - 6*60*1000).toISOString())
```

---

## 10. Where this lives

- Collection JSON: [`tools/postman/openclaw.postman_collection.json`](./openclaw.postman_collection.json)
- Environment JSON: [`tools/postman/openclaw.postman_environment.json`](./openclaw.postman_environment.json)
- Endpoint reference: [`docs/api/agents-and-memory.md`](../../docs/api/agents-and-memory.md)
- Auth recipe + Phase 3 migration: [`docs/n8n-integration.md`](../../docs/n8n-integration.md)
- Database guide: [`docs/db/database-guide.md`](../../docs/db/database-guide.md)
