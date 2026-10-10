#!/usr/bin/env python3
"""Build native overlay images for the wstag MIPS interpreter (P1/P2 of
docs/specs/2026-07-04-wstag-native-interpreter-design.md).

Everything is extracted from the decomp repo's disassembly
(~/ddw3/asm/dw2003/pro/wstagNNN.s) — the .s files carry the complete overlay
image as `.word` annotations (both the plain data form and the `# .word`
instruction-comment form; missing the latter falsified two earlier claims —
same lesson as tools/overlay_scan.py).

Per stage this emits:
  web/assets/native/sNNN.bin   — the raw overlay image (loads at 0x800A5DE0)
and one shared manifest:
  web/assets/native/manifest.json — per stage: image size, event-table offset,
    init-fn offset (the data word at eventTable-4), root-ctor offset (the
    function that loads that word — the fn the game stores at descriptor+0x04),
    every allocator call site {ctor_fn, cb, size, extra}, and effect-registry
    handler ids.

Stage selection: every overlay with ≥2 allocator calls (1 alloc = the
universal stage-root boilerplate) or ≥1 effect-registry id — the ambience
census criteria (docs/research/field/wstag-native-ambience-census-2026-07-04.txt).

Usage:
  python3 tools/build_native_overlays.py            # write assets + manifest
  python3 tools/build_native_overlays.py s780       # one stage, print info
"""

from __future__ import annotations
import os

import json
import re
import struct
import sys
from pathlib import Path

ASM_DIR = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro"
OUT_DIR = Path(__file__).parent.parent / "web/assets/native"
OVERLAY_BASE = 0x800A5DE0

ALLOC = 0x80014504  # (cb, size, extra)
ALLOC_ID = 0x800143DC  # (cb, size, extra, id)

WORD_RE = re.compile(
    r"\.L0x([0-9a-f]{8}): (?:\.word 0x([0-9a-f]+)|.*?# \.word 0x([0-9a-f]+))"
)


def load_image(path: Path) -> bytes:
    """Reconstruct the overlay image, keyed by the .s file-offset labels."""
    words: dict[int, int] = {}
    for m in WORD_RE.finditer(path.read_text()):
        words[int(m.group(1), 16)] = int(m.group(2) or m.group(3), 16)
    if not words:
        return b""
    size = max(words) + 4
    img = bytearray(size)
    for off, w in words.items():
        struct.pack_into("<I", img, off, w)
    return bytes(img)


def is_overlay_ptr(v: int, size: int) -> bool:
    return OVERLAY_BASE <= v < OVERLAY_BASE + size


def is_code_ptr(v: int, size: int) -> bool:
    """Overlay, fieldstg (0x80082cb0+) or main-EXE pointer — event records may
    reference resident fieldstg/EXE handlers (e.g. s740's native_fn)."""
    return is_overlay_ptr(v, size) or 0x80010000 <= v < 0x800A5DE0


def is_valid_flag(flag: int) -> bool:
    if flag == 0 or flag < 0x100:
        return True
    return ((flag >> 24) & 0xFF) in (0x01, 0x03, 0x05, 0x07, 0x09, 0x11, 0x13, 0x15)


def find_event_tables(data: bytes) -> list[tuple[int, int]]:
    """Candidate (file offset, record count) event tables, best-first.

    A table is 0x14-byte records ending at a 0xffffffff terminator; stages
    without events have an EMPTY table (bare terminator), so zero-record
    candidates are included when the word before the terminator looks like an
    init-fn slot (an overlay code pointer) — the caller disambiguates by
    finding the function that loads that slot.
    """
    sz = len(data)
    out: list[tuple[int, int]] = []
    for off in range(0, sz - 4, 4):
        if struct.unpack_from("<I", data, off)[0] != 0xFFFFFFFF:
            continue
        n, cur = 0, off - 0x14
        while cur >= 0:
            eid, scr, flag, nat, comp = struct.unpack_from("<5I", data, cur)
            if eid > 0x7FFF:
                break
            if scr != 0 and not is_overlay_ptr(scr, sz):
                break
            if any(p != 0 and not is_code_ptr(p, sz) for p in (nat, comp)):
                break
            if (scr == 0 and nat == 0) or not is_valid_flag(flag):
                break
            n += 1
            cur -= 0x14
        if n > 0:
            out.append((cur + 0x14, n))
        elif off >= 4 and is_overlay_ptr(struct.unpack_from("<I", data, off - 4)[0], sz):
            out.append((off, 0))  # empty table: the terminator IS the table
    out.sort(key=lambda t: -t[1])
    return out


