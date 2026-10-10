#!/usr/bin/env python3
"""Extract the inn (hotel) rest service -> web/assets/data/inn_ui.json.

THE BANK. `eshtlnam` is the inn service bank. `fieldstg` `F0x8008957c` requests
it as `*(s32 *)0x8005CCA8 + 0x5C` -- the language global plus the bank constant
0x5C.

DO NOT CONFUSE IT WITH `esshpnam`. That bank's tail also lists inns, but it is
the SAVE-LOCATION name list (it also holds towers, cities and badlands), and
`web/save.js` already consumes it correctly for the memory-card "place" field.

THE GATE. `F0x8008957c` reads the current screen id and scans a null-terminated
*2*-byte-stride s16 table at RAM 0x80097664 (`addiu $v1, 0x2` at fieldstg file
0x6918), requesting the bank only on a match. That table IS shipped: it lives in
the fieldstg overlay data at file offset 0x149b4 (base 0x80082cb0), and reads
identically in four independent RAM captures. It holds exactly the 21 screen ids
below. It is only a PRELOAD gate, though -- nothing else reads it.

THE RECORD TABLE. The screen itself is the resident class `F0x800119a8`, reached
from the innkeeper's `on_close` flag: bank 0x7A index 0x1E..0x30 (and 0x45)
routes through `F0x800165ac` to `jal D0x8008c000`, which builds the screen with
`F0x80011dac(0x1002)`. `F0x800119a8` calls the screen-id getter `D0x8004b438`
and linearly scans the 8-byte-stride table `D0x8003edcc` for that id, storing the
matched POSITION at obj+0x58. So the inn identifies itself from the map you are
standing on, never from the flag index -- which is why two stages can share one
flag index.

Each 8-byte record is:

    +0x0  s32  screen id
    +0x4  u16  eshtlnam string index  (drawn via draw-string, method +0x114)
    +0x6  u16  price per Digimon      (drawn via draw-number, method +0x118)

read at `fns.s` L1584-1594 (`lh $a2, 0x4($v0)`, name) and L1645-1655
(`lh $a2, 0x6($v0)`, price).

THE TRANSACTION.
  * `arg0->unk60` counts the party slots that answer >= 0 to the party-manager
    probe `D0x80048d34+0x2718`, over slots 0..2 (`fns.s` L2183-2189).
  * Affordability (`fns.s` L1797-1807): `total = price * count`, compared with
    `slt` against the BIT total at `D0x80048da0`.
  * Commit (`fns.s` L2009-2019): the same `price * count` is subtracted from
    `D0x80048d34 + 0x6c` (the BIT total), then `F0x8001104c` runs.
  * `F0x8001104c` is the rest effect: for each of the 3 slots it copies
    max HP -> current HP, max MP -> current MP, and zeroes the three halfwords
    at +0x42, +0x44 and +0x46 of the roster record.

Usage:
    .venv/bin/python3 tools/extract_inn_ui.py
"""

from __future__ import annotations

import json
import os
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parent.parent
DDW3 = pathlib.Path(os.environ.get("DDW3_DIR") or pathlib.Path.home() / "ddw3")
BANK = DDW3 / "lang_file/dw2003/eng/eshtlnam.toml"
EXE_DATA = DDW3 / "rust/dw2003_exe_data/src/data.rs"
SCREENS = REPO / "web/assets/data/screen_table.json"
OUT = REPO / "web/assets/data/inn_ui.json"

# fieldstg F0x8008957c: `*(s32 *)0x8005CCA8 + 0x5C`
BANK_BASE = 0x5C
GATE_TABLE_RAM = 0x80097664
GATE_TABLE_FILE = 0x149B4
RECORD_TABLE = "D0x8003edcc"
# F0x800165ac bank-0x7A branch: everything that is not `< 0x1e` and not in the
# card-shop ranges 0x31..0x43 / 0x46..0x4a falls through to `jal D0x8008c000`.
LAUNCHER_BANK = 0x7A


def toml_strings(path: pathlib.Path) -> list[str]:
    """Read the flat `strings = [...]` array, preserving index == bank index."""
    out: list[str] = []
    inside = False
    for line in path.read_text(errors="replace").splitlines():
        s = line.strip()
        if not inside:
            if s.startswith("strings"):
                inside = True
            continue
        if s.startswith("]"):
            break
        m = re.match(r'^"(.*)",?$', s)
        if m:
            out.append(m.group(1))
    return out


def record_table(path: pathlib.Path) -> list[tuple[int, int, int]]:
    """Parse `pub static mut D0x8003edcc ... = [ 0x..., ];` into 8-byte records.

    Returns (screen_id, name_index, price) up to the zero-screen terminator.
    """
    text = path.read_text(errors="replace")
    m = re.search(
        r"pub static mut " + RECORD_TABLE + r"\b[^=]*=\s*\[(.*?)\];",
        text,
        re.S,
    )
    if not m:
        raise SystemExit(f"{RECORD_TABLE} not found in {path}")
    words = [int(w, 16) for w in re.findall(r"0x([0-9a-fA-F]{8})\s*,", m.group(1))]
    rows: list[tuple[int, int, int]] = []
    for i in range(0, len(words) - 1, 2):
        screen, packed = words[i], words[i + 1]
        if screen == 0:
            break
        rows.append((screen, packed & 0xFFFF, (packed >> 16) & 0xFFFF))
    return rows


