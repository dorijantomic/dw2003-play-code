#!/usr/bin/env python3
"""Extract the object-813 emote-sound jump table from the shipped fieldstg image.

The resident scene object (registry id 0x32d, SETANIM first operand 813) has
draw_fn F0x800837EC = fieldstg file offset 0xb3c.  Its tail dispatches the
SETANIM's SECOND operand (a1) through a 0x1f-entry jump table that sits at the
overlay BASE (RAM 0x80082cb0 = fieldstg file offset 0):

    sltiu $v0, ($s1 - 0x365), 0x1f  ; jr table[$s1 - 0x365]

Each table slot points at a handler; a handler loads a packed sound id with
`lui $a0, hi` + (delay-slot) `ori $a0, lo`, loads the play cell [0x80055c48] and
jumps to the shared tail 0x80083b74.  The silent default is 0x80083b7c.

This reads web/assets/native/fieldstg.bin (base 0x80082cb0) and prints the map.
Read-only; a heads-up extractor, the table lives in engine/systems/emote-sounds.ts
and the test re-derives it here.
"""
import struct, sys, os

BASE = 0x80082CB0
TABLE_AT = 0
TABLE_N = 0x1F
SILENT_DEFAULT = 0x80083B7C
TAIL = 0x80083B74


def main(path):
    data = open(path, "rb").read()
    row = []
    for i in range(TABLE_N):
        ptr = struct.unpack_from("<I", data, TABLE_AT + i * 4)[0]
        eid = 0x365 + i
        if ptr == SILENT_DEFAULT:
            row.append((eid, None, ptr))
            continue
        off = ptr - BASE
        # handler: lui $a0, hi at off; ...; ori $a0, lo at off+0x10 (delay slot)
        hi_w = struct.unpack_from("<I", data, off)[0]
        lo_w = struct.unpack_from("<I", data, off + 0x10)[0]
        # lui $a0, imm  = 0x3c04xxxx ; ori $a0,$a0,imm = 0x3484xxxx
        if (hi_w >> 16) != 0x3C04 or (lo_w >> 16) != 0x3484:
            row.append((eid, "?", ptr))
            continue
        packed = ((hi_w & 0xFFFF) << 16) | (lo_w & 0xFFFF)
        row.append((eid, packed, ptr))
    for eid, packed, ptr in row:
        if packed is None:
            print(f"0x{eid:03x} {eid:3d}  silent        slot=0x{ptr:08x}")
        elif packed == "?":
            print(f"0x{eid:03x} {eid:3d}  UNKNOWN       slot=0x{ptr:08x}")
        else:
            print(f"0x{eid:03x} {eid:3d}  0x{packed:08x}  slot=0x{ptr:08x}")


if __name__ == "__main__":
    p = sys.argv[1] if len(sys.argv) > 1 else "web/assets/native/fieldstg.bin"
    main(p)
