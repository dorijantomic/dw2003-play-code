#!/usr/bin/env bash
# make-dmg.sh <bundle dir> <version> <out dir> — the macOS download (DW2003.app in a .dmg).
#
# The app opens Terminal running the launcher, so there is a window to close
# when you are done playing (the same as on Windows and Linux).
set -euo pipefail
BUNDLE="$1"; VERSION="$2"; OUT="$3"
WORK="$(mktemp -d)"
APP="$WORK/Digimon World 2003.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$OUT"
cp -R "$BUNDLE/app" "$BUNDLE/runtime" "$APP/Contents/Resources/"

cat > "$APP/Contents/Resources/start.command" <<'SH'
#!/bin/sh
RES="$(cd "$(dirname "$0")" && pwd)"
printf '\033]0;Digimon World 2003\007'
exec "$RES/runtime/python/bin/python3" "$RES/app/launcher/dw2003.py"
SH
cat > "$APP/Contents/MacOS/DW2003" <<'SH'
#!/bin/sh
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
# Downloaded apps carry a quarantine flag that also blocks the bundled Python.
xattr -dr com.apple.quarantine "$RES/.." 2>/dev/null || true
open -a Terminal "$RES/start.command"
SH
chmod +x "$APP/Contents/MacOS/DW2003" "$APP/Contents/Resources/start.command"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Digimon World 2003</string>
  <key>CFBundleDisplayName</key><string>Digimon World 2003</string>
  <key>CFBundleIdentifier</key><string>io.github.dorijantomic.dw2003</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleExecutable</key><string>DW2003</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict></plist>
PLIST

# Ad-hoc signature so Apple Silicon runs the bundled binaries.
codesign --force --deep --sign - "$APP" || true

ln -s /Applications "$WORK/Applications"
cat > "$WORK/READ ME FIRST.txt" <<TXT
1. Drag "Digimon World 2003" into Applications.
2. Open it with RIGHT-CLICK > Open (the first time only; the app is not
   notarized by Apple, so a normal double-click is refused once).
3. Your browser opens. Choose your PAL/EU disc image (.bin or .iso); the game
   is built from it on this Mac (15-40 minutes, once), then it starts.
Close the Terminal window to quit.
TXT
hdiutil create -volname "Digimon World 2003" -srcfolder "$WORK" -ov -format UDZO \
  "$OUT/DW2003-macos-arm64.dmg"
ls -la "$OUT"
