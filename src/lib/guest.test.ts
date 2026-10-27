import { createHmac } from 'node:crypto'
import { GUEST_COOKIE, getOrCreateGuestId, readGuestId } from './guest'

const { jar } = vi.hoisted(() => ({
  jar: { get: vi.fn(), set: vi.fn() },
}))

vi.mock('next/headers', () => ({
  cookies: async () => jar,
}))

const signWith = (secret: string, id: string) =>
  createHmac('sha256', secret).update(id).digest('base64url')

// The secret the module itself signs with, supplied by .env.test.
const sign = (id: string) => signWith(process.env.BETTER_AUTH_SECRET ?? '', id)

// Same length as the real signature, so timingSafeEqual is what rejects it.
const tamper = (signature: string) => `${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`

const presentCookie = (value: string) => {
  jar.get.mockReturnValue({ name: GUEST_COOKIE, value })
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('getOrCreateGuestId', () => {
  it('returns the id from a correctly signed cookie, and does not set a cookie', async () => {
    const id = crypto.randomUUID()
    presentCookie(`${id}.${sign(id)}`)

    expect(await getOrCreateGuestId()).toBe(id)
    expect(jar.set).not.toHaveBeenCalled()
  })

  it('generates and sets an id when the cookie is absent', async () => {
    const id = await getOrCreateGuestId()

    expect(id).toHaveLength(36)
    expect(jar.set).toHaveBeenCalledWith(GUEST_COOKIE, `${id}.${sign(id)}`, expect.anything())
  })

  it('sets a signed cookie, not a bare uuid', async () => {
    const id = await getOrCreateGuestId()

    const [, value] = jar.set.mock.calls[0]
    expect(value).toContain('.')
    expect(value).not.toBe(id)

    presentCookie(id)
    expect(await readGuestId()).toBeNull()
  })

  it('replaces a cookie whose signature does not match', async () => {
    const forged = crypto.randomUUID()
    presentCookie(`${forged}.${tamper(sign(forged))}`)

    const id = await getOrCreateGuestId()

    expect(id).not.toBe(forged)
    expect(jar.set).toHaveBeenCalledWith(GUEST_COOKIE, `${id}.${sign(id)}`, expect.anything())
  })

  it('replaces a cookie with no signature segment', async () => {
    const bare = crypto.randomUUID()
    presentCookie(bare)

    const id = await getOrCreateGuestId()

    expect(id).not.toBe(bare)
    expect(jar.set).toHaveBeenCalledWith(GUEST_COOKIE, `${id}.${sign(id)}`, expect.anything())
  })

  it('replaces a cookie signed with a different secret', async () => {
    const forged = crypto.randomUUID()
    presentCookie(`${forged}.${signWith('a-secret-the-server-does-not-have', forged)}`)

    const id = await getOrCreateGuestId()

    expect(id).not.toBe(forged)
    expect(jar.set).toHaveBeenCalledWith(GUEST_COOKIE, `${id}.${sign(id)}`, expect.anything())
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

  it('returns the id for a correctly signed cookie', async () => {
    const id = crypto.randomUUID()
    presentCookie(`${id}.${sign(id)}`)

    expect(await readGuestId()).toBe(id)
  })

  it('returns null for a tampered signature', async () => {
    const id = crypto.randomUUID()
    presentCookie(`${id}.${tamper(sign(id))}`)

    expect(await readGuestId()).toBeNull()
  })

  it('returns null for a tampered id with a valid-looking signature', async () => {
    const id = crypto.randomUUID()
    presentCookie(`${crypto.randomUUID()}.${sign(id)}`)

    expect(await readGuestId()).toBeNull()
  })

  it('returns null for a malformed value with no separator', async () => {
    presentCookie('not-even-close-to-a-signed-id')

    expect(await readGuestId()).toBeNull()
  })

  it('never writes a cookie, even when absent', async () => {
    await readGuestId()

    expect(jar.set).not.toHaveBeenCalled()
  })

  it('never writes a cookie, even for an invalid one', async () => {
    const id = crypto.randomUUID()
    presentCookie(`${id}.${tamper(sign(id))}`)

    await readGuestId()

    expect(jar.set).not.toHaveBeenCalled()
  })
})
