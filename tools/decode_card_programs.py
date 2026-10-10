#!/usr/bin/env python3
"""Render the 60 Program-card effect programs in plain language.

Input  : web/assets/data/card_effects.json  (the extracted opcode programs)
Output : docs/research/card/card-effect-programs-2026-08-22.md

Every gloss below carries the source that established it. `src` is either a
section of docs/research/card/card-battle-complete-model-2026-08-06.md or a
ledger claim id. A gloss marked UNKNOWN has no established meaning; it is
printed as UNKNOWN in the output rather than guessed.

This file is the single place a gloss is written. Do not restate a meaning in
the generated document by hand.
"""

import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
SRC = ROOT / "web/assets/data/card_effects.json"
OUT = ROOT / "docs/research/card/card-effect-programs-2026-08-22.md"

# opcode -> (plain-language gloss, source)
G = {}


def r(lo, hi, text, src, fmt=None):
    for i, op in enumerate(range(lo, hi + 1)):
        G[op] = (text.format(i=i, n=i + 1) if fmt is None else fmt(op, i), src)


def one(op, text, src):
    G[op] = (text, src)


# --- control flow -----------------------------------------------------------
one(0x02, "skip the next step", "§G.0")
one(0x03, "mark this point and set the repeat count to 2", "read 2026-08-22, registry update blocks for 0x03 and 0x06")
one(0x04, "mark this point and set the repeat count to 3", "read 2026-08-22, registry update blocks for 0x04 and 0x06")
one(0x05, "mark this point and set the repeat count to 5", "read 2026-08-22, registry update blocks for 0x05 and 0x06")
one(0x06, "count one off the repeat count; if any remain, jump back to the marked point", "read 2026-08-22, registry update block for 0x06")
SRC_TESTS = ("read 2026-08-22 from the five leaves F0x80083F48/F84/FC8, F0x8008400C and "
             "F0x8008404C: each is `if <condition> then duel+0x4E0 += delta`")
one(0x07, "if the last card played was the opponent's, skip the next step", SRC_TESTS)
one(0x08, "if the last card played was the opponent's, skip the next two steps", SRC_TESTS)
one(0x09, "if YOUR hand holds 10 cards or fewer, jump forward 9 steps", SRC_TESTS)
one(0x0A, "if YOUR hand holds more than 10 cards, jump BACK 9 steps", SRC_TESTS)
one(0x0B, "if YOUR hand holds 3 cards or fewer, jump forward 9 steps", SRC_TESTS)
one(0x0C, "if YOUR hand holds more than 3 cards, jump BACK 9 steps", SRC_TESTS)
one(0x0D, "if YOUR hand holds more than 2 cards, jump forward 4 steps", SRC_TESTS)
one(0x0E, "if the OPPONENT's deck still has cards, jump forward 2 steps", SRC_TESTS)
one(0x10, "if YOUR board has fewer than 6 Digimon, jump forward 5 steps", SRC_TESTS)
one(0x0F, "if any card in the opponent's hand is NOT black, jump BACK 4 steps",
    "read 2026-08-22, inline update block at 0x80084FD8: for each card in the opponent's hand it "
    "fetches the catalogue record through the resident accessor and compares byte +0x00, the colour, "
    "against 5 (black); the first non-match subtracts 4 from the program counter")
one(0x11, "swap which side the last play counts as - so the block that follows runs for the other player",
    "read 2026-08-22, dispatch block 0x80085138: xori 1 on history[playCount-1].+0x584. SUPERSEDES §G.0's 'reads back the previous play-history entry', which is not what it does")

# --- accumulators and energy ------------------------------------------------
r(0x1E, 0x28, "", "§G.3.a",
  fmt=lambda op, i: "change one side's S-Energy of the selected colour by %+d" % ({0x1E:1,0x1F:1,0x20:1,0x22:1,0x23:1}.get(op, 2 if op == 0x21 else -2)))
one(0x29, "zero every S-Energy (Anti-Power)", "§G.0")
one(0x2A, "show the card played last, and count it", "read 2026-08-22, F0x8008f948")

