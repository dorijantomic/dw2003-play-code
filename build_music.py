"""
Renders the bgm MIDIs extracted from ~/ddw3 (decomp repo) to OGG for the game.

Requires: fluidsynth under /tmp/fslibs (see CLAUDE.md), GeneralUser-GS.sf2 in
third_party/, and numpy+soundfile+mido in the venv.

The ddw3-extracted MIDIs were produced by a tool that wraps raw PS1 SEQ track
bytes in an SMF header and PREPENDS one valid SMF tempo event (delta 0,
ff 51 03 tt tt tt) at the start.  The raw PS1 SEQ body encodes its own tempo
changes as `ff 51 tt tt tt` — NO length byte (PS1 SEQ format).  A standard
SMF parser reads the first tempo byte as a meta length and desyncs.

sanitize_midi() is a full SMF event-stream rewriter that handles this:
  * The first ff 51 in the file is treated as standard SMF (ff 51 03 tt tt tt).
  * Every subsequent ff 51 is treated as PSX form: read 3 tempo bytes directly
    (no length byte) and emit standard ff 51 03 tt tt tt.
  * All other events are copied through unchanged.

Render pipeline:
  sanitized .mid -> fluidsynth -ni -T oga (direct OGG output, no WAV step)
  -> read up to MAX_SECONDS, trim trailing silence, peak-normalize
  -> re-write OGG in chunks (soundfile segfaults writing large buffers at once)
"""
import io
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import mido
import numpy as np
import soundfile as sf

DDW3_SOUND = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "sound/dw2003"
OUT = Path(__file__).parent / "web/assets/music"
# Per-bank soundfonts built from the game's own VAB instruments
# (tools/vab_to_sf2.py); GeneralUser GS is only the fallback when a bank has
# no VAB (never expected -- every music bank ships one).
SF2_BANKS = Path(__file__).parent / "third_party/sf2_banks"
SF2 = Path(__file__).parent / "third_party/GeneralUser-GS.sf2"
# The offline renderer build_all's music stage provisions (tools/ddw3_toolchain.py
# builds it once, static, with no audio drivers); FLUIDSYNTH overrides it.
FLUID = os.environ.get("FLUIDSYNTH") or shutil.which("fluidsynth") or "fluidsynth"
FLUID_ENV = dict(os.environ)
MAX_SECONDS = 600
SAMPLE_RATE = 44100
SILENCE_TAIL = 0.5  # seconds of tail to keep after last non-silent sample
SILENCE_THRESH = 1e-4  # amplitude threshold for "silent"
PEAK_TARGET = 0.89
# soundfile's libvorbis encoder segfaults when handed very large arrays at once;
# writing in 10-second chunks avoids this.
OGG_WRITE_CHUNK = SAMPLE_RATE * 10


def _read_varlen(data: bytes, pos: int) -> tuple[int, int]:
    """Read a MIDI variable-length integer. Returns (value, new_pos)."""
    value = 0
    for _ in range(4):
        if pos >= len(data):
            raise ValueError(f"EOF reading varlen at offset {pos}")
        b = data[pos]
        pos += 1
        value = (value << 7) | (b & 0x7F)
        if not (b & 0x80):
            return value, pos
    raise ValueError(f"varlen too long at offset {pos - 4}")


def _encode_varlen(value: int) -> bytes:
    """Encode an integer as a MIDI variable-length quantity."""
    if value < 0:
        raise ValueError(f"negative varlen: {value}")
    parts = [value & 0x7F]
    value >>= 7
    while value:
        parts.append((value & 0x7F) | 0x80)
        value >>= 7
    parts.reverse()
    return bytes(parts)


