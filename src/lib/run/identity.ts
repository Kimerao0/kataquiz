import { eq } from 'drizzle-orm'
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { type Db, db } from '@/db/client'
import { attempts } from '@/db/schema'
import { getOrCreateGuestId, readGuestId } from '@/lib/guest'
import { getCurrentUser } from '@/lib/session'
import type { Player } from './service'

// The base class of both `db` and a transaction, so tests can run these inside
// the rollback harness.
type Executor = PgDatabase<NodePgQueryResultHKT, Db['_']['fullSchema']>

// Stored verbatim in `attempts.nickname` and shown to whoever opens a challenge
// link, so it is capped here rather than at render time.
const MAX_NICKNAME_LENGTH = 40

// The only place a player identity is minted. It comes from the session cookie
// or the signed guest cookie, never from the request body, so a client that
// posts somebody else's id still plays as itself and fails the ownership checks
// inside the service. Shared by every Server Action that starts or continues a
// run: a second copy of this would be a second place the nickname cap could
// drift.
export async function resolvePlayer(nickname?: string): Promise<Player> {
  const user = await getCurrentUser()
  if (user) return { kind: 'user', userId: user.id }

  return {
    kind: 'guest',
    guestId: await getOrCreateGuestId(),
    nickname: (nickname ?? '').trim().slice(0, MAX_NICKNAME_LENGTH),
  }
}

// The read-only twin of resolvePlayer, for a render. It mints nothing: Next
// throws when a cookie is written while rendering, which is the whole reason
// readGuestId exists, so a visitor who has no guest cookie yet is nobody here
// and gets `null` rather than a fresh identity.
export async function readPlayer(): Promise<Player | null> {
  const user = await getCurrentUser()
  if (user) return { kind: 'user', userId: user.id }

  const guestId = await readGuestId()
  if (!guestId) return null

  // Empty rather than invented: only resolvePlayer mints a nickname, and the
  // lookups this player is handed to read ownership and never a name.
  return { kind: 'guest', guestId, nickname: '' }
}

// The prefix keeps run starts out of the way of the upload limit, which shares
// the rate limit table's primary key.
export function runLimitKey(player: Player): string {
  return player.kind === 'user' ? `run:user:${player.userId}` : `run:guest:${player.guestId}`
}

// Its own prefix for the same reason: sharing the run-start key would let
// picking a run back up burn the budget for starting one.
export function resumeLimitKey(player: Player): string {
  return player.kind === 'user' ? `resume:user:${player.userId}` : `resume:guest:${player.guestId}`
}

// Reading a finished run's comparison reveals the opponent's score, so the
// caller has to own the run. The service decides ownership for writes; this is
// the same question asked about a read, and it is asked of the derived player,
// never of anything in the payload.
export async function isAttemptPlayedBy(
  attemptId: string,
  player: Player,
  executor: Executor = db,
): Promise<boolean> {
  const [attempt] = await executor
    .select({ userId: attempts.userId, guestId: attempts.guestId })
    .from(attempts)
    .where(eq(attempts.id, attemptId))
  if (!attempt) return false

  return player.kind === 'user'
    ? attempt.userId === player.userId
    : attempt.guestId === player.guestId
}
