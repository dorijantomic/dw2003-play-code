#!/usr/bin/env python3
"""
Extract the full 316-entry card-battle catalog from CARDPAK0..4.BIN.

How the original reaches a card record (all authority-2, original assembly):

  exe/fns.s F0x8001e7ec — the "select card" method installed at +0x2c by
  F0x8001ebf8, called by every card front-end (shop grid draw F0x800857b0 in
  pro/stcrdshp.s reads +0x01/+0x02 off the pointer it leaves at object +0x00):

      blez    $a0, ...          # card ids are 1-based
      addiu   $s0, $a0, -0x1
      sra     $v1, $s0, 0x6     # block = (id-1) >> 6   -> 64 cards per file
      la_     $v0, D0x8004dfb8  # 5-entry file-index table
      ...
      andi    $s0, 0x3f         # slot  = (id-1) & 0x3f
      ...                       # x3 <<5 +x3 <<2 -x <<2 == * 1580
      addu    $v0, $v1          # record = fileBase + 1580 * slot

  D0x8004dfb8 (rust/dw2003_exe_data/src/data.rs) = 0x7f6,0x7f7,0x7f8,0x7f9,0x7fa
  = LBA_CARDPAK0..4_BIN_IDX (rust/dw2003_exe_data/src/lba.rs), i.e. the five
  files under ~/ddw3/dw2003/AAA/DAT/CARD/. Sizes confirm the stride exactly:
  4 x 101120 (64 x 1580) + 94800 (60 x 1580) = 316 records.

The card's ARTWORK starts at record + 0x0C and is a standard PS1 TIM.
exe/fns.s F0x8001e890 passes `record + 0xC` to the context method installed at
+0x20 by F0x8001ffa8, which is F0x8001fd50 — a TIM parser: it reads the flags
word (bit 3 = has CLUT, bits 0..2 = bpp), then walks one or two blocks each
shaped {u32 byteLen, u16 dx, u16 dy, u16 w, u16 h, data...} and hands each to
LoadImage (F0x80025b14) with a RECT built from dx/dy/w/h. The record's fields
line up exactly:

  +0x0C u32 0x10   TIM magic (this is why +0x0c is constant across all records)
  +0x10 u32 0x09   flags: bpp code 1 = 8bpp, bit 3 set = CLUT present
  +0x14 u32 0x20C  CLUT block length = 12 header + 256 colours x 2 = 524
  +0x18 u16 dx, u16 dy    CLUT VRAM position (0,0; 12 records use dy 0x1e0)
  +0x1C u16 256, u16 1    CLUT dimensions
  +0x20 512 bytes         the 256-entry BGR555 palette
  +0x220 u32 0x40C        image block length = 12 + 1024
  +0x224 u16 dx, u16 dy   image VRAM position
  +0x228 u16 16, u16 32   w in 16-bit units (=32 px at 8bpp) and h
  +0x22C 1024 bytes       the pixels

So every card carries a 32x32 8bpp icon with its own 256-colour palette, and
8 + 524 + 1036 = 1568 = exactly the record space from +0x0C to the 1580-byte
stride. Emitted as a 32x32-cell atlas alongside the JSON.

  +0x00 u8  colour       1..6, 43/43/43/43/43/41 across the 256 Digimon cards
  +0x01 u8  AP           0 for every Program card
  +0x02 u8  HP           0 for every Program card
  +0x03 u8  kind         0x10 = Digimon card (256 of them);
                         1..8 = Program-card category (60 of them, ids 1..60)
  +0x04 u8  program cost 1..4 on Program cards, 0 on Digimon cards
  +0x05 u8  summon cost  S-Energy paid to summon: 0 Rookie and every brown
                         Digimon, 1 Champion, 2 Ultimate, 3 Mega, 4 on five
                         Megas. Zero on every Program card (all 60). See the
                         note at the emit site.
  +0x06 u8  level        1 In-Training, 2 Rookie, 3 Champion, 4 Ultimate,
                         5 Mega. cardgame.s L4095 bounds this byte with
                         `sltiu $v0, $v1, 0x6` and jumps through the 6-entry
                         table at 0x80083294 to pick the LV plate graphic, so
                         the field is a 0..5 level index, and escardgm.toml
                         lists exactly those five level names. Zero on every
                         Program card (all 60).
  +0x07 u8  always zero across all 316 records; no meaning is established for
                         it, so it is NOT emitted (see the note at the emit
                         site) rather than named from a guess.
  +0x08 u16 strength rank, little-endian; 315 distinct values 0..314 ascending
                         FROM the strongest. (Bytes +0x09 is its high byte.)
  +0x0a u16 combo target card id (0 = this card cannot combo), little-endian;
                         values are card ids. (Bytes +0x0b is its high byte.)
  +0x0c..+0x1f  constant across all 316 records (image descriptor)

Every field above is emitted on EVERY record: colour, AP, HP, kind, program
cost, summon cost, level, strength rank and combo target. Before 2026-10-06 the
extraction dropped three of them on the half of the catalogue that holds them
at zero -- program cost on Digimon cards, summon cost and level on Program
cards -- so a consumer could not tell "the disc holds zero here" from "the
extractor never read this byte".

The record is 1580 bytes and 0x0C does not divide it, so +0x0C is a 1568-byte
TIM (1568 + 12 = 1580). Widths are read from the disc, not assumed: bytes
+0x00..+0x07 are single bytes, +0x08 and +0x0A are 16-bit little-endian fields
whose high bytes are +0x09 and +0x0B.

Names come from escardnm.toml (317 strings, index = card id). Program-card
effect text comes from escardst.toml at index == card id, which holds for all
60 Program cards; the Digimon half of that bank is NOT index-by-id and is left
unbound.

Output: web/assets/data/card_catalog.json
"""

