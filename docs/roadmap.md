# Kataquiz roadmap

The open set. Closed items move to `docs/roadmap-archive-<YYYY-MM>.md` and keep their id.

**Ids** are `KQnn`, assigned once and never reused — an archived id must still resolve, because
commits and reviews cite them. **Closing an item requires evidence**: a commit sha, or a `file:line`
showing the fixed state. **Dropping one requires a recorded reason**, or the next audit raises it again.

Created 2026-10-28 from the Milestone 1 close-out, two code reviews, a UX flow review and a design pass.
Closed items: `docs/roadmap-archive-2026-10.md`.

---

## Blocks a public launch

- [ ] KQ01: Register the Google OAuth app
  Only GitHub is configured. The sign-in page shows one provider; that is correct behaviour, not a bug, but it narrows who can sign up.
  _`.env.local`, `src/lib/auth.ts`_
- [ ] KQ02: Decide the domain and deploy
  `kataquiz` is free on npm and GitHub; `.com` is parked, `.app`/`.io`/`.dev`/`.study`/`.org`/`.co` are open. Nothing is deployed.
- [ ] KQ03: Prune `rate_limits`
  The table has no TTL and no cleanup job, so it grows without bound. One scheduled `DELETE` before launch.
  _`src/lib/rate-limit.ts`_

## Milestone 2 — the planned next slice

- [ ] KQ04: In-app quiz editor
  Decided for v1, deferred to M2. The zod schema is the contract; the editor is a UI that produces the same JSON.
  _`src/lib/quiz-schema/`_
- [ ] KQ05: Per-question error rate for authors
  The one stat that makes a quiz better: which questions everyone gets wrong. Every answer is already stored.
  _`attemptAnswers`_
- [ ] KQ06: Report button + admin hide
  All quizzes are public and anyone can upload. `isHidden` exists and is honoured everywhere; nothing sets it.
  _`src/db/schema.ts`_
- [ ] KQ07: Deleting a question destroys past answer rows
  `attempt_answers` cascades from `questions`, so the M2 editor will silently erase the per-answer history of finished runs while `attempts.score` keeps the old totals. Decide before the editor ships.
  _`src/db/schema.ts`_

## The biggest gap between the product and its own pitch

- [ ] KQ37: Resume a challenge run after a refresh
  KQ09 gave the quiz's run page a resume offer, but `RunPlayer` is mounted from two places and the other one got nothing, so refreshing a challenge at question 20 still orphans it. `findResumableRun` excludes challenge runs on purpose — resumed from the plain quiz page they would lose their head-to-head framing — but `/c/[attemptId]` _is_ that framing, and `resumeRun` already has no challenge filter. What is missing is a challenge-scoped lookup and an offer on the invite panel.
  _`src/components/run/challenge-invite-panel.tsx:74`, `src/lib/run/service.ts`_
- [ ] KQ10: Make "Play again" one click
  It currently costs a page load plus a Begin click, and a guest retypes their nickname. For someone doing hundreds of reps in a sitting, that is the loop's main friction.
- [ ] KQ11: Tell the challenger's sender what happened
  The person who shared a link never learns whether anyone played it. The growth loop has no return path.

## Correctness and robustness

- [ ] KQ12: `'anonymous'` bypasses next-intl
  A hardcoded lowercase English literal rendered to users as "anonymous challenged you". Should be a nullable name resolved to a message key, like `catalog.deletedAuthor` already is.
  _`src/lib/run/challenge.ts:27`_
- [ ] KQ13: `True`/`False` stored as English rows
  Generated at import time, so an Italian quiz shows English buttons. A data-level fix, not a translation one.
  _`src/lib/quiz-schema/index.ts`_
- [ ] KQ14: `<html lang>` is always `en`
  Quizzes carry their own `language`, so a screen reader mispronounces every non-English quiz.
  _`src/app/layout.tsx`_
- [ ] KQ15: Re-validate `imageUrl` at render
  `theoryUrl` is guarded at render against a `javascript:` scheme; `imageUrl` is not. The asymmetry reads as an oversight and the M2 editor is a second way into the column. KQ08 gave the column a second render site, so the guard now has two call sites to cover; `httpUrlOrNull` already exists next door to both.
  _`src/components/run/question-media.tsx`, used by `question-card.tsx` and `run-review.tsx`_
