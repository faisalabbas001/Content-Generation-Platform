import { adminClient, isDbConfigured, type Db } from '../client'
import type { BrandSnapshot } from '../types'

export async function getLatestSnapshot(brandId: string, client?: Db): Promise<BrandSnapshot | null> {
  const supabase = client ?? (isDbConfigured() ? adminClient() : null)
  if (!supabase) return null
  const { data, error } = await supabase
    .from('brand_snapshots')
    .select('*')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as BrandSnapshot | null
}
