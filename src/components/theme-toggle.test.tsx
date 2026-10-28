import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { THEME_STORAGE_KEY } from '@/lib/theme'
import { renderWithMessages } from '@/test/intl'
import { ThemeToggle } from './theme-toggle'

const isDark = () => document.documentElement.classList.contains('dark')

describe('theme toggle', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  it('renders a labelled toggle button', () => {
    renderWithMessages(<ThemeToggle />)

    expect(screen.getByRole('button', { name: 'Dark mode' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('flips the applied theme both ways', async () => {
    const user = userEvent.setup()
    renderWithMessages(<ThemeToggle />)
    const button = screen.getByRole('button', { name: 'Dark mode' })

    await user.click(button)
    expect(isDark()).toBe(true)
    expect(button).toHaveAttribute('aria-pressed', 'true')

    await user.click(button)
    expect(isDark()).toBe(false)
    expect(button).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps the choice across a remount', async () => {
    const user = userEvent.setup()
    const first = renderWithMessages(<ThemeToggle />)
    await user.click(screen.getByRole('button', { name: 'Dark mode' }))
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    first.unmount()
    // Simulate a fresh page: nothing but storage carries over.
    document.documentElement.classList.remove('dark')

    renderWithMessages(<ThemeToggle />)

    expect(isDark()).toBe(true)
    expect(screen.getByRole('button', { name: 'Dark mode' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
