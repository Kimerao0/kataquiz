# Grindstone Milestone 1 — Upload, Play, Share — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user can upload a quiz file, anyone can find it and drill it with immediate per-question feedback, and finishing a run produces a link that challenges someone else on the same question set.

**Architecture:** One Next.js App Router application over one Postgres database. All writes go through plain functions in `src/lib/**`; Server Actions are thin wrappers over them, so a REST import endpoint can reuse the same functions later. Quiz correctness never reaches the browser before an answer is submitted: each answer is a server round trip. The quiz file schema lives in `src/lib/quiz-schema/` and imports nothing from the app, so it can become a published package later.

**Tech Stack:** Next.js 16.4.3, React 19.3.1, TypeScript strict, pnpm 11, Biome 2.6.3, Vitest 5.0.5, zod 4.6.7, Drizzle 0.45.4 + drizzle-kit 0.31.11, pg 8.23.1, Better Auth 1.7.14, Tailwind 4.3.3 + shadcn/ui, next-intl 4.14.9.

**Spec:** `docs/specs/2026-10-27-grindstone-v1.md`

## Global Constraints

- Node 24.x, pnpm 11.x. `packageManager` pinned in `package.json`.
- TypeScript `strict: true`. No `any` in committed code.
- No Vercel-only and no Neon-only APIs. Database access is `pg` + `DATABASE_URL` only.
- No Redis, no KV, no blob storage. Postgres is the only datastore.
- Every user-visible string goes through next-intl. UI language is English.
- Quiz content is untrusted, public, user-supplied: never rendered as HTML, never trusted as a URL without scheme validation.
- `isCorrect` must not appear in any payload sent to the client for an unanswered question.
- License MIT. `LICENSE` at repo root.
- Commit after every task. Conventional Commits (`feat:`, `test:`, `chore:`).

## Review Focus

Five conditions the spec implies that no feature test would naturally cover. Each has a test assigned to the task that owns the code.

1. **A run is requested for more questions than the bank still holds** — sample what exists rather than throwing or looping forever. _(Task 6)_
2. **A challenge replays a set whose questions were since deleted** — skip the missing ids and play the remainder. _(Task 10)_
3. **The same question is answered twice** (double-click, reload, replayed request) — the second submission is rejected and does not alter the score. _(Task 7)_
4. **An oversized or malformed upload** — the size cap is enforced before parsing, and a failed import writes nothing. _(Task 4)_
5. **Hostile quiz content** — `<script>` in a prompt renders as literal text, and a `javascript:` image or theory URL is rejected at validation. _(Task 1 for URLs, Task 9 for rendering)_

---

### Task 1: Scaffold, toolchain, and the quiz file schema

**Files:**
- Create: `package.json`, `tsconfig.json`, `biome.json`, `vitest.config.ts`, `.github/workflows/ci.yml`, `LICENSE`, `.env.example`
- Create: `src/lib/quiz-schema/index.ts`, `src/lib/quiz-schema/types.ts`
- Test: `src/lib/quiz-schema/quiz-schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type QuestionType = 'single' | 'multi' | 'boolean'`
  - `type ParsedOption = { text: string; correct: boolean }`
  - `type ParsedQuestion = { type: QuestionType; prompt: string; imageUrl?: string; explanation?: string; theoryUrl?: string; options: ParsedOption[] }`
  - `type QuizFile = { version: 1; title: string; description?: string; language: string; tags: string[]; run: { questionsPerRun: number; maxErrors: number; timePerQuestionSec?: number }; questions: ParsedQuestion[] }`
  - `parseQuizText(text: string): { ok: true; data: QuizFile } | { ok: false; errors: string[] }`

- [ ] **Step 1: Scaffold the project**

