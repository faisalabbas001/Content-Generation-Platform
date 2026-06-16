'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Field, Input } from '@repo/ui/input'
import { Button } from '@repo/ui/button'
import {
  updateProfile,
  changePassword,
  updateNotifications,
  requestAccountDeletion,
  disconnectInstagram,
  type ActionResult,
} from '@/app/actions/settings'

interface Labels {
  saveProfile: string
  changePassword: string
  saveNotifications: string
  deleteAccount: string
  fullName: string
  phone: string
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

function StatusLine({ state }: { state: ActionResult | null }) {
  if (!state) return null
  if (!state.ok) {
    return <p className="rounded-(--r-sm) border border-(--danger)/30 bg-(--danger)/10 px-3 py-2 text-sm text-(--danger)" role="alert">{state.error}</p>
  }
  return <p className="rounded-(--r-sm) border border-(--accent)/30 bg-(--accent-soft) px-3 py-2 text-sm text-(--fg)" role="status">{state.message}</p>
}

export function ProfileForm({
  slug,
  initialFullName,
  initialEmail,
  initialPhone,
  labels,
}: {
  slug: string
  initialFullName: string
  initialEmail: string
  initialPhone: string
  labels: Labels & { email: string }
}) {
  const [state, setState] = useState<ActionResult | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => setState(await updateProfile(slug, fd)))
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      <Field label={labels.fullName}>
        <Input name="full_name" defaultValue={initialFullName} />
      </Field>
      <Field label={labels.email}>
        <Input type="email" dir="ltr" defaultValue={initialEmail} disabled />
      </Field>
      <Field label={labels.phone}>
        <Input type="tel" name="phone" dir="ltr" defaultValue={initialPhone} placeholder="+966 5x xxx xxxx" />
      </Field>
      <div />
      {state && <div className="sm:col-span-2"><StatusLine state={state} /></div>}
      <div className="sm:col-span-2 flex justify-end">
        <Button type="submit" disabled={pending}>{pending ? '…' : labels.saveProfile}</Button>
      </div>
    </form>
  )
}

export function PasswordForm({ slug, labels }: { slug: string; labels: Labels }) {
  const [state, setState] = useState<ActionResult | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await changePassword(slug, fd)
      setState(result)
      if (result.ok) e.currentTarget?.reset()
    })
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      <Field label={labels.currentPassword}>
        <Input type="password" name="current_password" dir="ltr" />
      </Field>
      <div className="hidden sm:block" />
      <Field label={labels.newPassword}>
        <Input type="password" name="new_password" dir="ltr" minLength={8} />
      </Field>
      <Field label={labels.confirmPassword}>
        <Input type="password" name="confirm_password" dir="ltr" minLength={8} />
      </Field>
      {state && <div className="sm:col-span-2"><StatusLine state={state} /></div>}
      <div className="sm:col-span-2 flex justify-end">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? '…' : labels.changePassword}
        </Button>
      </div>
    </form>
  )
}

export function NotificationsForm({
  slug,
  initial,
  rows,
  saveLabel,
}: {
  slug: string
  initial: { calendar_ready: boolean; revision_ready: boolean; anomaly: boolean }
  rows: Array<{ name: string; label: string; defaultChecked: boolean }>
  saveLabel: string
}) {
  void initial
  const [state, setState] = useState<ActionResult | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => setState(await updateNotifications(slug, fd)))
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <ul className="divide-y divide-(--border-subtle)">
        {rows.map((row) => (
          <li key={row.name} className="flex items-center justify-between py-3">
            <span className="text-sm text-(--fg-subtle)">{row.label}</span>
            <label className="relative inline-flex h-6 w-11 cursor-pointer items-center">
              <input type="checkbox" name={row.name} defaultChecked={row.defaultChecked} className="peer sr-only" />
              <span className="absolute inset-0 rounded-full bg-(--surface-4) transition-colors peer-checked:bg-(--accent)" />
              <span className="absolute start-1 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-5 rtl:peer-checked:-translate-x-5" />
            </label>
          </li>
        ))}
      </ul>
      {state && <StatusLine state={state} />}
      <div className="flex justify-end">
        <Button type="submit" variant="secondary" disabled={pending}>{pending ? '…' : saveLabel}</Button>
      </div>
    </form>
  )
}

