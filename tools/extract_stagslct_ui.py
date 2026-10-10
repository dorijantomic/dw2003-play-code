#!/usr/bin/env python3
"""
Extract and decode the STAGSLCT developer stage-select overlay in full.

Decode source: ~/ddw3/asm/dw2003/pro/stagslct.s (RAM base 0x80082cb0, file
0x44fc bytes). The overlay is 100% byte-accounted -- see BYTE_MAP below.

`stagslct` is the developers' own debug launcher, left on the retail disc.
Its record table is an authored index of every screen, shop, gym and
sub-system in the game, written in the developers' own words.

Record layout, taken from the build routine's own use of it (F0x80084d9c,
file 0x21cc-0x232c): {char *label_left, char *label_right, s32 type,
s32 value}, a FIXED 0x10-byte stride, list terminated by the record whose
`type` is -1 (file 0x44cc). 297 rows. `label_left` is the target's overlay
filename, `label_right` is its Japanese name.

WHAT `type` AND `value` ACTUALLY ARE (corrects the 2026-07-11 reading):
the launch state (state0 == 3, file 0x312c-0x31c4) does

    lw   $a1, 0xc($v1)            # a1 = row.value
    andi $v0, $a1, 0x8000
    beqz $v0, <plain>
    lw   $a0, 8($v1)             # a0 = row.type
    ...  [0x8004b440]($a0, $a1)  # resident screen launcher

so `type` is the LAUNCH CODE passed to the resident screen launcher at
D0x8004b440 and `value` is its second argument. It is NOT a screen id and
it is NOT written to the master story ordinal. Independent confirmation
from another overlay: soundtst's F0x80084370 does
`*(...)0x8004B440(0x1500, 0);` -- 0x1500 is exactly the launch code of this
overlay's own `ＳＴＳＬＣＴ / ステージセレクト` row, i.e. the Sound Test
returns to the Stage Select through the same launcher.

Only when row.value has bit 15 set does the launcher additionally force the
master story ordinal [0x8004b370] = (u8)row.value. NO SHIPPED ROW SETS THAT
BIT, so that path is dead in the retail table. The Circle-press branch
comparing type against 0x300 (file 0x28fc) is likewise dead: no shipped row
has type 0x300.

Output: web/assets/data/stagslct_ui.json  (runtime + research payload)
        data/stagslct_catalog.json        (queryable developer screen index)
"""
import os

import json
import re
import struct
from pathlib import Path

ROOT = Path(__file__).parent.parent
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
STAGSLCT_S = DDW3 / "asm/dw2003/pro/stagslct.s"
SCREEN_TABLE = ROOT / "web/assets/data/screen_table.json"
STAGE_NAMES = ROOT / "data/stage_names.json"
OUT = ROOT / "web/assets/data/stagslct_ui.json"
CATALOG_OUT = ROOT / "data/stagslct_catalog.json"

TABLE_RAM_BASE = 0x80085EEC  # disasm: stagslct.s L2834-2838 (lui 0x8008; addiu 0x5eec)
LANG_TABLE_RAM_BASE = 0x80085ED0  # file 0x3220, seven pointers, read at file 0x297c
SCREEN_MIN, SCREEN_MAX = 0x200, 0x2EE  # data/screen_table.json SCREEN_MIN/SCREEN_MAX

WORD_RE = re.compile(r"\.word 0x([0-9a-fA-F]{8})")

# ---------------------------------------------------------------------------
# Complete byte account of the 0x44fc-byte overlay. Every region below is
# reached from the code, and nothing is left over. Offsets are file offsets;
# RAM = 0x80082cb0 + offset.
# ---------------------------------------------------------------------------

