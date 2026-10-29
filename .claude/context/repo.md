# Repo context — Kataquiz

tracker: docs/roadmap.md

Ids are `KQnn`, matching the shape `parse-tracker.py` can read (`[A-Z]{1,3}\d{1,2}`, no
separator). A hyphenated `KQ-001` is invisible to it — that cost a round here.

`parse-tracker.py`'s `next_free_id` reads the live file only, so once items are archived it hands
back an id that is already taken: on 2026-10-29 it offered `KQ36`, which had been archived that
morning. Take the next id from `grep -ho 'KQ[0-9]\+' docs/roadmap.md docs/roadmap-archive-*.md`,
never from the parser.

This repo commits to trunk on `main` and has no pull-request path.

## Gates

`pnpm check` = biome + `tsc --noEmit` + vitest + `./scripts/check-portability.sh`.
`pnpm build` is NOT in it (KQ36).

Vitest runs two projects: `node` for `src/lib/**` and `src/db/**` against a real Postgres, and
`jsdom` for `.tsx`. Postgres comes from `compose.yaml` (`pnpm db:up`).

## Looking at the UI

**The test suite cannot see a page.** jsdom computes no layout, which is how this project shipped
Milestone 1 with 326 green tests and a UI nobody had looked at.

`pnpm shots <path> [label] [--play answer|summary] [--allow-noindex]` drives headless Chrome at
375 / 768 / 1440 / 1920 / 2560 in both colour schemes and writes PNGs to `shots/`. **Open the
files** — reading the filenames is not looking at the page. It is deliberately not a gate and must
not be added to `pnpm check` or a hook.

`--play summary` plays a whole run first, which is the only way to photograph the summary; it does
not exist until every question has been answered. `--play answer` stops on the feedback panel. A
seeded slug carries a generated suffix, so take it from the catalog rather than typing it.

Two traps it used to spring are now caught for you, and both throw rather than returning a
photograph:

- A not-found page is refused. The response status is no help here — a dead slug answers HTTP 200
  with not-found content, which this repo accepted deliberately — so it keys off the `noindex`
  robots meta Next adds.
- A scenario that never arrives throws with the page's own text, so a rate-limited start is never
  filed as evidence of a screen.

Two remain, and neither is the tool's to fix:

- **The dev server serves stale CSS (KQ35): verify design work against `pnpm build`.**
- It points at `localhost`, never `127.0.0.1`. Next only hydrates on the origin it was started for,
  and a `127.0.0.1` shot is a convincing picture of a page where React never attached.
