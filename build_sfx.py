"""
Builds web/assets/sfx/ (WAVs + manifest.json) from the decoded sound research.

Data-driven off three committed research artifacts (no hand-maintained id
tables -- see docs/research/audio/sound-system.md and the 2026-07-02 plan
docs/superpowers/plans/2026-07-02-authentic-sfx-wiring.md):

  - soundtst-common-ids.json      name -> {packed id, slot} (dev Sound Test table)
  - common-tones-full.json        slot -> {vag, loop points} (byte-exact VAB parse)
  - sfx-triggers.json             disasm-decoded triggers; rows with status
                                  "decoded" AND a walker_hook are built
  - system-blip-semantics.json    sounds whose semantics are traced to a call
                                  site are built (cursor/confirm/cancel/open/
                                  close, and the periodic cues)
  - soundtst-categories.json      the Sound Test's own 71 per-category sound
                                  arrays + category records: the AREA build set
                                  (see area_records)

Sample resolution is PATH-DEPENDENT (decompiled F0x8002006c + F0x8003432c +
F0x80037d0c, 2026-07-02i -- see sound-system.md):

  bit 31 CLEAR (2D path): the id's low byte is a SEQ PHRASE SLOT, not a tone
    ordinal, in whichever archive bits 18-24 name -- the score the original
    walks note by note. F0x8002006c's 2D branch passes `id & 0xff` to
    F0x800335b4 -> F0x8003340c, which addresses that archive's own per-voice
    record (D0x800815a0[phraseChannel] + slot*0xB0), and the per-tick player
    F0x8002f59c walks the record's cursor through the score
    (F0x8002faec -> F0x8002fe2c), one SPU voice per note-on (F0x8003581c,
    fns.s:41033). The score is the archive's own `.seq` file, loaded by
    F0x800205f0's archive-load state machine (fns.s:18208-18284) which calls
    F0x8003086c(file, vabSlot, 0x10) per file: SIXTEEN phrases per file
    (fns.s:35684-35712). Every one of the disc's 71 archives carries a `.seq`
    file; only `common` carries two (1.seq + 2.seq), which is why its slots run
    0-31 and every other archive's run 0-15.

  bit 31 SET (positional path): program row = (id >> 11) & 0x7f, tone =
    (id >> 7) & 0xf, NOTE = id & 0x7f. F0x80037d0c resolves row ->
    ProgramHeader[row].byte8 (filled at bank registration with the PACKED
    program index -- 0xff on disk); sample = ToneHeader[prog*16+tone].vag.
    Playback rate = 2^((note - center_note + center_note_shift/128)/12),
    clamped at 4.0 (F0x80036070, SPU pitch 0x1000 = 44100Hz baseline).

  ToneHeader.vag / common.toml `vag` values are 1-BASED (Sony VagAtr
  convention -- proven 2026-07-03b: every bank's tone fields span exactly
  [1, vags_len], never 0; the SPU address table entry[i] = END of 1-based
  vag i, so key-on indexes entry[field-1]; user ear-confirmed field 53 ==
  inst/52.wav walking in-game). Extracted inst/*.wav files are 0-based, so
  the WAV for field F is inst/(F-1).wav -- applied at the single lookup
  below for BOTH paths.

Manifest fields per sound (packed-id bit layout, disasm-decoded):
  category   = (id >> 18) & 0x7f   -- the ARCHIVE id (not a mixer category)
  dedup      = (id >> 30) & 1      -- the one exclusive-track register, bit 30
  positional = (id >> 31) & 1      -- original uses the dx/dy-panned path
  priority   = byte 0 of the tone record the sound plays, i.e. what the voice
               allocator F0x80034b9c is handed through D0x80082677
  rate       = playbackRate vs the 44.1kHz WAV (1.0 on the 2D path)
  loop       = {start, end} seconds (real ADPCM loop points) or null
"""
import hashlib
import math
import json
import os
import re
import shutil
import struct
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).parent
AUDIO_DOCS = ROOT / "docs/research/audio"
# The extracted ddw3 data tree. Override with DDW3_DIR; defaults to ~/ddw3.
DDW3_ROOT = Path(os.environ.get("DDW3_DIR") or (os.environ.get("DDW3_DIR") or (os.environ.get("DDW3_DIR") or os.path.expanduser("~/ddw3"))))
COMMON_INST = DDW3_ROOT / "sound/dw2003/common/inst"
RECOVERED = AUDIO_DOCS / "recovered"
OUT = ROOT / "web/assets/sfx"
# The per-note half of every 2D phrase. A phrase is ONE SPU voice per note-on
# in the original (F0x8003581c asks the allocator once per note event,
# fns.s:41033), so the walker needs each note as its own voice. What it needs
# for that is the sample each note plays and how it plays it, not a second
# rendering of the phrase: the exact decoded VAG samples live here and
# engine/systems/phrase-notes.ts renders each note from one of them, the same
# way the SPU plays one sample per voice. Generated and committed, because
# web/assets/sfx is the shared, gitignored asset tree.
PHRASE_OUT = ROOT / "web/sfx-voice"
# The census of every phrase the disc ships, for docs/research/audio/.
CENSUS_OUT = AUDIO_DOCS / "phrase-notes.json"
SOUND_PACK = DDW3_ROOT / "pack/dw2003/sound"
AREA_OUT = OUT / "area"

SAMPLE_RATE = 44100.0
PLAIN_NAME = re.compile(r"^[A-Z0-9_]+$")
# Always built regardless of trigger rows: the two originally wired sounds
# (window-open blip 0x00040019 + ladder creak 0x800458bd, under their TRUE
# Sound Test names -- the 2026-07-03 name-shift correction renamed them from
# SYSTEM04/PLAYER02).
# PLAYER11 joins them: the Blast-revert cue, caught live at authority 1
# (captures/blast-presentation-2026-07-14/README.md — packed 0xa0045ec9). It was
# left out while the resolver's tone-count misalignment made it look absent from
# the bank; it addresses program slot 11, tone 13, note 73 and resolves cleanly.
ALWAYS = {"SYSTEM03", "PLAYER01", "PLAYER11"}


VAB_HEADER = DDW3_ROOT / "pack/dw2003/sound/common/mpcommon/0.vh"


def load(p):
    with open(p) as f:
        return json.load(f)


def packed_program_index():
    """row (0-127 VAB program slot) -> index of that program's TONE BLOCK.

    Mirrors the driver's bank registration: F0x80037d0c reads
    ProgramHeader[row].byte8, which the loader fills with the program's
    packed position (present-programs-only, in slot order). The tone
    attribute area is stored in that same packed order, one 16-tone block
    per present program.
    """
    hdr = VAB_HEADER.read_bytes()
    mapping = {}
    packed = 0
    for slot in range(128):
        rec = hdr[0x20 + slot * 16 : 0x20 + slot * 16 + 16]
        if rec[0] > 0:  # tones count
            mapping[slot] = packed
            packed += 1
    return mapping


def vab_program_tones():
    """VAB program slot -> its real tone list, read straight from the header.

    common.toml's programs[] pairs program-header slot k with tone BLOCK k,
    but the blocks are stored present-programs-only, so block k belongs to the
    k-th PRESENT slot. Below the first empty slot the two agree; above it the
    shipped pairing takes the right block with the WRONG tone count, which
    silently dropped every sound addressing a tone past that count (the eight
    per-element special-attack loops BT_LOOP0-7 live at slot 28 tones 0-7 and
    only tone 0 survived). Each tone attribute carries its own program number
    at +0x14, so the alignment is checked here rather than assumed.
    """
    hdr = VAB_HEADER.read_bytes()
    tone_base = 0x20 + 128 * 16
    counts = [hdr[0x20 + s * 16] for s in range(128)]
    present = [s for s in range(128) if counts[s] > 0]
    out = {}
    for block, slot in enumerate(present):
        tones = []
        for t in range(counts[slot]):
            off = tone_base + block * 16 * 32 + t * 32
            r = hdr[off : off + 32]
            prog = int.from_bytes(r[0x14:0x16], "little")
            if prog != slot:
                raise SystemExit(
                    f"VAB tone block {block} reports program {prog}, expected slot {slot}")
            # Byte 0 = the SPU voice allocator's priority for this tone (see
            # bank_tone); common.toml has no field for it, so read it here.
            tones.append({"vag": int.from_bytes(r[0x16:0x18], "little"),
                          "center_note": r[4], "center_note_shift": r[5],
                          "priority": r[0]})
        out[slot] = tones
    return out


def positional_resolve(packed_id, programs, row_to_packed, slot_tones=None):
    """bit-31 id -> (vag, rate, priority) via program/tone/note addressing.

    The priority is the tone record's byte 0, the value the voice allocator
    F0x80034b9c is handed through D0x80082677 (see bank_tone)."""
    row = (packed_id >> 11) & 0x7F
    tone_idx = (packed_id >> 7) & 0xF
    note = packed_id & 0x7F
    if slot_tones is not None:
        tones = slot_tones.get(row)
    else:
        prog = row_to_packed.get(row)
        tones = programs[prog].get("tones", []) if (
            prog is not None and prog < len(programs)) else None
    if not tones or tone_idx >= len(tones):
        return None, None, None
    tone = tones[tone_idx]
    semis = note - tone["center_note"] + tone["center_note_shift"] / 128.0
    rate = min(2.0 ** (semis / 12.0), 4.0)  # F0x80036070 clamps at 0x3fff/0x1000
    return tone["vag"], rate, tone.get("priority", 0)


