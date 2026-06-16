/**
 * Server-side color-palette extraction.
 *
 * Pulls an image from a URL, resizes to a 64×64 thumbnail (Sharp does this
 * fast and cheap), reads raw RGB pixels, and runs a coarse 4-bit-per-channel
 * histogram + sort to pick the top N colors.
 *
 * This is intentionally simpler than a real perceptual palette extractor
 * (no LAB conversion, no k-means). It's adequate for "find this brand's
 * primary colors from their Instagram profile pic" — the goal is not pixel
 * art, it's broad brand-color signal for visual_style_profiles.color_palette.
 *
 * Why Sharp + not node-vibrant:
 *   • Sharp is already a dep (used for Arabic text overlay in N8N-V01)
 *   • node-vibrant pulls in jpeg-js + a pure-JS Quantize that is much slower
 *     and produces worse results for our use case
 *   • Sharp handles JPEG/PNG/WebP with libvips — same renderer used by the
 *     overlay pipeline, so no surprise behavioural drift
 *
 * Failure modes we accept:
 *   • Invalid URL / 4xx / 5xx → return []
 *   • Animated GIFs/WebPs → use first frame only
 *   • Tiny logos with text on transparent BG → may extract text color as
 *     a "primary" — that's actually correct for brand signal
 *
 * Caller should pass URLs in priority order (profile pic first, then top-3
 * post images). We extract from each in parallel, dedupe near-duplicates,
 * return up to maxColors hex strings.
 */
import sharp from 'sharp'

export interface PaletteOptions {
  /** Maximum total hex colors to return across all sources combined. Default 6. */
  maxColors?: number
  /** Per-image fetch timeout in ms. Default 5000. */
  fetchTimeoutMs?: number
  /** Skip near-duplicates within this RGB Manhattan distance. Default 30. */
  dedupeThreshold?: number
}

/**
 * Extract a palette from one or more image URLs.
 *
 * Usage:
 *   const palette = await extractPalette([profilePicUrl, post1, post2])
 *   // → ['#1a3d2e', '#f5d9a8', '#d63a2f', ...]
 *
 * Always resolves; returns [] on total failure rather than throwing.
 */
export async function extractPalette(
  urls: ReadonlyArray<string | null | undefined>,
  options: PaletteOptions = {},
): Promise<string[]> {
  const maxColors      = options.maxColors      ?? 6
  const fetchTimeoutMs = options.fetchTimeoutMs ?? 5000
  const dedupeThreshold = options.dedupeThreshold ?? 30

  const validUrls = urls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
  if (validUrls.length === 0) return []

  // Fetch + extract per-image dominant colors in parallel
  const perImage = await Promise.all(
    validUrls.map((u) => extractFromUrl(u, fetchTimeoutMs)),
  )

  // Merge results in URL order (profile pic first), deduping near-duplicates
  const merged: Array<{ rgb: [number, number, number]; hex: string; weight: number }> = []
  for (const colors of perImage) {
    for (const c of colors) {
      const dup = merged.find((m) => rgbDistance(m.rgb, c.rgb) < dedupeThreshold)
      if (dup) {
        dup.weight += c.weight
      } else {
        merged.push({ ...c })
      }
    }
  }

  // Sort by weight (descending), take top N, return as hex strings
  merged.sort((a, b) => b.weight - a.weight)
  return merged.slice(0, maxColors).map((c) => c.hex)
}

interface DominantColor {
  rgb: [number, number, number]
  hex: string
  weight: number
}

/** Fetch one image and run the histogram. Returns [] on any failure. */
async function extractFromUrl(url: string, timeoutMs: number): Promise<DominantColor[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    if (!res.ok) return []
    const ab = await res.arrayBuffer()
    if (ab.byteLength === 0) return []
    return await histogramFromBuffer(Buffer.from(ab))
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Sharp pipeline: resize to 64×64, output raw RGB pixels (no alpha).
 * Then quantize each pixel to 4 bits per channel (16×16×16 = 4096 buckets)
 * and accumulate a histogram. Return the top buckets.
 */
async function histogramFromBuffer(buf: Buffer): Promise<DominantColor[]> {
  let raw: { data: Buffer; info: { channels: number } }
  try {
    raw = await sharp(buf, { failOn: 'none' })
      .resize(64, 64, { fit: 'cover' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
  } catch {
    return []
  }
  if (!raw.data || raw.info.channels < 3) return []

  // Histogram bucket = (R>>4)<<8 | (G>>4)<<4 | (B>>4)
  const buckets = new Uint16Array(4096)
  const sumR = new Uint32Array(4096)
  const sumG = new Uint32Array(4096)
  const sumB = new Uint32Array(4096)
  const data = raw.data
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i]!
    const g = data[i + 1]!
    const b = data[i + 2]!
    // Skip near-black + near-white (background noise)
    const lum = r + g + b
    if (lum < 30 || lum > 720) continue
    const idx = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    buckets[idx]! += 1
    sumR[idx]! += r
    sumG[idx]! += g
    sumB[idx]! += b
  }

  // Top 12 buckets by count, then dedupe perceptually-similar ones
  const candidates: Array<{ count: number; rgb: [number, number, number] }> = []
  for (let i = 0; i < 4096; i++) {
    const n = buckets[i]!
    if (n === 0) continue
    candidates.push({
      count: n,
      rgb: [Math.round(sumR[i]! / n), Math.round(sumG[i]! / n), Math.round(sumB[i]! / n)],
    })
  }
  candidates.sort((a, b) => b.count - a.count)

  const picked: DominantColor[] = []
  for (const c of candidates) {
    if (picked.some((p) => rgbDistance(p.rgb, c.rgb) < 25)) continue
    picked.push({
      rgb: c.rgb,
      hex: rgbToHex(c.rgb[0], c.rgb[1], c.rgb[2]),
      weight: c.count,
    })
    if (picked.length >= 6) break
  }
  return picked
}

function rgbDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}
