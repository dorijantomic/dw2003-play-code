# Digimon World 2003 — Browser Recreation

A browser recreation of *Digimon World 2003*. This repository contains the
game's code — the engine, screens, and build scripts. The game's art, sound
and data are not included; you build them from **your own copy of the game**
(or, as an explicit opt-in, download a third-party copy — see Options).

## Easiest: the one-click download

Download the file for your computer from the
[latest release](https://github.com/dorijantomic/dw2003-play-code/releases/latest)
(Windows `.exe`, Mac `.dmg`, Linux `.tar.gz`), run it, and choose your disc
image on the page that opens. Nothing else to install. See the README's Quick
Start for the details per system. Windows and macOS show a one-time security
warning because the downloads are not code-signed; the README's
[Seeing a security warning?](README.md#seeing-a-security-warning) section shows
the two clicks that get past it.

Optional: features that use Digimon World 2 models (riding Unimon) need your own Digimon World 2 disc (PlayStation,
`.bin`/`.iso`). Open `/__dw2003/extras.html` in the running game (the setup page links it) and drop the disc there;
it is converted on your computer in a few seconds. From source: `python3 tools/dw2/dw2_addon.py --disc <DW2 .bin>
--converter <dw2_model_converter> --out web/dw2models`.

The rest of this page is the from-source route.

## Quick Start (from source)

You need your own copy of the game — the PAL/EU **Digimon World 2003**
(SLES-03936) — as a disc image (`.bin` CD-ROM XA or `.iso`, ~660 MB).

```sh
git clone https://github.com/dorijantomic/dw2003-play-code dw2003
cd dw2003
./install-play.sh --disc /path/to/your/disc.bin
```

The installer decodes your disc into the data tree the build reads (with
Marko's ddw3 extractor binaries, built from the ddw3 source with two small
patches that ship in `tools/byod/patches/`), installs any missing
prerequisites, builds all assets, and starts the server. Open
http://localhost:8080/ — press **Ctrl-C** to stop.

Running it with no arguments works only when a ddw3-shaped data tree already
exists at `~/ddw3`; otherwise it stops with instructions — the game's data is
never downloaded by default.

## What You Need

- Your own PAL/EU copy of the game (SLES-03936) as a disc image — for the
  `--disc` route. Already have a ddw3-shaped data tree? Use `--ddw3`.
  Neither? `--fetch-data` downloads a third-party copy of the data
  (opt-in; never downloaded by default).
- Linux x86_64 (the tested platform). On Windows, use WSL2 — native
  Windows shells are rejected. macOS is partially handled and untested.
- The installer installs missing prerequisites: Python 3, Node.js, uv — and
  git/curl/gcc/make via your system package manager (sudo is used when it is
  available). Rust is needed once for the disc route (to build Marko's
  extractor binaries); if it is missing, the installer prints instructions —
  https://rustup.rs installs it userspace, no sudo.

The build itself needs no admin/sudo access.

## Install and Play

```sh
git clone https://github.com/dorijantomic/dw2003-play-code dw2003
cd dw2003
./install-play.sh --disc /path/to/your/disc.bin
```

Open the URL it prints — http://localhost:8080/ — and press **Ctrl-C** to stop.

### Options

| Option | Meaning |
| ------ | ------- |
| `--disc PATH` | Build the data tree from YOUR disc image (recommended) |
| `--ddw3 PATH` | Use a ddw3-shaped data tree you already have (default: `~/ddw3` when it is one) |
| `--fetch-data` | OPT-IN: download a third-party copy of the game's data (never by default) |
| `--port N` | Serve on port N (default 8080) |
| `--no-serve` | Build only, do not serve |
| `--rebuild` | Force a rebuild of the assets |
| `--skip-prereqs` | Skip prerequisite installation (use only if already installed) |

Disc-route extras: `--ddw3-src DIR`, `--tools DIR`, `--objdump-bin BIN`,
`--disc-tree DIR` — see `./install-play.sh --help`.

## What Is Deliberately Not Here

- **Raw game assets** — no sprites, sound, maps or textures are tracked.
- **The game's playable data** — built from the tree you supply
  (`--disc` / `--ddw3`), or the opt-in `--fetch-data` download.
- **The HD asset mirror** — an optional 4x upscale, not built by default.

A small set of game-derived tables and short UI strings *is* tracked (for
the build and its tests) and is classified file by file in
`docs/third-party-and-generated.md`.

Known limitation: one battle-HUD image (`assets/ui/fight_ui.png`) is not
reproducible from public data — the HUD falls back to a plain style and the
browser logs a 404 for that image; that is expected. The s415 backdrop's
companion research document is also not shipped (see the README's Known
limitations).

## Credits

This recreation is built on the Digimon World 2003 matching decompilation by
**Marko (markisha64)** — his years of reverse-engineering work are the
foundation of everything here, and the game data comes from the repository he
created. Thank you, Marko. Without you, none of this would exist.

The optional Digimon World 2 extras use **jype**'s
[dw2_model_converter](https://gitlab.com/jype/dw2_model_converter) (MIT), which builds on work by **SydMontague**
and **RemyRM**. Thank you.

## Legal

**We do not own Digimon World 2003, its characters, artwork, music, or code.**
The original game is copyrighted by Bandai Namco / Banpresto.

This repository contains our own engine code, build tooling and docs — plus
a small, documented set of game-derived tables and short UI strings,
classified file by file in `docs/third-party-and-generated.md`. It does NOT
contain raw game assets, decompiled code, or raw data files from the original
game. The game data used at runtime is built from the player's own copy of
the game (or, only with `--fetch-data`, a third-party copy) — we redistribute
nothing.

## Issues

Found a bug? Open an issue with:
- What you expected
- What happened
- How to reproduce
- Your browser and OS
