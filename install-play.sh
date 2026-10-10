#!/usr/bin/env bash
# install-play.sh — build and play the Digimon World 2003 browser recreation.
#
# The game's data is NOT bundled and is NOT downloaded by default. You supply
# it from your own copy of the game:
#
#   ./install-play.sh --disc /path/to/your/disc.bin
#       decode YOUR disc (PAL/EU, SLES-03936) into the data tree the build
#       reads, then build and play. The decode uses Marko's (markisha64/ddw3)
#       extractor binaries, built from the ddw3 source (credit and details:
#       tools/byod/README.md). The toolchain, the disc tree and the ddw3
#       source are cached under ~/.cache/dw2003-play/ and reused on later runs.
#
#   ./install-play.sh --ddw3 /path/to/tree
#       use a ddw3-shaped data tree you already have (~/ddw3 is used when present).
#
#   ./install-play.sh --fetch-data
#       OPT-IN: download a third-party copy of the game's data from
#       https://github.com/markisha64/ddw3 (a fan project; the data remains the
#       original game's copyright). Only this flag downloads game data.
#
# No disc image and no sudo are needed for the build itself: it fetches and
# compiles its own toolchain (mips binutils, mkpsxiso, zbuild, fluidsynth,
# git-lfs; rust nightly through rustup) into ~/.cache/dw2003-play/toolchain
# on the first run.
#
# Usage:
#   ./install-play.sh                       # use ~/ddw3 if it is a data tree
#   ./install-play.sh --disc disc.bin       # build the tree from your own disc
#   ./install-play.sh --ddw3 /path/to/ddw3  # use an existing data tree
#   ./install-play.sh --fetch-data          # OPT-IN: download the data tree
#   ./install-play.sh --port 9000           # serve on another port
#   ./install-play.sh --no-serve            # build only, do not serve
#   ./install-play.sh --rebuild             # force a tree + asset rebuild
#   ./install-play.sh --skip-prereqs        # do not install python/node/uv
#
# Disc-route options (all cached under ~/.cache/dw2003-play/ by default):
#   --tools DIR        Marko's extractor binaries; built on demand from the
#                      ddw3 source when not given
#   --ddw3-src DIR     ddw3 source checkout used to build the tools and to copy
#                      the non-derivable support files (default: ~/ddw3 when it
#                      is a checkout, else cloned with git-lfs data skipped;
#                      the checkout still includes ddw3's plain-text files)
#   --objdump-bin BIN  mipsel/mips objdump for the asm/ step (default: found on
#                      PATH, else mips-elf binutils built into the toolchain)
#   --disc-tree DIR    where the generated tree is cached (default: <cache>/disc-tree)
#
# Host needs: git, curl, a C/C++ compiler and make (gcc/g++), python3, node 18+.
# The disc route additionally needs a Rust toolchain (cargo) once, to build the
# extractor binaries from the ddw3 source (https://rustup.rs; userspace, no sudo).
# Linux x86_64 is the tested platform (mkpsxiso/zbuild release binaries).
# A full first build takes roughly 20-40 minutes and ~6 GB of disk.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=8080
DDW3_ARG=""
DISC_ARG=""
TOOLS_ARG=""
OBJDUMP_ARG=""
DDW3_SRC_ARG=""
DISC_TREE_ARG=""
SERVE=1
REBUILD=0
SKIP_PREREQS=0
FETCH_DATA=0
# The ddw3 commit this tree is tested against (override: DDW3_REF=<ref>).
DDW3_REF="${DDW3_REF:-b125b3d7471c23d305b27f0b1d7a2353643a3ee3}"
DDW3_URL="${DDW3_URL:-https://github.com/markisha64/ddw3}"

