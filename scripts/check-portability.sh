#!/usr/bin/env bash
# Grindstone runs on any Postgres and any Node host. The hosted instance is
# just the first deployment of it, not a different edition. This check is what
# stops that claim from quietly becoming false: a platform-specific import is
# easy to add and almost impossible to notice afterwards.
set -euo pipefail

PATTERN='@vercel/|@neondatabase/|process\.env\.VERCEL|process\.env\.NEON'

if matches=$(grep -rnE "$PATTERN" src/ 2>/dev/null); then
  echo "Portability check failed — platform-specific code in src/:" >&2
  echo "$matches" >&2
  echo >&2
  echo "Grindstone must run on any Postgres and any Node host." >&2
  echo "Use DATABASE_URL and the standard pg driver instead." >&2
  exit 1
fi

echo "portability: no platform-specific imports in src/"
