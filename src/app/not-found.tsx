import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { PageFrame } from '@/components/page-frame'
import { Seal } from '@/components/seal'
import { buttonVariants } from '@/components/ui/button'

// One page serves every 404: a challenge link whose run was abandoned, an
// attempt id that never existed, a quiz its author has hidden, and a typo. The
// visitor is told what probably happened rather than which of the four it was,
// because the server deliberately does not tell them apart either.
//
// It renders inside the root layout, so the header — and with it the way back
// to the catalog — is still on the page.
export default function NotFound() {
  const t = useTranslations('notFound')

  return (
    <PageFrame seal={<Seal glyph={t('seal')} size="6rem" color="suo" page />} title={t('title')}>
      <div className="flex max-w-measure flex-col items-start gap-6 pt-4">
        <p className="font-reading text-ink-quiet text-prose">{t('body')}</p>
        <Link href="/" className={buttonVariants({ size: 'lg', className: 'h-12 px-8 text-base' })}>
          {t('cta')}
        </Link>
      </div>
    </PageFrame>
  )
}
