import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Suspense } from 'react'
import { SignOutButton } from '@/components/sign-out-button'
import { getCurrentUser, type SessionUser } from '@/lib/session'

export function SiteHeader() {
  const t = useTranslations('nav')
  const tApp = useTranslations('app')
  const tCommon = useTranslations('common')

  return (
    <header className="border-border border-b">
      {/* Wraps instead of scrolling: on a narrow viewport the session area
          drops onto its own line rather than pushing the links off-screen. */}
      <nav
        aria-label={t('label')}
        className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 p-4"
      >
        <Link href="/" className="font-bold font-heading text-lg">
          {tApp('name')}
        </Link>
        <Link href="/">{t('browse')}</Link>
        <Link href="/upload">{t('upload')}</Link>
        {/* The session is read per request, so it streams in behind this
            boundary instead of holding back the static shell of every page. */}
        <Suspense fallback={<span className="ms-auto opacity-70">{tCommon('loading')}</span>}>
          <SessionArea />
        </Suspense>
      </nav>
    </header>
  )
}

async function SessionArea() {
  const user = await getCurrentUser()
  return <SessionNav user={user} />
}

// Split out from the async wrapper above so the signed-in and signed-out
// renderings can be exercised without a request or a database.
export function SessionNav({ user }: { user: SessionUser | null }) {
  const t = useTranslations('nav')

  if (!user) {
    return (
      <Link href="/signin" className="ms-auto">
        {t('signIn')}
      </Link>
    )
  }

  return (
    <span className="ms-auto flex items-center gap-3">
      <span className="opacity-70">{t('signedInAs', { name: user.name })}</span>
      <SignOutButton />
    </span>
  )
}