export function InstagramConnectCard({
  slug,
  isConnected,
  handle,
}: {
  slug: string
  isConnected: boolean
  handle: string | null
}) {
  return (
    <div className="space-y-4">
      {isConnected ? (
        <div className="flex items-center gap-3 rounded-(--r-sm) border border-(--border) bg-(--surface) px-4 py-3">
          <svg className="h-5 w-5 shrink-0 text-pink-500" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-(--fg)">
              {handle ? `@${handle}` : 'Instagram'}
            </p>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Connected via Postiz
            </span>
          </div>
          <DisconnectInstagramButton slug={slug} />
        </div>
      ) : (
        <InstagramConnectFlow slug={slug} />
      )}
    </div>
  )
}

// True disconnect: clears postiz_channel_id for this brand (server action) —
// no OAuth redirect involved. The card flips back to the connect flow via
// revalidatePath, from which the user can reconnect cleanly.
function DisconnectInstagramButton({ slug }: { slug: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onClick() {
    if (pending) return
    if (!confirm('Disconnect Instagram from this brand? Auto-publishing will stop until you reconnect.')) return
    setError(null)
    startTransition(async () => {
      const res = await disconnectInstagram(slug)
      if (!res.ok) setError(res.error ?? 'failed')
    })
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="text-xs text-(--danger) hover:opacity-80 underline underline-offset-2 disabled:opacity-50"
      >
        {pending ? 'Disconnecting…' : 'Disconnect'}
      </button>
      {error && <span className="text-[11px] text-(--danger)">{error}</span>}
    </div>
  )
}

// Not-yet-connected state: primary button = direct Instagram login
// (instagram-standalone — works for any Professional account, no Facebook
// Page needed). Clicking it opens the OAuth in a new tab AND starts polling
// /api/postiz/sync-channels in the background; the card flips to Connected
// automatically the moment Postiz registers the channel — the user never
// needs to click a "verify" button.
function InstagramConnectFlow({ slug }: { slug: string }) {
  const router = useRouter()
  const [polling, setPolling] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [takeover, setTakeover] = useState<{ channel_id: string; handle: string } | null>(null)
  const [takeoverBusy, setTakeoverBusy] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  function startPolling() {
    if (timerRef.current) clearInterval(timerRef.current)
    setPolling(true)
    setTimedOut(false)
    setConflict(false)
    setTakeover(null)
    const startedAt = Date.now()
    timerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/postiz/sync-channels?slug=${slug}`)
        if (res.ok) {
          const data = (await res.json()) as {
            ok?: boolean
            conflict?: boolean
            takeover?: { channel_id: string; handle: string }
          }
          if (data.ok) {
            if (timerRef.current) clearInterval(timerRef.current)
            router.refresh() // server re-reads channel_profiles → Connected badge
            return
          }
          if (data.takeover) {
            // The authorized account is already linked to another brand —
            // stop spinning and ask the user explicitly.
            if (timerRef.current) clearInterval(timerRef.current)
            setPolling(false)
            setTakeover(data.takeover)
            return
          }
          if (data.conflict) {
            if (timerRef.current) clearInterval(timerRef.current)
            setPolling(false)
            setConflict(true)
            return
          }
        }
      } catch { /* network blip — keep polling */ }
      if (Date.now() - startedAt > 5 * 60_000) {
        if (timerRef.current) clearInterval(timerRef.current)
        setPolling(false)
        setTimedOut(true)
      }
    }, 5000)
  }

  async function confirmTakeover() {
    if (!takeover || takeoverBusy) return
    setTakeoverBusy(true)
    try {
      const res = await fetch(
        `/api/postiz/sync-channels?slug=${slug}&takeover=${encodeURIComponent(takeover.channel_id)}`,
      )
      const data = (await res.json().catch(() => null)) as { ok?: boolean } | null
      if (res.ok && data?.ok) {
        router.refresh()
        return
      }
      setTakeover(null)
      setTimedOut(true)
    } catch {
      setTakeover(null)
      setTimedOut(true)
    } finally {
      setTakeoverBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-(--fg-muted)">
        Connect your Instagram Professional account to enable auto-publishing of approved posts.
        Authorization opens in a new tab — this page updates automatically once you finish.
      </p>
      <div className="flex flex-col gap-2">
        <a
          href={`/api/postiz/connect?slug=${slug}&type=instagram-standalone`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={startPolling}
          className="inline-flex w-fit items-center gap-2 rounded-(--r-sm) bg-linear-to-r from-purple-600 to-pink-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
          </svg>
          Connect Instagram
        </a>
        <a
          href={`/api/postiz/connect?slug=${slug}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={startPolling}
          className="text-xs text-(--fg-muted) underline underline-offset-2 hover:text-(--fg) w-fit"
        >
          Business account linked to a Facebook Page? Connect via Facebook instead
        </a>
      </div>
      {polling && (
        <p className="flex items-center gap-2 rounded-(--r-sm) border border-(--border) bg-(--surface) px-3 py-2 text-sm text-(--fg-muted)" role="status">
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-(--fg-muted)/30 border-t-(--fg-muted)" />
          Waiting for you to finish authorizing in the other tab… this page will update by itself.
        </p>
      )}
      {timedOut && (
        <p className="rounded-(--r-sm) border border-(--danger)/30 bg-(--danger)/10 px-3 py-2 text-sm text-(--danger)" role="alert">
          We didn&apos;t detect a connection. If you finished authorizing, click{' '}
          <a className="underline underline-offset-2" href={`/api/postiz/detect?slug=${slug}`}>save connection</a>{' '}
          — otherwise try connecting again.
        </p>
      )}
      {conflict && (
        <p className="rounded-(--r-sm) border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-500" role="alert">
          The Instagram account you authorized is connected to more than one of your
          other brands, so we can&apos;t tell which one to move. Disconnect it from the
          brand that should no longer use it, then connect again here.
        </p>
      )}
      {takeover && (
        <div className="space-y-2 rounded-(--r-sm) border border-amber-500/30 bg-amber-500/10 px-3 py-2.5" role="alert">
          <p className="text-sm text-amber-500">
            <span className="font-semibold">@{takeover.handle}</span> is already connected
            to another brand. An Instagram account can only publish for one brand at a
            time — move it to this brand? The other brand will be disconnected.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmTakeover}
              disabled={takeoverBusy}
              className="rounded-(--r-sm) bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 transition-colors disabled:opacity-50"
            >
              {takeoverBusy ? 'Moving…' : 'Move Instagram to this brand'}
            </button>
            <button
              type="button"
              onClick={() => setTakeover(null)}
              disabled={takeoverBusy}
              className="rounded-(--r-sm) border border-(--border) px-3 py-1.5 text-xs font-medium text-(--fg-muted) hover:text-(--fg) transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function PostizConnectCard({
  slug,
  connected,
  channelName,
}: {
  slug: string
  connected: boolean
  channelName: string | null
}) {
  return (
    <div className="space-y-4">
      {connected ? (
        <div className="flex items-center gap-3 rounded-(--r-sm) border border-(--border) bg-(--surface) px-4 py-3">
          <svg className="h-5 w-5 shrink-0 text-pink-500" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-(--fg)">
              {channelName ?? 'Instagram connected via Postiz'}
            </p>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Active
            </span>
          </div>
          <a
            href={`/api/postiz/connect?slug=${slug}`}
            className="shrink-0 text-xs text-(--fg-muted) hover:text-(--fg) underline underline-offset-2"
          >
            Reconnect
          </a>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-(--fg-muted)">
            Connect your Instagram Business account via Postiz to enable auto-publishing of approved posts.
          </p>
          <div>
            <a
              href={`/api/postiz/connect?slug=${slug}`}
              className="inline-flex items-center gap-2 rounded-(--r-sm) bg-gradient-to-r from-purple-600 to-pink-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
              </svg>
              Connect Instagram via Postiz
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

export function PostizOAuthFeedback({
  postizConnected,
  postizError,
}: {
  postizConnected: string | undefined
  postizError: string | undefined
}) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (!postizConnected && !postizError) return
    const t = setTimeout(() => setVisible(false), 5000)
    return () => clearTimeout(t)
  }, [postizConnected, postizError])

  if (!visible || (!postizConnected && !postizError)) return null

  if (postizConnected === 'true') {
    return (
      <p
        className="rounded-(--r-sm) border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500"
        role="status"
      >
        Instagram connected via Postiz successfully.
      </p>
    )
  }

  const reason = postizError ?? 'unknown_error'
  return (
    <p
      className="rounded-(--r-sm) border border-(--danger)/30 bg-(--danger)/10 px-3 py-2 text-sm text-(--danger)"
      role="alert"
    >
      Could not connect via Postiz: {reason.replace(/_/g, ' ')}.
    </p>
  )
}

export function DeleteAccountButton({ slug, label }: { slug: string; label: string }) {
  const [state, setState] = useState<ActionResult | null>(null)
  const [pending, startTransition] = useTransition()

  function onClick() {
    if (!confirm('This requests deletion of your account and all brand data. Continue?')) return
    startTransition(async () => setState(await requestAccountDeletion(slug)))
  }

  return (
    <div className="space-y-2">
      <Button variant="danger" type="button" onClick={onClick} disabled={pending}>
        {pending ? '…' : label}
      </Button>
      {state && <StatusLine state={state} />}
    </div>
  )
}
