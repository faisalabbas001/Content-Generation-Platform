<!-- 
previous A03


{
  "name": "N8N-A03 — Onboarding Pipeline (rev3 — three-axis + DB-credential-free)",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "openclaw-onboarding",
        "responseMode": "responseNode",
        "options": {}
      },
      "id": "trigger-webhook",
      "name": "Webhook · /openclaw-onboarding",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [200, 400]
    },
    {
      "parameters": {
        "jsCode": "// Verify HMAC + parse. Hard Rule #5 — n8n is just routing; we trust the\n// inbound signature from /lib/n8n-outbound.ts. HARDCODED secret + base URL\n// for paste-and-run import.\nconst WEBHOOK_SECRET = 'c56cb3e88c57ea77929fdbec379fb6ff1ab72fef61cee9084e9cb263892d8887';\nconst APP_BASE_URL = 'https://vagrancy-pupil-spiritism.ngrok-free.dev';\nconst crypto = require('crypto');\nconst headers = $input.first().json.headers || {};\nconst given = headers['x-n8n-signature'];\nconst ts    = headers['x-n8n-timestamp'];\nconst rid   = headers['x-n8n-request-id'];\nif (!given || !ts || !rid) throw new Error('Missing required HMAC headers');\nconst drift = Math.abs(Date.now() - Date.parse(ts));\nif (drift > 5 * 60 * 1000) throw new Error(`Timestamp drift ${drift}ms > 5 min`);\nconst rawBody = JSON.stringify($input.first().json.body);\nconst expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');\nif (expected !== given) throw new Error('HMAC signature mismatch');\nconst body = $input.first().json.body || {};\nif (!body.brand_id || !body.slug) throw new Error('brand_id and slug are required');\nreturn { json: {\n  brand_id:         body.brand_id,\n  slug:             body.slug,\n  instagram_handle: body.instagram_handle || null,\n  website_url:      body.website_url || null,\n  place_search:     body.place_search || { name: '', city: '' },\n  form_payload:     body.form_payload || {},\n  request_id:       rid,\n  _secret:          WEBHOOK_SECRET,\n  _base:            APP_BASE_URL,\n}};"
      },
      "id": "verify-hmac",
      "name": "Verify HMAC + parse",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [380, 400]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={ \"ok\": true, \"brand_id\": \"{{ $json.brand_id }}\", \"queued\": true }"
      },
      "id": "respond-202",
      "name": "Respond 202 · queued",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1,
      "position": [560, 400]
    },

    {
      "parameters": {
        "jsCode": "// GAP 5 fix — emit stage='form_submitted' BEFORE work, not after.\n// Live UI shows pipeline transitions accurately.\nconst crypto = require('crypto');\nconst d = $('Verify HMAC + parse').first().json;\nconst body = JSON.stringify({ brand_id: d.brand_id, stage: 'form_submitted' });\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', d._secret).update(body).digest('hex');\nreturn { json: { ...d, _stage_url: d._base + '/api/processing/stage', _stage_body: body, _stage_headers: {\n  'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts\n}}};"
      },
      "id": "stage-form-submitted-sign",
      "name": "Sign · stage form_submitted",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [740, 400]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._stage_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._stage_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._stage_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._stage_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._stage_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._stage_body }}",
        "options": { "timeout":15000,"neverError":true,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "stage-form-submitted-http",
      "name": "POST · stage form_submitted",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [920, 400]
    },

    {
      "parameters": {
        "jsCode": "// Build the body for the CEO classify call. The signing node above\n// reads from $json.body, so we set it here.\n// GAP fix: surface the per-field present/absent map from form_payload.review\n// so the CEO can correctly choose Cautious/Standard instead of defaulting\n// to Blocked for any new brand.\nconst d = $('Verify HMAC + parse').first().json;\nconst review = (d.form_payload && d.form_payload.review) || {};\nconst nonEmpty = (v) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0);\nconst critical = {\n  arabic_dialect:           nonEmpty(review.arabic_dialect),\n  brand_differentiator:     nonEmpty(review.brand_differentiator) && String(review.brand_differentiator).trim().length >= 20,\n  price_position:           nonEmpty(review.price_position),\n  primary_channel:          nonEmpty(review.primary_channel),\n  primary_kpi_type:         nonEmpty(review.primary_kpi_type),\n  religious_sensitivity:    nonEmpty(review.religious_sensitivity),\n  bilingual_ratio:          nonEmpty(review.bilingual_ratio),\n  formality_level:          nonEmpty(review.formality_level),\n  humor_tolerance:          nonEmpty(review.humor_tolerance),\n  tone_anti_attribute_ids:  Array.isArray(review.tone_anti_attribute_ids) && review.tone_anti_attribute_ids.length > 0,\n  ramadan_relevance:        nonEmpty(review.ramadan_relevance),\n  intent_state:             nonEmpty(review.intent_state),\n};\nconst providedCount = Object.values(critical).filter(Boolean).length;\nreturn { json: {\n  ...d,\n  body: {\n    flow_id: 'N8N-A03',\n    brand_id: d.brand_id,\n    payload: {\n      request_type: 'onboarding_new',\n      trigger_payload: {\n        slug: d.slug,\n        has_instagram: !!d.instagram_handle,\n        has_website: !!d.website_url,\n        intake_form_complete: providedCount >= 11,\n        critical_fields_provided_count: providedCount,\n        critical_fields_provided: critical,\n      },\n      occasion_flags: ['none'],\n      current_month_spend_usd: 0,\n      monthly_ceiling_usd: 50,\n    },\n  },\n}};"
      },
      "id": "build-ceo-body",
      "name": "Build CEO body",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1100, 400]
    },
    {
      "parameters": {
        "jsCode": "// Sign the CEO classify body.\nconst crypto = require('crypto');\nconst d = $json;\nconst body = JSON.stringify(d.body);\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', d._secret).update(body).digest('hex');\nreturn { json: { ...d, _ceo_url: d._base + '/api/agents/ceo/classify', _ceo_body: body, _ceo_headers: {\n  'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts\n}}};"
      },
      "id": "sign-ceo",
      "name": "Sign · CEO classify",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1280, 400]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._ceo_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._ceo_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._ceo_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._ceo_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._ceo_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._ceo_body }}",
        "options": { "timeout":90000,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "http-ceo-classify",
      "name": "POST · /api/agents/ceo/classify",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [1460, 400]
    },
    {
      "parameters": {
        "jsCode": "// Parse CEO result. confidence_mode === 'Blocked' short-circuits.\nconst ceoResp = $input.first().json;\nconst decision = ceoResp.result?.decision || ceoResp.decision || {};\nconst blocked = decision.confidence_mode === 'Blocked';\nreturn { json: {\n  blocked,\n  decision,\n  ...$('Verify HMAC + parse').first().json,\n}};"
      },
      "id": "ceo-result",
      "name": "Parse CEO result",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1640, 400]
    },

    {
      "parameters": {
        "jsCode": "// GAP 5 — emit stage=ceo_classified BEFORE the IF branch so the live UI\n// shows the step transition immediately.\nconst crypto = require('crypto');\nconst d = $json;\nconst body = JSON.stringify({ brand_id: d.brand_id, stage: 'ceo_classified', metadata: { confidence_mode: d.decision?.confidence_mode ?? null }});\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', d._secret).update(body).digest('hex');\nreturn { json: { ...d, _stage_url: d._base + '/api/processing/stage', _stage_body: body, _stage_headers: {\n  'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts\n}}};"
      },
      "id": "stage-ceo-classified-sign",
      "name": "Sign · stage ceo_classified",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1820, 400]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._stage_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._stage_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._stage_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._stage_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._stage_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._stage_body }}",
        "options": { "timeout":15000,"neverError":true,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "stage-ceo-classified-http",
      "name": "POST · stage ceo_classified",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [2000, 400]
    },

    {
      "parameters": {
        "conditions": {
          "options": { "caseSensitive": true, "typeValidation": "strict" },
          "conditions": [
            { "leftValue": "={{ $('Parse CEO result').first().json.blocked }}", "rightValue": true,
              "operator": { "type":"boolean","operation":"true" } }
          ]
        }
      },
      "id": "if-blocked",
      "name": "IF · Blocked?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [2180, 400]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseCode": 200,
        "responseBody": "={ \"ok\": true, \"blocked\": true, \"reason\": \"Confidence mode is Blocked — onboarding paused awaiting human review\" }"
      },
      "id": "respond-blocked",
      "name": "Respond · Blocked",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1,
      "position": [2360, 250]
    },

    {
      "parameters": {
        "jsCode": "// Sign /api/extraction/source-records — replaces the Supabase LOAD node\n// (Gap 4). n8n now needs ZERO DB credentials.\nconst crypto = require('crypto');\nconst d = $('Parse CEO result').first().json;\nconst body = JSON.stringify({ brand_id: d.brand_id });\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', d._secret).update(body).digest('hex');\nreturn { json: { ...d, _src_url: d._base + '/api/extraction/source-records', _src_body: body, _src_headers: {\n  'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts\n}}};"
      },
      "id": "sign-source-records",
      "name": "Sign · load source_records",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [2360, 500]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._src_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._src_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._src_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._src_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._src_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._src_body }}",
        "options": { "timeout":15000,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "http-load-source-records",
      "name": "POST · load source_records",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [2540, 500]
    },

    {
      "parameters": {
        "jsCode": "// Consolidate extractions — GAP 1 + GAP 3 fix.\n// • Reads the API response (which already returns the consolidated shape\n//   from migration 0028's `normalised` column with legacy fallbacks).\n// • Detects PRE-LAUNCH brands: 0 sources from any lane → flag so COO\n//   uses form-only Vulnerability-Method default and skips scrape inference.\nconst api = $input.first().json;\nconst extractions = api.extractions || { instagram: null, website: null, places: null };\nconst raw = api.raw || { instagram: null, website: null, places: null };\nconst sourcesCount = api.sources_count || 0;\nconst d = $('Parse CEO result').first().json;\nconst review = (d.form_payload && d.form_payload.review) || {};\nconst hasFormSignal = !!(review.brand_differentiator || review.arabic_dialect || review.intent_state);\n// Pre-launch = no scraped sources AND we have form signal to fall back on.\nconst isPreLaunch = sourcesCount === 0 && hasFormSignal;\nreturn { json: {\n  ...d,\n  ceo_decision: d.decision,\n  extractions,\n  raw_extractions: raw,\n  sources_count: sourcesCount,\n  is_pre_launch: isPreLaunch,\n  data_richness: sourcesCount === 0 ? 'form_only' : sourcesCount === 1 ? 'single_source' : sourcesCount === 2 ? 'partial' : 'rich',\n}};"
      },
      "id": "consolidate",
      "name": "Consolidate extractions",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [2720, 500]
    },

    {
      "parameters": {
        "jsCode": "// GAP 5 — stage scraping_complete BEFORE the snapshot write.\nconst crypto = require('crypto');\nconst d = $json;\nconst body = JSON.stringify({\n  brand_id: d.brand_id,\n  stage: 'scraping_complete',\n  metadata: {\n    sources_count: d.sources_count,\n    data_richness: d.data_richness,\n    is_pre_launch: d.is_pre_launch,\n    has_instagram: !!d.extractions.instagram,\n    has_website: !!d.extractions.website,\n    has_places: !!d.extractions.places,\n  },\n});\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', d._secret).update(body).digest('hex');\nreturn { json: { ...d, _stage_url: d._base + '/api/processing/stage', _stage_body: body, _stage_headers: {\n  'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts\n}}};"
      },
      "id": "stage-scraping-complete-sign",
      "name": "Sign · stage scraping_complete",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [2900, 500]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._stage_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._stage_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._stage_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._stage_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._stage_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._stage_body }}",
        "options": { "timeout":15000,"neverError":true,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "stage-scraping-complete-http",
      "name": "POST · stage scraping_complete",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [3080, 500]
    },

    {
      "parameters": {
        "jsCode": "// Build COO build-branddna body.\n// GAP 2 — explicitly request three-axis inference + method profile so\n// COO Pass 3 produces archetype_primary / lifecycle_stage / intent_state\n// AND a method composition (per Three-Axis Framework v2 §Composition Matrix).\n// GAP 3 — pre-launch brands tell COO to default to Vulnerability Method\n// and skip scrape-derived inference (form-only).\n// NOTE: $json here is the stage-emit API response (no _secret/_base/etc),\n// so we pull state from Verify HMAC + Consolidate extractions explicitly.\nconst d = $('Consolidate extractions').first().json;\nconst v = $('Verify HMAC + parse').first().json;\nconst review = (d.form_payload && d.form_payload.review) || {};\nreturn { json: {\n  ...d,\n  _secret: v._secret,\n  _base:   v._base,\n  body: {\n    flow_id: 'N8N-A03',\n    brand_id: d.brand_id,\n    payload: {\n      form_answers:                d.form_payload,\n      instagram_extraction:        d.extractions.instagram,\n      website_extraction:          d.extractions.website,\n      google_business_extraction:  d.extractions.places,\n      raw_instagram:               d.raw_extractions?.instagram ?? null,\n      request_axes: {\n        archetype_primary:    true,\n        archetype_secondary:  true,\n        lifecycle_stage:      true,\n        intent_state:         true,\n      },\n      method_profile_request: {\n        compose: true,\n        default_method: d.is_pre_launch ? 'Vulnerability' : null,\n        score_threshold: 80,\n      },\n      data_richness:    d.data_richness,\n      is_pre_launch:    d.is_pre_launch,\n      form_dialect:     review.arabic_dialect ?? null,\n      // GAP 9 — thread the Three-Axis Framework v2 form priors so COO\n      // can anchor axis_inference + method composition on user-stated\n      // values, not just scraped evidence. All optional/nullable.\n      form_priors: {\n        archetype_primary:        review.archetype_primary ?? null,\n        lifecycle_stage:          review.lifecycle_stage ?? null,\n        intent_state:             review.intent_state ?? null,\n        primary_kpi_type:         review.primary_kpi_type ?? null,\n        primary_channel:          review.primary_channel ?? null,\n        bilingual_ratio:          review.bilingual_ratio ?? null,\n        formality_level:          review.formality_level ?? null,\n        humor_tolerance:          review.humor_tolerance ?? null,\n        religious_sensitivity:    review.religious_sensitivity ?? null,\n        ramadan_relevance:        review.ramadan_relevance ?? null,\n        tone_anti_attribute_ids:  review.tone_anti_attribute_ids ?? null,\n        price_position:           review.price_position ?? null,\n        brand_differentiator:     review.brand_differentiator ?? null,\n      },\n    },\n  },\n}};"
      },
      "id": "build-coo-body",
      "name": "Build COO body",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [3260, 500]
    },
    {
      "parameters": {
        "jsCode": "const crypto = require('crypto');\nconst d = $json;\nconst body = JSON.stringify(d.body);\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', d._secret).update(body).digest('hex');\nreturn { json: { ...d, _coo_url: d._base + '/api/agents/coo/build-branddna', _coo_body: body, _coo_headers: {\n  'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts\n}}};"
      },
      "id": "sign-coo",
      "name": "Sign · COO build-branddna",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [3440, 500]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._coo_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._coo_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._coo_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._coo_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._coo_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._coo_body }}",
        "options": { "timeout":120000,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "http-coo",
      "name": "POST · /api/agents/coo/build-branddna",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [3620, 500]
    },

    {
      "parameters": {
        "jsCode": "// GAP 5 — stage coo_branddna_built BEFORE memory drain.\nconst crypto = require('crypto');\nconst d = $('Build COO body').first().json;\nconst cooResult = $input.first().json.result || $input.first().json;\nconst body = JSON.stringify({\n  brand_id: d.brand_id,\n  stage: 'coo_branddna_built',\n  metadata: {\n    completeness_score:  cooResult.completeness_score ?? null,\n    dialect_confirmed:   cooResult.dialect_confirmed ?? false,\n    field_nominations:   (cooResult.field_nominations || []).length,\n    method_profile:      cooResult.method_profile?.method_name ?? null,\n    archetype_primary:   cooResult.axis_inference?.archetype_primary ?? null,\n    lifecycle_stage:     cooResult.axis_inference?.lifecycle_stage ?? null,\n    intent_state:        cooResult.axis_inference?.intent_state ?? null,\n  },\n});\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', d._secret).update(body).digest('hex');\nreturn { json: { ...d, _coo_full_result: cooResult, _stage_url: d._base + '/api/processing/stage', _stage_body: body, _stage_headers: {\n  'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts\n}}};"
      },
      "id": "stage-coo-built-sign",
      "name": "Sign · stage coo_branddna_built",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [3800, 500]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._stage_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._stage_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._stage_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._stage_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._stage_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._stage_body }}",
        "options": { "timeout":15000,"neverError":true,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "stage-coo-built-http",
      "name": "POST · stage coo_branddna_built",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [3980, 500]
    },

    {
      "parameters": {
        "jsCode": "// GAP 3 — Doc §5.3 step 5: SECOND CEO call (confidence gate / refinement).\n// First CEO call (step 1) routed with no evidence. Now COO has produced\n// real field_nominations + axis_inference, so CEO can re-classify with\n// actual evidence_bundle_states and upgrade/downgrade confidence_mode.\nconst crypto = require('crypto');\nconst v = $('Verify HMAC + parse').first().json;\nconst coo = $('Sign · stage coo_branddna_built').first().json._coo_full_result || {};\n// Build evidence_bundle_states map: field_path → confidence_state.\nconst evidence = {};\nfor (const n of (coo.field_nominations || [])) {\n  if (n && n.field_path && n.confidence_state) {\n    evidence[n.field_path] = n.confidence_state;\n  }\n}\nconst body = JSON.stringify({\n  flow_id: 'N8N-A03',\n  brand_id: v.brand_id,\n  payload: {\n    request_type: 'onboarding_new',\n    trigger_payload: {\n      slug: v.slug,\n      pass: 'confidence_gate_post_coo',\n      coo_completeness:    coo.completeness_score ?? null,\n      coo_dialect_confirmed: !!coo.dialect_confirmed,\n      method_recommended:  coo.method_profile?.method_name ?? null,\n      archetype_primary:   coo.axis_inference?.archetype_primary ?? null,\n      lifecycle_stage:     coo.axis_inference?.lifecycle_stage ?? null,\n      intent_state:        coo.axis_inference?.intent_state ?? null,\n    },\n    evidence_bundle_states: evidence,\n    occasion_flags: ['none'],\n    current_month_spend_usd: 0,\n    monthly_ceiling_usd: 50,\n  },\n});\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', v._secret).update(body).digest('hex');\nreturn { json: {\n  brand_id: v.brand_id,\n  _secret: v._secret, _base: v._base,\n  _gate_url: v._base + '/api/agents/ceo/classify',\n  _gate_body: body,\n  _gate_headers: {\n    'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts,\n  },\n}};"
      },
      "id": "sign-ceo-gate",
      "name": "Sign · CEO confidence gate",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [4160, 380]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._gate_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._gate_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._gate_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._gate_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._gate_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._gate_body }}",
        "options": { "timeout":90000,"neverError":true,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "http-ceo-gate",
      "name": "POST · CEO confidence gate",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [4340, 380]
    },
    {
      "parameters": {
        "jsCode": "// GAP 10 — emit a visible stage transition between the second CEO call\n// and the Memory Controller drain, so the live tracker doesn't jump from\n// coo_branddna_built straight to memory_drained.\nconst crypto = require('crypto');\nconst v = $('Verify HMAC + parse').first().json;\nconst gateResp = $input.first().json || {};\nconst decision = gateResp?.result?.decision || gateResp?.decision || {};\nconst body = JSON.stringify({\n  brand_id: v.brand_id,\n  stage: 'ceo_confidence_refined',\n  metadata: {\n    confidence_mode:     decision.confidence_mode ?? null,\n    human_gate_required: !!decision.human_gate_required,\n    human_gate_reasons:  decision.human_gate_reasons ?? [],\n    pipeline_assigned:   decision.pipeline_assigned ?? null,\n    gate_ok:             !!(gateResp?.ok ?? false),\n  },\n});\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', v._secret).update(body).digest('hex');\nreturn { json: { brand_id: v.brand_id, _secret: v._secret, _base: v._base, _stage_url: v._base + '/api/processing/stage', _stage_body: body, _stage_headers: {\n  'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts\n}}};"
      },
      "id": "stage-ceo-refined-sign",
      "name": "Sign · stage ceo_confidence_refined",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [4160, 260]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._stage_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._stage_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._stage_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._stage_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._stage_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._stage_body }}",
        "options": { "timeout":15000,"neverError":true,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "stage-ceo-refined-http",
      "name": "POST · stage ceo_confidence_refined",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [4340, 260]
    },
    {
      "parameters": {
        "jsCode": "// $json here is the stage-emit API response — no _secret. Pull from Verify HMAC.\nconst crypto = require('crypto');\nconst v = $('Verify HMAC + parse').first().json;\nconst memBody = { flow_id: 'N8N-A03', batch_size: 100 };\nconst innerBody = JSON.stringify(memBody);\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', v._secret).update(innerBody).digest('hex');\nreturn { json: {\n  brand_id: v.brand_id,\n  _secret: v._secret, _base: v._base,\n  _mem_url: v._base + '/api/memory/process',\n  _mem_body: innerBody,\n  _mem_headers: {\n    'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts,\n  },\n}};"
      },
      "id": "sign-memory",
      "name": "Sign · Memory process",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [4160, 500]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._mem_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._mem_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._mem_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._mem_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._mem_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._mem_body }}",
        "options": { "timeout":90000,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "http-memory",
      "name": "POST · /api/memory/process",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [4340, 500]
    },

    {
      "parameters": {
        "jsCode": "// GAP 5 — stage memory_drained BEFORE qdrant + final snapshot.\nconst crypto = require('crypto');\nconst d = $('Sign · Memory process').first().json;\nconst memResult = $input.first().json.result || $input.first().json;\nconst body = JSON.stringify({ brand_id: d.brand_id, stage: 'memory_drained', metadata: { written: memResult.written ?? 0, rejected: memResult.rejected ?? 0 } });\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', d._secret).update(body).digest('hex');\nreturn { json: { ...d, _mem_full_result: memResult, _stage_url: d._base + '/api/processing/stage', _stage_body: body, _stage_headers: {\n  'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts\n}}};"
      },
      "id": "stage-memory-drained-sign",
      "name": "Sign · stage memory_drained",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [4520, 500]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._stage_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._stage_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._stage_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._stage_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._stage_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._stage_body }}",
        "options": { "timeout":15000,"neverError":true,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "stage-memory-drained-http",
      "name": "POST · stage memory_drained",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [4700, 500]
    },

    {
      "parameters": {
        "jsCode": "// Sign /api/vectors/setup body. Best-effort — Qdrant failure is non-fatal.\n// $json here is the stage-emit API response — pull state from Verify HMAC.\nconst crypto = require('crypto');\nconst v = $('Verify HMAC + parse').first().json;\nconst body = JSON.stringify({ brand_id: v.brand_id, flow_id: 'N8N-A03' });\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', v._secret).update(body).digest('hex');\nreturn { json: {\n  brand_id: v.brand_id,\n  _secret: v._secret, _base: v._base,\n  _q_url: v._base + '/api/vectors/setup',\n  _q_body: body,\n  _q_headers: {\n    'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts,\n  },\n}};"
      },
      "id": "sign-qdrant",
      "name": "Sign · qdrant setup",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [4880, 500]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._q_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._q_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._q_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._q_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._q_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._q_body }}",
        "options": { "timeout":10000,"neverError":true,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "http-qdrant",
      "name": "POST · /api/vectors/setup",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [5060, 500]
    },

    {
      "parameters": {
        "jsCode": "// Build the FULL final snapshot.\n// GAP 4 — emit via /api/processing/stage with mark_complete=true. Replaces 2\n// Supabase nodes. GAP 6 — lenient dialect_confirmed (COO explicit OR form\n// dialect + axis_inference present). GAP 3 — refined confidence_mode from\n// the SECOND CEO call (post-COO confidence gate). GAP 7 — surface\n// archetype_secondary so A01 sees the composition pair. GAP 8 — validate\n// method_name against the 6 framework methods (Three-Axis v2).\nconst crypto = require('crypto');\nconst d = $('Build COO body').first().json;\nconst coo = $('Sign · stage coo_branddna_built').first().json._coo_full_result || {};\nconst memory = $('Sign · stage memory_drained').first().json._mem_full_result || {};\nconst consolidated = $('Consolidate extractions').first().json;\nconst extractions = consolidated.extractions;\nconst review = (d.form_payload && d.form_payload.review) || {};\nconst dialectConfirmed = !!coo.dialect_confirmed || !!(review.arabic_dialect && coo.axis_inference?.lifecycle_stage);\n// GAP 8 — Three-Axis Framework v2: the only 6 valid method names.\nconst VALID_METHODS = ['Authenticity','Heritage','Metaphor','Paradox','Diagnostic','Vulnerability'];\nconst rawMethodName = coo.method_profile?.method_name ?? null;\nconst methodValid = !!rawMethodName && VALID_METHODS.includes(rawMethodName);\nif (rawMethodName && !methodValid) {\n  console.warn('[A03] method_name out of framework set:', rawMethodName);\n}\n// Pull refined confidence_mode from the post-COO confidence gate when present.\n// If the gate failed (neverError swallows it), fall back to the first CEO\n// classify result which is always available.\nlet refinedDecision = null;\ntry {\n  const gateResp = $('POST · CEO confidence gate').first().json;\n  refinedDecision = gateResp?.result?.decision || gateResp?.decision || null;\n} catch (_) { /* gate node never ran — keep first CEO decision */ }\nconst firstDecision = $('Parse CEO result').first().json.decision || {};\nconst confidenceMode = refinedDecision?.confidence_mode || firstDecision.confidence_mode || 'Cautious';\nconst snapshotData = {\n  stage: 'snapshot_ready',\n  completeness:            coo.completeness_score ?? 70,\n  dialect_confirmed:       dialectConfirmed,\n  field_nominations_total: (coo.field_nominations || []).length,\n  memory_written:          memory.written ?? 0,\n  memory_rejected:         memory.rejected ?? 0,\n  extractions,\n  axis_inference:          coo.axis_inference ?? null,\n  // GAP 7 — pair surfaces so A01 / downstream can do composition lookups.\n  archetype_primary:       coo.axis_inference?.archetype_primary ?? null,\n  archetype_secondary:     coo.axis_inference?.archetype_secondary ?? null,\n  lifecycle_stage:         coo.axis_inference?.lifecycle_stage ?? null,\n  intent_state:            coo.axis_inference?.intent_state ?? null,\n  method_profile:          coo.method_profile ?? null,\n  method_name:             methodValid ? rawMethodName : null,\n  method_valid:            methodValid,\n  coo_reasoning:           coo.reasoning ?? null,\n  // GAP 5 — pre-launch flag rides the snapshot so the A01 readiness IF\n  // can short-circuit (no scraped content → no calendar evidence).\n  is_pre_launch:           !!consolidated.is_pre_launch,\n  data_richness:           consolidated.data_richness ?? null,\n  // GAP 3 — refined CEO verdict (vs the initial pre-COO routing).\n  confidence_mode:         confidenceMode,\n  confidence_refined:      !!refinedDecision,\n  human_gate_required:     !!(refinedDecision || firstDecision).human_gate_required,\n  human_gate_reasons:      (refinedDecision || firstDecision).human_gate_reasons || [],\n};\nconst body = JSON.stringify({\n  brand_id: d.brand_id,\n  stage: 'snapshot_ready',\n  metadata: snapshotData,\n  mark_complete: true,\n});\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', d._secret).update(body).digest('hex');\nreturn { json: { ...d, _snapshot_data: snapshotData, _stage_url: d._base + '/api/processing/stage', _stage_body: body, _stage_headers: {\n  'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts\n}}};"
      },
      "id": "build-final-snapshot",
      "name": "Build + sign final snapshot",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [5240, 500]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._stage_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._stage_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._stage_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._stage_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._stage_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._stage_body }}",
        "options": { "timeout":10000,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "http-final-snapshot",
      "name": "POST · final snapshot + mark complete",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [5420, 500]
    },

    {
      "parameters": {
        "jsCode": "// Status callback to /api/webhooks/n8n.\nconst crypto = require('crypto');\nconst d = $('Build + sign final snapshot').first().json;\nconst snap = d._snapshot_data;\nconst innerBody = JSON.stringify({\n  event_type: 'onboarding_complete',\n  flow_id: 'N8N-A03',\n  brand_id: d.brand_id,\n  payload: {\n    completeness_score: snap.completeness,\n    dialect_confirmed: snap.dialect_confirmed,\n    memory_written: snap.memory_written,\n    method_profile: snap.method_profile?.method_name ?? null,\n    archetype_primary: snap.axis_inference?.archetype_primary ?? null,\n    lifecycle_stage: snap.axis_inference?.lifecycle_stage ?? null,\n    intent_state: snap.axis_inference?.intent_state ?? null,\n  },\n});\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', d._secret).update(innerBody).digest('hex');\nreturn { json: { ...d, _cb_url: d._base + '/api/webhooks/n8n', _cb_body: innerBody, _cb_headers: {\n  'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts\n}}};"
      },
      "id": "sign-callback",
      "name": "Sign · status callback",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [5600, 500]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._cb_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._cb_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._cb_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._cb_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._cb_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._cb_body }}",
        "options": { "timeout":10000,"neverError":true,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "http-callback",
      "name": "POST · /api/webhooks/n8n (status)",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [5780, 500]
    },

    {
      "parameters": {
        "conditions": {
          "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "strict" },
          "combinator": "and",
          "conditions": [
            { "id": "cond-completeness",
              "leftValue": "={{ $('Build + sign final snapshot').first().json._snapshot_data.completeness ?? 0 }}",
              "rightValue": 40,
              "operator": { "type": "number", "operation": "gte" } },
            { "id": "cond-dialect",
              "leftValue": "={{ $('Build + sign final snapshot').first().json._snapshot_data.dialect_confirmed ?? false }}",
              "rightValue": true,
              "operator": { "type": "boolean", "operation": "true", "singleValue": true } },
            { "id": "cond-not-blocked",
              "leftValue": "={{ $('Build + sign final snapshot').first().json._snapshot_data.confidence_mode ?? 'Cautious' }}",
              "rightValue": "Blocked",
              "operator": { "type": "string", "operation": "notEquals" } },
            { "id": "cond-not-pre-launch",
              "leftValue": "={{ $('Build + sign final snapshot').first().json._snapshot_data.is_pre_launch ?? false }}",
              "rightValue": true,
              "operator": { "type": "boolean", "operation": "false", "singleValue": true } }
          ]
        },
        "options": {}
      },
      "id": "a01-ready-if",
      "name": "IF · ready for A01?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [5960, 500]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://vagrancy-pupil-spiritism.ngrok-free.dev/webhook/openclaw-batch-calendar",
        "sendHeaders": true,
        "headerParameters": { "parameters": [{ "name":"content-type","value":"application/json" }] },
        "sendBody": true, "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ brand_id: $('Verify HMAC + parse').first().json.brand_id, source: 'N8N-A03', auto_triggered: true }) }}",
        "options": {
          "timeout": 15000,
          "neverError": true,
          "response": { "response": { "responseFormat": "json" } },
          "retry": { "retryOnFailure": true, "maxTries": 3, "waitBetweenTries": 2000 }
        }
      },
      "id": "a01-trigger",
      "name": "POST · trigger N8N-A01",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [6160, 420]
    },

    {
      "parameters": {
        "jsCode": "// GAP 2 — Doc §5.3 step 9. Emitted when completeness_score < 40 OR\n// dialect_unconfirmed. Builds 3 gap questions for the user from the COO's\n// `critical_fields_missing` array (or, if absent, derives from\n// field_nominations confidence_state). UI reads brand_snapshots.snapshot_data.\n// .gap_questions[] and asks the user to fill them in.\nconst crypto = require('crypto');\nconst v = $('Verify HMAC + parse').first().json;\nconst snap = $('Build + sign final snapshot').first().json._snapshot_data || {};\nconst coo = $('Sign · stage coo_branddna_built').first().json._coo_full_result || {};\n// Prefer COO's explicit critical_fields_missing; fall back to deriving from\n// field_nominations (any with confidence < inferred_medium).\nlet missing = Array.isArray(coo.critical_fields_missing) ? coo.critical_fields_missing.slice() : [];\nif (missing.length === 0) {\n  for (const n of (coo.field_nominations || [])) {\n    if (n && (n.confidence_state === 'inferred_low' || n.confidence_state === 'rejected' || !n.confidence_state)) {\n      missing.push(n.field_path);\n    }\n  }\n}\n// Field-name → human-friendly question. Doc-anchored vocab.\nconst QUESTIONS = {\n  arabic_dialect:           'Which Arabic dialect best matches your brand voice — Najdi, Hejazi, Gulf, MSA accessible, MSA formal, or Mixed?',\n  brand_differentiator:     'In one or two sentences, what makes this brand distinctive vs. competitors?',\n  primary_color_hex:        'What is your primary brand color (hex code)?',\n  archetype_primary:        'Which Jungian archetype best fits this brand — Hero, Sage, Lover, Outlaw, Caregiver, Magician, Explorer, Innocent, Jester, Everyman, Ruler, or Creator?',\n  lifecycle_stage:          'Where is this brand in its lifecycle — pre_launch, launch, growth, maturity, or recovery?',\n  intent_state:             'What is your primary intent this month — launch, grow, defend, harvest, or recover?',\n  primary_kpi_type:         'What is the primary KPI you optimise for — engagement, conversion, awareness, or trust?',\n  religious_sensitivity:    'How religiously sensitive should the brand voice be — Low, Medium, or High?',\n  bilingual_ratio:          'What Arabic-vs-English ratio fits — arabic_only, arabic_primary, balanced, or english_primary?',\n  formality_level:          'Pick the formality level — casual, semi_formal, or formal.',\n  humor_tolerance:          'Pick the humor tolerance — none, light, or moderate.',\n  tone_anti_attribute_ids:  'Which tones should this brand NEVER sound like? (pick from: aggressive, salesy, flashy, edgy, ironic, formal_corporate, casual_humor, western_casual)',\n  ramadan_relevance:        'How relevant is Ramadan to your campaigns — Critical, High, Medium, Low, or Not_relevant?',\n  primary_channel:          'Which platform is your primary channel — Instagram, Snapchat, TikTok, or Twitter?',\n};\n// Map raw field paths (which may include namespaces) to base names.\nconst seen = new Set();\nconst topThree = [];\nfor (const fp of missing) {\n  const base = String(fp).split('.').pop();\n  if (!base || seen.has(base)) continue;\n  seen.add(base);\n  if (QUESTIONS[base]) {\n    topThree.push({ field: base, question: QUESTIONS[base] });\n    if (topThree.length === 3) break;\n  }\n}\n// If COO didn't surface anything but the gate failed (e.g. dialect_unconfirmed\n// with no field_nominations populated), seed at least the dialect question\n// so the user has something to act on.\nif (topThree.length === 0 && !snap.dialect_confirmed) {\n  topThree.push({ field: 'arabic_dialect', question: QUESTIONS.arabic_dialect });\n}\n// Suppression: if the form is complete (no real gaps), use a self-resolving\n// stage emission instead of a user-facing gap. /api/processing/stage with\n// stage='gap_notification' + metadata.gap_questions=[] is treated as a benign\n// audit row by the UI (no banner shown). Better than failing the HTTP node.\nconst metadata = topThree.length === 0\n  ? { reason: 'suppressed_no_gaps', completeness: snap.completeness ?? 0, dialect_confirmed: !!snap.dialect_confirmed, gap_questions: [], human_gate_reasons: snap.human_gate_reasons || [], suppressed: true }\n  : {\n  reason: snap.completeness < 40 ? 'low_completeness' : 'dialect_unconfirmed',\n  completeness: snap.completeness ?? 0,\n  dialect_confirmed: !!snap.dialect_confirmed,\n  gap_questions: topThree,\n  human_gate_reasons: snap.human_gate_reasons || [],\n};\nconst body = JSON.stringify({\n  brand_id: v.brand_id,\n  stage: 'gap_notification',\n  metadata,\n});\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', v._secret).update(body).digest('hex');\nreturn { json: {\n  brand_id: v.brand_id,\n  _secret: v._secret, _base: v._base,\n  _stage_url: v._base + '/api/processing/stage',\n  _stage_body: body,\n  _stage_headers: {\n    'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts,\n  },\n}};"
      },
      "id": "sign-gap-notification",
      "name": "Sign · gap notification",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [6160, 580]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._stage_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._stage_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._stage_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._stage_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._stage_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._stage_body }}",
        "options": { "timeout":10000,"neverError":true,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "http-gap-notification",
      "name": "POST · gap notification",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [6340, 580]
    },

    {
      "parameters": {},
      "id": "on-error",
      "name": "On Error",
      "type": "n8n-nodes-base.errorTrigger",
      "typeVersion": 1,
      "position": [200, 900]
    },
    {
      "parameters": {
        "jsCode": "// Build S03 alert + capture brand_id for the stage=failed write.\nconst WEBHOOK_SECRET = 'c56cb3e88c57ea77929fdbec379fb6ff1ab72fef61cee9084e9cb263892d8887';\nconst APP_BASE_URL = 'https://vagrancy-pupil-spiritism.ngrok-free.dev';\nconst e = $json;\nlet brand_id = null;\ntry { brand_id = $('Verify HMAC + parse').first().json.brand_id ?? null; } catch (_) { /* node never ran */ }\nreturn { json: {\n  brand_id,\n  _secret: WEBHOOK_SECRET,\n  _base: APP_BASE_URL,\n  anomaly_type: 'flow_failure',\n  severity: 'CRITICAL',\n  flow_id: 'N8N-A03',\n  message: e.execution?.error?.message || 'A03 onboarding flow failed',\n  details: {\n    failed_node: e.execution?.lastNodeExecuted ?? null,\n    error_name: e.execution?.error?.name ?? null,\n    workflow_id: e.workflow?.id ?? null,\n    execution_id: e.execution?.id ?? null,\n  },\n  timestamp: new Date().toISOString(),\n}};"
      },
      "id": "build-s03-alert",
      "name": "Build S03 alert",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [400, 900]
    },
    {
      "parameters": {
        "jsCode": "// Sign /api/processing/stage with stage='failed' → flips onboarding_status\n// to 'failed' so the red Retry banner appears on /[slug]/processing.\nconst crypto = require('crypto');\nconst brand_id = $json.brand_id;\nif (!brand_id) return { json: { ...$json, _stage_skip: true } };\nconst body = JSON.stringify({ brand_id, stage: 'failed', metadata: { error: $json.message, failed_node: $json.details?.failed_node } });\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', $json._secret).update(body).digest('hex');\nreturn { json: { ...$json, _stage_url: $json._base + '/api/processing/stage', _stage_body: body, _stage_headers: {\n  'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts\n}}};"
      },
      "id": "stage-failed-sign",
      "name": "Sign · stage=failed",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [600, 900]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._stage_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._stage_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._stage_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._stage_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._stage_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._stage_body }}",
        "options": { "timeout":15000,"neverError":true,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "stage-failed-http",
      "name": "POST · stage=failed",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [800, 900]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://vagrancy-pupil-spiritism.ngrok-free.dev/webhook/anomaly-alert",
        "sendHeaders": true,
        "headerParameters": { "parameters": [{ "name":"content-type","value":"application/json" }] },
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ JSON.stringify($json) }}",
        "options": { "timeout":10000,"neverError":true }
      },
      "id": "post-s03",
      "name": "POST · S03 anomaly-alert",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [600, 1020]
    }
  ],

  "connections": {
    "Webhook · /openclaw-onboarding": { "main": [[{ "node":"Verify HMAC + parse","type":"main","index":0 }]] },
    "Verify HMAC + parse":            { "main": [[{ "node":"Respond 202 · queued","type":"main","index":0 }]] },
    "Respond 202 · queued":           { "main": [[{ "node":"Sign · stage form_submitted","type":"main","index":0 }]] },
    "Sign · stage form_submitted":    { "main": [[{ "node":"POST · stage form_submitted","type":"main","index":0 }]] },
    "POST · stage form_submitted":    { "main": [[{ "node":"Build CEO body","type":"main","index":0 }]] },
    "Build CEO body":                 { "main": [[{ "node":"Sign · CEO classify","type":"main","index":0 }]] },
    "Sign · CEO classify":            { "main": [[{ "node":"POST · /api/agents/ceo/classify","type":"main","index":0 }]] },
    "POST · /api/agents/ceo/classify":{ "main": [[{ "node":"Parse CEO result","type":"main","index":0 }]] },
    "Parse CEO result":               { "main": [[{ "node":"Sign · stage ceo_classified","type":"main","index":0 }]] },
    "Sign · stage ceo_classified":    { "main": [[{ "node":"POST · stage ceo_classified","type":"main","index":0 }]] },
    "POST · stage ceo_classified":    { "main": [[{ "node":"IF · Blocked?","type":"main","index":0 }]] },

    "IF · Blocked?": {
      "main": [
        [{ "node":"Respond · Blocked","type":"main","index":0 }],
        [{ "node":"Sign · load source_records","type":"main","index":0 }]
      ]
    },

    "Sign · load source_records":     { "main": [[{ "node":"POST · load source_records","type":"main","index":0 }]] },
    "POST · load source_records":     { "main": [[{ "node":"Consolidate extractions","type":"main","index":0 }]] },
    "Consolidate extractions":        { "main": [[{ "node":"Sign · stage scraping_complete","type":"main","index":0 }]] },
    "Sign · stage scraping_complete": { "main": [[{ "node":"POST · stage scraping_complete","type":"main","index":0 }]] },
    "POST · stage scraping_complete": { "main": [[{ "node":"Build COO body","type":"main","index":0 }]] },

    "Build COO body":                       { "main": [[{ "node":"Sign · COO build-branddna","type":"main","index":0 }]] },
    "Sign · COO build-branddna":            { "main": [[{ "node":"POST · /api/agents/coo/build-branddna","type":"main","index":0 }]] },
    "POST · /api/agents/coo/build-branddna":{ "main": [[{ "node":"Sign · stage coo_branddna_built","type":"main","index":0 }]] },
    "Sign · stage coo_branddna_built":      { "main": [[{ "node":"POST · stage coo_branddna_built","type":"main","index":0 }]] },
    "POST · stage coo_branddna_built":      { "main": [[{ "node":"Sign · CEO confidence gate","type":"main","index":0 }]] },
    "Sign · CEO confidence gate":           { "main": [[{ "node":"POST · CEO confidence gate","type":"main","index":0 }]] },
    "POST · CEO confidence gate":           { "main": [[{ "node":"Sign · stage ceo_confidence_refined","type":"main","index":0 }]] },
    "Sign · stage ceo_confidence_refined":  { "main": [[{ "node":"POST · stage ceo_confidence_refined","type":"main","index":0 }]] },
    "POST · stage ceo_confidence_refined":  { "main": [[{ "node":"Sign · Memory process","type":"main","index":0 }]] },

    "Sign · Memory process":         { "main": [[{ "node":"POST · /api/memory/process","type":"main","index":0 }]] },
    "POST · /api/memory/process":    { "main": [[{ "node":"Sign · stage memory_drained","type":"main","index":0 }]] },
    "Sign · stage memory_drained":   { "main": [[{ "node":"POST · stage memory_drained","type":"main","index":0 }]] },
    "POST · stage memory_drained":   { "main": [[{ "node":"Sign · qdrant setup","type":"main","index":0 }]] },
    "Sign · qdrant setup":           { "main": [[{ "node":"POST · /api/vectors/setup","type":"main","index":0 }]] },
    "POST · /api/vectors/setup":     { "main": [[{ "node":"Build + sign final snapshot","type":"main","index":0 }]] },

    "Build + sign final snapshot":          { "main": [[{ "node":"POST · final snapshot + mark complete","type":"main","index":0 }]] },
    "POST · final snapshot + mark complete":{ "main": [[{ "node":"Sign · status callback","type":"main","index":0 }]] },
    "Sign · status callback":               { "main": [[{ "node":"POST · /api/webhooks/n8n (status)","type":"main","index":0 }]] },
    "POST · /api/webhooks/n8n (status)":    { "main": [[{ "node":"IF · ready for A01?","type":"main","index":0 }]] },

    "IF · ready for A01?": {
      "main": [
        [{ "node":"POST · trigger N8N-A01","type":"main","index":0 }],
        [{ "node":"Sign · gap notification","type":"main","index":0 }]
      ]
    },
    "Sign · gap notification": { "main": [[{ "node":"POST · gap notification","type":"main","index":0 }]] },

    "On Error":         { "main": [[{ "node":"Build S03 alert","type":"main","index":0 }]] },
    "Build S03 alert":  { "main": [[{ "node":"Sign · stage=failed","type":"main","index":0 }, { "node":"POST · S03 anomaly-alert","type":"main","index":0 }]] },
    "Sign · stage=failed": { "main": [[{ "node":"POST · stage=failed","type":"main","index":0 }]] }
  },

  "settings": {
    "executionOrder": "v1",
    "saveDataSuccessExecution": "all",
    "saveExecutionProgress": true,
    "saveManualExecutions": true,
    "errorWorkflow": "N8N-S03",
    "timezone": "Asia/Riyadh"
  },
  "pinData": {},
  "versionId": "3.0.0",
  "id": "N8N-A03",
  "active": false,
  "_meta": {
    "description": "rev3 — fills 6 doc + framework gaps. (1) Consolidate extractions reads payload.normalised (mig 0028) via new /api/extraction/source-records endpoint. (2) Build COO body sends three-axis + method composition request, plus form-only fallback for pre-launch brands. (3) Pre-launch detection short-circuits scrape inference. (4) All 4 Supabase nodes replaced with /api/processing/stage + /api/extraction/source-records HMAC posts — n8n needs ZERO DB credentials. (5) Stage emissions fire BEFORE the work, accurate UI tracking. (6) dialect_confirmed lenient: COO explicit OR (form dialect + axis_inference present). Plus: routing_decisions audit row written by /api/agents/ceo/classify. Failure path writes stage='failed' so the red Retry banner appears."
  }
} -->
































