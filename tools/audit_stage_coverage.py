#!/usr/bin/env python3
"""Per-stage presentation-coverage audit — the "here are the exact gaps" oracle.

For every wstag overlay this enumerates what the ORIGINAL stage data declares
(the stage-descriptor tables at 0x80099D80 and the materialize-actor claim
anchor) and diffs it against what the walker actually ships (committed JSON under web/assets). It is the story_robot pattern extended
from story to presentation: an assert that silently drops 38 stages of ambience
should show up HERE as named stages, not in a user report.

## The scene descriptor (0x80099D80) — every field a stage init writes

Censused 2026-08-05 over all 294 wstag overlays with `descriptor_stores`, and
each reader confirmed in FIELDSTG with `tools/descriptor_readers.py` (tracked
base register, not proximity). `fieldstg` loads at 0x80082CB0.

| off | stages | what it is | consumer |
|---|---|---|---|
| +0x08 | 291 | stage map PACK id | `extract_map_overlays.py` |
| +0x0c | 293 | stage TMPK handle | sprite/atlas resolution |
| +0x10 | 293 | point-sprite placement table | `extract_point_sprites.py` |
| +0x14 | 282 | WS4 **story-step program**, 24-byte records | `extract_story_steps.py` |
| +0x1c | 293 | collision MASK id | `collision` extraction |
| +0x20 | 173 | **encounter zone-group selector** record | `extract_stage_encounters.py` |
| +0x24 | 143 | event table (keyed, `-1` terminator) | `wstag_events.py` |
| +0x28 | 293 | **VRAM texture-slot descriptor array** | drop shadow, decoded 2026-07-27 |
| +0x2c/+0x30/+0x34 | 293/293/2 | stage default spawn X / Y / facing | none (see below) |
| +0x3c | 293 | music id | `map_sound_archives.json` |
| +0x40 | 293 | BGM play id | `map_sound_archives.json` |
| +0x4c | 281 | stage cast list (entity-type ptr array) | none (see below) |

**Do not re-derive "unconsumed" buckets from the store census alone.** Three
buckets here (`table14_unconsumed` 282, `tile_anim_unconsumed` 173,
`bg_quads_unconsumed` 293) were exactly that mistake and were removed on
2026-08-05: every one of the three fields is both read by FIELDSTG and already
shipped by an extractor. `tile_anim` in particular never existed — +0x20 is the
encounter selector (`extract_stage_encounters.py` §"Zone GROUPS", decoded
2026-07-27), and its 173 stages are a strict subset of the 203 stages already in
`stage_encounters.json`. There is no tile-animation system in the map data: the
237 stage packs ship `<= width*height` chunk images with no spare frames, and
the animated field decoration (windmills, torches, lights, halos) is the
point-sprite system at +0x10, whose `animMode` byte drives the frame loops.

**`meft_unrendered` was the same mistake and is gone (2026-08-05).** It scanned
every word of the overlay for `{n<<16 | tag}` with `n` in 1001..1055 and tag 4
or 8, and called each hit an authored field-effect placement: 19 stages, 27
placements, and for weeks the head of the render queue. All 27 are explained
and none is an unrendered effect. 21 are the X COORDINATE of a point sprite the
walker already draws on that same stage — the 18-byte point record read at u32
alignment puts `X<<16|kind` exactly where the scan looked (the 2026-07-04
session-2 falsification in map-effects-meft.md, re-verified 2026-08-05 against
point_sprites.json). The other 6 (s810, s815) are the `target` field of a
`{gate, 0xffff, target<<16|kind, spawn, dir, 0}` trigger record; across the
whole corpus that field ranges 270..1509 over 23 records, and MEFT0270 /
MEFT0730 / MEFT1507-1509 do not exist — only 1001-1055 do, so `target` is not
a MEFT id. Whether ANY field stage references MEFT1001-1055 is still open; do
not re-add a per-stage bucket for it without a decoded binding.

The two genuinely unconsumed fields are the default spawn (+0x2c/+0x30/+0x34 —
the walker positions the player from warp records instead, so this only matters
for a stage entered with no warp) and the cast list (+0x4c — which entity types
FIELDSTG instantiates, e.g. 0x146 leader / 0x147 partner). Both are engine
behaviour, not unrendered art; neither is bucketed until it is decoded.

The audit is purely static — overlay .s files from ~/ddw3 plus committed
walker JSON. No disc access, no emulator.

Usage:
  python3 tools/audit_stage_coverage.py                    # human summary
  python3 tools/audit_stage_coverage.py --json             # full scorecards
  python3 tools/audit_stage_coverage.py --stage s420       # one stage detail
  python3 tools/audit_stage_coverage.py --check            # exit 1 on NEW gaps vs baseline
  python3 tools/audit_stage_coverage.py --write-baseline   # accept current gaps
  python3 tools/audit_stage_coverage.py --md docs/generated/stage-coverage.md

Buckets (each maps stage -> badness count; --check fails when any stage's
badness exceeds the committed tools/audit_stage_coverage.baseline.json):
  points_missing         declared point-sprite records, none shipped
  points_partial         shipped fewer point records than declared
  points_error           declared +0x10 table the extractor side can't parse
  point_actor_unparsed   native code claims the point table (lw 0x9D90) but the
                         stage is in neither point_record_actors.json nor the
                         native interpreter manifest -- its runtime record
                         writes (halos, traffic lights, ...) ship nowhere
  events_missing         declared event table, stage absent from wstag_events.json
  events_partial         fewer events shipped than declared
  esdmg_unreferenced     cutscene-text entries (esdmgNNN.json) no wstag event
                         references -- text the walker never plays (keyed by
                         esdmg bank, not stage)
  native_events_unwired  native-only events, stage not in native/manifest.json
  scene_missing          stage declares a map pack but has no scene JSON
  exits_floating         scene exits without grid placement (guessed geometry)
  sound_missing          declared BGM, stage absent from map_sound_archives.json
  bgm_mismatch           declared +0x40 play id not among shipped play ids
  descriptor_field_unknown  the stage init writes a descriptor offset this tool
                         has no entry for — a new field, or a changed extractor
"""

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import overlay_scan as ovs
from extract_point_sprites import (WSTAG_BASE, descriptor_stores,
                                   parse_records, wstag_bytes)
