/**
 * /[slug]/brand-insight — Dynamic BrandDNA enrichment.
 *
 * Fetches SELECT * from brand_profiles, passes the raw row to InsightForm.
 * InsightForm checks every field against its question catalogue and shows
 * only questions for fields that are actually null/empty in the DB.
 * Fully dynamic — no hardcoded "which questions to show" logic here.
 */
import { adminClient } from '@repo/db/client'
import { requireBrandAccess } from '@repo/auth/server'
import { InsightForm } from './insight-form'
import { getServerT } from '@/lib/i18n-server'

export const dynamic = 'force-dynamic'

export default async function BrandInsightPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { t } = await getServerT()
  // requireBrandAccess verifies ownership — safe to use adminClient below
  await requireBrandAccess(slug)

  // SELECT * — pass the entire brand row to the form.
  // The form's question catalogue checks each field against actual DB values
  // and shows only questions for fields that are null/empty.
  const { data: brand, error } = await adminClient()
    .from('brand_profiles')
    .select('*')
    .eq('client_slug', slug)
    .single()

  if (error || !brand) {
    return (
      <div className="py-20 text-center text-sm text-(--fg-muted)">
        Could not load brand data. Please refresh.
      </div>
    )
  }

  const b = brand as unknown as Record<string, unknown>

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-(--fg)">BrandDNA Enrichment</h1>
        <p className="text-sm text-(--fg-muted) max-w-2xl">
          The system checked your BrandDNA and found fields that need your input.
          Answer one at a time — each answer saves immediately.
        </p>
      </div>
      <InsightForm
        brandId={b['brand_id'] as string}
        slug={slug}
        brandNameAr={b['brand_name_ar'] as string}
        brandNameEn={(b['brand_name_en'] as string | null) ?? null}
        primaryColorHex={(b['primary_color_hex'] as string | null) ?? null}
        completenessScore={Number(b['completeness_score'] ?? 0)}
        sector={(b['sector'] as string) ?? ''}
        arabicDialect={(b['arabic_dialect'] as string | null) ?? null}
        // Pass the entire raw brand row — the form uses it to detect which fields are null
        rawBrand={b}
      />
    </div>
  )
}
