'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { type SubmitResult, submitAnswerAction } from '@/app/(app)/q/[slug]/actions'
import { fetchChallengeComparisonAction } from '@/app/c/[attemptId]/actions'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { AnswerResult, PublicQuestion, RunStart, RunSummary } from '@/lib/run/service'
import { FeedbackPanel } from './feedback-panel'
import { QuestionCard } from './question-card'
import { QuestionTimer } from './question-timer'
import { type ComparisonState, RunSummary as RunSummaryPanel } from './run-summary'

type SubmitErrorCode = Extract<SubmitResult, { ok: false }>['error']

// A failed submission is either worth retrying or it is a dead end, and the two
// need different offers: a button that replays the same request, or a way out.
type Failure = { retryable: true } | { retryable: false; code: SubmitErrorCode }

type Attempt = { optionIds: string[]; elapsedMs: number }

/**
 * How long option input is ignored after the run moves to the next question.
 * The Next button sits where an option is about to be, so the second click of a
 * double click — or a fast second tap — would otherwise answer a question the
 * player has not read yet. Long enough to swallow that, short enough that a
 * player who is actually reading never meets it.
 */
export const ADVANCE_LOCK_MS = 300

type RunPlayerProps = {
  run: RunStart
  quizSlug: string
  /**
   * Set only when this run answers a challenge. The opponent's name is already
   * public — it was on the invite — while their score is not, and is asked for
   * only once the final answer has landed.
   */
  challenge?: { opponentName: string }
}

