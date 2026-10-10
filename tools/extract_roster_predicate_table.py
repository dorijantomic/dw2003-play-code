#!/usr/bin/env python3
"""Extract the bank-0x70 roster/party predicate dispatch table `D0x80048ad8`
→ web/assets/data/roster_predicate_table.json.

`get_flag(0x70NN, expected)` resolves via `F0x80015d90`: it scans this table for the
record whose key == NN, then dispatches on the record's `op` byte to a sub-predicate
that reads the persistent roster/collection object `D0x80048d34`; the result is
polarity-compared to `expected`. See
docs/research/scripting/get-flag-banked-predicate-system.md.

Table format (proven from F0x80015d90: stride `addiu $a2,0x3`, `0xff` key terminator):
  3-byte records {u8 key, u8 op, u8 param2}; op high-nibble = sub-predicate selector,
  op low-nibble + param2 = its parameters.

The table is **static EXE data** (loaded at boot), so it is identical in any in-game
2 MB PS1 RAM dump — this reads it from a dump file (not a live rig). Validated: the
dump's flag-API pointer `[0x80048ac8] == 0x800165ac`, and every bank-0x70 key referenced
by the extracted `spawn_flags` is present in the table.

Run: python3 tools/extract_roster_predicate_table.py [dump.bin]
"""
import json
import struct
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "web/assets/data/roster_predicate_table.json"
DEFAULT_DUMP = Path.home() / "vm-spike/dumps/a.bin"
TABLE_ADDR = 0x80048AD8

# op high-nibble -> the sub-predicate it dispatches to (from F0x80015d90 @0x80015dd8..0x80015e8c)
OP_HANDLER = {
    0x00: "F0x8001561c",
    0x10: "F0x80015754",
    0x20: "F0x80015aac",
    0x30: "F0x80015b9c",
    0x40: "F0x80015bd8",
    0x50: "F0x80015d4c",
}

# What each sub-predicate computes (decoded from fns.s). See
# docs/research/scripting/get-flag-banked-predicate-system.md.
OP_KIND = {
    0x00: "collection-set check (AND over fixed bank-0x80 collection entries)",
    0x10: "party/roster query (10-case, iterates 0x3dc-stride roster slots)",
    0x20: "currency/counter at D0x80048d34+0x6c (check/add/subtract; side effects)",
    0x30: "progress-ordinal range [lo,hi]  (lo/hi from D0x80048cb4[param2]; hi>=0x63 = open)",
    0x40: "stored-flag tally (bank-0x1c / bank-0x10 bits via F0x80015590)",
    0x50: "resident-object action (get_object(0x16)->vtable[0x2c](3)); always returns 1",
}
RANGE_TABLE = 0x80048CB4   # op-0x30 {u8 lo, u8 hi} pairs, indexed by param2

# CONFIRMED 2026-10-02 against the read-only EXE splat
# ~/ddw3/rust/dw2003_exe_data/src/data.rs (D0x80048cb4..0x80048cff, the same static EXE data this
# dump carries): the 33 pairs hold the byte 0x63 = 99 as the upper bound in exactly 7 slots
# (param2 6,7,8,10,11,12,13) and nowhere else — the largest CLOSED upper bound in the table is
# 44. `F0x80015b9c` (.L0x80015bc8 `slt $v1,$a2` + .L0x80015bcc `xori 1`) compares the master story
# ordinal against that byte literally, so 99 IS the disc's own end-of-story bound, not a sentinel
# to be discarded. Hence `None if hi >= 0x63` below is a faithful spelling of "up to story step
# 99", and every reader must compare it as 99 — reading it as a missing bound closed 40 shipped
# event rows at every story step until 2026-10-02 (engine/dw3/dw3-config.ts, `ordinalInRange`).

# ---------------------------------------------------------------------------
# Per-opcode semantics, decoded instruction-by-instruction from
# `~/ddw3/asm/dw2003/exe/fns.s`. Every constant below is an immediate in that
# code (not a table in RAM), so it is transcribed here with its exact citation
# rather than read from the dump. Line numbers are fns.s label addresses.
# ---------------------------------------------------------------------------

# op 0x00 / F0x8001561c (.L0x8001561c-.L0x80015750): two hardcoded AND-lists of
# `lb` pairs on D0x80048d34. Each pair is (A_base+n, B_base+n) with A_base=0x7c,
# B_base=0x20f — i.e. *exactly* the two parallel arrays behind the already-proven
# bank-0x80 predicate `0x80NN = (A[NN]!=0 || B[NN]!=0)`. So op 0x00 is an AND over
# bank-0x80 collection entries; the ONLY residual is the pre-existing open
# question of what the 403-entry collection array indexes (see
# get-flag-banked-predicate-system.md "banks 0x80/0x92").
COLLECTION_A_BASE = 0x7C
OP00_PAIR_OFFSETS = {
    # subop -> the A-side `lb` offsets read, in program order
    0: [0x83, 0xD5, 0x123],                    # .L0x80015640/0x80015660/0x80015680
    1: [0xE5, 0xF3, 0xFF, 0x10C, 0x118],       # .L0x800156a4..0x80015724
}

