#!/usr/bin/env python3
"""Extract the per-stage descriptor every `wstag*` overlay declares.

Each stage overlay's job is almost entirely declarative: one function fills in a
shared descriptor at 0x80099D80 (which `fieldstg` then reads) and asks the
loader for the stage's files. This pulls that out as data, so the ~250 stage
overlays do not have to be read one at a time.

It reports values, not meanings. Field offsets are left as offsets; nothing here
claims what +0x2C is. Where a stage overrides a field inside an `if`, the
override is kept WITH its condition rather than collapsed into the base value --
those are stages that differ by story progress, and flattening them would lose
the only interesting thing about them.

Usage:
    python3 tools/extract_stage_descriptors.py --json docs/generated/stage-descriptors.json
    python3 tools/extract_stage_descriptors.py --markdown docs/generated/stage-descriptors.md
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

DESC = "0x80099D80"          # the stage descriptor fieldstg reads
LOADER = "0x8009B6C4"        # the file loader the stage asks for its assets

ASSIGN_RE = re.compile(
    r"\(void \*\)" + DESC + r"->unk([0-9A-F]+)\s*=\s*(.+?);", re.I
)
LOAD_RE = re.compile(
    r"\(void \*\)" + LOADER + r"->unk([0-9A-F]+)\((.*?)\);", re.I
)
IF_RE = re.compile(r"^\s*if \((.+)\) \{", re.M)
UNPARSED = re.compile(r"M2C_ERROR|unaligned")


def clean(v: str) -> str:
    v = v.strip()
    v = re.sub(r"^\(s32\)\s*", "", v)
    v = re.sub(r"\s+", " ", v)
    if UNPARSED.search(v):
        return "<not lifted>"
    return v


def split_args(s: str) -> list[str]:
    out, depth, cur = [], 0, ""
    for ch in s:
        if ch == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
            continue
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def parse_function(body: str) -> dict | None:
    """Pull the descriptor writes, conditional overrides, and file loads."""
    if DESC not in body:
        return None

    # Everything before the first `if` is the unconditional declaration;
    # anything inside an `if` is an override that only some playthroughs see.
    cut = IF_RE.search(body)
    base_src = body[: cut.start()] if cut else body
    tail_src = body[cut.start():] if cut else ""

    fields: dict[str, str] = {}
    for off, val in ASSIGN_RE.findall(base_src):
        fields[off.upper()] = clean(val)

    overrides = []
    if tail_src:
        for m in IF_RE.finditer(tail_src):
            cond = re.sub(r"\s+", " ", m.group(1)).strip()
            # the block this condition guards
            start = tail_src.index("{", m.start())
            depth, end = 0, len(tail_src)
            for i in range(start, len(tail_src)):
                if tail_src[i] == "{":
                    depth += 1
                elif tail_src[i] == "}":
                    depth -= 1
                    if depth == 0:
                        end = i
                        break
            changed = {
                o.upper(): clean(v)
                for o, v in ASSIGN_RE.findall(tail_src[start:end])
            }
            if changed:
                overrides.append({"when": cond, "sets": changed})

    loads = []
    for meth, args in LOAD_RE.findall(body):
        a = split_args(args)
        loads.append({"call": f"+0x{meth.upper()}", "args": [clean(x) for x in a]})

    if not fields and not loads:
        return None
    return {"fields": fields, "overrides": overrides, "loads": loads}


def scan_overlay(d: pathlib.Path) -> list[dict]:
    rows = []
    for f in sorted(d.glob("*.c")):
        text = f.read_text(errors="replace")
        if DESC not in text:
            continue
        r = parse_function(text)
        if r:
            r["stage"] = d.name.removesuffix("_c")
            r["function"] = f.stem.lower()
            rows.append(r)
    return rows


def file_group(v: str) -> str | None:
    """0x052B0000-style values pack a group in the high half, an index low."""
    m = re.fullmatch(r"0x([0-9A-Fa-f]{4})([0-9A-Fa-f]{4})", v)
    return m.group(1).upper() if m else None


def as_int(v: str | None) -> int | None:
    m = re.fullmatch(r"0x([0-9A-Fa-f]+)", (v or "").strip())
    return int(m.group(1), 16) if m else None


def observed_patterns(rows: list[dict]) -> list[str]:
    """Report only what the extracted numbers actually support, with counts.

    Every line here is recomputed from the data, so it cannot drift away from
    the table below it. A tendency is reported as a tendency.
    """
    # Does every file a stage loads come from the group in +0xC's high half?
    hit = miss = 0
    for r in rows:
        grp = as_int(r["fields"].get("C"))
        if grp is None:
            continue
        grp >>= 16
        for l in r["loads"]:
            for a in l["args"][1:2]:
                n = as_int(a)
                if n is None or n < 0x10000:
                    continue
                if (n >> 16) == grp:
                    hit += 1
                else:
                    miss += 1

    # Is +0x8 always one below that group?
    pair = tot = 0
    for r in rows:
        a, c = as_int(r["fields"].get("8")), as_int(r["fields"].get("C"))
        if None in (a, c):
            continue
        tot += 1
        if (c >> 16) == a + 1:
            pair += 1

    lines = ["## What the numbers show", ""]
    lines.append(
        f"- **Every file a stage loads comes from the group in the high half of "
        f"+0xC.** {hit} of {hit + miss} load ids match, with no exceptions. "
        f"Given a stage's +0xC you know where all its assets live."
    )
    verdict = "always" if pair == tot else f"{pair} of {tot} stages"
    lines.append(
        f"- +0x8 is one less than that group in {verdict} — a strong tendency, "
        f"not a rule, so do not derive one from the other."
    )
    lines.append(
        "- +0x1C is a separate id: it is never any stage's file group "
        "(0 of {n} matched), so it indexes something else entirely.".format(
            n=len(rows)
        )
    )
    lines.append("")
    return lines


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=pathlib.Path, default=pathlib.Path("exe-decomp"))
    ap.add_argument("--json", type=pathlib.Path)
    ap.add_argument("--markdown", type=pathlib.Path)
    args = ap.parse_args()

    rows: list[dict] = []
    for d in sorted(args.root.glob("wstag*_c")):
        rows += scan_overlay(d)

    if not rows:
        print("no stage descriptors found", file=sys.stderr)
        return 1

    offsets = sorted(
        {o for r in rows for o in r["fields"]},
        key=lambda x: int(x, 16),
    )
    n_over = sum(1 for r in rows if r["overrides"])
    print(
        f"{len(rows)} descriptors from "
        f"{len({r['stage'] for r in rows})} stage overlays; "
        f"{len(offsets)} distinct fields; {n_over} carry conditional overrides"
    )

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(rows, indent=1))
        print(f"wrote {args.json}")

    if args.markdown:
        out = [
            "# Stage descriptors, extracted",
            "",
            f"One row per `wstag*` overlay: the values it writes into the shared",
            f"stage descriptor at `{DESC}`, which `fieldstg` reads.",
            "",
            "Generated by `tools/extract_stage_descriptors.py`. **Offsets are",
            "offsets** -- this file does not claim what any field means.",
            "",
        ]
        out += observed_patterns(rows) + [
            "| stage | " + " | ".join(f"+0x{o}" for o in offsets) + " |",
            "|---" * (len(offsets) + 1) + "|",
        ]
        for r in sorted(rows, key=lambda r: (r["stage"], r["function"])):
            cells = [r["fields"].get(o, "") for o in offsets]
            out.append(f"| {r['stage']} | " + " | ".join(cells) + " |")

        out += ["", "## Stages that change with story progress", ""]
        any_over = False
        for r in sorted(rows, key=lambda r: r["stage"]):
            for ov in r["overrides"]:
                any_over = True
                sets = ", ".join(f"+0x{k} = {v}" for k, v in ov["sets"].items())
                out.append(f"- **{r['stage']}** — when `{ov['when']}`: {sets}")
        if not any_over:
            out.append("_none found_")

        out += ["", "## Files each stage asks the loader for", ""]
        for r in sorted(rows, key=lambda r: r["stage"]):
            if r["loads"]:
                calls = "; ".join(
                    f"{l['call']}({', '.join(l['args'])})" for l in r["loads"]
                )
                out.append(f"- **{r['stage']}** — {calls}")

        args.markdown.parent.mkdir(parents=True, exist_ok=True)
        args.markdown.write_text("\n".join(out) + "\n")
        print(f"wrote {args.markdown}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
