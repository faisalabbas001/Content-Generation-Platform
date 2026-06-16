// Cultural Fit scorer — DeepSeek for language + occasion alignment.
// Weight: 30% — the moat dimension.

import { getDeepSeekClient, DEEPSEEK_MODEL } from '@repo/ai/deepseek-client'
import { getAnthropicClient } from '@repo/ai'
import type { ScoringInput, DimensionResult, FindingDraft, CulturalDeepDive } from './types'
import { clamp } from './types'
import { fetchImageAsBase64 } from './image-fetch'

// Saudi cultural occasions 2026 (expand yearly)
const OCCASIONS_2026: Record<string, { start: Date; end: Date; name_en: string; name_ar: string }> = {
  ramadan:      { start: new Date('2026-02-17'), end: new Date('2026-03-19'), name_en: 'Ramadan',         name_ar: 'رمضان' },
  eid_fitr:     { start: new Date('2026-03-20'), end: new Date('2026-03-22'), name_en: 'Eid Al-Fitr',     name_ar: 'عيد الفطر' },
  founding_day: { start: new Date('2026-02-22'), end: new Date('2026-02-22'), name_en: 'Founding Day',    name_ar: 'يوم التأسيس' },
  mothers_day:  { start: new Date('2026-03-21'), end: new Date('2026-03-21'), name_en: "Mother's Day",    name_ar: 'يوم الأم' },
  national_day: { start: new Date('2026-09-23'), end: new Date('2026-09-23'), name_en: 'National Day',    name_ar: 'اليوم الوطني' },
  eid_adha:     { start: new Date('2026-05-27'), end: new Date('2026-05-30'), name_en: 'Eid Al-Adha',     name_ar: 'عيد الأضحى' },
}

// Occasions 2025 for historical hits
const OCCASIONS_2025: Record<string, { start: Date; end: Date; name_en: string; name_ar: string }> = {
  ramadan:      { start: new Date('2025-03-01'), end: new Date('2025-03-30'), name_en: 'Ramadan',         name_ar: 'رمضان' },
  eid_fitr:     { start: new Date('2025-03-31'), end: new Date('2025-04-02'), name_en: 'Eid Al-Fitr',     name_ar: 'عيد الفطر' },
  founding_day: { start: new Date('2025-02-22'), end: new Date('2025-02-22'), name_en: 'Founding Day',    name_ar: 'يوم التأسيس' },
  national_day: { start: new Date('2025-09-23'), end: new Date('2025-09-23'), name_en: 'National Day',    name_ar: 'اليوم الوطني' },
  eid_adha:     { start: new Date('2025-06-06'), end: new Date('2025-06-09'), name_en: 'Eid Al-Adha',     name_ar: 'عيد الأضحى' },
}

const ALL_OCCASIONS = { ...OCCASIONS_2025, ...OCCASIONS_2026 }

type LangClass = 'najdi' | 'hejazi' | 'eastern' | 'msa' | 'english_only' | 'mixed' | 'other_arabic'

const LANG_SCORES: Record<LangClass, number> = {
  najdi:       100,
  hejazi:      100,
  eastern:     100,
  msa:          60,
  mixed:        50,
  english_only: 30,
  other_arabic: 20,
}

// Claude Vision: check each image for Saudi cultural appropriateness violations
// (alcohol, pork, immodest dress, gambling, etc.)
async function checkAppropriateness(imageUrls: string[], shortCodes?: Array<string | undefined>, preBase64s?: Array<string | undefined>, preMimes?: Array<string | undefined>): Promise<number> {
  if (imageUrls.length === 0) return 100
  // Batch: send up to 10 images at once to keep cost low
  const BATCH = 10
  let totalViolations = 0
  let totalChecked = 0

  const batches: string[][] = []
  for (let i = 0; i < imageUrls.length; i += BATCH) {
    batches.push(imageUrls.slice(i, i + BATCH))
  }

  const anthropic = getAnthropicClient()
  for (const batch of batches) {
    try {
      const batchStart = batches.indexOf(batch) * 10
      // Use pre-fetched base64 if available, otherwise fetch from URL
      const fetched = await Promise.all(batch.map((url, j) => {
        const idx = batchStart + j
        const b64 = preBase64s?.[idx]
        const mime = preMimes?.[idx]
        if (b64 && mime) return Promise.resolve({ base64: b64, mediaType: mime as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' })
        return fetchImageAsBase64(url, shortCodes?.[idx])
      }))
      const validFetched = fetched.filter((f): f is NonNullable<typeof f> => f !== null)
      if (validFetched.length === 0) {
        totalChecked += batch.length
        continue
      }

      const content: Array<{ type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string } } | { type: 'text'; text: string }> = [
        ...validFetched.map(img => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: img.mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: img.base64 },
        })),
        {
          type: 'text' as const,
          text: `You are a Saudi cultural compliance checker for Instagram content targeting Saudi Arabia.
Check each of the ${validFetched.length} images above (in order) for these violations:
- Alcohol or alcoholic beverages visible
- Pork or pork products visible
- Immodest dress (exposed skin beyond hands/face in a non-sports context)
- Gambling imagery
- Content that may offend Islamic values

Return ONLY a JSON array of ${validFetched.length} objects:
[{"index":0,"has_violation":boolean,"violation_type":"none"|"alcohol"|"pork"|"dress"|"gambling"|"other"},...]`,
        },
      ]

      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content }],
      })

      const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '[]'
      const parsed = JSON.parse(text.replace(/^```json\n?/, '').replace(/\n?```$/, '')) as Array<{ index: number; has_violation: boolean }>
      totalViolations += parsed.filter(r => r.has_violation).length
      totalChecked += validFetched.length
    } catch {
      totalChecked += batch.length // assume clean on error
    }
  }

  if (totalChecked === 0) return 100
  const violationRate = totalViolations / totalChecked
  // Each violation is a serious brand risk: deduct 30 points per violation up to max penalty
  return clamp(Math.round(100 - violationRate * 100 * 3))
}

