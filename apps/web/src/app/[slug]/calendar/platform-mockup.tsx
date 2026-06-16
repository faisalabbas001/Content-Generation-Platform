'use client'

import Image from 'next/image'

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface PostContext {
  postId?: string
  brandNameAr: string
  brandLogoUrl: string | null
  captionAr: string | null
  hashtags: string[]
  storageUrl: string | null
  postingTime: string | null
  watermark: boolean
  position: number
  channel: string
  accentHex: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTimeAr(iso: string | null): string {
  if (!iso) return ''
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  if (h < 1) return 'منذ قليل'
  if (h < 24) return `منذ ${h} ساعة`
  return `منذ ${Math.floor(h / 24)} أيام`
}

function normalizeTag(t: string) {
  return t.startsWith('#') ? t : `#${t}`
}

function picsumUrl(postId: string, tall: boolean) {
  const seed = postId.replace(/-/g, '').slice(0, 8)
  return `https://picsum.photos/seed/${seed}/${tall ? 400 : 400}/${tall ? 711 : 400}`
}

// ─── BrandAvatar ──────────────────────────────────────────────────────────────

function BrandAvatar({
  url,
  name,
  size = 32,
  storyRing = false,
}: {
  url: string | null
  name: string
  size?: number
  storyRing?: boolean
}) {
  const initial = name?.[0] ?? 'B'
  const inner = (
    <div
      className="relative rounded-full overflow-hidden bg-gradient-to-br from-purple-500 to-pink-500"
      style={{ width: size, height: size }}
    >
      {url ? (
        <Image src={url} alt={name} fill className="object-cover rounded-full" />
      ) : (
        <span
          className="flex items-center justify-center w-full h-full text-white font-bold"
          style={{ fontSize: size * 0.4 }}
        >
          {initial}
        </span>
      )}
    </div>
  )

  if (!storyRing) return inner

  return (
    <div
      className="rounded-full p-[2px] bg-gradient-to-br from-yellow-400 via-pink-500 to-purple-600 shrink-0"
      style={{ width: size + 4, height: size + 4 }}
    >
      <div className="rounded-full p-[2px] bg-white" style={{ width: size, height: size }}>
        <div className="relative rounded-full overflow-hidden" style={{ width: size - 4, height: size - 4 }}>
          {url ? (
            <Image src={url} alt={name} fill className="object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-500 to-pink-500 text-white font-bold" style={{ fontSize: (size - 4) * 0.4 }}>
              {initial}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Image area with shimmer + watermark ─────────────────────────────────────

function PostImage({
  storageUrl,
  postId,
  tall = false,
  watermark,
  className = '',
}: {
  storageUrl: string | null
  postId?: string
  tall?: boolean
  watermark: boolean
  className?: string
}) {
  const placeholder = !storageUrl && postId ? picsumUrl(postId, tall) : null
  const imgSrc = storageUrl ?? placeholder
  // .mp4 must never reach <Image> — Next's optimizer rejects non-image media.
  const isVideo = !!storageUrl && /\.mp4([?#]|$)/i.test(storageUrl)

  return (
    <div className={`relative w-full overflow-hidden bg-zinc-900 ${className}`}>
      {imgSrc ? (
        <>
          {isVideo ? (
            <video
              src={`${storageUrl!.trim()}#t=0.001`}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <Image
              src={imgSrc}
              alt="Post"
              fill
              className="object-cover"
              unoptimized={!storageUrl}
            />
          )}
          {!storageUrl && (
            <div className="absolute top-2 left-2 z-10 bg-black/50 px-1.5 py-0.5 rounded text-[9px] text-amber-400 font-bold tracking-wide">
              AI Preview
            </div>
          )}
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 animate-pulse">
          <svg className="w-8 h-8 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-[10px] text-white/30">جاري الإنشاء...</span>
        </div>
      )}
      {watermark && storageUrl && (
        <div className="absolute top-2 right-2 z-10 bg-black/70 px-2 py-0.5 rounded text-[9px] text-amber-300 font-bold tracking-wide backdrop-blur-sm">
          BETA DRAFT
        </div>
      )}
    </div>
  )
}

// ─── Instagram ────────────────────────────────────────────────────────────────

function InstagramPreview(p: PostContext) {
  const caption = p.captionAr ?? ''
  const tags = (p.hashtags ?? []).slice(0, 5).map(normalizeTag).join('  ')
  const likes = 2341 + p.position * 17

  return (
    <div className="bg-white text-black flex flex-col text-[12px] min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0">
        <div className="flex items-center gap-2">
          <BrandAvatar url={p.brandLogoUrl} name={p.brandNameAr} size={30} storyRing />
          <div>
            <p className="font-semibold text-[11px] leading-tight" dir="rtl">{p.brandNameAr}</p>
            <p className="text-[10px] text-gray-400 leading-tight">Sponsored</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-black text-lg leading-none font-bold tracking-tight">···</span>
          <svg className="w-3.5 h-3.5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      </div>

      {/* Image 1:1 */}
      <PostImage storageUrl={p.storageUrl} postId={p.postId} watermark={p.watermark} className="aspect-square shrink-0" />

      {/* Action bar */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1 shrink-0">
        <div className="flex items-center gap-4">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </div>
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
        </svg>
      </div>

      {/* Likes */}
      <p className="px-3 font-bold text-[11px] shrink-0">{likes.toLocaleString()} likes</p>

      {/* Caption */}
      <div className="px-3 pt-0.5 pb-1 shrink-0" dir="rtl">
        <span className="font-semibold text-[11px]">{p.brandNameAr} </span>
        <span className="text-[11px]">{caption.slice(0, 90)}{caption.length > 90 ? '…' : ''}</span>
        {tags && <p className="text-blue-500 text-[10px] mt-0.5">{tags}</p>}
      </div>

      {/* Comments hint */}
      <p className="px-3 text-gray-400 text-[10px] shrink-0">
        View all {12 + p.position * 3} comments
      </p>

      {/* Time */}
      <p className="px-3 text-gray-400 text-[10px] uppercase tracking-wide pb-3 shrink-0">
        {relativeTimeAr(p.postingTime)}
      </p>
    </div>
  )
}

// ─── Snapchat ─────────────────────────────────────────────────────────────────

function SnapchatPreview(p: PostContext) {
  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      {/* Progress bars */}
      <div className="absolute top-0 left-0 right-0 z-20 flex gap-1 p-2">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className={`h-0.5 flex-1 rounded-full transition-all ${i === 0 ? 'bg-white' : 'bg-white/30'}`}
          />
        ))}
      </div>

      {/* Top: avatar + name + close */}
      <div className="absolute top-5 left-0 right-0 z-20 flex items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <BrandAvatar url={p.brandLogoUrl} name={p.brandNameAr} size={26} />
          <span className="text-white font-semibold text-[11px] drop-shadow-md" dir="rtl">
            {p.brandNameAr}
          </span>
        </div>
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>

      {/* Full-bleed image */}
      <div className="absolute inset-0">
        <PostImage
          storageUrl={p.storageUrl}
          postId={p.postId}
          tall
          watermark={false}
          className="w-full h-full"
        />
      </div>

      {/* Caption overlay */}
      {p.captionAr && (
        <div className="absolute bottom-20 left-0 right-0 z-20 px-4">
          <p
            className="text-white text-[12px] text-center drop-shadow-lg leading-relaxed font-medium bg-black/30 rounded-xl px-3 py-2 backdrop-blur-sm"
            dir="rtl"
          >
            {p.captionAr.slice(0, 80)}
          </p>
        </div>
      )}

      {/* Watermark */}
      {p.watermark && p.storageUrl && (
        <div className="absolute top-10 right-3 z-30 bg-black/60 px-2 py-0.5 rounded text-[9px] text-amber-300 font-bold">
          BETA DRAFT
        </div>
      )}

      {/* Bottom send bar */}
      <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center gap-2 px-3 py-3 bg-gradient-to-t from-black/70 to-transparent">
        <div className="flex-1 border border-white/50 rounded-full px-3 py-1.5">
          <p className="text-white/50 text-[11px]" dir="rtl">أرسل رسالة...</p>
        </div>
        <svg className="w-5 h-5 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
        </svg>
      </div>
    </div>
  )
}

// ─── TikTok ───────────────────────────────────────────────────────────────────

function TikTokPreview(p: PostContext) {
  const actions = [
    { d: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z', count: `${9 + p.position}.2K` },
    { d: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z', count: `${841 + p.position * 12}` },
    { d: 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8', count: `${2 + p.position}.1K` },
  ]

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      {/* Full-bleed */}
      <div className="absolute inset-0">
        <PostImage storageUrl={p.storageUrl} postId={p.postId} tall watermark={false} className="w-full h-full" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/70" />
      </div>

      {/* Right action bar */}
      <div className="absolute top-1/4 right-2 z-20 flex flex-col items-center gap-5">
        {/* Avatar + follow */}
        <div className="flex flex-col items-center gap-0">
          <BrandAvatar url={p.brandLogoUrl} name={p.brandNameAr} size={34} />
          <div className="w-4 h-4 bg-red-500 rounded-full flex items-center justify-center -mt-2">
            <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 4v16m8-8H4" />
            </svg>
          </div>
        </div>
        {actions.map(({ d, count }, i) => (
          <div key={i} className="flex flex-col items-center gap-0.5">
            <svg className="w-6 h-6 text-white drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={d} />
            </svg>
            <span className="text-white text-[10px] font-semibold drop-shadow">{count}</span>
          </div>
        ))}
        {/* Music disc */}
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-900 border-2 border-zinc-600 flex items-center justify-center">
          <div className="w-2.5 h-2.5 rounded-full bg-black" />
        </div>
      </div>

      {/* Bottom info */}
      <div className="absolute bottom-0 left-0 right-12 z-20 px-3 pb-3">
        <p className="text-white font-bold text-[11px] mb-1" dir="rtl">@{p.brandNameAr}</p>
        {p.captionAr && (
          <p className="text-white text-[10px] line-clamp-2 mb-1 drop-shadow" dir="rtl">
            {p.captionAr.slice(0, 60)}
          </p>
        )}
        <div className="flex items-center gap-1">
          <svg className="w-3 h-3 text-white shrink-0" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
          </svg>
          <p className="text-white text-[9px] truncate">صوت أصلي — {p.brandNameAr}</p>
        </div>
        {/* Progress bar */}
        <div className="mt-2 h-0.5 bg-white/30 rounded-full">
          <div className="h-full w-1/3 bg-white rounded-full" />
        </div>
      </div>

      {/* Watermark */}
      {p.watermark && p.storageUrl && (
        <div className="absolute top-3 right-3 z-30 bg-black/60 px-2 py-0.5 rounded text-[9px] text-amber-300 font-bold">
          BETA DRAFT
        </div>
      )}
    </div>
  )
}

// ─── Twitter / X ──────────────────────────────────────────────────────────────

function TwitterPreview(p: PostContext) {
  const tags = (p.hashtags ?? []).slice(0, 4).map(normalizeTag)
  const handle = p.brandNameAr.replace(/\s/g, '_')
  const engagements = [
    { d: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z', count: `${234 + p.position}` },
    { d: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15', count: `${891 + p.position * 5}` },
    { d: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z', count: `${4 + p.position}.2K` },
    { d: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', count: `${18 + p.position}K` },
  ]

  return (
    <div className="bg-black text-white flex flex-col p-3 gap-2.5 min-h-full">
      {/* Header */}
      <div className="flex items-start gap-2">
        <BrandAvatar url={p.brandLogoUrl} name={p.brandNameAr} size={34} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="font-bold text-[12px] truncate" dir="rtl">{p.brandNameAr}</span>
            <svg className="w-3.5 h-3.5 text-blue-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-gray-500 text-[10px]">@{handle}</p>
        </div>
        {/* X logo */}
        <svg className="w-4 h-4 text-white shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.743l7.732-8.843L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </div>

      {/* Tweet text */}
      <div dir="rtl">
        <p className="text-[12px] leading-relaxed">
          {p.captionAr?.slice(0, 140)}
        </p>
        {tags.length > 0 && (
          <p className="text-blue-400 text-[11px] mt-1">{tags.join('  ')}</p>
        )}
      </div>

      {/* Image */}
      {(p.storageUrl || p.postId) && (
        <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-white/10">
          <PostImage
            storageUrl={p.storageUrl}
            postId={p.postId}
            watermark={p.watermark}
            className="w-full h-full"
          />
        </div>
      )}

      {/* Timestamp */}
      {p.postingTime && (
        <p className="text-gray-500 text-[10px]">
          {new Date(p.postingTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          {' · '}
          {new Date(p.postingTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
      )}

      <div className="border-t border-white/10" />

      {/* Engagement */}
      <div className="flex items-center gap-5">
        {engagements.map(({ d, count }, i) => (
          <div key={i} className="flex items-center gap-1 text-gray-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={d} />
            </svg>
            <span className="text-[10px]">{count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Phone Frame ──────────────────────────────────────────────────────────────

function PhoneFrame({ children, tall }: { children: React.ReactNode; tall: boolean }) {
  return (
    <div className="relative mx-auto select-none" style={{ width: tall ? 195 : 220 }}>
      {/* Device shell */}
      <div
        className="relative rounded-[38px] overflow-visible"
        style={{
          background: 'linear-gradient(160deg, #2c2c2e, #1a1a1c)',
          padding: '10px 7px 12px',
          boxShadow:
            '0 0 0 1px #3a3a3c, 0 0 0 2.5px #111, inset 0 1px 0 #444, 0 30px 60px rgba(0,0,0,0.8)',
        }}
      >
        {/* Dynamic island */}
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-black rounded-full"
          style={{ width: 72, height: 20 }}
        />

        {/* Screen — clips content, allows scroll */}
        <div
          className="relative rounded-[30px] overflow-hidden bg-black"
          style={{ aspectRatio: tall ? '9/16' : '4/5' }}
        >
          <div className="absolute inset-0 overflow-y-auto scrollbar-hide">
            {children}
          </div>
        </div>

        {/* Home indicator */}
        <div className="flex justify-center pt-2.5">
          <div className="w-16 h-[3px] bg-zinc-600 rounded-full" />
        </div>
      </div>

      {/* Volume buttons (left) */}
      <div className="absolute top-16 -left-[5px] w-[5px] h-8 bg-gradient-to-b from-zinc-600 to-zinc-700 rounded-l-sm shadow-md" />
      <div className="absolute top-28 -left-[5px] w-[5px] h-10 bg-gradient-to-b from-zinc-600 to-zinc-700 rounded-l-sm shadow-md" />
      <div className="absolute top-40 -left-[5px] w-[5px] h-10 bg-gradient-to-b from-zinc-600 to-zinc-700 rounded-l-sm shadow-md" />

      {/* Power button (right) */}
      <div className="absolute top-24 -right-[5px] w-[5px] h-14 bg-gradient-to-b from-zinc-600 to-zinc-700 rounded-r-sm shadow-md" />
    </div>
  )
}

// ─── Public export ────────────────────────────────────────────────────────────

export function PlatformMockup(props: PostContext) {
  const isTall = props.channel === 'Snapchat' || props.channel === 'TikTok'

  const Preview =
    props.channel === 'Snapchat' ? SnapchatPreview
    : props.channel === 'TikTok' ? TikTokPreview
    : props.channel === 'Twitter' ? TwitterPreview
    : InstagramPreview

  return (
    <div
      className="phone-frame-enter flex items-center justify-center w-full h-full py-8"
      style={{ animation: 'phone-in 280ms cubic-bezier(0.16,1,0.3,1) 50ms both' }}
    >
      <style>{`
        @keyframes phone-in {
          from { opacity: 0; transform: translateY(20px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <PhoneFrame tall={isTall}>
        <Preview {...props} />
      </PhoneFrame>
    </div>
  )
}
