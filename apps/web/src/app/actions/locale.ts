'use server'

/**
 * Server action — flips the locale cookie and revalidates the current path.
 *
 * IMPORTANT: A file marked `'use server'` may only export async functions.
 * Re-exporting types or constants from here will fail at build time with
 * "ReferenceError: <name> is not defined". Put non-action exports somewhere
 * else (we re-export them from `@repo/i18n` directly).
 */

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { COOKIE_NAME, isLocale } from '@repo/i18n'

const ONE_YEAR = 60 * 60 * 24 * 365

export async function setLocaleAction(formData: FormData) {
  const next = formData.get('locale')
  const path = (formData.get('path') as string | null) ?? '/'

  if (!isLocale(next)) return

  const store = await cookies()
  store.set(COOKIE_NAME, next, {
    path: '/',
    maxAge: ONE_YEAR,
    sameSite: 'lax',
    httpOnly: false,
  })
  revalidatePath(path, 'layout')
}
