import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithMessages } from '@/test/intl'
import { HeaderShell, SessionNav } from './site-header'

// site-header.tsx reaches the database through @/lib/session; the mock keeps
// the import chain (and the pg Pool it builds at module scope) out of jsdom.
vi.mock('@/lib/session', () => ({ getCurrentUser: vi.fn() }))
const { signOut, refresh } = vi.hoisted(() => ({ signOut: vi.fn(), refresh: vi.fn() }))

vi.mock('@/lib/auth-client', () => ({ signOut }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const user = { id: 'user-1', name: 'Ada Lovelace', image: null }

type SignOutResult =
  | { data: { success: true }; error: null }
  | { data: null; error: { message: string; status: number } }

// A promise the test settles by hand, so the pending state can be observed.
function deferredSignOut() {
  let resolve!: (value: SignOutResult) => void
  const promise = new Promise<SignOutResult>((r) => {
    resolve = r
  })
  signOut.mockReturnValue(promise)
  return resolve
}

// The disabled state may be exposed as aria-disabled or as base-ui's data attribute.
function expectDisabled(el: HTMLElement, disabled: boolean) {
  const isDisabled = el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('data-disabled')
  expect(isDisabled).toBe(disabled)
}

async function openMenu() {
  await userEvent.click(screen.getByRole('button', { name: /Account: / }))
  return screen.findByRole('menu')
}

beforeEach(() => {
  signOut.mockReset()
  refresh.mockReset()
})

// SessionNav is what SessionArea renders once the session has resolved; the
// async wrapper around it is a server component and is covered by the build.
describe('site header', () => {
  it('shows a sign-in link when signed out', () => {
    renderWithMessages(<SessionNav user={null} />)

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/signin')
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'My mistakes' })).not.toBeInTheDocument()
  })

  it('shows a single account menu trigger named after the user', () => {
    renderWithMessages(<SessionNav user={user} />)

    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Account: Ada Lovelace' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('keeps the account actions out of the bar until the menu is opened', () => {
    renderWithMessages(<SessionNav user={user} />)

    expect(screen.queryByRole('link', { name: 'My mistakes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens a menu with a My mistakes link and a Sign out item', async () => {
    renderWithMessages(<SessionNav user={user} />)

    await userEvent.click(screen.getByRole('button', { name: 'Account: Ada Lovelace' }))

    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(await screen.findByRole('menuitem', { name: 'My mistakes' })).toHaveAttribute(
      'href',
      '/mistakes',
    )
    expect(await screen.findByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('keeps a long display name whole in the trigger accessible name', () => {
    const name = 'Maximilian Bartholomew Featherstonehaugh-Cholmondeley III'
    renderWithMessages(<SessionNav user={{ ...user, name }} />)

    expect(screen.getByRole('button', { name: `Account: ${name}` })).toBeInTheDocument()
  })

  it('shows the full name as plain text in the open menu, not as an item', async () => {
    renderWithMessages(<SessionNav user={user} />)

    const menu = await openMenu()

    expect(within(menu).getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Ada Lovelace' })).toBeNull()
  })

  it('disables Sign out while pending, then refreshes the route once it succeeds', async () => {
    const resolve = deferredSignOut()
    renderWithMessages(<SessionNav user={user} />)
    await openMenu()

    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))

    const pending = await screen.findByRole('menuitem', { name: 'Signing out…' })
    expectDisabled(pending, true)
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()

    resolve({ data: { success: true }, error: null })

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(screen.queryByText("Couldn't sign out. Try again.")).not.toBeInTheDocument()
  })

  it('keeps the menu open with an error and an enabled item when sign out fails', async () => {
    const resolve = deferredSignOut()
    renderWithMessages(<SessionNav user={user} />)
    const menu = await openMenu()

    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
    resolve({ data: null, error: { message: 'boom', status: 500 } })

    expect(await within(menu).findByText("Couldn't sign out. Try again.")).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeInTheDocument()
    const item = await screen.findByRole('menuitem', { name: 'Sign out' })
    expectDisabled(item, false)
  })

  it('shows the avatar image and swaps it for the initial when it fails to load', async () => {
    const { container } = renderWithMessages(
      <SessionNav user={{ ...user, image: 'https://example.com/a.png' }} />,
    )
    const trigger = screen.getByRole('button', { name: 'Account: Ada Lovelace' })

    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(trigger).toContainElement(img as HTMLElement)
    expect(img).toHaveAttribute('alt', '')

    fireEvent.error(img as HTMLElement)

    expect(container.querySelector('img')).toBeNull()
    expect(within(trigger).getByText('A')).toBeInTheDocument()
  })

  it('does not render an unsafe avatar URL, showing the initial instead', () => {
    const { container } = renderWithMessages(
      <SessionNav user={{ ...user, image: 'javascript:alert(1)' }} />,
    )
    const trigger = screen.getByRole('button', { name: 'Account: Ada Lovelace' })

    expect(container.querySelector('img')).toBeNull()
    expect(within(trigger).getByText('A')).toBeInTheDocument()
  })

  it('uses a plain initial as the fallback monogram, not the brand seal', () => {
    renderWithMessages(<SessionNav user={user} />)
    const trigger = screen.getByRole('button', { name: 'Account: Ada Lovelace' })

    // Seal's root renders <span class="seal">.
    expect(trigger.querySelector('.seal')).toBeNull()
    expect(within(trigger).getByText('A')).toBeInTheDocument()
  })

  it('links Paths between Browse and Upload', () => {
    renderWithMessages(<HeaderShell>{null}</HeaderShell>)

    const paths = screen.getByRole('link', { name: 'Paths' })
    expect(paths).toHaveAttribute('href', '/paths')

    const links = screen.getAllByRole('link')
    const browse = links.indexOf(screen.getByRole('link', { name: 'Browse quizzes' }))
    const upload = links.indexOf(screen.getByRole('link', { name: 'Upload a quiz' }))
    expect(links.indexOf(paths)).toBeGreaterThan(browse)
    expect(links.indexOf(paths)).toBeLessThan(upload)
  })
})
