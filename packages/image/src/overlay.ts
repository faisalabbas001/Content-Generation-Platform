/**
 * Sharp-based Arabic text compositing (TechDoc §3.3, §9.2).
 *
 * Hard Rule #3: Arabic text is NEVER in the image generation prompt.
 * Applied here, post-generation, via Sharp SVG compositing.
 *
 * Layout: opts.layout drives vertical zone (top/upper/center/lower/bottom)
 * and horizontal lean (left/right).
 *
 * Client spec (TechDoc §3.3 "Arabic Overlay", p.32): Arabic text is rendered in the
 * brand's primary color (BrandDNA primary_color_hex), placed directly on the image —
 * no background rectangle, no scrim, no stroke. Font size = clamp(imageWidth*0.05,36,56)px.
 *
 * Dialect → font:
 *   Najdi / Hejazi                            → Noto Naskh Arabic (traditional)
 *   Gulf / MSA_formal / MSA_accessible / Mixed → Cairo (modern digital)
 */
import sharp from 'sharp'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export type Dialect = 'Najdi' | 'Hejazi' | 'Gulf' | 'MSA_formal' | 'MSA_accessible' | 'Mixed'
export type Channel = 'Instagram' | 'Snapchat' | 'TikTok' | 'Twitter'
export type OverlayLayout =
  | 'top-left'    | 'top-right'
  | 'upper-left'  | 'upper-right'
  | 'center-left' | 'center-right'
  | 'lower-left'  | 'lower-right'
  | 'bottom-left' | 'bottom-right'

// ── Font resolution ────────────────────────────────────────────────────────────
function resolveFontDir(): string {
  const candidates = [
    join(process.cwd(), 'packages/image/src/fonts'),
    join(process.cwd(), '../../packages/image/src/fonts'),
    join(process.cwd(), 'node_modules/@repo/image/src/fonts'),
    join(__dirname, 'fonts'),
  ]
  for (const c of candidates) { if (existsSync(c)) return c }
  throw new Error(`@repo/image: fonts dir not found; tried: ${candidates.join(', ')}`)
}

const FONT_DIR = resolveFontDir()

// Font mapping per client spec (TechDoc §9.2):
//   Najdi / Hejazi → Noto Naskh Arabic (traditional)
//   Gulf / MSA_formal / MSA_accessible / Mixed → Cairo (modern digital)
const DIALECT_FONT: Record<Dialect, string> = {
  Najdi:          'NotoNaskhArabic-Regular.ttf',
  Hejazi:         'NotoNaskhArabic-Regular.ttf',
  Gulf:           'Cairo-Regular.ttf',
  MSA_formal:     'Cairo-Regular.ttf',
  MSA_accessible: 'Cairo-Regular.ttf',
  Mixed:          'Cairo-Regular.ttf',
}

const fontCache = new Map<string, string>()
function loadFont(f: string): string {
  const c = fontCache.get(f); if (c) return c
  const b64 = readFileSync(join(FONT_DIR, f)).toString('base64')
  fontCache.set(f, b64); return b64
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// ── Colour helpers (used to validate the DeepSeek font_color override) ──────────
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex ?? '').trim())
  if (!m) return null
  const int = parseInt(m[1]!, 16)
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 }
}
function normalizeHex(hex: string): string {
  const h = (hex ?? '').trim()
  return h.startsWith('#') ? h : `#${h}`
}
// WCAG relative luminance (0–1) with sRGB linearisation.
function relLuminance(r: number, g: number, b: number): number {
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
// WCAG contrast ratio (1–21) between two relative luminances.
function contrastRatio(l1: number, l2: number): number {
  const a = Math.max(l1, l2), b = Math.min(l1, l2)
  return (a + 0.05) / (b + 0.05)
}

// Hard Rule #3 enforcement: only render text containing actual Arabic characters.
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿ]/
function hasArabic(text: string): boolean { return ARABIC_RE.test(text) }

// Keep only the Arabic part of a brand name: drop Latin words, separators ("|"),
// and emoji by retaining only whitespace-separated tokens that contain Arabic.
// e.g. "shawarma house | بيت الشاورما" → "بيت الشاورما"
function arabicOnly(text: string): string {
  return (text ?? '')
    .split(/\s+/)
    .filter((tok) => ARABIC_RE.test(tok))
    .join(' ')
    .trim()
}

