#!/usr/bin/env python3
"""Lift the routines an object's builder installs but the entry list never named.

A screen object is built by a constructor that writes a block of routine
pointers into the allocation. Those pointers ARE the object's method table:
every call a screen makes on itself goes through one. But the disassembler's
list of function-entry addresses is derived from call targets and static
pointer tables, and it misses most of these. A missed entry is not a missing
function -- it is a function that got swallowed into whatever labelled routine
physically precedes it, so the decompiler never emits it and no reading pass
can ever see it.

Measured on 2026-09-02: 200 routine pointers are installed into objects across
the overlays, and 180 of them are absent from the entry lists. The card duel
board alone hid 39. Every one of them was invisible to every previous pass.

This recovers them. For each overlay it:

  1. reads the constructor-installed pointers out of the decompiled C
     (`obj->unkNNN = 0x800xxxxx;`), keeping those inside the overlay;
  2. drops the ones the entry list already has;
  3. finds each remaining address's instruction label in the normalized asm
     and promotes it to a function entry;
  4. runs the ordinary lifter on that patched asm.

Nothing under `~/ddw3` is touched, and no file in the tree is rewritten: the
patched asm and the lifted C go to an output directory.

CONTROL. The already-known entries are lifted too, alongside the new ones, and
their output is compared against the C already on disk. A run that cannot
reproduce the routines we already had has not earned the ones we did not.
`--report` prints the control result and writes nothing else.

Usage:
  tools/lift_installed_routines.py --list                 # what is missing, per overlay
  tools/lift_installed_routines.py <overlay> --out DIR    # lift one overlay
  tools/lift_installed_routines.py --all --out DIR        # lift every overlay
"""
from __future__ import annotations

import argparse
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DECOMP = ROOT / "exe-decomp"
LIFTER = ROOT / "tools/exe_decomp/decompile_exe.py"

INSTALL = re.compile(r"->unk[0-9A-Fa-f]+ = (0x800[0-9A-Fa-f]{5});")
FLABEL = re.compile(r"^F0x([0-9a-f]+):")
LLABEL = re.compile(r"^\.L0x([0-9a-f]+):")


class Overlay:
    def __init__(self, name: str) -> None:
        self.name = name
        self.entries_path = DECOMP / f"{name}.entries.txt"
        self.norm_path = DECOMP / f"{name}.norm.s"
        if not self.norm_path.exists():
            # ststatus's normalized asm was written as `<name>_c_norm.s` by the
            # same generator. Without this fallback the overlay is silently
            # skipped, so its installed routines never appear in --list at all.
            alt = DECOMP / f"{name}_c_norm.s"
            if alt.exists():
                self.norm_path = alt
        self.c_dir = DECOMP / f"{name}_c"

    def ok(self) -> bool:
        return all(p.exists() for p in (self.entries_path, self.norm_path)) and self.c_dir.is_dir()

    def entries(self) -> set[int]:
        text = self.entries_path.read_text().split()
        return {int(w[3:], 16) for w in text if w.startswith("F0x")}

    def installed(self) -> set[int]:
        """Routine pointers written into objects, restricted to this overlay."""
        known = self.entries()
        if not known:
            return set()
        lo, hi = min(known), max(known)
        found: set[int] = set()
        for src in self.c_dir.glob("F0x*.c"):
            for m in INSTALL.finditer(src.read_text()):
                addr = int(m.group(1), 16)
                if lo <= addr <= hi:
                    found.add(addr)
        return found


def base_address(lines: list[str]) -> int:
    """File offset 0 maps to this address. Read it off any labelled routine."""
    pending: int | None = None
    for line in lines:
        m = FLABEL.match(line)
        if m:
            pending = int(m.group(1), 16)
            continue
        m = LLABEL.match(line)
        if m and pending is not None:
            return pending - int(m.group(1), 16)
    raise ValueError("no F0x label followed by an offset label; cannot fix the base")


def promote(ov: Overlay, wanted: set[int], out_asm: pathlib.Path) -> tuple[list[int], list[int]]:
    """Write a copy of the asm with `wanted` promoted to entries.

    Returns (promoted, unplaced). An unplaced address had no instruction label
    at its offset, which means it is not an instruction boundary at all -- so
    it is NOT a hidden routine and must not be invented into one.
    """
    lines = ov.norm_path.read_text().splitlines()
    base = base_address(lines)
    have = {int(m.group(1), 16) for m in map(FLABEL.match, lines) if m}
    by_offset = {a - base: a for a in wanted if a not in have}

    out: list[str] = []
    promoted: list[int] = []
    for line in lines:
        m = LLABEL.match(line)
        if m:
            addr = by_offset.get(int(m.group(1), 16))
            if addr is not None:
                out.append(f".global F0x{addr:08x}")
                out.append(f"F0x{addr:08x}:")
                promoted.append(addr)
        out.append(line)
    out_asm.write_text("\n".join(out) + "\n")
    unplaced = sorted(set(by_offset.values()) - set(promoted))
    return sorted(promoted), unplaced


