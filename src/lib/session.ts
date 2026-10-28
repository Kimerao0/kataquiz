import { headers } from 'next/headers'
import { unstable_rethrow } from 'next/navigation'
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
  } catch (error) {
    // Next signals control flow by throwing — a prerender abort, notFound(),
    // redirect(). A blanket catch swallows those, so hand them back first.
    unstable_rethrow(error)

    // What remains is a real failure. An expired or tampered cookie means
    // "signed out", not a 500 on the page, but this catch is broad enough to
    // also cover a datastore outage — log it, or the operator sees nothing
    // while every signed-in user is told they are signed out.
    console.error('[session] getSession failed; treating caller as signed out', error)
    return null
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) throw new UnauthorizedError('You must be signed in to do this')
  return user
}
