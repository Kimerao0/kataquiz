import { useTranslations } from 'next-intl'
import { Suspense } from 'react'
import { configuredProviders } from '@/lib/auth'
import { SignInOptions } from './sign-in-options'

export default function SignInPage() {
  const t = useTranslations('signIn')
  const tCommon = useTranslations('common')

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 p-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-bold text-3xl">{t('title')}</h1>
        <p className="opacity-70">{t('intro')}</p>
      </div>
      {/* SignInOptions reads `next` from the query string, which is request
          data: without this boundary the shell above cannot be prerendered. */}
      <Suspense fallback={<p className="opacity-70">{tCommon('loading')}</p>}>
        <SignInOptions providers={configuredProviders} />
      </Suspense>
    </main>
  )
}
