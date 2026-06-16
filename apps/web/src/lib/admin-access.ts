export interface AdminPrincipal {
  email?: string | null
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
}

export function getAdminAllowlistEmails(): Set<string> {
  const emails = new Set(parseCsv(process.env.ADMIN_ALLOWLIST_EMAILS))

  // Local bootstrap convenience only. Keep disabled in production.
  if (process.env.NODE_ENV !== 'production') {
    emails.add('admin@openclaw.local')
  }

  return emails
}

export function isAdminPrincipal(user: AdminPrincipal): boolean {
  if (user.user_metadata?.is_admin === true) return true
  if (user.app_metadata?.role === 'admin') return true

  const email = user.email?.toLowerCase()
  if (!email) return false
  return getAdminAllowlistEmails().has(email)
}
