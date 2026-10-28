import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '@/db/client'

type OAuthCredentials = { clientId: string; clientSecret: string }

// Credentials are optional on purpose: the module has to import cleanly under
// `vitest`, under `next build` and for a contributor who has not registered any
// OAuth app yet. An unset variable becomes an empty string rather than a throw.
const readEnv = (name: string) => process.env[name] ?? ''

// Every provider this app knows how to offer. Adding one here is the only edit
// needed: the registered providers, the exported id list and the sign-in page's
// buttons are all derived from it.
const providerCredentials = {
  github: {
    clientId: readEnv('GITHUB_CLIENT_ID'),
    clientSecret: readEnv('GITHUB_CLIENT_SECRET'),
  },
  google: {
    clientId: readEnv('GOOGLE_CLIENT_ID'),
    clientSecret: readEnv('GOOGLE_CLIENT_SECRET'),
  },
} satisfies Record<string, OAuthCredentials>

export type SocialProviderId = keyof typeof providerCredentials

const isConfigured = ({ clientId, clientSecret }: OAuthCredentials) =>
  clientId !== '' && clientSecret !== ''

const providerEntries = Object.entries(providerCredentials) as [
  SocialProviderId,
  OAuthCredentials,
][]

// The sign-in UI renders only these buttons: a provider without credentials
// would send the user into an OAuth round trip that cannot complete.
export const configuredProviders: SocialProviderId[] = providerEntries
  .filter(([, credentials]) => isConfigured(credentials))
  .map(([id]) => id)

// Registering an unconfigured provider would make the server advertise a
// round trip it cannot finish. Deriving both from one filter is what keeps
// `POST /api/auth/sign-in/social` accepting exactly the ids the page offers.
const socialProviders = Object.fromEntries(
  providerEntries.filter(([, credentials]) => isConfigured(credentials)),
)

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  // No email/password provider: this project has no email infrastructure.
  socialProviders,
  secret: readEnv('BETTER_AUTH_SECRET'),
  baseURL: readEnv('BETTER_AUTH_URL'),
})
