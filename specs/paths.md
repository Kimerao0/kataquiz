---

feature: paths
title: Paths
phase: building
---

# Paths

## Goal

Let a player follow an ordered series of existing quizzes ("Road to Software Architect") as one path:
a page that shows what is done, what is left and what still needs perfecting, and a nudge to the next
step wherever a step is played or browsed. Roadmap item KQ42 (phase 1 of the paths spec).

## Original request

Paths (KQ42-KQ44). Convert the existing settled spec docs/specs/2026-11-02-paths.md and plan docs/superpowers/plans/2026-11-02-paths-phase-1.md into specs/paths.md. Release R1 = KQ42 (phase 1); tasks 1-2 already built and committed (b85a3a4 path file parser, fa8607c paths/path_steps tables + migration 0007). Most decisions were settled with the owner on 2026-11-02; interview only on what is genuinely open.

## Scope

### Files to change

- `src/lib/paths/` (new: file schema, import, queries, progress, and their tests)
- `src/lib/quiz-schema/index.ts` (shared parse helpers)
- `src/lib/quizzes/import.ts`, `src/lib/quizzes/seed.ts`, `src/lib/quizzes/seed.test.ts`
- `src/lib/quiz-schema/seed-files.test.ts`
- `src/lib/run/engine.ts` (`worstTier` next to `bestTier`)
- `src/db/schema.ts`, `src/db/schema.test.ts`, `drizzle/0007_*.sql`, `drizzle/meta/*`
- `scripts/seed.mts`
- `seeds/path-road-to-software-architect.yaml`, `seeds/path-aws-cloud-practitioner.yaml` (new)
- `src/app/(app)/upload/` (`actions.ts`, `upload-form.tsx`, `format-help.tsx`, their tests)
- `src/app/(app)/p/[slug]/` (new), `src/app/(app)/paths/` (new)
- `src/app/(app)/page.tsx`, `src/app/(app)/q/[slug]/page.tsx`, `src/app/(app)/q/[slug]/run/page.tsx`
- `src/components/paths/` (new)
- `src/components/run/run-start-panel.tsx`, `src/components/run/run-player.tsx`,
  `src/components/run/run-summary.tsx`, `src/components/run/run-summary.test.tsx`
- `src/components/site-header.tsx`
- `messages/en.json` (`paths` namespace)
- `README.md` (path file format), `docs/roadmap.md`, `docs/roadmap-archive-2026-11.md`
### Out of scope

- KQ43 (build a path in the app) and KQ44 (path from a tag): each gets its own spec when it starts.
- Editing or deleting a published path: paths are immutable, like quizzes.
- Hiding a path from the UI: `is_hidden` is honoured everywhere, but nothing sets it (same as KQ06).
- Any progress for guests.

## Decisions

