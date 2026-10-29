# Kataquiz

You learn a body of rules faster by answering hundreds of questions and looking up only the ones you got wrong than by reading theory front to back. The correction lands while the question is still in your head.

Kataquiz is that loop for any subject. Upload a question bank, drill it, and challenge someone with a link.

- Upload a quiz as a YAML or JSON file; it is validated before anything is stored.
- Drill it: random questions, immediate feedback, an explanation and an optional theory link after each answer.
- Share a `/c/<attemptId>` link. The challenger plays the same ordered questions, as a guest if they like.

Built with Next.js (App Router), TypeScript, Postgres, Drizzle and Better Auth. Self-hosting notes are in [docs/self-hosting.md](docs/self-hosting.md). The full product spec is in [docs/specs/2026-10-27-kataquiz-v1.md](docs/specs/2026-10-27-kataquiz-v1.md).

## Quiz file format

A quiz is one `.yaml`, `.yml` or `.json` file. This example uses every field except the two code fields, which get their own example under [Code in questions](#code-in-questions):

```yaml
version: 1
title: Italian Driving Licence - Road Signs
description: Signs and right-of-way rules. # optional
language: it
tags: [driving, italy] # optional, defaults to []
run:
  questionsPerRun: 3
  maxErrors: 1
  timePerQuestionSec: 30 # optional; omit for untimed
questions:
  - type: single
    prompt: What does a red triangular sign mean?
    imageUrl: https://example.com/sign.png # optional
    explanation: Triangular signs warn of danger ahead. # optional
    theoryUrl: https://example.com/theory#signs # optional
    options:
      - { text: Prohibition, correct: false }
      - { text: Warning, correct: true }
      - { text: Obligation, correct: false }
  - type: multi
    prompt: Which of these are mandatory when overtaking?
    options:
      - { text: Sound the horn, correct: false }
      - { text: Check the road ahead is clear, correct: true }
      - { text: Signal your intention, correct: true }
  - type: boolean
    prompt: You may park on a pedestrian crossing.
    answer: false
```

A file that fails validation writes nothing. Every error is reported, not just the first.

| Field                    | Rule                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `version`                | Must be `1`.                                                                                      |
| `title`                  | Required, 1 to 200 characters.                                                                    |
| `description`            | Optional string.                                                                                  |
| `language`               | Required, 1 to 10 characters.                                                                     |
| `tags`                   | Optional, at most 10 tags of at most 30 characters each.                                          |
| `questions`              | 1 to 1000 questions.                                                                              |
| `run.questionsPerRun`    | Integer, at least 1 and at most the number of questions.                                          |
| `run.maxErrors`          | Integer, 0 up to `questionsPerRun`.                                                               |
| `run.timePerQuestionSec` | Optional integer, 5 to 600. Omit for untimed.                                                     |
| `prompt`                 | 1 to 2000 characters.                                                                             |
| `type: single`           | 2 to 10 options, exactly one with `correct: true`.                                                |
| `type: multi`            | 2 to 10 options, at least one with `correct: true`.                                               |
| `type: boolean`          | `answer` (true or false) required; `options` is forbidden. Stored as two options, True and False. |
| option `text`            | 1 to 500 characters.                                                                              |
| `imageUrl`, `theoryUrl`  | Optional. Must be a valid `http:` or `https:` URL.                                                |
| `explanation`            | Optional string.                                                                                  |
| `code`                   | Optional, 1 to 2000 characters. Rendered as a block under the prompt.                             |
| `codeLanguage`           | Optional, at most 20 characters, lowercase letters, digits, `+`, `#` and `-` only.                |
| file size                | At most 1 MiB (1,048,576 bytes), checked on upload.                                               |

The source of truth is [`src/lib/quiz-schema/index.ts`](src/lib/quiz-schema/index.ts). It is a zod schema that imports nothing from the app.

### Code in questions

Question banks about programming contain code, and a snippet pasted into a sentence is unreadable. There are two ways to write it, and they are independent — a question may use either, both or neither.

**A backtick span is inline code.** Inside any `prompt`, option `text` or `explanation`, a pair of single backticks marks a short span — an identifier, a keyword, an expression — and it is rendered as inline code:

```yaml
prompt: "What is the type of `x` here?"
```

The rules are deliberately forgiving, so an author who typed a backtick for some other reason never loses the rest of their sentence:

- An unpaired backtick is a literal backtick. It does not open a span that runs to the end of the text.
- An empty pair, ` ` ``, is two literal backticks, not an empty span. The same rule makes a markdown-style ` ``double`` ` run literal.
- `` \` `` is a literal backtick. A backslash anywhere else is itself literal.
- A span is never trimmed, and may contain newlines.

**The `code` field is a block.** For anything longer than a span — a function, several lines, anything with indentation that matters — put the snippet in `code` and let the prompt ask the question in prose. `codeLanguage` is an optional hint for highlighting:

```yaml
- type: single
  prompt: "What is the type of `x` where the comment is?"
  code: |
    function f(x: string | number) {
      if (typeof x === 'string') {
        // here
      }
    }
  codeLanguage: typescript
  explanation: "`typeof x === 'string'` is a type guard, so the union narrows to `string`."
  options:
    - { text: "`string | number`", correct: false }
    - { text: "`string`", correct: true }
```

Neither mechanism is markdown and neither produces HTML. Quiz content is user-supplied and public, so the parser in [`src/lib/quiz-schema/inline-code.ts`](src/lib/quiz-schema/inline-code.ts) returns a list of plain `{ kind, value }` segments and the UI renders them as React children. Nothing in a quiz file is ever interpreted as markup.

## Run rules

- A run samples `questionsPerRun` distinct questions at random from the bank, so every run differs.
- Option order is shuffled per run, so you cannot learn the position instead of the rule. Write your options in whatever order reads best; do not write options that depend on their position ("all of the above").
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

The container from `compose.yaml` uses user, password and database `kataquiz` on port 55432, so in `.env.local` set:

```bash
DATABASE_URL=postgres://kataquiz:kataquiz@localhost:55432/kataquiz
```

`pnpm db:seed` imports the quizzes in `seeds/`, so a fresh database opens with something to play instead of an empty catalog. It is idempotent: a quiz it has already imported is skipped, so running it twice leaves exactly one copy of each. Those files double as worked examples of the file format.

`pnpm db:down` stops the container. Other scripts: `pnpm db:generate` (create a migration from schema changes), `pnpm db:studio`, `pnpm format`.

## Running the tests

```bash
pnpm check
```

`pnpm check` is the single gate: Biome lint, `tsc --noEmit`, then the Vitest suite. It is exactly what CI runs.

Tests run against a real Postgres, not mocks. The `kataquiz_test` database is created by `pnpm db:up`, its URL is in the committed `.env.test`, and the suite applies migrations to it before running. Database tests isolate themselves by running inside a transaction that is always rolled back. For watch mode, use `pnpm test`.

## Configuration

Copy `.env.example` to `.env.local`.

| Variable                                   | Required          | Purpose                                                                                      |
| ------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                             | Yes               | Postgres connection string, used through the `pg` driver. Any Postgres works.                |
| `BETTER_AUTH_SECRET`                       | Yes in production | Signs sessions and the guest identity cookie. Guest identities cannot be created without it. |
| `BETTER_AUTH_URL`                          | Yes in production | Public base URL of this instance, for example `http://localhost:3000` in development.        |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | No                | GitHub OAuth app credentials. Both are needed to enable GitHub sign-in.                      |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | No                | Google OAuth app credentials. Both are needed to enable Google sign-in.                      |

OAuth is optional and the app runs without it, but then nobody can sign in. The sign-in page only offers providers whose credentials are both set.

## License

MIT. See [LICENSE](LICENSE).
