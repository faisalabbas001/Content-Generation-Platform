/**
 * Vision-based layout detection for Arabic text overlay (§image pipeline).
 *
 * Sends a 512px thumbnail to Claude Sonnet 4.6 vision and asks it to
 * identify the most compositionally suitable zone for Arabic text overlay.
 * Falls back to 'bottom-right' on any failure — this must never block
 * the main image generation pipeline.
 *
 * Cost: ~$0.002 per call (512px JPEG thumbnail, max_tokens=25).
 * Latency: ~1.5–3s. Runs in parallel with clean-variant upload.
 */
import Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'
import type { OverlayLayout } from './overlay'

// Sonnet returns simple vertical zone names (top/upper/center/lower/bottom).
// We always center text horizontally, so left/right distinction is unused —
// the prompt no longer asks for it to avoid false precision.
const ZONE_TO_LAYOUT: Record<string, OverlayLayout> = {
  top:    'top-right',
  upper:  'upper-right',
  center: 'center-right',
  lower:  'lower-right',
  bottom: 'bottom-right',
}

const VALID_ZONES = Object.keys(ZONE_TO_LAYOUT)

// ── Prompt ─────────────────────────────────────────────────────────────────────
// System prompt: role + strict rules for zone selection.
// User prompt: zone map + final instruction, sent with the image.
// Kept separate so the system context is cached across repeated calls.

const SYSTEM = `You are an expert art director for Arabic restaurant and food brand social media \
content targeting the Gulf and Saudi Arabian market.

Your only task: analyze a food photography image and select the single best vertical zone \
for an Arabic text overlay. The text will be centered horizontally across the full image width.

The overlay that will be placed consists of:
- An Arabic headline (up to 2 short lines, reading right-to-left, centered)
- A brand name line below the headline
- A dark gradient scrim (~80% opacity) that darkens the entire selected zone

Zone selection rules — follow in strict priority order:
1. NEVER select a zone where the main food subject, hero dish, or primary focal point sits
2. PREFER zones that are open and uncluttered across the full width — bokeh blur, plain walls, empty table surface, shadow areas, sky
3. PREFER zones that are already relatively dark or tonally uniform across the full width — white text reads cleanly there
4. AVOID zones with hard horizontal lines (table edges, window frames) that fight with text baselines
5. AVOID zones where the dark scrim would obscure a visually important compositional element

Reply with ONLY one zone name from the valid list — no explanation, no punctuation, no other words.`

const USER = `Vertical zone map for this image:
• top    → upper 36% of image height
• upper  → 10%–52% of image height
• center → 30%–70% of image height
• lower  → 48%–88% of image height
• bottom → lower 40% of image height

Study the full-width composition carefully. Identify where the main food subject is placed. \
Then select the vertical zone where the background is most open and suitable for centered Arabic text \
spanning the full image width.

Valid responses (reply with exactly one):
top, upper, center, lower, bottom`

// ── Main export ────────────────────────────────────────────────────────────────
/**
 * Detects the best OverlayLayout for Arabic text on the given image buffer.
 *
 * @param buf      - Raw image buffer (any Sharp-compatible format)
 * @param fallback - Zone to use if Sonnet call fails (default: 'bottom-right')
 * @returns        - One of the 10 valid OverlayLayout values, never throws
 */
export async function detectLayout(
  buf: Buffer,
  fallback: OverlayLayout = 'bottom-right',
): Promise<OverlayLayout> {
  try {
    // Resize to 512px max — composition is fully preserved, token cost minimised
    const thumb = await sharp(buf)
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer()

    const client = new Anthropic()

    // Hard 8-second timeout — vision call must never stall the pipeline
    const response = await Promise.race([
      client.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 25,
        system:     SYSTEM,
        messages: [{
          role: 'user',
          content: [
            {
              type:   'image',
              source: {
                type:       'base64',
                media_type: 'image/jpeg',
                data:       thumb.toString('base64'),
              },
            },
            { type: 'text', text: USER },
          ],
        }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('vision: 8s timeout')), 8_000),
      ),
    ])

    // Normalise response — strip whitespace, punctuation, lowercase
    const raw = (response.content[0] as { text: string })
      .text
      .trim()
      .toLowerCase()
      .replace(/[.,!?;:\s]+$/g, '')

    // Exact match against 5 simple zone names
    if (ZONE_TO_LAYOUT[raw]) return ZONE_TO_LAYOUT[raw]!

    // Partial match — catches "The bottom zone is best" style verbose responses
    for (const zone of VALID_ZONES) {
      if (raw.includes(zone)) return ZONE_TO_LAYOUT[zone]!
    }

    console.warn(`[vision] Unexpected response: "${raw}" — using fallback ${fallback}`)
    return fallback

  } catch (err) {
    console.warn(`[vision] detectLayout failed: ${(err as Error).message} — using fallback ${fallback}`)
    return fallback
  }
}
