import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

export const GUEST_COOKIE = 'gs_guest'

const ONE_YEAR_SEC = 60 * 60 * 24 * 365

// Read per call, not at import: a missing key must stop a guest id from being
// minted, not stop the module from loading under `next build`.
function signingKey(): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('BETTER_AUTH_SECRET is not set; guest ids cannot be signed')
  return secret
}

const sign = (id: string) => createHmac('sha256', signingKey()).update(id).digest('base64url')

function verify(value: string | undefined): string | null {
  if (!value) return null

  const parts = value.split('.')
  if (parts.length !== 2) return null

  const [id, signature] = parts
  const given = Buffer.from(signature)
  const expected = Buffer.from(sign(id))
  // timingSafeEqual throws on a length mismatch instead of returning false.
  if (given.length !== expected.length) return null

  return timingSafeEqual(given, expected) ? id : null
}

// Two functions on purpose: Next.js throws when a cookie is written during a
// render, so only Server Actions and route handlers may call
// getOrCreateGuestId. Pages read with readGuestId and live with the null.
export async function getOrCreateGuestId(): Promise<string> {
  const jar = await cookies()
  const existing = verify(jar.get(GUEST_COOKIE)?.value)
  if (existing) return existing

  const id = crypto.randomUUID()
  jar.set(GUEST_COOKIE, `${id}.${sign(id)}`, {
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
  return verify(jar.get(GUEST_COOKIE)?.value)
}
