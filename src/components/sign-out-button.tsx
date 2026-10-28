'use client'

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
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={handleSignOut}>
      {pending ? t('signingOut') : t('signOut')}
    </Button>
  )
}