// DeepSeek: verify a caption is actually about a specific occasion (not just a timestamp match)
async function verifyOccasionCaption(caption: string, occasionName: string): Promise<boolean> {
  if (!caption || caption.trim().length < 5) return false
  try {
    const client = getDeepSeekClient()
    const completion = await client.chat.completions.create({
      model: DEEPSEEK_MODEL,
      max_tokens: 8,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Reply only "yes" or "no".' },
        { role: 'user', content: `Is this caption about "${occasionName}"?\nCaption: ${caption.slice(0, 300)}` },
      ],
    })
    const reply = completion.choices[0]?.message?.content?.trim().toLowerCase() ?? ''
    return reply.startsWith('yes')
  } catch {
    return true // on error assume it is — don't penalize
  }
}

// DeepSeek call for language classification — direct SDK call (same process, no HTTP hop)
async function classifyLanguages(captions: string[]): Promise<LangClass[]> {
  if (captions.length === 0) return []

  const prompt = `Classify each Instagram caption into exactly one category:
- "najdi" — Najdi (central Saudi) Arabic dialect
- "hejazi" — Hejazi (western Saudi) Arabic dialect
- "eastern" — Eastern province Saudi Arabic
- "msa" — Modern Standard Arabic
- "english_only" — English only
- "mixed" — Arabic + English mixed
- "other_arabic" — other Arabic (Egyptian, Levantine, etc.)

Return ONLY a JSON array of strings matching the order of captions. No explanation.

Captions:
${captions.map((c, i) => `${i + 1}. ${(c ?? '').slice(0, 200)}`).join('\n')}`

  try {
    const client = getDeepSeekClient()
    const completion = await client.chat.completions.create({
      model: DEEPSEEK_MODEL,
      max_tokens: 512,
      temperature: 0,
      messages: [
        { role: 'system', content: 'You are a precise Arabic dialect classifier. Return only valid JSON arrays — no explanation, no markdown.' },
        { role: 'user', content: prompt },
      ],
    })
    const raw = completion.choices[0]?.message?.content?.trim() ?? '[]'
    const stripped = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(stripped) as unknown
    return (Array.isArray(parsed) ? parsed.map(String) : []) as LangClass[]
  } catch {
    // Fallback: naive heuristic — if contains Arabic chars → msa
    return captions.map(c => /[؀-ۿ]/.test(c ?? '') ? 'msa' : 'english_only')
  }
}

