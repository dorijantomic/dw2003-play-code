#!/usr/bin/env python3
"""extract_dataword_flag_refs.py — census of collection-bank (0x80..0x8E) flag ids
that appear as DATA WORDS (not code immediates) across the whole disassembly.

Background: every existing flag/grant miner (`scan_flag_setters.py`,
`extract_native_item_grants.py`, `extract_talk_grants.py`, `extract_npc_flag_sets.py`)
matches flag ids as CODE IMMEDIATES (`li $a0, 0x80xx` or a `lui/addiu` pair). Flag ids
also appear as DATA WORDS inside `{u16 id, u16 expected}` predicate tables — the same
encoding the engine's `F0x80016924` gate-checker and `F0x80016988` set-table applier
walk at runtime (see docs/research/scripting/ptrb-flag-set-producers-2026-06-30.md).
Those tables are reachable, and already fully mined, when a valid NPC spawn record's
`ptrB` dialogue triple points at them (`wstag_extract.py` -> `web/assets/scenes/*.json`
`spawn_flags` / `dialogue_states[].gate` / `.on_close` -> `extract_talk_grants.py`,
`extract_npc_flag_sets.py`, `extract_item_gates.py`). This scanner finds the ones that
are NOT reachable that way: literal `{id,expected}` runs sitting in an overlay with no
NPC ptrB pointer chain reaching them (e.g. inline per-record predicate fields in other
mini-table shapes, such as the per-map "activity point" records first seen in
wstag330 @0x2020-0x2030 that gate on FishingPole possession).

Method:
  1. Reconstruct each `.s` file's raw byte stream from EVERY `.word 0x...` token in
     file order (mirrors `wstag_extract.overlay_bytes`; works for both wstag overlays
     and any other disassembled `.s`, since the disassembler always emits a trailing
     `# .word 0x...` comment even for decoded instruction lines).
  2. Scan word-aligned offsets for `{u16 id, u16 expected}` runs: `id` has a plausible
     bank (`(id>>8)&0xFE <= 0x9E`), `id` is neither 0 nor 0xFFFF, `expected <= 100`
     (excludes coincidental non-flag binary data — random noise routinely produces
     `expected` values in the hundreds/thousands; every genuine flag table observed in
     this codebase uses small expected values), terminated by a literal `0x0000ffff`
     word within 64 entries, with >=2 entries (single-entry "runs" are far more likely
     to be a coincidental scalar than a real predicate list).
  3. Keep only runs containing >=1 entry whose bank is a COLLECTION bank (0x80..0x8E).
  4. Drop any (id, expected) pair already present in the shipped scene JSON's
     `spawn_flags` / `dialogue_states[].gate` / `.on_close` for that stage (the surface
     the existing extractors already mine) — this is the "already captured" filter the
     s931 PlatinumCard case demonstrates. Non-wstag overlays have no scene JSON, so
     nothing is pre-excluded for them.

Result on the 2026-07-26 disasm tree: with the tightened validator, ALL matches outside
`wstag*.s` vanish (0 residue in cardgame/fieldstg/stagslct/stcrd*/stgdglab/stgmcard/
stgtrain/stitshop/stplnmet/ststatus/wfightmn/soundtst/stdgname/stfgtrep/exe) — those
categories' raw `.word` streams are dense binary asset/mesh/table data with no genuine
`{id,expected}` predicate lists at all; the loose (untightened) matches there were 100%
coincidental (`expected` > 100 in every case). Inside `wstag*.s`, 41 residue runs remain,
all structurally GATE/QUERY reads (item-bank ids appear ONLY as predicate-list entries,
never as the target of a `F0x80016988` SSET-table apply — apply targets are always
reached through an NPC ptrB triple's `set_ptr`, which is exactly the surface already
mined into `on_close`/`talk_item_grants.json`). None are proven GRANTs; none are wired.
See docs/research/field/dataword-flag-residue-2026-07-26.md for the full census and the
worked FishingPole "activity point" example (item already has a real talk-give producer
at s340/s942 npc282 — no obtain-path impact).

Output: web/assets/data/dataword_flag_refs.json
  { "residue": [ {stage, overlay, run_start, entries:[{offset,id,id_hex,item_id,expected}],
                  context_entries:[...]} , ... ],
    "summary": {...} }
"""
import os
import json
import re
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
PRO = DDW3 / "asm/dw2003/pro"
EXE = DDW3 / "asm/dw2003/exe"
SCENES = ROOT / "web/assets/scenes"
OUT = ROOT / "web/assets/data/dataword_flag_refs.json"

WORD_ALL_RE = re.compile(r"\.word (0x[0-9a-f]+)")
MAX_EXPECTED = 100
MIN_RUN_LEN = 2
MAX_RUN_LEN = 64


def overlay_bytes(path: Path) -> bytes:
    words = WORD_ALL_RE.findall(path.read_text(errors="replace"))
    return b"".join(struct.pack("<I", int(w, 16)) for w in words)


def is_plausible_id(fid: int) -> bool:
    if fid == 0 or fid == 0xFFFF:
        return False
    return ((fid >> 8) & 0xFE) <= 0x9E


