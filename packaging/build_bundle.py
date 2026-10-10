#!/usr/bin/env python3
"""Assemble a self-contained DW2003 bundle for the current OS.

    python packaging/build_bundle.py --bin <dir> --out dist/DW2003 [--version v1.2.3]

The bundle contains no game data — only the game code, a portable Python and
Node, and the tools that turn the player's disc into the game's assets:

    DW2003/
      app/              this repository (git HEAD), plus node_modules
      runtime/python/   portable CPython with the build's packages installed
      runtime/node/     portable Node.js
      runtime/bin/      Marko's extractors, mips objdump, fluidsynth (from --bin)

The launcher (app/launcher/dw2003.py, run on runtime/python) does the rest on
the player's machine. The OS installers (packaging/*) wrap this directory.
"""
from __future__ import annotations

import argparse
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

REPO = Path(__file__).resolve().parent.parent
PYTHON_TAG = "20261009"
PYTHON_VERSION = "3.12.15"
PYTHON_URL = ("https://github.com/astral-sh/python-build-standalone/releases/download/"
              f"{PYTHON_TAG}/cpython-{PYTHON_VERSION}+{PYTHON_TAG}-{{triple}}-install_only.tar.gz")
NODE_VERSION = "v24.21.0"
NODE_URL = f"https://nodejs.org/dist/{NODE_VERSION}/node-{NODE_VERSION}-{{plat}}.{{ext}}"
# What the build's Python stages import (build_all.py BASE_WITH + every stage's uv_with).
PY_PACKAGES = ["pillow", "numpy", "toml", "capstone", "imageio-ffmpeg", "mido",
               "soundfile", "pycparser==2.22"]
EXE = ".exe" if os.name == "nt" else ""
BIN_REQUIRED = ["unpack", "unmap", "unrlen", "unmap-tile", "untim", "unlang-file",
                "ddw3-unvab-sep", "mips-elf-objdump", "fluidsynth"]


def host() -> tuple[str, str]:
    """(python-build-standalone triple, node platform) for this machine."""
    m = platform.machine().lower()
    arm = m in ("arm64", "aarch64")
    if sys.platform == "win32":
        return "x86_64-pc-windows-msvc", "win-x64"
    if sys.platform == "darwin":
        return ("aarch64-apple-darwin", "darwin-arm64") if arm else ("x86_64-apple-darwin", "darwin-x64")
    return ("aarch64-unknown-linux-gnu", "linux-arm64") if arm else ("x86_64-unknown-linux-gnu", "linux-x64")


def log(msg: str):
    print(f"[bundle] {msg}", flush=True)


def download(url: str, dest: Path) -> Path:
    if dest.exists():
        return dest
    log(f"download {url}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "dw2003-bundle"})
    with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as out:
        shutil.copyfileobj(r, out)
    tmp.rename(dest)
    return dest


def extract(archive: Path, dest: Path, strip_top: bool = True):
    """Extract, dropping the archive's single top-level directory."""
    with tempfile.TemporaryDirectory(dir=dest.parent) as work:
        if archive.name.endswith(".zip"):
            with zipfile.ZipFile(archive) as z:
                z.extractall(work)
        else:
            with tarfile.open(archive) as t:
                t.extractall(work, filter="tar") if hasattr(tarfile, "data_filter") else t.extractall(work)
        top = [p for p in Path(work).iterdir()]
        src = top[0] if strip_top and len(top) == 1 and top[0].is_dir() else Path(work)
        if dest.exists():
            shutil.rmtree(dest)
        shutil.move(str(src), str(dest))


def run(cmd, **kw):
    log("$ " + " ".join(str(c) for c in cmd))
    subprocess.run([str(c) for c in cmd], check=True, **kw)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bin", required=True, help="dir with the extractors, mips-elf-objdump and fluidsynth")
    ap.add_argument("--out", required=True, help="bundle directory to create")
    ap.add_argument("--version", default=None, help="version string (default: git describe)")
    ap.add_argument("--cache", default=str(REPO / "build/bundle-cache"), help="download cache")
    a = ap.parse_args(argv)

    out = Path(a.out).resolve()
    cache = Path(a.cache).resolve()
    bin_src = Path(a.bin).resolve()
    missing = [b for b in BIN_REQUIRED if not (bin_src / f"{b}{EXE}").exists()]
    if missing:
        raise SystemExit(f"--bin {bin_src} is missing: {', '.join(missing)}")
    triple, node_plat = host()
    ver = a.version or subprocess.run(["git", "describe", "--tags", "--always", "--dirty"], cwd=REPO,
                                      capture_output=True, text=True).stdout.strip() or "dev"
    if out.exists():
        shutil.rmtree(out)
    (out / "runtime").mkdir(parents=True)

    # 1. game code: exactly what git tracks, nothing local
    log(f"app ({ver})")
    with tempfile.TemporaryDirectory() as work:
        tar = Path(work) / "app.tar"
        run(["git", "archive", "--format=tar", "-o", tar, "HEAD"], cwd=REPO)
        (out / "app").mkdir()
        with tarfile.open(tar) as t:
            t.extractall(out / "app")
    (out / "app/launcher/VERSION").write_text(ver + "\n")

    # 2. portable Python + the build's packages
    py_arc = download(PYTHON_URL.format(triple=triple), cache / f"python-{triple}.tar.gz")
    extract(py_arc, out / "runtime/python")
    py = out / "runtime/python" / ("python.exe" if os.name == "nt" else "bin/python3")
    run([py, "-m", "pip", "install", "--no-cache-dir", "--disable-pip-version-check",
         "--no-warn-script-location", *PY_PACKAGES])

    # 3. portable Node, and the repo's node_modules (esbuild's per-OS binary)
    ext = "zip" if os.name == "nt" else "tar.gz"
    node_arc = download(NODE_URL.format(plat=node_plat, ext=ext), cache / f"node-{node_plat}.{ext}")
    extract(node_arc, out / "runtime/node")
    node_bin = out / "runtime/node" if os.name == "nt" else out / "runtime/node/bin"
    npm = node_bin / ("npm.cmd" if os.name == "nt" else "npm")
    env = {**os.environ, "PATH": str(node_bin) + os.pathsep + os.environ.get("PATH", "")}
    # --ignore-scripts: playwright's postinstall would download a browser (dev only).
    run([npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
        cwd=out / "app", env=env, shell=os.name == "nt")

    # 4. tools
    shutil.copytree(bin_src, out / "runtime/bin")
    if os.name != "nt":
        for f in (out / "runtime/bin").iterdir():
            f.chmod(0o755)

    # 5. self-test on the bundled interpreter
    run([py, out / "app/launcher/dw2003.py", "--self-test"])
    size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    log(f"done: {out} ({size / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
