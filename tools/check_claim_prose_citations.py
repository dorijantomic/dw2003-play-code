#!/usr/bin/env python3
"""Check the CITATIONS IN CLAIM PROSE against the files the claim cites.

`validate_packets` verifies every evidence `exact` quote. Nothing verifies the
line numbers and addresses a claim types into its own `statement`, `coverage`
or `notes` text -- and that is exactly where a wrong citation survived review
on 2026-08-28 (a claim named three lines that were a `move_`, a `nop` and an
unrelated `sltiu`).

Two mechanical checks, both over the claim's own cited sources only:

  LINE   an `L<n>` in the prose must exist in a cited text source; when the
         prose puts a MIPS mnemonic within LOOKAHEAD chars after it, that
         mnemonic must appear on that line.
  OFFS   (WARN, triage only -- it has real false positives when one sentence
         lists several lines and several fields) when the prose names offsets or immediates near an `L<n>`,
         at least one of them must appear on that line -- the check that catches
         a line reference typed one instruction off.
  ADDR   a `0x8xxxxxxx` in the prose must appear in a cited source, either
         literally or as the label `.L0x<addr>:` of an overlay whose load base
         the ledger records in the evidence locator.

Evidence ids are resolved from BOTH stores. `ledger.json`'s `evidence` array
holds hand-written records; the research index mints its own content-addressed
`EV-` ids for every indexed function, assembly label, table row and document
section. 619 of the ledger's 4,410 claim->evidence references live only in the
index, across 136 claims -- reading the ledger alone makes those claims look
sourceless and silently skips them.

Neither check proves a claim true. A FAIL means the prose points at a line or
address that does not say what the prose says it says.
"""
import argparse, json, os, re, sqlite3, sys

LREF = re.compile(r'\bL(\d{1,7})\b')
# `L2928-L2943` / `L2928-2943` names a SPAN. Checking its endpoints as if they
# were single cited lines produced false failures on 2026-08-29: prose that
# reads a range contiguously attributes its mnemonics to the range, not to the
# first and last line of it.
RANGE = re.compile(r'\bL(\d{1,7})\s*(?:-|--|\u2013|to)\s*L?(\d{1,7})\b')
MAX_SPAN = 400
ADDR = re.compile(r'\b0x8[0-9a-fA-F]{7}\b')
BASE = re.compile(r'base\s*(0x8[0-9a-fA-F]{7})', re.I)
LOOKAHEAD = 70
WINDOW = 90
OFFS = re.compile(r'(?<![0-9a-fA-Fx])0x([0-9a-fA-F]{1,4})\b')
TEXT_EXT = {'.s', '.c', '.h', '.md', '.py', '.rs', '.js', '.ts', '.toml', '.txt', '.json'}

MNEMONICS = """lw sw lb lbu lh lhu sb sh lwl lwr swl swr addiu addu addi subu sub
li lui ori andi and or nor xor xori sll srl sra sllv srlv srav slt slti sltiu
sltu beq bne beqz bnez blez bgtz bltz bgez jal jalr jr nop move mult multu
div divu mflo mfhi mtlo mthi break syscall lwc2 swc2 mtc2 mfc2 ctc2 cfc2""".split()
MNEMONICS = set(MNEMONICS)
# `and`, `or`, `move`, `break`, `div`, `sub`, `b`, `j`, `nor` are also ordinary
# English or prose punctuation. They only count as a mnemonic inside backticks.
AMBIGUOUS = {'and', 'or', 'move', 'break', 'div', 'divu', 'sub', 'b', 'j', 'nor', 'la', 'li'}
_ALT = '|'.join(sorted(MNEMONICS, key=len, reverse=True))
MN_TICKED = re.compile(r'`(' + _ALT + r')\b')
MN_FIRST = re.compile(r'^[\s,:;.\-]*(' + _ALT + r')\b')


