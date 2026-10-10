#!/usr/bin/env python3
"""byod — bring your own disc: build the ddw3-shaped data tree from your own
Digimon World 2003 (EU) disc image.

    python3 byod.py <disc.bin|disc.iso> --out <tree-dir> --tools <ddw3-tools-dir>

The tree it writes is the data tree the dw2003-play-code build reads
(pack/, map/, map-tile/, rlen/, tim/, lang_file/, sound/, dw2003/, ...).
Format decoding uses Marko's (markisha64/ddw3) extractor binaries, used with
permission; see README.md for credits and how to build them.

Preflight is strict and non-interactive: a missing/not-a-disc-image/wrong-region
disc image or a missing tool binary exits with an actionable message before any
decoding starts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from byod_lib.decode import Decoder, DecodeError  # noqa: E402
from byod_lib.iso import DiscImage, IsoError  # noqa: E402

HERE = Path(__file__).resolve().parent
DEFAULT_TOOLS = Path(os.environ.get("BYOD_DDW3_TOOLS", str(HERE / "ddw3-tools")))

# The one supported release: PAL/EU Digimon World 2003, SLES-03936. The disc's
# boot executable is checked against this sha1, so a wrong-region or modified
# image fails immediately instead of silently producing a broken tree.
EU_EXE = "SLES_039.36"
EU_EXE_SHA1 = "d1b7e4d646e3a9c2b88fdb25d20b5f7116bbb06d"
REQUIRED_TOOLS = ("unpack", "unmap", "unrlen", "unmap-tile", "untim",
                  "unlang-file", "ddw3-unvab-sep")
PSX_EXE_PREFIXES = ("SLES_", "SLUS_", "SLPS_", "SLPM_", "SCES_", "SCUS_", "SCPS_")


def log(msg: str) -> None:
    print(msg, flush=True)


def check_tools(tools: Path) -> None:
    """Fail with an actionable message when Marko's binaries are not built."""
    missing = [t for t in REQUIRED_TOOLS
               if not (tools / t).is_file() or not os.access(tools / t, os.X_OK)]
    if missing:
        raise SystemExit(
            f"byod: Marko's extractor binaries are not built in {tools}\n"
            f"  missing: {', '.join(missing)}\n"
            "Build them from a ddw3 checkout with the patches in tools/byod/patches/ applied:\n"
            "    tools/byod/build-ddw3-tools.sh --ddw3-src <ddw3 checkout> --out <dir>\n"
            "then pass that dir as --tools (or set BYOD_DDW3_TOOLS).\n"
            "The format decoding is Marko's (markisha64/ddw3) work, reused with\n"
            "permission — see tools/byod/README.md."
        )


def check_disc(disc: Path) -> int:
    """Open the image and verify it is the supported PAL/EU release.

    Returns the sector size. Exits with an actionable message for a missing
    file, a non-CD image, a different region, or a modified image.
    """
    if not disc.is_file():
        raise SystemExit(
            f"byod: disc image not found: {disc}\n"
            "  Pass the path to your PAL/EU Digimon World 2003 disc dump "
            "(.bin CD-ROM XA or .iso, SLES-03936)."
        )
    try:
        img = DiscImage(disc)
    except IsoError as e:
        raise SystemExit(
            f"byod: {disc} is not a usable disc image: {e}\n"
            "  Expected a 2352-byte/sector .bin (CD-ROM XA) or 2048-byte/sector .iso\n"
            "  dump of the PAL/EU Digimon World 2003 disc (SLES-03936)."
        )
    found = None
    other = None
    for p, lba, size in img.walk():
        name = os.path.basename(p).upper()
        if name == EU_EXE:
            found = (lba, size)
            break
        if other is None and name.startswith(PSX_EXE_PREFIXES):
            other = name
    if found is None:
        if other:
            raise SystemExit(
                f"byod: {disc} is a PlayStation disc ({other} on it), but not the\n"
                "  supported release: only the PAL/EU Digimon World 2003 disc "
                "(SLES-03936) can be decoded."
            )
        raise SystemExit(
            f"byod: {disc} does not contain a PlayStation boot executable — "
            "not a PS1 game disc image?"
        )
    lba, size = found
    sha1 = hashlib.sha1(img.file_bytes(lba, size)).hexdigest()
    if sha1 != EU_EXE_SHA1:
        raise SystemExit(
            f"byod: {disc} contains {EU_EXE}, but its sha1 is {sha1}, not the\n"
            f"  supported PAL/EU release ({EU_EXE_SHA1}).\n"
            "  A different revision or a modified image would decode into a broken tree."
        )
    assert img.sector_size is not None  # DiscImage only returns when detected
    return img.sector_size


def load_discmap() -> dict[str, str]:
    return json.loads((HERE / "data" / "discmap.json").read_text())


def kind_of(src: str) -> str:
    if src.startswith("build/pack/"):
        return "pack"
    if src.startswith("build/map/"):
        return "map"
    if src.startswith("build/lang_file/"):
        return "lang_file"
    if src.startswith("dw2003/"):
        return "copy"
    return "skip"  # raw_exe / psexe / misc: consumed by the asm/rust generators


