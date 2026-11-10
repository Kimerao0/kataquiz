import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { Suspense } from 'react'
import { PageFrame } from '@/components/page-frame'
import { PathCardView } from '@/components/paths/path-card-view'
import { QuizRow } from '@/components/quiz-row'
import { Seal } from '@/components/seal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { pathTier } from '@/lib/paths/progress'
import { getPlacementsForQuizzes, listPaths, type PathCard } from '@/lib/paths/queries'
import { getBestTiers } from '@/lib/quizzes/progress'
import { listPopularTags, PAGE_SIZE, searchQuizzes } from '@/lib/quizzes/search'
import type { Tier } from '@/lib/run/engine'
import { getCurrentUser } from '@/lib/session'

type CatalogSearchParams = Promise<{ [key: string]: string | string[] | undefined }>

export default function CatalogPage({ searchParams }: { searchParams: CatalogSearchParams }) {
  const t = useTranslations('catalog')
  const tCommon = useTranslations('common')

  // The title and the lead are static; the tools and the list are derived from
  // the query string, so each streams in behind its own boundary.
  return (
    <PageFrame
      title={t('title')}
      tools={
        <Suspense fallback={null}>
          <Tools searchParams={searchParams} />
        </Suspense>
      }
    >
      <Suspense fallback={null}>
        <PathsStrip searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<p className="text-ink-quiet text-meta">{tCommon('loading')}</p>}>
        <Results searchParams={searchParams} />
      </Suspense>
    </PageFrame>
  )
}

async function readQuery(searchParams: CatalogSearchParams) {
  const params = await searchParams
  return {
    q: firstValue(params.q),
    tag: firstValue(params.tag),
    page: pageNumber(firstValue(params.page)),
  }
}

// Search and tags live under the title, in the head column, so the spine
// separates what you narrow by from what you narrow.
async function Tools({ searchParams }: { searchParams: CatalogSearchParams }) {
  const { q, tag } = await readQuery(searchParams)
  const t = await getTranslations('catalog')
  const tags = await listPopularTags()

  return (
    <div className="flex flex-col gap-8 pt-4">
      <search>
        <form action="/" className="flex gap-2">
          {tag && <input type="hidden" name="tag" value={tag} />}
          <Input
            name="q"
            defaultValue={q}
            aria-label={t('searchLabel')}
            placeholder={t('searchPlaceholder')}
            className="h-9"
          />
          <Button type="submit" className="h-9 px-4">
            {t('searchSubmit')}
          </Button>
        </form>
      </search>

      {tags.length > 0 && (
        <nav aria-label={t('tagsLabel')} className="flex flex-col gap-2">
          <h2 className="text-ink-quiet text-meta">{t('tagsLabel')}</h2>
          <ul className="flex flex-wrap gap-x-4">
            {tags.map((name) => (
              <li key={name}>
                <Link
                  href={catalogHref({ q, tag: name })}
                  aria-current={name === tag ? 'true' : undefined}
                  className="tag-link"
                >
                  {name}
                </Link>
              </li>
            ))}
          </ul>
          {tag && (
            <Link
              href={catalogHref({ q })}
              className="w-fit py-1 text-meta underline underline-offset-4"
            >
              {t('clearTag')}
            </Link>
          )}
        </nav>
      )}
    </div>
  )
}