BYTE_MAP = [
    {"start": "0x0000", "end": "0x1cf4", "what": "row label strings",
     "detail": "NUL-terminated Shift-JIS, pointed at by table words +0 and +4"},
    {"start": "0x1cf4", "end": "0x1d1c", "what": "screen's own strings",
     "detail": "0x1cf4 title ステージセレクト, 0x1d08 ＳＴＳＬＣＴ, 0x1d18 cursor ＞"},
    {"start": "0x1d1c", "end": "0x3220", "what": "code",
     "detail": "nine functions, see FUNCTIONS"},
    {"start": "0x3220", "end": "0x323c", "what": "language name pointer table",
     "detail": "seven char* entries, indexed by the language global D0x8005cca8"},
    {"start": "0x323c", "end": "0x44cc", "what": "menu record table",
     "detail": "297 records x 0x10 bytes {char *left, char *right, s32 type, s32 value}"},
    {"start": "0x44cc", "end": "0x44dc", "what": "table terminator record",
     "detail": "type = -1 stops both the row counter and the launch walk"},
    {"start": "0x44dc", "end": "0x44e4", "what": "UI service descriptor",
     "detail": "{0x00000000, 0x00f00140}, argument 1 of shared UI service slot "
               "+0x16c at file 0x2190; soundtst passes the identical pair from "
               "its own file 0x2d90, so this is shared, not per-overlay scratch "
               "(ledger UI-SERVICE-DESCRIPTOR-16C-001)"},
    {"start": "0x44e4", "end": "0x44fc", "what": "BIOS date string buffer",
     "detail": "ten fullwidth chars written by F0x80084b70, NUL halfword at 0x44f8"},
]

# ---------------------------------------------------------------------------
# The nine functions, decoded 2026-08-05 from original assembly. m2c produced
# usable C for only eight of them and carved 256 spurious 'functions' out of
# the record table; the decode below is read from the assembly directly.
# ---------------------------------------------------------------------------

FUNCTIONS = [
    {"addr": "0x800849cc", "file": "0x1d1c", "name": "screenTaskHandler",
     "role": "Per-frame handler of the outer screen task. While base state0 is "
             "1..3 it does nothing; otherwise it creates the menu task via "
             "F0x80085ea4, publishes the returned pointer through its second "
             "argument, and advances state0 through base slot +0x38."},
    {"addr": "0x80084a30", "file": "0x1d80", "name": "registerScreenTask",
     "role": "F0x80014504(F0x800849cc, 0x50, 4) -- registers the outer screen "
             "task with handler F0x800849cc at priority 4."},
    {"addr": "0x80084a5c", "file": "0x1dac", "name": "moveCursorSkippingRules",
     "role": "Moves the selection by a1 rows and RE-MOVES in the same direction "
             "while it lands on a record whose type is 0, so the horizontal "
             "rules and section headings can never be selected. Clamps the "
             "in-window row (+0x50) to 0..rowsVisible-1 and the scroll (+0x54) "
             "to 0..rowCount-rowsVisible, and if it runs into either end while "
             "still on an unselectable row it restores the entry position."},
    {"addr": "0x80084b2c", "file": "0x1e7c", "name": "scrollBy",
     "role": "Adds a1 to the scroll offset (+0x54) and clamps it to "
             "0..rowCount-rowsVisible. Does not skip unselectable rows."},
    {"addr": "0x80084b70", "file": "0x1ec0", "name": "showConsoleBiosDate",
     "role": "Reads ten bytes from PS1 BOOT ROM address 0x1fc0012c, converts "
             "each to its fullwidth Shift-JIS equivalent (digits and A-Z via "
             "byte-0x7de1, '-' to 0x815c, anything else to the ideographic "
             "space 0x8140), byte-swaps each pair into the buffer at 0x80087194 "
             "and shows it at (220, 20). Built once, guarded by +0x60."},
    {"addr": "0x80084c94", "file": "0x1fe4", "name": "zoomToggle",
     "role": "Ramps a 0..0x1000 level by +/-0x111 per frame and feeds it to "
             "class-A slot +0x154 (which also sets the 0x1000 unity field), "
             "with slot +0x158 pinned to (0x37, 0x28). The direction flips each "
             "time pad-1 button 0 is newly pressed."},
    {"addr": "0x80084d9c", "file": "0x20ec", "name": "menuTaskHandler",
     "role": "The whole screen: 1089 instructions over a four-state machine. "
             "See STATE_MACHINE."},
    {"addr": "0x80085ea4", "file": "0x31f4", "name": "registerMenuTask",
     "role": "F0x80014504(F0x80084d9c, 0, 0) -- registers the menu task."},
]

