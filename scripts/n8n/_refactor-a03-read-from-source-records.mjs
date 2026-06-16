#!/usr/bin/env node
/**
 * Refactor N8N-A03 (v2):
 *   • Remove the 3 scraper subgraph (Apify / Website / Places + their
 *     normalize/merge/IF/build-branches nodes)
 *   • Replace with a single "Load extractions from source_records" Supabase
 *     SELECT node that reads the rows A06 wrote
 *   • Re-wire connections so Verify HMAC → Build CEO body → … → Load
 *     extractions → COO body → COO POST → ... unchanged tail
 *
 * Idempotent. Safe to run multiple times.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FLOW = resolve('n8n/flows/N8N-A03-onboarding.json')
const flow = JSON.parse(readFileSync(FLOW, 'utf8'))

// ── Nodes to remove (the scraper subgraph) ───────────────────────────
const SCRAPER_NODE_IDS = [
  'build-scrapers',
  'if-not-skipped',
  'http-apify',
  'http-website',
  'http-places',
  'normalize-scraper',
  'merge-scrapers',
]
const SCRAPER_NODE_NAMES = new Set([
  'Build scraper branches',
  'IF · branch enabled',
  'POST · Apify (Instagram)',
  'GET · Website',
  'GET · Google Places',
  'Normalise scraper output',
  'Merge scraper results',
])

const beforeCount = flow.nodes.length
flow.nodes = flow.nodes.filter((n) => !SCRAPER_NODE_IDS.includes(n.id))

// Strip connections involving removed nodes
for (const name of SCRAPER_NODE_NAMES) delete flow.connections[name]
for (const [src, val] of Object.entries(flow.connections)) {
  if (!val.main) continue
  val.main = val.main.map((branch) =>
    branch.filter((t) => !SCRAPER_NODE_NAMES.has(t.node)),
  )
}

// ── Inject the new "Load extractions" node ───────────────────────────
const LOAD_ID = 'a03-load-extractions'
if (!flow.nodes.some((n) => n.id === LOAD_ID)) {
  flow.nodes.push({
    parameters: {
      operation: 'getAll',
      tableId: 'source_records',
      filters: {
        conditions: [
          {
            keyName: 'brand_id',
            condition: 'eq',
            keyValue: "={{ $('Verify HMAC + parse').first().json.brand_id }}",
          },
          {
            keyName: 'source_type',
            condition: 'in',
            keyValue: '("instagram","website","google_places")',
          },
        ],
      },
      returnAll: true,
      options: {},
    },
    id: LOAD_ID,
    name: 'Supabase · LOAD extractions',
    type: 'n8n-nodes-base.supabase',
    typeVersion: 1,
    position: [1300, 500],
    credentials: { supabaseApi: { id: 'openclaw_supabase', name: 'OpenClaw Supabase' } },
  })
}

const COLLECT_ID = 'a03-collect-extractions'
if (!flow.nodes.some((n) => n.id === COLLECT_ID)) {
  flow.nodes.push({
    parameters: {
      jsCode: `// Reduce the source_records rows into the shape COO expects.
const rows = $input.all().map(it => it.json);
const extractions = { instagram: null, website: null, places: null };
for (const r of rows) {
  const payload = (r.raw_payload || {});
  const branch = payload.branch || (
    r.source_type === 'instagram' ? 'instagram'
    : r.source_type === 'website' ? 'website'
    : r.source_type === 'google_places' ? 'places' : null
  );
  if (!branch) continue;
  if (payload.skipped) continue;
  extractions[branch] = payload.data ?? null;
}
const d = $('Verify HMAC + parse').first().json;
const ceo = $('Parse CEO result').first().json;
return { json: { ...d, ceo_decision: ceo.decision, extractions } };`,
    },
    id: COLLECT_ID,
    name: 'Consolidate extractions',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1500, 500],
  })
}

// ── Rewire: IF · Blocked? false-branch → Load extractions → Consolidate
flow.connections['IF · Blocked?'] = {
  main: [
    [{ node: 'Respond · Blocked', type: 'main', index: 0 }],
    [{ node: 'Supabase · LOAD extractions', type: 'main', index: 0 }],
  ],
}
flow.connections['Supabase · LOAD extractions'] = {
  main: [[{ node: 'Consolidate extractions', type: 'main', index: 0 }]],
}
// Consolidate extractions → emit scraping_complete (existing chain)
flow.connections['Consolidate extractions'] = {
  main: [[{ node: 'Sign · emit scraping_complete', type: 'main', index: 0 }]],
}

// ── Persist
writeFileSync(FLOW, JSON.stringify(flow, null, 2) + '\n', 'utf8')
console.log(`A03 refactor done — node count: ${beforeCount} → ${flow.nodes.length}`)
console.log(`Removed ${beforeCount - flow.nodes.length + 2} scraper nodes; injected 2 read-from-DB nodes.`)
