#!/usr/bin/env python3
"""Userspace toolchain for rebuilding the game files out of the public ddw3 tree.

The browser game reads several original binaries (the resident PS-X EXE, the
screen overlays, FIELDSTG, raw disc banks, ...). None of them are committed
here. The public decompilation (https://github.com/markisha64/ddw3) rebuilds
every one of them byte-identically from its sources -- its `checksums.sha256`
covers each build output -- and assembles them into a disc image. That build
needs a handful of external tools; this module fetches or compiles each one
into a private cache, with no sudo and no system packages:

  mips-elf binutils 2.45   source tarball from ftp.gnu.org, built with gcc/make
  mkpsxiso 2.20            upstream Linux release binary
  zbuild 0.1.10            upstream release binary (the ddw3 build driver)
  git-lfs 3.x              upstream Linux release binary
  fluidsynth 2.6.1         source tarball, built with cmake (no glib, no audio
                           drivers -- only the offline renderer the music stage uses)
  rust nightly + rust-src  through rustup (installed into ~/.rustup / ~/.cargo
                           when missing)

Cache location: $DW2003_TOOLCHAIN, default ~/.cache/dw2003-play/toolchain.

CLI:
    python3 tools/ddw3_toolchain.py git-lfs      # print path to a git-lfs binary
    python3 tools/ddw3_toolchain.py binutils     # print the mips-elf binutils bin dir
    python3 tools/ddw3_toolchain.py all          # provision everything, print PATH
"""
from __future__ import annotations

import hashlib
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

TOOLCHAIN = Path(os.environ.get("DW2003_TOOLCHAIN")
                 or Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache")
                 / "dw2003-play/toolchain")

BINUTILS_VERSION = "2.45"
BINUTILS_URL = f"https://ftpmirror.gnu.org/gnu/binutils/binutils-{BINUTILS_VERSION}.tar.xz"
BINUTILS_FALLBACK_URL = f"https://ftp.gnu.org/gnu/binutils/binutils-{BINUTILS_VERSION}.tar.xz"
MKPSXISO_URL = "https://github.com/Lameguy64/mkpsxiso/releases/download/v2.20/mkpsxiso-2.20-Linux.zip"
ZBUILD_URL = "https://github.com/Zenithsiz/zbuild/releases/download/0.1.10/zbuild"
GIT_LFS_VERSION = "3.8.0"
GIT_LFS_URL = (f"https://github.com/git-lfs/git-lfs/releases/download/v{GIT_LFS_VERSION}/"
               f"git-lfs-linux-{{arch}}-v{GIT_LFS_VERSION}.tar.gz")
FLUIDSYNTH_URL = "https://github.com/FluidSynth/fluidsynth/archive/refs/tags/v2.6.1.tar.gz"
RUSTUP_URL = "https://sh.rustup.rs"


def log(msg: str) -> None:
    print(f"[toolchain] {msg}", file=sys.stderr, flush=True)


def _jobs() -> int:
    return max(1, min(8, (os.cpu_count() or 2)))


def _download(url: str, dest: Path, fallback: str | None = None) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    last = None
    for u in (url, fallback) if fallback else (url,):
        try:
            log(f"downloading {u}")
            tmp = dest.with_suffix(dest.suffix + ".part")
            with urllib.request.urlopen(u, timeout=120) as r, open(tmp, "wb") as fh:
                shutil.copyfileobj(r, fh)
            tmp.replace(dest)
            return dest
        except Exception as e:  # network errors: try the fallback, then report
            last = e
    raise SystemExit(f"download failed: {url}: {last}")


def _run(cmd, **kw) -> None:
    log("$ " + " ".join(str(c) for c in cmd))
    subprocess.run([str(c) for c in cmd], check=True, **kw)


def _require_linux_x86_64(what: str) -> None:
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "AMD64"):
        raise SystemExit(f"{what}: only a Linux x86_64 binary is provisioned automatically; "
                         f"install it yourself and put it on PATH "
                         f"(this host: {platform.system()} {platform.machine()})")


# --- individual tools --------------------------------------------------------

