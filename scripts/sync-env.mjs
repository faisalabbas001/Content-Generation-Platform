#!/usr/bin/env node
/**
 * Mirrors the workspace-root .env.local into apps/web/.env.local.
 *
 * Why: Next.js auto-loads .env files from the app directory only.
 * `next.config.ts` calls @next/env's `loadEnvConfig` against the workspace
 * root, but the per-app file is a defensive fallback for any code path
 * that reads env directly (Turbopack quirks, edge cases).
 *
 * Run by:  apps/web/package.json predev/prebuild
 * Idempotent. Safe to run multiple times.
 */
import { copyFileSync, existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const src = resolve(root, '.env.local')
const dst = resolve(root, 'apps/web/.env.local')

if (!existsSync(src)) {
  console.warn(`! ${src} does not exist — skipping sync. Create it from .env.example.`)
  process.exit(0)
}

// Skip copy if dst is newer (developer might be testing per-app overrides).
if (existsSync(dst) && statSync(dst).mtimeMs > statSync(src).mtimeMs) {
  console.log('✓ apps/web/.env.local is newer than the root copy — leaving as-is.')
  process.exit(0)
}

copyFileSync(src, dst)
console.log(`✓ synced .env.local → apps/web/.env.local`)
