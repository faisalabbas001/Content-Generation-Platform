'use client'

import { useState } from 'react'
import Link from 'next/link'

// ── Types ─────────────────────────────────────────────────────────────────────
interface CardMeta {
  handle: string; name_en: string | null; name_ar: string | null
  sector_label_en: string; sector_label_ar: string
  city: string | null; neighborhood: string | null; followers_count: number
  overall_score: number; score_tier: string; scanned_at: string
  share_slug: string; posts_analyzed: number
}

interface DimData {
  key: string; name_en: string; name_ar: string; short_en: string
  weight: number; score: number; benchmark: number | null
  findings: Array<{ finding_en: string; finding_ar: string; severity: string }>
  action: { workflow_id: string; label_en: string; label_ar: string; estimated_lift: number; timeframe_weeks: number; icon_emoji: string | null } | null
}

interface CompetitorItem {
  name: string; handle: string; score: number; tier: string
  location_en: string | null; location_ar: string | null
  rank: number; is_focal: boolean
}

interface PhaseAction { label_en: string; label_ar: string; lift: number; workflow_id: string; icon: string | null | undefined }
interface Phase {
  num: number; weeks: string; title_en: string; title_ar: string
  desc_en: string; desc_ar: string
  actions: PhaseAction[]
  score_after: number
}
interface Plan {
  current_score: number; target_score: number; total_lift: number
  leader_gap: number | null; leader_name: string | null
  phases: Phase[]
}

interface Props { card: CardMeta; dimensions: DimData[]; competitors: CompetitorItem[]; plan: Plan }

// ── Helpers ───────────────────────────────────────────────────────────────────
function tierColor(tier: string) {
  if (tier === 'high') return '#3DB88A'
  if (tier === 'mid') return '#C9A84C'
  return '#E5A04C'
}

function scoreColor(score: number) {
  if (score >= 70) return '#3DB88A'
  if (score >= 40) return '#C9A84C'
  return '#E5A04C'
}

