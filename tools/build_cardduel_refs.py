#!/usr/bin/env python3
"""Build the card-duel original-game reference strip from rig screenshots.

The 2026-08-05 card-duel rig runs (`tools/windows-rig/trace-cardgame-full-state5.lua`)
wrote a 320x240 16bpp `.raw` framebuffer every third frame next to the numeric
trace, so every screen of a real duel — challenge prompt, folder chooser, Start
Phase, the Calumon coin draw, Draw Phase, the dealt board — exists as an exact
capture keyed to a trace frame number. This converts the curated picks into
`web/assets/ref/cardduel/` for the UI lab's comparison strip.

Frames come from run 1 (`cardgame_s5_f####.raw`, trace
`cardgame_s5_run1_modes4-6.txt`). The frame numbers below are the trace frames,
so any pick can be read back against that timeline.

Usage:
  .venv/bin/python3 tools/build_cardduel_refs.py [--shots DIR] [--out DIR]
"""

import argparse
import json
from pathlib import Path

from PIL import Image

WIDTH, HEIGHT = 320, 240

# (output name, rig frame, caption shown in the lab)
FRAMES = [
    ("challenge", 510, "Card Battle Challenge — opponent LV + folder name"),
    ("folder-choose", 612, "Choose a folder — cursor on Folder 1"),
    ("folder-picked", 639, "Choose a folder — selected row flashes"),
    ("start-phase", 693, "Start Phase — “Draw Calumon to go first.”"),
    ("coin-choose", 780, "Start Phase — two face-down cards, cursor on the left"),
    ("coin-reveal", 840, "Start Phase — the chosen card flips face up"),
    ("first-player", 870, "“You go first.” — both cards face up"),
    ("draw-phase", 936, "Draw Phase — “6 cards will be drawn.”"),
    ("board-dealt", 1176, "Board after the deal — both hands, HUD bars, trash piles"),
    ("load-phase", 1257, "Load Phase — “Select and use a Program Card.”"),
]


def load_raw(path: Path) -> Image.Image:
    """Decode a PCSX-Redux 16bpp (BGR555, little-endian halfwords) framebuffer."""
    data = path.read_bytes()
    if len(data) != WIDTH * HEIGHT * 2:
        raise SystemExit(f"{path}: expected {WIDTH * HEIGHT * 2} bytes, got {len(data)}")
    im = Image.new("RGB", (WIDTH, HEIGHT))
    px = im.load()
    for i in range(WIDTH * HEIGHT):
        v = data[i * 2] | (data[i * 2 + 1] << 8)
        px[i % WIDTH, i // WIDTH] = (
            (v & 31) << 3,
            ((v >> 5) & 31) << 3,
            ((v >> 10) & 31) << 3,
        )
    return im


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", default="/mnt/c/dw3-rig/shots")
    ap.add_argument("--prefix", default="cardgame_s5_f")
    ap.add_argument("--out", default="web/assets/ref/cardduel")
    a = ap.parse_args()

    shots, out = Path(a.shots), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    index = []
    for name, frame, caption in FRAMES:
        src = shots / f"{a.prefix}{frame:04d}.raw"
        if not src.exists():
            print(f"! missing {src} — skipped")
            continue
        load_raw(src).save(out / f"{name}.png")
        index.append({"name": name, "frame": frame, "caption": caption})
        print(f"{name}.png  <- frame {frame}")

    (out / "index.json").write_text(
        json.dumps(
            {
                "source": "rig run 1, trace cardgame_s5_run1_modes4-6.txt (2026-08-05)",
                "capture": "PCSX.GPU.takeScreenShot every 3rd frame, 320x240 16bpp",
                "frames": index,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"wrote {len(index)} frames + index.json to {out}")


if __name__ == "__main__":
    main()
