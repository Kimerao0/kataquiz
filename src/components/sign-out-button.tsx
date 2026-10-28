'use client'

import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { signOut } from '@/lib/auth-client'

export function SignOutButton() {
  const t = useTranslations('nav')
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function handleSignOut() {
    setPending(true)
    try {
      await signOut()
      // The header is rendered on the server, so the signed-out state only
      // appears once the route is re-fetched.
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={handleSignOut}
      className="max-sm:size-10 max-sm:border-transparent max-sm:bg-transparent max-sm:px-0 max-sm:text-ink-quiet dark:max-sm:border-transparent dark:max-sm:bg-transparent"
    >
      <LogOut aria-hidden className="size-5 sm:hidden" />
      <span className="max-sm:sr-only">{pending ? t('signingOut') : t('signOut')}</span>
    </Button>
  )
}