// Split Arabic text into lines. Arabic chars average ~0.60× fontSize wide.
// Hard cap at 2 lines; overflow is silently truncated.
function wrapArabicWords(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (candidate.length <= maxCharsPerLine) {
      line = candidate
    } else {
      if (line) lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, 2)
}

// ── Zone configuration ─────────────────────────────────────────────────────────
// Each OverlayLayout maps to a vertical strip + text anchor.
type VAnchor  = 'top' | 'middle' | 'bottom'

interface ZoneSpec {
  yStartR:  number   // strip top    as fraction of image height
  yEndR:    number   // strip bottom as fraction of image height
  vAnchor:  VAnchor  // where text is anchored within the strip
}

const ZONE_MAP: Record<string, ZoneSpec> = {
  top:    { yStartR: 0.00, yEndR: 0.36, vAnchor: 'top'    },
  upper:  { yStartR: 0.10, yEndR: 0.52, vAnchor: 'middle' },
  center: { yStartR: 0.30, yEndR: 0.70, vAnchor: 'middle' },
  lower:  { yStartR: 0.48, yEndR: 0.88, vAnchor: 'middle' },
  bottom: { yStartR: 0.60, yEndR: 1.00, vAnchor: 'bottom' },
}

function parseLayout(layout: OverlayLayout = 'bottom-right'): { zone: ZoneSpec; xRatio: number } {
  const dash = layout.indexOf('-')
  const vKey = layout.slice(0, dash)
  const zone = ZONE_MAP[vKey] ?? ZONE_MAP['bottom']!
  // Arabic social media text is always horizontally centered.
  // The left/right suffix in the layout name controls where the *image subject*
  // should be placed (leaving the opposite side open), but the text itself stays
  // centered so it reads naturally in RTL and looks professional on all channels.
  return { zone, xRatio: 0.50 }
}

// ── Text y-positions within SVG strip ─────────────────────────────────────────
// All y values use dominant-baseline="middle", so y = vertical center of the glyph.
interface TextPositions {
  firstLineY: number  // SVG-local y of first headline line center
  brandY:     number  // SVG-local y of brand name center
}

function calcTextPositions(
  vAnchor:      VAnchor,
  overlayH:     number,
  n:            number,   // headline line count (0 = no headline)
  headlineSz:   number,
  brandSz:      number,
  lineHeight:   number,
  blockGap:     number,
  pad:          number,
): TextPositions {
  if (vAnchor === 'top') {
    // Headline at top, brand name stacked below
    const firstLineY = pad + Math.round(headlineSz / 2)
    const brandY = n > 0
      ? pad + (n - 1) * lineHeight + headlineSz + blockGap + Math.round(brandSz / 2)
      : pad + Math.round(brandSz / 2)
    return { firstLineY, brandY }
  }

  if (vAnchor === 'bottom') {
    // Brand name at bottom, headline stacked above — preserves original reading order
    const brandY         = overlayH - pad - Math.round(brandSz / 2)
    const headlineBottom = brandY - Math.round(brandSz / 2) - blockGap
    const lastLineCenterY = headlineBottom - Math.round(headlineSz / 2)
    const firstLineY     = lastLineCenterY - (n - 1) * lineHeight
    return { firstLineY, brandY }
  }

  // 'middle' — entire text block centered vertically in the strip
  const blockH = n > 0
    ? (n - 1) * lineHeight + headlineSz + blockGap + brandSz
    : brandSz
  const blockTopY  = Math.round((overlayH - blockH) / 2)
  const firstLineY = blockTopY + Math.round(headlineSz / 2)
  const brandY = n > 0
    ? blockTopY + (n - 1) * lineHeight + headlineSz + blockGap + Math.round(brandSz / 2)
    : blockTopY + Math.round(brandSz / 2)
  return { firstLineY, brandY }
}

