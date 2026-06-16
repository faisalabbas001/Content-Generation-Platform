// Engagement Health scorer — pure math, no AI calls.
// Weight: 15%
// For MVP: saves and DM response time are unavailable without Graph API auth.
// We use comments ratio + follower data as proxy.

import type { ScoringInput, DimensionResult, FindingDraft } from './types'
import { clamp } from './types'

export function scoreEngagementHealth(input: ScoringInput): DimensionResult {
  const posts = input.profile.posts
  const followers = input.profile.followers_count
  const benchmarks = input.benchmarks.engagement_health

  if (posts.length === 0 || followers === 0) {
    return emptyResult()
  }

  const totalComments = posts.reduce((s, p) => s + p.comments_count, 0)
  const totalLikes    = posts.reduce((s, p) => s + p.like_count, 0)

  // ── Comments-to-followers ratio (25%) ────────────────────────────────────
  const commentsRatio = totalComments / posts.length / followers
  const benchmarkCR   = benchmarks['comments_ratio'] ?? 0.012
  const commentsScore = clamp((commentsRatio / benchmarkCR) * 50)

  // ── Save rate proxy (30%) — use like rate as proxy when saves unavailable
  const likesPerPost = totalLikes / posts.length
  const likesRatio   = likesPerPost / followers
  const benchmarkLR  = 0.03   // 3% like rate is typical Saudi F&B
  const saveScore    = clamp((likesRatio / benchmarkLR) * 50)

  // ── Follower growth (20%) — estimated from post recency pattern
  // If we have at least 2 weeks of posts, estimate growth from activity trend
  const recentPosts = posts.filter(p => {
    const age = Date.now() - new Date(p.timestamp).getTime()
    return age < 14 * 24 * 60 * 60 * 1000
  })
  const growthProxy    = recentPosts.length / Math.max(posts.length, 1)
  const growthScore    = clamp(growthProxy * 100)

  // ── DM response (25%) — unavailable without auth; neutral 50
  const dmScore = 50

  // ── Aggregate ─────────────────────────────────────────────────────────────
  const score = Math.round(
    saveScore    * 0.30 +
    dmScore      * 0.25 +
    commentsScore * 0.25 +
    growthScore  * 0.20,
  )

  const benchP50 = benchmarks['overall'] ?? 45

  // ── Findings ──────────────────────────────────────────────────────────────
  const findings: FindingDraft[] = []

  const commentsRatioDisplay = (commentsRatio * 100).toFixed(3)
  const benchmarkCRDisplay   = (benchmarkCR * 100).toFixed(3)
  findings.push({
    finding_en: `Comment rate ${commentsRatioDisplay}% per follower (sector median: ${benchmarkCRDisplay}%).`,
    finding_ar: `معدل التعليقات ${commentsRatioDisplay}% لكل متابع (معيار القطاع: ${benchmarkCRDisplay}%).`,
    evidence_count: totalComments,
    evidence_total: posts.length,
    benchmark_count: Math.round(followers * benchmarkCR * posts.length),
    severity: commentsScore < 30 ? 'high' : commentsScore < 60 ? 'mid' : 'low',
  })

  const avgLikes = Math.round(likesPerPost)
  findings.push({
    finding_en: `Average ${avgLikes} likes per post across ${posts.length} analyzed.`,
    finding_ar: `متوسط ${avgLikes} إعجاباً لكل منشور عبر ${posts.length} منشور محلّل.`,
    evidence_count: avgLikes,
    evidence_total: posts.length,
    benchmark_count: null,
    severity: likesRatio < 0.01 ? 'high' : 'low',
  })

  const lift = 15

  return {
    dimension: 'engagement_health',
    score,
    weight: 0.15,
    benchmark: Math.round(benchP50),
    submetrics: {
      comments_ratio:       Math.round(commentsRatio * 10000) / 10000,
      comments_score:       Math.round(commentsScore),
      likes_ratio:          Math.round(likesRatio * 10000) / 10000,
      save_proxy_score:     Math.round(saveScore),
      avg_likes_per_post:   Math.round(likesPerPost),
      avg_comments_per_post: Math.round(totalComments / posts.length),
      dm_score_note:        'unavailable_without_graph_api',
    },
    findings,
    action: {
      workflow_id: 'workflow_4',
      action_label_en: 'Workflow 4 · UGC Repost + engagement captions',
      action_label_ar: 'سير العمل ٤ · إعادة نشر المحتوى + تعليقات تفاعلية',
      estimated_lift: lift,
      timeframe_weeks: 6,
      icon_emoji: '💬',
    },
  }
}

function emptyResult(): DimensionResult {
  return {
    dimension: 'engagement_health',
    score: 0,
    weight: 0.15,
    benchmark: 45,
    submetrics: {},
    findings: [{
      finding_en: 'Insufficient data to score engagement.',
      finding_ar: 'بيانات غير كافية لتقييم التفاعل.',
      evidence_count: 0, evidence_total: 0, benchmark_count: null, severity: 'mid',
    }],
    action: {
      workflow_id: 'workflow_4',
      action_label_en: 'Boost engagement with UGC content',
      action_label_ar: 'عزّز التفاعل بمحتوى المستخدمين',
      estimated_lift: 15, timeframe_weeks: 6, icon_emoji: '💬',
    },
  }
}
