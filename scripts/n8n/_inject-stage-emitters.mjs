#!/usr/bin/env node
/**
 * Inject "Emit stage" HTTP-call node-pairs into N8N-A03-onboarding.json
 * between the major pipeline milestones.
 *
 * For each insertion point we add TWO nodes:
 *   1. An "Emit stage <name>" Code node that signs a body for /api/processing/stage
 *   2. An HTTP Request node that POSTs the signed body
 *
 * Then re-wire the connections so the previous node feeds the emit-stage Code
 * node, the Code node feeds the HTTP node, and the HTTP node feeds the
 * downstream node.
 *
 * Idempotent: if a stage node with the same id already exists, we skip
 * insertion. Run this script as many times as you want.
 *
 * Usage:
 *   node scripts/n8n/_inject-stage-emitters.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FLOW_PATH = resolve('n8n/flows/N8N-A03-onboarding.json')

// Where to inject: before-node → stage to emit. The HTTP node we insert
// will be wired BETWEEN the source node and the original next node.
const INSERTIONS = [
  // After CEO classify resolves (before scrapers) → ceo_classified
  { source: 'Parse CEO result',                     stage: 'ceo_classified',     y: 320 },
  // After Consolidate extractions (before COO) → scraping_complete
  { source: 'Consolidate extractions',              stage: 'scraping_complete',  y: 580 },
  // After COO build-branddna succeeds (before memory drain) → coo_branddna_built
  { source: 'POST · /api/agents/coo/build-branddna', stage: 'coo_branddna_built', y: 580 },
  // After memory drain (before final snapshot) → memory_drained
  { source: 'POST · /api/memory/process',           stage: 'memory_drained',     y: 580 },
]

const SIGN_CODE = (stage) => `// Emit stage="${stage}" via /api/processing/stage (HMAC-signed)
const crypto = require('crypto');
const brand_id = $('Verify HMAC + parse').first().json.brand_id;
const body = JSON.stringify({ brand_id, stage: '${stage}' });
const ts = new Date().toISOString();
const reqId = crypto.randomUUID();
const sig = crypto.createHmac('sha256', $env.N8N_WEBHOOK_SECRET).update(body).digest('hex');
return { json: { ...$json, _stage_signed_body: body, _stage_signed_headers: {
  'content-type': 'application/json',
  'x-n8n-signature': sig,
  'x-n8n-request-id': reqId,
  'x-n8n-timestamp': ts,
}}};`

const flow = JSON.parse(readFileSync(FLOW_PATH, 'utf8'))
const nodes = flow.nodes
const conns = flow.connections

let added = 0
let skipped = 0

for (const ins of INSERTIONS) {
  const source = nodes.find((n) => n.name === ins.source)
  if (!source) { console.warn(`! source node not found: ${ins.source}`); continue }

  const codeNodeId = `emit-${ins.stage}-sign`
  const httpNodeId = `emit-${ins.stage}-http`
  if (nodes.some((n) => n.id === codeNodeId)) { skipped++; continue }

  // What was the source's downstream node?
  const downstream = (conns[ins.source]?.main?.[0] ?? []).slice()
  if (downstream.length === 0) {
    console.warn(`! ${ins.source} has no downstream — skipping`)
    continue
  }

  const baseX = (source.position?.[0] ?? 0) + 100
  const codeNode = {
    parameters: { jsCode: SIGN_CODE(ins.stage) },
    id: codeNodeId,
    name: `Sign · emit ${ins.stage}`,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [baseX, ins.y],
  }
  const httpNode = {
    parameters: {
      method: 'POST',
      url: "={{ $env.N8N_BASE_URL + '/api/processing/stage' }}",
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'content-type',     value: "={{ $json._stage_signed_headers['content-type'] }}" },
        { name: 'x-n8n-signature',  value: "={{ $json._stage_signed_headers['x-n8n-signature'] }}" },
        { name: 'x-n8n-request-id', value: "={{ $json._stage_signed_headers['x-n8n-request-id'] }}" },
        { name: 'x-n8n-timestamp',  value: "={{ $json._stage_signed_headers['x-n8n-timestamp'] }}" },
      ]},
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ $json._stage_signed_body }}',
      options: {
        timeout: 5000,
        response: { response: { responseFormat: 'json' } },
        neverError: true,
      },
    },
    id: httpNodeId,
    name: `POST · emit ${ins.stage}`,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4,
    position: [baseX + 180, ins.y],
  }

  nodes.push(codeNode, httpNode)

  // Re-wire: source → codeNode → httpNode → original-downstream
  conns[ins.source] = { main: [[{ node: codeNode.name, type: 'main', index: 0 }]] }
  conns[codeNode.name] = { main: [[{ node: httpNode.name, type: 'main', index: 0 }]] }
  conns[httpNode.name] = { main: [downstream] }

  added++
  console.log(`+ injected emit-${ins.stage} between "${ins.source}" → "${downstream.map(d => d.node).join(', ')}"`)
}

writeFileSync(FLOW_PATH, JSON.stringify(flow, null, 2) + '\n', 'utf8')
console.log(`\nDone. added=${added} skipped=${skipped} total_nodes=${nodes.length}`)
