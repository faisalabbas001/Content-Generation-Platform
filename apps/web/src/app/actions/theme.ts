'use server'

/**
 * Server action — flips the theme cookie and revalidates the current path.
 *
 * IMPORTANT: A file marked `'use server'` may only export async functions.
 * Type/constant exports live in `@/lib/theme-server` instead.
 */

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { THEME_COOKIE, isTheme } from '@/lib/theme-server'

const ONE_YEAR = 60 * 60 * 24 * 365

export async function setThemeAction(formData: FormData) {
  const next = formData.get('theme')
  const path = (formData.get('path') as string | null) ?? '/'

  if (!isTheme(next)) return

  const store = await cookies()
  store.set(THEME_COOKIE, next, {
    path: '/',
    maxAge: ONE_YEAR,
    sameSite: 'lax',
    httpOnly: false,
  })
  revalidatePath(path, 'layout')
}
