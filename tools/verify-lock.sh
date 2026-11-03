#!/usr/bin/env bash
# Run a verifier so that only ONE headless Chromium on this box uses the software
# WebGL renderer at a time. Two Playwright pages at once (each with its own WebGL
# context under SwiftShader) crashed each other with "Target page, context or
# browser has been closed"; serialising them costs wall time and nothing else.
#
# Usage:
#   VERIFY_PORT=8090 tools/verify-lock.sh tools/run-playwright.sh tools/verify_built_ground.mjs
#
# Set VERIFY_LOCK to share a different lock file.
set -euo pipefail
LOCK="${VERIFY_LOCK:-/tmp/dw2003-verify.lock}"
exec flock "$LOCK" -c "$*"
