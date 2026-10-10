#!/usr/bin/env python3
"""Turn a pause-explorer run folder into a readable menu map.

Input is the folder `pause-explorer.lua` writes (copied by `game_driver.py
explore` into `.dw3-research/game-use/<run>/explore/`). Output:

  graph.json  every screen, every button edge, waits in frames, sounds, flags
  MAP.md      the same for a person: screens with their shortest button path,
              what each button does there and how long it takes, then the
              findings that need a look (coarse keys, screens that never
              settled, restores that did not match), then code coverage

Every number is an observation of one run from one save. Nothing here is a
ledger claim; the report says so at the top.

Usage:
    python3 tools/pause_explorer_report.py .dw3-research/game-use/<run>/explore
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
FPS = 50  # PAL

PAGES = {
    "top": "Pause list", "items": "ITEMS", "bag": "Item bag", "sort": "SORT",
    "map": "MAP", "techniques": "TECHNIQUES",
    "status": "STATUS", "card_folders": "CARD FOLDERS", "demo_setup": "Demo Setup",
    "digivolve": "See Digivolve", "equipment": "See Equipment",
}
# Field names per page, in PAUSE_SPEC order (tools/build_pause_explorer_spec.py).
FIELDS = {
    "top": ["step", "sub", "row", "rows", "variant", "map_allowed"],
    "host": ["step", "sub"],
    "items": ["life", "step", "sub", "party", "category", "ability", "member", "member_list", "item_kind"],
    "bag": ["life", "step", "tab", "count", "cell", "page"],
    "sort": ["life", "step", "party", "cursor_on", "prompt", "row", "first", "second"],
    "map": ["life", "step", "cursor_on", "over_zone", "zone"],
    "techniques": ["life", "step", "sub", "party", "list_on", "member", "target_on", "target", "technique"],
    "status": ["life", "step", "detail_step", "detail_back", "party", "detail_choice", "cursor_on", "member"],
    "card_folders": ["life", "step", "chosen", "party", "choice"],
    "demo_setup": ["life", "step"],
    "digivolve": ["life", "step", "form_row", "choice", "tech_row", "tech_count", "tech_on", "position", "stats_on"],
    "equipment": ["life", "step", "member", "slot", "row", "length", "top", "header_on"],
}
TOP_ROWS = ["ITEMS", "SORT", "MAP", "TECHNIQUES", "STATUS", "CARD FOLDERS"]


def lines(path: pathlib.Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(x) for x in path.read_text().splitlines() if x.strip()]


def parse_key(key: str) -> dict[str, str]:
    out = {}
    for part in key.split("|"):
        name, _, value = part.partition("=")
        out[name] = value
    return out


def describe(key: str) -> str:
    """A short player-side name for a screen key."""
    k = parse_key(key)
    pages = [p for p in PAGES if p in k]
    if not pages and "top" not in k:
        return "Field" if "scene" in k else "Unknown"
    deepest = pages[-1] if pages else "top"
    vals = dict(zip(FIELDS.get(deepest, []), k[deepest].split(",")))
    label = PAGES[deepest]
    if deepest == "top":
        row = int(vals.get("row", "0"), 16)
        name = TOP_ROWS[row] if row < len(TOP_ROWS) else f"row {row}"
        return f"Pause list, cursor on {name} (step {int(vals.get('step', '0'), 16)})"
    bits = [f"{n} {v[1:] if v.startswith('k') else int(v, 16)}" for n, v in vals.items() if n not in ("party", "life")]
    return f"{label} (" + ", ".join(bits) + ")"


def build(folder: pathlib.Path) -> dict:
    summary = json.loads((folder / "summary.json").read_text())
    nodes = lines(folder / "nodes.jsonl")
    edges = lines(folder / "edges.jsonl")
    keys = {k["id"]: k["key"] for k in lines(folder / "keys.jsonl")}
    coverage = json.loads((folder / "coverage.json").read_text()) if (folder / "coverage.json").exists() else []
    by_id = {n["id"]: n for n in nodes}
    screens = []
    for n in nodes:
        out = [e for e in edges if e["from"] == n["id"] and not e.get("alt")]
        screens.append(dict(id=n["id"], name=describe(n["key"]), key=n["key"], depth=n["depth"],
                            path=n["path"], shot=n.get("shot"), expanded=n.get("expanded"),
                            world_changed=n.get("world_changed"),
                            edges=[dict(button=e["button"], to=e.get("to"),
                                        to_name=describe(keys.get(e["to_key_id"], "")),
                                        same=e.get("to") == n["id"], settled=e["settled"],
                                        first_change=e.get("first_change"),
                                        settle_frame=e.get("settle_frame"),
                                        passed=[describe(keys.get(t[1], "")) for t in e.get("transit", [])],
                                        sounds=[s[1] for s in e.get("sounds", [])],
                                        new_steps=e.get("new_steps", []))
                                   for e in out]))
    flags = dict(
        coarse=[dict(node=e["from"], button=e["button"], alt=e["alt"],
                     primary=describe(keys.get(e.get("primary_to_key_id"), "")),
                     alternate=describe(keys.get(e["to_key_id"], "")))
                for e in edges if e.get("coarse")],
        unsettled=[dict(node=e["from"], button=e["button"], moving=e.get("moving"))
                   for e in edges if not e["settled"]],
        restore=[dict(node=e["from"], button=e["button"], diff=e.get("restore_diff"))
                 for e in edges if e.get("restore_ok") is False],
        # Every button from one screen lands on the same other screen: the screen
        # was probably a wait that settled too early, not a real stop.
        auto=[dict(node=sc["id"], name=sc["name"], to=sc["edges"][0]["to_name"])
              for sc in screens if len(sc["edges"]) > 1 and not sc["edges"][0]["same"]
              and len({e["to"] for e in sc["edges"]}) == 1],
    )
    cov = coverage
    return dict(note="Observed once, one save, one run. Not a ledger claim.",
                summary=summary, screens=screens, flags=flags, coverage=cov,
                node_count=len(by_id))


def frames(n) -> str:
    return "-" if n is None else f"{n} f ({n / FPS:.2f} s)"


def markdown(g: dict) -> str:
    s = g["summary"]
    out = ["# Pause menu map (robot run)", "",
           f"_{g['note']}_", "",
           f"- Stop reason: {s['reason']}",
           f"- Screens: {s['nodes']}; button edges: {s['edges']}; trials: {s['trials']}",
           f"- Unsettled edges: {s['unsettled']}; too-coarse checks failed: {s['coarse']} of {s['alt_checks']}",
           f"- Page steps reached: {s['steps_hit']} of {s['steps_total']} (step lists are read from the translations)",
           f"- Save data that moved on its own and was left out of the key: {s.get('volatile') or 'none'}",
           f"- Queue left unexplored: {s['queue_left']}", ""]
    out += ["## Screens", ""]
    for sc in g["screens"]:
        path = " → ".join(sc["path"]) or "(start)"
        out.append(f"### {sc['id']}. {sc['name']}")
        out.append(f"Reached by: {path}. Picture: `{sc['shot']}`.")
        if not sc["edges"]:
            out.append(("Not expanded (save data changed)." if sc.get("world_changed") else "Not expanded.")
                       if not sc["expanded"] else "No edges tried.")
            out.append("")
            continue
        out += ["", "| Button | Goes to | First change | Settled after | Sounds |", "|---|---|---|---|---|"]
        for e in sc["edges"]:
            target = "no change" if e["same"] else (f"{e['to']}. {e['to_name']}" if e["to"] else e["to_name"])
            if not e["settled"]:
                target += " **(never settled)**"
            out.append(f"| {e['button']} | {target} | {frames(e['first_change'])} | "
                       f"{frames(e['settle_frame'])} | {', '.join(e['sounds']) or '-'} |")
        out.append("")
    f = g["flags"]
    out += ["## Needs a look", ""]
    if not any(f.values()):
        out.append("Nothing flagged.")
    for c in f["coarse"]:
        out.append(f"- **Key too coarse** at screen {c['node']}, {c['button']}: first moment went to "
                   f"{c['primary']}, alternate {c['alt']} went to {c['alternate']}.")
    for u in f["unsettled"]:
        out.append(f"- **Never settled** at screen {u['node']}, {u['button']}; still moving: {u['moving']}.")
    for r in f["restore"]:
        out.append(f"- **Restore mismatch** at screen {r['node']} before {r['button']}: {r['diff']}.")
    for a in f["auto"]:
        out.append(f"- **Moves on by itself** at screen {a['node']} ({a['name']}): every button went to "
                   f"{a['to']}. Probably a wait that settled too early.")
    out += ["", "## Page steps", "",
            "A step that was never reached is unexercised by this save, not proven unused.", "",
            "| Page | Steps seen | Steps never reached |", "|---|---|---|"]
    for c in g["coverage"]:
        seen = ", ".join(str(v[0]) for v in c["seen"]) or "-"
        never = ", ".join(str(v) for v in c["never"]) or ("-" if c["cases"] else "(no step list)")
        out.append(f"| {PAGES.get(c['page'], c['page'])} | {seen} | {never} |")
    return "\n".join(out) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("folder", type=pathlib.Path)
    args = ap.parse_args()
    g = build(args.folder)
    (args.folder / "graph.json").write_text(json.dumps(g, indent=1) + "\n")
    (args.folder / "MAP.md").write_text(markdown(g))
    print(json.dumps(dict(screens=len(g["screens"]), flags={k: len(v) for k, v in g["flags"].items()},
                          out=str(args.folder / "MAP.md"))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
