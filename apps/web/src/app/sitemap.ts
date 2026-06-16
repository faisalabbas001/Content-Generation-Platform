import type { MetadataRoute } from 'next'

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  const paths = [
    '/',
    '/about',
    '/pricing',
    '/login',
    '/signup',
    '/legal/privacy',
    '/legal/terms',
    '/legal/pdpl',
  ]
  return paths.map((p) => ({
    url: `${BASE}${p}`,
    lastModified: now,
    changeFrequency: p === '/' ? 'weekly' : 'monthly',
    priority: p === '/' ? 1.0 : 0.6,
  }))
}