`git init` first — the repo does not exist yet, and every task ends in a commit. Then `pnpm create next-app` with App Router, TypeScript, Tailwind, no src-dir prompt overridden to use `src/`. Then add Biome, Vitest, zod, and `yaml`. Set `"packageManager": "pnpm@11"`, `strict: true`, and scripts: `check` (`biome check . && tsc --noEmit && vitest run`), `test`, `db:generate`, `db:migrate`.

- [ ] **Step 2: Write the failing schema tests**

```ts
// src/lib/quiz-schema/quiz-schema.test.ts
describe('parseQuizText', () => {
  it('parses a minimal valid YAML quiz') // ok === true, questions.length === 2
  it('parses the same quiz as JSON') // same data
  it('normalizes a boolean question into two options') // options === [{text:'True',correct:false},{text:'False',correct:true}] for answer:false
  it('rejects a single question with two correct options') // errors[0] matches /exactly one correct/
  it('rejects a single question with one option') // /at least 2 options/
  it('rejects a multi question with no correct option') // /at least one correct/
  it('rejects a boolean question that also declares options') // /options/
  it('rejects questionsPerRun greater than the question count')
  it('rejects maxErrors greater than questionsPerRun')
  it('rejects timePerQuestionSec of 1 and of 601') // bounds 5..600
  it('accepts an omitted timePerQuestionSec')
  it('rejects a javascript: imageUrl') // Review Focus 5
  it('rejects a javascript: theoryUrl')
  it('rejects version 2')
  it('reports every validation error, not just the first') // errors.length === 2 for a file with two bad questions
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/quiz-schema`
Expected: FAIL, `parseQuizText` is not defined.

- [ ] **Step 4: Implement the schema**

Build `quizFileSchema` in `src/lib/quiz-schema/index.ts` per the table in spec section 4. Use a zod discriminated union on `type`, with `superRefine` for the cross-field rules (`questionsPerRun <= questions.length`, `maxErrors <= questionsPerRun`). Normalize `boolean` to two options in a `transform` so every downstream consumer sees `options`. `parseQuizText` detects JSON by a leading `{`, otherwise parses YAML, and returns flattened zod issues as `errors`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm check`
Expected: biome clean, tsc clean, all schema tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: scaffold project and add quiz file schema"
```

---

### Task 2: Database schema, migrations, and the integration test harness

**Files:**
- Create: `src/db/schema.ts`, `src/db/client.ts`, `drizzle.config.ts`, `src/test/db.ts`
- Modify: `.github/workflows/ci.yml` (add a `postgres:17` service and `DATABASE_URL`)
- Test: `src/db/schema.test.ts`

**Interfaces:**
- Consumes: `QuestionType` from Task 1.
- Produces:
  - `db` — the Drizzle instance in `src/db/client.ts`, built on a `pg` `Pool` from `DATABASE_URL`.
  - Tables: `quizzes`, `questions`, `options`, `attempts`, `attemptAnswers`, `rateLimits`, plus the Better Auth tables added in Task 3.
  - `withTestDb(fn)` in `src/test/db.ts` — runs `fn` inside a transaction that is always rolled back.

- [ ] **Step 1: Write the failing schema test**

```ts
// src/db/schema.test.ts
it('stores a quiz with questions and options and reads them back')
// insert 1 quiz, 2 questions, 4 options; select with relations; expect counts 2 and 4
it('cascades deletes from quiz to questions to options')
// delete the quiz; expect 0 questions and 0 options remain
it('rejects two quizzes with the same slug') // unique violation
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/db`
Expected: FAIL, no such table.

- [ ] **Step 3: Define the schema and generate the migration**