# ---------------------------------------------------------------------------
# Area (per-map bank) sounds -- docs/research/audio/sound-system.md 2026-07-03d.
# Each map loads ONE swappable sound archive (map_sound_archives.json, mined
# from the wstag scene structs); the Sound-Test table proves archive id ==
# category+1 and that area SFX (doors, gondola, train, traps, ambience...)
# live INSIDE those banks. Here we decode each area sound from ITS OWN bank
# and emit web/assets/sfx/area/<bank>/<name>.wav + area_manifest.json so
# audio.js can resolve by the current map's bank (silent where absent --
# authentic behavior, F0x80037d0c rejects out-of-range rows).

VAG_LUT = [(0, 0), (60, 0), (115, -52), (98, -55), (122, -60)]


def decode_vag_pcm(raw):
    """ADPCM decode mirroring vab.rs (same state machine as
    docs/research/audio/decode_vag_loops.py), returning samples + loop pts."""
    n_blocks = len(raw) // 16
    hist = [0, 0]
    out = []
    loop_status = None
    loop_start = loop_end = None
    cur = 0
    while cur < n_blocks:
        block = raw[cur * 16 : (cur + 1) * 16]
        shift = block[0] & 0xF
        lut_idx = (block[0] & 0xF0) >> 4
        flags = block[1]
        if flags in (0, 1, 2, 4, 5):
            nxt = cur + 1
        elif flags == 3:
            if isinstance(loop_status, tuple):
                nxt = loop_status[1]
                loop_status = "done"
                loop_end = len(out)
            else:
                break
        elif flags == 6:
            if loop_status is None:
                loop_status = ("from", cur)
                loop_start = len(out)
                nxt = cur + 1
            else:
                break
        else:  # 7 = end of stream, or unknown
            break
        k0, k1 = VAG_LUT[lut_idx] if lut_idx < len(VAG_LUT) else (0, 0)
        for b in block[2:16]:
            for s in (b & 0xF, (b & 0xF0) >> 4):
                v = s << 12
                if v >= 0x8000:
                    v -= 0x10000
                v >>= shift
                val = v + (hist[0] * k0 + hist[1] * k1) // 64
                val = max(-32768, min(32767, val))
                hist[1] = hist[0]
                hist[0] = val
                out.append(val)
        cur = nxt
    return out, loop_start, loop_end


def write_pcm_wav(path, samples, rate=44100):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack(f"<{len(samples)}h", *samples))


def parse_bank(bank):
    """Byte-exact VAB header parse (layout per decode_vag_loops.py)."""
    vh = SOUND_PACK / bank / f"mp{bank}" / "0.vh"
    vb = SOUND_PACK / bank / f"mv{bank}" / "0.vb"
    if not vh.is_file() or not vb.is_file():
        return None
    d = vh.read_bytes()
    programs_len = struct.unpack_from("<H", d, 18)[0]
    ph = [d[32 + i * 16] for i in range(128)]  # tones count per program slot
    tone_off = 32 + 128 * 16
    lens = struct.unpack_from("<256H", d, tone_off + programs_len * 512)
    return {"data": d, "ph": ph, "tone_off": tone_off,
            "programs_len": programs_len, "lens": lens, "vb": vb}


def bank_tone(bank_h, row, tone):
    """Game-exact positional row resolution: row -> packed present-program
    index (the byte8 fill, F0x80037eec) -> ToneHeader. None = silent."""
    ph = bank_h["ph"]
    if row >= 128 or ph[row] == 0 or tone >= ph[row]:
        return None
    packed = sum(1 for r in range(row) if ph[r] > 0)
    if packed >= bank_h["programs_len"]:
        return None
    rec = bank_h["tone_off"] + packed * 512 + tone * 32
    d = bank_h["data"]
    # +0 is the SPU voice allocator's priority for this tone: F0x8003432c
    # (fns.s:39603-39611) and F0x8003581c (fns.s:41012-41038) both read byte 0
    # at *(D0x80082658) + (packed*16 + note)*32 into the single global
    # D0x80082677 that F0x80034b9c then compares every voice against.
    return {"center": d[rec + 4], "shift": d[rec + 5], "priority": d[rec + 0],
            "vag": struct.unpack_from("<H", d, rec + 0x16)[0]}


def bank_tone_full(bank_h, row, tone):
    """Full ToneHeader (VagAtr) fields for program slot `row`, tone index
    `tone`: vol/center/shift/note range/vag. None when absent."""
    ph = bank_h["ph"]
    if row >= 128 or ph[row] == 0 or tone >= ph[row]:
        return None
    packed = sum(1 for r in range(row) if ph[r] > 0)
    if packed >= bank_h["programs_len"]:
        return None
    rec = bank_h["tone_off"] + packed * 512 + tone * 32
    d = bank_h["data"]
    return {"vol": d[rec + 2], "center": d[rec + 4], "shift": d[rec + 5],
            "note_min": d[rec + 6], "note_max": d[rec + 7],
            # byte 0 = the voice allocator's priority for this tone (see bank_tone)
            "priority": d[rec + 0],
            # VagAtr adsr1/adsr2 @ +16/+18 (vag @ +22 pins the layout)
            "adsr1": struct.unpack_from("<H", d, rec + 16)[0],
            "adsr2": struct.unpack_from("<H", d, rec + 18)[0],
            "vag": struct.unpack_from("<H", d, rec + 0x16)[0]}


def tone_release(tone):
    """SPU key-off release from adsr2 (nocash PSXSPX 'decrease' timing):
    shift = bits 0-4, mode = bit 5 (0 linear, 1 exponential).
    Cycles-per-step = 1 << max(0, shift-11); step = 8 << max(0, 11-shift);
    linear full-scale time = (0x8000/step) * cycles / 44100 s. In exponential
    mode the same figure is the decay time-constant tau (step scales with
    level/0x8000). The common-bank thud tones are exp with shift 13-15
    (tau 0.37-1.49 s) -- ignoring this is what turned every *_DOWN thud into
    the same 1.4 s full-sample boom (user: 'Agumon thuds like a huge digimon')."""
    if not tone or "adsr2" not in tone:
        return ("lin", 0.010)
    shift = tone["adsr2"] & 0x1F
    exp = (tone["adsr2"] >> 5) & 1
    cycles = 1 << max(0, shift - 11)
    step = 8 << max(0, 11 - shift)
    total = (0x8000 / step) * cycles / 44100.0
    return ("exp" if exp else "lin", total)


def bank_tones_for_note(bank_h, prog, note):
    """All tones of VAB program `prog` whose [note_min, note_max] range covers
    `note` -- the SPU keys every covering tone (layered samples)."""
    out = []
    for t in range(bank_h["ph"][prog] if prog < 128 else 0):
        tone = bank_tone_full(bank_h, prog, t)
        if tone and tone["note_min"] <= note <= tone["note_max"]:
            out.append(tone)
    return out


# ---------------------------------------------------------------------------
# 2D-path phrase sounds -- DECODED 2026-07-08 (in-battle savestate ground truth),
# widened to every archive 2026-10-05.
# bit31-CLEAR ids are NOT VAB tone ordinals: the driver's per-voice record points
# into the ARCHIVE'S OWN `.seq` file, a mini SEQ score (SEQp header per block).
# The 2026-07-08 decode read that for mpcommon only and left the other 70
# archives on a flat tone ordinal, which is the mistake this section's OPEN note
# named. Each `.seq` file is SIXTEEN phrases (F0x800205f0 state 3 ->
# F0x8003086c(.., 0x10), fns.s:18226/:35708), so an archive's slots are 0-15 per
# file in name order; only `common` ships two files, which is why its 32 cues
# run slots 0-31 and every other archive's run 0-15. Each phrase = MIDI-ish
# events (VLQ deltas, running status): Cn program change into that archive's VAB,
# 9n note-ons (vel 0 = off), and FF 51 <tempo:3> set-tempo meta events.
# SHT/MID/LRG/MTL_DOWN = program 1 at size-specific notes; the *_STEP sounds =
# program 0 multi-note footfalls. The old flat-slot rule mapped these onto
# unrelated field tones (LRG_DOWN == the SWITCH03 sample -- the user-reported
# "Tyrannomon falls with a 2D-map interaction sound"). Render each phrase offline
# through that archive's own VAB (note->tone by range, rate =
# 2^((note-center+shift/128)/12), layered tones, loop-sustain until note-off) and
# ship the note rows the browser plays, one SPU voice per note-on.


SEQ_FILES = (SOUND_PACK / "common/mpcommon/1.seq",
             SOUND_PACK / "common/mpcommon/2.seq")


