"""Decode the bg01 background format used by the two field stages that have no
map/dw2003/z_stage tile-stitch pack (s415 "East Sector -- Deeper Crevice", the
gondola's mid-ride Bulbmon vignette, and s815 "Spy Satellite -- Gunslinger 2F").

Both stages' {id}bg01/0.bin is a standard PS1 TIM, 8bpp indexed with an embedded
256-color CLUT, 128x256px (verified by reading the raw TIM header: magic 0x10,
flags 0x9 -> bpp_mode=1 (8bpp), has_clut=1). Files 1.bin-4.bin in the same folder
are 16bpp direct-color animation-overlay frames at the same VRAM position -- not
decoded here; a static single-frame background is enough to make these stages
enterable (see docs/superpowers/specs/2026-07-01-gondola-s415-bg-stage-design.md).

Run:
  python3 tools/decode_bg_stage.py s415 s815      # writes web/assets/maps/{id}.png
  python3 tools/decode_bg_stage.py --all
"""

import os
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from decode_title_art import parse_tim  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
DDW3_STAGE = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "pack/dw2003/field/stage"
ZSTAGE_DIR = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "map/dw2003/z_stage"
OUT = REPO / "web/assets/maps"


def bg_only_stage_ids() -> list:
    """Stage ids with a bg01 background dir but no z_stage tile-stitch pack."""
    ids = []
    for toml in sorted(DDW3_STAGE.glob("s*bg01.toml")):
        sid = toml.stem[:-4]  # "s415bg01" -> "s415"
        if not (ZSTAGE_DIR / f"{sid}pack.toml").exists():
            ids.append(sid)
    return ids


def decode_bg01(stage_id: str):
    """Decode {stage_id}bg01/0.bin (8bpp CLUT TIM) to an RGBA PIL Image."""
    # Check for override first
    override_path = REPO / "web/assets/bg_override" / f"{stage_id}.png"
    if override_path.exists():
        return Image.open(override_path).convert("RGBA")

    path = DDW3_STAGE / f"{stage_id}bg01" / "0.bin"
    if not path.exists():
        raise FileNotFoundError(
            f"{path}\nRun: cd ~/ddw3 && git lfs pull "
            f"--include='pack/dw2003/field/stage/{stage_id}bg01/**'"
        )
    return parse_tim(path.read_bytes())


def main():
    ids = sys.argv[1:] if sys.argv[1:] and sys.argv[1] != "--all" else bg_only_stage_ids()
    OUT.mkdir(parents=True, exist_ok=True)
    for sid in ids:
        img = decode_bg01(sid)
        out_path = OUT / f"{sid}.png"
        img.save(out_path)
        print(f"{sid}: wrote {out_path} ({img.width}x{img.height})")


if __name__ == "__main__":
    main()
