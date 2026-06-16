# N8N integration — Visual Prompt Composer

Wires the new backend agent `POST /api/agents/visual-prompt/compose` into **N8N-A01** (batch)
and **N8N-A02** (on-demand) so each post's `visual_brief_en` is a rich, DeepSeek-composed,
English-only fal.ai prompt instead of the old `"<Brand> product Saudi Arabia"` fallback.

These are **manual edits** — do not hand-edit the large flow exports. Open each flow in the n8n
UI, paste the nodes below, and rewire as described. Everything is **fallback-safe**: if the call
fails, times out, or the backend kill-switch is off, the post keeps its existing `visual_brief_en`.

Backend contract:
- Request: `{ flow_id, brand_id, payload: { brand_name_ar, brand_name_en, sector, primary_color_hex?, dialect?, content_type, objective, occasion?, product_descriptor, chain_family, platform, cultural_constraints? } }`
- Response: `{ ok: true, request_id, result: { visual_brief_en } }`
- Kill-switch: when `VISUAL_PROMPT_COMPOSER_ENABLED !== 'true'`, `result.visual_brief_en === ''`.
- Auth: identical HMAC pattern to `Sign: DeepSeek Generate` (shared secret + `x-n8n-signature` / `x-n8n-request-id` / `x-n8n-timestamp`).

---

## Part A — N8N-A01 (batch)

### A.1 — Pre-populate composer inputs in `Merge Posts Data`

`Merge Posts Data` already computes most fields. Add the few the composer needs. Edit the
`const base = { … }` object (and the helpers just above it):