def parse_seq_phrases(bank="common"):
    """One archive's OWN `.seq` files -> slot -> {data, resolution, tempo_us, score}.

    Which file a phrase lives in is the original's business, not ours: the
    archive-load state machine (F0x800205f0 state 3, fns.s:18208-18284) walks
    the archive descriptor's file list and calls F0x8003086c(file, vabSlot, 0x10)
    for each entry, so each `.seq` file becomes its own set of SIXTEEN phrase
    slots -- `li $a2, 0x10` in the call's delay slot (fns.s:18226) and the loop
    bound `slt $v0, $s1` in F0x8003086c (fns.s:35708) with $s1 = that count.
    Files are taken in name order, so `1.seq` is slots 0-15 and `2.seq` is slots
    16-31: which is exactly what the common bank needs (it is the only archive
    on the disc that ships two) and why every other archive's slots stop at 15.

    `common` was the only archive this used to read, which is the whole of the
    old flat-slot mistake: an area bank's 2D id addressed its own score, not a
    tone ordinal in its own VAB.
    """
    slots = {}
    base = 0
    for path in sorted((SOUND_PACK / bank / f"mp{bank}").glob("*.seq")):
        d = path.read_bytes()
        pos = 8  # pQES magic + version
        idx = 0
        while pos < len(d) - 4:
            if not (d[pos] == 0x01 and d[pos + 1] == 0xE0):
                idx = d[pos]
                pos += 1
            if not (d[pos] == 0x01 and d[pos + 1] == 0xE0):
                raise ValueError(f"{bank}/{path.name}: phrase desync at {pos:#x}")
            # The block header IS the resolution: `01 E0` read big-endian is 480,
            # which is the PPQN every one of the disc's 1152 blocks declares.
            resolution = struct.unpack_from(">H", d, pos)[0]
            tempo_us = int.from_bytes(d[pos + 2 : pos + 5], "big")
            pos += 12  # 10-byte header + u16 (unreliable length field; use the end marker)
            end = d.find(b"\xff\x2f\x00", pos)
            if end == -1:
                raise ValueError(f"{bank}/{path.name}: phrase {idx} missing end marker")
            slots[base + idx] = {"data": d[pos:end], "resolution": resolution,
                                 "tempo_us": tempo_us, "score": path.name}
            pos = end + 4
            idx += 1
        base += 16
    return slots



def parse_phrase_events(data, tempo_meta=True):
    """SEQ score bytes -> (events, tempo changes).

    events: `[(tick, kind, channel, a, b)]` in the score's own order. Order per
    event is EVENT then VLQ delta (verified against 2.seq phrase 6 = SHT_DOWN:
    prog change, 10-tick delta, layered note-ons, 120-tick delta, note-offs).
    Running status applies. kind: 'prog' (a=program), 'on' (a=note, b=vel),
    'off'.

    tempo changes: `[(tick, tempo_us)]` -- the block header's tempo is the
    implicit change at tick 0 and is NOT repeated here. A score may retime
    itself mid-phrase, and every tick after that point is on a different grid.

    `FF` is a META PREFIX, not a status byte with two data bytes, and reading it
    as one desynchronises the rest of the score -- which is how a two-second
    jingle comes out five minutes long. The original says so itself: F0x8002fe2c
    dispatches on `status & 0xf0` (fns.s:34898-34908) and its `0xf0` arm
    (fns.s:34939-34948) stores 0xff at record+0x16, reads exactly ONE more byte,
    compares it with 0x2f -- the end-of-track type -- and otherwise calls the
    meta handler in the cell D0x8008150c, which F0x8003086c fills with
    F0x8003261c (`sw $v1, 0xc($v0)` into D0x80081500, fns.s:35540). That handler
    (fns.s:37518-37547) reads three bytes into one 24-bit tempo and divides
    0x3938700 (60,000,000) by it. Every one of the disc's 1152 blocks carries
    exactly one meta kind, `51` = set tempo with a 3-byte payload, 91 blocks
    carrying one; that is the only payload length read here and any other type
    raises rather than being guessed at.
    `tests/sfx-area-phrases.test.js` re-parses all 1152 blocks with this and
    fails if any stops landing exactly on its `FF 2F 00` terminator.

    `tempo_meta=False` is the SUPERSEDED reading -- `FF` treated as a status
    byte with two data bytes -- kept for one purpose only: naming the render the
    shared `web/assets/sfx` tree still holds, which a worktree cannot rewrite
    (`phrase_mix_digests`). Nothing renders with it.
    """
    events = []
    tempos = []
    pos = 0
    tick = 0
    status = None
    while pos < len(data):
        if data[pos] & 0x80:
            status = data[pos]
            pos += 1
        if status is None or pos >= len(data):
            break
        kind = status & 0xF0
        ch = status & 0x0F
        if kind == 0xF0 and tempo_meta:
            mtype = data[pos]
            pos += 1
            if mtype == 0x2F:
                break
            if mtype != 0x51:
                raise ValueError(f"unhandled SEQ meta type 0x{mtype:02x} at {pos - 2:#x}")
            tempos.append((tick, int.from_bytes(data[pos:pos + 3], "big")))
            pos += 3
        elif kind == 0xC0:
            events.append((tick, "prog", ch, data[pos], 0))
            pos += 1
        elif kind == 0x90:
            note, vel = data[pos], data[pos + 1]
            pos += 2
            events.append((tick, "on" if vel > 0 else "off", ch, note, vel))
        elif kind == 0x80:
            events.append((tick, "off", ch, data[pos], 0))
            pos += 2
        elif kind == 0xD0:
            pos += 1                       # channel pressure: 1 data byte
        else:
            pos += 2                       # Bn CC / An aftertouch / En pitch bend
        delta = 0
        while pos < len(data):
            b = data[pos]
            pos += 1
            delta = (delta << 7) | (b & 0x7F)
            if not (b & 0x80):
                break
        tick += delta
    return events, tempos


def phrase_spt(phrase, tempo_us):
    """Samples per score tick at one tempo, from the block's own two numbers."""
    return SAMPLE_RATE * tempo_us / (phrase["resolution"] * 1e6)


def phrase_timeline(phrase, tempo_meta=True):
    """[(tick, samples-per-tick)] for the whole score, opening at tick 0.

    A set-tempo meta event retimes the score from its own tick onwards, so the
    grid is piecewise. `tests/sfx-area-phrases.test.js` checks all 1152 blocks.
    """
    _, tempos = parse_phrase_events(phrase["data"], tempo_meta)
    out = [[0, phrase_spt(phrase, phrase["tempo_us"])]]
    for tick, tempo_us in tempos:
        if tick == out[-1][0]:
            out[-1][1] = phrase_spt(phrase, tempo_us)
        else:
            out.append([tick, phrase_spt(phrase, tempo_us)])
    return out


def phrase_sample_at(timeline, tick):
    """The sample offset a score tick lands at, integrating the tempo changes.

    Floored per segment, exactly as the previous single-tempo `int(tick * spt)`
    was: one note placed a sample early is still the note the score asked for,
    and rounding each segment separately is what keeps a phrase's total length
    the sum of its parts.
    """
    if tick <= 0:
        return 0
    acc = 0
    at = 0
    for i, (t0, spt) in enumerate(timeline):
        if tick <= t0:
            break
        nxt = timeline[i + 1][0] if i + 1 < len(timeline) else None
        end = tick if nxt is None or tick < nxt else nxt
        acc += int((end - t0) * spt)
        at = end
    return acc


def phrase_voice_offs(phrase, counts, rule="all", tempo_meta=True):
    """The note-off that releases each SPU VOICE of a phrase, in voice order:
    `(tick, sample)` for the one that frees it, None for a voice the score never
    turns off.

    `counts` is how many voices each note-on event took — one per covering VAB
    tone — so this walks the voices, not the note-ons, because that is the level
    the original's key-off works at: a layered note is two voices and one
    note-off frees both.

    `rule="all"` is the original's rule and the only one the walker renders: one
    note-off releases EVERY voice still keyed on for that note. `rule="last"` is
    the rule the walker shipped before that was read out of the sequencer: one
    note-off releases only the newest voice of that (channel, note), and that
    note is then off the board, so the next note-off of it matches nothing and
    the older repeats — and the other tone of a layered note — ring to the end
    of the score. It is kept only so the build can record the render the shared
    asset tree still holds (see `resolve_and_emit`).

    HOW THE ORIGINAL PAIRS THEM. A note-off in a score is a `9n` event with
    velocity 0, and the score player turns it into a key-off of the sound, not
    of a channel: F0x8002fe2c reads the data byte after the status byte into
    $a3 (fns.s:34896 `lbu $s4, ($v0)` -> :34989 `move_ $a3, $s4`) and
    F0x800327ec branches on it (fns.s:37660 `beqz $a3, .L0x80032890`) — velocity 0
    goes to `jal F0x80035d38` (fns.s:37685), anything else takes a voice
    (fns.s:37675). Both paths build the same four key words out of the same
    fields (fns.s:37667-37686): `channel<<8 | bank`, the channel entry's program
    byte at +0x26, the per-entry byte at +0x37, and the note. That key-off walks
    all the voices and frees every one whose four match (F0x80035d38,
    fns.s:41213-41301: record +0x0e vs the note :41245, +0x14 vs the per-entry
    byte :41251, +0x10 vs `channel<<8 | bank` :41257, +0x18 vs the program byte
    :41263). Nothing in those four is the note's onset, so one note-off releases
    every repeat of that note, and both tones of a layered note.

    So (channel, note) identifies a group, and it stays one group because the
    only thing that rewrites the key is a program change on that channel — which
    `tests/sfx-phrase-voices.test.js` proves no shipped score does between a
    note-on and the note-off that releases it.
    """
    events, _ = parse_phrase_events(phrase["data"], tempo_meta)
    timeline = phrase_timeline(phrase, tempo_meta)
    outs = [(None, None)] * sum(counts)
    pending = {}            # (ch, note) -> the voices still keyed on
    n = 0                   # which note-on event; v, which voice
    v = 0
    for tick, kind, ch, a, b in events:
        if kind == "on":
            for _ in range(counts[n]):
                pending.setdefault((ch, a), []).append(v)
                v += 1
            n += 1
        elif kind == "off":
            held = pending.get((ch, a)) or []
            if rule == "all":
                for i in held:
                    outs[i] = (tick, phrase_sample_at(timeline, tick))
            elif held:
                outs[held.pop()] = (tick, phrase_sample_at(timeline, tick))
            if held:
                pending.pop((ch, a), None)
    return outs


