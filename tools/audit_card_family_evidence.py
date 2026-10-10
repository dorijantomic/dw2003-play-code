#!/usr/bin/env python3
"""For every card-effect opcode family we do NOT implement, report what the
LEDGER actually holds about its handlers.

Written 2026-08-24 after two separate errors of the same shape: a research
document's `[?]` mark was quoted as current status when the ledger had moved
past it, and a family was called "blocked" while two partially_verified claims
already decoded it. A document's OPEN QUESTION is not proof the question is
still open. This asks the ledger directly.
"""
import json, re, collections

R = '/home/dorij/ddw3-walker/'
reg = json.load(open(R + 'docs/research/card/cardgame-opcode-registry.json'))['opcodes']
led = json.load(open(R + 'docs/research/evidence/ledger.json'))
syms = {int(f['address'], 16): f.get('name', '?')
        for f in json.load(open(R + 'docs/research/ui/symbols/cardgame.json'))['functions']}

vm = open(R + 'engine/systems/card-effect-vm.ts').read()
ops = set()
ex = vm[vm.index('function execute'):]
for m in re.finditer(r'op === 0x([0-9a-fA-F]{1,2})', ex): ops.add(int(m.group(1), 16))
for m in re.finditer(r'op >= 0x([0-9a-fA-F]{2}) && op <= 0x([0-9a-fA-F]{2})', ex):
    ops.update(range(int(m.group(1), 16), int(m.group(2), 16) + 1))
for n in ('PILE_SWEEPS', 'BOARD_SELECTORS', 'PILE_PICKERS', 'STAT_OPS', 'ENERGY_OPS'):
    j = vm.index('const ' + n); blk = vm[j:vm.index('};', j)]
    for m in re.finditer(r'^\s*0x([0-9a-fA-F]{2})\s*:', blk, re.M): ops.add(int(m.group(1), 16))
cb = open(R + 'engine/systems/card-battle.ts').read()
j = cb.index('SUMMON_OPCODE_CARDS'); blk = cb[cb.index('{', j):cb.index('};', j)]
for m in re.finditer(r'^\s*0x([0-9a-fA-F]{2})\s*:', blk, re.M): ops.add(int(m.group(1), 16))

missing = [o for o in range(1, 0xAF) if o not in ops]


def row(o):
    return reg.get('0x%02X' % o) or reg.get('0x%02x' % o)


def callee(d):
    cs = d.get('callees') or []
    return cs[0] if cs else None


fam = collections.OrderedDict()
for o in missing:
    r = row(o)
    fam.setdefault((callee(r['enter']), callee(r['update'])), []).append(o)


def hits(addrs):
    """Claims and evidence that name any of these handler addresses."""
    pats = []
    for a in addrs:
        if not a: continue
        h = a.replace('F0x', '')
        pats.append(re.compile(re.escape(h), re.I))
    cl, evd = [], 0
    for c in led['claims']:
        blob = (c.get('statement') or '') + ' ' + c['id']
        if any(p.search(blob) for p in pats):
            cl.append((c['id'], c.get('status')))
    for e in led['evidence']:
        if any(p.search(e.get('locator', '') + ' ' + (e.get('summary') or '')) for p in pats):
            evd += 1
    return cl, evd


def rng(xs):
    out = []; st = pr = None
    for x in xs:
        if st is None: st = pr = x; continue
        if x == pr + 1: pr = x; continue
        out.append((st, pr)); st = pr = x
    out.append((st, pr))
    return ','.join('0x%02x' % a if a == b else '0x%02x-0x%02x' % (a, b) for a, b in out)


def nm(c):
    return syms.get(int(c.replace('F0x', ''), 16), '?') if c else '(none)'


print('%d families behind %d unimplemented opcodes\n' % (len(fam), len(missing)))
ranked = sorted(fam.items(), key=lambda kv: -len(kv[1]))
tot_c = 0
for i, (k, v) in enumerate(ranked, 1):
    cl, evd = hits(k)
    tot_c += len(cl)
    pv = sum(1 for _, s in cl if s == 'partially_verified')
    print('%2d. [%2d ops] %-22s  claims=%d (partially_verified=%d) evidence=%d'
          % (i, len(v), rng(v), len(cl), pv, evd))
    print('      %s / %s' % (nm(k[0]), nm(k[1])))
    for cid, st in cl[:6]:
        print('        - %-72s %s' % (cid[:72], st))
    if len(cl) > 6:
        print('        ... and %d more' % (len(cl) - 6))
print('\ntotal claims naming an unimplemented family handler: %d' % tot_c)