from wstag_events import find_event_table, overlay_bytes

DDW3 = Path.home() / "ddw3"
ASM = DDW3 / "asm/dw2003/pro"
REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "web/assets/data"
BASELINE = Path(__file__).resolve().parent / "audit_stage_coverage.baseline.json"

# Scene-descriptor (0x80099D80) offsets a stage init is KNOWN to write, with the
# decoded meaning. See the module docstring for the census and the consumers; a
# store to anything outside this map raises `descriptor_field_unknown`.
DESCRIPTOR_FIELDS = {
    0x08: "map pack id",
    0x0C: "stage TMPK handle",
    0x10: "point-sprite placement table",
    0x14: "WS4 story-step program",
    0x1C: "collision mask id",
    0x20: "encounter zone-group selector",
    0x24: "event table",
    0x28: "VRAM texture-slot descriptor array",
    0x2C: "default spawn X",
    0x30: "default spawn Y",
    0x34: "default spawn facing",
    0x3C: "music id",
    0x40: "BGM play id",
    0x4C: "stage cast list",
}


# ── declared side (overlay static data) ──────────────────────────────────────
def declared_stage(path: Path) -> dict:
    words = ovs.load_words(path)
    stores = descriptor_stores(path)
    d = {
        "pack": bool(stores.get(0x08)),
        "tmpk": bool(stores.get(0x0C)),
        "mask": bool(stores.get(0x1C)),
        "descriptor_fields": sorted(o for o, v in stores.items() if v),
        "music_id": sorted(set(stores.get(0x3C, []))),
        "bgm": sorted(set(stores.get(0x40, []))),
        "points": 0,
        "points_error": None,
        "events": 0,
        "native_events": 0,
        "materialize_candidate": False,
    }

    tables = sorted(set(stores.get(0x10, [])))
    if tables:
        try:
            d["points"] = len(parse_records(wstag_bytes(path), tables[0] - WSTAG_BASE))
        except Exception as e:  # unparseable table is itself a finding
            d["points_error"] = str(e)

    data = overlay_bytes(path.stem.replace("wstag", ""))
    if data:
        events = find_event_table(data)
        d["events"] = len(events)
        d["native_events"] = sum(
            1 for e in events if e["native_fn"] and not e["script_offset"])

    for w in words.values():
        # materialize-actor claim: `lw rt, 0x9D90(rs)` (descriptor+0x10 global)
        if (w >> 26) == 0x23 and (w & 0xFFFF) == 0x9D90:
            d["materialize_candidate"] = True
    return d


# ── shipped side (committed walker JSON) ─────────────────────────────────────
def load_shipped() -> dict:
    def j(p: Path, default):
        try:
            return json.loads(p.read_text())
        except FileNotFoundError:
            return default

    return {
        "points": j(DATA / "point_sprites.json", {}),
        "events": j(REPO / "web/assets/events/wstag_events.json", {}),
        "sounds": j(DATA / "map_sound_archives.json", {}),
        "point_actors": j(DATA / "point_record_actors.json",
                          {}).get("stages", {}),
        "native": j(REPO / "web/assets/native/manifest.json", {}),
        "scenes": {p.stem for p in (REPO / "web/assets/scenes").glob("s*.json")},
    }


