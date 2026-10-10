"""
Decodes walk-cycle frame layouts for all field sprites from their animation .bin files.

BIN GROUP STRUCTURE (decoded 2026-06-12 by examining p001play/p006agum/p004kogu bins):

Each sprite pack (pack/dw2003/field/sprite/pNNNname/) contains .bin files grouped
in sets of 5 directions per animation group:
  relative bin 0 = down
  relative bin 1 = down-left  (diagonal)
  relative bin 2 = left
  relative bin 3 = up-left    (diagonal)
  relative bin 4 = up

For sprites with 10+ bins (player/partner characters), there are multiple animation groups:
  Group 0 (bins  0-4): IDLE / breathing (4 frames, ~50-70 ticks)
  Group 1 (bins  5-9): WALK (6 frames,  ~60-72 ticks)  ← this tool uses this group
  Group 2 (bins 10-14): RUN (6 frames,  ~20 ticks, very fast)
  Group 3+:            other animations (talk, actions, etc.)

For sprites with 5-9 bins, only group 0 exists (idle = only animation available).
These are typically simpler NPC characters.

For sprites with 3-4 bins, a simplified 3-direction layout is used.

WALK FRAME FORMAT (one format, one walk — the original's):
  A frame-list .bin is a run of 4x i32 records `[duration, frame_idx, x_offset,
  y_offset]`, terminated by a `-1` duration. The original's animation resolver
  F0x8008f9c0 (/home/dorij/ddw3/asm/dw2003/pro/fieldstg.s:13245-13282) walks it
  with a 4-word stride, so every frame it can draw carries its own billboard
  registration (words 3/4 -> entity+0xDC/+0xE0). There is no second, offset-less
  format on the disc; a pack's clip directory is a different structure and is
  read as one (below), not as a frame list.
  The 6-frame walk cycle in each bin is [step1, step2, STAND, step3, step4, STAND].
  The STAND frame (appears twice) is the neutral/rest pose.
  Output reorders to [STAND, step1, step2, step3, step4] so frameIdx=0 is the stand
  pose (used when idle) and frameIdx 1..4 cycle through actual walk steps.

NOTE: right-facing and diagonal *-right directions are mirrored at render time from
their left-side counterparts. This tool only outputs left-side dirs:
  "down", "down-left", "left", "up-left", "up"

CLIP DIRECTORY (decoded 2026-07-01, see docs/research/field/field-actor-anim-engine.md):
  The highest-numbered .bin in a sprite pack is the real SETANIM clip directory the
  original engine reads at runtime: 0xc-byte records of `u16 clip_id, u16 dir_bin[5]`
  (one sibling .bin number per direction, same order as above), terminated by a
  clip_id==0 record. Each `dir_bin` number names another .bin in the same pack, decoded
  the same way as any animation group. This is the real per-clip gesture/talk/sleep/sit
  data — clip ids 1/4/5 happen to be idle/walk/run for most sprites (hence the "frames"/
  "durations" groups above already picking usable bins by position), but the directory
  covers every clip id the original scripts actually use via SETANIM.

Usage:
  cd ~/ddw3 && python ~/ddw3-walker/tools/decode_sprite_anims.py
Output: JSON to stdout, one object per sprite:
  { "pNNNname": {
      "frames": {"down": [stand,s1,...], "down-left": [...], "left": [...], "up-left": [...], "up": [...]},
      "durations": {"down": [ticks,...], ...},  # same lengths as "frames", 60Hz-tick units
      "offsets": {"down": [[x_off, y_off], ...], ...},  # per-frame billboard registration
        # (frame-list record words 3/4 — the original engine caches word 3 at
        # entity+0xDC and draws the billboard's left edge at screenX + that
        # value, mirrored at screenX - (E4 + that); word 4 goes to entity+0xE0
        # and the billboard's TOP row is drawn at screenY + that). Present for
        # every direction this sprite's walk table has frames for.
      "clips": {"<clip_id>": {"down": {"frames": [...], "durations": [...],
        "xoffsets": [...], "yoffsets": [...]}, ...}}  # optional; the same two
        # per-frame registration words, per direction.
        # omitted if this sprite has no separate directory bin. Per-direction keys omitted
        # when that direction's referenced bin decodes to no usable frames.
    }, ... }
"""

