#!/usr/bin/env python3
"""Decode SFSTDATA (fight resource 0x1cb = 459) -> the special-attack MEFT-pack binding table.

SFSTDATA is the global "standard fight data" overlay (~/ddw3/asm/dw2003/pro/sfstdata.s).
It is a flat array of 57 records x 0x58 bytes (22 words). The fight engine indexes it by
*effect/motion id* to find which MEFT10xx effect pack to load and how to play it:

  fightstg F0x80086304 (motion rebuild): base = [0x80044f4c](0x1cb); rec = base + id*0x58;
  passes rec[+0x00] and rec[+0x04] to the playback builder, rec[+0x08] = sound.
  fightstg F0x8008b06c (record accessor): returns base + id*0x58 + 0x18.

The two leading words of every record are MEFT resource pointers:
    +0x00 = (fileId << 16) | binA      (the effect PROGRAM / mesh bin)
    +0x04 = (fileId << 16) | binB      (the CLUT / 2nd bin)
where fileId is an LBA index (lbas.toml). Record index i maps 1:1 to MEFT10<i>:
  record 1 -> MEFT1001 ... record 55 -> MEFT1055, with two aliases:
    record 0  = alias of record 1  (MEFT1001; index 0 = default/no-effect)
    record 56 = duplicate of record 34 (MEFT1034)

KEY RESULT: record 55 = MEFT1055 = the generic special-attack DATA-FIELD backdrop. No tech's
effect/sigEffect/motion field references 55, so the backdrop is loaded by fixed engine logic
(a hardcoded constant), NOT selected per-tech or per-Digimon. Per-tech effect packs ARE
selected via the tech's motion id (e.g. Diamond Storm motion 44 -> SFSTDATA[44] = MEFT1044).

Falsifies the "each Digimon model brings its own MEFT10xx pack" hypothesis: SFSTDATA is one
global table shared by all 245 models, indexed by effect/motion id, not by model id.
"""
import os
import json
import re
import sys
from pathlib import Path

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
SFSTDATA_S = DDW3 / "asm/dw2003/pro/sfstdata.s"
FIGHTSTG_S = DDW3 / "asm/dw2003/pro/fightstg.s"
LBAS_TOML = DDW3 / "iso/dw2003-bootstrap/lbas.toml"
REC_WORDS = 22  # 0x58 bytes

# The record's +0x08 field is an index into a packed-sound table that lives in
# fightstg, not in SFSTDATA:
#   F0x80086304  0x80086434  lui $v1, 0x800a / addiu $v1, 0x2498
#                0x8008643c  sll $v0, $a0, 0x2 / addu $v0, $v1 / lw $a0, ($v0)
#                0x80086454  jalr [0x80055c48]       (play)
#                0x8008645c  sh $v0, 0xe4($s1)       (keep the voice handle)
# and the teardown case re-derives the same word and calls [0x80055c50](id,
# handle) at 0x8008689c to stop it. Eight words are used -- the eight values
# the shipped records reference are 0..7 -- and they are the Sound Test's
# BT_LOOP0..BT_LOOP7.
SOUND_TABLE_ADDR = 0x800A2498
SOUND_TABLE_LEN = 8


def load_lba_names():
    """LBA index -> symbol name (array position in lbas.toml)."""
    names = {}
    for i, line in enumerate(LBAS_TOML.read_text().splitlines()):
        m = re.search(r'"([A-Z0-9_]+)"', line)
        if m:
            names[i - 1] = m.group(1)  # first array entry is line index 1 -> id 0
    return names


def load_words(path):
    words = []
    for line in path.read_text().splitlines():
        m = re.search(r"\.word 0x([0-9a-fA-F]{8})", line)
        if m:
            words.append(int(m.group(1), 16))
    return words


def load_sound_table():
    """The eight packed sound ids at 0x800a2498 in fightstg, named from the Sound Test."""
    words = {}
    want = {SOUND_TABLE_ADDR + 4 * i for i in range(SOUND_TABLE_LEN)}
    for line in FIGHTSTG_S.read_text().splitlines():
        m = re.match(r"\.L0x([0-9a-fA-F]{8}):\s*\.word 0x([0-9a-fA-F]{8})", line.strip())
        if m and int(m.group(1), 16) in want:
            words[int(m.group(1), 16)] = int(m.group(2), 16)
    if len(words) != SOUND_TABLE_LEN:
        raise SystemExit(f"expected {SOUND_TABLE_LEN} words at 0x{SOUND_TABLE_ADDR:08x}, "
                         f"read {len(words)}")
    ids_path = Path(__file__).resolve().parent.parent / "docs/research/audio/soundtst-common-ids.json"
    by_id = {int(e["id"], 16): e["name"] for e in json.loads(ids_path.read_text())}
    out = []
    for i in range(SOUND_TABLE_LEN):
        packed = words[SOUND_TABLE_ADDR + 4 * i]
        out.append({
            "index": i,
            "packed": f"0x{packed:08x}",
            "name": by_id.get(packed),
            "archive": (packed >> 18) & 0x7F,
            "row": (packed >> 11) & 0x7F,
            "tone": (packed >> 7) & 0xF,
            "note": packed & 0x7F,
            "positional": bool(packed >> 31),
            "loop": bool((packed >> 29) & 1),
        })
    return out


def main():
    names = load_lba_names()
    words = load_words(SFSTDATA_S)
    n = len(words) // REC_WORDS
    records = []
    for i in range(n):
        r = words[i * REC_WORDS:(i + 1) * REC_WORDS]
        fidA, binA = r[0] >> 16, r[0] & 0xFFFF
        fidB, binB = r[1] >> 16, r[1] & 0xFFFF
        records.append({
            "index": i,
            "meft": names.get(fidA, f"fid_0x{fidA:x}"),
            "fileId": fidA,
            "binProgram": binA,
            "binClut": binB,
            "clutFileId": fidB,
            "sound": r[2] if r[2] != 0xFFFFFFFF else -1,
            "param": r[3],
        })
    sound_table = load_sound_table()
    out = {
        "resource": "SFSTDATA (fight res 0x1cb / 459)",
        "recordBytes": REC_WORDS * 4,
        "recordCount": n,
        "note": "record index i == MEFT10<i>; rec0 aliases rec1, rec56 dups rec34; "
                "rec55 = MEFT1055 = generic special-attack data-field backdrop.",
        "soundTableAddr": f"0x{SOUND_TABLE_ADDR:08x}",
        "soundTableNote": "rec[+0x08] indexes this fightstg table; F0x80086304 plays the word "
                          "when the effect pack is built and stops it by (id, voice handle) "
                          "when the pack tears down.",
        "soundTable": sound_table,
        "records": records,
    }
    dest = Path(__file__).resolve().parent.parent / "docs/research/fight-3d/data/sfstdata_effect_table.json"
    dest.write_text(json.dumps(out, indent=1))
    print(f"wrote {dest} ({n} records)")
    for s in sound_table:
        print(f"  snd {s['index']} -> {s['packed']} {s['name']} "
              f"(row {s['row']} tone {s['tone']} note {s['note']}"
              f"{', loop' if s['loop'] else ''})")
    for rec in records:
        print(f"  rec {rec['index']:2d} -> {rec['meft']:12s} "
              f"prog=0x{rec['binProgram']:02x} clut=0x{rec['binClut']:02x} "
              f"snd={rec['sound']} param=0x{rec['param']:08x}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
