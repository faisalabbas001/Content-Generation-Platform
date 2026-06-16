import type { MetadataRoute } from 'next'

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/about', '/pricing', '/legal/'],
        // App surfaces (admin + per-brand) and dev tooling are not indexable.
        disallow: ['/admin', '/admin/', '/dev', '/api/'],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  }
}