=================================================================










<!-- 

previous A06




{
  "name": "N8N-A06 — Onboarding Extraction (v4 — wrapper-driven)",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "openclaw-extraction",
        "responseMode": "responseNode",
        "options": {}
      },
      "id": "a06-webhook",
      "name": "Webhook · /openclaw-extraction",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [200, 400]
    },
    {
      "parameters": {
        "jsCode": "// Verify HMAC + parse the inbound request from Next.js submitSeed.\n// HARDCODED webhook secret + APP_BASE_URL for paste-and-run import. The\n// downstream HTTP nodes use the same secret to sign their callbacks.\nconst WEBHOOK_SECRET = 'c56cb3e88c57ea77929fdbec379fb6ff1ab72fef61cee9084e9cb263892d8887';\n\nconst crypto = require('crypto');\nconst headers = $input.first().json.headers || {};\nconst given = headers['x-n8n-signature'];\nconst ts    = headers['x-n8n-timestamp'];\nconst rid   = headers['x-n8n-request-id'];\nif (!given || !ts || !rid) throw new Error('Missing required HMAC headers');\n\nconst drift = Math.abs(Date.now() - Date.parse(ts));\nif (drift > 5 * 60 * 1000) throw new Error(`Timestamp drift ${drift}ms > 5 min`);\n\nconst rawBody = JSON.stringify($input.first().json.body);\nconst expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');\nif (expected !== given) throw new Error('HMAC signature mismatch');\n\nconst body = $input.first().json.body || {};\nif (!body.brand_id) throw new Error('brand_id required');\n\nreturn { json: {\n  brand_id: body.brand_id,\n  slug: body.slug || null,\n  instagram_handle: body.instagram_handle || null,\n  website_url: body.website_url || null,\n  place_search: body.place_search || { name: '', city: '' },\n  request_id: rid,\n}};"
      },
      "id": "a06-verify",
      "name": "Verify HMAC + parse",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [380, 400]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={ \"ok\": true, \"brand_id\": \"{{ $json.brand_id }}\", \"queued\": true }"
      },
      "id": "a06-respond",
      "name": "Respond 202 · queued",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1,
      "position": [560, 400]
    },
    {
      "parameters": {
        "jsCode": "// Sign extraction_started stage callback.\nconst WEBHOOK_SECRET = 'c56cb3e88c57ea77929fdbec379fb6ff1ab72fef61cee9084e9cb263892d8887';\nconst APP_BASE_URL = 'https://vagrancy-pupil-spiritism.ngrok-free.dev';\nconst crypto = require('crypto');\nconst body = JSON.stringify({ brand_id: $json.brand_id, stage: 'extraction_started' });\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');\nreturn { json: { ...$json, _stage_url: APP_BASE_URL + '/api/processing/stage', _stage_body: body, _stage_headers: {\n  'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts\n}}};"
      },
      "id": "a06-sign-start",
      "name": "Sign · stage_extraction_started",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [740, 400]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._stage_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._stage_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._stage_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._stage_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._stage_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ $json._stage_body }}",
        "options": { "timeout":5000,"neverError":true,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "a06-post-start",
      "name": "POST · stage_extraction_started",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [920, 400]
    },

    {
      "parameters": {
        "jsCode": "// Sign the wrapper call to /api/extraction/run.\n// This single endpoint runs all 3 scrapers in parallel via Promise.allSettled\n// and returns the combined normalised payload — replaces the old\n// 'Build jobs → Prep · IG/Web/Places → Apify HTTP nodes' chain.\nconst WEBHOOK_SECRET = 'c56cb3e88c57ea77929fdbec379fb6ff1ab72fef61cee9084e9cb263892d8887';\nconst APP_BASE_URL = 'https://vagrancy-pupil-spiritism.ngrok-free.dev';\nconst crypto = require('crypto');\n\nconst src = $('Verify HMAC + parse').first().json;\nconst body = JSON.stringify({\n  brand_id:         src.brand_id,\n  slug:             src.slug || null,\n  instagram_handle: src.instagram_handle || null,\n  website_url:      src.website_url || null,\n  place_search:     src.place_search || { name: '', city: '' },\n});\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');\nreturn { json: { ...$json,\n  _run_url: APP_BASE_URL + '/api/extraction/run',\n  _run_body: body,\n  _run_headers: {\n    'content-type':'application/json',\n    'x-n8n-signature':sig,\n    'x-n8n-request-id':reqId,\n    'x-n8n-timestamp':ts,\n  },\n}};"
      },
      "id": "a06-sign-run",
      "name": "Sign · /api/extraction/run",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1100, 400]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._run_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._run_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._run_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._run_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._run_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ $json._run_body }}",
        "options": { "timeout":300000,"neverError":true,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "a06-post-run",
      "name": "POST · /api/extraction/run",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [1300, 400],
      "alwaysOutputData": true
    },

    {
      "parameters": {
        "jsCode": "// Split the wrapper response into 3 ITEMS (one per branch). Each item\n// carries:\n//   • raw         — FULL untouched Apify / Places response (this is what\n//                    we write to source_records.raw_payload — no field loss)\n//   • normalised  — compact summary (used by UI for live extraction screen)\n//   • persist_ig  — IG-only enrichment (post observations, signatures,\n//                    channel profile, palette URLs, mentions, brand replies)\n//\n// Three items + sibling lanes via the Switch node = true parallel persistence.\nconst src = $('Verify HMAC + parse').first().json;\nconst run = $json;\nconst result = run.body || run; // n8n responseFormat:'json' may wrap in body\n\nconst raw        = result.raw        || { instagram: null, website: null, places: null };\nconst normalised = result.normalised || { instagram: null, website: null, places: null };\nconst status     = result.status     || { instagram: 'skipped', website: 'skipped', places: 'skipped' };\nconst enrichment = result.enrichment || {};\nconst timing     = result.timing     || null;\n\n// Optional log so the n8n execution view shows the wrapper's parallelism numbers\nconsole.log('[A06] wrapper timing:', JSON.stringify({\n  wall_ms: timing?.wall_time_ms,\n  overlap_ms: timing?.parallel_overlap_ms,\n  lanes: timing?.lanes,\n}));\n\nreturn [\n  { json: {\n    branch: 'instagram',\n    brand_id: src.brand_id,\n    skipped: status.instagram !== 'done',\n    // FULL raw scraper output — written to source_records.raw_payload AS-IS.\n    raw: raw.instagram,\n    // Compact summary for the live UI / persist-ig signer.\n    normalised: normalised.instagram,\n    persist_ig: status.instagram === 'done' ? {\n      ig_post_observations: enrichment.ig_post_observations || [],\n      brand_reply_samples:  enrichment.brand_reply_samples  || [],\n      signature_hashtags:   enrichment.signature_hashtags   || [],\n      signature_phrases:    enrichment.signature_phrases    || [],\n      // Enrich the channel_profile with the rich IG profile fields the\n      // normaliser already produced (biography, full_name, profile_pic,\n      // external_url, business_category, follows_count, joined_recently)\n      // so persist-ig can write them all into channel_profiles (mig 0028).\n      channel_profile: enrichment.channel_profile ? Object.assign({}, enrichment.channel_profile, {\n        full_name:          normalised.instagram?.profile?.full_name          || null,\n        biography:          normalised.instagram?.profile?.biography          || null,\n        profile_pic_url:    normalised.instagram?.profile?.profile_pic_url    || null,\n        external_url:       normalised.instagram?.profile?.external_url       || null,\n        business_category:  normalised.instagram?.profile?.business_category  || null,\n        follows_count:      normalised.instagram?.profile?.follows_count      || null,\n        is_private:         !!normalised.instagram?.profile?.is_private,\n        joined_recently:    !!normalised.instagram?.profile?.joined_recently,\n        has_channel:        !!normalised.instagram?.profile?.has_channel,\n        raw_profile:        raw.instagram?.details        || null,\n        normalised_profile: normalised.instagram?.profile || null,\n        posts_sample:       normalised.instagram?.posts_sample || null,\n      }) : null,\n      palette_image_urls:   enrichment.palette_image_urls   || [],\n      mentions:             enrichment.mentions             || [],\n    } : null,\n  }},\n  { json: {\n    branch: 'website',\n    brand_id: src.brand_id,\n    skipped: status.website !== 'done',\n    raw: raw.website,\n    normalised: normalised.website,\n  }},\n  { json: {\n    branch: 'places',\n    brand_id: src.brand_id,\n    skipped: status.places !== 'done',\n    raw: raw.places,\n    normalised: normalised.places,\n  }},\n];"
      },
      "id": "a06-build-branches",
      "name": "Build branches",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1480, 400]
    },

    {
      "parameters": {
        "rules": {
          "values": [
            {
              "conditions": {
                "options": { "caseSensitive": true, "typeValidation": "strict" },
                "conditions": [
                  { "leftValue": "={{ $json.branch }}", "rightValue": "instagram",
                    "operator": { "type": "string", "operation": "equals" } }
                ],
                "combinator": "and"
              },
              "renameOutput": true, "outputKey": "instagram"
            },
            {
              "conditions": {
                "options": { "caseSensitive": true, "typeValidation": "strict" },
                "conditions": [
                  { "leftValue": "={{ $json.branch }}", "rightValue": "website",
                    "operator": { "type": "string", "operation": "equals" } }
                ],
                "combinator": "and"
              },
              "renameOutput": true, "outputKey": "website"
            },
            {
              "conditions": {
                "options": { "caseSensitive": true, "typeValidation": "strict" },
                "conditions": [
                  { "leftValue": "={{ $json.branch }}", "rightValue": "places",
                    "operator": { "type": "string", "operation": "equals" } }
                ],
                "combinator": "and"
              },
              "renameOutput": true, "outputKey": "places"
            }
          ]
        },
        "options": {}
      },
      "id": "a06-switch",
      "name": "Switch · by branch",
      "type": "n8n-nodes-base.switch",
      "typeVersion": 3,
      "position": [1660, 400]
    },

    {
      "parameters": {
        "jsCode": "// Sign /api/extraction/persist-source-record body for the IG branch.\n// Migration 0028 splits the payload into explicit `raw` + `normalised`\n// columns (queryable by the live status route + COO Pass 2). raw_payload\n// is kept as the original blob for backward-compat / audit.\nconst WEBHOOK_SECRET = 'c56cb3e88c57ea77929fdbec379fb6ff1ab72fef61cee9084e9cb263892d8887';\nconst APP_BASE_URL = 'https://vagrancy-pupil-spiritism.ngrok-free.dev';\nconst crypto = require('crypto');\nconst typeMap = { instagram: 'instagram', website: 'website', places: 'google_places' };\nconst body = JSON.stringify({\n  brand_id: $json.brand_id,\n  source_type: typeMap[$json.branch] || $json.branch,\n  branch: $json.branch,\n  skipped: !!$json.skipped,\n  raw: $json.raw,                // FULL Apify response (no field loss)\n  normalised: $json.normalised,  // compact summary used by UI\n  raw_payload: { branch: $json.branch, skipped: !!$json.skipped, raw: $json.raw, normalised: $json.normalised },\n});\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');\nreturn { json: { ...$json,\n  _sr_url: APP_BASE_URL + '/api/extraction/persist-source-record',\n  _sr_body: body,\n  _sr_headers: { 'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts }\n}};"
      },
      "id": "a06-sign-sr-ig",
      "name": "Sign · source_record (IG)",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1840, 200]
    },
    {
      "parameters": {
        "jsCode": "// Sign /api/extraction/persist-source-record body. Migration 0028 splits\n// the payload into explicit `raw` + `normalised` + `branch` + `skipped`\n// columns so the live status route and COO Pass 2 can read them directly\n// without parsing raw_payload. raw_payload is kept as the audit blob.\nconst WEBHOOK_SECRET = 'c56cb3e88c57ea77929fdbec379fb6ff1ab72fef61cee9084e9cb263892d8887';\nconst APP_BASE_URL = 'https://vagrancy-pupil-spiritism.ngrok-free.dev';\nconst crypto = require('crypto');\nconst typeMap = { instagram: 'instagram', website: 'website', places: 'google_places' };\nconst body = JSON.stringify({\n  brand_id: $json.brand_id,\n  source_type: typeMap[$json.branch] || $json.branch,\n  branch: $json.branch,\n  skipped: !!$json.skipped,\n  raw: $json.raw,                // FULL Apify / Places response (no field loss)\n  normalised: $json.normalised,  // compact summary used by the UI\n  raw_payload: {\n    branch: $json.branch,\n    skipped: !!$json.skipped,\n    raw: $json.raw,\n    normalised: $json.normalised,\n  },\n});\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');\nreturn { json: { ...$json,\n  _sr_url: APP_BASE_URL + '/api/extraction/persist-source-record',\n  _sr_body: body,\n  _sr_headers: { 'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts }\n}};"
      },
      "id": "a06-sign-sr-web",
      "name": "Sign · source_record (Web)",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1840, 400]
    },
    {
      "parameters": {
        "jsCode": "// Sign /api/extraction/persist-source-record body. Migration 0028 splits\n// the payload into explicit `raw` + `normalised` + `branch` + `skipped`\n// columns so the live status route and COO Pass 2 can read them directly\n// without parsing raw_payload. raw_payload is kept as the audit blob.\nconst WEBHOOK_SECRET = 'c56cb3e88c57ea77929fdbec379fb6ff1ab72fef61cee9084e9cb263892d8887';\nconst APP_BASE_URL = 'https://vagrancy-pupil-spiritism.ngrok-free.dev';\nconst crypto = require('crypto');\nconst typeMap = { instagram: 'instagram', website: 'website', places: 'google_places' };\nconst body = JSON.stringify({\n  brand_id: $json.brand_id,\n  source_type: typeMap[$json.branch] || $json.branch,\n  branch: $json.branch,\n  skipped: !!$json.skipped,\n  raw: $json.raw,                // FULL Apify / Places response (no field loss)\n  normalised: $json.normalised,  // compact summary used by the UI\n  raw_payload: {\n    branch: $json.branch,\n    skipped: !!$json.skipped,\n    raw: $json.raw,\n    normalised: $json.normalised,\n  },\n});\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');\nreturn { json: { ...$json,\n  _sr_url: APP_BASE_URL + '/api/extraction/persist-source-record',\n  _sr_body: body,\n  _sr_headers: { 'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts }\n}};"
      },
      "id": "a06-sign-sr-places",
      "name": "Sign · source_record (Places)",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1840, 600]
    },

    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._sr_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._sr_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._sr_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._sr_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._sr_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._sr_body }}",
        "options": { "timeout":15000, "neverError":true, "response":{"response":{"responseFormat":"json"}} }
      },
      "id": "a06-post-sr-ig",
      "name": "POST · source_record (IG)",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [2020, 200]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._sr_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._sr_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._sr_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._sr_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._sr_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._sr_body }}",
        "options": { "timeout":15000, "neverError":true, "response":{"response":{"responseFormat":"json"}} }
      },
      "id": "a06-post-sr-web",
      "name": "POST · source_record (Web)",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [2020, 400]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._sr_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._sr_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._sr_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._sr_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._sr_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._sr_body }}",
        "options": { "timeout":15000, "neverError":true, "response":{"response":{"responseFormat":"json"}} }
      },
      "id": "a06-post-sr-places",
      "name": "POST · source_record (Places)",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [2020, 600]
    },

    {
      "parameters": {
        "jsCode": "// IG-only: sign /api/extraction/persist-ig (full enrichment).\n// Skips when skipped or no enrichment payload.\nconst WEBHOOK_SECRET = 'c56cb3e88c57ea77929fdbec379fb6ff1ab72fef61cee9084e9cb263892d8887';\nconst APP_BASE_URL = 'https://vagrancy-pupil-spiritism.ngrok-free.dev';\nconst crypto = require('crypto');\n\nconst seed = $('Build branches').all().map(i => i.json).find(b => b.branch === 'instagram');\nconst pi = seed?.persist_ig;\nif (!pi || !pi.channel_profile) {\n  return { json: { ...$json, _persist_skip: true } };\n}\nconst payload = {\n  brand_id: $json.brand_id,\n  source_record_id: null,\n  ig_post_observations: pi.ig_post_observations || [],\n  brand_reply_samples:  pi.brand_reply_samples  || [],\n  signature_hashtags:   pi.signature_hashtags   || [],\n  signature_phrases:    pi.signature_phrases    || [],\n  channel_profile:      pi.channel_profile,\n  palette_image_urls:   pi.palette_image_urls   || [],\n  mentions:             pi.mentions             || [],\n};\nconst body = JSON.stringify(payload);\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');\nreturn { json: { ...$json,\n  _persist_url: APP_BASE_URL + '/api/extraction/persist-ig',\n  _persist_body: body,\n  _persist_headers: { 'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts }\n}};"
      },
      "id": "a06-sign-persist-ig",
      "name": "Sign · persist-ig",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [2200, 200]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._persist_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._persist_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._persist_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._persist_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._persist_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._persist_body }}",
        "options": { "timeout":60000,"neverError":true,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "a06-post-persist-ig",
      "name": "POST · persist-ig",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [2380, 200]
    },

    {
      "parameters": {
        "jsCode": "// Sign per-branch stage callback (IG). After POST·persist-ig, $json holds\n// the API response — `branch` was stripped. Recover it from Build branches\n// by index 0 (instagram). brand_id survives in API response.\nconst WEBHOOK_SECRET = 'c56cb3e88c57ea77929fdbec379fb6ff1ab72fef61cee9084e9cb263892d8887';\nconst APP_BASE_URL = 'https://vagrancy-pupil-spiritism.ngrok-free.dev';\nconst crypto = require('crypto');\nconst seed = $('Build branches').all().map(i => i.json).find(b => b.branch === 'instagram');\nconst brand_id = seed?.brand_id || $json.brand_id;\nconst body = JSON.stringify({ brand_id, stage: 'extraction.instagram_complete' });\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');\nreturn { json: { brand_id, branch: 'instagram', _stage_url: APP_BASE_URL + '/api/processing/stage', _stage_body: body, _stage_headers: {\n  'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts\n}}};"
      },
      "id": "a06-sign-stage-ig",
      "name": "Sign · stage (IG)",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [2560, 200]
    },
    {
      "parameters": {
        "jsCode": "// Sign per-branch stage callback (Web). After POST·source_record, $json is\n// the API response — `branch` is gone. Recover from Build branches.\nconst WEBHOOK_SECRET = 'c56cb3e88c57ea77929fdbec379fb6ff1ab72fef61cee9084e9cb263892d8887';\nconst APP_BASE_URL = 'https://vagrancy-pupil-spiritism.ngrok-free.dev';\nconst crypto = require('crypto');\nconst seed = $('Build branches').all().map(i => i.json).find(b => b.branch === 'website');\nconst brand_id = seed?.brand_id || $json.brand_id;\nconst body = JSON.stringify({ brand_id, stage: 'extraction.website_complete' });\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');\nreturn { json: { brand_id, branch: 'website', _stage_url: APP_BASE_URL + '/api/processing/stage', _stage_body: body, _stage_headers: {\n  'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts\n}}};"
      },
      "id": "a06-sign-stage-web",
      "name": "Sign · stage (Web)",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [2200, 400]
    },
    {
      "parameters": {
        "jsCode": "// Sign per-branch stage callback (Places).\nconst WEBHOOK_SECRET = 'c56cb3e88c57ea77929fdbec379fb6ff1ab72fef61cee9084e9cb263892d8887';\nconst APP_BASE_URL = 'https://vagrancy-pupil-spiritism.ngrok-free.dev';\nconst crypto = require('crypto');\nconst seed = $('Build branches').all().map(i => i.json).find(b => b.branch === 'places');\nconst brand_id = seed?.brand_id || $json.brand_id;\nconst body = JSON.stringify({ brand_id, stage: 'extraction.places_complete' });\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');\nreturn { json: { brand_id, branch: 'places', _stage_url: APP_BASE_URL + '/api/processing/stage', _stage_body: body, _stage_headers: {\n  'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts\n}}};"
      },
      "id": "a06-sign-stage-places",
      "name": "Sign · stage (Places)",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [2200, 600]
    },

    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._stage_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._stage_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._stage_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._stage_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._stage_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._stage_body }}",
        "options": { "timeout":5000,"neverError":true,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "a06-post-stage-ig",
      "name": "POST · stage (IG)",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [2740, 200]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._stage_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._stage_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._stage_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._stage_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._stage_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._stage_body }}",
        "options": { "timeout":5000,"neverError":true,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "a06-post-stage-web",
      "name": "POST · stage (Web)",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [2380, 400]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._stage_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._stage_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._stage_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._stage_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._stage_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._stage_body }}",
        "options": { "timeout":5000,"neverError":true,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "a06-post-stage-places",
      "name": "POST · stage (Places)",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [2380, 600]
    },

    {
      "parameters": { "numberInputs": 3 },
      "id": "a06-merge",
      "name": "Merge all branches",
      "type": "n8n-nodes-base.merge",
      "typeVersion": 3,
      "position": [2920, 400]
    },
    {
      "parameters": {
        "jsCode": "// Sign /api/extraction/mark-done — flips brand_profiles.onboarding_status\n// to 'extraction_done'. Replaces the old Supabase UPDATE node so n8n needs\n// no DB credentials.\nconst WEBHOOK_SECRET = 'c56cb3e88c57ea77929fdbec379fb6ff1ab72fef61cee9084e9cb263892d8887';\nconst APP_BASE_URL = 'https://vagrancy-pupil-spiritism.ngrok-free.dev';\nconst crypto = require('crypto');\nconst src = $('Verify HMAC + parse').first().json;\nconst body = JSON.stringify({ brand_id: src.brand_id });\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');\nreturn { json: {\n  brand_id: src.brand_id,\n  _md_url: APP_BASE_URL + '/api/extraction/mark-done',\n  _md_body: body,\n  _md_headers: { 'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts }\n}};"
      },
      "id": "a06-sign-mark-done",
      "name": "Sign · mark-done",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [3100, 400]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._md_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._md_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._md_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._md_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._md_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._md_body }}",
        "options": { "timeout":10000,"neverError":true,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "a06-post-mark-done",
      "name": "POST · mark-done",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [3280, 400]
    },

    {
      "parameters": {
        "jsCode": "const WEBHOOK_SECRET = 'c56cb3e88c57ea77929fdbec379fb6ff1ab72fef61cee9084e9cb263892d8887';\nconst APP_BASE_URL = 'https://vagrancy-pupil-spiritism.ngrok-free.dev';\nconst crypto = require('crypto');\nconst body = JSON.stringify({ brand_id: $json.brand_id, stage: 'extraction_complete' });\nconst ts = new Date().toISOString();\nconst reqId = crypto.randomUUID();\nconst sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');\nreturn { json: { brand_id: $json.brand_id, _stage_url: APP_BASE_URL + '/api/processing/stage', _stage_body: body, _stage_headers: {\n  'content-type':'application/json','x-n8n-signature':sig,'x-n8n-request-id':reqId,'x-n8n-timestamp':ts\n}}};"
      },
      "id": "a06-sign-final",
      "name": "Sign · extraction_complete",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [3460, 400]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json._stage_url }}",
        "sendHeaders": true,
        "headerParameters": { "parameters": [
          { "name":"content-type","value":"={{ $json._stage_headers['content-type'] }}" },
          { "name":"x-n8n-signature","value":"={{ $json._stage_headers['x-n8n-signature'] }}" },
          { "name":"x-n8n-request-id","value":"={{ $json._stage_headers['x-n8n-request-id'] }}" },
          { "name":"x-n8n-timestamp","value":"={{ $json._stage_headers['x-n8n-timestamp'] }}" }
        ]},
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ $json._stage_body }}",
        "options": { "timeout":5000,"neverError":true,"response":{"response":{"responseFormat":"json"}} }
      },
      "id": "a06-post-final",
      "name": "POST · stage_extraction_complete",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [3640, 400]
    },

    {
      "parameters": {},
      "id": "a06-on-error",
      "name": "On Error",
      "type": "n8n-nodes-base.errorTrigger",
      "typeVersion": 1,
      "position": [200, 800]
    },
    {
      "parameters": {
        "jsCode": "const e = $json;\nreturn [{ json: {\n  anomaly_type: 'flow_failure', severity: 'WARNING', flow_id: 'N8N-A06',\n  brand_id: e.execution?.error?.brand_id ?? null,\n  message: e.execution?.error?.message || 'A06 extraction flow failed',\n  details: { failed_node: e.execution?.lastNodeExecuted ?? null },\n  timestamp: new Date().toISOString(),\n}}];"
      },
      "id": "a06-build-alert",
      "name": "Build S03 alert",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [400, 800]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://vagrancy-pupil-spiritism.ngrok-free.dev/webhook/anomaly-alert",
        "sendHeaders": true,
        "headerParameters": { "parameters": [{ "name":"content-type","value":"application/json" }] },
        "sendBody": true, "specifyBody": "json", "jsonBody": "={{ JSON.stringify($json) }}",
        "options": { "timeout":10000,"neverError":true }
      },
      "id": "a06-post-alert",
      "name": "POST · S03 anomaly-alert",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [600, 800]
    }
  ],

  "connections": {
    "Webhook · /openclaw-extraction": { "main": [[{ "node":"Verify HMAC + parse","type":"main","index":0 }]] },
    "Verify HMAC + parse": { "main": [[{ "node":"Respond 202 · queued","type":"main","index":0 }]] },
    "Respond 202 · queued": { "main": [[{ "node":"Sign · stage_extraction_started","type":"main","index":0 }]] },
    "Sign · stage_extraction_started": { "main": [[{ "node":"POST · stage_extraction_started","type":"main","index":0 }]] },
    "POST · stage_extraction_started": { "main": [[{ "node":"Sign · /api/extraction/run","type":"main","index":0 }]] },
    "Sign · /api/extraction/run": { "main": [[{ "node":"POST · /api/extraction/run","type":"main","index":0 }]] },
    "POST · /api/extraction/run": { "main": [[{ "node":"Build branches","type":"main","index":0 }]] },
    "Build branches": { "main": [[{ "node":"Switch · by branch","type":"main","index":0 }]] },

    "Switch · by branch": {
      "main": [
        [{ "node":"Sign · source_record (IG)","type":"main","index":0 }],
        [{ "node":"Sign · source_record (Web)","type":"main","index":0 }],
        [{ "node":"Sign · source_record (Places)","type":"main","index":0 }]
      ]
    },

    "Sign · source_record (IG)":     { "main": [[{ "node":"POST · source_record (IG)","type":"main","index":0 }]] },
    "POST · source_record (IG)":     { "main": [[{ "node":"Sign · persist-ig","type":"main","index":0 }]] },
    "Sign · persist-ig":             { "main": [[{ "node":"POST · persist-ig","type":"main","index":0 }]] },
    "POST · persist-ig":             { "main": [[{ "node":"Sign · stage (IG)","type":"main","index":0 }]] },
    "Sign · stage (IG)":             { "main": [[{ "node":"POST · stage (IG)","type":"main","index":0 }]] },
    "POST · stage (IG)":             { "main": [[{ "node":"Merge all branches","type":"main","index":0 }]] },

    "Sign · source_record (Web)":    { "main": [[{ "node":"POST · source_record (Web)","type":"main","index":0 }]] },
    "POST · source_record (Web)":    { "main": [[{ "node":"Sign · stage (Web)","type":"main","index":0 }]] },
    "Sign · stage (Web)":            { "main": [[{ "node":"POST · stage (Web)","type":"main","index":0 }]] },
    "POST · stage (Web)":            { "main": [[{ "node":"Merge all branches","type":"main","index":1 }]] },

    "Sign · source_record (Places)": { "main": [[{ "node":"POST · source_record (Places)","type":"main","index":0 }]] },
    "POST · source_record (Places)": { "main": [[{ "node":"Sign · stage (Places)","type":"main","index":0 }]] },
    "Sign · stage (Places)":         { "main": [[{ "node":"POST · stage (Places)","type":"main","index":0 }]] },
    "POST · stage (Places)":         { "main": [[{ "node":"Merge all branches","type":"main","index":2 }]] },

    "Merge all branches":             { "main": [[{ "node":"Sign · mark-done","type":"main","index":0 }]] },
    "Sign · mark-done":               { "main": [[{ "node":"POST · mark-done","type":"main","index":0 }]] },
    "POST · mark-done":               { "main": [[{ "node":"Sign · extraction_complete","type":"main","index":0 }]] },
    "Sign · extraction_complete":     { "main": [[{ "node":"POST · stage_extraction_complete","type":"main","index":0 }]] },

    "On Error": { "main": [[{ "node":"Build S03 alert","type":"main","index":0 }]] },
    "Build S03 alert": { "main": [[{ "node":"POST · S03 anomaly-alert","type":"main","index":0 }]] }
  },

  "settings": {
    "executionOrder": "v1",
    "saveDataSuccessExecution": "all",
    "saveExecutionProgress": true,
    "saveManualExecutions": true,
    "errorWorkflow": "N8N-S03",
    "timezone": "Asia/Riyadh"
  },
  "pinData": {},
  "versionId": "4.0.0",
  "id": "N8N-A06",
  "active": false,
  "_meta": {
    "description": "v4 — Extraction logic moved to code (@repo/scraping). n8n keeps the workflow shape (webhook → verify → respond 202 → stage_started → ONE wrapper call → 3 lanes → merge → mark-done → final stage). The wrapper /api/extraction/run does all 3 scrapers in parallel via Promise.allSettled and returns the combined normalised payload. n8n Supabase nodes replaced with HTTP POSTs to /api/extraction/persist-source-record + /api/extraction/persist-ig + /api/extraction/mark-done — so n8n needs ZERO database credentials. Just import + activate."
  }
}










 -->