# ── the diff ─────────────────────────────────────────────────────────────────
def audit(stages: list[str] | None = None) -> dict:
    shipped = load_shipped()
    cards: dict[str, dict] = {}
    for path in sorted(ASM.glob("wstag*.s")):
        stage = "s" + re.match(r"wstag(\d+)", path.stem).group(1)
        if stages and stage not in stages:
            continue
        dec = declared_stage(path)
        shp = {
            "points": len(shipped["points"].get(stage, {}).get("records", [])),
            "events": len(shipped["events"].get(stage, [])),
            "scene": stage in shipped["scenes"],
            "sound": stage in shipped["sounds"],
            "point_actor": stage in shipped["point_actors"],
            "native": stage in shipped["native"],
            "exit_floats": 0,
        }
        if shp["scene"]:
            scene = json.loads(
                (REPO / f"web/assets/scenes/{stage}.json").read_text())
            shp["exit_floats"] = sum(
                1 for e in scene.get("exits", []) if not e.get("grid"))
        gaps = classify(stage, dec, shp, shipped)
        cards[stage] = {"declared": dec, "shipped": shp, "gaps": gaps}
    if not stages:  # bank-level rows only make sense in a full audit
        for bank, gap in esdmg_unreferenced(shipped["events"]).items():
            cards[bank] = {"declared": {}, "shipped": {},
                           "gaps": {"esdmg_unreferenced": gap}}
    return cards


def esdmg_unreferenced(events: dict) -> dict:
    """{esdmgNNN: gap} — cutscene-text entries no wstag event references."""
    refs = {(str(e["esdmg_stage"]), int(e["esdmg_entry"]))
            for evs in events.values() for e in evs
            if e.get("esdmg_stage") is not None and e.get("esdmg_entry") is not None}
    out = {}
    for f in sorted((REPO / "web/assets/events").glob("esdmg*.json")):
        bank = f.stem[5:]
        entries = json.loads(f.read_text())
        unref = [i for i in entries if (bank, int(i)) not in refs]
        if unref:
            out[f.stem] = {"n": len(unref), "total": len(entries)}
    return out


def classify(stage: str, dec: dict, shp: dict, shipped: dict) -> dict:
    """-> {bucket: {"n": badness, ...detail}} for every gap this stage has."""
    gaps: dict[str, dict] = {}

    if dec["points_error"]:
        gaps["points_error"] = {"n": 1, "error": dec["points_error"]}
    elif dec["points"] and not shp["points"]:
        gaps["points_missing"] = {"n": dec["points"], "declared": dec["points"]}
    elif shp["points"] < dec["points"]:
        gaps["points_partial"] = {"n": dec["points"] - shp["points"],
                                  "shipped": shp["points"],
                                  "declared": dec["points"]}

    if (dec["materialize_candidate"] and not shp["point_actor"]
            and not shp["native"]):
        gaps["point_actor_unparsed"] = {"n": 1}

    if dec["events"] and not shp["events"]:
        gaps["events_missing"] = {"n": dec["events"], "declared": dec["events"]}
    elif shp["events"] < dec["events"]:
        gaps["events_partial"] = {"n": dec["events"] - shp["events"],
                                  "shipped": shp["events"],
                                  "declared": dec["events"]}

    if dec["native_events"] and not shp["native"]:
        gaps["native_events_unwired"] = {"n": dec["native_events"]}

    if dec["pack"] and not shp["scene"]:
        gaps["scene_missing"] = {"n": 1}

    if shp.get("exit_floats"):
        gaps["exits_floating"] = {"n": shp["exit_floats"]}

    if dec["bgm"] and not shp["sound"]:
        gaps["sound_missing"] = {"n": 1}
    elif dec["bgm"]:
        snd = shipped["sounds"][stage]
        have = {int(x, 16) for x in [snd["play_id"], *snd.get("alt_play_ids", [])]}
        missing = [v for v in dec["bgm"] if v not in have]
        if missing:
            gaps["bgm_mismatch"] = {"n": len(missing),
                                    "declared": [f"0x{v:08x}" for v in missing],
                                    "shipped": sorted(f"0x{v:08x}" for v in have)}

    unknown = [o for o in dec["descriptor_fields"] if o not in DESCRIPTOR_FIELDS]
    if unknown:
        gaps["descriptor_field_unknown"] = {
            "n": len(unknown), "offsets": [f"+0x{o:02x}" for o in unknown]}
    return gaps


def bucketize(cards: dict) -> dict:
    """{bucket: {stage: gap detail}} across all stages."""
    buckets: dict[str, dict] = {}
    for stage, card in cards.items():
        for bucket, detail in card["gaps"].items():
            buckets.setdefault(bucket, {})[stage] = detail
    return buckets


