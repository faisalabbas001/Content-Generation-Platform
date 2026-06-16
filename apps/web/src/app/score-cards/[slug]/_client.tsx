'use client'

import { useState } from 'react'
import type { ScoreCardPageData } from './page'

// ── Score helpers ──────────────────────────────────────────────────────────────
function scoreColor(s: number) {
  return s >= 70 ? 'text-emerald-400' : s >= 40 ? 'text-amber-400' : 'text-orange-400'
}
function scoreBg(s: number) {
  return s >= 70 ? 'bg-emerald-400' : s >= 40 ? 'bg-amber-400' : 'bg-orange-400'
}
function tierPalette(tier: string) {
  if (tier === 'high') return { hex: '#3DB88A', ring: 'ring-emerald-500/30', glow: 'shadow-emerald-500/20' }
  if (tier === 'mid')  return { hex: '#C9A84C', ring: 'ring-amber-500/30',   glow: 'shadow-amber-500/20'   }
  return                       { hex: '#E5A04C', ring: 'ring-orange-500/30',  glow: 'shadow-orange-500/20'  }
}

const OCCASION_ICONS: Record<string, string> = {
  ramadan: '🌙', eid_fitr: '🕌', eid_adha: '🐑',
  national_day: '🇸🇦', founding_day: '⚔️', mothers_day: '🌸',
}
const OCCASION_NAMES: Record<string, { en: string; ar: string }> = {
  ramadan:      { en: 'Ramadan',   ar: 'رمضان'    },
  eid_fitr:     { en: 'Eid Fitr',  ar: 'عيد الفطر' },
  eid_adha:     { en: 'Eid Adha',  ar: 'عيد الأضحى'},
  national_day: { en: "Nat'l Day", ar: 'وطني'      },
  founding_day: { en: 'Founding',  ar: 'تأسيس'     },
  mothers_day:  { en: "Mother's",  ar: 'يوم الأم'  },
}
const DIM_ORDER = ['visual_quality','cultural_fit','posting_consistency','brand_coherence','engagement_health']
const DIM_EMOJI: Record<string,string> = {
  visual_quality:'📸', cultural_fit:'🌙', posting_consistency:'📅', brand_coherence:'🎨', engagement_health:'💬',
}
const DIM_WEIGHT: Record<string,{en:string;ar:string}> = {
  visual_quality:      { en:'20% · photography & composition',       ar:'وزن ٢٠٪ · تصوير وتكوين'           },
  cultural_fit:        { en:'30% · what global tools can\'t measure', ar:'وزن ٣٠٪ · ما تقيسه أي أداة عالمية'},
  posting_consistency: { en:'15% · cadence & prime-time hit rate',    ar:'وزن ١٥٪ · إيقاع وأوقات الذروة'    },
  brand_coherence:     { en:'20% · visual & voice consistency',       ar:'وزن ٢٠٪ · تناسق بصري وصوتي'       },
  engagement_health:   { en:'15% · signal, not vanity',               ar:'وزن ١٥٪ · إشارة حقيقية'            },
}

// Deterministic sparkline (no random, SSR-safe)
function Sparkline({ color, seed }: { color: string; seed: number }) {
  const pts = [2,12,22,32,42,52,62,72,78].map((x,i) => `${x},${8+((seed*(i+1)*13)%14)}`).join(' ')
  const [lx, ly] = (pts.split(' ').pop()!).split(',')
  return (
    <svg width="80" height="24" viewBox="0 0 80 24" className="shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
      <circle cx={lx} cy={ly} r="2.5" fill={color}/>
    </svg>
  )
}