export function RunPlayer({ run, quizSlug, challenge }: RunPlayerProps) {
  const t = useTranslations('run')
  const tCommon = useTranslations('common')

  const [question, setQuestion] = useState<PublicQuestion>(run.question)
  const [position, setPosition] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [feedback, setFeedback] = useState<AnswerResult | null>(null)
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [startedAt, setStartedAt] = useState(() => Date.now())
  // Undefined for an ordinary run, which is what keeps the summary identical
  // to the one it renders today.
  const [comparison, setComparison] = useState<ComparisonState | undefined>(undefined)
  // Once the clock has run out for a question it stays out, so a failed
  // auto-submit cannot restart the timer and fire itself again.
  const [expired, setExpired] = useState(false)
  // Set when the run advances and cleared by the timer below, which is the one
  // way out of it: a player who waits is never blocked, and unmounting during
  // the wait cannot leave a lock behind.
  const [advanceLock, setAdvanceLock] = useState(false)

  useEffect(() => {
    if (!advanceLock) return
    const timer = setTimeout(() => setAdvanceLock(false), ADVANCE_LOCK_MS)
    return () => clearTimeout(timer)
  }, [advanceLock])

  // Captured on the first try and replayed verbatim: recomputing the elapsed
  // time on a retry would charge the player for our own failed round trip, and
  // could turn an answer given in time into a timeout.
  const lastAttempt = useRef<Attempt>({ optionIds: [], elapsedMs: 0 })

  async function submit(attempt: Attempt) {
    // The in-flight guard, not just the disabled styling: a second click that
    // slips through still cannot post a second answer.
    if (pending || feedback !== null || summary !== null) return

    setPending(true)
    setFailure(null)
    lastAttempt.current = attempt

    try {
      const outcome = await submitAnswerAction({
        attemptId: run.attemptId,
        questionId: question.id,
        selectedOptionIds: attempt.optionIds,
        elapsedMs: attempt.elapsedMs,
      })
      if (outcome.ok) {
        setFeedback(outcome.result)
        // Started here and not when the summary is opened: the run is finished
        // as of this answer, which is the first moment the server will part
        // with the opponent's score, and the player is still reading the last
        // feedback panel while it travels.
        if (outcome.result.summary !== null) void loadComparison()
      } else setFailure({ retryable: false, code: outcome.error })
    } catch {
      // The action itself never throws for a known service error, so what lands
      // here is the network or the server being unreachable — worth retrying.
      setFailure({ retryable: true })
    } finally {
      setPending(false)
    }
  }

  async function loadComparison() {
    if (challenge === undefined) return

    const opponentName = challenge.opponentName
    const failed: ComparisonState = { status: 'failed', retry: () => void loadComparison() }
    setComparison({ status: 'pending' })

    try {
      const outcome = await fetchChallengeComparisonAction({ attemptId: run.attemptId })
      // A finished challenge run always has both summaries, so a null here is
      // as unexpected as a rejection and gets the same retry rather than a
      // silently missing panel.
      if (outcome.ok && outcome.comparison !== null) {
        setComparison({ status: 'ready', opponentName, ...outcome.comparison })
      } else {
        setComparison(failed)
      }
    } catch {
      setComparison(failed)
    }
  }

  function commit(optionIds: string[]) {
    // The guard behind the disabled options, for the same reason the in-flight
    // one exists: a click that slips past the styling still must not answer a
    // question the player has not read. The timeout path below deliberately
    // skips it — the clock is not input.
    if (advanceLock) return
    void submit({ optionIds, elapsedMs: Date.now() - startedAt })
  }

  function expire() {
    setExpired(true)
    // Whatever is selected, which for a single-choice question is nothing: a
    // click there would already have submitted it.
    void submit({ optionIds: selected, elapsedMs: Date.now() - startedAt })
  }

  function next() {
    if (feedback === null) return
    if (feedback.summary !== null) {
      setSummary(feedback.summary)
      return
    }
    if (feedback.next === null) return

    setQuestion(feedback.next)
    setPosition((current) => current + 1)
    setSelected([])
    setFeedback(null)
    setFailure(null)
    setExpired(false)
    setStartedAt(Date.now())
    // The feedback panel this click landed in is about to vanish and the
    // options are about to take its place on screen; a second click of the
    // same gesture would answer the new question. Not the Next button itself:
    // it is leaving anyway, and locking it would strand a stuck run.
    setAdvanceLock(true)
  }

  if (summary !== null) {
    return <RunSummaryPanel summary={summary} quizSlug={quizSlug} comparison={comparison} />
  }

  const answered = feedback !== null
  const correctOptionIds = feedback?.correctOptionIds ?? null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-muted-foreground text-sm">
            {t('progress', { position, total: run.total })}
          </p>
          <QuestionTimer
            timePerQuestionSec={run.timePerQuestionSec}
            startedAt={startedAt}
            // The whole point of the timer: it measures answering only, and
            // stops the instant an answer is in flight or graded.
            running={!answered && !pending && !expired}
            onExpire={expire}
          />
        </div>
        <Progress aria-label={t('progressLabel')} value={((position - 1) / run.total) * 100} />
      </div>

      <QuestionCard
        key={question.id}
        question={question}
        selected={selected}
        onSelect={setSelected}
        onCommit={commit}
        locked={pending || answered || advanceLock}
        submitting={pending}
        correctOptionIds={correctOptionIds}
      />

      {failure !== null && (
        <Alert variant="destructive">
          <AlertTitle>{t('submitErrorTitle')}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            {failure.retryable ? (
              <>
                <p>{tCommon('error')}</p>
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => submit(lastAttempt.current)}
                >
                  {pending ? t('checking') : tCommon('retry')}
                </Button>
              </>
            ) : (
              <>
                <p>{t(`submitErrors.${failure.code}`)}</p>
                {/* Nothing to retry: the answer landed, or this run is not
                    reachable any more. The only way on is a new run. */}
                <Link href={`/q/${quizSlug}/run`} className="underline underline-offset-4">
                  {t('startAgain')}
                </Link>
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      {feedback !== null && (
        <FeedbackPanel
          result={feedback}
          correctOptionTexts={question.options
            .filter((option) => feedback.correctOptionIds.includes(option.id))
            .map((option) => option.text)}
          onNext={next}
        />
      )}
    </div>
  )
}
