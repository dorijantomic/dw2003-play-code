#!/usr/bin/env python3
"""Scratch: segment the pure-bytecode wstag260 overlay into scripts, dump SAYs."""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import overlay_scan as ovs

path = Path.home() / "ddw3/asm/dw2003/pro/wstag260.s"
words = ovs.load_words(path)
size = max(words) + 4
buf = bytearray(size)
for off, w in words.items():
    struct.pack_into("<I", buf, off, w)
buf = bytes(buf)

LENS = {(1, 0): 8, (1, 1): 8, (1, 2): 10,
        (3, 0): 4, (3, 1): 2, (3, 2): 4, (3, 3): 4, (3, 4): 10,
        (6, 0): 6, (6, 1): 8}


def walk(pc):
    ops = []
    while pc + 2 <= size and len(ops) < 3000:
        w = struct.unpack_from("<H", buf, pc)[0]
        major, sub = (w >> 8) & 0xFF, w & 0xFF
        sm = major if major < 128 else major - 256
        if sm == 0 or sm >= 7:
            ops.append(("END",))
            return ops, pc + 2
        if sm < 0:
            return None, pc
        if sm == 2:
            ops.append(("SAY", *struct.unpack_from("<4h", buf, pc + 2)))
            pc += 10
        elif (sm, sub) in LENS:
            n = LENS[(sm, sub)]
            ops.append(((sm, sub), *struct.unpack_from(f"<{n // 2 - 1}h", buf, pc + 2)))
            pc += n
        else:
            return None, pc
    return None, pc


scripts = []
pc = 0
while pc < size:
    ops, end = walk(pc)
    if ops is None:
        if end + 2 <= size:
            w = struct.unpack_from("<H", buf, end)[0]
            print(f"parse break: script started {pc:#x}, failed at {end:#x} on word {w:#06x}")
        else:
            print(f"clean end of data: last script started {pc:#x}, pc reached {end:#x}")
        break
    scripts.append((pc, ops))
    pc = end
    while pc + 2 <= size and struct.unpack_from("<H", buf, pc)[0] == 0:
        pc += 2

print(f"{len(scripts)} scripts, covered up to {pc:#x} of {size:#x}")
for i, (off, ops) in enumerate(scripts):
    s = [tuple(o[1:]) for o in ops if o[0] == "SAY"]
    handoffs = [tuple(o[1:]) for o in ops if o[0] == (3, 4)]
    print(f"script {i} @ {off:#x}: {len(ops)} ops, SAYs={s}, HANDOFF={handoffs}")
