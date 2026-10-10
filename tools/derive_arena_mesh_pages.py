#!/usr/bin/env python3
"""Derive the per-MESH atlas page (page0 = floor atlas, page1 = wall atlas) of a MEFT arena pack.

WHY THIS EXISTS
---------------
The arena pack's own bytes do NOT carry the per-mesh page: it is the runtime display-list
node field `node.texBase0/1` (the 0x01 descriptor's base, FIGHTSTG_F0x80085110 /
`fightstg.s` F0x80085110). The predecessor's rule `clut col == 16 -> floor` is WRONG for the
stage arenas (documented in
.dw3-research/playtest-arena-palette-rig-2026-10-07/results.md §4: for MEFT1001 the col-16
prims are the WALL, not the floor). Drawing a mesh with the wrong atlas page paints the wrong
region — mostly the atlas's index-0 fill — which, once the decoded OPAQUE blend is applied,
blackens the scene.

THE DECODE (method = results.md §13)
------------------------------------
A live battle's MainRAM holds the arena's POST-CULL POLY_FT4 packets; each packet carries its
texpage (page) and its four UV bytes. Collect the per-page UV multiset from a capture, then
score every static mesh of the pack by how many of its UVs that page's packets actually use:
the mesh's page is the page whose packet UVs it shares. Validated 2026-10-07 against the four
packs whose page map was established independently (ids 1, 5, 13, 20): 100% of meshes match.

Usage:
  derive_arena_mesh_pages.py [RAM dump]...   # default: every C:/bizhawk-rig/dumps/battle<N>_ram.bin
Writes (next to this file): arena_mesh_pages.json  { "meft10NN": {"<meshRow>": "p0"|"p1"} }
"""
from __future__ import annotations

import collections
import importlib.util
import json
import re
import struct
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = Path(__file__).with_name("arena_mesh_pages.json")           # per-mesh fallback table
CLUT_OUT = Path(__file__).with_name("arena_clut_pages.json")      # per-CLUT-group page (primary)
DUMPS = Path("/mnt/c/bizhawk-rig/dumps")

_spec = importlib.util.spec_from_file_location("eb", Path(__file__).with_name("extract_backdrops.py"))
eb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(eb)


def _s16(v: int) -> int:
    return v - 0x10000 if v & 0x8000 else v


def page_uv_counts(ram: bytes) -> dict[int, collections.Counter]:
    """Per (page) UV multiset of every arena POLY_FT4 packet in a MainRAM dump.

    tpage 0x000a = page0 (VRAM halfword 640,0); 0x000b = page1 (704,0) — decoded live
    2026-10-07 (results.md §3). XY are validated to the signed 11-bit draw range so RAM
    garbage that merely looks like a command byte is rejected.
    """
    n = len(ram)
    per: dict[int, collections.Counter] = {0x0a: collections.Counter(), 0x0b: collections.Counter()}
    for o in range(0, n - 48, 4):
        if ram[o + 3] not in range(0x2C, 0x30):     # POLY_FT4
            continue
        words = struct.unpack_from("<9I", ram, o)
        tpage = (words[4] >> 16) & 0xFFFF
        if tpage not in (0x0a, 0x0b):
            continue
        ok = True
        uv: list[tuple[int, int]] = []
        for wi in (1, 3, 5, 7):
            x = _s16(words[wi] & 0xFFFF)
            y = _s16((words[wi] >> 16) & 0xFFFF)
            if not (-1024 <= x <= 1023 and -1024 <= y <= 1023):
                ok = False
                break
            uv.append((words[wi + 1] & 0xFF, (words[wi + 1] >> 8) & 0xFF))
        if ok:
            per[tpage].update(uv)
    return per


def mesh_pages(pack: str, per: dict[int, collections.Counter],
               quad_uv: dict[tuple, collections.Counter] | None = None) -> dict[str, str]:
    """Per-mesh-row page — the FALLBACK when a pack has no captured CLUT->page map.

    The page is really a property of the CLUT GROUP, not the mesh (see `clut_pages`); this
    mesh-row form is kept only so an uncaptured pack still gets a page, using the page whose
    captured packet UV multiset the mesh's own UVs share most."""
    out: dict[str, str] = {}
    for i, (m, _ctrl) in enumerate(eb.pack_meshes(pack)):
        uvset: collections.Counter = collections.Counter()
        for p in m["prims"]:
            if p.get("uv"):
                for (u, v) in p["uv"]:
                    uvset[(u & 0xFF, v & 0xFF)] += 1
        if not uvset:
            continue
        s0 = sum(min(uvset[k], per[0x0a][k]) for k in uvset)
        s1 = sum(min(uvset[k], per[0x0b][k]) for k in uvset)
        out[str(i)] = "p0" if s0 >= s1 else "p1"
    return out


