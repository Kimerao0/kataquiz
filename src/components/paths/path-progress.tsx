import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { TierRibbon } from '@/components/tier-ribbon'
import { buttonVariants } from '@/components/ui/button'
import { continueTarget, pathTier, progressCounts } from '@/lib/paths/progress'
import type { LiveStep } from '@/lib/paths/queries'
import type { Tier } from '@/lib/run/engine'

export function PathProgress({
  pathSlug,
  steps,
  tiers,
}: {
  pathSlug: string
  steps: LiveStep[]
  tiers: Map<string, Tier> | null
}) {
  const t = useTranslations('paths')
  const target = continueTarget(steps, tiers)
  const ribbonTier = tiers && pathTier(steps.map((step) => tiers.get(step.quizId) ?? null))

  return (
    <div className="flex flex-col gap-8">
      {tiers && (
        <div className="flex flex-col gap-2">
          <p className="text-meta">{t('progress', progressCounts(steps, tiers))}</p>
          {ribbonTier && (
            <p className="text-meta">
              <TierRibbon tier={ribbonTier} variant="full" />
            </p>
          )}
        </div>
      )}

      {target && (
        <Link
          href={`/q/${target.step.quizSlug}/run?path=${encodeURIComponent(pathSlug)}`}
          className={buttonVariants({
            size: 'lg',
            className: 'h-12 w-full text-base sm:w-fit sm:px-12',
          })}
        >
          {target.mode === 'perfect' ? t('perfectNext') : t('continue')}
        </Link>
      )}
    </div>
  )
}
