/**
 * Orchestrates the full visual generation pipeline per post (doc §3.3 N8N-V01):
 *
 *   1. fal.ai generate → poll → download buffer          (Hard Rule #4: CDN URL never stored)
 *      — Single-model image: generateFalImage / generateFalWorkflowImage
 *      — Two-model video chain: generateFalVideoChain (Flux keyframe → Kling)
 *   2. Normalise to lossless PNG                         (prevents multi-JPEG blur; images only)
 *   3a. Upload clean variant (background, best-effort)
 *   3b. detectLayout via Sonnet vision                   (runs in parallel with 3a; images only)
 *   4. applySafeZone                                     (no-op, kept for compatibility)
 *   5. applyArabicOverlay — layout from Sonnet vision    (Hard Rule #3: applied AFTER generation)
 *   6. applyWatermark (if confidence_flag='watermark_required')
 *   7. Single JPEG encode — the ONLY lossy compression   (images only; videos returned as-is)
 *   8. uploadPostImage → Supabase Storage                (only Supabase URL returned)
 */
import sharp from 'sharp'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  generateFalImage,
  generateFalWorkflowImage,
  generateFalVideoChain,
  submitVideoChainAsync,
  type FalModelConfig,
} from './fal-client'
import { applyArabicOverlay, applySafeZone, applyWatermark, type Dialect, type Channel, type OverlayLayout } from './overlay'
import { uploadPostImage, uploadCleanPostImage } from './storage'
import { detectLayout } from './vision'

export interface ImageGenerationContext {
  flow_id: string
  brand_id: string
  post_id: string
  /** Optional: n8n execution ID for usage_logs.flow_run_id correlation. */
  flow_run_id?: string | null
  /** Optional: brand slug for usage_logs.client_slug. */
  client_slug?: string | null
  /**
   * Service-role Supabase DB client for writing usage_logs after generation.
   * Pass null (default) to skip cost logging. The image/generate route injects this.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db?: any | null
  /** English-only image prompt — Hard Rule #3: Arabic NEVER here. */
  prompt_en: string
  /** Applied by Sharp after generation, not passed to fal.ai. */
  brand_name_ar: string
  headline_ar?: string
  dialect: Dialect
  channel: Channel
  objective: 'awareness' | 'engagement' | 'conversion' | 'cultural' | 'trust'
  first_ever_post: boolean
  confidence_flag: 'clean' | 'watermark_required' | 'hold'
  cost_constraint: string
  palette_hex: string[]
  month: string
  /** CCO score; null when the post reached generation unscored (fail-safe HOLD route). */
  score: number | null
  revision_count?: number
  /** Layout hint from upstream — skips Sonnet vision detection when set. */
  layout?: OverlayLayout
  /**
   * If set, bypasses standard model-routing and uses this exact FAL model ID.
   * Populated from chains.models_used[0].model_id when a chain_id is selected.
   */
  fal_workflow_id?: string
  /**
   * Chain-resolved primary fal.ai model (from chains table).
   * Overrides resolveModel() when set.
   */
  fal_model_primary?: string
  /**
   * Chain-resolved secondary fal.ai model (Kling for video chains).
   * When set alongside fal_model_primary, triggers two-model video pipeline.
   */
  fal_model_secondary?: string
  /**
   * Custom negative prompt from chain definition.
   * Falls back to DEFAULT_NEGATIVE_PROMPT in fal-client.
   */
  negative_prompt?: string
  /**
   * Explicit media type requested by the user ('image' | 'video').
   * Passed from the brief through N8N-A02 → N8N-V01 → /api/image/generate.
   * Takes precedence over output_type when no chain is resolved from the DB.
   */
  expected_media_type?: 'image' | 'video'
  /**
   * Chain output type — drives image-vs-video pipeline decision.
   * When absent the legacy behaviour applies: video pipeline triggers only
   * when both fal_model_primary AND fal_model_secondary are set.
   */
  output_type?: 'image' | 'video' | 'carousel' | 'audio' | 'mixed'
  /**
   * Chain output dimensions (for video chains these override CHANNEL_DIMS).
   */
  output_width?: number
  output_height?: number
  output_duration_s?: number
  aspect_ratio?: string
  /**
   * Spec-compliant video input (TechDoc v1.0): a public URL of a reference image
   * (a prior generation, e.g. U06/F01) to animate. When set on a video request,
   * the image-to-video model animates this image DIRECTLY (single model call) and
   * the Flux keyframe step is skipped. When absent, a keyframe is synthesised from
   * the prompt so video still generates.
   */
  reference_image_url?: string | null
  /** DeepSeek-recommended hex color for headline overlay. Contrast-checked before use. */
  font_color?: string
  /** DeepSeek-recommended font size in px for headline, clamped [24, 96]. */
  font_size?: number
  /**
   * Cost in USD taken directly from chains.cost_estimate_usd.
   * Written to usage_logs.cost_usd — no model-name lookup needed.
   * Null when no chain was resolved (fallback model routing path).
   */
  chain_cost_usd?: number | null
  /**
   * Chain ID from the §9.5 deterministic selection.
   * Written into usage_logs.payload so brand_chain_approval_rate and
   * chain_platform_approval_rate views can compute per-chain scores.
   */
  chain_id?: string | null
}

