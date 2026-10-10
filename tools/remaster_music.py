#!/usr/bin/env python3
"""Build optional, non-authentic remasters of selected DW3 music stems.

The authentic renders in web/assets/music are inputs and are never modified.
The default "hybrid" backend keeps the punch and character of the authentic
render while blending in the bundled GeneralUser GS instruments for additional
clarity. "modern" is the replacement-instruments-only experiment, and
"restored" is the earlier subtle DSP-only pass. The optional "audiosr" backend
first invokes the AudioSR CLI, then applies the same mastering pass. All are
audition variants, never evidence for the original game's sound.

Examples:
  ~/.local/bin/uv run --with mido --with numpy --with scipy --with soundfile \
    --with imageio-ffmpeg \
    python3 tools/remaster_music.py
  audiosr -h
  ~/.local/bin/uv run --with mido --with numpy --with scipy --with soundfile \
    --with imageio-ffmpeg \
    python3 tools/remaster_music.py --backend audiosr --stem bgm001
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import shutil
import subprocess
import sys
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import soundfile as sf
import imageio_ffmpeg
import mido
from scipy import signal


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import build_music as original_music  # noqa: E402

SOURCE_DIR = ROOT / "web/assets/music"
OUTPUT_DIR = ROOT / "web/assets/music-remastered"
REIMAGINED_DIR = ROOT / "web/assets/music-reimagined"

# Stage/bank associations come from the generated map_sound_archives.json and
# battle_music.json.  These labels describe the prototype audition set; they do
# not rename or replace the canonical bank stems.
PROTOTYPE_TRACKS = {
    "bgm001": "Asuka City",
    "bgm007": "Central Park / Wire Forest Entrance",
    "bgm010": "Seiryu City",
    "bgm016": "Suzaku City",
    "batl00": "Central-sector regular battle",
    "batl10": "East/South-sector regular battle",
}

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


@dataclass
class AudioStats:
    seconds: float
    sample_rate: int
    channels: int
    peak_dbfs: float
    rms_dbfs: float
    crest_db: float


def db(value: float) -> float:
    return 20.0 * math.log10(max(value, 1e-12))


def stats(audio: np.ndarray, sample_rate: int) -> AudioStats:
    peak = float(np.max(np.abs(audio)))
    rms = float(np.sqrt(np.mean(np.square(audio, dtype=np.float64))))
    return AudioStats(
        seconds=round(len(audio) / sample_rate, 6),
        sample_rate=sample_rate,
        channels=audio.shape[1],
        peak_dbfs=round(db(peak), 3),
        rms_dbfs=round(db(rms), 3),
        crest_db=round(db(peak) - db(rms), 3),
    )


def comparison(reference: np.ndarray, candidate: np.ndarray) -> dict:
    if reference.shape != candidate.shape:
        return {"waveform_correlation": None, "difference_rms_dbfs": None}
    ref = reference.astype(np.float64, copy=False).reshape(-1)
    new = candidate.astype(np.float64, copy=False).reshape(-1)
    denominator = math.sqrt(float(np.dot(ref, ref)) * float(np.dot(new, new)))
    correlation = float(np.dot(ref, new) / denominator) if denominator else 0.0
    difference_rms = float(np.sqrt(np.mean(np.square(ref - new))))
    return {
        "waveform_correlation": round(correlation, 5),
        "difference_rms_dbfs": round(db(difference_rms), 3),
    }


def biquad(kind: str, sample_rate: int, frequency: float, gain_db: float):
    """Return RBJ low/high-shelf biquad coefficients."""
    amplitude = 10.0 ** (gain_db / 40.0)
    omega = 2.0 * math.pi * frequency / sample_rate
    cosine, sine = math.cos(omega), math.sin(omega)
    alpha = sine / math.sqrt(2.0)
    if kind == "low":
        b = [
            amplitude * ((amplitude + 1) - (amplitude - 1) * cosine + 2 * math.sqrt(amplitude) * alpha),
            2 * amplitude * ((amplitude - 1) - (amplitude + 1) * cosine),
            amplitude * ((amplitude + 1) - (amplitude - 1) * cosine - 2 * math.sqrt(amplitude) * alpha),
        ]
        a = [
            (amplitude + 1) + (amplitude - 1) * cosine + 2 * math.sqrt(amplitude) * alpha,
            -2 * ((amplitude - 1) + (amplitude + 1) * cosine),
            (amplitude + 1) + (amplitude - 1) * cosine - 2 * math.sqrt(amplitude) * alpha,
        ]
    elif kind == "high":
        b = [
            amplitude * ((amplitude + 1) + (amplitude - 1) * cosine + 2 * math.sqrt(amplitude) * alpha),
            -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosine),
            amplitude * ((amplitude + 1) + (amplitude - 1) * cosine - 2 * math.sqrt(amplitude) * alpha),
        ]
        a = [
            (amplitude + 1) - (amplitude - 1) * cosine + 2 * math.sqrt(amplitude) * alpha,
            2 * ((amplitude - 1) - (amplitude + 1) * cosine),
            (amplitude + 1) - (amplitude - 1) * cosine - 2 * math.sqrt(amplitude) * alpha,
        ]
    else:
        raise ValueError(f"unknown shelf kind: {kind}")
    return np.asarray(b) / a[0], np.asarray(a) / a[0]


def restored_master(
    audio: np.ndarray,
    sample_rate: int,
    target_rms: float | None = None,
    punchy: bool = False,
) -> np.ndarray:
    """Conservative, deterministic restoration/mastering pass.

    This deliberately preserves sample count and channel count.  It removes
    sub-bass/DC rumble, adds restrained low/air shelves, slightly widens stereo,
    uses soft saturation for peak density, then applies a peak-safe gain stage.
    """
    out = np.asarray(audio, dtype=np.float64).copy()
    if not np.isfinite(out).all():
        raise ValueError("input contains non-finite samples")
    source_rms = float(np.sqrt(np.mean(np.square(out, dtype=np.float64))))
    target_rms = source_rms if target_rms is None else target_rms

    # Remove DC/subsonic energy without touching musical timing.
    sos = signal.butter(2, 28.0, btype="highpass", fs=sample_rate, output="sos")
    out = signal.sosfilt(sos, out, axis=0)

    # Small tonal moves: warmth and definition, not an attempted reconstruction.
    shelves = (
        (("low", 145.0, 1.1), ("high", 5600.0, 1.6))
        if punchy
        else (("low", 145.0, 0.8), ("high", 5800.0, 1.15))
    )
    for kind, frequency, gain in shelves:
        b, a = biquad(kind, sample_rate, frequency, gain)
        out = signal.lfilter(b, a, out, axis=0)

    # Preserve mono compatibility while opening already-stereo renders slightly.
    if out.shape[1] == 2:
        mid = (out[:, 0] + out[:, 1]) * 0.5
        side = (out[:, 0] - out[:, 1]) * 0.5 * (1.10 if punchy else 1.08)
        out[:, 0], out[:, 1] = mid + side, mid - side

    # Very gentle saturation supplies density without a hard compressor pumping
    # against synthesized drums and short PS1 sample envelopes.
    # The hybrid profile keeps more of the authentic attack envelope.
    drive = 1.02 if punchy else 1.08
    out = np.tanh(out * drive) / math.tanh(drive)

    # Loudness-match the authentic render for honest A/B comparison, but never
    # add more than 2 dB. Final true-peak limiting is approximated
    # conservatively at -1 dBFS sample peak.
    rms = float(np.sqrt(np.mean(np.square(out, dtype=np.float64))))
    desired_gain = target_rms / max(rms, 1e-12)
    out *= min(desired_gain, 10.0 ** (2.0 / 20.0))
    ceiling = 10.0 ** (-1.0 / 20.0)
    peak = float(np.max(np.abs(out)))
    if peak > ceiling:
        out *= ceiling / peak
    return out.astype(np.float32)


def run_audiosr(audio: np.ndarray, sample_rate: int, seed: int) -> tuple[np.ndarray, int]:
    """Run the official AudioSR CLI and return its generated 48 kHz result."""
    executable = shutil.which("audiosr")
    if not executable:
        raise RuntimeError(
            "AudioSR CLI not found. Install audiosr==0.0.7 in a dedicated "
            "Python 3.9 environment, then rerun with --backend audiosr."
        )
    with tempfile.TemporaryDirectory(prefix="dw3-audiosr-") as tmp:
        tmp_path = Path(tmp)
        source = tmp_path / "input.wav"
        result_dir = tmp_path / "output"
        result_dir.mkdir()
        sf.write(source, audio, sample_rate, subtype="PCM_24")
        subprocess.run(
            [
                executable,
                "-i",
                str(source),
                "-s",
                str(result_dir),
                "--model_name",
                "basic",
                "--seed",
                str(seed),
                "--suffix",
                "_audiosr",
            ],
            check=True,
        )
        candidates = sorted(result_dir.glob("*.wav"))
        if len(candidates) != 1:
            raise RuntimeError(f"AudioSR produced {len(candidates)} WAV files")
        enhanced, enhanced_rate = sf.read(
            candidates[0], dtype="float32", always_2d=True
        )

    # AudioSR is expected to return 48 kHz. Crop/pad only fractional rounding so
    # browser loop duration remains identical to the authentic source.
    expected = round((len(audio) / sample_rate) * enhanced_rate)
    tolerance = max(2, round(enhanced_rate * 0.002))
    if abs(len(enhanced) - expected) > tolerance:
        raise RuntimeError(
            f"AudioSR changed duration by {(len(enhanced) - expected) / enhanced_rate:.3f}s"
        )
    if len(enhanced) < expected:
        enhanced = np.pad(enhanced, ((0, expected - len(enhanced)), (0, 0)))
    else:
        enhanced = enhanced[:expected]
    return enhanced, enhanced_rate


def synthesize_sequence(
    midi_bytes: bytes,
    soundfont: Path,
    expected_frames: int,
    sample_rate: int,
    reverb: bool = False,
    chorus: bool = False,
) -> np.ndarray:
    with tempfile.TemporaryDirectory(prefix="dw3-modern-music-") as tmp:
        tmp_path = Path(tmp)
        clean_midi = tmp_path / "sequence.mid"
        rendered_wav = tmp_path / "sequence.wav"
        clean_midi.write_bytes(midi_bytes)
        subprocess.run(
            [
                original_music.FLUID,
                "-ni",
                "-r",
                str(sample_rate),
                "-R",
                "yes" if reverb else "no",
                "-C",
                "yes" if chorus else "no",
                "-g",
                "0.8",
                "-T",
                "wav",
                "-F",
                str(rendered_wav),
                str(soundfont),
                str(clean_midi),
            ],
            env=original_music.FLUID_ENV,
            capture_output=True,
            text=True,
            check=True,
            timeout=600,
        )
        modern, modern_rate = sf.read(
            rendered_wav, dtype="float32", always_2d=True
        )

    if modern_rate != sample_rate:
        raise RuntimeError(f"FluidSynth returned unexpected rate {modern_rate}")
    if modern.shape[1] == 1:
        modern = np.repeat(modern, 2, axis=1)
    if len(modern) < expected_frames:
        modern = np.pad(modern, ((0, expected_frames - len(modern)), (0, 0)))
    else:
        modern = modern[:expected_frames]
    return modern


def clean_sequence(stem: str) -> bytes:
    midi = original_music.DDW3_SOUND / stem / "tracks/0/0.midi"
    if not midi.exists():
        raise FileNotFoundError(f"missing extracted sequence: {midi}")
    return original_music.sanitize_midi(midi.read_bytes(), filename=stem)


def render_modern_instruments(
    stem: str, expected_frames: int, sample_rate: int
) -> np.ndarray:
    """Replay the original sequence with the bundled modern GM instruments."""
    return synthesize_sequence(
        clean_sequence(stem),
        original_music.SF2,
        expected_frames,
        sample_rate,
    )


MAJOR_PROFILE = np.asarray(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
MINOR_PROFILE = np.asarray(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)
MAJOR_SCALE = (0, 2, 4, 5, 7, 9, 11)
MINOR_SCALE = (0, 2, 3, 5, 7, 8, 10)
NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")


def infer_key(mid: mido.MidiFile) -> tuple[int, tuple[int, ...], str]:
    histogram = np.zeros(12, dtype=np.float64)
    for message in mid.tracks[0]:
        if message.type == "note_on" and message.velocity:
            histogram[message.note % 12] += max(1, message.velocity)
    if not histogram.any():
        return 0, MAJOR_SCALE, "major"
    histogram = (histogram - histogram.mean()) / max(histogram.std(), 1e-9)
    candidates = []
    for tonic in range(12):
        for mode, profile, scale in (
            ("major", MAJOR_PROFILE, MAJOR_SCALE),
            ("minor", MINOR_PROFILE, MINOR_SCALE),
        ):
            rotated = np.roll(profile, tonic)
            score = float(np.dot(histogram, rotated))
            candidates.append((score, tonic, scale, mode))
    _, tonic, scale, mode = max(candidates)
    return tonic, scale, mode


def nearest_pitch(note: int, pitch_classes: set[int]) -> int:
    candidates = [
        pitch
        for pitch in range(max(0, note - 6), min(127, note + 6) + 1)
        if pitch % 12 in pitch_classes
    ]
    return min(candidates, key=lambda pitch: (abs(pitch - note), pitch)) if candidates else note


def shifted_scale_pitch(
    note: int, tonic: int, scale: tuple[int, ...], degrees: int
) -> int:
    scale_notes = [
        pitch
        for pitch in range(128)
        if (pitch - tonic) % 12 in scale
    ]
    index = min(range(len(scale_notes)), key=lambda i: abs(scale_notes[i] - note))
    return scale_notes[max(0, min(len(scale_notes) - 1, index + degrees))]


def reimagine_sequence(stem: str) -> tuple[bytes, dict]:
    """Create a theory-constrained variation from the original note stream.

    Rhythm, tempo, controller data, and instrument slots remain recognizable.
    Bass follows a stable four-chord loop; inner voices target chord tones; lead
    voices use a repeating eight-step motif with a changed final response.
    """
    mid = mido.MidiFile(file=io.BytesIO(clean_sequence(stem)))
    tonic, scale, mode = infer_key(mid)
    notes_by_channel = {
        channel: [
            message.note
            for message in mid.tracks[0]
            if message.type == "note_on"
            and message.velocity
            and message.channel == channel
        ]
        for channel in range(16)
    }
    populated = {channel: notes for channel, notes in notes_by_channel.items() if notes}
    medians = {
        channel: float(np.median(notes)) for channel, notes in populated.items()
    }
    groove_channel = max(populated, key=lambda channel: len(populated[channel]))
    ticks_per_beat = mid.ticks_per_beat
    progression = (0, 5, 3, 4) if mode == "major" else (0, 5, 2, 6)
    motif = (0, 1, 0, -1, 2, 0, -2, 1)
    active: dict[tuple[int, int], list[int]] = {}
    absolute_tick = 0

    for message in mid.tracks[0]:
        absolute_tick += message.time
        if message.type not in ("note_on", "note_off"):
            continue
        key = (message.channel, message.note)
        is_on = message.type == "note_on" and message.velocity > 0
        if not is_on:
            mapped = active.get(key)
            if mapped:
                message.note = mapped.pop(0)
            continue

        original_note = message.note
        channel = message.channel
        # Keep the busiest groove and channel 10 intact; this retains the
        # original percussion/sample rhythm while the pitched parts change.
        if channel in (groove_channel, 9):
            transformed = original_note
        else:
            bar = absolute_tick // max(1, ticks_per_beat * 4)
            chord_degree = progression[bar % len(progression)]
            chord_degrees = (
                chord_degree % 7,
                (chord_degree + 2) % 7,
                (chord_degree + 4) % 7,
            )
            chord_pcs = {
                (tonic + scale[degree]) % 12 for degree in chord_degrees
            }
            median = medians[channel]
            if median < 50:
                root_pc = (tonic + scale[chord_degree % 7]) % 12
                transformed = nearest_pitch(original_note, {root_pc})
            elif median < 70:
                transformed = nearest_pitch(original_note, chord_pcs)
            else:
                eighth = absolute_tick // max(1, ticks_per_beat // 2)
                degree_shift = motif[eighth % len(motif)]
                # Every fourth bar answers the hook rather than copying it.
                if bar % 4 == 3:
                    degree_shift -= 2
                transformed = shifted_scale_pitch(
                    original_note, tonic, scale, degree_shift
                )
                if absolute_tick % max(1, ticks_per_beat) < ticks_per_beat // 8:
                    transformed = nearest_pitch(transformed, chord_pcs)
                message.velocity = min(127, message.velocity + 5)
        message.note = transformed
        active.setdefault(key, []).append(transformed)

    output = io.BytesIO()
    mid.save(file=output)
    return output.getvalue(), {
        "tonic": tonic,
        "mode": mode,
        "key": f"{NOTE_NAMES[tonic]} {mode}",
        "groove_channel": groove_channel,
        "progression_degrees": list(progression),
    }


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_ogg(path: Path) -> tuple[np.ndarray, int]:
    """Decode through FFmpeg, avoiding libsndfile's unstable Vorbis reader."""
    with tempfile.TemporaryDirectory(prefix="dw3-remaster-decode-") as tmp:
        wav = Path(tmp) / "decoded.wav"
        subprocess.run(
            [
                FFMPEG,
                "-v",
                "error",
                "-i",
                str(path),
                "-c:a",
                "pcm_f32le",
                str(wav),
            ],
            check=True,
        )
        return sf.read(wav, dtype="float32", always_2d=True)


