import { cookies } from 'next/headers'

export const GUEST_COOKIE = 'gs_guest'

const ONE_YEAR_SEC = 60 * 60 * 24 * 365

// Two functions on purpose: Next.js throws when a cookie is written during a
// render, so only Server Actions and route handlers may call
// getOrCreateGuestId. Pages read with readGuestId and live with the null.
export async function getOrCreateGuestId(): Promise<string> {
  const jar = await cookies()
  const existing = jar.get(GUEST_COOKIE)?.value
  if (existing) return existing

  const id = crypto.randomUUID()
  jar.set(GUEST_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: ONE_YEAR_SEC,
  })
  return id
}

export async function readGuestId(): Promise<string | null> {
  const jar = await cookies()
  return jar.get(GUEST_COOKIE)?.value ?? null
}
