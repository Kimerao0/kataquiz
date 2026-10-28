import { screen } from '@testing-library/react'
import { renderWithMessages } from '@/test/intl'
import { SessionNav } from './site-header'

// site-header.tsx reaches the database through @/lib/session; the mock keeps
// the import chain (and the pg Pool it builds at module scope) out of jsdom.
vi.mock('@/lib/session', () => ({ getCurrentUser: vi.fn() }))
vi.mock('@/lib/auth-client', () => ({ signOut: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const user = { id: 'user-1', name: 'Ada Lovelace', image: null }

// SessionNav is what SessionArea renders once the session has resolved; the
// async wrapper around it is a server component and is covered by the build.
describe('site header', () => {
  it('shows a sign-in link when signed out', () => {
    renderWithMessages(<SessionNav user={null} />)

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/signin')
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  it("shows the user's name and a sign-out control when signed in", () => {
    renderWithMessages(<SessionNav user={user} />)

    expect(screen.getByText('Signed in as Ada Lovelace')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled()
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument()
  })
})
