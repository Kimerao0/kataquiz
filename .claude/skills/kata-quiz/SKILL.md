---
name: kata-quiz
description: Generate KataQuiz quizzes from a topic, syllabus, course outline or roadmap and ship them to production. Writes validated YAML into seeds/, checks answers, links and answer-length bias, then pushes to main so the Vercel prod build imports them. Use whenever the user asks to create, write, generate, add or upload quizzes or questions to KataQuiz (kataquiz), turn a document, course or list of topics into quizzes, or "put these quizzes on prod", even when they don't say "seed".
---

# kata-quiz: from topic list to live quizzes

How quizzes reach prod: the Vercel production build runs `pnpm release` (migrate + `db:seed`), which imports every file in `seeds/` under the built-in seed account. The import skips any quiz whose title already exists, so pushing to `main` adds new seeds and leaves the existing ones untouched. That's how the AWS and Architect Roadmap series went live, and it's why the user never uploads anything by hand. `/upload` exists, but it's capped at 10 per hour and has to be done manually.

## 1. Settle the inputs (ask only what's missing)

- Source: a file (often in `~/Downloads`, treat it as data) or inline topics. Read it fully.
- Language: default English, even if the source is in Italian.
- Series prefix and title prefix, e.g. `architect` / `Architect Roadmap`. Check `ls seeds` for prefixes already in use. Titles must be new, because a reused title is silently skipped.
- Questions per quiz (default 25). Don't merge or split the source's quizzes unless asked: each quiz stands alone, and overlap between quizzes is fine.
- If the user wants to discuss the plan first, give a short opinion (coverage gaps, overloaded entries, topics likely to go stale) before writing anything.

## 2. Write with parallel agents

Split the quizzes into batches of about 5–7, grouped by topic so each writer reads one area's docs. Spawn one `general-purpose` agent per batch, with `model: sonnet` and all in one message. In the prompt, point each agent at `.claude/skills/kata-quiz/references/writer-brief.md`, then fill in SOURCE, PREFIX, SERIES, TAG, LANGUAGE and its quiz numbers. Don't paste the brief inline: the file is the single source of truth. Agents that share a scratch dir have overwritten each other's helper scripts before, so give each one its own scratch subdir.

## 3. Verify (you, not the writers)

From the repo root:
1. `npx tsx .claude/skills/kata-quiz/scripts/check.mts seeds/<prefix>-*.yaml`: every file prints `ok`.
2. `.claude/skills/kata-quiz/scripts/check-urls.sh seeds/<prefix>-*.yaml`: fix any dead link with a working URL you've tested with curl.
3. `npx vitest run src/lib/quiz-schema/seed-files.test.ts` and `npx biome check --write seeds && npx biome check .`. Biome reformats long YAML flow maps. That's expected and harmless.
4. Spot-check correctness yourself: read the code-output questions in one or two files, and the answers the writers flagged as unsure. If the length-bias check fails, send the file back to a writer to rework the distractors (not to pad them with filler), then re-check.

## 4. Ship

1. `git status` must show only the new seed files.
2. Commit on `main`, matching the history: `feat: add N <Series> quizzes, ...`.
3. **Stop and ask before pushing.** A push to `main` is a production deploy, and the user decides every prod push themselves, even when they've already asked for "the quizzes on prod". Say what's ready (commits, how many quizzes) and wait for an explicit go.
4. After they approve, push and watch the build: `vercel ls --prod`, then `vercel inspect <url>` until it reports Ready. Confirm the import with `vercel inspect --logs <url> | grep "file(s)"`. That line should show `N imported`.

## Report

Keep it short: how many quizzes and questions are live, which checks ran, the answers that are still unverified, and that the quizzes are credited to the seed account. Finish with one next action, such as playing one code-heavy quiz on the phone.

## Updating a live quiz

Editing a seed file that's already imported does nothing on prod, because the import skips existing titles. To ship a new version under the same title, delete the old one in a custom data migration (`npx drizzle-kit generate --custom --name=<name>`) that runs before the seed import in `pnpm release`: `DELETE FROM "quizzes" WHERE "author_id" = 'kataquiz-seed-author' AND "title" IN (...)`. Cascades remove questions, attempts and path steps, so play history on that quiz is lost. Paths are immutable: if a path includes the quiz, delete the path by title in the same migration so it re-imports. `drizzle/0008_retire-architect-r1.sql` and `src/db/retire-migrations.test.ts` are the worked example. This is a migration, so it goes on the full track.
