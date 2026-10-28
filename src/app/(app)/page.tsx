import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { Suspense } from 'react'
import { PageFrame } from '@/components/page-frame'
import { QuizRow } from '@/components/quiz-row'
import { Seal } from '@/components/seal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { listPopularTags, PAGE_SIZE, searchQuizzes } from '@/lib/quizzes/search'

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
                <QuizRow quiz={quiz} activeTag={tag} />
              </li>
            ))}
          </ul>
        </>
      )}

      <Pagination q={q} tag={tag} page={page} lastPage={lastPage} />
    </div>
  )
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

function pageNumber(value: string | undefined) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

function catalogHref(params: { q?: string; tag?: string; page?: number }) {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.tag) search.set('tag', params.tag)
  if (params.page && params.page > 1) search.set('page', String(params.page))

  const query = search.toString()
  return query ? `/?${query}` : '/'
}