def phrase_note_voices(phrase, bank_h, rule="all", tempo_meta=True):
    """Every note-on event of one phrase, ONE ENTRY PER COVERING VAB TONE.

    This is the list the original's sequencer builds for a note. F0x8003769c
    (fns.s:42886-42961) walks the program's tones and returns one (tone index,
    sample id) pair per tone whose [note_min, note_max] range covers the note;
    F0x8003581c then allocates ONE SPU VOICE PER ENTRY (fns.s:41033
    `.L0x80035a74: jal F0x80034b9c`), writes that voice's record from the same
    tone (priority = byte 0, fns.s:41016-41018), and keys it on. A layered
    note therefore costs two voices: TELEPORT's second note and every *_DOWN
    thud cover two tones of their program.

    Each entry carries the note-on tick, the tone's priority -- what the voice
    allocator is asked for -- and the sample, pitch, volume and release that
    render it. `off` is its release point in samples and `off_tick` the score's
    own note-off event, both paired by `phrase_voice_offs`.

    `rule`/`tempo_meta` exist only to render the superseded readings; the
    walker always asks for the original's own pair (see `phrase_voice_offs`
    and `parse_phrase_events`).
    """
    events, _ = parse_phrase_events(phrase["data"], tempo_meta)
    if not events:
        return []
    timeline = phrase_timeline(phrase, tempo_meta)
    prog = [0] * 16
    voices = []            # per note-on (per covering tone): source pcm + placement
    counts = []            # voices per note-on event, for the note-off pairing
    for tick, kind, ch, a, b in events:
        if kind == "prog":
            prog[ch] = a
        elif kind == "on":
            taken = 0
            for tone in bank_tones_for_note(bank_h, prog[ch], a):
                dec = bank_vag_pcm(bank_h, tone["vag"])
                if not dec or not dec[0]:
                    continue
                pcm, ls, le = dec
                semis = a - tone["center"] + tone["shift"] / 128.0
                rate = min(2.0 ** (semis / 12.0), 4.0)
                voices.append({
                    "start": phrase_sample_at(timeline, tick),
                    "pcm": pcm, "rate": rate,
                    "gain": (b / 127.0) * (tone["vol"] / 127.0),
                    "loop": (ls, le) if ls is not None and le else None,
                    "release": tone_release(tone),
                    # byte 0 of this note's tone record: the priority
                    # F0x80034b9c compares this voice's +0x18 against.
                    "priority": tone["priority"], "vag": tone["vag"],
                    "note": a, "program": prog[ch], "vel": b, "ch": ch,
                    "on_tick": tick, "off_tick": None, "off": None})
                taken += 1
            counts.append(taken)
    offs = phrase_voice_offs(phrase, counts, rule, tempo_meta)
    for v, (off_tick, off) in zip(voices, offs):
        v["off_tick"], v["off"] = off_tick, off
    default_off = phrase_sample_at(timeline, events[-1][0] + 1)
    for v in voices:
        v["default_off"] = default_off
    return voices


def render_phrase_voices(voices, gain=None):
    """Render one note-on voice to PCM: hold until its note-off, then decay with
    the tone's REAL adsr2 release (tone_release: exp time-constant / linear
    ramp). Looped tones keep looping through the release, one-shots keep playing
    their sample -- exactly the SPU's key-off behavior. A voice ends when its
    envelope falls below -40 dB or a one-shot sample runs out. `gain` overrides
    the note's own velocity x tone volume, which the per-note table leaves to
    the browser's gain node."""
    src, rate = voices["pcm"], voices["rate"]
    off = voices["off"] if voices["off"] is not None else voices["default_off"]
    rel_start = max(off - voices["start"], 1)
    rmode, rtime = voices["release"]
    rel_n = int(rtime * SAMPLE_RATE)
    if rmode == "exp":
        # exp decay reaches the -40 dB floor at ln(1/FLOOR) * tau
        rel_n = int(rtime * SAMPLE_RATE * 4.61)
    n = rel_start + max(rel_n, 1)
    if not voices["loop"]:
        n = min(n, int(len(src) / rate))       # one-shot: sample may end first
    ls, le = voices["loop"] if voices["loop"] else (None, None)
    g = voices["gain"] if gain is None else gain
    buf = []
    for i in range(n):
        sp = i * rate
        if ls is not None and sp >= le:
            sp = ls + (sp - ls) % (le - ls)
        j = int(sp)
        if j + 1 >= len(src):
            break
        s = src[j] * (1 - (sp - j)) + src[j + 1] * (sp - j)
        if i >= rel_start:
            t = (i - rel_start) / SAMPLE_RATE
            env = math.exp(-t / rtime) if rmode == "exp" else max(0.0, 1.0 - t / rtime)
            if env < FLOOR:
                break
            s *= env
        buf.append(s * g)
    return buf


FLOOR = 0.01                                   # -40 dB: below audibility


def phrase_mix(voices):
    """The phrase as ONE audio stream: every note voice placed at its own tick.
    This is what web/assets/sfx/<name>.wav holds, and what
    `tests/sfx-phrase-voices.test.js` re-sums the runtime note table against --
    against its digest, so the proof does not need the asset tree rebuilt."""
    rendered = [(v["start"], render_phrase_voices(v)) for v in voices]
    total = max((s + len(b) for s, b in rendered), default=0)
    mix = [0.0] * total
    for start, buf in rendered:
        for i, s in enumerate(buf):
            mix[start + i] += s
    return mix


def render_phrase(phrase, bank_h, rule="all", tempo_meta=True):
    """Render one phrase to 16-bit PCM @44.1kHz through that archive's own VAB."""
    mix = phrase_mix(phrase_note_voices(phrase, bank_h, rule, tempo_meta))
    return [max(-32768, min(32767, int(s))) for s in mix]


def phrase_digest(pcm):
    """Length and sha256 of a 16-bit PCM buffer, exactly as a WAV holds it.

    This is the pin between the two renderers of the same phrase: the Python
    render here, and `engine/systems/phrase-notes.ts` re-rendering every note in
    the browser. `tests/sfx-phrase-voices.test.js` compares every note's own
    digest, sample for sample, for every phrase the walker ships.
    """
    return {"samples": len(pcm),
            "sha256": hashlib.sha256(struct.pack(f"<{len(pcm)}h", *pcm)).hexdigest()}


# The two decode corrections this build has made to the phrase reader since the
# shared `web/assets/sfx` tree was last written: the note-off pairing (one
# note-off releases every voice of that note, F0x80035d38) and the `FF` meta
# prefix (F0x8002fe2c's 0xf0 arm). Each has one superseded reading, and the pair
# of them is a third. A worktree cannot rewrite the asset tree, so every render
# those readings produce is digested next to the current one: a test can then say
# which phrases the tree still holds an older render for, without a hand list.
SUPERSEDED_RENDERS = (("last", True), ("all", False), ("last", False))


def phrase_mix_row(phrase, bank_h, pcm):
    """`mix` for a phrase row: the current render's digest, plus every superseded
    reading's digest when it renders different audio.

    Labels are the inputs, not a date, so a reader can tell which correction the
    asset tree is behind on.
    """
    row = phrase_digest(pcm)
    superseded = []
    for rule, tempo_meta in SUPERSEDED_RENDERS:
        old = render_phrase(phrase, bank_h, rule, tempo_meta)
        # An empty render is not a render the asset tree can hold (the build
        # refuses to write one), so it is not a superseded WAV either.
        if old and old != pcm:
            superseded.append({"noteOff": rule, "tempoMeta": tempo_meta,
                               **phrase_digest(old)})
    if superseded:
        row["superseded"] = superseded
    return row


