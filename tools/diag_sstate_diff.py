#!/usr/bin/env python3
"""Diff PCSX-Redux savestates offline (no emulator needed).

PCSX-Redux .sstateN files are gzip-compressed; the 2 MB main RAM image sits at
byte offset 0x27 inside the decompressed blob (verified by fingerprinting a
known RAM dump against three stable code regions, 2026-06-22).

Usage:
  diag_sstate_diff.py extract <slotN> <out.bin>        # write the 2MB RAM image
  diag_sstate_diff.py diff <slotA> <slotB> [lo] [hi]   # word diff over [lo,hi)
"""
import gzip, sys

RAM_OFF = 0x27
RAM_SZ = 0x200000
SS = "/home/dorij/.config/pcsx-redux/SLES03936.sstate{}"

def ram(slot):
    blob = gzip.open(SS.format(slot), "rb").read()
    r = blob[RAM_OFF:RAM_OFF + RAM_SZ]
    assert len(r) == RAM_SZ, f"got {len(r)} bytes"
    return r

def u16(r, o): return r[o] | (r[o + 1] << 8)

def main():
    if len(sys.argv) < 2:
        print(__doc__); return
    cmd = sys.argv[1]
    if cmd == "extract":
        open(sys.argv[3], "wb").write(ram(sys.argv[2]))
        print("wrote", sys.argv[3])
    elif cmd == "diff":
        a, b = ram(sys.argv[2]), ram(sys.argv[3])
        lo = int(sys.argv[4], 0) if len(sys.argv) > 4 else 0
        hi = int(sys.argv[5], 0) if len(sys.argv) > 5 else RAM_SZ
        n = 0
        for o in range(lo & ~1, hi & ~1, 2):
            va, vb = u16(a, o), u16(b, o)
            if va != vb:
                print(f"  {hex(0x80000000+o)}: {va:6d} -> {vb:6d}  (d={vb-va:+d})")
                n += 1
        print(f"# {n} differing u16 words in [{hex(lo)},{hex(hi)})")
    else:
        print(__doc__)

if __name__ == "__main__":
    main()