# ---------------------------------------------------------------------------
# Base-object state machine of F0x80084d9c, dispatched on state0 (self+0xc)
# and then state1 (self+0x10). Both fields are the shared task object's
# (ledger UI-TASKOBJ-STATEMACHINE-001).
# ---------------------------------------------------------------------------

STATE_MACHINE = {
    "dispatch": "state0 at self+0xc, file 0x211c-0x2148",
    "states": [
        {"state0": 0, "file": "0x214c-0x2420", "name": "build",
         "does": "Initialises the shared UI service (D0x8004de10 slots +0x150, "
                 "+0x154 with 0x5000, +0x174 with 320x240), counts the records "
                 "up to the terminator into rowCount (+0x5c), clamps "
                 "rowsVisible (+0x58) to at most 14, restores the saved scroll "
                 "and row from D0x80048d5c/D0x80048d60, then constructs every "
                 "text widget and advances state0."},
        {"state0": 1, "state1": 0, "file": "0x2444-0x2488", "name": "installChrome",
         "does": "Sets the title widget's text to ステージセレクト and the cursor "
                 "widget's text to ＞, then advances state1."},
        {"state0": 1, "state1": 1, "file": "0x248c-0x3128", "name": "run",
         "does": "Input, live editors and per-frame readouts. See INPUT."},
        {"state0": 2, "file": "0x2130-0x2138", "name": "idle",
         "does": "Falls straight through to the function epilogue."},
        {"state0": 3, "file": "0x312c-0x31c4", "name": "launch",
         "does": "Reads the selected record, calls the resident screen launcher "
                 "D0x8004b440(row.type, row.value), and saves the scroll and row "
                 "back to D0x80048d5c/D0x80048d60 so the menu reopens where it "
                 "was left. When row.value has bit 15 set it instead passes 0 as "
                 "the second argument and forces the master story ordinal "
                 "[0x8004b370] = (u8)row.value -- no shipped row does this."},
    ],
}

# ---------------------------------------------------------------------------
# Everything the screen reads from the two controllers. Button numbers are
# standard PS1 pad bit positions; the pad service is the resident shared block
# D0x8004b7d0 with slot +0x3f4 = held mask, +0x3f8 and +0x3fc = the two edge
# masks, +0x408 = (pad, button) -> bit shift.
# ---------------------------------------------------------------------------

INPUT = {
    "pad_service": "D0x8004b7d0",
    "held_fn": "+0x3F4", "edge_fn_a": "+0x3F8", "edge_fn_b": "+0x3FC",
    "bit_fn": "+0x408",
    "pad1": [
        {"button": "Up", "bit": 4, "file": "0x2498-0x250c",
         "does": "move the selection up one selectable row"},
        {"button": "Down", "bit": 6, "file": "0x2518-0x258c",
         "does": "move the selection down one selectable row"},
        {"button": "L1", "bit": 10, "file": "0x2598-0x2768",
         "does": "scroll the list up by one 14-row page"},
        {"button": "R1", "bit": 11, "file": "0x2598-0x2768",
         "does": "scroll the list down by one 14-row page"},
        {"button": "Select", "bit": 0, "file": "0x2834-0x2898",
         "does": "toggle the flag at D0x80042b1c+0 and redraw it at (16, 220)"},
        {"button": "Circle", "bit": 13, "file": "0x289c-0x2920",
         "does": "launch the selected row by advancing state0 to 3; a row whose "
                 "type is 0 is ignored, and a row whose type is 0x300 would "
                 "instead write row.value to the master story ordinal without "
                 "leaving the screen -- no shipped row has that type"},
        {"button": "Start", "bit": 3, "file": "0x2924-0x2970",
         "does": "advance the language index D0x8005cca8 (wrapping 0..6) and "
                 "call the resident language-apply routine D0x80048a7c"},
        {"button": "L2", "bit": 8, "file": "0x2a10-0x2a74",
         "does": "increment the master story ordinal [0x8004b370]"},
        {"button": "R2", "bit": 9, "file": "0x29a4-0x2a0c",
         "does": "decrement the master story ordinal [0x8004b370]"},
    ],
    "pad2": [
        {"button": "L1 / R1", "bit": "10 / 11", "file": "0x2aa4-0x2c90",
         "does": "add -10, -1, +1 or +10 to field +0x1c of all three party "
                 "records, clamped to 1..99"},
        {"button": "L2 / R2", "bit": "8 / 9", "file": "0x2c94-0x2e7c",
         "does": "add -10, -1, +1 or +10 to field +0x32 of all three party "
                 "records, clamped to 0..999"},
        {"button": "Up / Down", "bit": "4 / 6", "file": "0x2f84-0x2ff8",
         "does": "step D0x80042b20 through -1..3; -1 hides its readout"},
        {"button": "Right / Left", "bit": "5 / 7", "file": "0x2ffc-0x3064",
         "does": "step D0x80042b24 through -1..7; -1 hides its readout"},
    ],
    "note": "Party records come from D0x8004b44c(slot) then D0x8004b484(); the "
            "loop runs slots 0..2 and the readouts show slot 0 only. "
            "D0x80042b1c is the same block fieldstg's F0x8008b798 fills before "
            "an encounter, so these three words are encounter setup, not "
            "menu-local state.",
}

