import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithMessages } from '@/test/intl'
import { SignInOptions } from './sign-in-options'

const { social, useSearchParams } = vi.hoisted(() => ({
  social: vi.fn(),
  useSearchParams: vi.fn(),
}))

// The whole point of the page is that signing in is a POST with a `provider`
// body field, so the assertion target is the argument object, not a href.
vi.mock('@/lib/auth-client', () => ({ signIn: { social } }))
vi.mock('next/navigation', () => ({ useSearchParams }))

// What better-auth returns for the redirect branch: the real client follows
// `url` via its redirect plugin, which jsdom cannot do.
const redirected = { data: { redirect: true, url: 'https://github.com/login/oauth' }, error: null }

beforeEach(() => {
  vi.clearAllMocks()
  social.mockResolvedValue(redirected)
})

// `next` only ever reaches the component through the query string, so every
// case goes in the way a visitor's URL would.
function renderAt(query: string) {
  useSearchParams.mockReturnValue(new URLSearchParams(query))
  return renderWithMessages(<SignInOptions providers={['github', 'google']} />)
}

function githubButton() {
  return screen.getByRole('button', { name: 'Continue with GitHub' })
}

function callbackURLOfFirstCall() {
  expect(social).toHaveBeenCalledTimes(1)
  return social.mock.calls[0][0].callbackURL
}

describe('signin page', () => {
  it('renders one button per configured provider', () => {
    useSearchParams.mockReturnValue(new URLSearchParams())
    renderWithMessages(<SignInOptions providers={['github']} />)

    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible()
  })

  it('renders an explanatory state when no provider is configured', () => {
    useSearchParams.mockReturnValue(new URLSearchParams())
    renderWithMessages(<SignInOptions providers={[]} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('No sign-in provider is configured')
    // The fix is an environment change, so the state has to name it.
    expect(alert).toHaveTextContent('GITHUB_CLIENT_ID')
  })

  it('calls signIn.social with the provider when a button is clicked', async () => {
    renderAt('')

    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))

    expect(social).toHaveBeenCalledWith({ provider: 'google', callbackURL: '/' })
  })

  it('passes a same-origin next path through as callbackURL', async () => {
    renderAt('next=/upload')

    await userEvent.click(githubButton())

    expect(social).toHaveBeenCalledWith({ provider: 'github', callbackURL: '/upload' })
  })

  it('ignores a protocol-relative next value', async () => {
    renderAt('next=//evil.com')

    await userEvent.click(githubButton())

    expect(callbackURLOfFirstCall()).toBe('/')
    expect(callbackURLOfFirstCall()).not.toContain('evil.com')
  })

  it('ignores a backslash-escaped protocol-relative next value', async () => {
    // Browsers normalise the backslash to a slash, so '/\evil.com' leaves the
    // origin exactly like '//evil.com' does.
    renderAt('next=%2F%5Cevil.com')

    await userEvent.click(githubButton())

    expect(callbackURLOfFirstCall()).toBe('/')
    expect(callbackURLOfFirstCall()).not.toContain('evil.com')
  })

  it('ignores an absolute-URL next value', async () => {
    renderAt('next=https://evil.com/steal')

    await userEvent.click(githubButton())

    expect(callbackURLOfFirstCall()).toBe('/')
    expect(callbackURLOfFirstCall()).not.toContain('evil.com')
  })

  it('disables every button while a sign-in is in flight', async () => {
    // Never resolves: the redirect is still pending, which is the real state a
    // double click would land in.
    social.mockReturnValue(new Promise(() => {}))
    renderAt('')

    await userEvent.click(githubButton())

    // The clicked button says what is happening; the other keeps its label but
    // cannot start a second round trip.
    expect(screen.getByRole('button', { name: 'Redirecting…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled()
    expect(social).toHaveBeenCalledTimes(1)
  })

  it('shows an error and re-enables the buttons when the provider call fails', async () => {
    social.mockResolvedValue({ data: null, error: { status: 500, message: 'boom' } })
    renderAt('')

    await userEvent.click(githubButton())

    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in could not be started')
    expect(githubButton()).toBeEnabled()
  })
})
