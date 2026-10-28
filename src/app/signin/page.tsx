import { connection } from 'next/server'
import { useTranslations } from 'next-intl'
import { Suspense } from 'react'
import { configuredProviders } from '@/lib/auth'
import { SignInOptions } from './sign-in-options'

// Which providers exist comes from environment variables. Rendering this at
// build time bakes the answer into the prerendered page, so a container given
// its OAuth credentials at start-up would still claim none are configured.
// connection() holds the render until a real request, which is when the
// server process has the environment it will actually run with.
async function ProviderOptions() {
  await connection()
  return <SignInOptions providers={configuredProviders} />
}

export default function SignInPage() {
  const t = useTranslations('signIn')
  const tCommon = useTranslations('common')

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 p-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-bold text-3xl">{t('title')}</h1>
        <p className="opacity-70">{t('intro')}</p>
      </div>
      {/* SignInOptions also reads `next` from the query string, which is
          request data: the shell above stays prerendered either way. */}
      <Suspense fallback={<p className="opacity-70">{tCommon('loading')}</p>}>
        <ProviderOptions />
      </Suspense>
    </main>
  )
}