# op 0x10 / F0x80015754: 10-way jump table at D0x80010160 (`sltiu $v0,$a0,0xa`).
# Roster record base is D0x80048d34+0x760+slot*0x3dc == DIGIMON_CUR_STATS[slot]-8;
# `roster_owned[slot]` is the u32 there (0 = slot never obtained, else the partner's
# species id). `+0x784` == DIGIMON_CUR_STATS[slot]+0x1c == Unknown4Stats.level.
OP10_JUMP_TABLE = 0x80010160
ROSTER_OWNED_ADDR = 0x80049494        # = D0x80048d34 + 0x760, stride 0x3dc
ROSTER_STRIDE = 0x3DC
OP10_LEVEL_GATE = 0x2D                # `slti $v0,0x2d` in cases 4 and 7
PACK_SELECTOR_ADDR = 0x8004B374       # = DIGIMON_CUR_STATS + 0x3dc*8 - 8


def op10_semantics(subop: int, p2: int) -> dict | None:
    """F0x80015754 case `subop`, decoded from its jump-table target in fns.s."""
    if subop == 0:                     # F0x800157a0
        return {"kind": "pack_selector_equals", "effect": "read", "value": p2,
                "address": PACK_SELECTOR_ADDR}
    if subop == 1:                     # F0x800157bc
        return {"kind": "roster_owned", "effect": "read", "slot": p2}
    if subop == 2:                     # F0x800157e8
        return {"kind": "party_contains_slot", "effect": "read", "slot": p2}
    if subop == 3:                     # F0x80015820 — WRITE
        return {"kind": "grant_partner", "effect": "write", "slot": p2,
                "species_id": p2 + 3}
    if subop == 4:                     # F0x8001584c
        return {"kind": "roster_owned_at_level", "effect": "read", "slot": p2,
                "min_level": OP10_LEVEL_GATE}
    if subop == 5:                     # F0x80015898
        return {"kind": "party_level_sum_at_least", "effect": "read",
                "threshold": p2 * 15 + 30}
    if subop == 6:                     # F0x8001590c
        return {"kind": "roster_not_owned", "effect": "read", "slot": p2}
    if subop == 7:                     # F0x80015944
        return {"kind": "every_owned_at_level", "effect": "read",
                "min_level": OP10_LEVEL_GATE, "slots": 8}
    if subop == 8:                     # F0x80015990 — WRITE
        return {"kind": "heal_active_party", "effect": "write",
                "detail": "cur_hp=max_hp, cur_mp=max_mp for the <=3 active party members"}
    if subop == 9:                     # F0x800159fc
        return {"kind": "every_slot_owned", "effect": "read", "slots": 8}
    return None                        # subop >= 0xa: `sltiu` guard returns 0


# op 0x40 / F0x80015bd8 (.L0x80015bd8-.L0x80015d48). Both subops call the plain
# stored-bit getter F0x80015590(base, bit, 1) on flag-bank bases documented in
# get-flag-banked-predicate-system.md: D0x8004b3b5 = bank 0x1c, D0x8004b3a6 = bank 0x10.
OP40_TALLY_BANK = 0x1C                 # D0x8004b3b5
OP40_TALLY_BITS = list(range(0x27, 0x2E))   # `li $s0,0x27` .. `slti $v0,$s0,0x2e`
OP40_ALLSET_BANK = 0x10                # D0x8004b3a6
OP40_ALLSET_BITS = [0x0D, 0x0E, 0x0F, 0x10]
OP40_TALLY_TEST = {                    # param2 -> the comparison on the tally
    0: {"test": "set_count_at_least", "n": 1},      # .L0x80015c90 `beqz $s2`
    1: {"test": "clear_count_at_least", "n": 2},    # .L0x80015ca0 `slti $v0,$s1,0x2`
    2: {"test": "clear_count_equals", "n": 1},      # .L0x80015cb4 `bne $s1,$v1`
}

# op 0x50 / F0x80015d4c (.L0x80015d4c-.L0x80015d8c): one resident-object call and an
# unconditional `li $v0,0x1`. `[0x8004b7bc]` is the shared object lookup, statically
# resolved to F0x8001810c (exclamation-indicator-decoded-2026-07-02.md).
OP50_OBJECT_TYPE = 0x16
OP50_VTABLE_OFFSET = 0x2C
OP50_VTABLE_ARG = 3


