#!/usr/bin/env python3
"""Install the tracked recovered-semantics table where the probe reads it.

`data/recovered-semantics.json` is tracked because its generator chain needs the
616 MB `.dw3-research/index.sqlite3` research database, which is not part of this
export. The native screen probe (and the native-bridge / native-screen tests)
read it at `recovered/ddw3/semantics.json`, so the build copies it there.
"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
src = ROOT / "data/recovered-semantics.json"
dst = ROOT / "recovered/ddw3/semantics.json"
dst.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(src, dst)
print(f"installed {dst.relative_to(ROOT)} ({dst.stat().st_size} B) from {src.relative_to(ROOT)}")
