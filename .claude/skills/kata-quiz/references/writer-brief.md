# Writer brief (hand this file to each writer agent)

The orchestrator fills in: SOURCE (topic list / roadmap path or inline text), PREFIX (file prefix, e.g. `architect`), SERIES (title prefix, e.g. `Architect Roadmap`), TAG (series tag), LANGUAGE, and your assigned quiz numbers.

You are writing quiz YAML files for KataQuiz (repo root: the current working directory). Write ONLY your assigned files. Do not edit anything else, do not commit, do not run the test suite.

## Where and how

- Path: `seeds/<PREFIX>-NN-short-kebab-slug.yaml` (NN = two-digit number from the source). `seeds/` is flat: no subfolders.
- Schema: `src/lib/quiz-schema/index.ts`. Question types: `single`, `multi`, `boolean`; optional `code` + `codeLanguage`, `theoryUrl`, `explanation`.
- Look at one existing seed for style, e.g. `seeds/architect-16-node-event-loop.yaml` (code questions) or `seeds/aws-ccp-05-vpc.yaml`.

Header:
```yaml
version: 1
title: "<SERIES> NN: <Topic title>" # titles must be unique: the importer dedupes by title
description: <one sentence listing the subtopics>
language: <LANGUAGE, e.g. en>
tags: [<TAG>, <area tag>, <2-4 topic tags>]
run:
  questionsPerRun: 10
  maxErrors: 3
  timePerQuestionSec: 60 # 90 for scenario-heavy or code-heavy quizzes
questions:
```

## Content

- 25 questions per quiz unless told otherwise. Cover every subtopic in the source entry, roughly evenly.
- Mix theory, "what does this code print / in what order", and scenario trade-offs ("system X with constraint Y: what do you choose?"). Follow any per-quiz emphasis in the source (e.g. "[SCENARIO]" means at least 60% scenarios).
- Mostly `single` with 4 options, some `multi` (the prompt says "Select all that apply."), a few `boolean`.
- Distractors are real misconceptions, as specific and qualified as the correct answer. Players learn to pick the longest, most hedged option, so make some distractors the longest and keep the correct answer tight. Options are shuffled at runtime, so position doesn't matter.
- `explanation`: 2-4 sentences on why the right answer is right and why the tempting wrong ones are wrong.
- `theoryUrl` on every question: a specific page on an authoritative source. Only use URLs you're confident exist.
- Limits: prompt and code ≤ 2000 chars, option ≤ 500 chars. Use `|` block scalars for code. Quote strings containing `: ` or `#`.

## Correctness

- Run every code-output snippet with `node` before writing the answer, in a scratch dir outside the repo. CommonJS and ESM order `nextTick` vs promises differently: put `{"type":"commonjs"}` in the scratch dir's package.json and say "CommonJS" in the prompt when it matters. Drop snippets whose output is genuinely non-deterministic.
- For framework topics that match a dependency of this repo (Next.js, React, Zod, Drizzle…), base answers on the installed version: `node_modules/next/dist/docs/` for Next. Don't teach deprecated APIs as current.
- Every `single` question has exactly one defensible answer.

## Before you finish

From the repo root:
- `npx tsx .claude/skills/kata-quiz/scripts/check.mts seeds/<your files>`: every file must print `ok`. It fails on missing url or explanation, and when the correct option is the uniquely longest or shortest in more than 30% of single questions.
- `.claude/skills/kata-quiz/scripts/check-urls.sh seeds/<your files>`: no output means all links load. Fix any it prints.

## Report back (short)

Per file: name, question count, code-question count. Then a list of the answers you are not fully sure of, with the reason for each. Nothing else.
