#!/usr/bin/env python3
"""Build the movies the walker ships from the raw Mode 2 disc image.

The walker ships every movie any launch code it implements can ask for: the two
opening movies (the title's attract loop) and MOVIED08_STR (the ordinal-43
field battle handoff, F0x8008B798 -> selector 0xE0A -> movie row 9). The list
below is the shipped set; the disc indices are the movie table's own first
words (pro/stdwtitl.s .L0x00004fe8, twelve 12-byte rows, and the generated copy
engine/dw3/movie-destinations.ts).

The extracted 2048-byte STR files omit part of each XA sound sector. Reading
the original 2352-byte sectors preserves the complete audio stream. The movie
table and disc indices are documented in docs/research/overlays/stdwtitl.md.

Built from the public ddw3 tree, the disc image is ddw3's own rebuild
(tools/build_ddw3_disc.py), and ddw3 only has those 2048-byte STR files: every
XA audio sector arrives as a plain data sector carrying 2048 of its 2304 audio
bytes (16 of 18 sound groups). That audio cannot be made whole from public
data, and stitching it with gaps would stutter, so for such a disc the movies
are encoded video-only and the manifest says why ("audio": "unavailable").
The video stream is complete either way.
"""

import os
import argparse
import hashlib
import json
import struct
import subprocess
import tempfile
from pathlib import Path

import imageio_ffmpeg

from build_native_screens import LBA_LEN_SECTORS, LBA_OFFSETS, load_exe

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DISC = Path(os.environ.get("DW3_DISC") or Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "build/iso/dw2003.bin")
SECTOR_BYTES = 2352
STR_VIDEO_MAGIC = b"\x60\x01\x01\x80"  # STR v2/v3 video chunk header
SOURCE_BYTES = 2048
# (name, disc file index, expected {sectors, video, audio, zero}). The expected
# mix is the measured sector census of each stream (the first pass's own record;
# it is re-checked on every run so a wrong LBA or a bad read cannot pass).
MOVIES = (
    ("movieop2", 0x94C, {"sectors": 18088, "video": 15680, "audio": 2261, "zero": 147}),
    ("movieopn", 0x7F4, {"sectors": 18088, "video": 15680, "audio": 2261, "zero": 147}),
    # MOVIED08_STR: 434 frames at 15 fps in the row; the stream carries 450.
    ("movied08", 0x7F0, {"sectors": 4512, "video": 3938, "audio": 564, "zero": 10}),
)
# The two openings share one video track (different audio), which is why their
# videoSha256 matches; that identity check is scoped to them, not to every movie.
OPENING_MOVIES = ("movieop2", "movieopn")


def extract_stream(disc: Path, exe: bytes, base: int, index: int, output: Path, expected: dict):
    lba = struct.unpack_from("<I", exe, LBA_OFFSETS + index * 4 - base)[0]
    sectors = struct.unpack_from("<H", exe, LBA_LEN_SECTORS + index * 2 - base)[0]
    if sectors != expected["sectors"]:
        raise ValueError(
            f"movie index {index}: expected {expected['sectors']} sectors, got {sectors}")
    counts = {"video": 0, "audio": 0, "zero": 0}
    truncated_audio = 0
    stream_digest = hashlib.sha256()
    video_digest = hashlib.sha256()
    with disc.open("rb") as source, output.open("wb") as target:
        source.seek(lba * SECTOR_BYTES)
        for sector_index in range(sectors):
            sector = source.read(SECTOR_BYTES)
            if len(sector) != SECTOR_BYTES or sector[:12] != b"\0" + b"\xff" * 10 + b"\0":
                raise ValueError(f"movie index {index}: invalid raw sector {sector_index}")
            data = sector[24:24 + SOURCE_BYTES]
            if not any(data):
                counts["zero"] += 1
            elif sector[18] & 0x04:
                counts["audio"] += 1
            elif data[:4] == STR_VIDEO_MAGIC:
                counts["video"] += 1
                video_digest.update(data)
            elif sector[18] & 0x08:
                # A data-mode sector that is not a video chunk: an XA audio
                # sector flattened to 2048 bytes (ddw3's STR files). Leave it out
                # of the stream handed to ffmpeg; see the module docstring.
                counts["audio"] += 1
                truncated_audio += 1
                stream_digest.update(sector)
                continue
            else:
                raise ValueError(f"movie index {index}: unknown sector {sector_index}")
            target.write(sector)
            stream_digest.update(sector)
    if counts != {"video": expected["video"], "audio": expected["audio"], "zero": expected["zero"]}:
        raise ValueError(f"movie index {index}: unexpected sector mix {counts}")
    if truncated_audio and truncated_audio != counts["audio"]:
        raise ValueError(f"movie index {index}: mixed XA and flattened audio sectors")
    return {"index": index, "lba": lba, "sectors": sectors, "counts": counts,
            "rawSha256": stream_digest.hexdigest(), "videoSha256": video_digest.hexdigest(),
            "audio": "unavailable" if truncated_audio else "xa"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--disc", type=Path, default=DEFAULT_DISC)
    parser.add_argument("--out", type=Path, default=ROOT / "web/assets/movie")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    with args.disc.open("rb") as source:
        base, exe = load_exe(source)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    manifest = {"generatedBy": "tools/extract_opening_movies.py", "source": "raw Mode 2 disc sectors",
                "movies": {}}
    with tempfile.TemporaryDirectory(prefix="dw3-movies-") as scratch:
        for name, index, expected in MOVIES:
            raw = Path(scratch) / f"{name}.str"
            record = extract_stream(args.disc, exe, base, index, raw, expected)
            output = args.out / f"{name}.mp4"
            audio = (["-map", "0:a:0", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-shortest"]
                     if record["audio"] == "xa" else ["-an"])
            subprocess.run([ffmpeg, "-hide_banner", "-y", "-loglevel", "error",
                            "-f", "psxstr", "-i", str(raw), "-map", "0:v:0",
                            "-c:v", "libx264", "-preset", "medium", "-crf", "20",
                            "-pix_fmt", "yuv420p", *audio,
                            "-movflags", "+faststart", str(output)], check=True)
            record["file"] = output.name
            record["size"] = output.stat().st_size
            record["sha256"] = hashlib.sha256(output.read_bytes()).hexdigest()
            manifest["movies"][name] = record
            print(name, output, record["size"])
    videos = {manifest["movies"][name]["videoSha256"] for name in OPENING_MOVIES}
    if len(videos) != 1:
        raise ValueError("the two opening movies unexpectedly have different video data")
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
