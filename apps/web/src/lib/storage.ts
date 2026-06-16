/**
 * Storage helpers — uploads to the `brand-assets` Supabase Storage bucket.
 *
 * Bucket layout:
 *   brand-assets/
 *   └── {brand_id}/
 *       ├── logo.{ext}        ← user-uploaded brand logo (set by onboarding)
 *       └── (Phase 2: more)
 *
 * RLS policies (migrations 0014 + 0032):
 *   - owner read scoped to `brand-assets/{brand_id}/*` (0032 — replaces the
 *     broad public SELECT that caused the Supabase dashboard warning)
 *   - owner write on `brand-assets/{brand_id}/*`
 *   - owner update/delete on `brand-assets/{brand_id}/*`
 *   - service_role bypasses all of the above
 *   NOTE: public CDN reads (logo in snapshot/email) work because the bucket
 *   is marked public=true — that bypasses RLS entirely, no SELECT policy needed.
 *
 * Why public-read:
 *   Logos are public-facing artwork — they appear in generated calendar
 *   posts, in the brand snapshot card, and in email previews. We don't
 *   gain anything by gating them behind signed URLs, and signed URLs would
 *   break email clients that strip query params.
 *
 *   AI-generated calendar visuals use a SEPARATE bucket (per Doc §7.4 +
 *   future migration) with signed URLs — those carry brand-specific content
 *   and should not be enumerable.
 */
import type { Db } from '@repo/db/client'

const MAX_LOGO_REMOTE_BYTES = 2 * 1024 * 1024 // 2 MB remote image cap

export const BRAND_ASSETS_BUCKET = 'brand-assets'
const MAX_LOGO_BYTES = 2 * 1024 * 1024 // 2 MB
const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])

export interface UploadLogoResult {
  ok: boolean
  publicUrl?: string
  storagePath?: string
  error?: string
}

/**
 * Upload a brand logo. Validates size + MIME type, picks an extension from
 * the file's content-type (so SVG stays SVG, etc.), and writes to
 * `brand-assets/{brand_id}/logo.{ext}`.
 *
 * Idempotent: re-uploading replaces the previous logo (upsert: true).
 */
export async function uploadBrandLogo(
  client: Db,
  brand_id: string,
  file: File,
): Promise<UploadLogoResult> {
  // Type / size validation up front — no point round-tripping a bad file.
  if (!ALLOWED_LOGO_TYPES.has(file.type)) {
    return { ok: false, error: `unsupported file type: ${file.type}. Allowed: PNG, JPEG, WebP, SVG.` }
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { ok: false, error: `logo is too large (${Math.round(file.size / 1024)}KB > ${MAX_LOGO_BYTES / 1024}KB max)` }
  }
  if (file.size === 0) {
    return { ok: false, error: 'logo file is empty' }
  }

  const ext = extensionForMime(file.type)
  const storagePath = `${brand_id}/logo.${ext}`

  const { error } = await client.storage
    .from(BRAND_ASSETS_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type,
      cacheControl: '3600',
      upsert: true,
    })

  if (error) {
    return { ok: false, error: `storage upload failed: ${error.message}` }
  }

  const { data: pub } = client.storage.from(BRAND_ASSETS_BUCKET).getPublicUrl(storagePath)
  return { ok: true, publicUrl: pub.publicUrl, storagePath }
}

/**
 * Download a logo from a remote URL (e.g. Instagram CDN profile picture)
 * and upload it to Supabase Storage as the brand logo.
 *
 * Uses a server-side fetch so there is no browser Referer restriction.
 * Falls back gracefully — a failed download does NOT block onboarding.
 */
