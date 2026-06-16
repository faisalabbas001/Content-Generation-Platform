import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Card, CardBody } from '@repo/ui/card'
import { AdminLoginForm } from '@/components/auth/admin-login-form'
import { getAdminUserOrNull } from '@/lib/admin-session'
import { getServerT } from '@/lib/i18n-server'

export default async function AdminAccessPage() {
  const existingAdmin = await getAdminUserOrNull()
  if (existingAdmin) {
    redirect('/admin')
  }

  const { t } = await getServerT()

  return (
    <Card>
      <CardBody className="space-y-6 p-7 sm:p-8">
        <header className="space-y-1.5">
          <div className="text-xs uppercase tracking-[0.2em] text-(--fg-muted)">
            {t('adminAuth.eyebrow')}
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-(--fg)">
            {t('adminAuth.title')}
          </h1>
          <p className="text-sm text-(--fg-muted)">{t('adminAuth.subtitle')}</p>
        </header>

        <AdminLoginForm
          emailLabel={t('auth.email')}
          passwordLabel={t('auth.password')}
          submitLabel={t('adminAuth.submit')}
          pendingLabel={t('adminAuth.signingIn')}
          defaultRedirectTo="/admin"
          showPasswordLabel={t('auth.showPassword')}
          hidePasswordLabel={t('auth.hidePassword')}
        />

        <p className="text-center text-xs text-(--fg-muted)">
          <Link href="/" className="font-medium text-(--accent) hover:underline">
            {t('common.backToHome')}
          </Link>
        </p>
      </CardBody>
    </Card>
  )
}
