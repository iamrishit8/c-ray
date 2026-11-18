#!/usr/bin/env bash
# Stop hook: if code under src/ or tests/ changed in the working tree but no
# documentation changed, ask Claude to update the docs before finishing.
# See docs/DEFINITION_OF_DONE.md. Runs once per stop (respects stop_hook_active).
input=$(cat)
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0
cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

changed=$(git status --porcelain --untracked-files=all | cut -c4- | sed 's/.* -> //')
code=$(printf '%s\n' "$changed" | grep -E '^(src|tests)/' | grep -vE '^tests/(\.tmp|fixtures)/' | head -5)
docs=$(printf '%s\n' "$changed" | grep -E '^(CLAUDE\.md|README\.md|docs/)' | head -1)

if [ -n "$code" ] && [ -z "$docs" ]; then
  files=$(printf '%s' "$code" | tr '\n' ' ')
  jq -n --arg f "$files" '{decision:"block", reason:("Code changed (" + $f + ") but no docs were updated. Per docs/DEFINITION_OF_DONE.md, update docs/TODO.md (task status), and docs/DECISIONS.md / docs/ARCHITECTURE.md / docs/FLOWS.md / docs/CONVENTIONS.md if this change affects them. If no doc change is genuinely needed, say so explicitly in your reply and stop.")}'
fi
exit 0
