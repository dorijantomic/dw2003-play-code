#!/usr/bin/env python3
"""
Extract the bank-0x70 REWARD/ACTION dispatch table -> web/assets/data/bank70_rewards.json.

Decode (orchestrator-verified against a runtime capture; see the ledger claim
`bank70-reward-dispatch-table`): bank-0x70 `set_flag` WRITES (not reads) are routed by the
resident dispatcher `F0x800165ac` to `F0x80015d90(index, 1)`. That function linearly scans
the SAME static table already known as the bank-0x70 predicate dispatch table
(`web/assets/data/roster_predicate_table.json`, built by
`tools/extract_roster_predicate_table.py` from a RAM dump) — but read as a WRITE dispatch:
`D0x80048ad8`, 3 bytes/entry `{u8 key, u8 op, u8 param2}`, 0xFF-terminated, 120 entries.

This extractor is independent of that one: it reads the table (and its three numeric amount
tables) directly out of the STATIC EXE data source
`~/ddw3/rust/dw2003_exe_data/src/data.rs` (read-only, no RAM dump / rig needed — the table is
boot-time-constant EXE data), so it can run with no emulator.

Table bounds (from data.rs, all contiguous `u32` statics at 4-byte strides):
  reward table   D0x80048ad8 .. D0x80048c40 (exclusive)  = 0x168 bytes = 120 * 3 + 1-byte-align
                 terminator: the u32 at 0x80048c40 == 0x000000ff (byte0 0xff)
  compare table  D0x80048c44 .. D0x80048c6c (excl)  — op 0x20 arg0==0 (COMPARE), 10 x u32
  add table      D0x80048c6c .. D0x80048c8c (excl)  — op 0x20 arg0==1 (ADD), 8 x u32
  subtract table D0x80048c8c .. D0x80048cb4 (excl)  — op 0x20 arg0==2 (SUBTRACT), 10 x u32
Each boundary is a `//` section-comment break in data.rs AND (for the subtract table's upper
bound) the start of the already-documented op-0x30 range table `D0x80048cb4`
(RANGE_TABLE in extract_roster_predicate_table.py) — two independent confirmations we are not
reading past the amount tables' real extent. Table lengths are NOT hardcoded: this script
walks the contiguous `pub static mut D0x8004####` declarations and stops at the first address
gap or the next named boundary, then asserts the observed count against the value above.

opcode (op high-nibble) -> handler (F0x80015d90 @0x80015dd8..0x80015e8c, verified table):
  0x00 F0x8001561c   0x10 F0x80015754   0x20 F0x80015aac (CURRENCY)
  0x30 F0x80015b9c   0x40 F0x80015bd8   0x50 F0x80015d4c

F0x80015aac(arg0=op&0xF, arg1=param2) (exe-decomp/c/F0x80015aac.c):
  arg0==1 ADD:      D0x80048d34.unk6C (== 0x80048da0, the BIT/money total) += addTable[arg1],
                     capped at 0x98967F (9,999,999)
  arg0==0 COMPARE:  BIT >= compareTable[arg1]                       (read-only predicate)
  arg0==2 SUBTRACT: BIT -= subtractTable[arg1], floored at 0

ONLY opcode 0x20 arg0==1 (ADD) is decoded well enough to ACT on (per the ledger claim). All
120 entries are still emitted with their opcode/handler/args so downstream tooling and docs
have the full census; entries whose opcode/arg0 combination is not ADD get "resolved_action":
null and "wireable": false.

WORKED EXAMPLE (matches a runtime capture exactly — s235 Asuka Inn shelf search point):
  on_close flag 0x708c -> key 140 -> table entry (140, 0x21, 0x01) -> op=0x20 (CURRENCY),
  arg0=(0x21 & 0xF)=1 (ADD), arg1=param2=1 -> BIT += addTable[1] = 300.

Run: tools/extract_bank70_rewards.py (no arguments; always reads ~/ddw3, read-only)
"""
import os
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
DATA_RS = DDW3 / "rust/dw2003_exe_data/src/data.rs"
OUT = ROOT / "web/assets/data/bank70_rewards.json"

TABLE_ADDR = 0x80048AD8
EXPECTED_ENTRIES = 120
EXPECTED_TERMINATOR_OFFSET = EXPECTED_ENTRIES * 3  # 360