- [ ] KQ16: `startRun` has a narrow mirror of the stranded-run bug
  If the first sampled question is deleted between the bank read and the load, it throws `EmptyQuizError` even though others survived. Fails honestly rather than stranding, so it is low priority.
  _`src/lib/run/service.ts:98`_
- [ ] KQ17: `total` can exceed the questions actually served
  A run that finishes early after deletions still reports the originally sampled count, because the challenge comparison reads the same column.
  _`src/lib/run/service.ts`_
- [ ] KQ18: Cap `selectedOptionIds` length
  Validated element-wise but unbounded in count. Pick a cap alongside `MAX_NICKNAME_LENGTH`.
  _`src/app/(app)/q/[slug]/actions.ts`_
- [ ] KQ19: Drop the dead `ChallengeInvite.quizId`
  No consumer outside a test fixture, on the one type whose job is defining what is safe to show a challenger.
  _`src/lib/run/challenge.ts:11`_

## Accessibility and interaction

- [ ] KQ20: Focus falls to `<body>` after Next
  A keyboard player must Tab back into the options on every single question. The worst remaining friction for keyboard-first use.
  _`src/components/run/run-player.tsx`_
- [ ] KQ21: Mid-run exits are unguarded
  The back link, the header and the quiz-title link all discard a run in progress with no confirmation, and there is no explicit Quit.
  _`src/components/run/`_
- [ ] KQ22: Dark-mode option controls are low contrast
  Inherited from the vendored shadcn primitives (`dark:bg-input/30`).
  _`src/components/ui/`_
- [ ] KQ23: The timer is silent to screen readers
  `role="timer"` with live announcements off, deliberately — but a timed run then gives a screen-reader user no warning at all. WCAG 2.2.1.
  _`src/components/run/question-timer.tsx`_

## Authoring

- [ ] KQ24: Upload errors name the wrong question number
  Paths are zero-indexed, so `questions.3` is the fourth question. Partly softened in the form; the underlying strings are still raw zod.
  _`src/lib/quiz-schema/index.ts`_
- [ ] KQ25: A rejected upload clears the chosen file
  The pasted text is preserved now; a file input cannot be restored for security reasons, and the UI says so. Worth revisiting if authors hit it.
  _`src/app/(app)/upload/upload-form.tsx`_

## Design and layout

- [ ] KQ26: Redesign the page shell for ultrawide
  `<main>` is 50% of a 2560 display. Widening the drill alone would push its left edge outside the header's; widening `--page-width` globally would worsen the catalog, whose body is measure-capped. One decision, two pages.
  _`src/app/globals.css`_
- [ ] KQ27: Summary, start panel and invite still have the wide-display void
  Re-aligned but not redesigned when the drill was. Same lens, same fix.
  _`src/components/run/`_
- [ ] KQ28: Sign-in at 1440 is a title and one button in a void
  Structurally right, visually bare.
  _`src/app/signin/`_
- [ ] KQ29: Upload signed-out shows a stock rounded alert
  The only surface still carrying untouched shadcn chrome.
  _`src/app/(app)/upload/page.tsx`_
- [ ] KQ30: A 4-option multi scrolls 13px at 375
  The "Select all that apply" line costs ~33px. The only lever is `.drill-main` padding.
  _`src/app/globals.css`_
- [ ] KQ31: The header seal is easy to miss at 28px
  Rendered at `size="1.75rem"` beside the wordmark, the hanko reads as a small coloured square and its glyph is lost. It is the only brand mark most pages carry.
  _`src/components/site-header.tsx:58`_
- [ ] KQ32: "Browse" is a compass icon below 640px
  Has an accessible name, but a compass for "browse quizzes" is a guess. Short text labels would fit.
  _`src/components/site-header.tsx`_

## Tooling — each of these has already cost a wasted cycle

- [ ] KQ35: The dev server silently serves stale CSS
  `globals.css` edits repeatedly failed to reach the bundle; a whole screenshot round was a picture of CSS that was never applied. Verify design work against `pnpm build`, not `pnpm dev`.

## Accepted — recorded so they are not rediscovered

These are in `docs/specs/2026-10-27-kataquiz-v1.md` under "Accepted limitations" with the reasoning.
The sharpest one: **a dead `/q/<slug>` or `/c/<attemptId>` returns HTTP 200** with 404 content,
because `notFound()` is thrown inside a Suspense boundary after streaming starts. The visitor sees
the right page and Next adds `noindex`; what is wrong is link previews and uptime checks.
