import { getServerT } from '@/lib/i18n-server'
import { CopilotScreen } from '../_copilot-screen'

export default async function ProductionCopilotPage() {
  const { t } = await getServerT()
  return (
    <CopilotScreen
      role="production"
      apiPath="/api/copilot/production"
      texts={{
        eyebrow: t('marketingHome.copilotsEyebrow'),
        title: t('copilotChat.navProduction'),
        intro: t('copilotChat.introProduction'),
        scopeNote: t('copilotChat.scopeProduction'),
        placeholder: t('copilotChat.placeholder'),
        suggestions: [
          t('copilotChat.suggestions.productionA'),
          t('copilotChat.suggestions.productionB'),
          t('copilotChat.suggestions.productionC'),
        ],
      }}
    />
  )
}
