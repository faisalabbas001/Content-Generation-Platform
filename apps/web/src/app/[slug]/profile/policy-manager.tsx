'use client'


import { useState, useTransition, useOptimistic } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@repo/ui/badge'
import { Button } from '@repo/ui/button'
import { Input } from '@repo/ui/input'
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@repo/ui/card'
import type { NegativePattern, OverrideRule } from '@repo/db/queries/brand-dna'
import {
  addBrandNegativePattern,
  deleteBrandNegativePattern,
  addBrandOverrideRule,
  deleteBrandOverrideRule,
} from '@/app/actions/brand-policy'

// ─────────────────────────────────────────────────────────────────────────
// Negative Patterns Manager
// ─────────────────────────────────────────────────────────────────────────

interface NegativePatternsManagerProps {
  slug: string
  brand_id: string
  initial_patterns: NegativePattern[]
}

export function NegativePatternsManager({ slug, brand_id, initial_patterns }: NegativePatternsManagerProps) {
  const router = useRouter()
  const [patterns, setOptimistic] = useOptimistic(initial_patterns)
  const [addPending, startAdd] = useTransition()
  const [text, setText] = useState('')
  const [severity, setSeverity] = useState<'SOFT_WARN' | 'STRONG_WARN' | 'HARD_BLOCK'>('STRONG_WARN')
  const [addError, setAddError] = useState<string | null>(null)
  const [addSuccess, setAddSuccess] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault()
    if (text.trim().length < 2) return
    setAddError(null)
    setAddSuccess(false)
    const optimisticPattern: NegativePattern = {
      pattern_id: `optimistic-${Date.now()}`,
      brand_id,
      pattern_text: text.trim(),
      severity,
      reasoning: null,
      source: 'user',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    startAdd(async () => {
      setOptimistic((prev) => [...prev, optimisticPattern])
      const r = await addBrandNegativePattern({ slug, pattern_text: text.trim(), severity })
      if (!r.ok) {
        setAddError(r.error ?? 'Failed to add pattern')
        router.refresh() // revert optimistic item
      } else {
        setAddSuccess(true)
        setText('')
        setTimeout(() => setAddSuccess(false), 2000)
        router.refresh()
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Never say this</CardTitle>
          <CardDescription>Phrases the AI is forbidden from generating for your brand.</CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ Add'}
        </Button>
      </CardHeader>

      {showForm && (
        <div className="border-b border-(--border-subtle) px-4 pb-4 pt-0">
          <form onSubmit={handleAdd} className="space-y-2.5">
            <Input
              placeholder="e.g. never use urgency language, لا تستخدم أسلوب الضغط"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={addPending}
              className="text-sm"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <select
                className="rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-1) px-2 py-1 text-xs"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as typeof severity)}
                disabled={addPending}
              >
                <option value="HARD_BLOCK">HARD_BLOCK — absolute</option>
                <option value="STRONG_WARN">STRONG_WARN — strong</option>
                <option value="SOFT_WARN">SOFT_WARN — caution</option>
              </select>
              <Button type="submit" size="sm" disabled={addPending || text.trim().length < 2}>
                {addPending ? 'Saving…' : 'Save pattern'}
              </Button>
              {addError && <span className="text-xs text-rose-500">{addError}</span>}
              {addSuccess && <span className="text-xs text-emerald-500">✓ Pattern added — AI will avoid this on next generation</span>}
            </div>
          </form>
        </div>
      )}

      <CardBody className="p-0">
        {patterns.length === 0 ? (
          <p className="px-4 py-6 text-sm text-(--fg-faint) text-center">
            No custom patterns. The AI follows platform-wide defaults.
          </p>
        ) : (
          <ul className="divide-y divide-(--border-subtle)">
            {patterns.map((p) => (
              <PatternRow
                key={p.pattern_id}
                pattern={p}
                slug={slug}
                brand_id={brand_id}
                onDeleted={(id) => setOptimistic((prev) => prev.filter((x) => x.pattern_id !== id))}
              />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

function PatternRow({
  pattern,
  slug,
  brand_id,
  onDeleted,
}: {
  pattern: NegativePattern
  slug: string
  brand_id: string
  onDeleted: (id: string) => void
}) {
  const router = useRouter()
  const [pending, startT] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <span dir="auto" className="flex-1 text-(--fg)">{pattern.pattern_text}</span>
      <div className="flex items-center gap-2 shrink-0">
        <Badge
          tone={pattern.severity === 'HARD_BLOCK' ? 'danger' : pattern.severity === 'STRONG_WARN' ? 'warning' : 'outline'}
          size="sm"
        >
          {pattern.severity}
        </Badge>
        {error && <span className="text-xs text-rose-500">{error}</span>}
        {pattern.pattern_id.startsWith('optimistic-') ? (
          <span className="text-xs text-(--fg-faint)">saving…</span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => startT(async () => {
              const r = await deleteBrandNegativePattern({ slug, pattern_id: pattern.pattern_id, brand_id })
              if (!r.ok) setError(r.error ?? 'Delete failed')
              else { onDeleted(pattern.pattern_id); router.refresh() }
            })}
            title="Remove this pattern"
          >
            {pending ? '…' : '✕'}
          </Button>
        )}
      </div>
    </li>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Override Rules Manager
// ─────────────────────────────────────────────────────────────────────────

interface OverrideRulesManagerProps {
  slug: string
  brand_id: string
  initial_rules: OverrideRule[]
}

const PRESET_RULES = [
  { key: 'force_hashtags',          label: 'Force hashtags',         hint: 'Hashtags always included',           type: 'list' as const },
  { key: 'force_mention',           label: 'Force mention',          hint: 'Accounts always mentioned',          type: 'list' as const },
  { key: 'always_include_location', label: 'Always include location',hint: 'e.g. الرياض or Riyadh',             type: 'text' as const },
  { key: 'tone_override',           label: 'Tone override',          hint: 'e.g. ultra-formal or playful',       type: 'text' as const },
  { key: 'language_lock',           label: 'Language lock',          hint: 'arabic_only / bilingual / english',  type: 'text' as const },
  { key: 'disable_emojis',          label: 'Disable emojis',         hint: 'Remove all emojis from captions',    type: 'boolean' as const },
  { key: 'ramadan_mode',            label: 'Ramadan mode',           hint: 'Switch to Ramadan-appropriate tone', type: 'boolean' as const },
  { key: 'watermark_text',          label: 'Watermark text',         hint: 'Text appended to every caption',     type: 'text' as const },
]

export function OverrideRulesManager({ slug, brand_id, initial_rules }: OverrideRulesManagerProps) {
  const router = useRouter()
  const [rules, setOptimistic] = useOptimistic(initial_rules)
  const [addPending, startAdd] = useTransition()
  const [showForm, setShowForm] = useState(false)
  const [ruleType, setRuleType] = useState<'preset' | 'custom'>('preset')
  const [presetKey, setPresetKey] = useState('force_hashtags')
  const [customKey, setCustomKey] = useState('')
  const [valueType, setValueType] = useState<'list' | 'text' | 'boolean'>('list')
  const [listVal, setListVal] = useState('')
  const [textVal, setTextVal] = useState('')
  const [boolVal, setBoolVal] = useState('true')
  const [desc, setDesc] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addSuccess, setAddSuccess] = useState(false)

  const activeKey = ruleType === 'preset' ? presetKey : customKey
  const preset = PRESET_RULES.find((p) => p.key === presetKey)

  const handlePresetChange = (k: string) => {
    setPresetKey(k)
    const found = PRESET_RULES.find((p) => p.key === k)
    if (found) setValueType(found.type)
  }

  const buildRuleValue = (): string => {
    if (valueType === 'list') return JSON.stringify(listVal.split(',').map((s) => s.trim()).filter(Boolean))
    if (valueType === 'boolean') return boolVal
    return JSON.stringify(textVal)
  }

  const canSubmit = activeKey.trim().length >= 2 &&
    (valueType === 'list' ? listVal.trim().length > 0 : valueType === 'text' ? textVal.trim().length > 0 : true)

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    const rv = buildRuleValue()
    setAddError(null)
    setAddSuccess(false)
    const optimisticRule: OverrideRule = {
      rule_id: `optimistic-${Date.now()}`,
      brand_id,
      rule_key: activeKey.trim(),
      rule_value: JSON.parse(rv),
      description: desc.trim() || null,
      reasoning: null,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    startAdd(async () => {
      setOptimistic((prev) => {
        const idx = prev.findIndex((r) => r.rule_key === activeKey.trim())
        if (idx >= 0) { const u = [...prev]; u[idx] = optimisticRule; return u }
        return [...prev, optimisticRule]
      })
      const r = await addBrandOverrideRule({ slug, rule_key: activeKey.trim(), rule_value: rv, description: desc.trim() || undefined })
      if (!r.ok) {
        setAddError(r.error ?? 'Failed to save rule')
        router.refresh() // revert optimistic item
      } else {
        setAddSuccess(true)
        setListVal(''); setTextVal(''); setDesc('')
        setTimeout(() => setAddSuccess(false), 3000)
        router.refresh()
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Override rules</CardTitle>
          <CardDescription>Custom instructions the AI always follows for your brand.</CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ Add'}
        </Button>
      </CardHeader>

      {showForm && (
        <div className="border-b border-(--border-subtle) px-4 pb-4 pt-0">
          <form onSubmit={handleAdd} className="space-y-3">
            {/* Preset / custom toggle */}
            <div className="flex gap-2 pt-1">
              {(['preset', 'custom'] as const).map((t) => (
                <button key={t} type="button" onClick={() => setRuleType(t)}
                  className={`rounded-(--r-sm) border px-3 py-1 text-xs font-medium capitalize transition-colors ${ruleType === t ? 'border-(--accent) bg-(--accent)/10 text-(--accent)' : 'border-(--border-subtle) text-(--fg-muted) hover:bg-(--surface-2)'}`}>
                  {t === 'preset' ? 'Common rules' : 'Custom rule'}
                </button>
              ))}
            </div>

            {/* Key */}
            {ruleType === 'preset' ? (
              <div>
                <label className="block text-xs font-medium text-(--fg-muted) mb-1">Rule type</label>
                <select
                  className="w-full rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-1) px-2 py-1.5 text-sm"
                  value={presetKey}
                  onChange={(e) => handlePresetChange(e.target.value)}
                  disabled={addPending}
                >
                  {PRESET_RULES.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
                {preset?.hint && <p className="mt-0.5 text-xs text-(--fg-faint)">{preset.hint}</p>}
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-(--fg-muted) mb-1">Rule key</label>
                <Input placeholder="e.g. force_hashtags, max_caption_length" value={customKey}
                  onChange={(e) => setCustomKey(e.target.value)} disabled={addPending} className="font-mono text-sm" />
              </div>
            )}

            {/* Value type (custom only) */}
            {ruleType === 'custom' && (
              <div className="flex gap-2">
                {(['list', 'text', 'boolean'] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setValueType(t)}
                    className={`rounded-(--r-sm) border px-2.5 py-1 text-xs capitalize transition-colors ${valueType === t ? 'border-(--accent) bg-(--accent)/10 text-(--accent)' : 'border-(--border-subtle) text-(--fg-muted) hover:bg-(--surface-2)'}`}>
                    {t}
                  </button>
                ))}
              </div>
            )}

            {/* Value input */}
            {valueType === 'list' && (
              <div>
                <label className="block text-xs font-medium text-(--fg-muted) mb-1">
                  {presetKey === 'force_hashtags' ? 'Hashtags' : 'Items'} (comma-separated)
                </label>
                <Input placeholder={presetKey === 'force_hashtags' ? '#riyadh, #saudi, #الرياض' : 'item1, item2'}
                  value={listVal} onChange={(e) => setListVal(e.target.value)} disabled={addPending} />
              </div>
            )}
            {valueType === 'text' && (
              <div>
                <label className="block text-xs font-medium text-(--fg-muted) mb-1">Value</label>
                <Input placeholder={preset?.hint ?? 'Enter value'} value={textVal}
                  onChange={(e) => setTextVal(e.target.value)} disabled={addPending} />
              </div>
            )}
            {valueType === 'boolean' && (
              <div>
                <label className="block text-xs font-medium text-(--fg-muted) mb-1">Value</label>
                <select className="w-full rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-1) px-2 py-1.5 text-sm"
                  value={boolVal} onChange={(e) => setBoolVal(e.target.value)} disabled={addPending}>
                  <option value="true">true — enabled</option>
                  <option value="false">false — disabled</option>
                </select>
              </div>
            )}

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-(--fg-muted) mb-1">Note (optional)</label>
              <Input placeholder="Why this rule is needed" value={desc}
                onChange={(e) => setDesc(e.target.value)} disabled={addPending} className="text-sm" />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button type="submit" size="sm" disabled={addPending || !canSubmit}>
                {addPending ? 'Saving…' : 'Save rule'}
              </Button>
              {addError && <span className="text-xs text-rose-500">{addError}</span>}
              {addSuccess && <span className="text-xs text-emerald-500">✓ Saved — AI applies on next generation</span>}
            </div>
          </form>
        </div>
      )}

      <CardBody className="p-0">
        {rules.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-(--fg-faint)">
            No override rules. The AI uses standard brand voice settings.
          </p>
        ) : (
          <ul className="divide-y divide-(--border-subtle)">
            {rules.map((r) => (
              <RuleRow key={r.rule_id} rule={r} slug={slug} brand_id={brand_id}
                onDeleted={(id) => setOptimistic((prev) => prev.filter((x) => x.rule_id !== id))} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

function RuleRow({
  rule,
  slug,
  brand_id,
  onDeleted,
}: {
  rule: OverrideRule
  slug: string
  brand_id: string
  onDeleted: (id: string) => void
}) {
  const router = useRouter()
  const [pending, startT] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
      <div className="flex-1 min-w-0">
        <div className="font-mono text-xs font-medium text-(--fg-muted)">{rule.rule_key}</div>
        {rule.description && (
          <div className="text-xs text-(--fg-muted) mt-0.5">{rule.description}</div>
        )}
        <div className="mt-0.5 truncate font-mono text-xs text-(--fg)">
          {typeof rule.rule_value === 'string' ? rule.rule_value : JSON.stringify(rule.rule_value)}
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {error && <span className="text-xs text-rose-500">{error}</span>}
        {rule.rule_id.startsWith('optimistic-') ? (
          <span className="text-xs text-(--fg-faint)">saving…</span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => startT(async () => {
              const r = await deleteBrandOverrideRule({ slug, rule_id: rule.rule_id, brand_id })
              if (!r.ok) setError(r.error ?? 'Delete failed')
              else { onDeleted(rule.rule_id); router.refresh() }
            })}
            title="Remove this rule"
          >
            {pending ? '…' : '✕'}
          </Button>
        )}
      </div>
    </li>
  )
}