def sanitize_midi(data: bytes, filename: str = "?") -> bytes:
    """
    Rewrite a PS1-SEQ-wrapped SMF to standard MIDI.

    The input has exactly one MTrk.  The track body is walked byte-by-byte:
      - varlen delta
      - status byte (with running-status support)
      - channel events: 0x8n/0x9n/0xAn/0xBn/0xEn = 2 data bytes,
                        0xCn/0xDn = 1 data byte
      - F0/F7 sysex: varlen length + payload (pass through)
      - FF meta:
          0x51 first time: standard form (ff 51 03 tt tt tt), copy as-is
          0x51 subsequent: PSX form (ff 51 tt tt tt, NO length), emit standard
          0x2f: end-of-track (ff 2f 00), copy and stop
          other: standard varlen length + data, copy through
    """
    if len(data) < 22:
        raise ValueError("file too short to be a valid MIDI")

    # --- Parse MThd (14 bytes) ---
    if data[:4] != b"MThd":
        raise ValueError("not a MIDI file (no MThd)")
    mthd = data[:14]

    # --- Parse MTrk header (8 bytes at offset 14) ---
    if data[14:18] != b"MTrk":
        raise ValueError("expected MTrk at offset 14")
    orig_trk_len = struct.unpack(">I", data[18:22])[0]
    track_data = data[22: 22 + orig_trk_len]
    if len(track_data) < orig_trk_len:
        # Some files are truncated; work with what we have
        track_data = data[22:]

    # --- Walk the track body ---
    out = bytearray()
    pos = 0
    last_status = 0
    seen_first_tempo = False
    warned_meta = set()
    eot_emitted = False

    while pos < len(track_data):
        # Read delta time
        delta_raw_start = pos
        delta, pos = _read_varlen(track_data, pos)

        if pos >= len(track_data):
            break  # truncated after delta

        b = track_data[pos]

        # Determine status (handle running status)
        if b & 0x80:
            status = b
            pos += 1
            if status != 0xFF and status < 0xF0:
                last_status = status
        else:
            # Running status — data byte, reuse last status
            status = last_status
            if status == 0:
                raise ValueError(
                    f"running status with no previous status at offset {pos + 22}"
                )

        out += _encode_varlen(delta)

        if status == 0xFF:
            # Meta event
            if pos >= len(track_data):
                raise ValueError(f"EOF after FF at offset {pos + 22}")
            meta_type = track_data[pos]
            pos += 1

            if meta_type == 0x51:
                if not seen_first_tempo:
                    # Standard SMF form: ff 51 03 tt tt tt
                    seen_first_tempo = True
                    if pos + 4 > len(track_data):
                        raise ValueError(f"truncated first tempo event at offset {pos + 22}")
                    length_byte = track_data[pos]
                    pos += 1
                    if length_byte != 3:
                        raise ValueError(
                            f"first ff51 has unexpected length {length_byte} at offset {pos + 22 - 1}"
                        )
                    tempo_bytes = track_data[pos: pos + 3]
                    pos += 3
                    out += bytes([0xFF, 0x51, 0x03]) + tempo_bytes
                else:
                    # PSX form: no length byte, just 3 tempo bytes
                    if pos + 3 > len(track_data):
                        raise ValueError(f"truncated PSX tempo event at offset {pos + 22}")
                    tempo_bytes = track_data[pos: pos + 3]
                    pos += 3
                    out += bytes([0xFF, 0x51, 0x03]) + tempo_bytes

            elif meta_type == 0x2F:
                # End of track: ff 2f 00
                if pos < len(track_data):
                    length_byte = track_data[pos]
                    pos += 1
                    pos += length_byte  # skip any payload (should be 0)
                out += bytes([0xFF, 0x2F, 0x00])
                eot_emitted = True
                break

            else:
                # Generic meta: varlen length + payload, copy through
                if meta_type not in warned_meta:
                    warned_meta.add(meta_type)
                    print(f"  [{filename}] meta ff {meta_type:02x} seen")
                length, pos = _read_varlen(track_data, pos)
                payload = track_data[pos: pos + length]
                pos += length
                out += bytes([0xFF, meta_type]) + _encode_varlen(length) + payload

        elif status == 0xF0 or status == 0xF7:
            # Sysex: varlen length + payload
            length, pos = _read_varlen(track_data, pos)
            payload = track_data[pos: pos + length]
            pos += length
            out += bytes([status]) + _encode_varlen(length) + payload

        else:
            # Channel message
            out += bytes([status])
            msg_type = status & 0xF0
            if msg_type in (0x80, 0x90, 0xA0, 0xB0, 0xE0):
                # 2 data bytes
                if pos + 2 > len(track_data):
                    raise ValueError(f"truncated 2-byte channel msg at offset {pos + 22}")
                out += track_data[pos: pos + 2]
                pos += 2
            elif msg_type in (0xC0, 0xD0):
                # 1 data byte
                if pos + 1 > len(track_data):
                    raise ValueError(f"truncated 1-byte channel msg at offset {pos + 22}")
                out += track_data[pos: pos + 1]
                pos += 1
            else:
                raise ValueError(
                    f"unknown status 0x{status:02x} at offset {pos + 22}"
                )

    if not eot_emitted:
        out += bytes([0x00, 0xFF, 0x2F, 0x00])

    # Rebuild the file: MThd + MTrk (with corrected length)
    new_trk_len = len(out)
    clean = mthd + b"MTrk" + struct.pack(">I", new_trk_len) + bytes(out)

    # Self-check: mido must load cleanly (no clip=)
    try:
        chk = mido.MidiFile(file=io.BytesIO(clean))
        if not any(True for _ in chk.tracks[0]):
            raise RuntimeError("track has no messages")
    except Exception as e:
        raise RuntimeError(f"sanitize_midi: output failed self-check: {e}") from e

    return clean


