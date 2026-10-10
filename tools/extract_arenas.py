#!/usr/bin/env python3
"""Extract the per-AREA battle STAGE arenas (MEFT1001-1029) as 3D meshes + atlas textures.

THE SELECTOR, DECODED 2026-10-07 (see
.dw3-research/playtest-battle-arena-selector-2026-10-07/results.md):

  fieldstg fn 0x800925a8 (random-encounter selector, overlay file 0xf8f8) and its
  scripted twin fn 0x800927a0 (file 0xfaf0) copy the chosen battle-trigger record's
  `param` (u16 @record+0x4) into the battle descriptor at 0x80042b1c+0xc = 0x80042b28:

      lw  $a0, 0x4($v1)        # $v1 = block[slot]  -> the record
      lw  $v1, 0x4($a0)        # record+0x4 = param
      addiu $v0, 0x2b1c        # descriptor base
      sw  $v1, 0xc($v0)        # -> 0x80042b28  (pro/fieldstg.s:15973-15980 / :16075-16082)

  wfightmn (overlay file 0xfac, pro/wfightmn.s:1010) then reads it and builds the
  backdrop object:

      lw  $a0, 0x2b28($v0)                 # the arena/backdrop id
      jal FIGHTSTG_F0x800869a8             # id -> object+0x50 (pro/fightstg.s:4005)
      li  $a1, 0x3c

  FIGHTSTG_F0x80086304 indexes the SFSTDATA table (resource 0x1cb) with id:
  `rec = SFSTDATA + id*0x58` (pro/fightstg.s:3598-3626). SFSTDATA record i -> MEFT10<i>
  (fires 1:1; record 0 aliases 1). So an ordinary battle's arena art is
  `MEFT10<param>`, param 1..29 -- the 29 STAGE packs. `sigEffect` 33..54 selects the
  per-ELEMENT EFFECT packs (MEFT1033-1055, the existing `assets/battle/backdrops/`).

Output:
  web/assets/battle/arenas/meft10NN/floor.png, wall.png   -- atlas pages (decoded RGB)
  web/assets/battle/arenas/meft10NN/geometry.json         -- spin-grouped triangles
  web/assets/battle/arenas/manifest.json                  -- byArena + byStage tables
"""
from __future__ import annotations

import importlib.util
import json
import os
import struct
import sys
from pathlib import Path

from PIL import Image

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
REPO = Path(__file__).resolve().parent.parent
EFFECT = DDW3 / "pack/dw2003/fight/effect"
OUT = REPO / "web/assets/battle/arenas"

# The 29 stage packs. 1..29 (SFSTDATA index N -> MEFT10<NN>); 0 aliases 1.
STAGE_IDS = list(range(1, 30))
MEFT_OFFSET = REPO / "docs/research/fight-3d/data/sfstdata_effect_table.json"
# Per-CLUT-group atlas page (page0 / page1) — THE decoded model, read off the live packets by
# tools/derive_arena_mesh_pages.py. Each CLUT group `(col,row)` is drawn from exactly one atlas
# page (28 captured packs, 0 conflicts). This is the primary source; MESH_PAGE_TABLE is the
# fallback for a group the capture did not cover.
CLUT_PAGE_TABLE = json.loads((REPO / "tools/arena_clut_pages.json").read_text()) \
    if (REPO / "tools/arena_clut_pages.json").exists() else {}
# Per-mesh atlas page (page0 floor / page1 wall), decoded from live battle packet captures.
# FALLBACK ONLY: the page is really a property of the CLUT group, but an uncaptured group (or a
# pack with no captured packets, e.g. meft1023) still needs a page. The pack carries no page
# field; this is the captured runtime `node.texBase0/1`.
MESH_PAGE_TABLE = json.loads((REPO / "tools/arena_mesh_pages.json").read_text()) \
    if (REPO / "tools/arena_mesh_pages.json").exists() else {}


def mesh_page(pack: str, row: int, clut_col: int) -> str:
    """Fallback per-mesh page: the captured mesh table, else the (approximate) col heuristic."""
    t = MESH_PAGE_TABLE.get(pack)
    if t is not None and str(row) in t:
        return "floor" if t[str(row)] == "p0" else "wall"
    return "floor" if clut_col == 16 else "wall"


