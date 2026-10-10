#!/usr/bin/env python3
"""Regenerate ddw3's asm/dw2003/{pro,exe} for a byod tree from the disc.

Per file:
  1. disassemble the disc raw exe (gen_asm.render)
  2. apply the ddw3 symbol replacement (" 0xADDR" -> "F0xADDR"/"D0xADDR",
     from the addr->name map derived from the ddw3 tree)
  3. apply the per-file .section line(s) (decompilation metadata)
  4. diff vs the committed file; report byte-identical / residual hunks

Usage: asm_final.py --staging <_disc> --objdump-bin <od> --ddw3 <~/ddw3> \
                    --out <tree> --report <json>
Non-derivable files (hand-authored set + fns.s + special files) are copied
from --ddw3; the report lists them.
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from byod_asm_gen import render  # noqa: E402

# hand-authored / curated .s files (not disc-derivable): copied from ddw3
HAND = [
    "pro/fightstg/check_move_cond.s", "pro/stfgtrep/f0.s",
    "pro/stgtrain/f0.s", "pro/stgtrain/f1.s", "pro/stgtrain/f9.s",
    "pro/stgtrain/f10.s", "pro/stgtrain/f11.s", "pro/sdigiedt.s",
    "exe/f0.s", "exe/f1.s", "exe/f2.s", "exe/f3.s", "exe/f4.s", "exe/f5.s",
    "exe/f6.s", "exe/f7.s", "exe/f8.s", "exe/f9.s", "exe/f10.s", "exe/f11.s",
    "exe/f12.s", "exe/f13.s", "exe/f14.s", "exe/f15.s", "exe/f16.s",
    "exe/fns.s", "exe/loading.s", "exe/start.s", "macros.s",
]
# files whose committed form carries structural hand edits (code/data range
# fixes, section splits) beyond the mechanical pass: copied too
STRUCT = ["pro/smdldata.s", "pro/shocktst.s", "pro/stdwtitl.s", "pro/wfightts.s",
          "pro/fightstg.s", "pro/stfgtrep.s", "pro/stgtrain.s"]


def load_symmap(ddw3: Path) -> dict:
    names: dict[str, str] = {}
    for p in (ddw3 / "asm").rglob("*.s"):
        for m in re.finditer(r"[DF]0x([0-9a-f]{8})", p.read_text(errors="replace")):
            names.setdefault(m.group(1), m.group(0))
    return names


def load_sections(ddw3: Path) -> dict:
    out = {}
    for p in (ddw3 / "asm" / "dw2003" / "pro").glob("*.s"):
        lines = [l for l in p.read_text().splitlines() if l.startswith(".section ")]
        if lines:
            out[p.stem] = lines
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--staging", required=True)
    ap.add_argument("--objdump-bin", required=True)
    ap.add_argument("--ddw3", required=True)
    ap.add_argument("--out", required=True, help="tree dir")
    ap.add_argument("--report", required=True)
    a = ap.parse_args()

    staging = Path(a.staging).expanduser().resolve()
    ddw3 = Path(a.ddw3).expanduser().resolve()
    out = Path(a.out).expanduser().resolve() / "asm"
    pro_out = out / "dw2003" / "pro"
    pro_out.mkdir(parents=True, exist_ok=True)

    symmap = load_symmap(ddw3)
    sections = load_sections(ddw3)
    pro_src = {p.stem.lower(): p for p in (staging / "AAA" / "PRO").glob("*.PRO")}

    report = {"regenerated_identical": [], "regenerated_residual": {},
              "copied": []}
    for stem in sorted(pro_src):
        rel = f"pro/{stem}.s"
        if rel in HAND or rel in STRUCT:
            continue
        src = pro_src[stem]
        text = render(a.objdump_bin, str(src), stem.upper(),
                      section=f"section_{stem.upper()}")
        for addr, name in symmap.items():
            text = text.replace(f" 0x{addr}", f" {name}")
        secs = sections.get(stem)
        if secs:
            text = re.sub(r'^\.section "[^"]*"$', secs[0], text, count=1, flags=re.M)
        committed = (ddw3 / "asm" / "dw2003" / rel).read_text()
        if text == committed:
            report["regenerated_identical"].append(rel)
        else:
            d = list(difflib.unified_diff(committed.splitlines(),
                                          text.splitlines(), lineterm="", n=0))
            hunks = [x for x in d if x.startswith("@@")]
            report["regenerated_residual"][rel] = len(hunks)
        (pro_out / f"{stem}.s").write_text(text)

    # copy every hand-authored / curated file (and residual files) verbatim
    for rel in HAND + STRUCT:
        src = ddw3 / "asm" / (rel if rel == "macros.s" else "dw2003/" + rel)
        dst = (out / "macros.s" if rel == "macros.s" else out / "dw2003" / rel)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        if rel not in report["copied"]:
            report["copied"].append(rel)
    for rel in sorted(report["regenerated_residual"]):
        stem = rel.split("/")[1][:-2]
        shutil.copy2(ddw3 / "asm" / "dw2003" / rel, pro_out / f"{stem}.s")
        report.setdefault("residual_copied", []).append(rel)

    Path(a.report).write_text(json.dumps(report, indent=1))
    print(f"identical: {len(report['regenerated_identical'])}")
    print(f"residual (copied over): {len(report['regenerated_residual'])}")
    print(f"copied: {len(report['copied'])}")


if __name__ == "__main__":
    main()
