// Brand Coherence scorer — Claude Vision for typography + voice tone.
// Weight: 20%
// Color palette coherence via dominant-color clustering (Sharp).

import { getAnthropicClient } from '@repo/ai'
import type { ScoringInput, DimensionResult, FindingDraft } from './types'
import { clamp } from './types'
import { fetchImageAsBase64 } from './image-fetch'

type FontStyle = 'serif' | 'sans-serif' | 'display' | 'script' | 'handwritten' | 'monospace'
type ToneStyle = 'formal' | 'casual' | 'promotional' | 'storytelling' | 'instructional'

interface ImageCoherenceAnalysis {
  font_style: FontStyle | null
  tone: ToneStyle
  dominant_colors: string[]   // top 3 hex colors detected
  has_logo: boolean
  logo_placement: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | 'none'
  logo_style: 'text-only' | 'icon-only' | 'combined' | 'none'
}

async function classifyFontAndTone(imageUrl: string, caption: string, shortCode?: string, prefetchedBase64?: string, prefetchedMime?: string): Promise<ImageCoherenceAnalysis | null> {
  const img = prefetchedBase64 && prefetchedMime
    ? { base64: prefetchedBase64, mediaType: prefetchedMime as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' }
    : await fetchImageAsBase64(imageUrl, shortCode)
  if (!img) {
    console.warn(`[scorer-coherence] image fetch failed url=${imageUrl.slice(0, 60)} shortCode=${shortCode}`)
    return null
  }

  const anthropic = getAnthropicClient()
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } },
            {
              type: 'text',
              text: `Analyze this Instagram post image for brand coherence. Return ONLY valid JSON:
{
  "has_text": boolean,
  "font_style": "serif"|"sans-serif"|"display"|"script"|"handwritten"|"monospace"|null,
  "tone": "formal"|"casual"|"promotional"|"storytelling"|"instructional",
  "dominant_colors": ["#rrggbb", "#rrggbb", "#rrggbb"],
  "has_logo": boolean,
  "logo_placement": "top-left"|"top-right"|"bottom-left"|"bottom-right"|"center"|"none",
  "logo_style": "text-only"|"icon-only"|"combined"|"none"
}
Caption: "${(caption ?? '').slice(0, 150)}"`,
            },
          ],
        }],
      })
      const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''
      return JSON.parse(text.replace(/^```json\n?/, '').replace(/\n?```$/, '')) as ImageCoherenceAnalysis
    } catch (err) {
      const msg = String(err)
      const is529 = msg.includes('529') || msg.includes('overloaded')
      console.warn(`[scorer-coherence] attempt ${attempt}/3 failed shortCode=${shortCode} error=${msg.slice(0, 120)}`)
      if (is529 && attempt < 3) {
        await new Promise(r => setTimeout(r, 5000 * attempt)) // 5s, 10s back-off
        continue
      }
      return null
    }
  }
  return null
}

// Compute color palette coherence: how similar are the dominant palettes across posts?
// We compare hue distributions — if all posts share similar hues, it's a coherent palette.
function computeColorCoherence(colorSets: string[][]): number {
  if (colorSets.length === 0) return 50
  // Extract hue from each hex color and build hue histogram per post
  const hexToHue = (hex: string): number => {
    const r = parseInt(hex.slice(1, 3), 16) / 255
    const g = parseInt(hex.slice(3, 5), 16) / 255
    const b = parseInt(hex.slice(5, 7), 16) / 255
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
    if (delta === 0) return -1 // achromatic (grey/white/black)
    let h = 0
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    return Math.round(h * 60 + (h < 0 ? 360 : 0))
  }
  // Collect all hues across all posts, bin into 12 sectors of 30°
  const bins = new Array(12).fill(0)
  let colorCount = 0
  for (const colors of colorSets) {
    for (const hex of colors) {
      if (!hex || hex.length < 7) continue
      const hue = hexToHue(hex)
      if (hue >= 0) { bins[Math.floor(hue / 30) % 12]++; colorCount++ }
    }
  }
  if (colorCount === 0) return 50
  // Entropy-based coherence: low entropy = few dominant hues = coherent palette
  const probs = bins.map(b => b / colorCount).filter(p => p > 0)
  const entropy = -probs.reduce((s, p) => s + p * Math.log2(p), 0)
  const maxEntropy = Math.log2(12) // 3.58 for 12 equal bins
  const coherence = clamp(Math.round(100 * (1 - entropy / maxEntropy)))
  return coherence
}