export async function scoreCulturalFit(input: ScoringInput): Promise<{ result: DimensionResult; deepDive: CulturalDeepDive }> {
  const posts = input.profile.posts
  const benchmarks = input.benchmarks.cultural_fit

  if (posts.length === 0) {
    return { result: emptyResult(), deepDive: emptyDeepDive() }
  }

  const captions = posts.map(p => p.caption ?? '')

  // ── Language classification ────────────────────────────────────────────────
  const languages = await classifyLanguages(captions)

  const langCounts: Record<string, number> = {}
  let langScoreSum = 0
  for (const lang of languages) {
    langCounts[lang] = (langCounts[lang] ?? 0) + 1
    langScoreSum += LANG_SCORES[lang] ?? 50
  }
  const langScore = clamp(langScoreSum / languages.length)

  // Dialect multiplier: compare engagement of dialect vs MSA posts
  const dialectPosts = posts.filter((_, i) => ['najdi','hejazi','eastern'].includes(languages[i] ?? ''))
  const msaPosts     = posts.filter((_, i) => languages[i] === 'msa')
  let dialectMultiplier: number | null = null
  if (dialectPosts.length > 0 && msaPosts.length > 0) {
    const dialectAvgLikes = dialectPosts.reduce((s, p) => s + p.like_count, 0) / dialectPosts.length
    const msaAvgLikes     = msaPosts.reduce((s, p) => s + p.like_count, 0) / msaPosts.length
    if (msaAvgLikes > 0) {
      dialectMultiplier = Math.round((dialectAvgLikes / msaAvgLikes) * 10) / 10
    }
  }

  // ── Occasion alignment ────────────────────────────────────────────────────
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
  const postDates  = posts.map(p => new Date(p.timestamp))

  const occasionResults: Array<{ key: string; status: 'hit' | 'late' | 'miss' }> = []
  let hitsScore = 0
  let totalOccasions = 0

  for (const [key, occ] of Object.entries(ALL_OCCASIONS)) {
    if (occ.end < oneYearAgo) continue // too old
    totalOccasions++

    // Find posts that fall within the occasion window
    const windowPostIdxs = posts
      .map((p, i) => ({ date: postDates[i]!, i }))
      .filter(({ date }) => date >= occ.start && date <= occ.end)
    const lateEnd = new Date(occ.end.getTime() + 3 * 24 * 60 * 60 * 1000)
    const latePostIdxs = posts
      .map((p, i) => ({ date: postDates[i]!, i }))
      .filter(({ date }) => date > occ.end && date <= lateEnd)

    if (windowPostIdxs.length > 0) {
      // Verify at least one of those posts is actually about this occasion via DeepSeek
      const captionVerifications = await Promise.all(
        windowPostIdxs.slice(0, 3).map(({ i }) =>
          verifyOccasionCaption(posts[i]?.caption ?? '', occ.name_en),
        ),
      )
      const verified = captionVerifications.some(Boolean)
      if (verified) {
        hitsScore += 1
        occasionResults.push({ key, status: 'hit' })
      } else {
        // Posted during window but didn't mention occasion — count as late (coincidental)
        hitsScore += 0.3
        occasionResults.push({ key, status: 'late' })
      }
    } else if (latePostIdxs.length > 0) {
      const captionVerifications = await Promise.all(
        latePostIdxs.slice(0, 2).map(({ i }) =>
          verifyOccasionCaption(posts[i]?.caption ?? '', occ.name_en),
        ),
      )
      const verified = captionVerifications.some(Boolean)
      hitsScore += verified ? 0.3 : 0
      occasionResults.push({ key, status: verified ? 'late' : 'miss' })
    } else {
      occasionResults.push({ key, status: 'miss' })
    }
  }

  const occasionScore = totalOccasions > 0 ? clamp((hitsScore / totalOccasions) * 100) : 50

  // ── Cultural appropriateness — real Claude Vision check per image ─────────
  const imagePosts = posts
    .filter(p => (p.media_type === 'IMAGE' || p.media_type === 'CAROUSEL_ALBUM') && (p.media_url || p.media_base64))
    .slice(0, 20)
  const imageUrls = imagePosts.map(p => p.media_url ?? '')
  const imageShortCodes = imagePosts.map(p => p.short_code)
  const imageBase64s = imagePosts.map(p => p.media_base64)
  const imageMimes = imagePosts.map(p => p.media_mime)
  const appropriatenessScore = await checkAppropriateness(imageUrls, imageShortCodes)

  // ── Aggregate ─────────────────────────────────────────────────────────────
  const score = Math.round(
    langScore            * 0.30 +
    occasionScore        * 0.50 +
    appropriatenessScore * 0.20,
  )

  const benchP50 = benchmarks['overall'] ?? 62

  // ── Findings ──────────────────────────────────────────────────────────────
  const findings: FindingDraft[] = []

  const topLang = Object.entries(langCounts).sort((a, b) => b[1] - a[1])
  findings.push({
    finding_en: `Language: ${topLang.map(([l, n]) => `${n} ${l}`).join(' · ')} out of ${posts.length} captions.`,
    finding_ar: `اللغة: ${topLang.map(([l, n]) => `${n} ${l}`).join(' · ')} من ${posts.length} تعليق.`,
    evidence_count: (langCounts['najdi'] ?? 0) + (langCounts['hejazi'] ?? 0) + (langCounts['eastern'] ?? 0),
    evidence_total: posts.length,
    benchmark_count: null,
    severity: langScore < 40 ? 'high' : langScore < 70 ? 'mid' : 'low',
  })

  const misses = occasionResults.filter(o => o.status === 'miss')
  if (misses.length > 0) {
    const missNames = misses.map(o => ALL_OCCASIONS[o.key]?.name_en ?? o.key).join(', ')
    findings.push({
      finding_en: `Missed ${misses.length} Saudi occasion${misses.length > 1 ? 's' : ''}: ${missNames}.`,
      finding_ar: `فاتتك ${misses.length} مناسبة سعودية: ${misses.map(o => ALL_OCCASIONS[o.key]?.name_ar ?? o.key).join('، ')}.`,
      evidence_count: misses.length,
      evidence_total: totalOccasions,
      benchmark_count: Math.round(totalOccasions * 0.7),
      severity: misses.length >= 3 ? 'high' : 'mid',
    })
  }

  if (appropriatenessScore < 100) {
    const violationPct = Math.round(100 - appropriatenessScore)
    findings.push({
      finding_en: `Cultural appropriateness check flagged potential issues (~${Math.ceil(violationPct / 33)} image${violationPct > 33 ? 's' : ''} may contain content that needs review for Saudi market).`,
      finding_ar: `فحص الملاءمة الثقافية وجد مشكلات محتملة — قد تحتاج بعض الصور إلى مراجعة للسوق السعودي.`,
      evidence_count: Math.ceil(violationPct / 33),
      evidence_total: imageUrls.length,
      benchmark_count: 0,
      severity: appropriatenessScore < 70 ? 'high' : 'mid',
    })
  }

  if (dialectMultiplier !== null && dialectMultiplier > 1.5) {
    findings.push({
      finding_en: `Your dialect posts get ${dialectMultiplier}× more likes than MSA posts.`,
      finding_ar: `منشوراتك باللهجة تحصل على ${dialectMultiplier}× أكثر من الإعجابات مقارنة بالفصحى.`,
      evidence_count: dialectPosts.length,
      evidence_total: posts.length,
      benchmark_count: null,
      severity: 'low',
    })
  }

  // Pick next missed occasion for action
  const nextMissedOccasion = occasionResults.find(o => o.status === 'miss' && new Date(ALL_OCCASIONS[o.key]?.start ?? 0) > new Date())
  const occasionChain = nextMissedOccasion?.key === 'ramadan' ? 'chain_c1'
    : nextMissedOccasion?.key === 'eid_fitr' ? 'chain_c2'
    : nextMissedOccasion?.key === 'eid_adha' ? 'chain_c3'
    : 'chain_c4'

  const lift = clamp(25 - Math.round(score * 0.1), 10, 25)

  const deepDive: CulturalDeepDive = {
    language_breakdown: langCounts,
    occasions: occasionResults,
    dialect_multiplier: dialectMultiplier,
    dialect_multiplier_note_en: dialectMultiplier !== null
      ? `${dialectMultiplier}× more engagement on dialect posts vs MSA`
      : 'Not enough dialect posts to compute',
    dialect_multiplier_note_ar: dialectMultiplier !== null
      ? `${dialectMultiplier}× تفاعل أعلى على منشوراتك باللهجة مقارنة بالفصحى`
      : 'لا توجد منشورات كافية باللهجة لحساب النسبة',
  }

  return {
    result: {
      dimension: 'cultural_fit',
      score,
      weight: 0.30,
      benchmark: Math.round(benchP50),
      submetrics: {
        language_score:       Math.round(langScore),
        occasion_score:       Math.round(occasionScore),
        appropriateness:      Math.round(appropriatenessScore),
        occasions_hit:        Math.round(hitsScore * 10) / 10,
        occasions_total:      totalOccasions,
        dialect_multiplier:   dialectMultiplier,
        images_checked:       imageUrls.length,
      },
      findings,
      action: {
        workflow_id: occasionChain,
        action_label_en: `Cultural Calendar — ${nextMissedOccasion ? ALL_OCCASIONS[nextMissedOccasion.key]?.name_en : 'Saudi Occasions'}`,
        action_label_ar: `تقويم ثقافي — ${nextMissedOccasion ? ALL_OCCASIONS[nextMissedOccasion.key]?.name_ar : 'المناسبات السعودية'}`,
        estimated_lift: lift,
        timeframe_weeks: 8,
        icon_emoji: '🌙',
      },
    },
    deepDive,
  }
}

function emptyResult(): DimensionResult {
  return {
    dimension: 'cultural_fit', score: 0, weight: 0.30, benchmark: 62, submetrics: {},
    findings: [{ finding_en: 'No posts found.', finding_ar: 'لا توجد منشورات.', evidence_count: 0, evidence_total: 0, benchmark_count: null, severity: 'high' }],
    action: { workflow_id: 'chain_c1', action_label_en: 'Cultural Calendar', action_label_ar: 'التقويم الثقافي', estimated_lift: 20, timeframe_weeks: 8, icon_emoji: '🌙' },
  }
}

function emptyDeepDive(): CulturalDeepDive {
  return {
    language_breakdown: {},
    occasions: [],
    dialect_multiplier: null,
    dialect_multiplier_note_en: 'No data',
    dialect_multiplier_note_ar: 'لا توجد بيانات',
  }
}
