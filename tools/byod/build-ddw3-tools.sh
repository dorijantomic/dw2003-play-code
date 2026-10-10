#!/usr/bin/env bash
# Build Marko's ddw3 extractor binaries for byod (the disc -> tree tool).
#
# byod does the routing/decoding; the actual format extractors are Marko's
# (markisha64/ddw3) Rust tools, using markisha's work — credit Marko and ddw3.
# Two patches that ship in tools/byod/patches/ must be applied to the ddw3
# source before building:
#   * ddw3-lang-file-decode-loop.patch  — fixes an inverted decode loop
#     (without it every decoded string is empty);
#   * ddw3-untim-duplicate-colours.patch — restores the pre-2023 duplicate-colour
#     encoding the committed ddw3 PNGs use (without it 420 map PNGs differ from
#     ddw3 by one 8-bit colour step).
#
# Usage:
#   tools/byod/build-ddw3-tools.sh [--ddw3-src DIR] [--out DIR] [--jobs N]
#
#   --ddw3-src DIR  a ddw3 checkout to build from (default: ~/ddw3 when it is a
#                   checkout, else <cache>/ddw3-src, cloned with
#                   GIT_LFS_SKIP_SMUDGE=1 (git-lfs game data skipped; ddw3's
#                   plain-text files are still present) at the tested ref)
#   --out DIR       where the built binaries are copied (default:
#                   <cache>/ddw3-tools; <cache> = ${XDG_CACHE_HOME:-~/.cache}/dw2003-play)
#   --jobs N        cargo parallelism (default: cargo's own)
#
# Needs: git, patch, and a Rust toolchain (cargo) — https://rustup.rs installs
# userspace, no sudo. The build takes a few minutes the first time.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DDW3_URL="${DDW3_URL:-https://github.com/markisha64/ddw3}"
DDW3_REF="${DDW3_REF:-b125b3d7471c23d305b27f0b1d7a2353643a3ee3}"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/dw2003-play"

SRC=""
OUT=""
JOBS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --ddw3-src) SRC="${2:-}"; shift 2 ;;
    --ddw3-src=*) SRC="${1#*=}"; shift ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --out=*) OUT="${1#*=}"; shift ;;
    --jobs) JOBS="${2:-}"; shift 2 ;;
    --jobs=*) JOBS="${1#*=}"; shift ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "build-ddw3-tools: unknown option '$1' (try --help)" >&2; exit 2 ;;
  esac
done

say()  { printf '\n== %s\n' "$*"; }
fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
info() { printf '  %s\n' "$*"; }

is_ddw3_src() { [ -f "$1/tools/Cargo.toml" ] && [ -d "$1/asm/dw2003" ]; }

# --- source checkout ---------------------------------------------------------
if [ -z "$SRC" ]; then
  if is_ddw3_src "$HOME/ddw3"; then
    SRC="$HOME/ddw3"
  else
    SRC="$CACHE/ddw3-src"
    if ! is_ddw3_src "$SRC"; then
      say "Fetching the ddw3 source (git-lfs game-data objects are skipped; the checkout still includes ddw3's plain-text files)"
      info "credit: Marko (markisha64) — https://github.com/markisha64/ddw3"
      command -v git >/dev/null 2>&1 || fail "git not found; install git and re-run"
      GIT_LFS_SKIP_SMUDGE=1 git clone -q "$DDW3_URL" "$SRC" \
        || fail "could not clone $DDW3_URL (offline? pass --ddw3-src <checkout>)"
      git -C "$SRC" -c advice.detachedHead=false checkout -q "$DDW3_REF" \
        || fail "could not check out $DDW3_REF in $SRC"
    fi
  fi
fi
is_ddw3_src "$SRC" || fail "'$SRC' is not a ddw3 source checkout (expected tools/Cargo.toml and asm/dw2003)"

if [ -z "$OUT" ]; then
  OUT="$CACHE/ddw3-tools"
fi

# --- patches -----------------------------------------------------------------
say "Applying the byod patches to $SRC"
for p in "$HERE"/patches/*.patch; do
  name="$(basename "$p")"
  if git -C "$SRC" rev-parse --git-dir >/dev/null 2>&1; then
    if git -C "$SRC" apply --check "$p" 2>/dev/null; then
      git -C "$SRC" apply "$p"
      info "applied $name"
    elif git -C "$SRC" apply --reverse --check "$p" 2>/dev/null; then
      info "already applied: $name"
    else
      fail "cannot apply $name to $SRC — the checkout is not the tested revision (or has local edits). Re-clone, or apply the patches by hand."
    fi
  else
    if patch --dry-run -R -p1 -d "$SRC" -i "$p" >/dev/null 2>&1; then
      info "already applied: $name"
    elif patch --dry-run -p1 -d "$SRC" -i "$p" >/dev/null 2>&1; then
      patch -p1 -d "$SRC" -i "$p" >/dev/null
      info "applied $name"
    else
      fail "cannot apply $name to $SRC — the checkout is not the tested revision (or has local edits). Re-clone, or apply the patches by hand."
    fi
  fi
done

# --- build -------------------------------------------------------------------
say "Building the extractor binaries (first build: a few minutes)"
CARGO="${CARGO:-}"
if [ -z "$CARGO" ]; then
  if command -v cargo >/dev/null 2>&1; then
    CARGO="$(command -v cargo)"
  elif [ -x "$HOME/.cargo/bin/cargo" ]; then
    CARGO="$HOME/.cargo/bin/cargo"
  else
    fail "cargo not found. Install Rust (userspace, no sudo):
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
then re-run this script (or pass --tools <dir> pointing at an existing build)."
  fi
fi
info "cargo: $CARGO ($("$CARGO" --version 2>/dev/null || echo '?'))"
# Build only the seven packages byod drives. A plain `cargo build --release` in
# the workspace also builds the dev-only mips-sim crate, which does not compile
# with current rustc releases.
PKGS=(-p ddw3-pack-tools -p ddw3-map-tools -p ddw3-map-tile-tools -p ddw3-rlen-tools
      -p ddw3-tim-tools -p ddw3-lang-file-tools -p ddw3-unvab-sep)
if [ -n "$JOBS" ]; then
  ( cd "$SRC/tools" && "$CARGO" build --release -j "$JOBS" "${PKGS[@]}" ) || fail "cargo build failed in $SRC/tools"
else
  ( cd "$SRC/tools" && "$CARGO" build --release "${PKGS[@]}" ) || fail "cargo build failed in $SRC/tools"
fi

# --- collect the binaries byod needs ----------------------------------------
BINS=(unpack unmap unrlen unmap-tile untim unlang-file ddw3-unvab-sep)
mkdir -p "$OUT"
for b in "${BINS[@]}"; do
  bin="$SRC/tools/target/release/$b"
  [ -x "$bin" ] || fail "expected binary was not built: $bin"
  cp -f "$bin" "$OUT/$b"
  chmod +x "$OUT/$b"
done

say "Done"
info "Marko's extractor binaries: $OUT"
info "byod:  python3 tools/byod/byod.py <disc> --out <tree> --tools $OUT"
