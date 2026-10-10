#!/usr/bin/env python3
"""Compose and render original, loop-safe Asuka City companion variations.

This is deliberately authored from a conventional score rather than generated
by mutating DDW3 sequence events.  It borrows only the verified 128 BPM tempo
and the broad upbeat-city role; no original melody or VAB program mapping is
used.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import sys
from pathlib import Path

import mido
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import build_music
from remaster_music import restored_master, stats, synthesize_sequence, write_ogg


OUTPUT_DIR = ROOT / "web/assets/music-new"
MANIFEST_PATH = OUTPUT_DIR / "manifest.json"

BPM = 128
TPB = 480
BEATS_PER_BAR = 4
BARS = 32
TOTAL_TICKS = BARS * BEATS_PER_BAR * TPB
SAMPLE_RATE = 44_100
EXPECTED_FRAMES = round(BARS * BEATS_PER_BAR * 60 / BPM * SAMPLE_RATE)
# G major with a Mixolydian F-natural colour. F# is retained only as the bright
# leading tone/dominant colour heard in this style of fusion harmony.
G_FUSION = {7, 9, 11, 0, 2, 4, 5, 6}

VARIANTS = {
    "neon-promenade": {
        "title": "Asuka Neon Promenade",
        "character": "balanced jazz-fusion city loop",
        "instruments": {
            0: ("Electric Piano 1", 4, 88, 58),
            1: ("Slap Bass 1", 36, 108, 64),
            2: ("Synth Brass 1", 62, 76, 48),
            3: ("Lead 1 (square)", 80, 86, 76),
            4: ("Pad 2 (warm)", 89, 52, 68),
            5: ("Electric Guitar (clean)", 27, 70, 82),
        },
        "bass_style": "syncopated",
        "drum_style": "city",
        "arp_style": "eighths",
        "melodies": "balanced",
    },
    "chrome-circuit": {
        "title": "Asuka Chrome Circuit",
        "character": "bass-forward funk and brass variation",
        "instruments": {
            0: ("Clavinet", 7, 86, 54),
            1: ("Slap Bass 1", 36, 112, 64),
            2: ("Brass Section", 61, 86, 46),
            3: ("Lead 2 (sawtooth)", 81, 78, 78),
            4: ("Pad 2 (warm)", 89, 42, 70),
            5: ("Electric Guitar (muted)", 28, 78, 84),
        },
        "bass_style": "slap",
        "drum_style": "funk",
        "arp_style": "sixteenths",
        "melodies": "funk",
    },
    "pixel-skyline": {
        "title": "Asuka Pixel Skyline",
        "character": "bright PS1 synth and chiptune variation",
        "instruments": {
            0: ("Electric Piano 2", 5, 78, 56),
            1: ("Synth Bass 2", 39, 104, 64),
            2: ("Synth Brass 2", 63, 78, 50),
            3: ("Lead 1 (square)", 80, 94, 80),
            4: ("Pad 3 (polysynth)", 90, 46, 66),
            5: ("Lead 8 (bass + lead)", 87, 68, 82),
        },
        "bass_style": "pulse",
        "drum_style": "electronic",
        "arp_style": "sixteenths",
        "melodies": "pixel",
    },
}

# Voicings stay inside D major. The final A chord supplies the dominant pull
# needed to make the end-to-start loop sound intentional.
A_CHORDS = [
    ("G6/9", (43, 47, 50, 52, 57), 31),
    ("Fmaj9", (41, 45, 48, 52, 55), 29),
    ("Em7", (40, 43, 47, 50), 28),
    ("Cmaj9", (36, 40, 43, 47, 50), 36),
    ("G/B", (47, 50, 55, 59), 35),
    ("Am7", (45, 48, 52, 55), 33),
    ("C/D", (38, 48, 52, 55), 38),
    ("D7", (38, 42, 45, 48), 38),
]
B_CHORDS = [
    ("Em7", (40, 43, 47, 50), 28),
    ("Bm7", (47, 50, 54, 57), 35),
    ("Cmaj7", (36, 40, 43, 47), 36),
    ("G/D", (38, 43, 47, 50), 38),
    ("Am9", (45, 48, 52, 55, 59), 33),
    ("Em/G", (43, 47, 52, 55), 31),
    ("Fmaj9", (41, 45, 48, 52, 55), 29),
    ("D7", (38, 42, 45, 48), 38),
]

# (beat, duration, MIDI note). Each list is one bar. The phrases use repetition
# plus small variations so they are memorable without becoming mechanically
# identical.
MELODY_A = [
    [(0, 1, 78), (1, .5, 81), (1.5, .5, 83), (2, 1, 81), (3, 1, 78)],
    [(0, 1, 76), (1, .5, 78), (1.5, .5, 81), (2, 1, 83), (3, 1, 81)],
    [(0, 1, 78), (1, .5, 74), (1.5, .5, 76), (2, 1, 78), (3, 1, 71)],
    [(0, 2, 74), (2, 1, 71), (3, 1, 69)],
    [(0, 1, 78), (1, .5, 81), (1.5, .5, 83), (2, 1, 86), (3, 1, 85)],
    [(0, 1, 83), (1, .5, 79), (1.5, .5, 78), (2, 1, 76), (3, 1, 78)],
    [(0, 1, 79), (1, 1, 81), (2, 1, 83), (3, 1, 86)],
    [(0, .5, 85), (.5, .5, 83), (1, 1, 81), (2, 1, 76)],
]
MELODY_A2 = [
    [(0, .5, 78), (.5, .5, 81), (1, .5, 83), (1.5, .5, 86), (2, 1, 81), (3, 1, 78)],
    [(0, 1, 76), (1, .5, 78), (1.5, .5, 81), (2, .5, 83), (2.5, .5, 85), (3, 1, 81)],
    [(0, 1, 78), (1, .5, 74), (1.5, .5, 76), (2, 1, 78), (3, .5, 81), (3.5, .5, 83)],
    [(0, 1.5, 86), (1.5, .5, 83), (2, 1, 81), (3, 1, 78)],
    [(0, 1, 78), (1, .5, 81), (1.5, .5, 83), (2, 1, 86), (3, .5, 85), (3.5, .5, 81)],
    [(0, 1, 83), (1, .5, 79), (1.5, .5, 78), (2, 1, 76), (3, 1, 78)],
    [(0, .5, 79), (.5, .5, 81), (1, 1, 83), (2, .5, 86), (2.5, .5, 85), (3, 1, 83)],
    [(0, .5, 85), (.5, .5, 83), (1, 1, 81), (2, .5, 76), (2.5, .5, 78), (3, 1, 81)],
]
MELODY_B = [
    [(0, 1, 83), (1, 1, 78), (2, .5, 74), (2.5, .5, 76), (3, 1, 78)],
    [(0, 1, 81), (1, .5, 78), (1.5, .5, 76), (2, 1, 73), (3, 1, 69)],
    [(0, 1, 71), (1, 1, 74), (2, 1, 78), (3, 1, 79)],
    [(0, 1.5, 81), (1.5, .5, 78), (2, 1, 74), (3, 1, 69)],
    [(0, .5, 76), (.5, .5, 78), (1, 1, 79), (2, 1, 83), (3, 1, 81)],
    [(0, 1, 78), (1, .5, 74), (1.5, .5, 71), (2, 1, 74), (3, 1, 78)],
    [(0, 1, 79), (1, .5, 83), (1.5, .5, 81), (2, 1, 78), (3, 1, 74)],
    [(0, .5, 76), (.5, .5, 78), (1, 1, 81), (2, 1, 85), (3, 1, 81)],
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compose(
    slug: str, variant: dict
) -> tuple[bytes, dict, list[tuple[int, int, float, float, int]]]:
    events: list[tuple[int, int, mido.Message | mido.MetaMessage]] = []
    score_events: list[tuple[int, int, float, float, int]] = []
    melodic_notes: list[int] = []
    note_count = 0

    def event(beat: float, priority: int, message):
        events.append((round(beat * TPB), priority, message))

    def note(channel: int, pitch: int, beat: float, duration: float, velocity: int):
        nonlocal note_count
        end = beat + duration
        if beat < 0 or end > BARS * BEATS_PER_BAR:
            raise ValueError(f"note outside score: {channel=} {pitch=} {beat=} {end=}")
        event(beat, 2, mido.Message("note_on", channel=channel, note=pitch, velocity=velocity))
        event(end, 1, mido.Message("note_off", channel=channel, note=pitch, velocity=0))
        note_count += 1
        score_events.append((channel, pitch, beat, duration, velocity))
        if channel != 9:
            melodic_notes.append(pitch)

    events.extend([
        (0, 0, mido.MetaMessage("track_name", name=variant["title"])),
        (0, 0, mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(BPM))),
        (0, 0, mido.MetaMessage("time_signature", numerator=4, denominator=4)),
        (0, 0, mido.MetaMessage("key_signature", key="G")),
    ])
    instruments = variant["instruments"]
    for channel, (_name, program, volume, pan) in instruments.items():
        event(0, 0, mido.Message("program_change", channel=channel, program=program))
        event(0, 0, mido.Message("control_change", channel=channel, control=7, value=volume))
        event(0, 0, mido.Message("control_change", channel=channel, control=10, value=pan))
        event(0, 0, mido.Message("control_change", channel=channel, control=91, value=18))
    event(0, 0, mido.Message("control_change", channel=9, control=7, value=92))

    progressions = A_CHORDS + A_CHORDS + B_CHORDS + A_CHORDS
    melodies = {
        "balanced": MELODY_A + MELODY_A2 + MELODY_B + MELODY_A2,
        "funk": MELODY_B + MELODY_A2 + MELODY_A + MELODY_B,
        "pixel": MELODY_A2 + MELODY_B + MELODY_A2 + MELODY_A,
    }[variant["melodies"]]
    # The hand-written theme was first drafted in D. Move it into the authentic
    # track's G-centred register before arrangement; this is a fixed score
    # transposition, not key inference or automatic mutation.
    melodies = [
        [(offset, duration, pitch + 5) for offset, duration, pitch in bar]
        for bar in melodies
    ]

    for bar, ((_name, chord, bass_root), melody) in enumerate(zip(progressions, melodies)):
        start = bar * BEATS_PER_BAR
        energy = 1 if bar < 8 else 2 if bar < 24 else 3

        # Long pad and short off-beat electric-piano responses establish harmony.
        for pitch in chord:
            note(4, pitch + 12, start, 3.9, 42 + energy * 3)
        upper = tuple(pitch + 24 for pitch in chord[1:])
        # The 1, 1⅓, 1⅔ burst is a measured structural fingerprint of the
        # original sequence, used here with new chords and voicings.
        stabs = (0, 1, 4 / 3, 5 / 3, 2) if bar % 4 in (0, 2) else (.5, 2.5)
        for stab in stabs:
            for pitch in upper:
                duration = .20 if len(stabs) == 5 and stab not in (0, 2) else .55
                note(0, pitch, start + stab, duration, 54 + energy * 4)

        # A quantized guitar/synth ostinato gives the city its forward motion.
        arp = (chord[0] + 24, chord[2] + 24, chord[1] + 24, chord[3] + 24)
        arp_steps = 8 if variant["arp_style"] == "eighths" else 16
        arp_grid = 4 / arp_steps
        for step in range(arp_steps):
            pitch = arp[(step * 3 if arp_steps == 16 else step) % 4]
            accent = 10 if step % (4 if arp_steps == 16 else 2) == 0 else 0
            note(
                5,
                pitch,
                start + step * arp_grid,
                arp_grid * .58,
                42 + accent + energy * 2,
            )

        # Root/fifth bass with a scale-safe pickup into the next bar.
        # Use an actual chord tone rather than assuming every inversion's bass
        # can take a diatonic perfect fifth (C# -> G# would leave D major).
        fifth = chord[2]
        while fifth > 47:
            fifth -= 12
        next_root = progressions[(bar + 1) % BARS][2]
        approach = next_root - 2 if (next_root - bass_root) % 12 in (2, 4, 7, 9, 11) else next_root + 2
        if approach % 12 not in G_FUSION:
            approach = next_root
        bass_patterns = {
            "syncopated": (
                (0, bass_root, .72, 92),
                (.75, fifth, .28, 76),
                (1.5, bass_root + 12, .38, 88),
                (2, bass_root, .70, 90),
                (2.75, fifth, .28, 74),
                (3.5, approach, .35, 78),
            ),
            "slap": (
                (0, bass_root, .42, 102),
                (.75, fifth, .24, 84),
                (1.25, bass_root + 12, .24, 94),
                (1.75, fifth, .24, 80),
                (2, bass_root, .42, 100),
                (2.75, bass_root + 12, .24, 90),
                (3.25, fifth, .22, 82),
                (3.5, approach, .34, 88),
            ),
            "pulse": (
                (0, bass_root, .68, 94),
                (1, bass_root + 12, .42, 82),
                (1.5, fifth, .38, 76),
                (2, bass_root, .68, 92),
                (3, bass_root + 12, .42, 84),
                (3.5, approach, .34, 76),
            ),
        }
        for offset, pitch, duration, velocity in bass_patterns[variant["bass_style"]]:
            note(1, pitch, start + offset, duration, velocity + energy * 2)

        # Quantized kits differ in density, but all preserve the same 4/4 grid.
        drum_style = variant["drum_style"]
        hat_steps = 16 if drum_style in ("funk", "electronic") else 8
        for step in range(hat_steps):
            grid = 4 / hat_steps
            hat = 46 if step == hat_steps - 1 else 42
            note(9, hat, start + step * grid, .10, 42 + (step % 4 == 0) * 14)
        kicks = {
            "city": ((0, 98), (2, 92), (2.75, 72)),
            "funk": ((0, 106), (.75, 78), (2, 102), (2.5, 74), (3.5, 86)),
            "electronic": ((0, 104), (1.5, 78), (2, 100), (3.25, 82)),
        }[drum_style]
        for offset, velocity in kicks:
            note(9, 36, start + offset, .18, velocity + energy)
        for offset, velocity in ((1, 90), (3, 96)):
            note(9, 38, start + offset, .18, velocity + energy)
        if drum_style == "funk":
            note(9, 38, start + 2.75, .10, 46)
        if energy >= 2 or drum_style == "electronic":
            note(9, 39, start + 3, .10, 58)

        # The lead is intentionally monophonic and entirely diatonic.
        for offset, duration, pitch in melody:
            note(3, pitch, start + offset, duration * .88, 69 + energy * 3)

        # Restrained brass answers appear at phrase endings. The funk variation
        # also gets short off-beat section stabs.
        if bar % 4 == 3:
            for pitch in chord[:3]:
                note(2, pitch + 24, start + 3, .72, 50 + energy * 3)
        elif drum_style == "funk" and bar % 2 == 1:
            for stab in (1.5, 3.5):
                for pitch in chord[:3]:
                    note(2, pitch + 24, start + stab, .28, 56 + energy * 3)

    out_of_scale = sorted({pitch for pitch in melodic_notes if pitch % 12 not in G_FUSION})
    if out_of_scale:
        raise ValueError(f"out-of-scale melodic pitches: {out_of_scale}")

    events.sort(key=lambda item: (item[0], item[1]))
    track = mido.MidiTrack()
    previous_tick = 0
    active: set[tuple[int, int]] = set()
    hanging_or_overlapping = 0
    for tick, _priority, message in events:
        if message.type == "note_on" and message.velocity:
            key = (message.channel, message.note)
            hanging_or_overlapping += key in active
            active.add(key)
        elif message.type in ("note_off", "note_on"):
            key = (message.channel, message.note)
            hanging_or_overlapping += key not in active
            active.discard(key)
        message.time = tick - previous_tick
        track.append(message)
        previous_tick = tick
    if active or hanging_or_overlapping:
        raise ValueError(f"invalid note pairing: active={active}, errors={hanging_or_overlapping}")
    track.append(mido.MetaMessage("end_of_track", time=TOTAL_TICKS - previous_tick))

    midi = mido.MidiFile(type=0, ticks_per_beat=TPB)
    midi.tracks.append(track)
    buffer = io.BytesIO()
    midi.save(file=buffer)
    return buffer.getvalue(), {
        "slug": slug,
        "note_count": note_count,
        "melodic_note_count": len(melodic_notes),
        "out_of_scale_notes": 0,
        "hanging_or_overlapping_notes": 0,
        "end_tick": TOTAL_TICKS,
    }, score_events


def synthesize_punch_bus(
    score_events: list[tuple[int, int, float, float, int]],
    variant: dict,
) -> np.ndarray:
    """Add a deterministic PS1-era transient layer for bass and percussion."""
    out = np.zeros((EXPECTED_FRAMES, 2), dtype=np.float64)
    seed = int(hashlib.sha256(variant["title"].encode()).hexdigest()[:8], 16)
    rng = np.random.default_rng(seed)

    def add(wave: np.ndarray, beat: float, left: float = 1.0, right: float = 1.0):
        start = round(beat * 60 / BPM * SAMPLE_RATE)
        end = min(start + len(wave), EXPECTED_FRAMES)
        if end > start:
            out[start:end, 0] += wave[: end - start] * left
            out[start:end, 1] += wave[: end - start] * right

    bass_gain = {"syncopated": .13, "slap": .18, "pulse": .14}[
        variant["bass_style"]
    ]
    for channel, pitch, beat, duration, velocity in score_events:
        gain = velocity / 127
        if channel == 1:
            seconds = max(duration * 60 / BPM, .10)
            frames = round((seconds + .045) * SAMPLE_RATE)
            t = np.arange(frames) / SAMPLE_RATE
            frequency = 440 * 2 ** ((pitch - 69) / 12)
            phase = 2 * math.pi * frequency * t
            saw = 2 * ((frequency * t) % 1) - 1
            body = .68 * np.sin(phase) + .20 * np.sin(phase * 2) + .12 * saw
            envelope = (1 - np.exp(-t * 260)) * np.exp(-t * 4.2)
            release_start = max(0, round(seconds * SAMPLE_RATE) - 48)
            envelope[release_start:] *= np.linspace(
                1, 0, len(envelope) - release_start
            )
            noise = rng.standard_normal(frames)
            click = np.r_[noise[0], np.diff(noise)] * np.exp(-t * 85)
            wave = (body * envelope + click * .075) * gain * bass_gain
            add(wave, beat)
        elif channel == 9 and pitch == 36:
            frames = round(.24 * SAMPLE_RATE)
            t = np.arange(frames) / SAMPLE_RATE
            frequency = 45 + 105 * np.exp(-t * 30)
            phase = 2 * math.pi * np.cumsum(frequency) / SAMPLE_RATE
            click = rng.standard_normal(frames) * np.exp(-t * 115)
            wave = (
                np.sin(phase) * np.exp(-t * 17) + click * .10
            ) * gain * .30
            add(wave, beat)
        elif channel == 9 and pitch in (38, 39):
            frames = round(.20 * SAMPLE_RATE)
            t = np.arange(frames) / SAMPLE_RATE
            noise = rng.standard_normal(frames)
            bright = np.r_[noise[0], np.diff(noise)]
            body = np.sin(2 * math.pi * 185 * t)
            wave = (
                bright * np.exp(-t * 22) * .12
                + body * np.exp(-t * 19) * .08
            ) * gain
            add(wave, beat, .92, 1.0)
        elif channel == 9 and pitch in (42, 46):
            seconds = .055 if pitch == 42 else .16
            frames = round(seconds * SAMPLE_RATE)
            t = np.arange(frames) / SAMPLE_RATE
            noise = rng.standard_normal(frames)
            bright = np.r_[noise[0], np.diff(noise)]
            wave = bright * np.exp(-t * (85 if pitch == 42 else 28)) * gain * .025
            add(wave, beat, 1.0, .72)

    return out.astype(np.float32)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    tracks = []
    for slug, variant in VARIANTS.items():
        midi_path = OUTPUT_DIR / f"asuka-{slug}.mid"
        audio_path = OUTPUT_DIR / f"asuka-{slug}.ogg"
        midi_bytes, validation, score_events = compose(slug, variant)
        midi_path.write_bytes(midi_bytes)

        rendered = synthesize_sequence(
            midi_bytes,
            build_music.SF2,
            expected_frames=EXPECTED_FRAMES,
            sample_rate=SAMPLE_RATE,
            reverb=True,
            chorus=False,
        )
        # Keep the SF2 body, but put the purpose-built transient layer forward.
        punch_bus = synthesize_punch_bus(score_events, variant)
        rendered = rendered * .82 + punch_bus
        mastered = restored_master(
            rendered,
            SAMPLE_RATE,
            target_rms=10 ** (-15.0 / 20),
            punchy=True,
        )
        # Era-appropriate soft clipping supplies console-like density while the
        # separately synthesized kick/slap attacks retain their initial spike.
        drive = 1.35
        mastered = np.tanh(mastered * drive) / math.tanh(drive)
        # Bring the reverb tail to the same zero-amplitude boundary at which the
        # synthesizer starts. Ten milliseconds prevents a click at the loop.
        fade_in_frames = round(SAMPLE_RATE * .001)
        mastered[:fade_in_frames] *= np.linspace(0.0, 1.0, fade_in_frames)[:, None]
        fade_frames = round(SAMPLE_RATE * .010)
        mastered[-fade_frames:] *= np.linspace(1.0, 0.0, fade_frames)[:, None]
        # Peak-normalize so louder is not mistaken for better between variants.
        ceiling = 10 ** (-1.0 / 20)
        mastered *= ceiling / max(float(np.max(np.abs(mastered))), 1e-12)
        # Attenuate only the denser arrangement when needed, keeping all three
        # close to the authentic render's measured -16.1 dBFS RMS.
        target_rms = 10 ** (-16.1 / 20)
        current_rms = float(np.sqrt(np.mean(np.square(mastered, dtype=np.float64))))
        if current_rms > target_rms:
            mastered *= target_rms / current_rms
        if len(mastered) != EXPECTED_FRAMES or mastered.shape[1] != 2:
            raise RuntimeError(f"unexpected render shape: {mastered.shape}")
        if not np.isfinite(mastered).all():
            raise RuntimeError("render contains non-finite audio")
        write_ogg(audio_path, mastered, SAMPLE_RATE)

        track = {
            "slug": slug,
            "title": variant["title"],
            "character": variant["character"],
            "instruments": [
                {
                    "channel": channel + 1,
                    "name": name,
                    "gm_program_zero_based": program,
                }
                for channel, (name, program, _volume, _pan)
                in variant["instruments"].items()
            ] + [{"channel": 10, "name": "Standard drum kit", "gm_percussion": True}],
            "arrangement": {
                "bass_style": variant["bass_style"],
                "drum_style": variant["drum_style"],
                "ostinato": variant["arp_style"],
                "melody_order": variant["melodies"],
            },
            "validation": validation,
            "loop": {
                "exact_bar_boundary": True,
                "end_fade_milliseconds": 10,
                "boundary_sample_jump": round(
                    float(np.max(np.abs(mastered[0] - mastered[-1]))), 8
                ),
            },
            "audio": {
                **stats(mastered, SAMPLE_RATE).__dict__,
                "file": audio_path.name,
                "sha256": sha256(audio_path),
            },
            "midi": {
                "file": midi_path.name,
                "sha256": sha256(midi_path),
            },
        }
        tracks.append(track)
        print(
            f"Built {track['title']}: {validation['note_count']} notes, "
            f"{track['audio']['seconds']:.3f}s, {track['audio']['rms_dbfs']} dBFS RMS"
        )

    manifest = {
        "collection": "Asuka City original variations",
        "profile": "original-composition",
        "original_composition": True,
        "not_original_game_audio": True,
        "design_reference": {
            "source": "Asuka City role and verified tempo only",
            "original_melody_reused": False,
            "original_sequence_events_reused": False,
            "original_samples_reused": False,
        },
        "tempo_bpm": BPM,
        "key": "G major / Mixolydian",
        "time_signature": "4/4",
        "bars": BARS,
        "ticks_per_beat": TPB,
        "duration_seconds": EXPECTED_FRAMES / SAMPLE_RATE,
        "structure": ["A", "A variation", "B", "A finale"],
        "style": [
            "late-1990s/early-2000s JRPG town",
            "jazz-fusion",
            "PS1 synth and chiptune",
            "funk",
        ],
        "inspiration_analysis": {
            "status": "design-analysis-not-authenticity-evidence",
            "source_sequence": "bgm001",
            "source_parts": 12,
            "source_main_tempo_bpm": 128,
            "source_main_grid": [
                "half-beat",
                "quarter-beat",
                "one-third-beat chord bursts",
            ],
            "source_harmonic_centre": "G with F-natural and F-sharp colour",
            "copied_sequence_events": False,
        },
        "tracks": tracks,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
