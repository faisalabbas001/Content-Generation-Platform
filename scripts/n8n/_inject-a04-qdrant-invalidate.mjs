#!/usr/bin/env node
/**
 * Wire Qdrant invalidation into N8N-A04 (Doc §5.4).
 *
 *   1. Insert Qdrant invalidate between "POST · /api/memory/process" and
 *      "Build status callback". The drained Memory Controller has just
 *      written the corrected BrandDNA — Qdrant CaptionContext cache must be
 *      flushed so the next caption regenerates from fresh DNA.
 *
 *   2. Workflow-level error trigger → S03 anomaly-alert.
 *
 * Idempotent.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FLOW = resolve('n8n/flows/N8N-A04-brand-correction.json')
const flow = JSON.parse(readFileSync(FLOW, 'utf8'))
const nodes = flow.nodes
const conns = flow.connections

const has = (id) => nodes.some((n) => n.id === id)
let added = 0

// ── 1. Qdrant invalidate ──────────────────────────────────────────────
{
  const codeId = 'a04-qdrant-invalidate-sign'
  const httpId = 'a04-qdrant-invalidate-http'
  if (!has(codeId)) {
    const upstream = 'POST · /api/memory/process'
    const downstream = (conns[upstream]?.main?.[0] ?? []).slice()
    if (downstream.length === 0) {
      console.warn('! POST · /api/memory/process has no downstream — skipping')
    } else {
      nodes.push(
        {
          parameters: {
            jsCode: `// Sign /api/vectors/invalidate body (Doc §5.4)
const crypto = require('crypto');
const brand_id = $('Verify HMAC + parse').first().json.brand_id;
const body = JSON.stringify({ brand_id, flow_id: 'N8N-A04' });
const ts = new Date().toISOString();
const reqId = crypto.randomUUID();
const sig = crypto.createHmac('sha256', $env.N8N_WEBHOOK_SECRET).update(body).digest('hex');
return { json: { ...$json, _qdrant_body: body, _qdrant_headers: {
  'content-type': 'application/json',
  'x-n8n-signature': sig,
  'x-n8n-request-id': reqId,
  'x-n8n-timestamp': ts,
}}};`,
          },
          id: codeId,
          name: 'Sign · qdrant invalidate',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1700, 300],
        },
        {
          parameters: {
            method: 'POST',
            url: "={{ $env.N8N_BASE_URL + '/api/vectors/invalidate' }}",
            sendHeaders: true,
            headerParameters: {
              parameters: [
                { name: 'content-type', value: "={{ $json._qdrant_headers['content-type'] }}" },
                { name: 'x-n8n-signature', value: "={{ $json._qdrant_headers['x-n8n-signature'] }}" },
                { name: 'x-n8n-request-id', value: "={{ $json._qdrant_headers['x-n8n-request-id'] }}" },
                { name: 'x-n8n-timestamp', value: "={{ $json._qdrant_headers['x-n8n-timestamp'] }}" },
              ],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: '={{ $json._qdrant_body }}',
            options: {
              timeout: 10000,
              retry: { maxTries: 2 },
              response: { response: { responseFormat: 'json' } },
              neverError: true,
            },
          },
          id: httpId,
          name: 'POST · /api/vectors/invalidate',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4,
          position: [1880, 300],
        },
      )
      conns[upstream] = { main: [[{ node: 'Sign · qdrant invalidate', type: 'main', index: 0 }]] }
      conns['Sign · qdrant invalidate'] = {
        main: [[{ node: 'POST · /api/vectors/invalidate', type: 'main', index: 0 }]],
      }
      conns['POST · /api/vectors/invalidate'] = { main: [downstream] }
      added++
      console.log('+ injected qdrant invalidate between memory drain and status callback')
    }
  } else {
    console.log('= qdrant invalidate already present')
  }
}

// ── 2. Error → S03 ────────────────────────────────────────────────────
{
  const errId = 'a04-error-trigger'
  if (!has(errId)) {
    nodes.push(
      {
        parameters: {},
        id: errId,
        name: 'On Error',
        type: 'n8n-nodes-base.errorTrigger',
        typeVersion: 1,
        position: [200, 700],
      },
      {
        parameters: {
          jsCode: `const e = $json;
return { json: {
  anomaly_type: 'flow_failure',
  severity: 'CRITICAL',
  flow_id: 'N8N-A04',
  brand_id: e.execution?.error?.brand_id ?? null,
  message: e.execution?.error?.message || 'A04 brand-correction flow failed',
  details: {
    failed_node: e.execution?.lastNodeExecuted ?? null,
    error_name: e.execution?.error?.name ?? null,
    workflow_id: e.workflow?.id ?? null,
    execution_id: e.execution?.id ?? null,
  },
  timestamp: new Date().toISOString(),
}};`,
        },
        id: 'a04-error-sign',
        name: 'Build S03 alert',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [400, 700],
      },
      {
        parameters: {
          method: 'POST',
          url: "={{ ($env.N8N_BASE_URL_INTERNAL || $env.N8N_BASE_URL) + '/webhook/anomaly-alert' }}",
          sendHeaders: true,
          headerParameters: { parameters: [{ name: 'content-type', value: 'application/json' }] },
          sendBody: true,
          specifyBody: 'json',
          jsonBody: '={{ JSON.stringify($json) }}',
          options: { timeout: 10000, neverError: true },
        },
        id: 'a04-error-post',
        name: 'POST · S03 anomaly-alert',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [600, 700],
      },
    )
    conns['On Error'] = { main: [[{ node: 'Build S03 alert', type: 'main', index: 0 }]] }
    conns['Build S03 alert'] = {
      main: [[{ node: 'POST · S03 anomaly-alert', type: 'main', index: 0 }]],
    }
    added++
    console.log('+ injected error-trigger → S03 alert chain')
  } else {
    console.log('= error trigger already present')
  }
}

writeFileSync(FLOW, JSON.stringify(flow, null, 2) + '\n', 'utf8')
console.log(`\nDone. added=${added} total_nodes=${nodes.length}`)