const execFileAsync = promisify(execFile)

async function applyVideoWatermark(buf: Buffer, postId: string): Promise<Buffer> {
  // Use FFMPEG_PATH env var so this works on any host (local, Docker, CI).
  // Falls back to 'ffmpeg' (PATH lookup) when the env var is not set.
  // On Vercel serverless where ffmpeg is unavailable, the ENOENT is caught
  // gracefully — the video is returned unwatermarked and the DB flag
  // (calendar_posts.watermark = true) ensures the UI badge is shown instead.
  const ffmpegBin = process.env.FFMPEG_PATH ?? 'ffmpeg'
  const dir = tmpdir()
  const inputPath  = join(dir, `wm-in-${postId}.mp4`)
  const outputPath = join(dir, `wm-out-${postId}.mp4`)
  try {
    await writeFile(inputPath, buf)
    // Spec: "Beta AI Draft", Arial 14px, 30% opacity (alpha=0.3), top-right corner
    // ffmpeg drawtext: x=w-tw-10 places text 10px from right edge, y=10 from top
    await execFileAsync(ffmpegBin, [
      '-y',
      '-i', inputPath,
      '-vf', "drawtext=text='Beta AI Draft':fontsize=14:fontcolor=white@0.3:x=w-tw-10:y=10:font=Arial",
      '-c:a', 'copy',
      outputPath,
    ])
    const result = await readFile(outputPath)
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      console.warn(
        `[generate] applyVideoWatermark: ffmpeg not found (${ffmpegBin}) — ` +
        `skipping burn-in. Set FFMPEG_PATH env var. ` +
        `calendar_posts.watermark=true will show the UI badge instead.`,
      )
      return buf
    }
    throw err
  } finally {
    await unlink(inputPath).catch(() => {})
    await unlink(outputPath).catch(() => {})
  }
}

