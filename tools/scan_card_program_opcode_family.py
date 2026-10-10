"""Which opcodes of a range do the shipped card programs actually carry?

Written 2026-09-02 to settle whether any card can reach the play-prompt
family 0x70..0x82. None can. Kept because the question recurs: an opcode
with a decoded handler is not the same as an opcode a duel ever runs.
Usage: python3 tools/scan_card_program_opcode_family.py [lo] [hi]
"""
import sys
import json, collections
cards = json.load(open('/home/dorij/ddw3-walker/web/assets/data/card_effects.json'))
rows = cards['effects']
lo = int(sys.argv[1], 0) if len(sys.argv) > 1 else 0x70
hi = int(sys.argv[2], 0) if len(sys.argv) > 2 else 0x82
family = range(lo, hi + 1)
use = collections.Counter()
carriers = collections.defaultdict(list)
total = 0
for c in rows:
    msgs = c.get('messages') or []
    total += 1
    for op in msgs:
        if op in family:
            use[op] += 1
            carriers[op].append(c.get('name', c.get('id')))
print("card programs scanned:", total)
print("family members used by a card, with how many cards use each:")
for op in sorted(use):
    print("  0x%02X  %2d cards  %s" % (op, use[op], ", ".join(sorted(set(carriers[op]))[:4])))
missing = [op for op in family if op not in use]
print("family members NO shipped card uses:", " ".join("0x%02X" % o for o in missing))