// Logo coherence: check placement and style consistency across images that have a logo
function computeLogoCoherence(items: ImageCoherenceAnalysis[]): number {
  const logoPosts = items.filter(a => a.has_logo)
  if (logoPosts.length < 2) return 70 // not enough data — assume neutral
  const placements = new Set(logoPosts.map(a => a.logo_placement)).size
  const styles     = new Set(logoPosts.map(a => a.logo_style)).size
  // Perfect = same placement + same style every time
  const placementScore = clamp(100 - (placements - 1) * 25)
  const styleScore     = clamp(100 - (styles - 1) * 30)
  const logoRatio      = logoPosts.length / items.length // penalize if logo missing often
  const presenceScore  = clamp(Math.round(logoRatio * 100))
  return Math.round(placementScore * 0.35 + styleScore * 0.35 + presenceScore * 0.30)
}

export async function scoreBrandCoherence(input: ScoringInput): Promise<DimensionResult> {
  const imagePosts = input.profile.posts.filter(p =>
    p.media_type === 'IMAGE' || p.media_type === 'CAROUSEL_ALBUM',
  )
  const benchmarks = input.benchmarks.brand_coherence

  if (imagePosts.length === 0) return emptyResult()

  // Sample up to 15 images for cost control
  const sample = imagePosts.slice(0, 10).filter(p => p.media_url || p.media_base64)

  const valid: ImageCoherenceAnalysis[] = []
  const CONCURRENCY = 2
  for (let i = 0; i < sample.length; i += CONCURRENCY) {
    const batch = sample.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.allSettled(
      batch.map(p => classifyFontAndTone(p.media_url ?? '', p.caption ?? '', p.short_code, p.media_base64, p.media_mime)),
    )
    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value !== null) valid.push(r.value)
    }
  }

  if (valid.length === 0) return emptyResult()

  // ── Typography coherence ──────────────────────────────────────────────────
  const fontStyles = valid.map(v => v.font_style).filter((f): f is FontStyle => f !== null)
  const distinctFonts = new Set(fontStyles).size
  const typographyScore = clamp(100 - (Math.max(distinctFonts - 1, 0) * 15))

  // ── Voice coherence ────────────────────────────────────────────────────────
  const tones = valid.map(v => v.tone)
  const toneCounts: Record<string, number> = {}
  for (const t of tones) toneCounts[t] = (toneCounts[t] ?? 0) + 1
  const distinctTones = Object.keys(toneCounts).length
  const voiceScore = clamp(100 - (Math.max(distinctTones - 1, 0) * 20))

  // ── Color palette coherence via hue entropy analysis ─────────────────────
  const colorSets = valid.map(v => v.dominant_colors ?? [])
  const colorScore = computeColorCoherence(colorSets)

  // ── Logo coherence via placement + style consistency ──────────────────────
  const logoScore = computeLogoCoherence(valid)

  const score = Math.round(
    colorScore       * 0.30 +
    typographyScore  * 0.25 +
    logoScore        * 0.25 +
    voiceScore       * 0.20,
  )

  const benchP50 = benchmarks['overall'] ?? 60

  // ── Findings ──────────────────────────────────────────────────────────────
  const findings: FindingDraft[] = []

  findings.push({
    finding_en: `Caption tone splits: ${Object.entries(toneCounts).map(([t, n]) => `${n} ${t}`).join(', ')} — ${distinctTones} different voice${distinctTones > 1 ? 's' : ''}.`,
    finding_ar: `أسلوب التعليقات: ${Object.entries(toneCounts).map(([, n]) => `${n}`).join('، ')} — ${distinctTones} ${distinctTones > 1 ? 'أصوات مختلفة' : 'صوت موحّد'}.`,
    evidence_count: distinctTones,
    evidence_total: valid.length,
    benchmark_count: 1,
    severity: distinctTones >= 4 ? 'high' : distinctTones >= 2 ? 'mid' : 'low',
  })

  if (distinctFonts > 1) {
    findings.push({
      finding_en: `${distinctFonts} different font styles detected across image posts.`,
      finding_ar: `${distinctFonts} أنماط خطوط مختلفة عُثر عليها في المنشورات.`,
      evidence_count: distinctFonts,
      evidence_total: sample.length,
      benchmark_count: 1,
      severity: distinctFonts >= 4 ? 'high' : 'mid',
    })
  }

  if (colorScore < 50) {
    findings.push({
      finding_en: `Color palette coherence ${colorScore}/100 — posts use scattered hues with no dominant brand palette.`,
      finding_ar: `تماسك لوحة الألوان ${colorScore}/100 — المنشورات تستخدم ألواناً متفرقة بدون لوحة علامة تجارية موحّدة.`,
      evidence_count: colorSets.filter(s => s.length > 0).length,
      evidence_total: valid.length,
      benchmark_count: 70,
      severity: colorScore < 35 ? 'high' : 'mid',
    })
  }

  const logoPostCount = valid.filter(v => v.has_logo).length
  if (logoPostCount < valid.length * 0.5) {
    findings.push({
      finding_en: `Logo visible in only ${logoPostCount} of ${valid.length} analyzed posts — low brand stamp consistency.`,
      finding_ar: `الشعار ظاهر في ${logoPostCount} فقط من ${valid.length} منشور — انخفاض في ثبات هوية العلامة التجارية.`,
      evidence_count: logoPostCount,
      evidence_total: valid.length,
      benchmark_count: Math.round(valid.length * 0.8),
      severity: logoPostCount < valid.length * 0.3 ? 'high' : 'mid',
    })
  }

  const lift = clamp(80 - score, 0, 30)

  return {
    dimension: 'brand_coherence',
    score,
    weight: 0.20,
    benchmark: Math.round(benchP50),
    submetrics: {
      color_score:       colorScore,
      typography_score:  Math.round(typographyScore),
      logo_score:        logoScore,
      voice_score:       Math.round(voiceScore),
      distinct_fonts:    distinctFonts,
      distinct_tones:    distinctTones,
      tone_breakdown:    toneCounts,
      logo_presence_pct: Math.round((valid.filter(v => v.has_logo).length / valid.length) * 100),
    },
    findings,
    action: {
      workflow_id: 'branddna_onboarding',
      action_label_en: 'Complete BrandDNA — build your brand style guide',
      action_label_ar: 'أكمل الهوية الرقمية — أنشئ دليل أسلوب علامتك',
      estimated_lift: lift,
      timeframe_weeks: 4,
      icon_emoji: '🎨',
    },
  }
}

function emptyResult(): DimensionResult {
  return {
    dimension: 'brand_coherence', score: 0, weight: 0.20, benchmark: 60, submetrics: {},
    findings: [{ finding_en: 'No image posts to analyze.', finding_ar: 'لا توجد صور للتحليل.', evidence_count: 0, evidence_total: 0, benchmark_count: null, severity: 'mid' }],
    action: { workflow_id: 'branddna_onboarding', action_label_en: 'Complete BrandDNA', action_label_ar: 'أكمل الهوية الرقمية', estimated_lift: 25, timeframe_weeks: 4, icon_emoji: '🎨' },
  }
}