// ── Main export ────────────────────────────────────────────────────────────────
export async function applyArabicOverlay(
  buf: Buffer,
  brandNameAr: string,
  dialect: Dialect,
  // Brand primary color (BrandDNA primary_color_hex) — client spec (TechDoc p.32)
  // renders all Arabic text in this color.
  colorHex: string,
  opts: {
    headlineAr?: string
    channel?: Channel
    postId?: string
    layout?: OverlayLayout
    /** DeepSeek-recommended headline color. Validated against background brightness before use. */
    fontColorOverride?: string
    /** DeepSeek-recommended font size in px, clamped [24, 96]. Brand name size always auto-derived. */
    fontSizeOverride?: number
  } = {},
): Promise<Buffer> {
  // Hard Rule #3: drop non-Arabic text silently
  const headlineAr = (opts.headlineAr ?? '').trim()
  const brandAr    = arabicOnly(brandNameAr ?? '')
  if (!hasArabic(headlineAr) && !brandAr) {
    console.warn(
      `[overlay] skipped — no Arabic text present. ` +
      `postId="${opts.postId ?? 'unknown'}" ` +
      `brandNameAr="${brandNameAr ?? ''}" ` +
      `headlineAr="${opts.headlineAr ?? ''}"`,
    )
    return buf
  }

  const meta = await sharp(buf).metadata()
  const w = meta.width  ?? 1080
  const h = meta.height ?? 1080

  const fontFile   = DIALECT_FONT[dialect] ?? 'Cairo-Regular.ttf'
  const fontB64    = loadFont(fontFile)
  // librsvg requires the exact family name declared in @font-face
  const fontFamily = fontFile.startsWith('Cairo') ? 'Cairo' : 'Noto Naskh Arabic'

  // Client spec (TechDoc §3.3): headline font size = clamp(imageWidth * 0.05, 36, 56)px.
  // Brand name is a small subordinate signature line — ~50% of the headline,
  // floored at 24px so it stays legible on small canvases.
  // Headline size: honor DeepSeek's recommended font_size when supplied (clamped
  // 24–96 px per spec); otherwise fall back to the client-spec width-derived size
  // clamp(w*0.05, 36, 56). Brand-name size stays auto-derived from the headline.
  const headlineSz = opts.fontSizeOverride != null
    ? Math.min(96, Math.max(24, Math.round(opts.fontSizeOverride)))
    : Math.min(56, Math.max(36, Math.floor(w * 0.05)))
  const brandSz    = Math.max(24, Math.round(headlineSz * 0.5))
  const lineHeight = Math.round(headlineSz * 1.45)

  // Derive strip bounds and horizontal x from layout
  const { zone, xRatio } = parseLayout(opts.layout)
  const xCenter    = Math.round(w * xRatio)
  const overlayTop = Math.round(h * zone.yStartR)
  const overlayH   = Math.max(1, Math.round(h * (zone.yEndR - zone.yStartR)))

  // usableW: full image width minus 80px safety margin on each side (word-wrap budget).
  const usableW = w - 160

  // Client spec (TechDoc §3.3, p.32): all Arabic text is rendered in the brand's
  // primary color (BrandDNA primary_color_hex), passed in via colorHex. Placed
  // directly on the image — no scrim, no stroke. Falls back to white only when no
  // usable brand color is supplied.
  const textColor = colorHex && colorHex !== '#000000' && colorHex !== '#000'
    ? colorHex : '#FFFFFF'

  // Headline color: honor DeepSeek's recommended font_color ONLY when it is a valid
  // hex AND has adequate contrast (WCAG AA large-text ratio ≥ 3:1) against the actual
  // image pixels behind the text strip. Otherwise fall back to the brand color.
  // The brand-name signature always stays in the brand color.
  let headlineColor = textColor
  const fcRgb = opts.fontColorOverride ? hexToRgb(opts.fontColorOverride) : null
  if (fcRgb) {
    let bgLum = 0.5 // neutral default if region sampling fails (non-fatal)
    try {
      const sampleH = Math.max(1, Math.min(overlayH, h - overlayTop))
      const stats = await sharp(buf)
        .extract({ left: 0, top: overlayTop, width: w, height: sampleH })
        .stats()
      const ch = stats.channels
      const r = ch[0]?.mean ?? 128
      const g = ch[1]?.mean ?? r
      const b = ch[2]?.mean ?? r
      bgLum = relLuminance(r, g, b)
    } catch (e) {
      console.warn(`[overlay] background sampling failed (${(e as Error).message}) — using neutral default for contrast check`)
    }
    const fcLum = relLuminance(fcRgb.r, fcRgb.g, fcRgb.b)
    if (contrastRatio(fcLum, bgLum) >= 3) {
      headlineColor = normalizeHex(opts.fontColorOverride!)
    } else {
      console.warn(`[overlay] font_color "${opts.fontColorOverride}" rejected — contrast < 3:1 vs background; using brand color`)
    }
  }
  const brandColor = textColor

  // Word-wrap: usableW / (fontSize × 0.65) — Arabic connected forms are slightly
  // wider than Latin at the same pt size, so 0.65 is more accurate than 0.60.
  const maxCharsPerLine = Math.floor(usableW / (headlineSz * 0.65))
  const headlineLines  = headlineAr ? wrapArabicWords(headlineAr, maxCharsPerLine) : []
  const n              = headlineLines.length

  const PAD       = 48   // breathing room from strip edge
  const BLOCK_GAP = Math.round(brandSz * 0.60)

  const { firstLineY, brandY } = calcTextPositions(
    zone.vAnchor, overlayH, n, headlineSz, brandSz, lineHeight, BLOCK_GAP, PAD,
  )

  const fontFace = `@font-face {
      font-family: '${fontFamily}';
      src: url('data:font/truetype;base64,${fontB64}') format('truetype');
      font-weight: normal;
    }`

  // Note: direction="rtl" + text-anchor="middle" has a known librsvg bug where the
  // anchor behaves as text-anchor="start" in RTL mode, shifting text left of center.
  // Dropping direction="rtl" lets Unicode BiDi handle RTL (Arabic chars are strongly
  // RTL by codepoint) while keeping text-anchor="middle" working correctly.
  const headlineNodes = headlineLines.map((line, i) => {
    const y = firstLineY + i * lineHeight
    return `
  <text
    x="${xCenter}" y="${y}"
    font-family="'${fontFamily}',sans-serif"
    font-size="${headlineSz}" font-weight="400"
    fill="${headlineColor}"
    text-anchor="middle" dominant-baseline="middle"
    unicode-bidi="embed"
  >${escXml(line)}</text>`
  }).join('')

  const brandNode = brandAr ? `
  <text
    x="${xCenter}" y="${brandY}"
    font-family="'${fontFamily}',sans-serif"
    font-size="${brandSz}" font-weight="400"
    fill="${brandColor}"
    text-anchor="middle" dominant-baseline="middle"
    unicode-bidi="embed"
  >${escXml(brandAr)}</text>` : ''

  const svg = `<svg width="${w}" height="${overlayH}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>${fontFace}</style>
  </defs>
  ${headlineNodes}${brandNode}
</svg>`

  // Output PNG so this intermediate step stays lossless.
  // generate.ts does the single final JPEG encode before upload.
  return sharp(buf)
    .composite([{ input: Buffer.from(svg), top: overlayTop, left: 0 }])
    .png()
    .toBuffer()
}

/** No-op — kept for generate.ts compatibility. */
export async function applySafeZone(buf: Buffer, _channel: Channel): Promise<Buffer> {
  return buf
}

// Watermark spec (TechDoc §3.3 Row 8): "Beta AI Draft", Arial 14px,
// white 30% opacity, top-right corner, text-only (no background).
export async function applyWatermark(buf: Buffer, required: boolean): Promise<Buffer> {
  if (!required) return buf
  const meta = await sharp(buf).metadata()
  const w = meta.width ?? 1080
  const svg = `<svg width="200" height="40" xmlns="http://www.w3.org/2000/svg">
  <text x="100" y="20"
    font-family="Arial,sans-serif" font-size="14"
    fill="#FFFFFF" opacity="0.3"
    text-anchor="middle"
    dominant-baseline="middle">Beta AI Draft</text>
</svg>`
  return sharp(buf)
    .composite([{ input: Buffer.from(svg), top: 10, left: Math.max(0, w - 210), blend: 'over' }])
    .toBuffer()
}
