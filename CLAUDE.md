@AGENTS.md

# Kataquiz

Read `.claude/context/repo.md` (gates, tracker, how to look at the UI) and `.claude/context/lenses.md`
(defect shapes this repo has produced) before any code work. They hold the detail; this file only
points at it.

- **Pushing deploys production.** Trunk on `main`, no PRs. Every push to `main` triggers the Vercel prod
  build, which runs `pnpm release` (migrations + seed import) against the prod database. Commit and
  merge freely; **never push without the owner's go-ahead for that specific push.**
- **Gate:** `pnpm check` (biome, `tsc`, vitest, portability). Vitest needs Postgres on **55432**
  (`pnpm db:up`). A stopped database shows up as `No test files found`, not as a connection error:
  check `docker ps` first.
- **Tracker:** `docs/roadmap.md`, ids `KQnn`. Take the next id from the live file _and_ the
  `docs/roadmap-archive-*.md` files, never from the parser alone.
- **UI work:** tests cannot see a page. Look at it with `pnpm shots`, and verify CSS against
  `pnpm build`, not `pnpm dev`, which serves stale CSS (KQ35).
- **Copy** lives in `messages/en.json` via next-intl; never hardcode English in components.