def clut_pages(pack: str, ram: bytes) -> dict[str, str]:
    """Per-CLUT-GROUP atlas page, read off the live packets — THE TRUE MODEL (2026-10-07).

    The page is NOT a per-mesh field. Matching each pack quad-prim's four UVs against the live
    packets and crossing the prim's CLUT group against the packet's texpage is UNANIMOUS for
    every group of every captured pack (28 packs, 0 conflicts; meft1023 holds one packet so it
    has no map): each `(clut col, row)` is drawn from exactly one atlas page. MEASURED
    examples — meft1001: (0,255)->p0, (16,255)->p1, (32,255)->p0, (48,255)->p0; meft1013:
    (16,255)->p0, (32,255)->p1, (48,255)->p0. `extract_arenas.group_page` prefers this map and
    falls back to the mesh table only for a group the capture did not cover.

    (The old per-mesh attribution sent meft1001's (0,255) and meft1013's (16,255) groups to the
    wrong atlas page because several rows share the same quad UV sets.)
    """
    live = _arena_packets(ram)
    quad_uv: dict[tuple, collections.Counter] = {}
    for lp in live:
        quad_uv.setdefault(tuple(sorted(lp["uv"])), collections.Counter())[lp["tpage"]] += 1
    out: dict[str, set] = {}
    for _row, (m, _c) in enumerate(eb.pack_meshes(pack)):
        for p in m["prims"]:
            if not p.get("uv") or len(p["uv"]) != 4:
                continue
            cc = quad_uv.get(tuple(sorted((u & 0xFF, v & 0xFF) for u, v in p["uv"])))
            if not cc:
                continue
            col, rw = p["clut"]
            out.setdefault(f"{col},{rw}", set()).update(cc)
    # A conflict would mean the page is not a CLUT function; none occurs on the 28 captured packs.
    return {k: ("p0" if (0x0A in v) else "p1") for k, v in out.items() if len(v) == 1}


def _arena_packets(ram: bytes) -> list[dict]:
    """Every arena POLY_FT4 packet's (tpage, four UVs) out of a MainRAM dump."""
    n, out = len(ram), []
    for o in range(0, n - 48, 4):
        if ram[o + 3] not in range(0x2C, 0x30):
            continue
        words = struct.unpack_from("<9I", ram, o)
        tpage = (words[4] >> 16) & 0xFFFF
        if tpage not in (0x0A, 0x0B):
            continue
        ok, uv = True, []
        for wi in (1, 3, 5, 7):
            x = _s16(words[wi] & 0xFFFF)
            y = _s16((words[wi] >> 16) & 0xFFFF)
            if not (-1024 <= x <= 1023 and -1024 <= y <= 1023):
                ok = False
                break
            uv.append((words[wi + 1] & 0xFF, (words[wi + 1] >> 8) & 0xFF))
        if ok:
            out.append({"tpage": tpage, "uv": uv})
    return out


def main() -> int:
    args = sys.argv[1:]
    if args:
        dumps = [Path(a) for a in args]
    else:
        dumps = sorted(DUMPS.glob("battle*_ram.bin"))
    table = json.loads(OUT.read_text()) if OUT.exists() else {}
    clut_table = json.loads(CLUT_OUT.read_text()) if CLUT_OUT.exists() else {}
    for dump in dumps:
        m = re.search(r"battle(\d+)", dump.name)
        if not m:
            print(f"  skip {dump} (no battle<N> in name)")
            continue
        aid = int(m.group(1))
        pk = f"meft10{aid:02d}"
        ram = dump.read_bytes()
        per = page_uv_counts(ram)
        pages = mesh_pages(pk, per)
        table[pk] = pages
        clut = clut_pages(pk, ram)
        clut_table[pk] = clut
        n1 = sum(1 for v in pages.values() if v == "p1")
        print(f"  arena {aid:2d} -> {pk}: {len(pages)} meshes, {n1} on page1; "
              f"{len(clut)} CLUT groups -> {dict(sorted(clut.items()))}")
    OUT.write_text(json.dumps(table, indent=1, sort_keys=True))
    CLUT_OUT.write_text(json.dumps(clut_table, indent=1, sort_keys=True))
    print(f"arena mesh pages: {len(table)} packs -> {OUT}")
    print(f"arena CLUT->page: {len(clut_table)} packs -> {CLUT_OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
