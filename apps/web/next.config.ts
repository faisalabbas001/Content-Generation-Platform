import path from 'node:path'
import { loadEnvConfig } from '@next/env'
import type { NextConfig } from 'next'

// Load workspace-root .env files using the same loader Next.js uses
// internally. This MUST happen at module-top-level so it fires before
// Next.js starts bundling — that's the only window where setting
// `process.env.NEXT_PUBLIC_*` reaches the browser bundle.
//
// We also explicitly read `apps/web/.env.local` (synced via the predev
// script) as a belt-and-braces fallback in case the workspace-root file
// is missing on a fresh checkout.
const workspaceRoot = path.resolve(__dirname, '../..')
loadEnvConfig(workspaceRoot, /* dev */ process.env.NODE_ENV !== 'production')
loadEnvConfig(__dirname, /* dev */ process.env.NODE_ENV !== 'production')

const nextConfig: NextConfig = {
  allowedDevOrigins: ['vagrancy-pupil-spiritism.ngrok-free.dev', 'unwieldable-mavis-unbacked.ngrok-free.dev'],
  // Pin the Turbopack workspace root so Next does not have to infer it.
  // Silences the "multiple lockfiles" warning when running inside a monorepo.
  turbopack: {
    root: workspaceRoot,
  },
  images: {
    remotePatterns: [
      // Unsplash photo CDN — real photographs used by the marketing hero showcase.
      { protocol: 'https', hostname: 'images.unsplash.com' },
      // Picsum Photos — deterministic seeded placeholders for posts pending image generation.
      { protocol: 'https', hostname: 'picsum.photos' },
      // Supabase Storage — generated post images uploaded by @repo/image pipeline.
      { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' },
      // OGz Studios app CDN — visual placeholder and other hosted assets.
      { protocol: 'https', hostname: 'app.openclaw.com' },
    ],
  },
  // Required for Vercel to bundle the Arabic font files from packages/image/src/fonts/
  // when deploying /api/image/generate. Without this, the font directory is excluded
  // from the serverless function bundle and Sharp throws ENOENT at runtime.
  outputFileTracingRoot: workspaceRoot,
  outputFileTracingIncludes: {
    '/api/image/generate': ['../../packages/image/src/fonts/**'],
  },
}

export default nextConfig
