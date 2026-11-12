# Kataquiz roadmap

The open set. Closed items move to `docs/roadmap-archive-<YYYY-MM>.md` and keep their id.

**Ids** are `KQnn`, assigned once and never reused — an archived id must still resolve, because
commits and reviews cite them. **Closing an item requires evidence**: a commit sha, or a `file:line`
showing the fixed state. **Dropping one requires a recorded reason**, or the next audit raises it again.

Created 2026-10-28 from the Milestone 1 close-out, two code reviews, a UX flow review and a design pass.
Closed items: `docs/roadmap-archive-2026-10.md`, `docs/roadmap-archive-2026-11.md`.

---

## Blocks a public launch

- [ ] KQ01: Register the Google OAuth app
  The code already supports Google (`src/lib/auth.ts:20` reads `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`), but production only has the `GITHUB_*` vars (checked 2026-11-02 with `vercel env ls production`), so the sign-in page shows one provider. No code work: register the app in the Google console and add the two vars to Vercel production.
  _Vercel env, `src/lib/auth.ts`_
- [ ] KQ02: Decide the custom domain
  Deployed: production runs on Vercel, and every push to `main` builds and runs `pnpm release`. What is left is the domain: `kataquiz` is free on npm and GitHub; `.com` is parked, `.app`/`.io`/`.dev`/`.study`/`.org`/`.co` were open when last checked.

## Milestone 2 — the planned next slice

- [ ] KQ04: In-app quiz editor
  Decided for v1, deferred to M2. The zod schema is the contract; the editor is a UI that produces the same JSON. It must validate `imageUrl` and `theoryUrl` with that same `httpUrl` schema at the point the author can still fix them: KQ15 made the player drop a bad image URL silently, which is right for a stranger mid-quiz but useless as feedback to whoever typed it.
  _`src/lib/quiz-schema/`_
- [ ] KQ06: Report button + admin hide
  All quizzes are public and anyone can upload. `isHidden` exists and is honoured everywhere; nothing sets it.
  _`src/db/schema.ts`_
- [ ] KQ07: Deleting a question destroys past answer rows
  `attempt_answers` cascades from `questions`, so the M2 editor will silently erase the per-answer history of finished runs while `attempts.score` keeps the old totals. Decide before the editor ships.
  _`src/db/schema.ts`_


## Paths — "road to" series of quizzes

Spec: `specs/paths.md` (phase 1, KQ42, live in production since 2026-11-11; archived). Original design:
`docs/specs/2026-11-02-paths.md`.

- [ ] KQ43: Paths, phase 2 — build a path in the app
  An authoring UI that writes the same data as a path file. Close to the quiz editor (KQ04); settle its details in its own spec when it starts.
- [ ] KQ44: Paths, phase 3 — create a path from a tag
  "Make a path from the quizzes tagged X" produces a normal, editable path, never a live tag-derived grouping, so there is one source of truth. Blocked on KQ43.

## The biggest gap between the product and its own pitch

- [ ] KQ41: A refresh between a challenge's last answer and the comparison loses the result
  KQ37 resumes an unfinished challenge run, but the last answer marks the run finished, so a refresh while "Comparing your scores…" is on screen (or a resume that lands on an already-finished run, which KQ37 treats as gone) shows the invite again with no way back to the head-to-head result. Needs a finished-run lookup on `/c/[attemptId]` that renders the summary and the comparison.
  _`src/app/c/[attemptId]/page.tsx`, `src/components/run/challenge-invite-panel.tsx`_
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
- [ ] KQ16: `startRun` has a narrow mirror of the stranded-run bug
  If the first sampled question is deleted between the bank read and the load, it throws `EmptyQuizError` even though others survived. Fails honestly rather than stranding, so it is low priority.
  _`src/lib/run/service.ts:98`_
- [ ] KQ17: `total` can exceed the questions actually served
  A run that finishes early after deletions still reports the originally sampled count, because the challenge comparison reads the same column.
  _`src/lib/run/service.ts`_
- [ ] KQ18: Cap `selectedOptionIds` length
  Validated element-wise but unbounded in count. Pick a cap alongside `MAX_NICKNAME_LENGTH`.
  _`src/app/(app)/q/[slug]/actions.ts`_

## Accessibility and interaction

- [ ] KQ20: Focus falls to `<body>` after Next
  A keyboard player must Tab back into the options on every single question. The worst remaining friction for keyboard-first use. KQ10 added a second instance of the same shape: Play again disables itself while the run starts, which blurs it, so a keyboard player whose replay fails has to Tab back to reach both the alert and the retry.
  _`src/components/run/run-player.tsx`, `src/components/run/run-summary.tsx` (the Play again button)_
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

- [ ] KQ46: `getCurrentUser` runs a session query on every call
  Not wrapped in React `cache()` and better-auth has no `cookieCache`, so a signed-in catalog render now makes three session lookups (header, paths strip, results). Harmless at this scale; wrapping it in `cache()` fixes every page at once. Found in the paths R3 review.
  _`src/lib/session.ts:11`_

- [ ] KQ35: The dev server silently serves stale CSS
  `globals.css` edits repeatedly failed to reach the bundle; a whole screenshot round was a picture of CSS that was never applied. Verify design work against `pnpm build`, not `pnpm dev`.

## Architect Roadmap v2

- [ ] KQ47: Architect Roadmap v2 R1 — Delete mechanism, snippet guard, React quizzes 01–06
  Spec: `specs/architect-roadmap-v2.md` R1 · status: merged bc3cef9, not pushed
  Specs: R1.1 … R1.9 (the spec file holds the text; never copy it here)
  Verdicts: 9 proven — `.proofs/architect-roadmap-v2/`
  2026-11-11 — check: 9/9 implemented; 9 findings (0 blockers): 8 fixed, 1 accepted (user paths lose steps, decision 11)
  2026-11-11 — merged bc3cef9 (ff, rebase clean); pnpm check green: biome ok, tsc ok, 850/850 tests, portability ok
- [ ] KQ48: Architect Roadmap v2 R2 — Next.js and React patterns 07–15
  Spec: `specs/architect-roadmap-v2.md` R2 · status: checking
  Specs: R2.1 … R2.7 (the spec file holds the text; never copy it here)
  Verdicts: <filled by feature-prove>
  2026-11-12 — check: 7/7 implemented (R2.7 bounced once: ~10 edge-case questions replaced); 9 findings (0 blockers): 7 fixed, R2.4/R2.6 tightened + decision 13 via sync
- [ ] KQ49: Architect Roadmap v2 R3 — Node.js 16–23
  Spec: `specs/architect-roadmap-v2.md` R3 · status: open
  Specs: R3.1 … R3.7 (the spec file holds the text; never copy it here)
  Verdicts: <filled by feature-prove>
- [ ] KQ50: Architect Roadmap v2 R4 — Architecture 24–41
  Spec: `specs/architect-roadmap-v2.md` R4 · status: open
  Specs: R4.1 … R4.7 (the spec file holds the text; never copy it here)
  Verdicts: <filled by feature-prove>

## Accepted — recorded so they are not rediscovered

These are in `docs/specs/2026-10-27-kataquiz-v1.md` under "Accepted limitations" with the reasoning.
The sharpest one: **a dead `/q/<slug>` or `/c/<attemptId>` returns HTTP 200** with 404 content,
because `notFound()` is thrown inside a Suspense boundary after streaming starts. The visitor sees
the right page and Next adds `noindex`; what is wrong is link previews and uptime checks.
