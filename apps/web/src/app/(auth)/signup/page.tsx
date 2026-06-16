import Link from 'next/link'
import { Card, CardBody } from '@repo/ui/card'
import { SignupForm } from '@/components/auth/signup-form'
import { GoogleAuthButton } from '@/components/auth/google-button'
import { getServerT } from '@/lib/i18n-server'

export default async function SignupPage({
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
            {t('signupPage.eyebrow')}
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-(--fg)">
            {t('signupPage.title')}
          </h1>
          <p className="text-sm text-(--fg-muted)">{t('signupPage.subtitle')}</p>
        </header>

        <GoogleAuthButton label={t('signupPage.continueWithGoogle')} redirectTo={next} />

        <div className="flex items-center gap-3 text-xs text-(--fg-muted)">
          <div className="h-px flex-1 bg-(--border-subtle)" />
          <span>{t('signupPage.or')}</span>
          <div className="h-px flex-1 bg-(--border-subtle)" />
        </div>

        <SignupForm
          fullNameLabel={t('contact.fields.fullName')}
          emailLabel={t('auth.email')}
          passwordLabel={t('auth.password')}
          submitLabel={t('auth.signupSubmit')}
          pendingLabel={t('auth.creatingAccount')}
          successLabel={t('auth.checkEmail')}
          defaultRedirectTo={next}
          showPasswordLabel={t('auth.showPassword')}
          hidePasswordLabel={t('auth.hidePassword')}
        />

        <p className="text-center text-xs text-(--fg-muted)">
          {t('signupPage.haveAccount')}{' '}
          <Link href="/login" className="font-medium text-(--accent) hover:underline">
            {t('signupPage.loginNow')}
          </Link>
        </p>
      </CardBody>
    </Card>
  )
}
