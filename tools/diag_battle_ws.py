#!/usr/bin/env python3
"""diag_battle_ws.py (scratch) — decode the LIVE battle workspace @ 0x800a4460.

Diffs the 4 combatant records (stride 0x20: P1 0x4470, P2 0x4490, P3 0x44b0, EN 0x44d0)
across every 2 MB battle RAM dump to expose dynamic fields. Used for census S2.1.

Record layout decoded so far (S2.1 + live S2.1b, data + wfightmn.s):
  +0x00 u16  STATIC per-combatant value (NOT a gauge; ~initiative seed)  [live-confirmed static]
  +0x04 u8   active-actor / turn flag?  (=1 on the acting enemy)    [N=1]
  +0x06 u16  max_hp        +0x08 u16  cur_hp    (CORRECTED order; live: EN 336->91->0)
  +0x0a u16  max_mp        +0x0c u16  cur_mp
  +0x18 u16  static per-enemy property (e.g. 348)                   [enemy-only]
  +0x02,+0x0e..0x16,+0x1a..0x1e = status/Tag — 0 in all dumps (basic attack sets none).

Action/target/phase are NOT in the record — they're workspace GLOBALS (S2.1b live):
  0x800a4418 = action opcode (7=Fight)   0x800a441c = last-damage
  0x800a4424, 0x800a442a = action-phase flags   0x800a4536 = mode (0 for basic Fight)
The Blast gauge is NOT in this workspace (enemy died with all record fields static) —
it's in the persistent profile / ctx heap object; find via a writer-trace.

Run:  python3 tools/diag_battle_ws.py [dump ...]
With no args it diffs the standard battle dump set in ~/vm-spike/dumps.
A FRESH mid-combat dump (status active / blast mid-fill / action queued / Tag mode 5-6)
is what's needed to fill the zero fields.
"""
import struct, sys, os, hashlib

RB = 0x80000000
WS = 0x800a4460  # workspace base (wfightmn.s: addiu $v0, 0x4460 after lui 0x800a)
RECS = [("P1", WS + 0x10), ("P2", WS + 0x30), ("P3", WS + 0x50), ("EN", WS + 0x70)]
DUMPDIR = os.path.expanduser("~/vm-spike/dumps")
DEFAULT = ["battle_start.raw", "pre_attack.bin", "post_attack.bin", "fight_rena.bin",
           "fight_rena0", "kyubimon_battle", "attack_transition.bin"]

paths = sys.argv[1:] or [os.path.join(DUMPDIR, f) for f in DEFAULT]
paths = [p for p in paths if os.path.exists(p)]


def load(p):
    d = open(p, "rb").read()
    if len(d) > 0x200000:  # 8 MB attack_transition = 4 identical frames; take frame 0
        d = d[:0x200000]
    return d


data = {os.path.basename(p): load(p) for p in paths}
u16 = lambda d, a: struct.unpack_from("<H", d, a - RB)[0]
byte = lambda d, a: d[a - RB]

names = list(data)
print("dumps:", ", ".join(f"{n}({hashlib.md5(data[n]).hexdigest()[:6]})" for n in names))

for label, addr in RECS:
    print(f"\n##### {label} @ 0x{addr:x} (u16; '*'=differs across dumps) #####")
    print("off  | " + " | ".join(f"{n[:10]:>10}" for n in names))
    for o in range(0, 0x20, 2):
        vals = [u16(data[n], addr + o) for n in names]
        flag = " *" if len(set(vals)) > 1 else ""
        print(f"+0x{o:02x}| " + " | ".join(f"{v:10d}" for v in vals) + flag)
