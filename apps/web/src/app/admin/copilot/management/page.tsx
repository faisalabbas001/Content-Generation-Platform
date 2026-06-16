import { getServerT } from '@/lib/i18n-server'
import { CopilotScreen } from '../_copilot-screen'

export default async function ManagementCopilotPage() {
  const { t } = await getServerT()
  return (
    <CopilotScreen
      role="management"
      apiPath="/api/copilot/management"
      texts={{
        eyebrow: t('marketingHome.copilotsEyebrow'),
        title: t('copilotChat.navManagement'),
        intro: t('copilotChat.introManagement'),
        scopeNote: t('copilotChat.scopeManagement'),
        placeholder: t('copilotChat.placeholder'),
        suggestions: [
          t('copilotChat.suggestions.managementA'),
          t('copilotChat.suggestions.managementB'),
          t('copilotChat.suggestions.managementC'),
        ],
      }}
    />
  )
}
