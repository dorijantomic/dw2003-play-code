#!/usr/bin/env python3
"""How much of each screen's real composition the walker actually models.

`tools/extract_screen_draw_calls.py` reads every picture draw and text box out
of the original assembly, with the screen position the original uses. The walker
keeps its own decoded geometry in `web/assets/data/<screen>_ui.json`. This
compares the two sets of positions.

It answers one question per screen: **which positions the original draws at are
not anywhere in our data.** Those are things a player sees that we may not draw.

This is a coverage measure, not a proof of correctness. A position we hold under
a different name still counts as covered, and a position matching by coincidence
also counts -- so the "covered" number is an upper bound and the "missing"
number is a lower bound on the gap.

**A row of a list states one position, not eight.** Our data writes a repeated
row as a base plus a pitch plus a count, so a literal comparison called every
row after the first "missing" even where we draw it correctly. Positions are
therefore EXPANDED before the comparison: every x-bearing key in a node is
crossed with every y-bearing key, and a pitch/count pair walks the base down the
list. The strict literal count is printed beside it, because an expansion can
invent a position no screen draws.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
GEN = REPO / "docs" / "generated" / "screen-draw-calls.json"
DATA = REPO / "web" / "assets" / "data"

# walker json name -> overlay name in the generated inventory
ALIAS = {"status": "ststatus", "shop": "stitshop", "cardduel": "cardgame"}

# Overlays that draw a screen whose geometry another overlay's file already
# holds, because the walker builds it once and both screens use it. Edit
# Folder's "Change name" keyboard is the NAMEDT keyboard: its ctor
# F0x800868e8 places every widget at the same position stdgname does, and the
# walker draws both through web/nameentry.js off stdgname_ui.json. Without
# this the audit called 14 implemented positions missing.
# stplnmet is the overlay that OWNS the NAMEDT pack, so the pack-select and
# sign-up screens draw the same keyboard from the same places.
SHARED_WITH = {"stcrddek": ["stdgname"], "stplnmet": ["stdgname"]}


PITCH_KEYS = ("pitch", "row_pitch", "y_step", "dy")
COUNT_KEYS = ("rows", "n", "count", "visible", "lineCount", "frames")
COL_PITCH_KEYS = ("col_pitch", "x_step", "dx")

# A key names an axis through its TOKENS, not its spelling. `y_base`, `nameY0`,
# `counterX0` and `iconX` all name one; `maxCopiesPerFolder` does not, even
# though it contains an x. Until 2026-09-03 only the snake_case spellings were
# recognised, so every camelCase screen file reported positions it does hold as
# missing -- 18 of the folder editor's 28, for one.
_STEP_TOKENS = {"step", "pitch", "delta", "stride"}
_AXIS_TOKEN = re.compile(r"^([xy])\d*$")


def _tokens(key: str) -> list[str]:
    return [t.lower() for t in re.split(r"[_\s]+|(?=[A-Z])", key) if t]


def _axis_of(key: str) -> str | None:
    toks = _tokens(key)
    if set(toks) & _STEP_TOKENS:
        return None
    for t in toks:
        m = _AXIS_TOKEN.match(t)
        if m:
            return m.group(1)
    return None


def _axis(node, suffix):
    """Every value in this node that names a coordinate on one axis.

    A screen states a repeated position as `y_base`, a two-position one as
    `y_top`/`y_bottom`, a column as `label_x` or `cols`. All of them are that
    axis. A list under such a key is several positions on it.
    """
    out = []
    for k, v in node.items():
        if k in PITCH_KEYS or k in COL_PITCH_KEYS:
            continue
        axis = _axis_of(k)
        # `cols` is a COUNT when it is a number and a list of column positions
        # when it is a list; the same word carries both in this corpus.
        if axis is None and suffix == "x" and k == "cols" and isinstance(v, list):
            axis = "x"
        if axis != suffix:
            continue
        if isinstance(v, int):
            out.append(v)
        elif isinstance(v, list) and v and all(isinstance(i, int) for i in v):
            out.extend(v)
    return out


def _first(node, keys):
    """The first of `keys` this node states, by token match, as a number."""
    wanted = [_tokens(k) for k in keys]
    for k, v in node.items():
        if not isinstance(v, int) or v <= 0:
            continue
        if _tokens(k) in wanted:
            return v
    for k in keys:
        v = node.get(k)
        if isinstance(v, int) and v > 0:
            return v
    return None


def walker_points(path: Path, expand: bool = True) -> set[tuple[int, int]]:
    """Every screen position our data states, literal and parameterised."""
    out: set[tuple[int, int]] = set()

    def walk(node):
        if isinstance(node, dict):
            if expand:
                xs = _axis(node, "x")
                ys = _axis(node, "y")
                pitch = _first(node, PITCH_KEYS)
                if pitch:
                    count = _first(node, COUNT_KEYS) or 1
                    ys = [y + pitch * i for y in ys for i in range(count)]
                colp = _first(node, COL_PITCH_KEYS)
                cols = node.get("cols")
                if colp and isinstance(cols, int) and cols > 0:
                    xs = [x + colp * i for x in xs for i in range(cols)]
            else:
                xs = [v for k, v in node.items() if k == "x" and isinstance(v, int)]
                ys = [v for k, v in node.items() if k == "y" and isinstance(v, int)]
            for x in xs:
                for y in ys:
                    out.add((x, y))
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            if len(node) == 2 and all(isinstance(v, int) for v in node):
                out.add((node[0], node[1]))
            for v in node:
                walk(v)

    walk(json.loads(path.read_text()))
    return out


def original_points(overlay: dict) -> dict[tuple[int, int], list[str]]:
    out: dict[tuple[int, int], list[str]] = {}
    for routine in overlay:
        for call in routine["calls"]:
            if call["op"] == "draw":
                _, _, pid, x, y = call["args"]
                label = f"picture {pid}"
            elif call["op"] == "text_element":
                _, kind, x, y = call["args"]
                label = f"text kind {kind}"
            else:
                continue
            try:
                pt = (int(x), int(y))
            except ValueError:
                continue
            out.setdefault(pt, []).append(f"{routine['routine']} {label}")
    return out


HEADER = """---
reach: choosing what to fix next on any screen; asking how much of a screen the walker actually models; before claiming a screen is pixel-accurate
status: generated
---

