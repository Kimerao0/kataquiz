import Link from 'next/link'
import { useTranslations } from 'next-intl'
import type { PathPlacement } from '@/lib/paths/queries'

export function PathNext({ placements }: { placements: PathPlacement[] }) {
  const t = useTranslations('paths')
  if (placements.length === 0) return null

  return (
    <ul className="grid gap-y-2 text-meta">
      {placements.map((placement) => (
        <li key={placement.pathSlug}>
          {placement.next ? (
            <Link
              href={`/q/${placement.next.quizSlug}/run?path=${encodeURIComponent(placement.pathSlug)}`}
              className="underline underline-offset-4 hover:text-ai"
            >
              {t('nextIn', { path: placement.pathTitle, title: placement.next.quizTitle })}
            </Link>
          ) : (
            <Link
              href={`/p/${placement.pathSlug}`}
              className="underline underline-offset-4 hover:text-ai"
            >
              {t('lastStep', { path: placement.pathTitle })}
            </Link>
          )}
        </li>
      ))}
    </ul>
  )
}
