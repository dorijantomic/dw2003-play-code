#!/usr/bin/env python3
"""Build a source-level HD audition of the Asuka City music bank.

The musical sequence and all VAB metadata remain unchanged. Only the decoded
PCM of each VAG sample is restored. The transform is zero-phase and
sample-count-preserving: it adds transient definition, restrained harmonic
bandwidth extension, and a small high shelf, then loudness-matches each sample.

Run:
  ~/.local/bin/uv run --with mido --with numpy --with scipy --with soundfile \
    --with imageio-ffmpeg python3 tools/build_hd_music.py
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage, signal


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

import build_music  # noqa: E402
import remaster_music  # noqa: E402
import vab_to_sf2  # noqa: E402


BANK = "bgm001"
OUT_DIR = ROOT / "web/assets/music-hd"
SF2 = ROOT / "third_party/hd_sf2/bgm001-hd.sf2"


def rms(audio: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(audio, dtype=np.float64))))


def db(value: float) -> float:
    return 20.0 * math.log10(max(value, 1e-12))


def band_energy(audio: np.ndarray, sample_rate: int, low_hz: float) -> float:
    spectrum = np.fft.rfft(audio.astype(np.float64))
    frequencies = np.fft.rfftfreq(len(audio), 1.0 / sample_rate)
    power = np.square(np.abs(spectrum))
    return float(power[frequencies >= low_hz].sum() / max(power.sum(), 1e-18))


def repair_loop_boundary(
    audio: np.ndarray, loop_start: int | None, loop_end: int | None
) -> np.ndarray:
    if loop_start is None or loop_end is None or loop_end <= loop_start:
        return audio
    loop_end = min(loop_end, len(audio))
    width = min(128, max(0, (loop_end - loop_start) // 8))
    if width < 4:
        return audio
    # Match the end value to the start over a short tail without moving either
    # loop marker or changing the loop's duration.
    delta = audio[loop_end - 1] - audio[loop_start]
    ramp = np.linspace(0.0, 1.0, width, dtype=np.float64)
    audio[loop_end - width : loop_end] -= delta * ramp
    return audio


def restore_sample(
    index: int,
    samples: list[int],
    loop_start: int | None,
    loop_end: int | None,
) -> list[int]:
    original = np.asarray(samples, dtype=np.float64) / 32768.0
    original_rms = rms(original)

    # Zero-phase subsonic/DC cleanup: no group delay, hence no note-on drift.
    highpass = signal.butter(
        2, 24.0, btype="highpass", fs=vab_to_sf2.SAMPLE_RATE, output="sos"
    )
    restored = signal.sosfiltfilt(highpass, original)

    # Transient definition. The fast-vs-slow envelope boosts attacks while
    # leaving sustained loop bodies mostly unchanged.
    fast = ndimage.gaussian_filter1d(
        np.abs(restored), sigma=vab_to_sf2.SAMPLE_RATE * 0.0015
    )
    slow = ndimage.gaussian_filter1d(
        np.abs(restored), sigma=vab_to_sf2.SAMPLE_RATE * 0.018
    )
    transient = np.clip((fast - slow) / (slow + 0.04), 0.0, 1.0)
    restored *= 1.0 + transient * 0.30

    # Conservative bandwidth extension: isolate only the new upper harmonics
    # from a nonlinear copy, then mix them quietly under the real sample.
    saturated = np.tanh(restored * 2.0) / math.tanh(2.0)
    harmonic = saturated - restored
    upper = signal.butter(
        2, 4200.0, btype="highpass", fs=vab_to_sf2.SAMPLE_RATE, output="sos"
    )
    harmonic = signal.sosfiltfilt(upper, harmonic)
    restored += harmonic * 0.22

    # Audible but bounded weight/air shelves: enough for an A/B test without
    # replacing the source timbre.
    for kind, frequency, gain in (
        ("low", 155.0, 0.9),
        ("high", 6000.0, 3.0),
    ):
        b, a = remaster_music.biquad(
            kind, vab_to_sf2.SAMPLE_RATE, frequency, gain
        )
        restored = signal.filtfilt(b, a, restored)
    restored = repair_loop_boundary(restored, loop_start, loop_end)

    # Match the original sample's energy so "better" is never just "louder."
    restored_rms = rms(restored)
    if restored_rms and original_rms:
        restored *= original_rms / restored_rms
    peak = float(np.max(np.abs(restored)))
    if peak > 0.98:
        restored *= 0.98 / peak

    report = {
        "index": index,
        "samples": len(samples),
        "loop_start": loop_start,
        "loop_end": loop_end,
        "original_rms_dbfs": round(db(original_rms), 3),
        "restored_rms_dbfs": round(db(rms(restored)), 3),
        "original_high_band_ratio": round(
            band_energy(original, vab_to_sf2.SAMPLE_RATE, 6000.0), 7
        ),
        "restored_high_band_ratio": round(
            band_energy(restored, vab_to_sf2.SAMPLE_RATE, 6000.0), 7
        ),
        "correlation": round(
            float(
                np.dot(original, restored)
                / max(
                    math.sqrt(
                        float(np.dot(original, original))
                        * float(np.dot(restored, restored))
                    ),
                    1e-18,
                )
            ),
            6,
        ),
    }
    SAMPLE_REPORTS.append(report)
    return np.rint(restored * 32768.0).astype(np.int16).tolist()


SAMPLE_REPORTS: list[dict] = []


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    SAMPLE_REPORTS.clear()
    if not vab_to_sf2.build_sf2(BANK, SF2, sample_transform=restore_sample):
        raise RuntimeError(f"could not load {BANK}")

    clean = remaster_music.clean_sequence(BANK)
    authentic, sample_rate = remaster_music.read_ogg(
        ROOT / f"web/assets/music/{BANK}.ogg"
    )
    rendered = remaster_music.synthesize_sequence(
        clean,
        SF2,
        len(authentic),
        sample_rate,
        reverb=True,
        chorus=True,
    )
    # Final loudness match only; no second timbre-changing master.
    rendered_rms = rms(rendered)
    authentic_rms = rms(authentic)
    if rendered_rms:
        rendered *= authentic_rms / rendered_rms
    peak = float(np.max(np.abs(rendered)))
    if peak > 10.0 ** (-1.0 / 20.0):
        rendered *= (10.0 ** (-1.0 / 20.0)) / peak

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    output = OUT_DIR / f"{BANK}.ogg"
    remaster_music.write_ogg(output, rendered, sample_rate)
    decoded, decoded_rate = remaster_music.read_ogg(output)
    if decoded_rate != sample_rate or len(decoded) != len(authentic):
        raise RuntimeError("HD render changed decoded duration")

    midi = build_music.DDW3_SOUND / BANK / "tracks/0/0.midi"
    manifest = {
        "profile": "source-level-hd",
        "authentic": False,
        "bank": BANK,
        "label": "Asuka City",
        "source": f"../music/{BANK}.ogg",
        "output": f"{BANK}.ogg",
        "sequence_sha256": sha256(midi),
        "sf2": str(SF2.relative_to(ROOT)),
        "sample_count": len(SAMPLE_REPORTS),
        "samples": SAMPLE_REPORTS,
        "before": vars(remaster_music.stats(authentic, sample_rate)),
        "after": vars(remaster_music.stats(rendered, sample_rate)),
        "comparison": remaster_music.comparison(authentic, rendered),
        "invariants": {
            "sequence_unchanged": True,
            "sample_counts_unchanged": True,
            "vab_metadata_unchanged": True,
            "decoded_frames_unchanged": len(decoded) == len(authentic),
        },
        "output_sha256": sha256(output),
        "warning": "Optional HD restoration; not original-game audio.",
    }
    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n"
    )
    print(
        f"{BANK}: restored {len(SAMPLE_REPORTS)} samples, "
        f"{len(rendered) / sample_rate:.1f}s, "
        f"correlation={manifest['comparison']['waveform_correlation']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
