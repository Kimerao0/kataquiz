import Link from 'next/link'
import { useTranslations } from 'next-intl'
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
    <main className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 p-8">
      <h1 className="font-bold text-3xl">{t('title')}</h1>
      <p className="text-muted-foreground">{t('body')}</p>
      <Link href="/" className={buttonVariants({ size: 'lg' })}>
        {t('cta')}
      </Link>
    </main>
  )
}
