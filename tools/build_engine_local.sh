#!/bin/bash
# Builds web/vendor/engine.js from THIS checkout's engine/ sources.
# This copy of the repo does not carry five generated data files the engine imports (item-data.ts and friends, built from the
# disc by the research repo). They are borrowed from a research checkout: set GENERATED_ENGINE_DIR (default ~/ddw3-walker/engine/dw3).
# esbuild is taken from the same checkout. The output goes to web/vendor/ of THIS checkout only.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
GEN="${GENERATED_ENGINE_DIR:-$HOME/ddw3-walker/engine/dw3}"
ESB="${ESBUILD:-$HOME/ddw3-walker/node_modules/@esbuild/linux-x64/bin/esbuild}"
TMP="$(mktemp -d)"
cp -r "$HERE/engine" "$TMP/engine"
for f in booster-items equipment-data item-data item-directories item-names; do
  [ -e "$TMP/engine/dw3/$f.ts" ] || cp "$GEN/$f.ts" "$TMP/engine/dw3/$f.ts"
done
mkdir -p "$HERE/web/vendor"
"$ESB" "$TMP/engine/index.ts" --bundle --format=esm --outfile="$HERE/web/vendor/engine.js" --log-level=warning
rm -rf "$TMP"
ls -l "$HERE/web/vendor/engine.js"