# ---------------------------------------------------------------------------
# The seven language names at 0x80085ed0, cycled by Start. Index 6 points at
# the overlay's very first string. These are the game's seven language builds.
# ---------------------------------------------------------------------------

LANGUAGE_GLOBAL = "D0x8005cca8"

# ---------------------------------------------------------------------------
# Screen identity and chrome, hand-transcribed 2026-08-05 from the overlay's
# own build routine F0x80084d9c (file offset 0x20ec), reachable because the
# shared widget class it drives is now decoded (ledger UI-WIDGETCLASS-AE38-*).
#
# The build routine creates every widget with the class-A text-widget
# constructor F0x8001ae38(0x1000, 1, x, y) -- ctor args 3 and 4 are the screen
# position, confirmed independently by UI-WIDGETCLASS-AE38-CONSUMER-001 (slot
# +0x134 SET POSITION is called with the same pair). Row text is installed with
# slot +0x110 (set line 0 from a caller-supplied string).
#
# Two literal Shift-JIS strings in the overlay settle what this screen IS: the
# header at 0x800849a4 reads the katakana for "Stage Select" and the row cursor
# at 0x800849c8 reads the overlay's own filename in fullwidth letters.
# Untranslated Japanese and a filename label in a PAL release, with no language
# file, no screen-pack load anywhere in stagslct.s, and no trigger site, make
# this a DEVELOPER stage-warp tool, not a player-facing menu.
# ---------------------------------------------------------------------------

IDENTITY = {
    "kind": "developer",
    "header_text_sjis": "ステージセレクト",
    "header_text_en": "Stage Select",
    "cursor_glyph": "＞",
    "self_row_label": "ＳＴＳＬＣＴ",
    "evidence": (
        "stagslct.s literal strings at file 0x1cf4 (0x800849a4, the title) and "
        "0x1d18 (0x800849c8, the single-character row cursor), installed on "
        "the title and cursor widgets by the state0==1 "
        "branch at file 0x2444-0x2470 via class-A slot +0x110. Untranslated "
        "Shift-JIS in the PAL build (SLES03936); no lang_file/dw2003/eng TOML "
        "exists for this overlay; the five `lui $a0` constants in the whole "
        "overlay are 0x8008/0x8006 code and data pointers, not pack handles, "
        "so no screen art is ever loaded."
    ),
    "player_facing": False,
    "note": (
        "Because the original screen draws plain text on no background, the "
        "walker's plain-panel rendering is already faithful; what was missing "
        "was the exact text positions, which are now traced below. This is NOT "
        "a claim that the player can reach this screen -- the trigger remains "
        "unfound and is most likely absent from the retail build."
    ),
}

