#!/usr/bin/env python3
"""Generate compact per-stage interaction summaries from committed assets.

Examples:
  python3 tools/report_stage_interactions.py s505
  python3 tools/report_stage_interactions.py --all
  python3 tools/report_stage_interactions.py --all --write docs/generated/stage-interactions.md
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCENES = ROOT / "web/assets/scenes"


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return default


def stage_sort_key(stage_id: str) -> int:
    return int(stage_id.removeprefix("s"))


def norm_stage(raw: str) -> str:
    raw = str(raw)
    return raw if raw.startswith("s") else f"s{raw}"


def flag_list(flags) -> str:
    if not flags:
        return "-"
    parts = []
    for item in flags:
        if isinstance(item, dict):
            fid = item.get("id")
            exp = item.get("expected", item.get("val", 1))
        else:
            fid, exp = item[0], item[1]
        parts.append(f"{int(fid):#x}={exp}")
    return ", ".join(parts)


def dialogue_ref(dlg) -> str:
    if not dlg:
        return "-"
    return f"{dlg.get('file')}[{dlg.get('index')}]"


def coord(x, y) -> str:
    if x is None or y is None:
        return "-"
    return f"{x},{y}"


def stage_name(stage_id: str, names: dict) -> str:
    return names.get(stage_id, "")


def load_scene(stage_id: str) -> dict:
    return load_json(SCENES / f"{stage_id}.json", {})


def collect_assets():
    screen_table = load_json(ROOT / "web/assets/data/screen_table.json", {})
    names = load_json(ROOT / "data/stage_names.json", {})
    story_steps = load_json(ROOT / "web/assets/data/story_steps.json", {}).get("stages", {})
    story_grids = load_json(ROOT / "web/assets/data/story_trigger_grids.json", {}).get("stages", {})
    zone_grids = load_json(ROOT / "web/assets/data/zone_grids.json", {}).get("stages", {})
    stage_encounters = load_json(ROOT / "web/assets/data/stage_encounters.json", {}).get("stages", {})
    point_sprites = load_json(ROOT / "web/assets/data/point_sprites.json", {})
    map_overlays = load_json(ROOT / "web/assets/data/map_overlays.json", {})
    scripted_battles = load_json(ROOT / "web/assets/data/scripted_battles.json", {})
    auto_event_gates = load_json(ROOT / "web/assets/data/auto_event_gates.json", {})
    talk_grants = load_json(ROOT / "web/assets/data/talk_item_grants.json", {}).get("grants", [])
    npc_flag_sets = load_json(ROOT / "web/assets/data/npc_flag_sets.json", {}).get("flag_sets", [])
    item_grants = load_json(ROOT / "web/assets/data/item_grants.json", {}).get("grants", [])

    screen_by_stage = {}
    for screen, rec in screen_table.items():
        screen_by_stage[f"s{rec['stage']}"] = int(screen)

    talk_grants_by_stage_npc = defaultdict(list)
    for grant in talk_grants:
        talk_grants_by_stage_npc[(grant["stage"], grant["npc_id"])].append(grant)

    flag_sets_by_stage_npc = defaultdict(list)
    for row in npc_flag_sets:
        flag_sets_by_stage_npc[(row["stage"], row["npc_id"])].append(row)

    item_grants_by_stage = defaultdict(list)
    for grant in item_grants:
        item_grants_by_stage[grant["stage"]].append(grant)

    return {
        "names": names,
        "screen_by_stage": screen_by_stage,
        "story_steps": story_steps,
        "story_grids": story_grids,
        "zone_grids": zone_grids,
        "stage_encounters": stage_encounters,
        "point_sprites": point_sprites,
        "map_overlays": map_overlays,
        "scripted_battles": scripted_battles,
        "auto_event_gates": auto_event_gates,
        "talk_grants_by_stage_npc": talk_grants_by_stage_npc,
        "flag_sets_by_stage_npc": flag_sets_by_stage_npc,
        "item_grants_by_stage": item_grants_by_stage,
    }


def step_op_name(op: int) -> str:
    return {
        0: "end",
        1: "warp/arrow",
        2: "ladder-bottom",
        3: "ladder-top",
        4: "door-glyph",
        5: "exclaim",
        6: "exclaim",
        7: "tool",
        8: "start-event",
    }.get(op, f"op{op}")


def format_stage(stage_id: str, assets: dict) -> list[str]:
    scene = load_scene(stage_id)
    if not scene:
        return [f"## {stage_id}", "", "_No scene JSON found._", ""]

    stage_num = stage_id.removeprefix("s")
    title = stage_name(stage_id, assets["names"])
    screen = assets["screen_by_stage"].get(stage_id)
    head = f"## {stage_id}"
    meta = []
    if title:
        meta.append(title)
    if screen is not None:
        meta.append(f"screen {screen:#x}")
    if meta:
        head += " — " + " · ".join(meta)

    lines = [head, ""]

    exits = scene.get("exits", [])
    warps = scene.get("warps", [])
    doors = scene.get("doors", [])
    ladders = scene.get("ladders", [])
    zones = scene.get("zones", [])
    npcs = scene.get("npcs", [])

    lines.append(
        f"Summary: {len(exits)} exits, {len(doors)} door triggers, {len(warps)} warp records, "
        f"{len(ladders)} ladders, {len(zones)} zones, {len(npcs)} NPC records."
    )
    lines.append("")

    if exits:
        lines.append("### Exits / Doors")
        lines.append("| at | to | spawn | dir | tags |")
        lines.append("| --- | --- | --- | --- | --- |")
        for ex in exits:
            at = f"{ex.get('x')},{ex.get('y')} {ex.get('w')}x{ex.get('h')}"
            spawn = coord(ex.get("spawnX"), ex.get("spawnY"))
            tags = []
            for key in ("warp", "approx", "oneway"):
                if key in ex:
                    tags.append(f"{key}={ex[key]}")
            lines.append(f"| {at} | {ex.get('to')} | {spawn} | {ex.get('dir', '-')} | {'; '.join(tags) or '-'} |")
        lines.append("")

    if warps:
        lines.append("### Raw Warp Records")
        lines.append("| dest screen | dest stage | spawn | dir | param |")
        lines.append("| --- | --- | --- | --- | --- |")
        for w in warps:
            lines.append(
                f"| {int(w.get('screen', 0)):#x} | s{w.get('stage')} | "
                f"{w.get('spawnX')},{w.get('spawnY')} | {w.get('dir', '-')} | {w.get('param', '-')} |"
            )
        lines.append("")

    if ladders:
        lines.append("### Ladders")
        lines.append("| id | bottom | top |")
        lines.append("| --- | --- | --- |")
        for lad in ladders:
            b, t = lad["bottom"], lad["top"]
            lines.append(f"| {lad.get('id')} | {b.get('x')},{b.get('y')} | {t.get('x')},{t.get('y')} |")
        lines.append("")

    if zones:
        lines.append("### Scene Zones")
        lines.append("| type | rect | event/text | gate |")
        lines.append("| --- | --- | --- | --- |")
        for z in zones:
            rect = f"{z.get('x')},{z.get('y')} {z.get('w')}x{z.get('h')}"
            event = []
            if "stage" in z or "entry" in z:
                event.append(f"{z.get('stage')}[{z.get('entry')}]")
            if "onceFlag" in z:
                event.append(f"once={z['onceFlag']}")
            if "chapterAfter" in z:
                event.append(f"chapterAfter={z['chapterAfter']}")
            lines.append(f"| {z.get('type')} | {rect} | {'; '.join(event) or '-'} | {z.get('ifFlag', '-')} |")
        lines.append("")

    steps = assets["story_steps"].get(stage_num)
    grid = assets["story_grids"].get(stage_num)
    if steps:
        op_counts = Counter(step.get("op", 0) for step in steps.get("steps", []) if step.get("op"))
        grid_desc = "uniform" if grid and "uniform" in grid else (f"{grid.get('w')}x{grid.get('h')} cell={grid.get('cell')}" if grid else "no grid")
        lines.append("### Story-Step Triggers")
        lines.append(f"Grid: {grid_desc}. Ops: " + ", ".join(f"{step_op_name(op)}={count}" for op, count in sorted(op_counts.items())) + ".")
        events = steps.get("events", [])
        if events:
            event_bits = ", ".join(f"{e.get('event_id')}->{e.get('flag_key')}" for e in events[:12])
            if len(events) > 12:
                event_bits += f", ... +{len(events)-12}"
            lines.append(f"Events: {event_bits}.")
        lines.append("")

    auto_gates = assets["auto_event_gates"].get(stage_id)
    scripted = assets["scripted_battles"].get(stage_id, {}).get("events", [])
    if auto_gates or scripted or assets["item_grants_by_stage"].get(stage_id):
        lines.append("### Event Attachments")
        if auto_gates:
            lines.append("Auto gates: " + ", ".join(f"event {eid}: {flag_list(v.get('conds'))}" for eid, v in sorted(auto_gates.items(), key=lambda x: int(x[0]))))
        if scripted:
            lines.append("Scripted battles/events: " + ", ".join(str(e.get("id")) for e in scripted[:20]) + (f", ... +{len(scripted)-20}" if len(scripted) > 20 else ""))
        grants = assets["item_grants_by_stage"].get(stage_id, [])
        if grants:
            lines.append("Cutscene item grants: " + ", ".join(f"{g.get('event_id')}->{g.get('item_name')}({g.get('item_id')})" for g in grants))
        lines.append("")

    if npcs:
        lines.append("### NPCs")
        lines.append("| npc | sprite | pos | spawn gate | dialogue | on-close / grants |")
        lines.append("| --- | --- | --- | --- | --- | --- |")
        for npc in npcs:
            npc_id = npc.get("npc_id", "-")
            pos = f"{npc.get('x')},{npc.get('y')}"
            if npc.get("cutsceneOnly"):
                pos += " cutsceneOnly"
            states = npc.get("dialogue_states", [])
            dlgs = ", ".join(dialogue_ref(st.get("dialogue")) for st in states[:3]) if states else dialogue_ref(npc.get("dialogue"))
            if states and len(states) > 3:
                dlgs += f", ... +{len(states)-3}"
            effects = []
            on_close = []
            for st in states:
                on_close.extend(st.get("on_close", []))
            if on_close:
                effects.append("set " + flag_list(on_close[:5]))
            grants = assets["talk_grants_by_stage_npc"].get((stage_id, npc_id), [])
            if grants:
                effects.append("give " + ", ".join(f"{g.get('item_name')}({g.get('item_id')})" for g in grants[:4]))
            flag_sets = assets["flag_sets_by_stage_npc"].get((stage_id, npc_id), [])
            if flag_sets:
                effects.append("flagsets " + ", ".join(flag_list(fs.get("sets")) for fs in flag_sets[:3]))
            lines.append(
                f"| {npc_id} | {npc.get('sprite', '-')} | {pos} | "
                f"{flag_list(npc.get('spawn_flags'))} | {dlgs or '-'} | {'; '.join(effects) or '-'} |"
            )
        lines.append("")

    zone_grid = assets["zone_grids"].get(stage_num)
    encounters = assets["stage_encounters"].get(stage_num)
    if zone_grid or encounters:
        lines.append("### Random Encounters")
        if zone_grid:
            if "uniform" in zone_grid:
                lines.append(f"Zone grid: uniform zone {zone_grid['uniform']}.")
            else:
                lines.append(f"Zone grid: {zone_grid.get('w')}x{zone_grid.get('h')} cell={zone_grid.get('cell')}.")
        if encounters:
            for i, zone in enumerate(encounters.get("zones", []), start=1):
                lines.append(f"Zone {i}: slots {zone.get('slots')}.")
        lines.append("")

    effects = assets["point_sprites"].get(stage_id, {}).get("records", [])
    has_overlay = assets["map_overlays"].get(stage_id)
    if effects or has_overlay:
        lines.append("### Presentation Layers")
        if has_overlay:
            lines.append("- Foreground map overlay: yes (`sNNN_fg.png`).")
        if effects:
            by_layer = Counter(rec.get("layer") for rec in effects)
            lines.append("- Point sprites: " + ", ".join(f"layer {k}: {v}" for k, v in sorted(by_layer.items())) + f" ({len(effects)} total).")
        lines.append("")

    return lines


def available_stages() -> list[str]:
    return sorted((p.stem for p in SCENES.glob("s*.json")), key=stage_sort_key)


def render(stages: list[str], assets: dict) -> str:
    lines = [
        "# Stage Interactions Index",
        "",
        "> Generated by `python3 tools/report_stage_interactions.py --all --write docs/generated/stage-interactions.md`.",
        "> Do not edit by hand; fix source data or the generator.",
        "",
        "This report is a compact lookup for doors/warps, NPC state, story triggers, encounter zones, and presentation-layer interaction cues.",
        "For one-stage output, run `python3 tools/report_stage_interactions.py sNNN`.",
        "",
    ]
    for stage_id in stages:
        lines.extend(format_stage(stage_id, assets))
    return "\n".join(lines).rstrip() + "\n"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("stages", nargs="*", help="Stage ids such as s200 or 200")
    parser.add_argument("--all", action="store_true", help="Include every scene JSON")
    parser.add_argument("--write", help="Write markdown output to this path")
    args = parser.parse_args(argv)

    stages = available_stages() if args.all else [norm_stage(s) for s in args.stages]
    if not stages:
        parser.error("provide stages or --all")

    doc = render(stages, collect_assets())
    if args.write:
        out = ROOT / args.write
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(doc)
        print(f"wrote {out} ({len(stages)} stages)")
    else:
        print(doc, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
