'use client'

import { useState, useCallback, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody, CardHeader, CardTitle, CardDescription, CardFooter } from '@repo/ui/card'
import { Button } from '@repo/ui/button'
import { Badge } from '@repo/ui/badge'
import { Input, Textarea, Field } from '@repo/ui/input'
import { Check, AlertTriangle, Eye, FileText, Clock, Plus, X, Sparkles, Send } from '@repo/ui/icons'
import type { Locale } from '@repo/i18n'
import { saveTemplate, createTemplate, generateWithAI, sendTestEmail, sendCustomEmail, getBrandsForEmailPicker } from './actions'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Template {
  template_key: string
  lang: string
  subject: string
  title: string
  body_html: string
  body_text: string | null
  variables: string[]
  is_active: boolean
  updated_at: string
  updated_by: string | null
}

interface Props {
  initialTemplates: Template[]
  locale: Locale
}

// ── UI strings (locale-keyed) ──────────────────────────────────────────────────

const S = {
  ar: {
    templatesHeading: 'قوالب الإشعارات',
    disabled: 'معطّل',
    active: 'مفعّل',
    unsavedDot: 'تغييرات غير محفوظة',
    editMode: 'تحرير',
    previewMode: 'معاينة',
    missingTemplate: (lang: string) =>
      lang === 'ar'
        ? 'لا يوجد قالب عربي بعد. هذا مطلوب لجميع المستخدمين.'
        : 'لا يوجد قالب إنجليزي بعد. سيتم استخدام القالب العربي تلقائياً.',
    availableVars: 'المتغيرات المتاحة:',
    copyHint: 'انقر للنسخ · القيم التجريبية للمعاينة',
    sampleValue: 'قيمة تجريبية',
    fieldSubject: 'سطر الموضوع (Subject)',
    fieldTitle: 'عنوان الإشعار (In-app title)',
    fieldBodyHtml: 'محتوى البريد الإلكتروني (HTML)',
    fieldBodyHtmlHint: '⚠ يجب أن يحتوي على dir="rtl" lang="ar" للعربية',
    fieldBodyText: 'نسخة نص عادي (اختياري)',
    fieldBodyTextHint: 'تُستخدم كبديل عند عدم دعم HTML',
    previewLabel: 'معاينة:',
    lastUpdated: 'آخر تحديث',
    savedStatus: 'تم الحفظ',
    unsavedStatus: '● تغييرات غير محفوظة',
    saving: 'جارٍ الحفظ...',
    saveChanges: 'حفظ التغييرات',
    savedBtn: 'محفوظ',
    previewSubjectLabel: 'الموضوع:',
    previewTitleLabel: 'عنوان الإشعار:',
    emailPreviewTitle: 'معاينة البريد الإلكتروني',
    emailPreviewDesc: 'بيانات تجريبية · يظهر كما سيصله المستخدم',
    emailPreviewBadge: 'HTML مُقدَّم',
    emailPreviewFooter: 'المتغيرات المميزة بالأحمر ← غير مستبدلة (تحقق من الاسم)',
    inboxPreviewTitle: 'معاينة صندوق الوارد',
    inboxPreviewDesc: 'كيف سيظهر في صفحة الإشعارات للمستخدم',
    inboxBadgeNew: 'جديد',
    dateLocale: 'ar-SA',
    addTemplate: '+ إضافة قالب',
    addTemplateTitle: 'قالب جديد',
    addTemplateDesc: 'أنشئ قالباً مخصصاً',
    fieldKey: 'مفتاح القالب',
    fieldKeyHint: 'أحرف صغيرة وشرطة سفلية فقط، مثل: welcome_email',
    fieldVars: 'المتغيرات (افصل بفاصلة)',
    fieldVarsHint: 'مثل: brand_name, month, position',
    createBtn: 'إنشاء',
    cancelBtn: 'إلغاء',
    creating: 'جارٍ الإنشاء...',
    generateAI: '✦ توليد بالذكاء الاصطناعي',
    generating: 'جارٍ التوليد...',
    generateError: 'فشل التوليد',
    sendMode: 'إرسال',
    sendRecipient: 'المستقبِل',
    sendRecipientHint: 'اختر علامة تجارية أو أدخل بريداً مخصصاً',
    sendCustomEmail: 'بريد مخصص',
    sendVars: 'قيم المتغيرات',
    sendVarsHint: 'قيم لملء قالب البريد الإلكتروني',
    sendBtn: 'إرسال الآن',
    sending: 'جارٍ الإرسال...',
    sendSuccess: 'تم الإرسال بنجاح',
    sendError: 'فشل الإرسال',
    loadingBrands: 'جارٍ تحميل العلامات التجارية...',
    noBrands: 'لا توجد علامات تجارية',
    noEmail: 'لا يوجد بريد إلكتروني',
  },
  en: {
    templatesHeading: 'Notification templates',
    disabled: 'Disabled',
    active: 'Active',
    unsavedDot: 'Unsaved changes',
    editMode: 'Edit',
    previewMode: 'Preview',
    missingTemplate: (lang: string) =>
      lang === 'ar'
        ? 'No Arabic template yet. This is required for all users.'
        : 'No English template yet. Arabic template will be used as fallback.',
    availableVars: 'Available variables:',
    copyHint: 'Click to copy · sample values used in preview',
    sampleValue: 'Sample value',
    fieldSubject: 'Email subject',
    fieldTitle: 'In-app title',
    fieldBodyHtml: 'Email body (HTML)',
    fieldBodyHtmlHint: '⚠ Include dir="rtl" lang="ar" for Arabic templates',
    fieldBodyText: 'Plain text (optional)',
    fieldBodyTextHint: 'Used as fallback when HTML is not supported',
    previewLabel: 'Preview:',
    lastUpdated: 'Last updated',
    savedStatus: 'Saved',
    unsavedStatus: '● Unsaved changes',
    saving: 'Saving...',
    saveChanges: 'Save changes',
    savedBtn: 'Saved',
    previewSubjectLabel: 'Subject:',
    previewTitleLabel: 'Notification title:',
    emailPreviewTitle: 'Email preview',
    emailPreviewDesc: 'Sample data · as the user will receive it',
    emailPreviewBadge: 'Rendered HTML',
    emailPreviewFooter: 'Variables highlighted in red ← not replaced (check the name)',
    inboxPreviewTitle: 'Inbox preview',
    inboxPreviewDesc: "How it will appear in the user's notifications page",
    inboxBadgeNew: 'New',
    dateLocale: 'en-US',
    addTemplate: 'Add Template',
    addTemplateTitle: 'New template',
    addTemplateDesc: 'Create a custom template',
    fieldKey: 'Template key',
    fieldKeyHint: 'Lowercase letters and underscores only, e.g. welcome_email',
    fieldVars: 'Variables (comma-separated)',
    fieldVarsHint: 'e.g. brand_name, month, position',
    createBtn: 'Create',
    cancelBtn: 'Cancel',
    creating: 'Creating...',
    generateAI: '✦ Generate with AI',
    generating: 'Generating...',
    generateError: 'Generation failed',
    sendMode: 'Send',
    sendRecipient: 'Recipient',
    sendRecipientHint: 'Pick a brand or enter a custom email',
    sendCustomEmail: 'Custom email',
    sendVars: 'Variable values',
    sendVarsHint: 'Values to fill the email template',
    sendBtn: 'Send now',
    sending: 'Sending...',
    sendSuccess: 'Sent successfully',
    sendError: 'Send failed',
    loadingBrands: 'Loading brands...',
    noBrands: 'No brands found',
    noEmail: 'No email on file',
  },
} as const

