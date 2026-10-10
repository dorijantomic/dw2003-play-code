#!/usr/bin/env python3
"""
Extract the STPLNMET registration-wizard UI: the native screen that hosts the
s785 "MAGAMI Online Center" Account Clerk flow — intro message, "Choose a
Starter Pack" list, per-pack Digimon list, account/partner name entry, and the
"Register account? YES/NO" confirmation — between story event `014a0001`
(esdmg700 entry 1) and the HANDOFF-1280 "name entry" transition already
tracked in docs/specs/2026-06-23-opening-flow-engine-port-design.md.

See docs/research/ui/stplnmet-decoded-2026-07-11.md for the full identification
writeup and evidence. Summary:
  - Screen-pack handles: NAMEDTCS (LBA idx 1904 = 0x770) / NAMEDTTM (LBA idx
    1905 = 0x771), proven by `lui $a0, 0x770` / `li $a0, 0x771` in
    stplnmet.norm.s (many call sites; handle = lba_idx << 16).
  - Text: esnameet.toml (intro/pack-choice/confirm strings, 33 entries) +
    esdgnmet.toml ("Choose a Digimon" / "Enter Name" / back-button hint,
    4 entries) — both un-owned by any other pro/ overlay in this tree.
  - Chrome: F0x80083e70 (name/account-entry widget ctor) is near byte-
    identical in layout to stdgname.s's F0x80083478 (new-game/DRI-rename
    keyboard chrome) -- same 8 anchor coordinates, same do-while x3 tab loop
    -- i.e. stplnmet embeds its own copy of the on-screen keyboard used to
    type the account/partner name. F0x80086fc0 is the pack/Digimon LIST
    chrome (title + 3-row pack list + 3-row digimon name/description list).
    F0x80085ecc is the YES/NO confirm chrome (owns a cursor via
    F0x8001b364, matching the master-plan's decoded cursor pattern).

Every literal below carries a `disasm:` provenance comment. Values not
resolvable from static evidence are omitted and recorded in `open_gaps`
rather than guessed.

Output: web/assets/data/stplnmet_ui.json
"""
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
NAMEET_TOML = DDW3 / "lang_file/dw2003/eng/esnameet.toml"
DGNMET_TOML = DDW3 / "lang_file/dw2003/eng/esdgnmet.toml"
OUT = ROOT / "web/assets/data/stplnmet_ui.json"

OVERLAY_BASE = 0x80082CB0


def load_strings(path: Path):
    text = path.read_text(encoding="utf-8")
    body = text[text.index("[") + 1: text.rindex("]")]
    items = []
    for m in re.finditer(r'"((?:[^"\\]|\\.)*)"', body, re.S):
        items.append(m.group(1).replace("\\n", "\n"))
    return items


PACK = {
    "cs": {"name": "NAMEDTCS", "lba_idx": 1904, "handle": 0x07700000,
           "disasm": "stplnmet.norm.s many sites, e.g. F0x800845a4 "
                     "`lui $a0, 0x770` (stplnmet.s ~L1540)"},
    "tm": {"name": "NAMEDTTM", "lba_idx": 1905, "handle": 0x07710000,
           "disasm": "stplnmet.s L5563/L5599-area `li $a0, 0x771`"},
    "note": "pack/dw2003/screen/namedtcs + namedttm -- the SAME pack the "
            "stdgname-decoded doc flagged as an unused red herring for the "
            "keyboard screen ('NOT the older pack/dw2003/screen/namedtcs/tm "
            "that the pre-decode todo doc guessed at'). stplnmet is the "
            "overlay that actually owns it.",
}

