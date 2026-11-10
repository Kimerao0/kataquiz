import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { TierRibbon } from '@/components/tier-ribbon'
import type { PathCard } from '@/lib/paths/queries'
import type { Tier } from '@/lib/run/engine'

export function PathCardView({
  card,
  tier,
  headingLevel = 2,
}: {
  card: PathCard
  tier: Tier | null
  headingLevel?: 2 | 3
}) {
  const t = useTranslations('paths')
  const Heading = headingLevel === 3 ? 'h3' : 'h2'

  return (
    <article className="group relative grid gap-y-2 py-5">
      <Heading className="font-bold font-reading text-xl leading-snug tracking-tight">
        <Link
          href={`/p/${card.slug}`}
          className="underline-offset-4 decoration-2 group-hover:text-ai group-hover:underline after:absolute after:inset-0"
        >
          {card.title}
        </Link>
      </Heading>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-quiet text-meta">
        <span>{t('stepCount', { count: card.stepCount })}</span>
        {tier && <TierRibbon tier={tier} />}
      </p>
    </article>
  )
}
