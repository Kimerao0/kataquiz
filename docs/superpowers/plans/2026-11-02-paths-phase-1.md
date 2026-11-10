# Paths (phase 1, KQ42) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ordered "paths" of existing quizzes, with a path page, signed-in progress from KQ40 tiers, next-step suggestions, and two seed paths.

**Architecture:** Two new tables (`paths`, `path_steps`) and a `src/lib/paths/` module mirroring `src/lib/quizzes/` (file schema, import, seed, queries, progress). Path files ride the existing upload and seed flows, routed by a top-level `kind: path`. UI is server components reading those queries, plus one prop threaded from the run page to the run summary.

**Tech Stack:** Next 16 App Router (read `node_modules/next/dist/docs/` before touching routing), React 19, next-intl (`messages/en.json`), Drizzle 0.45 + Postgres, Zod 4, Vitest (`node` project against real Postgres via `withTestDb`, `jsdom` for `.tsx`).

**Spec:** `docs/specs/2026-11-02-paths.md`

## Global Constraints

- Gate: `pnpm check` (biome + `tsc --noEmit` + vitest + portability). Postgres must be up (`pnpm db:up`, port 55432); see `.claude/context/repo.md` for the "No test files found" trap.
- Never push: a push to `main` deploys production. Commit only; the owner approves every push.
- Code is written by agents from these task specs (owner's rule); each task ends with a `core-workflow:code-reviewer` pass before the next.
- Max **100** steps per path; a quiz at most once per path.
- Path uploads share `UPLOAD_LIMIT` / `UPLOAD_WINDOW_SEC` and the key `upload:<userId>`.
- Run summary lists at most **3** paths; catalog strip shows at most **6** paths.
- Steps: uploaded files reference quizzes by `quiz: <slug>`; seed files by `title: <quiz title>` (seed author's quizzes only). Uploaded files containing `title:` steps are rejected.
- Hidden quizzes and hidden paths never appear; counts and numbering use live steps only.
- Portability: no platform APIs (`scripts/check-portability.sh`).
- Copy lives in `messages/en.json` under a new `paths` namespace; never hardcode English in components.
- Comments explain why, in the repo's voice; small functions, early returns, no nested ternaries.

## Review Focus

- A `?path=` slug for a path that doesn't contain this quiz (or doesn't exist): ignore it and fall back to listing up to 3 paths. Test in Task 5.
- An uploaded path naming a hidden quiz, an unknown slug, or the same quiz twice: rejected with an error naming the step number (1-based). Test in Task 3.
- Every step of a path hidden or deleted: path page shows the empty state, no Continue, no ribbon; the path still lists. Test in Task 5 (queries) and Task 6 (page).
- Re-running the seed: path seeds skip "already imported" by title, and a seed path naming a missing quiz title fails the seed run with the title in the reason. Test in Task 4.
- A quiz in several paths seen by a guest: quiz page lines and catalog badge render with no progress queries for guests. Test in Task 7.

---

### Task 1: Path file schema and parser

**Files:**
- Create: `src/lib/paths/file.ts`
- Test: `src/lib/paths/file.test.ts`

**Interfaces:**
- Produces:
  - `type PathStepRef = { quiz: string } | { title: string }`
  - `type PathFile = { version: 1; kind: 'path'; title: string; description?: string; language: string; steps: PathStepRef[] }`
  - `MAX_PATH_STEPS = 100`
  - `parsePathText(text: string): { ok: true; data: PathFile } | { ok: false; errors: string[] }` — same YAML/JSON handling and error-path format as `parseQuizText` (`src/lib/quiz-schema/index.ts:105`).
  - `isPathText(text: string): boolean` — true when the parsed document is an object with `kind === 'path'`; false on unparseable text (the quiz parser then reports the error).

- [ ] **Step 1: Write failing tests** in `file.test.ts`:
  - `parses a path with slug steps` → `ok: true`, `data.steps` equals `[{ quiz: 'a-1' }, { quiz: 'b-2' }]`.
  - `parses title steps` → `[{ title: 'Architect Roadmap 01: React fundamentals' }]`.
  - `rejects more than 100 steps` → `ok: false`, an error starting `steps:`.
  - `rejects a duplicate step` → two `{ quiz: 'a-1' }` → error mentioning step `2` (1-based).
  - `rejects a step with both quiz and title` and `rejects an empty steps list`.
  - `isPathText` true for `kind: path` YAML and JSON, false for a quiz file (`seeds/typescript-basics.yaml` text) and for `"{"`.
- [ ] **Step 2: Run** `npx vitest run src/lib/paths/file.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** with Zod: `title` 1–200, `language` 1–10, `steps` 1–100, each step a strict object with exactly one of `quiz` (1–200) / `title` (1–200). Duplicate check as a `superRefine` over the step's key value.
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Commit** `feat: parse path files (KQ42)`.

### Task 2: Tables and migration

**Files:**
- Modify: `src/db/schema.ts` (after `quizzes`/`attempts`; add relations near the others)
- Create: `drizzle/0006_*.sql` + snapshot via `pnpm db:generate`
- Test: `src/db/schema.test.ts`

**Interfaces:**
- Produces: `paths` (`id uuid pk`, `slug text unique not null`, `authorId text → user.id on delete set null`, `title text not null`, `description text`, `language text not null`, `isHidden boolean not null default false`, `createdAt timestamptz not null default now()`), `pathSteps` (`id uuid pk`, `pathId uuid not null → paths.id cascade`, `quizId uuid not null → quizzes.id cascade`, `position integer not null`, `unique(pathId, position)`, `unique(pathId, quizId)`, `index(quizId)`).

- [ ] **Step 1: Write failing tests** in `schema.test.ts`, following its existing style: `deleting a quiz deletes its path steps`; `a quiz cannot appear twice in one path` (second insert rejects); `deleting a path deletes its steps`.
- [ ] **Step 2: Run** `npx vitest run src/db/schema.test.ts` → FAIL.
- [ ] **Step 3: Implement** the tables, then `pnpm db:generate` and `pnpm db:migrate`. Check the SQL is exactly two `CREATE TABLE`s, their FKs and indexes.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: add paths and path_steps tables (KQ42)` (schema, migration, snapshot, journal).

### Task 3: Import a path, and accept it on /upload

**Files:**
- Create: `src/lib/paths/import.ts`, `src/lib/paths/import.test.ts`
- Modify: `src/app/(app)/upload/actions.ts`, `src/app/(app)/upload/upload-form.tsx`, `src/app/(app)/upload/format-help.tsx`, `messages/en.json`
- Test: `src/app/(app)/upload/actions.test.ts`, `src/app/(app)/upload/upload-form.test.tsx`

**Interfaces:**
- Consumes: `PathFile`, `parsePathText`, `isPathText` (Task 1); `slugify`, `SLUG_SUFFIX_LENGTH`-style slugging from `src/lib/quizzes/import.ts` (export what's needed rather than duplicating).
- Produces:
  - `class PathStepError extends Error { step: number }` (1-based step number in the message: `step <n>: ...`, matching the parser's duplicate error; `steps.<n>` stays Zod's 0-based path only).
  - `importPath(params: { file: PathFile; authorId: string; resolveBy: 'slug' | 'seedTitle'; executor?: Executor }): Promise<{ pathId: string; slug: string }>` — resolves every step to a live (not hidden) quiz id, throws `PathStepError` for an unknown/hidden quiz, for two steps that resolve to the same quiz id (e.g. a `quiz:` and a `title:` step naming one quiz — the parser only compares step text), or for a `title` step when `resolveBy === 'slug'`; inserts the path and its steps (positions 1..n) in one transaction, with the same executor/transaction rule as `importQuiz`.
  - `UploadResult` becomes `{ ok: true; kind: 'quiz' | 'path'; slug: string } | { ok: false; errors: string[] }`; the form navigates to `/q/<slug>` or `/p/<slug>` by `kind`.

- [ ] **Step 1: Write failing tests**:
  - `import.test.ts`: `imports steps in file order` (positions 1,2,3 match the file); `rejects an unknown slug` → `PathStepError` with `step === 2`; `rejects a hidden quiz`; `rejects a title step when resolving by slug`; `resolves seed titles among the seed author's quizzes only` (a same-titled quiz by another author is not matched).
  - `actions.test.ts`: `accepts a path file and returns kind path`; `a path upload spends the upload limit` (11th upload in the window is refused, mixing quiz and path uploads); `returns the step error for a hidden quiz`.
  - `upload-form.test.tsx`: `navigates to /p/<slug> after a path upload`.
- [ ] **Step 2: Run** the three files → FAIL.
- [ ] **Step 3: Implement.** In `uploadQuizAction`, after size checks: `isPathText(text)` routes to `parsePathText` + `importPath({ resolveBy: 'slug' })`, mapping `PathStepError` to `errors: [error.message]`. Format help gains a short "Path files" section with a 3-step YAML example.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: upload path files (KQ42)`.

### Task 4: Seed paths, and the two first paths

**Files:**
- Modify: `src/lib/quizzes/seed.ts`, `src/lib/quizzes/seed.test.ts`, `scripts/seed.mts` (output line names paths), `src/lib/quiz-schema/seed-files.test.ts` (must not fail on path files)
- Create: `seeds/path-road-to-software-architect.yaml`, `seeds/path-aws-cloud-practitioner.yaml`

**Interfaces:**
- Consumes: `isPathText`, `parsePathText`, `importPath({ resolveBy: 'seedTitle' })`.
- Produces: `seedQuizzes` imports **all quiz files first, then path files** (paths reference quizzes); `SeedOutcome` unchanged in shape; a path already imported (same title, seed author) is `skipped` with `ALREADY_IMPORTED`; a `PathStepError` is a `skipped` outcome whose reason contains the missing title, which `scripts/seed.mts` already treats as a failing build.

- [ ] **Step 1: Write failing tests** in `seed.test.ts` (use a temp dir fixture like the existing tests): `imports a path after the quizzes it names` (path file sorts before its quiz file alphabetically); `skips a path already imported`; `reports a path naming a missing quiz title`.
- [ ] **Step 2: Run** `npx vitest run src/lib/quizzes/seed.test.ts src/lib/quiz-schema/seed-files.test.ts` → FAIL.
- [ ] **Step 3: Implement**, then write the two seed files: Architect = the 41 `Architect Roadmap NN: …` titles from `seeds/architect-*.yaml` in number order; AWS = the 25 `AWS Cloud Practitioner NN: …` titles in order, then `AWS Cloud Practitioner: Mock exam (CLF-C02)`. Titles copied from the files (`grep -h '^title:' seeds/...`), never retyped.
- [ ] **Step 4: Run** → PASS, then `pnpm db:seed` locally → `imported path-…` for both, and a second run skips both.
- [ ] **Step 5: Commit** `feat: seed paths, starting with Architect and AWS (KQ42)`.

### Task 5: Path queries and progress

**Files:**
- Create: `src/lib/paths/queries.ts`, `src/lib/paths/queries.test.ts`, `src/lib/paths/progress.ts`, `src/lib/paths/progress.test.ts`

**Interfaces:**
- Consumes: tables (Task 2); `getBestTiers` (`src/lib/quizzes/progress.ts:14`); `Tier`, `bestTier` (`src/lib/run/engine.ts`).
- Produces (all exclude hidden paths and hidden quizzes; positions are 1-based over live steps):
  - `type LiveStep = { position: number; quizId: string; quizSlug: string; quizTitle: string }`
  - `type PathDetail = { id: string; slug: string; title: string; description: string | null; authorName: string | null; steps: LiveStep[] }`
  - `getPath(slug: string, executor?): Promise<PathDetail | null>`
  - `type PathCard = { slug: string; title: string; stepCount: number; quizIds: string[] }` (live steps' quiz ids, so a page can compute ribbons with one `getBestTiers` call)
  - `listPaths(params: { page: number; pageSize: number; executor? }): Promise<{ items: PathCard[]; total: number }>` — newest first.
  - `type PathPlacement = { pathSlug: string; pathTitle: string; position: number; total: number; previous: LiveStep | null; next: LiveStep | null }`
  - `getPlacements(quizId: string, executor?): Promise<PathPlacement[]>` — every path containing the quiz, newest path first.
  - `getPlacementsForQuizzes(quizIds: string[], executor?): Promise<Map<string, PathPlacement[]>>` — one query, for the catalog.
  - `nextSuggestions(placements: PathPlacement[], pathSlug: string | null): PathPlacement[]` — pure: the requested path only when it's among `placements`, else the first 3.
  - `type StepStatus = 'todo' | 'toPerfect' | 'perfected'`
  - `stepStatus(tier: Tier | null): StepStatus`; `pathTier(stepTiers: (Tier | null)[]): Tier | null` (null for an empty list; otherwise the worst step tier, and null if any step is null).
  - `continueTarget(steps: LiveStep[], tiers: Map<string, Tier> | null): { step: LiveStep; mode: 'continue' | 'perfect' } | null` — `tiers === null` (guest) → first step, `continue`.
  - `getPathProgress(userId: string, path: PathDetail, executor?): Promise<Map<string, Tier>>` — `getBestTiers` over the path's quiz ids.

- [ ] **Step 1: Write failing tests**:
  - `queries.test.ts`: `getPath skips a hidden quiz and renumbers` (steps 1,2,3 with 2 hidden → positions 1,2); `getPath returns a path with no live steps with steps []`; `getPath returns null for a hidden path`; `getPlacements gives previous and next`; `getPlacementsForQuizzes returns every path for each quiz`; `listPaths counts live steps only`.
  - `progress.test.ts` (pure): `nextSuggestions keeps only the requested path`; `nextSuggestions ignores a path that does not contain the quiz and returns up to 3`; `pathTier is gold only when every step is gold`; `pathTier is bronze when the weakest step is bronze`; `pathTier is null with an unpassed step` and `for no steps`; `continueTarget goes to the first step not passed`; `switches to perfect mode once all are passed`; `returns null when every step is gold`; `sends a guest to the first step`.
- [ ] **Step 2: Run** both files → FAIL.
- [ ] **Step 3: Implement.** `pathTier`'s "worst tier" is the inverse of `bestTier`: add `worstTier` next to `bestTier` in `engine.ts` rather than duplicating `TIER_RANK`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: path queries and progress (KQ42)`.

### Task 6: Path page `/p/[slug]`

**Files:**
- Create: `src/app/(app)/p/[slug]/page.tsx`, `src/components/paths/path-steps.tsx`, `src/components/paths/path-steps.test.tsx`
- Modify: `messages/en.json` (`paths.*`)

**Interfaces:**
- Consumes: `getPath`, `getPathProgress`, `continueTarget`, `stepStatus`, `pathTier` (Task 5); `readPlayer`/`getCurrentUser` as the quiz page does; the KQ40 ribbon component used on the quiz page.
- Produces: `PathSteps({ pathSlug, steps, tiers }: { pathSlug: string; steps: LiveStep[]; tiers: Map<string, Tier> | null })` — ordered list; each row links to `/q/<quizSlug>/run?path=<pathSlug>`; with `tiers`, each row shows its status and ribbon.

Page shape (same shell and Suspense pattern as `src/app/(app)/q/[slug]/page.tsx`): title, description, author, "N steps", for signed-in players a progress line (`{done} done · {perfected} perfected · {left} left`) and the path ribbon, the Continue / Perfect next button (`continueTarget`), then `PathSteps`. Unknown or hidden slug → `notFound()`. No live steps → `paths.emptyBody` and no button. `generateMetadata` gives the path title.

- [ ] **Step 1: Write failing tests** in `path-steps.test.tsx`: `links every step to its run with the path`; `shows no status for a guest`; `marks steps todo, to perfect and perfected from tiers`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** component and page; copy keys: `paths.stepCount`, `paths.progress`, `paths.continue`, `paths.perfectNext`, `paths.status.todo|toPerfect|perfected`, `paths.emptyBody`.
- [ ] **Step 4: Run** → PASS; then `pnpm build && pnpm start` and `pnpm shots /p/<architect slug>` at all widths, both themes. Open the PNGs.
- [ ] **Step 5: Commit** `feat: path page (KQ42)`.

### Task 7: Browsing — `/paths`, catalog strip, header link, row badge, quiz page lines

**Files:**
- Create: `src/app/(app)/paths/page.tsx`, `src/components/paths/path-card.tsx`, `src/components/paths/path-badge.tsx`, `src/components/paths/path-placements.tsx`, tests next to each component
- Modify: `src/app/(app)/page.tsx` (strip above the list; badges per row), `src/app/(app)/q/[slug]/page.tsx` (placement lines), `src/components/site-header.tsx` (nav link "Paths" between Browse and Upload, icon below 640px like its siblings), `messages/en.json`

**Interfaces:**
- Consumes: `listPaths`, `getPlacements`, `getPlacementsForQuizzes` (Task 5).
- Produces: `PathCardView({ card, tier }: { card: PathCard; tier: Tier | null })` (ribbon when `tier` is set); `PathBadge({ placements }: { placements: PathPlacement[] })` renders `"<title> · <position>/<total>"` plus `"+<n>"` when more than one, linking to `/p/<first.pathSlug>`, nothing for `[]`; `PathPlacements({ placements })` renders one line per path: "Step <position> of <total> in <title>" with previous/next links.

- [ ] **Step 1: Write failing tests**: `path-badge.test.tsx` — `shows the first path and its position`, `adds +N for more paths`, `renders nothing without paths`; `path-placements.test.tsx` — `links previous and next`, `omits previous on step 1 and next on the last step`; `path-card.test.tsx` — `shows title and step count`, `shows the ribbon when a tier is given`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Catalog: one `getPlacementsForQuizzes` call per page (never per row); strip = `listPaths({ page: 1, pageSize: 6 })` with "See all" to `/paths`. `/paths` paginates with `PAGE_SIZE` like the catalog. Path cards: for a signed-in player, one `getBestTiers` over the union of the listed cards' `quizIds`, then `pathTier` per card; guests get `tier: null` and no progress query. Badges and placement lines never read progress.
- [ ] **Step 4: Run** → PASS; `pnpm build`, then `pnpm shots /`, `/paths`, `/q/<an architect slug>` at all widths. Check the header at 375 still fits.
- [ ] **Step 5: Commit** `feat: browse paths from the catalog, header and quiz page (KQ42)`.

### Task 8: Next step in the run summary

**Files:**
- Modify: `src/app/(app)/q/[slug]/run/page.tsx`, `src/components/run/run-start-panel.tsx`, `src/components/run/run-player.tsx`, `src/components/run/run-summary.tsx`, `messages/en.json`
- Create: `src/components/paths/path-next.tsx`, `src/components/paths/path-next.test.tsx`
- Test: `src/components/run/run-summary.test.tsx`

**Interfaces:**
- Consumes: `getPlacements`, `nextSuggestions` (Task 5).
- Produces: the run page reads `searchParams.path` (string or absent), computes `suggestions = nextSuggestions(await getPlacements(quiz.id), path ?? null)` server-side, and threads `pathNext: PathPlacement[]` through `RunStartPanel` → `RunPlayer` → `RunSummary` (optional prop, default `[]`; challenge runs don't pass it). `PathNext({ placements })`: per placement, "Next in <title>: <next.quizTitle>" linking to `/q/<next.quizSlug>/run?path=<pathSlug>`, or "Last step of <title>" linking to `/p/<pathSlug>` when `next === null`.

- [ ] **Step 1: Write failing tests**: `path-next.test.tsx` — `links the next step keeping the path`, `points to the path page on the last step`, `renders nothing without placements`; `run-summary.test.tsx` — `shows the next step after a finished run`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Read the Next 16 docs on `searchParams` in pages before wiring it (it's a Promise). Play again keeps the same `pathNext`.
- [ ] **Step 4: Run** → PASS; then on a build, play an Architect step from the path page with Playwright (pattern in this session's `kq37.mjs`): the summary shows the next Architect step, and the link keeps `?path=`.
- [ ] **Step 5: Commit** `feat: suggest the next step of a path after a run (KQ42)`.

### Task 9: Close out

- [ ] **Step 1:** `pnpm check` green; `core-workflow:code-reviewer` over the whole branch against the spec (spec axis included).
- [ ] **Step 2:** Update `README.md`'s file-format section with path files; move KQ42 to `docs/roadmap-archive-2026-11.md` with the closing commit and anything that deviated from the spec.
- [ ] **Step 3:** Commit `docs: close KQ42`. **Stop: ask the owner before pushing** (the push runs the migration and imports both seed paths on production).
