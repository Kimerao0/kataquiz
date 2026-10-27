import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { Suspense } from 'react'
import { QuizCard } from '@/components/quiz-card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { badgeVariants } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { listPopularTags, PAGE_SIZE, searchQuizzes } from '@/lib/quizzes/search'

type CatalogSearchParams = Promise<{ [key: string]: string | string[] | undefined }>

export default function CatalogPage({ searchParams }: { searchParams: CatalogSearchParams }) {
  const t = useTranslations('catalog')
  const tCommon = useTranslations('common')

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-bold text-3xl">{t('title')}</h1>
        <p className="opacity-70">{t('intro')}</p>
      </div>
      {/* Everything below is derived from the query string, so it streams in at
          request time and the heading above stays in the static shell. */}
      <Suspense fallback={<p className="opacity-70">{tCommon('loading')}</p>}>
        <Catalog searchParams={searchParams} />
      </Suspense>
    </main>
  )
}

async function Catalog({ searchParams }: { searchParams: CatalogSearchParams }) {
  const params = await searchParams
  const q = firstValue(params.q)
  const tag = firstValue(params.tag)
  const page = pageNumber(firstValue(params.page))

  const t = await getTranslations('catalog')
  const [{ items, total }, tags] = await Promise.all([
    searchQuizzes({ q, tag, page }),
    listPopularTags(),
  ])
  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE), 1)

  return (
    <div className="flex flex-col gap-6">
      <form action="/" className="flex gap-2">
        <Input
          name="q"
          defaultValue={q}
          aria-label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
        />
        <Button type="submit">{t('searchSubmit')}</Button>
      </form>

      {tags.length > 0 && (
        <nav aria-label={t('tagsLabel')} className="flex flex-wrap gap-2">
          {tags.map((name) => (
            <Link
              key={name}
              href={catalogHref({ q, tag: name })}
              className={badgeVariants({ variant: name === tag ? 'default' : 'outline' })}
            >
              {name}
            </Link>
          ))}
        </nav>
      )}

      {items.length === 0 ? (
        <EmptyCatalog filtered={Boolean(q || tag)} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {items.map((quiz) => (
            <li key={quiz.id}>
              <QuizCard quiz={quiz} />
            </li>
          ))}
        </ul>
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
    <nav aria-label={t('paginationLabel')} className="flex items-center gap-4">
      {page > 1 && <Link href={catalogHref({ q, tag, page: page - 1 })}>{t('previous')}</Link>}
      <span className="opacity-70">{t('pageOf', { page, pages: lastPage })}</span>
      {page < lastPage && <Link href={catalogHref({ q, tag, page: page + 1 })}>{t('next')}</Link>}
    </nav>
  )
}

// The two cases need different words and a different next action: one is a
// search that found nothing, the other an empty catalog.
function EmptyCatalog({ filtered }: { filtered: boolean }) {
  const t = useTranslations('catalog')

  if (filtered) {
    return (
      <Alert>
        <AlertTitle>{t('noMatchTitle')}</AlertTitle>
        <AlertDescription>
          {t('noMatchBody')} <Link href="/">{t('noMatchCta')}</Link>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert>
      <AlertTitle>{t('noQuizzesTitle')}</AlertTitle>
      <AlertDescription>
        {t('noQuizzesBody')} <Link href="/upload">{t('noQuizzesCta')}</Link>
      </AlertDescription>
    </Alert>
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