# Attribution is CLAUSE-scoped, not lookahead-scoped. Reading a fixed window
# after the reference produced two false failures on 2026-08-29: prose reading
# `... li 0x63 L7721; addiu -0x2 ...` had the next clause's mnemonic charged to
# L7721, and prose reading `L8358) ... no bound; the actual bound `slti` lives
# in the UNCITED F0x8001764c` had a mnemonic the sentence explicitly places
# ELSEWHERE charged to L8358. Prose also names the mnemonic BEFORE the line as
# often as after it (`sw $zr at L12384`), which a lookahead never sees.
#
# The rule: every mnemonic named in a clause must appear on at least one line
# that the SAME clause cites.
CLAUSE = re.compile(r';|\n|(?<=[A-Za-z0-9)`])\.\s+(?=[A-Z])')
MN_BARE = re.compile(r'(?<![\w`])(' + _ALT + r')\b')
# `no jal, no la, no .word` is prose PROVING an absence. Charging its mnemonics
# to the cited line inverts the claim.
NEGATED = re.compile(r'\b(no|not|never|without|neither|nor|nothing|none)\b[^.;]{0,24}$', re.I)
# `sb/sh`, `lui/addiu` name a PAIR the clause describes as a whole; a line that
# carries either member satisfies it.
PAIR = re.compile(r'`?\b(' + _ALT + r')\b`?\s*/\s*`?\b(' + _ALT + r')\b`?')
# `R1/L1 fast-adjust` is a controller button, not line 1.
BUTTON = re.compile(r'[RL][12]\s*/\s*$|/\s*$')
DELAY = re.compile(r'delay slot', re.I)


# A mnemonic far from the reference is usually describing the IDIOM, not the
# line: "each by a lui/addiu pair followed by a store, in cardgame.s: 0xEA4 =
# 0x8009BE40 (installed at L27053)" cites the store, not the pair.
PROX = 60
# NOT `[\w./~-]*\b([\w-]+\.md)` -- a greedy prefix eats
# `docs/research/ui/stcrddek-decoded-2026-07-` and leaves the basename `12.md`,
# which matches nothing and fabricates 20 uncited-source failures.
FILEREF = re.compile(r'[\w.~/-]+\.(?:s|c|h|rs|md|py|json|toml|txt)\b')


def mnemonic_groups(clause, ref_spans):
    """Alternative-sets the clause attributes to the lines it cites."""
    pairs = {}
    for m in PAIR.finditer(clause):
        both = frozenset((m.group(1), m.group(2)))
        pairs[m.group(1)] = pairs[m.group(2)] = both
    out = set()
    for rx, ticked in ((MN_TICKED, True), (MN_BARE, False)):
        for m in rx.finditer(clause):
            mn = m.group(1)
            if not ticked and mn in AMBIGUOUS:
                continue
            if NEGATED.search(clause[:m.start()]):
                continue
            if not any(a - PROX <= m.start() <= b + PROX for a, b in ref_spans):
                continue
            out.add(pairs.get(mn, frozenset((mn,))))
    return sorted(out, key=lambda g: sorted(g))


def named_file(clause, at):
    """The source file the clause names nearest before this reference."""
    best = None
    for m in FILEREF.finditer(clause):
        if m.end() <= at and at - m.end() <= PROX:
            best = os.path.basename(m.group(0))
    return best

_cache = {}


def lines_of(path):
    if path not in _cache:
        try:
            with open(path, 'r', errors='replace') as fh:
                _cache[path] = fh.read().split('\n')
        except OSError:
            _cache[path] = None
    return _cache[path]


def prose_of(claim):
    out = []
    for key in ('statement', 'coverage', 'notes'):
        v = claim.get(key)
        if isinstance(v, str):
            out.append((key, v))
        elif isinstance(v, list):
            out.append((key, ' '.join(str(x) for x in v)))
    return out