def binutils() -> Path:
    """mips-elf-{as,ld,objcopy}: ddw3 assembles and links with these."""
    found = shutil.which("mips-elf-as")
    if found and shutil.which("mips-elf-ld") and shutil.which("mips-elf-objcopy"):
        return Path(found).parent
    prefix = TOOLCHAIN / "binutils"
    if (prefix / "bin/mips-elf-objcopy").exists():
        return prefix / "bin"
    for tool in ("gcc", "make"):
        if not shutil.which(tool):
            raise SystemExit(f"building mips-elf binutils needs '{tool}' (a C compiler and make)")
    src_tar = _download(BINUTILS_URL, TOOLCHAIN / f"src/binutils-{BINUTILS_VERSION}.tar.xz",
                        BINUTILS_FALLBACK_URL)
    with tempfile.TemporaryDirectory(prefix="binutils-", dir=TOOLCHAIN) as work:
        with tarfile.open(src_tar) as tf:
            tf.extractall(work)
        build = Path(work) / "build"
        build.mkdir()
        log("building mips-elf binutils (a few minutes, once)")
        env = {**os.environ, "MAKEINFO": "true"}
        _run([Path(work) / f"binutils-{BINUTILS_VERSION}/configure", "--target=mips-elf",
              f"--prefix={prefix}", "--disable-nls", "--disable-werror", "--disable-gdb",
              "--disable-gdbserver", "--disable-sim", "--disable-gprofng",
              "--disable-libdecnumber", "--disable-readline", "--without-zstd",
              "MAKEINFO=true"], cwd=build, env=env, stdout=subprocess.DEVNULL)
        _run(["make", f"-j{_jobs()}", "MAKEINFO=true"], cwd=build, env=env,
             stdout=subprocess.DEVNULL)
        _run(["make", "install", "MAKEINFO=true"], cwd=build, env=env, stdout=subprocess.DEVNULL)
    return prefix / "bin"


def mkpsxiso() -> Path:
    found = shutil.which("mkpsxiso")
    if found:
        return Path(found).parent
    bindir = TOOLCHAIN / "mkpsxiso/mkpsxiso-2.20-Linux/bin"
    if (bindir / "mkpsxiso").exists():
        return bindir
    _require_linux_x86_64("mkpsxiso")
    z = _download(MKPSXISO_URL, TOOLCHAIN / "src/mkpsxiso-2.20-Linux.zip")
    with zipfile.ZipFile(z) as zf:
        zf.extractall(TOOLCHAIN / "mkpsxiso")
    for f in bindir.iterdir():
        f.chmod(0o755)
    return bindir


def zbuild() -> Path:
    found = shutil.which("zbuild")
    if found:
        out = subprocess.run([found, "--version"], capture_output=True, text=True).stdout
        if "0.1.10" in out:
            return Path(found).parent
    bindir = TOOLCHAIN / "bin"
    exe = bindir / "zbuild"
    if not exe.exists():
        _require_linux_x86_64("zbuild")
        _download(ZBUILD_URL, exe)
        exe.chmod(0o755)
    return bindir


def git_lfs() -> Path:
    """Path to a git-lfs executable (system one, or a cached upstream release)."""
    found = shutil.which("git-lfs")
    if found:
        return Path(found)
    exe = TOOLCHAIN / "bin/git-lfs"
    if exe.exists():
        return exe
    if platform.system() != "Linux":
        raise SystemExit("git-lfs not found: install it from https://git-lfs.com and re-run")
    arch = {"x86_64": "amd64", "aarch64": "arm64"}.get(platform.machine())
    if not arch:
        raise SystemExit(f"git-lfs not found and no release binary for {platform.machine()}")
    tgz = _download(GIT_LFS_URL.format(arch=arch), TOOLCHAIN / f"src/git-lfs-{arch}.tar.gz")
    with tempfile.TemporaryDirectory(dir=TOOLCHAIN) as work:
        with tarfile.open(tgz) as tf:
            tf.extractall(work)
        cand = next(Path(work).rglob("git-lfs"))
        exe.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(cand, exe)
    exe.chmod(0o755)
    return exe


