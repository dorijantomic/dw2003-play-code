#!/usr/bin/env python3
"""Turn a rig function-entry trace into a readable, ordered call log.

Input:  the `frames`/`fn` file written by tools/windows-rig/trace-cardgame-callgraph.lua
Joins:  docs/research/ui/symbols/cardgame.json  (names + one-line descriptions)
        docs/generated/function-extents.json    (addresses, static caller counts)

Output: a per-phase ordered call log and a coverage table -- which duel
        functions the disc actually ran, how often, and which never ran.
"""
import json, re, sys, collections, argparse

REPO = '/home/dorij/ddw3-walker'
FNLIST = REPO + '/tools/windows-rig/cardgame-fnlist.lua'
SYMS = REPO + '/docs/research/ui/symbols/cardgame.json'


def load_addrs():
    txt = open(FNLIST).read()
    return [int(m, 16) for m in re.findall(r'\{0x([0-9a-f]{8}),', txt)]


def load_syms():
    d = json.load(open(SYMS))
    out = {}
    for f in d['functions']:
        out[int(f['address'], 16)] = (f.get('name') or '?', f.get('one_line') or '')
    return out


def parse(path):
    frames = []          # (frame, repeat, [idx...])
    fnrows = {}          # idx -> (addr, size, callers, hits, firstframe)
    meta = []
    for line in open(path):
        line = line.rstrip('\n')
        if line.startswith('#'):
            meta.append(line)
            continue
        m = re.match(r'frames (\d+) x(\d+) : (.*)$', line)
        if m:
            body = m.group(3)
            ids = [int(x) for x in body.split(',')] if body else []
            frames.append((int(m.group(1)), int(m.group(2)), ids))
            continue
        m = re.match(r'fn (\d+) ([0-9a-f]{8}) +(\d+) +(\d+) +(\d+) +(-?\d+) (\S+)', line)
        if m:
            fnrows[int(m.group(1))] = dict(
                addr=int(m.group(2), 16), size=int(m.group(3)),
                static_callers=int(m.group(4)), hits=int(m.group(5)),
                first=int(m.group(6)), ra=m.group(7))
    return meta, frames, fnrows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('trace')
    ap.add_argument('--top', type=int, default=40)
    ap.add_argument('--order', action='store_true',
                    help='print the ordered per-frame call log')
    a = ap.parse_args()

    addrs = load_addrs()
    syms = load_syms()
    meta, frames, fnrows = parse(a.trace)

    def nm(idx):
        addr = addrs[idx - 1]
        n, o = syms.get(addr, ('?', ''))
        return addr, n, o

    # counts derived from the frame log (independent of the fn table, which a
    # crash can truncate)
    cnt = collections.Counter()
    first = {}
    total_frames = 0
    for f, rep, ids in frames:
        total_frames += rep
        for i in ids:
            cnt[i] += rep
            first.setdefault(i, f)

    for m in meta:
        print(m)
    print('# frames observed: %d   distinct functions entered: %d / %d'
          % (total_frames, len(cnt), len(addrs)))
    print()

    print('== most-run duel functions ==')
    print('%-9s %-34s %8s %6s  %s' % ('addr', 'name', 'calls', 'first', 'what it does'))
    for i, c in cnt.most_common(a.top):
        addr, n, o = nm(i)
        print('%08x  %-34s %8d %6d  %s' % (addr, n[:34], c, first[i], o[:96]))
    print()

    never = [i for i in range(1, len(addrs) + 1) if i not in cnt]
    print('== never entered during this duel (%d of %d) ==' % (len(never), len(addrs)))
    for i in never:
        addr, n, o = nm(i)
        print('%08x  %-34s  %s' % (addr, n[:34], o[:96]))

    if a.order:
        print()
        print('== ordered call log ==')
        for f, rep, ids in frames:
            if not ids:
                continue
            names = [nm(i)[1] for i in ids]
            print('frame %04d x%-4d %s' % (f, rep, ' -> '.join(names)))


if __name__ == '__main__':
    main()