# --- play history and presentation ------------------------------------------
one(0x2B, "rewind the play history by one", "§G.12")
one(0x2C, "restore the play history", "§G.12")
one(0x2D, "rewind the play history by one, always", "§G.12")
one(0x2E, "restore the play history, always", "§G.12")
# CORRECTED 2026-08-27. All three called F0x80094FDC and were glossed as
# flourishes because the third argument was read as an effect index. It is a
# MESSAGE ID: the routine hands it to the view's prompt-open method at +0xEE4,
# and against escardgm.toml (entry N at line N+2) the three are ordinary
# sentences. The shared update waits for the wipe, then for Circle or Cross with
# no timeout, then for the close.
_MSG = "read 2026-08-22, corrected 2026-08-27: F0x80094fdc passes a message id, not an effect"
one(0x2F, 'put up "Pick a Card to Trash." and wait for a button', _MSG)
one(0x30, 'put up "No Cards in Deck." and wait for a button', _MSG)
one(0x31, 'put up "There are too many Digimon cards in field. Select which to '
          'throw away." and wait for a button', _MSG)

# --- pile selectors ---------------------------------------------------------
PILE = {0x32: ("your", "deck", "any card"), 0x33: ("the opponent's", "deck", "any card"),
        0x34: ("your", "deck", "Digimon only"), 0x35: ("your", "deck", "Program only"),
        0x36: ("the opponent's", "hand", "any card"), 0x37: ("your", "hand", "any card"),
        0x38: ("the opponent's", "hand", "one colour only"), 0x39: ("the opponent's", "hand", "all but one colour"),
        0x3A: ("your", "trash", "any card")}
for op, (who, zone, kinds) in PILE.items():
    one(op, f"look at {who} {zone} ({kinds})", "§G.0 zone selectors")

one(0x3D, "select board slots by colour and side (mask 0x1FC)", "§G.0 field selectors + §G.15.a")
one(0x3E, "act on the opponent's hand", "§G.0, the one-card hand discards")
one(0x3F, "act on your own hand", "§G.0, the one-card hand discards")

# --- card movement ----------------------------------------------------------
one(0x40, "reveal one card from the chosen pile, large in the middle of the screen, then put it in the trash",
    "ledger cardgame-opcode-0x3e-0x40-pile-peek-icon; re-read 2026-08-22, F0x8008f978 (reveal) and F0x8008fa9c (its update appends the card to the trash, advances the deck cursor and repaints the count)")
one(0x41, "send the card played before this one to its owner's trash, and update both trash counts",
    "read 2026-08-22, F0x8008f750 + F0x8008f790; ledger cardgame-opcode-0x41-is-the-paired-response-resolution")
one(0x42, "draw", "§G.0")
one(0x43, "draw", "§G.0")
one(0x44, "shuffle the trash back into the deck",
    "read 2026-08-22, F0x8009076c; ledger cardgame-opcode-0x44-draw-enter-2026-08-07")
one(0x45, "you may pick 2", "§G.0")
one(0x46, "you may pick up to a full hand of 3", "§G.0")
one(0x47, "you may pick 6", "§G.0")
one(0x48, "move the cards you marked in the deck into your hand",
    "read 2026-08-22, F0x80090ba0; ledger cardgame-opcode-0x48-hand-reveal-2026-08-07")
one(0x49, "discard your whole hand to the trash",
    "read 2026-08-22, F0x8008f0b4; ledger cardgame-opcode-0x49-hand-trash-counters")
one(0x4A, "make the first marked card in the opponent's hand the current selection",
    "read 2026-08-22, inline update block at 0x80085694: scans duel+0x446 over the hand and, on the first non-zero entry, stores that index into duel+0x440 from a jr delay slot")
one(0x4B, "choose which position the next reveal reads from",
    "read 2026-08-22, F0x800840d0 - NEW, no prior claim")
one(0x4C, "the survivors slide along the board to close the gaps",
    "read 2026-08-22, F0x8008e5bc; ledger cardgame-f8008e5bc-runs-as-opcode-0x4c-with-a-full-step-breakdown")
one(0x4D, "destroy the marked card", "§G.6")
one(0x4E, "return the marked card to its owner's hand", "§G.6")
r(0x4F, 0x55, "", "§G.11", fmt=lambda op, i: "put card instance 0x%02X on the board" % (0x50 + i))
one(0x56, "take a card off the board back into a hand",
    "ledger cardgame-opcode-0x56-field-slot-remove-2026-08-07")
