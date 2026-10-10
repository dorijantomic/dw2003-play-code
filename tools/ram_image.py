#!/usr/bin/env python3
"""A static 2 MiB PS1 RAM image built from the disc: the resident EXE at its
load address plus, optionally, one overlay at its load base.

Several extractors were first written against RAM dumps taken from a running
game, but the ranges they read are static data (EXE .data, an overlay's
tables), identical in every dump. This rebuilds exactly those bytes from the
disc image ddw3's build lays out, so the extractors run without a dump.
"""
from __future__ import annotations

import os
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_native_screens import (DEFAULT_DISC, LBA_LEN_SECTORS, LBA_OFFSETS,  # noqa: E402
                                  SCREEN_BASE, load_exe, read_overlay)

RAM_SIZE = 0x200000


def ram_image(disc: Path | None = None, overlay_index: int | None = None,
              overlay_base: int = SCREEN_BASE) -> bytes:
    disc = Path(disc or os.environ.get("DW3_DISC") or DEFAULT_DISC)
    ram = bytearray(RAM_SIZE)
    with open(disc, "rb") as fh:
        base, exe = load_exe(fh)
        ram[base & 0x1FFFFF:(base & 0x1FFFFF) + len(exe)] = exe
        if overlay_index is not None:
            img = read_overlay(fh, exe, base, overlay_index)
            ram[overlay_base & 0x1FFFFF:(overlay_base & 0x1FFFFF) + len(img)] = img
    return bytes(ram)
