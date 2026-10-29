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
