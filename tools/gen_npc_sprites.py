"""
Build stage: extract the GLOBAL npc_id -> sprite mapping the game actually uses.

The field engine resolves an NPC/cutscene actor's sprite with a flat table
lookup, NOT `p{id}`:

    sprite(npc_id) = lba_name( TABLE[npc_id] >> 16 )            # low 16 = palette/param

`TABLE` is static `.data` baked into the FIELDSTG overlay at RAM 0x80099e00
(file offset 0x17150). The resolver is FIELDSTG 0x800920dc (scene_struct+0x74):

    addiu v0, -0x6200      ; v0 = 0x80099e00
    sll   a0, 2            ; a0 = npc_id * 4
    addu  a0, v0
    lw    v0, (a0)         ; return TABLE[npc_id]   (= LBA<<16 | param)

The table is GLOBAL (verified byte-identical across stages s780 vs s200 in
RAM dumps) -- npc_id is a global character id. Each entry's high 16 bits are
the disc LBA index; lba.rs maps that to a sprite file name.

This was the root cause of wrong cutscene/NPC sprites: `p{npc_id}` only
coincidentally matches for npc_id 1..11, then diverges (12->p013taku not
p012mint; 16->p065jksi not the digimon p016rdmd).

Committed source (no RAM dump in the build):
  ~/ddw3/rust/dw2003_pro_fieldstg/src/data.rs   (the .data words, w/ file-offset comments)
  ~/ddw3/rust/dw2003_exe_data/src/lba.rs        (LBA index -> file name)

Output: web/assets/npc_sprites.json  =  { "<npc_id>": "p013taku", ... }
"""

import os
import json
import re
from pathlib import Path

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
FIELDSTG_DATA = DDW3 / "rust/dw2003_pro_fieldstg/src/data.rs"
LBA_RS = DDW3 / "rust/dw2003_exe_data/src/lba.rs"
OUT = Path(__file__).resolve().parent.parent / "web/assets/npc_sprites.json"

# FIELDSTG file offset of TABLE[0] (RAM 0x80099e00 - overlay base 0x80082cb0).
TABLE_OFF = 0x17150
# The resolver (scene+0x74) does a bare `TABLE[npc_id]` with NO upper bound, so the
# table's real length is whatever the contiguous .data array is -- it is NOT 256.
# Event/cutscene puppets index well past 255 (the Blue-Card "Trickster Guilmon"
# reveal NPCs are npc 296/369). We decode every entry up to a hard ceiling and stop
# at the first word that is clearly not a sprite handle (the next .data structure);
# see _table_end below. The old `MAX_NPC_ID = 256` truncation made high-nid actors
# resolve to nothing, so they were wrongly rendered as invisible.
SCAN_CEILING = 0x1000
# The 4 words immediately before TABLE[0] are scene_struct's method pointers
# (+0x70..+0x7c). We assert them so a decomp reshuffle is caught, not silently
# decoded wrong.  scene+0x74 == 0x800920dc is the resolver itself.
ANCHOR = {
    0x17140: 0x80092110,  # scene+0x70
    0x17144: 0x800920dc,  # scene+0x74  (the resolver)
    0x17148: 0x800920f8,  # scene+0x78
    0x1714C: 0x800921e4,  # scene+0x7c
}


def _data_words():
    """Parse FIELDSTG data.rs into {file_offset: u32} using its `// 0xOFF` comments."""
    words = {}
    pat = re.compile(r"0x([0-9a-fA-F]{8})\s*,\s*//\s*0x([0-9a-fA-F]+)")
    for line in FIELDSTG_DATA.read_text().splitlines():
        m = pat.search(line)
        if m:
            words[int(m.group(2), 16)] = int(m.group(1), 16)
    return words


def _lba_names():
    """LBA index -> file name (lowercased to match walker sprite folders)."""
    names = {}
    pat = re.compile(r"pub const LBA_(\w+?)_BIN_IDX: usize = (\d+);")
    for line in LBA_RS.read_text().splitlines():
        m = pat.search(line)
        if m:
            names[int(m.group(2))] = m.group(1).lower()
    return names


def build_table():
    words = _data_words()
    for off, expect in ANCHOR.items():
        got = words.get(off)
        if got != expect:
            raise SystemExit(
                f"npc-sprite table anchor failed at file 0x{off:x}: "
                f"expected 0x{expect:08x}, got {got and hex(got)}. "
                "FIELDSTG .data layout changed -- re-locate TABLE_OFF via the "
                "resolver (scene+0x74) before trusting this stage."
            )
    names = _lba_names()
    end = _table_end(words, names)
    table = {}
    for nid in range(end):
        handle = words.get(TABLE_OFF + nid * 4, 0)
        if handle == 0:
            continue
        lba = handle >> 16
        name = names.get(lba)
        if name:
            table[str(nid)] = name
    return table


def _table_end(words, names):
    """First npc_id past the end of the sprite TABLE.

    A valid entry is either 0 (an in-range invisible marker -- npc 63/112/...) or a
    handle whose high 16 bits resolve to a known LBA sprite name. The array ends at
    the first word that is neither: the following .data structure is non-handle data
    (e.g. 0x20202020). This finds the real length (npc_id 0..405) without hardcoding it.
    """
    for nid in range(SCAN_CEILING):
        handle = words.get(TABLE_OFF + nid * 4)
        if handle is None:
            return nid
        if handle != 0 and (handle >> 16) not in names:
            return nid
    return SCAN_CEILING


def main():
    table = build_table()
    OUT.write_text(json.dumps(table, indent=0, sort_keys=True))
    print(f"wrote {OUT} ({len(table)} npc_id -> sprite entries)")


if __name__ == "__main__":
    main()
