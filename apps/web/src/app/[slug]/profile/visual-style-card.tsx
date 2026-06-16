'use client'

// Visual style (colour palette + style descriptor) intentionally bypasses the
// CEO routing step. These are aesthetic preferences, not semantic BrandDNA that
// needs AI classification — the client picks colours directly and they write
// straight through Memory Controller with source='client_confirmation'.
// All other BrandDNA corrections (tone, archetype, dialect, etc.) go through
// CEO → n8n A04 → Memory Controller as normal.

import { useState, useTransition } from 'react'
import { Button } from '@repo/ui/button'
import { submitVisualStyleUpdate } from '@/app/actions/brand-correction'

interface Props {
  brandId: string
  initialPalette: string[] | null
  initialDescriptor: string | null
}

function isValidHex(v: string) { return /^#[0-9A-Fa-f]{6}$/.test(v) }

export function VisualStyleCard({ brandId, initialPalette, initialDescriptor }: Props) {
  const [editing, setEditing]         = useState(false)
  const [pending, startTransition]    = useTransition()
  const [result, setResult]           = useState<{ ok: boolean; error?: string } | null>(null)

  // Editing state
  const [palette, setPalette]         = useState<string[]>(initialPalette ?? [])
  const [descriptor, setDescriptor]   = useState(initialDescriptor ?? '')
  const [newHex, setNewHex]           = useState('#')
  const [hexError, setHexError]       = useState('')

  function openEditor() {
    setPalette(initialPalette ?? [])
    setDescriptor(initialDescriptor ?? '')
    setNewHex('#')
    setHexError('')
    setResult(null)
    setEditing(true)
  }

  function addColour() {
    const h = newHex.trim().toUpperCase()
    if (!isValidHex(h))        { setHexError('Enter a valid 6-digit hex — e.g. #FF5500'); return }
    if (palette.includes(h))   { setHexError('Already in palette'); return }
    if (palette.length >= 12)  { setHexError('Maximum 12 colours'); return }
    setPalette((p) => [...p, h])
    setNewHex('#')
    setHexError('')
  }

  function removeColour(hex: string) { setPalette((p) => p.filter((c) => c !== hex)) }

  function updateColour(idx: number, val: string) {
    setPalette((p) => p.map((c, i) => (i === idx ? val.trim().toUpperCase() : c)))
  }

  function save() {
    const badIdx = palette.findIndex((c) => !isValidHex(c))
    if (badIdx >= 0) { setResult({ ok: false, error: `"${palette[badIdx]}" is not a valid hex colour` }); return }

    const paletteChanged    = JSON.stringify(palette) !== JSON.stringify(initialPalette ?? [])
    const descriptorChanged = descriptor.trim() !== (initialDescriptor ?? '')

    if (!paletteChanged && !descriptorChanged) { setEditing(false); return }

    startTransition(async () => {
      const r = await submitVisualStyleUpdate({
        brand_id:         brandId,
        color_palette:    paletteChanged    ? palette              : undefined,
        style_descriptor: descriptorChanged ? descriptor.trim()    : undefined,
      })
      if (r.ok) {
        setEditing(false)
        setResult(null)
      } else {
        setResult({ ok: false, error: (r as { ok: false; error?: string }).error })
      }
    })
  }

  // ── Read-only view ──────────────────────────────────────────────────────────
  if (!editing) {
    return (
      <div className="space-y-3">
        {(initialDescriptor) && (
          <p className="text-sm text-(--fg)">{initialDescriptor}</p>
        )}

        {/* Colour swatches */}
        {(initialPalette?.length ?? 0) > 0 ? (
          <div className="flex flex-wrap gap-2">
            {(initialPalette ?? []).map((hex) => (
              <div key={hex} className="flex items-center gap-1.5 rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-2) px-2 py-1">
                <span className="h-4 w-4 rounded-sm shrink-0" style={{ backgroundColor: hex }} />
                <span className="font-mono text-xs text-(--fg-muted)">{hex.toUpperCase()}</span>
              </div>
            ))}
          </div>
        ) : (
          !initialDescriptor && <p className="text-sm text-(--fg-faint)">No visual style set yet.</p>
        )}

        <Button size="sm" variant="ghost" onClick={openEditor} className="mt-1">
          Edit visual style
        </Button>
      </div>
    )
  }

  // ── Editor ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Style descriptor */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-(--fg-muted) uppercase tracking-wider">Style description</label>
        <textarea
          value={descriptor}
          onChange={(e) => setDescriptor(e.target.value)}
          rows={3}
          className="w-full rounded-(--r-sm) border border-(--border-default) bg-(--surface-2) px-3 py-2 text-sm text-(--fg) placeholder:text-(--fg-faint) focus:outline-none focus:ring-1 focus:ring-(--accent) resize-none"
          placeholder="Warm photography, earth tones, cultural authenticity…"
        />
      </div>

      {/* Colour palette */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-(--fg-muted) uppercase tracking-wider">Colour palette</div>

        {/* Existing swatches — click to pick, ✕ to remove */}
        {palette.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {palette.map((hex, idx) => (
              <div key={idx} className="group flex items-center gap-1.5 rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-2) pl-1.5 pr-2 py-1">
                <label className="relative cursor-pointer" title="Change colour">
                  <span
                    className="block h-5 w-5 rounded-sm border border-(--border-subtle)"
                    style={{ backgroundColor: isValidHex(hex) ? hex : '#aaa' }}
                  />
                  <input
                    type="color"
                    value={isValidHex(hex) ? hex : '#aaaaaa'}
                    onChange={(e) => updateColour(idx, e.target.value)}
                    className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
                  />
                </label>
                <span className="font-mono text-xs text-(--fg)">{hex}</span>
                <button
                  onClick={() => removeColour(hex)}
                  className="text-xs text-(--fg-faint) hover:text-red-400"
                  title="Remove"
                >✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Add new colour */}
        <div className="flex items-center gap-2">
          <label className="relative cursor-pointer" title="Pick colour">
            <span
              className="block h-8 w-8 rounded-(--r-sm) border border-(--border-default) cursor-pointer"
              style={{ backgroundColor: isValidHex(newHex) ? newHex : '#cccccc' }}
            />
            <input
              type="color"
              value={isValidHex(newHex) ? newHex : '#cccccc'}
              onChange={(e) => { setNewHex(e.target.value.toUpperCase()); setHexError('') }}
              className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
            />
          </label>
          <input
            value={newHex}
            onChange={(e) => { setNewHex(e.target.value); setHexError('') }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addColour() } }}
            placeholder="#FF5500"
            maxLength={7}
            className="w-24 rounded-(--r-sm) border border-(--border-default) bg-(--surface-2) px-2 py-1.5 font-mono text-xs text-(--fg) focus:outline-none focus:ring-1 focus:ring-(--accent)"
          />
          <Button size="sm" variant="secondary" onClick={addColour} disabled={pending}>
            + Add
          </Button>
        </div>
        {hexError && <p className="text-xs text-red-400">{hexError}</p>}
      </div>

      {/* Error */}
      {result && !result.ok && (
        <p className="text-xs text-red-400">✗ {result.error}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" variant="primary" onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
