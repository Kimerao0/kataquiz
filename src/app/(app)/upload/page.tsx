import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { Suspense } from 'react'
import { PageFrame } from '@/components/page-frame'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { getCurrentUser } from '@/lib/session'
import { FormatHelp } from './format-help'
import { UploadForm } from './upload-form'

export default function UploadPage() {
  const t = useTranslations('upload')
  const tCommon = useTranslations('common')

  return (
    <PageFrame title={t('title')} lead={t('intro')}>
      <div className="flex max-w-measure flex-col gap-8 pt-4">
        {/* Above the session boundary on purpose: the format does not depend on
            who is asking, so it is part of the static shell and is there for a
            signed-out visitor too. */}
        <FormatHelp />
        {/* The session is read per request, so it cannot be part of the static shell. */}
        <Suspense fallback={<p className="text-ink-quiet text-meta">{tCommon('loading')}</p>}>
          <UploadSection />
        </Suspense>
      </div>
    </PageFrame>
  )
}

async function UploadSection() {
  const user = await getCurrentUser()
  if (user) return <UploadForm />

  const t = await getTranslations('upload')
  return (
    <Alert>
      <AlertTitle>{t('signInTitle')}</AlertTitle>
      <AlertDescription>
        <Link href="/signin?next=/upload">{t('signInCta')}</Link>
      </AlertDescription>
    </Alert>
  )
}