def check_claim(claim, ev_by_id):
    evs = [ev_by_id[e] for e in claim.get('evidence', []) if e in ev_by_id]
    sources, bases = [], []
    for e in evs:
        src = os.path.expanduser(e.get('source', ''))
        if os.path.splitext(src)[1] in TEXT_EXT and os.path.exists(src):
            sources.append(src)
        m = BASE.search(str(e.get('locator', '')) + ' ' + str(e.get('summary', '')))
        if m:
            bases.append(int(m.group(1), 16))
    sources = list(dict.fromkeys(sources))
    bases = list(dict.fromkeys(bases))
    findings = []
    if not sources:
        return findings, False

    for key, text in prose_of(claim):
        spans = {}
        for r in RANGE.finditer(text):
            a, b = int(r.group(1)), int(r.group(2))
            if 0 < b - a <= MAX_SPAN:
                spans[a] = spans[b] = (a, b)

        for clause in CLAUSE.split(text):
            refs, ref_spans, named = [], [], {}
            for m in LREF.finditer(clause):
                if BUTTON.search(clause[max(0, m.start() - 4):m.start()]):
                    continue
                n = int(m.group(1))
                refs.append(n)
                ref_spans.append((m.start(), m.end()))
                f = named_file(clause, m.start())
                if f:
                    named[n] = f
            if not refs:
                continue
            # When the prose names the file it is quoting, hold it to THAT file.
            for n, f in named.items():
                if not any(os.path.basename(src) == f for src in sources):
                    # Pointing at another research DOCUMENT is ordinary
                    # cross-reference prose. Pointing at a SOURCE the claim
                    # does not carry is the citation nobody can re-check.
                    doc = f.endswith('.md')
                    findings.append(dict(
                        kind='SRC', level='WARN' if doc else 'FAIL', field=key, ref='L%d' % n,
                        detail='prose cites %s L%d; %s is not among the claim\'s evidence sources'
                               % (f, n, f)))
            refs = [n for n in refs if n not in named
                    or any(os.path.basename(src) == named[n] for src in sources)]
            if not refs:
                continue
            # A delay-slot line is named by the instruction ABOVE it.
            back = 1 if DELAY.search(clause) else 0
            hits, dead = [], []
            for n in refs:
                lo, hi = spans.get(n, (n, n))
                lo = max(1, lo - back)
                got = False
                want = named.get(n)
                for src in sources:
                    if want and os.path.basename(src) != want:
                        continue
                    ls = lines_of(src)
                    if ls and 1 <= lo <= len(ls):
                        got = True
                        for i in range(lo, min(hi, len(ls)) + 1):
                            hits.append((n, src, ls[i - 1]))
                if not got:
                    dead.append(n)
            for n in dead:
                findings.append(dict(kind='LINE', level='FAIL', field=key, ref='L%d' % n,
                                     detail='line %d is past the end of every cited source' % n))
            if not hits:
                continue
            # A mnemonic is only checkable against ASSEMBLY. Prose citing a
            # `.rs` or `.c` line while naming what the ASSEMBLY does elsewhere
            # ("all twelve references are lw") is not a citation defect.
            asm = [h for h in hits if h[1].endswith('.s')]
            if not asm:
                continue
            for group in mnemonic_groups(clause, ref_spans):
                if any(re.search(r'\b%s\b' % re.escape(mn), h[2])
                       for mn in group for h in asm):
                    continue
                cited = ', '.join('L%d' % n for n in dict.fromkeys(refs))
                shown = ' || '.join(dict.fromkeys(h[2].strip()[:90] for h in asm))[:400]
                findings.append(dict(
                    kind='LINE', level='FAIL', field=key, ref=cited,
                    detail='clause names `%s` but no line it cites (%s) carries it: %s'
                           % ('/'.join(sorted(group)), cited, shown)))

        for m in LREF.finditer(text):
            n = int(m.group(1))
            lo, hi = spans.get(n, (n, n))
            hits = []
            for src in sources:
                ls = lines_of(src)
                if ls and 1 <= lo <= len(ls):
                    for i in range(lo, min(hi, len(ls)) + 1):
                        hits.append((src, ls[i - 1]))
            if not hits:
                continue
            shown = ' || '.join(dict.fromkeys(h[1].strip()[:90] for h in hits))
            win = text[max(0, m.start() - WINDOW):m.end() + WINDOW]
            offs = {'0x%s' % o.lower() for o in OFFS.findall(win)}
            if offs:
                on_line = [o for o in offs
                           if any(re.search(r'(?<![0-9a-fA-Fx])%s\b' % o, h[1], re.I) for h in hits)]
                if not on_line:
                    findings.append(dict(
                        kind='OFFS', level='WARN', field=key, ref='L%d' % n,
                        detail='prose puts %s near L%d; that line carries none of them: %s'
                               % (', '.join(sorted(offs)), n, shown)))

        for m in ADDR.finditer(text):
            a = int(m.group(0), 16)
            found = False
            for src in sources:
                ls = lines_of(src)
                if not ls:
                    continue
                needles = ['%08x' % a, '%08X' % a]
                for b in bases:
                    if a >= b:
                        needles.append('.L0x%08x:' % (a - b))
                blob = _blob(src)
                if any(nd.lower() in blob for nd in needles):
                    found = True
                    break
            if not found:
                findings.append(dict(kind='ADDR', level='WARN', field=key, ref=m.group(0),
                                     detail='address not present in any cited source'))
    return findings, True