```js
// ── add above `const base = {`: derive composer inputs ───────────────────────
// chain_family from the selected chain id (best-effort, non-critical context).
const CHAIN_FAMILY_MAP = { U01: 'TF01', F01: 'TF04' }; // extend as chains are confirmed
const chain_family =
  (selected_chain && (CHAIN_FAMILY_MAP[selected_chain]
    || String(selected_chain).split(/[_-]/)[0].toUpperCase())) || '';

// product_descriptor: CEO chain context → brand differentiator → brand name.
const product_descriptor_final =
  product_descriptor || brandData.brand_differentiator || brandData.brand_name_en || 'product';

// cultural_constraints: sector default (F&B is the strictest common case).
const cultural_constraints =
  brandData.sector === 'F&B' ? 'no faces, avoid left hand' : 'modest, culturally appropriate, no faces';

const occasion = (brandData.occasions && brandData.occasions[0] && brandData.occasions[0] !== 'none')
  ? brandData.occasions[0] : '';
```

Then add these keys to the `base` object so the composer Sign node can read them off the post:

```js
  // ── composer inputs (read by Sign: Visual Prompt Compose) ──
  brand_name_en: brandData.brand_name_en || '',
  sector: brandData.sector || '',
  primary_color_hex: brandData.primary_color_hex || '',
  objective: (caption.content_type === 'offer') ? 'conversion' : 'awareness',
  occasion,
  chain_family,
  cultural_constraints,
  product_descriptor: product_descriptor_final, // replaces the old `product_descriptor` line
```

> `content_type`, `brand_name_ar`, `dialect`, `position`, `route` are already on `base`/`visualFields`.

### A.2 — Insert the composer nodes (paste-ready)

In the n8n canvas, paste the following (copy the JSON, then ⌘V / Ctrl+V on the canvas).
It adds three nodes: a signer, the HTTP call (**Continue On Fail**), and a coalescing setter.

```json
{
  "nodes": [
    {
      "parameters": {
        "jsCode": "// Sign the Visual Prompt Composer payload (mirrors Sign: DeepSeek Generate).\nconst crypto = require('crypto');\nconst post = $json;\nconst secret = 'c56cb3e88c57ea77929fdbec379fb6ff1ab72fef61cee9084e9cb263892d8887';\nconst requestId = crypto.randomUUID();\nconst timestamp = new Date().toISOString();\n\nconst bodyObj = {\n  flow_id: 'N8N-A01',\n  brand_id: post.brand_id,\n  payload: {\n    brand_name_ar: post.brand_name_ar || '',\n    brand_name_en: post.brand_name_en || '',\n    sector: post.sector || 'Other',\n    primary_color_hex: post.primary_color_hex || undefined,\n    dialect: post.dialect || undefined,\n    content_type: post.content_type || 'product',\n    objective: post.objective || 'awareness',\n    occasion: post.occasion || undefined,\n    product_descriptor: post.product_descriptor || post.brand_name_en || 'product',\n    chain_family: post.chain_family || 'TF01',\n    platform: post.channel || 'Instagram',\n    cultural_constraints: post.cultural_constraints || undefined\n  }\n};\n\nconst body = JSON.stringify(bodyObj);\nconst signature = crypto.createHmac('sha256', secret).update(body).digest('hex');\n\nreturn [{ json: {\n  __post: post,\n  url: 'https://unwieldable-mavis-unbacked.ngrok-free.dev/api/agents/visual-prompt/compose',\n  body,\n  headers: {\n    'content-type': 'application/json',\n    'x-n8n-signature': signature,\n    'x-n8n-request-id': requestId,\n    'x-n8n-timestamp': timestamp\n  }\n} }];"
      },
      "name": "Sign: Visual Prompt Compose",
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
        "options": { "timeout": 30000 }
      },
      "name": "HTTP: Visual Prompt Compose",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [220, 0],
      "onError": "continueRegularOutput",
      "retryOnFail": true,
      "maxTries": 2,
      "waitBetweenTries": 2000
    },
    {
      "parameters": {
        "jsCode": "// Coalesce: use the composed brief only when present & non-empty.\n// Guards kill-switch passthrough ('') and Continue-On-Fail error items.\nconst signed = $('Sign: Visual Prompt Compose').item.json;\nconst post = signed.__post || {};\nconst composed = $json && $json.result && typeof $json.result.visual_brief_en === 'string'\n  ? $json.result.visual_brief_en.trim()\n  : '';\nconst visual_brief_en = composed.length > 0 ? composed : post.visual_brief_en;\nreturn [{ json: { ...post, visual_brief_en, prompt_en: visual_brief_en } }];"
      },
      "name": "Apply Visual Brief",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [440, 0]
    }
  ],
  "connections": {
    "Sign: Visual Prompt Compose": { "main": [[{ "node": "HTTP: Visual Prompt Compose", "type": "main", "index": 0 }]] },
    "HTTP: Visual Prompt Compose": { "main": [[{ "node": "Apply Visual Brief", "type": "main", "index": 0 }]] }
  }
}
```

### A.3 — Rewire (only the non-HOLD path is composed)

`IF: Route Clean or Watermark?` output **0** is the generate path (CLEAN + WATERMARK); output **1**
goes to QA queue (HOLD). Insert the composer on output 0 **before** `IF: Video or Image?`:

```
IF: Route Clean or Watermark?  [out 0]
   ─(was)→ IF: Video or Image?
   ─(now)→ Sign: Visual Prompt Compose → HTTP: Visual Prompt Compose → Apply Visual Brief → IF: Video or Image?
```

Steps in the UI:
1. Delete the connection `IF: Route Clean or Watermark?` (out 0) → `IF: Video or Image?`.
2. Connect `IF: Route Clean or Watermark?` (out 0) → `Sign: Visual Prompt Compose`.
3. Connect `Apply Visual Brief` → `IF: Video or Image?`.

Because the composer sits inside the per-post `Loop Each Post`, each post is composed individually.
HOLD posts (out 1) are never sent to the agent. `Apply Visual Brief` updates **both**
`visual_brief_en` and `prompt_en` (the field `IF: Video or Image?` / N8N-V01 consume downstream).

---

## Part B — N8N-A02 (on-demand single post)

A02 routes `Switch: hold vs generate` [out 1 = generate] → `Prepare V01 call` → `Execute N8N-V01`.
Insert the composer **before** `Prepare V01 call` so the composed brief is available when that node
builds the V01 payload.

### B.1 — Pre-populate inputs
`Prepare V01 call` (and its upstream `Merge context`) already hold brand + caption data. Ensure the
item reaching the composer carries: `brand_id`, `brand_name_ar`, `brand_name_en`, `sector`,
`primary_color_hex`, `dialect`, `content_type`, `objective`, `occasion`, `product_descriptor`,
`chain_family`, `channel`/`platform`, `cultural_constraints`, and the existing
`__caption.visual_brief_en`. Add the same `CHAIN_FAMILY_MAP` / `cultural_constraints` derivation as
A.1 wherever those fields are assembled.

### B.2 — Paste the same three nodes
Paste the JSON from **A.2**, then change the signer's `flow_id` from `'N8N-A01'` to `'N8N-A02'`.
The `Apply Visual Brief` node already preserves the full post via `__post`.

### B.3 — Rewire
```
Switch: hold vs generate [out 1]
   ─(was)→ Prepare V01 call
   ─(now)→ Sign: Visual Prompt Compose → HTTP: Visual Prompt Compose → Apply Visual Brief → Prepare V01 call
```
In `Prepare V01 call`, make the brief prefer the composed value — change the priority line so the
incoming `$json.visual_brief_en` (set by `Apply Visual Brief`) wins:
```js
const visualBriefEn = ($json.visual_brief_en && $json.visual_brief_en.trim())
  || (d.__caption && d.__caption.visual_brief_en) || null;
```

---

## Notes
- **Secret / URL:** the snippets reuse the existing testing-mode secret and ngrok URL from
  `Sign: DeepSeek Generate`. For staging/prod, swap both to your `$vars.BACKEND_URL` +
  `$vars.N8N_WEBHOOK_SECRET` exactly as the other agent calls are migrated.
- **Enabling:** set `VISUAL_PROMPT_COMPOSER_ENABLED=true` in the backend (Vercel/local) and provide
  `VISUAL_PROMPT_SYSTEM_PROMPT` (or rely on `prompts/OGzStudios_VisualPrompt_Prompt_v1.md` in dev).
  Until then the route returns `''` and n8n transparently keeps the old brief.
- **Concurrency:** the composer runs inside the existing post loop (A01) / single item (A02); no extra
  batching is required. To parallelize A01 further, raise `Loop Each Post` batch size — the agent route
  is idempotent per `x-n8n-request-id`.
