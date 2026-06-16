import {
  Sparkles, Languages, Calendar,
  ImageIcon, ShieldCheck, Users, Layers, Workflow, ArrowUpRight,
} from '@repo/ui/icons'
import { LinkButton } from '@repo/ui/button'
import { Badge } from '@repo/ui/badge'
import { Card } from '@repo/ui/card'
import { Hero } from '@repo/ui/client/hero'
import { FeatureCard } from '@repo/ui/client/feature-card'
import { HeroOgzVisual } from '@repo/ui/client/hero-ogz-visual'
import { unstable_cache } from 'next/cache'
import { occasionsQ } from '@repo/db'
import { getServerT } from '@/lib/i18n-server'
import { formatDateOnly } from '@/lib/format'

// Upcoming occasions change at most a few times a day. Cache the query so the
// DB is not hit on every visit — the marketing home is high-traffic and this
// data is not user-specific. Revalidates hourly.
const getCachedOccasions = unstable_cache(
  async () => occasionsQ.getUpcomingOccasions().catch(() => []),
  ['marketing-upcoming-occasions'],
  { revalidate: 3600, tags: ['occasions'] },
)

export default async function MarketingHome() {
  const { locale, t } = await getServerT()
  const occasions = await getCachedOccasions()

  return (
    <main>
      {/* HERO */}
      <Hero
        eyebrow={
          <>
            <Sparkles size={14} className="text-(--accent)" />
            <span>{t('marketingHome.heroBadge')}</span>
          </>
        }
        title={
          <>
            {t('marketingHome.heroTitleA')}
            <br />
            <span className="text-(--pop)">
              {t('marketingHome.heroTitleB')}
            </span>
          </>
        }
        subtitle={t('marketingHome.heroSubtitle')}
        actions={
          <>
            <LinkButton href="/signup" size="lg" trailingIcon={<ArrowUpRight size={16} />}>
              {t('marketingHome.heroCtaPrimary')}
            </LinkButton>
            <LinkButton href="/#features" size="lg" variant="outline">
              {t('marketingHome.heroCtaSecondary')}
            </LinkButton>
          </>
        }
        visual={
          <HeroOgzVisual
            logoSrc="/images/ogz-logo-dark-DSFb1E81.png"
            alt={t('common.appName')}
            caption={locale === 'ar' ? 'يتكلّم عنك.' : 'Speaking for your brand.'}
          />
        }
      />

      {/* FEATURES */}
      <Section id="features">
        <Eyebrow>{t('marketingHome.featuresEyebrow')}</Eyebrow>
        <H2>{t('marketingHome.featuresTitle')}</H2>
        <Sub>{t('marketingHome.featuresSubtitle')}</Sub>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard icon={<Languages size={20} />}      title={t('marketingHome.feature1Title')} description={t('marketingHome.feature1Desc')} />
          <FeatureCard icon={<ShieldCheck size={20} />}    title={t('marketingHome.feature2Title')} description={t('marketingHome.feature2Desc')} />
          <FeatureCard icon={<Calendar size={20} />}       title={t('marketingHome.feature3Title')} description={t('marketingHome.feature3Desc')} />
          <FeatureCard icon={<ImageIcon size={20} />}      title={t('marketingHome.feature4Title')} description={t('marketingHome.feature4Desc')} />
          <FeatureCard icon={<Workflow size={20} />}       title={t('marketingHome.feature5Title')} description={t('marketingHome.feature5Desc')} />
          <FeatureCard icon={<Layers size={20} />}         title={t('marketingHome.feature6Title')} description={t('marketingHome.feature6Desc')} />
        </div>
      </Section>

      {/* OCCASIONS */}
      {occasions.length > 0 && (
        <Section className="bg-(--surface-1)">
          <Eyebrow>{t('marketingHome.occasionsEyebrow')}</Eyebrow>
          <H2>{t('marketingHome.occasionsTitle')}</H2>
          <Sub>{t('marketingHome.occasionsSubtitle')}</Sub>

          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {occasions.slice(0, 6).map((o) => (
              <Card key={o.occasion_id} className="px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-display font-semibold text-(--fg)">
                      {locale === 'en' && o.occasion_name_en ? o.occasion_name_en : o.occasion_name_ar}
                    </div>
                    <div className="text-xs text-(--fg-muted)">
                      {formatDateOnly(o.gregorian_date, locale)}
                    </div>
                  </div>
                  <Badge tone={o.priority === 'Critical' ? 'danger' : 'outline'} size="sm">{o.priority}</Badge>
                </div>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {/* BRAND SCORE CTA — always-dark feature block (OGz uses black cards on
          light pages too). Self-contained dark tokens so it reads correctly in
          both light and dark themes. */}
      <section className="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div
          className="relative mx-auto max-w-7xl overflow-hidden rounded-(--r-2xl)"
          style={{ background: '#0a0a0a' }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background: 'radial-gradient(ellipse 700px 400px at 50% 100%, rgba(43,238,79,0.12), transparent 70%)',
            }}
          />
          <div className="relative mx-auto max-w-4xl px-6 py-16 text-center sm:py-20">
            <div className="mb-4 inline-flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[#2bee4f]">
              FREE · SAUDI BRAND ANALYSIS
            </div>
            <h2 className="font-display text-4xl font-bold uppercase tracking-tight text-white sm:text-5xl">
              {locale === 'ar' ? 'كيف قوية علامتك على إنستغرام؟' : 'How strong is your brand on Instagram?'}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-white/55">
              {locale === 'ar'
                ? 'أدخل اسم حسابك. نحلل آخر ٣٠ منشور على ٥ محاور ونعطيك نتيجة مخصصة للسوق السعودي في أقل من ٩٠ ثانية.'
                : 'Enter your Instagram handle. We analyse your last 30 posts across 5 dimensions and give you a Saudi-specific brand score in under 90 seconds.'}
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <LinkButton
                href="/score-cards"
                size="lg"
                trailingIcon={<ArrowUpRight size={16} />}
                className="border-0 bg-[#2bee4f] font-semibold text-black hover:bg-[#22d246]"
              >
                {locale === 'ar' ? 'قيّم علامتي الآن ← مجاناً' : 'Score My Brand → Free'}
              </LinkButton>
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-6 font-mono text-[11px] uppercase tracking-wider text-white/35">
              {[
                locale === 'ar' ? '📸 جودة الصور ٢٠٪' : '📸 Visual Quality 20%',
                locale === 'ar' ? '🌙 الملاءمة الثقافية ٣٠٪' : '🌙 Cultural Fit 30%',
                locale === 'ar' ? '📅 انتظام النشر ١٥٪' : '📅 Posting Consistency 15%',
                locale === 'ar' ? '🎨 تماسك الهوية ٢٠٪' : '🎨 Brand Coherence 20%',
                locale === 'ar' ? '💬 صحة التفاعل ١٥٪' : '💬 Engagement Health 15%',
              ].map(label => (
                <span key={label}>{label}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-y border-(--border-subtle) bg-(--surface-2)">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <div
            aria-hidden
            className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-(--accent-soft) text-(--accent)"
          >
            <Users size={20} />
          </div>
          <h2 className="font-display text-3xl font-semibold tracking-tight text-(--fg) sm:text-4xl">
            {t('marketingHome.ctaTitle')}
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-(--fg-muted)">
            {t('marketingHome.ctaSubtitle')}
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <LinkButton href="/signup" size="lg">{t('marketingHome.ctaPrimary')}</LinkButton>
            <LinkButton href="/about" variant="outline" size="lg">{t('marketingHome.ctaSecondary')}</LinkButton>
          </div>
        </div>
      </section>
    </main>
  )
}

// ── Local helpers ─────────────────────────────────────────────

function Section({
  children,
  id,
  className = '',
}: {
  children: React.ReactNode
  id?: string
  className?: string
}) {
  return (
    <section id={id} className={className}>
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8">{children}</div>
    </section>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  // OGz signature: spaced-out uppercase magenta label, no chrome.
  return (
    <div className="mb-3 inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-(--tracking-eyebrow) text-(--pop)">
      {children}
    </div>
  )
}
function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-4xl font-bold uppercase tracking-tight text-(--fg) sm:text-5xl">
      {children}
    </h2>
  )
}
function Sub({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 max-w-2xl text-base leading-relaxed text-(--fg-muted)">{children}</p>
  )
}