# Where the walker does not draw what the original draws

Generated by `tools/audit_screen_coverage.py`. Do not hand-edit; regenerate.

Every position below is one the original assembly draws a picture or a text box
at, taken from `screen-draw-calls.md` (authority 2). "Covered" means our own
decoded geometry in `web/assets/data/<screen>_ui.json` holds that same position
somewhere. "Missing" means it does not.

**Read the numbers carefully.** Covered is an UPPER bound: a position we hold
under an unrelated name, or one that matches by coincidence, still counts.
Missing is a LOWER bound on the gap. Only positions the original states as
literal numbers are compared; a position it computes at run time is not here.

**A row of a list states one position, not eight.** Our data writes a repeated
row as a base plus a pitch plus a count, so the comparison expands ours before
matching: every x-bearing key in a node is crossed with every y-bearing key,
and a pitch/count pair walks the base down the list. The `literal` column is
what a strict key-for-key comparison would have said, and the gap between it
and `covered` is parameterised layout, not missing work.

**A key names an axis through its tokens**, so `nameX` and `counterX0` count as
positions and `maxCopiesPerFolder` does not. Until 2026-09-03 only the
snake_case spellings were recognised and every camelCase file was undercounted.

**A screen whose geometry another overlay's file holds names it** in
`SHARED_WITH`. Edit Folder's rename keyboard is the naming screen's keyboard,
so its 14 positions are not this overlay's gap.

```
"""

FOOTER = "```\n"


def main() -> int:
    print(HEADER, end="")
    gen = json.loads(GEN.read_text())
    rows = []
    for path in sorted(DATA.glob("*_ui.json")):
        name = path.stem[:-3]
        overlay = ALIAS.get(name, name)
        if overlay not in gen:
            continue
        extra = [DATA / f"{n}_ui.json" for n in SHARED_WITH.get(overlay, ())]
        ours = walker_points(path)
        strict = walker_points(path, expand=False)
        for e in extra:
            if e.exists():
                ours |= walker_points(e)
                strict |= walker_points(e, expand=False)
        theirs = original_points(gen[overlay])
        missing = sorted(p for p in theirs if p not in ours)
        literal = sum(1 for p in theirs if p in strict)
        rows.append((name, overlay, len(theirs), len(theirs) - len(missing),
                     literal, missing, theirs))

    print(f"{'screen':10} {'overlay':10} {'positions':>9} {'covered':>8} "
          f"{'missing':>8} {'literal':>8}")
    print("-" * 59)
    tt = tc = tl = 0
    for name, overlay, total, covered, literal, missing, _ in rows:
        tt += total
        tc += covered
        tl += literal
        print(f"{name:10} {overlay:10} {total:9} {covered:8} {len(missing):8} "
              f"{literal:8}")
    print("-" * 59)
    print(f"{'ALL':21} {tt:9} {tc:8} {tt - tc:8} {tl:8}")

    print(FOOTER, end="")

    for name, overlay, _, _, _, missing, theirs in rows:
        if not missing:
            continue
        print(f"\n=== {name}: {len(missing)} positions the original draws at that "
              f"our data does not hold")
        print("```")
        for pt in missing:
            print(f"    ({pt[0]:>3},{pt[1]:>3})  {'; '.join(theirs[pt][:3])}")
        print("```")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