// ── Constants ─────────────────────────────────────────────────────────────────

const TEMPLATE_META: Record<string, { label: string; labelAr: string; description: string; icon: string }> = {
  post_approved:                { label: 'Post Approved',               labelAr: 'موافقة على منشور',               description: 'Sent when admin approves a post',                            icon: '✓' },
  post_rejected:                { label: 'Post Rejected',               labelAr: 'رفض منشور',                      description: 'Sent when admin rejects a post',                             icon: '✕' },
  revision_ready:               { label: 'Revision Ready',              labelAr: 'مراجعة جاهزة',                   description: 'Sent when a revised post is ready for review',               icon: '↻' },
  calendar_delivered:           { label: 'Calendar Delivered',          labelAr: 'تسليم تقويم',                    description: 'Sent when a full monthly calendar is delivered',             icon: '🗓' },
  calendar_pending_review:      { label: 'Calendar Pending Review',     labelAr: 'تقويم قيد المراجعة',             description: 'Sent by A01 when a calendar is generated and awaiting admin approval', icon: '⏳' },
  calendar_approved:            { label: 'Calendar Approved',           labelAr: 'اعتماد تقويم',                   description: 'Sent when admin bulk-approves a calendar',                   icon: '📅' },
  calendar_rejected:            { label: 'Calendar Rejected',           labelAr: 'رفض تقويم',                      description: 'Sent when admin rejects a calendar batch for rework',        icon: '✕' },
  publish_success:              { label: 'Publish Success',             labelAr: 'نشر ناجح',                       description: 'Sent when auto-publish succeeds',                            icon: '✅' },
  publish_failed:               { label: 'Publish Failed',              labelAr: 'فشل النشر',                      description: 'Sent when auto-publish fails',                               icon: '⚠' },
  branddna_correction_applied:  { label: 'BrandDNA Correction Applied', labelAr: 'تطبيق تعديل BrandDNA',           description: 'Sent when a BrandDNA correction is accepted',                icon: '🧠' },
  branddna_correction_rejected: { label: 'BrandDNA Correction Rejected',labelAr: 'رفض تعديل BrandDNA',             description: 'Sent when a BrandDNA correction is rejected by CEO',        icon: '🚫' },
  branddna_onboarding_complete: { label: 'BrandDNA Onboarding Complete',labelAr: 'اكتمال تحليل هوية العلامة',      description: 'Sent when BrandDNA onboarding analysis completes',            icon: '🎯' },
  cost_ceiling_approaching:     { label: 'Cost Ceiling Approaching',    labelAr: 'اقتراب سقف التكلفة',             description: 'Sent when brand spend reaches the warning threshold',        icon: '⚡' },
  cost_ceiling_breached:        { label: 'Cost Ceiling Breached',       labelAr: 'تجاوز سقف التكلفة',              description: 'Sent when brand spend exceeds the configured ceiling',       icon: '🔴' },
}

