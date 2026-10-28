'use client'

import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { SocialProviderId } from '@/lib/auth'
import { signIn } from '@/lib/auth-client'

// `next` comes from the query string and is handed straight to an OAuth
// callback, so anything that can leave this origin is an open redirect. Only a
// path with exactly one leading slash survives: '//evil.com' is
// protocol-relative, '/\evil.com' is normalised to it by browsers, and
// 'https://evil.com' or 'javascript:…' never start with a slash at all.
function safeNextPath(next: string | null) {
  if (!next?.startsWith('/')) return undefined
  if (next[1] === '/' || next[1] === '\\') return undefined
  return next
}

export function SignInOptions({ providers }: { providers: SocialProviderId[] }) {
  const t = useTranslations('signIn')
  const searchParams = useSearchParams()
  const [pendingProvider, setPendingProvider] = useState<SocialProviderId | null>(null)
  const [failed, setFailed] = useState(false)

  const callbackURL = safeNextPath(searchParams.get('next')) ?? '/'

  async function startSignIn(provider: SocialProviderId) {
    setFailed(false)
    setPendingProvider(provider)
    try {
      const { error } = await signIn.social({ provider, callbackURL })
      // On success the browser is already navigating to the provider, so the
      // button stays disabled rather than flickering back to its idle label.
      if (!error) return
      setFailed(true)
    } catch {
      setFailed(true)
    }
    setPendingProvider(null)
  }

  // A fresh clone has no OAuth credentials, and a page with no buttons reads as
  // broken rather than as unconfigured.
  if (providers.length === 0) {
    return (
      <Alert>
        <AlertTitle>{t('noProvidersTitle')}</AlertTitle>
        <AlertDescription>{t('noProvidersBody')}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {failed && (
        <Alert variant="destructive">
          <AlertTitle>{t('errorTitle')}</AlertTitle>
          <AlertDescription>{t('errorBody')}</AlertDescription>
        </Alert>
      )}
      {providers.map((provider) => (
        <Button
          key={provider}
          type="button"
          size="lg"
          className="h-12 text-base"
          disabled={pendingProvider !== null}
          onClick={() => startSignIn(provider)}
        >
          {pendingProvider === provider
            ? t('redirecting')
            : t('continueWith', { provider: t(`providers.${provider}`) })}
        </Button>
      ))}
    </div>
  )
}
