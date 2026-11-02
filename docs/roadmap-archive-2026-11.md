# Kataquiz roadmap archive — 2026-11

Closed and dropped items, moved out of `docs/roadmap.md` so the live file is the open set.
Ids are never reused and never renumbered: commits and reviews cite them, so an archived id
must still resolve.

---

## Closed

- [x] KQ03: Prune `rate_limits`
  Closed by `17c8985`. Not the scheduled `DELETE` the item proposed: a cron would bind the app to a
  host, and the portability check forbids that. Instead `checkRateLimit` runs `pruneRateLimits` on 1%
  of calls, deleting rows older than `RATE_LIMIT_RETENTION_SEC` (24h). Every window is 1h, and an
  expired row already resets to 1 on its next hit, so no limiter decision changes; a test pins each
  window below the retention. A prune failure is logged and never fails the request (tested, and a
  mutation that rethrows turns it red).
- [x] KQ38: `attempts` has no index
  Closed by `17c8985` (migration `drizzle/0005_red_valkyrie.sql`). Two indexes rather than the one
  proposed, because `ownedBy` filters by `user_id` for a signed-in player and `guest_id` for a guest:
  `(quiz_id, user_id, started_at)` and `(quiz_id, guest_id, started_at)`, plus
  `attempt_answers(question_id)` for the stats queries. Review confirmed on the dev DB that
  `lastNicknameFor` becomes an index scan backward with no sort. Plain `CREATE INDEX` inside
  drizzle's migration transaction, so it blocks inserts while it builds: fine on a young table,
  revisit for a future index on a large one.
- [x] KQ37: Resume a challenge run after a refresh
  Closed by `0b1cf7b`. `findResumableRun` takes an optional `challengeOfAttemptId`: without it the
  quiz page keeps excluding challenge runs, with it `/c/[attemptId]` finds only the player's own
  unfinished, answered run on that challenge. The invite panel mirrors KQ09's offer (Resume / Start
  over, cross-guarded handlers) and reuses `resumeRunAction`, whose `resumeRun` already scopes the
  attempt to the quiz and owner. Verified end to end on a production build with Playwright: answer
  one question, refresh, Resume lands on question 2 still framed as a challenge, and the quiz page
  offers nothing. A run that finished between render and click is treated as gone; the lost-result
  case behind that is KQ41.

## Dropped

- [-] KQ19: Drop the dead `ChallengeInvite.quizId`
  Dropped 2026-11-02: no longer dead. KQ37 (`0b1cf7b`) reads it on the challenge page to scope the
  resumable-run lookup to the quiz.
