import { Card, CardBody } from '@repo/ui/card'
import { ResetPasswordForm } from '@/components/auth/reset-password-form'
import { getServerT } from '@/lib/i18n-server'

export const dynamic = 'force-dynamic'

export default async function ResetPasswordPage() {
  const { t } = await getServerT()

  return (
    <Card>
      <CardBody className="space-y-6 p-7 sm:p-8">
        <header className="space-y-1.5">
          <div className="text-xs uppercase tracking-[0.2em] text-(--fg-muted)">
            {t('resetPassword.eyebrow')}
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-(--fg)">
            {t('resetPassword.title')}
          </h1>
          <p className="text-sm text-(--fg-muted)">{t('resetPassword.subtitle')}</p>
        </header>

        <ResetPasswordForm
          passwordLabel={t('resetPassword.passwordLabel')}
          confirmLabel={t('resetPassword.confirmLabel')}
          submitLabel={t('resetPassword.submit')}
          submittingLabel={t('resetPassword.submitting')}
          successTitle={t('resetPassword.successTitle')}
          successBody={t('resetPassword.successBody')}
          goToLoginLabel={t('resetPassword.goToLogin')}
          mismatchLabel={t('resetPassword.mismatch')}
          tooShortLabel={t('resetPassword.tooShort')}
          invalidLinkLabel={t('resetPassword.invalidLink')}
          genericErrorLabel={t('resetPassword.genericError')}
          showPasswordLabel={t('auth.showPassword')}
          hidePasswordLabel={t('auth.hidePassword')}
        />
      </CardBody>
    </Card>
  )
}