one(0x57, "copy the marked card into a new board slot",
    "ledger cardgame-opcode-0x57-field-slot-merge-2026-08-07")
one(0x58, "hold the effect on screen (the longer beat)", "§G.0")
one(0x59, "hold the effect on screen (the shorter beat)", "§G.0")
one(0x5B, "act on one target", "§G.0")
one(0x5C, "act on every match", "§G.0")

# --- stat changes -----------------------------------------------------------
AMT = {0x5E: (10, 10), 0x5F: (0, 30), 0x60: (50, 50), 0x61: (20, 20), 0x62: (30, 30),
       0x63: (0, 10), 0x64: (10, 0), 0x65: (0, -60), 0x66: (0, -15), 0x67: (0, -30),
       0x68: (10, -10), 0x69: (-99, 0)}
for op, (ap, hp) in AMT.items():
    if ap and hp:
        t = f"{ap:+d} AP and {hp:+d} HP"
    elif hp:
        t = f"{hp:+d} HP" + (" (destroy)" if hp == -99 else "")
    else:
        t = f"{ap:+d} AP" + (" (destroy)" if ap == -99 else "")
    one(op, t, "§G.3")

COL = ["white", "blue", "green", "red", "black", "brown"]
for i, c in enumerate(COL):
    one(0x6A + i, f"choose the colour {c}", "§G.0 colour selection")

# --- selection rank ---------------------------------------------------------
one(0xA9, "take the strongest / earliest match", "§G.14 + the hand-discard trace")
one(0xAA, "throw the weakest / latest match", "§G.14 + the hand-discard trace")
for op in (0xAB, 0xAC, 0xAD):
    one(op, "sort the chosen pile and select from it", "ledger cardgame-opcode-0x97-passthrough-and-0xa9-0xad-zone-select")
one(0xAE, "the combo / summon sprite step", "§G.0")


