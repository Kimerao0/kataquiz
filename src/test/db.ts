import { db } from '@/db/client'

export type TestTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Private on purpose: nothing outside this file can throw it, so swallowing it
// below can never hide a real failure.
class Rollback extends Error {}

// Runs a test body inside a transaction that is always rolled back. Tests stay
// isolated without ever truncating a table.
export async function withTestDb<T>(fn: (tx: TestTx) => Promise<T>): Promise<T> {
  let result!: T
  try {
    await db.transaction(async (tx) => {
      result = await fn(tx)
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
  return result
}
