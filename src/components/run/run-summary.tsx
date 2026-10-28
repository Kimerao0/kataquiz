'use client'

import { CheckCircle2Icon, XCircleIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import type { RunSummary as RunSummaryData } from '@/lib/run/service'
import { cn } from '@/lib/utils'

const COPIED_FEEDBACK_MS = 2000

export function RunSummary({ summary, quizSlug }: { summary: RunSummaryData; quizSlug: string }) {
  const t = useTranslations('run')
  const challengePath = `/c/${summary.attemptId}`

  // The origin is only knowable in the browser. Rendering it straight from
  // `window` would differ between the server pass and the first client one, so
  // the path is shown until an effect can widen it to a full URL.
  const [challengeUrl, setChallengeUrl] = useState(challengePath)
  useEffect(() => {
    setChallengeUrl(new URL(challengePath, window.location.origin).toString())
  }, [challengePath])

  const verdict = summary.passed
    ? { Icon: CheckCircle2Icon, title: t('passed') }
    : { Icon: XCircleIcon, title: t('failed') }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">{t('summaryTitle')}</p>
        {/* Icon and words again: pass or fail must not rest on colour. */}
        <h2
          className={cn(
            'flex items-center gap-2 font-bold text-3xl',
            summary.passed ? 'text-foreground' : 'text-destructive',
          )}
        >
          <verdict.Icon aria-hidden="true" className="size-7" />
          {verdict.title}
        </h2>
        <p className="text-lg">
          {t('score', { score: summary.score, total: summary.total })} &middot;{' '}
          {t('errorCount', { errors: summary.errors })}
        </p>
      </div>

      <Separator />

      <ChallengeLink url={challengeUrl} />

      <div className="flex flex-wrap gap-3">
        <Link href={`/q/${quizSlug}/run`} className={buttonVariants({ size: 'lg' })}>
          {t('playAgain')}
        </Link>
        <Link
          href={`/q/${quizSlug}`}
          className={buttonVariants({ variant: 'outline', size: 'lg' })}
        >
          {t('backToQuiz')}
        </Link>
      </div>
    </section>
  )
}

function ChallengeLink({ url }: { url: string }) {
  const t = useTranslations('run')
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const inputRef = useRef<HTMLInputElement>(null)

  // Without this, navigating away mid-timeout sets state on a gone component.
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timeout.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setState('copied')
      clearTimeout(timeout.current)
      timeout.current = setTimeout(() => setState('idle'), COPIED_FEEDBACK_MS)
    } catch {
      // No clipboard permission, or no clipboard at all. The field below still
      // holds the link, so the dead end is a selection away from being fixed.
      setState('failed')
      inputRef.current?.select()
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-semibold text-lg">{t('shareTitle')}</h3>
      <p className="text-muted-foreground text-sm">{t('shareBody')}</p>
      <Label htmlFor="challenge-link" className="sr-only">
        {t('shareLabel')}
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="challenge-link" ref={inputRef} readOnly value={url} className="sm:flex-1" />
        <Button type="button" onClick={copy}>
          {state === 'copied' ? t('copied') : t('copy')}
        </Button>
      </div>
      {/* Announced rather than silently swapped in, since the button it
          belongs to has already moved on. */}
      <p aria-live="polite" className="text-muted-foreground text-sm">
        {state === 'failed' ? t('copyFailed') : ''}
      </p>
    </div>
  )
}
