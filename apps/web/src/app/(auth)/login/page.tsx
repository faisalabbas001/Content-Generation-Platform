import Link from 'next/link'
import { Card, CardBody } from '@repo/ui/card'
import { LoginForm } from '@/components/auth/login-form'
import { GoogleAuthButton } from '@/components/auth/google-button'
import { getServerT } from '@/lib/i18n-server'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { t } = await getServerT()
  const params = await searchParams
  const next = params.next ?? '/onboarding-start'

  return (
    <Card>
      <CardBody className="space-y-6 p-7 sm:p-8">
        <header className="space-y-1.5">
          <div className="text-xs uppercase tracking-[0.2em] text-(--fg-muted)">
            {t('loginPage.eyebrow')}
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-(--fg)">
            {t('loginPage.title')}
          </h1>
          <p className="text-sm text-(--fg-muted)">{t('loginPage.subtitle')}</p>
        </header>

        <GoogleAuthButton label={t('loginPage.continueWithGoogle')} redirectTo={next} />

        <div className="flex items-center gap-3 text-xs text-(--fg-muted)">
          <div className="h-px flex-1 bg-(--border-subtle)" />
          <span>{t('loginPage.or')}</span>
          <div className="h-px flex-1 bg-(--border-subtle)" />
        </div>

        <LoginForm
          emailLabel={t('auth.email')}
          passwordLabel={t('auth.password')}
          submitLabel={t('auth.submit')}
          pendingLabel={t('auth.signingIn')}
          defaultRedirectTo={next}
          showPasswordLabel={t('auth.showPassword')}
          hidePasswordLabel={t('auth.hidePassword')}
          forgotPasswordLabel={t('loginPage.forgotPassword')}
        />

        <p className="text-center text-xs text-(--fg-muted)">
          {t('loginPage.noAccount')}{' '}
          <Link href="/signup" className="font-medium text-(--accent) hover:underline">
            {t('loginPage.signupNow')}
          </Link>
        </p>
      </CardBody>
    </Card>
  )
}
