import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { Suspense } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { getCurrentUser } from '@/lib/session'
import { FormatHelp } from './format-help'
import { UploadForm } from './upload-form'

export default function UploadPage() {
  const t = useTranslations('upload')
  const tCommon = useTranslations('common')

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-bold text-3xl">{t('title')}</h1>
        <p className="opacity-70">{t('intro')}</p>
      </div>
      {/* Above the session boundary on purpose: the format does not depend on
          who is asking, so it is part of the static shell and is there for a
          signed-out visitor too. */}
      <FormatHelp />
      {/* The session is read per request, so it cannot be part of the static shell. */}
      <Suspense fallback={<p className="opacity-70">{tCommon('loading')}</p>}>
        <UploadSection />
      </Suspense>
    </main>
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
