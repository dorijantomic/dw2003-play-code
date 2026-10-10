#!/usr/bin/env python3
"""Census the MEFT03xx family: what binds it, and is any of it arena scenery?

Answers the open half of `docs/research/battle/battle-stage-backdrop-decode-2026-10-04.md`
§7 lead 1 ("the ~90 MEFT03xx packs") in two independent ways, both mechanical:

1. BINDING. FIGHTSTG's op6 3D-effect registry at RAM 0x800A2550 is a flat array of 12-byte
   records `{u32 id, u32 (lba<<16)|descBin, u32 (lba<<16)|metaBin}`, walked linearly until
   id == 0 (`tools/extract_fight_effects.py`). Every MEFT03xx pack is named in it, and the
   record's id IS the pack's own MEFT number -- so the pack is picked by the effect id that
   the technique's action data carries, and there is no `base + index` arithmetic anywhere.

2. ART. Every pack in the family is opened with the repo's own MEFT container decoder
   (`tools/extract_fight_effects.py`): a u32 offset directory of RLEN-compressed 256x256
   4bpp atlas pages, plus `0x10` ctrl bins, `0x18` mesh bins and a `0x04` descriptor bin.
   For each page we measure what share of its texels is the single most common index. A
   painted sky, a grass ground or a rock face is a FILLED sheet -- one flat index would
   never dominate it. A sprite/effect sheet leaves most of the page at the transparent
   index, so one index does dominate it.

Sources (read-only):
  ~/ddw3/asm/dw2003/pro/fightstg.s   the op6 registry's .word rows
  ~/ddw3/iso/dw2003-bootstrap/lbas.toml  the disc's own LBA -> file-name table
  ~/ddw3/pack/dw2003/fight/effect/meft03*/  the already-unpacked packs

Output: docs/research/battle/data/battle-arena-meft03-census.json
"""
from __future__ import annotations

import json
import re
import struct
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DDW3 = Path.home() / "ddw3"
FIGHTSTG = DDW3 / "asm/dw2003/pro/fightstg.s"
LBAS = DDW3 / "iso/dw2003-bootstrap/lbas.toml"
EFFECT = DDW3 / "pack/dw2003/fight/effect"
OUT = REPO / "docs/research/battle/data/battle-arena-meft03-census.json"

REGISTRY_BASE = 0x800A2550
REGISTRY_STRIDE = 12
PAGE_W = PAGE_H = 256


def unrlen(blob: bytes) -> bytes:
    if blob[:4] != b"RLEN":
        raise ValueError("bad RLEN magic %r" % blob[:4])
    total = struct.unpack_from("<I", blob, 4)[0]
    out = bytearray()
    i = 8
    while len(out) < total:
        op = blob[i]
        i += 1
        if op < 0x80:
            out += blob[i:i + op]
            i += op
        else:
            out += bytes([blob[i]]) * (op - 0x80)
            i += 1
    return bytes(out)


def lba_names() -> list[str]:
    names: list[str] = []
    inside = False
    for line in LBAS.read_text().splitlines():
        s = line.strip()
        if s.startswith("lbas"):
            inside = True
            continue
        if not inside:
            continue
        m = re.match(r'^"([A-Za-z0-9_]+)",?$', s)
        if m:
            names.append(m.group(1))
        elif s == "]":
            break
    return names


def fightstg_words() -> dict[int, int]:
    words: dict[int, int] = {}
    for line in FIGHTSTG.read_text().splitlines():
        m = re.match(r"\.L0x(800[89ab][0-9a-f]{4}): \.word (0x[0-9a-f]+)$",
                     line.split("#", 1)[0].rstrip())
        if m:
            words[int(m.group(1), 16)] = int(m.group(2), 16)
    return words


def registry(words: dict[int, int]) -> list[dict]:
    """Walk 12-byte records from REGISTRY_BASE until the id word is zero."""
    out = []
    addr = REGISTRY_BASE
    while True:
        pid = words.get(addr)
        if pid is None or pid == 0:
            break
        w1 = words.get(addr + 4)
        w2 = words.get(addr + 8)
        if w1 is None or w2 is None:
            break
        out.append({
            "index": len(out),
            "ram": addr,
            "id": pid,
            "lba": w1 >> 16,
            "desc_bin": w1 & 0xFFFF,
            "meta_lba": w2 >> 16,
            "meta_bin": w2 & 0xFFFF,
        })
        addr += REGISTRY_STRIDE
    return out


