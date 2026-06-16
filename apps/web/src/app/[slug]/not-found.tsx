import Link from 'next/link'
import { isDbConfigured } from '@repo/db'
import { Card, CardBody } from '@repo/ui/card'
import { SetupBanner } from '@repo/ui/setup-banner'
import { Code } from '@repo/ui/code'
import { getServerT } from '@/lib/i18n-server'

/**
 * Reached when getBrandBySlug() returns null — either because the slug
 * is wrong, or because the database isn't configured yet.
 *
 * No admin entry-point is exposed here: admins reach their panel via
 * /admin-access, never from a client-facing surface.
 */
export default async function ClientNotFound() {
  const { t } = await getServerT()
  const dbReady = isDbConfigured()

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <SetupBanner
        show={!dbReady}
        title={t('common.setupBannerTitle')}
        body={
          <>
            {t('common.setupBannerBody').split('{cmd}').map((part, i, arr) => (
              <span key={i}>
                {part}
                {i < arr.length - 1 && <Code>pnpm db:setup</Code>}
              </span>
            ))}
          </>
        }
        hint={t('common.setupBannerHint')}
      />
      {dbReady && (
        <Card>
          <CardBody className="space-y-3 text-center">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-(--fg)">404</h1>
            <p className="text-sm text-(--fg-muted)">
              {t('common.noData')}
            </p>
          </CardBody>
        </Card>
      )}
      <div className="mt-6 flex justify-center">
        <Link href="/" className="text-sm text-(--accent) hover:underline">
          ← {t('common.backToHome')}
        </Link>
      </div>
    </main>
  )
}
