#!/usr/bin/env python3
"""Apply a validated batch of doc-header proposals.

The model supplies `reach` and `evidence` only. `status` is computed here: a
date in the filename makes a document the record of one session (`log`);
everything else is `canonical`. `superseded` is NOT computed -- a document
saying "supersedes" is as likely to be the replacement as the replaced, so that
mark stays a hand judgement.

Refuses to touch a document that already carries a header.
"""
import argparse, json, os, re, sys

DATED = re.compile(r'20\d\d-\d\d-\d\d')


def has_header(path):
    with open(path, errors='replace') as fh:
        return fh.readline() == '---\n'


def apply_row(row, dry):
    p, reach = row['path'], (row.get('reach') or '').strip()
    if reach == 'UNSUPPORTED' or not reach:
        return 'skipped-unsupported'
    if not os.path.exists(p):
        return 'skipped-missing'
    if has_header(p):
        return 'skipped-headered'
    status = 'log' if DATED.search(os.path.basename(p)) else 'canonical'
    body = open(p, errors='replace').read()
    out = '---\nreach: %s\nstatus: %s\n---\n\n%s' % (reach, status, body.lstrip('\n'))
    if not dry:
        open(p, 'w').write(out)
    return 'applied-' + status


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('proposals')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    counts = {}
    for line in open(a.proposals):
        line = line.strip()
        if not line:
            continue
        r = apply_row(json.loads(line), a.dry_run)
        counts[r] = counts.get(r, 0) + 1
    for k in sorted(counts):
        print('%s %d' % (k, counts[k]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