def group_page(pack: str, row: int, clut_col: int, clut_row: int) -> str:
    """The atlas page a CLUT group `(col,row)` is drawn from.

    DECODED LIVE 2026-10-07 (tools/derive_arena_mesh_pages.py): the page is a property of the
    CLUT GROUP, not the mesh — matching every pack quad-prim's UVs against the live packets is
    unanimous per group across all 28 captured packs. The per-mesh table is a fallback only.
    """
    t = CLUT_PAGE_TABLE.get(pack)
    if t is not None:
        p = t.get(f"{clut_col},{clut_row}")
        if p is not None:
            return "floor" if p == "p0" else "wall"
    return mesh_page(pack, row, clut_col)

_spec = importlib.util.spec_from_file_location("eb", Path(__file__).with_name("extract_backdrops.py"))
eb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(eb)


def pack_name(idx: int) -> str:
    return f"meft10{idx:02d}"


def palette_at(clut_page: bytes, col: int, row: int) -> list[int]:
    """The 16-colour palette the pack's CLUT group `(col, row)` holds in page0.

    MEASURED LIVE 2026-10-07 (see .dw3-research/playtest-arena-palette-rig-2026-10-07/results.md):
    an arena primitive's packet CLUT field has X in 16-halfword VRAM units and points at one of
    the four palette groups packed into the pack's own page-0 atlas at halfword columns
    0/16/32/48, rows 254/255. `col`/`row` are the mesh prim's own `clut` (page-relative), which the
    runtime encodes as VRAM halfword (640+col, row). Each group is 16 consecutive halfwords."""
    col &= 0x3F
    row &= 0xFF
    base = (row * 64 + col) * 2
    if base + 32 > len(clut_page):
        return [0] * 16
    return [struct.unpack_from("<H", clut_page, base + k * 2)[0] for k in range(16)]


def page_rgba(page: bytes, clut_page: bytes, col: int, row: int, skip_dominant: bool = True,
              void_fill: list[int] | None = None) -> "Image.Image":
    """A 4bpp atlas page → RGBA PNG resolved with the palette group `(col, row)`.

    TRANSPARENCY IS THE CLUT ENTRY, NOT THE INDEX (corrected 2026-10-07). A PS1 texel is
    transparent when its 16-bit palette entry is exactly `0x0000` — the rule the repo already
    documents in `tools/extract_fight_effects.py:decode_atlas` ("Never infer transparency from
    the INDEX being 0 — the rule is the `cl[idx] == 0` test"). The previous version voided
    index 0 AND the page's most common index, which is wrong in both directions and is the
    discolouration the operator saw:

      * MEASURED, `meft1013 wall_c32_r255` (the scenery atlas, palette (32,255)): entry 0 is
        `(80,112,48)` — a real GREEN — and index 0 is ~48% of the page. Voiding by index
        painted all of that green with the arena background `(101,88,206)` → violet patches
        scattered across the ground (the operator's "weird colouring when you load the map").
      * MEASURED, `meft1001 floor_c32_r255` (the sky atlas): the page-dominant index 15 is the
        WHITE CLOUD step `(240,240,240)`, entry `0x7fff`. Voiding by index painted every cloud
        with the background blue → the sky went flat.

    The arena's textured quads are drawn OPAQUE (cmd 0x2C, abr 0 — decoded live 2026-10-07), so
    a transparent texel shows the arena view's own background colour (SFSTDATA +0x0c, the `bg`);
    `void_fill` supplies it. `skip_dominant` keeps the legacy debug render (the transparent texel
    left as alpha 0 instead of filled).

    THE VOID TEXEL IS ALPHA 0, NOT AN OPAQUE FILL (2026-10-07, construct fix). A texel whose CLUT
    entry is 0x0000 is SKIPPED by the PS1 GPU: it writes neither colour nor depth, so whatever is
    already in the framebuffer — the arena's sky quad, or geometry drawn behind it — shows through.
    Painting it opaque `bg` instead made those texels OCCLUDE the ground behind them, which is
    exactly the operator's "flat blue rectangular patches where rock should be" on meft1004 (its
    rock meshes carry large colour-key regions over the ground). The shared proj shader already
    DISCARDS (`web/battle3d.js` FRAG_SRC: `if (c.a < 0.05) discard;`), so shipping the key texel
    at ALPHA 0 reproduces the PS1 skip exactly. The RGB is left as the arena background so the
    texture is still self-describing for the before/after debug capture."""
    clut = palette_at(clut_page, col, row)
    vf = void_fill
    W = 256
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    px = img.load()
    for y in range(W):
        for xhw in range(64):
            hw = struct.unpack_from("<H", page, (y * 64 + xhw) * 2)[0]
            for nib in range(4):
                idx = (hw >> (4 * nib)) & 0xF
                if clut[idx] == 0:                     # the PS1 0000h texel is transparent (skipped)
                    if skip_dominant:
                        continue                       # legacy: leave it alpha 0
                    if vf is not None:
                        # shipped: transparent key — the shader discards it, geometry/sky behind shows
                        px[xhw * 4 + nib, y] = (vf[0], vf[1], vf[2], 0)
                    else:
                        px[xhw * 4 + nib, y] = (0, 0, 0, 255)   # *_void.png debug: opaque key
                    continue
                r, g, b = eb.efx.rgb5(clut[idx])[:3]
                px[xhw * 4 + nib, y] = (r, g, b, 255)
    return img