CHROME = {
    "_provenance": (
        "hand-transcribed from stagslct.s build routine F0x80084d9c, file "
        "offsets 0x20ec-0x2420; every value is a literal ctor argument or an "
        "immediate in that routine (original assembly, authority 2)."
    ),
    "widget_ctor": "F0x8001ae38(0x1000, 1, x, y) -- class-A text widget",
    "header": {
        "title": {"x": 16, "y": 32, "text": "header_text_sjis",
                  "disasm": "file 0x2234 a2=0x10 a3=0x20"},
        "extra": [
            {"x": 144, "y": 32, "disasm": "file 0x2350 a2=0x90 a3=0x20"},
            {"x": 192, "y": 32, "disasm": "file 0x2364 a2=0xc0 a3=0x20"},
        ],
    },
    "cursor": {
        "x": 14,
        "y_base": 45,
        "row_pitch": 12,
        "formula": "y = selection * 12 + 45",
        "disasm": (
            "file 0x225c-0x2284: a1=0xe, a2=((sel*3)<<2)+0x2d sign-extended, "
            "passed to class-A slot +0x134 (set position)"
        ),
    },
    "list": {
        "rows_visible": 14,
        "row_pitch": 12,
        "y_base": 45,
        "col_left_x": 24,
        "col_right_x": 152,
        "disasm": (
            "loop at file 0x2298-0x2344: left widget a2=0x18, right widget "
            "a2=0x98, shared y from s4 starting 0x2d0000>>16=45 and incremented "
            "by 0xc0000>>16=12 per row; row count capped at 0xe at file 0x21f4."
        ),
        "text_binding": (
            "row i shows record[scroll + i] of the table at 0x80085eec: the "
            "word at record+0x0 goes to the left column and the word at "
            "record+0x4 to the right column, both through class-A slot +0x110 "
            "(file 0x22dc-0x232c)."
        ),
    },
    "footer": {
        "y": 220,
        "slots_x": [16, 48, 80, 208, 256],
        "counter": {
            "x": 16,
            "source": "0x80042b1c",
            "disasm": (
                "file 0x23c8-0x23d8: the widget at (16,220) is filled with an "
                "INTEGER via class-A slot +0x118 from the word at 0x80042b1c"
            ),
        },
        "disasm": "file 0x234c-0x2408, all with a3=0xdc",
    },
    "persisted_state": {
        "scroll_global": "0x80048d5c",
        "selection_global": "0x80048d60",
        "note": (
            "read into the task object at +0x54 and +0x50 on build (file "
            "0x2214-0x2238), so the cursor position survives leaving and "
            "re-entering the screen."
        ),
    },
    "row_count_scan": (
        "walk the table at 0x80085eec in 0x10-byte steps until the word at "
        "record+0x8 equals -1 (file 0x21cc-0x21f0); the resulting count is "
        "clamped to 14 and stored at task+0x58."
    ),
    "input": {
        "device": "0x8004b7d0",
        "held_fn": "+0x3F4",
        "repeat_fn": "+0x3FC",
        "bit_fn": "+0x408",
        "buttons": {"up": 4, "down": 6, "confirm": 13, "cancel": 14},
        "note": (
            "same shared pad service and same logical button ids the shop uses "
            "(shop_ui.json input block); ids are the standard PS1 pad bit "
            "positions, so confirm is O and cancel is X."
        ),
    },
}


def load_words():
    """All raw .word literals in the overlay, in file order (RAM-contiguous
    starting at OVERLAY_BASE 0x80082cb0 -- the table's own RAM address lets
    us slice directly by matching TABLE_RAM_BASE below)."""
    # Most data words are plain hex literals, but the splat renders a word that
    # happens to equal a known symbol address in symbolic form instead
    # (`.word D0x80084410`). Both carry the same value, and dropping the
    # symbolic ones silently punches holes in the table -- which truncated the
    # menu walk at row 69 before this was handled.
    words = []
    pattern = re.compile(
        r"\.L0x([0-9a-fA-F]+):\s*\.word (?:0x|[DF]0x)([0-9a-fA-F]{8})")
    for line in STAGSLCT_S.read_text().splitlines():
        m = pattern.match(line)
        if m:
            words.append((int(m.group(1), 16), int(m.group(2), 16)))
    return words


