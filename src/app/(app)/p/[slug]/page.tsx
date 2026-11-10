import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { cache, Suspense } from 'react'
import { PageFrame } from '@/components/page-frame'
import { PathProgress } from '@/components/paths/path-progress'
import { PathSteps } from '@/components/paths/path-steps'
import { getPathProgress } from '@/lib/paths/progress'
import { getPath } from '@/lib/paths/queries'
import { getCurrentUser } from '@/lib/session'

type PathParams = Promise<{ slug: string }>

// generateMetadata and the page below both need the path; cache collapses the
// two reads into one query per request.
const loadPath = cache((slug: string) => getPath(slug))

export async function generateMetadata({ params }: { params: PathParams }): Promise<Metadata> {
  const { slug } = await params
  const path = await loadPath(slug)
  if (!path) return {}

  return { title: path.title, description: path.description ?? undefined }
}

export default function PathPage({ params }: { params: PathParams }) {
  const t = useTranslations('common')

  return (
    // The slug is request data, so the path streams in below the shell.
    <Suspense
      fallback={
        <PageFrame>
          <p className="pt-4 text-ink-quiet text-meta">{t('loading')}</p>
        </PageFrame>
      }
    >
      <PathDetailView params={params} />
    </Suspense>
  )
}

async function PathDetailView({ params }: { params: PathParams }) {
  const { slug } = await params
  const path = await loadPath(slug)
  if (!path) notFound()

  const t = await getTranslations('paths')
  const tQuiz = await getTranslations('quiz')
  const tCatalog = await getTranslations('catalog')
  // A path outlives its author's account, so the byline has to stand in for one.
  const authorName = path.authorName ?? tCatalog('deletedAuthor')
  const viewer = await getCurrentUser()
  // Only a signed-in player has progress; a guest costs no query.
  const tiers = viewer ? await getPathProgress(viewer.id, path.steps) : null

  return (
    <PageFrame
      title={path.title}
      userTitle
      lead={null}
      tools={
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-ink-quiet text-meta">
          <p>{tQuiz('author', { name: authorName })}</p>
          <p>{t('stepCount', { count: path.steps.length })}</p>
        </div>
      }
    >
      <div className="flex max-w-measure flex-col gap-8 pt-4">
        {path.description && <p className="font-reading text-prose">{path.description}</p>}

        {path.steps.length > 0 ? (
          <>
            <PathProgress pathSlug={path.slug} steps={path.steps} tiers={tiers} />
            <PathSteps pathSlug={path.slug} steps={path.steps} tiers={tiers} />
          </>
        ) : (
          <p className="text-ink-quiet">{t('emptyBody')}</p>
        )}
      </div>
    </PageFrame>
  )
}
