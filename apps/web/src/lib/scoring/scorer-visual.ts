// Visual Quality scorer — Claude Vision via Anthropic SDK.
// Weight: 20%
// For MVP: calls Claude Haiku 4.5 per image (cheaper than Sonnet).
// Parallelised across all image posts.

import { getAnthropicClient } from '@repo/ai'
import type { ScoringInput, DimensionResult, FindingDraft } from './types'
import { clamp } from './types'
import { fetchImageAsBase64 } from './image-fetch'

type LightingClass = 'natural' | 'studio' | 'warm_ambient' | 'fluorescent' | 'mixed' | 'underexposed'
const LIGHTING_SCORES: Record<LightingClass, number> = {
  studio:       100,
  natural:       90,
  warm_ambient:  70,
  mixed:         50,
  fluorescent:   30,
  underexposed:  20,
}

interface ImageAnalysis {
  lighting: LightingClass
  lighting_score: number
  sharpness_score: number     // estimated 0-100 by Claude Vision
  composition_score: number
  appeal_score: number        // F&B sector appeal
  steam_visible: boolean
  freshness_visible: boolean
  plating_quality: 'high' | 'mid' | 'low'
}

async function analyzeImage(imageUrl: string, sector: string, shortCode?: string, prefetchedBase64?: string, prefetchedMime?: string): Promise<ImageAnalysis | null> {
  const img = prefetchedBase64 && prefetchedMime
    ? { base64: prefetchedBase64, mediaType: prefetchedMime as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' }
    : await fetchImageAsBase64(imageUrl, shortCode)
  if (!img) {
    console.warn(`[scorer-visual] image fetch failed url=${imageUrl.slice(0, 60)} shortCode=${shortCode}`)
    return null
  }

  const anthropic = getAnthropicClient()
  // Retry up to 3 times on 529 overload
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } },
            {
              type: 'text',
              text: `Analyze this Instagram post image for a ${sector} brand. Return ONLY valid JSON:
{
  "lighting": "natural"|"studio"|"warm_ambient"|"fluorescent"|"mixed"|"underexposed",
  "sharpness_score": integer 0-100 (100=tack sharp, crisp focus; 50=acceptable; 0=blurry/out-of-focus),
  "composition_score": integer 0-100 (rule of thirds, negative space, visual balance),
  "steam_visible": boolean,
  "freshness_visible": boolean,
  "plating_quality": "high"|"mid"|"low",
  "appeal_score": integer 0-100 (sector: ${sector}, overall visual appetite/purchase appeal)
}`,
            },
          ],
        }],
      })

      const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''
      const json = JSON.parse(text.replace(/^```json\n?/, '').replace(/\n?```$/, '')) as {
        lighting: LightingClass
        sharpness_score: number
        composition_score: number
        steam_visible: boolean
        freshness_visible: boolean
        plating_quality: 'high' | 'mid' | 'low'
        appeal_score: number
      }

      return {
        lighting:          json.lighting,
        lighting_score:    LIGHTING_SCORES[json.lighting] ?? 50,
        sharpness_score:   clamp(json.sharpness_score ?? 50),
        composition_score: clamp(json.composition_score ?? 50),
        appeal_score:      clamp(json.appeal_score ?? 50),
        steam_visible:     Boolean(json.steam_visible),
        freshness_visible: Boolean(json.freshness_visible),
        plating_quality:   json.plating_quality ?? 'mid',
      }
    } catch (err) {
      const msg = String(err)
      const is529 = msg.includes('529') || msg.includes('overloaded') || msg.includes('529')
      console.warn(`[scorer-visual] attempt ${attempt}/3 failed shortCode=${shortCode} error=${msg.slice(0, 120)}`)
      if (is529 && attempt < 3) {
        await new Promise(r => setTimeout(r, 5000 * attempt)) // 5s, 10s back-off
        continue
      }
      return null
    }
  }
  return null
}

