#!/usr/bin/env python3
"""Re-verify ledger evidence anchors against the live files.

`handoff-check` does NOT do this: `record-packets` verifies digests and `exact`
quotes at integration time only, so any later edit to a cited source silently
desynchronises the ledger and nothing downstream notices. This tool is that
missing check.

Read-only. Classifies every evidence entry that carries a source_sha256:

  ok           digest matches; nothing to do
  drift        digest stale, `exact` quote still present  -> restampable
  locator      digest stale, quote present but the line moved -> restampable
  broken       digest stale, `exact` quote NO LONGER PRESENT
  missing      cited file does not exist
  noquote      digest stale, entry has no `exact` quote -> cannot self-check

Two verdicts need a human, not a script:

  * `broken` is not automatically "claim unsupported". Some entries put an
    ASSERTION in `exact` ("size 35360") rather than a literal substring of the
    source, and a binary source can never contain its own quote. Read the entry
    before concluding anything.
  * A surviving quote does NOT prove the claim survived. The quote can still
    match while the surrounding data changed enough to falsify the summary --
    on 2026-08-08 `RANK-E01` still quoted its card while the catalog it counts
    had grown from 315 to 316 entries. Re-read the summary, not just the quote.

Usage:
  .venv/bin/python3 tools/audit_evidence_digests.py             # report
  .venv/bin/python3 tools/audit_evidence_digests.py --check     # exit 1 if any
  .venv/bin/python3 tools/audit_evidence_digests.py --restamp   # fix drift/locator
  .venv/bin/python3 tools/audit_evidence_digests.py --restamp --journal

`--restamp` writes the live digest onto exactly the entries whose quote is still
present -- `drift` and `locator` -- and leaves `broken`, `missing` and `noquote`
alone, because those need a person. For a `locator` row it also moves a plain
`L<n>` locator to the line the quote now sits on, and prints every change.

`--journal` restamps `.dw3-research/integration-journal.json` instead of the
ledger. A retained integration journal embeds its own full ledger snapshot and
replays it over the live file, so restamping the ledger alone loops forever:
edit the journal, then run `record-packets` once to let the recovery finish.
This is the documented failure mode in CLAUDE.md, and it has cost time in three
separate sessions.
"""
import json, hashlib, os, sys
from collections import defaultdict

LEDGER = 'docs/research/evidence/ledger.json'
JOURNAL = '.dw3-research/integration-journal.json'

RESTAMP = '--restamp' in sys.argv
JOURNAL_MODE = '--journal' in sys.argv

led = json.load(open(LEDGER))
evidence = led.get('evidence', [])
claims = {c.get('id'): c for c in led.get('claims', [])}

# map evidence id -> claims that cite it
cites = defaultdict(list)
for c in led.get('claims', []):
    for eid in (c.get('evidence') or []):
        cites[eid].append(c.get('id'))

_cache = {}
def readfile(p):
    if p not in _cache:
        try:
            _cache[p] = open(p, 'rb').read()
        except OSError:
            _cache[p] = None
    return _cache[p]

def locator_line(loc):
    if not loc:
        return None
    s = str(loc).lstrip('Ll')
    s = s.split('-')[0].split(':')[0]
    return int(s) if s.isdigit() else None

rows = []
for e in evidence:
    eid = e.get('id')
    src = e.get('source')
    dig = e.get('source_sha256')
    if not dig or not src:
        continue
    path = os.path.expanduser(src)
    blob = readfile(path)
    if blob is None:
        rows.append((eid, 'missing', src, '', cites.get(eid, [])))
        continue
    live = hashlib.sha256(blob).hexdigest()
    if live == dig:
        continue  # ok, skip
    quote = e.get('exact')
    if not quote:
        rows.append((eid, 'noquote', src, '', cites.get(eid, [])))
        continue
    try:
        text = blob.decode('utf-8', 'replace')
    except Exception:
        text = ''
    if quote not in text:
        rows.append((eid, 'broken', src, repr(quote)[:90], cites.get(eid, [])))
        continue
    lines = text.split('\n')
    hits = [i + 1 for i, l in enumerate(lines) if quote in l]
    want = locator_line(e.get('locator'))
    note = ''
    if want and hits and want not in hits:
        note = f'L{want} -> L{hits[0]}' + (f' (+{len(hits)-1} more)' if len(hits) > 1 else '')
        kind = 'locator'
    else:
        note = f'line {hits[0]}' if hits else ''
        kind = 'drift'
    rows.append((eid, kind, src, note, cites.get(eid, [])))

order = {'broken': 0, 'missing': 1, 'noquote': 2, 'locator': 3, 'drift': 4}
rows.sort(key=lambda r: (order.get(r[1], 9), r[0]))

counts = defaultdict(int)
for r in rows:
    counts[r[1]] += 1

print(f'evidence entries with a digest: '
      f'{sum(1 for e in evidence if e.get("source_sha256") and e.get("source"))}')
print('needing attention:', dict(counts))
print()
for eid, kind, src, note, cl in rows:
    short = src.replace('/home/dorij/ddw3-walker/', '').replace('/home/dorij/', '~/')
    print(f'{kind:8} {eid:28} {short}')
    if note:
        print(f'{"":8} {"":28} {note}')
    if cl:
        print(f'{"":8} {"":28} cited by: {", ".join(cl)}')


def restamp(entries, label):
    """Write the live digest onto every entry whose quote is still present."""
    fixable = {eid for eid, kind, *_ in rows if kind in ('drift', 'locator')}
    done = 0
    for e in entries:
        eid, src, quote = e.get('id'), e.get('source'), e.get('exact')
        if eid not in fixable or not src or not quote:
            continue
        blob = readfile(os.path.expanduser(src))
        if blob is None:
            continue
        text = blob.decode('utf-8', 'replace')
        if quote not in text:
            continue  # never restamp an anchor whose quote is gone
        e['source_sha256'] = hashlib.sha256(blob).hexdigest()
        moved = ''
        want = locator_line(e.get('locator'))
        if want is not None and str(e.get('locator')).lstrip('Ll').isdigit():
            hits = [i + 1 for i, l in enumerate(text.split('\n')) if quote in l]
            if hits and want not in hits:
                e['locator'] = f'L{hits[0]}'
                moved = f' locator L{want} -> L{hits[0]}'
        print(f'  restamped {eid}{moved}')
        done += 1
    print(f'{label}: restamped {done} of {len(fixable)} restampable anchor(s)')
    return done


def walk_entries(obj):
    """Every dict in a nested structure that looks like an evidence anchor."""
    if isinstance(obj, dict):
        if obj.get('id') and obj.get('source') and obj.get('source_sha256'):
            yield obj
        for v in obj.values():
            yield from walk_entries(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from walk_entries(v)


if RESTAMP:
    print()
    if JOURNAL_MODE:
        if not os.path.exists(JOURNAL):
            print(f'no retained journal at {JOURNAL}; nothing to do')
            sys.exit(0)
        doc = json.load(open(JOURNAL))
        if restamp(list(walk_entries(doc)), JOURNAL):
            open(JOURNAL, 'w').write(json.dumps(doc, indent=2) + '\n')
            print('now run `./dw3-research record-packets <epoch>` once to '
                  'let the retained journal finish.')
    elif restamp(evidence, LEDGER):
        open(LEDGER, 'w').write(json.dumps(led, indent=2) + '\n')
    sys.exit(0)

if '--check' in sys.argv and rows:
    print(f'\nFAIL: {len(rows)} evidence anchor(s) no longer match their source.')
    sys.exit(1)
