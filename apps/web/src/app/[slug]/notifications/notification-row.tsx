'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import {
  CheckCircle2, XCircle, RefreshCw, Calendar, Bell,
  Zap, AlertCircle, Send, Sparkles, ShieldCheck,
} from '@repo/ui/icons'
import { markOneRead } from './actions'

interface Props {
  notificationId: string
  slug: string
  lang: string
  isUnread: boolean
  renderedTitle: string
  createdAt: string
  deepLink: string | null
  dateLocale: 'ar-SA' | 'en-US'
  templateKey: string | null
}

type IconConfig = {
  Icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>
  color: string
  bg: string
  ring: string
}

const TEMPLATE_CONFIG: Record<string, IconConfig> = {
  calendar_delivered:         { Icon: Calendar,    color: '#10b981', bg: 'rgba(16,185,129,0.15)',  ring: 'rgba(16,185,129,0.3)'  },
  calendar_approved:          { Icon: CheckCircle2, color: '#22c55e', bg: 'rgba(34,197,94,0.15)',   ring: 'rgba(34,197,94,0.3)'   },
  calendar_pending_review:    { Icon: Calendar,    color: '#38bdf8', bg: 'rgba(56,189,248,0.15)',  ring: 'rgba(56,189,248,0.3)'  },
  calendar_rejected:          { Icon: XCircle,     color: '#f43f5e', bg: 'rgba(244,63,94,0.15)',   ring: 'rgba(244,63,94,0.3)'   },
  post_approved:              { Icon: CheckCircle2, color: '#22c55e', bg: 'rgba(34,197,94,0.15)',   ring: 'rgba(34,197,94,0.3)'   },
  post_rejected:              { Icon: AlertCircle, color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',  ring: 'rgba(245,158,11,0.3)'  },
  revision_ready:             { Icon: RefreshCw,   color: '#38bdf8', bg: 'rgba(56,189,248,0.15)',  ring: 'rgba(56,189,248,0.3)'  },
  publish_success:            { Icon: Send,        color: '#22c55e', bg: 'rgba(34,197,94,0.15)',   ring: 'rgba(34,197,94,0.3)'   },
  publish_failed:             { Icon: XCircle,     color: '#f43f5e', bg: 'rgba(244,63,94,0.15)',   ring: 'rgba(244,63,94,0.3)'   },
  branddna_correction_applied:{ Icon: ShieldCheck, color: '#a78bfa', bg: 'rgba(167,139,250,0.15)', ring: 'rgba(167,139,250,0.3)' },
  branddna_correction_rejected:{ Icon: AlertCircle, color: '#f43f5e', bg: 'rgba(244,63,94,0.15)',  ring: 'rgba(244,63,94,0.3)'   },
  branddna_onboarding_complete:{ Icon: Sparkles,   color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',  ring: 'rgba(245,158,11,0.3)'  },
  cost_ceiling_approaching:   { Icon: Zap,         color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',  ring: 'rgba(245,158,11,0.3)'  },
  cost_ceiling_breached:      { Icon: Zap,         color: '#f43f5e', bg: 'rgba(244,63,94,0.15)',   ring: 'rgba(244,63,94,0.3)'   },
}

const DEFAULT_CONFIG: IconConfig = {
  Icon: Bell, color: '#10b981', bg: 'rgba(16,185,129,0.15)', ring: 'rgba(16,185,129,0.3)',
}

function getRelativeTime(dateStr: string, locale: 'ar-SA' | 'en-US'): string {
  const diff  = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)

  if (locale === 'ar-SA') {
    if (mins  <  1) return 'الآن'
    if (mins  < 60) return `منذ ${mins} د`
    if (hours < 24) return `منذ ${hours} س`
    return `منذ ${days} ي`
  }
  if (mins  <  1) return 'just now'
  if (mins  < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

export function NotificationRow({
  notificationId,
  slug,
  lang,
  isUnread,
  renderedTitle,
  createdAt,
  deepLink,
  dateLocale,
  templateKey,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const cfg     = (templateKey ? TEMPLATE_CONFIG[templateKey] : undefined) ?? DEFAULT_CONFIG
  const { Icon } = cfg
  const relTime = getRelativeTime(createdAt, dateLocale)
  const absTime = new Date(createdAt).toLocaleString(dateLocale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  const handleActivate = () => {
    startTransition(async () => {
      if (isUnread) await markOneRead(notificationId, slug)
      if (deepLink) router.push(deepLink)
      else router.refresh()
    })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleActivate()
    }
  }

  return (
    <li role="listitem">
      <button
        type="button"
        onClick={handleActivate}
        onKeyDown={onKeyDown}
        disabled={pending}
        aria-label={`${isUnread ? 'unread: ' : ''}${renderedTitle}`}
        className={[
          'group relative flex w-full items-start gap-3.5 px-4 py-3.5 text-start transition-all duration-150',
          'hover:bg-(--surface-2) focus-visible:bg-(--surface-2)',
          'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--accent)',
          'disabled:opacity-50',
          isUnread ? 'bg-(--surface-1)' : '',
        ].join(' ')}
      >
        {/* Unread stripe */}
        {isUnread && (
          <span
            className="absolute inset-y-0 start-0 w-[3px] rounded-full"
            style={{ background: cfg.color }}
            aria-hidden="true"
          />
        )}

        {/* Icon circle */}
        <div
          style={{ background: cfg.bg, boxShadow: isUnread ? `0 0 0 1px ${cfg.ring}` : 'none' }}
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105"
          aria-hidden="true"
        >
          <Icon size={16} style={{ color: cfg.color }} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          <p
            className={[
              'text-sm leading-snug',
              isUnread ? 'font-semibold text-(--fg)' : 'font-medium text-(--fg-muted)',
            ].join(' ')}
          >
            {renderedTitle}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-(--fg-faint)">
            <span>{relTime}</span>
            <span className="opacity-40">·</span>
            <time dateTime={createdAt}>{absTime}</time>
          </p>
        </div>

        {/* Unread dot */}
        {isUnread && (
          <div className="mt-1.5 shrink-0" aria-hidden="true">
            <span
              className="block h-2 w-2 rounded-full"
              style={{ background: cfg.color, boxShadow: `0 0 6px ${cfg.color}90` }}
            />
          </div>
        )}
      </button>
    </li>
  )
}
