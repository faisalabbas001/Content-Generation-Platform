import { getServerT } from '@/lib/i18n-server'
import { CopilotScreen } from '../_copilot-screen'

export default async function TechCopilotPage() {
  const { t } = await getServerT()
  return (
    <CopilotScreen
      role="tech"
      apiPath="/api/copilot/tech"
      texts={{
        eyebrow: t('marketingHome.copilotsEyebrow'),
        title: t('copilotChat.navTech'),
        intro: t('copilotChat.introTech'),
        scopeNote: t('copilotChat.scopeTech'),
        placeholder: t('copilotChat.placeholder'),
        suggestions: [
          t('copilotChat.suggestions.techA'),
          t('copilotChat.suggestions.techB'),
          t('copilotChat.suggestions.techC'),
        ],
      }}
    />
  )
}
