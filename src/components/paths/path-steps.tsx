import Link from 'next/link'
import type { LiveStep } from '@/lib/paths/queries'

export function PathSteps({ pathSlug, steps }: { pathSlug: string; steps: LiveStep[] }) {
  return (
    <ol className="divide-y divide-rule border-rule border-y">
      {steps.map((step) => (
        <li key={step.quizId} className="flex items-baseline gap-4 py-3">
          <span aria-hidden="true" className="w-6 text-ink-quiet text-meta">
            {step.position}
          </span>
          <Link
            href={`/q/${step.quizSlug}/run?path=${encodeURIComponent(pathSlug)}`}
            className="font-reading font-semibold text-xl underline-offset-4 hover:text-ai hover:underline"
          >
            {step.quizTitle}
          </Link>
        </li>
      ))}
    </ol>
  )
}
