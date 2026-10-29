// Test this in a .tsx file: a src/**/*.test.ts runs in the node project, which boots Postgres.
// Quiz content is uploaded by strangers. Upload validation already restricts
// theoryUrl to http(s), so this is a second line rather than the only one —
// but the Milestone 2 editor will be a second way into the same column, and a
// javascript: href here would run in the player's session.
export function httpUrlOrNull(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}