def _palette_degenerate(pal: list[int]) -> bool:
    """True when a CLUT group is blank — the pack's page-0 palette rows carry unused slots (all
    zero). The original only reaches a prim through its mesh's projection/cull (FIGHTSTG_F0x80085110
    drops back-facing and degenerate prims before packing), so a group whose palette is blank is a
    slot no visible primitive draws through. Rendering it opaque would paint black where the
    original culls (measured: 14% vs the rig frame's 4% — results.md)."""
    distinct = {c for c in pal}
    lit = sum(1 for c in distinct if ((c & 31) + ((c >> 5) & 31) + ((c >> 10) & 31)) > 6)
    return lit < 3


def arena_geometry(pack: str) -> dict:
    """Arena geometry as GROUPS keyed by (page, CLUT group).

    MEASURED LIVE 2026-10-07 (.dw3-research/playtest-arena-palette-rig-2026-10-07/results.md):
    every arena quad is drawn OPAQUE (cmd 0x2C, abr 0) and each prim carries its own CLUT
    selector into one of the pack's four palette groups (page0 rows 254/255, halfword cols
    0/16/32/48). A group = the pack's prims sharing a page AND a palette; the renderer binds the
    `(page, col, row)` texture the group names. The per-layer tint is now the group's own palette,
    not one palette for the whole page. Verts in fight-model space (battle3d: ×MODEL_SCALE, Y-neg).
    """
    groups: dict = {}
    order: list = []
    for row, (m, ctrl) in enumerate(eb.pack_meshes(pack)):
        spin = eb._spin_deg(ctrl)
        for p in m["prims"]:
            if not p.get("uv"):
                continue
            c = tuple(p["clut"])
            page = group_page(pack, row, c[0], c[1])
            key = (page, c[0], c[1])
            if key not in groups:
                groups[key] = {"page": page, "clut": [c[0], c[1]],
                               "spinDeg": round(spin, 3), "pos": [], "uv": [], "cullRef": []}
                order.append(key)
            g = groups[key]
            # STRIP/Z vertex order (0=BL,1=TL,2=BR,3=TR): split [0,1,2]+[1,3,2], not loop order.
            tri = [0, 1, 2, 1, 3, 2] if len(p["idx"]) == 4 else [0, 1, 2]
            # The original culls a PRIMITIVE with one NCLIP on its first three projected
            # vertices (SXY0,1,2), then splits the surviving quad into two triangles for the
            # GPU. Both split triangles therefore share the quad's facing, so the second
            # triangle of a quad is governed by the first — this is the per-primitive cull
            # grouping the runtime reproduces (`cullRef[t]` = the triangle whose projected
            # signed area decides whether triangle `t` is drawn). DECODED 2026-10-07 (see
            # results.md): every surviving arena packet in the captured post-cull stream has
            # NCLIP MAC0 > 0 on its first three screen vertices.
            first = len(g["pos"]) // 9
            for c2 in tri:
                v = m["verts"][p["idx"][c2]]
                g["pos"] += [v[0], v[1], v[2]]
                g["uv"] += [p["uv"][c2][0] / 256.0, p["uv"][c2][1] / 256.0]
            g["cullRef"] += [first] * (len(tri) // 3)
    return {"rotFrames": eb.ROT_FRAMES, "blend": "opaque",
            "groups": [groups[k] for k in order]}


def arena_texture_specs(pack: str) -> list[tuple[str, int, int]]:
    """The (page, col, row) palette textures this pack's arena geometry needs — one PNG per group,
    in first-use order. The renderer derives the filename `{page}_c{col}_r{row}.png`."""
    seen: list = []
    for row, (m, _ctrl) in enumerate(eb.pack_meshes(pack)):
        for p in m["prims"]:
            if not p.get("uv"):
                continue
            c = tuple(p["clut"])
            page = group_page(pack, row, c[0], c[1])
            key = (page, c[0], c[1])
            if key not in seen:
                seen.append(key)
    return seen


def sfstdata_bg(idx: int) -> list[int]:
    """The arena view's BACKGROUND colour for SFSTDATA record `idx`.

    SFSTDATA record +0x0c is a little-endian RGB triple (r | g<<8 | b<<16) — the colour the
    arena view carries (view+0x12C, the sink the ported effect-tint feed also writes). It is
    the sky: record 1 (MEFT1001) = (59,115,233), the original grassland battle's captured sky.

    FIVE-BIT TRUNCATION, MEASURED 2026-10-07. The GPU shows the colour 5 bits per channel, so
    the rig frame's sky is the param's bytes with the low three bits dropped, NOT the full
    byte: arena 1's rig sky is exactly (56,112,232) (20436 pixels) and arena 13's exactly
    (96,88,200) (19220 pixels), while the full-byte values (59,115,233)/(101,88,206) appear ZERO
    times in either frame. So each byte is masked `& 0xF8` here, matching the `v<<3` expansion
    the 5->8 bit palette path already uses.
    """
    recs = json.loads(MEFT_OFFSET.read_text())["records"]
    for r in recs:
        if r["index"] == idx:
            p = r["param"] & 0xFFFFFF
            return [(p & 0xFF) & 0xF8, ((p >> 8) & 0xFF) & 0xF8, ((p >> 16) & 0xFF) & 0xF8]
    return [1, 1, 1]


def main() -> int:
    if not EFFECT.exists():
        print(f"missing {EFFECT} (git-lfs not pulled?)", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    by_arena = {}
    ids = STAGE_IDS
    if len(sys.argv) > 1:
        ids = [int(a) for a in sys.argv[1:] if a.isdigit()]
    for idx in ids:
        pk = pack_name(idx)
        pdir = EFFECT / pk
        if not pdir.exists():
            print(f"  arena {idx}: MISSING pack {pk}")
            continue
        out = OUT / pk
        out.mkdir(parents=True, exist_ok=True)
        pages = eb.tex_pages(pk)
        # Legacy page-level renders (kept for the existing stage test) — one palette per page.
        page_rgba(pages[0], pages[0], 0, 255).save(out / "floor.png")
        page_rgba(pages[-1], pages[0], 32, 255).save(out / "wall.png")
        # Per-layer palette: one texture per (page, CLUT group) the pack's meshes reference. The
        # runtime CLUT points at the group packed in page0 at (col,row); the group's palette is the
        # layer's tint. MEASURED live 2026-10-07 (results.md §3). Rendered with skip_dominant=False
        #: the arena is drawn OPAQUE (cmd 0x2C), so every texel takes its palette colour — an
        # alpha-void texture would let the sky through where the original paints the palette.
        specs = arena_texture_specs(pk)
        wall_page = pages[1] if len(pages) > 1 else pages[0]
        bg = sfstdata_bg(idx)   # the arena view's background (SFSTDATA +0x0c) — the pack's colour key
        for page, col, row in specs:
            src = pages[0] if page == "floor" else wall_page
            # Shipped: the pack's transparent colour key resolved to the arena's own background.
            page_rgba(src, pages[0], col, row, skip_dominant=False,
                      void_fill=bg).save(out / f"{page}_c{col}_r{row}.png")
            # Debug/before only: the same atlas with the colour key left as the palette's index-0
            # entry (usually black) — the raw opaque draw that blackens the scene (results.md §5).
            page_rgba(src, pages[0], col, row, skip_dominant=False).save(out / f"{page}_c{col}_r{row}_void.png")
        geo = arena_geometry(pk)
        for grp in geo["groups"]:
            pal = palette_at(pages[0], grp["clut"][0], grp["clut"][1])
            if _palette_degenerate(pal):
                grp["degenerate"] = True
        (out / "geometry.json").write_text(json.dumps(geo))
        # Drop textures a previous run wrote for a group this pack no longer uses (the per-mesh
        # page decode changes the (page,col,row) set), so the shipped pack holds only its own.
        keep = {"geometry.json", "floor.png", "wall.png"}
        for page, col, row in specs:
            keep.add(f"{page}_c{col}_r{row}.png")
            keep.add(f"{page}_c{col}_r{row}_void.png")
        for f in out.iterdir():
            if f.is_file() and f.name not in keep:
                f.unlink()
        r = eb.pack_meshes(pk)
        vtx = sum(len(m["verts"]) for m, _ in r)
        prims = sum(len(m["prims"]) for m, _ in r)
        by_arena[str(idx)] = {"pack": pk, "bg": sfstdata_bg(idx), "clutTextures": len(specs)}
        print(f"  arena {idx:2d} -> {pk}  pages={len(pages)} meshes={len(r)} verts={vtx} prims={prims} clutTex={len(specs)}")

    # stage -> arena id, from the disc's own battle-trigger records (u16 param @record+0x4).
    by_stage = stage_arena_table()

    if ids != STAGE_IDS:
        print(f"subset run: {len(by_arena)} packs regenerated (manifest left untouched)")
        return 0

    (OUT / "manifest.json").write_text(json.dumps({
        "note": ("Ordinary-battle arena = MEFT10<trigger param> (SFSTDATA index). param is "
                 "copied to 0x80042b28 by fieldstg fn 0x800925a8 / fn 0x800927a0; SFSTDATA "
                 "record i -> MEFT10<i> (fightstg F0x80086304). Stage arenas = ids 1-29; the "
                 "element effects are the separate assets/battle/backdrops/ family."),
        "byArena": by_arena,
        "byStage": by_stage,
    }, indent=1))
    print(f"arenas: {len(by_arena)} packs, {len(by_stage)} stages -> {OUT}")
    return 0


def _record_params(data: bytes):
    """(screen, param) for every 12-byte battle-trigger record in a wstag overlay."""
    out, i, n = [], 0, len(data)
    while i + 12 <= n:
        w0, w1, w2 = struct.unpack_from("<III", data, i)
        if w0 < 0x10000 and w1 < 0x10000 and (w2 & 0xFFFF) == 0 and (w2 >> 28) == 6:
            out.append((w0, w1 & 0xFFFF))
            i += 12
        else:
            i += 4
    return out


def stage_arena_table() -> dict:
    """stage -> {screen: arenaId, _default: arenaId}, read from each wstag overlay.

    A battle-trigger record is `{screen:u16@0, _, param:u16@4, _, tag:u32@8}`; the engine
    writes `param` to 0x80042b28. The walker's battle API carries only (mapId, screenId),
    so a screen that appears with more than one param in a stage is keyed by its FIRST
    (rate-ordered) occurrence; the stage default is the first nonzero param seen.
    """
    sys.path.insert(0, str(REPO / "tools"))
    import wstag_extract as W  # noqa: PLC0415
    base = W._OVERLAY_BASE
    import re
    stages = sorted(int(m.group(1)) for p in W.ASM_DIR.glob("wstag*.s")
                    if (m := re.fullmatch(r"wstag(\d+)", p.stem)))
    table = {}
    for st in stages:
        data = W.overlay_bytes(str(st))
        if data is None:
            continue
        recs = _record_params(data)
        # walk the pointer-array zone blocks (what the engine indexes) for ordering
        rec_map, i, n = {}, 0, len(data)
        while i + 12 <= n:
            w0, w1, w2 = struct.unpack_from("<III", data, i)
            if w0 < 0x10000 and w1 < 0x10000 and (w2 & 0xFFFF) == 0 and (w2 >> 28) == 6:
                rec_map[i] = (w0, w1 & 0xFFFF)
                i += 12
            else:
                i += 4
        ordered = []
        j = 0
        while j + 36 <= n:
            words = struct.unpack_from("<9I", data, j)
            offs = [p - base for p in words[1:]]
            if all(0 <= o < n and o in rec_map for o in offs):
                ordered.extend(rec_map[o] for o in offs)
                j += 36
            else:
                j += 4
        if not ordered:
            ordered = recs
        entry, default = {}, None
        for screen, param in ordered:
            if screen and param and default is None:
                default = param
            if screen and param and str(screen) not in entry:
                entry[str(screen)] = param
        if default is not None:
            entry["_default"] = default
            table[str(st)] = entry
    return table


if __name__ == "__main__":
    raise SystemExit(main())
