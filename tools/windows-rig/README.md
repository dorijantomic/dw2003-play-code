# Windows-hosted DW2003 Redux rig

This folder contains the portable pieces for running PCSX-Redux natively on
Windows while keeping WSL/Codex as the automation driver.

Default layout:

```text
C:\dw3-rig\
  SCPH1001.BIN
  dw2003.bin
  dw2003.cue
  bridge-portable.lua
  setup-portable.lua
  launch-redux-windows.ps1
  launch-redux-windows.cmd
  pcsx-redux-active\
    pcsx-redux.exe
    *.dll
  rpc\
  dumps\
  shots\
  states\SLES03936.sstate*
```

Installed native build:

```text
PCSX-Redux Windows x64 dev build 314
version: 24035.20260602.2.x64
changeset: d658f89ebc5842b046e3fd2776133a9d2ea4d0c1
source: https://distrib.app/pub/org/pcsx-redux/project/dev-win-x64
zip: pcsx-redux-nightly-24035.20260602.2-x64.zip
md5: 7b907dd0fc145621afb7532a8763c987
sha1: a67e4c292f9514ed347f0f73852c6d07eafc9f7a

This build is pinned because it matches the Linux AppImage changeset that
created/loaded the existing `SLES03936.sstate*` files. Newer Windows build 342
launched successfully but crashed when loading existing savestates.
```

Hard rule: this rig must only run `C:\dw3-rig\pcsx-redux-active\pcsx-redux.exe`
when `pcsx-redux-active\version.json` reports build `314` and changeset
`d658f89ebc5842b046e3fd2776133a9d2ea4d0c1`. The launcher enforces this and
will refuse to run root-level `PCSX-Redux.exe`, root-level `pcsx-redux.exe`, or
any `pcsx-redux-nightly-*` fallback. Do not "upgrade" the active build unless
all required savestates are revalidated and this README is intentionally
updated.

Start Redux from Windows PowerShell:

```powershell
cd C:\dw3-rig
.\launch-redux-windows.ps1
```

Optional CMD bootstrap, useful when PowerShell execution policy blocks direct
`.ps1` launch:

```bat
C:\dw3-rig\launch-redux-windows.cmd
```

Then from WSL:

```bash
tools/windows-rig/rpc-windows.sh tools/windows-rig/setup-portable.lua
tools/windows-rig/rpc-windows.sh 'print(string.format("%08x", rd32(0x80055d2c)))'
```

## Capture & offline analysis toolkit (2026-07-13)

- `capture-timeline.lua` — vsync-driven animation capture (press + periodic
  screenshots + full savestates, all in-emulator from ONE listener). Use this
  instead of looping one-off RPC `shot()` calls — the loop pattern crashes
  the emulator mid-animation; the listener pattern captured a full 480-frame
  training animation with zero crashes. Configure the `CAP` table, then
  `rpc-windows.sh tools/windows-rig/capture-timeline.lua`.
- `savestate_vram.py` — offline parser for `createSaveState()` `.sav` files
  (protobuf; GPU field 5.3 = the true 1024x512 linear VRAM). Renders full
  VRAM, halfword-rect crops, or 4bpp texpages with a chosen CLUT row.
  ⚠️ Never byte-search a `.sav` for VRAM patterns (you find a RAM staging
  copy and get a phantom-empty VRAM — this produced a wrong ledger entry
  once), and never `PCSX.loadSaveState` these files back (crashes build 314;
  GUI-hotkey slot states in `%APPDATA%/Roaming/pcsx-redux/` load fine).
- `raw2png.py` — converts `shot()` `.raw` screenshots (16bpp 320x240 or
  24bpp 320x480 FMV, auto-detected).

Savestate slots: GUI hotkey states live in `%APPDATA%/Roaming/pcsx-redux/`
(`C:/Users/<user>/AppData/...`), NOT `C:\dw3-rig\states\` — `loadstate(n)`
only reads the latter. Load an AppData state with
`PCSX.loadSaveState(Support.File.zReader(Support.File.open(path)))`.

If you place the rig somewhere other than `C:\dw3-rig`, set both:

```powershell
$env:DW3_RIG_ROOT = "D:/path/to/dw3-rig"
```

```bash
export DW3_RIG_WIN_MOUNT=/mnt/d/path/to/dw3-rig
```

## BizHawk player-rig probes

The player session lives at `C:\bizhawk-rig` (see its own README) and is driven
from WSL with `tools/windows-rig/bizhawk-rpc`, which speaks the same file RPC
protocol as `rpc-windows.sh`.

- `pause-explorer.lua` — the pause-menu robot: maps every pause screen and
  button edge from one saved moment. Run it only through
  `game_driver.py explore`; see `docs/workflow/pause-explorer.md`.
- **Exec hooks are expensive on Octoshock** (measured 2026-09-29, normal speed):
  0 hooks 50.0 fps, 1 hook 49.4, 13 hooks 15.9, 116 hooks 2.4. Find objects by
  reading memory (the `+0x48` routine word, see the workflow note) instead of
  hooking many routines.

- `capture-shop-sfx.lua` — hooks the game's packed-sound entry `F0x8002006c`
  (`[0x80055c48]`) with `event.onmemoryexecute` and appends `a0`/`ra`/frame per
  call to `C:/bizhawk-rig/dumps/shop-sfx-live.log`; `SHOP_SFX.mark()`,
  `.dump()`, `.stop()`. No audio capture. Use
  `emu.getregisters()` inside the callback (this BizHawk has no
  `memory.getregister`). It proved the seven shop sounds live:
  `docs/research/ui/captures/shop-sfx-live-2026-09-10.md`.
