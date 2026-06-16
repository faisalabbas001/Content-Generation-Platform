import { adminClient, isDbConfigured, type Db } from '../client'
import type { BrandProfile, EvidenceBundle } from '../types'

export async function getBrandBySlug(slug: string, client?: Db): Promise<BrandProfile | null> {
  const supabase = client ?? (isDbConfigured() ? adminClient() : null)
  if (!supabase) return null
  const { data, error } = await supabase
    .from('brand_profiles')
    .select('*')
    .eq('client_slug', slug)
    .maybeSingle()
  if (error) throw error
  return data as BrandProfile | null
}

export async function getAllBrands(client?: Db): Promise<BrandProfile[]> {
  const supabase = client ?? (isDbConfigured() ? adminClient() : null)
  if (!supabase) return []
  const { data, error } = await supabase
    .from('brand_profiles')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as BrandProfile[]
}

export async function getEvidenceBundlesForBrand(brandId: string, client?: Db): Promise<EvidenceBundle[]> {
  const supabase = client ?? (isDbConfigured() ? adminClient() : null)
  if (!supabase) return []
  const { data, error } = await supabase
    .from('evidence_bundles')
    .select('*')
    .eq('brand_id', brandId)
    .order('field_name', { ascending: true })
  if (error) throw error
  return (data ?? []) as EvidenceBundle[]
}