def scan_code(data: bytes):
    """Yield (off, word, consts) with linear lui/addiu/ori const tracking."""
    regs: dict[int, int | None] = {}
    for off in range(0, len(data) - 3, 4):
        (w,) = struct.unpack_from("<I", data, off)
        yield off, w, dict(regs)
        op = w >> 26
        rs, rt = (w >> 21) & 31, (w >> 16) & 31
        imm = w & 0xFFFF
        simm = imm - 0x10000 if imm >= 0x8000 else imm
        if op == 0x0F:
            regs[rt] = (imm << 16) & 0xFFFFFFFF
        elif op == 0x0D:
            regs[rt] = imm if rs == 0 else ((regs[rs] | imm) if regs.get(rs) is not None else None)
        elif op in (0x08, 0x09):
            if rs == 0:
                regs[rt] = simm & 0xFFFFFFFF
            elif regs.get(rs) is not None:
                regs[rt] = (regs[rs] + simm) & 0xFFFFFFFF
            else:
                regs[rt] = None
        elif op == 0 and (w & 0x3F) == 0x21:
            rd = (w >> 11) & 31
            a, b = regs.get(rs), regs.get(rt)
            regs[rd] = None if a is None or b is None else (a + b) & 0xFFFFFFFF
        elif op == 0:
            rd = (w >> 11) & 31
            if rd:
                regs[rd] = None
        elif 0x20 <= op <= 0x26:
            if rt:
                regs[rt] = None


def fn_start(data: bytes, off: int) -> int:
    """Back-scan for the enclosing function prologue (addiu sp, sp, -X)."""
    cur = off
    while cur >= 4:
        (w,) = struct.unpack_from("<I", data, cur)
        if (w >> 16) == 0x27BD and (w & 0x8000):  # addiu sp, sp, negative
            return cur
        cur -= 4
    return 0


def find_alloc_sites(data: bytes) -> list[dict]:
    """Every jal to an allocator, with const-tracked args."""
    jal_alloc = 0x0C000000 | ((ALLOC >> 2) & 0x03FFFFFF)
    jal_alloc_id = 0x0C000000 | ((ALLOC_ID >> 2) & 0x03FFFFFF)
    sites = []
    snap = list(scan_code(data))
    for i, (off, w, _) in enumerate(snap):
        if w != jal_alloc and w != jal_alloc_id:
            continue
        # args visible after the delay slot executes
        regs = snap[i + 2][2] if i + 2 < len(snap) else {}
        sites.append(
            {
                "site": off,
                "ctor_fn": fn_start(data, off),
                "cb": regs.get(4),
                "size": regs.get(5),
                "extra": regs.get(6) or 0,
                "with_id": w == jal_alloc_id,
            }
        )
    return sites


def find_root_ctor(data: bytes, sites: list[dict]) -> tuple[int, int]:
    """(init_fn RAM addr, root ctor file offset).

    Stage entry convention (verified on s780, docs/research/field/s780 doc
    §allocator): the root ctor allocs the stage-root object, then loads a
    data slot holding the descriptor-init fn pointer and jalr's it. On stages
    with an event table the slot is the word at eventTable-4; on event-less
    stages it is a bare trailing data word — so we search for the pattern
    directly: inside an alloc-calling function, `lw rX, [const slot]` where
    the slot's word is an overlay code pointer, followed shortly by `jalr rX`.
    """
    ctor_fns = {s["ctor_fn"] for s in sites}
    snap = list(scan_code(data))
    for i, (off, w, regs) in enumerate(snap):
        if (w >> 26) != 0x23:  # lw
            continue
        rs = (w >> 21) & 31
        rt = (w >> 16) & 31
        imm = w & 0xFFFF
        simm = imm - 0x10000 if imm >= 0x8000 else imm
        base = regs.get(rs)
        if base is None:
            continue
        slot = ((base + simm) & 0xFFFFFFFF) - OVERLAY_BASE
        if not (0 <= slot <= len(data) - 4):
            continue
        init_ptr = struct.unpack_from("<I", data, slot)[0]
        if not is_overlay_ptr(init_ptr, len(data)):
            continue
        # jalr of the loaded register within the next few instructions
        for j in range(1, 5):
            if i + j >= len(snap):
                break
            w2 = snap[i + j][1]
            if (w2 >> 26) == 0 and (w2 & 0x3F) == 0x09 and ((w2 >> 21) & 31) == rt:
                fn = fn_start(data, off)
                if fn in ctor_fns:
                    return init_ptr, fn
    return 0, -1


