#!/usr/bin/env bash
# skills/browser-testing-with-devtools is a copy of ai-skillset/skills/browser-testing-with-devtools.
# The skillset keeps the source of truth; the copy lets a machine that clones only this repository
# learn how to use the tools. Run this after the skill changes there:
#   scripts/sync-skill.sh                      # from ~/.agents/skills (the skillset's store)
#   SKILLSET=/path/to/ai-skillset/skills scripts/sync-skill.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME=browser-testing-with-devtools
SRC="${SKILLSET:-$HOME/.agents/skills}/$NAME"
[ -f "$SRC/SKILL.md" ] || { echo "sync-skill: no $SRC/SKILL.md" >&2; exit 1; }
rm -rf "$ROOT/skills/$NAME"
mkdir -p "$ROOT/skills"
cp -RL "$SRC" "$ROOT/skills/$NAME"
echo "sync-skill: copied $SRC -> skills/$NAME"