const SAMPLE_VARS: Record<string, Record<string, string | number>> = {
  post_approved:                { brand_name: 'KFC', position: 3, month: 'مايو 2026' },
  post_rejected:                { brand_name: 'KFC', position: 3, reason: 'الصورة لا تتوافق مع هوية العلامة التجارية' },
  revision_ready:               { brand_name: 'KFC', position: 3, revision_number: 2 },
  calendar_delivered:           { brand_name: 'KFC', month: 'مايو 2026', post_count: 20 },
  calendar_pending_review:      { brand_name: 'KFC', month: 'يونيو 2026', calendar_url: 'https://app.ogzstudios.com/kfc/calendar' },
  calendar_approved:            { brand_name: 'KFC', month: 'يونيو 2026', calendar_url: 'https://app.ogzstudios.com/kfc/calendar/2026-06' },
  calendar_rejected:            { brand_name: 'KFC', month: 'يونيو 2026', reason: 'الصور لا تعكس هوية العلامة التجارية بشكل صحيح، يرجى مراجعة الألوان والنبرة العامة' },
  publish_success:              { position: 3, platform: 'Instagram', published_at: '12 مايو 2026، 9:00 ص' },
  publish_failed:               { position: 3, error: 'خطأ في الاتصال بـ Instagram API — انتهت مهلة الطلب' },
  branddna_correction_applied:  { brand_name: 'KFC', field_name: 'نبرة العلامة', new_value: 'رسمي ودافئ' },
  branddna_correction_rejected: { brand_name: 'KFC', field_name: 'موقع السعر', rejection_reason: 'القيمة غير ضمن الخيارات المسموح بها' },
  branddna_onboarding_complete: { brand_name: 'KFC', completeness_score: 78 },
  cost_ceiling_approaching:     { brand_name: 'KFC', spend_usd: '72.50', ceiling_usd: '100.00', spend_pct: '72', alert_at_pct: '70', cost_page_url: 'https://app.ogzstudios.com/admin/cost/kfc' },
  cost_ceiling_breached:        { brand_name: 'KFC', spend_usd: '105.20', ceiling_usd: '100.00', spend_pct: '105', action: 'تم إيقاف التوليد مؤقتاً', cost_page_url: 'https://app.ogzstudios.com/admin/cost/kfc' },
}

function renderPreview(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const val = vars[key]
    return val !== undefined ? String(val) : `<mark style="background:#ff000033;padding:0 2px;border-radius:2px">${match}</mark>`
  })
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── Main component ─────────────────────────────────────────────────────────────