def rust() -> Path:
    """A nightly cargo with rust-src (ddw3 builds core for mipsel-sony-psx)."""
    cargo_home = Path(os.environ.get("CARGO_HOME") or Path.home() / ".cargo")
    rustup = shutil.which("rustup") or (cargo_home / "bin/rustup")
    if not Path(rustup).exists():
        log("installing rustup (userspace, ~/.rustup + ~/.cargo)")
        script = _download(RUSTUP_URL, TOOLCHAIN / "src/rustup-init.sh")
        _run(["sh", script, "-y", "--no-modify-path", "--profile", "minimal",
              "--default-toolchain", "nightly", "--component", "rust-src"])
        rustup = cargo_home / "bin/rustup"
    installed = subprocess.run([rustup, "toolchain", "list"], capture_output=True,
                               text=True).stdout
    if "nightly" not in installed:
        _run([rustup, "toolchain", "install", "nightly", "--profile", "minimal",
              "--component", "rust-src"])
    comps = subprocess.run([rustup, "component", "list", "--installed", "--toolchain", "nightly"],
                           capture_output=True, text=True).stdout
    if "rust-src" not in comps:
        _run([rustup, "component", "add", "rust-src", "--toolchain", "nightly"])
    return Path(rustup).parent


def fluidsynth() -> Path:
    """Offline MIDI renderer for the music stage (raw PCM output only)."""
    exe = TOOLCHAIN / "fluidsynth/bin/fluidsynth"
    if exe.exists():
        return exe
    cmake = shutil.which("cmake")
    if not cmake:
        uv = shutil.which("uv") or str(Path.home() / ".local/bin/uv")
        cmake_venv = TOOLCHAIN / "cmake-venv"
        if not (cmake_venv / "bin/cmake").exists():
            _run([uv, "venv", "-q", cmake_venv])
            _run([uv, "pip", "install", "-q", "--python", cmake_venv / "bin/python", "cmake"])
        cmake = str(cmake_venv / "bin/cmake")
    for tool in ("gcc", "g++", "make"):
        if not shutil.which(tool):
            raise SystemExit(f"building fluidsynth needs '{tool}'")
    tgz = _download(FLUIDSYNTH_URL, TOOLCHAIN / "src/fluidsynth-2.6.1.tar.gz")
    with tempfile.TemporaryDirectory(prefix="fluidsynth-", dir=TOOLCHAIN) as work:
        with tarfile.open(tgz) as tf:
            tf.extractall(work)
        src = Path(work) / "fluidsynth-2.6.1"
        build = src / "b"
        build.mkdir()
        off = ["libsndfile", "alsa", "pulseaudio", "pipewire", "jack", "sdl3", "dbus",
               "readline", "network", "ladspa", "oss", "midishare", "systemd", "openmp"]
        log("building fluidsynth (a minute or two, once)")
        _run([cmake, "..", "-DCMAKE_BUILD_TYPE=Release",
              f"-DCMAKE_INSTALL_PREFIX={TOOLCHAIN / 'fluidsynth'}", "-Dosal=cpp11",
              "-DBUILD_SHARED_LIBS=off", *[f"-Denable-{o}=off" for o in off]],
             cwd=build, stdout=subprocess.DEVNULL)
        _run(["make", f"-j{_jobs()}"], cwd=build, stdout=subprocess.DEVNULL)
        _run(["make", "install"], cwd=build, stdout=subprocess.DEVNULL)
    if not exe.exists():
        raise SystemExit("fluidsynth build finished but the binary is missing")
    return exe


def ddw3_build_path() -> str:
    """PATH with every tool the ddw3 zbuild needs in front."""
    dirs = [binutils(), mkpsxiso(), zbuild(), rust()]
    return os.pathsep.join([str(d) for d in dirs] + [os.environ.get("PATH", "")])


def main(argv: list[str]) -> int:
    what = argv[1] if len(argv) > 1 else "all"
    if what == "git-lfs":
        print(git_lfs())
    elif what == "binutils":
        print(binutils())
    elif what == "fluidsynth":
        print(fluidsynth())
    elif what == "all":
        print(ddw3_build_path())
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