In `src/db/schema.ts`:
- `quizzes`: `id` uuid pk, `slug` text unique, `authorId` text fk -> user, `title`, `description`, `language`, `tags` `text[]`, `questionsPerRun` int, `maxErrors` int, `timePerQuestionSec` int null, `isHidden` boolean default false, `createdAt`, `updatedAt`.
- `questions`: `id` uuid pk, `quizId` fk cascade, `position` int, `type` enum, `prompt` text, `imageUrl`, `explanation`, `theoryUrl`.
- `options`: `id` uuid pk, `questionId` fk cascade, `position` int, `text` text, `isCorrect` boolean.
- `attempts`: `id` uuid pk, `quizId` fk, `userId` text null, `guestId` text null, `nickname` text null, `questionIds` `uuid[]`, `challengeOfAttemptId` uuid null, `score` int default 0, `errors` int default 0, `startedAt`, `finishedAt` null.
- `attemptAnswers`: `id` uuid pk, `attemptId` fk cascade, `questionId` fk, `selectedOptionIds` `uuid[]`, `isCorrect` boolean, `elapsedMs` int, `timedOut` boolean, `answeredAt`; unique on `(attemptId, questionId)` — this is what enforces Review Focus 3.
- `rateLimits`: `key` text pk, `windowStart` timestamptz, `count` int.

Run `pnpm db:generate`, commit the generated SQL.

- [ ] **Step 4: Add the CI Postgres service and the test harness**

`src/test/db.ts` exports `withTestDb`, which opens a transaction, passes a scoped `db` to the callback, and rolls back in a `finally`. CI gains a `postgres:17` service plus a migrate step before `pnpm check`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm db:migrate && pnpm vitest run src/db`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add database schema, migrations and test harness"
```

---

### Task 3: Authentication

**Files:**
- Create: `src/lib/auth.ts`, `src/lib/session.ts`, `src/app/api/auth/[...all]/route.ts`
- Modify: `src/db/schema.ts` (Better Auth tables), `.env.example`
- Test: `src/lib/session.test.ts`

**Interfaces:**
- Consumes: `db` from Task 2.
- Produces:
  - `auth` — the Better Auth instance, Drizzle adapter, GitHub and Google providers.
  - `getCurrentUser(): Promise<{ id: string; name: string; image: string | null } | null>`
  - `requireUser(): Promise<{ id: string; name: string; image: string | null }>` — throws `UnauthorizedError` when there is no session.

- [ ] **Step 1: Write the failing session tests**

```ts
it('getCurrentUser returns null when no session cookie is present')
it('requireUser throws UnauthorizedError when no session cookie is present')
it('getCurrentUser returns the user when a valid session exists')
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/lib/session`
Expected: FAIL, module not found.

- [ ] **Step 3: Configure Better Auth and the session helpers**

Wire the Drizzle adapter to `db`, enable `github` and `google` social providers reading `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, and generate the auth tables into `src/db/schema.ts`. `getCurrentUser` reads the session from `headers()`; `requireUser` wraps it and throws.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add GitHub and Google authentication"
```

---

### Task 4: Quiz import

**Files:**
- Create: `src/lib/quizzes/import.ts`, `src/app/(app)/upload/page.tsx`, `src/app/(app)/upload/actions.ts`, `messages/en.json`, `src/i18n/request.ts`
- Test: `src/lib/quizzes/import.test.ts`

**Interfaces:**
- Consumes: `parseQuizText`, `QuizFile` (Task 1); `db` (Task 2); `requireUser` (Task 3).
- Produces:
  - `MAX_UPLOAD_BYTES = 1_048_576`
  - `importQuiz(params: { file: QuizFile; authorId: string }): Promise<{ quizId: string; slug: string }>`
  - `uploadQuizAction(formData: FormData): Promise<{ ok: true; slug: string } | { ok: false; errors: string[] }>`

- [ ] **Step 1: Write the failing import tests**

```ts
it('creates the quiz, its questions and its options from a valid file')
// counts match the file; options keep their declared order
it('generates a slug from the title with a short unique suffix')
it('writes nothing when a question fails validation') // Review Focus 4
// quiz count unchanged after a rejected import
it('rejects a payload larger than MAX_UPLOAD_BYTES before parsing')
// Review Focus 4: assert the error is the size error, not a parse error
it('rejects an unauthenticated upload') // UnauthorizedError
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/lib/quizzes/import`
Expected: FAIL, `importQuiz` is not defined.