export function TemplateEditor({ initialTemplates, locale }: Props) {
  const s = S[locale] ?? S.en
  const router = useRouter()
  const keys = [...new Set(initialTemplates.map((t) => t.template_key))]

  const [selectedKey, setSelectedKey] = useState<string>(keys[0] ?? 'post_approved')
  const selectedLang                  = 'ar' as const
  const [viewMode, setViewMode]       = useState<'edit' | 'preview'>('edit')
  const [drafts, setDrafts]           = useState<Record<string, Template>>(() => {
    const map: Record<string, Template> = {}
    for (const t of initialTemplates) map[`${t.template_key}__${t.lang}`] = { ...t }
    return map
  })
  const [saved, setSaved]   = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()

  // ── Create form state ──────────────────────────────────────────────────────
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newKey, setNewKey]   = useState('')
  const [newVars, setNewVars] = useState('')
  const [createError, setCreateError]   = useState('')
  const [isCreating, startCreateTransition] = useTransition()

  // ── AI generation state ────────────────────────────────────────────────────
  const [showAiPrompt, setShowAiPrompt]   = useState(false)
  const [aiInstructions, setAiInstructions] = useState('')
  const [aiError, setAiError]             = useState('')
  const [isGenerating, startAiTransition] = useTransition()

  // ── Test send state ────────────────────────────────────────────────────────
  const [testSendStatus, setTestSendStatus] = useState<
    { state: 'idle' } | { state: 'sending' } | { state: 'ok'; messageId: string | null } | { state: 'error'; error: string }
  >({ state: 'idle' })
  const [isTestSending, startTestTransition] = useTransition()

  // ── Send email panel state ─────────────────────────────────────────────────
  type BrandOption = { brand_id: string; brand_name_ar: string; client_slug: string; email: string | null }
  const [showSendPanel, setShowSendPanel]   = useState(false)
  const [brands, setBrands]                 = useState<BrandOption[]>([])
  const [brandsLoading, setBrandsLoading]   = useState(false)
  const [selectedBrandId, setSelectedBrandId] = useState<string>('custom')
  const [customEmail, setCustomEmail]       = useState('')
  const [sendVarValues, setSendVarValues]   = useState<Record<string, string>>({})
  const [sendStatus, setSendStatus]         = useState<
    { state: 'idle' } | { state: 'sending' } | { state: 'ok'; messageId: string | null } | { state: 'error'; error: string }
  >({ state: 'idle' })
  const [isSendPending, startSendTransition] = useTransition()

  const draftKey = `${selectedKey}__${selectedLang}`
  const current  = drafts[draftKey]

  const original = initialTemplates.find(
    (t) => t.template_key === selectedKey && t.lang === selectedLang,
  )

  const resolvedRecipient = selectedBrandId === 'custom'
    ? customEmail.trim()
    : (brands.find((b) => b.brand_id === selectedBrandId)?.email ?? '')

  const openSendPanel = useCallback(async () => {
    setShowSendPanel(true)
    setSendStatus({ state: 'idle' })
    const vars = current?.variables ?? []
    const pre: Record<string, string> = {}
    for (const v of vars) pre[v] = String(SAMPLE_VARS[selectedKey]?.[v] ?? '')
    setSendVarValues(pre)
    if (brands.length === 0) {
      setBrandsLoading(true)
      const result = await getBrandsForEmailPicker()
      if (result.ok) setBrands(result.brands)
      setBrandsLoading(false)
    }
  }, [current, selectedKey, brands.length])

  const handleSend = () => {
    setSendStatus({ state: 'sending' })
    startSendTransition(async () => {
      const result = await sendCustomEmail({
        templateKey: selectedKey,
        lang: selectedLang,
        recipientEmail: resolvedRecipient,
        variables: sendVarValues,
      })
      if (result.ok) {
        setSendStatus({ state: 'ok', messageId: result.messageId })
        setTimeout(() => setSendStatus({ state: 'idle' }), 10000)
      } else {
        setSendStatus({ state: 'error', error: result.error })
      }
    })
  }

  const isDirty = current && original
    ? current.subject   !== original.subject   ||
      current.title     !== original.title     ||
      current.body_html !== original.body_html ||
      (current.body_text ?? '') !== (original.body_text ?? '') ||
      current.is_active !== original.is_active
    : false

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault() }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const update = useCallback(
    (field: keyof Template, value: string | boolean) => {
      setDrafts((prev) => ({
        ...prev,
        [draftKey]: { ...prev[draftKey]!, [field]: value },
      }))
      setSaved((prev) => ({ ...prev, [draftKey]: false }))
      setErrors((prev) => ({ ...prev, [draftKey]: '' }))
    },
    [draftKey],
  )

  const handleSave = () => {
    if (!current) return
    startTransition(async () => {
      const result = await saveTemplate(selectedKey, selectedLang, {
        subject:   current.subject,
        title:     current.title,
        body_html: current.body_html,
        body_text: current.body_text ?? '',
        is_active: current.is_active,
      })
      if (result.ok) {
        setSaved((prev) => ({ ...prev, [draftKey]: true }))
      } else {
        setErrors((prev) => ({ ...prev, [draftKey]: result.error }))
      }
    })
  }

  const handleCreate = () => {
    setCreateError('')
    const key = newKey.trim().toLowerCase().replace(/\s+/g, '_')
    const vars = newVars.split(',').map((v) => v.trim()).filter(Boolean)

    if (!key) { setCreateError('Key is required'); return }
    if (!/^[a-z][a-z0-9_]{0,49}$/.test(key)) { setCreateError('Lowercase letters and underscores only'); return }

    startCreateTransition(async () => {
      const result = await createTemplate(key, vars)
      if (result.ok) {
        setShowCreateForm(false)
        setNewKey('')
        setNewVars('')
        router.refresh()
        // Auto-select new template after refresh
        setSelectedKey(key)
      } else {
        setCreateError(result.error)
      }
    })
  }

  const handleGenerate = () => {
    setAiError('')
    const vars = current?.variables ?? []
    setShowAiPrompt(false)
    startAiTransition(async () => {
      const result = await generateWithAI(selectedKey, vars, aiInstructions)
      if (result.ok) {
        setDrafts((prev) => ({
          ...prev,
          [draftKey]: {
            ...prev[draftKey]!,
            subject:   result.subject,
            title:     result.title,
            body_html: result.body_html,
          },
        }))
        setSaved((prev) => ({ ...prev, [draftKey]: false }))
        setAiInstructions('')
      } else {
        setAiError(result.error)
        setShowAiPrompt(true)
      }
    })
  }

  const handleTestSend = () => {
    setTestSendStatus({ state: 'sending' })
    startTestTransition(async () => {
      const result = await sendTestEmail(selectedKey, selectedLang)
      if (result.ok) {
        setTestSendStatus({ state: 'ok', messageId: result.messageId })
        setTimeout(() => setTestSendStatus({ state: 'idle' }), 8000)
      } else {
        setTestSendStatus({ state: 'error', error: result.error })
      }
    })
  }

  const sample = SAMPLE_VARS[selectedKey] ?? {}
  const meta   = TEMPLATE_META[selectedKey]

  const previewSubject   = current ? renderPreview(current.subject, sample)   : ''
  const previewTitle     = current ? renderPreview(current.title, sample)     : ''
  const previewBodyHtml  = current ? renderPreview(current.body_html, sample) : ''

  if (!current && !showCreateForm && keys.length === 0) return null

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">

      {/* ── LEFT: Template list ─────────────────────────────────────────── */}
      <div className="space-y-2">
        <p className="px-1 text-[11px] uppercase tracking-widest text-(--fg-faint)">{s.templatesHeading}</p>

        {keys.map((key) => {
          const m       = TEMPLATE_META[key]
          const arDraft = drafts[`${key}__ar`]
          const isSelected = key === selectedKey
          const hasUnsaved = (drafts[`${key}__ar`] && initialTemplates.find(t => t.template_key === key && t.lang === 'ar'))
            ? drafts[`${key}__ar`]!.subject   !== initialTemplates.find(t => t.template_key === key && t.lang === 'ar')!.subject ||
              drafts[`${key}__ar`]!.body_html !== initialTemplates.find(t => t.template_key === key && t.lang === 'ar')!.body_html
            : false

          return (
            <button
              key={key}
              onClick={() => { setSelectedKey(key); setShowCreateForm(false); setAiError('') }}
              className={`w-full rounded-(--r-md) border px-4 py-3 text-start transition-all ${
                isSelected
                  ? 'border-(--accent) bg-(--surface-3) shadow-(--shadow-1)'
                  : 'border-(--border-subtle) bg-(--surface-2) hover:border-(--border-default) hover:bg-(--surface-3)'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-base leading-none shrink-0">{m?.icon ?? '📄'}</span>
                  <span className={`text-sm font-medium truncate ${isSelected ? 'text-(--fg)' : 'text-(--fg-muted)'}`}>
                    {locale === 'ar' ? (m?.labelAr ?? key) : (m?.label ?? key)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {hasUnsaved && (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title={s.unsavedDot} />
                  )}
                  {!arDraft?.is_active && (
                    <Badge tone="outline" size="sm">{s.disabled}</Badge>
                  )}
                </div>
              </div>
              {m && (
                <p className="mt-1 text-[11px] text-(--fg-faint) leading-snug">{m.description}</p>
              )}
              {!m && (
                <p className="mt-1 text-[11px] text-(--fg-faint) leading-snug font-mono">{key}</p>
              )}
            </button>
          )
        })}

        {/* ── Add template button / form ─────────────────────────────── */}
        {!showCreateForm ? (
          <button
            onClick={() => setShowCreateForm(true)}
            className="w-full rounded-(--r-md) border border-dashed border-(--border-subtle) px-4 py-3 text-start text-sm text-(--fg-faint) hover:border-(--border-default) hover:text-(--fg-muted) transition-colors flex items-center gap-2"
          >
            <Plus size={14} />
            {s.addTemplate}
          </button>
        ) : (
          <div className="rounded-(--r-md) border border-(--accent) bg-(--surface-3) p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-(--fg)">{s.addTemplateTitle}</p>
              <button onClick={() => { setShowCreateForm(false); setCreateError('') }} className="text-(--fg-faint) hover:text-(--fg)">
                <X size={14} />
              </button>
            </div>

            <Field label={s.fieldKey} hint={s.fieldKeyHint} required>
              <Input
                dir="ltr"
                value={newKey}
                onChange={(e) => { setNewKey(e.target.value); setCreateError('') }}
                placeholder="welcome_email"
                className="font-mono text-xs"
              />
            </Field>

            <Field label={s.fieldVars} hint={s.fieldVarsHint}>
              <Input
                dir="ltr"
                value={newVars}
                onChange={(e) => setNewVars(e.target.value)}
                placeholder="brand_name, month"
                className="font-mono text-xs"
              />
            </Field>

            {createError && (
              <p className="flex items-center gap-1 text-xs text-red-400">
                <AlertTriangle size={12} /> {createError}
              </p>
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={isCreating || !newKey.trim()}
                onClick={handleCreate}
              >
                {isCreating ? s.creating : s.createBtn}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setShowCreateForm(false); setCreateError('') }}
              >
                {s.cancelBtn}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── RIGHT: Editor ──────────────────────────────────────────────── */}
      <div className="space-y-4 min-w-0">

        {/* Header row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-(--fg)">
              {locale === 'ar' ? (meta?.labelAr ?? selectedKey) : (meta?.label ?? selectedKey)}
            </h2>
            <p className="text-xs text-(--fg-muted)">{meta?.description ?? selectedKey}</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Edit / Preview toggle */}
            <div className="flex rounded-(--r-md) border border-(--border-default) overflow-hidden text-xs">
              <button
                onClick={() => setViewMode('edit')}
                className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
                  viewMode === 'edit'
                    ? 'bg-(--surface-3) text-(--fg)'
                    : 'text-(--fg-muted) hover:bg-(--surface-3)'
                }`}
              >
                <FileText size={12} /> {s.editMode}
              </button>
              <button
                onClick={() => setViewMode('preview')}
                className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
                  viewMode === 'preview'
                    ? 'bg-(--surface-3) text-(--fg)'
                    : 'text-(--fg-muted) hover:bg-(--surface-3)'
                }`}
              >
                <Eye size={12} /> {s.previewMode}
              </button>
            </div>

            {/* Generate with AI — toggle prompt panel */}
            {viewMode === 'edit' && current && (
              <button
                onClick={() => { setShowAiPrompt((v) => !v); setAiError('') }}
                disabled={isGenerating}
                className={`flex items-center gap-1.5 rounded-(--r-md) border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                  showAiPrompt
                    ? 'border-purple-500/60 bg-purple-500/20 text-purple-300'
                    : 'border-purple-500/40 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20'
                }`}
              >
                <Sparkles size={12} />
                {isGenerating ? s.generating : s.generateAI}
              </button>
            )}

            {/* Send test email */}
            {current?.is_active && (
              <button
                onClick={handleTestSend}
                disabled={isTestSending || testSendStatus.state === 'sending'}
                className="flex items-center gap-1.5 rounded-(--r-md) border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-400 hover:bg-sky-500/20 disabled:opacity-50 transition-colors"
                title="Sends a live test email to your admin address using saved template content"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
                {isTestSending ? 'Sending…' : 'Send test'}
              </button>
            )}

            {/* Send to brand/custom — opens compose panel */}
            {current?.is_active && (
              <button
                onClick={() => showSendPanel ? setShowSendPanel(false) : openSendPanel()}
                className={[
                  'flex items-center gap-1.5 rounded-(--r-md) border px-3 py-1.5 text-xs font-medium transition-colors',
                  showSendPanel
                    ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-300'
                    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20',
                ].join(' ')}
              >
                <Send size={12} />
                {s.sendMode}
              </button>
            )}

            {/* Active toggle */}
            {current && (
              <button
                onClick={() => update('is_active', !current.is_active)}
                className={`flex items-center gap-1.5 rounded-(--r-md) border px-3 py-1.5 text-xs font-medium transition-colors ${
                  current.is_active
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                    : 'border-(--border-default) text-(--fg-muted) hover:bg-(--surface-3)'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${current.is_active ? 'bg-emerald-400' : 'bg-(--fg-faint)'}`} />
                {current.is_active ? s.active : s.disabled}
              </button>
            )}
          </div>
        </div>

        {/* AI prompt panel */}
        {showAiPrompt && current && (
          <div className="rounded-(--r-md) border border-purple-500/40 bg-purple-500/8 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-purple-400" />
                <p className="text-xs font-semibold text-purple-300">
                  {locale === 'ar' ? 'وصف التصميم المطلوب' : 'Describe what you want'}
                </p>
              </div>
              <button onClick={() => { setShowAiPrompt(false); setAiError('') }} className="text-(--fg-faint) hover:text-(--fg)">
                <X size={14} />
              </button>
            </div>

            <Textarea
              dir={locale === 'ar' ? 'rtl' : 'ltr'}
              value={aiInstructions}
              onChange={(e) => setAiInstructions(e.target.value)}
              className="min-h-20 text-xs resize-none"
              placeholder={
                locale === 'ar'
                  ? 'مثال: استخدم لون أخضر #10b981، أضف شعار OGz Studios كصورة في الأعلى، نبرة رسمية ودافئة، بدون تذييل...'
                  : 'e.g. Use green color #10b981, add OGz Studios logo at the top, formal and warm tone, include a CTA button, no footer...'
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && aiInstructions.trim()) handleGenerate()
              }}
            />

            <div className="flex items-center justify-between">
              <p className="text-[10px] text-(--fg-faint)">
                {locale === 'ar' ? 'Ctrl+Enter للتوليد' : 'Ctrl+Enter to generate'}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setShowAiPrompt(false); setAiError('') }}>
                  {s.cancelBtn}
                </Button>
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="flex items-center gap-1.5 rounded-(--r-md) bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50 transition-colors"
                >
                  <Sparkles size={12} />
                  {isGenerating ? s.generating : (locale === 'ar' ? 'توليد' : 'Generate')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* AI error */}
        {aiError && (
          <div className="flex items-center gap-2 rounded-(--r-md) border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400">
            <AlertTriangle size={14} className="shrink-0" />
            <span>{s.generateError}: {aiError}</span>
            <button onClick={() => setAiError('')} className="ms-auto opacity-60 hover:opacity-100"><X size={12} /></button>
          </div>
        )}

        {/* Test send feedback */}
        {testSendStatus.state === 'ok' && (
          <div className="flex items-center gap-2 rounded-(--r-md) border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-xs text-sky-400">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            <span>
              Test email sent to your admin address.
              {testSendStatus.messageId && (
                <span className="ms-1 font-mono opacity-60">ID: {testSendStatus.messageId}</span>
              )}
            </span>
            <button onClick={() => setTestSendStatus({ state: 'idle' })} className="ms-auto opacity-60 hover:opacity-100"><X size={12} /></button>
          </div>
        )}
        {testSendStatus.state === 'error' && (
          <div className="flex items-center gap-2 rounded-(--r-md) border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400">
            <AlertTriangle size={14} className="shrink-0" />
            <span>Test send failed: {testSendStatus.error}</span>
            <button onClick={() => setTestSendStatus({ state: 'idle' })} className="ms-auto opacity-60 hover:opacity-100"><X size={12} /></button>
          </div>
        )}

        {/* ── Send email compose panel ──────────────────────────────────── */}
        {showSendPanel && current && (
          <div className="rounded-(--r-md) border border-emerald-500/40 bg-emerald-500/8 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Send size={14} className="text-emerald-400" />
                <p className="text-xs font-semibold text-emerald-300">
                  {locale === 'ar' ? 'إرسال بريد إلكتروني' : 'Send email'}
                </p>
              </div>
              <button onClick={() => setShowSendPanel(false)} className="text-(--fg-faint) hover:text-(--fg)">
                <X size={14} />
              </button>
            </div>

            {/* Recipient picker */}
            <Field label={s.sendRecipient} hint={s.sendRecipientHint} required>
              <div className="space-y-2">
                <select
                  className="w-full rounded-(--r-md) border border-(--border-default) bg-(--surface-2) px-3 py-2 text-sm text-(--fg) focus:outline-none focus:border-(--accent) transition-colors"
                  value={selectedBrandId}
                  onChange={(e) => { setSelectedBrandId(e.target.value); setSendStatus({ state: 'idle' }) }}
                  dir={locale === 'ar' ? 'rtl' : 'ltr'}
                >
                  <option value="custom">{s.sendCustomEmail}…</option>
                  {brandsLoading && <option disabled>{s.loadingBrands}</option>}
                  {brands.map((b) => (
                    <option key={b.brand_id} value={b.brand_id}>
                      {b.brand_name_ar} — {b.email ?? s.noEmail}
                    </option>
                  ))}
                </select>

                {selectedBrandId === 'custom' && (
                  <Input
                    dir="ltr"
                    type="email"
                    value={customEmail}
                    onChange={(e) => { setCustomEmail(e.target.value); setSendStatus({ state: 'idle' }) }}
                    placeholder="email@example.com"
                    className="text-sm"
                  />
                )}

                {selectedBrandId !== 'custom' && (
                  <p className="text-[11px] text-(--fg-faint)">
                    → {brands.find((b) => b.brand_id === selectedBrandId)?.email ?? s.noEmail}
                  </p>
                )}
              </div>
            </Field>

            {/* Variable values */}
            {(current.variables?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-wide text-(--fg-faint)">{s.sendVars}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {current.variables?.map((v) => (
                    <Field key={v} label={`{{${v}}}`}>
                      <Input
                        dir={locale === 'ar' ? 'rtl' : 'ltr'}
                        value={sendVarValues[v] ?? ''}
                        onChange={(e) => setSendVarValues((prev) => ({ ...prev, [v]: e.target.value }))}
                        placeholder={String(SAMPLE_VARS[selectedKey]?.[v] ?? v)}
                        className="text-xs"
                      />
                    </Field>
                  ))}
                </div>
              </div>
            )}

            {/* Send feedback */}
            {sendStatus.state === 'ok' && (
              <div className="flex items-center gap-2 rounded-(--r-md) border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
                <Check size={12} className="shrink-0" />
                <span>
                  {s.sendSuccess}{sendStatus.messageId && <span className="ms-1 font-mono opacity-60">ID: {sendStatus.messageId}</span>}
                </span>
                <button onClick={() => setSendStatus({ state: 'idle' })} className="ms-auto opacity-60 hover:opacity-100"><X size={12} /></button>
              </div>
            )}
            {sendStatus.state === 'error' && (
              <div className="flex items-center gap-2 rounded-(--r-md) border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                <AlertTriangle size={12} className="shrink-0" />
                <span>{s.sendError}: {sendStatus.error}</span>
                <button onClick={() => setSendStatus({ state: 'idle' })} className="ms-auto opacity-60 hover:opacity-100"><X size={12} /></button>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setShowSendPanel(false)}>{s.cancelBtn}</Button>
              <button
                onClick={handleSend}
                disabled={isSendPending || !resolvedRecipient || sendStatus.state === 'sending'}
                className="flex items-center gap-1.5 rounded-(--r-md) bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
              >
                <Send size={12} />
                {isSendPending ? s.sending : s.sendBtn}
              </button>
            </div>
          </div>
        )}

        {/* Missing template notice */}
        {!drafts[`${selectedKey}__${selectedLang}`] && (
          <Card variant="ghost">
            <CardBody className="flex items-center gap-3 py-4">
              <AlertTriangle size={16} className="text-amber-400 shrink-0" />
              <p className="text-sm text-(--fg-muted)">{s.missingTemplate(selectedLang)}</p>
            </CardBody>
          </Card>
        )}

        {current && (
          <>
            {/* ── Variables helper ─────────────────────────────────────── */}
            <Card variant="ghost">
              <CardBody className="py-3 px-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] uppercase tracking-wide text-(--fg-faint) shrink-0">
                    {s.availableVars}
                  </span>
                  {current.variables?.map((v) => (
                    <code
                      key={v}
                      className="cursor-pointer rounded bg-(--surface-4) px-2 py-0.5 font-mono text-xs text-(--accent) hover:bg-(--surface-3) border border-(--border-subtle) transition-colors"
                      title={`${s.sampleValue}: ${sample[v] ?? '—'}`}
                      onClick={() => navigator.clipboard?.writeText(`{{${v}}}`)}
                    >
                      {`{{${v}}}`}
                    </code>
                  ))}
                  {(!current.variables || current.variables.length === 0) && (
                    <span className="text-[11px] text-(--fg-faint) italic">—</span>
                  )}
                  <span className="text-[10px] text-(--fg-faint)">{s.copyHint}</span>
                </div>
              </CardBody>
            </Card>

            {viewMode === 'edit' ? (
              /* ── Edit mode ─────────────────────────────────────────── */
              <Card>
                <CardBody className={`space-y-5 ${isGenerating ? 'opacity-50 pointer-events-none' : ''}`}>
                  <Field label={s.fieldSubject} required>
                    <Input
                      dir={selectedLang === 'ar' ? 'rtl' : 'ltr'}
                      value={current.subject}
                      onChange={(e) => update('subject', e.target.value)}
                      placeholder={selectedLang === 'ar' ? 'موضوع الرسالة...' : 'Email subject...'}
                    />
                    {current.subject && (
                      <p className="mt-1.5 text-[11px] text-(--fg-faint)">
                        {s.previewLabel} <span className="text-(--fg-muted)">{previewSubject}</span>
                      </p>
                    )}
                  </Field>

                  <Field label={s.fieldTitle} required>
                    <Input
                      dir={selectedLang === 'ar' ? 'rtl' : 'ltr'}
                      value={current.title}
                      onChange={(e) => update('title', e.target.value)}
                      placeholder={selectedLang === 'ar' ? 'عنوان الإشعار...' : 'Notification title...'}
                    />
                    {current.title && (
                      <p className="mt-1.5 text-[11px] text-(--fg-faint)">
                        {s.previewLabel} <span className="text-(--fg-muted)">{previewTitle}</span>
                      </p>
                    )}
                  </Field>

                  <Field
                    label={s.fieldBodyHtml}
                    required
                    hint={<span className="text-amber-400">{s.fieldBodyHtmlHint}</span>}
                  >
                    <Textarea
                      dir="ltr"
                      value={current.body_html}
                      onChange={(e) => update('body_html', e.target.value)}
                      className="min-h-56 font-mono text-xs leading-relaxed"
                      spellCheck={false}
                    />
                  </Field>

                  <Field label={s.fieldBodyText} hint={s.fieldBodyTextHint}>
                    <Textarea
                      dir={selectedLang === 'ar' ? 'rtl' : 'ltr'}
                      value={current.body_text ?? ''}
                      onChange={(e) => update('body_text', e.target.value)}
                      className="min-h-20 text-xs"
                      placeholder={selectedLang === 'ar' ? 'نسخة نصية...' : 'Plain text fallback...'}
                    />
                  </Field>
                </CardBody>

                <CardFooter className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5 text-(--fg-faint)">
                    <Clock size={11} />
                    <span>{s.lastUpdated} {timeAgo(current.updated_at)}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {errors[draftKey] && (
                      <span className="flex items-center gap-1 text-xs text-red-400">
                        <AlertTriangle size={12} /> {errors[draftKey]}
                      </span>
                    )}
                    {saved[draftKey] && !isDirty && (
                      <span className="flex items-center gap-1 text-xs text-emerald-400">
                        <Check size={12} /> {s.savedStatus}
                      </span>
                    )}
                    {isDirty && (
                      <span className="text-xs text-amber-400">{s.unsavedStatus}</span>
                    )}
                    <Button
                      variant={isDirty ? 'primary' : 'secondary'}
                      size="sm"
                      disabled={isPending || !isDirty}
                      onClick={handleSave}
                      leadingIcon={isPending ? undefined : isDirty ? undefined : <Check size={13} />}
                    >
                      {isPending ? s.saving : isDirty ? s.saveChanges : s.savedBtn}
                    </Button>
                  </div>
                </CardFooter>
              </Card>
            ) : (
              /* ── Preview mode ──────────────────────────────────────── */
              <div className="space-y-4">
                <Card variant="ghost">
                  <CardBody className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] uppercase tracking-wide text-(--fg-faint) shrink-0">{s.previewSubjectLabel}</span>
                      <span
                        className="text-sm text-(--fg)"
                        dir={selectedLang === 'ar' ? 'rtl' : 'ltr'}
                        dangerouslySetInnerHTML={{ __html: previewSubject }}
                      />
                    </div>
                  </CardBody>
                </Card>

                <Card variant="ghost">
                  <CardBody className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] uppercase tracking-wide text-(--fg-faint) shrink-0">{s.previewTitleLabel}</span>
                      <span
                        className="text-sm font-medium text-(--fg)"
                        dir={selectedLang === 'ar' ? 'rtl' : 'ltr'}
                        dangerouslySetInnerHTML={{ __html: previewTitle }}
                      />
                    </div>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <div>
                      <CardTitle>{s.emailPreviewTitle}</CardTitle>
                      <CardDescription>{s.emailPreviewDesc}</CardDescription>
                    </div>
                    <Badge tone="info" size="sm">{s.emailPreviewBadge}</Badge>
                  </CardHeader>
                  <CardBody className="p-0 overflow-hidden rounded-b-(--r-lg)">
                    <iframe
                      srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff;font-family:Tahoma,sans-serif}</style></head><body>${previewBodyHtml}</body></html>`}
                      sandbox="allow-same-origin"
                      className="w-full border-0"
                      style={{ height: 420 }}
                      title="Email preview"
                    />
                  </CardBody>
                  <CardFooter>
                    <span className="text-(--fg-faint)">{s.emailPreviewFooter}</span>
                  </CardFooter>
                </Card>

                <Card variant="ghost">
                  <CardHeader>
                    <div>
                      <CardTitle>{s.inboxPreviewTitle}</CardTitle>
                      <CardDescription>{s.inboxPreviewDesc}</CardDescription>
                    </div>
                  </CardHeader>
                  <CardBody>
                    <div className="flex items-start gap-4 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) px-5 py-4">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500" />
                      <div className="flex-1 min-w-0" dir={selectedLang === 'ar' ? 'rtl' : 'ltr'}>
                        <p
                          className="text-sm font-medium text-(--fg)"
                          dangerouslySetInnerHTML={{ __html: previewTitle }}
                        />
                        <p className="mt-0.5 text-xs text-(--fg-muted)">
                          {new Date().toLocaleString(s.dateLocale as string, { dateStyle: 'medium', timeStyle: 'short' })}
                        </p>
                      </div>
                      <Badge tone="accent" size="sm">{s.inboxBadgeNew}</Badge>
                    </div>
                  </CardBody>
                </Card>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
