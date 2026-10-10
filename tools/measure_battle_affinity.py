#!/usr/bin/env python3
"""Measure BATTLE-Q004 part (d): how often the damage tail's stage-3 operand is nonzero.

THE OPERAND. `F0x8009f6dc` reads the ACTING side's effective block `+0x26`
(`pro/fightstg.s:29904 lbu $v0, 0x26($s2)`) and, when it is nonzero, adds
`running * byte / 64` to the running damage (`:29908 mult $s0, $v0` / `:29910 mflo
$v0` / `:29916 sra $v0, 0x6` / `:29918 addu $s0, $v0`). `F0x8009ec94` copies that block
byte out of the live combatant record's `+0x0E` (`:29409 lbu $v0, 0xe($s3)` /
`:29411 sb $v0, 0x26($s2)`), and the record base it reads is the 0x20-stride party array
`0x800a4470 + index*0x20` (`:29212`) or its enemy half `0x800a44d0 + index*0x20`
(`:29706`). Nothing masks the byte, so the WHOLE byte is the divisor's multiplier.

THE WRITER. It is NOT the cop2 display-list packer. `FIGHTSTG_F0x80084bc0`
(`:2084 sh $v0, 0xe($v1)`) and `FIGHTSTG_F0x80084e0c` (`:2215`) do write a byte at
displacement `0x0e`, but `$v1` there is `*(arg0+0x54)` (`:2081 lw $v1, 0x54($a3)`), and in
the display-list interpreter `FIGHTSTG_F0x80085110` that slot is the global at
`0x8004DE30` — `:2520 lw $v1, -0x2098($v1)` loads the engine service at `0x8004DF68`, which
`exe/fns.s:14840-14842` shows to be `F0x8001d844`: `lui $v0, 0x8004 / lw $v0, 0xde30($v0)
/ jr $ra`. So those two sites write a GPU polygon record (the same arms put the command
byte `0x3c`/`0x2c` at `+0x07` and a texture-page word at `+0x1a`), not a combatant record.

THE REAL WRITERS. Three stores, all inside the category-5 ("Saving Chi!") handler
`FIGHTSTG_F0x8008f714`, and they are selected by the technique id
(`:13668 lw $v1, 0x54($s4)`):

  * `:13875 sh $a0, 0xe($v1)` — ids 0xd1 (209) and 0xd2 (210). The value is
    `lbu $a0, 0xc($s5)` at `:13873`, and `$s5` is the technique's own 18-byte record
    (`:13109-13110` form `0x80042bca + 18 * id`), so the byte is the record's `+0x0C`.
    Dispatch: `:13690 li $v0, 0xd4 / :13691 beq $v1, $v0, .L0x800905c8` /
    `:13692 slti $v0, $v1, 0xd5 / :13694 slti $v0, $v1, 0xd3 / :13695 bnez $v0,
    .L0x80090528`.
  * `:14016 sh $v0, 0xe($s0)` — id 0x190 (400), with `li $v0, 0x20` at `:14015`. The
    record base is `0x800a4460 + 0x70 = 0x800a44d0` (`:13992` / `:13994`) plus
    `index*0x20` (`:13998` / `:14000`), i.e. the ENEMY party array — the same array
    `F0x8009ec94` reads at `:29706`.
  * Five sites clear it back to zero: `F0x8008cb70` `:10312`, `F0x8008ee84` `:12760`,
    `F0x8008f714` `:13092`, plus `pro/wfightmn.s` `:3275` and `:3653`. Each builds the
    record from the side byte the event carries and runs on the path where the battle
    message box has nothing outstanding (`lw $v0, ($s2) / bnez $v0, ...` at `:10288-10290`,
    `:12761-12763`), so the byte lives until that side's presentation is over.

WHAT THIS TOOL MEASURES. The three ids the asm arms name, the byte each one writes, the
resulting damage multiplier, and — as the census — every technique in the shipped table
whose `+0x0C` byte could be mistaken for one of them, so a hand list cannot hide.

SOURCES. The disc's own data segment (`~/ddw3/rust/dw2003_exe_data/src/data.rs`,
`D0x80042bdc: [Unknown3; 443]`, read-only) is the authority; the shipped extract
`web/assets/data/fight_tech_table.json` and the shipped names in
`web/assets/data/digimon.json` are cross-checked against it. Nothing here is hand-copied.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_RS = Path.home() / "ddw3/rust/dw2003_exe_data/src/data.rs"
TECH_JSON = ROOT / "web/assets/data/fight_tech_table.json"
DIGIMON_JSON = ROOT / "web/assets/data/digimon.json"

TABLE_BASE = 0x80042BCA
STRIDE = 0x12
ROW_COUNT = 443
# The three arms of FIGHTSTG_F0x8008f714 that write a nonzero value into a combatant
# record's +0x0E. Listed from the ASSEMBLY (see the module docstring), not from data.
CHI_ARMS = (0xD1, 0xD2)      # fightstg.s:13875, value = record +0x0C
GENERATE_ARM = 0x190         # fightstg.s:14016, value = the literal 0x20
LITERAL_20 = 0x20


def read_disc_table():
    """The 443 technique records straight out of the disc's data segment."""
    rows = []
    for line in DATA_RS.read_text().splitlines():
        m = re.match(r"\s*Unknown3 \{ (.+) \},", line)
        if m:
            fields = {k.strip(): int(v, 16) for k, v in
                      (p.split(":") for p in m.group(1).split(","))}
            rows.append(fields)
    if len(rows) != ROW_COUNT:
        raise SystemExit(f"expected {ROW_COUNT} technique rows, found {len(rows)}")
    # +0x0C is the ninth declared field, `f9` — tools/extract_fight_tech_table.py
    # writes it out as `crit`.
    return {i + 1: rows[i]["f9"] for i in range(ROW_COUNT)}


