#!/usr/bin/env python3
"""The position step's facing-cone enable table — FIELDSTG.PRO's 8x8 byte gate at 0x80097624.

The WS4 position step runs every frame from one resident 0x68-byte driver object
(`F0x80014504(0x80088888, 0x68, 8)`, fieldstg.s:5998-6007 `.L0x00005d9c`). Its step-load
half, `0x80088288` (file 0x55d8), is the only reader of this table:

    pro/fieldstg.s:5501  .L0x000055d8  0x80088288  step-load
      :5614 andi  $v1, $v0, 0xff        # grid byte
      :5618 beqz  $v1, .L0x000056a8     # byte == 0 -> not live
      :5620 srl   $v0, $v1, 0x5         # hi3 = byte >> 5
      :5624 andi  $v1, 0x1f             # step_idx = byte & 0x1f
      :5628 sw    $v0, 0x60($s0)        # runner+0x60 = the hi-3-bit group
      :5634 sw    $v1, 0x5c($s0)        # runner+0x5c = the step index
      :5644 sw    $v1, 0x64($s0)        # runner+0x64 = base + step_idx*24
      :5648 lhu   $v1, 0x8($v1)         # the record's opcode
      :5650 slti  $v0, $v1, 0x5 / :5654 bnez -> GATE      # opcodes 0..4 gate
      :565c slti  $v0, $v1, 0x7 / :5660 bnez -> RETURN 1  # opcodes 5,6 do NOT gate
      :5668 slti  $v0, $v1, 0xf / :566c beqz -> GATE      # opcode >= 15 gates
      :5670 slti  $v0, $v1, 0x8 / :5674 bnez -> GATE      # opcode 7 gates
      :567c j     .L0x000056a8 (delay slot `li $v0,0x1`)   # opcodes 8..14 do NOT gate
    pro/fieldstg.s:5544  .L0x00005684  addiu $a0, 0x7624    # a0 = 0x80097624
      :5688 lw    $v1, 0x60($s0)        # the hi-3 group
      :568c lw    $v0, 0x60($s1)        # $s1 = runner+0x58 = the type-5 player entity
                                          #   -> entity+0x60 = the facing (0..7)
      :5690 sll   $v1, 0x3              # group * 8
      :5698 addu  $v0, $a0              # 0x80097624 + facing + group*8
      :569c lbu   $v0, ($v0)
      :56a4 sltu  $v0, $zr, $v0         # live iff that byte != 0

So the byte address is `0x80097624 + facing + group*8`: row = the required facing group,
column = the player's facing (`entity+0x60`, the same 0..7 enum as
`engine/systems/field-movement.ts` FIELD_DIRECTIONS). entity+0x60 is documented decoded
facing in docs/research/field/field-actor-anim-engine.md:47 and npc-decode.md:267.

WHERE IT LIVES ON THE DISC: FIELDSTG.PRO (the EXE's LBA file index 358,
`rust/dw2003_exe_data/src/lba.rs` LBA_FIELDSTG_PRO_IDX; the overlay the game's field
screen lives in), which loads at RAM 0x80082cb0 — so RAM 0x80097624 is flat file offset
0x14974, inside FIELDSTG.PRO's initialised .data tail (its .text ends at file 0x10158).
WHO FILLS IT: nothing. It is static initialised data in the overlay image; the only two
references to the address in the whole assembly corpus are the two `lui 0x8009 /
addiu 0x7624` reads above (`grep -rn 0x7624 ~/ddw3/asm/dw2003`), both inside step-load,
and no routine in pro/*.s or exe/*.s stores to it.

The 64 bytes are a ±1 facing cone, row g allowing facings {g-1, g, g+1} mod 8 — which is
what makes the "!" and the door/ladder arrow appear only when you are looking at the
thing they mark (docs/research/ui/exclamation-indicator-decoded-2026-07-02.md:120 read
the same table but left the row/column convention unverified; the bytes settle it).

Output: web/assets/data/scene/step_enable_table.json

Usage:
  python3 tools/extract_step_enable_table.py            # report
  python3 tools/extract_step_enable_table.py --json     # write the json
  python3 tools/extract_step_enable_table.py --fieldstg /path/to/FIELDSTG.PRO
"""
import json
import os
import sys

RAM_BASE = 0x80082CB0          # FIELDSTG.PRO's load address
TABLE_RAM = 0x80097624         # the gate table
N_GROUP = 8                   # hi3 is 3 bits
N_FACING = 8                  # entity+0x60 is a 0..7 enum
TABLE_OFF = TABLE_RAM - RAM_BASE
OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..",
                                    "web/assets/data/scene/step_enable_table.json"))
