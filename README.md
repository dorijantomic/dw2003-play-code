# Digimon World 2003 — Browser Recreation

A fully playable browser recreation of Digimon World 2003 (PS1), built from a
matching decompilation of the game's original code.

## Quick Start

You need your own copy of the game — the PAL/EU **Digimon World 2003**
(SLES-03936) — as a disc image (`.bin` or `.iso`, ~660 MB). Nothing from the
game is included or downloaded: everything is built from your disc, on your
computer.

**1. Download** the file for your computer from the
[latest release](https://github.com/dorijantomic/dw2003-play-code/releases/latest):

| Computer | File | Then |
| --- | --- | --- |
| Windows 10/11 | `DW2003-Setup-windows-x64.exe` | Run it. (If SmartScreen appears: *More info → Run anyway*.) |
| Mac (Apple Silicon) | `DW2003-macos-arm64.dmg` | Drag the app to Applications, then **right-click → Open** the first time. |
| Linux (x64) | `DW2003-linux-x64.tar.gz` | Extract it and run `./DW2003`. |

**2. Start "Digimon World 2003".** Your browser opens.

**3. Choose your disc image** on the page that appears. The game is built from
it once (15–40 minutes, depending on your computer), then it starts. From then
on, starting the app goes straight to the game.

No Python, Node, Rust, git or admin rights needed; the download carries
everything it uses. Keep the small window that opens alongside the browser
while you play; close it to quit. The disc is decoded with Marko's
([markisha64](https://github.com/markisha64/ddw3)) extractors, reused with
permission — see `tools/byod/README.md` and Credits below. On first setup the
app downloads ddw3's public source text (~11 MB of assembly/tables, no game
data) that the build reads alongside your disc.

### From source (developers)

```sh
git clone https://github.com/dorijantomic/dw2003-play-code dw2003
cd dw2003
./install-play.sh --disc /path/to/your/disc.bin
```

This builds the extractors and toolchain from source (Linux; see below), then
serves the game at http://localhost:8080. Alternatives:

- `./install-play.sh --ddw3 ~/ddw3` — use a ddw3-shaped data tree you
  already have.
- `./install-play.sh --fetch-data` — OPT-IN: download a third-party copy of
  the game's data (a fan project; the data remains the original game's
  copyright) — it is never downloaded by default.

The one-click downloads are built by `.github/workflows/release.yml`
(`packaging/`); the launcher they run is `launcher/dw2003.py`.

## Prerequisites (source install only)

The installer handles these automatically, but if you prefer to install them
manually:

- Python 3.10+ (https://python.org) — the disc route's byod tool documents
  3.11+ for its tree build
- Node.js 18+ with npm (https://nodejs.org)
- uv (https://docs.astral.sh/uv) — used to manage Python dependencies
- git (https://git-scm.com)
- Rust (cargo, https://rustup.rs) — only for the disc route, used once to
  build Marko's extractor binaries from the ddw3 source; the installer
  reports a clear error with instructions if it is missing.

The build itself needs no admin/sudo access. The optional prerequisite step
above uses your system package manager — and sudo, when it is available — for
anything that is missing.

Platforms: Linux x86_64 is the tested platform (the installer refuses native
Windows shells — use WSL2). macOS is partially handled and untested.

## How It Works

The game's art, sound and playable data are not included in this repository.
They come from a game-data tree the player supplies — built from their own
copy of the game with `install-play.sh --disc <your disc>` (which drives the
disc-to-tree tool in `tools/byod/`), or a ddw3-shaped tree they already have
via `--ddw3 <tree>`. `build_all.py` then converts that tree into
browser-ready assets (PNG sprites, stitched stage maps, collision JSON,
sound effects, etc.).

For people without a disc copy, `install-play.sh --fetch-data` is an explicit
opt-in convenience: it clones a third-party fan repository
(https://github.com/markisha64/ddw3) that has extracted and organized the
original game's data, and builds from that. That download is never automatic,
and the data stays under its own terms (see Legal).

## Project Structure

```
web/          The game: HTML, CSS, JS, and built assets
engine/       The game engine (TypeScript, compiled to web/vendor/engine.js)
tools/        Build scripts and utilities
data/         Authored game data (not extracted assets)
tests/        Test suites
```

## What Is and Is Not Included

Not included:

- Raw game assets — no sprites, textures, sound, music, maps or other
  binaries from the original game are tracked (checked mechanically: no
  audio or console formats among the tracked files).
- The HD asset mirror — an optional 4x upscale of original images; not
  built by default.
- The original game's data files — the playable data is built from the data
  tree you supply (`--disc`, `--ddw3`, or opt-in `--fetch-data`).

Included, although game-derived (tracked and classified file by file in
`docs/third-party-and-generated.md`):

- A small set of decoded tables used by the build and its tests (e.g.
  function tables, stage registries) and research data we authored about
  the game — including a ~9 MB evidence ledger and multi-MB function
  tables under `docs/generated/` and `docs/research/`.
- Short UI strings from the game, embedded in the ported UI modules and
  their tests (shop, card duel, starter-pack picker).

None of this is playable content; the game's art, sound and data are built
from the data tree you supply.

Known limitations:

- One battle-HUD image (`assets/ui/fight_ui.png`) is not reproducible from
  public data, so the battle HUD falls back to a plain style and the browser
  logs a 404 for that one image — that is expected.
- The s415 backdrop research note
  (`docs/research/field/stage-object-registry-2026-10-04.md`) references a
  companion decode document (`s415-deeper-crevice-ride-decode.md`) that is
  not part of this repository, and the s415 fixed-viewport background shows
  the raw bg01 decode (the author's hand-made capture is not shipped, by
  design).

## Why This Exists

I believe in game preservation. Digimon World 2003 is a game of my childhood —
one that many fans still love and remember fondly. It deserves to be playable,
not lost to time and hardware that no longer exists.

This project provides a way for many others to experience this game in their
browser, without needing a PS1, a disc, or an emulator. It also opens the door
for bug fixes, balance adjustments, and potential improvements that the original
never received.

I plan to work on a remaster version with graphical improvements — that work is
already in progress. But for now, the main purpose is making sure the game
works **authentic to the original**. That's the foundation everything else
builds on.

If you can help with that — testing, bug reports, code contributions — I'd
greatly appreciate it.

## Credits

This project would not exist without the extraordinary reverse-engineering work
of **Marko (markisha64)**. His Digimon World 2003 decompilation project —
matching, function-by-function, across every overlay and the executable — is the
foundation this entire recreation is built on. The game data used at runtime
comes from the repository he created and maintains. The bring-your-own-disc
route (`tools/byod/`) builds and drives his extractor binaries and ships the two
small patches they need, reused with his permission — if you use it, credit
Marko and ddw3. Without his years of patient work documenting how this game
actually works, none of this would be possible. Thank you, Marko.

## Open Code

All the code in this repository is here to be read, learned from, and built upon.
I don't believe in hogging it. If you want to go in a different direction — make
your own version of the game, fix things your way, add features, experiment —
that's fine with me. That's the whole point.

This should be available for everyone, especially people who want to make their
own versions of the game for themselves, to make it fun for them. Go for it.

## Legal

**We do not own Digimon World 2003, its characters, artwork, music, or code.**
The original game is copyrighted by Bandai Namco / Banpresto.

This repository contains:
- Our own TypeScript/JavaScript engine code (original work)
- Our own build tooling (original work; third-party components are listed
  under License)
- Documentation and research we authored
- A small, documented set of game-derived tables and short UI strings,
  tracked for the build and its tests (see "What Is and Is Not Included")

This repository does NOT contain:
- Raw game assets — no sprites, textures, sound, music, maps or other
  binaries from the original game
- Decompiled original code — none is shipped
- Raw data files from the original game — the playable data is built from
  the data tree the player supplies

`docs/third-party-and-generated.md` classifies every tracked file that is
generated from the game data (or kept for the build) so this claim can be
checked file by file.

The game data used at runtime comes from the player: a data tree built from
their own copy of the game (the `--disc` route, which drives the disc-to-tree
tool in `tools/byod/`), or — only when the player explicitly passes
`--fetch-data` — a third-party fan repository's extracted copy. We
redistribute nothing; we provide tools that build a playable game from data
the user obtains separately.

This project is for educational and personal-use purposes only.

## License

All original work in this repository — engine code, build tooling, tests,
documentation and authored data — is provided under the MIT License; you are
free to use, modify, and distribute it. See LICENSE for the full text.

Third-party components:
- `tools/m2c/**` is a vendored copy of m2c, licensed GPL-3.0-only (see
  `tools/m2c/LICENSE`); it keeps its own license.
- The byod disc tools build and patch Marko's ddw3 extractor sources, reused
  with permission (see `tools/byod/README.md` and Credits).

The game data — whether built from your own copy of the game or downloaded
via the opt-in `--fetch-data` flag — is subject to its own terms; we claim no
ownership over it.

## Issues

Found a bug? Open an issue using the template provided, or describe:
- What you expected to happen
- What actually happened
- How to reproduce it
- Your browser and OS
