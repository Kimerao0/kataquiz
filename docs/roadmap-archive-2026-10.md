# Kataquiz roadmap archive — 2026-10

Closed and dropped items, moved out of `docs/roadmap.md` so the live file is the open set.
Ids are never reused and never renumbered: commits and reviews cite them, so an archived id
must still resolve.

---

## Closed

- [x] KQ08: Review your missed questions on the summary
  Closed by `b10118a`. Every question of the run is listed under the score — missed ones open,
  correct ones collapsed — with the correct answer, the player's own picks struck where they were
  wrong, the explanation, the question's snippet or image, and the theory link.
  _`src/components/run/run-review.tsx`, rendered from `run-summary.tsx:81`_

  Scope recorded, because two of these look like gaps and are not:
  - The entries are accumulated client-side as the run is graded, so a refresh still loses them.
    That is KQ09 and was a deliberate choice, not an oversight.
  - `imageUrl` is now rendered in two places; re-validating it at render is still KQ15, which names
    both call sites.

- [x] KQ33: `pnpm shots` photographed a 404 silently
  Closed by `8fa9038`. The roadmap prescribed the `Network` domain response status and that fix
  would not have worked: a dead slug answers **HTTP 200** with not-found content, because
  `notFound()` is thrown inside a Suspense boundary after streaming starts — the limitation this
  repo had already accepted. Verified against the running app before the fix was written. What does
  distinguish it is the `noindex` robots meta Next adds, and that is what the tool refuses on.
  `--allow-noindex` is the escape hatch.
  _`scripts/shots.mts`_

- [x] KQ34: `pnpm shots` could not reach an interactive state
  Closed by `8fa9038`. `--play answer` and `--play summary` drive a real run before the shot, so the
  feedback panel and the summary can be photographed. The three traps that cost a cycle each are
  defended in the script and named in its comments: the start panel's nickname `label[for]`, the
  advance lock, and a scenario that fails rather than photographing a rate-limit error.
  _`scripts/shots.mts`_
