import { Card, CardBody } from '@repo/ui/card'
import { LinkButton } from '@repo/ui/button'
import { getServerT } from '@/lib/i18n-server'

export default async function RootNotFound() {
  const { t } = await getServerT()
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-6 py-16 text-center">
      <Card className="w-full">
        <CardBody className="space-y-5 py-12">
          <div className="font-display text-7xl font-semibold tracking-tight text-(--accent)">404</div>
          <h1 className="font-display text-2xl font-semibold text-(--fg)">{t('notFound.title')}</h1>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-(--fg-muted)">
            {t('notFound.description')}
          </p>
          <div className="flex justify-center pt-2">
            <LinkButton href="/" size="lg">{t('notFound.goHome')}</LinkButton>
          </div>
        </CardBody>
      </Card>
    </main>
  )
}
