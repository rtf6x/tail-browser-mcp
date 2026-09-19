#!/usr/bin/env bash
# AMO source archive: manifest.json at zip root, dist/ included, common/ sibling.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
FF="$REPO/firefox-extension"
OUT="$REPO/tail-mcp-firefox-source.zip"
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

npm run build --prefix "$REPO/common"
npm run build --prefix "$FF"

rsync -a \
  --exclude node_modules \
  --exclude .nx \
  --exclude SOURCE_CODE_README.txt \
  --exclude pack-sources.sh \
  --exclude .DS_Store \
  "$FF/" "$STAGING/"

rsync -a \
  --exclude node_modules \
  --exclude dist \
  --exclude .DS_Store \
  "$REPO/common/" "$STAGING/common/"

VERSION="$(node -p "require('$FF/manifest.json').version")"
sed "s/^Version: .*/Version: $VERSION/" "$FF/SOURCE_CODE_README.txt" > "$STAGING/SOURCE_CODE_README.txt"

cd "$STAGING"
rm -f "$OUT"
zip -r "$OUT" . -x '*.DS_Store'

echo "Created $OUT"