# ── output ───────────────────────────────────────────────────────────────────
BUCKET_ORDER = [
    "points_missing", "points_partial", "points_error", "point_actor_unparsed",
    "events_missing", "events_partial", "esdmg_unreferenced",
    "native_events_unwired", "scene_missing", "exits_floating",
    "sound_missing", "bgm_mismatch",
    "descriptor_field_unknown",
]
# Systems with no walker consumer at all: whole-system gaps, summarized by
# count in the human report (per-stage lists add noise, not information).
# Empty since 2026-08-05: every bucket that ever lived here turned out to be
# counting something the walker already ships (see the docstring).
SYSTEM_BUCKETS: set[str] = set()


def render(cards: dict, md: bool = False) -> str:
    buckets = bucketize(cards)
    overlays = [c for c in cards.values() if c["declared"]]
    n_pts_dec = sum(c["declared"]["points"] for c in overlays)
    n_pts_shp = sum(c["shipped"]["points"] for c in overlays)
    n_ev_dec = sum(c["declared"]["events"] for c in overlays)
    n_ev_shp = sum(c["shipped"]["events"] for c in overlays)
    h = "## " if md else ""
    lines = [
        f"{'# ' if md else ''}Stage coverage audit — "
        f"{len(overlays)} overlays",
        "",
        f"point records shipped/declared: {n_pts_shp}/{n_pts_dec}   "
        f"events: {n_ev_shp}/{n_ev_dec}   "
        f"scenes: {sum(c['shipped']['scene'] for c in overlays)}   "
        f"sound-mapped: {sum(c['shipped']['sound'] for c in overlays)}",
        "",
    ]
    for bucket in BUCKET_ORDER:
        entries = buckets.get(bucket, {})
        if not entries:
            continue
        total = sum(d["n"] for d in entries.values())
        lines.append(f"{h}{bucket}: {len(entries)} stages (badness {total})")
        if bucket not in SYSTEM_BUCKETS:
            for stage in sorted(entries):
                d = entries[stage]
                detail = ", ".join(f"{k}={v}" for k, v in d.items() if k != "n")
                lines.append(f"  {stage}" + (f"  {detail}" if detail else "")
                             + (f"  (n={d['n']})" if d["n"] > 1 and not detail else ""))
        lines.append("")
    return "\n".join(lines)


# ── baseline / --check ───────────────────────────────────────────────────────
def baseline_shape(cards: dict) -> dict:
    return {b: {s: d["n"] for s, d in stages.items()}
            for b, stages in sorted(bucketize(cards).items())}


def check(cards: dict) -> int:
    if not BASELINE.exists():
        print("no baseline; run --write-baseline first", file=sys.stderr)
        return 2
    base = json.loads(BASELINE.read_text())["buckets"]
    now = baseline_shape(cards)
    regressions, improvements = [], []
    for bucket in set(base) | set(now):
        b, n = base.get(bucket, {}), now.get(bucket, {})
        for stage in set(b) | set(n):
            was, cur = b.get(stage, 0), n.get(stage, 0)
            if cur > was:
                regressions.append(f"{bucket}/{stage}: {was} -> {cur}")
            elif cur < was:
                improvements.append(f"{bucket}/{stage}: {was} -> {cur}")
    for r in sorted(regressions):
        print(f"REGRESSION {r}")
    for i in sorted(improvements):
        print(f"improved   {i}")
    if improvements and not regressions:
        print("baseline is stale (improvements only) — rerun --write-baseline")
    print(f"check: {len(regressions)} regressions, {len(improvements)} improvements")
    return 1 if regressions else 0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--json", action="store_true", help="full scorecards to stdout")
    ap.add_argument("--stage", action="append", help="audit only this stage (repeatable)")
    ap.add_argument("--check", action="store_true", help="exit 1 on new gaps vs baseline")
    ap.add_argument("--write-baseline", action="store_true")
    ap.add_argument("--md", metavar="FILE", help="write markdown report to FILE")
    args = ap.parse_args()

    cards = audit(args.stage)
    if args.check:
        sys.exit(check(cards))
    if args.write_baseline:
        BASELINE.write_text(json.dumps({
            "_note": "Pinned gap baseline for tools/audit_stage_coverage.py. "
                     "--check exits non-zero when any stage's badness in any bucket "
                     "EXCEEDS this file (a new silent extraction/render gap). Rerun "
                     "--write-baseline only when a gap is legitimately closed or a "
                     "newly decoded system adds an expected bucket.",
            "buckets": baseline_shape(cards),
        }, indent=1) + "\n")
        print(f"baseline written: {BASELINE}")
        return
    if args.json:
        print(json.dumps(cards, indent=1))
        return
    out = render(cards, md=bool(args.md))
    if args.md:
        Path(args.md).write_text(out + "\n")
        print(f"wrote {args.md}")
    else:
        print(out)


if __name__ == "__main__":
    main()