def is_collection_bank(fid: int) -> bool:
    return 0x80 <= ((fid >> 8) & 0xFE) <= 0x8E


def find_run(data: bytes, off: int):
    """Return [(byte_off, id, expected), ...] if a valid terminated run starts at
    `off`, else None. Mirrors wstag_extract.valid_flaglist, tightened with the
    expected<=MAX_EXPECTED noise filter and a >=2-entry floor."""
    entries = []
    for i in range(MAX_RUN_LEN):
        o = off + i * 4
        if o + 2 > len(data):
            return None
        fid = struct.unpack_from("<H", data, o)[0]
        if fid == 0xFFFF:
            return entries if len(entries) >= MIN_RUN_LEN else None
        if o + 4 > len(data) or not is_plausible_id(fid):
            return None
        expected = struct.unpack_from("<H", data, o + 2)[0]
        if expected > MAX_EXPECTED:
            return None
        entries.append((o, fid, expected))
    return None


def item_names():
    src = (DDW3 / "rust/types/src/item_id.rs").read_text()
    return re.findall(r"^\t(\w+),", src, re.M)


def scan_runs():
    files = sorted(PRO.glob("*.s")) + sorted(EXE.glob("*.s"))
    runs = []
    for f in files:
        data = overlay_bytes(f)
        seen = set()
        off = 0
        n = len(data)
        while off + 2 <= n:
            if off not in seen:
                run = find_run(data, off)
                if run:
                    for o, _, _ in run:
                        seen.add(o)
                    if any(is_collection_bank(fid) for _, fid, _ in run):
                        runs.append({"file": f.stem, "run_start": off, "entries": run})
                    off += (len(run) + 1) * 4
                    continue
            off += 4
    return runs


def scene_covered():
    """stage -> set of (id, expected) pairs already present in the shipped scene
    JSON (spawn_flags + dialogue_states[].gate + .on_close) — the surface the
    existing extractors mine."""
    covered = {}
    for f in sorted(SCENES.glob("s*.json")):
        stage = f.stem
        try:
            data = json.loads(f.read_text())
        except Exception:
            continue
        s = covered.setdefault(stage, set())
        for npc in data.get("npcs", []):
            for fl in npc.get("spawn_flags", []) or []:
                s.add((fl["id"], fl["expected"]))
            for ds in npc.get("dialogue_states", []) or []:
                for fl in ds.get("gate", []) or []:
                    s.add((fl["id"], fl["expected"]))
                for fl in ds.get("on_close", []) or []:
                    s.add((fl["id"], fl["expected"]))
    return covered


def main():
    if not PRO.exists():
        raise SystemExit(f"disasm not found at {PRO}")
    names = item_names()
    covered = scene_covered()
    runs = scan_runs()

    residue = []
    for r in runs:
        overlay = r["file"]
        stage = "s" + overlay[len("wstag"):] if overlay.startswith("wstag") else None
        cov = covered.get(stage, set()) if stage else set()
        item_entries = [(o, fid, exp) for o, fid, exp in r["entries"] if is_collection_bank(fid)]
        uncovered = [(o, fid, exp) for o, fid, exp in item_entries if (fid, exp) not in cov]
        if not uncovered:
            continue

        def entry_dict(o, fid, exp):
            item_id = fid & 0x1FF
            name = names[item_id] if item_id < len(names) else f"item#{item_id}"
            return {"offset": hex(o), "id": fid, "id_hex": hex(fid), "item_id": item_id,
                    "item_name": name, "expected": exp}

        residue.append({
            "overlay": overlay,
            "stage": stage,
            "run_start": hex(r["run_start"]),
            "uncovered": [entry_dict(*e) for e in uncovered],
            "context_entries": [entry_dict(*e) for e in r["entries"]],
            # Every residue entry observed to date is a predicate READ (the item bank id
            # sits inside an inline gate-shaped table, never as a set_ptr apply target) —
            # classify accordingly. No entry here has been proven to be a GRANT.
            "classification": "gate",
        })

    residue.sort(key=lambda r: (r["overlay"], r["run_start"]))
    total_runs = len(runs)
    total_entries = sum(len(r["uncovered"]) for r in residue)
    exp0 = sum(1 for r in residue for e in r["uncovered"] if e["expected"] == 0)
    exp1 = sum(1 for r in residue for e in r["uncovered"] if e["expected"] == 1)
    non_wstag_hits = sum(1 for r in runs if not r["file"].startswith("wstag"))

    out = {
        "summary": {
            "total_structural_runs_scanned": total_runs,
            "residue_runs": len(residue),
            "residue_item_bank_entries": total_entries,
            "residue_expected_0": exp0,
            "residue_expected_1": exp1,
            "non_wstag_residue_runs": non_wstag_hits,
            "note": "non_wstag_residue_runs is 0 on the current tree: no genuine "
                     "{id,expected} predicate tables were found outside wstag*.s.",
        },
        "residue": residue,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(residue)} residue runs, "
          f"{total_entries} uncovered item-bank entries ({exp0} expected=0, {exp1} expected=1), "
          f"{non_wstag_hits} of them outside wstag*.s")


if __name__ == "__main__":
    main()
