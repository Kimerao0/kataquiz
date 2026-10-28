# Contributing

Stack: Next.js App Router, TypeScript (strict), Postgres with Drizzle, Better Auth, zod, Tailwind and shadcn/ui, next-intl, Biome, Vitest, pnpm.

## Getting a working checkout

Requires Node 24, pnpm 11 and Docker.

```bash
pnpm install
cp .env.example .env.local   # set DATABASE_URL=postgres://grindstone:grindstone@localhost:5432/grindstone
pnpm db:up
pnpm db:migrate
pnpm dev
```

See the [README](README.md) for details.

## Before opening a PR

```bash
pnpm check
```

It runs Biome, `tsc --noEmit` and the test suite, and is exactly what CI runs. It must pass. `pnpm format` fixes formatting.

## Tests

- Tests go next to what they test: `foo.ts` is covered by `foo.test.ts`; component tests are `.test.tsx`.
- They run against a real Postgres, not mocks. Use `withTestDb` from `src/test/db.ts` to run a test in a transaction that is rolled back.
- Anything touching scoring or authorisation needs a test that fails when the behaviour regresses.

## Commit style

Conventional-commit prefixes, lower-case, imperative:

```
feat: add challenge links with deferred score reveal
fix: sign the guest identity cookie
test: give the upload guards and import atomicity real teeth
chore: set up shadcn/ui and pin better-auth to a vetted release
```

## House rules

- Strict TypeScript. No `any`.
- Formatting and lint are Biome's; do not hand-format against it.
- Quiz content is user-supplied and public. Never render it as HTML; treat every string as untrusted.
- The client must not learn which options are correct before the answer is submitted.
- The quiz file format is defined by `src/lib/quiz-schema`, which imports nothing from the app. Keep it that way.
- UI strings go through next-intl (`messages/`), not literals in components.