import os
import json
import struct
import subprocess
import sys
import tomllib
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).parent.parent
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
CARD_DIR = DDW3 / "dw2003/AAA/DAT/CARD"
LANG = DDW3 / "lang_file/dw2003/eng"
OUT = ROOT / "web/assets/data/card_catalog.json"
ATLAS = ROOT / "web/assets/cards/card_icons.png"

TIM_OFFSET = 0x0C
ICON_W = 32
ICON_H = 32
ATLAS_COLS = 16

STRIDE = 1580
HEADER = 0x20
KIND_DIGIMON = 0x10

# +0x00. The six colours the card text names ("non-white", "non-blue",
# "all brown", ...); the order is the catalog's own id order, which groups
# ids 1..60 as White, Blue, Green, Red, Black, Brown in blocks of ten.
COLOURS = {1: "white", 2: "blue", 3: "green", 4: "red", 5: "black", 6: "brown"}

# +0x06, Digimon cards only.
STAGES = {2: "rookie", 3: "champion", 4: "ultimate", 5: "mega"}


def read_pak(path: Path) -> bytes:
    """Read a CARDPAK, transparently resolving a git-lfs pointer.

    ~/ddw3 is read-only for this repository, so a pointer is smudged to stdout
    rather than materialised in that worktree.
    """
    raw = path.read_bytes()
    if not raw.startswith(b"version https://git-lfs.github.com/spec/v1"):
        return raw
    lfs = Path.home() / "bin/git-lfs"
    git_lfs = str(lfs) if lfs.exists() else "git-lfs"
    proc = subprocess.run(
        [git_lfs, "smudge"], input=raw, cwd=DDW3, capture_output=True, check=True
    )
    return proc.stdout


