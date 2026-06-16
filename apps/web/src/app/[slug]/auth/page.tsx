import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody } from '@repo/ui/card'
import { LoginForm } from '@/components/auth/login-form'
import { getServerT } from '@/lib/i18n-server'

export default async function AuthPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { t } = await getServerT()
  return (
    <div>
      <PageHeader eyebrow={t('auth.eyebrow')} title={t('auth.title')} subtitle={t('auth.subtitle')} />
      <div className="mx-auto max-w-md">
        <Card>
          <CardBody className="space-y-5">
            <LoginForm
              emailLabel={t('auth.email')}
              passwordLabel={t('auth.password')}
              submitLabel={t('auth.submit')}
              pendingLabel={t('auth.signingIn')}
              defaultRedirectTo={`/${slug}/snapshot`}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
