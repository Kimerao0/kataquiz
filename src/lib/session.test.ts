import { getCurrentUser, requireUser, UnauthorizedError } from './session'

const { getSession, betterAuth } = vi.hoisted(() => {
  const getSession = vi.fn()
  return { getSession, betterAuth: vi.fn(() => ({ api: { getSession } })) }
})

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

// Only the library is stubbed. src/lib/auth.ts itself runs for real, so the
// `configuredProviders` block below observes the module's own logic, and the
// spy records the options the module hands to better-auth.
vi.mock('better-auth', () => ({ betterAuth }))

const sessionUser = {
  id: 'user-1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  image: 'https://example.com/ada.png',
}

const validSession = { session: { id: 'session-1' }, user: sessionUser }

// No email: a SessionUser carries only what the rest of the app may render.
const expectedUser = { id: 'user-1', name: 'Ada Lovelace', image: 'https://example.com/ada.png' }

describe('getCurrentUser', () => {
  it('returns null when there is no session', async () => {
    getSession.mockResolvedValue(null)

    expect(await getCurrentUser()).toBeNull()
  })

  it('returns null when the session lookup throws', async () => {
    getSession.mockRejectedValue(new Error('invalid session token'))

    expect(await getCurrentUser()).toBeNull()
  })

  it('returns the user when a valid session exists', async () => {
    getSession.mockResolvedValue(validSession)

    expect(await getCurrentUser()).toEqual(expectedUser)
  })

  it('maps a missing image to null', async () => {
    getSession.mockResolvedValue({
      ...validSession,
      user: { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com' },
    })

    expect(await getCurrentUser()).toEqual({ ...expectedUser, image: null })
  })
})

describe('requireUser', () => {
  it('throws UnauthorizedError when there is no session', async () => {
    getSession.mockResolvedValue(null)

    await expect(requireUser()).rejects.toThrow(UnauthorizedError)
  })

  it('returns the user when a valid session exists', async () => {
    getSession.mockResolvedValue(validSession)

    expect(await requireUser()).toEqual(expectedUser)
  })
})

describe('configuredProviders', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is empty when no OAuth credentials are set', async () => {
    for (const name of [
      'GITHUB_CLIENT_ID',
      'GITHUB_CLIENT_SECRET',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
    ]) {
      vi.stubEnv(name, undefined)
    }
    // src/lib/auth.ts reads the environment once, when the module is evaluated.
    vi.resetModules()

    const { configuredProviders } = await import('./auth')

    expect(configuredProviders).toEqual([])
  })

  it('registers exactly the providers it advertises', async () => {
    vi.stubEnv('GITHUB_CLIENT_ID', 'github-id')
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'github-secret')
    vi.stubEnv('GOOGLE_CLIENT_ID', 'google-id')
    // Half-configured is the interesting case: a secret-less provider must not
    // reach either list.
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '')
    vi.resetModules()
    betterAuth.mockClear()

    const { configuredProviders } = await import('./auth')

    expect(configuredProviders).toEqual(['github'])
    // Registering google anyway would let POST /sign-in/social start an OAuth
    // round trip that can never complete, so the two have to agree.
    expect(betterAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        socialProviders: { github: { clientId: 'github-id', clientSecret: 'github-secret' } },
      }),
    )
  })
})
