import { adminClient, isDbConfigured } from '../client'
import type { Occasion } from '../types'

export async function getUpcomingOccasions(fromDate = new Date()): Promise<Occasion[]> {
  if (!isDbConfigured()) return []
  const iso = fromDate.toISOString().slice(0, 10)
  const { data, error } = await adminClient()
    .from('occasion_intelligence')
    .select('*')
    .gte('gregorian_date', iso)
    .order('gregorian_date', { ascending: true })
    .limit(12)
  if (error) throw error
  return (data ?? []) as Occasion[]
}

export async function getAllOccasions(): Promise<Occasion[]> {
  if (!isDbConfigured()) return []
  const { data, error } = await adminClient()
    .from('occasion_intelligence')
    .select('*')
    .order('gregorian_date', { ascending: true })
  if (error) throw error
  return (data ?? []) as Occasion[]
}