def write_ogg(path: Path, audio: np.ndarray, sample_rate: int) -> None:
    """Encode through FFmpeg so large buffers never reach libsndfile/Vorbis."""
    with tempfile.TemporaryDirectory(prefix="dw3-remaster-encode-") as tmp:
        wav = Path(tmp) / "master.wav"
        sf.write(wav, audio, sample_rate, subtype="PCM_24")
        subprocess.run(
            [
                FFMPEG,
                "-v",
                "error",
                "-y",
                "-i",
                str(wav),
                "-c:a",
                "libvorbis",
                "-q:a",
                "6",
                str(path),
            ],
            check=True,
        )


def render(
    stem: str,
    label: str,
    backend: str,
    seed: int,
    experimental_reimagined: bool = False,
) -> dict:
    source = SOURCE_DIR / f"{stem}.ogg"
    if not source.exists():
        raise FileNotFoundError(f"missing authentic source: {source}")
    authentic, sample_rate = read_ogg(source)
    before = stats(authentic, sample_rate)
    authentic_rms = float(
        np.sqrt(np.mean(np.square(authentic, dtype=np.float64)))
    )
    audio = authentic
    if backend in ("modern", "hybrid"):
        modern = render_modern_instruments(stem, len(audio), sample_rate)
        if backend == "hybrid":
            modern_rms = float(
                np.sqrt(np.mean(np.square(modern, dtype=np.float64)))
            )
            if modern_rms:
                modern *= authentic_rms / modern_rms
            # Authentic leads the blend to retain PS1 drum attacks and the
            # track's recognizable timbre; modern instruments add body/air.
            audio = authentic * 0.60 + modern * 0.40
        else:
            audio = modern
    elif backend == "audiosr":
        audio, sample_rate = run_audiosr(audio, sample_rate, seed)
    mastered = restored_master(
        audio,
        sample_rate,
        target_rms=authentic_rms,
        punchy=backend == "hybrid",
    )
    after = stats(mastered, sample_rate)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    destination = OUTPUT_DIR / f"{stem}.ogg"
    write_ogg(destination, mastered, sample_rate)
    decoded, decoded_rate = read_ogg(destination)
    if decoded_rate != sample_rate or len(decoded) != len(mastered):
        raise RuntimeError(f"encoded duration mismatch for {stem}")

    return {
        "stem": stem,
        "label": label,
        "backend": backend,
        "seed": seed if backend == "audiosr" else None,
        "source": f"../music/{stem}.ogg",
        "output": f"{stem}.ogg",
        "source_sha256": sha256(source),
        "output_sha256": sha256(destination),
        "before": asdict(before),
        "after": asdict(after),
        "comparison": comparison(authentic, mastered),
        "reimagined": (
            render_reimagined(stem, authentic, sample_rate, authentic_rms)
            if backend == "hybrid" and experimental_reimagined
            else None
        ),
    }


