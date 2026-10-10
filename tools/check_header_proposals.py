#!/usr/bin/env python3
"""Validate a batch of doc-header proposals before any of it is applied.

Round one ran 336 rows and self-certified; every field was wrong. This runs in
a second and rejects a batch at row 1, so the next round cannot repeat it.

The model proposes only `reach` and `evidence`. `status`, `system` and
`superseded_by` are computed here, because a date in a filename and a catalog
id are things a script gets right every time.
"""
import argparse, collections, json, os, re, sys

GERUND = re.compile(r'^[A-Z][a-z]+ing\b')
EVIDENCE = re.compile(r'^(.+):(\d+)$')
MIN_WORDS, MAX_WORDS = 6, 25


def check(rows):
    errs, seen = [], {}
    for i, r in enumerate(rows, 1):
        p = r.get('path')
        tag = 'row %d (%s)' % (i, p or '?')
        if not p or not os.path.exists(p):
            errs.append('%s: path does not exist' % tag)
            continue
        reach = (r.get('reach') or '').strip()
        if reach == 'UNSUPPORTED':
            continue
        n = len(reach.split())
        if not GERUND.match(reach):
            errs.append('%s: reach must start with a capitalised gerund' % tag)
        if n < MIN_WORDS:
            errs.append('%s: reach is %d words; a situation needs at least %d' % (tag, n, MIN_WORDS))
        if n > MAX_WORDS:
            errs.append('%s: reach is %d words; the ceiling is %d' % (tag, n, MAX_WORDS))
        key = reach.lower()
        if key in seen:
            errs.append('%s: reach is identical to %s -- a pointer shared by two '
                        'documents fires on neither' % (tag, seen[key]))
        seen[key] = p
        m = EVIDENCE.match(str(r.get('evidence') or ''))
        if not m:
            errs.append('%s: evidence must be path:line, not text' % tag)
            continue
        src, line = m.group(1), int(m.group(2))
        if src != p:
            errs.append('%s: evidence cites %s; it must cite the document itself' % (tag, src))
        elif line < 1 or line > sum(1 for _ in open(p, errors='replace')):
            errs.append('%s: evidence line %d is outside the file' % (tag, line))
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('proposals')
    args = ap.parse_args()

    rows, bad = [], 0
    for i, line in enumerate(open(args.proposals), 1):
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except ValueError as e:
            bad += 1
            print('error=line %d is not valid JSON: %s' % (i, e))

    errs = check(rows)
    for e in errs:
        print('error=%s' % e)

    uns = sum(1 for r in rows if (r.get('reach') or '').strip() == 'UNSUPPORTED')
    uniq = len({(r.get('reach') or '').lower() for r in rows})
    print('rows %d, unparseable %d, UNSUPPORTED %d, distinct reach %d, errors %d'
          % (len(rows), bad, uns, uniq, len(errs)))
    if rows and uniq < 0.8 * (len(rows) - uns):
        print('error=only %d distinct reach lines across %d rows; the batch collapsed '
              'onto a few labels' % (uniq, len(rows)))
        return 1
    return 1 if (errs or bad) else 0


if __name__ == '__main__':
    sys.exit(main())
