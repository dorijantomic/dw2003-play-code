#!/usr/bin/env python3
"""Extract the per-element special-attack BACKDROPS (MEFT1033-1055) as 3D meshes + atlas textures.

CONFIRMED 2026-07-07 (live PS1 rig capture + disasm): a special fires a full-screen backdrop =
`MEFT10<tech.sigEffect>` (fallback MEFT1055 data-field when sigEffect==0). sigEffect (fight_tech_table
+0x0d) is per-element: fire 33/34, water 36/37, ice 39/40, wind 42/43, thunder 45/46, machine 48/49,
dark 51/52, normal 53/54. See docs/research/fight-3d/special-attack-backdrop-decode.md §11-13.

The backdrop is a 3D scene: each pack's `0x18` MESHES (wall ring + floor), drawn additively (abr=1)
through the SAME battle camera as the fighters (proven: the captured screen quads = the meshes
projected through the default OP5 preset; battle-camera.md). So the port renders each element's own
meshes through the live camera — no per-element rig capture, no baked image. The one thunder capture
(slot1) was the oracle that pinned the camera + the clut→page mapping.

Pack layout: program bin = {u32 texIdx, u32 count, count×(z, meshIdx, ctrlIdx)}; each meshIdx is a
0x18 mesh (verts + UV'd prims). texIdx = the two-page atlas bin (page0 → floor / VRAM tpage 0x2a,
page1 → wall / tpage 0x2b). The CLUTs live in page0's lower rows (page1 has none). Per-prim page:
clut (16,255) → floor, clut (0/32,255) → wall (learned from the thunder capture; meshes are shared
across elements so it holds for all).

Output: web/assets/battle/backdrops/
  meft10NN/floor.png, wall.png   — the two atlas pages, decoded RGB via page0's element CLUT
  meft10NN/geometry.json         — [{page:"floor"|"wall", pos:[x,y,z,...], uv:[u,v,...]}] triangles
  manifest.json                  — byTech {techId: sigEffect}, bySig {sig: {pack, element}}
"""
from __future__ import annotations
import os

import importlib.util
import json
import struct
import sys
from pathlib import Path

from PIL import Image

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
REPO = Path(__file__).resolve().parent.parent
EFFECT = DDW3 / "pack/dw2003/fight/effect"
OUT = REPO / "web/assets/battle/backdrops"

_spec = importlib.util.spec_from_file_location("efx", Path(__file__).with_name("extract_fight_effects.py"))
efx = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(efx)


def pack_name(idx: int) -> str:
    return f"meft10{idx:02d}"


def tex_pages(pack: str) -> list[bytes]:
    sf = json.loads((REPO / "docs/research/fight-3d/data/sfstdata_effect_table.json").read_text())["records"]
    prog = {r["index"]: r["binProgram"] for r in sf}
    idx = int(pack[-2:])
    pdir = EFFECT / pack
    desc = (pdir / f"{prog[idx]}.bin").read_bytes()
    tex_idx = struct.unpack_from("<I", desc, 0)[0]
    tb = (pdir / f"{tex_idx}.bin").read_bytes()
    offs, i = [], 0
    while i + 4 <= len(tb):
        (o,) = struct.unpack_from("<I", tb, i)
        if o == 0:
            break
        offs.append(o)
        i += 4
    return [efx.unrlen(tb[tb.find(b"RLEN", o):])[20:] for o in offs]


def pack_meshes(pack: str):
    """The pack's program table → list of (mesh dict, ctrl dict) with textured prims + animation.
    ctrl (0x10 bin) holds the layer's keyframed rotation — the backdrop's SPIN (Y-axis, PS1 angle
    units 4096=360°): floor +1024 (90°), accent wall ±2048 (180°) over 121 frames then hold; main
    wall static. See decode_ctrl / special-attack-backdrop-decode.md §14."""
    sf = json.loads((REPO / "docs/research/fight-3d/data/sfstdata_effect_table.json").read_text())["records"]
    prog = {r["index"]: r["binProgram"] for r in sf}
    idx = int(pack[-2:])
    pdir = EFFECT / pack
    desc = (pdir / f"{prog[idx]}.bin").read_bytes()
    _tex, count = struct.unpack_from("<2I", desc, 0)
    table = [struct.unpack_from("<3I", desc, 8 + k * 12) for k in range(count)]
    out = []
    for _z, mi, ci in table:
        try:
            m = efx.decode_mesh(pdir / f"{mi}.bin")
        except Exception:  # noqa: BLE001
            continue
        try:
            c = efx.decode_ctrl((pdir / f"{ci}.bin").read_bytes())
        except Exception:  # noqa: BLE001
            c = None
        out.append((m, c))
    return out


