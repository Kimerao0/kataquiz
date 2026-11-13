'use client'

import { Menu } from '@base-ui/react/menu'
import { BookX, ChevronDown, LogOut } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { httpUrlOrNull } from '@/components/run/safe-url'
import { signOut } from '@/lib/auth-client'

// Quiet like the nav links beside it; full ink while hovered or open. A 40px
// tap target on a phone, the monogram alone; the chevron joins from sm and
// the (truncated) name from lg. The full name always lives in aria-label.
const trigger =
  'ms-auto inline-flex size-10 min-w-0 items-center justify-center gap-2 rounded-sm text-ink-quiet hover:text-ink data-popup-open:text-ink sm:size-auto sm:py-1'

// Paper and a hairline, like the page under it: no lifted card, no heavy
// shadow. The fade runs only when the user has not asked for less motion.
const popup =
  'min-w-48 origin-(--transform-origin) rounded-lg border border-rule bg-paper py-1 text-sm text-ink-quiet outline-none data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-safe:transition-[opacity,scale] motion-safe:duration-150'

// Keyboard focus moves onto the items, so the app-wide focus ring lands here
// too; it is inset so the popup border does not clip it.
const item =
  'flex w-full cursor-default select-none items-center gap-2 px-3 py-2 text-ink-quiet focus-visible:-outline-offset-3! data-disabled:opacity-50 data-highlighted:bg-muted data-highlighted:text-ink'

export function AccountMenu({ name, image }: { name: string; image: string | null }) {
  const t = useTranslations('nav')
  const signOutState = useSignOut()

  // Any open or close drops a stale failure, including one that landed after
  // the menu was dismissed mid-attempt.
  return (
    <Menu.Root onOpenChange={signOutState.clearFailure}>
      <Menu.Trigger aria-label={t('account', { name })} title={name} className={trigger}>
        <Monogram key={image ?? ''} name={name} image={image} />
        <span className="hidden truncate lg:block lg:max-w-32 xl:max-w-48">{name}</span>
        <ChevronDown aria-hidden className="hidden size-4 shrink-0 sm:block" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={6} className="z-50">
          <Menu.Popup className={popup}>
            {/* Who is signed in, as plain text: not an item, so the keyboard
                skips it. Truncated, with the whole name in the tooltip. */}
            <div title={name} className="max-w-64 truncate px-3 py-2 text-ink-quiet">
              {name}
            </div>
            <Menu.Separator className={separator} />
            <Menu.LinkItem closeOnClick render={<Link href="/mistakes" />} className={item}>
              <BookX aria-hidden className="size-4 shrink-0" />
              {t('mistakes')}
            </Menu.LinkItem>
            <Menu.Separator className={separator} />
            <SignOutItem pending={signOutState.pending} onSignOut={signOutState.run} />
            <div aria-live="polite">
              {signOutState.failed && (
                <p className="max-w-64 px-3 pt-1 pb-2 text-suo text-xs">{t('signOutFailed')}</p>
              )}
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

const separator = 'my-1 h-px bg-rule'

// The avatar when the provider gave one and it loads; otherwise the first
// letter on a neutral disc. Decorative either way: the trigger's label names
// the user. Keyed on the image URL by the caller, so a new URL starts unbroken.
function Monogram({ name, image }: { name: string; image: string | null }) {
  const [broken, setBroken] = useState(false)
  const src = httpUrlOrNull(image)

  if (!src || broken) {
    return (
      <span
        aria-hidden
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-ink text-xs"
      >
        {initialOf(name)}
      </span>
    )
  }

  return (
    // biome-ignore lint/performance/noImgElement: provider-supplied remote avatar URL
    <img
      src={src}
      alt=""
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className="size-6 shrink-0 rounded-full object-cover"
    />
  )
}

function initialOf(name: string) {
  const first = Array.from(name.trim())[0]
  if (!first) return '?'
  return first.toUpperCase()
}

// better-auth's client resolves { data, error } rather than throwing; a
// network failure can still reject, so both count as a failed sign-out.
async function attemptSignOut() {
  try {
    const result = await signOut()
    return !result?.error
  } catch {
    return false
  }
}

function useSignOut() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  async function run() {
    setFailed(false)
    setPending(true)
    const ok = await attemptSignOut()
    setPending(false)
    if (!ok) {
      setFailed(true)
      return
    }
    // The header is rendered on the server, so the signed-out state only
    // appears once the route is re-fetched.
    router.refresh()
  }

  function clearFailure() {
    setFailed(false)
  }

  return { pending, failed, run, clearFailure }
}

// Stays open while signing out, so the pending label is actually seen and a
// failure can be reported in place; on success the refresh replaces the whole
// menu with the sign-in link.
function SignOutItem({ pending, onSignOut }: { pending: boolean; onSignOut: () => void }) {
  const t = useTranslations('nav')
  const label = pending ? t('signingOut') : t('signOut')

  return (
    <Menu.Item closeOnClick={false} disabled={pending} onClick={onSignOut} className={item}>
      <LogOut aria-hidden className="size-4 shrink-0" />
      {label}
    </Menu.Item>
  )
}
