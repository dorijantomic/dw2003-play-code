#!/usr/bin/env python3
"""Scan field-stage pack files for the 6-section grid-pyramid zone-map format
decoded from fieldstg loader 0x800927fc + zonecheck 0x80092914.

Format (resource base = file start):
  base+0x00..0x14 : 6 LE u32 section offsets (rel to base) -> sec0..sec5
  sec0 @ word[0]  : u8 width, u8 height, then width*height bytes (level-0 grid)
  sec1 @ word[1]  : bytes   (2x2 children, index = node*4 + child)
  sec2 @ word[2]  : u16[]   (halfword entries)
  sec3 @ word[3]  : u16[]
  sec4 @ word[4]  : u16[]
  sec5 @ word[5]  : bytes   (8x8 leaf blocks, 64 bytes/node -> 1-based zone id)
"""
import struct, sys, glob, os

def test(buf):
    if len(buf) < 0x18 + 2:
        return None
    off = struct.unpack_from('<6I', buf, 0)
    # offsets must be ascending, start after the 6-word header, within file
    if off[0] < 0x18:
        return None
    for i in range(5):
        if off[i] >= off[i+1]:
            return None
    if off[5] >= len(buf):
        return None
    w, h = buf[off[0]], buf[off[0]+1]
    if w == 0 or h == 0:
        return None
    sec0_end = off[0] + 2 + w*h
    # sec0 grid must fit before sec1
    if sec0_end > off[1]:
        return None
    # sec5 (leaf) must be nonempty and end at/inside file
    if off[5] >= len(buf):
        return None
    leaf = buf[off[5]:]
    # leaf zone ids should be small (1-based; 0 allowed = none)
    maxzone = max(leaf) if leaf else 0
    if maxzone == 0 or maxzone > 64:
        return None
    return dict(off=off, w=w, h=h, sec0_end=sec0_end, leaf_len=len(leaf), maxzone=maxzone)

def main():
    roots = sys.argv[1:] or ['/home/dorij/ddw3/pack/dw2003/field/stage']
    files = []
    for r in roots:
        if os.path.isfile(r):
            files.append(r)
        else:
            files += glob.glob(os.path.join(r, '**', '*.bin'), recursive=True)
    hits = 0
    for f in sorted(files):
        try:
            buf = open(f, 'rb').read()
        except Exception:
            continue
        r = test(buf)
        if r:
            hits += 1
            print(f"HIT {f}  size={len(buf)} off={[hex(x) for x in r['off']]} "
                  f"grid={r['w']}x{r['h']} maxzone={r['maxzone']} leaf={r['leaf_len']}")
    print(f"\nscanned {len(files)} files, {hits} candidate zone-maps")

if __name__ == '__main__':
    main()