def main():
    d = json.loads(SRC.read_text())
    effects = d["effects"]
    unknown = set()
    lines = []
    lines.append("# What every Program card actually does, opcode by opcode")
    lines.append("")
    lines.append("Generated by `tools/decode_card_programs.py` on 2026-08-22. Do not edit by")
    lines.append("hand - change the gloss table in that script instead.")
    lines.append("")
    lines.append("Each card carries a short program. The program is extracted in")
    lines.append("`web/assets/data/card_effects.json` (field `messages`, a name the ledger")
    lines.append("records as contradicted - it is a program, not dialogue). This document")
    lines.append("renders every program with the established meaning of each step.")
    lines.append("")
    lines.append("**A step printed as UNKNOWN has no established meaning.** It is not a guess")
    lines.append("and not an omission: nothing in the project has read it yet.")
    lines.append("")
    lines.append("## The programs")
    lines.append("")
    for e in sorted(effects, key=lambda x: x["id"]):
        prog = e["messages"]
        lines.append(f"### {e['id']}. {e['name']}")
        lines.append("")
        lines.append("| step | op | what it does |")
        lines.append("|---|---|---|")
        for n, op in enumerate(prog, 1):
            gloss, _ = G.get(op, ("UNKNOWN", ""))
            if gloss == "UNKNOWN":
                unknown.add(op)
            lines.append(f"| {n} | `0x{op:02X}` | {gloss} |")
        lines.append("")
    lines.append("## Where each gloss comes from")
    lines.append("")
    lines.append("| op | gloss | source |")
    lines.append("|---|---|---|")
    used = sorted({op for e in effects for op in e["messages"]})
    for op in used:
        gloss, src = G.get(op, ("UNKNOWN", "not established"))
        lines.append(f"| `0x{op:02X}` | {gloss} | {src} |")
    lines.append("")
    lines.append("## How the jumps work")
    lines.append("")
    lines.append("The program counter is `duel+0x4E0`. **When a test runs, the counter already")
    lines.append("points at the NEXT step**, so a forward jump of N lands N steps past the one")
    lines.append("after the test. That convention is not assumed - it is confirmed three times")
    lines.append("independently, each time landing exactly on a meaningful step:")
    lines.append("")
    lines.append("* Summon Patamon, `0x10` at step 1, +5 lands on step 7, the placement.")
    lines.append("* Summon Angemon, `0x10` at step 2, +5 lands on step 8, the placement.")
    lines.append("* Tidal Wave, `0x09` at step 6, +9 lands on step 16; and `0x0A` at step 15,")
    lines.append("  -9 lands back on step 7, the top of the discard block.")
    lines.append("* Darkness Gale, `0x0F` at step 5, -4 lands back on step 2, the filter.")
    lines.append("* Security Hall, `0x0E` at step 5, +2 lands on step 8, the loop end.")
    lines.append("")
    lines.append("`0x03`/`0x04`/`0x05` save the counter and set a repeat count of 2/3/5; `0x06`")
    lines.append("counts one off and, while any remain, restores the saved counter.")
    lines.append("")
    lines.append("Two readings this settled:")
    lines.append("")
    lines.append("* **Summon Angemon and Summon Hagurumon really do place two.** Their whole")
    lines.append("  body sits inside a repeat-twice, and each pass either finds room on the")
    lines.append("  board (`0x10` jumps straight to the placement) or clears room first. Both")
    lines.append("  cards are printed \"Bring 2 <name> to the field\"; every other Summon card")
    lines.append("  says one and carries no repeat. The control flow was read before the card")
    lines.append("  text was looked at.")
    lines.append("* **Darkness Gale empties the opponent's hand of every non-black card.**")
    lines.append("  Steps 2 to 5 are a loop: mark the non-black cards in the opponent's hand,")
    lines.append("  take the first one, trash it, and `0x0F` jumps back while any non-black")
    lines.append("  card is still there.")
    lines.append("* **Security Hall and Illegal Access mill the opponent's deck, 5 and 2.**")
    lines.append("  Their repeat counts are literally `0x05` and `0x03` - repeat 5 and repeat 2 -")
    lines.append("  matching their printed \"Put 5 Cards\" and \"Put 2 Cards\". Each pass reveals")
    lines.append("  the opponent's top card and trashes it, and `0x0E` breaks the loop early if")
    lines.append("  their deck runs out.")
    lines.append("* **The hand limit is 10, and Tidal Wave enforces it for both players.**")
    lines.append("  Steps 6 to 16 are a loop: while a hand holds more than 10, throw its")
    lines.append("  weakest card away; `0x11` then swaps which side counts as the actor and the")
    lines.append("  repeat-twice runs the same block for the other player.")
    lines.append("")
    lines.append("## What this does not settle")
    lines.append("")
    lines.append("* **Which side a test asks about** comes from section G.16's reading of the")
    lines.append("  interpreter's three side registers, not from a fresh derivation here. The")
    lines.append("  register each dispatch block passes WAS read: the hand and board tests take")
    lines.append("  the acting side, the deck test and the two opponent-hand opcodes take the")
    lines.append("  opponent.")
    lines.append("* **`0x0F` hard-codes black.** It compares the catalogue colour byte against 5")
    lines.append("  directly rather than against the colour `0x6E` selected, so the reading")
    lines.append("  'not black' is exact for Darkness Gale but would not generalise to a card")
    lines.append("  that chose a different colour. No such card exists in the 60.")
    lines.append("* This document is a reading of the ORIGINAL code. Nothing in it has been")
    lines.append("  checked against the running game.")
    lines.append("")
    lines.append("## Coverage")
    lines.append("")
    lines.append(f"* opcodes used by the 60 cards: **{len(used)}**")
    lines.append(f"* with an established meaning: **{len(used) - len(unknown)}**")
    lines.append(f"* UNKNOWN: **{len(unknown)}** ({', '.join('0x%02X' % o for o in sorted(unknown)) or 'none'})")
    fully = sum(1 for e in effects if not any(G.get(o, ('UNKNOWN',))[0] == 'UNKNOWN' for o in e['messages']))
    lines.append(f"* cards whose program reads end to end with no UNKNOWN step: **{fully} of {len(effects)}**")
    lines.append("")
    OUT.write_text("\n".join(lines) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}")
    print(f"opcodes used {len(used)}, unknown {len(unknown)}: "
          + ", ".join("0x%02X" % o for o in sorted(unknown)))
    print(f"cards fully readable: {fully}/{len(effects)}")


if __name__ == "__main__":
    main()
