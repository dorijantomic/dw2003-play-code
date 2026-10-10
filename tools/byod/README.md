# byod — bring your own disc

Build the ddw3-shaped data tree — the tree `build_all.py` reads — from your own
Digimon World 2003 (PAL/EU, SLES-03936) disc image.

**Credits.** Format decoding is done by Marko's
([markisha64](https://github.com/markisha64), the
[ddw3](https://github.com/markisha64/ddw3) decompilation) extractor binaries,
using markisha's work. If you use this, credit Marko and ddw3. The routing,
kind detection, config rewriting and the wiring into the play-code build are
byod's.

## What you need

* Your own EU disc image (`.bin` CD-ROM XA or `.iso`, ~660 MB) — the PAL/EU
  release, SLES-03936. The tool checks the disc's boot executable
  (`SLES_039.36`, sha1 `d1b7e4d6…bbb06d`) and refuses a wrong-region or
  modified image with a clear message.
* A [ddw3](https://github.com/markisha64/ddw3) checkout to build the extractor
  binaries from. Easiest:

  ```sh
  tools/byod/build-ddw3-tools.sh --ddw3-src /path/to/ddw3 --out /path/to/tools
  ```

  which applies the two patches in `patches/` first — they fix an inverted
  decode loop in `unlang-file` (without it the tool emits empty strings) and
  restore the duplicate-colour encoding in `untim` that the committed ddw3 PNGs
  were generated with (without it 420 map PNGs differ by one 8-bit colour step
  from ddw3). It builds with cargo and copies the seven binaries into `--out`.
  Without a `--ddw3-src` it clones ddw3 itself (git-lfs game-data objects
  are skipped; the checkout still contains ddw3's plain-text files, some of
  which carry game text) into `~/.cache/dw2003-play/ddw3-src`.

  Manual equivalent:

  ```sh
  git clone https://github.com/markisha64/ddw3 && cd ddw3
  patch -p1 < .../tools/byod/patches/ddw3-lang-file-decode-loop.patch
  patch -p1 < .../tools/byod/patches/ddw3-untim-duplicate-colours.patch
  cd tools && cargo build --release \
      -p ddw3-pack-tools -p ddw3-map-tools -p ddw3-map-tile-tools -p ddw3-rlen-tools \
      -p ddw3-tim-tools -p ddw3-lang-file-tools -p ddw3-unvab-sep
  # binaries: tools/target/release/{unpack,unmap,unrlen,unmap-tile,untim,unlang-file,ddw3-unvab-sep}
  ```

  (Build only those packages: the workspace's dev-only `mips-sim` crate does not
  compile with current rustc releases.)

* Python 3.11+ (stdlib only — no third-party packages for the tree build).
* Optional, for the assembly step: a `mipsel` objdump (e.g.
  `binutils-mipsel-linux-gnu`, or the ReGame toolchain build).

## Run

In this repository the installer runs the whole flow for you:

```sh
./install-play.sh --disc /path/to/disc.bin
```

Standalone (this tool only):

```sh
python3 tools/byod/byod.py /path/to/disc.bin --out tree/ --tools /path/to/ddw3/tools/target/release
```

Both are non-interactive: a missing disc image, a wrong-region image, or
unbuilt extractor binaries stop with an explanation of what to fix.

Writes `pack/ map/ map-tile/ rlen/ tim/ lang_file/ sound/ dw2003/` plus `_work/`
scratch: ~66,000 files in ~3 minutes on 8 cores. Flags: `--jobs N`,
`--reuse-staging` (re-decode from an existing `_disc/` extraction),
`--skip-sound`.

Then feed it to the play-code build:

```sh
DDW3_DIR=tree/ python3 build_all.py --skip ddw3_disc
```

(`--skip ddw3_disc`: that stage re-creates a disc image from ddw3's own zbuild
tree; with a tree built from your own disc there is nothing to re-create. Point
`DW3_DISC` at your disc image for the few stages that read disc sectors
directly.)

## Assembly (asm/) — companion step

The play-code build reads `asm/dw2003/{pro,exe}/*.s` for several stages. 296 of
the 310 mechanically-derivable flat `pro/*.s` files are regenerated
**byte-identically** from the disc's raw overlay data; the remaining 14 carry
symbol-timing residuals and the 29 hand-authored + 7 structural files are
curated text — those are copied from the public ddw3 tree:

```sh
python3 tools/byod/byod_asm.py --staging tree/_disc \
    --objdump-bin /usr/bin/mipsel-linux-gnu-objdump \
    --ddw3 /path/to/ddw3 --out tree/ --report tree/_work/asm_report.json
```

## Support files not derived from the disc

The build also reads a handful of hand-written files from the ddw3 repo — copy
them into the tree from your ddw3 checkout:

* `rust/` (the dw2003_exe_data / pro_* tables the build reads; 40 files)
* `tools/util.py`, `tools/stitch-map.py`, `tools/ddw3-lang-file/src/codepoint.rs`
* `iso/dw2003-bootstrap/lbas.toml`
* `data/digimon_profiles.toml`

See `REPORT.md` (byod's report) for the exact readset and the full
verification table.

## Verify

```sh
python3 tools/byod/verify_readset.py tree/
```

compares every path the play-code build actually reads (65,884 paths, captured
by an audit-hooked reference build; list in `data/readset.tsv`) against
`DDW3_DIR` (default `~/ddw3`): expect everything identical, 16,303 PNGs
differing in bytes only (2023 encoder vs 2026 — pixels identical), and 0 pixel
differences. One `tools/__pycache__/*.pyc` entry may report missing before the
first build — it is a bytecode cache the build re-creates on import.
