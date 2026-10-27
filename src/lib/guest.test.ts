import { GUEST_COOKIE, getOrCreateGuestId, readGuestId } from './guest'

const { jar } = vi.hoisted(() => ({
  jar: { get: vi.fn(), set: vi.fn() },
}))

vi.mock('next/headers', () => ({
  cookies: async () => jar,
}))

beforeEach(() => {
  vi.resetAllMocks()
})

describe('getOrCreateGuestId', () => {
  it('returns the existing id when the cookie is present, and does not set a cookie', async () => {
    jar.get.mockReturnValue({ name: GUEST_COOKIE, value: 'guest-from-the-browser' })

    expect(await getOrCreateGuestId()).toBe('guest-from-the-browser')
    expect(jar.set).not.toHaveBeenCalled()
  })

  it('generates and sets an id when the cookie is absent', async () => {
    const id = await getOrCreateGuestId()

    expect(id).toHaveLength(36)
    expect(jar.set).toHaveBeenCalledWith(GUEST_COOKIE, id, expect.anything())
  })

  it('sets the cookie httpOnly, sameSite lax, path / and with a maxAge', async () => {
    await getOrCreateGuestId()

    const [, , options] = jar.set.mock.calls[0]
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' })
    expect(options.maxAge).toBe(60 * 60 * 24 * 365)
  })

  it('does not set secure outside production', async () => {
    await getOrCreateGuestId()

    const [, , options] = jar.set.mock.calls[0]
    expect(options.secure).toBe(false)
  })
})

describe('readGuestId', () => {
  it('returns null when the cookie is absent', async () => {
    expect(await readGuestId()).toBeNull()
  })

  it('never writes a cookie, even when absent', async () => {
    await readGuestId()

    expect(jar.set).not.toHaveBeenCalled()
  })
})
