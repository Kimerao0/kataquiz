import type { Metadata } from 'next'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { Suspense } from 'react'
import { PageFrame } from '@/components/page-frame'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  getMistakeSummaries,
  getMistakeTags,
  type MistakeSummary,
  parseMistakesTag,
} from '@/lib/mistakes/mistakes'
import { getCurrentUser } from '@/lib/session'

type MistakesSearchParams = Promise<{ [key: string]: string | string[] | undefined }>

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('mistakes')
  return { title: t('title'), robots: { index: false } }
}

export default function MistakesPage({ searchParams }: { searchParams: MistakesSearchParams }) {
  const t = useTranslations('mistakes')
  const tCommon = useTranslations('common')

  return (
    <PageFrame title={t('title')} lead={t('intro')}>
      <div className="flex max-w-measure flex-col gap-8 pt-4">
        {/* The session and the query string are read per request, so neither
            can be part of the static shell. */}
        <Suspense fallback={<p className="text-ink-quiet text-meta">{tCommon('loading')}</p>}>
          <MistakesSection searchParams={searchParams} />
        </Suspense>
      </div>
    </PageFrame>
  )
}

async function MistakesSection({ searchParams }: { searchParams: MistakesSearchParams }) {
  const user = await getCurrentUser()
  if (!user) return <SignInPrompt />

  const params = await searchParams
  const tag = parseMistakesTag(params.tag)
  const [mistakes, tags] = await Promise.all([
    getMistakeSummaries(user.id, { tag }),
    getMistakeTags(user.id),
  ])

  return (
    <>
      {(tags.length > 0 || tag) && <TagFilter tags={tags} current={tag} />}
      <MistakesBody mistakes={mistakes} tag={tag} />
    </>
  )
}

function MistakesBody({ mistakes, tag }: { mistakes: MistakeSummary[]; tag: string | null }) {
  if (mistakes.length > 0) return <MistakeList mistakes={mistakes} tag={tag} />
  if (tag) return <EmptyTag tag={tag} />
  return <EmptyMistakes />
}

async function SignInPrompt() {
  const t = await getTranslations('mistakes')
  return (
    <Alert>
      <AlertTitle>{t('signInTitle')}</AlertTitle>
      <AlertDescription>
        <Link href="/signin?next=/mistakes">{t('signInCta')}</Link>
      </AlertDescription>
    </Alert>
  )
}

function TagFilter({ tags, current }: { tags: string[]; current: string | null }) {
  const t = useTranslations('mistakes')

  return (
    <nav aria-label={t('tagsLabel')} className="flex flex-col gap-2">
      <h2 className="text-ink-quiet text-meta">{t('tagsLabel')}</h2>
      <ul className="flex flex-wrap gap-x-4">
        <li>
          <Link
            href={withTag('/mistakes', null)}
            aria-current={current === null ? 'page' : undefined}
            className="tag-link"
          >
            {t('allTags')}
          </Link>
        </li>
        {tags.map((name) => (
          <li key={name}>
            <Link
              href={withTag('/mistakes', name)}
              aria-current={name === current ? 'page' : undefined}
              className="tag-link"
            >
              {name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function MistakeList({ mistakes, tag }: { mistakes: MistakeSummary[]; tag: string | null }) {
  const t = useTranslations('mistakes')

  return (
    <div className="flex flex-col gap-4">
      <p className="flex flex-wrap gap-x-5 text-ink-quiet text-meta">
        <span>{t('count', { count: mistakes.length })}</span>
        {/* A plain anchor: the export is a file from a route handler, not a
            page to navigate to client-side. */}
        <a
          href={withTag('/mistakes/export', tag)}
          download
          className="underline underline-offset-4 hover:text-ink"
        >
          {t('download')}
        </a>
      </p>

      <ol aria-label={t('listLabel')} className="divide-y divide-rule border-rule border-y">
        {mistakes.map((mistake) => (
          <MistakeRow key={mistake.questionId} mistake={mistake} />
        ))}
      </ol>
    </div>
  )
}

// Which option was right is left out on purpose: this list is for recalling
// the answer, not reading it off.
function MistakeRow({ mistake }: { mistake: MistakeSummary }) {
  const t = useTranslations('mistakes')

  return (
    <li className="flex flex-col gap-2 py-4">
      <p className="line-clamp-3 font-reading text-prose">{mistake.prompt}</p>
      <p className="flex flex-wrap gap-x-5 text-ink-quiet text-meta">
        <span>{mistake.quizTitle}</span>
        <span>{t('timesWrong', { count: mistake.timesWrong })}</span>
      </p>
    </li>
  )
}

function EmptyMistakes() {
  const t = useTranslations('mistakes')

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="font-reading text-ink-quiet">{t('empty')}</p>
      <Link href="/" className="w-fit py-1 text-meta underline underline-offset-4">
        {t('emptyCta')}
      </Link>
    </div>
  )
}

// A filter that matches nothing is not the same as having nothing to review,
// so it says which tag came up empty and offers the way back.
function EmptyTag({ tag }: { tag: string }) {
  const t = useTranslations('mistakes')

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="font-reading text-ink-quiet">{t('emptyTag', { tag })}</p>
      <Link href="/mistakes" className="w-fit py-1 text-meta underline underline-offset-4">
        {t('showAll')}
      </Link>
    </div>
  )
}

function withTag(path: string, tag: string | null) {
  if (!tag) return path
  return `${path}?${new URLSearchParams({ tag })}`
}
