import { screen } from '@testing-library/react'
import { renderWithMessages } from '@/test/intl'
import { TierRibbon } from './tier-ribbon'

const COLORS = ['text-tier-gold', 'text-tier-silver', 'text-tier-bronze'] as const

describe('tier ribbon', () => {
  it.each([
    ['gold', 'text-tier-gold'],
    ['silver', 'text-tier-silver'],
    ['bronze', 'text-tier-bronze'],
  ] as const)('colours the %s rosette with its own tier colour only', (tier, own) => {
    const { container } = renderWithMessages(<TierRibbon tier={tier} />)

    const svg = container.querySelector('svg')
    expect(svg).toHaveClass(own)
    for (const other of COLORS.filter((c) => c !== own)) {
      expect(svg).not.toHaveClass(other)
    }
  })

  it('hides the rosette from assistive tech', () => {
    const { container } = renderWithMessages(<TierRibbon tier="gold" />)

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('shows only the tier name visibly in the compact variant, and speaks the full sentence', () => {
    renderWithMessages(<TierRibbon tier="gold" />)

    const visible = screen.getByText('Gold')
    expect(visible).toHaveAttribute('aria-hidden', 'true')
    const spoken = screen.getByText('Your best: Gold')
    expect(spoken).toHaveClass('sr-only')
    expect(spoken).not.toHaveAttribute('aria-hidden')
  })

  it('shows the full sentence as plain visible text in the full variant', () => {
    renderWithMessages(<TierRibbon tier="silver" variant="full" />)

    const label = screen.getByText('Your best: Silver')
    expect(label).not.toHaveClass('sr-only')
    expect(label).not.toHaveAttribute('aria-hidden')
    expect(screen.queryByText('Silver')).not.toBeInTheDocument()
  })
})