def render_phrase_voice16(v, gain=None):
    """One note voice as the 16-bit PCM a single hardware voice contributes to
    the mix: every sample truncated and clipped on its own, which is what the
    SPU's mixer does to each voice before it adds it to the sum.

    `render_phrase_voices` returns the same samples as unbounded floats, and
    `phrase_mix` adds those before the single clip at the end — that is what the
    one-stream WAV holds and it does not change. This is the per-voice form the
    browser plays, one AudioBufferSource per voice.

    `gain` overrides the note's own velocity x tone volume, which is what
    `phrase_voice_rows` does: the row rounds the gain to six decimals for the
    JSON, so the digest has to be taken with that same rounded value or the
    browser's render could never match it.
    """
    return [max(-32768, min(32767, int(s)))
            for s in render_phrase_voices(v, gain)]


def phrase_priority(phrase, bank_h):
    """The SPU-voice priority of a 2D phrase ROW = its FIRST note's.

    Each note-on of the phrase now carries its own priority through the runtime
    table (`web/sfx-voice/phrases.json`), and the walker takes one voice per
    note-on at that value -- the original's rule, one allocator call per note
    event (fns.s:41033). This field stays for the single-source fallback (and
    for the packed-id paths that never see the note table) and is the first
    note's value, because that is the voice the phrase's own first request
    asks for.
    """
    voices = phrase_note_voices(phrase, bank_h)
    return voices[0]["priority"] if voices else 0


def phrase_voice_rows(voices, sample_key=None):
    """The runtime table for one phrase: one row per SPU voice the original's
    sequencer would take for it.

    Each row carries everything the browser needs to render the voice itself
    (engine/systems/phrase-notes.ts is the port of `render_phrase_voices`):
    which sample (`sample`), at what pitch (`rate`), for how long before its
    note-off starts the release (`relStart`), the tone's own adsr2 release
    (`release`), and how loud the note plays (`gain`). `priority` is byte 0 of
    the note's tone record -- what F0x80034b9c is asked for when this voice is
    taken. `start` and `relStart` are in SAMPLES, like the render they feed: a
    millisecond field would lose the exact placement (a 3-decimal ms value is
    22 samples wide, and truncating it back moves a note by a sample).

    `onTick`/`offTick` are the score's own ticks for this voice: `offTick` is the
    note-off that released EVERY voice its note-on took, or null when the score
    never turns this note off and the voice therefore runs with the phrase
    (`default_off`). They are what `tests/sfx-phrase-voices.test.js` pins
    `relStart` against, out of the census's own note-off events.

    `voice` is the digest of this note's own 16-bit render, so the browser's
    port of the renderer is checked against this one, sample for sample, per
    voice — the phrase mix is a sum of these, and a sum can hide a wrong note.

    `sample` is the key into the phrase table's `samples` map. A VAB field
    number only means anything inside the archive it came from, so an area
    bank's rows are keyed `"<bank>:<vag>"` and the common bank's rows keep the
    bare field number; `sample_key` is how a caller says so.
    """
    rows = []
    for v in voices:
        off = v["off"] if v["off"] is not None else v["default_off"]
        rmode, rtime = v["release"]
        gain = round(v["gain"], 6)
        rows.append({
            "start": v["start"],
            "onTick": v["on_tick"],
            "offTick": v["off_tick"],
            "sample": v["vag"] if sample_key is None else sample_key(v),
            "rate": v["rate"],
            "relStart": max(off - v["start"], 1),
            "release": {"mode": rmode, "seconds": rtime},
            "gain": gain,
            "priority": v["priority"],
            "note": v["note"], "program": v["program"],
            "vel": v["vel"], "channel": v["ch"],
            "voice": phrase_digest(render_phrase_voice16(v, gain)),
        })
    return rows


def bank_vag_pcm(bank_h, vag_field):
    """Decode 1-BASED vag field F from the bank body (vab.rs numbering)."""
    lens = bank_h["lens"]
    idx = vag_field - 1
    start = sum(lens[j] << 3 for j in range(1, idx + 1))
    n = lens[idx + 1] << 3 if idx + 1 < 256 else 0
    if n == 0:
        return None
    body = bank_h["vb"].read_bytes()
    return decode_vag_pcm(body[start : start + n])


def area_records():
    """Every sound the disc's own Sound Test names, with the bank it lives in.

    Read straight from tools/extract_soundtst.py's structural walk of the
    overlay (docs/research/audio/soundtst-categories.json): 71 per-category
    sound arrays plus the 72 category records, each `{name, archive_id}`. The
    category record's NAME is the sound pack's bank directory (COMMON ->
    `common`, BGM031 -> `bgm031`, CBTL00 -> `cbtl00`; checked against all 71 pack
    directories), so the bank needs no second table, and every row's packed
    archive (bits 18-24) equals its category's archive_id (checked for all 118
    non-common rows).

    This replaces the hand-kept soundtst-all-categories.json list, which had
    drifted: it carried 88 of the 118 rows and dropped 30 -- TRAIN_NG
    (0x00840000, the gym's missed rep) among them -- while the two card-duel
    rows that used to sit in EXTRA_AREA_RECORDS (CARDFIRE/CARDTHND, category
    38) are in category 38's own array all along. Reading the extractor's
    output drops those two hand rows and covers all 71 banks.
    """
    out = []
    for cat in load(AUDIO_DOCS / "soundtst-categories.json")["categories"]:
        if cat["category"] == 0:
            continue  # the common bank: the main build, not the area walk
        for sound in cat["sounds"]:
            out.append({"id": sound["id"], "name": sound["name"],
                        "bank": cat["name"].lower(), "category": cat["category"],
                        "archive_id": cat["archive_id"]})
    return out


def area_record_kind(pid):
    """How one non-common Sound-Test id is played: 'positional', 'phrase', or
    'music-start' (not an SFX at all).

    ONE place decides this, and both area builds ask it, because the two halves
    of the area path are one system: a bit-31-clear id is a SEQ phrase in the
    archive its own bits name, and a bit-31-set id is a row/tone/note of
    whatever bank the map has loaded.

    A music start is not an SFX: bit 31 clear with bits 30 and 29 set is the
    game's own 0x60... play-id form (build_music.py music_start_seqs, and
    sound-system.md 2026-07-03j "SEP = up to 16 SEQUENCES"), where the low bits
    select a SEP sequence rather than a phrase slot. The old test also demanded a
    zero low byte, so ids like TRAINING 0x60840002 and ENV_0205 0x610c0003 fell
    through and were decoded as flat-slot samples.
    """
    if ((pid >> 29) & 0x7) == 0x3:
        return "music-start"
    return "positional" if (pid >> 31) & 1 else "phrase"


def area_phrase_records():
    """Every non-common Sound-Test id the 2D path plays as a phrase, with the
    archive and the phrase slot its own bits name.

    The member list is the disc's, not a hand list: the Sound Test's own 71
    per-category arrays, filtered by `area_record_kind`. All 32 of the disc's
    non-common bit-31-clear ids land on a real block of their own archive's
    `.seq` file (`tests/sfx-area-phrases.test.js` proves it over the whole
    archive list), so nothing here is dropped and nothing is invented.
    """
    out = []
    for r in area_records():
        pid = int(r["id"], 16)
        if area_record_kind(pid) != "phrase":
            continue
        out.append({**r, "slot": pid & 0xFF, "row": (pid >> 8) & 0xFF,
                    "archive": (pid >> 18) & 0x7F})
    return out


def build_area_phrase_tables():
    """Every area-bank phrase the disc names, as the runtime note rows the
    browser plays -- one row per SPU voice, exactly as for the common bank.

    Returns `(rows, samples)` where `rows` is `{bank: {name: row}}` and
    `samples` is `{key: (bank, vag)}`: a VAG field number means nothing on its
    own, so a note's `sample` here is `"<bank>:<vag>"` and the sample table is
    keyed the same way. The common bank's rows keep the bare vag as the key, so
    that table and everything already reading it is untouched.

    All 32 members go in, not the four a decoded call site happens to reach:
    `playBank`/`playArea`/`playPacked` name any of them by bank and name, and a
    table that only carried the four would leave the other 28 on the old wrong
    resolution the moment anything asked for them.
    """
    rows = {}
    samples = {}
    banks = {}
    for r in area_phrase_records():
        bank = r["bank"]
        if bank not in banks:
            banks[bank] = (parse_seq_phrases(bank), parse_bank(bank))
        phrases, h = banks[bank]
        phrase = phrases.get(r["slot"])
        if h is None or phrase is None:
            raise ValueError(f"{r['name']} ({bank}): slot {r['slot']} has no score or no VAB")
        voices = phrase_note_voices(phrase, h)
        notes = phrase_voice_rows(voices, lambda v, b=bank: f"{b}:{v['vag']}")
        for v in voices:
            samples.setdefault(f"{bank}:{v['vag']}", (bank, v["vag"]))
        mix = [max(-32768, min(32767, int(x))) for x in phrase_mix(voices)]
        rows.setdefault(bank, {})[r["name"].lower()] = {
            "id": r["id"],
            "slot": r["slot"],
            "row": r["row"],
            "archive": r["archive"],
            "score": phrase["score"],
            "notes": notes,
            # The mix the build would write as the bank's one-stream WAV, with
            # every superseded reading beside it. It is NOT in web/assets/sfx (a
            # shared build product a worktree cannot rewrite, and the tree still
            # holds the flat-slot render these rows replace), so the digests are
            # how a test compares a future rebuild without reading it.
            "phraseMix": phrase_mix_row(phrase, h, mix),
            "priority": voices[0]["priority"] if voices else 0,
        }
    return rows, samples


