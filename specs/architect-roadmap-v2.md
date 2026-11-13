---

feature: architect-roadmap-v2
title: Architect Roadmap v2
phase: building
---

# Architect Roadmap v2

## Goal

Make the "Road to Software Architect" path teach theory and reasoning instead of code puzzles: at most
1 question in 5 carries a code snippet, and edge-case trivia appears only in the topic-advanced quizzes
(04, 05, 14, 21, 26). Replaced quizzes and the old path are hard-deleted on prod by a data migration that
runs before the seed import, so the new versions import under the original titles.

## Original request

i want you to modify the quiz you creted. I tried the "Architect Roadmap 01: React fundamentals" and the question i had were all code snipped and they where kinda hard. i don't want to have many snippeds, i want more theory questions, besides those where react fundamentals and you asked some seriously hard and edge cases questions. Please analyze the quiz and improve it

Follow-up: Kill the old path, and the old quiz, i want a new quiz and new path. Also check every other test in the path, snippets should be max 1/5 of total questions and edge cases only for advanced quiz, prefer general theory and "domande di ragionamento"

## Scope

### Files to change

- `seeds/architect-*.yaml` (rewritten quizzes only; `seeds/architect-01-react-fundamentals-v2.yaml` is folded back into `seeds/architect-01-react-fundamentals.yaml`)
- `drizzle/*.sql` and `drizzle/meta/*` (one custom data migration per release)
- `src/db/*.test.ts` or `src/lib/quizzes/*.test.ts` (migration tests)
- `.claude/skills/kata-quiz/scripts/check.mts` (snippet cap)
- `.claude/skills/kata-quiz/references/writer-brief.md` and `.claude/skills/kata-quiz/SKILL.md` (cap rule, the delete-and-reimport way to update a live quiz)
- `docs/roadmap.md` (tracker mirror)
### Out of scope

- Quizzes outside the Architect Roadmap series, and the other paths.
- An admin UI or script for deleting content: deletion lives only in migrations.
- Keeping play history for replaced quizzes: attempts on a deleted quiz are deleted with it.
- A stable path URL: the path slug changes on every release.
- User-authored paths that include a retired quiz: they lose that step (decision 11).
- `seeds/path-road-to-software-architect.yaml` content: titles stay the same, so the file is unchanged.

## Decisions

| #   | Question                                                                                                  | Answer                                                                                                                                                                               | Date       |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 1   | How are the old quizzes and path retired on prod?                                                         | Hard delete in a data migration (cascades to questions, options, attempts, answers, path steps).                                                                                     | 2026-11-11 |
| 2   | Which quizzes may keep edge-case questions?                                                               | Topic-advanced only: 04 advanced hooks, 05 performance, 14 caching at scale, 21 Node perf/debugging, 26 distributed consistency. All others: theory, reasoning, scenarios.           | 2026-11-11 |
| 3   | Snippet cap                                                                                               | At most 1/5 of questions with a `code` block, in every quiz of the path, advanced ones included.                                                                                     | 2026-11-11 |
| 4   | Slug                                                                                                      | `architect-roadmap-v2`                                                                                                                                                               | 2026-11-11 |
| 5   | How does it reach prod?                                                                                   | Staged by area, one push per release; each release deletes and recreates the path.                                                                                                   | 2026-11-11 |
| 6   | Quizzes under the cap with edge-case trivia                                                               | Audit every non-advanced quiz; replace the flagged questions, then delete and reimport that quiz. Unflagged quizzes stay untouched.                                                  | 2026-11-11 |
| 7   | What does the migration delete?                                                                           | Rows authored by the seed account whose title is in an explicit list, plus the path by title.                                                                                        | 2026-11-11 |
| 8   | Guard                                                                                                     | `check.mts` fails a quiz with more than 20% code questions unless it is tagged `advanced`. No Architect Roadmap quiz carries that tag, so the cap binds the whole path (decision 3). | 2026-11-11 |
| 9   | Path URL changes per release                                                                              | Accepted.                                                                                                                                                                            | 2026-11-11 |
| 10  | Can a challenge attempt block the delete?                                                                 | No: a challenge attempt always belongs to its source's quiz, so both go in the same cascade.                                                                                         | 2026-11-11 |
| 11  | A user-authored path that includes a retired quiz loses that step (cascade; the new quiz has a new slug). | Accepted, not handled.                                                                                                                                                               | 2026-11-11 |
| 12  | "A new quiz and new path": new titles or the same ones?                                                   | Same titles; only content and the path slug change.                                                                                                                                  | 2026-11-11 |
| 13  | A quiz with no flagged question that fails `check.mts` (e.g. 15, answer-length bias)?                     | Fixed and re-imported like a flagged one; its attempts go with it.                                                                                                                   | 2026-11-12 |

## Releases

### R1 — Delete mechanism, snippet guard, React quizzes 01–06

