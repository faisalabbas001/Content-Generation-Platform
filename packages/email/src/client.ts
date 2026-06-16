import { Resend } from 'resend'

// Singleton — one Resend instance per process lifetime
let _resend: Resend | null = null

export function resendClient(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY
    if (!key) throw new Error('RESEND_API_KEY env var is not set')
    _resend = new Resend(key)
  }
  return _resend
}

export function resendFrom(): string {
  return process.env.RESEND_FROM_EMAIL ?? 'notifications@ogz.studio'
}