def decode_one(dec: Decoder, disc_root: Path, disc_path: str, src: str) -> None:
    kind = kind_of(src)
    if kind == "skip":
        return
    data = (disc_root / disc_path).read_bytes()
    if kind == "copy":
        dec.write_file(src, data)
        return
    stem = src[len("build/"):]
    if stem.endswith(".bin"):
        stem = stem[:-4]
    dec.decode(kind, stem, data)


def sound_step(dec: Decoder, tree: Path) -> None:
    """Rebuild sound/dw2003/* from the decoded sound packs (ddw3-unvab-sep).

    Run from the tree root with relative paths: the tool records the --output
    string verbatim into the toml (committed configs say "sound/dw2003/<g>/"),
    so the invocation must look exactly like the original one."""
    snd = tree / "pack" / "dw2003" / "sound"
    if not snd.is_dir():
        return
    made = 0
    for group in sorted(p.name for p in snd.iterdir() if p.is_dir()):
        mp = snd / group / f"mp{group}"
        mv = snd / group / f"mv{group}"
        if not mp.is_dir() or not mv.is_dir():
            continue
        vh = sorted(mp.glob("*.vh"))
        vb = sorted(mv.glob("*.vb"))
        tracks = sorted(mp.glob("*.seq"))
        if not vh or not vb:
            dec.warn(f"sound {group}: missing vh/vb")
            continue
        rel = Path("pack") / "dw2003" / "sound" / group
        args = [dec.tool("ddw3-unvab-sep"),
                "--vab-header", str(rel / f"mp{group}" / vh[0].name),
                "--vab-body", str(rel / f"mv{group}" / vb[0].name)]
        for t in tracks:
            args += ["--tracks", str(rel / f"mp{group}" / t.name)]
        args += ["--output", f"sound/dw2003/{group}/",
                 "--toml", f"sound/dw2003/{group}.toml"]
        r = subprocess.run([str(a) for a in args], capture_output=True, text=True,
                           cwd=str(tree))
        if r.returncode != 0:
            dec.warn(f"sound {group}: unvab-sep failed: {r.stderr.strip()[-300:]}")
        else:
            made += 1
    log(f"sound: {made} groups -> sound/dw2003/")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("disc", help="player's disc image (.bin CD-ROM XA or .iso)")
    ap.add_argument("--out", required=True, help="output tree directory")
    ap.add_argument("--tools", default=str(DEFAULT_TOOLS),
                    help="directory with Marko's extractor binaries "
                         "(unpack, unmap, unrlen, unmap-tile, untim, unlang-file, ddw3-unvab-sep)")
    ap.add_argument("--staging", default=None,
                    help="keep extracted disc files here (default: <out>/_disc)")
    ap.add_argument("--reuse-staging", action="store_true",
                    help="skip disc extraction and use the existing staging dir")
    ap.add_argument("--jobs", type=int, default=min(8, os.cpu_count() or 4))
    ap.add_argument("--skip-sound", action="store_true")
    a = ap.parse_args(argv)

    t0 = time.time()
    out = Path(a.out).expanduser().resolve()
    tools = Path(a.tools).expanduser()
    staging = Path(a.staging).expanduser() if a.staging else out / "_disc"
    disc = Path(a.disc).expanduser()

    # Preflight: fail fast and clearly (never a traceback) on a missing disc,
    # a wrong-region image, or unbuilt extractor binaries.
    check_tools(tools)
    sector_size = check_disc(disc)
    log(f"disc ok: {disc} ({sector_size}-byte sectors, {EU_EXE} sha1 matches the PAL/EU release)")

    discmap = load_discmap()

    if not a.reuse_staging:
        log(f"reading disc image {disc} ...")
        img = DiscImage(disc)
        log(f"  sector size: {img.sector_size}")
        counts = img.extract_all(staging)
        log(f"  extracted {counts['files']} files ({counts['bytes']/1e6:.1f} MB)")
    else:
        log(f"reusing staging dir {staging}")

    out.mkdir(parents=True, exist_ok=True)
    (out / "_work").mkdir(exist_ok=True)
    dec = Decoder(tools, out)

    # raw copies + decodes, parallel over disc files
    jobs = []
    for disc_path, src in sorted(discmap.items()):
        if kind_of(src) == "skip":
            continue
        jobs.append((disc_path, src))
    log(f"decoding {len(jobs)} disc files with {a.jobs} workers ...")
    done = 0
    with ThreadPoolExecutor(max_workers=a.jobs) as ex:
        futs = {ex.submit(decode_one, dec, staging, d, s): d for d, s in jobs}
        for fut in as_completed(futs):
            done += 1
            try:
                fut.result()
            except DecodeError as e:
                dec.warn(f"{futs[fut]}: {e}")
            if done % 200 == 0:
                log(f"  {done}/{len(jobs)}")

    if not a.skip_sound:
        sound_step(dec, out)

    log(f"done in {time.time()-t0:.1f}s: {dec.stats['files']} files, {dec.stats['tomls']} configs")
    if dec.warnings:
        log(f"{len(dec.warnings)} warning(s):")
        for w in dec.warnings:
            log("  " + w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