# esnameet.toml index -> role. Established from literal English content
# (registration wizard copy) cross-referenced against the already-verified
# opening-flow docs (s785 Account Clerk dialogue explains packs A/B/C,
# then "native menu" pack pick, then "native name entry", per
# docs/research/scripting/2026-06-23-opening-animation-follower-parity-audit.md
# section 5).
NAMEET_ROLES = {
    0: "unused_empty",
    1: "intro_message",       # "Welcome to Digimon Online...."
    2: "name_entry_cursor",   # "_"
    3: "pack_index_1",        # "1"
    4: "pack_index_2",        # "2"
    5: "pack_index_3",        # "3"
    6: "choose_pack_title",   # "Choose a Starter Pack"
    7: "pack_letter_a",       # "A"
    8: "pack_letter_b",       # "B"
    9: "pack_letter_c",       # "C"
    10: "pack_name_a",        # "Balanced Pack"
    11: "pack_name_b",        # "Powerful Pack"
    12: "pack_name_c",        # "Maniac Pack"
    13: "member_desc_a1",     # Kotemon-ish "Balanced swordsman..."
    14: "member_desc_a2",     # "Powerful martial artist..."
    15: "member_desc_a3",     # "Has various guns..."
    16: "member_desc_b1",     # "Likes to spew fire..."
    17: "member_name_veemon",  # "Veemon"
    18: "member_desc_b2",     # "Mischievious Digimon..."
    19: "member_desc_b3",     # "Gets the enemy with lightning and ice."
    20: "member_desc_c",      # "Healing specialist. Very likable."
    21: "confirmation_title",  # "Confirmation Screen"
    22: "register_question",  # "Register account?"
    23: "yes",
    24: "no",
    25: "percent_fmt",        # "{1}%"
    26: "pack_desc_a",        # "Weapon, magic attacks and healing..."
    27: "pack_desc_b",        # "For the fearless who think..."
    28: "pack_desc_c",        # "They're all quirky and difficult..."
    29: "now_entering",       # "NOW ENTERING..."
    30: "registered",         # "Registered"
}

DGNMET_ROLES = {
    0: "unused_empty",
    1: "choose_a_digimon",     # "Choose a Digimon"
    2: "back_hint",            # "[triangle] Button: Back"
    3: "enter_name_title",     # "Enter Name"
}