ROT_FRAMES = 121   # ctrl reaches its target angle at frame 121, then holds (30000 sentinel)


def _spin_deg(ctrl) -> float:
    """Target Y-spin (degrees) from a ctrl's rotation track. Key = [frame, x, y, z]; y at frame 121
    is the target (PS1 4096 = 360°). 0 for a static layer."""
    if not ctrl or not ctrl.get("r"):
        return 0.0
    target = 0
    for f, _x, y, _z in ctrl["r"]:
        if 0 < f < 30000:
            target = y
    return target * 360.0 / 4096.0


def _dominant(page: bytes) -> int:
    hist = [0] * 16
    for i in range(len(page) // 2):
        hw = struct.unpack_from("<H", page, i * 2)[0]
        for nib in range(4):
            hist[(hw >> (4 * nib)) & 0xF] += 1
    return max(range(16), key=lambda k: hist[k])


def best_clut(clut_page: bytes, void: int) -> list[int]:
    """Best element ramp in page0's lower rows (page1/wall has no CLUT of its own; scanning it hits a
    degenerate all-white row → blanks the wall). Reject all-same rows; prefer saturated + dark-void."""
    best = None
    for row in range(248, 256):
        for col in range(0, 48):
            base = (row * 64 + col) * 2
            cols = [struct.unpack_from("<H", clut_page, base + k * 2)[0] for k in range(16)]
            if len(set(cols)) < 4:
                continue
            rgb = [efx.rgb5(c)[:3] for c in cols]
            sat = sum(max(r, g, b) - min(r, g, b) for r, g, b in rgb)
            vr, vg, vb = rgb[void]
            score = sat - (vr + vg + vb) * 4
            if best is None or score > best[0]:
                best = (score, row, col)
    base = (best[1] * 64 + best[2]) * 2
    return [struct.unpack_from("<H", clut_page, base + k * 2)[0] for k in range(16)]


def page_png(page: bytes, clut_page: bytes, depth: int = 10) -> Image.Image:
    """4bpp page → RGB PNG via page0's element CLUT. Drawn additively in-engine, so the void (0xffff
    fill, which the CLUT decodes to black) contributes nothing. BUT the flame/effect texture has
    void GAPS *inside* the dense band that the real game fills with overlapping additive layers — in
    our per-mesh render they'd show as black patches. So we fill SMALL void gaps that are surrounded
    by texture with a dim element glow (a fraction of the local colour), while leaving LARGE void
    regions (the sky above the band) black. Distinguished by neighbourhood density."""
    void = _dominant(page)
    clut = best_clut(clut_page, void)
    W = 256
    rgb = [[(0, 0, 0)] * W for _ in range(W)]
    filled = [[False] * W for _ in range(W)]
    for y in range(W):
        for xhw in range(64):
            hw = struct.unpack_from("<H", page, (y * 64 + xhw) * 2)[0]
            for nib in range(4):
                idx = (hw >> (4 * nib)) & 0xF
                x = xhw * 4 + nib
                if idx != void:
                    rgb[y][x] = efx.rgb5(clut[idx])[:3]
                    filled[y][x] = True

    # Inpaint the void GAPS inside the dense band: the flame/effect texture is transparent (0xffff)
    # between tongues, which the real game fills with overlapping additive layers. We grow the texture
    # inward for `depth` passes, dimming each step, so gaps (even big blobs) fill with the surrounding
    # colour (dim toward their centre) instead of pure-black holes; void farther than `depth` from any
    # texture stays black. Fewer passes for the floor (its large dark areas should stay dark).
    for _ in range(depth):
        add = []
        for y in range(W):
            row, frow = rgb[y], filled[y]
            for x in range(W):
                if frow[x]:
                    continue
                sr = sg = sb = n = 0
                for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= yy < W and 0 <= xx < W and filled[yy][xx]:
                        cr, cg, cb = rgb[yy][xx]; sr += cr; sg += cg; sb += cb; n += 1
                if n:
                    add.append((y, x, (sr * 82 // (n * 100), sg * 82 // (n * 100), sb * 82 // (n * 100))))
        if not add:
            break
        for y, x, c in add:
            rgb[y][x] = c; filled[y][x] = True

    img = Image.new("RGB", (256, 256))
    px = img.load()
    for y in range(W):
        for x in range(W):
            px[x, y] = rgb[y][x]
    return img


def geometry(pack: str):
    """Triangulated backdrop geometry as a list of SPIN GROUPS. Each group = the prims of one mesh
    layer that share a rotation (the ctrl's Y-spin) — battle3d rotates each group about Y over the
    cast (spinDeg over ROT_FRAMES then holds). page (floor page0 / wall page1) picks the texture;
    clut (16,*) → floor, else wall. Verts in fight-model space (battle3d: × MODEL_SCALE, Y-negated)."""
    groups = []
    for m, ctrl in pack_meshes(pack):
        spin = _spin_deg(ctrl)
        pos, uv, page = [], [], "wall"
        for p in m["prims"]:
            if not p.get("uv"):
                continue
            page = "floor" if tuple(p["clut"])[0] == 16 else "wall"
            # MEFT quads store verts in STRIP/Z order (0=BL,1=TL,2=BR,3=TR), not loop order — so the
            # split is [0,1,2]+[1,3,2] (diagonal TL→BR). The loop split [0,1,2]+[0,2,3] used the
            # bottom EDGE as a diagonal → folded triangles = the black-triangle checkerboard.
            tri = [0, 1, 2, 1, 3, 2] if len(p["idx"]) == 4 else [0, 1, 2]
            for c in tri:
                v = m["verts"][p["idx"][c]]
                pos += [v[0], v[1], v[2]]
                uv += [p["uv"][c][0] / 256.0, p["uv"][c][1] / 256.0]
        if pos:
            groups.append({"page": page, "spinDeg": round(spin, 3), "pos": pos, "uv": uv})
    return {"rotFrames": ROT_FRAMES, "groups": groups}


def main() -> int:
    if not EFFECT.exists():
        print(f"missing {EFFECT} (git-lfs not pulled?)", file=sys.stderr)
        return 1
    tech = json.loads((REPO / "web/assets/data/fight_tech_table.json").read_text())
    skills = {s["id"]: s for s in
              json.loads((REPO / "web/assets/data/digimon.json").read_text())["skills"]}
    by_tech, sig_element = {}, {}
    for tid, r in tech.items():
        s = skills.get(int(tid))
        if not s or s.get("tech_basic"):
            continue
        by_tech[str(tid)] = r["sigEffect"]
        if r["sigEffect"]:
            sig_element.setdefault(r["sigEffect"], s["element"])

    # SFSTDATA rec[+0x08] = the index into fightstg's eight-word packed-sound table
    # (0x800a2498 = BT_LOOP0..7). F0x80086304 starts it with the pack and stops it by
    # (id, voice handle) when the pack tears down, so it is exactly the element
    # backdrop's own sustained sound.
    sfst = {r["index"]: r for r in json.loads(
        (REPO / "docs/research/fight-3d/data/sfstdata_effect_table.json").read_text())["records"]}

    OUT.mkdir(parents=True, exist_ok=True)
    by_sig = {}
    for sig in sorted(set(sig_element) | {0}):
        idx = 55 if sig == 0 else sig
        pk = pack_name(idx)
        out = OUT / pk
        out.mkdir(parents=True, exist_ok=True)
        pages = tex_pages(pk)
        # Wall is all flame band → fill its 0xffff gaps deeply (dense fire, no black holes; the sky
        # void is a separate quad). Floor has real dark areas → shallow fill so they stay dark.
        page_png(pages[0], pages[0], depth=4).save(out / "floor.png")     # page0 = floor (tpage 0x2a)
        page_png(pages[-1], pages[0], depth=12).save(out / "wall.png")    # page1 = wall  (tpage 0x2b)
        (out / "geometry.json").write_text(json.dumps(geometry(pk)))
        snd = sfst.get(idx, {}).get("sound", -1)
        by_sig[str(sig)] = {"pack": pk, "element": sig_element.get(sig, "data"),
                            "sound": snd}
        print(f"  sig {sig:2d} → {pk} ({sig_element.get(sig, 'data')}) sound={snd}")

    (OUT / "manifest.json").write_text(json.dumps({
        "note": "special-attack backdrop = MEFT10<tech.sigEffect> (sig 0 = meft1055). 3D meshes drawn "
                "additively through the battle camera (battle-camera.md). Confirmed live 2026-07-07.",
        "byTech": by_tech, "bySig": by_sig, "fallbackSig": 0,
    }, indent=1))
    print(f"backdrops: {len(by_sig)} packs, {len(by_tech)} techs mapped → {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
