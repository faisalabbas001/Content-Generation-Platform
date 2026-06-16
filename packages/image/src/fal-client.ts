/**
 * fal.ai queue API client — submit → poll → download.
 *
 * Hard Rule #4: the fal CDN URL is NEVER returned or stored.
 * The raw image/video Buffer is returned to the caller, who uploads to Supabase.
 *
 * Model routing per PDF §3.3 Node 3:
 *   first_ever_post=true          → Flux Ultra (FAL_FLUX_MODEL)
 *   cost_constraint='high'        → Nano Banana (FAL_NANO_BANANA_MODEL)
 *   score > 80 && awareness       → Flux Ultra
 *   default                       → Nano Banana
 *
 * Chain-aware routing (added 0066):
 *   When fal_model_primary is supplied (from chains table), it overrides
 *   the resolveModel logic entirely.
 *   When fal_model_secondary is also supplied, a two-model video pipeline
 *   is executed: primary generates a keyframe image, secondary (Kling) animates it.
 */

import sharp from 'sharp'

const FAL_QUEUE_BASE = 'https://queue.fal.run'
const FAL_RUN_BASE   = 'https://fal.run' 

const PHOTOREALISM_PREFIX = 'Photorealistic professional photography, natural lighting, high detail. '

/**
 * A scene-complete brief (DeepSeek contract: 50–100 words with its own subject,
 * style, lighting, palette, composition) must NOT get a hardcoded realism prefix:
 * "DSLR / 8K / hyperrealistic skin tones / candid documentary" fights the brand's
 * style_register (e.g. flat_graphic_warm = "no photorealism") and references faces
 * on no-face food shots. Only short/generic prompts (on-demand one-liners,
 * fallbacks) still get the prefix so they don't render flat.
 */
const COMPLETE_BRIEF_MIN_CHARS = 200
function realismPrefix(promptEn: string): string {
  return promptEn.trim().length >= COMPLETE_BRIEF_MIN_CHARS ? '' : PHOTOREALISM_PREFIX
}

/**
 * The EXACT final positive prompt string sent to fal for a given prompt body.
 * Exported so the generate route can persist it (c2pa_metadata.final_prompt)
 * for the admin QA "which prompt produced this image" view — single source of
 * truth, never reassembled by hand elsewhere.
 */
export function buildFinalFalPrompt(promptEn: string): string {
  return realismPrefix(promptEn) + sanitizePrompt(promptEn) + NO_TEXT_SUFFIX
}

/**
 * Merge a chain's negative prompt with the platform defaults instead of replacing
 * them: the chain contributes scene-specific exclusions, the defaults keep the
 * always-on guarantees (no text, no cartoon, no watermarks). De-duplicated by term.
 */
export function mergeNegativePrompts(chainNegative?: string | null): string {
  if (!chainNegative?.trim()) return DEFAULT_NEGATIVE_PROMPT
  const seen = new Set<string>()
  const terms: string[] = []
  for (const t of `${chainNegative}, ${DEFAULT_NEGATIVE_PROMPT}`.split(',')) {
    const term = t.trim()
    const key = term.toLowerCase()
    if (term && !seen.has(key)) { seen.add(key); terms.push(term) }
  }
  return terms.join(', ')
}

const NO_TEXT_SUFFIX = ' No text, no words, no numbers, no typography, no captions, no labels, no watermarks, no photography credits embedded anywhere in the image. Pure photographic scene only.'

const DEFAULT_NEGATIVE_PROMPT = 'text, words, letters, numbers, typography, captions, headlines, labels, watermarks, fonts, writing, signs, banners, cartoon, anime, illustration, CGI, 3D render, artificial, plastic skin, fake, unrealistic faces, painting, drawing'

/**
 * SCRUB-ONLY sanitizer — must NEVER delete scene content.
 *
 * The old version dropped whole SENTENCES that paired a text-action word with a
 * text-element word. DeepSeek briefs are ONE long sentence and legitimately say
 * "clear bottom strip for text overlay" (a COMPOSITION instruction telling the
 * model to leave empty space — "overlay" matched BOTH regexes) — so the ENTIRE
 * brief was deleted and fal received only NO_TEXT_SUFFIX → a random unrelated
 * image (audited: 33/58 posts of one calendar shipped with an EMPTY prompt).
 *
 * The DeepSeek brief is authoritative (user requirement). Rendered-typography
 * protection comes from NO_TEXT_SUFFIX + the negative prompt, not from cutting
 * the brief. We only scrub literal render-this-text payloads:
 *   • bracketed meta tags ("[VIDEO]")
 *   • quoted promo strings ("50% OFF") and quoted ALL-CAPS slogans
 *   • unquoted "NN% off/discount/sale" fragments
 * Fail-safe: if scrubbing somehow empties the prompt, return the raw brief.
 */