export function ScoreCardClient({ data }: { data: ScoreCardPageData }) {
  const [lang, setLang]       = useState<'en'|'ar'>('en')
  const [methodOpen, setMethod] = useState(false)
  const [copied, setCopied]   = useState(false)

  const { brand, overall_score, score_tier, competitors, dimensions, cultural_deepdive, methodology } = data
  const isAr = lang === 'ar'
  const pal  = tierPalette(score_tier)

  // nearest competitor above focal brand
  const focalRank = competitors.find(c => c.is_focal)?.rank ?? 99
  const nearest   = [...competitors].sort((a,b) => b.score - a.score).find(c => !c.is_focal && c.score > overall_score)

  function copyLink() {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }
  function shareWA() {
    const name = brand.name_en ?? `@${brand.handle}`
    const delta = nearest ? ` (${nearest.score - overall_score} pts behind ${nearest.name})` : ''
    const deltaAr = nearest ? ` (${nearest.score - overall_score} نقطة وراء ${nearest.name})` : ''
    const msg = isAr
      ? `شفت نتيجة ${name}؟ ${overall_score} من ١٠٠${deltaAr}. شوف بنفسك: ${window.location.href}`
      : `${name} scored ${overall_score}/100 on Brand DNA${delta}. See the breakdown: ${window.location.href}`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }

  return (
    <div
      dir={isAr ? 'rtl' : 'ltr'}
      className="min-h-screen text-[#F0EDE8]"
      style={{
        background: `radial-gradient(ellipse 700px 500px at 50% -150px, ${pal.hex}18, transparent 65%),
                     radial-gradient(ellipse 500px 700px at 100% 40%, ${pal.hex}08, transparent 65%),
                     #0A0908`,
        backgroundAttachment: 'fixed',
        fontFamily: isAr ? 'var(--font-tajawal), var(--font-inter), sans-serif' : 'var(--font-inter), sans-serif',
      }}
    >
      <div className="mx-auto max-w-[520px] px-5 pb-20">

        {/* ── Sticky nav ─────────────────────────────────────────────────── */}
        <nav className="sticky top-0 z-20 flex items-center justify-between py-4"
          style={{ background: 'linear-gradient(180deg, #0A0908 75%, transparent)' }}>
          <a href="/score-cards" className="font-mono text-[10px] tracking-[0.2em] text-[#6B6860] hover:text-[#A09B92] transition-colors">
            score.<span style={{ color: pal.hex }}>ogzai</span>.com
            <span className="text-[#3A3733]"> / </span>
            <span className="text-[#A09B92]">{brand.handle}</span>
          </a>
          <div className="flex gap-1 rounded-full border border-[#252320] bg-[#141312] p-0.5">
            {(['en','ar'] as const).map(l => (
              <button key={l} onClick={() => setLang(l)}
                className="rounded-full px-3 py-1.5 text-[10px] font-semibold transition-all duration-150 cursor-pointer"
                style={{
                  background: lang === l ? pal.hex : 'transparent',
                  color: lang === l ? '#000' : '#6B6860',
                  fontFamily: l === 'ar' ? 'var(--font-tajawal)' : 'var(--font-jetbrains-mono)',
                  fontSize: l === 'ar' ? 12 : 10,
                  letterSpacing: l === 'ar' ? 0 : '0.06em',
                  border: 'none',
                }}>
                {l === 'en' ? 'EN' : 'عربي'}
              </button>
            ))}
          </div>
        </nav>

        {/* ── Status warning banner ──────────────────────────────────────── */}
        {(data as unknown as Record<string,unknown>)['score_status'] === 'preliminary' && (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-center font-mono text-[11px] text-amber-400">
            ⚠️ {isAr ? 'نتيجة أولية — أكمل ١٠ منشورات أو أكثر لنتيجة دقيقة' : 'Preliminary score — post 10+ times for a sharper result'}
          </div>
        )}
        {(data as unknown as Record<string,unknown>)['score_status'] === 'stale' && (
          <div className="mb-4 rounded-xl border border-orange-500/30 bg-orange-500/8 px-4 py-3 text-center font-mono text-[11px] text-orange-400">
            📅 {isAr ? 'آخر نشاط قبل ٩٠+ يوم — النتيجة قد لا تعكس الوضع الحالي' : 'No posts for 90+ days — score may not reflect current activity'}
          </div>
        )}

        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <section className="pt-8 pb-4 text-center">
          {/* Badge */}
          <div className="mb-6 inline-block rounded-full border px-3 py-1 font-mono text-[10px] tracking-[0.2em] uppercase"
            style={{ color: pal.hex, background: `${pal.hex}18`, borderColor: `${pal.hex}40` }}>
            {isAr ? 'هوية العلامة · ٢٠٢٦' : 'BRAND DNA SCORE · 2026'}
          </div>

          {/* Brand name */}
          <h1 className="mb-1 text-4xl font-extrabold tracking-tight leading-none"
            style={{ fontFamily: 'var(--font-fraunces), Georgia, serif' }}>
            {brand.name_en ?? brand.handle}
          </h1>
          {brand.name_ar && (
            <p className="mb-4 text-xl font-bold text-[#A09B92]"
              style={{ fontFamily: 'var(--font-tajawal)', direction: 'rtl' }}>
              {brand.name_ar}
            </p>
          )}

          {/* Meta row */}
          <div className="mb-12 flex flex-wrap items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-widest text-[#6B6860]">
            <span>{isAr ? brand.sector_label_ar : brand.sector_label_en}</span>
            {brand.city && <><span className="text-[#252320]">·</span><span>{brand.city}{brand.neighborhood ? ` · ${brand.neighborhood}` : ''}</span></>}
            {brand.followers_count > 0 && <><span className="text-[#252320]">·</span><span>{brand.followers_count.toLocaleString()} {isAr ? 'متابع' : 'followers'}</span></>}
          </div>

          {/* Big score number */}
          <div className="relative py-4">
            {/* Glow backdrop */}
            <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-full"
              style={{ width: 360, height: 360, background: `radial-gradient(circle, ${pal.hex}22 0%, transparent 60%)` }}/>

            <p className="relative z-10 font-mono text-[11px] uppercase tracking-[0.25em] text-[#6B6860] mb-3">
              {isAr ? 'نتيجتك' : 'YOUR SCORE'}
            </p>
            <div className="relative z-10 leading-none mb-2 font-extrabold"
              style={{
                fontFamily: 'var(--font-fraunces), Georgia, serif',
                fontSize: 'clamp(100px, 30vw, 160px)',
                color: pal.hex,
                letterSpacing: '-0.05em',
                textShadow: `0 0 60px ${pal.hex}55`,
                fontVariantNumeric: 'tabular-nums',
              }}>
              {overall_score}
            </div>
            <p className="relative z-10 font-mono text-[13px] tracking-[0.15em] text-[#6B6860] mb-6">/ 100</p>

            {/* Competitor anchor */}
            {nearest && (
              <div className="relative z-10 inline-flex items-center gap-3 rounded-xl border border-[rgba(229,102,122,0.3)] bg-[rgba(229,102,122,0.08)] px-4 py-2.5 text-left">
                <span className="text-sm font-bold text-[#E5667A]">▼</span>
                <div>
                  <p className="text-[13px] text-[#A09B92]">
                    {isAr
                      ? <><strong className="text-white">{nearest.score - overall_score} نقطة وراء {nearest.name}</strong> ({nearest.score})</>
                      : <><strong className="text-white">{nearest.score - overall_score} pts behind {nearest.name}</strong> ({nearest.score})</>
                    }
                  </p>
                  {(nearest.location_label_en || nearest.location_label_ar) && (
                    <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-[#6B6860]">
                      {isAr ? nearest.location_label_ar : nearest.location_label_en}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Competitor strip ───────────────────────────────────────────── */}
        {competitors.length > 0 && (
          <section className="mt-10">
            <SectionHeader num="01" isAr={isAr} color={pal.hex}
              en="Your neighborhood" ar="منطقتك" />
            <div className="flex flex-col gap-1.5 mb-8">
              {[...competitors].sort((a,b) => a.rank - b.rank).map(c => {
                const cc = c.score >= 70 ? '#3DB88A' : c.score >= 40 ? '#C9A84C' : '#E5A04C'
                return (
                  <div key={c.handle}
                    className="grid items-center gap-2.5 rounded-xl border p-3"
                    style={{
                      gridTemplateColumns: '1fr 80px 36px',
                      background: c.is_focal ? `${pal.hex}0A` : '#141312',
                      borderColor: c.is_focal ? `${pal.hex}66` : '#252320',
                      borderLeftWidth: c.is_focal ? 3 : 1,
                    }}>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-[#F0EDE8]">
                        {c.is_focal ? (isAr ? `${c.name} (أنت)` : `${c.name} (you)`) : c.name}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] tracking-wide text-[#6B6860] truncate">
                        {isAr ? c.location_label_ar : c.location_label_en}
                      </p>
                    </div>
                    <div className="h-[5px] rounded-full bg-[#252320] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${c.score}%`, background: cc }}/>
                    </div>
                    <p className="text-right font-mono text-sm font-bold tabular-nums" style={{ color: cc }}>{c.score}</p>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ── Dimensions ─────────────────────────────────────────────────── */}
        <section className="mt-2">
          <SectionHeader num="02" isAr={isAr} color={pal.hex}
            en="Where the number comes from" ar="من وين جا هالرقم" />

          {DIM_ORDER.map((key, idx) => {
            const dim = dimensions.find(d => d.key === key)
            if (!dim) return null
            const dc  = dim.score >= 70 ? '#3DB88A' : dim.score >= 40 ? '#C9A84C' : '#E5A04C'
            const sub = dim.submetrics as Record<string,unknown>

            let sparkLabel = `${methodology.posts_analyzed} posts`
            if (key === 'posting_consistency' && sub['posts_per_week']) sparkLabel = `${Number(sub['posts_per_week']).toFixed(1)} posts/week`
            if (key === 'engagement_health'   && sub['growth_proxy'])   sparkLabel = `${Number(sub['growth_proxy']).toFixed(1)}%/mo`
            if (key === 'brand_coherence'     && sub['font_variations']) sparkLabel = isAr ? `${sub['font_variations']} خطوط` : `${sub['font_variations']} fonts`
            if (key === 'cultural_fit' && cultural_deepdive?.language_breakdown) {
              const lb = cultural_deepdive.language_breakdown
              const msa = lb['msa'] ?? 0
              const d2  = (lb['najdi']??0)+(lb['hejazi']??0)+(lb['eastern']??0)
              sparkLabel = isAr ? `${msa} فصحى / ${d2} لهجة` : `${msa} MSA / ${d2} dialect`
            }

            return (
              <div key={key}>
                {/* Dim card */}
                <div className="mb-3 rounded-2xl border border-[#252320] bg-[#141312] p-5">
                  {/* Head */}
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-[18px] font-extrabold leading-tight tracking-tight text-[#F0EDE8]"
                        style={{ fontFamily: 'var(--font-fraunces), Georgia, serif' }}>
                        {isAr ? dim.name_ar : dim.name_en}
                      </h3>
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[#6B6860]">
                        {isAr ? DIM_WEIGHT[key]?.ar : DIM_WEIGHT[key]?.en}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[38px] font-extrabold leading-none tabular-nums"
                        style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', color: dc }}>
                        {dim.score}
                      </div>
                      <p className="mt-1 font-mono text-[10px] tracking-widest text-[#6B6860]">/100</p>
                    </div>
                  </div>

                  {/* Sparkline row */}
                  <div className="mb-4 flex items-center gap-2.5 border-b border-[#252320] pb-4">
                    <Sparkline color={dc} seed={idx + 3}/>
                    <span className="font-mono text-[10px] tracking-wide text-[#6B6860]">{sparkLabel}</span>
                    {dim.benchmark && (
                      <span className="font-mono text-[10px] text-[#A09B92] ms-auto">
                        {isAr ? `المعيار: ${dim.benchmark}` : `Benchmark: ${dim.benchmark}`}
                      </span>
                    )}
                  </div>

                  {/* Findings */}
                  <div className="space-y-2 mb-3">
                    {dim.findings.slice(0,2).map((f,fi) => (
                      <p key={fi} className="text-[13px] leading-relaxed text-[#A09B92]">
                        {isAr ? f.finding_ar : f.finding_en}
                      </p>
                    ))}
                  </div>

                  {/* Action */}
                  {dim.action && (
                    <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3.5 py-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-xs">
                        {dim.action.icon_emoji ?? DIM_EMOJI[key]}
                      </span>
                      <div className="min-w-0 flex-1 text-[12px] leading-relaxed text-[#A09B92]">
                        <strong className="text-emerald-400">
                          {isAr ? dim.action.label_ar : dim.action.label_en}
                        </strong>
                        {' — '}
                        {isAr ? `تحسن متوقع خلال ${dim.action.timeframe_weeks} أسابيع` : `est. lift in ${dim.action.timeframe_weeks}w`}
                      </div>
                      <span className="shrink-0 font-mono text-[12px] font-bold text-emerald-400">+{dim.action.estimated_lift}</span>
                    </div>
                  )}
                </div>

                {/* Cultural deepdive — after cultural_fit card */}
                {key === 'cultural_fit' && cultural_deepdive && (
                  <div className="mb-3 overflow-hidden rounded-2xl border border-[#252320] bg-gradient-to-b from-[#141312] to-[#1C1A17] p-6 relative">
                    <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full"
                      style={{ background: 'radial-gradient(circle, rgba(124,106,245,0.12), transparent 60%)' }}/>
                    <span className="mb-4 inline-block rounded-full border border-[rgba(152,131,255,0.3)] bg-[rgba(124,106,245,0.12)] px-3 py-1 font-mono text-[9px] uppercase tracking-[0.2em] text-[#9883FF]">
                      {isAr ? '↓ الملاءمة الثقافية · تفصيل' : '↓ Cultural Fit · deep dive'}
                    </span>
                    <h4 className="mb-5 text-[20px] font-extrabold leading-tight tracking-tight text-[#F0EDE8]"
                      style={{ fontFamily: 'var(--font-fraunces), Georgia, serif' }}>
                      {isAr ? 'هذا الشي ما تقدر أي أداة عالمية تقيسه لك.' : 'What no global tool can measure for you.'}
                    </h4>

                    {/* Language bar */}
                    <div className="mb-5 border-b border-[#252320] pb-5">
                      <p className="mb-3 font-mono text-[9px] uppercase tracking-[0.15em] text-[#6B6860]">
                        {isAr ? 'لغة الكابشن · آخر ٣٠ منشور' : 'Caption language · last 30 posts'}
                      </p>
                      <LanguageBar breakdown={cultural_deepdive.language_breakdown} isAr={isAr}/>
                    </div>

                    {/* Occasions */}
                    {cultural_deepdive.occasions.length > 0 && (
                      <div className="mb-5 border-b border-[#252320] pb-5">
                        <p className="mb-3 font-mono text-[9px] uppercase tracking-[0.15em] text-[#6B6860]">
                          {isAr ? 'المناسبات السعودية · آخر ١٢ شهر' : 'Saudi cultural moments · past 12 months'}
                        </p>
                        <OccasionGrid occasions={cultural_deepdive.occasions} isAr={isAr}/>
                      </div>
                    )}

                    {/* Dialect multiplier */}
                    {cultural_deepdive.dialect_multiplier !== null && (
                      <div>
                        <p className="mb-3 font-mono text-[9px] uppercase tracking-[0.15em] text-[#6B6860]">
                          {isAr ? 'أثر اللهجة على التفاعل' : 'Dialect engagement multiplier'}
                        </p>
                        <div className="flex items-baseline gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3.5">
                          <div className="shrink-0">
                            <span className="text-[32px] font-extrabold leading-none tabular-nums text-emerald-400"
                              style={{ fontFamily: 'var(--font-fraunces), Georgia, serif' }}>
                              {cultural_deepdive.dialect_multiplier.toFixed(1)}
                            </span>
                            <span className="text-base font-semibold text-emerald-400"
                              style={{ fontFamily: 'var(--font-fraunces)' }}>×</span>
                          </div>
                          <p className="flex-1 text-[12px] leading-relaxed text-[#A09B92]">
                            {isAr ? cultural_deepdive.dialect_multiplier_note_ar : cultural_deepdive.dialect_multiplier_note_en}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </section>

        {/* ── Methodology ────────────────────────────────────────────────── */}
        <div className="mt-6 overflow-hidden rounded-2xl border border-[#252320] bg-[#141312]">
          <button onClick={() => setMethod(o => !o)}
            className="flex w-full cursor-pointer items-center justify-between border-none bg-transparent px-5 py-4 text-left"
            style={{ color: '#F0EDE8' }}>
            <span className="font-mono text-[11px] uppercase tracking-widest text-[#A09B92]">
              {isAr ? 'كيف حسبنا هذا' : 'How we calculated this'}
            </span>
            <span className="text-[11px] text-[#6B6860] transition-transform duration-200"
              style={{ transform: methodOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
          </button>
          {methodOpen && (
            <div className="px-5 pb-5 space-y-0">
              {[
                [isAr ? 'المنشورات'   : 'Posts analyzed',  `${methodology.posts_analyzed} most recent`],
                [isAr ? 'التحليل البصري' : 'Visual analysis', methodology.vision_pipeline],
                [isAr ? 'تحليل اللغة'  : 'Arabic NLP',     methodology.nlp_pipeline],
                [isAr ? 'المعيار'      : 'Benchmark',       `${methodology.benchmark_dataset_size.toLocaleString()} Saudi brands`],
                [isAr ? 'الأوزان'     : 'Weighting',       'VQ 20 · CF 30 · PC 15 · BC 20 · EH 15'],
                [isAr ? 'آخر تحديث'   : 'Last refresh',    new Date(methodology.last_refresh).toLocaleDateString('en-SA')],
                [isAr ? 'المعادلة'    : 'Formula',         'Σ(dim × weight) / 100'],
              ].map(([label, val], i, arr) => (
                <div key={i} className={`flex justify-between py-2 text-[11px] ${i < arr.length - 1 ? 'border-b border-dashed border-[#252320]' : ''}`}>
                  <span className="font-mono text-[#6B6860]">{label}</span>
                  <span className="font-mono font-medium text-[#F0EDE8]">{val}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── CTAs ───────────────────────────────────────────────────────── */}
        <div className="mt-8 flex flex-col gap-2.5">
          <button onClick={shareWA}
            className="flex cursor-pointer items-center justify-center gap-2.5 rounded-xl border-none py-4 font-mono text-[12px] font-bold uppercase tracking-widest transition-all hover:-translate-y-px"
            style={{ background: '#25D366', color: '#000', boxShadow: '0 0 24px rgba(37,211,102,0.3)' }}>
            📲 {isAr ? 'شارك عبر واتساب' : 'Share via WhatsApp'}
          </button>

          <a href="/onboarding-start"
            className="flex items-center justify-center gap-2.5 rounded-xl py-4 font-mono text-[12px] font-bold uppercase tracking-widest no-underline transition-all hover:-translate-y-px"
            style={{ background: pal.hex, color: '#000', boxShadow: `0 0 24px ${pal.hex}44` }}>
            {isAr ? 'ابدأ إعداد الهوية مجاناً ←' : 'Start BrandDNA → Free'}
          </a>

          <a href={`/score-cards/${data.slug}/report`}
            className="flex items-center justify-center gap-2.5 rounded-xl border border-[#252320] bg-transparent py-4 font-mono text-[12px] font-bold uppercase tracking-widest text-[#A09B92] no-underline transition-all hover:border-[#383530] hover:text-[#F0EDE8]">
            📋 {isAr ? 'عرض التقرير الكامل · خطة ٩٠ يوم' : 'Full Report → 90-Day Plan'}
          </a>

          <button onClick={copyLink}
            className="flex cursor-pointer items-center justify-center gap-2.5 rounded-xl border border-[#1C1A17] bg-transparent py-3 font-mono text-[10px] font-semibold uppercase tracking-widest text-[#6B6860] transition-all hover:text-[#A09B92]">
            {copied ? (isAr ? '✓ تم النسخ' : '✓ Copied!') : (isAr ? 'نسخ الرابط' : 'Copy link')}
          </button>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <footer className="mt-10 text-center font-mono text-[10px] leading-loose tracking-wide text-[#6B6860]">
          <p>
            {isAr
              ? `تحديث ${new Date(methodology.last_refresh).toLocaleDateString('ar-SA')} · بناء على آخر ${methodology.posts_analyzed} منشور`
              : `Updated ${new Date(methodology.last_refresh).toLocaleDateString('en-SA')} · ${methodology.posts_analyzed} most recent posts`}
          </p>
          <div className="mx-auto my-3 h-px w-10 bg-[#252320]"/>
          <p>© 2026 OGz AI</p>
        </footer>

      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ num, en, ar, isAr, color }: { num:string; en:string; ar:string; isAr:boolean; color:string }) {
  return (
    <div className="mb-5 flex items-center gap-3.5">
      <span className="font-mono text-[10px] font-semibold tracking-[0.15em]" style={{ color }}>{num}</span>
      <h2 className="text-[22px] font-bold tracking-tight text-[#F0EDE8]"
        style={{ fontFamily: 'var(--font-fraunces), Georgia, serif' }}>
        {isAr ? ar : en}
      </h2>
      <div className="h-px flex-1" style={{ background: 'linear-gradient(90deg, #252320, transparent)' }}/>
    </div>
  )
}

function LanguageBar({ breakdown, isAr }: { breakdown: Record<string,number>; isAr: boolean }) {
  const total   = Object.values(breakdown).reduce((s,v) => s+v, 0) || 1
  const msa     = (breakdown['msa'] ?? 0) + (breakdown['other_arabic'] ?? 0)
  const dialect = (breakdown['najdi']??0)+(breakdown['hejazi']??0)+(breakdown['eastern']??0)+(breakdown['mixed']??0)
  const english = breakdown['english_only'] ?? 0
  return (
    <div>
      <div className="mb-2.5 flex h-9 overflow-hidden rounded-lg">
        {msa     > 0 && <div className="flex items-center justify-center font-mono text-[11px] font-semibold text-white" style={{ width:`${(msa/total)*100}%`, background:'#7C6AF5' }}>{msa}</div>}
        {dialect > 0 && <div className="flex items-center justify-center font-mono text-[11px] font-semibold text-black" style={{ width:`${(dialect/total)*100}%`, background:'#3DB88A' }}>{dialect}</div>}
        {english > 0 && <div className="flex items-center justify-center font-mono text-[11px] font-semibold text-white" style={{ width:`${(english/total)*100}%`, background:'#6B6860' }}>{english}</div>}
      </div>
      <div className="flex flex-wrap gap-3">
        {[
          { color: '#7C6AF5', en: 'MSA',         ar: 'فصحى'     },
          { color: '#3DB88A', en: 'Saudi dialect', ar: 'لهجة'    },
          { color: '#6B6860', en: 'English',       ar: 'إنجليزي' },
        ].map(item => (
          <span key={item.en} className="flex items-center gap-1.5 font-mono text-[10px] text-[#A09B92]">
            <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: item.color }}/>
            {isAr ? item.ar : item.en}
          </span>
        ))}
      </div>
    </div>
  )
}

function OccasionGrid({ occasions, isAr }: { occasions: Array<{key:string;status:'hit'|'late'|'miss'}>; isAr: boolean }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
      {occasions.slice(0, 10).map(occ => {
        const isHit  = occ.status === 'hit'
        const isLate = occ.status === 'late'
        const names  = OCCASION_NAMES[occ.key] ?? { en: occ.key, ar: occ.key }
        return (
          <div key={occ.key} className="rounded-lg border p-2 text-center"
            style={{
              background: isHit ? 'rgba(61,184,138,0.08)' : isLate ? 'rgba(229,160,76,0.06)' : 'rgba(229,102,122,0.06)',
              borderColor: isHit ? 'rgba(61,184,138,0.4)' : isLate ? 'rgba(229,160,76,0.4)' : 'rgba(229,102,122,0.3)',
            }}>
            <div className="text-base mb-1">{OCCASION_ICONS[occ.key] ?? '📌'}</div>
            <div className="font-mono text-[8px] uppercase leading-tight tracking-wide text-[#A09B92] mb-1">
              {isAr ? names.ar : names.en}
            </div>
            <div className="font-mono text-[9px] font-bold"
              style={{ color: isHit ? '#22c55e' : isLate ? '#E5A04C' : '#EF4444' }}>
              {isHit ? (isAr?'حضر':'HIT') : isLate ? (isAr?'متأخر':'LATE') : (isAr?'فائت':'MISS')}
            </div>
          </div>
        )
      })}
    </div>
  )
}
