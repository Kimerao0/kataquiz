import { Compass, LogIn, Upload } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { Suspense } from 'react'
import { Seal } from '@/components/seal'
import { SignOutButton } from '@/components/sign-out-button'
import { ThemeToggle } from '@/components/theme-toggle'
import { getCurrentUser, type SessionUser } from '@/lib/session'

// Quiet by default, full ink on hover: the nav is chrome, not content.
const navLink =
  'inline-flex size-10 whitespace-nowrap items-center justify-center gap-2 text-ink-quiet hover:text-ink sm:size-auto sm:py-1'

// Below sm a nav entry is an icon; the label stays in the DOM as its
// accessible name and returns as visible text from sm up.
function NavLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <>
      {icon}
      <span className="sr-only sm:not-sr-only">{children}</span>
    </>
  )
}

export function SiteHeader() {
  const tCommon = useTranslations('common')
  return (
    <HeaderShell>
      {/* The session is read per request, so it streams in behind this
          boundary instead of holding back the static shell of every page. */}
      <Suspense
        fallback={
          <span className="ms-auto text-ink-quiet max-sm:sr-only">{tCommon('loading')}</span>
        }
      >
        <SessionArea />
      </Suspense>
    </HeaderShell>
  )
}

export function HeaderShell({ children }: { children: ReactNode }) {
  const t = useTranslations('nav')
  const tApp = useTranslations('app')
  const name = tApp('name')

  return (
    <header className="border-rule border-b text-sm">
      {/* Same two columns as .page, so the wordmark sits left of the spine and
          the nav right of it. Below lg it is a single row: wordmark left,
          controls right, labels collapsing to icons on a phone. */}
      <nav
        aria-label={t('label')}
        className="mx-auto flex w-full max-w-(--page-width) items-center justify-between gap-x-3 px-6 py-2 md:px-8 lg:grid lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]"
      >
        <Link href="/" className="wordmark flex w-fit shrink-0 items-center gap-3 py-1">
          <Seal glyph={name.charAt(0)} size="1.75rem" />
          <span className="font-reading font-extrabold text-lg tracking-tight">{name}</span>
        </Link>
        <div className="flex min-w-0 items-center gap-x-1 sm:gap-x-6 lg:ps-[calc(3rem+var(--spine))]">
          <Link href="/" className={navLink}>
            <NavLabel icon={<Compass aria-hidden className="size-5 sm:hidden" />}>
              {t('browse')}
            </NavLabel>
          </Link>
          <Link href="/upload" className={navLink}>
            <NavLabel icon={<Upload aria-hidden className="size-5 sm:hidden" />}>
              {t('upload')}
            </NavLabel>
          </Link>
          {children}
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
        <NavLabel icon={<LogIn aria-hidden className="size-5 sm:hidden" />}>{t('signIn')}</NavLabel>
      </Link>
    )
  }

  return (
    <span className="ms-auto flex min-w-0 items-center gap-1 sm:gap-3">
      {/* Always in the DOM so a screen reader gets the full name; sighted
          users get it truncated from sm up, and not at all on a phone. */}
      <span
        title={user.name}
        className="sr-only text-ink-quiet lg:not-sr-only lg:max-w-48 lg:truncate"
      >
        {t('signedInAs', { name: user.name })}
      </span>
      <SignOutButton />
    </span>
  )
}
