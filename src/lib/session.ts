import { headers } from 'next/headers'
import { auth } from './auth'

export class UnauthorizedError extends Error {}

export type SessionUser = { id: string; name: string; image: string | null }

// These two functions are the only way the rest of the app learns who the
// caller is: nothing else reads the session or the auth cookie.
export async function getCurrentUser(): Promise<SessionUser | null> {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) return null

    const { id, name, image } = session.user
    return { id, name, image: image ?? null }
  } catch {
    // An expired or tampered cookie means "signed out", not a 500 on the page.
    return null
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) throw new UnauthorizedError('You must be signed in to do this')
  return user
}