// ── Main Component ────────────────────────────────────────────────────────────
export function ReportClient({ card, dimensions, competitors, plan }: Props) {
  const [lang, setLang] = useState<'en' | 'ar'>('en')
  const ar = lang === 'ar'
  const t = <E extends string, A extends string>(en: E, ar_text: A) => ar ? ar_text : en

  const displayName = ar ? (card.name_ar ?? card.name_en ?? card.handle) : (card.name_en ?? card.handle)
  const topComp = competitors.find(c => !c.is_focal && c.rank === 1)
  const myRank = competitors.find(c => c.is_focal)?.rank ?? (competitors.length + 1)

  // Determine the leader gap
  const leaderScore = plan.leader_gap !== null && topComp ? topComp.score : null
  const gapToLeader = leaderScore !== null ? leaderScore - card.overall_score : null

  const cardBg: React.CSSProperties = {
    background: card.score_tier === 'high'
      ? 'radial-gradient(ellipse 500px 300px at 50% 0%, rgba(61,184,138,0.07), transparent 70%), #0A0908'
      : card.score_tier === 'mid'
      ? 'radial-gradient(ellipse 500px 300px at 50% 0%, rgba(201,168,76,0.07), transparent 70%), #0A0908'
      : 'radial-gradient(ellipse 500px 300px at 50% 0%, rgba(229,160,76,0.07), transparent 70%), #0A0908',
  }

  return (
    <div style={{ minHeight: '100vh', ...cardBg, color: '#F0EDE8', fontFamily: 'var(--font-inter)' }} dir={ar ? 'rtl' : 'ltr'}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '0 20px 80px', position: 'relative' }}>

        {/* ── UNLOCKED BAR ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', margin: '16px -20px 0',
          background: 'linear-gradient(90deg, rgba(61,184,138,0.12), rgba(61,184,138,0.04))',
          borderTop: '1px solid rgba(61,184,138,0.25)', borderBottom: '1px solid rgba(61,184,138,0.25)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 24, height: 24, borderRadius: 6,
              background: 'rgba(61,184,138,0.2)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: '#3DB88A', fontSize: 13, fontWeight: 700,
              fontFamily: 'var(--font-jetbrains-mono)',
            }}>✓</div>
            <div>
              <div style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 10, letterSpacing: '0.12em', color: '#3DB88A', fontWeight: 600 }}>
                {t('FULL REPORT · BRAND INTELLIGENCE', 'التقرير الكامل · ذكاء العلامة التجارية')}
              </div>
              <div style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 9, color: '#6B6860', letterSpacing: '0.08em' }}>
                {new Date(card.scanned_at).toLocaleDateString(ar ? 'ar-SA' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, padding: 3, background: '#141312', border: '1px solid #252320', borderRadius: 40 }}>
            {(['en', 'ar'] as const).map(l => (
              <button
                key={l}
                onClick={() => setLang(l)}
                style={{
                  padding: '4px 11px', border: 'none', borderRadius: 30,
                  background: lang === l ? '#E5A04C' : 'transparent',
                  color: lang === l ? '#000' : '#6B6860',
                  fontFamily: l === 'ar' ? 'var(--font-tajawal)' : 'var(--font-jetbrains-mono)',
                  fontSize: l === 'ar' ? 12 : 10, fontWeight: 600, cursor: 'pointer',
                  letterSpacing: l === 'ar' ? 0 : '0.06em',
                }}
              >{l === 'en' ? 'EN' : 'عربي'}</button>
            ))}
          </div>
        </div>

        {/* ── HEADER ── */}
        <header style={{ textAlign: 'center', padding: '40px 0 32px' }}>
          <div style={{
            display: 'inline-block', fontFamily: 'var(--font-jetbrains-mono)', fontSize: 10,
            letterSpacing: '0.22em', color: '#3DB88A', background: 'rgba(61,184,138,0.1)',
            padding: '5px 13px', borderRadius: 40, border: '1px solid rgba(61,184,138,0.25)', marginBottom: 22,
          }}>
            {t('FULL BRAND DNA REPORT · 90-DAY PLAN', 'التقرير الكامل · خطة ٩٠ يوم')}
          </div>
          <h1 style={{ fontFamily: 'var(--font-fraunces)', fontSize: 36, fontWeight: 800, letterSpacing: '-0.025em', lineHeight: 1.05, marginBottom: 4 }}>
            {ar ? (card.name_ar ?? card.name_en ?? card.handle) : (card.name_en ?? card.handle)}
          </h1>
          {card.name_ar && !ar && (
            <div style={{ fontFamily: 'var(--font-tajawal)', fontSize: 18, fontWeight: 700, color: '#A09B92', direction: 'rtl', marginBottom: 12 }}>
              {card.name_ar}
            </div>
          )}
          <div style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 10, color: '#6B6860', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 12 }}>
            {ar ? card.sector_label_ar : card.sector_label_en}
            {card.city && <><span style={{ display: 'inline-block', width: 3, height: 3, borderRadius: '50%', background: '#6B6860', margin: '0 8px', verticalAlign: 'middle' }} />{card.city}{card.neighborhood ? ` · ${card.neighborhood}` : ''}</>}
            <span style={{ display: 'inline-block', width: 3, height: 3, borderRadius: '50%', background: '#6B6860', margin: '0 8px', verticalAlign: 'middle' }} />
            {card.followers_count.toLocaleString()} {t('followers', 'متابع')}
          </div>
        </header>

        {/* ── SCORE SUMMARY GRID ── */}
        <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '32px 0' }}>
          <SummaryCard
            label={t('Your score', 'نتيجتك')}
            num={card.overall_score}
            numColor='#E5A04C'
            bg='rgba(26,15,5,0.8)'
            border='rgba(229,160,76,0.4)'
            sub={myRank > 0 ? t(`RANKED ${myRank} OF ${competitors.length + 1} NEARBY`, `المرتبة ${myRank} من ${competitors.length + 1}`) : t('YOUR BRAND', 'علامتك')}
          />
          <SummaryCard
            label={t('Local leader gap', 'الفجوة مع الأول')}
            num={gapToLeader !== null ? -gapToLeader : 0}
            numColor='#E5667A'
            bg='rgba(229,102,122,0.05)'
            border='rgba(229,102,122,0.3)'
            sub={topComp ? `VS ${topComp.name.toUpperCase()} (${topComp.score})` : t('NO LOCAL DATA YET', 'لا بيانات محلية بعد')}
            prefixSign
          />
          <SummaryCard
            label={t('90-day target', 'هدف ٩٠ يوم')}
            num={plan.target_score}
            numColor='#3DB88A'
            bg='#141312'
            border='#252320'
            sub={t(`+${plan.target_score - card.overall_score} POINTS · LEADER TIER`, `+${plan.target_score - card.overall_score} نقطة · فئة المتصدرين`)}
          />
          <SummaryCard
            label={t('Total recommended actions', 'الإجراءات المقترحة')}
            num={plan.phases.reduce((s, p) => s + p.actions.length, 0)}
            numColor='#F0EDE8'
            bg='#141312'
            border='#252320'
            sub={t('ACROSS 3 PHASES', 'عبر ٣ مراحل')}
          />
        </section>

        {/* ── SECTION 01: COMPETITOR DEEP DIVE ── */}
        <SectionHeader num='01' title={t('Why they beat you', 'ليش هم يتفوقون عليك')} />
        <p style={{ fontSize: 13, color: '#A09B92', marginBottom: 24, lineHeight: 1.6, maxWidth: 480 }}>
          {t(
            'Expand any competitor to see their five-dimension breakdown and exactly what they do better than you. Same scoring engine, same posts analyzed.',
            'افتح أي منافس لتشوف تقسيم النقاط لكل من الأبعاد الخمسة، وش يسوّونه أحسن منك بالضبط. نفس النظام، نفس المنشورات.',
          )}
        </p>

        {competitors.length === 0 && (
          <div style={{ background: '#141312', border: '1px solid #252320', borderRadius: 14, padding: 24, textAlign: 'center', marginBottom: 12 }}>
            <div style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 11, color: '#6B6860', letterSpacing: '0.1em' }}>
              {t('NO COMPETITORS SCORED YET IN YOUR SECTOR · CHECK BACK AFTER MORE BRANDS SCAN', 'لا منافسين مُحلَّلين بعد في قطاعك · تحقق لاحقاً')}
            </div>
          </div>
        )}

        {/* Your brand row */}
        <CompetitorCard
          rank={myRank}
          name={displayName}
          handle={card.handle}
          score={card.overall_score}
          tier={card.score_tier}
          dimensions={dimensions}
          isYou
          lang={lang}
          isFocal
        />

        {competitors.filter(c => !c.is_focal).map(comp => (
          <CompetitorCard
            key={comp.handle}
            rank={comp.rank}
            name={comp.name}
            handle={comp.handle}
            score={comp.score}
            tier={comp.tier}
            dimensions={[]}
            isYou={false}
            lang={lang}
            location={ar ? comp.location_ar : comp.location_en}
            isFocal={false}
            yourDimensions={dimensions}
          />
        ))}

        {/* ── SECTION 02: 90-DAY PLAN ── */}
        <SectionHeader num='02' title={t('Your 90-day plan', 'خطة ٩٠ يوم')} />

        <div style={{
          background: 'linear-gradient(180deg, #141312, #1C1A17)',
          border: '1px solid #252320', borderRadius: 14, padding: 22, marginBottom: 16, position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: -50, right: -50, width: 200, height: 200, background: 'radial-gradient(circle, rgba(61,184,138,0.1), transparent 60%)', pointerEvents: 'none' }} />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12, flexWrap: 'wrap', position: 'relative' }}>
            <span style={{ fontFamily: 'var(--font-fraunces)', fontSize: 40, fontWeight: 800, color: '#E5A04C', lineHeight: 1, letterSpacing: '-0.02em' }}>{card.overall_score}</span>
            <span style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 20, color: '#6B6860' }}>→</span>
            <span style={{ fontFamily: 'var(--font-fraunces)', fontSize: 56, fontWeight: 800, color: '#3DB88A', lineHeight: 1, letterSpacing: '-0.025em', textShadow: '0 0 30px rgba(61,184,138,0.3)' }}>{plan.target_score}</span>
          </div>
          <div style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 10, color: '#A09B92', letterSpacing: '0.1em', marginBottom: 14, textTransform: 'uppercase' }}>
            {t('90-DAY TRANSFORMATION TARGET', 'هدف التحول في ٩٠ يوم')}
          </div>
          <div style={{ fontFamily: 'var(--font-fraunces)', fontSize: 16, color: '#A09B92', fontStyle: 'italic', lineHeight: 1.5, position: 'relative' }}>
            {t(
              `${card.name_en ?? card.handle} can reach leader-tier by fixing ${plan.phases[0]?.actions.length ?? 4} critical gaps in the first 30 days.`,
              `يمكن لـ ${card.name_ar ?? card.name_en ?? card.handle} الوصول لفئة المتصدرين بإصلاح ${plan.phases[0]?.actions.length ?? 4} فجوات حرجة في أول ٣٠ يوم.`,
            )}
          </div>
        </div>

        {plan.phases.map(phase => (
          <PhaseCard key={phase.num} phase={phase} lang={lang} />
        ))}

        {/* ── SECTION 03: METHODOLOGY ── */}
        <SectionHeader num='03' title={t('Methodology', 'المنهجية')} />

        <div style={{ background: '#141312', border: '1px solid #252320', borderRadius: 14, padding: 22, marginBottom: 10 }}>
          <div style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 9, letterSpacing: '0.18em', color: '#6B6860', textTransform: 'uppercase', marginBottom: 14 }}>
            {t('SCORING FORMULA', 'صيغة التقييم')}
          </div>
          <h4 style={{ fontFamily: 'var(--font-fraunces)', fontSize: 18, fontWeight: 700, marginBottom: 12, letterSpacing: '-0.012em' }}>
            {t('How the score is computed', 'كيف تُحسب النتيجة')}
          </h4>
          <p style={{ fontSize: 13, color: '#A09B92', lineHeight: 1.65, marginBottom: 12 }}>
            {t(
              `We analyse the last ${card.posts_analyzed} posts published by the account using Claude Haiku 4.5 (vision) for visual signals and DeepSeek V3 for language and cultural context. The final score is a weighted average of five dimensions.`,
              `نحلل آخر ${card.posts_analyzed} منشور باستخدام Claude Haiku 4.5 (رؤية) للإشارات البصرية وDeepSeek V3 للغة والسياق الثقافي. النتيجة النهائية هي متوسط موزون لخمسة أبعاد.`,
            )}
          </p>
          <div style={{
            fontFamily: 'var(--font-jetbrains-mono)', fontSize: 13,
            background: '#0F0D0B', border: '1px solid #252320',
            padding: 14, borderRadius: 10, color: '#F0EDE8',
            margin: '12px 0', letterSpacing: '0.02em', textAlign: 'center', lineHeight: 1.8, direction: 'ltr',
          }}>
            <span style={{ color: '#E5A04C', fontWeight: 600 }}>Score</span> = VQ×<span style={{ color: '#3DB88A' }}>0.20</span> + CF×<span style={{ color: '#3DB88A' }}>0.30</span> + PC×<span style={{ color: '#3DB88A' }}>0.15</span> + BC×<span style={{ color: '#3DB88A' }}>0.20</span> + EH×<span style={{ color: '#3DB88A' }}>0.15</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 12 }}>
            {[
              { name: t('Visual Quality', 'جودة الصور'), pct: '20%', short: 'VQ' },
              { name: t('Cultural Fit', 'الملاءمة الثقافية'), pct: '30%', short: 'CF' },
              { name: t('Posting Consistency', 'انتظام النشر'), pct: '15%', short: 'PC' },
              { name: t('Brand Coherence', 'تماسك الهوية'), pct: '20%', short: 'BC' },
              { name: t('Engagement Health', 'صحة التفاعل'), pct: '15%', short: 'EH' },
            ].map(row => (
              <div key={row.short} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', background: '#0F0D0B', borderRadius: 8, border: '1px solid #252320' }}>
                <span style={{ fontSize: 12, color: '#A09B92' }}>{row.name}</span>
                <span style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 13, fontWeight: 700, color: '#E5A04C' }}>{row.pct}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: '#141312', border: '1px solid #252320', borderRadius: 14, padding: 22, marginBottom: 10 }}>
          <div style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 9, letterSpacing: '0.18em', color: '#6B6860', textTransform: 'uppercase', marginBottom: 14 }}>
            {t('DATASET & MODEL STACK', 'البيانات وحزمة النماذج')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
            {[
              { label: t('Posts Analysed', 'منشورات محللة'), num: card.posts_analyzed, note: t('this brand', 'هذه العلامة') },
              { label: t('Benchmark Dataset', 'مجموعة المقاييس'), num: '1,247', note: t('Saudi accounts', 'حساب سعودي') },
              { label: t('Vision Model', 'نموذج الرؤية'), num: 'Haiku', note: 'Claude 4.5' },
              { label: t('Language Model', 'نموذج اللغة'), num: 'DS V3', note: 'DeepSeek V3' },
            ].map(cell => (
              <div key={cell.label} style={{ background: '#0F0D0B', border: '1px solid #252320', borderRadius: 10, padding: 14 }}>
                <div style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 9, color: '#6B6860', letterSpacing: '0.1em', marginBottom: 8, textTransform: 'uppercase' }}>{cell.label}</div>
                <div style={{ fontFamily: 'var(--font-fraunces)', fontSize: 26, fontWeight: 800, color: '#F0EDE8', lineHeight: 1, letterSpacing: '-0.02em' }}>{cell.num}</div>
                <div style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 9, color: '#6B6860', marginTop: 6, letterSpacing: '0.04em' }}>{cell.note}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── CTAs ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '40px 0 20px' }}>
          <Link
            href='/signup'
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: '17px 24px', borderRadius: 12,
              background: '#3DB88A', color: '#000',
              fontFamily: ar ? 'var(--font-tajawal)' : 'var(--font-jetbrains-mono)',
              fontSize: ar ? 14 : 12, fontWeight: 700,
              letterSpacing: ar ? 0 : '0.08em', textTransform: ar ? 'none' : 'uppercase',
              textDecoration: 'none', boxShadow: '0 0 24px rgba(61,184,138,0.3)',
            }}
          >
            {t('START FREE TRIAL → GET CONTENT WORKFLOWS', 'ابدأ التجربة المجانية ← احصل على سير العمل')}
          </Link>
          <a
            href={`https://wa.me/966500000000?text=${encodeURIComponent(`Hi, I want to discuss the full report for @${card.handle}`)}`}
            target='_blank' rel='noopener noreferrer'
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: '17px 24px', borderRadius: 12,
              background: '#25D366', color: '#000',
              fontFamily: ar ? 'var(--font-tajawal)' : 'var(--font-jetbrains-mono)',
              fontSize: ar ? 14 : 12, fontWeight: 700,
              letterSpacing: ar ? 0 : '0.08em', textTransform: ar ? 'none' : 'uppercase',
              textDecoration: 'none', boxShadow: '0 0 24px rgba(37,211,102,0.25)',
            }}
          >
            💬 {t('TALK TO A SAUDI BRAND STRATEGIST', 'تحدث مع مستشار علامات تجارية سعودية')}
          </a>
          <Link
            href={`/score-cards/${card.share_slug}`}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: '17px 24px', borderRadius: 12,
              background: 'transparent', color: '#A09B92',
              border: '1px solid #252320',
              fontFamily: ar ? 'var(--font-tajawal)' : 'var(--font-jetbrains-mono)',
              fontSize: ar ? 14 : 12, fontWeight: 600,
              letterSpacing: ar ? 0 : '0.06em', textTransform: ar ? 'none' : 'uppercase',
              textDecoration: 'none',
            }}
          >
            ← {t('BACK TO SCORE CARD', 'العودة إلى بطاقة النقاط')}
          </Link>
        </div>

        {/* ── FOOTER ── */}
        <footer style={{ textAlign: 'center', padding: '40px 20px 20px', fontFamily: 'var(--font-jetbrains-mono)', fontSize: 10, color: '#6B6860', letterSpacing: '0.05em', lineHeight: 1.7 }}>
          <div style={{ width: 40, height: 1, background: '#252320', margin: '12px auto' }} />
          <div>OGz AI · Saudi Brand Intelligence</div>
          <div style={{ marginTop: 4 }}>Powered by Claude Haiku 4.5 · DeepSeek V3</div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 8,
            padding: '6px 12px', border: '1px dashed rgba(61,184,138,0.4)',
            borderRadius: 20, color: '#3DB88A', fontSize: 9, letterSpacing: '0.08em',
          }}>
            ✓ {t('SAUDI MARKET CALIBRATED', 'معايَر للسوق السعودي')}
          </div>
        </footer>

      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryCard({ label, num, numColor, bg, border, sub, prefixSign }: {
  label: string; num: number; numColor: string; bg: string; border: string; sub: string; prefixSign?: boolean
}) {
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: 18, textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 9, letterSpacing: '0.15em', color: '#6B6860', marginBottom: 8, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-fraunces)', fontSize: 52, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.03em', color: numColor }}>
        {prefixSign && num < 0 ? '' : prefixSign && num > 0 ? '+' : ''}{prefixSign ? `−${Math.abs(num)}` : num}
      </div>
      <div style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 10, color: '#A09B92', marginTop: 6, letterSpacing: '0.04em' }}>{sub}</div>
    </div>
  )
}

