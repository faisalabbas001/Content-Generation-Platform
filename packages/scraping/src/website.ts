/**
 * Apify Website Content Crawler — multi-page Firefox-rendered scrape.
 *
 * Runs the canonical apify~website-content-crawler actor with our defaults:
 *   • Up to 8 pages
 *   • Depth 2
 *   • playwright:firefox (handles JS-rendered SPAs)
 *   • Markdown output + structured data (JSON-LD, OG)
 *
 * Returns the raw page array; the caller (run wrapper) does the
 * homepage-pick + JSON-LD extraction during normalisation.
 */
import type { WebsitePageResult, WebsiteScrapeResult } from './types'

export interface WebsiteScrapeResultWithRunId extends WebsiteScrapeResult {
  apify_run_id: string | null
}

const APIFY_ENDPOINT = 'https://api.apify.com/v2/acts/apify~website-content-crawler/run-sync-get-dataset-items'

export interface RunWebsiteOptions {
  apifyToken: string
  url: string
  /** Per-page hard timeout. Default 120000 (Crawler is slower than IG). */
  timeoutMs?: number
  maxCrawlPages?: number
  maxCrawlDepth?: number
}

export async function runWebsiteScrape(opts: RunWebsiteOptions): Promise<WebsiteScrapeResultWithRunId> {
  const body = {
    startUrls:                   [{ url: opts.url }],
    maxCrawlPages:               opts.maxCrawlPages ?? 8,
    maxCrawlDepth:               opts.maxCrawlDepth ?? 2,
    crawlerType:                 'playwright:firefox',
    saveMarkdown:                true,
    saveHtml:                    false,
    saveStructuredData:          true,
    removeCookieWarnings:        true,
    removeElementsCssSelector:   'nav, footer, header, .cookie, .modal, [role="banner"], [role="navigation"], [role="contentinfo"]',
    blockMedia:                  true,
    expandIframes:               false,
    proxyConfiguration:          { useApifyProxy: true },
  }

  // Crawler can run >2min on slow targets; align with the wrapper's 5-min budget.
  const timeoutMs = opts.timeoutMs ?? 270000
  // Apify Free plan = 8 GB max concurrent actor memory. IG scraper grabs ~2 GB,
  // so Web Crawler's default 8 GB request returns HTTP 402 (memory-limit-exceeded)
  // when run in parallel. Pin to 2 GB — plenty for an 8-page Firefox crawl —
  // and the 3 lanes coexist comfortably (2 + 2 + ~0 = under cap).
  const memoryMbytes = 2048
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()
  try {
    console.info(`[scraping/website] START url=${opts.url} timeout=${timeoutMs}ms memory=${memoryMbytes}MB`)
    const url = `${APIFY_ENDPOINT}?token=${encodeURIComponent(opts.apifyToken)}&memory=${memoryMbytes}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const elapsed = Date.now() - startedAt
    // Capture run ID for exact cost lookup
    const apify_run_id = res.headers.get('X-Apify-Run-Id') ?? null
    if (apify_run_id) console.info(`[scraping/website] run_id=${apify_run_id}`)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.warn(`[scraping/website] HTTP ${res.status} after ${elapsed}ms: ${text.slice(0, 300)}`)
      return { ok: false, pages: [], error: `Apify Web ${res.status}: ${text.slice(0, 200)}`, apify_run_id }
    }
    const json = (await res.json()) as unknown
    const pages: WebsitePageResult[] = Array.isArray(json) ? (json as WebsitePageResult[]) : []
    console.info(`[scraping/website] OK ${pages.length} pages in ${elapsed}ms`)
    return {
      ok: pages.length > 0,
      pages,
      error: pages.length === 0 ? `Apify returned 0 pages (actor ran ${elapsed}ms — likely blocked by site or proxy)` : null,
      apify_run_id,
    }
  } catch (err) {
    const elapsed = Date.now() - startedAt
    const msg = err instanceof Error ? err.message : String(err)
    const aborted = msg.includes('aborted') || msg.includes('AbortError')
    console.warn(`[scraping/website] ERROR after ${elapsed}ms${aborted ? ' (timeout)' : ''}: ${msg}`)
    return { ok: false, pages: [], error: aborted ? `timeout after ${elapsed}ms` : msg, apify_run_id: null }
  } finally {
    clearTimeout(timer)
  }
}
