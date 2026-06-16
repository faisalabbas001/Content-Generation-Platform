import type { Metadata, Viewport } from 'next'
import {
  Inter,
  Space_Grotesk,
  IBM_Plex_Sans_Arabic,
  Noto_Naskh_Arabic,
  JetBrains_Mono,
  Fraunces,
  Tajawal,
} from 'next/font/google'
import { direction, getT } from '@repo/i18n'
import { getLocale } from '@/lib/i18n-server'
import { getTheme } from '@/lib/theme-server'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
})

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-arabic',
  display: 'swap',
})

const naskhArabic = Noto_Naskh_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-naskh-arabic',
  display: 'swap',
})

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

const fraunces = Fraunces({
  subsets: ['latin'],
  weight: 'variable',
  variable: '--font-fraunces',
  display: 'swap',
})

const tajawal = Tajawal({
  subsets: ['arabic'],
  weight: ['400', '500', '700', '800'],
  variable: '--font-tajawal',
  display: 'swap',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#09090b' },
    { media: '(prefers-color-scheme: dark)',  color: '#09090b' },
  ],
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale()
  const t = getT(locale)
  return {
    title: `${t('common.appName')} — ${t('common.appTagline')}`,
    description: t('landing.subtitle'),
    icons: { icon: '/favicon.ico' },
    robots: { index: true, follow: true },
  }
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale()
  const dir = direction(locale)
  const theme = await getTheme()

  return (
    <html
      lang={locale}
      dir={dir}
      data-theme={theme}
      className={`${inter.variable} ${spaceGrotesk.variable} ${plexArabic.variable} ${naskhArabic.variable} ${jetbrains.variable} ${tajawal.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-(--bg) text-(--fg) font-body selection:bg-(--accent-soft) selection:text-(--fg)">
        {children}
      </body>
    </html>
  )
}