OP_HANDLER = {
    0x00: "F0x8001561c",
    0x10: "F0x80015754",
    0x20: "F0x80015aac",
    0x30: "F0x80015b9c",
    0x40: "F0x80015bd8",
    0x50: "F0x80015d4c",
}
OP_KIND = {
    0x00: "party-field check (fixed D0x80048d34 offsets)",
    0x10: "party/roster query (10-case, iterates 0x3dc-stride roster slots)",
    0x20: "currency/counter at D0x80048d34+0x6c (BIT total): compare/add/subtract",
    0x30: "progress-ordinal range [lo,hi]",
    0x40: "roster query (multi-case)",
    0x50: "roster special",
}

LINE_RE = re.compile(
    r'pub static mut D0x([0-9a-fA-F]{8}) @ "0x[0-9a-fA-F]{8}": u32 = 0x([0-9a-fA-F]{8});'
)


def load_static_words() -> dict[int, int]:
    """addr -> u32 value, for every `pub static mut D0x........: u32 = 0x........;` line."""
    text = DATA_RS.read_text()
    out: dict[int, int] = {}
    for m in LINE_RE.finditer(text):
        out[int(m.group(1), 16)] = int(m.group(2), 16)
    return out


def contiguous_bytes(words: dict[int, int], start: int, stop_exclusive: int) -> bytes:
    """Concatenate little-endian u32s for addr in [start, stop_exclusive), asserting the run
    is fully contiguous (every 4-byte address present) so we never silently skip a gap."""
    out = bytearray()
    addr = start
    while addr < stop_exclusive:
        if addr not in words:
            raise AssertionError(f"gap in static data at 0x{addr:08x} (range 0x{start:08x}..0x{stop_exclusive:08x})")
        out += words[addr].to_bytes(4, "little")
        addr += 4
    return bytes(out)


