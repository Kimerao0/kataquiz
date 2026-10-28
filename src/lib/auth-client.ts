import { createAuthClient } from 'better-auth/react'

// Written as a literal `process.env.NEXT_PUBLIC_…` access so that Next inlines
// the value into the browser bundle; a dynamic lookup from inside node_modules
// is never substituted at build time.
//
// When it is unset, `baseURL` is left undefined rather than set to a relative
// path: `createAuthClient` runs its argument through `assertHasProtocol`, so
// passing '/api/auth' throws `Invalid base URL`. Undefined makes better-auth
// resolve the route handler against the current origin instead, which is what
// lets one build serve localhost, a preview host and production unchanged.
const baseURL = process.env.NEXT_PUBLIC_BETTER_AUTH_URL || undefined

export const authClient = createAuthClient({ baseURL })

// `signIn.social` POSTs to /sign-in/social with a `provider` body field, so it
// can only ever be called from script — there is no URL to put in a <Link>.
export const { signIn, signOut, useSession } = authClient
