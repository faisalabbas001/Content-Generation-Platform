/**
 * POST /api/agents/deepseek/classify
 *
 * Lightweight DeepSeek V3 classification endpoint used by the Brand Scorecard
 * scoring engine (scorer-cultural.ts) to classify Instagram caption language/dialect.
 *
 * Input:  { prompt: string }
 * Output: { classifications: string[] }
 *
 * No agent-route wrapper — this is a lightweight internal call, not an n8n agent job.
 * Secured by DEEPSEEK_API_KEY being server-only (never exposed to client).
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDeepSeekClient, DEEPSEEK_MODEL } from '@repo/ai/deepseek-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RequestSchema = z.object({
  prompt: z.string().min(1).max(8000),
})

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'validation_failed' }, { status: 422 })
  }

  const client = getDeepSeekClient()

  const completion = await client.chat.completions.create({
    model: DEEPSEEK_MODEL,
    max_tokens: 512,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: 'You are a precise Arabic dialect classifier. Return only valid JSON arrays — no explanation, no markdown.',
      },
      {
        role: 'user',
        content: parsed.data.prompt,
      },
    ],
  })

  const raw = completion.choices[0]?.message?.content?.trim() ?? '[]'

  // Parse the JSON array from the response
  let classifications: string[]
  try {
    const stripped = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
    const parsed2 = JSON.parse(stripped)
    classifications = Array.isArray(parsed2) ? parsed2.map(String) : []
  } catch {
    // Fallback: split by newline if the model returned one label per line
    classifications = raw.split('\n').map(l => l.trim()).filter(Boolean)
  }

  return NextResponse.json({ ok: true, classifications })
}