function sanitizePrompt(raw: string): string {
  const scrubbed = raw
    .replace(/\[[A-Z _-]{2,16}\]\s*/g, '')
    .replace(/"[^"]*\d+\s*%[^"]*"/g, '')
    .replace(/"[A-Z][A-Z\s]{3,}"/g, '')
    .replace(/\d+\s*%\s*(off|discount|sale)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return scrubbed.length > 0 ? scrubbed : raw.trim()
}

const CHANNEL_DIMS: Record<string, { width: number; height: number }> = {
  Instagram: { width: 1080, height: 1080 },
  Snapchat:  { width: 1080, height: 1920 },
  TikTok:    { width: 1080, height: 1920 },
  Twitter:   { width: 1200, height: 675 },
}

/**
 * Models that use aspect_ratio (enum string) instead of image_size ({ width, height }).
 * These models also do not accept negative_prompt or enable_safety_checker.
 * Source: fal.ai OpenAPI schema for each model.
 */
const FAL_ASPECT_RATIO_MODELS = new Set([
  'fal-ai/nano-banana',
])

/**
 * Map pixel dimensions to the nearest fal.ai aspect_ratio enum value.
 * nano-banana accepts: "21:9","16:9","3:2","4:3","5:4","1:1","4:5","3:4","2:3","9:16"
 */
function dimsToAspectRatio(width: number, height: number): string {
  const ratio = width / height
  const candidates: [number, string][] = [
    [21/9,  '21:9'],
    [16/9,  '16:9'],
    [3/2,   '3:2'],
    [4/3,   '4:3'],
    [5/4,   '5:4'],
    [1/1,   '1:1'],
    [4/5,   '4:5'],
    [3/4,   '3:4'],
    [2/3,   '2:3'],
    [9/16,  '9:16'],
  ]
  let best = '1:1'
  let bestDiff = Infinity
  for (const [r, label] of candidates) {
    const diff = Math.abs(ratio - r)
    if (diff < bestDiff) { bestDiff = diff; best = label }
  }
  return best
}

interface FalQueueSubmitResponse {
  request_id: string
  status_url: string
  response_url: string
}

interface FalStatusResponse {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  /** Kling (and some other models) embed the output directly in the COMPLETED status body. */
  output?: {
    video?:  { url: string }
    videos?: { url: string }[]
    images?: { url: string }[]
  }
}

interface FalImageResultResponse {
  images?: { url: string }[]
}

interface FalVideoResultResponse {
  video?: { url: string }
  videos?: { url: string }[]
}

export interface FalModelConfig {
  first_ever_post: boolean
  cost_constraint: string
  /** CCO score; null = unscored (treated as low for model routing). */
  score: number | null
  objective: string
  channel: string
  /** When set, bypasses standard routing and uses this exact FAL model ID. */
  model_override?: string
  /** When set, bypasses resolveModel() and uses this model directly. */
  fal_model_primary?: string
  /** When set alongside fal_model_primary, enables two-model video pipeline. */
  fal_model_secondary?: string
  /** Custom negative prompt from chain definition. Falls back to DEFAULT_NEGATIVE_PROMPT. */
  negative_prompt?: string
}

/**
 * Image-editing / image-to-image models (FLUX Kontext, inpaint, img2img, etc.)
 * REQUIRE an input `image_url` and cannot do text-to-image generation. Several
 * chains are seeded with `fal-ai/flux-pro/kontext` as their primary model; when
 * used for plain prompt-only generation fal.ai rejects the request (422).
 * This maps any such model to a standard text-to-image model so generation works.
 */
const IMAGE_EDIT_MODEL_RE = /kontext|image-to-image|img2img|inpaint|\/edit/i

function toTextToImageModel(model: string): string {
  if (IMAGE_EDIT_MODEL_RE.test(model)) {
    const fallback = process.env.FAL_NANO_BANANA_MODEL ?? 'fal-ai/flux-pro/v1.1'
    console.warn(`[fal-client] model "${model}" requires an input image — falling back to "${fallback}" for text-to-image`)
    return fallback
  }
  return model
}

function resolveModel(cfg: FalModelConfig): string {
  if (cfg.fal_model_primary) return toTextToImageModel(cfg.fal_model_primary)
  if (cfg.model_override) return toTextToImageModel(cfg.model_override)
  const ultra = process.env.FAL_FLUX_MODEL ?? 'fal-ai/flux-pro/v1.1-ultra'
  const pro   = process.env.FAL_NANO_BANANA_MODEL ?? 'fal-ai/flux-pro/v1.1'
  if (cfg.first_ever_post) return ultra
  if ((cfg.score ?? 0) > 80 && cfg.objective === 'awareness') return ultra
  return pro
}

// ─── Standard image generation (single model, queue) ─────────────────────────

export async function generateFalImage(promptEn: string, cfg: FalModelConfig): Promise<Buffer> {
  const key = process.env.FAL_KEY
  if (!key) throw new Error('FAL_KEY env var is not set')

  const dims  = CHANNEL_DIMS[cfg.channel] ?? CHANNEL_DIMS['Instagram']!
  const negPrompt = mergeNegativePrompts(cfg.negative_prompt)
  const sanitized = buildFinalFalPrompt(promptEn)

  const buildBody = (model: string) => {
    const isAspectRatioModel = FAL_ASPECT_RATIO_MODELS.has(model)
    return isAspectRatioModel
      ? {
          // nano-banana and similar models: aspect_ratio enum, no negative_prompt, no image_size
          prompt:       sanitized,
          num_images:   1,
          aspect_ratio: dimsToAspectRatio(dims.width, dims.height),
        }
      : {
          // flux-pro and other standard models: image_size object, negative_prompt supported
          prompt:                sanitized,
          negative_prompt:       negPrompt,
          image_size:            { width: dims.width, height: dims.height },
          num_images:            1,
          enable_safety_checker: true,
        }
  }

  // fal.ai intermittently returns 422 "model did not generate the expected output"
  // for a perfectly valid prompt — non-deterministic, and during fal degradation
  // WINDOWS the SAME model can 422 many times in a row. Two-level recovery:
  //   1. RE-SUBMIT (fresh seed) on the same model — clears most one-off rejections.
  //   2. ESCALATE to a DIFFERENT model when one model keeps failing — a different
  //      model = different safety/generation pipeline, which usually clears the
  //      window even when the primary is stuck. We never abandon a chain-pinned
  //      primary lightly: it's tried first and most.
  const primary = resolveModel(cfg)
  // Build the model ladder: primary first (most attempts), then distinct fallbacks.
  // Chain-pinned primaries (cfg.fal_model_primary/model_override) skip fallbacks —
  // a chain explicitly chose that model and silently swapping it would break intent.
  const isChainPinned = !!(cfg.fal_model_primary || cfg.model_override)
  const fallbacks = isChainPinned ? [] : [
    process.env.FAL_NANO_BANANA_MODEL ?? 'fal-ai/flux-pro/v1.1',
    'fal-ai/flux/dev',
  ].filter((m) => m !== primary)
  // Attempt plan: 3× primary, then 1× each distinct fallback.
  const ladder: string[] = [primary, primary, primary, ...fallbacks]

  console.log(`[fal-client][DEBUG] IMAGE → model=${primary} sanitized_prompt_preview="${sanitized.slice(0,200)}"`)
  console.log(`[fal-client][DEBUG] IMAGE → negative_prompt_preview="${negPrompt.slice(0,150)}"`)

  let lastErr: unknown
  for (let attempt = 0; attempt < ladder.length; attempt++) {
    const model = ladder[attempt]!
    const submitRes = await falFetch(`${FAL_QUEUE_BASE}/${model}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Key ${key}` },
      body: JSON.stringify(buildBody(model)),
    })

    if (!submitRes.ok) {
      const text = await submitRes.text()
      throw new Error(`fal.ai submit failed (${submitRes.status}) on ${model}: ${text.slice(0, 300)}`)
    }

    const queue = (await submitRes.json()) as FalQueueSubmitResponse
    try {
      return await pollAndDownloadImage(queue, key)
    } catch (err) {
      lastErr = err
      const retryable = (err as Error & { falRetryableResubmit?: boolean }).falRetryableResubmit === true
        || /returned FAILED status/.test((err as Error).message)
      if (!retryable || attempt === ladder.length - 1) throw err
      const next = ladder[attempt + 1]!
      const escalating = next !== model
      console.warn(`[fal-client] image attempt ${attempt + 1}/${ladder.length} on ${model} rejected by fal — ${escalating ? `ESCALATING to ${next}` : 'resubmitting same model'}`)
      await sleep(1500 * (attempt + 1))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('fal.ai image generation failed after model ladder')
}

// ─── Legacy workflow call (synchronous fal.run, 0055 backward-compat) ────────

export async function generateFalWorkflowImage(
  promptEn: string,
  falWorkflowId: string,
): Promise<Buffer> {
  const key = process.env.FAL_KEY
  if (!key) throw new Error('FAL_KEY env var is not set')

  const res = await fetch(`${FAL_RUN_BASE}/${falWorkflowId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${key}` },
    body: JSON.stringify({
      prompt:          buildFinalFalPrompt(promptEn),
      negative_prompt: DEFAULT_NEGATIVE_PROMPT,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`fal.ai workflow call failed (${res.status}): ${text.slice(0, 300)}`)
  }

  const result = (await res.json()) as FalImageResultResponse
  const imageUrl = result.images?.[0]?.url
  if (!imageUrl) throw new Error(`fal.ai workflow ${falWorkflowId} returned no images`)

  const imgRes = await fetch(imageUrl)
  if (!imgRes.ok) throw new Error(`fal.ai CDN download failed (${imgRes.status})`)
  return Buffer.from(await imgRes.arrayBuffer())
}

// ─── Video pipeline: image-to-video on a source still (chain's video model) ──

/** Seedance image-to-video models use a different request body than Kling. */
const SEEDANCE_MODEL_RE = /seedance/i

/**
 * Build the per-model request body for an image-to-video animator.
 * fal.ai's video models share `prompt` + `image_url` but differ on the rest:
 *   • Kling v1.6 i2v — duration enum 5|10, supports negative_prompt, aspect_ratio 16:9|9:16|1:1
 *   • Seedance (bytedance/seedance/*) — duration string "2".."12", resolution enum,
 *     NO negative_prompt, aspect_ratio incl. 9:16
 * Source: fal.ai OpenAPI schema per model.
 */
function buildAnimatorBody(
  model: string,
  promptEn: string,
  imageUrl: string,
  videoCfg: { duration_seconds?: number; aspect_ratio?: string },
  negPrompt: string,
): Record<string, unknown> {
  const prompt = sanitizePrompt(promptEn)
  const aspect_ratio = videoCfg.aspect_ratio ?? '16:9'
  if (SEEDANCE_MODEL_RE.test(model)) {
    // Seedance accepts a wide duration range; clamp to its valid 2–12s window.
    const d = Math.min(12, Math.max(2, Math.round(videoCfg.duration_seconds ?? 5)))
    return {
      prompt,
      image_url:  imageUrl,
      duration:   String(d),
      resolution: '1080p',
      aspect_ratio,
    }
  }
  // Kling family (default). The Kling i2v duration enum is ONLY "5" or "10" — it
  // physically cannot emit 6/7/8/9s. Snap to the nearest valid value, but bias any
  // chain asking for 6s+ UP to 10s so a 7s chain delivers a 10s clip instead of
  // silently collapsing to 5s (the cause of the "video is only 5 seconds" report).
  // For EXACT chain durations (e.g. a true 7s), set the chain's fal_model_secondary
  // to a Seedance i2v model — Seedance honours the full 2–12s range and is handled
  // by the SEEDANCE_MODEL_RE branch above.
  const requestedSeconds = videoCfg.duration_seconds ?? 5
  return {
    prompt,
    image_url:       imageUrl,
    duration:        requestedSeconds >= 6 ? 10 : 5,
    aspect_ratio,
    negative_prompt: negPrompt,
  }
}

/**
 * Generates a video by animating a source still image with the chain's
 * image-to-video model (fal_model_secondary — Kling i2v or Seedance i2v).
 *
 * Two ways the source still is obtained:
 *   • CLIENT PATH (TechDoc v1.0) — when `reference_image_url` is supplied (a prior
 *     generation, e.g. U06/F01), that image is animated DIRECTLY: a single model
 *     call, no keyframe synthesis. This is the spec-compliant route.
 *   • FALLBACK — when no reference image is available, a keyframe is synthesised
 *     from the text prompt via the keyframe model (fal_model_primary, a
 *     text-to-image model such as Flux), then animated. Keeps video working when
 *     no reference exists so the pipeline never silently fails.
 *
 * Returns the video buffer. Hard Rule #4: every intermediate fal CDN URL is
 * downloaded immediately and never stored or returned to the caller.
 */
export async function generateFalVideoChain(
  promptEn: string,
  cfg: FalModelConfig & { fal_model_primary: string; fal_model_secondary: string },
  videoCfg: {
    duration_seconds?: number
    aspect_ratio?: string
    output_width?: number
    output_height?: number
    /**
     * Spec-compliant input: a public URL of the reference image to animate
     * (a prior generation's Supabase Storage URL). When set, the keyframe step is
     * skipped entirely and this image is fed straight to the image-to-video model.
     */
    reference_image_url?: string | null
    /**
     * Optional callback that uploads the synthesised keyframe buffer and returns a
     * public URL. Used only on the FALLBACK path (no reference image). When provided,
     * this is used instead of uploadBufferToFalStorage so the caller can supply any
     * storage backend (e.g. Supabase Storage) for the animator's image_url.
     */
    keyframeUploadFn?: (buf: Buffer) => Promise<string>
  } = {},
): Promise<Buffer> {
  const key = process.env.FAL_KEY
  if (!key) throw new Error('FAL_KEY env var is not set')

  const negPrompt = mergeNegativePrompts(cfg.negative_prompt)
  const animatorModel = cfg.fal_model_secondary // the chain's image-to-video model

  // Resolve the source still image for the animator.
  let sourceImageUrl: string
  if (videoCfg.reference_image_url) {
    // CLIENT PATH: animate the supplied reference image directly (single model call).
    sourceImageUrl = videoCfg.reference_image_url
    console.log(`[fal-client] video: animating provided reference image via ${animatorModel} (single-model image-to-video)`)
  } else {
    // FALLBACK: synthesise a keyframe from the prompt, then animate it.
    // Guard: the keyframe is text-to-image — map any image-editing model (kontext)
    // to a text-to-image model so the keyframe step can't 422.
    const keyframeModel = toTextToImageModel(cfg.fal_model_primary)
    console.log(`[fal-client] video: no reference image — keyframe via ${keyframeModel}, then animate via ${animatorModel}`)
    const kfWidth  = videoCfg.output_width  ?? 1920
    const kfHeight = videoCfg.output_height ?? 1080
    const kfIsAspectRatioModel = FAL_ASPECT_RATIO_MODELS.has(keyframeModel)
    const kfSanitized = buildFinalFalPrompt(promptEn)
    console.log(`[fal-client][DEBUG] VIDEO keyframe → model=${keyframeModel} kfSanitized_preview="${kfSanitized.slice(0,200)}"`)

    const keyframeBody = kfIsAspectRatioModel
      ? { prompt: kfSanitized, num_images: 1, aspect_ratio: dimsToAspectRatio(kfWidth, kfHeight) }
      : { prompt: kfSanitized, negative_prompt: negPrompt, image_size: { width: kfWidth, height: kfHeight }, num_images: 1, enable_safety_checker: true }
    // Resubmit-on-422 (same non-deterministic fal rejection as generateFalImage).
    const KF_MAX_SUBMITS = 4
    let keyframeBuf: Buffer | null = null
    let kfErr: unknown
    for (let kfAttempt = 1; kfAttempt <= KF_MAX_SUBMITS; kfAttempt++) {
      const keyframeSubmit = await falFetch(`${FAL_QUEUE_BASE}/${keyframeModel}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Key ${key}` },
        body: JSON.stringify(keyframeBody),
      })
      if (!keyframeSubmit.ok) {
        const text = await keyframeSubmit.text()
        throw new Error(`fal.ai keyframe submit failed (${keyframeSubmit.status}): ${text.slice(0, 300)}`)
      }
      const keyframeQueue = (await keyframeSubmit.json()) as FalQueueSubmitResponse
      try {
        keyframeBuf = await pollAndDownloadImage(keyframeQueue, key)
        break
      } catch (err) {
        kfErr = err
        const retryable = (err as Error & { falRetryableResubmit?: boolean }).falRetryableResubmit === true
          || /returned FAILED status/.test((err as Error).message)
        if (!retryable || kfAttempt === KF_MAX_SUBMITS) throw err
        console.warn(`[fal-client] video keyframe attempt ${kfAttempt}/${KF_MAX_SUBMITS} rejected by fal — resubmitting`)
        await sleep(1500 * kfAttempt)
      }
    }
    if (!keyframeBuf) throw kfErr instanceof Error ? kfErr : new Error('fal.ai keyframe generation failed after resubmits')

    // Upload the keyframe so the animator can reference it as image_url.
    // Prefer the caller-supplied uploadFn (Supabase Storage); fall back to fal storage.
    sourceImageUrl = videoCfg.keyframeUploadFn
      ? await videoCfg.keyframeUploadFn(keyframeBuf)
      : await uploadBufferToFalStorage(keyframeBuf, key)
  }

  // Animate the source still into a video via the chain's image-to-video model.
  console.log(`[fal-client] video: animate via ${animatorModel}`)
  const videoSubmit = await falFetch(`${FAL_QUEUE_BASE}/${animatorModel}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${key}` },
    body: JSON.stringify(buildAnimatorBody(animatorModel, promptEn, sourceImageUrl, videoCfg, negPrompt)),
  })

  if (!videoSubmit.ok) {
    const text = await videoSubmit.text()
    throw new Error(`fal.ai animator submit failed (${videoSubmit.status}): ${text.slice(0, 300)}`)
  }

  const videoQueue = (await videoSubmit.json()) as FalQueueSubmitResponse
  return pollAndDownloadVideo(videoQueue, key)
}

