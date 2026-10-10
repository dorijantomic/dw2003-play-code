#!/usr/bin/env python3
"""
Extract the 60 Program-card effect records from `pro/cardgame`.

Where the table is (all authority-2, original assembly, ~/ddw3/asm/dw2003/pro/
cardgame.s):

  F0x80083e34(cardId, selector, extra) is the ONLY reader of the table. It
  computes `0x800a4df4 + cardId * 0x2c` (the index sequence `sll 1; addu;
  sll 2; subu; sll 2` at L1139-L1146 is exactly *0x2c) and then returns
  selector 0 -> +0x00, 1 -> +0x01, 2 -> +0x02, 3 -> +0x03, 4+ -> +0x04+extra.

  The region runs to the next referenced address 0x800a5844, i.e. 0xa50 bytes
  = 60 records of 0x2c, and 60 is exactly the number of Program cards in the
  disc catalog (card ids 1..60, the records whose CARDPAK byte +0x03 is not
  0x10). Row index == cardId - 1: the five "<colour> Remove" cards, ids 51..55,
  hold the five consecutive leading bytes 0x78..0x7c, and the five "<colour>
  Power" cards hold 0x73..0x77 in colour order.

What the four header bytes are, and how each was established:

  +0x00  targeting kind. F0x800a36e4 switches on exactly this byte (it is
         handed `F0x80083e34(cardId, 0, 0)` at F0x800a4978 L67/L99/L131) and,
         per case, asks whether the card has any legal target:
           0x70,0x73..0x7e  -> always playable (no target needed)
           0x71 / 0x7f      -> F0x8008ec44(ctx, side, zone 2 = hand, 0xff)
           0x72 / 0x82      -> zone 3 = deck
           0x80 / 0x81      -> zone 4 = trash
           0x96             -> own hand, kind mask 0xfd (Digimon only)
           0x83             -> requires a card played this phase
           0x84             -> last played card's category == 6
           0x85..0x95       -> F0x8008eec8(ctx, side, mask) on the FIELD
         The field masks are decoded in `TARGETING` below.
  +0x01  effect-visual selector, passed to F0x800954f8 at F0x800a2180 case 6.
         0 = no visual.
  +0x02  effect asset id, passed to the screen's unkEE4 in the same block.
  +0x03  a small enum stored into the play-history entry at +0x585 by
         F0x8009f998. Its meaning is NOT established; it is carried through
         verbatim and not acted on.
  +0x04..  RETRACTED READING BELOW. This array is the card's zero-terminated
         OPCODE PROGRAM, run by the effect interpreter F0x80084320 with the
         PC at duel+0x4E0 -- see docs/research/card/
         card-battle-complete-model-2026-08-06.md line 53 and section E, and
         ledger claim cardduel-effect-record-message-list-is-not-a-bytecode.
         The JSON field is still named `messages` because renaming it would
         break every consumer; see docs/research/ui/
         cardgame-divergence-2026-08-21.md item 4. The original note follows.
  +0x04..  a zero-terminated list of on-screen message ids. F0x800a2180 case 7
         walks it with `F0x80083e34(cardId, 4, ctx->unk4E0)`, writing each
         non-zero byte into the message id at ctx+0x421 and advancing, and
         leaves the sub-state when it reads the 0 terminator. It is dialogue,
         not an effect program.

Field-target mask bits, from F0x8008eec8 and the colour table at 0x800a58f4:

  bit 8 (0x100)  the acting player's own field slots
  bit 9 (0x200)  the opponent's field slots
                 (F0x8008eec8 gates slots 0..5 on 0x100 when arg2 == 0 and on
                 0x200 when arg2 == 1, and slots 6..11 the other way round, so
                 the two bits are relative to the actor, not to a fixed side)
  bits 2..7      card colour 1..6 = white, blue, green, red, black, brown. The
                 loop at F0x8008eec8 `loop_19` walks the 6-entry u16 table at
                 0x800a58f4 (0x0004, 0x0008, 0x0010, 0x0020, 0x0040, 0x0080)
                 and matches entry i against colour byte i+1.

Zone codes, from F0x8008ec44: 2 = hand (count +0x5a6, array +0x600), 3 = deck
(count +0x5a4, array +0x5b0, read cursor +0x5a0), 4 = trash (count +0x5a2,
array +0x614). Its `arg4` kind mask is bit 0 = Digimon cards, bit 1 = Program
cards.

Output: web/assets/data/card_effects.json
"""

import os
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
ASM = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro/cardgame.s"
CATALOG = ROOT / "web/assets/data/card_catalog.json"
OUT = ROOT / "web/assets/data/card_effects.json"

OVERLAY_BASE = 0x80082CB0
TABLE_ADDR = 0x800A4DF4
TABLE_END = 0x800A5844
STRIDE = 0x2C
COLOUR_MASK_ADDR = 0x800A58F4

COLOURS = ["white", "blue", "green", "red", "black", "brown"]

WORD = re.compile(r"^\.L0x([0-9a-fA-F]{8}): \.word 0x([0-9a-fA-F]{8})")


def read_overlay_words(path):
    words = {}
    with path.open(encoding="utf-8", errors="replace") as fh:
        for line in fh:
            m = WORD.match(line)
            if m:
                words[int(m.group(1), 16)] = int(m.group(2), 16)
    return words


