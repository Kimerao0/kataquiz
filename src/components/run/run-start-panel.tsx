'use client'

import { useTranslations } from 'next-intl'
import { type FormEvent, useState } from 'react'
import { type StartRunResult, startRunAction } from '@/app/(app)/q/[slug]/actions'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { RunStart } from '@/lib/run/service'
import { RunPlayer } from './run-player'

type StartErrorCode = Extract<StartRunResult, { ok: false }>['error'] | 'unexpected'

type RunStartPanelProps = {
  slug: string
  questionsPerRun: number
  maxErrors: number
  timePerQuestionSec: number | null
  /** Signed-out players name themselves; a signed-in one already has a name. */
  askNickname: boolean
}

// The run is started from a click and never from a render: startRunAction mints
// the guest cookie, and Next forbids writing a cookie while rendering. That is
// the whole reason this panel exists instead of the page auto-starting.
export function RunStartPanel({
  slug,
  questionsPerRun,
  maxErrors,
  timePerQuestionSec,
  askNickname,
}: RunStartPanelProps) {
  const t = useTranslations('run')
  const tQuiz = useTranslations('quiz')

  const [run, setRun] = useState<RunStart | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<StartErrorCode | null>(null)
  const [nickname, setNickname] = useState('')

  async function begin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (starting) return

    setStarting(true)
    setError(null)
    try {
      const result = await startRunAction({ slug, nickname: askNickname ? nickname : undefined })
      if (result.ok) {
        // Left mounted and starting stays true: the panel is about to be
        // replaced by the run, so the button must not flicker back to idle.
        setRun(result.run)
        return
      }
      setError(result.error)
    } catch {
      setError('unexpected')
    }
    setStarting(false)
  }

  if (run !== null) return <RunPlayer run={run} quizSlug={slug} />

  const settings =
    timePerQuestionSec === null
      ? tQuiz('runSettingsUntimed', { questions: questionsPerRun, errors: maxErrors })
      : tQuiz('runSettings', {
          questions: questionsPerRun,
          errors: maxErrors,
          seconds: timePerQuestionSec,
        })

  return (
    <form
      onSubmit={begin}
      className="mx-auto flex w-full max-w-measure flex-1 flex-col justify-center gap-8 py-10 md:py-14"
    >
      <div className="flex flex-col gap-3">
        <h2 className="font-reading font-semibold text-title">{t('title')}</h2>
        <p className="text-ink-quiet text-meta">{settings}</p>
      </div>

      {askNickname && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="nickname">{t('nicknameLabel')}</Label>
          <Input
            id="nickname"
            name="nickname"
            value={nickname}
            maxLength={40}
            placeholder={t('nicknamePlaceholder')}
            aria-describedby="nickname-hint"
            onChange={(event) => setNickname(event.target.value)}
            className="h-11 max-w-sm rounded-md text-base"
          />
          <p id="nickname-hint" className="text-ink-quiet text-meta">
            {t('nicknameHint')}
          </p>
        </div>
      )}

      {error !== null && (
        <Alert variant="destructive">
          <AlertTitle>{t('startErrorTitle')}</AlertTitle>
          {/* The retry is the Begin button itself, which stays enabled. */}
          <AlertDescription>{t(`startErrors.${error}`)}</AlertDescription>
        </Alert>
      )}

      <Button
        type="submit"
        size="lg"
        disabled={starting}
        className="h-12 w-full rounded-md text-base sm:w-fit sm:px-10"
      >
        {starting ? t('starting') : t('begin')}
      </Button>
    </form>
  )
}