while [ $# -gt 0 ]; do
  case "$1" in
    --ddw3)          DDW3_ARG="${2:-}"; shift 2 ;;
    --ddw3=*)        DDW3_ARG="${1#*=}"; shift ;;
    --disc)          DISC_ARG="${2:-}"; shift 2 ;;
    --disc=*)        DISC_ARG="${1#*=}"; shift ;;
    --tools)         TOOLS_ARG="${2:-}"; shift 2 ;;
    --tools=*)       TOOLS_ARG="${1#*=}"; shift ;;
    --objdump-bin)   OBJDUMP_ARG="${2:-}"; shift 2 ;;
    --objdump-bin=*) OBJDUMP_ARG="${1#*=}"; shift ;;
    --ddw3-src)      DDW3_SRC_ARG="${2:-}"; shift 2 ;;
    --ddw3-src=*)    DDW3_SRC_ARG="${1#*=}"; shift ;;
    --disc-tree)     DISC_TREE_ARG="${2:-}"; shift 2 ;;
    --disc-tree=*)   DISC_TREE_ARG="${1#*=}"; shift ;;
    --fetch-data)    FETCH_DATA=1; shift ;;
    --port)          PORT="${2:-}"; shift 2 ;;
    --port=*)        PORT="${1#*=}"; shift ;;
    --no-serve)      SERVE=0; shift ;;
    --rebuild)       REBUILD=1; shift ;;
    --skip-prereqs)  SKIP_PREREQS=1; shift ;;
    -h|--help)       sed -n '2,51p' "$0"; exit 0 ;;
    *) echo "install-play: unknown option '$1' (try --help)" >&2; exit 2 ;;
  esac
done

say()  { printf '\n== %s\n' "$*"; }
fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
info() { printf '  %s\n' "$*"; }
trap 'rc=$?; [ $rc -ne 0 ] && printf "\ninstall-play: stopped (exit %s). Fix the error above and re-run; finished steps are skipped.\n" "$rc" >&2' EXIT

