// Calls CEO directly with the same prompt + payload and prints the raw response.
import { readFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('='); if (eq < 0) continue
  const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1)
  if (!(k in process.env)) process.env[k] = v
}
const fs = await import('node:fs/promises')
const path = await import('node:path')
const promptPath = path.resolve('prompts/OGzStudios_CEO_Prompt_v1.md')
const systemPrompt = (await fs.readFile(promptPath, 'utf8')).trim()
console.log('System prompt length:', systemPrompt.length, 'chars')

const userPayload = {
  flow_id: 'N8N-A03',
  request_type: 'onboarding_new',
  brand_id: '00000000-0000-0000-0000-000000000000',
  trigger_payload: { slug: 'probe' },
  occasion_flags: ['none'],
  current_month_spend_usd: 0,
  monthly_ceiling_usd: 50,
}

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: [{ type: 'text', text: systemPrompt }],
    messages: [{ role: 'user', content: JSON.stringify(userPayload) }],
  }),
})
const json = await res.json()
console.log('status:', res.status)
console.log('stop_reason:', json.stop_reason)
console.log('usage:', json.usage)
console.log('---raw response text---')
const text = json.content?.find(b => b.type === 'text')?.text ?? '(none)'
console.log(text.slice(0, 2000))
console.log('---end---')
console.log('total length:', text.length)
console.log('first 50 chars:', JSON.stringify(text.slice(0, 50)))
console.log("contains '{':", text.includes('{'))
console.log("contains '['", text.includes('['))
