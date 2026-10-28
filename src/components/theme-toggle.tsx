'use client'

import { Moon, Sun } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { applyTheme, resolveTheme, storeTheme } from '@/lib/theme'

const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Re-assert the resolved theme (covers a remount, or a page whose inline
  // script did not run) and follow the OS while no choice is stored.
  applyTheme(resolveTheme())
  const query = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
  const onSystemChange = () => {
    applyTheme(resolveTheme())
    listener()
  }
  query?.addEventListener('change', onSystemChange)
  return () => {
    listeners.delete(listener)
    query?.removeEventListener('change', onSystemChange)
  }
}

const getSnapshot = () => resolveTheme() === 'dark'
// The server cannot know; the label is constant and only aria-pressed settles
// after hydration, while the icon swap is pure CSS so nothing flashes.
const getServerSnapshot = () => false

export function ThemeToggle() {
  const t = useTranslations('nav')
  const dark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  function toggle() {
    const next = dark ? 'light' : 'dark'
    storeTheme(next)
    applyTheme(next)
    notify()
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t('darkMode')}
      aria-pressed={dark}
      className="text-ink-quiet hover:text-ink max-sm:size-10"
      onClick={toggle}
    >
      <Sun aria-hidden className="hidden dark:block" />
      <Moon aria-hidden className="dark:hidden" />
    </Button>
  )
}