def bank_sf2(bank: str) -> Path:
    """The bank's own-instrument soundfont, built on demand."""
    out = SF2_BANKS / f"{bank}.sf2"
    if not out.exists():
        sys.path.insert(0, str(Path(__file__).parent / "tools"))
        import vab_to_sf2
        try:
            vab_to_sf2.build_sf2(bank, out)
        except Exception as e:
            print(f"  sf2 build failed for {bank}: {e} -- GM fallback")
    return out if out.exists() else SF2


def render(midi_bytes: bytes, ogg_path: Path, sf2: Path = None) -> float:
    """
    Render sanitized MIDI bytes to OGG at ogg_path.

    Pipeline:
      tmp .mid -> fluidsynth -ni -r 44100 -T raw -F tmp.raw (s16le stereo)
      -> read up to MAX_SECONDS -> trim trailing silence (SILENCE_TAIL)
      -> peak-normalize to PEAK_TARGET -> write OGG in chunks (avoids segfault)

    Returns duration in seconds of the written file.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        mid_path = os.path.join(tmpdir, "input.mid")
        raw_path = os.path.join(tmpdir, "output.raw")

        with open(mid_path, "wb") as f:
            f.write(midi_bytes)

        result = subprocess.run(
            [
                FLUID,
                "-ni",
                "-r", str(SAMPLE_RATE),
                # raw s16le stereo: needs no libsndfile in the renderer
                "-T", "raw", "-O", "s16", "-E", "little",
                "-F", raw_path,
                str(sf2 or SF2),
                mid_path,
            ],
            env=FLUID_ENV,
            capture_output=True,
            text=True,
            timeout=600,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"fluidsynth exited {result.returncode}: {result.stderr[:400]}"
            )

        # Read up to MAX_SECONDS (avoids allocating a huge array for long songs)
        max_frames = MAX_SECONDS * SAMPLE_RATE
        pcm = np.fromfile(raw_path, dtype="<i2", count=max_frames * 2)
        audio = (pcm[: len(pcm) // 2 * 2].reshape(-1, 2).astype(np.float32) / 32768.0)

        if audio.ndim == 1:
            audio = audio[:, np.newaxis]

        # Trim trailing silence: find last sample above threshold
        envelope = np.abs(audio).max(axis=1)
        nonsilent = np.where(envelope > SILENCE_THRESH)[0]
        if len(nonsilent) == 0:
            raise RuntimeError("render produced all-silent audio")
        last_sample = nonsilent[-1]
        tail_samples = int(SILENCE_TAIL * SAMPLE_RATE)
        trim_end = min(last_sample + tail_samples, len(audio))
        audio = audio[:trim_end]

        # Peak-normalize
        peak = np.abs(audio).max()
        if peak > 0:
            audio = audio * (PEAK_TARGET / peak)

        # Write OGG in chunks to avoid libvorbis segfault with large arrays
        ogg_path.parent.mkdir(parents=True, exist_ok=True)
        channels = audio.shape[1] if audio.ndim > 1 else 1
        with sf.SoundFile(
            str(ogg_path), "w",
            samplerate=SAMPLE_RATE,
            channels=channels,
            format="OGG",
            subtype="VORBIS",
        ) as out:
            for i in range(0, len(audio), OGG_WRITE_CHUNK):
                out.write(audio[i : i + OGG_WRITE_CHUNK])

    duration = len(audio) / SAMPLE_RATE
    return duration


def soundtst_rows():
    """Every sound the disc's own Sound Test names, with its bank and archive.

    Read from tools/extract_soundtst.py's structural walk of the overlay
    (docs/research/audio/soundtst-categories.json): 71 per-category sound
    arrays plus the 72 category records, each `{name, archive_id}`. The
    category record's NAME is the sound pack's bank directory (COMMON ->
    `common`, BGM031 -> `bgm031`; checked against all 71 pack directories), so
    the bank needs no second table. The walk reproduces the tables dumped from
    the running screen 231/231 (ledger
    soundtst-catalogue-and-navigation-2026-10-05).

    This replaces the hand-kept soundtst-all-categories.json list, which had
    drifted: it carried 201 of the disc's 231 rows across 70 categories and
    dropped category 70 (TTLBGM, TITLEBGM 0x611c0000) entirely. build_sfx.py's
    area_records reads the same extractor output.
    """
    cats = json.loads(
        (Path(__file__).parent / "docs/research/audio/soundtst-categories.json")
        .read_text())
    out = []
    for cat in cats["categories"]:
        for snd in cat["sounds"]:
            out.append({"id": snd["id"], "name": snd["name"],
                        "bank": cat["name"].lower(),
                        "category": cat["category"],
                        "archive_id": cat["archive_id"]})
    return out


def music_start_seqs():
    """bank -> sorted seq indices of its MUSIC-START records.

    Each bank's SEP holds up to 16 separate SEQUENCES (tracks/0/N.midi = seq N,
    ddw3-unvab-sep main.rs); the play id's low bits select WHICH. Ids with bits
    30+29 set (0x60...) and bit 31 clear are music starts (soundtst category
    records; every stage play_id in map_sound_archives.json is such an id with
    seq 0). The old "render the biggest midi" heuristic picked the wrong
    sequence wherever seq 0 isn't the biggest (bgm031 train, cbtl00, env011...).
    """
    out = {}
    for r in soundtst_rows():
        i = int(r["id"], 16)
        if (i >> 29) & 0x7 == 0x3:  # bit31 clear, bits 30+29 set = music start
            out.setdefault(r["bank"], []).append(i & 0xFFFF)
    return {b: sorted(set(v)) for b, v in out.items()}


# Byte-exact requester decodes for banks whose theme is NOT their lowest start
# record: stgtrain plays 0x60840002 (bgm031 seq 2, file 0x30b8); stplnmet also
# fires 0x6084000c. cbtl00's only start = CBTLMAIN seq 4 (falls out naturally).
SEQ_OVERRIDES = {
    "bgm031": 2,
    # evo_00/jog_00 sound-test records (EVOLUTIO 0x41140000 / JOGRESSE
    # 0x41180000) use the 0x40 flag form, seq 0; ttlbgm's single sequence is
    # seq 0 too and its own record (TITLEBGM 0x611c0000) now comes from the
    # catalogue, but the title code requests it directly, so pin it.
    "evo_00": 0,
    "jog_00": 0,
    "ttlbgm": 0,
}

# Music-start records inside the COMMON bank = global jingles fired by id, not
# by stage: GAMEOVER = 0x60040008 -> common SEP seq 8 (a sequenced jingle --
# NOT sample slot 8; the flat-slot WAV the sfx build used to ship for it was
# the wrong sound). DEMO_BGM seq 2, W_JINGLE seq 30, COM_CNFS seq 0.
COMMON_JINGLES = {"gameover": 8, "demo_bgm": 2, "w_jingle": 30}

# Sequenced one-shot SFX from other banks (bank, seq): DIGI_EN0/2 = the
# "Digimon entry/download" pieces in env205 (s212's own archive; ids
# 0x010c0000/0x010c0002 in the wstag212 data table).
EXTRA_JINGLES = {
    "digi_en0": ("env205", 0),
    "digi_en1": ("env205", 1),
    "digi_en2": ("env205", 2),
    # s225 login-pad materialize cue: the wstag225 effect actor's tick plays
    # packed id 0x00cc0001 = archive 0xcc (env011, s225's own bank) seq 1
    # when the claim phase runs (tools/extract_materialize_effects.py).
    "login_dl": ("env011", 1),
}


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    # bgm = per-stage music; env = wilderness ambience (mined scene structs,
    # tools/extract_map_sound_archives.py); batl/boss/cbtl = battle themes;
    # evo_00/jog_00 = evolution/jogress jingles (fightstg requests archives
    # 0x45/0x46 -- byte-exact); confus/ttlbgm = confusion status / title.
    starts = music_start_seqs()
    bgm_dirs = sorted(
        d for d in DDW3_SOUND.iterdir()
        if d.is_dir() and d.name.startswith(
            ("bgm", "env", "batl", "boss", "cbtl", "confus", "evo_", "jog_", "ttlbgm"))
    )

    # (bank, seq) pairs actually played: stage play_ids (mined scene structs)
    # + battle-trigger tags. Seq != 0 renders under the stem "<bank>_<seq>".
    used = {}
    data_dir = Path(__file__).parent / "web/assets/data"
    # archive id -> bank (id = sound-test category + 1), from the same walk
    arch2bank = {r["archive_id"]: r["bank"] for r in soundtst_rows()}
    try:
        for rec in json.loads((data_dir / "map_sound_archives.json").read_text()).values():
            # primary play id + conditional alt variants (story-state music
            # switches, e.g. s200's bgm029 paths). Each id names its OWN
            # archive in bits 18-24 (an alt may target a different bank).
            for pid_hex in [rec.get("play_id")] + rec.get("alt_play_ids", []):
                if not pid_hex:
                    continue
                pid = int(pid_hex, 16)
                bank = arch2bank.get((pid >> 18) & 0x7F)
                if bank:
                    used.setdefault(bank, set()).add(pid & 0xFFFF)
    except FileNotFoundError:
        pass
    try:
        for recs in json.loads((data_dir / "battle_music.json").read_text()).values():
            for r in recs:
                used.setdefault(r["bank"], set()).add(int(r["tag"], 16) & 0xFFFF)
    except FileNotFoundError:
        pass

    rendered_stems = []
    jobs = []
    for bgm_dir in bgm_dirs:
        name = bgm_dir.name
        seqs = set(used.get(name, set()))
        if name in SEQ_OVERRIDES:
            seqs.add(SEQ_OVERRIDES[name])
        elif not seqs:
            bank_starts = starts.get(name)
            if not bank_starts:
                # No stage/battle usage, no music-start record, no requester:
                # this bank is never STARTED as music (event-SFX-only bank).
                print(f"SKIP {name}  (no music-start record)")
                continue
            seqs.add(bank_starts[0])
        for seq in sorted(seqs):
            # A bank's canonical theme keeps the plain stem: seq 0, or the
            # byte-exact requester override (bgm031 train = seq 2, cbtl00
            # CBTLMAIN = seq 4). Other seqs get "<bank>_<seq>".
            canonical = SEQ_OVERRIDES.get(name, 0)
            stem = name if seq == canonical else f"{name}_{seq}"
            jobs.append((stem, bgm_dir / "tracks" / "0" / f"{seq}.midi", name))
    # common-bank jingles (GAMEOVER etc.) render through the same pipeline
    for stem, seq in sorted(COMMON_JINGLES.items()):
        jobs.append((stem, DDW3_SOUND / "common/tracks/0" / f"{seq}.midi", "common"))
    for stem, (bank, seq) in sorted(EXTRA_JINGLES.items()):
        jobs.append((stem, DDW3_SOUND / bank / "tracks/0" / f"{seq}.midi", bank))

    for stem, midi_path, bank in jobs:
        if not midi_path.exists():
            print(f"SKIP {stem}  ({midi_path.name} missing)")
            continue
        ogg_path = OUT / f"{stem}.ogg"
        try:
            clean = sanitize_midi(midi_path.read_bytes(), filename=stem)
            duration = render(clean, ogg_path, sf2=bank_sf2(bank))
            print(f"{stem}.ogg  ({midi_path.name}, {bank}.sf2)  {duration:.0f}s")
            rendered_stems.append(stem)
        except Exception as e:
            print(f"SKIP {stem}  {e}")
            continue

    index_path = OUT / "index.json"
    index_path.write_text(json.dumps(sorted(rendered_stems), indent=2) + "\n")
    print(f"\nWrote {index_path} ({len(rendered_stems)} stems)")

    # Verify: every stage-manifest music stem must exist as a non-empty OGG.
    manifest_path = Path(__file__).parent / "web/assets/manifest.json"
    if manifest_path.exists():
        stems = {
            m["music"] for m in json.loads(manifest_path.read_text()).get("maps", [])
            if m.get("music")
        }
        missing = sorted(s for s in stems if not (OUT / f"{s}.ogg").exists())
        if missing:
            print(f"MISSING stage music stems: {missing}", file=sys.stderr)
            sys.exit(1)
        print(f"verified {len(stems)} stage music stems present")


if __name__ == "__main__":
    main()