/**
 * ASYNC video: generate the keyframe SYNC (~25s, also the fallback still), then
 * SUBMIT the image-to-video animate job to fal's queue with `?fal_webhook=` and
 * return the request_id WITHOUT polling. fal renders in the background (2-5 min)
 * and calls the webhook when done — so the caller never blocks on the long animate.
 *
 * Returns { request_id, keyframe_url, animator_model }. The keyframe is uploaded via
 * keyframeUploadFn (Supabase) so it doubles as the post's fallback still.
 */
export async function submitVideoChainAsync(
  promptEn: string,
  cfg: FalModelConfig & { fal_model_primary: string; fal_model_secondary: string },
  opts: {
    webhookUrl: string
    keyframeUploadFn: (buf: Buffer) => Promise<string>
    reference_image_url?: string | null
    duration_seconds?: number
    aspect_ratio?: string
    output_width?: number
    output_height?: number
  },
): Promise<{ request_id: string; keyframe_url: string | null; animator_model: string }> {
  const key = process.env.FAL_KEY
  if (!key) throw new Error('FAL_KEY env var is not set')
  const negPrompt = mergeNegativePrompts(cfg.negative_prompt)
  const animatorModel = cfg.fal_model_secondary

  console.log(`[fal-client][VIDEO-ASYNC] submitVideoChainAsync called: keyframeModel=${cfg.fal_model_primary} animatorModel=${animatorModel} promptEn_len=${promptEn.length} promptEn_preview="${promptEn.slice(0,200)}"`)

  // Resolve source still: provided reference image, else synthesise a keyframe (sync).
  let sourceImageUrl: string
  let keyframe_url: string | null = null
  if (opts.reference_image_url) {
    sourceImageUrl = opts.reference_image_url
    console.log(`[fal-client][VIDEO-ASYNC] using reference_image_url=${opts.reference_image_url.slice(0,80)} — skipping keyframe generation`)
  } else {
    const keyframeModel = toTextToImageModel(cfg.fal_model_primary)
    const kfWidth  = opts.output_width  ?? 1920
    const kfHeight = opts.output_height ?? 1080
    const kfIsAR = FAL_ASPECT_RATIO_MODELS.has(keyframeModel)
    const kfSanitized = buildFinalFalPrompt(promptEn)
    console.log(`[fal-client][VIDEO-ASYNC] keyframe: model=${keyframeModel} ${kfWidth}x${kfHeight} isAspectRatioModel=${kfIsAR}`)
    console.log(`[fal-client][VIDEO-ASYNC] keyframe prompt EXACT="${kfSanitized.slice(0,300)}"`)

    const keyframeBody = kfIsAR
      ? { prompt: kfSanitized, num_images: 1, aspect_ratio: dimsToAspectRatio(kfWidth, kfHeight) }
      : { prompt: kfSanitized, negative_prompt: negPrompt, image_size: { width: kfWidth, height: kfHeight }, num_images: 1, enable_safety_checker: true }
    const KF_MAX = 4
    let kfBuf: Buffer | null = null, kfErr: unknown
    for (let a = 1; a <= KF_MAX; a++) {
      const sub = await falFetch(`${FAL_QUEUE_BASE}/${keyframeModel}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Key ${key}` },
        body: JSON.stringify(keyframeBody),
      })
      if (!sub.ok) throw new Error(`fal.ai keyframe submit failed (${sub.status}): ${(await sub.text()).slice(0,300)}`)
      try { kfBuf = await pollAndDownloadImage((await sub.json()) as FalQueueSubmitResponse, key); break }
      catch (err) {
        kfErr = err
        const retryable = (err as Error & { falRetryableResubmit?: boolean }).falRetryableResubmit === true || /returned FAILED status/.test((err as Error).message)
        if (!retryable || a === KF_MAX) throw err
        await sleep(1500 * a)
      }
    }
    if (!kfBuf) throw kfErr instanceof Error ? kfErr : new Error('keyframe generation failed')
    keyframe_url = await opts.keyframeUploadFn(kfBuf)
    sourceImageUrl = keyframe_url
    console.log(`[fal-client][VIDEO-ASYNC] keyframe uploaded: ${keyframe_url}`)
  }

  // SUBMIT the animate job to fal's QUEUE with the webhook — DO NOT poll. fal posts
  // the result to webhookUrl when the render finishes.
  const animatorBody = buildAnimatorBody(animatorModel, promptEn, sourceImageUrl,
    { duration_seconds: opts.duration_seconds, aspect_ratio: opts.aspect_ratio }, negPrompt)
  console.log(`[fal-client][VIDEO-ASYNC] animator submit: model=${animatorModel} image_url=${sourceImageUrl.slice(0,80)} animatorBody=${JSON.stringify(animatorBody).slice(0,300)}`)
  const submitUrl = `${FAL_QUEUE_BASE}/${animatorModel}?fal_webhook=${encodeURIComponent(opts.webhookUrl)}`
  const res = await falFetch(submitUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${key}` },
    body: JSON.stringify(animatorBody),
  })
  if (!res.ok) {
    const errText = await res.text()
    console.error(`[fal-client][VIDEO-ASYNC] animator submit FAILED (${res.status}): ${errText.slice(0,300)}`)
    throw new Error(`fal.ai async animate submit failed (${res.status}): ${errText.slice(0,300)}`)
  }
  const q = (await res.json()) as FalQueueSubmitResponse
  console.log(`[fal-client][VIDEO-ASYNC] animator queued: request_id=${q.request_id} status_url=${q.status_url}`)
  if (!q.request_id) throw new Error('fal.ai async animate returned no request_id')
  return { request_id: q.request_id, keyframe_url, animator_model: animatorModel }
}

// ─── Polling helpers ──────────────────────────────────────────────────────────

/** Download a CDN URL with a 60s timeout and up to 3 attempts (transient CDN timeouts). */
async function downloadWithRetry(url: string, label: string): Promise<Buffer> {
  const maxAttempts = 3
  let lastErr: unknown
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await sleep(2000 * i)
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
      if (!res.ok) throw new Error(`fal.ai ${label} CDN download failed (${res.status})`)
      return Buffer.from(await res.arrayBuffer())
    } catch (err) {
      lastErr = err
      console.warn(`[fal] ${label} CDN download attempt ${i + 1}/${maxAttempts} failed:`, (err as Error).message)
    }
  }
  throw lastErr
}

async function pollAndDownloadImage(queue: FalQueueSubmitResponse, key: string): Promise<Buffer> {
  const maxAttempts = 60 // 60 × 2s = 2 min
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000)
    const statusRes = await fetch(queue.status_url, { headers: { Authorization: `Key ${key}` } })
    if (!statusRes.ok) throw new Error(`fal.ai status poll failed (${statusRes.status})`)
    const status = (await statusRes.json()) as FalStatusResponse
    if (status.status === 'FAILED') throw new Error('fal.ai generation returned FAILED status')
    if (status.status === 'COMPLETED') {
      // The result can lag the COMPLETED status by a beat — fal occasionally returns
      // 422/404 on the very first response_url fetch (the artifact isn't materialised
      // yet). Retry the result fetch a few times before giving up, and log fal's body
      // so a genuine rejection (e.g. content-policy) is visible instead of a bare 422.
      let result: FalImageResultResponse | null = null
      for (let r = 0; r < 4; r++) {
        const resultRes = await fetch(queue.response_url, { headers: { Authorization: `Key ${key}` } })
        if (resultRes.ok) { result = (await resultRes.json()) as FalImageResultResponse; break }
        const errBody = await resultRes.text().catch(() => '')
        console.warn(`[fal-client] image result fetch ${resultRes.status} (try ${r + 1}/4): ${errBody.slice(0, 300)}`)
        if (resultRes.status !== 422 && resultRes.status !== 404) {
          throw new Error(`fal.ai result fetch failed (${resultRes.status}): ${errBody.slice(0, 200)}`)
        }
        await sleep(2000 * (r + 1))
      }
      // 422 "the model did not generate the expected output" is fal's NON-DETERMINISTIC
      // generation rejection — the SAME prompt often succeeds on a fresh submit (new
      // seed). Re-fetching the same result URL never clears it, so tag the error and
      // let the caller re-submit the whole generation.
      if (!result) {
        const e = new Error('fal.ai result fetch failed (422) — model did not generate output (retryable: resubmit)')
        ;(e as Error & { falRetryableResubmit?: boolean }).falRetryableResubmit = true
        throw e
      }
      const imageUrl = result.images?.[0]?.url
      if (!imageUrl) throw new Error('fal.ai result contained no images')
      // Hard Rule #4: download immediately
      return downloadWithRetry(imageUrl, 'image')
    }
  }
  throw new Error('fal.ai generation timed out after 2 minutes')
}

async function pollAndDownloadVideo(queue: FalQueueSubmitResponse, key: string): Promise<Buffer> {
  // Kling Pro image-to-video (5s clip) takes 2–4 minutes in production.
  // Budget breakdown vs. Vercel Pro 300s ceiling:
  //   pollAndDownloadImage: 40 × 3s = 120s max (Flux typically finishes in 30–60s)
  //   pollAndDownloadVideo: 90 × 5s = 450s max  ← increased for local dev (no Vercel ceiling)
  //   Overhead (submit + upload + download): ~20s
  //   On Vercel Pro (300s ceiling): keep maxAttempts = 50. For local dev: 90 is safe.
  //   Very slow jobs (>450s) require the generation-worker service for async processing.
  const POLL_INTERVAL_MS = 5000
  const maxAttempts = 90  // 90 × 5s = 450s — covers slow Kling Pro jobs locally
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(POLL_INTERVAL_MS)
    const statusRes = await fetch(queue.status_url, { headers: { Authorization: `Key ${key}` } })
    if (!statusRes.ok) throw new Error(`fal.ai video status poll failed (${statusRes.status})`)
    const status = (await statusRes.json()) as FalStatusResponse
    if (status.status === 'FAILED') throw new Error('fal.ai video generation returned FAILED status')
    if (status.status === 'COMPLETED') {
      // Log the full COMPLETED body (first 600 chars) so we can see fal.ai's exact response shape.
      const statusSnap = JSON.stringify(status).slice(0, 600)
      console.log(`[fal-client] video COMPLETED status body: ${statusSnap}`)

      // fal.ai may embed output at different keys depending on the model.
      // Cast to any to probe all known shapes before falling back to response_url.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = status as any
      const inlineUrl: string | undefined =
        s?.output?.video?.url ??
        s?.output?.videos?.[0]?.url ??
        s?.video?.url ??
        s?.videos?.[0]?.url ??
        s?.result?.video?.url ??
        s?.result?.videos?.[0]?.url
      if (inlineUrl) {
        console.log(`[fal-client] video URL from status body: ${inlineUrl}`)
        return downloadWithRetry(inlineUrl, 'video')
      }

      // Fall back to response_url (standard fal.ai queue pattern for most models).
      console.log(`[fal-client] fetching response_url: ${queue.response_url}`)
      const resultRes = await fetch(queue.response_url, { headers: { Authorization: `Key ${key}` } })
      if (!resultRes.ok) {
        const errBody = await resultRes.text()
        console.error(`[fal-client] response_url ${resultRes.status}: ${errBody.slice(0, 300)}`)
        throw new Error(`fal.ai video result fetch failed (${resultRes.status})`)
      }
      const result = (await resultRes.json()) as FalVideoResultResponse
      const videoUrl = result.video?.url ?? result.videos?.[0]?.url
      if (!videoUrl) throw new Error('fal.ai video result contained no video URL')
      // Hard Rule #4: download immediately
      return downloadWithRetry(videoUrl, 'video')
    }
  }
  throw new Error('fal.ai video generation timed out after 450 seconds — Kling Pro job took unusually long; use the generation-worker service for reliable async video generation')
}

/**
 * Upload a buffer to fal's temporary file storage so it can be referenced
 * as image_url input for video models (Kling requires a URL, not a buffer).
 * The uploaded URL is transient (24h TTL on fal's side) — we never store it.
 *
 * fal.ai uses a two-step upload:
 *   Step A: POST /storage/upload/initiate  → { url: presignedPutUrl, file_url: permanentUrl }
 *   Step B: PUT  {presignedPutUrl}         → upload raw bytes (no auth header needed)
 *
 * NOTE: /storage/upload (no /initiate) returns 404 — that route does not exist.
 */
async function uploadBufferToFalStorage(buf: Buffer, key: string): Promise<string> {
  // Re-encode to JPEG before upload to guarantee content_type matches regardless of
  // what format the upstream model (Flux, Nano Banana, etc.) actually returned.
  // Without this, a PNG-output model causes a MIME mismatch on the presigned PUT,
  // and Kling receives a malformed image_url that fails at step 3 of the video chain.
  const jpegBuf = await sharp(buf).jpeg({ quality: 90 }).toBuffer()

  // Step A: Initiate — get a presigned PUT URL and the permanent CDN file URL
  const initRes = await fetch('https://rest.fal.ai/storage/upload/initiate', {
    method: 'POST',
    headers: {
      Authorization: `Key ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content_type: 'image/jpeg', file_name: 'keyframe.jpg' }),
  })
  if (!initRes.ok) {
    const text = await initRes.text()
    throw new Error(`fal.ai storage initiate failed (${initRes.status}): ${text.slice(0, 300)}`)
  }
  const { url: putUrl, file_url: fileUrl } = (await initRes.json()) as {
    url: string
    file_url: string
  }
  if (!putUrl || !fileUrl) throw new Error('fal.ai storage initiate returned incomplete URLs')

  // Step B: Upload JPEG bytes to the presigned PUT URL (no Authorization needed — signed by fal)
  const putRes = await fetch(putUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: new Uint8Array(jpegBuf.buffer as ArrayBuffer, jpegBuf.byteOffset, jpegBuf.byteLength),
  })
  if (!putRes.ok) {
    const text = await putRes.text()
    throw new Error(`fal.ai storage PUT failed (${putRes.status}): ${text.slice(0, 300)}`)
  }

  // Hard Rule #4: fileUrl is a fal CDN URL used only as Kling's image_url — never persisted.
  return fileUrl
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Retryable fetch for fal.ai API calls.
 *
 * Node.js's built-in fetch (undici) has a hard 10-second connect timeout
 * (UND_ERR_CONNECT_TIMEOUT). fal.ai's queue endpoint is occasionally slow to
 * accept new TCP connections under load. Without a retry the entire video
 * chain crashes on the first network hiccup.
 *
 * Retries up to `maxAttempts` times on network-layer errors only
 * (connect timeout, socket reset, DNS failure). HTTP-level errors (4xx/5xx)
 * are NOT retried here — the caller checks `res.ok` after return.
 */
const RETRYABLE_NETWORK_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_RESET',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNREFUSED',
])

async function falFetch(url: string, init: RequestInit, maxAttempts = 3): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const backoff = 3000 * attempt // 3s, 6s
      console.warn(`[fal-client] network retry ${attempt}/${maxAttempts - 1} in ${backoff}ms — ${url}`)
      await sleep(backoff)
    }
    try {
      return await fetch(url, init)
    } catch (err) {
      // Node.js wraps the undici error in a TypeError with a `cause` property.
      const cause = (err as { cause?: { code?: string } })?.cause
      const code  = cause?.code ?? ''
      if (RETRYABLE_NETWORK_CODES.has(code)) {
        lastErr = err
        console.warn(`[fal-client] network error (${code}) attempt ${attempt + 1}/${maxAttempts}`)
        continue
      }
      throw err // Non-network error — propagate immediately
    }
  }
  throw lastErr
}