def build_area_sounds():
    """Decode every non-common Sound-Test record from its own bank.

    Positional rows are one VAG tone each and are written per bank, as before.
    A 2D row is a PHRASE, not a tone: it is rendered through that archive's own
    `.seq` score and its own VAB exactly as the common bank's 2D cues are, so
    the one-stream WAV written here is the phrase mix -- the same audio the
    browser now plays note by note. (The walker prefers the note table, so this
    WAV is the fallback for a browser whose note table has not loaded.)
    """
    records = area_records()
    banks = {}
    phrases = {}
    manifest = {}
    skipped = []
    for r in records:
        if r["category"] == 0:
            continue  # common bank: handled by the main build below
        pid = int(r["id"], 16)
        name, bank = r["name"], r["bank"]
        kind = area_record_kind(pid)
        if kind == "music-start":
            skipped.append(f"{name} ({bank}): music-start command, not an SFX")
            continue
        # Positional ids resolve through whatever bank the CURRENT map has
        # loaded (the id encodes row/tone/note, not a bank) -- e.g. DOOROPEN
        # gets a different timbre per env bank, silent where the row is
        # absent. So positional records are resolved across ALL banks; a phrase
        # is meaningful only in its home archive (bits 18-24 name it).
        positional = kind == "positional"
        if not positional:
            if bank not in banks:
                banks[bank] = parse_bank(bank)
            # The positional sweep below warms `banks` for every pack, so a phrase
            # record for a bank it already touched must still parse that bank's own
            # score here; keyed off `banks` alone it raised KeyError (bgm015).
            if bank not in phrases:
                phrases[bank] = parse_seq_phrases(bank)
            h = banks[bank]
            phrase = phrases[bank].get(pid & 0xFF) if h else None
            if h is None or phrase is None:
                skipped.append(f"{name} ({bank}): phrase slot {pid & 0xFF} absent "
                               f"(authentically silent)")
                continue
            voices = phrase_note_voices(phrase, h)
            mix = [max(-32768, min(32767, int(x))) for x in phrase_mix(voices)]
            key = name.lower()
            write_pcm_wav(AREA_OUT / bank / f"{key}.wav", mix)
            manifest.setdefault(bank, {})[key] = {
                "id": r["id"],
                "category": (pid >> 18) & 0x7F,
                "dedup": bool((pid >> 30) & 1),
                "positional": False,
                "priority": phrase_priority(phrase, h),
                "rate": 1.0,       # the score plays each note at its own pitch
                "loop": None,      # the phrase mix is complete; nothing to sustain
            }
            continue
        targets = sorted(p.name for p in SOUND_PACK.iterdir())
        for tb in targets:
            if tb not in banks:
                banks[tb] = parse_bank(tb)
            h = banks[tb]
            if h is None:
                if tb == bank:
                    skipped.append(f"{name} ({bank}): bank files missing")
                continue
            tone = bank_tone(h, (pid >> 11) & 0x7F, (pid >> 7) & 0xF)
            note = pid & 0x7F
            if tone is None:
                if tb == bank:
                    skipped.append(f"{name} ({bank}): row/slot absent (authentically silent)")
                continue
            pcm = bank_vag_pcm(h, tone["vag"])
            if not pcm or not pcm[0]:
                if tb == bank:
                    skipped.append(f"{name} ({bank}): vag field {tone['vag']} empty")
                continue
            samples, ls, le = pcm
            key = name.lower()
            write_pcm_wav(AREA_OUT / tb / f"{key}.wav", samples)
            rate = 1.0 if note is None else min(
                2.0 ** ((note - tone["center"] + tone["shift"] / 128.0) / 12.0), 4.0)
            manifest.setdefault(tb, {})[key] = {
                "id": r["id"],
                "category": (pid >> 18) & 0x7F,
                "dedup": bool((pid >> 30) & 1),
                "positional": positional,
                "priority": tone["priority"],
                "rate": round(rate, 5),
                "loop": ({"start": ls / SAMPLE_RATE, "end": le / SAMPLE_RATE}
                         if ls is not None and le is not None else None),
            }
    with open(OUT / "area_manifest.json", "w") as f:
        json.dump(manifest, f, indent=1)
    n = sum(len(v) for v in manifest.values())
    print(f"area_manifest.json: {n} sounds across {len(manifest)} banks")
    for msg in skipped:
        print(f"  area-skip {msg}")


def build_set():
    """The names the common bank builds, from the two research tables that
    record which sounds the game plays.

    `action` and `confidence` in system-blip-semantics.json say WHICH UI event
    a sound marks and how many call sites were traced to it. Neither says
    whether the walker can play it, and gating the build on them dropped
    SWITCH03 -- the title screen's periodic "Press Start" beat, action
    "other:periodic_title_cue", confidence "single-source". Its one traced site
    is real (pro/stdwtitl.s:2747 `lui $a0,0x8004` + :2762 `ori $a0,0x113e` in
    the jalr delay slot, dispatched through the cell loaded at :2759 from
    `lui $v0,0x8005` = 0x8004113e) and the title menu plays that word
    (engine/dw3/ui/title-menu.ts:93). So the gate is the traced call
    site itself: any row the table anchored to code is built.
    """
    names = set(ALWAYS)
    for row in load(AUDIO_DOCS / "sfx-triggers.json"):
        if row["status"] == "decoded" and row.get("walker_hook") and PLAIN_NAME.match(row["name"]):
            names.add(row["name"])
    # Newly decoded call sites staged by the phrase-gap pass (2026-10-05) that the
    # lead has not yet folded into sfx-triggers.json, which the lead owns. Same row
    # shape; the file is read tolerantly so deleting it after folding is safe.
    staged = ROOT / "data/sfx-call-sites.json"
    if staged.exists():
        for row in load(staged)["rows"]:
            if row["status"] == "decoded" and row.get("walker_hook") and PLAIN_NAME.match(row["name"]):
                names.add(row["name"])
    for name, entry in load(AUDIO_DOCS / "system-blip-semantics.json").items():
        if name.startswith("_") or not isinstance(entry, dict):
            continue
        if entry.get("evidence"):
            names.add(name)
    return names


def resolve_and_emit(name, ids, tones, programs, row_to_packed, vag_loop, manifest,
                     bank_h=None, phrases=None, slot_tones=None, phrase_out=None,
                     emit_wav=True):
    """Resolve one common-bank sound NAME -> WAV + manifest entry.
    Returns None on success, else a human-readable failure reason (string).

    `emit_wav=False` resolves and digests everything but writes no WAV, for
    `--phrase-tables-only`: that mode exists because web/assets/sfx is a shared
    build product (and a symlink in a worktree), so regenerating the phrase note
    tables must never rewrite it.
    """
    entry = ids.get(name)
    if not entry:
        return f"{name}: not in soundtst-common-ids.json"
    packed = int(entry["id"], 16)
    key = name.lower()
    if not (packed >> 31) & 1:
        # 2D path: the id's slot is a SEQ PHRASE (1.seq/2.seq), not a flat VAB
        # tone ordinal -- render the phrase through the VAB (decode 2026-07-08).
        if not (phrases and bank_h):
            return f"{name}: 2D id {entry['id']} needs the seq phrases"
        slot = entry["slot"]
        if slot not in phrases:
            return f"{name}: 2D slot {slot} has no seq phrase"
        voices = phrase_note_voices(phrases[slot], bank_h)
        pcm = [max(-32768, min(32767, int(s))) for s in phrase_mix(voices)]
        if not pcm:
            return f"{name}: seq phrase {slot} rendered empty"
        if emit_wav:
            write_pcm_wav(OUT / f"{key}.wav", pcm)
        # The phrase as the original plays it: ONE SPU VOICE PER NOTE-ON
        # (fns.s:41033), each with that note's own tone priority, freed at its
        # note-off or at the end of its sample. The mix above is what this file
        # has always shipped; `phrase_out` is the same phrase as the list of
        # voices the walker now plays, each one rendered from the sample at
        # `web/sfx-voice/samples/<vag>.wav` so a note the pool has no room for
        # loses only itself.
        if phrase_out is not None:
            phrase_out[key] = {
                "id": entry["id"], "slot": slot,
                "notes": phrase_voice_rows(voices),
                # The mix those note voices must reproduce in the browser: the
                # digest of the WAV written just above, so the same-sound proof
                # does not have to read the (gitignored) asset tree — plus the
                # digest of every render a later decode correction has made
                # different, because the tree itself cannot be rewritten from a
                # worktree and a test has to be able to name what it is behind.
                "mix": phrase_mix_row(phrases[slot], bank_h, pcm),
            }
        manifest[key] = {
            "id": entry["id"],
            "category": (packed >> 18) & 0x7F,
            "dedup": bool((packed >> 30) & 1),
            "positional": False,
            "priority": phrase_priority(phrases[slot], bank_h),
            "rate": 1.0,        # rendered at true pitch/tempo
            "loop": None,       # the phrase mix is complete; nothing to sustain
        }
        return None
    vag, rate, priority = positional_resolve(packed, programs, row_to_packed, slot_tones)
    if vag is None:
        return f"{name}: positional id {entry['id']} unresolvable"
    inst = vag - 1  # 1-based VagAtr field -> 0-based extracted WAV
    src = COMMON_INST / f"{inst}.wav"
    if not src.exists():
        src = RECOVERED / f"{inst}.wav"
    if not src.exists():
        return f"{name}: no WAV for vag field {vag} (inst/{inst}.wav)"
    if emit_wav:
        shutil.copyfile(src, OUT / f"{key}.wav")
    loop = vag_loop.get(vag)
    manifest[key] = {
        "id": entry["id"],
        "category": (packed >> 18) & 0x7F,
        "dedup": bool((packed >> 30) & 1),
        "positional": True,
        "priority": priority,
        "rate": round(rate, 5),
        "loop": ({"start": loop["start"] / SAMPLE_RATE, "end": loop["end"] / SAMPLE_RATE}
                 if loop else None),
    }
    return None