import os
import json
import struct
import sys
from collections import Counter
from pathlib import Path

SPRITE_PACK_DIR = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "pack/dw2003/field/sprite"

_MAX_FRAME = 500  # a frame index above the pack's own TIM count is junk, not a frame
_DEFAULT_DURATION = 8  # ticks (~1/8s @ 60Hz), only for the walk table's empty-bin safety net
_WRAP_SENTINEL = -1  # the engine's "hold this frame" marker (F0x8008f9c0, fieldstg.s:13250)


def _decode_bin_pairs(path: Path) -> list[tuple[int, int]]:
    """Return raw list of (frame_idx, duration_ticks) pairs, with duplicates, from a .bin file."""
    return [(rec[0], rec[1]) for rec in _decode_bin_records(path)]


def _decode_bin_records(path: Path) -> list[tuple[int, ...]]:
    """Walk a field-sprite frame list exactly as the original engine does.

    The disc has ONE frame-list layout and one walk of it. `F0x8008f9c0`
    (~/ddw3/asm/dw2003/pro/fieldstg.s:13245-13282) keeps a word index in
    `entity+0xCC`, reads the duration word at that index, and then consumes FOUR
    consecutive i32 words: `[duration, frame_idx, x_offset, y_offset]`, caching
    word 1 at `entity+0xD0` (the frame timer), word 2 at `+0xD4` (the texture
    handle, OR'd with the pack bank), word 3 at `+0xDC` and word 4 at `+0xE0` —
    the billboard's own per-frame X and Y registration. A duration of -1 is the
    wrap sentinel (hold) and 0 restarts the list at word 0; either way the
    stride is 4, so there is no record without offsets and no second format.

    Returned as `(frame_idx, duration, x_off, y_off)` per record.

    A .bin that is NOT a frame list — the packs' clip directories, which are
    0xc-byte records (`_decode_clip_directory`) — yields no records here, which
    is what the original does too: it reads those through the directory path,
    never as a frame list. That is why this function has no fallback branch; the
    "Format B" u16 guess that used to live here invented offsets the disc does
    not have, and handed the build bounding-box values in their place.
    """
    data = path.read_bytes()
    n = len(data) // 4
    if n < 4:
        return []

    words = struct.unpack_from(f"<{n}i", data)
    records: list[tuple[int, ...]] = []
    cc = 0
    while cc + 3 < n:
        peek = words[cc]
        if peek == _WRAP_SENTINEL:
            break
        if peek == 0:
            # A zero duration makes the engine store 0 back into `entity+0xCC`
            # (fieldstg.s:13255) and then read word 0 — so the list restarts at its
            # first record. Word 0's own record is therefore the one that plays on and
            # on: a row written that way is a HELD frame, not a cycle. Only one .bin in
            # the disc's 179 field-sprite packs leads with such a word (p188blok/13.bin,
            # whose up-facing row holds frame 6) and no .bin carries one mid-list, so
            # this is the whole census of the case.
            if cc == 0 and words[1] <= _MAX_FRAME:
                records.append((words[1], 0, words[2], words[3]))
            break
        duration, frame_idx, x_off, y_off = words[cc:cc + 4]
        if frame_idx > _MAX_FRAME:
            break
        records.append((frame_idx, duration, x_off, y_off))
        cc += 4
    return records


_CLIP_DIRS = ("down", "down-left", "left", "up-left", "up")