export async function generatePostImage(
  ctx: ImageGenerationContext,
): Promise<{ storage_url: string; clean_storage_url: string | null; degraded_to_image?: boolean }> {
  const falCfg: FalModelConfig = {
    first_ever_post:     ctx.first_ever_post,
    cost_constraint:     ctx.cost_constraint,
    score:               ctx.score,
    objective:           ctx.objective,
    channel:             ctx.channel,
    fal_model_primary:   ctx.fal_model_primary,
    fal_model_secondary: ctx.fal_model_secondary,
    negative_prompt:     ctx.negative_prompt,
    model_override:  ctx.fal_workflow_id,
  }

  // Default video models used when no chain is resolved from the DB but the user
  // explicitly requested video (expected_media_type='video').
  const DEFAULT_VIDEO_PRIMARY   = process.env.FAL_VIDEO_KEYFRAME_MODEL ?? 'fal-ai/flux-pro/v1.1-ultra'
  const DEFAULT_VIDEO_SECONDARY = process.env.FAL_VIDEO_ANIMATE_MODEL  ?? 'fal-ai/kling-video/v1.6/pro/image-to-video'

  // When output_type is explicitly set (chain-resolved), use it.
  // When expected_media_type='video' (user-requested) but no chain resolved,
  // also route to the video pipeline using the default Flux→Kling models.
  // Legacy fallback (no chain, no explicit choice): video only when both model IDs set.
  const userWantsVideo = ctx.expected_media_type === 'video'
  const isVideoChain = ctx.output_type
    ? ctx.output_type === 'video'
    : (userWantsVideo || !!(ctx.fal_model_primary && ctx.fal_model_secondary))

  // Resolve which primary/secondary models to use for the video chain.
  // Chain-table values take priority; fall back to env-var defaults when the user
  // explicitly requested video but no chain was resolved.
  const videoPrimary   = ctx.fal_model_primary   ?? DEFAULT_VIDEO_PRIMARY
  const videoSecondary = ctx.fal_model_secondary ?? DEFAULT_VIDEO_SECONDARY

  // 1. Generate via fal.ai → download buffer (fal CDN URL never stored, Hard Rule #4)
  let buf: Buffer

  if (isVideoChain) {
    // Video via the chain's image-to-video model (fal_model_secondary):
    //   • CLIENT PATH — a reference_image_url (prior generation) is animated directly.
    //   • FALLBACK — no reference image: synthesise a keyframe via fal_model_primary
    //     (Flux) and animate it. The keyframe is uploaded to Supabase Storage so the
    //     animator can fetch it as image_url (avoids fal.ai's unreliable /storage/upload).
    //     Stored at {post_id}-kf.jpg — never written to the DB. uploadPostImage (not
    //     uploadCleanPostImage) avoids the automatic -clean suffix.
    const keyframeUploadFn = async (kfBuf: Buffer): Promise<string> =>
      uploadPostImage(kfBuf, ctx.brand_id, `${ctx.post_id}-kf`, ctx.month, 0, {
        contentType: 'image/jpeg',
        extension:   'jpg',
      })

    const t0video = Date.now()
    let videoBuf: Buffer | null = null
    let videoError: Error | null = null
    try {
      videoBuf = await generateFalVideoChain(ctx.prompt_en, {
        ...falCfg,
        fal_model_primary:   videoPrimary,
        fal_model_secondary: videoSecondary,
      }, {
        duration_seconds:    ctx.output_duration_s,
        aspect_ratio:        ctx.aspect_ratio,
        output_width:        ctx.output_width,
        output_height:       ctx.output_height,
        reference_image_url: ctx.reference_image_url,
        keyframeUploadFn,
      })
    } catch (err) {
      videoError = err instanceof Error ? err : new Error(String(err))
    }

    // ── INTELLIGENT FALLBACK: video failed → degrade to a STATIC IMAGE ──────────
    // A failed animator (Kling/Seedance 422, timeout, exhausted ladder) must NOT
    // leave the post blank. Generate a still from the SAME prompt via the image
    // pipeline and return it as an image post (flagged for admin). This guarantees
    // every video slot produces *something* visual; admin can re-request video.
    if (!videoBuf) {
      console.warn(`[generate] video generation FAILED for post=${ctx.post_id} (${videoError?.message}); falling back to static image`)
      try {
        const imgBuf = await generateFalImage(ctx.prompt_en, falCfg) // text-to-image, model ladder + resubmit
        const fallbackUrl = await uploadPostImage(
          imgBuf, ctx.brand_id, ctx.post_id, ctx.month, ctx.revision_count ?? 0,
          { contentType: 'image/jpeg', extension: 'jpg' },
        )
        void writeImageCostLog(ctx, {
          node_name: 'video_fallback_image', request_type: 'video_fallback',
          model: videoPrimary, cost_usd: ctx.chain_cost_usd ?? 0,
          images_generated: 1, duration_ms: Date.now() - t0video,
        })
        // Signal the degrade to the caller so the worker stores format=image + a flag.
        return { storage_url: fallbackUrl, clean_storage_url: null, degraded_to_image: true }
      } catch (imgErr) {
        // Even the image fallback failed — surface the original video error.
        throw videoError ?? (imgErr instanceof Error ? imgErr : new Error('video+image fallback both failed'))
      }
    }
    buf = videoBuf
    const imgDurationMs = Date.now() - t0video

    // Video output: Arabic text overlay is not supported on mp4 buffers via Sharp.
    // Hard Rule #3 compliance is maintained — Arabic text is never in the fal.ai
    // prompt; it simply cannot be composited post-generation for video artifacts.
    // Watermark: when confidence_flag='watermark_required', log a warning so the
    // caller (N8N) can track it. The watermark boolean in calendar_posts handles
    // the UI-level badge. mp4 watermark burn-in requires ffmpeg which is outside
    // the current Sharp-only pipeline.
    if (ctx.confidence_flag === 'watermark_required') {
      buf = await applyVideoWatermark(buf, ctx.post_id)
    }

    // Upload directly to Supabase Storage as .mp4.
    const storage_url = await uploadPostImage(
      buf, ctx.brand_id, ctx.post_id, ctx.month, ctx.revision_count ?? 0,
      { contentType: 'video/mp4', extension: 'mp4' },
    )

    // Write cost row — use chain's cost_estimate_usd directly (88 chains all have it)
    void writeImageCostLog(ctx, {
      node_name:        'video_generation',
      request_type:     'video_cost',
      model:            `${ctx.fal_model_primary}+${ctx.fal_model_secondary}`,
      cost_usd:         ctx.chain_cost_usd ?? 0,
      images_generated: 2,   // keyframe + video
      duration_ms:      imgDurationMs,
    })

    return { storage_url, clean_storage_url: null }
  }

  const t0img = Date.now()
  if (ctx.fal_workflow_id) {
    buf = await generateFalWorkflowImage(ctx.prompt_en, ctx.fal_workflow_id)
  } else {
    buf = await generateFalImage(ctx.prompt_en, falCfg)
  }
  const imgDurationMs = Date.now() - t0img

  // 2. Normalise to lossless PNG for all intermediate compositing steps.
  buf = await sharp(buf).png().toBuffer()

  // 3a+3b. Run clean-variant upload and Sonnet vision layout detection in parallel.
  const cleanJpeg = await sharp(buf).jpeg({ quality: 88 }).toBuffer()

  // Resolve the overlay zone. An explicit caller-supplied `layout` is treated as a
  // deliberate override and skips vision; otherwise the Sonnet vision agent picks
  // the zone per-image so placement varies with composition. N8N-V01 only sends
  // `layout` when DeepSeek returned a genuine sharp_text_gravity — absent that, the
  // key is omitted and this runs detectLayout(). Logged so it's always visible
  // which path was taken (and that vision wasn't silently suppressed).
  let layoutPromise: Promise<OverlayLayout>
  if (ctx.layout) {
    console.log(`[generate] explicit layout="${ctx.layout}" supplied — skipping Sonnet vision (post=${ctx.post_id})`)
    layoutPromise = Promise.resolve(ctx.layout)
  } else {
    console.log(`[generate] no layout hint — running Sonnet vision detection (post=${ctx.post_id})`)
    layoutPromise = detectLayout(buf)
  }

  const [clean_storage_url, detectedLayout] = await Promise.all([
    uploadCleanPostImage(cleanJpeg, ctx.brand_id, ctx.post_id, ctx.month, ctx.revision_count ?? 0)
      .then((url) => { console.log(`[generate] clean upload OK: ${url}`); return url })
      .catch((e: Error) => { console.error(`[generate] clean upload FAILED: ${e.message}`); return null }),

    layoutPromise,
  ])
  console.log(`[generate] overlay zone resolved: ${detectedLayout} (post=${ctx.post_id})`)

  // 4. Safe zone (no-op)
  buf = await applySafeZone(buf, ctx.channel)

  // 5. Arabic typography layer (Hard Rule #3: post-generation only)
  const colorHex = ctx.palette_hex[0] ?? '#FFFFFF'
  buf = await applyArabicOverlay(buf, ctx.brand_name_ar, ctx.dialect, colorHex, {
    headlineAr:        ctx.headline_ar,
    channel:           ctx.channel,
    postId:            ctx.post_id,
    layout:            detectedLayout,
    fontColorOverride: ctx.font_color,
    fontSizeOverride:  ctx.font_size,
  })

  // 6. Watermark
  buf = await applyWatermark(buf, ctx.confidence_flag === 'watermark_required')

  // 7. Single final JPEG encode
  buf = await sharp(buf).jpeg({ quality: 88 }).toBuffer()

  // 8. Upload to Supabase Storage
  const storage_url = await uploadPostImage(
    buf, ctx.brand_id, ctx.post_id, ctx.month, ctx.revision_count ?? 0,
  )

  // Write cost row — use chain's cost_estimate_usd directly (88 chains all have it)
  void writeImageCostLog(ctx, {
    node_name:        'image_generation',
    request_type:     'image_cost',
    model:            ctx.fal_model_primary ?? ctx.fal_workflow_id ?? 'unknown',
    cost_usd:         ctx.chain_cost_usd ?? 0,
    images_generated: 1,
    duration_ms:      imgDurationMs,
  })

  // SDAIA C2PA compliance (spec §12.2) — mark every AI-generated asset.
  // We don't embed a cryptographic C2PA manifest yet (requires c2pa-node),
  // but we set the DB flag so the audit trail is complete and the UI can
  // display the AI-generated badge. Full manifest embedding is Phase 3.
  if (ctx.db && ctx.post_id) {
    void ctx.db.from('calendar_posts')
      .update({ watermark: true, c2pa_signed: false } as never)
      .eq('post_id', ctx.post_id)
      .then(({ error }: { error: unknown }) => {
        if (error) console.warn('[generate] c2pa flag update failed:', (error as Error)?.message ?? String(error))
      })
  }

  return { storage_url, clean_storage_url }
}

