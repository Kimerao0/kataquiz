import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Suspense } from 'react'
import { Seal } from '@/components/seal'
import { SignOutButton } from '@/components/sign-out-button'
import { ThemeToggle } from '@/components/theme-toggle'
import { getCurrentUser, type SessionUser } from '@/lib/session'

// Quiet by default, full ink on hover: the nav is chrome, not content.
const navLink = 'py-1 text-ink-quiet hover:text-ink'

export function SiteHeader() {
  const t = useTranslations('nav')
  const tApp = useTranslations('app')
  const tCommon = useTranslations('common')
  const name = tApp('name')

  return (
    <header className="border-rule border-b text-sm">
      {/* Same two columns as .page, so the wordmark sits left of the spine and
          the nav right of it. Below lg it wraps instead of scrolling: the
          session area drops onto its own line rather than pushing links off. */}
      <nav
        aria-label={t('label')}
        className="mx-auto grid w-full max-w-(--page-width) gap-y-1 px-6 py-3 md:px-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:items-center"
      >
        <Link href="/" className="wordmark flex w-fit items-center gap-3 py-1">
          <Seal glyph={name.charAt(0)} size="1.75rem" />
          <span className="font-reading font-extrabold text-lg tracking-tight">{name}</span>
        </Link>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 lg:ps-[calc(3rem+var(--spine))]">
          <Link href="/" className={navLink}>
            {t('browse')}
          </Link>
          <Link href="/upload" className={navLink}>
            {t('upload')}
          </Link>
          {/* The session is read per request, so it streams in behind this
              boundary instead of holding back the static shell of every page. */}
          <Suspense fallback={<span className="ms-auto text-ink-quiet">{tCommon('loading')}</span>}>
            <SessionArea />
          </Suspense>
          <ThemeToggle />
        </div>
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
      <Link href="/signin" className={`${navLink} ms-auto`}>
        {t('signIn')}
      </Link>
    )
  }

  return (
    <span className="ms-auto flex items-center gap-3">
      <span className="text-ink-quiet">{t('signedInAs', { name: user.name })}</span>
      <SignOutButton />
    </span>
  )
}