export async function uploadBrandLogoFromUrl(
  client: Db,
  brand_id: string,
  remoteUrl: string,
): Promise<UploadLogoResult> {
  let res: Response
  try {
    res = await fetch(remoteUrl, {
      // Server-side fetch — no Referer header needed.
      headers: { 'User-Agent': 'OGz Studios-Onboarding/1.0' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (e) {
    return { ok: false, error: `remote fetch failed: ${(e as Error).message}` }
  }

  if (!res.ok) {
    return { ok: false, error: `remote fetch returned ${res.status}` }
  }

  const contentType = res.headers.get('content-type') ?? 'image/jpeg'
  // Normalise – IG CDN often returns 'image/jpeg; charset=...' etc.
  const mime = contentType.split(';')[0]!.trim()
  // Treat unknown types as JPEG (IG profile pics are always JPEG).
  const resolvedMime = ALLOWED_LOGO_TYPES.has(mime) ? mime : 'image/jpeg'
  const ext = extensionForMime(resolvedMime)

  const buffer = await res.arrayBuffer()
  if (buffer.byteLength > MAX_LOGO_REMOTE_BYTES) {
    return { ok: false, error: `remote image too large (${Math.round(buffer.byteLength / 1024)}KB)` }
  }
  if (buffer.byteLength === 0) {
    return { ok: false, error: 'remote image is empty' }
  }

  const storagePath = `${brand_id}/logo.${ext}`
  const { error } = await client.storage
    .from(BRAND_ASSETS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: resolvedMime,
      cacheControl: '3600',
      upsert: true,
    })

  if (error) {
    return { ok: false, error: `storage upload failed: ${error.message}` }
  }

  const { data: pub } = client.storage.from(BRAND_ASSETS_BUCKET).getPublicUrl(storagePath)
  return { ok: true, publicUrl: pub.publicUrl, storagePath }
}

export interface UploadAssetsResult {
  ok: boolean
  urls: string[]
  errors: string[]
}

/**
 * Upload brand asset files (logos, photos, PDFs, videos) to
 * `brand-assets/{brand_id}/assets/{filename}`.
 * Returns public URLs for all successfully uploaded files.
 * Individual file failures are collected in `errors` — doesn't abort the batch.
 */
export async function uploadBrandAssets(
  client: Db,
  brand_id: string,
  files: File[],
): Promise<UploadAssetsResult> {
  const MAX_ASSET_BYTES = 20 * 1024 * 1024 // 20 MB per file
  const ALLOWED_ASSET_TYPES = new Set([
    'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif',
    'application/pdf', 'video/mp4', 'video/quicktime', 'video/webm',
  ])

  const urls: string[] = []
  const errors: string[] = []

  for (const file of files) {
    if (!ALLOWED_ASSET_TYPES.has(file.type)) {
      errors.push(`${file.name}: unsupported type ${file.type}`)
      continue
    }
    if (file.size > MAX_ASSET_BYTES) {
      errors.push(`${file.name}: too large (${Math.round(file.size / 1024)}KB > 20MB)`)
      continue
    }
    if (file.size === 0) {
      errors.push(`${file.name}: empty file`)
      continue
    }
    // Sanitize filename — strip path separators, keep extension
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
    const storagePath = `${brand_id}/assets/${Date.now()}_${safeName}`
    const { error } = await client.storage
      .from(BRAND_ASSETS_BUCKET)
      .upload(storagePath, file, { contentType: file.type, cacheControl: '3600', upsert: false })
    if (error) {
      errors.push(`${file.name}: ${error.message}`)
      continue
    }
    const { data: pub } = client.storage.from(BRAND_ASSETS_BUCKET).getPublicUrl(storagePath)
    urls.push(pub.publicUrl)
  }

  return { ok: urls.length > 0, urls, errors }
}

/**
 * Download images from remote URLs (e.g. Instagram CDN) server-side and store
 * them as brand assets in Supabase Storage. Used to auto-fill brand_assets_bundle
 * from extracted IG post images at onboarding submission.
 *
 * All URLs are fetched in parallel (capped at MAX_IMAGES total) with a 5s
 * per-image timeout so the total wall-clock time stays well under the 25s
 * Next.js Server Action limit even for large IG accounts.
 *
 * Stores at `brand-assets/{brand_id}/assets/ig_{index}_{timestamp}.{ext}`.
 */
export async function uploadBrandAssetsFromUrls(
  client: Db,
  brand_id: string,
  imageUrls: string[],
): Promise<UploadAssetsResult & { bundleItems: Array<{ url: string; name: string; mime: string; size: number }> }> {
  const MAX_IMAGES = 30   // hard cap — keeps submit under ~15s even if all images are slow
  const MAX_ASSET_BYTES = 5 * 1024 * 1024  // 5 MB per IG image (they're CDN-compressed)
  const FETCH_TIMEOUT_MS = 5_000
  const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
  const ts = Date.now()
  const urls: string[] = []
  const errors: string[] = []
  const bundleItems: Array<{ url: string; name: string; mime: string; size: number }> = []

  const capped = imageUrls.slice(0, MAX_IMAGES)

  // All images in parallel — each has its own timeout so one slow image doesn't block others
  await Promise.all(capped.map(async (remoteUrl, idx) => {
    let arrayBuffer: ArrayBuffer
    let mime: string
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      const res = await fetch(remoteUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OpenClaw/1.0)' },
      })
      clearTimeout(timer)
      if (!res.ok) { errors.push(`url[${idx}]: HTTP ${res.status}`); return }
      mime = (res.headers.get('content-type') ?? '').split(';')[0].trim()
      if (!ALLOWED_IMAGE_TYPES.has(mime)) { errors.push(`url[${idx}]: unsupported type ${mime}`); return }
      arrayBuffer = await res.arrayBuffer()
    } catch (err) {
      errors.push(`url[${idx}]: ${err instanceof Error ? err.message : String(err)}`)
      return
    }

    if (arrayBuffer.byteLength > MAX_ASSET_BYTES) {
      errors.push(`url[${idx}]: too large (${Math.round(arrayBuffer.byteLength / 1024)}KB)`)
      return
    }

    const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'gif'
    const name = `ig_${String(idx).padStart(2, '0')}_${ts}.${ext}`
    const storagePath = `${brand_id}/assets/${name}`
    const { error: upErr } = await client.storage
      .from(BRAND_ASSETS_BUCKET)
      .upload(storagePath, arrayBuffer, { contentType: mime, cacheControl: '3600', upsert: true })
    if (upErr) { errors.push(`url[${idx}]: ${upErr.message}`); return }

    const { data: pub } = client.storage.from(BRAND_ASSETS_BUCKET).getPublicUrl(storagePath)
    urls.push(pub.publicUrl)
    bundleItems.push({ url: pub.publicUrl, name, mime, size: arrayBuffer.byteLength })
  }))

  return { ok: urls.length > 0, urls, errors, bundleItems }
}

/** Remove a brand's logo. Used by PDPL cascade delete + admin tooling. */
export async function removeBrandLogo(
  client: Db,
  brand_id: string,
): Promise<{ ok: boolean; error?: string }> {
  // Delete every file under brand-assets/{brand_id}/. Supabase Storage's
  // remove() takes an explicit list, so we list-then-remove.
  const { data: files, error: listErr } = await client.storage
    .from(BRAND_ASSETS_BUCKET)
    .list(brand_id)
  if (listErr) return { ok: false, error: listErr.message }
  if (!files || files.length === 0) return { ok: true }

  const paths = files.map((f) => `${brand_id}/${f.name}`)
  const { error: delErr } = await client.storage.from(BRAND_ASSETS_BUCKET).remove(paths)
  if (delErr) return { ok: false, error: delErr.message }
  return { ok: true }
}

function extensionForMime(mime: string): string {
  switch (mime) {
    case 'image/png':     return 'png'
    case 'image/jpeg':    return 'jpg'
    case 'image/webp':    return 'webp'
    case 'image/svg+xml': return 'svg'
    default:              return 'bin'
  }
}