def phrase_census(ids, bank_h, phrases):
    """Every phrase the disc ships, with every note-on event and each note's
    tone priority -- the census of the 2D path, read out of the two SEQ scores
    rather than off a hand list.

    One row per disc phrase slot (0-15 = 1.seq, 16-31 = 2.seq), named by the
    Sound Test's own id table (`soundtst-common-ids.json`: a bit-31-clear id
    IS a 2D-path sound, and its slot is the phrase). `noteOns` lists the score's
    note-on events; each carries the covering tones and each tone's byte-0
    priority, which is what the voice allocator is handed for that note
    (fns.s:41016-41018). `noteOffs` lists the score's note-off events, each of
    which releases every voice with that (channel, note). `programChanges` lists
    the `C0` events: a program change rewrites one of the four halfwords the
    key-off matches on, so it is what decides whether (channel, note) alone
    identifies the voices one note-off frees — and no shipped score changes a
    channel's program between a note-on and the note-off that releases it
    (`tests/sfx-phrase-voices.test.js` proves that over this census).
    `voices` is how many SPU voices the phrase asks the pool for in all, and
    `maxConcurrentNotes` how many it holds at once.
    """
    by_slot = {}
    for e in ids:
        if (int(e["id"], 16) >> 31) & 1:
            continue                      # bit 31 set = positional, not a phrase
        by_slot[e["slot"]] = e
    rows = []
    for slot in sorted(phrases):
        phrase = phrases[slot]
        entry = by_slot.get(slot)
        events, tempos = parse_phrase_events(phrase["data"])
        timeline = phrase_timeline(phrase)
        prog = [0] * 16
        note_ons = []
        offs = []
        changes = []
        seq = 0                   # the score's own event order, note-ons and
                                  # note-offs interleaved as the bytes emit them:
                                  # a note-on and a note-off can share a tick, and
                                  # which came first decides what the note-off frees
        for tick, kind, ch, a, b in events:
            if kind == "prog":
                prog[ch] = a
                changes.append({"tick": tick, "channel": ch, "program": a, "seq": seq})
            elif kind == "on":
                tones = []
                for t in bank_tones_for_note(bank_h, prog[ch], a):
                    tones.append({"noteMin": t["note_min"], "noteMax": t["note_max"],
                                  "priority": t["priority"], "vag": t["vag"],
                                  "vol": t["vol"], "center": t["center"],
                                  "shift": t["shift"]})
                note_ons.append({"tick": tick, "channel": ch, "program": prog[ch],
                                 "note": a, "vel": b, "seq": seq, "tones": tones})
            elif kind == "off":
                # The score's note-off event, kept whole: the original's handler
                # (F0x80035d38) turns ONE of these into the release of EVERY
                # voice whose (channel, note) matches, which is what pins each
                # voice's note-off in the runtime table.
                offs.append({"tick": tick, "channel": ch, "note": a, "seq": seq})
            seq += 1
        # concurrency from the score's own note-on / note-off order, one voice per
        # note-on at most: the original's pool holds one voice per sounding NOTE.
        cur = mx = 0
        for t, d in sorted([(n["tick"], 1) for n in note_ons]
                           + [(o["tick"], -1) for o in offs]):
            cur += d
            mx = max(mx, cur)
        last = max([e[0] for e in events], default=0)
        rows.append({
            "slot": slot,
            "score": phrase["score"],
            "name": entry["name"] if entry else None,
            "id": entry["id"] if entry else None,
            "resolution": phrase["resolution"], "tempoUs": phrase["tempo_us"],
            "samplesPerTick": round(timeline[0][1], 4),
            # A score may retime itself mid-phrase; the notes after the change
            # sit on the new grid. 91 of the disc's 1152 blocks do it at least
            # once, two of them in phrases the walker ships.
            "tempoChanges": [{"tick": t, "tempoUs": u} for t, u in tempos],
            "noteOns": note_ons,
            "noteOffs": offs,
            "programChanges": changes,
            "voices": sum(len(n["tones"]) for n in note_ons),
            "maxConcurrentNotes": mx,
            "durationMs": round(phrase_sample_at(timeline, last) * 1000.0 / SAMPLE_RATE, 1),
        })
    return rows


def main(tables_only=False):
    import tomllib

    ids = {e["name"]: e for e in load(AUDIO_DOCS / "soundtst-common-ids.json")}
    tones = {t["slot"]: t for t in load(AUDIO_DOCS / "common-tones-full.json")}
    # loop points are a property of the VAG sample, not the tone
    vag_loop = {}
    for t in tones.values():
        if t.get("vag") is not None and t.get("loop") and t["vag"] not in vag_loop:
            vag_loop[t["vag"]] = t["loop"]
    with open(DDW3_ROOT / "sound/dw2003/common.toml", "rb") as f:
        programs = tomllib.load(f)["programs"]
    row_to_packed = packed_program_index()
    slot_tones = vab_program_tones()
    bank_h = parse_bank("common")
    phrases = parse_seq_phrases("common")

    PHRASE_OUT.mkdir(parents=True, exist_ok=True)
    if not tables_only:
        OUT.mkdir(parents=True, exist_ok=True)
    manifest = {}
    phrase_tables = {}
    failures = []
    for name in sorted(build_set()):
        reason = resolve_and_emit(name, ids, tones, programs, row_to_packed, vag_loop, manifest,
                                  bank_h, phrases, slot_tones, phrase_tables, emit_wav=not tables_only)
        if reason:
            failures.append(reason)
        elif not tables_only:
            m = manifest[name.lower()]
            print(f"{name.lower()}: id={m['id']} rate={m['rate']} cat={m['category']}")

    if not tables_only:
        with open(OUT / "manifest.json", "w") as f:
            json.dump(manifest, f, indent=1)
        print(f"manifest.json: {len(manifest)} sounds")

    # --- op10 battle-effect sound table (0x800a368c; tech-effects-decode.md) ---
    # Every action-VM op10 plays common-bank sound table[type]. Resolve each of
    # the extracted packed ids to its Sound-Test name and build the WAV; emit a
    # type -> sfx-key map for battle3d. A type that does not resolve to a common
    # WAV is left silent (warn, not fail) -- honest gap, no invented cue.
    id_to_name = {int(e["id"], 16): e["name"] for e in
                  load(AUDIO_DOCS / "soundtst-common-ids.json")}
    fx_manifest = load(ROOT / "web/assets/battle/effects/manifest.json")
    op10_map = {}
    op10_warn = []
    for type_s, packed in sorted(fx_manifest.get("op10_sounds", {}).items(),
                                 key=lambda kv: int(kv[0])):
        name = id_to_name.get(int(packed))
        if not name or not PLAIN_NAME.match(name):
            op10_warn.append(f"op10 type {type_s}: id 0x{int(packed):08x} has no common name")
            continue
        key = name.lower()
        if key not in manifest:
            reason = resolve_and_emit(name, ids, tones, programs, row_to_packed, vag_loop, manifest,
                                      bank_h, phrases, slot_tones, phrase_tables,
                                      emit_wav=not tables_only)
            if reason:
                op10_warn.append(f"op10 type {type_s}: {reason}")
                continue
        op10_map[type_s] = key
    if not tables_only:
        with open(OUT / "op10_map.json", "w") as f:
            json.dump(op10_map, f, indent=1)
        print(f"op10_map.json: {len(op10_map)} battle sounds")

    # --- per-element special-attack loop (fightstg table 0x800a2498) ---------
    # F0x80086304 rebuilds the special-attack effect pack from SFSTDATA[id];
    # when that record's +0x08 sound field is not -1 it plays
    # 0x800a2498[sound] and keeps the voice handle at [obj+0xe4], stopping it
    # through [0x80055c50](id, handle) when the pack tears down. The eight
    # words of that table are BT_LOOP0-7, one per element. Build them all and
    # emit sound-index -> sfx key so battle3d can hold the loop for exactly as
    # long as the element backdrop is up.
    sf = load(ROOT / "docs/research/fight-3d/data/sfstdata_effect_table.json")
    loop_map = {}
    for entry in sf.get("soundTable", []):
        name = entry.get("name")
        if not name or not PLAIN_NAME.match(name):
            op10_warn.append(f"special-loop {entry.get('index')}: id "
                             f"{entry.get('packed')} has no common name")
            continue
        key = name.lower()
        if key not in manifest:
            reason = resolve_and_emit(name, ids, tones, programs, row_to_packed, vag_loop,
                                      manifest, bank_h, phrases, slot_tones, phrase_tables,
                                      emit_wav=not tables_only)
            if reason:
                op10_warn.append(f"special-loop {entry['index']}: {reason}")
                continue
        loop_map[str(entry["index"])] = key
    if not tables_only:
        with open(OUT / "special_loop_map.json", "w") as f:
            json.dump(loop_map, f, indent=1)
        print(f"special_loop_map.json: {len(loop_map)} element loops")
    for msg in op10_warn:
        print(f"  op10-skip {msg}")

    # manifest.json may have gained op10-only entries; rewrite with the final set
    if not tables_only:
        with open(OUT / "manifest.json", "w") as f:
            json.dump(manifest, f, indent=1)

    # --- the 2D phrases as note events, and the census of all of them -------
    # EVERY area-bank phrase the disc names, not only the ones a decoded call
    # site reaches: playBank/playArea/playPacked name any of them by archive and
    # name, so a table carrying four of the 32 would leave the rest on the old
    # wrong resolution.
    area_rows, area_samples = build_area_phrase_tables()
    emit_phrase_tables(phrase_tables, bank_h, area_rows, area_samples)

    if not tables_only:
        build_area_sounds()

    if failures:
        for msg in failures:
            print(f"MISSING {msg}", file=sys.stderr)
        sys.exit(1)