**What we do:** Add the snippet cap to the checker, rewrite quizzes 01–06, and ship a migration that deletes their old versions and the path so the new ones and a new path import.
**Customer impact:** Players of the path get React quizzes 01–06 with at most 5 snippets in 25 and lose their old attempts on those six; the path link changes.
**Tracker:** docs/roadmap.md#KQ47

#### Specs

1. [proven] Running `check.mts` on a quiz file with 6 code questions out of 25 and no `advanced` tag prints FAIL with the code-question share.
2. [proven] Running `check.mts` on the same quiz file with an `advanced` tag added prints ok.
3. [proven] Running `check.mts` on `seeds/architect-0[1-6]-*.yaml` prints ok for all six files, each with at most 5 code questions, and none of them carries an `advanced` tag.
4. [proven] On a database holding the old seed quizzes 01–06 and the old path, `pnpm release` leaves exactly one seed quiz per title for 01–06, each with the rewritten question set.
5. [proven] On a database holding the old seed quizzes, a quiz uploaded by a non-seed user titled "Architect Roadmap 01: React fundamentals" still exists after the R1 migration.
6. [proven] On a database holding the old seed quizzes, seed quiz 07 and its attempts still exist after the R1 migration.
7. [proven] On a fresh database, `pnpm release` runs the R1 migration without error and imports every seed, the path included.
8. [proven] After `pnpm release` on a database holding the old content, the "Road to Software Architect" page lists 41 steps and step 1 opens the rewritten React fundamentals quiz.
9. [proven] Reading quizzes 01, 02, 03 and 06, no question turns on an edge case or a trick output; quizzes 04 and 05 may.

### R2 — Next.js and React patterns 07–15

**What we do:** Rewrite 08, 11 and 12, audit 07, 09, 10, 13 and 15 for edge-case trivia and fix the flagged ones, and delete the changed quizzes and the path in a migration.
**Customer impact:** Players get Next.js and pattern quizzes with at most 5 snippets in 25 and lose their old attempts on the changed ones; the path link changes.
**Tracker:** docs/roadmap.md#KQ48

#### Specs

1. [proven] Running `check.mts` on `seeds/architect-0[7-9]-*.yaml seeds/architect-1[0-5]-*.yaml` prints ok for all nine files, each with at most 5 code questions, and none of them carries an `advanced` tag.
2. [proven] The title list in the R2 migration equals the set of quiz files changed in R2, as listed by `git diff --name-only` on `seeds/`.
3. [proven] On a database holding the R1 content, a quiz from 07–15 that R2 left unchanged keeps its attempts after `pnpm release`.
4. [proven] On a database holding the R1 content, `pnpm release` leaves exactly one seed quiz per title for 07–15, each changed one with the R2 question set.
5. [proven] On a fresh database, `pnpm release` runs the R1 and R2 migrations without error and imports every seed, the path included.
6. [proven] After `pnpm release` on a database holding the R1 content, the "Road to Software Architect" page lists 41 steps and step 7 opens the R2 version of quiz 07.
7. [owner-check] Reading quizzes 07–13 and 15, no question turns on an edge case or a trick output; quiz 14 may.

### R3 — Node.js 16–23

**What we do:** Rewrite 16, 17, 18, 19, 21 and 23, audit 20 and 22 for edge-case trivia and fix the flagged ones, and delete the changed quizzes and the path in a migration.
**Customer impact:** Players get Node.js quizzes with at most 5 snippets in 25 and lose their old attempts on the changed ones; the path link changes.
**Tracker:** docs/roadmap.md#KQ49

#### Specs

1. [proven] Running `check.mts` on `seeds/architect-1[6-9]-*.yaml seeds/architect-2[0-3]-*.yaml` prints ok for all eight files, each with at most 5 code questions, and none of them carries an `advanced` tag.
2. [proven] The title list in the R3 migration equals the set of quiz files changed in R3, as listed by `git diff --name-only` on `seeds/`.
3. [proven] On a database holding the R2 content, quiz 24, which R3 left unchanged, keeps its attempts after `pnpm release`.
4. [proven] On a database holding the R2 content, `pnpm release` leaves exactly one seed quiz per title for 16–23, each with the R3 question set.
5. [proven] On a fresh database, `pnpm release` runs the R1–R3 migrations without error and imports every seed, the path included.
6. [proven] After `pnpm release` on a database holding the R2 content, the "Road to Software Architect" page lists 41 steps and step 16 opens the R3 version of quiz 16.
7. [owner-check] Reading quizzes 16–20, 22 and 23, no question turns on an edge case or a trick output; quiz 21 may.

### R4 — Architecture 24–41

**What we do:** Rewrite 25, audit 24 and 27–41 for edge-case trivia and fix the flagged ones, and delete the changed quizzes and the path in a migration.
**Customer impact:** Players get architecture quizzes with at most 5 snippets in 25 and lose their old attempts on the changed ones; the path link changes.
**Tracker:** docs/roadmap.md#KQ50