# ---------------------------------------------------------------------------
# CHROME — every entry cites the exact draw-ctx-owning function + evidence.
# ---------------------------------------------------------------------------
CHROME = {
    # F0x80086fc0 (stplnmet.s ~L0x00006cb0 region, RAM 0x80086fc0): pack /
    # Digimon LIST screen. Title, then a do-while x3 loop of row labels
    # (18px y-step, x fixed at 0x1A) -- almost certainly the A/B/C pack rows
    # -- then a second header pair + a do-while x3 loop of TWO labels per row
    # (42px y-step, x fixed at 0x72, kinds 5 and 2 differ -- name vs.
    # description text style) -- the 3 Digimon-per-pack name+description
    # list.
    "pack_list_screen": {
        "title": {"x": 0x20, "y": 0x1A, "kind": 1, "clut": 4},
        "pack_rows": {
            "count": 3, "x": 0x1A, "y_start": 0x34, "y_step": 0x18,
            "kind": 1, "clut": 1,
            "note": "3 rows -- pack A/B/C row labels (hypothesis, strong: "
                    "matches esnameet 'Choose a Starter Pack' A/B/C string "
                    "set; exact per-row text binding not traced)",
        },
        "digimon_list_header": {"x": 0x3A, "y": 0x32, "kind": 1, "clut": 4},
        "digimon_list_header2": {"x": 0x3A, "y": 0xC2, "kind": 1, "clut": 1},
        "digimon_rows": {
            "count": 3, "x": 0x72, "y_step": 0x2A,
            "name_y_start": 0x43, "name_kind": 2, "name_clut": 5,
            "desc_y_start": 0x4F, "desc_kind": 1, "desc_clut": 1,
            "note": "3 rows x (name, description) -- the 3 Digimon in the "
                    "selected pack. Per-row text binding TRACED 2026-08-05, "
                    "see text_binding below; the earlier 'matches esnameet "
                    "member_name_*' reading was a hypothesis and is now "
                    "replaced by the actual indices.",
        },
        # TRACED 2026-08-05 from the screen's own text binder F0x80087190,
        # which closes the long-standing "per-row/per-cell text binding is NOT
        # traced" gap. Every call is class-A slot +0x114, i.e. set line 0 from
        # a resource string, whose two arguments are the string bank handle and
        # the index within it (ledger UI-WIDGETCLASS-AE38-SETLINE-001).
        "text_binding": {
            "_provenance": "F0x80087190 (exe-decomp/stplnmet_c), the arg2 != 0 "
                           "branch; bank handles resolved through the shared "
                           "text service by (language base + bank).",
            "title": {"bank": "0x8D", "index": 6},
            "pack_rows": {
                "bank": "0x8D", "index": "row + 7",
                "resolved": [7, 8, 9],
            },
            "digimon_list_header": {"bank": "0x8D",
                                    "index": "selectedPack + 0xA",
                                    "resolved": [10, 11, 12]},
            "digimon_list_header2": {"bank": "0x8D",
                                     "index": "selectedPack + 0x1A",
                                     "resolved": [26, 27, 28]},
            "digimon_name": {
                "bank": "0x4E",
                "index": "packMembers[selectedPack][row] + 1",
                "note": "a DIFFERENT bank from every other label on this "
                        "screen -- 0x4E is the Digimon name bank, indexed by "
                        "the member's own roster id plus one.",
            },
            "digimon_desc": {
                "bank": "0x8D",
                "index": "packMembers[selectedPack][row] + 0xD",
            },
        },
        "step_tabs": {
            "count": 3, "y": 0x12, "kind": 3,
            "x": [0xE4, 0x100, 0x11C],
            "strings": [3, 4, 5],
            "_provenance": "F0x80087b14 reads s16 x at 0x80089A80 stride 4, "
                           "y=0x12, binds bank 0x8D strings 3/4/5.",
        },
        "sprites": {
            "_note": "Pack-list chrome is STNMET (handle 0x028A0000 = "
                     "LBA_STNMETCS 650), not NAMEDT. NAMEDT (0x770) is only "
                     "the three Digimon clips.",
            "window": {
                "pack": "stnmet", "handle": "0x028A0000",
                "clip": 7, "x": 16, "y": 44,
                "_provenance": "F0x80087444 sp94(0x028A0000, 7, 0x10, 0x2C)",
            },
            "row_plates": {
                "pack": "stnmet", "handle": "0x028A0000",
                "clip": 8, "x": 16, "y": 44,
                "_provenance": "F0x80087444 sp94(0x028A0000, 8, 0x10, 0x2C)",
            },
            "pack_cursor": {
                "pack": "stnmet", "handle": "0x028A0000",
                "clip": 50, "x": 16, "y_base": 48, "y_step": 24,
                "_provenance": "F0x80087444 y = unk6C*0x18+0x30, clip 0x32",
            },
            "figures": {
                "pack": "namedt", "handle": "0x07700000",
                "x": 65, "y_start": 64, "y_step": 42,
                "_provenance": "F0x80087444 sp94(NAMEDTCS, clip, 0x41, "
                               "0x40+0x2A*i); clip table 0x80089a8c.",
                "used": True,
                "frame_vsync": 13,
                "pack_roster": [[0, 6, 7], [2, 3, 6], [1, 5, 7]],
                "clip_rows": [
                    [7, 8, 9, 10, 9, 8],
                    [14, 15, 16, 15],
                    [11, 12, 13, 12],
                    [3, 4, 5, 6, 5, 4],
                    [25, 26, 27, 28, 27, 26],
                    [0, 1, 2, 1],
                    [17, 18, 19, 20, 19, 18],
                    [21, 22, 23, 24, 23, 22],
                ],
            },
            "title_bar": {
                "pack": "stnmet", "handle": "0x028A0000",
                "clip": 13, "x": 24, "y": 21,
                "_provenance": "F0x80088070 sp94(0x028A0000, unk58+0xC, "
                               "0x18, 0x15). Clips 12/13/14 gold tabs 1/2/3. "
                               "Isolated pack-select is wizard step 2, clip 13.",
            },
        },
        "disasm": "F0x80086fc0 (stplnmet.norm.s, RAM 0x80086fc0)",
    },
    # F0x80083e70: account/partner NAME-ENTRY chrome. Near byte-identical to
    # stdgname.s F0x80083478 (same 8 anchors, same 3x do-while tab loop at
    # 0x4E0000-per-iter == 78px x-step) -- this overlay embeds its own copy
    # of the on-screen keyboard used elsewhere for Digimon naming / DRI
    # rename.
    "name_entry_screen": {
        "title": {"x": 0x20, "y": 0x1A, "kind": 1},
        "subtitle": {"x": 0x4B, "y": 0x40, "kind": 1},
        "page_tabs": {"count": 3, "x_start": 0x2F, "y": 0x5B,
                      "x_step": 0x4E},
        "hint_right_a": {"x": 0xCE, "y": 0xC6},
        "hint_right_b": {"x": 0xE1, "y": 0xC6},
        "side_panel_left": {"x": 0x13, "y": 0x62},
        "side_panel_right": {"x": 0x123, "y": 0x62},
        "center_label": {"x": 0x3E, "y": 0x72},
        "disasm": "F0x80083e70 (stplnmet.norm.s); identical anchor set to "
                  "stdgname.s F0x80083478 (docs/research/ui/"
                  "stdgname-decoded-2026-07-11.md 'Static label anchors')",
    },
    # F0x80085ecc: YES/NO confirmation chrome. Owns a CURSOR via
    # F0x8001b364 (the master-plan's decoded cursor-widget constructor) at
    # (0x5A,0xB9), positioned just left of two closely-stacked option labels
    # at (0x6B,0xB9) / (0x6B,0xC7) (14px apart) -- classic vertical YES/NO
    # menu with the cursor gliding between two rows.
    "confirm_screen": {
        "title": {"x": 0x20, "y": 0x1A, "kind": 1, "clut": 4,
                  "string": "confirmation_title", "bank_index": 0x15},
        "name": {"x": 0x61, "y": 0x42, "kind": 1,
                 "note": "typed account name; F0x80086074 skips leading "
                         "0x4081 pads then binds the remainder"},
        "pack_name": {"x": 0x40, "y": 0x60, "kind": 1,
                      "bank_index": "selectedPack + 0xA"},
        "register_question": {"x": 0x5A, "y": 0xA9, "kind": 1,
                              "string": "register_question",
                              "bank_index": 0x16},
        "subtitle": {"x": 0x61, "y": 0x42, "kind": 1,
                     "note": "alias of name — kept so older readers still "
                             "resolve the widget at this xy"},
        "question": {"x": 0x40, "y": 0x60, "kind": 1,
                     "note": "alias of pack_name. The 2026-07-11 ctor pass "
                             "labelled this Register account?; F0x80086074 "
                             "binds selectedPack+0xA (the pack name) here "
                             "and puts string 0x16 on register_question."},
        "option_yes": {"x": 0x6B, "y": 0xB9, "kind": 1, "bank_index": 0x17},
        "option_no": {"x": 0x6B, "y": 0xC7, "kind": 1, "bank_index": 0x18},
        "cursor": {"x": 0x5A, "y": 0xB9, "y_step": 0xE,
                   "disasm": "F0x8001b364(handle, unk58-2, 0x5A, 0xB9); "
                             "F0x80086074 y = unk60*0xE + 0xB9"},
        "extra_label": {"x": 0xE3, "y": 0xA9, "kind": 1,
                         "note": "role unresolved -- candidate: '{1}%' "
                                 "percent-format string (open gap)"},
        "disasm": "F0x80085ecc ctor + F0x80086074 bind",
    },
}