def archive_census(walker_banks):
    """EVERY `.seq` phrase slot the disc ships, per archive.

    The 2D path is not a common-bank thing: F0x800205f0's archive-load state
    machine loads EVERY archive's own `.seq` file (fns.s:18208-18284), 16
    phrases per file, so the disc's phrase slots are every block of every
    archive's score, not just mpcommon's 32. This walks the sound pack itself --
    one row per archive, one row per slot -- so the member list is read off the
    data and `tests/sfx-area-phrases.test.js` can require the runtime table's
    list to equal it.

    A slot is `walker` when the disc's Sound Test names it AND the runtime note
    table carries it. Every named non-common slot is carried (all 32), so on
    this disc `walker` is decided by the naming alone; the conjunction is there
    so a future disc with a named slot the build drops shows up as a gap rather
    than as agreement.
    """
    named = {(r["bank"], r["slot"]): r for r in area_phrase_records()}
    out = []
    for bank in sorted(p.name for p in SOUND_PACK.iterdir()):
        mp = SOUND_PACK / bank / f"mp{bank}"
        if not mp.is_dir():
            continue
        scores = sorted(p.name for p in mp.glob("*.seq"))
        slots = parse_seq_phrases(bank)
        h = parse_bank(bank)
        rows = []
        for slot in sorted(slots):
            phrase = slots[slot]
            events, tempos = parse_phrase_events(phrase["data"])
            entry = named.get((bank, slot))
            prog = [0] * 16
            voices = 0
            for tick, kind, ch, a, b in events:
                if kind == "prog":
                    prog[ch] = a
                elif kind == "on":
                    voices += len(bank_tones_for_note(h, prog[ch], a)) if h else 0
            rows.append({
                "slot": slot,
                "score": phrase["score"],
                "name": entry["name"] if entry else None,
                "id": entry["id"] if entry else None,
                "resolution": phrase["resolution"],
                "tempoUs": phrase["tempo_us"],
                "tempoChanges": len(tempos),
                "events": len(events),
                "noteOns": sum(1 for e in events if e[1] == "on"),
                "noteOffs": sum(1 for e in events if e[1] == "off"),
                "programChanges": sum(1 for e in events if e[1] == "prog"),
                # Voices the sequencer would ask the pool for: one per note-on's
                # covering VAB tone, which is 0 when no tone covers the note --
                # and then the note is silent on the SPU too.
                "voices": voices,
                "durationMs": round(phrase_sample_at(phrase_timeline(phrase),
                                                      max([e[0] for e in events], default=0))
                                    * 1000.0 / SAMPLE_RATE, 1),
                "walker": bool(entry) and bank in walker_banks,
            })
        out.append({"bank": bank, "scores": scores, "slots": len(slots), "rows": rows})
    return out


def emit_phrase_tables(phrase_tables, bank_h, area_rows, area_samples):
    """Write what the walker plays a 2D phrase from, and the census of them all.

    A 2D cue is ONE SPU VOICE PER NOTE-ON in the original: F0x8003581c asks
    F0x80034b9c once per note event (fns.s:41033) with that note's own tone
    priority, and a refusal drops that note and the phrase carries on
    (fns.s:41039-41040 sets the return value to -1 and continues the loop).

    `web/sfx-voice/` is what web/audio.js plays from: the exact VAG samples the
    phrases' notes are built from, and one note row per voice, each with the
    digest of its own 16-bit render so the browser's port of the renderer is
    checked per voice. `phrases` holds the common bank's rows, keyed by name;
    `banks` holds every other archive's, keyed by archive then name -- the same
    shape one level down, because a VAB field number and a sound name both mean
    nothing without the archive they came from.

    `docs/research/audio/phrase-notes.json` is the census: `phrases` is the
    common bank's 32 slots with every note event, `archives` is every archive
    the disc ships a score for and every slot in it.

    Neither output touches web/assets/sfx, which is why this is a function of its
    own: `--phrase-tables-only` can regenerate both without writing a WAV.
    """
    sample_rows = {}
    banks = {"common": bank_h}
    for row in phrase_tables.values():
        for note in row["notes"]:
            vag = note["sample"]
            if vag in sample_rows:
                continue
            dec = bank_vag_pcm(bank_h, vag)
            if not dec or not dec[0]:
                continue
            pcm, ls, le = dec
            write_pcm_wav(PHRASE_OUT / "samples" / f"{vag}.wav", pcm)
            sample_rows[vag] = {"file": f"samples/{vag}.wav", "samples": len(pcm),
                                "loopStart": ls, "loopEnd": le}
    for key, (bank, vag) in sorted(area_samples.items()):
        if key in sample_rows:
            continue
        if bank not in banks:
            banks[bank] = parse_bank(bank)
        dec = bank_vag_pcm(banks[bank], vag)
        if not dec or not dec[0]:
            continue
        pcm, ls, le = dec
        write_pcm_wav(PHRASE_OUT / "samples" / f"{bank}_{vag}.wav", pcm)
        sample_rows[key] = {"file": f"samples/{bank}_{vag}.wav", "samples": len(pcm),
                            "loopStart": ls, "loopEnd": le}
    with open(PHRASE_OUT / "phrases.json", "w") as f:
        json.dump({
            "note": "generated by build_sfx.py; one row per 2D phrase the walker "
                    "ships, one note per SPU voice the original's sequencer takes. "
                    "`phrases` is the common bank (sample = VAB field), `banks` is "
                    "every other archive (sample = \"<archive>:<VAB field>\")",
            "samples": sample_rows,
            "phrases": phrase_tables,
            "banks": area_rows,
        }, f, indent=1)
    voices_total = sum(len(v["notes"]) for v in phrase_tables.values())
    area_total = sum(len(v["notes"]) for b in area_rows.values() for v in b.values())
    print(f"phrases.json: {len(phrase_tables)} common phrases, {voices_total} note "
          f"voices; {sum(len(v) for v in area_rows.values())} area phrases in "
          f"{len(area_rows)} archives, {area_total} note voices; "
          f"{len(sample_rows)} samples")

    census = phrase_census(load(AUDIO_DOCS / "soundtst-common-ids.json"), bank_h,
                           parse_seq_phrases("common"))
    built_slots = {v["slot"] for v in phrase_tables.values()}
    for row in census:
        row["walker"] = row["slot"] in built_slots
    archives = archive_census(area_rows)
    with open(CENSUS_OUT, "w") as f:
        json.dump({
            "note": "generated by build_sfx.py -- `phrases` is every slot of the "
                    "common bank's 1.seq + 2.seq with its note-on events and each "
                    "covering tone's byte-0 voice priority; `archives` is every "
                    "archive the disc ships a score for and every slot in it",
            "phrases": census,
            "archives": archives,
        }, f, indent=1)
    slots = sum(a["slots"] for a in archives)
    print(f"phrase-notes.json: {len(census)} common phrases, "
          f"{sum(r['voices'] for r in census)} note voices, "
          f"{sum(1 for r in census if r['walker'])} of them in the walker; "
          f"{len(archives)} archives, {slots} phrase slots")


if __name__ == "__main__":
    # --phrase-tables-only regenerates web/sfx-voice/ and the census without
    # writing a single WAV into the shared asset tree.
    main(tables_only="--phrase-tables-only" in sys.argv[1:])