def render_reimagined(
    stem: str,
    authentic: np.ndarray,
    sample_rate: int,
    authentic_rms: float,
) -> dict:
    midi_bytes, theory = reimagine_sequence(stem)
    soundfont = original_music.SF2_BANKS / f"{stem}.sf2"
    creative = synthesize_sequence(
        midi_bytes, soundfont, len(authentic), sample_rate
    )
    creative = restored_master(
        creative,
        sample_rate,
        target_rms=authentic_rms,
        punchy=True,
    )
    REIMAGINED_DIR.mkdir(parents=True, exist_ok=True)
    destination = REIMAGINED_DIR / f"{stem}.ogg"
    write_ogg(destination, creative, sample_rate)
    decoded, decoded_rate = read_ogg(destination)
    if decoded_rate != sample_rate or len(decoded) != len(authentic):
        raise RuntimeError(f"reimagined duration mismatch for {stem}")
    return {
        "output": f"../music-reimagined/{stem}.ogg",
        "output_sha256": sha256(destination),
        "after": asdict(stats(creative, sample_rate)),
        "comparison": comparison(authentic, creative),
        "theory": theory,
        "authentic": False,
        "warning": "Creative variation; not original-game music.",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--backend",
        choices=("hybrid", "modern", "restored", "audiosr"),
        default="hybrid",
    )
    parser.add_argument(
        "--stem",
        action="append",
        choices=sorted(PROTOTYPE_TRACKS),
        help="render one prototype stem; repeatable (default: all)",
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--experimental-reimagined",
        action="store_true",
        help="generate the rejected automatic composition experiment",
    )
    args = parser.parse_args(argv)

    stems = args.stem or list(PROTOTYPE_TRACKS)
    reports = []
    for stem in stems:
        print(f"{stem}: {PROTOTYPE_TRACKS[stem]} [{args.backend}]")
        report = render(
            stem,
            PROTOTYPE_TRACKS[stem],
            args.backend,
            args.seed,
            experimental_reimagined=args.experimental_reimagined,
        )
        reports.append(report)
        print(
            f"  {report['before']['seconds']:.1f}s "
            f"{report['before']['rms_dbfs']:.1f} -> "
            f"{report['after']['rms_dbfs']:.1f} dBFS RMS"
        )

    manifest_path = OUTPUT_DIR / "manifest.json"
    manifest = {
        "profile": args.backend,
        "authentic": False,
        "warning": (
            "Optional audition remasters. These files are not evidence of "
            "original Digimon World 3 audio behavior."
        ),
        "tracks": reports,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {manifest_path.relative_to(ROOT)} ({len(reports)} tracks)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