function SectionHeader({ num, title }: { num: string; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '56px 0 6px' }}>
      <span style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 10, color: '#3DB88A', letterSpacing: '0.15em', fontWeight: 600 }}>{num}</span>
      <h2 style={{ fontFamily: 'var(--font-fraunces)', fontSize: 24, fontWeight: 800, letterSpacing: '-0.018em' }}>{title}</h2>
      <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, #252320, transparent)' }} />
    </div>
  )
}

function CompetitorCard({ rank, name, handle, score, tier, dimensions, isYou, lang, location, isFocal, yourDimensions }: {
  rank: number; name: string; handle: string; score: number; tier: string
  dimensions: DimData[]; isYou: boolean; lang: 'en' | 'ar'
  location?: string | null; isFocal: boolean; yourDimensions?: DimData[]
}) {
  const [open, setOpen] = useState(isYou)
  const ar = lang === 'ar'
  const color = scoreColor(score)

  const dimOrder = ['visual_quality', 'cultural_fit', 'posting_consistency', 'brand_coherence', 'engagement_health']
  const shortLabels: Record<string, string> = { visual_quality: 'VQ', cultural_fit: 'CF', posting_consistency: 'PC', brand_coherence: 'BC', engagement_health: 'EH' }

  return (
    <div style={{
      background: isYou ? 'rgba(26,15,5,0.8)' : '#141312',
      border: `1px solid ${isYou ? 'rgba(229,160,76,0.3)' : '#252320'}`,
      borderRadius: 14, marginBottom: 12, overflow: 'hidden',
    }}>
      <div
        style={{ display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 12, alignItems: 'center', padding: '16px 18px', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 11, color: '#6B6860', fontWeight: 700, letterSpacing: '0.05em' }}>#{rank}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#F0EDE8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {name}{isYou && <span style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 8, color: '#E5A04C', background: 'rgba(229,160,76,0.15)', padding: '2px 6px', borderRadius: 4, marginInlineStart: 8 }}>{ar ? 'أنت' : 'YOU'}</span>}
          </div>
          <div style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 10, color: '#6B6860', letterSpacing: '0.04em', marginTop: 3 }}>
            @{handle}{location ? ` · ${location}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 22, fontWeight: 700, color }}>{score}</span>
          <span style={{ fontSize: 11, color: '#6B6860', transition: 'transform 0.2s', display: 'inline-block', transform: open ? 'rotate(180deg)' : 'none' }}>▾</span>
        </div>
      </div>

      {open && (
        <div style={{ padding: '0 18px 18px', borderTop: '1px solid #252320' }}>
          {/* Dimension breakdown */}
          {dimensions.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, paddingTop: 16, marginBottom: 16 }}>
              {dimOrder.map(key => {
                const dim = dimensions.find(d => d.key === key)
                const sc = dim?.score ?? 0
                return (
                  <div key={key} style={{ textAlign: 'center', padding: '10px 6px', background: 'rgba(0,0,0,0.2)', borderRadius: 8, border: '1px solid #252320' }}>
                    <div style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 8, letterSpacing: '0.05em', color: '#6B6860', marginBottom: 4, textTransform: 'uppercase' }}>{shortLabels[key]}</div>
                    <div style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 16, fontWeight: 700, color: scoreColor(sc) }}>{sc}</div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Insights comparing to this brand vs focal brand */}
          {!isFocal && yourDimensions && yourDimensions.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {dimOrder.slice(0, 2).map(key => {
                const yourDim = yourDimensions.find(d => d.key === key)
                if (!yourDim) return null
                const gap = score - yourDim.score
                const isAhead = gap > 10
                return (
                  <div key={key} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '12px 14px',
                    background: isAhead ? 'rgba(229,160,76,0.06)' : 'rgba(61,184,138,0.06)',
                    border: `1px solid ${isAhead ? 'rgba(229,160,76,0.2)' : 'rgba(61,184,138,0.2)'}`,
                    borderRadius: 10,
                  }}>
                    <div style={{
                      fontSize: 11, width: 20, height: 20, borderRadius: 5,
                      background: isAhead ? 'rgba(229,160,76,0.15)' : 'rgba(61,184,138,0.15)',
                      color: isAhead ? '#E5A04C' : '#3DB88A',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, flexShrink: 0, fontFamily: 'var(--font-jetbrains-mono)',
                    }}>{isAhead ? '↑' : '✓'}</div>
                    <div style={{ fontSize: 12, color: '#A09B92', lineHeight: 1.5 }}>
                      <strong style={{ color: '#F0EDE8', fontWeight: 600 }}>
                        {ar ? yourDim.name_ar : yourDim.name_en}: {yourDim.score} vs {score}
                      </strong>
                      {' '}{isAhead
                        ? (ar ? `— متقدمون عليك بـ ${gap} نقطة في هذا البُعد.` : `— they lead you by ${gap} points in this dimension.`)
                        : (ar ? `— أنت في المقدمة هنا.` : `— you lead here.`)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PhaseCard({ phase, lang }: { phase: Phase; lang: 'en' | 'ar' }) {
  const ar = lang === 'ar'
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '56px 1fr', gap: 14,
      background: '#141312', border: '1px solid #252320', borderRadius: 14,
      padding: 18, marginBottom: 10,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 2 }}>
        <div style={{ fontFamily: 'var(--font-fraunces)', fontSize: 32, fontWeight: 800, color: '#3DB88A', lineHeight: 1, letterSpacing: '-0.02em' }}>{phase.num}</div>
        <div style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 8, color: '#6B6860', letterSpacing: '0.1em', marginTop: 2, textTransform: 'uppercase' }}>{ar ? 'مرحلة' : 'PHASE'}</div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 10, color: '#3DB88A', letterSpacing: '0.1em', marginBottom: 5, textTransform: 'uppercase', fontWeight: 600 }}>
          {ar ? `أسبوع ${phase.weeks}` : `WEEKS ${phase.weeks}`}
        </div>
        <h3 style={{ fontFamily: 'var(--font-fraunces)', fontSize: 18, fontWeight: 700, color: '#F0EDE8', marginBottom: 8, letterSpacing: '-0.015em', lineHeight: 1.2 }}>
          {ar ? phase.title_ar : phase.title_en}
        </h3>
        <p style={{ fontSize: 12, color: '#A09B92', lineHeight: 1.55, marginBottom: 12 }}>
          {ar ? phase.desc_ar : phase.desc_en}
        </p>

        {phase.actions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
            {phase.actions.map((action, i) => (
              <div key={action.workflow_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#F0EDE8', padding: '6px 0' }}>
                <span style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 9, color: '#6B6860', width: 16, flexShrink: 0 }}>{i + 1}</span>
                <span style={{ flex: 1 }}>
                  <strong style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 9, color: '#3DB88A', background: 'rgba(61,184,138,0.1)', padding: '2px 6px', borderRadius: 4, marginInlineEnd: 6, letterSpacing: '0.04em' }}>+{action.lift}</strong>
                  {ar ? action.label_ar : action.label_en}
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'rgba(61,184,138,0.06)', border: '1px solid rgba(61,184,138,0.2)', borderRadius: 8 }}>
          <span style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 10, color: '#A09B92', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {ar ? 'النتيجة المتوقعة' : 'PROJECTED SCORE'}
          </span>
          <span style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 14, fontWeight: 700, color: '#3DB88A', letterSpacing: '0.04em' }}>{phase.score_after}/100</span>
        </div>
      </div>
    </div>
  )
}
