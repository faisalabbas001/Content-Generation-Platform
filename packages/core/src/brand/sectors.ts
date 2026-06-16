/**
 * Sector enum — mirrors the `sector_type` Postgres enum (migration 0001).
 */

export const SECTORS = [
  'F&B',
  'Retail',
  'Beauty_Wellness',
  'Healthcare',
  'Finance',
  'Government',
  'Other',
] as const

export type Sector = (typeof SECTORS)[number]

export function isSector(value: unknown): value is Sector {
  return typeof value === 'string' && (SECTORS as readonly string[]).includes(value)
}