def main() -> None:
    words = load_static_words()

    # ── Reward/action dispatch table: D0x80048ad8. We do NOT know its end address up front, so
    # bound it SAFELY by reading a generous, independently-verified-contiguous span (up to the
    # already-published op-0x30 RANGE_TABLE address, which necessarily lies past every amount
    # table and therefore past the reward table too) and then stopping at the first 0xFF
    # terminator byte on a 3-byte stride -- the actual, in-band bound the original scanner uses
    # (F0x80015d90's own loop condition). This never reads past a real terminator; the generous
    # outer span only has to be an upper CEILING, not the true extent. ──
    SPAN_CEILING = 0x80048CB4  # RANGE_TABLE start (op-0x30 table) -- independently documented,
                                # guaranteed to be past the reward + all 3 amount tables.
    span = contiguous_bytes(words, TABLE_ADDR, SPAN_CEILING)

    records = []
    off = 0
    while off + 3 <= len(span) and span[off] != 0xFF and len(records) < EXPECTED_ENTRIES * 4:
        key, op, p2 = span[off], span[off + 1], span[off + 2]
        records.append({"key": key, "op": op, "param2": p2, "_offset": off})
        off += 3
    terminator_offset = off
    assert terminator_offset < len(span) and span[terminator_offset] == 0xFF, (
        f"table did not terminate with 0xFF within the span (byte offset {terminator_offset})"
    )
    assert len(records) == EXPECTED_ENTRIES, f"expected {EXPECTED_ENTRIES} entries, got {len(records)}"
    assert terminator_offset == EXPECTED_TERMINATOR_OFFSET, (
        f"expected terminator at byte offset {EXPECTED_TERMINATOR_OFFSET}, got {terminator_offset}"
    )
    # The terminator's containing u32 word is D0x80048ad8's last word; the table therefore ends
    # (exclusive) at the next 4-aligned address after the terminator byte.
    table_end = TABLE_ADDR + ((terminator_offset // 4) + 1) * 4

    # ── Three amount tables. Each is bounded by the next `//`-separated table's KNOWN start
    # address (COMPARE ends where ADD's own decoded start begins, etc.) — not by scanning for a
    # gap (there is none; data.rs keeps every u32 declared back-to-back through 0x80048cb4). The
    # 0x80048cb4 upper bound for SUBTRACT is the already-published op-0x30 RANGE_TABLE address
    # (extract_roster_predicate_table.py), an independent corroboration of where amounts end. ──
    COMPARE_START, ADD_START, SUB_START, SUB_END = 0x80048C44, 0x80048C6C, 0x80048C8C, 0x80048CB4

    def word_list(lo: int, hi: int) -> list[int]:
        b = contiguous_bytes(words, lo, hi)
        return [int.from_bytes(b[i:i + 4], "little") for i in range(0, len(b), 4)]

    compare_table = word_list(COMPARE_START, ADD_START)
    add_table = word_list(ADD_START, SUB_START)
    subtract_table = word_list(SUB_START, SUB_END)

    # Sanity: TABLE_ADDR..table_end from the walked-gap bound must equal COMPARE_START (the
    # reward table's real end, corroborating the terminator-offset assert above).
    assert table_end == COMPARE_START, (
        f"reward-table gap bound (0x{table_end:08x}) != documented compare-table start "
        f"(0x{COMPARE_START:08x}) -- table extent assumption is stale, re-derive"
    )

    out_records = []
    add_count = 0
    for r in records:
        op, p2 = r["op"], r["param2"]
        hi_nib, lo_nib = op & 0xF0, op & 0x0F
        rec = {
            "key": r["key"],
            "flag_id": 0x7000 | r["key"],
            "op": op,
            "handler": OP_HANDLER.get(hi_nib, f"?{hi_nib:#x}"),
            "kind": OP_KIND.get(hi_nib, "unknown"),
            "arg0": lo_nib,
            "arg1": p2,
            "resolved_action": None,
            "wireable": False,
        }
        if hi_nib == 0x20:
            if lo_nib == 1 and p2 < len(add_table):
                rec["resolved_action"] = {"kind": "ADD", "amount": add_table[p2]}
                rec["wireable"] = True
                add_count += 1
            elif lo_nib == 0 and p2 < len(compare_table):
                rec["resolved_action"] = {"kind": "COMPARE_GE", "amount": compare_table[p2]}
            elif lo_nib == 2 and p2 < len(subtract_table):
                rec["resolved_action"] = {"kind": "SUBTRACT", "amount": subtract_table[p2]}
            # else: arg1 out of bounds for its table -- leave unresolved (do not fabricate)
        out_records.append(rec)

    out = {
        "_comment": (
            "bank-0x70 REWARD/ACTION dispatch table D0x80048ad8 (static EXE data, parsed from "
            "~/ddw3/rust/dw2003_exe_data/src/data.rs, no RAM dump needed). set_flag(0x70NN,1) "
            "dispatches via F0x800165ac -> F0x80015d90(NN,1) -> this table's op high-nibble -> "
            "handler. Only opcode 0x20 (F0x80015aac, CURRENCY) with arg0==1 (ADD) is decoded "
            "well enough to act on; its resolved BIT amount comes from the ADD table "
            "D0x80048c6c. COMPARE (arg0==0) and SUBTRACT (arg0==2) amounts are resolved for "
            "reference but NOT acted on (their game-facing trigger semantics are undecoded). "
            "Opcodes 0x00/0x10/0x30/0x40/0x50 are recorded as data only -- undecoded, unwired. "
            "Generated by tools/extract_bank70_rewards.py."
        ),
        "source": "~/ddw3/rust/dw2003_exe_data/src/data.rs",
        "count": len(out_records),
        "currency_add_count": add_count,
        "amount_tables": {
            "compare": {"addr": f"0x{COMPARE_START:08x}", "values": compare_table},
            "add": {"addr": f"0x{ADD_START:08x}", "values": add_table},
            "subtract": {"addr": f"0x{SUB_START:08x}", "values": subtract_table},
        },
        "records": out_records,
    }
    OUT.write_text(json.dumps(out, indent=1) + "\n")

    # Worked example self-check: s235 shelf search point, flag 0x708c (key 140).
    worked = next((r for r in out_records if r["key"] == 140), None)
    assert worked is not None, "key 140 (0x708c) missing from table"
    assert worked["op"] == 0x21 and worked["resolved_action"] == {"kind": "ADD", "amount": 300}, (
        f"worked example mismatch: key 140 -> {worked}"
    )

    print(f"wrote {OUT} -- {len(out_records)} entries, {add_count} currency-ADD (wireable)")
    print(f"worked example OK: key 140 (flag 0x708c) op={worked['op']:#x} -> ADD 300 BIT")


if __name__ == "__main__":
    main()
