import Link from 'next/link'
import { useTranslations } from 'next-intl'
import type { PathPlacement } from '@/lib/paths/queries'

// Sits inside a row whose title link stretches over it, so the badge link
// lifts above that overlay with its own stacking.
export function PathBadge({ placements }: { placements: PathPlacement[] }) {
  const t = useTranslations('paths')
  const [first, ...more] = placements
  if (!first) return null

  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-ink-quiet text-meta sm:col-start-1">
      <Link
        href={`/p/${first.pathSlug}`}
        className="relative z-10 underline-offset-4 hover:text-ai hover:underline"
      >
        {t('badge', {
          title: first.pathTitle,
          position: first.position,
          total: first.total,
        })}
      </Link>
      {more.length > 0 && (
        <>
          <span aria-hidden="true">{t('badgeMore', { count: more.length })}</span>
          <span className="sr-only">{t('badgeMoreLabel', { count: more.length })}</span>
        </>
      )}
    </p>
  )
}
