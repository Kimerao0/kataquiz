# Kataquiz roadmap archive — 2026-10

Closed and dropped items, moved out of `docs/roadmap.md` so the live file is the open set.
Ids are never reused and never renumbered: commits and reviews cite them, so an archived id
must still resolve.

---

## Closed

- [x] KQ10: Make "Play again" one click
  Closed by `05b6179`. The summary starts the next run in place: no page load, no Begin click, and
  the nickname is carried both in memory across a replay and across a page load by
  `lastNicknameFor`, which seeds the field so it shows what it will send.
  _`src/components/run/run-summary.tsx`, `src/components/run/run-start-panel.tsx`, `src/lib/run/service.ts`_

  Recorded, because each of these is a decision and not an oversight:
  - `/c/[attemptId]` keeps its link. Leaving a challenge for an ordinary run is a real navigation,
    and replaying it in place would leave the player on a `/c/` URL playing something else.
  - `RUN_START_LIMIT` went 30 → 120 an hour, which also raises the ceiling for challenge starts.
    The key is per guest cookie and a fresh cookie is free, so the number was never much of an
    abuse control; what actually bounds the table is KQ38 and a pruning story that does not exist.
  - The `key` on `RunPlayer` is load-bearing and has a test that goes red without it.
  - Two things are deliberately uncovered. The `replaying` guard in the summary cannot be reached
    from the DOM, because React drops clicks on a disabled button; it stays as defence and says so
    in a comment. And the `page.tsx` → panel `initialNickname` wiring has no test — verified by
    mutation, all 483 stay green — because this repo has no server-component page tests at all.
    Introducing the first one is its own decision, not a thing to smuggle into KQ10.

- [x] KQ09: Resume a run after a refresh
  Closed by `a4635c0`. A run left unfinished is offered back on the quiz's run page — "you left a
  run unfinished, N of M answered" — and resuming serves the question the server is waiting for
  together with the history it has already graded, so the tally keeps its strokes and the KQ08
  review still lists the whole run rather than only what came after the refresh. A `duplicate`
  answer after a flaky network now offers that same resume instead of a dead end.
  _`src/lib/run/service.ts` (`findResumableRun`, `resumeRun`), `src/components/run/run-start-panel.tsx`_

  Recorded, because each of these is a decision and not an oversight:
  - No schema change, and no staleness cutoff: an unfinished attempt is offered back however old it
    is. Starting over leaves the old one unfinished, which is already what happens to every run
    somebody walks away from.
  - Resuming hands the player a fresh clock on the current question. Accepted on a manual pass.
  - Challenge runs are excluded from the offer. The other mount point is KQ37.
  - Two defects came out of review and were fixed before the commit: Begin and Resume could both be
    in flight at once, and the zero-answer filter ran after `LIMIT 1`, so an abandoned Start over
    hid the run that still held the work. Both now have tests that fail without the fix.

- [x] KQ08: Review your missed questions on the summary
  Closed by `2577453`. Every question of the run is listed under the score — missed ones open,
  correct ones collapsed — with the correct answer, the player's own picks struck where they were
  wrong, the explanation, the question's snippet or image, and the theory link.
  _`src/components/run/run-review.tsx`, rendered from `run-summary.tsx:81`_

  Scope recorded, because two of these look like gaps and are not:
  - The entries are accumulated client-side as the run is graded, so a refresh still loses them.
    That is KQ09 and was a deliberate choice, not an oversight.
  - `imageUrl` is now rendered in two places; re-validating it at render is still KQ15, which names
    both call sites.

- [x] KQ33: `pnpm shots` photographed a 404 silently
  Closed by `e07e76a`. The roadmap prescribed the `Network` domain response status and that fix
  would not have worked: a dead slug answers **HTTP 200** with not-found content, because
  `notFound()` is thrown inside a Suspense boundary after streaming starts — the limitation this
  repo had already accepted. Verified against the running app before the fix was written. What does
  distinguish it is the `noindex` robots meta Next adds, and that is what the tool refuses on.
  `--allow-noindex` is the escape hatch.
  _`scripts/shots.mts`_

- [x] KQ34: `pnpm shots` could not reach an interactive state
  Closed by `e07e76a`. `--play answer` and `--play summary` drive a real run before the shot, so the
  feedback panel and the summary can be photographed. The three traps that cost a cycle each are
  defended in the script and named in its comments: the start panel's nickname `label[for]`, the
  advance lock, and a scenario that fails rather than photographing a rate-limit error.
  _`scripts/shots.mts`_

- [x] KQ36: No CI job ran `pnpm build`
  Closed by the commit below. `pnpm check` is lint, types, tests and portability, so a break that
  only shows at build time reached main unseen — this session caught one only because the build was
  run by hand for screenshots. Verified before adding the step: the build needs `DATABASE_URL` set,
  because `src/db/client.ts` throws without one, but never connects — it succeeds with no
  `.env.local` and a database that does not exist, so it needs no secrets and no step ordering.
  _`.github/workflows/ci.yml`_
