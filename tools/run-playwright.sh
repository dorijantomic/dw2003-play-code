#!/usr/bin/env bash
# Run a Node script that uses Playwright's headless Chromium on this project.
#
# Why a wrapper: this box has no sudo, so the NSS/NSPR shared libraries Chromium
# needs (libnspr4.so, libnss3.so, …) are not installed system-wide. They live in a
# userspace bundle; we add it to LD_LIBRARY_PATH so `chromium.launch()` works.
# The Playwright npm package + browser binary come from `npm install` (see the
# `postinstall`/`setup:playwright` scripts in package.json).
#
# Usage:
#   tools/run-playwright.sh tools/verify_opening_flow.mjs [args…]
#   npm run verify:opening
#
# Override the libs location with PLAYWRIGHT_LIBS if your bundle lives elsewhere.
# VERIFY_PORT selects the server port the verifier scripts connect to.
set -euo pipefail

LIBS="${PLAYWRIGHT_LIBS:-$HOME/.local/share/playwright-shot/libs/usr/lib/x86_64-linux-gnu}"
if [ -d "$LIBS" ]; then
  export LD_LIBRARY_PATH="$LIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
else
  echo "warning: Chromium lib bundle not found at $LIBS" >&2
  echo "         If Chromium fails to start (libnspr4.so error), set PLAYWRIGHT_LIBS" >&2
  echo "         to a dir containing libnspr4.so/libnss3.so (extracted without sudo)." >&2
fi

exec node "$@"
