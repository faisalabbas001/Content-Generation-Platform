import { PageLoader } from '@repo/ui/page-loader'
import { getServerT } from '@/lib/i18n-server'

export default async function RootLoading() {
  const { t } = await getServerT()
  return <PageLoader label={t('loaders.page')} />
}
