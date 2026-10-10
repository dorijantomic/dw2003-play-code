#!/usr/bin/env python3
"""Carve one or more `fight/model` CD files out of the disc image and split them
into the `m<NNN><name>/<n>.bin` folders `tools/build_fight_models.py` consumes.

Why this exists (2026-10-03): smdldata keys 468, 469 and 470 name CD file ids
1958 / 1992 / 1998 — `M468AGNM.BIN`, `M469GARM.BIN`, `M470AGRY.BIN`, the Agunimon,
BladeGarurumon and AncientGreymon packs — but `~/ddw3/pack/dw2003/fight/model`
has no folder for them, so the earlier `--all` build could not produce them. The
packs are not in the disc's ISO9660 filesystem; each one is a CD file addressed
by the same handle the game loads it with (`handle >> 16` = file id), so it has to
be carved from the raw sector image at the extent the resident EXE's own LBA
tables name. Same two lookups the runtime makes, same tables:

    LBA_OFFSETS      u32[2382] @ 0x80044F6C   first sector per file id
    LBA_LEN_SECTORS  u16[2382] @ 0x800474A4   sector count per file id

(`tools/build_native_screens.py:81-82`, `tools/extract_screen_packs.py:165-181`;
runtime split `docs/research/engine/resident-core-services-2026-08-04.md:128-129`.)
The file-id -> name mapping is `~/ddw3/rust/dw2003_exe_data/src/lba.rs`, read the
same way `tools/extract_fight_effects.py:83-89` reads it.

The archive itself is the game's PACK format: a u32 offset table whose length is
the first non-null offset / 4, each entry running to the next non-null offset
(`tools/extract_screen_packs.py:183-199`, mirroring
`~/ddw3/tools/ddw3-pack/src/lib.rs:25-77`).

Usage:
  python3 tools/extract_fight_model_pack.py --out .bunny-scratch/pack 1899
  python3 tools/extract_fight_model_pack.py --out .bunny-scratch/pack 1958 1992 1998

`--out` is required: this tool writes outside `web/assets`, and the pack tree it
produces is a build input, not a committed asset. Point `DW3_MODEL_DIR` at the
output directory to let the model pipeline see it alongside the read-only tree.
"""
from __future__ import annotations
import os

import argparse
import hashlib
import json
import re
import struct
import sys
from pathlib import Path

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
DISC = Path(os.environ.get("DW3_DISC") or Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "build/iso/dw2003.bin")
LBA_RS = DDW3 / "rust/dw2003_exe_data/src/lba.rs"

RESIDENT_LBA = 24
RESIDENT_READ = 0x48000
RESIDENT_BASE = 0x80010000
LBA_OFFSETS = 0x80044F6C
LBA_LEN_SECTORS = 0x800474A4
SECTOR = 2352
DATA = 2048
# A PS-X executable prefixes its loadable image with a 0x800-byte header, so a
# RAM address is 0x800 bytes further into the sector read than it is in the file.
PSX_HEADER = 0x800


def load_lba_names() -> dict[int, str]:
    """CD file id -> its disc name, from the decoded LBA table."""
    names: dict[int, str] = {}
    for line in LBA_RS.read_text().splitlines():
        m = re.match(r"pub const LBA_(\w+)_(BIN|PRO)_IDX: usize = (\d+);", line)
        if m:
            names[int(m.group(3))] = m.group(1)
    if not names:
        raise SystemExit(f"no LBA_*_IDX constants in {LBA_RS}")
    return names


def read_resident(fh) -> bytes:
    """The resident executable, which is what carries both LBA tables."""
    fh.seek(RESIDENT_LBA * SECTOR)
    out = bytearray()
    while len(out) < RESIDENT_READ:
        sec = fh.read(SECTOR)
        if len(sec) < SECTOR:
            raise SystemExit("disc ends inside the resident executable")
        out += sec[24:24 + DATA]
    return bytes(out)


def read_extent(fh, lba: int, sectors: int) -> bytes:
    out = bytearray()
    while len(out) < sectors * DATA:
        fh.seek((lba + len(out) // DATA) * SECTOR)
        sec = fh.read(SECTOR)
        if len(sec) < SECTOR:
            raise SystemExit(f"disc ends mid-extent at LBA {lba}")
        take = min(DATA, sectors * DATA - len(out))
        out += sec[24:24 + take]
    return bytes(out)


def unpack_archive(blob: bytes) -> list[bytes]:
    """The game's PACK archive: u32 offsets, each entry to the next non-null."""
    i = 0
    while struct.unpack_from("<I", blob, i * 4)[0] == 0:
        i += 1
    n = struct.unpack_from("<I", blob, i * 4)[0] // 4
    offs = [struct.unpack_from("<I", blob, k * 4)[0] for k in range(n)]
    out = []
    for idx, start in enumerate(offs):
        if start == 0:
            out.append(b"")
            continue
        end = next((o for o in offs[idx + 1:] if o != 0), len(blob))
        out.append(blob[start:end])
    return out


def carve(disc: Path, file_id: int, names: dict[int, str], out_root: Path) -> dict:
    name = names.get(file_id)
    if name is None:
        raise SystemExit(f"file id {file_id} is not in the decoded LBA table")
    folder = name.lower()
    with disc.open("rb") as fh:
        resident = read_resident(fh)
        lba = struct.unpack_from("<I", resident, PSX_HEADER + LBA_OFFSETS - RESIDENT_BASE + file_id * 4)[0]
        sectors = struct.unpack_from("<H", resident, PSX_HEADER + LBA_LEN_SECTORS - RESIDENT_BASE + file_id * 2)[0]
        if lba == 0 or sectors == 0:
            raise SystemExit(f"file id {file_id} ({folder}) has no disc extent")
        blob = read_extent(fh, lba, sectors)

    members = unpack_archive(blob)
    folder_out = out_root / folder
    folder_out.mkdir(parents=True, exist_ok=True)
    written = []
    for idx, member in enumerate(members):
        (folder_out / f"{idx}.bin").write_bytes(member)
        written.append({
            "member": idx,
            "bytes": len(member),
            "sha256": hashlib.sha256(member).hexdigest(),
        })

    report = {
        "fileId": file_id,
        "discName": name,
        "folder": folder,
        "lba": lba,
        "sectors": sectors,
        "archiveBytes": len(blob),
        "archiveSha256": hashlib.sha256(blob).hexdigest(),
        "members": len(members),
        "written": written,
    }
    (folder_out.parent / f"{folder}.json").write_text(json.dumps(report, indent=1) + "\n")
    return report


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("file_ids", nargs="+", type=int, help="CD file ids, e.g. 1958")
    ap.add_argument("--out", required=True, help="output root for the pack folders")
    ap.add_argument("--disc", default=str(Path(os_environ_disc())), help="disc image")
    args = ap.parse_args()

    out_root = Path(args.out)
    names = load_lba_names()
    for file_id in args.file_ids:
        rep = carve(Path(args.disc), file_id, names, out_root)
        print(f"{rep['fileId']:5d} {rep['discName']:<14} lba={rep['lba']:<7} "
              f"sectors={rep['sectors']:<5} members={rep['members']:<4} -> {rep['folder']}/")
    return 0


def os_environ_disc() -> str:
    import os
    return os.environ.get("DW3_DISC", str(DISC))


if __name__ == "__main__":
    sys.exit(main())