# Screen-lifecycle dispatch table: overlay file offset 0x0 (RAM 0x80082cb0),
# 170 x u32 function-pointer entries -- same shape as stdgname's 135-entry
# table (dominant idle handler + 2 secondary handlers + ~15 once-used
# handlers), reinforcing that stplnmet/stdgname share a common UI-wizard
# code template.
# TRACED 2026-08-05. The text binder F0x80087190 indexes the selected pack's
# member record as `*(s32 *)0x80089B94 + selectedPack * 0xC`, walking three s32
# entries per record. The pointer at 0x80089B94 is a static .word holding
# 0x80089b6c, so the whole table is readable from the overlay: three packs of
# three roster ids, with the fourth record already past the table (its words
# are unrelated pointers), which fixes the pack count at three.
#
# The ids reconcile exactly with the pack membership web/packs.js already
# shipped, independently confirming that data against original code:
#   pack 0 = {0, 6, 7}  Kotemon, Renamon, Patamon
#   pack 1 = {2, 3, 6}  Monmon, Agumon, Renamon
#   pack 2 = {1, 5, 7}  Kumamon, Guilmon, Patamon
STARTER_PACKS = {
    "_provenance": "F0x80087190 member-record walk; table pointer .word at "
                   "0x80089B94 -> 0x80089b6c, stride 0xc, three s32 ids each.",
    "count": 3,
    "record_stride": 12,
    "table_ram": "0x80089b6c",
    "pointer_ram": "0x80089B94",
    "members": [[0, 6, 7], [2, 3, 6], [1, 5, 7]],
    "member_id_meaning": "starter roster id; the screen renders it as name "
                         "string (id + 1) of bank 0x4E and description string "
                         "(id + 0xD) of bank 0x8D.",
    "cross_check": "matches web/packs.js membership exactly (A Kotemon/"
                   "Renamon/Patamon, B Monmon/Agumon/Renamon, C Kumamon/"
                   "Guilmon/Patamon), which implies roster ids 0=Kotemon, "
                   "1=Kumamon, 2=Monmon, 3=Agumon, 5=Guilmon, 6=Renamon, "
                   "7=Patamon. Id 4 appears in no pack.",
}

