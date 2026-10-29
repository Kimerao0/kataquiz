# Review lenses — Kataquiz

The defects this repo has actually produced, not a generic checklist. A diff that touches one of
these shapes gets that check whether or not anything else looks wrong.

Each lens says what happened, where to look, and what to ask. Add one when a review or a session
finds a defect whose _shape_ could recur; delete one when the shape becomes impossible.

---

## 1. State kept across a render that looked like a remount

**Measured 2026-10-29, twice in one day.** React reconciles an element of the same type in the same
position and keeps its state. `RunStartPanel` renders `<RunPlayer>` from three entry paths — start,
resume, replay — so swapping the `run` prop for a different attempt left `question`, `position`,
`reviewed` and `summary` on the _previous_ run. First time it was a blocker: an answer posted one
attempt's id with another attempt's question. Second time it was pre-empted with
`key={started.run.attemptId}` (`src/components/run/run-start-panel.tsx:167`).

**Ask, whenever a component can be handed a different subject without unmounting:** what identifies
the subject, and is that the `key`? A reset function that clears state by hand is the weaker answer —
it has to be kept in step with every new piece of state, and nothing fails when someone forgets.

**It is cheap to test and the test is worth writing**: drive the component to a terminal state, hand
it a new subject, and assert the new one is on screen. Without the key the old state survives and
the assertion times out.

---

## 2. Meaning carried by something no query can reach

**Measured 2026-10-29.** `verdictFor` returns a mark as well as a word
(`src/components/run/feedback-parts.tsx:17`), and the mark renders `aria-hidden="true"` in all three
places it appears (`feedback-panel.tsx:43`, `run-review.tsx:76`, `run-summary.tsx:80`). Hiding it is
**correct** — the word already carries the meaning and a screen reader should not hear it twice —
and that is precisely what put it beyond every `getByText` and `getByRole`. Swapping `CheckIcon` and
`XIcon` rendered a cross beside the word "Correct" with the entire suite green.

**Ask, for anything `aria-hidden`, decorative, or styled-only that still encodes meaning:** what
asserts it? If the answer is "the text next to it", the two can disagree and nothing will say so.
Identity against the imported component, or a class assertion where the project's rule is about
colour, is often the only assertion available — take it rather than leaving the surface bare.

This repo's own rule is _"a mark and a word, never colour alone"_ (`feedback-panel.tsx:33`). A test
that pins only the word holds up half of it.

---

## 3. A guard beside the caller instead of inside the component

**Measured 2026-10-29, on both author-supplied URL columns.** `imageUrl` reached `<img src>` with no
check at all while `theoryUrl` was guarded — but guarded at each _call site_, so the component
itself trusted whatever it was handed. Both now run `httpUrlOrNull` inside the component that
renders them (`question-media.tsx:39`, `feedback-parts.tsx:46`).

**Ask, for any value from outside that reaches the DOM:** is the check inside the thing that renders
it, or beside each caller? Beside the caller is a convention, not a guarantee — a third call site
is one `git grep` away from not having it, and the type says nothing.

Watch the asymmetry in particular. When one of two sibling values is guarded and the other is not,
the gap is usually where nobody thought to look, and it is as likely to sit on the dangerous one as
the safe one: here the weaker arrangement was on `<a href>`, where a `javascript:` URL actually
executes, while the stronger reasoning had gone to `<img src>`, where it never would have.

---

## 4. A test that passes for a reason other than the one intended

**Not a defect that shipped — a near miss, 2026-10-29.** Three times this session a test would have
passed against the broken code: a lookup test where a zero-answer guard returned `null` whichever
branch ran, an ownership test where the column was empty anyway, and a filter test resolved by a
transaction timestamp tie rather than by the filter.

**Ask of a new test, before trusting it:** mutate the line it claims to defend and watch it go red.
Inside one transaction `now()` is the transaction start time, so rows written together share
`started_at` and any ordering between them is a tie — write explicit timestamps when order is the
thing under test.