def effect_ids(data: bytes) -> list[int]:
    """Effect-registry ids compared/handled in code (0x320..0x357).

    Counted from instruction immediates (addiu/ori/slti/li forms), not raw
    text — a bare regex over the .s also matches data words and over-selects.
    """
    ids = set()
    for off in range(0, len(data) - 3, 4):
        (w,) = struct.unpack_from("<I", data, off)
        op = w >> 26
        if op in (0x08, 0x09, 0x0A, 0x0B, 0x0D):  # addi(u)/slti(u)/ori
            imm = w & 0xFFFF
            if 0x320 <= imm <= 0x357:
                ids.add(imm)
    return sorted(ids)


def claims_point_table(data: bytes) -> bool:
    """Native code reads the shared point table ([0x80099D90] = descriptor+0x10)
    — the stage-coverage audit's point_actor_unparsed signal. A stage whose ONLY
    alloc is such an actor (s421: windmills spin iff flag 0x1a0a) is a real
    ambience machine, not root boilerplate, so it belongs in the manifest."""
    return any(
        (w >> 26) == 0x23 and (w & 0xFFFF) == 0x9D90
        for (w,) in struct.iter_unpack("<I", data[: len(data) & ~3])
    )


def build_stage(name: str, entry_only: bool = False) -> tuple[bytes, dict] | None:
    path = ASM_DIR / f"wstag{name}.s"
    if not path.exists():
        return None
    data = load_image(path)
    if not data:
        return None
    sites = find_alloc_sites(data)
    fx = effect_ids(data)
    if len(sites) < 2 and not fx and not claims_point_table(data) and not entry_only:
        return None  # 1 alloc = universal stage-root boilerplate only
    tables = find_event_tables(data)
    table_off = tables[0][0] if tables else -1
    init_ptr, root_ctor = find_root_ctor(data, sites)
    return data, {
        "size": len(data),
        "event_table": table_off,
        "init_fn": (init_ptr - OVERLAY_BASE) if is_overlay_ptr(init_ptr, len(data)) else -1,
        "root_ctor": root_ctor,
        "allocs": sites,
        "effect_ids": fx,
    }


FIELDSTG_IDX = 358  # LBA file index of FIELDSTG.PRO (lba.rs LBA_FIELDSTG_PRO_IDX)


def extract_fieldstg() -> bytes:
    """The full FIELDSTG.PRO image (loads at 0x80082CB0). Carries the static
    tables stage native code reads through fieldstg pointers — including the
    effect registry at 0x8009B3E8 ({id, construct_fn, draw_fn} × 56, ids
    0x320-0x357 with per-stage overlay ctor addresses BAKED IN — static disc
    data, NOT runtime-populated BSS; this falsifies the 2026-07-02 registry
    doc's population claim). The asm .s only covers the code region
    (0x0..0x10158); the data tail lives in rust/dw2003_pro_fieldstg. Read the
    whole file from the disc image like the other extractors."""
    sys.path.insert(0, str(Path(__file__).parent))
    from extract_point_sprites import Disc, DISC

    return Disc(DISC).file(FIELDSTG_IDX)


def extract_sine_table() -> list[int]:
    """The EXE trig table used by F0x8002abcc (sin) / F0x8002ac9c (cos):
    signed halfwords at 0x80055888..0x8005688a (data.rs of the decomp),
    quarter-wave indexed with base 0x80056088. Extracted verbatim."""
    txt = (Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "rust/dw2003_exe_data/src/data.rs").read_text()
    words: dict[int, int] = {}
    for m in re.finditer(r'D0x(80[0-9a-f]{6}) @ "0x\1": u32 = 0x([0-9a-f]+)', txt):
        words[int(m.group(1), 16)] = int(m.group(2), 16)
    out: list[int] = []
    for a in range(0x80055888, 0x8005688C, 4):
        w = words.get(a, 0)
        for v in (w & 0xFFFF, w >> 16):
            out.append(v - 0x10000 if v >= 0x8000 else v)
    return out


