# Grindstone v1 — Spec

**Date:** 2026-10-27
**Status:** approved (grill-me session)
**One line:** Upload a question bank, drill it, challenge people with a link.

---

## 1. Premise

Learning by volume and immediate correction, not by reading theory first. The
reference experience: skim the theory once, then answer hundreds of quiz
questions, and every time you are wrong, look up exactly the rule you missed.
The correction lands while the question is still in your head.

Grindstone is the tool for that loop, for any subject, not just driving licences.

## 2. Scope

**Milestone 1 (this plan): upload -> play -> share.**
Accounts, file upload, public catalog with search, a timed run with immediate
feedback, challenge links with guest play.

**Milestone 2 (next plan, still v1): in-app editor, per-question error-rate
stats for authors, report button and admin hide.**

> Note: during the session the editor was first put "in v1" and later the chosen
> first milestone explicitly cut it. Reconciled as: the editor ships in v1, as
> Milestone 2, before public launch. The upload schema is the contract; the
> editor is a UI that produces the same JSON.

**Out of scope for v1:** spaced repetition, retry-mistakes mode, free-text
questions, image hosting, live head-to-head duels, public REST API, Docker
packaging, non-English UI.

## 3. Domain model

- **Quiz** — a question bank owned by one user. Public to everyone. Carries its
  own run settings and tags.
- **Question** — belongs to a quiz. One of three types: `single` (one correct
  option), `multi` (several correct options), `boolean` (true/false, stored as
  two options so everything downstream is uniform). Optional explanation and
  optional external theory URL, both shown after answering.
- **Option** — belongs to a question. Carries `isCorrect`, which must never
  reach the client before that question has been answered.
- **Attempt** — one run of a quiz by one player (user or guest). Stores the exact
  ordered question ids it was built from, so a challenge can be replayed.
- **AttemptAnswer** — one row per answered question: what was selected, whether
  it was right, how long it took, whether it timed out.

## 4. Quiz file format

Single YAML or JSON file, validated by a zod schema that lives in its own folder
and imports nothing from the app.

```yaml
version: 1
title: Italian Driving Licence - Road Signs
description: Signs and right-of-way rules.
language: it
tags: [driving, italy]
run:
  questionsPerRun: 30
  maxErrors: 3
  timePerQuestionSec: 30 # optional; omit for untimed
questions:
  - type: single
    prompt: What does a red triangular sign mean?
    imageUrl: https://example.com/sign.png # optional
    explanation: Triangular signs warn of danger ahead. # optional
    theoryUrl: https://example.com/theory#signs # optional
    options:
      - { text: Warning, correct: true }
      - { text: Prohibition, correct: false }
  - type: boolean
    prompt: You may park on a pedestrian crossing.
    answer: false
```

**Validation rules (all enforced, all tested):**

| Rule                     | Value                                                                             |
| ------------------------ | --------------------------------------------------------------------------------- |
| `version`                | must be `1`                                                                       |
| `single`                 | exactly one correct option, at least 2 options                                    |
| `multi`                  | at least one correct option, at least 2 options                                   |
| `boolean`                | `answer` required, `options` forbidden; normalized to two options                 |
| `questionsPerRun`        | 1..questions.length                                                               |
| `maxErrors`              | 0..questionsPerRun                                                                |
| `timePerQuestionSec`     | absent, or 5..600                                                                 |
| `imageUrl` / `theoryUrl` | `http:` or `https:` only                                                          |
| limits                   | <= 1000 questions, <= 10 options per question, prompt <= 2000 chars, file <= 1 MB |

A file that fails validation writes nothing: the whole import is one transaction.

## 5. Run rules

- A run samples `questionsPerRun` distinct questions at random from the bank.
  Every run is different, so the order cannot be memorised.
- **Feedback is immediate and per question.** Answer, see right/wrong plus the
  explanation and theory link, then move on. There is no end-of-run reveal.
- **Timer, when set, measures answering only.** The clock runs while the question
  is unanswered and stops the instant an answer is submitted. Reading the
  explanation is untimed, deliberately: learning is the goal, speed is not.
- **Timeout counts as wrong**, and the explanation is still shown.
- **`multi` is scored all-or-nothing**: correct only if the selected set is
  exactly the correct set.
- A run passes if errors <= `maxErrors`.
- **The client never receives `isCorrect` before submitting.** Each answer is a
  server round trip that returns correctness, the correct option ids and the
  explanation. This is a hard requirement, not an optimisation.

