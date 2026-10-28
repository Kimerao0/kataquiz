# Self-hosting

## Status

- **Any Postgres works.** The app talks to `DATABASE_URL` through the standard `pg` driver. Nothing in the codebase is specific to Neon or to Vercel, and rate limiting lives in a Postgres table, so there is no Redis or KV to run.
- **There is no Docker image yet.** It is deliberately not shipped: an image nobody has asked for is an artifact that rots. If you want one, open an issue and say so.

Self-hosting today means: build it with Node, point `DATABASE_URL` at your Postgres, set the secret, run the migrations.

## Requirements

- Node 24
- pnpm 11
- A Postgres database you can create tables in

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection string. |
| `BETTER_AUTH_SECRET` | Yes | Random secret, see below. |
| `BETTER_AUTH_URL` | Yes | Public base URL of your instance, for example `https://quiz.example.com`. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | No | Enables GitHub sign-in. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | No | Enables Google sign-in. |
| `NEXT_PUBLIC_BETTER_AUTH_URL` | No | Read by the browser auth client. Left unset, the client uses the current origin, which is correct for a single-host deployment. It is inlined at build time. |

Generate the secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## Build, migrate, run

```bash
pnpm install --frozen-lockfile
pnpm build

# Migrations. drizzle-kit is a dev dependency, so run this where dev dependencies are installed.
DATABASE_URL=postgres://user:password@host:5432/dbname pnpm db:migrate

pnpm start
```

`pnpm db:migrate` applies the SQL files in `./drizzle`. Use the same `DATABASE_URL` for it as for the running app. An exported `DATABASE_URL` takes precedence over `.env.local`. Run it again after every upgrade that adds a migration.

## OAuth apps

Sign-in is GitHub and Google OAuth only; there is no email or password login. Without at least one provider configured the app runs but nobody can sign in. Replace `{BETTER_AUTH_URL}` with the value you set.

| Provider | Register at | Callback URL |
| --- | --- | --- |
| GitHub | https://github.com/settings/developers | `{BETTER_AUTH_URL}/api/auth/callback/github` |
| Google | https://console.cloud.google.com/apis/credentials | `{BETTER_AUTH_URL}/api/auth/callback/google` |

Put the resulting client ID and secret in the matching variables. A provider appears on the sign-in page only when both its variables are set.

## Operational notes

- **`BETTER_AUTH_SECRET` is required in production.** Guest identity cookies are HMAC-signed with it, and minting one throws an error without it. Changing it later invalidates every existing guest cookie, so guests lose ownership of the attempts they started.
- **`rate_limits` is never cleaned up.** The table has no automatic expiry. Schedule a periodic delete of old rows, for example daily:

```sql
DELETE FROM rate_limits WHERE window_start < now() - interval '1 day';
```
