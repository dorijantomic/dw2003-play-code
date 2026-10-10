#!/usr/bin/env python3
"""Build the native screen-port assets (Phase 1 of
docs/plans/2026-09-14-native-screen-port-plan.md).

Everything the browser needs to run an ORIGINAL screen overlay through
engine/native, extracted from the read-only decomp/disc inputs:

  web/assets/native/screens/resident.bin      — the resident PS-X EXE image
                                                 (SLES_039.36 at LBA 24,
                                                 loads at 0x80010000)
  web/assets/native/screens/<module>.bin      — one screen overlay image per
                                                 root in data/native_screen_roots.json
  web/assets/native/screens/banks/<id>.bin    — the disc banks those screens
                                                 request from the resident cache
                                                 service (from the interpreter's
                                                 own bank plan, not a guess)
  web/assets/native/screens/manifest.json     — per screen: load_base, size,
                                                 ctor/tick/root_ctor, bank ids
  web/assets/native/screens/checksums.json    — sha256 of every emitted file

The bank plan is produced by booting each root in tools/native_screen_probe.ts
and recording the ids it passes to the host bank service, so the asset set
follows the original code rather than a hand list. Idempotent: re-running
overwrites every file deterministically.

Usage:
  python3 tools/build_native_screens.py
  python3 tools/build_native_screens.py --no-banks
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_DISC = Path(os.environ.get("DW3_DISC") or Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "build/iso/dw2003.bin")
DEFAULT_OUT = REPO / "web/assets/native/screens"
DEFAULT_ROOTS = REPO / "data/native_screen_roots.json"
PROBE = REPO / "tools/native_screen_probe.ts"
LBA_RS = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "rust/dw2003_exe_data/src/lba.rs"
SHEETS = REPO / "web/assets/ui"
# Pack name aliases where the LBA constant and the extracted sheet differ.
PACK_ALIASES = {"stdglb": "stdglabo"}
# Pack indices that are not a plain <name>CS pair (bundles / single files).
# Sources: tools/extract_screen_packs.py BUNDLED_PACKS/comments.
PACK_BY_INDEX = {605: "carddata2", 709: "stdglabo", 1109: "pgfgc00",
                 2211: "cntselwn", 2212: "tlogousa"}
# Bundle packs: the handle LOW u16 selects a sprite sub-directory whose extracted
# sheet has its own name. (LBA file index, sub-slot) -> sheet name.
SUB_PACKS = {
    (605, 2): "carddata2", (605, 3): "carddata3",
    (652, 0): "sttrng0", (652, 3): "sttrng3",
    (709, 0): "stdglabo", (709, 1): "stdglabo_portraits",
    # Title startup screens: ttcommpk dirs 0/1/2 tile the 320x240 background
    # with texture pages 4/5/6 (tools/extract_screen_packs.py BUNDLE_SUB_PACKS).
    (2183, 0): "ttcommpk0", (2183, 1): "ttcommpk1", (2183, 2): "ttcommpk2",
    # Sub 3 (98 clips) / sub 8 (46) are the title's sparkle directories, both
    # drawn from the SAME 4bpp page sub 7 (sub 9 byte-identical). Research answer
    # ttcommpk-sub3-atlas (accepted 2026-09-22).
    (2183, 3): "ttcommpk3", (2183, 8): "ttcommpk8",
    # Region-selected title logo: the language index maps languages 2..6 to the
    # PAL logo pack, which is what the region loader stores for ENG=2.
    (2381, 0): "tlogopal", (2381, 1): "tlogopal",
}

# All screen overlays load in the resident fieldstg slot (census 2026-09-14).
SCREEN_BASE = 0x80082CB0
RESIDENT_LBA = 24
RESIDENT_READ = 0x48000
RESIDENT_BASE = 0x80010000
# EXE data tables the resident cache service reads (probe boot record).
LBA_OFFSETS = 0x80044F6C  # u32 start sector per bank id
LBA_LEN_SECTORS = 0x800474A4  # u16 sector count per bank id
BANK_BYTE_CAP = 0x200000
SECTOR = 2352
DATA = 2048

def read_overlay(fh, resident: bytes, base: int, index: int) -> bytes:
    """Read one screen overlay's real .PRO file from the disc.

    The .s disassembly only covers the code region; the file continues with the
    data tail the code reads (e.g. STITSHOP's 0x8008d1ac table). Reading the
    whole file from the resident EXE's own LBA/length tables is the same source
    the console loads, so code and data arrive together.
    """
    def rd32(ram: int) -> int:
        return struct.unpack_from("<I", resident, ram - base)[0]

    def rd16(ram: int) -> int:
        return struct.unpack_from("<H", resident, ram - base)[0]

    lba = rd32(LBA_OFFSETS + index * 4)
    sectors = rd16(LBA_LEN_SECTORS + index * 2)
    if lba == 0 or sectors == 0:
        raise SystemExit(f"overlay index {index} has no disc extent")
    return read_sectors(fh, lba, sectors << 11)


def read_sectors(fh, lba: int, nbytes: int) -> bytes:
    out = bytearray()
    s = 0
    while len(out) < nbytes:
        fh.seek((lba + s) * SECTOR)
        sec = fh.read(SECTOR)
        if len(sec) < SECTOR:
            raise SystemExit(f"disc ends mid-sector at LBA {lba + s}")
        take = min(DATA, nbytes - len(out))
        out += sec[24 : 24 + take]
        s += 1
    return bytes(out)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_exe(fh) -> tuple[int, bytes]:
    # Read the PS-X header, then the whole text segment. The old fixed
    # RESIDENT_READ (0x48000) truncated every EXE data table past 0x47800
    # (the language index at 0x8005cca8 read as 0), so screens asked for the
    # wrong language bank ids.
    head = read_sectors(fh, RESIDENT_LBA, 0x800)
    if head[:8] != b"PS-X EXE":
        raise SystemExit("disc LBA 24 is not a PS-X EXE")
    base = struct.unpack_from("<I", head, 0x18)[0]
    size = struct.unpack_from("<I", head, 0x1C)[0]
    exe = read_sectors(fh, RESIDENT_LBA, 0x800 + size)
    return base, exe[0x800 : 0x800 + size]


def pack_name_map() -> dict[int, str]:
    """LBA file index -> extracted pack name, for the packs a screen can draw.

    handle = LBA_file_index << 16 (web/native-screen.js). Plain pairs come from
    the <NAME>CS_BIN_IDX constants; aliases and bundles from the tables above.
    Only indices whose sheet exists are returned; the rest stay unresolved.
    """
    names: dict[int, str] = {}
    if LBA_RS.exists():
        for m in re.finditer(r"LBA_(\w+?)CS_BIN_IDX\s*:\s*usize\s*=\s*(\d+)", LBA_RS.read_text()):
            raw = m.group(1).lower()
            names[int(m.group(2))] = PACK_ALIASES.get(raw, raw)
    names.update(PACK_BY_INDEX)
    return {i: n for i, n in names.items() if (SHEETS / f"{n}_sheet.json").exists()}


def pack_name_for(idx: int, sub: int, auto_packs: dict[int, str]) -> str | None:
    """Extracted sheet name for a requested (LBA index, sub-slot), or None.

    Sub-aware entries win (bundle packs); otherwise the single-name map is used
    for any sub."""
    if (idx, sub) in SUB_PACKS:
        return SUB_PACKS[(idx, sub)]
    return auto_packs.get(idx)


def bank_plan(frames: int, disc: Path) -> dict[str, list[int]]:
    """Ask the interpreter which bank ids each screen requests."""
    with tempfile.NamedTemporaryFile(suffix=".bank-plan.json", delete=False) as tf:
        plan_path = tf.name
    try:
        env = dict(os.environ)
        if disc != DEFAULT_DISC:
            env["DW3_DISC"] = str(disc)
        subprocess.run(
            ["node", str(PROBE), "--bank-plan", plan_path, "--frames", str(frames)],
            cwd=str(REPO),
            env=env,
            check=True,
        )
        return json.loads(Path(plan_path).read_text())  # {"banks": {...}, "packs": {...}}
    except FileNotFoundError as e:  # no node on PATH
        raise SystemExit(f"native screen bank plan needs node: {e}")
    finally:
        try:
            os.unlink(plan_path)
        except OSError:
            pass


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--disc", default=str(DEFAULT_DISC))
    ap.add_argument("--roots", default=str(DEFAULT_ROOTS))
    # The plan must see a screen's FIRST drawn frame. Several roots reach their
    # first picture-service call only after their bank loads settle (the wizard
    # intro, pro/stplnmet, draws at ~frame 25 in the probe's host), so the old
    # 20-frame window measured no pack for it and the browser renderer skipped
    # every intent. 60 frames covers every root's first draw.
    ap.add_argument("--frames", type=int, default=60)
    ap.add_argument("--no-banks", action="store_true")
    args = ap.parse_args()

    out = Path(args.out)
    banks_dir = out / "banks"
    out.mkdir(parents=True, exist_ok=True)
    disc = Path(args.disc)
    if not disc.exists():
        raise SystemExit(f"disc image not found: {disc}")
    roots = json.loads(Path(args.roots).read_text())

    with open(disc, "rb") as fh:
        base, resident = load_exe(fh)
        if base != RESIDENT_BASE:
            print(f"warning: resident base 0x{base:08x} != expected 0x{RESIDENT_BASE:08x}")

        plan = {"banks": {}, "packs": {}} if args.no_banks else bank_plan(args.frames, disc)
        auto_packs = pack_name_map()

        (out / "resident.bin").write_bytes(resident)
        checksums = {"resident.bin": sha256(resident)}

        screens: dict[str, dict] = {}
        for spec in roots:
            module = str(spec["module"])
            index = int(spec["disc_index"])
            img = read_overlay(fh, resident, base, index)
            fname = module.replace("/", "_") + ".bin"
            (out / fname).write_bytes(img)
            checksums[fname] = sha256(img)
            ctor = int(spec["ctor"], 16) if isinstance(spec["ctor"], str) else int(spec["ctor"])
            tick = int(spec["tick"], 16) if isinstance(spec["tick"], str) else int(spec["tick"])
            # Most screen overlays load in the resident fieldstg slot, but a few
            # (the fight-menu wstag overlays wfightmn/wfightts) load at the
            # standard overlay base; the tracked spec may override it and the
            # constructor offset must be measured from the ACTUAL base.
            lb_spec = spec.get("load_base")
            load_base = int(lb_spec, 16) if isinstance(lb_spec, str) else int(lb_spec) if lb_spec else SCREEN_BASE
            # Pack directories this screen actually drew from (probe measurement)
            # mapped to extracted pack names; explicit roots entries win.
            measured = [str(k) for k in plan["packs"].get(module, [])]
            packs = {}
            for key in measured:
                idx_s, _, sub_s = key.partition(":")
                name = pack_name_for(int(idx_s), int(sub_s or 0), auto_packs)
                if name:
                    packs[key] = name
            packs.update({str(k): v for k, v in (spec.get("packs") or {}).items()})
            screens[module] = {
                "file": fname,
                "load_base": load_base,
                "size": len(img),
                "ctor": ctor,
                "tick": tick,
                "root_ctor": ctor - load_base,
                "actor": spec.get("actor", ""),
                "pack": spec.get("pack"),
                "packs": packs,
                "pack_unresolved": [i for i in measured if i not in packs],
                "bank_ids": sorted(int(b) for b in plan["banks"].get(module, [])),
                "sha256": sha256(img),
            }

        # Banks: read LBA/sector length from the resident EXE's own tables.
        banks: dict[str, int] = {}
        all_ids = sorted({int(b) for ids in plan["banks"].values() for b in ids})
        if all_ids:
            banks_dir.mkdir(parents=True, exist_ok=True)

            def rd32(ram: int) -> int:
                return struct.unpack_from("<I", resident, ram - base)[0]

            def rd16(ram: int) -> int:
                return struct.unpack_from("<H", resident, ram - base)[0]

            for bid in all_ids:
                lba = rd32(LBA_OFFSETS + bid * 4)
                sectors = rd16(LBA_LEN_SECTORS + bid * 2)
                if lba == 0 or sectors == 0:
                    print(f"bank {bid}: no disc extent (lba={lba} sectors={sectors}); skipped")
                    continue
                nbytes = min(sectors << 11, BANK_BYTE_CAP)
                data = read_sectors(fh, lba, nbytes)
                (banks_dir / f"{bid}.bin").write_bytes(data)
                checksums[f"banks/{bid}.bin"] = sha256(data)
                banks[str(bid)] = nbytes

    manifest = {
        "generated_by": "tools/build_native_screens.py",
        "roots": Path(args.roots).name,
        "resident": {
            "file": "resident.bin",
            "base": base,
            "size": len(resident),
            "sha256": checksums["resident.bin"],
        },
        "screens": screens,
        "banks": banks,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
    (out / "checksums.json").write_text(json.dumps(checksums, indent=1, sort_keys=True) + "\n")
    total_bank = sum(banks.values())
    print(
        f"wrote {len(screens)} screen overlays, resident {len(resident) >> 10} KiB, "
        f"{len(banks)} banks ({total_bank >> 10} KiB) to {out}"
    )


if __name__ == "__main__":
    main()
