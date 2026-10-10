#!/usr/bin/env python3
"""Rebuild every DW2003 fight model (geometry + texture) for the 3D battle renderer.

Single entry point for regenerating the battle3d.js assets from the raw PS1 packs
at ~/ddw3/pack/dw2003/fight/model. It chains the two pipeline tools:

  - geometry: web/assets/battle/models/<id>/anim.json   (export_fight_anim.export_model)
  - texture:  web/assets/battle/textures/<id>.png        (bake_clut_texture.bake_texture)
  - index:    web/assets/battle/models/index.json        (list of built models, for the viewer)

The geometry parser reads verts at Section-A +6 (the 2-byte phase-shift fix), the full
face region with PS1 Z-ordered quad splitting, and b1/b3 UV bases. The texture baker
resolves each texel to its covering face's per-primitive CLUT from the disc texture-page
band (4bpp / 256x256, no RAM dependency) so it generalizes across all 248 models.

`DW3_MODEL_DIR` (os.pathsep-separated) names extra pack roots searched when a
model folder is not in the read-only tree, so a pack carved out of the disc by
tools/extract_fight_model_pack.py builds through this same pipeline:

  python3 tools/extract_fight_model_pack.py --out .bunny-scratch/pack 1958
  DW3_MODEL_DIR=.bunny-scratch/pack python3 tools/build_fight_models.py m468agnm

Usage (from the repo root):
  ~/.local/bin/uv run --with pillow python tools/build_fight_models.py --all
  ~/.local/bin/uv run --with pillow python tools/build_fight_models.py m003agum m373rena
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from export_fight_anim import export_model, model_folder, model_folder_names, OUT_BASE  # noqa: E402
from bake_clut_texture import bake_texture                       # noqa: E402
from decode_timeline import decode_timeline                       # noqa: E402
from decode_action_scripts import decode_action_scripts, find_action_bin  # noqa: E402

WALKER = Path(__file__).parent.parent
TEX_DIR = WALKER / "web/assets/battle/textures"
PLACEMENT = WALKER / "web/assets/battle/model_placement.json"


def timeline_members() -> dict[str, int]:
    """Model number -> the pack member holding its timeline directory.

    FIGHTSTG_F0x80083a54 resolves the animation directory from the model actor's
    +0x74, which F0x80084560 fills from the smdldata record's +0x04 packed reference
    (claim smdldata-record-head-is-three-packed-model-pack-references-2026-08-18).
    That member is 0 for 246 of the 248 records, which is why hardcoding `0.bin`
    worked at all — but Gururumon reads member 50 and Baihumon member 2, and reading
    member 0 for them decoded 4 and 6 timeline tables instead of their real ones.
    """
    if not PLACEMENT.exists():
        return {}
    models = json.loads(PLACEMENT.read_text())["models"]
    return {key: row["members"][1] for key, row in models.items()}


def build(folder_name: str, timelines: dict[str, int] | None = None) -> bool:
    """Export geometry + bake texture for one model. Returns True on full success."""
    if not export_model(folder_name):
        print(f"  {folder_name}: SKIP (geometry export failed)")
        return False
    anim_path = OUT_BASE / folder_name / "anim.json"
    anim = json.loads(anim_path.read_text())
    pack = model_folder(folder_name)
    member = (timelines or {}).get(str(int(folder_name[1:4])), 0)
    tl_bin = pack / f"{member}.bin"
    if tl_bin.exists():
        anim["timeline"] = decode_timeline(tl_bin.read_bytes())
    action_bin = find_action_bin(str(pack))
    if action_bin is not None:
        anim["actions"] = decode_action_scripts(action_bin)
    anim_path.write_text(json.dumps(anim))
    TEX_DIR.mkdir(parents=True, exist_ok=True)
    out_png = TEX_DIR / f"{folder_name}.png"
    try:
        npals, ntex, conflicts = bake_texture(str(pack), str(out_png), 1)
        print(f"    texture: {npals} palettes, {ntex} texels, {conflicts} conflicts")
    except Exception as e:  # texture failure shouldn't drop a model from the build
        print(f"    texture FAILED: {e}")
        return False
    return True


def main():
    args = sys.argv[1:]
    if not args or args[0] == "--help":
        print(__doc__)
        return
    if args[0] == "--all":
        folders = model_folder_names()
    else:
        folders = args

    timelines = timeline_members()
    built, tex_failed = [], []
    for name in folders:
        if build(name, timelines):
            built.append(name)
        elif (OUT_BASE / name / "anim.json").exists():
            # geometry succeeded but texture failed — still a usable model
            built.append(name)
            tex_failed.append(name)

    (OUT_BASE / "index.json").write_text(json.dumps(index_list(), indent=2) + "\n")
    print(f"\nBuilt {len(built)}/{len(folders)} models; wrote index.json")
    if tex_failed:
        print(f"texture bake failed for {len(tex_failed)}: {', '.join(tex_failed)}")


def index_list() -> list[str]:
    """The viewer's model list: every pack folder with a built anim.json, sorted,
    then the hand-authored packs from custom-manifest.json."""
    packs = sorted(n for n in model_folder_names() if (OUT_BASE / n / "anim.json").exists())
    manifest = OUT_BASE / "custom-manifest.json"
    if manifest.exists():
        custom = json.loads(manifest.read_text())
    else:  # fresh build: custom_fight_models has not run yet; same list it will write
        registry = Path(__file__).resolve().parent.parent / "data/custom/registry.json"
        custom = sorted(json.loads(registry.read_text()).values()) if registry.exists() else []
    return packs + [c for c in custom if c not in packs]


if __name__ == "__main__":
    main()