async function Results({ searchParams }: { searchParams: CatalogSearchParams }) {
  const { q, tag, page } = await readQuery(searchParams)
  const t = await getTranslations('catalog')
  const { items, total } = await searchQuizzes({ q, tag, page })
  const quizIds = items.map((quiz) => quiz.id)
  const tiers = await viewerTiers(quizIds)
  const placements = await getPlacementsForQuizzes(quizIds)
  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE), 1)

  return (
    <div className="flex flex-col gap-4">
      {items.length === 0 ? (
        <EmptyCatalog filtered={Boolean(q || tag)} />
      ) : (
        <>
          <p className="text-ink-quiet text-meta">{t('resultCount', { count: total })}</p>
          <ul className="divide-y divide-rule border-rule border-y">
            {items.map((quiz) => (
              <li key={quiz.id}>
                <QuizRow
                  quiz={quiz}
                  activeTag={tag}
                  tier={tiers.get(quiz.id)}
                  paths={placements.get(quiz.id) ?? []}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      <Pagination q={q} tag={tag} page={page} lastPage={lastPage} />
    </div>
  )
}

const STRIP_SIZE = 6

// Only the plain catalog gets the strip: page 1, no search, no tag.
async function PathsStrip({ searchParams }: { searchParams: CatalogSearchParams }) {
  const { q, tag, page } = await readQuery(searchParams)
  if (q || tag || page !== 1) return null

  const t = await getTranslations('paths')
  const { items } = await listPaths({ page: 1, pageSize: STRIP_SIZE })
  if (items.length === 0) return null

  const tiers = await viewerTiers(items.flatMap((card) => card.quizIds))

  return (
    <section aria-labelledby="paths-strip-title" className="mb-10 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="paths-strip-title" className="text-ink-quiet text-meta">
          {t('stripTitle')}
        </h2>
        <Link href="/paths" className="py-1 text-meta underline underline-offset-4">
          {t('seeAll')}
        </Link>
      </div>
      <ul className="divide-y divide-rule border-rule border-y">
        {items.map((card) => (
          <li key={card.slug}>
            <PathCardView card={card} tier={cardTier(card, tiers)} headingLevel={3} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function cardTier(card: PathCard, tiers: Map<string, Tier>): Tier | null {
  return pathTier(card.quizIds.map((id) => tiers.get(id) ?? null))
}

// Ribbons are a signed-in player's own record; a visitor gets none and costs
// no query.
async function viewerTiers(quizIds: string[]): Promise<Map<string, Tier>> {
  const viewer = await getCurrentUser()
  if (!viewer) return new Map()
  return getBestTiers(viewer.id, quizIds)
}

function Pagination({
  q,
  tag,
  page,
  lastPage,
}: {
  q?: string
  tag?: string
  page: number
  lastPage: number
}) {
  const t = useTranslations('catalog')
  if (lastPage < 2) return null

  return (
    <nav aria-label={t('paginationLabel')} className="flex items-center gap-6 text-meta">
      {page > 1 && (
        <Link
          href={catalogHref({ q, tag, page: page - 1 })}
          className="py-1 underline underline-offset-4"
        >
          {t('previous')}
        </Link>
      )}
      <span className="text-ink-quiet">{t('pageOf', { page, pages: lastPage })}</span>
      {page < lastPage && (
        <Link
          href={catalogHref({ q, tag, page: page + 1 })}
          className="py-1 underline underline-offset-4"
        >
          {t('next')}
        </Link>
      )}
    </nav>
  )
}

// The two cases need different words and a different next action: one is a
// search that found nothing, the other an empty catalog.
function EmptyCatalog({ filtered }: { filtered: boolean }) {
  const t = useTranslations('catalog')
  const copy = filtered
    ? { title: t('noMatchTitle'), body: t('noMatchBody'), cta: t('noMatchCta'), href: '/' }
    : {
        title: t('noQuizzesTitle'),
        body: t('noQuizzesBody'),
        cta: t('noQuizzesCta'),
        href: '/upload',
      }

  return (
    <div className="flex max-w-measure flex-col items-start gap-3 pt-4">
      <Seal glyph={t('emptySeal')} size="4.5rem" page />
      <h2 className="mt-4 font-extrabold font-reading text-3xl tracking-tight">{copy.title}</h2>
      <p className="font-reading text-ink-quiet">{copy.body}</p>
      <Link href={copy.href} className="w-fit py-1 text-meta underline underline-offset-4">
        {copy.cta}
      </Link>
    </div>
  )
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

const MAX_PAGE = 10_000

function pageNumber(value: string | undefined) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_PAGE ? parsed : 1
}

function catalogHref(params: { q?: string; tag?: string; page?: number }) {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.tag) search.set('tag', params.tag)
  if (params.page && params.page > 1) search.set('page', String(params.page))

  const query = search.toString()
  return query ? `/?${query}` : '/'
}
