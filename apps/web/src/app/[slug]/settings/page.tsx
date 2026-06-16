import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@repo/ui/card'
import { requireBrandAccess } from '@repo/auth/server'
import { adminClient } from '@repo/db'
import { getServerT } from '@/lib/i18n-server'
import {
  ProfileForm,
  PasswordForm,
  NotificationsForm,
  DeleteAccountButton,
  InstagramConnectCard,
  PostizOAuthFeedback,
} from './settings-forms'

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { slug } = await params
  const sp = await searchParams
  const { t } = await getServerT()
  const { user, brand } = await requireBrandAccess(slug)

  const fullName = (user.user_metadata?.full_name as string | undefined) ?? brand.brand_name_ar
  const phone = (user.user_metadata?.phone as string | undefined) ?? ''

  const db = adminClient()
  const { data: igChannel } = await db
    .from('channel_profiles')
    .select('postiz_channel_id, handle')
    .eq('brand_id', brand.brand_id as string)
    .eq('channel', 'Instagram')
    .maybeSingle()

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={t('settings.eyebrow')} title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <Card>
        <CardHeader>
          <div><CardTitle>{t('settings.profileSection')}</CardTitle></div>
        </CardHeader>
        <CardBody>
          <ProfileForm
            slug={slug}
            initialFullName={fullName}
            initialEmail={user.email ?? ''}
            initialPhone={phone}
            labels={{
              saveProfile: t('settings.save'),
              changePassword: t('settings.changePassword'),
              saveNotifications: t('settings.save'),
              deleteAccount: t('settings.deleteAccount'),
              fullName: t('settings.fullName'),
              email: t('settings.email'),
              phone: t('settings.phone'),
              currentPassword: t('settings.currentPassword'),
              newPassword: t('settings.newPassword'),
              confirmPassword: t('settings.confirmPassword'),
            }}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div><CardTitle>{t('settings.securitySection')}</CardTitle></div>
        </CardHeader>
        <CardBody>
          <PasswordForm
            slug={slug}
            labels={{
              saveProfile: t('settings.save'),
              changePassword: t('settings.changePassword'),
              saveNotifications: t('settings.save'),
              deleteAccount: t('settings.deleteAccount'),
              fullName: t('settings.fullName'),
              phone: t('settings.phone'),
              currentPassword: t('settings.currentPassword'),
              newPassword: t('settings.newPassword'),
              confirmPassword: t('settings.confirmPassword'),
            }}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div><CardTitle>{t('settings.notificationsSection')}</CardTitle></div>
        </CardHeader>
        <CardBody>
          <NotificationsForm
            slug={slug}
            initial={{ calendar_ready: true, revision_ready: true, anomaly: false }}
            saveLabel={t('settings.save')}
            rows={[
              { name: 'notify_calendar_ready', label: t('settings.notifyCalendarReady'), defaultChecked: true },
              { name: 'notify_revision_ready', label: t('settings.notifyRevisionReady'), defaultChecked: true },
              { name: 'notify_anomaly',        label: t('settings.notifyAnomaly'),       defaultChecked: false },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div><CardTitle>Instagram</CardTitle></div>
        </CardHeader>
        <CardBody className="space-y-3">
          <InstagramConnectCard
            slug={slug}
            isConnected={!!igChannel?.postiz_channel_id}
            handle={igChannel?.handle ?? null}
          />
          <PostizOAuthFeedback
            postizConnected={sp.postiz_connected}
            postizError={sp.postiz_error}
          />
        </CardBody>
      </Card>

      <Card className="border-(--danger)/40">
        <CardHeader>
          <div>
            <CardTitle className="text-(--danger)">{t('settings.dangerSection')}</CardTitle>
            <CardDescription>{t('settings.deleteAccountHint')}</CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          <DeleteAccountButton slug={slug} label={t('settings.deleteAccount')} />
        </CardBody>
      </Card>
    </div>
  )
}
