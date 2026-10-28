# Grindstone

You learn a body of rules faster by answering hundreds of questions and looking up only the ones you got wrong than by reading theory front to back. The correction lands while the question is still in your head.

Grindstone is that loop for any subject. Upload a question bank, drill it, and challenge someone with a link.

- Upload a quiz as a YAML or JSON file; it is validated before anything is stored.
- Drill it: random questions, immediate feedback, an explanation and an optional theory link after each answer.
- Share a `/c/<attemptId>` link. The challenger plays the same ordered questions, as a guest if they like.

Built with Next.js (App Router), TypeScript, Postgres, Drizzle and Better Auth. Self-hosting notes are in [docs/self-hosting.md](docs/self-hosting.md). The full product spec is in [docs/specs/2026-10-27-grindstone-v1.md](docs/specs/2026-10-27-grindstone-v1.md).

## Quiz file format

A quiz is one `.yaml`, `.yml` or `.json` file. This example uses every field, including the optional ones:

```yaml
version: 1
title: Italian Driving Licence - Road Signs
description: Signs and right-of-way rules.   # optional
language: it
tags: [driving, italy]                       # optional, defaults to []
run:
  questionsPerRun: 3
  maxErrors: 1
  timePerQuestionSec: 30                     # optional; omit for untimed
questions:
  - type: single
    prompt: What does a red triangular sign mean?
    imageUrl: https://example.com/sign.png   # optional
    explanation: Triangular signs warn of danger ahead.   # optional
    theoryUrl: https://example.com/theory#signs           # optional
    options:
      - { text: Warning, correct: true }
      - { text: Prohibition, correct: false }
      - { text: Obligation, correct: false }
  - type: multi
    prompt: Which of these are mandatory when overtaking?
    options:
      - { text: Check the road ahead is clear, correct: true }
      - { text: Signal your intention, correct: true }
      - { text: Sound the horn, correct: false }
  - type: boolean
    prompt: You may park on a pedestrian crossing.
    answer: false
```

A file that fails validation writes nothing. Every error is reported, not just the first.

| Field | Rule |
| --- | --- |
| `version` | Must be `1`. |
| `title` | Required, 1 to 200 characters. |
| `description` | Optional string. |
| `language` | Required, 1 to 10 characters. |
| `tags` | Optional, at most 10 tags of at most 30 characters each. |
| `questions` | 1 to 1000 questions. |
| `run.questionsPerRun` | Integer, at least 1 and at most the number of questions. |
| `run.maxErrors` | Integer, 0 up to `questionsPerRun`. |
| `run.timePerQuestionSec` | Optional integer, 5 to 600. Omit for untimed. |
| `prompt` | 1 to 2000 characters. |
| `type: single` | 2 to 10 options, exactly one with `correct: true`. |
| `type: multi` | 2 to 10 options, at least one with `correct: true`. |
| `type: boolean` | `answer` (true or false) required; `options` is forbidden. Stored as two options, True and False. |
| option `text` | 1 to 500 characters. |
| `imageUrl`, `theoryUrl` | Optional. Must be a valid `http:` or `https:` URL. |
| `explanation` | Optional string. |
| file size | At most 1 MiB (1,048,576 bytes), checked on upload. |

The source of truth is [`src/lib/quiz-schema/index.ts`](src/lib/quiz-schema/index.ts). It is a zod schema that imports nothing from the app.

## Run rules

- A run samples `questionsPerRun` distinct questions at random from the bank, so every run differs.
- Feedback is immediate and per question: right or wrong, plus the explanation and theory link.
- If `timePerQuestionSec` is set, the timer stops the moment you answer. Reading the explanation is untimed.
- A timeout counts as wrong, and the explanation is still shown.
- `multi` questions are all-or-nothing: correct only if your selection is exactly the correct set.
- A run passes if the number of errors is at most `maxErrors`.
- The client never receives which options are correct until it has submitted an answer.

## Local development

Requires Node 24, pnpm 11 and Docker. Postgres runs in a Docker container for development and tests; the app itself is not containerised.

```bash
pnpm install
cp .env.example .env.local   # then edit; see Configuration
pnpm db:up                   # starts Postgres 17 in Docker
pnpm db:migrate              # applies the migrations in ./drizzle
pnpm dev                     # http://localhost:3000
```

The container from `compose.yaml` uses user, password and database `grindstone` on port 5432, so in `.env.local` set:

```bash
DATABASE_URL=postgres://grindstone:grindstone@localhost:5432/grindstone
```

`pnpm db:down` stops the container. Other scripts: `pnpm db:generate` (create a migration from schema changes), `pnpm db:studio`, `pnpm format`.

## Running the tests

```bash
pnpm check
```

`pnpm check` is the single gate: Biome lint, `tsc --noEmit`, then the Vitest suite. It is exactly what CI runs.

Tests run against a real Postgres, not mocks. The `grindstone_test` database is created by `pnpm db:up`, its URL is in the committed `.env.test`, and the suite applies migrations to it before running. Database tests isolate themselves by running inside a transaction that is always rolled back. For watch mode, use `pnpm test`.

## Configuration

Copy `.env.example` to `.env.local`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection string, used through the `pg` driver. Any Postgres works. |
| `BETTER_AUTH_SECRET` | Yes in production | Signs sessions and the guest identity cookie. Guest identities cannot be created without it. |
| `BETTER_AUTH_URL` | Yes in production | Public base URL of this instance, for example `http://localhost:3000` in development. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | No | GitHub OAuth app credentials. Both are needed to enable GitHub sign-in. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | No | Google OAuth app credentials. Both are needed to enable Google sign-in. |

OAuth is optional and the app runs without it, but then nobody can sign in. The sign-in page only offers providers whose credentials are both set.

## License

MIT. See [LICENSE](LICENSE).
