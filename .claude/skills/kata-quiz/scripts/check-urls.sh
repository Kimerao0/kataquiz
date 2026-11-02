#!/usr/bin/env bash
# Usage: .claude/skills/kata-quiz/scripts/check-urls.sh seeds/<prefix>-*.yaml
# Prints every theoryUrl that does not answer HTTP 200 (anchors stripped). No output = all good.
# The URL is passed to sh as "$1", never spliced into the script text, so a crafted URL can't run commands.
grep -ho 'theoryUrl: *[^ ]*' "$@" | sed 's/theoryUrl: *//; s/^"//; s/"$//; s/#.*//' | sort -u |
  grep -E '^https?://[A-Za-z0-9._~:/?@!&()*+,;=%-]+$' |
  xargs -P 16 -I{} sh -c 'c=$(curl -s -o /dev/null -L --max-time 20 -A "Mozilla/5.0" -w "%{http_code}" -- "$1"); [ "$c" = 200 ] || echo "$c $1"' _ {}