def extract_rand_table() -> list[int]:
    """The EXE's ONE random table: 4096 halfwords at 0x8004bc04 (data.rs of the
    decomp, `RAND_TABLE @ "0x8004bc04": [u16; 0x1000]`), walked by
    `rand_u16` (exe/fns.s:10116-10134) off the index word at 0x8004dc04.
    Extracted verbatim, in table order, so the index is the table offset."""
    txt = (Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "rust/dw2003_exe_data/src/data.rs").read_text()
    m = re.search(r'RAND_TABLE @ "0x8004bc04": \[u16; 0x1000\] = \[(.*?)\];', txt, re.S)
    if not m:
        raise SystemExit("RAND_TABLE not found in the EXE data image")
    vals = [int(v, 16) for v in re.findall(r"0x([0-9a-f]{4})", m.group(1))]
    if len(vals) != 0x1000:
        raise SystemExit(f"RAND_TABLE has {len(vals)} entries, expected 4096")
    return vals


def main() -> None:
    argv = sys.argv[1:]
    entry_only = "--entry-only" in argv
    arrival = "--arrival" in argv
    completion = "--completion" in argv
    only = [a.lstrip("s") for a in argv if not a.startswith("--")]
    # The arrival-dispatcher oracle (tests/lane-b/scene-arrival.test.js) runs every
    # overlay's own stage-entry tick, so it needs an image for every stage that HAS
    # one -- not only the stages the ambience census selected. The list is the
    # extractor's own output, so it cannot drift from the dispatchers.
    if arrival and not only:
        ac = Path(__file__).resolve().parent.parent / "web/assets/data/scene/arrival_candidates.json"
        only = sorted(k[1:] for k in json.loads(ac.read_text())["stages"])
    # Same, for the scene-completion oracle (tests/lane-b/scene-completion.test.js):
    # it runs each event's own on_complete routine, so it needs every stage that
    # ships one.
    if completion and not only:
        sc = Path(__file__).resolve().parent.parent / "web/assets/data/scene/scene_completion.json"
        only = sorted(k[1:] for k in json.loads(sc.read_text())["stages"])
    stages = only or sorted(
        p.stem[len("wstag"):] for p in ASM_DIR.glob("wstag*.s")
    )
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if entry_only or completion:
        # Research instrumentation: stages whose only native object is the
        # story-event entry itself were skipped by the default build as "root
        # boilerplate" (the walker implements the story layer in JS). The call
        # journal still needs to observe that entry, so these images and their
        # separate manifest are built on request and never loaded by the game.
        if not only and not arrival:
            raise SystemExit("--entry-only needs stage names, e.g. --entry-only 200 206")
        manifest: dict[str, dict] = {}
        for st in stages:
            built = build_stage(st, entry_only=True)
            if built is None:
                print(f"s{st}: not buildable")
                continue
            data, info = built
            manifest[f"s{st}"] = info
            (OUT_DIR / f"s{st}.bin").write_bytes(data)
        name = ("manifest_completion.json" if completion else
                "manifest_arrival.json" if arrival else "manifest_entry_only.json")
        (OUT_DIR / name).write_text(json.dumps(manifest, indent=1) + "\n")
        total = sum(v["size"] for v in manifest.values())
        print(f"wrote {len(manifest)} entry-only overlay images ({total >> 10} KiB)")
        return
    manifest = {}
    for st in stages:
        built = build_stage(st)
        if built is None:
            continue
        data, info = built
        manifest[f"s{st}"] = info
        if not only:
            (OUT_DIR / f"s{st}.bin").write_bytes(data)
        else:
            print(f"s{st}:", json.dumps(info, indent=1))
    if not only:
        (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
        (OUT_DIR / "exe_tables.json").write_text(
            json.dumps({
                "sin_table_base": 0x80055888,
                "halfwords": extract_sine_table(),
                # The game's single random stream: the table rand_u16 walks, and the
                # address of each cell in the service block that holds the index, the
                # seed setter and the generator itself.
                "rand_table_base": 0x8004BC04,
                "rand_index_cell": 0x8004DC04,
                "rand_set_seed_cell": 0x8004DC08,
                "rand_value_cell": 0x8004DC0C,
                "rand_table": extract_rand_table(),
            }) + "\n"
        )
        (OUT_DIR / "fieldstg.bin").write_bytes(extract_fieldstg())
        n_init = sum(1 for v in manifest.values() if v["root_ctor"] >= 0)
        total = sum(v["size"] for v in manifest.values())
        print(
            f"wrote {len(manifest)} overlay images ({total >> 10} KiB) to {OUT_DIR}; "
            f"root ctor located on {n_init}/{len(manifest)}"
        )


if __name__ == "__main__":
    main()