def semantics_for(hi_nib: int, subop: int, p2: int) -> dict | None:
    """Exact, machine-readable meaning of one dispatch record.

    `effect` is "read" for pure predicates and "write" for the records that mutate
    persistent state (op 0x10 cases 3/8, op 0x20 ADD/SUBTRACT, op 0x50). `None`
    means the handler provably returns a constant 0 for this parameter.
    """
    if hi_nib == 0x00:
        offsets = OP00_PAIR_OFFSETS.get(subop)
        if offsets is None:            # `default: return 0` in F0x8001561c
            return None
        return {"kind": "collection_all", "effect": "read",
                "collection_indices": [off - COLLECTION_A_BASE for off in offsets]}
    if hi_nib == 0x10:
        return op10_semantics(subop, p2)
    if hi_nib == 0x40:
        if subop == 0:
            test = OP40_TALLY_TEST.get(p2)
            if test is None:           # p2 >= 3 falls through every compare -> 0
                return None
            return {"kind": "stored_bit_tally", "effect": "read",
                    "bank": OP40_TALLY_BANK,
                    "flag_ids": [(OP40_TALLY_BANK << 8) | b for b in OP40_TALLY_BITS],
                    **test}
        if subop == 1:
            return {"kind": "stored_bits_all_set", "effect": "read",
                    "bank": OP40_ALLSET_BANK,
                    "flag_ids": [(OP40_ALLSET_BANK << 8) | b for b in OP40_ALLSET_BITS]}
        return None                    # `default: return 0`
    if hi_nib == 0x50:
        return {"kind": "object_action", "effect": "write",
                "object_type": OP50_OBJECT_TYPE, "vtable_offset": OP50_VTABLE_OFFSET,
                "vtable_arg": OP50_VTABLE_ARG, "returns": 1}
    return None                        # op 0x20 amounts live in bank70_rewards.json;
                                       # op 0x30 resolves to ordinal_lo/ordinal_hi below


def ram_from_disc(disc: Path) -> bytes:
    """A 2 MB RAM image holding just the resident EXE, which is where this table
    lives (static EXE data): read from the disc image ddw3's build lays out."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from build_native_screens import load_exe
    with open(disc, "rb") as fh:
        base, exe = load_exe(fh)
    ram = bytearray(0x200000)
    ram[base - 0x80000000:base - 0x80000000 + len(exe)] = exe
    return bytes(ram)


def main():
    if len(sys.argv) > 2 and sys.argv[1] == "--disc":
        dump = Path(sys.argv[2])
        data = ram_from_disc(dump)
    else:
        dump = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DUMP
        data = dump.read_bytes()
    # trust check: the flag-API pointer table must be intact in this dump
    api = struct.unpack_from("<I", data, 0x80048AC8 - 0x80000000)[0]
    assert api == 0x800165AC, f"dump sanity failed: [0x80048ac8]={api:#x} (want 0x800165ac)"

    off = TABLE_ADDR - 0x80000000
    records = []
    while data[off] != 0xFF and len(records) < 1000:
        key, op, p2 = data[off], data[off + 1], data[off + 2]
        hi_nib = op & 0xF0
        rec = {
            "key": key,                       # = the 0x70NN low byte
            "flag_id": 0x7000 | key,
            "op": op,
            "handler": OP_HANDLER.get(hi_nib, f"?{hi_nib:#x}"),
            "kind": OP_KIND.get(hi_nib, "unknown"),
            "op_lo": op & 0x0F,
            "param2": p2,
        }
        if hi_nib == 0x30:                    # progress-ordinal range — resolve [lo,hi] now
            r = RANGE_TABLE - 0x80000000 + p2 * 2
            lo, hi = data[r], data[r + 1]
            rec["ordinal_lo"] = lo
            rec["ordinal_hi"] = None if hi >= 0x63 else hi
        else:
            # Exact per-opcode meaning for every non-0x30 handler. `None` = the
            # handler provably returns a constant 0 for this parameter, which is a
            # decoded outcome, not a gap; record it explicitly so a consumer can
            # tell "never true" apart from "not yet decoded".
            rec["semantics"] = semantics_for(hi_nib, rec["op_lo"], p2)
        records.append(rec)
        off += 3

    out = {
        "_comment": ("bank-0x70 predicate dispatch table D0x80048ad8 (static EXE data, read "
                     "from a 2MB RAM dump). get_flag(0x70NN,e) = (handler[op](op_lo,param2) "
                     "== e) where the sub-predicate reads roster/collection object D0x80048d34. "
                     "3-byte {key,op,param2} records, 0xff terminator. op high-nibble -> handler "
                     "(see OP_HANDLER). Per-handler semantics: see get-flag-banked-predicate-"
                     "system.md. Generated by tools/extract_roster_predicate_table.py."),
        "source_dump": dump.name,
        "count": len(records),
        "records": records,
    }
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    import collections
    by = collections.Counter(r["handler"] for r in records)
    print(f"wrote {OUT} — {len(records)} records")
    for h, c in sorted(by.items()):
        print(f"  {h}: {c}")


if __name__ == "__main__":
    main()
