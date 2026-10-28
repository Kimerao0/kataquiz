// Attempt ids reach the server from a URL segment and from Server Action
// payloads, so they are untrusted text until proven otherwise. Postgres answers
// a malformed uuid with a query error rather than an empty result, which would
// turn /c/<typo> into a 500 instead of a 404 — hence a shape check before any
// id taken from a request is used in a lookup.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID.test(value)
}
