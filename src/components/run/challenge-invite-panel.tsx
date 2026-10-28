'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { type FormEvent, useState } from 'react'
import { type StartChallengeResult, startChallengeRunAction } from '@/app/c/[attemptId]/actions'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { RunStart } from '@/lib/run/service'
import { RunPlayer } from './run-player'

type StartErrorCode = Extract<StartChallengeResult, { ok: false }>['error'] | 'unexpected'

type ChallengeInvitePanelProps = {
  attemptId: string
  quizSlug: string
  /** Already resolved to printable copy by getChallenge; free text all the same. */
  opponentName: string
  /** What is left of the original set, which is what this run will play. */
  questionCount: number
  /** Signed-out players name themselves; a signed-in one already has a name. */
  askNickname: boolean
}

// The same shape as RunStartPanel, and for the same reason: the run starts from
// a click and never from a render, because startChallengeRunAction mints the
// guest cookie and Next forbids writing a cookie while rendering.
//
// There is no score on this screen and none in its props. The invite the server
// sends carries none, so there is nothing here to hide — which is the point.
export function ChallengeInvitePanel({
  attemptId,
  quizSlug,
  opponentName,
  questionCount,
  askNickname,
}: ChallengeInvitePanelProps) {
  const t = useTranslations('challenge')
  const tRun = useTranslations('run')
  const tCommon = useTranslations('common')

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
      const result = await startChallengeRunAction({
        attemptId,
        nickname: askNickname ? nickname : undefined,
      })
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

  if (run !== null) {
    return <RunPlayer run={run} quizSlug={quizSlug} challenge={{ opponentName }} />
  }

  // Every question of the original set has since been deleted. Offering a
  // Begin button here would only produce the same answer from the server, so
  // the way on is the quiz itself.
  if (questionCount === 0) {
    return (
      <section className="mx-auto flex w-full max-w-measure flex-col gap-6 py-10 xl:mx-0">
        <div className="flex flex-col gap-3">
          <h2 className="font-reading font-semibold text-title">{t('emptyTitle')}</h2>
          <p className="font-reading text-prose">{t('emptyBody')}</p>
        </div>
        <Link
          href={`/q/${quizSlug}`}
          className={buttonVariants({
            variant: 'outline',
            size: 'lg',
            className: 'h-11 w-full rounded-md text-base sm:w-fit sm:px-8',
          })}
        >
          {t('viewQuiz')}
        </Link>
      </section>
    )
  }

  return (
    <form
      onSubmit={begin}
      className="mx-auto flex w-full max-w-measure flex-1 flex-col justify-center gap-8 py-10 md:py-14 xl:mx-0"
    >
      <div className="flex flex-col gap-3">
        {/* A name a stranger chose, interpolated as text and nothing else. */}
        <h2 className="font-reading font-semibold text-title [overflow-wrap:anywhere]">
          {t('invitedBy', { name: opponentName })}
        </h2>
        <p className="text-ink-quiet text-meta">
          {tCommon('questionCount', { count: questionCount })}
        </p>
        <p className="font-reading text-prose">{t('intro')}</p>
      </div>

      {askNickname && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="nickname">{tRun('nicknameLabel')}</Label>
          <Input
            id="nickname"
            name="nickname"
            value={nickname}
            maxLength={40}
            placeholder={tRun('nicknamePlaceholder')}
            aria-describedby="nickname-hint"
            onChange={(event) => setNickname(event.target.value)}
            className="h-11 max-w-sm rounded-md text-base"
          />
          <p id="nickname-hint" className="text-ink-quiet text-meta">
            {tRun('nicknameHint')}
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
        {starting ? tRun('starting') : t('begin')}
      </Button>
    </form>
  )
}