- [ ] **Step 3: Implement `importQuiz` and the action**

`importQuiz` runs one `db.transaction` inserting the quiz, then its questions and options with their positions. Slug is a slugified title plus a 6-character nanoid. `uploadQuizAction` calls `requireUser`, checks the byte length against `MAX_UPLOAD_BYTES` **before** calling `parseQuizText`, and returns the error list unchanged on failure.

- [ ] **Step 4: Set up next-intl and build the upload page**

This is the first UI in the project, so it carries the i18n setup: install and configure next-intl with a single `en` locale, create `messages/en.json`, and wrap the app layout in the provider. Every string on this page is read from `messages/en.json` — none are inline literals, which is what keeps a second locale a file rather than a refactor.

The page itself is a file input plus a textarea for pasting, posting to `uploadQuizAction`, rendering `errors` as a list and redirecting to `/q/<slug>` on success.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: import quiz files from upload"
```

---

### Task 5: Catalog and search

**Files:**
- Create: `src/lib/quizzes/search.ts`, `src/app/(app)/page.tsx`, `src/app/(app)/q/[slug]/page.tsx`
- Modify: `src/db/schema.ts` (generated `tsvector` column plus GIN indexes), new migration
- Test: `src/lib/quizzes/search.test.ts`

**Interfaces:**
- Consumes: `db` (Task 2).
- Produces:
  - `type QuizSummary = { id: string; slug: string; title: string; description: string | null; tags: string[]; questionCount: number; authorName: string }`
  - `searchQuizzes(params: { q?: string; tag?: string; page?: number }): Promise<{ items: QuizSummary[]; total: number }>`
  - `getQuizBySlug(slug: string): Promise<QuizSummary | null>`

- [ ] **Step 1: Write the failing search tests**

```ts
it('finds a quiz by a word in its title')
it('finds a quiz by a word in its description')
it('filters by tag')
it('excludes hidden quizzes')
it('returns an empty page rather than throwing for page 99')
it('paginates at 20 per page and reports the true total')
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/lib/quizzes/search`
Expected: FAIL.

- [ ] **Step 3: Add the search column and implement the query**

Add a stored generated column `searchVector` = `to_tsvector('simple', title || ' ' || coalesce(description,''))` with a GIN index, and a GIN index on `tags`. `searchQuizzes` builds a `websearch_to_tsquery` match when `q` is present, an array-contains filter when `tag` is present, always filters `isHidden = false`, and orders by rank then `createdAt desc`.

- [ ] **Step 4: Build the catalog page and the quiz detail page**

Catalog lists `QuizSummary` cards with a search box and tag chips. The detail page shows title, description, tags, question count and run settings, with a Start button.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add quiz catalog with full-text search and tags"
```

---

### Task 6: Run engine (pure logic)

**Files:**
- Create: `src/lib/run/engine.ts`
- Test: `src/lib/run/engine.test.ts`

**Interfaces:**
- Consumes: nothing. No database, no imports from the app — this is the part worth testing hardest.
- Produces:
  - `sampleQuestionIds(ids: string[], n: number, rng: () => number): string[]`
  - `gradeAnswer(correctOptionIds: string[], selectedOptionIds: string[]): boolean`
  - `isTimedOut(elapsedMs: number, limitSec: number | null): boolean`
  - `TIMER_GRACE_MS = 2000`
  - `hasPassed(errors: number, maxErrors: number): boolean`

- [ ] **Step 1: Write the failing engine tests**

