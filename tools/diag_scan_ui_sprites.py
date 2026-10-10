#!/usr/bin/env python3
"""Scratch: scan a full-RAM dump for live UI-sprite objects created by EXE
F0x8001ae38 (vtable signature 0x800194c4/0x800194e8 at +0x110/+0x114), print
{id, bank, x, y} for each, plus the 4 bank records at D0x8004de00 (0x18B each).
Purpose: name which sprite ids the status screen draws where (stat icon hunt)."""

import struct
import sys
from pathlib import Path

dump = Path(sys.argv[1]).read_bytes()
RAM = 0x80000000


def u32(a):
    return struct.unpack_from("<I", dump, a & 0x1FFFFF)[0]


def s16(a):
    return struct.unpack_from("<h", dump, a & 0x1FFFFF)[0]


print("bank table @0x8004de00:")
for k in range(4):
    b = 0x8004DE00 + k * 0x18
    words = [u32(b + i * 4) for i in range(6)]
    print(f"  kind{k}: " + " ".join(f"{w:08x}" for w in words))

print("\nlive sprite objects:")
hits = []
for a in range(0, 0x200000 - 0x180, 4):
    if (struct.unpack_from("<I", dump, a)[0] == 0x800194C4
            and struct.unpack_from("<I", dump, a + 4)[0] == 0x800194E8):
        base = RAM + a - 0x110
        sid = u32(base + 0x54)
        bank = u32(base + 0x50)
        x, y = s16(base + 0xB0), s16(base + 0xB2)
        state = u32(base + 0xAC)
        hits.append((base, sid, bank, x, y, state))

hits.sort(key=lambda h: (h[4], h[3]))
for base, sid, bank, x, y, state in hits:
    kind = (bank - 0x8004DE00) // 0x18 if 0x8004DE00 <= bank < 0x8004DE00 + 4 * 0x18 else -1
    print(f"  obj@{base:08x} id={sid:#06x} kind={kind} bank={bank:08x} "
          f"x={x:4d} y={y:4d} state={state:#x}")
print(f"total {len(hits)}")
