/**
 * Visual Prompt Composer — Zod contract for the DeepSeek-backed agent that
 * writes the English fal.ai image/video prompt (`visual_brief_en`).
 *
 * Replaces the primitive `brand_name_en + " product Saudi Arabia"` fallback
 * with a brand/occasion/chain-aware prompt. Hard Rule #3: the output is
 * English-only — Arabic is applied later via Sharp overlay, never in the prompt.
 */
import { z } from 'zod'

export const VisualPromptInput = z.object({
  brand_name_ar: z.string().min(1),
  brand_name_en: z.string().min(1),
  sector: z.string().min(1),
  primary_color_hex: z.string().optional(),
  dialect: z.string().optional(),
  content_type: z.string().min(1), // "product" | "lifestyle" | "offer" | "cultural" | …
  objective: z.string().min(1), // "awareness" | "conversion" | "trust" | "engagement"
  occasion: z.string().optional(), // "ramadan" | "national_day" | "eid" | …
  product_descriptor: z.string().min(1), // the hero of the shot
  chain_family: z.string().min(1), // "TF01", "TF13", "U01", … (soft context)
  platform: z.string().min(1), // "Instagram" | "TikTok" | "Snapchat"
  cultural_constraints: z.string().optional(), // e.g. "no faces, avoid left hand"
})
export type VisualPromptInput = z.infer<typeof VisualPromptInput>

export const VisualPromptResponse = z.object({
  visual_brief_en: z.string().min(1), // English-only fal.ai prompt (Hard Rule #3)
})
export type VisualPromptResponse = z.infer<typeof VisualPromptResponse>