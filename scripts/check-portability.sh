#!/usr/bin/env bash
# Kataquiz runs on any Postgres and any Node host. The hosted instance is just
# the first deployment of it, not a different edition. This check is what stops
# that claim from quietly becoming false: a platform-specific import is easy to
# add and almost impossible to notice afterwards.
set -euo pipefail

PATTERN='@vercel/|@neondatabase/|process\.env\.VERCEL|process\.env\.NEON'

# Config and manifest count too: a @vercel/* dependency or a VERCEL env read in
# next.config.ts is just as binding as one in src/.
TARGETS=(src next.config.ts package.json drizzle.config.ts)

for target in "${TARGETS[@]}"; do
  if [ ! -e "$target" ]; then
    echo "Portability check failed — expected '$target' to exist." >&2
    echo "Refusing to pass a check that had nothing to inspect." >&2
    exit 1
  fi
done

set +e
matches=$(grep -rnE "$PATTERN" "${TARGETS[@]}")
status=$?
set -e

# grep: 0 = found something, 1 = clean, 2+ = it failed to run. Only 1 is a pass.
# Treating 2 as a pass is how a gate silently stops being a gate.
if [ "$status" -eq 0 ]; then
  echo "Portability check failed — platform-specific code found:" >&2
  echo "$matches" >&2
  echo >&2
  echo "Kataquiz must run on any Postgres and any Node host." >&2
  echo "Use DATABASE_URL and the standard pg driver instead." >&2
  exit 1
fi

if [ "$status" -ne 1 ]; then
  echo "Portability check failed — grep exited $status (it could not run)." >&2
  exit 1
fi

echo "portability: no platform-specific imports in ${TARGETS[*]}"
