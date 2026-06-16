import { Card, CardBody } from '@repo/ui/card'
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form'
import { getServerT } from '@/lib/i18n-server'

export const dynamic = 'force-dynamic'

export default async function ForgotPasswordPage() {
  const { t } = await getServerT()

  return (
    <Card>
      <CardBody className="space-y-6 p-7 sm:p-8">
        <header className="space-y-1.5">
          <div className="text-xs uppercase tracking-[0.2em] text-(--fg-muted)">
            {t('forgotPassword.eyebrow')}
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-(--fg)">
            {t('forgotPassword.title')}
          </h1>
          <p className="text-sm text-(--fg-muted)">{t('forgotPassword.subtitle')}</p>
        </header>

        <ForgotPasswordForm
          emailLabel={t('forgotPassword.emailLabel')}
          submitLabel={t('forgotPassword.submit')}
          submittingLabel={t('forgotPassword.submitting')}
          successTitle={t('forgotPassword.successTitle')}
          successBodyTemplate={t('forgotPassword.successBody')}
          backToLoginLabel={t('forgotPassword.backToLogin')}
          genericErrorLabel={t('forgotPassword.genericError')}
        />
      </CardBody>
    </Card>
  )
}
