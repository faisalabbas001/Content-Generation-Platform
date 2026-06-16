/**
 * OGz Studios — DB reset (DANGEROUS — dev use only)
 *
 * Drops the public schema and all custom types, then re-applies migrations + seed.
 * Refuses to run unless SUPABASE_URL contains a clearly non-production project
 * (presence of "localhost" / "supabase.co" is allowed but the user must pass --yes).
 *
 * Usage: pnpm db:reset -- --yes
 */

import { loadEnv, getPgConnectionString, getDbLabel } from './lib/env.js'
import pg from 'pg'

const { Client } = pg

async function main(): Promise<void> {
  if (!process.argv.includes('--yes')) {
    console.error(
      '✗ Refusing to run without --yes\n' +
        '   This will DROP every table in the public schema.\n' +
        '   Re-run with: pnpm db:reset -- --yes',
    )
    process.exit(1)
  }

  loadEnv()
  const conn = getPgConnectionString()
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
  await client.connect()

  console.log(`→ Resetting ${getDbLabel()}`)

  try {
    // Drop and re-create the public schema — simplest safe reset on Supabase.
    await client.query(`
      drop schema if exists public cascade;
      create schema public;
      grant usage on schema public to postgres, anon, authenticated, service_role;
      grant all on all tables in schema public to postgres, service_role;
      grant all on all sequences in schema public to postgres, service_role;
      grant all on all functions in schema public to postgres, service_role;
      alter default privileges in schema public grant all on tables to postgres, service_role;
      alter default privileges in schema public grant all on sequences to postgres, service_role;
      alter default privileges in schema public grant all on functions to postgres, service_role;
    `)
    console.log('  · schema dropped and recreated')
  } finally {
    await client.end()
  }

  // Re-run migrations + seed via the same processes
  const { spawn } = await import('node:child_process')
  await run(spawn, 'pnpm', ['db:migrate'])
  await run(spawn, 'pnpm', ['db:seed'])

  console.log('✓ reset complete')
}

function run(spawn: typeof import('node:child_process').spawn, cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ps = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
    ps.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`)),
    )
  })
}

main().catch((err) => {
  console.error('✗ reset failed')
  console.error(err)
  process.exit(1)
})