def atlas_pages(pdir: Path):
    """Yield (bin name, page index, 256x256 4bpp page bytes)."""
    for f in sorted(pdir.glob("*.bin"), key=lambda x: int(x.stem)):
        b = f.read_bytes()
        offs, i = [], 0
        while i + 4 <= len(b) and len(offs) < 8:
            (o,) = struct.unpack_from("<I", b, i)
            if o == 0:
                break
            if o >= len(b):
                offs = []
                break
            offs.append(o)
            i += 4
        if not offs:
            continue
        if not (0 <= b.find(b"RLEN", offs[0]) - offs[0] <= 32):
            continue
        for k, o in enumerate(offs):
            raw = unrlen(b[b.find(b"RLEN", o):])
            yield f.stem, k, (raw[20:] if len(raw) > 20 else raw)


def page_share(page: bytes) -> float:
    """Share of texels holding the page's single most common index."""
    hist = [0] * 16
    n = len(page) // 2
    for i in range(n):
        hw = struct.unpack_from("<H", page, i * 2)[0]
        hist[hw & 0xF] += 1
        hist[(hw >> 4) & 0xF] += 1
        hist[(hw >> 8) & 0xF] += 1
        hist[(hw >> 12) & 0xF] += 1
    total = sum(hist) or 1
    return max(hist) / float(total)


def main() -> int:
    if not FIGHTSTG.exists() or not EFFECT.is_dir():
        sys.stderr.write("ddw3 sources not present; nothing to census\n")
        return 2
    names = lba_names()
    words = fightstg_words()
    reg = registry(words)

    # ---- 1. binding ---------------------------------------------------------
    bound: dict[str, dict] = {}
    for r in reg:
        nm = names[r["lba"]] if r["lba"] < len(names) else "?"
        base = nm[:-4] if nm.endswith("_BIN") else nm
        rec = dict(r, name=nm, pack=base.lower())
        # a duplicated record is a fact about the shipped data, not a second pack
        bound.setdefault(base, rec)

    packs = {}
    for pdir in sorted(EFFECT.glob("meft03*")):
        if not pdir.is_dir():
            continue
        pages = []
        for bin_name, k, page in atlas_pages(pdir):
            if len(page) < PAGE_W * PAGE_H // 2:
                continue
            pages.append({"bin": int(bin_name), "page": k,
                          "flat_index_share": round(page_share(page), 4)})
        nmesh = sum(1 for f in pdir.glob("*.bin")
                    if f.stat().st_size >= 4
                    and struct.unpack_from("<I", f.read_bytes(), 0)[0] == 0x18)
        rec = bound.get(pdir.name.upper())
        packs[pdir.name] = {
            "lba": rec["lba"] if rec else None,
            "registry_id": rec["id"] if rec else None,
            "registry_desc_bin": rec["desc_bin"] if rec else None,
            "registry_meta_bin": rec["meta_bin"] if rec else None,
            "pack_number": int(pdir.name[-4:]),
            "mesh_bins": nmesh,
            "atlas_pages": pages,
            "min_flat_index_share": min((p["flat_index_share"] for p in pages), default=None),
        }

    all_ids = [r["id"] for r in reg]
    dupes = sorted({i for i in all_ids if all_ids.count(i) > 1})
    out = {
        "registry": {
            "ram_base": REGISTRY_BASE,
            "stride": REGISTRY_STRIDE,
            "record": "{u32 id, u32 (lba<<16)|descBin, u32 (lba<<16)|metaBin}",
            "terminator": "id == 0",
            "records": len(reg),
            "rows": reg,
        },
        "meft03": {
            "packs": len(packs),
            "bound_by_registry": sum(1 for p in packs.values() if p["registry_id"] is not None),
            "keyed_by_own_number": sum(
                1 for p in packs.values()
                if p["registry_id"] is not None and p["registry_id"] == p["pack_number"]),
            "duplicate_registry_ids": dupes,
            "min_flat_index_share_over_all_pages": min(
                (p["min_flat_index_share"] for p in packs.values()
                 if p["min_flat_index_share"] is not None), default=None),
            "rows": packs,
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")
    m = out["meft03"]
    print("op6 registry %s: %d records (RAM 0x%X, %d-byte stride)"
          % (out["registry"]["record"], len(reg), REGISTRY_BASE, REGISTRY_STRIDE))
    print("MEFT03xx packs on disc: %d, bound by the registry: %d, keyed by their own number: %d"
          % (m["packs"], m["bound_by_registry"], m["keyed_by_own_number"]))
    print("duplicate registry ids: %s" % (m["duplicate_registry_ids"] or "none"))
    print("flattest atlas page in the whole family: %.1f%% of texels at one index"
          % (100.0 * m["min_flat_index_share_over_all_pages"]))
    print("wrote %s" % OUT.relative_to(REPO))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())