DISPATCH_TABLE = {
    "file_offset": "0x0", "ram": "0x80082cb0", "entries": 170,
    "entry_size": 4,
    "handler_histogram": {
        "0x80084d68": 92, "0x800845a4": 30, "0x8008576c": 29,
    },
    "disasm": "stplnmet.s L6-L682 (raw .word table at file start)",
}


def main() -> int:
    nameet = load_strings(NAMEET_TOML)
    dgnmet = load_strings(DGNMET_TOML)
    out = {
        "overlay_base": hex(OVERLAY_BASE),
        "identity": {
            "summary": "Registration-wizard screen for the s785 MAGAMI "
                       "Online Center Account Clerk flow: intro -> choose "
                       "starter pack -> choose Digimon -> enter account/"
                       "partner name -> confirm registration.",
            "story_context": "s785 event 014a0001 (esdmg700 entry 1); "
                             "HANDOFF 1280 in docs/specs/"
                             "2026-06-23-opening-flow-engine-port-design.md "
                             "is this screen's exit transition.",
            "not_confused_with": "stdgname.s (separate overlay: the "
                                 "reusable name-entry KEYBOARD widget, also "
                                 "used by the DRI Digimon-Lab rename desk) "
                                 "-- stplnmet duplicates that keyboard's "
                                 "chrome layout internally rather than "
                                 "calling out to stdgname.",
        },
        "pack": PACK,
        "strings": {
            "esnameet": {NAMEET_ROLES.get(i, f"unk_{i}"): s
                         for i, s in enumerate(nameet)},
            "esdgnmet": {DGNMET_ROLES.get(i, f"unk_{i}"): s
                         for i, s in enumerate(dgnmet)},
        },
        "chrome": CHROME,
        "starter_packs": STARTER_PACKS,
        "dispatch_table": DISPATCH_TABLE,
        "open_gaps": [
            "RESOLVED 2026-08-05 -- per-row/per-cell text binding is now "
            "traced to F0x80087190 and recorded in chrome.text_binding: "
            "title = bank 0x8D string 6, the three pack rows = strings 7/8/9, "
            "the two list headers = selectedPack + 0xA and + 0x1A, and each "
            "Digimon row takes its name from bank 0x4E at (memberId + 1) and "
            "its description from bank 0x8D at (memberId + 0xD). The member "
            "ids come from the table at 0x80089b6c (see starter_packs).",
            "The main per-frame update/cursor-navigation functions for "
            "each sub-screen (pack pick, digimon pick, confirm Yes/No) "
            "were not hand-traced beyond their draw-ctx constructors -- "
            "unlike stdgname's still-open F0x80083994, no single ~570-"
            "instruction function was identified as the hub; the 170-entry "
            "dispatch table's ~15 once-used handlers are the likely state-"
            "transition points but were not individually read.",
            "7 of 62 split functions failed m2c decompilation (grep "
            "'Decompilation failure' in exe-decomp/stplnmet_c/*.c): "
            "F0x80084d10, F0x800890b8, F0x80084db0, F0x80089b6c, "
            "F0x800886d4, F0x8008438c, F0x80089a8c. NOTE 2026-08-05: at least "
            "one of these is not a function at all -- 0x80089b6c is the "
            "starter-pack member TABLE (see starter_packs), so m2c carved a "
            "phantom function out of data. The remaining six should be "
            "re-checked for the same before anyone spends effort on them.",
            "NAMEDTTM's real RLEN texture atlas source/addressing was not "
            "independently re-verified this session (same open-format risk "
            "flagged for stdgname's NAMEDTCS/TM sibling packs STDGNMCS/TM); "
            "no native sprite pixel art is shipped for this screen.",
            "RESOLVED 2026-08-05 -- the shared pad service is decoded (ledger "
            "UI-PADSERVICE-STATIC-TABLE-001): every menu reads buttons through "
            "the same device at 0x8004b7d0, with +0x3F4/+0x3FC returning a "
            "port's button words and +0x408 mapping a logical id to its bit. "
            "The logical ids are the standard PS1 pad bit positions, so 4 is "
            "up, 6 is down, 13 is confirm (O) and 14 is cancel (X) -- the same "
            "set shop_ui.json and stagslct_ui.json record.",
            "The exact resident boot-chain call that transitions from the "
            "s785 event's HANDOFF 1280 into loading STPLNMET.PRO was not "
            "traced (would require the overlay-chain dispatcher in "
            "exe/fns.s, out of scope for this overlay's own internals).",
        ],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(f"wrote {OUT} ({len(json.dumps(out))} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