# Expand a leading ~ in a path argument (the shell only does this unquoted) and
# make it absolute, so relative paths keep working after the script changes cwd.
expand_tilde() { case "$1" in "~") printf '%s' "$HOME" ;; "~/"*) printf '%s' "$HOME/${1#\~/}" ;; *) printf '%s' "$1" ;; esac; }
abs_path() { [ -n "$1" ] || { printf '%s' ""; return; }; case "$1" in /*) printf '%s' "$1" ;; *) printf '%s/%s' "$PWD" "$1" ;; esac; }
DISC_ARG="$(abs_path "$(expand_tilde "$DISC_ARG")")"
TOOLS_ARG="$(abs_path "$(expand_tilde "$TOOLS_ARG")")"
OBJDUMP_ARG="$(abs_path "$(expand_tilde "$OBJDUMP_ARG")")"
DDW3_SRC_ARG="$(abs_path "$(expand_tilde "$DDW3_SRC_ARG")")"
DISC_TREE_ARG="$(abs_path "$(expand_tilde "$DISC_TREE_ARG")")"
DDW3_ARG="$(abs_path "$(expand_tilde "$DDW3_ARG")")"

if [ -n "$DISC_ARG" ] && { [ -n "$DDW3_ARG" ] || [ "$FETCH_DATA" = 1 ]; }; then
  fail "--disc builds its own tree from your disc; do not combine it with --ddw3 or --fetch-data"
fi

# --- OS detection ----------------------------------------------------------
OS="unknown"; PKG_MANAGER=""; SUDO=""
case "$(uname -s)" in
  Linux)
    OS="linux"
    for pm in apt-get dnf pacman zypper; do
      if command -v "$pm" >/dev/null 2>&1; then PKG_MANAGER="${pm%-get}"; break; fi
    done
    [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"
    ;;
  Darwin) OS="macos"; command -v brew >/dev/null 2>&1 && PKG_MANAGER="brew" ;;
  MINGW*|MSYS*|CYGWIN*) OS="windows"; command -v winget >/dev/null 2>&1 && PKG_MANAGER="winget" ;;
esac

if [ "$OS" = "windows" ]; then
  fail "native Windows shells are not supported (the ddw3 build needs a Linux toolchain). Run this script inside WSL2 (Ubuntu)."
fi

# --- Prerequisites (optional; everything else is userspace) ----------------
pkg_install() {  # pkg_install <apt names> <dnf names> <pacman names> <zypper names> <brew names>
  case "$PKG_MANAGER" in
    apt)    $SUDO apt-get update -qq && $SUDO apt-get install -y -qq $1 ;;
    dnf)    $SUDO dnf install -y $2 ;;
    pacman) $SUDO pacman -Sy --noconfirm $3 ;;
    zypper) $SUDO zypper install -y $4 ;;
    brew)   brew install $5 ;;
    *)      return 1 ;;
  esac
}

install_prereqs() {
  command -v python3 >/dev/null 2>&1 || pkg_install python3 python3 python python3 python@3.12 \
    || fail "install Python 3.10+ (https://python.org) and re-run"
  command -v git >/dev/null 2>&1 || pkg_install git git git git git || fail "install git and re-run"
  command -v curl >/dev/null 2>&1 || pkg_install curl curl curl curl curl || fail "install curl and re-run"
  if ! command -v gcc >/dev/null 2>&1 || ! command -v g++ >/dev/null 2>&1 || ! command -v make >/dev/null 2>&1; then
    pkg_install "build-essential" "gcc gcc-c++ make" "base-devel" "gcc gcc-c++ make" "gcc make" \
      || fail "install a C/C++ compiler and make (gcc, g++, make) and re-run"
  fi
  local major=0
  command -v node >/dev/null 2>&1 && major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "${major:-0}" -lt 18 ]; then
    pkg_install "nodejs npm" "nodejs npm" "nodejs npm" "nodejs npm" node \
      || fail "install Node.js 18+ (https://nodejs.org) and re-run"
  fi
  if ! command -v uv >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/uv" ]; then
    info "installing uv (userspace)"
    curl -LsSf https://astral.sh/uv/install.sh | sh
  fi
}

say "Digimon World 2003 — browser recreation"
info "OS: $OS  package manager: ${PKG_MANAGER:-none}"
if [ "$SKIP_PREREQS" = 0 ]; then
  say "Checking prerequisites"
  install_prereqs
fi
for tool in python3 node npm git curl gcc g++ make; do
  command -v "$tool" >/dev/null 2>&1 || fail "'$tool' not found on PATH"
done
export PATH="$HOME/.local/bin:$PATH"
command -v uv >/dev/null 2>&1 || fail "uv not found (https://docs.astral.sh/uv); install it or run without --skip-prereqs"
info "python3 $(python3 --version 2>&1 | cut -d' ' -f2), node $(node --version), uv $(uv --version | cut -d' ' -f2)"

# --- git-lfs (lazy: obtained only when ddw3's LFS objects must be fetched) ---
# The --disc route never needs it (its ddw3-source clone skips LFS smudge), and
# neither does a --ddw3 tree that is not a git checkout or already has its LFS
# objects. Only a git tree still holding pointer files (incl. --fetch-data) does.
ensure_git_lfs() {
  say "git-lfs"
  LFS_BIN="$(python3 "$REPO/tools/ddw3_toolchain.py" git-lfs | tail -n 1)" || fail "could not obtain git-lfs (install it from https://git-lfs.com)"
  export PATH="$(dirname "$LFS_BIN"):$PATH"
  git lfs version >/dev/null 2>&1 || fail "git-lfs at $LFS_BIN does not run"
  info "$(git lfs version)"
}

# --- game data: your own disc, or a ddw3-shaped tree -----------------------
DEFAULT_DDW3="$HOME/ddw3"
DDW3="${DDW3_ARG:-$DEFAULT_DDW3}"
CACHE_BASE="${XDG_CACHE_HOME:-$HOME/.cache}/dw2003-play"
looks_like_ddw3() { [ -f "$1/zbuild.zb" ] && [ -d "$1/asm/dw2003" ] && [ -d "$1/pack/dw2003" ]; }
looks_like_ddw3_src() { [ -f "$1/tools/Cargo.toml" ] && [ -d "$1/asm/dw2003" ]; }
byod_tools_ok() { for t in unpack unmap unrlen unmap-tile untim unlang-file ddw3-unvab-sep; do [ -x "$1/$t" ] || return 1; done; }
lfs_ok() { ! head -c 40 "$1/dw2003/AAA/DAT/FIELD/FIELDCOM.BIN" 2>/dev/null | grep -q "version https://git-lfs"; }

BUILD_ARGS=()
TREE_REGENERATED=0

if [ -n "$DISC_ARG" ]; then
  # --- the player's own disc ------------------------------------------------
  say "Game data: decoding your disc"
  [ -f "$DISC_ARG" ] || fail "disc image not found: $DISC_ARG (pass the .bin/.iso dump of your PAL/EU disc)"

  DISC_TREE="${DISC_TREE_ARG:-${DW2003_DISC_TREE:-$CACHE_BASE/disc-tree}}"

  # 1. A ddw3 source checkout: used to build Marko's extractor binaries and to
  #    copy the non-derivable support files (asm/ copies, rust/ tables, utils).
  DDW3_SRC="$DDW3_SRC_ARG"
  if [ -z "$DDW3_SRC" ]; then
    if looks_like_ddw3_src "$HOME/ddw3"; then
      DDW3_SRC="$HOME/ddw3"
    elif looks_like_ddw3_src "$CACHE_BASE/ddw3-src"; then
      DDW3_SRC="$CACHE_BASE/ddw3-src"
    else
      DDW3_SRC="$CACHE_BASE/ddw3-src"
      info "fetching the ddw3 source (git-lfs game-data objects are skipped; the checkout still includes ddw3's plain-text files)"
      info "credit: Marko (markisha64/ddw3) — his extractors decode the disc; the support files come from here"
      GIT_LFS_SKIP_SMUDGE=1 git clone -q "$DDW3_URL" "$DDW3_SRC" \
        || fail "could not clone $DDW3_URL (offline? pass --ddw3-src <checkout>)"
      git -C "$DDW3_SRC" -c advice.detachedHead=false checkout -q "$DDW3_REF" \
        || fail "could not check out $DDW3_REF in $DDW3_SRC"
    fi
  fi
  looks_like_ddw3_src "$DDW3_SRC" || fail "'$DDW3_SRC' is not a ddw3 source checkout (expected tools/Cargo.toml and asm/dw2003)"
  info "ddw3 source: $DDW3_SRC ($(git -C "$DDW3_SRC" rev-parse --short HEAD 2>/dev/null || echo 'not a git checkout'))"

  # 2. Marko's extractor binaries (the decoders byod drives).
  BYOD_TOOLS="${TOOLS_ARG:-${BYOD_DDW3_TOOLS:-$CACHE_BASE/ddw3-tools}}"
  if ! byod_tools_ok "$BYOD_TOOLS"; then
    say "Building Marko's extractor binaries"
    "$REPO/tools/byod/build-ddw3-tools.sh" --ddw3-src "$DDW3_SRC" --out "$BYOD_TOOLS" \
      || fail "could not build Marko's extractor binaries (see above); you can also pass --tools <dir>"
  fi
  byod_tools_ok "$BYOD_TOOLS" || fail "Marko's extractor binaries are incomplete in $BYOD_TOOLS"
  info "extractor binaries: $BYOD_TOOLS"

  # 3. An objdump for the asm/ companion step.
  OBJDUMP="$OBJDUMP_ARG"
  if [ -z "$OBJDUMP" ]; then
    OBJDUMP="$(command -v mipsel-linux-gnu-objdump || command -v mips-elf-objdump || true)"
  fi
  if [ -z "$OBJDUMP" ]; then
    say "Building mips-elf binutils for the asm/ step (a few minutes, once)"
    BINUTILS_BIN="$(python3 "$REPO/tools/ddw3_toolchain.py" binutils | tail -n 1)" \
      || fail "could not build mips-elf binutils; install binutils-mipsel-linux-gnu or pass --objdump-bin"
    OBJDUMP="$BINUTILS_BIN/mips-elf-objdump"
  fi
  [ -x "$OBJDUMP" ] || fail "objdump not executable: $OBJDUMP"
  info "objdump: $OBJDUMP"

  # 4. Disc -> data tree (cached; regenerated when the disc or --rebuild changes).
  say "Decoding the disc into a data tree"
  DISC_ID="$(stat -L -c '%s:%Y' "$DISC_ARG" 2>/dev/null || stat -L -f '%z:%m' "$DISC_ARG" 2>/dev/null || echo unknown)"
  MARKER="$DISC_TREE/.byod-tree-ok"
  if [ -f "$MARKER" ] && [ "$REBUILD" = 0 ] && [ "$(cat "$MARKER" 2>/dev/null)" = "$DISC_ID" ]; then
    info "reusing $DISC_TREE (built from this disc; --rebuild regenerates)"
  else
    if [ -e "$DISC_TREE" ]; then
      if [ "$REBUILD" = 1 ] || [ -e "$DISC_TREE/_work" ] || [ -e "$DISC_TREE/_disc" ]; then
        rm -rf "$DISC_TREE"
      else
        fail "$DISC_TREE exists and does not look like a generated tree; move it aside or pass --disc-tree"
      fi
    fi
    mkdir -p "$DISC_TREE"
    python3 "$REPO/tools/byod/byod.py" "$DISC_ARG" --out "$DISC_TREE" --tools "$BYOD_TOOLS" \
      || fail "the disc -> tree decode failed (see above)"
    say "Regenerating asm/ from the disc"
    python3 "$REPO/tools/byod/byod_asm.py" --staging "$DISC_TREE/_disc" \
      --objdump-bin "$OBJDUMP" --ddw3 "$DDW3_SRC" --out "$DISC_TREE" \
      --report "$DISC_TREE/_work/asm_report.json" \
      || fail "the asm/ regeneration step failed (see above)"
    info "copying the non-derivable support files from the ddw3 checkout"
    mkdir -p "$DISC_TREE/tools/ddw3-lang-file/src" "$DISC_TREE/iso/dw2003-bootstrap" "$DISC_TREE/data"
    cp -a "$DDW3_SRC/rust" "$DISC_TREE/"
    cp -f "$DDW3_SRC/tools/util.py" "$DDW3_SRC/tools/stitch-map.py" "$DISC_TREE/tools/"
    cp -f "$DDW3_SRC/tools/ddw3-lang-file/src/codepoint.rs" "$DISC_TREE/tools/ddw3-lang-file/src/"
    cp -f "$DDW3_SRC/iso/dw2003-bootstrap/lbas.toml" "$DISC_TREE/iso/dw2003-bootstrap/"
    cp -f "$DDW3_SRC/data/digimon_profiles.toml" "$DISC_TREE/data/"
    printf '%s' "$DISC_ID" > "$MARKER"
    TREE_REGENERATED=1
  fi
  export DDW3_DIR="$DISC_TREE"
  export DW3_DISC="$DISC_ARG"
  BUILD_ARGS=(--skip ddw3_disc)
  info "data tree: $DISC_TREE"
else

say "Game data"
if ! looks_like_ddw3 "$DDW3"; then
  if [ -n "$DDW3_ARG" ]; then
    fail "'$DDW3' is not a game-data tree (expected zbuild.zb, asm/dw2003, pack/dw2003). Build one from your own copy of the game (see README: ./install-play.sh --disc <your disc>), or run --fetch-data."
  fi
  [ -e "$DDW3" ] && fail "'$DDW3' exists but is not a game-data tree; move it aside or pass --ddw3"
  if [ "$FETCH_DATA" != 1 ]; then
    fail "no game-data tree at $DDW3.
The game's data is copyrighted and is NOT downloaded by default.
  - build the tree from your own disc: ./install-play.sh --disc <your disc>, or
  - point --ddw3 at a tree you already have, or
  - re-run with --fetch-data to download a third-party copy of the game's data."
  fi
  printf '\n  NOTICE: --fetch-data downloads a third-party copy of the game data\n  (the original game is (c) Bandai Namco / Banpresto) from\n  %s\n  That copy is not covered by this project; download it only where legal.\n\n' "$DDW3_URL"
  info "cloning $DDW3_URL -> $DDW3 (pointer files first, LFS data next)"
  GIT_LFS_SKIP_SMUDGE=1 git clone -q "$DDW3_URL" "$DDW3"
  git -C "$DDW3" -c advice.detachedHead=false checkout -q "$DDW3_REF"
fi
if git -C "$DDW3" rev-parse --git-dir >/dev/null 2>&1; then
  if lfs_ok "$DDW3"; then
    info "'$DDW3' is a git checkout with its git-lfs objects already present; nothing to fetch"
  else
    ensure_git_lfs
    git -C "$DDW3" lfs install --local >/dev/null
    info "downloading git-lfs objects (~1.3 GB, once)"
    git -C "$DDW3" lfs pull || fail "git lfs pull failed in $DDW3 (network? GitHub LFS quota?)"
  fi
  lfs_ok "$DDW3" || fail "$DDW3 still contains git-lfs pointer files after 'git lfs pull'"
else
  # A tree built by byod (or any non-git tree) has no git-lfs pointers to
  # fetch; the old unconditional 'git lfs install' aborted here (exit 128).
  lfs_ok "$DDW3" || fail "$DDW3 is not a git checkout but still contains git-lfs pointer files; use the ddw3 checkout it came from, or re-run with --fetch-data"
  info "'$DDW3' is not a git checkout; skipping git-lfs setup (a byod-built tree needs none)"
fi
info "data tree: $DDW3 ($(git -C "$DDW3" rev-parse --short HEAD 2>/dev/null || echo 'not a git checkout'))"
export DDW3_DIR="$DDW3"

fi

# --- Node dependencies -----------------------------------------------------
say "Node dependencies"
if [ -d "$REPO/node_modules/esbuild" ]; then
  info "already installed"
else
  ( cd "$REPO" && npm install --no-audit --no-fund --ignore-scripts ) || fail "npm install failed"
fi

# --- Python environment ----------------------------------------------------
say "Python environment"
if [ -x "$REPO/.venv/bin/python3" ]; then
  info "already present"
else
  ( cd "$REPO" && uv venv -q .venv \
      && uv pip install -q --python .venv/bin/python3 pillow toml numpy capstone ) \
    || fail "could not create .venv"
  info "created .venv (pillow, toml, numpy, capstone)"
fi

# --- Build -----------------------------------------------------------------
say "Building game assets (first run: 20-40 minutes)"
if [ "$REBUILD" = 0 ] && [ "$TREE_REGENERATED" = 0 ] && [ -f "$REPO/build/.install-ok" ]; then
  info "already built (use --rebuild to rebuild)"
else
  mkdir -p "$REPO/build"
  rm -f "$REPO/build/.install-ok"
  set +e
  ( cd "$REPO" && python3 build_all.py ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"} ) 2>&1 | tee "$REPO/build/install-build.log"
  rc="${PIPESTATUS[0]}"
  set -e
  if [ "$rc" != 0 ]; then
    printf '\nThe build did not finish. Failed stages and the end of their logs:\n' >&2
    for log in $(grep -o 'log [^ )]*\.log' "$REPO/build/install-build.log" 2>/dev/null | cut -d' ' -f2 | sort -u); do
      printf '\n--- %s\n' "$log" >&2; tail -n 15 "$log" >&2 || true
    done
    fail "build_all.py exited with $rc (full output: $REPO/build/install-build.log)"
  fi
  for f in web/assets/manifest.json web/assets/maps/s200.png web/assets/native/screens/resident.bin web/vendor/engine.js; do
    [ -f "$REPO/$f" ] || fail "the build finished but $f is missing"
  done
  touch "$REPO/build/.install-ok"
fi

say "Build complete!"
if [ "$SERVE" = 0 ]; then
  info "Serve with: python3 -m http.server $PORT --directory $REPO/web   then open http://localhost:$PORT/"
  exit 0
fi

if [ -t 0 ]; then
  printf '\n  Start the game now? [Y/n] '
  answer=""
  read -r answer || answer=""
  case "$answer" in
    [nN]*) info "To play later: python3 -m http.server $PORT --directory $REPO/web"; exit 0 ;;
  esac
fi

say "Starting the game"
printf '  Serving %s\n  Open:  http://localhost:%s/\n  Stop:  Ctrl-C\n' "$REPO/web" "$PORT"
exec python3 -m http.server "$PORT" --directory "$REPO/web"