OVERLAY_BASE = 0x80082CB0


def read_sjis(word_map, ram, limit=64):
    """Decode a NUL-terminated Shift-JIS string living inside the overlay.

    The row labels are ordinary C strings pointed at by the first two words of
    each table record; the overlay stores them as .word literals like all its
    other data, so they are read straight out of the same word map.
    """
    if not (OVERLAY_BASE <= ram < OVERLAY_BASE + 0x20000):
        return None
    off = ram - OVERLAY_BASE
    out = bytearray()
    while len(out) < limit:
        w = word_map.get(off)
        if w is None:
            return None
        chunk = struct.pack("<I", w)
        if 0 in chunk:
            out += chunk[: chunk.index(0)]
            break
        out += chunk
        off += 4
    try:
        return out.decode("shift_jis")
    except UnicodeDecodeError:
        return None


def read_menu_rows(word_map):
    """Walk the record table at 0x80085eec and decode the developer menu.

    Record layout, from the build routine's own use of it (F0x80084d9c, file
    0x21cc-0x232c): {char *label_left, char *label_right, s32 type, s32 value},
    0x10 bytes, and the list ends at the record whose `type` is -1. The left
    label is the target overlay's filename and the right label is its Japanese
    name; rows whose type is 0 are horizontal-rule separators or section
    headings rather than launchable entries.
    """
    rows = []
    i = 0
    while True:
        base = TABLE_RAM_BASE - OVERLAY_BASE + i * 0x10
        rec = [word_map.get(base + k * 4) for k in range(4)]
        if any(r is None for r in rec):
            break
        raw_type = rec[2]
        signed_type = raw_type - (1 << 32) if raw_type >= 0x80000000 else raw_type
        if signed_type == -1:
            break
        left = read_sjis(word_map, rec[0])
        right = read_sjis(word_map, rec[1])
        rule = left is not None and set(left) == {"―"}
        heading = (
            not rule
            and signed_type == 0
            and left is not None
            and left.startswith("―")
        )
        rows.append({
            "index": i,
            "type": f"0x{raw_type:x}",
            "value": rec[3],
            "overlay_label": left,
            "name_jp": right,
            "kind": ("separator" if rule
                     else "heading" if heading
                     else "entry" if signed_type != 0
                     else "blank"),
        })
        i += 1
    return rows


def read_language_table(word_map):
    """The seven language names cycled by Start (file 0x3220, read at 0x297c)."""
    names = []
    for i in range(7):
        off = LANG_TABLE_RAM_BASE - OVERLAY_BASE + i * 4
        ptr = word_map.get(off)
        names.append({
            "index": i,
            "ptr": f"0x{ptr:08x}",
            "name": read_sjis(word_map, ptr),
        })
    return names