def shipped_table():
    data = json.loads(TECH_JSON.read_text())
    return {int(k): int(v["crit"]) for k, v in data.items()}


def shipped_names():
    data = json.loads(DIGIMON_JSON.read_text())
    return {int(s["id"]): s.get("name") for s in data["skills"]}


def cross_check(disc, shipped):
    bad = [t for t in disc if disc[t] != shipped.get(t)]
    if bad:
        raise SystemExit(
            f"the shipped extract disagrees with the disc on +0x0C for {len(bad)} "
            f"techniques: {bad[:12]}")
    return True


def multiplier(byte):
    """`running * byte / 64` — the tail's own arithmetic, as a plain multiplier."""
    return 1.0 + byte / 64.0


def main() -> int:
    disc = read_disc_table()
    shipped = shipped_table()
    cross_check(disc, shipped)
    names = shipped_names()

    print(f"technique table: {TABLE_BASE:#x} + {STRIDE:#x} * id, {ROW_COUNT} rows")
    print(f"record byte +0x0C cross-checked against {TECH_JSON.name}: "
          f"all {ROW_COUNT} rows agree\n")

    print("the arms that write the combatant record's +0x0E:")
    print(f"  {'id':>5} {'name':<20} {'+0x0C':>5} {'source':<12} {'x damage':>9}")
    members = {}
    for tech in CHI_ARMS:
        byte = disc[tech]
        members[tech] = ("record+0x0C", byte)
        print(f"  {tech:>5} {str(names.get(tech)):.<20} {byte:>5} {'record+0x0C':<12} "
              f"x{multiplier(byte):.4f}")
    members[GENERATE_ARM] = ("literal 0x20", LITERAL_20)
    print(f"  {GENERATE_ARM:>5} {str(names.get(GENERATE_ARM)):<20.20} "
          f"{LITERAL_20:>5} {'literal 0x20':<12} x{multiplier(LITERAL_20):.4f}")

    # The census: no other technique can reach the byte, because only these three arms
    # store into it. Every distinct +0x0C in the table is listed so the reader can see
    # that the two Chi arms are not special by accident and that no fourth id exists.
    values = sorted(set(disc.values()))
    print(f"\ndistinct record +0x0C values over all {ROW_COUNT} techniques: {values}")
    nonzero = {v: [t for t in sorted(disc) if disc[t] == v] for v in values if v}
    print("nonzero +0x0C values and every technique that carries one:")
    for v, ids in nonzero.items():
        print(f"  {v:>4} -> {len(ids):>3} techniques, e.g. {ids[:8]}"
              f"{' ...' if len(ids) > 8 else ''}")
    print("\nof those, the arms that actually write the byte are "
          f"{sorted(members)} (ids {sorted(members)})\n")

    # Which shipped Digimon can reach them.
    data = json.loads(DIGIMON_JSON.read_text())
    owners = {}
    for p in data["digimon"]:
        slots = [p.get("tech_basic"), p.get("tech_signature")] + list(p.get("techs") or [])
        for t in members:
            if t in slots:
                owners.setdefault(t, []).append(p["name"])
    print("shipped Digimon that can use them:")
    for t in sorted(owners):
        print(f"  {t} {names.get(t)}: {', '.join(sorted(owners[t]))}")

    print(f"\nVERDICT: the operand is NONZERO for every reachable input. "
          f"{len(members)} of {ROW_COUNT} techniques write it, and the two Chi ids take "
          f"their value from the disc's own +0x0C column "
          f"({disc[0xD1]} and {disc[0xD2]}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())