def main() -> None:
    strings = toml_strings(BANK)
    screens = json.loads(SCREENS.read_text())
    rows = record_table(EXE_DATA)

    inns = []
    for pos, (screen, name_index, price) in enumerate(rows):
        entry = screens.get(str(screen))
        if entry is None:
            raise SystemExit(f"screen id {screen} missing from {SCREENS.name}")
        if name_index >= len(strings) or not strings[name_index]:
            raise SystemExit(f"bank index {name_index} is empty in eshtlnam")
        inns.append(
            {
                "index": pos,
                "screen": screen,
                "stage": entry["stage"],
                "map": f"s{entry['stage']}",
                "name_index": name_index,
                "name": strings[name_index],
                "price_per_digimon": price,
            }
        )

    data = {
        "source": "~/ddw3/lang_file/dw2003/eng/eshtlnam.toml",
        "record_table": {
            "symbol": RECORD_TABLE,
            "source": "~/ddw3/rust/dw2003_exe_data/src/data.rs",
            "stride": 8,
            "layout": "+0x0 s32 screen id, +0x4 u16 eshtlnam index, +0x6 u16 price per Digimon",
            "read_by": "F0x800119a8 (index -> obj+0x58); name fns.s L1594, price fns.s L1655",
        },
        "overlay": "pro/fieldstg",
        "requested_by": {
            "function": "F0x8008957c",
            "bank_base": BANK_BASE,
            "disasm": "*(? (**)(s32))0x80044F44(*(s32 *)0x8005CCA8 + 0x5C)",
        },
        "preload_gate": {
            "ram": f"{GATE_TABLE_RAM:#x}",
            "file": f"{GATE_TABLE_FILE:#x}",
            "stride": 2,
            "note": "shipped fieldstg data; same 21 screen ids as the record table",
        },
        "launcher": {
            "bank": LAUNCHER_BANK,
            "note": (
                "innkeeper NPC 20 (sprite p039tail) on_close sets bank 0x7A. "
                "F0x800165ac sends every index that is not < 0x1e and not in the "
                "card-shop ranges 0x31..0x43 / 0x46..0x4a to jal D0x8008c000. "
                "The index does NOT select the inn -- the current screen id does."
            ),
        },
        "transaction": {
            "total": "price_per_digimon * (party slots present, over slots 0..2)",
            "affordable": "BIT (D0x80048da0) >= total",
            "charge": "D0x80048d34+0x6c -= total   (fns.s L2009-2019)",
            "effect": (
                "F0x8001104c, per slot 0..2: current HP = max HP, current MP = "
                "max MP, and the three halfwords at roster +0x42/+0x44/+0x46 are "
                "zeroed."
            ),
        },
        # DECODED 2026-08-13 from F0x800119a8 (fns.s L2152-2425). Native PS1
        # 320x240 screen space, so every number below is used verbatim.
        "layout": {
            "native_width": 320,
            "font_resource": 0x1002,
            "clut": {"x": 0x140, "y": 0},
            "window_pack": {
                "handle": "0x02860000",
                "name": "cmfont",
                "note": "resolved through D0x80044b38+0x424; LBA 646 = CMFONTCS, the pack the item shop and status menu already use.",
            },
            # Three independent fold tweens, all with steps 0xA (obj+0x6C/+0x7C/
            # +0x8C), values at obj+0x74/+0x84/+0x94, fully open at 0x1000.
            # `pivot` is the setAnchor(x,y) issued immediately before each piece
            # while the fold is mid-animation.
            "windows": [
                {
                    "id": "header",
                    "fold_field": "0x74",
                    "steps": 0xA,
                    "pieces": [
                        {"clip": 0x41, "x": 0x16, "y": 0x12, "pivot": [0x57, 0x19]},
                        {"clip": 0x42, "x": 0xD6, "y": 0x0F, "pivot": [0x140, 0x18]},
                    ],
                },
                {
                    "id": "prompt",
                    "fold_field": "0x84",
                    "steps": 0xA,
                    "pieces": [
                        {"clip": 0x43, "x": 0x4C, "y": 0x2E, "pivot": [0x140, 0x41]},
                        {"clip": 0x44, "x": 0xAF, "y": 0x59, "pivot": [0x140, 0x6D]},
                    ],
                },
                {
                    "id": "alternate",
                    "fold_field": "0x94",
                    "steps": 0xA,
                    "pieces": [
                        {"clip": 0x43, "x": 0x4C, "y": 0x2E, "pivot": [0x140, 0x41]},
                    ],
                    "role": "refusal",
                    "message_string": 0x14,
                    "message_bank": "[0x8005cca8] + 0x5C (LBA 92 = MSHTLNAM run; eng = 94, eshtlnam)",
                    "message_widget": "price",
                    "states": [30, 31, 32],
                    "note": "Same clip and place as the prompt panel but fetched through the OTHER resolver D0x80044f5c. DECODED 2026-08-14: this is the \"You don't have enough BIT!\" panel. F0x800110e0 state 30 waits for this fold, then writes eshtlnam 0x14 into the OFFER widget -- so the refusal replaces the price line; state 31 waits for Confirm; state 32 waits for the fold to close.",
                },
            ],
            # Seven objects, all built as F0x8001ae38(0x1002, kind, x, y).
            "widgets": [
                {"id": "inn_name", "kind": 1, "x": 0x1D, "y": 0x14,
                 "source": "eshtlnam[record+0x4]", "slot": "0x114"},
                {"id": "bits", "kind": 3, "x": 0x117, "y": 0x17, "align": "right",
                 "source": "D0x80048da0 (the BIT total), as an integer",
                 "slot": "0x118 line 0, then 0x148(1) to right-align"},
                {"id": "bits_label", "kind": 3, "x": 0x11A, "y": 0x17,
                 "source": "eshtlnam[16] = \"BIT\"", "slot": "0x114"},
                {"id": "price", "kind": 1, "x": 0x79, "y": 0x34,
                 "source": "eshtlnam[17] = \"Each Digimon\\n{1} BIT\", with line 1 set to the price",
                 "slot": "0x114, then 0x118 line 1"},
                {"id": "option_stay", "kind": 1, "x": 0xC5, "y": 0x5F,
                 "source": "eshtlnam[18] = \"Stay in Inn\"", "slot": "0x114"},
                {"id": "option_leave", "kind": 1, "x": 0xC5, "y": 0x6F,
                 "source": "eshtlnam[19] = \"Do not stay in Inn\"", "slot": "0x114"},
            ],
            # F0x8001b364(0x1002, 0, 0xB8, 0x5F); the selection handler moves it
            # with setPosition(0xB8, 0x5F + (sel << 4)) at fns.s L1730-1740.
            "cursor": {"x": 0xB8, "y": 0x5F, "row_pitch": 0x10, "rows": 2},
            "selection": {
                "field": "0x5C",
                "up_button": 4,
                "down_button": 6,
                "confirm_button": 0xD,
                "note": "logical button ids read through the pad remap; 0 = Stay in Inn, 1 = Do not stay.",
            },
        },
        "strings": {"all": strings},
        "inn_names": [s for s in strings[1:16] if s],
        "inns": inns,
        "prompt": {
            "currency": strings[16] if len(strings) > 16 else "BIT",
            "price_line": strings[17] if len(strings) > 17 else "",
            "options": [s for s in strings[18:20] if s],
            "unaffordable": strings[20] if len(strings) > 20 else "",
        },
        "open_gaps": [
            "The meaning of the three cleared halfwords at roster +0x42/+0x44/"
            "+0x46 is not established. Prior research "
            "(battle/stgtrain-static-investigation-2026-07-08.md) calls +0x42 "
            "`un2` and +0x44 the start of `un3` and says their semantics are "
            "unresolved. The walker clears its status-effect list on a stay, "
            "which is an INTERPRETATION of those three fields, not a decode.",
            "WHICH scale axis the fold value drives is not decoded — the three "
            "scale components carry identical defaults (UI-C-FOLD-VALUE-IS-SCALE "
            "says so explicitly). The walker scales on x, matching the item "
            "shop's header, which uses these same two pieces at these same "
            "pivots and is confirmed correct in play.",
            "RESOLVED 2026-08-14 (ledger UI-INN-THIRD-FOLD-2026-08-14): the third "
            "fold is the REFUSAL panel, and its trigger is states 30, 31 and 32 of "
            "the screen's own update F0x800110e0. State 30 polls that fold with "
            "F0x80010fe0(obj+0x8C) and, once it reports done, sets the SAME widget "
            "that normally carries the offer (arg1+0x10, at (121,52)) to string "
            "0x14 of the bank [0x8005cca8]+0x5C -- LBA 92 + language, i.e. "
            "eshtlnam, whose entry 0x14 is \"You don't have enough BIT!\". State 31 "
            "waits for logical button 0xD (Confirm) and state 32 waits for the "
            "same fold to finish closing. So the message REPLACES the price line "
            "rather than joining it. Now drawn by the walker. STILL OPEN: the two "
            "resolvers D0x80044b38+0x424 and D0x80044f5c are still not "
            "distinguished -- both are called with handle 0x02860000 here.",
            "Whether staying advances any clock is not read; nothing in "
            "F0x8001104c or the commit path touches a time value.",
        ],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=1) + "\n")
    print(f"{len(inns)} inns, {len(data['inn_names'])} names -> {OUT.name}")


if __name__ == "__main__":
    main()
