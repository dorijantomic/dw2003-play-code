"""Extract each stage's sound-archive assignment from the wstag overlays.

Decoded 2026-07-03d (docs/research/audio/sound-system.md):
  - The per-stage scene struct (base 0x80099d80, statically written by each
    wstagNNN overlay's init) carries at +0x3c the ARCHIVE ID the stage-
    lifecycle code passes to the archive-request service [0x80055c54]
    (-> EXE F0x80020574, loads the archive's VAB into channel 1 or 2), and
    at +0x40 the packed PLAY id fired through the category-struct player
    (the stage's music-start command).
  - Archive id == Sound-Test category + 1 (201/201 record proof), so the id
    maps 1:1 onto a bank directory in ~/ddw3/pack/dw2003/sound/.

This tool scans every wstagNNN.s for the scene-struct writer pattern:
    addiu $sN, -0x6280   (after lui 0x800a -> $sN = 0x80099d80, scene base)
    li/lui+ori $rt, K ; sw $rt, 0x3c($sN)   -> K = archive id
    li/lui+ori $rt, K ; sw $rt, 0x40($sN)   -> K = music play id
plus any direct  lw $vN,0x5c54($vN) ... jalr / li $a0, K  request calls
(stage overlays like stgtrain do this for extra banks).

Output: web/assets/data/map_sound_archives.json
    { "s200": {"archive": 4, "bank": "bgm001", "play_id": "0x60100000",
               "extra_archives": []}, ... }

Validated anchors: s200 -> archive 4 = bgm001 (matches the live-RAM VAB
fingerprint from the 2026-07-03 session); stgtrain -> 0x21 = bgm031.
"""
import json
import os
import re
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sys
from pathlib import Path

ASM = Path(os.environ.get("DDW3_DIR") or Path(os.path.expanduser("~/ddw3"))) / "asm/dw2003/pro"
OUT = Path(__file__).parent.parent / "web/assets/data/map_sound_archives.json"

WORD = re.compile(r"\.L0x([0-9a-fA-F]{8}):.*?\.word (0x[0-9a-fA-F]+)")

# Sound-Test category order (2026-07-03d parse; archive = index + 1).
# bgm006 does not exist on disc and has no category.
BANKS = (
    ["common", "batl00", "batl10"]
    + [f"bgm{n:03d}" for n in range(1, 32) if n != 6]
    + ["boss00", "boss01", "boss02", "boss03", "boss04", "cbtl00", "confus"]
    + [f"env{n:03d}" for n in range(1, 26)]
    + ["env204", "env205", "env206", "evo_00", "jog_00", "ttlbgm"]
)


def bank_for(archive_id):
    idx = archive_id - 1
    return BANKS[idx] if 0 <= idx < len(BANKS) else None


def words_of(path):
    out = []
    for line in open(path, errors="replace"):
        m = WORD.search(line)
        if m:
            out.append((int(m.group(1), 16), int(m.group(2), 16)))
    return out


def const_of(reg, ws, i, window=8):
    """Best-effort constant tracked into `reg` looking back from ws[i]."""
    hi = None
    for j in range(i - 1, max(-1, i - 1 - window), -1):
        w = ws[j][1]
        op, rt = w >> 26, (w >> 16) & 0x1F
        if op == 0x09 and ((w >> 21) & 0x1F) == 0 and rt == reg:  # addiu rt,$zero
            return w & 0xFFFF
        if op == 0x0D and ((w >> 21) & 0x1F) == 0 and rt == reg:  # ori rt,$zero
            return w & 0xFFFF
        if op == 0x0F and rt == reg:  # lui rt -> upper const
            if hi is None:
                hi = (w & 0xFFFF) << 16
                # look for a following ori rt,rt in between
                for k in range(j + 1, i):
                    w2 = ws[k][1]
                    if (w2 >> 26) == 0x0D and ((w2 >> 21) & 0x1F) == reg and ((w2 >> 16) & 0x1F) == reg:
                        return hi | (w2 & 0xFFFF)
                return hi
    return None


def scan_overlay(path):
    """First writer to scene+0x3c/+0x40 wins (the normal stage init); later
    writers are CONDITIONAL variants (e.g. wstag200 has two paths that switch
    to archive 0x1f/bgm029) and are collected as alt_play_ids.

    Register values come from overlay_scan.track_consts (full lui/ori/addiu/
    addu propagation) — the old lookback-window const_of missed values
    materialized far from the sw (s212's play id 0x610c0003 was set ~20
    instructions earlier), leaving 7 stages wrongly play_id-less.
    """
    from overlay_scan import load_words, track_consts

    words = load_words(path)
    rec = {"archive": None, "play_id": None, "alt_play_ids": [], "extra_archives": []}
    for i, (off, w, regs) in enumerate(track_consts(sorted(words.items()))):
        op = w >> 26
        if op == 0x2B and (w & 0xFFFF) in (0x3C, 0x40):
            if regs.get((w >> 21) & 0x1F) != 0x80099D80:
                continue
            val = regs.get((w >> 16) & 0x1F)
            if (w >> 16) & 0x1F == 0:
                val = 0
            if val is None:
                continue
            if (w & 0xFFFF) == 0x3C and rec["archive"] is None:
                rec["archive"] = val
            elif (w & 0xFFFF) == 0x40:
                if rec["play_id"] is None:
                    rec["play_id"] = val
                elif val != rec["play_id"] and val not in rec["alt_play_ids"]:
                    rec["alt_play_ids"].append(val)
        # lw $vN, 0x5c54($vM) ... jalr with li $a0, K nearby (direct requests)
        if op == 0x23 and (w & 0xFFFF) == 0x5C54:
            ws = sorted(words.items())
            for j in range(i, min(len(ws), i + 4)):
                w2 = ws[j][1]
                if (w2 >> 26) == 0x09 and ((w2 >> 21) & 0x1F) == 0 and ((w2 >> 16) & 0x1F) == 4:
                    rec["extra_archives"].append(w2 & 0xFFFF)
                    break
    return rec


def main():
    out = {}
    for path in sorted(ASM.glob("wstag*.s")):
        stage = "s" + path.stem[5:]
        rec = scan_overlay(path)
        if rec["archive"] is None and not rec["extra_archives"]:
            continue
        entry = {
            "archive": rec["archive"],
            "bank": bank_for(rec["archive"]) if rec["archive"] is not None else None,
            "play_id": f"0x{rec['play_id']:08x}" if rec["play_id"] is not None else None,
            "alt_play_ids": [f"0x{v:08x}" for v in rec["alt_play_ids"]],
            "extra_archives": [
                {"archive": a, "bank": bank_for(a)} for a in rec["extra_archives"]
            ],
        }
        out[stage] = entry
    OUT.write_text(json.dumps(out, indent=1))

    total = len(out)
    with_arch = sum(1 for v in out.values() if v["archive"] is not None)
    print(f"{total} stages, {with_arch} with a scene archive -> {OUT}")

    # validation anchors (fail loudly if the decode regresses)
    s200 = out.get("s200")
    assert s200 and s200["archive"] == 4 and s200["bank"] == "bgm001", f"s200 anchor broken: {s200}"
    from collections import Counter
    dist = Counter(v["bank"] for v in out.values() if v["bank"])
    print("bank distribution:", dict(sorted(dist.items())))


if __name__ == "__main__":
    main()