def main():
    words = load_words()
    word_map = dict(words)
    menu_rows = read_menu_rows(word_map)
    languages = read_language_table(word_map)

    screen_table = json.loads(SCREEN_TABLE.read_text()) if SCREEN_TABLE.exists() else {}
    stage_names = json.loads(STAGE_NAMES.read_text()) if STAGE_NAMES.exists() else {}

    # Launch codes come straight off the decoded records now -- no word-pattern
    # scan. A code inside the FIELDSTG screen-id window also names a stage, so
    # those rows additionally carry the stage number and its display name.
    records = []
    for row in menu_rows:
        if row["kind"] not in ("entry",):
            continue
        code = int(row["type"], 16)
        rec = {
            "ram": f"0x{TABLE_RAM_BASE + row['index'] * 0x10:08x}",
            "index": row["index"],
            "type": row["type"],
            "val": row["value"],
            "overlay_label": row["overlay_label"],
            "name_jp": row["name_jp"],
            "kind": "screen" if SCREEN_MIN <= code <= SCREEN_MAX else "category",
        }
        entry = screen_table.get(str(code))
        if entry:
            rec["stage"] = entry["stage"]
            name = stage_names.get(f"s{entry['stage']}")
            if name:
                rec["name"] = name
        records.append(rec)

    # A launch code is not unique on its own -- the sub-indexed groups (0xf00
    # shops, 0xa00 gyms) repeat one code and vary only the second argument, so
    # the identifying key is the (code, value) pair the launcher is called with.
    keys = [(r["type"], r["val"]) for r in records]
    assert len(keys) == len(set(keys)), "duplicate (launch code, value) pair"
    screen_codes = [r["type"] for r in records if r["kind"] == "screen"]
    assert len(screen_codes) == len(set(screen_codes)), "duplicate screen id"

    categories = [r for r in records if r["kind"] == "category"]
    destinations = [r for r in records if r["kind"] == "screen"]

    out = {
        "provenance": {
            "source": "~/ddw3/asm/dw2003/pro/stagslct.s",
            "overlay_base": "0x80082cb0",
            "table_ram_base": f"0x{TABLE_RAM_BASE:08x}",
            "record": "{char *label_left, char *label_right, s32 type, s32 value}"
                      " at a fixed 0x10 stride, terminated by type == -1",
            "launch": "state0 == 3, file 0x312c-0x31c4: D0x8004b440(row.type, row.value)",
            "note": "Decoded 2026-08-05 from original assembly. m2c cannot "
                    "decompile this overlay (256/256 spurious 'functions' carved "
                    "out of the record table, exe-decomp/stagslct_c/_failures.txt), "
                    "so both the records and the code are read from the assembly. "
                    "Row count and every label are structural, not heuristic.",
        },
        "identity": IDENTITY,
        "chrome": CHROME,
        "byteMap": BYTE_MAP,
        "functions": FUNCTIONS,
        "stateMachine": STATE_MACHINE,
        "input": INPUT,
        "languageGlobal": LANGUAGE_GLOBAL,
        "languages": languages,
        "menuRowCount": len(menu_rows),
        "menuRows": menu_rows,
        "categories": categories,
        "destinationCount": len(destinations),
        "destinations": destinations,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1))

    # The catalog is the durable, queryable half: one row per launchable entry,
    # keyed by the launch code the resident launcher actually takes.
    catalog = {
        "_provenance": out["provenance"],
        "_schema": {
            "code": "launch code, argument 1 of D0x8004b440",
            "value": "argument 2 of D0x8004b440",
            "overlay": "developers' filename label (table word +0)",
            "name_jp": "developers' Japanese name (table word +4)",
            "section": "nearest preceding section heading row",
            "stage": "FIELDSTG stage number, when the code is a screen id",
            "stage_name": "display name from data/stage_names.json",
        },
        "entries": [],
    }
    section = None
    by_index = {r["index"]: r for r in records}
    for row in menu_rows:
        if row["kind"] == "heading":
            # The heading text is the LEFT label; the right label of a heading
            # row is a single ideographic space.
            section = (row["overlay_label"] or "").strip("―ー-　") or None
            continue
        rec = by_index.get(row["index"])
        if rec is None:
            continue
        entry = {
            "code": rec["type"],
            "value": rec["val"],
            "overlay": rec["overlay_label"],
            "name_jp": rec["name_jp"],
            "section": section,
            "menu_index": rec["index"],
        }
        if "stage" in rec:
            entry["stage"] = rec["stage"]
        if "name" in rec:
            entry["stage_name"] = rec["name"]
        catalog["entries"].append(entry)
    CATALOG_OUT.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_OUT.write_text(json.dumps(catalog, indent=1, ensure_ascii=False) + "\n")

    print(f"wrote {OUT}: {len(menu_rows)} rows, {len(categories)} category entries, "
          f"{len(destinations)} screen entries "
          f"({sum(1 for d in destinations if 'stage' in d)} resolved to a stage, "
          f"{sum(1 for d in destinations if 'name' in d)} to a display name), "
          f"{sum(1 for l in languages if l['name'])} languages")
    print(f"wrote {CATALOG_OUT}: {len(catalog['entries'])} catalog entries")


if __name__ == "__main__":
    main()