def _decode_clip_directory(path: Path) -> list[tuple[int, list[int]]]:
    """Decode a sprite's SETANIM clip directory (its highest-numbered .bin file).

    Format (see docs/research/field/field-actor-anim-engine.md): a list of 0xc-byte
    records, each `u16 clip_id, u16 dir_bin[5]` (one sibling .bin number per direction,
    order = down/down-left/left/up-left/up), terminated by a clip_id==0 record.
    Returns [] if `path` doesn't parse as a clean, terminated directory (e.g. a sprite
    with no separate directory bin, or one that IS its own only animation).
    """
    data = path.read_bytes()
    if len(data) == 0 or len(data) % 12 != 0:
        return []
    n = len(data) // 12
    records = []
    for i in range(n):
        vals = struct.unpack_from("<6H", data, i * 12)
        clip_id = vals[0]
        if clip_id == 0:
            return records if i == n - 1 else []
        if clip_id > _MAX_FRAME:
            return []
        records.append((clip_id, list(vals[1:])))
    return []  # no terminator found — not this format


def _stand_first_pairs(pairs: list[tuple]) -> list[tuple]:
    """Reorder records to [stand, step1, step2, step3, step4].

    Same rule as before (most-repeated frame id becomes the stand pose, moved first),
    now keeping each record's tail fields (duration, and x/y offsets when present)
    alongside its frame id. Records are (frame_idx, ...) tuples of any length.
    """
    if not pairs:
        return pairs
    counts = Counter(rec[0] for rec in pairs)
    first_record = {}
    for rec in pairs:
        first_record.setdefault(rec[0], rec)
    repeated = [f for f, n in counts.items() if n > 1]
    if repeated:
        stand = repeated[0]
        steps = [f for f in dict.fromkeys(rec[0] for rec in pairs) if f != stand]
        ordered = [stand] + steps
    else:
        ordered = list(dict.fromkeys(rec[0] for rec in pairs))
    return [first_record[f] for f in ordered]


