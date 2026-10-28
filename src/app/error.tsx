'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { PageFrame } from '@/components/page-frame'
import { Seal } from '@/components/seal'
import { Button, buttonVariants } from '@/components/ui/button'

// An error boundary has to be a Client Component. It wraps the pages, not the
// root layout, so the header is still there and this page is reachable copy
// rather than Next's default error screen.
//
// Of the two recovery props Next passes, `retry` is the one offered: it
// re-fetches and re-renders the segment, where `reset` only replays the payload
// that failed. The thrown value is deliberately not rendered — from a Server
// Component it is an opaque digest, and from a Client Component it can carry
// details that are ours to log, not the visitor's to read.
export default function AppError({ retry }: { retry: () => void }) {
  const t = useTranslations('errorPage')
  const tCommon = useTranslations('common')

  return (
    <PageFrame seal={<Seal glyph={t('seal')} size="6rem" color="suo" page />} title={t('title')}>
      <div className="flex max-w-measure flex-col items-start gap-6 pt-4">
        <p className="font-reading text-ink-quiet text-prose">{t('body')}</p>
        {/* Wraps on a narrow viewport instead of pushing the second action off
            the edge. */}
        <div className="flex flex-wrap gap-3">
          <Button type="button" size="lg" className="h-12 px-8 text-base" onClick={() => retry()}>
            {tCommon('retry')}
          </Button>
          <Link
            href="/"
            className={buttonVariants({
              variant: 'outline',
              size: 'lg',
              className: 'h-12 px-8 text-base',
            })}
          >
            {t('home')}
          </Link>
        </div>
      </div>
    </PageFrame>
  )
}
