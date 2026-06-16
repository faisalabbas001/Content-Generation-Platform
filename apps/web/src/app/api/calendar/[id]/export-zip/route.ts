import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { getBrandForCurrentUser, getUserScopedClient } from '@repo/auth/server'
import { adminClient } from '@repo/db'
import { calendarsQ } from '@repo/db'

export const maxDuration = 60

function formatPostingDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function buildCaptionTxt(p: { position: number; caption_ar: string | null; hashtags: string[] | null; posting_time: string | null }): string {
  const lines: string[] = []
  lines.push(`Post #${p.position}`)
  if (p.posting_time) lines.push(`Scheduled: ${formatPostingDate(p.posting_time)}`)
  lines.push('')
  if (p.caption_ar) lines.push(p.caption_ar)
  if (p.hashtags?.length) {
    lines.push('')
    lines.push(p.hashtags.map(t => t.startsWith('#') ? t : `#${t}`).join('  '))
  }
  return lines.join('\n')
}

function buildCsv(posts: Array<{ position: number; caption_ar: string | null; hashtags: string[] | null; posting_time: string | null }>): string {
  const header = 'Position,Scheduled Date,Caption (Arabic),Hashtags'
  const rows = posts.map(p => {
    const tags = (p.hashtags ?? []).map(t => t.startsWith('#') ? t : `#${t}`).join(' ')
    // Escape double-quotes in caption by doubling them
    const caption = (p.caption_ar ?? '').replace(/"/g, '""')
    return `${p.position},"${formatPostingDate(p.posting_time)}","${caption}","${tags}"`
  })
  return [header, ...rows].join('\n')
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: calendarId } = await params
  const slug = request.nextUrl.searchParams.get('slug')
  const postIdsParam = request.nextUrl.searchParams.get('post_ids')

  if (!slug) return NextResponse.json({ error: 'Missing slug.' }, { status: 400 })

  const brand = await getBrandForCurrentUser(slug)
  if (!brand) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })

  if (brand.tier === 'free') {
    return NextResponse.json(
      { error: 'Download is available on paid plans. Upgrade to unlock.' },
      { status: 403 },
    )
  }

  const db = adminClient()
  const { data: calendar } = await db
    .from('calendars')
    .select('month, brand_id')
    .eq('calendar_id', calendarId)
    .single()

  if (!calendar || calendar.brand_id !== brand.brand_id) {
    return NextResponse.json({ error: 'Calendar not found.' }, { status: 404 })
  }

  const userClient = await getUserScopedClient()
  let posts = await calendarsQ.getPostsForCalendar(calendarId, userClient)

  if (postIdsParam) {
    const requested = new Set(postIdsParam.split(',').map(s => s.trim()).filter(Boolean))
    posts = posts.filter(p => requested.has(p.post_id))
  }

  const postsWithImages = posts.filter(p => p.storage_url)

  if (postsWithImages.length === 0) {
    return NextResponse.json(
      { error: 'No images available for the selected posts.' },
      { status: 404 },
    )
  }

  const zip = new JSZip()

  // Download all media in parallel. storage_url may live in ANY bucket
  // (post-images for calendar media, brand-assets for legacy) — parse the
  // bucket out of the URL instead of hard-coding it.
  await Promise.all(
    postsWithImages.map(async (p) => {
      try {
        const m = p.storage_url!.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?#]+)/)
        if (!m) return
        const [, bucket, rawPath] = m
        const storagePath = decodeURIComponent(rawPath)

        const { data, error } = await db.storage.from(bucket).download(storagePath)
        if (error || !data) return

        const ext = /\.mp4$/i.test(storagePath) ? 'mp4' : 'jpg'
        const prefix = `post-${String(p.position).padStart(2, '0')}`
        zip.file(`${prefix}.${ext}`, await data.arrayBuffer())
        zip.file(`${prefix}.txt`, buildCaptionTxt(p))
      } catch {
        // Partial ZIP is better than no ZIP
      }
    }),
  )

  if (Object.keys(zip.files).length === 0) {
    return NextResponse.json(
      { error: 'Could not download any images. Please try again.' },
      { status: 500 },
    )
  }

  // Master captions sheet — useful for scheduling tools (Buffer, Hootsuite, etc.)
  zip.file('captions.csv', buildCsv(postsWithImages))

  const zipBuffer = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
  const label = postIdsParam ? `selected-${postsWithImages.length}` : 'all'

  return new NextResponse(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="calendar-${calendar.month}-${label}.zip"`,
    },
  })
}
