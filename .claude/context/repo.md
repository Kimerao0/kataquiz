# Repo context — Kataquiz

tracker: docs/roadmap.md

Ids are `KQnn`, matching the shape `parse-tracker.py` can read (`[A-Z]{1,3}\d{1,2}`, no
separator). A hyphenated `KQ-001` is invisible to it — that cost a round here.

This repo commits to trunk on `main` and has no pull-request path.

## Gates

`pnpm check` = biome + `tsc --noEmit` + vitest + `./scripts/check-portability.sh`.
`pnpm build` is NOT in it (KQ36).

Vitest runs two projects: `node` for `src/lib/**` and `src/db/**` against a real Postgres, and
`jsdom` for `.tsx`. Postgres comes from `compose.yaml` (`pnpm db:up`).

## Looking at the UI

**The test suite cannot see a page.** jsdom computes no layout, which is how this project shipped
Milestone 1 with 326 green tests and a UI nobody had looked at.

`pnpm shots <path> [label]` drives headless Chrome at 375 / 768 / 1440 / 1920 / 2560 in both colour
schemes and writes PNGs to `shots/`. **Open the files** — reading the filenames is not looking at
the page. It is deliberately not a gate and must not be added to `pnpm check` or a hook.

Three traps it has already sprung, each costing a cycle:

- It points at `localhost`, never `127.0.0.1`: Next only hydrates on the origin it was started for,
  and a `127.0.0.1` shot is a convincing picture of a page where React never attached.
- It photographs a 404 silently (KQ35), because Next renders not-found at the requested path.
- The dev server serves stale CSS (KQ37 note): verify design work against `pnpm build`.

It cannot reach an interactive state (KQ34). A working driver exists in the session scratchpad.
