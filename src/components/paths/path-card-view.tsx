import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { TierRibbon } from '@/components/tier-ribbon'
import type { PathCard } from '@/lib/paths/queries'
import type { Tier } from '@/lib/run/engine'

export function PathCardView({ card, tier }: { card: PathCard; tier: Tier | null }) {
  const t = useTranslations('paths')

  return (
    <article className="group relative grid gap-y-2 py-5">
      <h2 className="font-bold font-reading text-xl leading-snug tracking-tight">
        <Link
          href={`/p/${card.slug}`}
          className="underline-offset-4 decoration-2 group-hover:text-ai group-hover:underline after:absolute after:inset-0"
        >
          {card.title}
        </Link>
      </h2>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-quiet text-meta">
        <span>{t('stepCount', { count: card.stepCount })}</span>
        {tier && <TierRibbon tier={tier} />}
      </p>
    </article>
  )
}
