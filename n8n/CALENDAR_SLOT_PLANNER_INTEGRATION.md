# N8N integration — Deterministic Calendar Slot Planner

Wires the new deterministic planner `POST /api/agents/calendar/plan-slots` into **N8N-A01**
(batch), **N8N-A02** (on-demand), and **N8N-B03** (revision), and **removes chain selection
from the CEO**.

## What changed (and why it's low-risk)
- **CEO no longer picks a chain.** `/api/agents/ceo/classify` stopped returning `decision.posts`,
  `format_tier`, and a `selected_chain` for the batch. (Its old chain pre-filter read columns that
  don't exist — `eligibility_filters`/`models_used` — so it was already returning `null` chains.)
- **A new deterministic step decides, per slot:** `content_type` (from the brand's content mix),
  `format` (image/video, **max 2 video** on the occasion-greeting + hero slots), and `chain_id` +
  `chain_family` (deterministic §9.5 scoring — no LLM).
- CEO still runs first (Hard Rule #1) and still does routing / confidence gate / human gate / memory.

Backend contract:
- Request: `{ flow_id, brand_id, payload: { post_count, schedule_dates[], occasion_flags[] } }`
- Response: `{ ok, request_id, result: { brand_id, occasion, slots: [ { slot_index, posting_date, content_type, format, chain_id, chain_family, rationale } ] } }`
- Auth: same HMAC pattern as `Sign: DeepSeek Generate` (shared secret + the 3 `x-n8n-*` headers).

---

## Part A — N8N-A01 (batch)

### A.1 — Insert the Plan Slots nodes (paste-ready)

Paste after `HTTP: CEO Route & Classify1`, **before** `Sign: COO CaptionContext`. Copy → click
canvas → Ctrl/Cmd+V:

```json
{
  "nodes": [
    {
      "parameters": {
        "jsCode": "// Sign the Calendar Slot Planner payload (mirrors Sign: DeepSeek Generate).\nconst crypto = require('crypto');\nconst brandData = $('Prepare Brand Data1').first().json;\nconst secret = 'c56cb3e88c57ea77929fdbec379fb6ff1ab72fef61cee9084e9cb263892d8887';\nconst requestId = crypto.randomUUID();\nconst timestamp = new Date().toISOString();\n\nconst occasions = (brandData.occasions && brandData.occasions.length > 0 && brandData.occasions[0] !== 'none')\n  ? brandData.occasions : [];\n\nconst bodyObj = {\n  flow_id: 'N8N-A01',\n  brand_id: brandData.brand_id,\n  payload: {\n    post_count: brandData.total_posts || 20,\n    schedule_dates: brandData.schedule_dates || [],\n    occasion_flags: occasions\n  }\n};\n\nconst body = JSON.stringify(bodyObj);\nconst signature = crypto.createHmac('sha256', secret).update(body).digest('hex');\n\nreturn [{ json: {\n  url: 'https://unwieldable-mavis-unbacked.ngrok-free.dev/api/agents/calendar/plan-slots',\n  body,\n  headers: {\n    'content-type': 'application/json',\n    'x-n8n-signature': signature,\n    'x-n8n-request-id': requestId,\n    'x-n8n-timestamp': timestamp\n  }\n} }];"
      },
      "name": "Sign: Plan Slots",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [0, 0]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json.url }}",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "content-type", "value": "={{ $json.headers['content-type'] }}" },
            { "name": "x-n8n-signature", "value": "={{ $json.headers['x-n8n-signature'] }}" },
            { "name": "x-n8n-request-id", "value": "={{ $json.headers['x-n8n-request-id'] }}" },
            { "name": "x-n8n-timestamp", "value": "={{ $json.headers['x-n8n-timestamp'] }}" }
          ]
        },
        "sendBody": true,
        "contentType": "raw",
        "rawContentType": "application/json",
        "body": "={{ $json.body }}",
        "options": { "timeout": 15000 }
      },
      "name": "HTTP: Plan Slots",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [220, 0],
      "retryOnFail": true,
      "maxTries": 2,
      "waitBetweenTries": 2000
    }
  ],
  "connections": {
    "Sign: Plan Slots": { "main": [[{ "node": "HTTP: Plan Slots", "type": "main", "index": 0 }]] }
  }
}
```
Rewire: `HTTP: CEO Route & Classify1` → `Sign: Plan Slots`; `HTTP: Plan Slots` → `Sign: COO CaptionContext`
(whatever node CEO classify previously fed). The slot plan is now available as
`$('HTTP: Plan Slots').first().json.result`.

### A.2 — Inject `content_type_plan` into `Sign: DeepSeek Generate`
In that node's `bodyObj.payload`, add one line so DeepSeek writes each caption to its planned type:
```js
const slotPlan = $('HTTP: Plan Slots').first().json.result;
// ... inside payload: { ... }
    content_type_plan: (slotPlan?.slots || []).map(s => s.content_type),
```

### A.3 — Rewrite `Merge Posts Data` to read the slot plan
Replace the CEO-posts source with the slot plan. Change the top of the node:
```js
// OLD:
// const ceoClassifyResult = $('HTTP: CEO Route & Classify1').first().json.result || {};
// const postsMeta = ceoClassifyResult.decision?.posts || [];
// NEW:
const slotPlan = $('HTTP: Plan Slots').first().json.result || {};
const planSlots = slotPlan.slots || [];
```
Then inside the `.map((caption, index) => …)`, source per-slot fields from the plan (authoritative):
```js
const slot = planSlots[index] || {};
const format_tier   = slot.format       || 'image';
const selected_chain = slot.chain_id    || null;
const chain_id       = slot.chain_id    || null;     // for the video branch (fixes the old chain_id bug)
const chain_family   = slot.chain_family || '';      // real family for the Visual Prompt Composer
// content_type is now authoritative from the plan, not DeepSeek:
const content_type   = slot.content_type || caption.content_type || 'emotional';
```
Use `content_type` (the plan value) in `base.content_type`, and add `chain_id` + `chain_family` to
`base`. Keep `product_descriptor`, `occasion_visual_motif`, `brand_color_palette` as they are.

### A.4 — Add `chain_id` to `Supabase: Insert Calendar Posts`
In the JSON body add `chain_id: $json.chain_id` (column added by migration `0079_calendar_posts_chain_id.sql`).

### A.5 — Carry over the two already-identified A01 fixes
- **Loop-backs:** connect `Supabase: Insert Calendar Posts` → `Loop Each Post` and the video
  `HTTP Request` → `Loop Each Post` (so the splitInBatches loop advances past batches with no HOLD).
- **Video chain_id:** the video `HTTP Request` body must send `"chain_id": "{{ $json.chain_id }}"`
  (now populated from the slot plan in A.3) — generate-video requires a non-empty chain_id.

---

## Part B — N8N-A02 (on-demand) & N8N-B03 (revision)
Both produce a single post. Add a single-slot Plan Slots call and use its `chain_id`:
1. Paste the same `Sign: Plan Slots` + `HTTP: Plan Slots` nodes; change `flow_id` to `'N8N-A02'`
   (or `'N8N-B03'`) and set `payload.post_count: 1`, `schedule_dates: []`, and
   `occasion_flags` from the trigger/brand.
2. In `Prepare V01 call` (A02) / `Prepare Visual for Revision1` (B03), replace the dead
   `chainId = null;` line with:
   ```js
   const sp = $('HTTP: Plan Slots').first().json.result;
   const chainId = (sp && sp.slots && sp.slots[0] && sp.slots[0].chain_id) || null;
   ```

---

## Enable / notes
- Apply migration `0079_calendar_posts_chain_id.sql`.
- The planner is deterministic and always on (no feature flag). Selection today = eligibility filter
  + occasion boost + cost tiebreak (style/approval scoring stubbed until per-chain performance data
  exists — see `selectChainForSlot` TODOs).
- Staging/prod: swap the hardcoded test secret + ngrok URL for `$vars.N8N_WEBHOOK_SECRET` /
  `$vars.BACKEND_URL`, matching the other agent calls.
- The Visual Prompt Composer (`Sign: Visual Prompt Compose`) now receives the **real** `chain_family`
  from `Merge Posts Data` — you can drop its hardcoded `CHAIN_FAMILY_MAP` guess and read
  `post.chain_family` directly.
