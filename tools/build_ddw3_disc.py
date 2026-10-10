#!/usr/bin/env python3
"""Rebuild the game's disc files from the public ddw3 decompilation tree.

This is the root stage of build_all.py. It runs ddw3's own build (zbuild) in
the ddw3 checkout, which assembles/links the resident EXE and every overlay,
re-encodes the language files and packs, and lays them out into
`$DDW3/build/iso/dw2003.bin` with the same LBA table the retail EXE carries.
ddw3's `checksums.sha256` covers every build output; this stage re-checks the
ones the game reads (EXE, overlays, LBA tables) and stops on any mismatch.

It then runs ddw3's own `tools/extract_all_sound.sh` (VAB/SEQ -> WAV/MIDI +
TOML) into `$DDW3/sound/dw2003`, which the music and sfx stages read.

Nothing here touches tracked ddw3 files: everything lands in the gitignored
`build/`, plus `licenses/` and `sound/` (both untracked upstream).

The licenses the ddw3 build asks for are not game data:
  psexe-eu.dat / psexe-na.dat  the PS-X EXE region text, written verbatim and
                               checked against ddw3's checksums.sha256;
  psx-bin.dat                  the disc's Sony license sectors (0-11). Only
                               mkpsxiso reads it and no tool here reads those
                               sectors back, so a zero-filled stand-in is used.

Known, unrecoverable difference from a retail disc: ddw3 keeps each STR movie
as 2048-byte sectors, so the XA audio sectors inside the movies are truncated
(2048 of their 2304 audio bytes). See tools/extract_opening_movies.py.
"""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ddw3_toolchain  # noqa: E402

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
ISO = DDW3 / "build/iso/dw2003.bin"
SOUND_MARK = DDW3 / "sound/dw2003/common.toml"
LICENSES = {
    "psexe-eu.dat": b"Sony Computer Entertainment Inc. for Europe area",
    "psexe-na.dat": b"Sony Computer Entertainment Inc. for North America area",
    "psx-bin.dat": bytes(0x6D80),
}
# Build outputs the browser game depends on; each must match checksums.sha256.
CHECKED = (
    "build/psexe/dw2003/exe.psexe",
    "build/iso/dw2003-bootstrap.lba-offsets",
    "build/iso/dw2003-bootstrap.lba-len-sectors",
    "build/raw_exe/dw2003/pro/fieldstg.bin",
    "build/raw_exe/dw2003/pro/stdwtitl.bin",
    "build/raw_exe/dw2003/pro/fightstg.bin",
)


def log(msg: str) -> None:
    print(f"[ddw3_disc] {msg}", flush=True)


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def check_tree() -> None:
    if not (DDW3 / "zbuild.zb").exists() or not (DDW3 / "asm/dw2003").is_dir():
        raise SystemExit(f"{DDW3} is not a ddw3 checkout (clone https://github.com/markisha64/ddw3)")
    probe = DDW3 / "dw2003/AAA/DAT/FIELD/FIELDCOM.BIN"
    with open(probe, "rb") as fh:
        if fh.read(40).startswith(b"version https://git-lfs"):
            raise SystemExit(f"{probe} is a git-lfs pointer: run `git lfs pull` in {DDW3} first")


def write_licenses() -> None:
    d = DDW3 / "licenses"
    d.mkdir(exist_ok=True)
    for name, data in LICENSES.items():
        p = d / name
        if not p.exists() or p.read_bytes() != data:
            p.write_bytes(data)


def python_venv() -> None:
    """ddw3's zbuild makes tools/.venv with `python3 -m venv` + pip, which many
    distros ship without; pre-create it with uv so that rule is already satisfied."""
    venv = DDW3 / "tools/.venv"
    py = venv / "bin/python3"
    pip = venv / "bin/pip3"
    reqs = DDW3 / "tools/requirements.txt"
    if py.exists() and pip.exists() and pip.stat().st_mtime >= reqs.stat().st_mtime:
        return
    uv = shutil.which("uv") or str(Path.home() / ".local/bin/uv")
    subprocess.run([uv, "venv", "-q", "--seed", "--allow-existing", str(venv)], check=True)
    subprocess.run([uv, "pip", "install", "-q", "--python", str(py), "-r", str(reqs)], check=True)
    os.utime(py, None, follow_symlinks=False)
    os.utime(pip, None, follow_symlinks=False)


def expected_checksums() -> dict[str, str]:
    out = {}
    for line in (DDW3 / "checksums.sha256").read_text().splitlines():
        parts = line.split()
        if len(parts) == 2:
            out[parts[1]] = parts[0]
    return out


def main() -> int:
    check_tree()
    write_licenses()
    python_venv()
    env = {**os.environ, "PATH": ddw3_toolchain.ddw3_build_path(), "RUSTUP_TOOLCHAIN": "nightly"}
    zb = shutil.which("zbuild", path=env["PATH"]) or "zbuild"
    jobs = str(max(1, (os.cpu_count() or 2) - 1))
    log(f"zbuild in {DDW3} (-j {jobs})")
    rc = subprocess.call([zb, "-j", jobs], cwd=DDW3, env=env)
    if rc != 0 or not ISO.exists():
        raise SystemExit(f"ddw3 zbuild failed (rc={rc}); see the output above")
    want = expected_checksums()
    bad = [rel for rel in CHECKED if want.get(rel) and sha256(DDW3 / rel) != want[rel]]
    if bad:
        raise SystemExit("ddw3 build outputs do not match ddw3's checksums.sha256: " + ", ".join(bad))
    log(f"verified {len(CHECKED)} build outputs against checksums.sha256")
    if not SOUND_MARK.exists():
        log("extracting VAB/SEQ sound banks (tools/extract_all_sound.sh)")
        rc = subprocess.call(["bash", "tools/extract_all_sound.sh"], cwd=DDW3, env=env)
        if rc != 0 or not SOUND_MARK.exists():
            raise SystemExit(f"ddw3 tools/extract_all_sound.sh failed (rc={rc})")
    log(f"disc image: {ISO}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
