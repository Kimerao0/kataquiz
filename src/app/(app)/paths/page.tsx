import type { Metadata } from 'next'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { Suspense } from 'react'
import { PageFrame } from '@/components/page-frame'
import { PathCardView } from '@/components/paths/path-card-view'
import { pathTier } from '@/lib/paths/progress'
import { listPaths, type PathCard } from '@/lib/paths/queries'
import { getBestTiers } from '@/lib/quizzes/progress'
import { PAGE_SIZE } from '@/lib/quizzes/search'
import type { Tier } from '@/lib/run/engine'
import { getCurrentUser } from '@/lib/session'

type PathsSearchParams = Promise<{ [key: string]: string | string[] | undefined }>

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('paths')

  return { title: t('listTitle') }
}

export default function PathsPage({ searchParams }: { searchParams: PathsSearchParams }) {
  const t = useTranslations('paths')
  const tCommon = useTranslations('common')

  return (
    <PageFrame title={t('listTitle')}>
      <Suspense fallback={<p className="text-ink-quiet text-meta">{tCommon('loading')}</p>}>
        <PathList searchParams={searchParams} />
      </Suspense>
    </PageFrame>
  )
}

async function PathList({ searchParams }: { searchParams: PathsSearchParams }) {
  const params = await searchParams
  const page = pageNumber(firstValue(params.page))
  const t = await getTranslations('paths')
  const { items, total } = await listPaths({ page, pageSize: PAGE_SIZE })
  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE), 1)

  if (items.length === 0) {
    return <p className="font-reading text-ink-quiet">{t('listEmpty')}</p>
  }

  const tiers = await viewerTiers(items.flatMap((card) => card.quizIds))

  return (
    <div className="flex flex-col gap-4">
      <ul className="divide-y divide-rule border-rule border-y">
        {items.map((card) => (
          <li key={card.slug}>
            <PathCardView card={card} tier={cardTier(card, tiers)} />
          </li>
        ))}
      </ul>

      <Pagination page={page} lastPage={lastPage} />
    </div>
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

function Pagination({ page, lastPage }: { page: number; lastPage: number }) {
  const t = useTranslations('catalog')
  if (lastPage < 2) return null

  return (
    <nav aria-label={t('paginationLabel')} className="flex items-center gap-6 text-meta">
      {page > 1 && (
        <Link href={pathsHref(page - 1)} className="py-1 underline underline-offset-4">
          {t('previous')}
        </Link>
      )}
      <span className="text-ink-quiet">{t('pageOf', { page, pages: lastPage })}</span>
      {page < lastPage && (
        <Link href={pathsHref(page + 1)} className="py-1 underline underline-offset-4">
          {t('next')}
        </Link>
      )}
    </nav>
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

function pathsHref(page: number) {
  return page > 1 ? `/paths?page=${page}` : '/paths'
}