## 6. Challenge

- Finishing a run yields a shareable link, `/c/<attemptId>`.
- The challenger plays **the same ordered question set**, so the comparison is fair.
- The challenger sees the challenger's own result first, and the opponent's score
  only after finishing. No anchoring, no spoilers.
- Guests play without an account, with a nickname. They get an anonymous signed
  httpOnly cookie id, and their attempts are stored like anyone else's.
- Scores are fakeable by a determined person. That is acceptable for friendly
  challenges and explicitly not defended against in v1.
- Quizzes are edited in place with no versioning, so a replayed set skips
  questions that no longer exist and plays what remains.

## 7. Accounts and permissions

- Better Auth, GitHub and Google OAuth only. No email infrastructure in v1.
- Any signed-in user can author quizzes. All quizzes are public.
- An `admin` role can hide a quiz (Milestone 2).

## 8. Moderation and content rights

- Terms place content rights on the uploader: you must own or have the right to
  what you upload.
- Report button plus admin hide, and a takedown contact (Milestone 2).
- Official exam banks are not banned outright, since that is the originating use
  case.

## 9. Discovery

- Public catalog, searchable by title and description via Postgres full-text
  search, filterable by author-supplied tags. No external search service.

## 10. Platform and non-functional

- **One app, one config surface.** The hosted instance is simply the first
  deployment of it. There is no separate "self-hosted edition".
- **Portable by construction:** no Vercel-only and no Neon-only APIs. Everything
  is configured through environment variables.
- Database is any Postgres via `DATABASE_URL`, using the plain `pg` driver.
  Neon is reached through its pooler like any other Postgres.
- Rate limiting lives in a Postgres table. No Redis, no KV.
- Docker packaging is deliberately deferred until a self-hoster asks for it. The
  README states this plainly rather than shipping an artifact that will rot.
- UI is English, routed through next-intl from day one so another language is a
  file, not a refactor.
- Quiz content is user-supplied and public, so every rendered string is treated
  as untrusted.

## 11. Stack

| Concern         | Choice                | Version at planning time |
| --------------- | --------------------- | ------------------------ |
| Framework       | Next.js App Router    | 16.4.3                   |
| Runtime         | Node                  | 24.x                     |
| Package manager | pnpm                  | 11.x                     |
| Language        | TypeScript, strict    | 5.x                      |
| Lint/format     | Biome                 | 2.6.3                    |
| Tests           | Vitest                | 5.0.5                    |
| Validation      | zod                   | 4.6.7                    |
| ORM             | Drizzle + drizzle-kit | 0.45.4 / 0.31.11         |
| DB driver       | pg                    | 8.23.1                   |
| Auth            | Better Auth           | 1.7.14                   |
| UI              | Tailwind + shadcn/ui  | 4.3.3                    |
| i18n            | next-intl             | 4.14.9                   |
| License         | MIT                   |                          |

## 12. Decisions log — what was rejected and why

| Decision        | Chosen                                       | Rejected because                                                                     |
| --------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| ORM             | Drizzle                                      | Prisma adds codegen and a heavier runtime for no gain here                           |
| Theory delivery | Optional explanation + optional external URL | Hosting theory docs is a second product                                              |
| Repetition      | None in v1                                   | Spaced repetition needs users who come back; every answer is stored so it stays open |
| Attempt storage | Every answer                                 | Score-only blocks stats and retry-mistakes without a migration                       |
| Multi scoring   | All-or-nothing                               | Partial credit is hard to explain and unlike real exams                              |
| Timer           | Per-question, paused on feedback             | A whole-run budget punishes reading the explanation                                  |
| Guest play      | Allowed, nickname only                       | A login wall kills the share link                                                    |
| Versioning      | Edit in place                                | Snapshots are schema work for a problem nobody has yet                               |
| Images          | External URLs                                | Blob storage is infra for both hosts and an abuse surface                            |
| Self-hosting    | Portable now, Docker later                   | The Dockerfile is work for users who do not exist; portability is not                |
| Rate limiting   | Postgres table                               | Redis/KV is a second service self-hosters must run                                   |
| DB driver       | pg only                                      | Neon's HTTP driver is faster and Neon-specific; one path beats two                   |
| Name            | Grindstone                                   | "Drill", "Ace", "Prova" too generic or already taken                                 |
