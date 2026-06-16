/**
 * Manual test: Arabic overlay on synthetic gradient images.
 * Run: cd OGz-Studios && npx tsx packages/image/src/test-overlay.ts
 * Output: /tmp/test-overlay-{zone}.jpg
 */
import sharp from 'sharp'
import { applyArabicOverlay } from './overlay'

const W = 1080
const H = 1080

// Synthetic food-photo stand-in: vertical gradient dark→light→dark
async function makeTestImage(): Promise<Buffer> {
  const pixels = Buffer.alloc(W * H * 3)
  for (let y = 0; y < H; y++) {
    const t = y / H
    // warm amber gradient: dark at top/bottom, lighter in middle
    const r = Math.round(40  + 160 * Math.sin(Math.PI * t))
    const g = Math.round(20  + 100 * Math.sin(Math.PI * t))
    const b = Math.round(10  +  40 * Math.sin(Math.PI * t))
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3
      pixels[i]     = r
      pixels[i + 1] = g
      pixels[i + 2] = b
    }
  }
  return sharp(pixels, { raw: { width: W, height: H, channels: 3 } })
    .png()
    .toBuffer()
}

async function run() {
  console.log('Generating test base image …')
  const base = await makeTestImage()

  const TESTS: Array<{ zone: 'top-right' | 'center-right' | 'bottom-right'; label: string }> = [
    { zone: 'top-right',    label: 'top' },
    { zone: 'center-right', label: 'center' },
    { zone: 'bottom-right', label: 'bottom' },
  ]

  for (const { zone, label } of TESTS) {
    console.log(`\nApplying overlay — zone: ${zone}`)
    const result = await applyArabicOverlay(
      base,
      'مطعم نجدي',           // brand name
      'Najdi',               // dialect → NotoNaskhArabic
      '#D4A843',             // warm gold — brand palette color
      {
        headlineAr: 'أصالة المذاق من قلب نجد',
        layout:     zone,
      },
    )

    const jpg = await sharp(result).jpeg({ quality: 88 }).toBuffer()
    const outPath = `/tmp/test-overlay-${label}.jpg`
    require('node:fs').writeFileSync(outPath, jpg)
    console.log(`  ✓ saved → ${outPath}  (${Math.round(jpg.length / 1024)} KB)`)
  }

  // Extra: no headline — brand name only
  console.log('\nApplying overlay — brand-only (no headline)')
  const brandOnly = await applyArabicOverlay(
    base,
    'مطعم نجدي',
    'Gulf',
    '#FFFFFF',
    { layout: 'lower-right' },
  )
  const brandJpg = await sharp(brandOnly).jpeg({ quality: 88 }).toBuffer()
  require('node:fs').writeFileSync('/tmp/test-overlay-brand-only.jpg', brandJpg)
  console.log(`  ✓ saved → /tmp/test-overlay-brand-only.jpg  (${Math.round(brandJpg.length / 1024)} KB)`)

  console.log('\n✅ All tests complete. Open /tmp/test-overlay-*.jpg to inspect.\n')
}

run().catch(e => { console.error('FAILED:', e); process.exit(1) })
