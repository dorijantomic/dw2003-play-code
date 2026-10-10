#!/usr/bin/env python3
"""Audit the SEQ->MIDI->OGG tempo chain for every rendered music stem.

For each (bank, seq) job that build_music renders, report:
  - MThd division (ticks per quarter, from the SEP's quarter_node_resolution)
  - initial tempo (the u24 the extractor copied from the SEQ header)
  - all mid-track tempo metas after build_music.sanitize_midi
  - implied BPM at each point, total tick length, computed duration
Flags anomalies: BPM outside [40, 250], division outside {48,96,120,240,480},
mid-track tempo that differs from header by >4x (usually a mis-parsed meta).

Run: ~/.local/bin/uv run --with mido python3 tools/audit_music_tempo.py [stem...]
"""
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import build_music as bm  # noqa: E402

import mido  # noqa: E402


def audit(stem, midi_path):
    raw = midi_path.read_bytes()
    division = int.from_bytes(raw[12:14], "big")
    clean = bm.sanitize_midi(raw, filename=stem)
    mid = mido.MidiFile(file=io.BytesIO(clean))
    tempos = []
    tick = 0
    for msg in mid.tracks[0]:
        tick += msg.time
        if msg.type == "set_tempo":
            tempos.append((tick, msg.tempo))
    notes = sum(1 for m in mid.tracks[0] if m.type == "note_on" and m.velocity > 0)
    dur = mid.length
    flags = []
    if division not in (48, 96, 120, 192, 240, 480):
        flags.append(f"odd division {division}")
    for tk, t in tempos:
        bpm = 60_000_000 / t if t else 0
        if not (40 <= bpm <= 250):
            flags.append(f"tempo@{tk}: {t}us = {bpm:.0f} BPM")
    if len(tempos) >= 2 and tempos[0][1] and max(t for _, t in tempos) / max(1, min(t for _, t in tempos)) > 4:
        flags.append("mid-track tempo swings >4x")
    bpm0 = 60_000_000 / tempos[0][1] if tempos else 0
    print(
        f"{stem:12} div={division:4} tempo0={tempos[0][1] if tempos else '-':>7} "
        f"({bpm0:5.1f} BPM) changes={len(tempos) - 1:2} notes={notes:4} dur={dur:6.1f}s"
        + ("   <== " + "; ".join(flags) if flags else "")
    )
    return flags


def main():
    only = set(sys.argv[1:])
    idx = json.loads((bm.OUT / "index.json").read_text())
    # rebuild the stem -> midi mapping the same way build_music does
    starts = bm.music_start_seqs()
    bad = 0
    for stem in idx:
        if only and stem not in only:
            continue
        if "_" in stem and stem.rsplit("_", 1)[1].isdigit():
            bank, seq = stem.rsplit("_", 1)
            seq = int(seq)
        elif stem in bm.COMMON_JINGLES:
            bank, seq = "common", bm.COMMON_JINGLES[stem]
        elif stem in bm.EXTRA_JINGLES:
            bank, seq = bm.EXTRA_JINGLES[stem]
        else:
            bank = stem
            seq = bm.SEQ_OVERRIDES.get(stem, starts.get(stem, [0])[0] if starts.get(stem) else 0)
        p = bm.DDW3_SOUND / bank / "tracks/0" / f"{seq}.midi"
        if not p.exists():
            print(f"{stem:12} MISSING {p}")
            continue
        try:
            if audit(stem, p):
                bad += 1
        except Exception as e:
            print(f"{stem:12} ERROR {e}")
            bad += 1
    print(f"\n{bad} stems flagged")


if __name__ == "__main__":
    main()