def records() -> list[bytes]:
    out: list[bytes] = []
    for i in range(5):
        blob = read_pak(CARD_DIR / f"CARDPAK{i}.BIN")
        if len(blob) % STRIDE:
            sys.exit(f"CARDPAK{i}.BIN is {len(blob)} bytes, not a multiple of {STRIDE}")
        for j in range(len(blob) // STRIDE):
            out.append(blob[j * STRIDE : (j + 1) * STRIDE])
    return out


def decode_tim(record: bytes) -> Image.Image:
    """Decode one record's 8bpp+CLUT TIM into a 32x32 RGBA image.

    PS1 palette entries are BGR555 with the top bit as the semi-transparency
    flag; the all-zero entry is fully transparent, which is what the card icons
    use for their background.
    """
    tim = record[TIM_OFFSET:]
    magic, flags = struct.unpack_from("<II", tim, 0)
    if magic != 0x10 or (flags & 0xF) != 0x9:
        raise ValueError(f"unexpected TIM header magic={magic:#x} flags={flags:#x}")

    off = 8
    clut_len = struct.unpack_from("<I", tim, off)[0]
    clut_w, clut_h = struct.unpack_from("<HH", tim, off + 8)
    palette_raw = tim[off + 12 : off + clut_len]
    off += clut_len

    img_len = struct.unpack_from("<I", tim, off)[0]
    img_w, img_h = struct.unpack_from("<HH", tim, off + 8)
    pixels = tim[off + 12 : off + img_len]

    width = img_w * 2  # w counts 16-bit units; 8bpp packs two pixels per unit
    height = img_h
    if width != ICON_W or height != ICON_H:
        raise ValueError(f"unexpected icon size {width}x{height}")

    palette = []
    for i in range(clut_w * clut_h):
        (v,) = struct.unpack_from("<H", palette_raw, i * 2)
        r = (v & 0x1F) << 3
        g = ((v >> 5) & 0x1F) << 3
        b = ((v >> 10) & 0x1F) << 3
        a = 0 if v == 0 else 255
        palette.append((r | (r >> 5), g | (g >> 5), b | (b >> 5), a))

    out = Image.new("RGBA", (width, height))
    out.putdata([palette[p] for p in pixels[: width * height]])
    return out


def build_atlas(recs: list[bytes]) -> None:
    rows = (len(recs) + ATLAS_COLS - 1) // ATLAS_COLS
    atlas = Image.new("RGBA", (ATLAS_COLS * ICON_W, rows * ICON_H))
    for i, r in enumerate(recs):
        icon = decode_tim(r)
        atlas.paste(icon, ((i % ATLAS_COLS) * ICON_W, (i // ATLAS_COLS) * ICON_H))
    ATLAS.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(ATLAS)
    print(f"{ATLAS}: {len(recs)} icons, {ATLAS_COLS} x {rows} cells of {ICON_W}x{ICON_H}")


def strings(name: str) -> list[str]:
    return tomllib.loads((LANG / f"{name}.toml").read_text())["strings"]


def main() -> None:
    recs = records()
    names = strings("escardnm")
    effects = strings("escardst")

    cards = []
    for idx, r in enumerate(recs):
        card_id = idx + 1
        digimon = r[3] == KIND_DIGIMON
        card = {
            "id": card_id,
            "name": names[card_id] if card_id < len(names) else "",
            "colour": COLOURS.get(r[0], r[0]),
            "kind": "digimon" if digimon else "program",
            "ap": r[1],
            "hp": r[2],
            # +0x04 the card's PROGRAM cost: 1..4 on the 60 Program cards, and
            # 0 on every one of the 256 Digimon cards. Emitted for every card so
            # the field is carried, not left to a consumer's default.
            "programCost": r[4],
            # +0x05 the card's SUMMON cost: the S-Energy of the card's colour
            # paid to bring it to the field -- 0 for every Rookie and every
            # brown Digimon, 1 Champion, 2 Ultimate, 3 Mega, 4 on five Megas.
            # Zero on every one of the 60 Program cards (a Program is played,
            # not summoned). Emitted for every card.
            "summonCost": r[5],
            # +0x06 the card's LEVEL index 0..5 (1 In-Training .. 5 Mega);
            # Digimon carry 2..5 and the 60 Program cards all carry 0. Emitted
            # raw for every card, beside the Digimon `stage` name below.
            "level": r[6],
            # +0x08 is the card's STRENGTH RANK, decoded 2026-08-07: 315
            # distinct values ordered ascending FROM THE STRONGEST (Pearson
            # -0.92 against attack; ranks 7..11 are Imperialdramon-P,
            # Armageddemon and the two Omnimon, ranks 311..314 the four basic
            # Power Programs). Both AI choosers MINIMISE it, so the opponent
            # reaches for its best card. It is a 16-bit little-endian field (its
            # high byte is +0x09), and it cannot be a single byte: 256 cards
            # would then collide. Kept under the old `unk8` name as well so an
            # older consumer still reads.
            "strengthRank": int.from_bytes(r[8:10], "little"),
            "unk8": int.from_bytes(r[8:10], "little"),
            "unkA": int.from_bytes(r[10:12], "little"),
            # +0x0A is the card's COMBO target, decoded 2026-08-06. The duel
            # engine's combo scan F0x800a0cd4 (pro/cardgame.s) sorts a side's
            # field by card id, and for each run of identical cards reads this
            # field off the CARDPAK record (`sp30->unkA`): a zero ends the run,
            # a non-zero value is stored into the duel's combo slot at
            # ctx+0x438 once the run reaches three. The values are card ids and
            # they follow the digivolution lines exactly - Patamon, Angemon and
            # Piddomon all carry 71 = MagnaAngemon. F0x800a3934, the AI's own
            # board evaluator installed at duel+0x820, gates its combo bonus on
            # the same `!= 0` test. 16-bit little-endian (high byte +0x0B).
            "comboInto": int.from_bytes(r[10:12], "little"),
        }
        if digimon:
            card["stage"] = STAGES.get(r[6], r[6])
            # +0x05 again, under the older name; a Digimon's summon cost.
            card["summonTier"] = r[5]
            # Five Digimon cards carry an escardst line where every other
            # Digimon index holds the filler "a", and they are exactly the five
            # the album and the shop both special-case by id: 0x45 RosemonII,
            # 0x70 MarineAngemon, 0x9B SaberLeomon, 0xC6 Gryphonmon and 0xF1
            # Creepymon, one per colour block. Their printed AP/HP are not the
            # whole story - the text is the rule that computes them.
            # -- UI-CARDALBUM-FIVE-SPECIAL-DIGIMON-HAVE-TEXT-2026-08-14
            text = effects[card_id] if card_id < len(effects) else ""
            if text.strip() and text.strip() != "a":
                card["effect"] = text
        else:
            card["programCategory"] = r[3]
            # +0x04 again, under the older name; a Program's own cost.
            card["cost"] = r[4]
            card["effect"] = effects[card_id] if card_id < len(effects) else ""
        cards.append(card)

    digimon = [c for c in cards if c["kind"] == "digimon"]
    program = [c for c in cards if c["kind"] == "program"]
    build_atlas(recs)

    doc = {
        "_source": "~/ddw3/dw2003/AAA/DAT/CARD/CARDPAK0..4.BIN via exe/fns.s F0x8001e7ec",
        "_stride": STRIDE,
        "_headerBytes": HEADER,
        # The canonical record layout (docs/research/card/CARD-DUEL-VERIFIED.md
        # S8.1) as this extractor reads it, one row per field. `off`/`width` are
        # read from the disc, not copied from the table.
        "_recordLayout": [
            {"field": "colour", "off": "0x00", "width": 1, "emitted": "colour"},
            {"field": "ap", "off": "0x01", "width": 1, "emitted": "ap"},
            {"field": "hp", "off": "0x02", "width": 1, "emitted": "hp"},
            {"field": "kind", "off": "0x03", "width": 1, "emitted": "kind (0x10 Digimon; 1..8 Program category as programCategory)"},
            {"field": "program cost", "off": "0x04", "width": 1, "emitted": "programCost (and `cost` for a Program)"},
            {"field": "summon cost", "off": "0x05", "width": 1, "emitted": "summonCost (and `summonTier` for a Digimon)"},
            {"field": "level", "off": "0x06", "width": 1, "emitted": "level (raw 0..5; and `stage` name for a Digimon)"},
            {"field": "unestablished", "off": "0x07", "width": 1, "emitted": "no -- zero on all 316 records, no meaning established"},
            {"field": "strength rank", "off": "0x08", "width": 2, "emitted": "strengthRank (and `unk8`)"},
            {"field": "combo target", "off": "0x0A", "width": 2, "emitted": "comboInto (and `unkA`)"},
            {"field": "artwork TIM", "off": "0x0C", "width": 1568, "emitted": "atlas cell (assets/cards/card_icons.png)"},
        ],
        "icons": {
            "atlas": "assets/cards/card_icons.png",
            "cols": ATLAS_COLS,
            "cellW": ICON_W,
            "cellH": ICON_H,
            "_note": "cell index = card id - 1; source is each record's own 8bpp TIM at +0x0C",
        },
        "counts": {"total": len(cards), "digimon": len(digimon), "program": len(program)},
        "cards": cards,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=1) + "\n")
    print(f"{OUT}: {len(cards)} cards ({len(digimon)} Digimon, {len(program)} Program)")


if __name__ == "__main__":
    main()
