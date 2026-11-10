import Link from 'next/link'
import { useTranslations } from 'next-intl'
import type { PathPlacement } from '@/lib/paths/queries'

export function PathPlacements({ placements }: { placements: PathPlacement[] }) {
  const t = useTranslations('paths')
  if (placements.length === 0) return null

  return (
    <ul className="grid gap-y-3 text-meta">
      {placements.map((placement) => {
        const runHref = (quizSlug: string) =>
          `/q/${quizSlug}/run?path=${encodeURIComponent(placement.pathSlug)}`

        return (
          <li key={placement.pathSlug} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <Link
              href={`/p/${placement.pathSlug}`}
              className="underline-offset-4 hover:text-ai hover:underline"
            >
              {t('placement', {
                position: placement.position,
                total: placement.total,
                title: placement.pathTitle,
              })}
            </Link>
            {placement.previous && (
              <Link
                href={runHref(placement.previous.quizSlug)}
                className="text-ink-quiet underline-offset-4 hover:text-ink hover:underline"
              >
                {t('previous', { title: placement.previous.quizTitle })}
              </Link>
            )}
            {placement.next && (
              <Link
                href={runHref(placement.next.quizSlug)}
                className="text-ink-quiet underline-offset-4 hover:text-ink hover:underline"
              >
                {t('next', { title: placement.next.quizTitle })}
              </Link>
            )}
          </li>
        )
      })}
    </ul>
  )
}
