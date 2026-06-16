#!/usr/bin/env node
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', 'apps', 'web', '.env.local') })

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 200 })
const userIds = users?.users?.map((u) => u.id) ?? []
const { data: brands } = await db.from('brand_profiles')
  .select('brand_id, brand_name_ar, brand_name_en, client_slug, sector, completeness_score, tier, auth_user_id')
  .in('auth_user_id', userIds.length > 0 ? userIds : ['00000000-0000-0000-0000-000000000000'])

const brandsByUser = new Map()
for (const b of brands ?? []) {
  const list = brandsByUser.get(b.auth_user_id) ?? []
  list.push(b)
  brandsByUser.set(b.auth_user_id, list)
}

console.log(`Found ${users?.users?.length ?? 0} users, ${brands?.length ?? 0} brands\n`)

let withBrand = 0, withoutBrand = 0, banned = 0, unconfirmed = 0
for (const u of users?.users ?? []) {
  const userBrands = brandsByUser.get(u.id) ?? []
  if (userBrands.length > 0) withBrand++
  else withoutBrand++
  if (u.banned_until && new Date(u.banned_until) > new Date()) banned++
  if (!u.email_confirmed_at) unconfirmed++
}
console.log(`Summary:`)
console.log(`  ${withBrand} users with ≥1 brand`)
console.log(`  ${withoutBrand} users with no brand`)
console.log(`  ${banned} banned`)
console.log(`  ${unconfirmed} email-unconfirmed`)

console.log(`\nTop 10 users with most brands:`)
const sorted = [...(users?.users ?? [])].map((u) => ({ u, count: (brandsByUser.get(u.id) ?? []).length })).sort((a, b) => b.count - a.count).slice(0, 10)
for (const { u, count } of sorted) {
  if (count === 0) continue
  const userBrands = brandsByUser.get(u.id) ?? []
  console.log(`  ${(u.email ?? u.id.slice(0,8)).padEnd(40)} ${count} brand(s)`)
  for (const b of userBrands.slice(0, 3)) {
    console.log(`     → ${(b.brand_name_en ?? b.brand_name_ar).padEnd(30)} ${b.client_slug.padEnd(28)} ${b.sector.padEnd(10)} completeness=${b.completeness_score}`)
  }
}
