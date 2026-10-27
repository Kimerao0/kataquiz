import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '@/db/client'

type OAuthCredentials = { clientId: string; clientSecret: string }

// Credentials are optional on purpose: the module has to import cleanly under
// `vitest`, under `next build` and for a contributor who has not registered any
// OAuth app yet. An unset variable becomes an empty string rather than a throw.
const readEnv = (name: string) => process.env[name] ?? ''

const github: OAuthCredentials = {
  clientId: readEnv('GITHUB_CLIENT_ID'),
  clientSecret: readEnv('GITHUB_CLIENT_SECRET'),
}

const google: OAuthCredentials = {
  clientId: readEnv('GOOGLE_CLIENT_ID'),
  clientSecret: readEnv('GOOGLE_CLIENT_SECRET'),
}

const isConfigured = ({ clientId, clientSecret }: OAuthCredentials) =>
  clientId !== '' && clientSecret !== ''

// The sign-in UI renders only these buttons: a provider without credentials
// would send the user into an OAuth round trip that cannot complete.
export const configuredProviders: string[] = Object.entries({ github, google })
  .filter(([, credentials]) => isConfigured(credentials))
  .map(([id]) => id)

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  // No email/password provider: this project has no email infrastructure.
  socialProviders: { github, google },
  secret: readEnv('BETTER_AUTH_SECRET'),
  baseURL: readEnv('BETTER_AUTH_URL'),
})
