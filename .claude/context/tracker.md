# Tracker

## Kind

file

<!-- The file is `docs/roadmap.md` (see `tracker:` in repo.md). No CLI: every write is an edit of
     that file, committed by name with the spec file. -->

## How to mirror

One roadmap item per **release**, created by `feature-spec` on approval, under a `## <Feature title>`
section (add the section if missing, above "Accepted"). Take each new id from
`grep -ho 'KQ[0-9]\+' docs/roadmap.md docs/roadmap-archive-*.md | sort -V | tail -1`, plus one —
never from `parse-tracker.py`. The release's `**Tracker:**` line in the spec is
`docs/roadmap.md#KQnn`.

```
- [ ] KQnn: <Feature> R<n> — <release name>
  Spec: `specs/<feature>.md` R<n> · status: <state>
  Specs: R<n>.1 … R<n>.<m> (the spec file holds the text; never copy it here)
  Verdicts: <filled by feature-prove>
```

- **Specs checklist**: the `Specs:` line above, written once by `feature-spec`. On a later amendment
  (`feature-sync`) update the id range only.
- **Verdicts checklist**: `feature-prove` replaces the `Verdicts:` line with the counts, e.g.
  `10 proven` or `9 proven · R1.1 owner-check`, and the evidence dir `.proofs/<feature>/`.

## How to comment

Append one indented line to the item: `  <YYYY-MM-DD> — <one-line summary>` (e.g. a check's finding
counts, `merged <sha>`). Never rewrite an earlier line.

## Moves allowed

The state lives in the item's `status:` field. The checkbox stays `[ ]`.

| Move           | From -> To                                                          |
| -------------- | ------------------------------------------------------------------- |
| Start          | `open` -> `building on feat/<feature>-r<n>`                         |
| Review         | `building …` -> `checking` -> `proving`                             |
| Back to review | `proving` -> `building on feat/<feature>-r<n>` (a disproven spec)   |
| Merged         | `proving` -> `merged <sha>, not pushed` (feature-ship, local merge) |

## Moves forbidden

- Done: ticking `[x]` or moving the item to `docs/roadmap-archive-*.md`. Only `core-workflow:roadmap
  close <id>` does that, with the deploy SHA as evidence, after the owner has pushed to production.
- Ready for prod / "deployed": a push to `main` deploys production and is the owner's call alone.

## Merge authorization

<!-- None: only the owner's word in chat authorizes feature-ship to merge. -->