export async function scoreVisualQuality(input: ScoringInput): Promise<DimensionResult> {
  const imagePosts = input.profile.posts.filter(p =>
    p.media_type === 'IMAGE' || p.media_type === 'CAROUSEL_ALBUM',
  )
  const benchmarks = input.benchmarks.visual_quality

  if (imagePosts.length === 0) {
    return emptyResult()
  }

  // Batched analysis — concurrency=3 to avoid Haiku 529 overload
  const sample = imagePosts.slice(0, 10).filter(p => p.media_url || p.media_base64)
  const analyses: ImageAnalysis[] = []
  const CONCURRENCY = 2
  for (let i = 0; i < sample.length; i += CONCURRENCY) {
    const batch = sample.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.allSettled(
      batch.map(p => analyzeImage(p.media_url ?? '', input.sector, p.short_code, p.media_base64, p.media_mime)),
    )
    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value !== null) analyses.push(r.value)
    }
  }

  if (analyses.length === 0) return emptyResult()

  const avgSharpness     = analyses.reduce((s, a) => s + a.sharpness_score, 0) / analyses.length
  const avgLighting      = analyses.reduce((s, a) => s + a.lighting_score, 0) / analyses.length
  const avgComposition   = analyses.reduce((s, a) => s + a.composition_score, 0) / analyses.length
  const avgAppeal        = analyses.reduce((s, a) => s + a.appeal_score, 0) / analyses.length

  const score = Math.round((avgSharpness + avgLighting + avgComposition + avgAppeal) / 4)

  // ── Video-heavy cap (spec §5.1) ───────────────────────────────────────────
  const totalPosts = input.profile.posts.length
  const videoPosts = input.profile.posts.filter(p => p.media_type === 'VIDEO').length
  const videoRatio = totalPosts > 0 ? videoPosts / totalPosts : 0
  const isVideoHeavy = videoRatio > 0.5
  const cappedScore = isVideoHeavy ? Math.min(score, 75) : score

  const benchP50 = benchmarks['overall'] ?? 56

  // ── Stats ─────────────────────────────────────────────────────────────────
  const lightingCounts: Record<string, number> = {}
  for (const a of analyses) {
    lightingCounts[a.lighting] = (lightingCounts[a.lighting] ?? 0) + 1
  }
  const steamCount     = analyses.filter(a => a.steam_visible).length
  const freshCount     = analyses.filter(a => a.freshness_visible).length
  const worstLighting  = Object.entries(lightingCounts).sort((a, b) => b[1] - a[1])[0]

  // ── Findings ──────────────────────────────────────────────────────────────
  const findings: FindingDraft[] = []

  if (worstLighting && (worstLighting[0] === 'fluorescent' || worstLighting[0] === 'underexposed')) {
    findings.push({
      finding_en: `${worstLighting[1]} of ${analyses.length} images shot under ${worstLighting[0].replace('_', ' ')} lighting.`,
      finding_ar: `${worstLighting[1]} من ${analyses.length} صورة تحت إضاءة ${worstLighting[0] === 'fluorescent' ? 'فلورية' : 'قاتمة'}.`,
      evidence_count: worstLighting[1],
      evidence_total: analyses.length,
      benchmark_count: null,
      severity: worstLighting[1] > analyses.length * 0.5 ? 'high' : 'mid',
    })
  }

  const benchmarkSteam = benchmarks['steam_visible_pct'] ?? 21
  findings.push({
    finding_en: `${steamCount} posts with steam visible. Sector benchmark: ${Math.round(benchmarkSteam)}/30.`,
    finding_ar: `${steamCount} منشور يظهر البخار. معيار القطاع: ${Math.round(benchmarkSteam)}/30.`,
    evidence_count: steamCount,
    evidence_total: analyses.length,
    benchmark_count: Math.round(benchmarkSteam),
    severity: steamCount < Math.round(benchmarkSteam * 0.4) ? 'high' : 'mid',
  })

  const lowCompositionCount = analyses.filter(a => a.composition_score < 40).length
  if (lowCompositionCount > analyses.length * 0.3) {
    findings.push({
      finding_en: `${lowCompositionCount} of ${analyses.length} images lack strong composition (rule of thirds / negative space).`,
      finding_ar: `${lowCompositionCount} من ${analyses.length} صورة تفتقر إلى تكوين قوي.`,
      evidence_count: lowCompositionCount,
      evidence_total: analyses.length,
      benchmark_count: null,
      severity: 'mid',
    })
  }

  if (isVideoHeavy) {
    findings.unshift({
      finding_en: `${videoPosts} of ${totalPosts} posts are videos — score capped at 75. Mix in static images to unlock full score.`,
      finding_ar: `${videoPosts} من ${totalPosts} منشور مقاطع فيديو — الدرجة محددة عند ٧٥. أضف صور ثابتة لرفع الدرجة.`,
      evidence_count: videoPosts,
      evidence_total: totalPosts,
      benchmark_count: null,
      severity: 'mid',
    })
  }

  const lift = clamp(75 - score, 0, 30)

  return {
    dimension: 'visual_quality',
    score: cappedScore,
    weight: 0.20,
    benchmark: Math.round(benchP50),
    submetrics: {
      images_analyzed:  analyses.length,
      avg_sharpness:    Math.round(avgSharpness),
      avg_lighting:     Math.round(avgLighting),
      avg_composition:  Math.round(avgComposition),
      avg_appeal:       Math.round(avgAppeal),
      steam_count:      steamCount,
      freshness_count:  freshCount,
      lighting_breakdown: lightingCounts,
      video_ratio:      Math.round(videoRatio * 100),
      is_video_heavy:   Number(isVideoHeavy),
    },
    findings,
    action: {
      workflow_id: 'workflow_3',
      action_label_en: 'Workflow 3 · Real Photo Enhancement — professional shoot brief',
      action_label_ar: 'سير العمل ٣ · تحسين الصور — إيجاز التصوير الاحترافي',
      estimated_lift: lift,
      timeframe_weeks: 6,
      icon_emoji: '📸',
    },
  }
}

function emptyResult(): DimensionResult {
  return {
    dimension: 'visual_quality', score: 0, weight: 0.20, benchmark: 56, submetrics: {},
    findings: [{ finding_en: 'No image posts to analyze.', finding_ar: 'لا توجد صور للتحليل.', evidence_count: 0, evidence_total: 0, benchmark_count: null, severity: 'mid' }],
    action: { workflow_id: 'workflow_3', action_label_en: 'Real Photo Enhancement', action_label_ar: 'تحسين الصور', estimated_lift: 25, timeframe_weeks: 6, icon_emoji: '📸' },
  }
}