def read_bytes(words, addr, length):
    out = bytearray()
    for i in range((length + 3) // 4):
        w = words.get(addr - OVERLAY_BASE + 4 * i)
        if w is None:
            raise SystemExit(f"cardgame.s has no word at {addr + 4 * i:#010x}")
        out += w.to_bytes(4, "little")
    return bytes(out[:length])


def decode_field_mask(mask):
    """Split a F0x8008eec8 field mask into sides and colours."""
    sides = []
    if mask & 0x100:
        sides.append("own")
    if mask & 0x200:
        sides.append("opponent")
    colours = [c for i, c in enumerate(COLOURS) if mask & (1 << (i + 2))]
    return {"zone": "field", "sides": sides, "colours": colours}


# F0x800a36e4, one entry per case. `field` masks are passed to F0x8008eec8;
# `zone`/`side`/`kinds` come from the F0x8008ec44 arguments of that case.
TARGETING = {
    0x70: {"zone": "none"},
    0x71: {"zone": "hand", "sides": ["own"], "kinds": ["digimon", "program"]},
    0x72: {"zone": "deck", "sides": ["opponent"], "kinds": ["digimon", "program"]},
    0x73: {"zone": "none"},
    0x74: {"zone": "none"},
    0x75: {"zone": "none"},
    0x76: {"zone": "none"},
    0x77: {"zone": "none"},
    0x78: {"zone": "none"},
    0x79: {"zone": "none"},
    0x7A: {"zone": "none"},
    0x7B: {"zone": "none"},
    0x7C: {"zone": "none"},
    0x7D: {"zone": "none"},
    0x7E: {"zone": "none"},
    0x7F: {"zone": "hand", "sides": ["opponent"], "kinds": ["digimon", "program"]},
    0x80: {"zone": "trash", "sides": ["own"], "kinds": ["digimon", "program"]},
    0x81: {"zone": "trash", "sides": ["own"], "kinds": ["digimon", "program"]},
    0x82: {"zone": "deck", "sides": ["own"], "kinds": ["digimon", "program"]},
    0x83: {"zone": "played-this-phase"},
    0x84: {"zone": "played-this-phase", "requiresCategory": 6},
    0x96: {"zone": "hand", "sides": ["own"], "kinds": ["digimon"]},
}
FIELD_MASKS = {
    0x85: 0x1FC, 0x87: 0x180, 0x88: 0x2FC, 0x89: 0x2BC, 0x8A: 0x280,
    0x8B: 0x3FC, 0x8C: 0x380, 0x8E: 0x1FC, 0x8F: 0x2FC, 0x90: 0x3FC,
    0x91: 0x3F8, 0x92: 0x3F4, 0x93: 0x310, 0x94: 0x3DC, 0x95: 0x380,
}


def main():
    words = read_overlay_words(ASM)

    size = TABLE_END - TABLE_ADDR
    if size % STRIDE:
        raise SystemExit(f"table span {size:#x} is not a multiple of {STRIDE:#x}")
    count = size // STRIDE
    blob = read_bytes(words, TABLE_ADDR, size)

    colour_masks = read_bytes(words, COLOUR_MASK_ADDR, 12)
    colour_bits = [int.from_bytes(colour_masks[i * 2:i * 2 + 2], "little") for i in range(6)]
    if colour_bits != [0x04, 0x08, 0x10, 0x20, 0x40, 0x80]:
        raise SystemExit(f"colour mask table changed: {colour_bits}")

    catalog = json.loads(CATALOG.read_text())
    by_id = {c["id"]: c for c in catalog["cards"]}

    records = []
    for i in range(count):
        rec = blob[i * STRIDE:(i + 1) * STRIDE]
        card_id = i + 1
        card = by_id.get(card_id)
        if card is None or card["kind"] != "program":
            raise SystemExit(
                f"row {i} maps to card {card_id} which is not a Program card; "
                "the table is no longer id-aligned"
            )
        kind = rec[0]
        messages = []
        for b in rec[4:]:
            if b == 0:
                break
            messages.append(b)
        entry = {
            "id": card_id,
            "name": card["name"],
            "targetKind": kind,
            "effectVisual": rec[1],
            "effectAsset": rec[2],
            "playKind": rec[3],
            "messages": messages,
        }
        if kind in FIELD_MASKS:
            entry["fieldMask"] = FIELD_MASKS[kind]
            entry["targeting"] = decode_field_mask(FIELD_MASKS[kind])
        elif kind in TARGETING:
            entry["targeting"] = dict(TARGETING[kind])
        else:
            raise SystemExit(f"card {card_id}: targeting kind {kind:#x} is not in F0x800a36e4")
        records.append(entry)

    out = {
        "_source": "~/ddw3/asm/dw2003/pro/cardgame.s",
        "_table": f"{TABLE_ADDR:#010x}",
        "_stride": STRIDE,
        "_reader": "F0x80083e34",
        "_targetingSwitch": "F0x800a36e4",
        "_colourBits": {c: colour_bits[i] for i, c in enumerate(COLOURS)},
        "_fieldSideBits": {"own": 0x100, "opponent": 0x200},
        "count": len(records),
        "effects": records,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    print(f"wrote {OUT} ({len(records)} Program-card effect records)")


if __name__ == "__main__":
    main()
