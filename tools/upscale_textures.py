#!/usr/bin/env python3
"""Compatibility entry point for the former fight-texture-only upscaler.

Use ``tools/upscale_assets.py`` for the complete asset library.  Arguments are
forwarded, with this wrapper defaulting to the battle texture subtree.
"""
from __future__ import annotations

import sys

from upscale_assets import main


def legacy_args(argv: list[str]) -> list[str]:
    """Translate the two documented options from the original utility."""
    translated: list[str] = []
    model = None
    all_textures = False
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--model":
            if index + 1 >= len(argv):
                raise SystemExit("--model requires a model id")
            model = argv[index + 1]
            index += 2
            continue
        if arg.startswith("--model="):
            model = arg.split("=", 1)[1]
            index += 1
            continue
        if arg == "--all":
            all_textures = True
            index += 1
            continue
        if arg == "--iters":
            translated.append("--dilate")
        elif arg.startswith("--iters="):
            translated.append("--dilate=" + arg.split("=", 1)[1])
        else:
            translated.append(arg)
        index += 1

    if model and all_textures:
        raise SystemExit("--model and --all are mutually exclusive")
    if model:
        translated = ["--include", f"battle/textures/{model}.png", *translated]
    elif not any(
        arg == "--include" or arg.startswith("--include=") for arg in translated
    ):
        translated = ["--include", "battle/textures/**", *translated]
    return translated


if __name__ == "__main__":
    raise SystemExit(main(legacy_args(sys.argv[1:])))