def controls(ov: Overlay, wanted: set[int], out_dir: pathlib.Path) -> tuple[int, int, list[str]]:
    """Compare every lifted routine that already had C against that C."""
    same = differ = 0
    bad: list[str] = []
    for addr in sorted(wanted & ov.entries()):
        name = f"F0x{addr:08x}.c"
        old, new = ov.c_dir / name, out_dir / name
        if not old.exists() or not new.exists():
            continue
        if old.read_text() == new.read_text():
            same += 1
        else:
            differ += 1
            bad.append(name)
    return same, differ, bad


def lift(ov: Overlay, out_root: pathlib.Path) -> dict:
    out_dir = out_root / ov.name
    out_dir.mkdir(parents=True, exist_ok=True)
    wanted = ov.installed()
    missing = wanted - ov.entries()
    asm = out_dir / f"{ov.name}.promoted.s"
    promoted, unplaced = promote(ov, missing, asm)

    entries_file = out_dir / "entries.txt"
    entries_file.write_text("\n".join(f"F0x{a:08x}" for a in sorted(wanted)) + "\n")

    subprocess.run(
        [sys.executable, str(LIFTER), str(asm), str(out_dir),
         "--entries-file", str(entries_file)],
        check=True, cwd=ROOT, stdout=subprocess.DEVNULL,
    )

    same, differ, bad = controls(ov, wanted, out_dir)
    lifted = {p.stem for p in out_dir.glob("F0x*.c")}
    return {
        "overlay": ov.name,
        "installed": len(wanted),
        "missing": len(missing),
        "promoted": len(promoted),
        "unplaced": unplaced,
        "lifted": len(lifted),
        "new": sorted(f"F0x{a:08x}" for a in promoted if f"F0x{a:08x}" in lifted),
        "control_same": same,
        "control_differ": differ,
        "control_bad": bad,
    }


def overlays() -> list[Overlay]:
    found = [Overlay(p.name.split(".")[0]) for p in sorted(DECOMP.glob("*.entries.txt"))]
    return [o for o in found if o.ok()]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("overlay", nargs="?")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--out", type=pathlib.Path)
    args = ap.parse_args()

    if args.list:
        total_i = total_m = 0
        print("missing / installed / overlay")
        for ov in overlays():
            inst = ov.installed()
            miss = inst - ov.entries()
            total_i += len(inst)
            total_m += len(miss)
            if miss:
                print(f"{len(miss):6d} {len(inst):6d}  {ov.name}")
        print(f"\n{total_m} of {total_i} installed routines were never lifted")
        return 0

    if not args.out:
        ap.error("--out is required to lift")
    targets = overlays() if args.all else [Overlay(args.overlay)]

    ok = True
    for ov in targets:
        if not ov.ok():
            print(f"{ov.name}: sources incomplete, skipped")
            continue
        try:
            r = lift(ov, args.out)
        except (ValueError, subprocess.CalledProcessError) as exc:
            print(f"{ov.name}: could not lift -- {exc}")
            ok = False
            continue
        if r["control_differ"]:
            verdict = "CONTROL FAILED"
        elif r["control_same"] == 0:
            # No installed routine of this overlay already had C, so the
            # self-check could not run. Saying OK here would claim a proof
            # that never happened -- ststatus is such an overlay.
            verdict = "NO CONTROL -- nothing to compare, lift is unchecked"
        else:
            verdict = "CONTROL OK"
        if r["control_differ"]:
            ok = False
        print(f"{r['overlay']:10s} new={len(r['new']):4d} "
              f"lifted={r['lifted']:4d}/{r['installed']:4d}  "
              f"{verdict} ({r['control_same']} identical, {r['control_differ']} differ)")
        if r["control_bad"]:
            print("   differ:", ", ".join(r["control_bad"][:6]))
        if r["unplaced"]:
            print("   no instruction boundary (NOT routines):",
                  ", ".join(f"0x{a:08x}" for a in r["unplaced"][:6]))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
