'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ScoreCardsPage() {
  const router = useRouter()
  const [handle, setHandle] = useState('')
  const [sector, setSector] = useState<'fnb' | 'beauty' | 'retail' | 'other'>('fnb')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)

  async function handleScan(e: React.FormEvent) {
    e.preventDefault()
    if (!handle.trim()) return
    setError(null)
    setLoading(true)

    const steps = [
      'Fetching your last 30 posts…',
      'Running visual quality analysis…',
      'Classifying captions and dialect…',
      'Checking Saudi cultural calendar…',
      'Computing brand coherence…',
      'Calculating your score…',
    ]
    let stepIdx = 0
    setProgress(steps[stepIdx]!)
    const interval = setInterval(() => {
      stepIdx = Math.min(stepIdx + 1, steps.length - 1)
      setProgress(steps[stepIdx]!)
    }, 12000)

    try {
      const res = await fetch('/api/scorecard/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: handle.trim(), sector }),
      })
      const data = await res.json() as { ok: boolean; share_slug?: string; error?: string; message?: string }
      if (!data.ok || !data.share_slug) {
        const msgs: Record<string, string> = {
          private_account:       'This account is private. Make it public for 24h then try again.',
          account_not_found:     'Instagram handle not found. Double-check the spelling.',
          rate_limited:          'Instagram is rate-limiting us right now. Try again in a few minutes.',
          insufficient_posts:    'This account has fewer than 10 posts. Score will be preliminary.',
          scrape_failed:         `Could not fetch Instagram data. ${data.message ?? 'Please try again.'}`,
          apify_not_configured:  'Scraping service is not configured. Contact admin.',
        }
        setError(msgs[data.error ?? ''] ?? (data.message ?? 'Something went wrong. Please try again.'))
        return
      }
      router.push(`/score-cards/${data.share_slug}`)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      clearInterval(interval)
      setLoading(false)
      setProgress(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0908] flex flex-col items-center justify-center px-4 py-16">
      {/* Header */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono mb-6">
          FREE · SAUDI BRAND ANALYSIS
        </div>
        <h1 className="font-serif text-4xl md:text-5xl text-white mb-4 leading-tight">
          How strong is your<br />
          <span className="text-emerald-400">brand on Instagram?</span>
        </h1>
        <p className="text-white/60 text-lg max-w-md mx-auto">
          Enter your Instagram handle. We&apos;ll analyse your last 30 posts across 5 dimensions and give you a Saudi-specific brand score in under 90 seconds.
        </p>
      </div>

      {/* Scan form */}
      <form onSubmit={handleScan} className="w-full max-w-md space-y-4">
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 text-lg select-none">@</span>
          <input
            type="text"
            value={handle}
            onChange={e => setHandle(e.target.value)}
            placeholder="yourhandle"
            disabled={loading}
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-4 text-white placeholder-white/30 text-lg focus:outline-none focus:border-emerald-500/60 focus:bg-white/8 transition disabled:opacity-50"
            dir="ltr"
          />
        </div>

        <div className="flex gap-2">
          {(['fnb', 'beauty', 'retail'] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setSector(s)}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition ${
                sector === s
                  ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-400'
                  : 'bg-white/5 border border-white/10 text-white/40 hover:text-white/70'
              }`}
            >
              {s === 'fnb' ? '🍽 F&B' : s === 'beauty' ? '✨ Beauty' : '🛍 Retail'}
            </button>
          ))}
        </div>

        <button
          type="submit"
          disabled={loading || !handle.trim()}
          className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/30 text-black font-semibold py-4 rounded-xl text-base transition"
        >
          {loading ? 'Analysing…' : 'Score My Brand →'}
        </button>

        {/* Progress */}
        {loading && progress && (
          <div className="flex items-center gap-3 text-white/50 text-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {progress}
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
            {error}
          </p>
        )}
      </form>

      {/* What we analyse */}
      <div className="mt-16 w-full max-w-xl">
        <p className="text-white/30 text-xs text-center mb-6 font-mono uppercase tracking-widest">What we analyse</p>
        <div className="grid grid-cols-1 gap-3">
          {[
            { label: 'Visual Quality', weight: '20%', desc: 'Photography, lighting, composition', icon: '📸' },
            { label: 'Cultural Fit', weight: '30%', desc: 'Arabic dialect, Saudi occasions, values', icon: '🌙' },
            { label: 'Posting Consistency', weight: '15%', desc: 'Cadence, gaps, prime-time timing', icon: '📅' },
            { label: 'Brand Coherence', weight: '20%', desc: 'Colors, fonts, voice consistency', icon: '🎨' },
            { label: 'Engagement Health', weight: '15%', desc: 'Comments, saves, growth rate', icon: '💬' },
          ].map(d => (
            <div key={d.label} className="flex items-center gap-4 px-4 py-3 bg-white/3 border border-white/6 rounded-xl">
              <span className="text-2xl">{d.icon}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-white text-sm font-medium">{d.label}</span>
                  <span className="text-emerald-400 text-xs font-mono">{d.weight}</span>
                </div>
                <p className="text-white/40 text-xs">{d.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Arabic tagline */}
      <p className="mt-12 text-white/20 text-sm font-arabic text-center" dir="rtl">
        تحليل مخصص للسوق السعودي · مجاني · نتائج خلال ٩٠ ثانية
      </p>
    </div>
  )
}
