#!/usr/bin/env node
/**
 * Wire the missing pieces of N8N-A03 (Doc §5.3):
 *
 *   1. Qdrant per-brand namespace setup (step 4) — between memory drain and
 *      final-snapshot. Sign + POST to /api/vectors/setup.
 *
 *   2. Trigger N8N-A01 (step 9) — fired AFTER the status callback when
 *      completeness ≥ 40 AND dialect_confirmed. We use the COO result that the
 *      final-snapshot node already exposes via $json.snapshot_data.
 *
 *   3. Global error trigger → N8N-S03 (Doc §5 NOTE) — workflow-level Error
 *      Trigger node that signs an alert payload and POSTs to S03 anomaly-alert
 *      webhook on any node failure that the standard 2× retry can't recover.
 *
 * Idempotent. Run as many times as you want.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FLOW = resolve('n8n/flows/N8N-A03-onboarding.json')
const flow = JSON.parse(readFileSync(FLOW, 'utf8'))
const nodes = flow.nodes
const conns = flow.connections

const has = (id) => nodes.some((n) => n.id === id)
let added = 0

// ── 1. Qdrant setup: insert between "POST · /api/memory/process" and the
//      next downstream node in the chain. Memory currently feeds the
//      "Sign · emit memory_drained" node; we want Qdrant AFTER that emit
//      pair so /processing shows memory_drained first, then snapshot_ready
//      (the final snapshot is what flips is_partial=false). Plug into the
//      tail of the emit chain — between "POST · emit memory_drained" and
//      its current downstream "Build final snapshot".
{
  const codeId = 'qdrant-setup-sign'
  const httpId = 'qdrant-setup-http'
  if (!has(codeId)) {
    const upstream = 'POST · emit memory_drained'
    const upConn = conns[upstream]?.main?.[0] ?? []
    const downstream = upConn.slice()
    if (downstream.length === 0) {
      console.warn('! POST · emit memory_drained has no downstream — skipping qdrant setup')
    } else {
      nodes.push(
        {
          parameters: {
            jsCode: `// Sign /api/vectors/setup body (Doc §5.3 step 4)
const crypto = require('crypto');
const brand_id = $('Verify HMAC + parse').first().json.brand_id;
const body = JSON.stringify({ brand_id, flow_id: 'N8N-A03' });
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
          name: 'Sign · qdrant setup',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [3500, 500],
        },
        {
          parameters: {
            method: 'POST',
            url: "={{ $env.N8N_BASE_URL + '/api/vectors/setup' }}",
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
          name: 'POST · /api/vectors/setup',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4,
          position: [3680, 500],
        },
      )
      conns[upstream] = { main: [[{ node: 'Sign · qdrant setup', type: 'main', index: 0 }]] }
      conns['Sign · qdrant setup'] = { main: [[{ node: 'POST · /api/vectors/setup', type: 'main', index: 0 }]] }
      conns['POST · /api/vectors/setup'] = { main: [downstream] }
      added++
      console.log('+ injected qdrant setup between memory_drained emitter and Build final snapshot')
    }
  } else {
    console.log('= qdrant setup already present')
  }
}

// ── 2. Trigger N8N-A01 after the status callback if completeness ≥ 40 and
//      dialect_confirmed. Reads from "Build final snapshot" (which has
//      completeness + dialect_confirmed) via $node['Build final snapshot'].
{
  const ifId = 'a01-ready-if'
  const httpId = 'a01-trigger-http'
  if (!has(ifId)) {
    const upstream = 'POST · /api/webhooks/n8n (status)'
    const upConn = conns[upstream]?.main?.[0] ?? []
    const downstream = upConn.slice()
    nodes.push(
      {
        parameters: {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
            combinator: 'and',
            conditions: [
              {
                id: 'cond-completeness',
                leftValue:
                  "={{ $node['Build final snapshot'].json.snapshot_data.completeness ?? 0 }}",
                rightValue: 40,
                operator: { type: 'number', operation: 'gte' },
              },
              {
                id: 'cond-dialect',
                leftValue:
                  "={{ $node['Build final snapshot'].json.snapshot_data.dialect_confirmed ?? false }}",
                rightValue: true,
                operator: { type: 'boolean', operation: 'true', singleValue: true },
              },
            ],
          },
          options: {},
        },
        id: ifId,
        name: 'IF · ready for A01?',
        type: 'n8n-nodes-base.if',
        typeVersion: 2,
        position: [4900, 500],
      },
      {
        parameters: {
          method: 'POST',
          url: "={{ $env.N8N_BASE_URL_INTERNAL || $env.N8N_BASE_URL }}/webhook-test/openclaw-batch-calendar",
          sendHeaders: true,
          headerParameters: {
            parameters: [{ name: 'content-type', value: 'application/json' }],
          },
          sendBody: true,
          specifyBody: 'json',
          jsonBody:
            "={{ JSON.stringify({ brand_id: $('Verify HMAC + parse').first().json.brand_id, source: 'N8N-A03', auto_triggered: true }) }}",
          options: {
            timeout: 10000,
            response: { response: { responseFormat: 'json' } },
            neverError: true,
          },
        },
        id: httpId,
        name: 'POST · trigger N8N-A01',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [5100, 420],
      },
    )
    // status callback → IF; IF.true → trigger A01 → original-downstream;
    // IF.false → original-downstream
    conns[upstream] = { main: [[{ node: 'IF · ready for A01?', type: 'main', index: 0 }]] }
    const trueBranch = [{ node: 'POST · trigger N8N-A01', type: 'main', index: 0 }]
    const falseBranch = downstream.length ? downstream : []
    conns['IF · ready for A01?'] = { main: [trueBranch, falseBranch] }
    conns['POST · trigger N8N-A01'] = { main: [downstream.length ? downstream : []] }
    added++
    console.log('+ injected A01 auto-trigger gate after status callback')
  } else {
    console.log('= A01 trigger already present')
  }
}

// ── 3. Workflow-level error trigger → S03 anomaly-alert
{
  const errId = 'a03-error-trigger'
  const codeId = 'a03-error-sign'
  const httpId = 'a03-error-post'
  if (!has(errId)) {
    nodes.push(
      {
        parameters: {},
        id: errId,
        name: 'On Error',
        type: 'n8n-nodes-base.errorTrigger',
        typeVersion: 1,
        position: [200, 900],
      },
      {
        parameters: {
          jsCode: `// Build S03 alert payload from the failure
const e = $json;
const brand_id = e.execution?.lastNodeExecuted ? (e.workflow?.id || null) : null;
return { json: {
  anomaly_type: 'flow_failure',
  severity: 'CRITICAL',
  flow_id: 'N8N-A03',
  brand_id: e.execution?.error?.brand_id ?? null,
  message: e.execution?.error?.message || 'A03 onboarding flow failed',
  details: {
    failed_node: e.execution?.lastNodeExecuted ?? null,
    error_name: e.execution?.error?.name ?? null,
    workflow_id: e.workflow?.id ?? null,
    execution_id: e.execution?.id ?? null,
  },
  timestamp: new Date().toISOString(),
}};`,
        },
        id: codeId,
        name: 'Build S03 alert',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [400, 900],
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
        id: httpId,
        name: 'POST · S03 anomaly-alert',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [600, 900],
      },
    )
    conns['On Error'] = { main: [[{ node: 'Build S03 alert', type: 'main', index: 0 }]] }
    conns['Build S03 alert'] = { main: [[{ node: 'POST · S03 anomaly-alert', type: 'main', index: 0 }]] }
    added++
    console.log('+ injected error-trigger → S03 alert chain')
  } else {
    console.log('= error trigger already present')
  }
}

writeFileSync(FLOW, JSON.stringify(flow, null, 2) + '\n', 'utf8')
console.log(`\nDone. added=${added} total_nodes=${nodes.length}`)