/**
 * ASYNC video submit — keyframe SYNC (~25s, becomes the fallback still), then submit
 * the Kling/Seedance i2v animate job to fal's queue with a webhook and return the
 * request_id immediately. The caller writes usage_logs(fal_request_id) so the
 * /api/webhooks/fal-ai/video-callback can correlate the result → storage_url later.
 * This is what makes video NON-BLOCKING: the worker returns in ~25s, not ~250s.
 */
export async function submitPostVideoAsync(
  ctx: ImageGenerationContext,
  webhookUrl: string,
): Promise<{ request_id: string; keyframe_url: string | null; animator_model: string }> {
  const falCfg: FalModelConfig = {
    first_ever_post: ctx.first_ever_post, cost_constraint: ctx.cost_constraint,
    score: ctx.score, objective: ctx.objective, channel: ctx.channel,
    fal_model_primary: ctx.fal_model_primary, fal_model_secondary: ctx.fal_model_secondary,
    negative_prompt: ctx.negative_prompt,
  }
  const DEFAULT_VIDEO_PRIMARY   = process.env.FAL_VIDEO_KEYFRAME_MODEL ?? 'fal-ai/flux-pro/v1.1-ultra'
  const DEFAULT_VIDEO_SECONDARY = process.env.FAL_VIDEO_ANIMATE_MODEL  ?? 'fal-ai/kling-video/v1.6/pro/image-to-video'
  // Keyframe uploaded at {post_id}-kf.jpg — the same fallback path the Worker's
  // Sweep Video Processing looks for, so a failed render degrades to this still.
  const keyframeUploadFn = (kfBuf: Buffer): Promise<string> =>
    uploadPostImage(kfBuf, ctx.brand_id, `${ctx.post_id}-kf`, ctx.month, 0, { contentType: 'image/jpeg', extension: 'jpg' })
  return submitVideoChainAsync(ctx.prompt_en, {
    ...falCfg,
    fal_model_primary:   ctx.fal_model_primary   ?? DEFAULT_VIDEO_PRIMARY,
    fal_model_secondary: ctx.fal_model_secondary ?? DEFAULT_VIDEO_SECONDARY,
  }, {
    webhookUrl,
    keyframeUploadFn,
    reference_image_url: ctx.reference_image_url,
    duration_seconds: ctx.output_duration_s,
    aspect_ratio: ctx.aspect_ratio,
    output_width: ctx.output_width,
    output_height: ctx.output_height,
  })
}

