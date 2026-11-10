import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { TierRibbon } from '@/components/tier-ribbon'
import { stepStatus } from '@/lib/paths/progress'
import type { LiveStep } from '@/lib/paths/queries'
import type { Tier } from '@/lib/run/engine'

export function PathSteps({
  pathSlug,
  steps,
  tiers,
}: {
  pathSlug: string
  steps: LiveStep[]
  tiers?: Map<string, Tier> | null
}) {
  const t = useTranslations('paths')

  return (
    <ol className="divide-y divide-rule border-rule border-y">
      {steps.map((step) => {
        const tier = tiers?.get(step.quizId)

        return (
          <li key={step.quizId} className="flex items-baseline gap-4 py-3">
            <span aria-hidden="true" className="w-6 shrink-0 text-ink-quiet text-meta">
              {step.position}
            </span>
            <Link
              href={`/q/${step.quizSlug}/run?path=${encodeURIComponent(pathSlug)}`}
              className="font-reading font-semibold text-xl underline-offset-4 hover:text-ai hover:underline"
            >
              {step.quizTitle}
            </Link>
            {tiers && (
              <span className="ml-auto flex shrink-0 items-baseline gap-3 text-meta">
                {tier && <TierRibbon tier={tier} />}
                <span className="text-ink-quiet">{t(`status.${stepStatus(tier ?? null)}`)}</span>
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