def decode_sprite(sprite_dir: Path) -> dict | None:
    """Decode frame layout + real per-frame timing for one sprite.

    Returns {"frames": {dir: [frame_idx, ...]}, "durations": {dir: [duration_ticks, ...]}}
    with keys from {"down", "down-left", "left", "up-left", "up"} (diagonals omitted when
    unavailable). Returns None if no bins found. `durations[dir]` always matches
    `frames[dir]` in length.
    """
    bins = sorted(sprite_dir.glob("*.bin"), key=lambda p: int(p.stem))
    if not bins:
        return None

    n = len(bins)

    if n >= 10:
        # Pick walk group (group 1): bins at absolute positions 5-9
        # relative offsets: 0=down, 1=down-left, 2=left, 3=up-left, 4=up
        down_p   = _stand_first_pairs(_decode_bin_records(bins[5]))
        down_l_p = _stand_first_pairs(_decode_bin_records(bins[6]))
        left_p   = _stand_first_pairs(_decode_bin_records(bins[7]))
        up_l_p   = _stand_first_pairs(_decode_bin_records(bins[8]))
        up_p     = _stand_first_pairs(_decode_bin_records(bins[9]))
    elif n >= 5:
        # Only group 0 available: bins 0-4
        down_p   = _stand_first_pairs(_decode_bin_records(bins[0]))
        down_l_p = _stand_first_pairs(_decode_bin_records(bins[1]))
        left_p   = _stand_first_pairs(_decode_bin_records(bins[2]))
        up_l_p   = _stand_first_pairs(_decode_bin_records(bins[3]))
        up_p     = _stand_first_pairs(_decode_bin_records(bins[4]))
    elif n >= 3:
        # Simplified 3-direction layout; no diagonals
        down_p = _stand_first_pairs(_decode_bin_records(bins[0]))
        left_p = _stand_first_pairs(_decode_bin_records(bins[1]))
        up_p   = _stand_first_pairs(_decode_bin_records(bins[2]))
        down_l_p = up_l_p = []
    else:
        # 1-2 bins: static sprite — all directions share the same frames
        idle_p = _stand_first_pairs(_decode_bin_records(bins[0]))
        down_p = left_p = up_p = idle_p
        down_l_p = up_l_p = []

    if not down_p:
        return None

    # Validate against available TIM frames
    tim_dir = (sprite_dir.parents[4] / "tim/dw2003/field/sprite" / sprite_dir.name)
    tims = [p for p in tim_dir.glob("*.png") if p.stem.isdigit()] if tim_dir.exists() else []
    max_valid = max(int(p.stem) for p in tims) if tims else _MAX_FRAME

    def clean_pairs(pairs, fallback):
        result = [rec for rec in pairs if rec[0] <= max_valid]
        return result if result else fallback

    down_p   = clean_pairs(down_p,   [(0, _DEFAULT_DURATION)])
    left_p   = clean_pairs(left_p,   down_p)
    up_p     = clean_pairs(up_p,     down_p)
    down_l_p = clean_pairs(down_l_p, [])
    up_l_p   = clean_pairs(up_l_p,   [])

    def split(records):
        return ([rec[0] for rec in records], [rec[1] for rec in records],
                [[rec[2], rec[3]] for rec in records] if (records and len(records[0]) == 4) else None)

    down, down_dur, down_off = split(down_p)
    left, left_dur, left_off = split(left_p)
    up, up_dur, up_off = split(up_p)
    down_l, down_l_dur, down_l_off = split(down_l_p)
    up_l, up_l_dur, up_l_off = split(up_l_p)

    frames = {"down": down, "left": left, "up": up}
    durations = {"down": down_dur, "left": left_dur, "up": up_dur}
    offsets = {}
    for name, frames_, off in (
        ("down", down, down_off), ("left", left, left_off), ("up", up, up_off),
        ("down-left", down_l, down_l_off), ("up-left", up_l, up_l_off),
    ):
        if off is not None:
            offsets[name] = off
    if down_l:
        frames["down-left"] = down_l
        durations["down-left"] = down_l_dur
    if up_l:
        frames["up-left"] = up_l
        durations["up-left"] = up_l_dur

    result = {"frames": frames, "durations": durations, "offsets": offsets}

    clips = _decode_clips(sprite_dir, bins, max_valid)
    if clips:
        result["clips"] = clips

    return result


def _decode_clips(sprite_dir: Path, bins: list[Path], max_valid: int) -> dict:
    """Decode clip_id -> {direction: {frames, durations}} from the pack's directory bin
    (its highest-numbered .bin). Returns {} if this sprite has no separate directory bin
    (too few bins, or the last bin doesn't parse as one — see `_decode_clip_directory`).
    """
    directory = _decode_clip_directory(bins[-1])
    if not directory:
        return {}
    by_num = {int(p.stem): p for p in bins}
    clips = {}
    for clip_id, dir_bin_nums in directory:
        per_dir = {}
        for direction, bin_num in zip(_CLIP_DIRS, dir_bin_nums):
            bin_path = by_num.get(bin_num)
            if bin_path is None:
                continue
            records = [rec for rec in _decode_bin_records(bin_path) if rec[0] <= max_valid]
            if records:
                per_dir[direction] = {
                    "frames": [rec[0] for rec in records],
                    "durations": [rec[1] for rec in records],
                }
                if len(records[0]) == 4:
                    per_dir[direction]["xoffsets"] = [rec[2] for rec in records]
                    per_dir[direction]["yoffsets"] = [rec[3] for rec in records]
        if per_dir:
            clips[str(clip_id)] = per_dir
    return clips


def main():
    results = {}
    sprite_dirs = sorted(
        p for p in SPRITE_PACK_DIR.iterdir()
        if p.is_dir() and p.name.startswith("p")
    )
    for d in sprite_dirs:
        layout = decode_sprite(d)
        if layout:
            results[d.name] = layout

    print(json.dumps(results, indent=2))
    print(f"# Decoded {len(results)} sprites", file=sys.stderr)


if __name__ == "__main__":
    main()
