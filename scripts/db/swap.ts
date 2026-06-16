/**
 * pnpm db:swap — interactive helper for switching to a new Supabase project.
 *
 * What it does:
 *   1. Sanity-checks that .env.local now points at a different project URL.
 *   2. Runs migrate + seed + verify on the new project.
 *
 * Usage flow when the client provides their own Supabase project:
 *   1. Edit .env.local — paste the new SUPABASE_URL, SUPABASE_ANON_KEY,
 *      SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL, and update
 *      NEXT_PUBLIC_SUPABASE_* to match.
 *   2. Run:  pnpm db:swap
 *   3. Run:  pnpm db:create-admin -- <admin@example.com> '<password>'
 *
 * No code changes needed — every Supabase reference comes from env vars.
 */
import { spawnSync } from 'node:child_process'
import { loadEnv, getDbLabel } from './lib/env.js'

function run(cmd: string, args: string[]) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

async function main() {
  loadEnv()
  console.log(`→ Active Supabase project: ${getDbLabel()}`)
  console.log('  Running migrate + seed + verify against this project.\n')

  run('pnpm', ['db:migrate'])
  run('pnpm', ['db:seed'])
  run('pnpm', ['db:verify'])

  console.log('\n✓ Swap complete.')
  console.log('  Next: pnpm db:create-admin -- <email> "<password>"')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
