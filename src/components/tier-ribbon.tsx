import { useTranslations } from 'next-intl'
import type { Tier } from '@/lib/run/engine'
import { cn } from '@/lib/utils'

const TIER_COLOR: Record<Tier, string> = {
  gold: 'text-tier-gold',
  silver: 'text-tier-silver',
  bronze: 'text-tier-bronze',
}

// The best tier a player has reached on a quiz. The rosette is decoration and
// hidden from assistive tech; the word beside it carries the tier, so the mark
// is never told apart by colour alone. The compact variant shows only the tier
// name to save room, but a screen reader still hears the full "Your best" sentence.
export function TierRibbon({
  tier,
  variant = 'compact',
}: {
  tier: Tier
  variant?: 'compact' | 'full'
}) {
  const t = useTranslations('common')
  const tierName = t(`tiers.${tier}`)
  const fullLabel = t('tiers.yourBest', { tier: tierName })

  return (
    <span className="inline-flex items-center gap-1.5">
      <svg
        aria-hidden="true"
        viewBox="0 0 16 20"
        fill="currentColor"
        className={cn('h-[1.25em] w-[1em] shrink-0', TIER_COLOR[tier])}
      >
        <path d="M4.5 11.5 3 19l2.5-1.5L7 19.5l1-7.5zM11.5 11.5 13 19l-2.5-1.5L9 19.5l-1-7.5z" />
        <circle cx="8" cy="7" r="6" />
      </svg>
      {variant === 'full' ? (
        <span>{fullLabel}</span>
      ) : (
        <>
          <span aria-hidden="true">{tierName}</span>
          <span className="sr-only">{fullLabel}</span>
        </>
      )}
    </span>
  )
}