```ts
describe('sampleQuestionIds', () => {
  it('returns n distinct ids drawn from the input')
  it('returns every id, shuffled, when n equals the input length')
  it('returns all available ids when n exceeds the input length') // Review Focus 1
  it('returns an empty array for an empty bank') // Review Focus 1
  it('is deterministic for a seeded rng') // same rng -> same order
})
describe('gradeAnswer', () => {
  it('is true for the single correct option')
  it('is false for the wrong single option')
  it('is true only for the exact correct set in a multi question') // all-or-nothing
  it('is false for a correct subset') // ['a'] vs ['a','b']
  it('is false for a superset including a wrong option') // ['a','b','c']
  it('ignores the order of selected ids')
  it('is false for an empty selection')
})
describe('isTimedOut', () => {
  it('is false when limitSec is null, whatever the elapsed time')
  it('is false at exactly the limit')
  it('is false within the grace margin') // limit 30s, elapsed 31s
  it('is true beyond the limit plus grace') // limit 30s, elapsed 33s
})
describe('hasPassed', () => {
  it('passes at exactly maxErrors')
  it('fails at maxErrors + 1')
  it('fails any error when maxErrors is 0')
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/lib/run/engine`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the engine**

Fisher-Yates over a copy using `rng`, sliced to `Math.min(n, ids.length)`. `gradeAnswer` compares sets by size then membership. `isTimedOut` returns `false` for a null limit, otherwise `elapsedMs > limitSec * 1000 + TIMER_GRACE_MS`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add run sampling, grading and timer rules"
```

---

### Task 7: Run flow and attempt storage

**Files:**
- Create: `src/lib/run/service.ts`, `src/app/(app)/q/[slug]/actions.ts`
- Test: `src/lib/run/service.test.ts`

**Interfaces:**
- Consumes: engine functions (Task 6); `db` (Task 2); `getCurrentUser` (Task 3).
- Produces:
  - `type Player = { kind: 'user'; userId: string } | { kind: 'guest'; guestId: string; nickname: string }`
  - `type PublicOption = { id: string; text: string }` — **no `isCorrect` field exists on this type**
  - `type PublicQuestion = { id: string; type: QuestionType; prompt: string; imageUrl: string | null; options: PublicOption[] }`
  - `type RunSummary = { attemptId: string; score: number; errors: number; total: number; passed: boolean }`
  - `type AnswerResult = { correct: boolean; correctOptionIds: string[]; explanation: string | null; theoryUrl: string | null; next: PublicQuestion | null; summary: RunSummary | null }`
  - `startRun(params: { quizId: string; player: Player; challengeOfAttemptId?: string }): Promise<{ attemptId: string; question: PublicQuestion; total: number; timePerQuestionSec: number | null }>`
  - `submitAnswer(params: { attemptId: string; questionId: string; selectedOptionIds: string[]; elapsedMs: number; player: Player }): Promise<AnswerResult>`

- [ ] **Step 1: Write the failing service tests**

```ts
describe('startRun', () => {
  it('creates an attempt holding questionsPerRun question ids')
  it('returns the first question with options but no correctness')
  // Object.keys of every option === ['id','text']  <- the hard requirement
  it('returns a different question order on two consecutive runs') // statistical: 10 runs, not all identical
})
describe('submitAnswer', () => {
  it('stores the answer, marks it correct and returns the explanation')
  it('marks a wrong answer and still returns the explanation and theory URL')
  it('marks a late answer as timed out and counts it as an error') // elapsed beyond limit + grace
  it('rejects a second answer to the same question') // Review Focus 3
  // throws DuplicateAnswerError; errors and score unchanged
  it('rejects an answer from a player who does not own the attempt')
  it('rejects an answer to a question that is not in this attempt')
  it('returns the next question until the set is exhausted')
  it('returns a summary with passed=true when errors <= maxErrors on the final answer')
  it('returns a summary with passed=false when errors exceed maxErrors')
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/lib/run/service`
Expected: FAIL.

- [ ] **Step 3: Implement the service**

`startRun` loads the quiz's question ids, calls `sampleQuestionIds` with `Math.random`, inserts the attempt with the resulting `questionIds`, and returns the first `PublicQuestion` — built by an explicit projection that selects only `id` and `text` from options, never a spread. `submitAnswer` verifies ownership and membership, loads the correct option ids server-side, calls `isTimedOut` then `gradeAnswer` (a timeout is always wrong regardless of selection), inserts the `attemptAnswers` row letting the unique constraint raise `DuplicateAnswerError`, updates the running score, and returns the next question or the summary.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add run flow with server-side grading"
```

---

### Task 8: Guest identity and rate limiting

**Files:**
- Create: `src/lib/guest.ts`, `src/lib/rate-limit.ts`
- Modify: `src/app/(app)/q/[slug]/actions.ts` (apply the limit to `startRun`)
- Test: `src/lib/rate-limit.test.ts`, `src/lib/guest.test.ts`

**Interfaces:**
- Consumes: `db` (Task 2).
- Produces:
  - `getOrCreateGuestId(): Promise<string>` — reads or sets a signed httpOnly `gs_guest` cookie, 1 year.
  - `checkRateLimit(key: string, limit: number, windowSec: number): Promise<boolean>` — `true` when the call is allowed.
  - `RUN_START_LIMIT = 30`, `RUN_START_WINDOW_SEC = 3600`

- [ ] **Step 1: Write the failing tests**

```ts
describe('checkRateLimit', () => {
  it('allows the first call for a new key')
  it('allows calls up to the limit')
  it('blocks the call after the limit')
  it('allows again once the window has elapsed') // windowStart moved into the past
  it('keeps counters for different keys independent')
  it('counts concurrent calls exactly once each') // 10 parallel calls, limit 5 -> exactly 5 allowed
})
describe('getOrCreateGuestId', () => {
  it('sets a new httpOnly cookie when none is present')
  it('reuses the existing id when the cookie is present')
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/lib/rate-limit src/lib/guest`
Expected: FAIL.

- [ ] **Step 3: Implement both**

`checkRateLimit` is a single `INSERT ... ON CONFLICT (key) DO UPDATE` that resets `count` to 1 when `windowStart` is older than the window and otherwise increments, returning the new count — one statement, so the concurrency test passes. `getOrCreateGuestId` uses `cookies()` with `httpOnly`, `sameSite: 'lax'`, `secure` in production. The run action keys the limit on the forwarded IP.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add guest identity and Postgres rate limiting"
```

---

### Task 9: Play UI

**Files:**
- Create: `src/components/run/run-player.tsx`, `src/components/run/question-card.tsx`, `src/components/run/feedback-panel.tsx`, `src/components/run/question-timer.tsx`, `src/components/run/run-summary.tsx`
- Create: `src/app/(app)/q/[slug]/run/page.tsx`
- Modify: `messages/en.json`
- Test: `src/components/run/run-player.test.tsx`

**Interfaces:**
- Consumes: `PublicQuestion`, `AnswerResult`, `RunSummary`, `startRun`, `submitAnswer` (Task 7).
- Produces: the client run experience. No new exported functions.

- [ ] **Step 1: Configure the component test environment**

Add `@testing-library/react`, `@testing-library/user-event` and `jsdom`, and give `vitest.config.ts` a `jsdom` environment for `src/components/**` while the `src/lib/**` tests stay on `node`. Component tests call the server actions through a stub, since Task 7 already tests them for real.

- [ ] **Step 2: Write the failing component tests**

```ts
it('renders the prompt and its options')
it('renders a script tag in a prompt as literal text') // Review Focus 5
// queryByText('<script>alert(1)</script>') is found; container has no <script> element
it('submits a single-choice answer on click and shows the feedback panel')
it('requires an explicit Confirm for a multi question') // selecting does not submit
it('shows the explanation and a theory link after answering')
it('stops the timer once an answer is submitted') // timer text frozen after submit
it('auto-submits an empty answer when the timer reaches zero')
it('does not render a timer when timePerQuestionSec is null')
it('shows the summary with score and pass state after the final question')
it('disables the options while the answer request is in flight') // Review Focus 3, client half
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm vitest run src/components/run`
Expected: FAIL.

- [ ] **Step 4: Build the components**

`run-player.tsx` is the client component holding the current question, the in-flight flag and the running progress. Options render through React children, never `dangerouslySetInnerHTML`. `question-timer.tsx` counts down from `timePerQuestionSec`, stops on submit, and fires the auto-submit at zero. `feedback-panel.tsx` shows correct/incorrect, the correct options, the explanation, the theory link, and a Next button; it has no time limit by design.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add the run player UI with immediate feedback"
```

---

### Task 10: Challenge links

**Files:**
- Create: `src/lib/run/challenge.ts`, `src/app/(app)/c/[attemptId]/page.tsx`, `src/components/run/challenge-result.tsx`
- Modify: `src/components/run/run-summary.tsx` (add the share link)
- Test: `src/lib/run/challenge.test.ts`

**Interfaces:**
- Consumes: `startRun`, `submitAnswer`, `RunSummary`, `Player` (Task 7); `getOrCreateGuestId` (Task 8).
- Produces:
  - `type ChallengeInvite = { attemptId: string; quizSlug: string; quizTitle: string; opponentName: string; questionCount: number }`
  - `getChallenge(attemptId: string): Promise<ChallengeInvite | null>`
  - `startChallengeRun(params: { attemptId: string; player: Player }): Promise<ReturnType<typeof startRun>>`
  - `getChallengeComparison(myAttemptId: string): Promise<{ mine: RunSummary; theirs: RunSummary } | null>`

- [ ] **Step 1: Write the failing challenge tests**

```ts
it('getChallenge returns the invite without revealing the opponent score')
// the returned object has no score-bearing key
it('startChallengeRun replays the same ordered question ids')
it('skips questions deleted since the original run') // Review Focus 2
// delete 2 of 10; the new attempt holds the remaining 8, in the same relative order
it('starts no run when every question of the set was deleted') // returns null, does not throw
it('getChallengeComparison returns null before the challenger has finished')
it('getChallengeComparison returns both summaries once finished')
it('refuses to compare an attempt that is not a challenge of another')
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/lib/run/challenge`
Expected: FAIL.

- [ ] **Step 3: Implement the challenge functions**

`startChallengeRun` reads the source attempt's `questionIds`, filters them against the questions that still exist (preserving order), and inserts a new attempt with `challengeOfAttemptId` set. `getChallengeComparison` returns `null` unless the challenger's attempt has a `finishedAt`, which is what keeps the opponent's score hidden until the end.

- [ ] **Step 4: Build the challenge page and the share link**

`/c/[attemptId]` shows who challenged you, the quiz, the question count and a nickname field for guests, then runs the same player component. The summary screen gains a copyable `/c/<attemptId>` link.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add challenge links with deferred score reveal"
```

---

### Task 11: Deployment configuration and documentation

**Files:**
- Create: `README.md`, `docs/self-hosting.md`, `CONTRIBUTING.md`, `.github/ISSUE_TEMPLATE/quiz-bug.md`
- Modify: `.env.example`, `next.config.ts`
- Test: production build

**Interfaces:**
- Consumes: the whole application.
- Produces: no code interfaces. The deliverable is a deployable repository.

- [ ] **Step 1: Document the full environment surface**

`.env.example` lists every variable with a comment: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. No variable may be read anywhere outside this list.

- [ ] **Step 2: Verify there is no platform lock-in**

Run: `grep -rnE "@vercel/|@neondatabase/|process\.env\.VERCEL" src/`
Expected: no matches. This is the test for the portability constraint.

- [ ] **Step 3: Write the README and the self-hosting note**

README covers what Grindstone is, the quiz file format with a working example, local setup, and the environment variables. `docs/self-hosting.md` states plainly: any Postgres via `DATABASE_URL`, no Docker image yet, open an issue if you want one.

- [ ] **Step 4: Verify the production build**

Run: `pnpm build`
Expected: build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "docs: add README, self-hosting notes and environment reference"
```
