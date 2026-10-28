import { connection } from 'next/server'
import { useTranslations } from 'next-intl'
import { Suspense } from 'react'
import { PageFrame } from '@/components/page-frame'
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
    <PageFrame title={t('title')} lead={t('intro')}>
      {/* SignInOptions also reads `next` from the query string, which is
          request data: the shell above stays prerendered either way. */}
      <div className="max-w-sm pt-4">
        <Suspense fallback={<p className="text-ink-quiet text-meta">{tCommon('loading')}</p>}>
          <ProviderOptions />
        </Suspense>
      </div>
    </PageFrame>
  )
}
