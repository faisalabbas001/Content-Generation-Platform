import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { Code } from '@repo/ui/code'
import { ShieldCheck } from '@repo/ui/icons'
import { getServerT } from '@/lib/i18n-server'

const ENV_VARS = [
  'ANTHROPIC_API_KEY','OPENAI_API_KEY','DEEPSEEK_API_KEY','GOOGLE_AI_API_KEY',
  'CEO_SYSTEM_PROMPT','COO_SYSTEM_PROMPT','CCO_SYSTEM_PROMPT','DEEPSEEK_SYSTEM_PROMPT',
  'COPILOT_MANAGEMENT_PROMPT','COPILOT_TECH_PROMPT','COPILOT_PRODUCTION_PROMPT',
  'WEAVY_API_KEY','NANO_BANANA_API_KEY','FLUX_ULTRA_API_KEY',
  'SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ADMIN_URL','SUPABASE_ADMIN_SERVICE_KEY',
  'QDRANT_URL','QDRANT_API_KEY','RESEND_API_KEY',
  'STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET',
  'POSTHOG_KEY','APIFY_API_KEY','N8N_WEBHOOK_SECRET',
  'POSTIZ_API_KEY','N8N_P01_WEBHOOK_PATH',
] as const

const INTEGRATIONS = [
  { name: 'Anthropic',  required: 'ANTHROPIC_API_KEY' },
  { name: 'OpenAI',     required: 'OPENAI_API_KEY' },
  { name: 'DeepSeek',   required: 'DEEPSEEK_API_KEY' },
  { name: 'Weavy',      required: 'WEAVY_API_KEY' },
  { name: 'Apify',      required: 'APIFY_API_KEY' },
  { name: 'Resend',     required: 'RESEND_API_KEY' },
  { name: 'Stripe',     required: 'STRIPE_SECRET_KEY' },
  { name: 'Supabase',   required: 'SUPABASE_URL' },
  { name: 'Qdrant',     required: 'QDRANT_URL' },
  { name: 'PostHog',    required: 'POSTHOG_KEY' },
  { name: 'Postiz',     required: 'POSTIZ_API_KEY' },
] as const

export default async function AdminSettingsPage() {
  const { t } = await getServerT()

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={t('adminSettings.eyebrow')} title={t('adminSettings.title')} subtitle={t('adminSettings.subtitle')} />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t('adminSettings.integrationsSection')}</CardTitle>
            <CardDescription>{t('adminSettings.integrationsHint')}</CardDescription>
          </div>
          <Badge tone="info" size="sm" dot>SEC-06 · prompts in env only</Badge>
        </CardHeader>
        <CardBody className="grid gap-3 sm:grid-cols-2">
          {INTEGRATIONS.map((i) => {
            const present = Boolean(process.env[i.required])
            return (
              <div
                key={i.name}
                className="flex items-center justify-between rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) px-4 py-3"
              >
                <div>
                  <div className="text-sm font-medium text-(--fg)">{i.name}</div>
                  <div className="font-mono text-[10px] text-(--fg-faint)">{i.required}</div>
                </div>
                <Badge tone={present ? 'success' : 'outline'} dot size="sm">
                  {present ? 'connected' : 'not set'}
                </Badge>
              </div>
            )
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t('adminSettings.envSection')}</CardTitle>
            <CardDescription>{t('adminSettings.envHint')}</CardDescription>
          </div>
          <ShieldCheck size={18} className="text-(--accent)" />
        </CardHeader>
        <CardBody>
          <ul className="grid gap-2 sm:grid-cols-2">
            {ENV_VARS.map((v) => (
              <li key={v} className="flex items-center justify-between gap-3 rounded-(--r-md) bg-(--surface-3) px-3 py-2">
                <Code className="bg-transparent border-0 text-(--fg-subtle)">{v}</Code>
                <Badge tone={process.env[v] ? 'success' : 'outline'} size="sm">
                  {process.env[v] ? 'set' : 'unset'}
                </Badge>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t('adminSettings.promptsSection')}</CardTitle>
            <CardDescription>{t('adminSettings.promptsHint')}</CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          <p className="text-xs text-(--fg-muted)">
            Prompt names follow the pattern <Code>*_SYSTEM_PROMPT</Code>. They are loaded from <Code>process.env</Code> at runtime and never logged.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