// ── Internal cost logger ──────────────────────────────────────────────────────

async function writeImageCostLog(
  ctx: ImageGenerationContext,
  row: {
    node_name:        string
    request_type:     string
    model:            string
    cost_usd:         number
    images_generated: number
    duration_ms:      number
  },
): Promise<void> {
  if (!ctx.db) return
  try {
    await ctx.db.from('usage_logs').insert({
      flow_id:          ctx.flow_id,
      brand_id:         ctx.brand_id,
      node_name:        row.node_name,
      agent:            'FAL',
      provider:         'fal',
      model:            row.model,
      request_type:     row.request_type,
      status:           'success',
      flow_run_id:      ctx.flow_run_id   ?? null,
      client_slug:      ctx.client_slug   ?? null,
      images_generated: row.images_generated,
      cost_usd:         row.cost_usd,
      cost_usd_input:   0,
      cost_usd_output:  row.cost_usd,  // FAL has no input/output split — total = output
      cost_usd_cached:  0,
      tokens_in:        0,
      tokens_out:       0,
      duration_ms:      row.duration_ms,
      payload: {
        post_id:   ctx.post_id,
        channel:   ctx.channel,
        objective: ctx.objective,
        chain_id:  ctx.chain_id ?? null,
      },
    } as never)
  } catch (err) {
    // Non-fatal — never break image generation on a logging error
    console.warn('[generate] usage_logs insert failed:', err instanceof Error ? err.message : String(err))
  }
}