| #   | Question                                            | Answer                                                                                                                                                                                                              | Date       |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | What is the concept called, and where does it live? | **Path** in the UI, titles may say "Road to …". Page `/p/<slug>`, list `/paths`.                                                                                                                                    | 2026-11-02 |
| 2   | How is a path created in phase 1?                   | A path file (`kind: path`, YAML or JSON) through `/upload` (steps by quiz slug) and `seeds/` (steps by quiz title, among the seed author's quizzes).                                                                | 2026-11-02 |
| 3   | Which quizzes can be steps, and how many?           | Any public, non-hidden quiz, including other people's. At most 100 steps; a quiz at most once per path.                                                                                                             | 2026-11-02 |
| 4   | Does a path upload have its own rate limit?         | No: it spends the quiz upload limit (10/hour, key `upload:<userId>`).                                                                                                                                               | 2026-11-02 |
| 5   | Can a path be edited?                               | No: immutable once published; re-uploading creates a new path. Seed paths dedupe by title under the seed author.                                                                                                    | 2026-11-02 |
| 6   | How is progress measured?                           | From KQ40 tiers, signed-in only. Step: done with any pass, to perfect at bronze/silver, perfected at gold. Path ribbon: the weakest live step's tier, none if any live step is unpassed or there are no live steps. | 2026-11-02 |
| 7   | Where does Continue go?                             | First live step not passed; once all are passed it reads Perfect next and goes to the first non-gold step; no button when all are gold. Guests go to the first step.                                                | 2026-11-02 |
| 8   | Where are paths suggested?                          | Run summary (the `?path=` one, else up to 3), quiz page ("Step n of m in …" with previous/next), catalog row badge ("title · n/m", "+N"), a strip of 6 above the catalog, `/paths`, a header link.                  | 2026-11-02 |
| 9   | What happens to hidden and deleted quizzes?         | A deleted quiz's step disappears; a hidden quiz's step is skipped at read time; numbering and counts use live steps only. A path with no live steps shows an empty state.                                           | 2026-11-02 |
| 10  | Which paths ship first?                             | Road to Software Architect (41 Architect Roadmap quizzes) and AWS Cloud Practitioner (25 sections, then the mock exam).                                                                                             | 2026-11-02 |
| 11  | Spec file slug?                                     | `paths`                                                                                                                                                                                                             | 2026-11-10 |
| 12  | How is phase 1 sliced?                              | Four releases: path object, progress, browsing, next step after a run.                                                                                                                                              | 2026-11-10 |
| 13  | Do KQ43/KQ44 belong in this file?                   | No: out of scope, each gets its own spec when it starts.                                                                                                                                                            | 2026-11-10 |
| 14  | When does a release go to production?               | Hold: merge R1–R3 locally and push once R4 ships (still with the owner's go-ahead for that push).                                                                                                                   | 2026-11-10 |

## Releases

### R1 — Path object

**What we do:** A path can be uploaded or seeded, and has a read-only page at `/p/<slug>` listing its live steps.
**Customer impact:** None until pushed; held for the R4 push.
**Tracker:** none

#### Specs

1. [built] On `/upload`, a signed-in author who submits a path YAML naming two public quizzes by slug lands on `/p/<new slug>`, which lists those two quizzes in file order.
2. [built] On `/upload`, a path file whose second step names an unknown or hidden quiz slug is refused with an error naming step 2, and no path is created.
3. [built] On `/upload`, a path file that names the same quiz twice is refused with an error naming the repeated step, and a path file with 101 steps is refused with an error on `steps`.
4. [built] On `/upload`, an author who has already uploaded 10 files in the last hour, mixing quizzes and paths, has an 11th path upload refused by the rate limit.
5. [open] Running `pnpm db:seed` on a database with the seed quizzes reports Road to Software Architect and AWS Cloud Practitioner as imported, and a second run reports both as skipped, already imported.
6. [open] On `/p/<slug>` of the seeded Road to Software Architect, the page lists 41 steps from Architect Roadmap 01 to 41 in order; on the seeded AWS Cloud Practitioner page, the 26th and last step is the mock exam.
7. [built] On `/p/<slug>` of a three-step path whose second quiz is hidden, the page lists two steps numbered 1 and 2; with the quiz deleted instead, it also lists two steps.
8. [built] On `/p/<slug>` of a path whose every quiz is hidden, the page shows the empty state and no Continue button.
9. [built] Opening `/p/<slug>` for a hidden path or an unknown slug shows the not-found page.
10. [built] On `/p/<slug>`, each step links to `/q/<quiz slug>/run?path=<path slug>`, and Continue links to the first step's run.

### R2 — Progress on the path page

**What we do:** A signed-in player sees each step's status, the path ribbon and a Continue or Perfect next button that follows their progress.
**Customer impact:** None until pushed; held for the R4 push.
**Tracker:** none

#### Specs

1. [open] On `/p/<slug>` signed in, a step with no passing run shows "to do", a step whose best tier is bronze or silver shows "to perfect" with that ribbon, and a step at gold shows "perfected".
2. [open] On `/p/<slug>` as a guest, no step shows a status or a ribbon, and there is no progress line.
3. [open] On `/p/<slug>` signed in, the progress line reads `<done> done · <perfected> perfected · <left> left` and its numbers match the step statuses on the page.
4. [open] On `/p/<slug>` signed in, the path ribbon is bronze when every live step is passed and the weakest is bronze, and there is no path ribbon while any live step is unpassed.
5. [open] On `/p/<slug>` signed in, the path ribbon is gold when every live step is gold, and silver when the weakest live step is silver.
6. [open] On `/p/<slug>` signed in with steps 1 and 2 passed, Continue links to step 3's run.
7. [open] On `/p/<slug>` signed in with every step passed and step 2 the first below gold, the button reads Perfect next and links to step 2's run.
8. [open] On `/p/<slug>` signed in with every step at gold, there is no Continue or Perfect next button.
9. [open] On `/p/<slug>` as a guest, Continue links to the first step's run.

### R3 — Browsing paths

**What we do:** Paths are reachable from the catalog, a `/paths` list, the header and each step's quiz page.
**Customer impact:** None until pushed; held for the R4 push.
**Tracker:** none

#### Specs

1. [open] On the catalog `/` with seven paths, a Paths strip above the quiz list shows the six newest with a See all link to `/paths`; with no paths, there is no strip.
2. [open] On `/paths`, every non-hidden path is listed newest first and paginated like the catalog, and a hidden path does not appear.
3. [open] On `/paths` and the catalog strip, a signed-in player sees their path ribbon on each card they have earned one for, and a guest sees no ribbons.
4. [open] In the site header at 1440px, a Paths link sits between Browse and Upload and goes to `/paths`; at 375px it is an icon with the accessible name "Paths" and the header does not overflow.
5. [open] On the catalog `/`, the row of a quiz that is step 16 of a 41-step path shows `<path title> · 16/41` linking to `/p/<path slug>`.
6. [open] On the catalog `/`, the row of a quiz in three paths shows the first path's badge plus `+2`, and the row of a quiz in no path shows no badge.
7. [open] On `/q/<slug>` of a quiz that is step 3 of a path, a line reads `Step 3 of <total> in <path title>` linking to the path, with links to steps 2 and 4.
8. [open] On `/q/<slug>` of a path's first step there is no previous link, on its last step there is no next link, and a quiz in no path shows no path line.

### R4 — Next step after a run

**What we do:** The run summary suggests the next step of the path(s) the quiz belongs to.
**Customer impact:** Paths go live: the R1–R4 push creates the tables and imports both seed paths on production.
**Tracker:** none

#### Specs

1. [open] On the run summary of a quiz that is step 3 of one path, opened without `?path=`, a line reads `Next in <path title>: <step 4 title>` and links to step 4's run with `?path=<path slug>`.
2. [open] On the run summary of a quiz in several paths, opened with `?path=<slug>` of one of them, only that path's next step is shown.
3. [open] On the run summary opened with `?path=<slug>` of a path that does not contain the quiz, or does not exist, the summary lists the quiz's paths as if no `?path=` were given.
4. [open] On the run summary of a quiz in five paths, opened without `?path=`, three path suggestions are shown.
5. [open] On the run summary of a quiz that is the last step of a path, a line reads `Last step of <path title>` and links to `/p/<path slug>`.
6. [open] On the run summary of a quiz in no path, no path line is shown.
7. [open] On the run summary reached through Play again from a summary that showed a path suggestion, the same suggestion is shown.
8. [open] On the summary of a challenge run at `/c/<attemptId>`, no path suggestion is shown.

## Proofs

| Spec | Verdict | Evidence |
| ---- | ------- | -------- |

## Changelog

- 2026-11-10 — created from `docs/specs/2026-11-02-paths.md` and `docs/superpowers/plans/2026-11-02-paths-phase-1.md`. R1 groundwork already committed before the spec: `b85a3a4` (path file parser), `fa8607c` (`paths` / `path_steps` tables, migration 0007). No spec is proven by them alone.