#### Specs

1. [open] Running `check.mts` on `seeds/architect-2[4-9]-*.yaml seeds/architect-3*.yaml seeds/architect-4*.yaml` prints ok for all eighteen files, each with at most a fifth of its questions carrying code, and none of them carries an `advanced` tag.
2. [open] The title list in the R4 migration equals the set of quiz files changed in R4, as listed by `git diff --name-only` on `seeds/`.
3. [open] On a database holding the R3 content, a quiz from 24–41 that R4 left unchanged keeps its attempts after `pnpm release`.
4. [open] On a database holding the R3 content, `pnpm release` leaves exactly one seed quiz per title for 24–41.
5. [open] On a fresh database, `pnpm release` runs the R1–R4 migrations without error and imports every seed, the path included.
6. [open] After `pnpm release` on a database holding the R3 content, the "Road to Software Architect" page lists 41 steps.
7. [open] Reading quizzes 24, 25 and 27–41, no question turns on an edge case or a trick output; quiz 26 may.

## Proofs

| Spec | Verdict     | Evidence                                                                   |
| ---- | ----------- | -------------------------------------------------------------------------- |
| R1.1 | proven      | .proofs/architect-roadmap-v2/R1.1-six-code-no-advanced-fails.txt           |
| R1.2 | proven      | .proofs/architect-roadmap-v2/R1.2-six-code-advanced-ok.txt                 |
| R1.3 | proven      | .proofs/architect-roadmap-v2/R1.3-seeds-01-06-ok.txt                       |
| R1.4 | proven      | .proofs/architect-roadmap-v2/R1.4-one-seed-quiz-per-title-rewritten.txt    |
| R1.5 | proven      | .proofs/architect-roadmap-v2/R1.5-other-user-quiz-survives.txt             |
| R1.6 | proven      | .proofs/architect-roadmap-v2/R1.6-quiz-07-attempts-survive.txt             |
| R1.7 | proven      | .proofs/architect-roadmap-v2/R1.7-fresh-release.txt                        |
| R1.8 | proven      | .proofs/architect-roadmap-v2/R1.8-path-page.png                            |
| R1.9 | proven      | .proofs/architect-roadmap-v2/R1.9-observation.md                           |
| R2.1 | proven      | .proofs/architect-roadmap-v2/R2.1-check-07-15-ok.txt                       |
| R2.2 | proven      | .proofs/architect-roadmap-v2/R2.2-migration-titles-match-changed-seeds.txt |
| R2.3 | proven      | .proofs/architect-roadmap-v2/R2.3-quiz-14-attempts-survive.txt             |
| R2.4 | proven      | .proofs/architect-roadmap-v2/R2.4-one-quiz-per-title-r2-question-set.txt   |
| R2.5 | proven      | .proofs/architect-roadmap-v2/R2.5-fresh-release.txt                        |
| R2.6 | proven      | .proofs/architect-roadmap-v2/R2.6-path-page.png                            |
| R2.7 | owner-check | .proofs/architect-roadmap-v2/owner-check.md                                |
| R3.1 | proven      | .proofs/architect-roadmap-v2/R3.1-check-16-23-ok.txt                       |
| R3.2 | proven      | .proofs/architect-roadmap-v2/R3.2-migration-titles-match-changed-seeds.txt |
| R3.3 | proven      | .proofs/architect-roadmap-v2/R3.3-quiz-24-attempts-survive.txt             |
| R3.4 | proven      | .proofs/architect-roadmap-v2/R3.4-one-quiz-per-title-r3-question-set.txt   |
| R3.5 | proven      | .proofs/architect-roadmap-v2/R3.5-fresh-release.txt                        |
| R3.6 | proven      | .proofs/architect-roadmap-v2/R3.6-path-page.png                            |
| R3.7 | owner-check | .proofs/architect-roadmap-v2/owner-check.md                                |

## Changelog

- 2026-11-11 — created
- 2026-11-11 — R2.1 reworded
- 2026-11-11 — R3.1 reworded
- 2026-11-11 — R4.1 reworded
- 2026-11-11 — decisions 11 and 12 added, user-authored paths out of scope (feature-check R1 triage)
- 2026-11-11 — R1 merged bc3cef9
- 2026-11-12 — R2.4 and R2.6 reworded (new content, not just one row per title), decision 13 added (feature-check R2 triage)
- 2026-11-12 — R2.7 reopened: edge-case questions left in 07, 09, 11, 13, 15 (feature-check R2)
- 2026-11-12 — R2 merged ef0746d
- 2026-11-12 — R3.3 reworded (every quiz 16–23 changed, so the unchanged neighbour is 24), R3.4 and R3.6 tightened like R2 (feature-check R3 triage)
- 2026-11-12 — R3.7 reopened: trivia questions left in 16, 17, 19, 22, 23 (feature-check R3)
- 2026-11-12 — R3 merged 9329c85