# The shipped FIELDSTG.PRO image (LBA 358) that tools/build_native_overlays.py extracts;
# kept in the tree so this stage needs no disc image.
DEFAULT_FIELDSTG = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "web/assets/native/fieldstg.bin"))

# Opcodes whose liveness the disc decides through this table, and the ones it does not.
# Read off the four comparisons at fieldstg.s:5650/565c/5668/5670 — see the module
# docstring. Ops 5, 6 and 8..14 branch straight to the epilogue with v0 = 1.
GATED_OPS = [0, 1, 2, 3, 4, 7]


def read_rows(image: bytes):
    raw = image[TABLE_OFF:TABLE_OFF + N_GROUP * N_FACING]
    if len(raw) < N_GROUP * N_FACING:
        raise SystemExit("image too short for the table at +0x%x" % TABLE_OFF)
    return [[raw[g * N_FACING + f] for f in range(N_FACING)] for g in range(N_GROUP)]


def check_cone(rows):
    """Every row must allow exactly {g-1, g, g+1} mod 8; anything else is a real finding."""
    problems = []
    for g, row in enumerate(rows):
        want = {(g - 1) % 8, g, (g + 1) % 8}
        got = {f for f, v in enumerate(row) if v}
        if got != want:
            problems.append("row %d allows %s, expected %s" % (g, sorted(got), sorted(want)))
    return problems


def main(argv):
    src = DEFAULT_FIELDSTG
    write = "--json" in argv
    if "--fieldstg" in argv:
        src = argv[argv.index("--fieldstg") + 1]
    with open(src, "rb") as fh:
        image = fh.read()

    rows = read_rows(image)
    problems = check_cone(rows)
    print("FIELDSTG.PRO %s (%d bytes)" % (src, len(image)))
    print("gate table RAM 0x%08x = file +0x%05x, %d x %d bytes"
          % (TABLE_RAM, TABLE_OFF, N_GROUP, N_FACING))
    print("index = facing + group*8   (facing = entity+0x60, group = grid byte >> 5)")
    for g, row in enumerate(rows):
        print("  group %d (row +0x%02x): %s   allows facings %s"
              % (g, g * N_FACING, " ".join("%02x" % v for v in row),
                 sorted(f for f, v in enumerate(row) if v)))
    print("gated opcodes: %s   ungated (always live): 5, 6, 8..14"
          % ", ".join(str(o) for o in GATED_OPS))
    # The 8 bytes after the table are the head of the next table; print them so a
    # shifted read is visible rather than silent.
    tail = image[TABLE_OFF + N_GROUP * N_FACING:TABLE_OFF + N_GROUP * N_FACING + 8]
    print("next 8 bytes (must NOT look like a cone row): %s"
          % " ".join("%02x" % b for b in tail))
    if problems:
        for p in problems:
            print("MISMATCH: %s" % p, file=sys.stderr)
        return 1

    if write:
        doc = {
            "_comment": (
                "The position step's facing-cone enable gate, byte-for-byte from "
                "FIELDSTG.PRO (LBA 358) at RAM 0x80097624 = file +0x14974. Generated by "
                "tools/extract_step_enable_table.py; read at fieldstg.s:5684-56a4 "
                "(step-load 0x80088288, file 0x55d8). Static initialised overlay data: "
                "nothing writes it. A step is live iff rows[group][facing] != 0, where "
                "group = the type-7 grid byte >> 5 and facing = the player entity's +0x60 "
                "0..7 facing enum. Only opcodes 0-4, 7 and >= 15 consult it; opcodes 5, 6 "
                "and 8-14 return live without reading it."
            ),
            "source": {
                "file": "FIELDSTG.PRO",
                "lba_index": 358,
                "load_base": "0x%08x" % RAM_BASE,
                "ram": "0x%08x" % TABLE_RAM,
                "file_offset": "0x%05x" % TABLE_OFF,
                "read_by": "fieldstg.s:5684-56a4 (step-load 0x80088288, file 0x55d8)",
                "filled_by": None,
                "note": "static initialised overlay data; the only two references to the "
                        "address in the assembly corpus are the two reads above",
            },
            "index": "byte = facing + group*8",
            "shape": [N_GROUP, N_FACING],
            "gated_opcodes": GATED_OPS,
            "ungated_opcodes": [5, 6, 8, 9, 10, 11, 12, 13, 14],
            "rows": rows,
        }
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, "w") as fh:
            json.dump(doc, fh, indent=1)
            fh.write("\n")
        print("wrote %s" % OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
