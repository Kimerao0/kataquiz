# Kataquiz roadmap archive — 2026-11

Closed and dropped items, moved out of `docs/roadmap.md` so the live file is the open set.
Ids are never reused and never renumbered: commits and reviews cite them, so an archived id
must still resolve.

---

## Closed

- [x] KQ03: Prune `rate_limits`
  Closed by `17c8985`. Not the scheduled `DELETE` the item proposed: a cron would bind the app to a
  host, and the portability check forbids that. Instead `checkRateLimit` runs `pruneRateLimits` on 1%
  of calls, deleting rows older than `RATE_LIMIT_RETENTION_SEC` (24h). Every window is 1h, and an
  expired row already resets to 1 on its next hit, so no limiter decision changes; a test pins each
  window below the retention. A prune failure is logged and never fails the request (tested, and a
  mutation that rethrows turns it red).
- [x] KQ38: `attempts` has no index
  Closed by `17c8985` (migration `drizzle/0005_red_valkyrie.sql`). Two indexes rather than the one
  proposed, because `ownedBy` filters by `user_id` for a signed-in player and `guest_id` for a guest:
  `(quiz_id, user_id, started_at)` and `(quiz_id, guest_id, started_at)`, plus
  `attempt_answers(question_id)` for the stats queries. Review confirmed on the dev DB that
  `lastNicknameFor` becomes an index scan backward with no sort. Plain `CREATE INDEX` inside
  drizzle's migration transaction, so it blocks inserts while it builds: fine on a young table,
  revisit for a future index on a large one.
