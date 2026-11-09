import { NextRequest } from 'next/server'
import { GET } from './route'

const { getCurrentUser, getMistakes } = vi.hoisted(() => ({
  getCurrentUser: vi.fn<typeof import('@/lib/session').getCurrentUser>(),
  getMistakes: vi.fn<typeof import('@/lib/mistakes/mistakes').getMistakes>(),
}))

vi.mock('@/lib/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/session')>()),
  getCurrentUser,
}))

// Only the read is stubbed: tag parsing and the export shape stay real, so
// these tests pin what the handler does with them. The query has its own test
// against Postgres.
vi.mock('@/lib/mistakes/mistakes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mistakes/mistakes')>()),
  getMistakes,
}))

const player = { id: 'user-1', name: 'Ada Lovelace', image: null }

function exportRequest(query = '') {
  return new NextRequest(`http://localhost/mistakes/export${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  getCurrentUser.mockResolvedValue(player)
  getMistakes.mockResolvedValue([])
  // Only Date is faked, so the awaited mocks still resolve.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-03T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /mistakes/export', () => {
  it('turns away a signed-out caller without reading anything', async () => {
    getCurrentUser.mockResolvedValue(null)

    const response = await GET(exportRequest('?tag=aws'))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthorized' })
    expect(getMistakes).not.toHaveBeenCalled()
  })

  it("downloads the caller's mistakes for the tag as a private attachment", async () => {
    const response = await GET(exportRequest('?tag=%20aws%20'))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/json')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="kataquiz-mistakes-aws-2026-11-03.json"',
    )
    const body = await response.json()
    expect(body).toMatchObject({ format: 'kataquiz-mistakes', version: 1, tag: 'aws' })
    expect(getMistakes).toHaveBeenCalledWith('user-1', { tag: 'aws' })
  })

  it('exports everything when the tag is missing', async () => {
    const response = await GET(exportRequest())

    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="kataquiz-mistakes-2026-11-03.json"',
    )
    expect((await response.json()).tag).toBeNull()
    expect(getMistakes).toHaveBeenCalledWith('user-1', { tag: null })
  })

  it('treats a repeated tag as no filter, as the page does', async () => {
    const response = await GET(exportRequest('?tag=aws&tag=k8s'))

    expect((await response.json()).tag).toBeNull()
    expect(getMistakes).toHaveBeenCalledWith('user-1', { tag: null })
  })
})
