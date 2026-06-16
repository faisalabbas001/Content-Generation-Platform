/**
 * Shared brand visual identity helpers used by both image and video generation routes.
 * Extracted from /api/image/generate/route.ts so both routes stay in sync.
 */

const ARCHETYPE_VISUAL_MODIFIERS: Record<string, string> = {
  Caregiver: 'warm intimate framing, family-oriented composition, soft daylight',
  Everyman:  'unposed documentary realism, accessible everyday scenes, neutral tones',
  Sage:      'editorial composition, archive-style framing, considered negative space',
  Lover:     'sensory close-ups, premium aesthetic, rich saturated palette',
  Magician:  'transformative reveal, before-after framing, dramatic light contrast',
  Ruler:     'institutional framing, symmetric composition, formal palette',
  Hero:      'action-forward composition, victorious framing, dynamic light',
  Creator:   'process-visible craft, behind-the-scenes framing, textured materials',
  Innocent:  'wholesome bright composition, simple geometry, optimistic palette',
  Outlaw:    'unconventional framing, contrast-led, refuses-the-frame composition',
  Explorer:  'frontier composition, unfinished iterative framing, expansive horizons',
  Jester:    'playful asymmetry, humor-led visual surprise, vibrant palette',
}

const VISUAL_IDIOM_MODIFIERS: Record<string, string> = {
  minimal_natural_light: 'minimal composition, soft natural light, uncluttered scene',
  archive_film_grain:    'archive film grain, muted vintage palette, slightly desaturated',
  flat_graphic_warm:     'flat graphic illustration, warm flat palette, no shadows',
  editorial_dramatic:    'editorial composition, dramatic chiaroscuro lighting, magazine-grade framing',
  documentary_unposed:   'documentary-style unposed framing, candid realism, ambient light',
  studio_polished:       'studio-polished product photography, controlled lighting, clean background',
}

export function buildVisualIdentityPreamble(input: {
  style_descriptor:  string | null
  color_palette:     string[] | null
  visual_idiom:      string | null
  archetype_primary: string | null
  fallback_palette:  string[]
}): string {
  const parts: string[] = []
  if (input.style_descriptor) parts.push(input.style_descriptor.trim().replace(/\.+$/, ''))
  if (input.visual_idiom && VISUAL_IDIOM_MODIFIERS[input.visual_idiom]) {
    parts.push(VISUAL_IDIOM_MODIFIERS[input.visual_idiom])
  }
  if (input.archetype_primary && ARCHETYPE_VISUAL_MODIFIERS[input.archetype_primary]) {
    parts.push(ARCHETYPE_VISUAL_MODIFIERS[input.archetype_primary])
  }
  const palette = (input.color_palette && input.color_palette.length > 0)
    ? input.color_palette : input.fallback_palette
  if (palette.length > 0) parts.push(`brand palette: ${palette.slice(0, 6).join(', ')}`)
  if (parts.length === 0) return ''
  return `Brand visual identity: ${parts.join('. ')}.`
}
