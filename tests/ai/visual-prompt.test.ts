/**
 * Visual Prompt Composer provider — unit tests.
 *
 * Mocks the DeepSeek client so no network call happens. Asserts:
 *   1. The composed prompt is returned for a well-formed JSON response.
 *   2. The system prompt (VISUAL_PROMPT_SYSTEM_PROMPT) is loaded and sent.
 *   3. Hard Rule #3 — Arabic in the brief is rejected (retried, then throws).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

// ── Mock the DeepSeek client so compose() makes no real network call. ──────────
const createMock = vi.fn()
vi.mock('../../packages/ai/src/providers/deepseek-client', () => ({
  DEEPSEEK_MODEL: 'deepseek-chat',
  getDeepSeekClient: () => ({ chat: { completions: { create: createMock } } }),
  priceDeepSeekUsage: () => 0,
}))

import { compose } from '../../packages/ai/src/providers/visual-prompt'

const INPUT = {
  brand_name_ar: 'البيك',
  brand_name_en: 'Al Baik',
  sector: 'F&B',
  primary_color_hex: '#E2231A',
  dialect: 'Hejazi',
  content_type: 'product',
  objective: 'awareness',
  occasion: 'national_day',
  product_descriptor: 'crispy fried chicken broasted meal with garlic sauce',
  chain_family: 'TF01',
  platform: 'Instagram',
  cultural_constraints: 'no faces, avoid left hand',
}

function mockResponse(content: string) {
  createMock.mockResolvedValueOnce({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 120, completion_tokens: 80 },
  })
}

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('visualPrompt.compose', () => {
  it('returns the composed English brief and sends the system prompt + input', async () => {
    const brief =
      'Hero shot of crispy broasted fried chicken on a clean studio backdrop, ' +
      'warm side lighting, shallow depth of field, crimson accent props, festive green and gold national-day mood, no text.'
    mockResponse(JSON.stringify({ visual_brief_en: brief }))

    const result = await compose(INPUT, { flow_id: 'N8N-A01', brand_id: 'b1', db: null })

    expect(result.visual_brief_en).toBe(brief)

    // The DeepSeek call carries a non-empty system prompt and the JSON-encoded input.
    const callArgs = createMock.mock.calls[0]![0]
    expect(callArgs.model).toBe('deepseek-chat')
    expect(callArgs.response_format).toEqual({ type: 'json_object' })
    const [system, user] = callArgs.messages
    expect(system.role).toBe('system')
    expect(system.content.length).toBeGreaterThan(50)
    expect(user.role).toBe('user')
    expect(JSON.parse(user.content)).toMatchObject({ product_descriptor: INPUT.product_descriptor })
  })

  it('rejects Arabic text in the brief (Hard Rule #3)', async () => {
    // Every attempt returns Arabic — the provider must throw after retries.
    mockResponse(JSON.stringify({ visual_brief_en: 'صورة دجاج مقلي' }))
    mockResponse(JSON.stringify({ visual_brief_en: 'صورة دجاج مقلي' }))
    mockResponse(JSON.stringify({ visual_brief_en: 'صورة دجاج مقلي' }))

    vi.useFakeTimers()
    const p = compose(INPUT, { flow_id: 'N8N-A01', brand_id: 'b1', db: null })
    // Flush the 2s/4s retry backoffs so the test doesn't wait in real time.
    const settled = expect(p).rejects.toThrow()
    await vi.runAllTimersAsync()
    await settled
    expect(createMock).toHaveBeenCalledTimes(3) // initial + 2 retries
  })
})