_blobs = {}


def _blob(src):
    if src not in _blobs:
        ls = lines_of(src) or []
        _blobs[src] = '\n'.join(ls).lower()
    return _blobs[src]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ledger', default='docs/research/evidence/ledger.json')
    ap.add_argument('--claim', action='append', help='limit to these claim ids')
    ap.add_argument('--status', action='append', help='limit to these statuses')
    ap.add_argument('--index', default='.dw3-research/index.sqlite3',
                    help='research index, the second evidence store')
    ap.add_argument('--no-index', action='store_true',
                    help='ledger evidence only (reproduces the pre-2026-08-29 blind spot)')
    ap.add_argument('--fail-only', action='store_true')
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()

    d = json.load(open(args.ledger))
    ev_by_id = {e['id']: e for e in d['evidence']}
    missing = {e for c in d['claims'] for e in c.get('evidence', [])} - set(ev_by_id)
    from_index = 0
    if missing and not args.no_index and os.path.exists(args.index):
        con = sqlite3.connect('file:%s?mode=ro' % args.index, uri=True)
        con.execute('PRAGMA query_only = ON')
        for chunk in [sorted(missing)[i:i + 400] for i in range(0, len(missing), 400)]:
            q = 'SELECT evidence_id, source_path, locator, summary, exact FROM evidence WHERE evidence_id IN (%s)' % ','.join('?' * len(chunk))
            for eid, src, loc, summ, exact in con.execute(q, chunk):
                ev_by_id[eid] = dict(id=eid, source=src, locator=loc, summary=summ, exact=exact)
                from_index += 1
        con.close()
    unresolved = len(missing) - from_index
    rows, checked, skipped = [], 0, 0
    for c in d['claims']:
        if args.claim and c['id'] not in args.claim:
            continue
        if args.status and c.get('status') not in args.status:
            continue
        f, had = check_claim(c, ev_by_id)
        checked += 1 if had else 0
        skipped += 0 if had else 1
        for x in f:
            if args.fail_only and x['level'] != 'FAIL':
                continue
            x.update(claim=c['id'], status=c.get('status'), system=c.get('system'))
            rows.append(x)

    if args.json:
        json.dump(rows, sys.stdout, indent=1)
        print()
    else:
        for x in rows:
            print('%-4s %-4s %-24s %-14s %s\n       %s'
                  % (x['level'], x['kind'], x['claim'][:24], x['status'], x['ref'], x['detail']))
        fails = sum(1 for x in rows if x['level'] == 'FAIL')
        print('\nclaims checked %d, skipped (no readable cited source) %d, FAIL %d, WARN %d'
              % (checked, skipped, fails, len(rows) - fails))
        print('evidence ids resolved from the index %d, unresolved in either store %d'
              % (from_index, unresolved))
    return 1 if any(x['level'] == 'FAIL' for x in rows) else 0


if __name__ == '__main__':
    sys.exit(main())
