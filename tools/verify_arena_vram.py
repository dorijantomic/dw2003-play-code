#!/usr/bin/env python3
"""Verify each arena pack's decoded atlas pages against the VRAM page captured in a live battle.

For every `C:/bizhawk-rig/dumps/battle<N>_ram.bin` + `_vram.bin` pair, compare the pack's page 0
(the floor atlas) with the VRAM halfword rect at (640,0) and page 1 (the wall atlas) with (704,0).
A page is byte-identical when every halfword matches. The tpage 0x000a/0x000b -> (640,0)/(704,0)
mapping is decoded live in
.dw3-research/playtest-arena-palette-rig-2026-10-07/results.md §3.

Usage: verify_arena_vram.py [arena ids...]   (default: every captured dump)
"""
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DUMPS = Path("/mnt/c/bizhawk-rig/dumps")

_spec = importlib.util.spec_from_file_location("eb", Path(__file__).with_name("extract_backdrops.py"))
eb = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
_spec.loader.exec_module(eb)  # type: ignore[union-attr]

PAGE_HW_W = 64      # 256 px at 4bpp = 128 bytes = 64 halfwords
PAGE_H = 256
VRAM_W = 1024


def vram_page(vram: bytes, hw_x: int) -> list[bytes]:
    out = []
    for y in range(PAGE_H):
        base = (y * VRAM_W + hw_x) * 2
        out.append(vram[base:base + PAGE_HW_W * 2])
    return out


def score(pack_page: bytes, vram_rows: list[bytes]) -> float:
    ok = 0
    for y in range(PAGE_H):
        seg = pack_page[y * PAGE_HW_W * 2:(y + 1) * PAGE_HW_W * 2]
        if seg == vram_rows[y]:
            ok += 1
    return ok / PAGE_H


def main() -> int:
    args = [a for a in sys.argv[1:] if a.isdigit()]
    ids = [int(a) for a in args] if args else list(range(1, 30))
    covered = 0
    for aid in ids:
        ram = DUMPS / f"battle{aid}_ram.bin"
        vram_f = DUMPS / f"battle{aid}_vram.bin"
        if not ram.exists() or not vram_f.exists():
            print(f"  arena {aid:2d}: no dump")
            continue
        pk = f"meft10{aid:02d}"
        pages = eb.tex_pages(pk)
        vram = vram_f.read_bytes()
        s0 = score(pages[0], vram_page(vram, 640))
        s1 = score(pages[1], vram_page(vram, 704)) if len(pages) > 1 else None
        # A pack is verified when its own pages match the captured VRAM pages (page0 always;
        # page1 when the pack has a second atlas page).
        ok = s0 == 1.0 and (s1 is None or s1 == 1.0)
        if ok:
            covered += 1
        print(f"  arena {aid:2d} -> {pk}: pages={len(pages)} page0={s0:.3f}"
              + (f" page1={s1:.3f}" if s1 is not None else " (single-page)")
              + ("  VERIFIED" if ok else "  <-- MISMATCH"))
    print(f"\nverified {covered} of {len(ids)} packs against captured VRAM")
    return 0 if covered == len(ids) else 1


if __name__ == "__main__":
    raise SystemExit(main())
