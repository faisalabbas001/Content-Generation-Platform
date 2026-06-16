import { adminClient } from '@repo/db/client'
import { PageHeader } from '@repo/ui/page-header'
import { Bell } from '@repo/ui/icons'
import { getServerT } from '@/lib/i18n-server'
import { TemplateEditor } from './template-editor'

export const dynamic = 'force-dynamic'

export default async function AdminNotificationsPage() {
  const { locale, t } = await getServerT()

  const db = adminClient()
  const { data } = await db
    .from('notification_templates')
    .select('*')
    .order('template_key')
    .order('lang')

  const templates = data ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('adminNotifications.eyebrow')}
        title={t('adminNotifications.title')}
        subtitle={t('adminNotifications.subtitle')}
        action={
          <div className="flex items-center gap-2 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) px-3 py-1.5">
            <Bell size={14} className="text-(--fg-muted)" />
            <span className="text-xs text-(--fg-muted)">
              {t('adminNotifications.templateCount').replace('{{count}}', String(templates.length))}
            </span>
          </div>
        }
      />
      <TemplateEditor initialTemplates={templates as any} locale={locale} />
    </div>
  )
}
