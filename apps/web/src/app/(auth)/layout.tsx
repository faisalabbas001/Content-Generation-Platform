import Link from 'next/link'
import { LocaleToggle } from '@/components/locale-toggle'
import { getServerT } from '@/lib/i18n-server'

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { locale, t } = await getServerT()
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-(--border-subtle) bg-(--bg)/85 px-4 py-3 backdrop-blur sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-(--r-md) bg-(--accent) font-display text-base font-bold text-(--accent-fg)">
            O
          </span>
          <span className="font-display text-base font-semibold tracking-tight text-(--fg)">
            {t('common.appName')}
          </span>
        </Link>
        <LocaleToggle current={locale} />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  )
}
