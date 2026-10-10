#!/usr/bin/env python3
"""build_story_progression.py — story-progression RE reference generator.

Mines the DECODED story data (no assumptions, every claim traces to a source byte)
into a story-progression dependency graph and 5 reverse-engineering docs, viewing the
whole game as a state machine of flags.

Sources (all already decoded by other build stages):
  web/assets/events/wstag_events.json      per-event bytecode (disasm), esdmg ref, flag_key
  web/assets/data/story_steps.json         step programs: op1=spawn, op8=start_event,
                                           cond gates (get_flag), event on_complete flag-sets
  web/assets/events/esdmgNNN.json          per-region dialogue text (entry-indexed)
  web/assets/scenes/sNNN.json              NPC spawn variants (n-field chapter gates)
  web/assets/data/screen_table.json        screen_id -> stage (HANDOFF map transitions)
  web/assets/data/chapter_progression.json chapter ladder (decoded milestone flags)
  data/stage_names.json                    stage display names

Output: docs/research/story-progression/{STORY_PROGRESSION,EVENT_DEPENDENCIES,
        MAP_PROGRESS_STATES,NPC_AND_DIALOGUE_STATE_CHANGES,CUTSCENE_DEPENDENCIES}.md
"""
import json, re, glob, collections
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
W = ROOT / "web/assets"
OUT = ROOT / "docs/research/story-progression"
OUT.mkdir(parents=True, exist_ok=True)

# ── load ──────────────────────────────────────────────────────────────────────
wstag = json.load(open(W / "events/wstag_events.json"))                 # {sNNN:[evt]}
steps = json.load(open(W / "data/story_steps.json"))["stages"]          # {"NNN":{steps,events}}
screen = json.load(open(W / "data/screen_table.json"))                  # {"id":{stage}}
names = json.load(open(ROOT / "data/stage_names.json"))                 # {sNNN:name}
chapters = json.load(open(W / "data/chapter_progression.json"))
try:
    ordinal = json.load(open(W / "data/progress_ordinal.json"))  # [0x8004b370] ladder
except FileNotFoundError:
    ordinal = {"ladder": [], "by_stage": {}}
try:  # bank-0x70 predicate table: key (0x70NN low byte) -> decoded record
    _rp = json.load(open(W / "data/roster_predicate_table.json"))["records"]
    roster_pred = {r["key"]: r for r in _rp}
except FileNotFoundError:
    roster_pred = {}
# set_flag producer index mined from the WHOLE disasm (overlays + EXE) by
# tools/scan_flag_setters.py — captures the set_flag immediates the on_complete
# extractor (98 step-program stages only) never saw.  {"0xNNNN":[{overlay,val,line}]}
try:
    flag_setters = json.load(open(W / "data/flag_setters.json"))
except FileNotFoundError:
    flag_setters = {}
esdmg = {}
for f in glob.glob(str(W / "events/esdmg*.json")):
    key = Path(f).stem.replace("esdmg", "")
    esdmg[key] = json.load(open(f))
scenes = {}
for f in glob.glob(str(W / "scenes/s*.json")):
    scenes[Path(f).stem] = json.load(open(f))
estalk = {}
for f in glob.glob(str(W / "dialogue/estalk*.json")):
    estalk[Path(f).stem] = json.load(open(f))

UNCOND = (65535, 0)  # cond_a values meaning "no get_flag gate"

# region (flag_key high16) -> human label, anchored to the region's stages + chapter ladder
REGION_NAME = {
    0x0112: "Central Sector — Asuka / Amaterasu City",
    0x0127: "Amaterasu City interiors / Central Sector",
    0x0135: "East Sector — Kicking Forest / Seiryu (Green)",
    0x013c: "South Sector — Zhu Que City / Suzaku (Red)",
    0x0143: "Byakko (White) team area",
    0x014a: "Opening / West Sector",
    0x0151: "Underground — Seabed / Genbu approach",
    0x0158: "Underground — Circuit Board / endgame",
    0x0120: "Asuka sub-area (s270, esdmg270)",
    0x012e: "Amaterasu sub-area (s305, esdmg305)",
    0x0000: "Uncategorised events (null flag_key: s741/745/746/810)",
}
# the linear story spine (server areas in progression order); sub-areas hang off these
MAIN_SPINE = [0x014a, 0x0112, 0x0127, 0x0135, 0x013c, 0x0143, 0x0151, 0x0158]
# sub-area region -> the spine region it belongs to (by stage geography)
SUBAREA_PARENT = {0x0120: 0x0112, 0x012e: 0x0127, 0x0000: 0x0151}
# chapter ladder flag -> chapter
LADDER = {r["flag"]: r["chapter"] for r in chapters["ladder"]}


def hx(n):  # consistent 0xNNN rendering for flag ids
    return f"0x{n:04x}"


# bank-0x60 = equality test against the master progress ordinal [0x8004b370]
# (DIGIMON_CUR_STATS+0x1ed4); each 0x60NN names story beat 0xNN. Map value->stage.
_ord_stage = {}
for _b in ordinal.get("ladder", []):
    for _o in _b["ordinals"]:
        _ord_stage.setdefault(_o, _b["stage"])


def beat_label(n):
    """Render an ordinal value as 'beat 0xNN (sStage name)' if known."""
    s = _ord_stage.get(n)
    return f"beat 0x{n:02x}" + (f" = s{s} {stage_name(s)}" if s else "")


def roster_pred_label(fid):
    """Resolve a bank-0x70 id to its decoded meaning via roster_predicate_table.json.
    op 0x30 = progress-ordinal range (the common, fully-decoded case)."""
    r = roster_pred.get(fid & 0x1ff)
    if not r:
        return f"roster/party predicate `{hx(fid)}`"
    if (r["op"] & 0xf0) == 0x30:
        lo, hi = r.get("ordinal_lo"), r.get("ordinal_hi")
        if hi is None:
            return f"progress-ordinal >= {beat_label(lo)}"
        return f"progress-ordinal in [{beat_label(lo)} .. {beat_label(hi)}]"
    return f"{r['kind'].split('(')[0].strip()} (`{hx(fid)}`)"


def flag_nature(fid):
    """Classify a get_flag id by its decoded BANK source (F0x800163b0), verified by
    delay-slot pairing. See docs/research/scripting/get-flag-banked-predicate-system.md.
    Banks 0x00-0x40 = stored bit-arrays; banks 0x60+ = computed predicate functions."""
    bank = (fid >> 8) & 0xfe
    if bank == 0x00:
        return "story flag (stored, D0x80048abc)"
    if bank == 0x60:
        return f"progress-ordinal == {beat_label(fid & 0x1ff)}"
    if bank == 0x70:
        return roster_pred_label(fid)
    if bank in (0x72, 0x7e):
        return "VIRTUAL predicate"
    if 0x80 <= bank <= 0x92:
        return f"collection[{hx(fid & 0x1ff)}] obtained? (D0x80048d34 per-id array)"
    if bank <= 0x40:
        return f"stored bit (bank {hx(bank)})"
    return f"bank {hx(bank)} (unclassified)"


def stage_name(stg):
    return names.get(f"s{stg}", f"s{stg}")


def clean(s):
    """Strip control tags + collapse whitespace for a short readable snippet."""
    s = re.sub(r"\[name\][^\[]*\[name\]", "", s, count=0)  # remove [name]X[name] wrappers
    s = re.sub(r"\[[a-z_]+\]", " ", s)                     # [pause][clear][player_name]...
    return re.sub(r"\s+", " ", s).strip()


def speaker_of(s):
    m = re.match(r"\[name\]([^\[]*)\[name\]", s)
    return (m.group(1).strip() if m else "")


def esdmg_lines(stg, entry):
    d = esdmg.get(str(stg), {}).get(str(entry))
    return d.get("strings", []) if isinstance(d, dict) else []


def resolve_dialogue(ref):
    """Resolve an NPC dialogue ref {file,index} to 'file#idx — Speaker: text'."""
    if isinstance(ref, dict) and "file" in ref:
        d = estalk.get(ref["file"], {})
        txt = d.get(str(ref["index"]))
        if txt:
            sp, c = speaker_of(txt), clean(txt)
            return f'{ref["file"]}#{ref["index"]} — ' + (f"{sp}: {c}" if sp else c)
        return f'{ref["file"]}#{ref["index"]}'
    return clean(str(ref))[:90]


def event_label(ev):
    lines = esdmg_lines(ev["esdmg_stage"], ev["esdmg_entry"])
    if lines:
        sp, txt = speaker_of(lines[0]), clean(lines[0])
        return (f"{sp}: {txt}" if sp else txt)[:80]
    return f"event {ev['flag_key']}"


# ── build event model ─────────────────────────────────────────────────────────
# on_complete sets live in story_steps events[], keyed by flag_key.
sets_by_flagkey = {}
eventid_to_flagkey = {}  # per stage: {stage:{event_id:flag_key}}
for stg, info in steps.items():
    eventid_to_flagkey[stg] = {}
    for e in info.get("events", []):
        if e.get("flag_key"):
            sets_by_flagkey[e["flag_key"]] = [tuple(s) for s in e.get("sets", [])]
            eventid_to_flagkey[stg][e["event_id"]] = e["flag_key"]

ACTOR_PLAYER, ACTOR_PARTNER, EFFECT_MIN = 1, 2, 800


def parse_disasm(disasm):
    """Pull participants, animations, handoff targets, dialogue refs from bytecode."""
    actors, effects, handoffs, anims, says = set(), set(), [], [], []
    for ln in disasm:
        t = ln.split()
        op = t[0]
        if op == "SAY":            # SAY p0 line speaker mode
            if len(t) >= 4:
                says.append((int(t[2]), int(t[3])))
                a = int(t[3])
                (effects if a >= EFFECT_MIN else actors).add(a)
        elif op in ("SETPOS", "WALKTO", "SETANIM"):
            a = int(t[1])
            (effects if a >= EFFECT_MIN else actors).add(a)
            if op in ("WALKTO", "SETANIM"):
                anims.append(ln)
        elif op == "HANDOFF":
            sid = int(t[1])
            dest = screen.get(str(sid), {}).get("stage")
            handoffs.append((sid, dest))
    actors.discard(0)
    return actors, effects, handoffs, anims, says


EVENTS = {}        # flag_key -> model
events_by_stage = collections.defaultdict(list)
for stg_key, evs in wstag.items():
    stg = stg_key[1:]
    for ev in evs:
        fk = ev.get("flag_key")
        if not fk:
            continue
        region = int(fk, 16) >> 16
        entry = int(fk, 16) & 0xFFFF
        actors, effects, handoffs, anims, says = parse_disasm(ev.get("disasm", []))
        m = {
            "stage": stg, "flag_key": fk, "region": region, "entry": entry,
            "esdmg_stage": ev.get("esdmg_stage"), "esdmg_entry": ev.get("esdmg_entry"),
            "esdmg_approx": ev.get("esdmg_approx", False),
            "disasm": ev.get("disasm", []),
            "actors": sorted(actors), "effects": sorted(effects),
            "handoffs": handoffs, "anims": anims, "says": says,
            "sets": sets_by_flagkey.get(fk, []),
        }
        m["label"] = event_label(m)
        EVENTS[fk] = m
        events_by_stage[stg].append(m)

# ── flag graph ────────────────────────────────────────────────────────────────
producers = collections.defaultdict(list)   # flag id -> [event flag_key]
for fk, m in EVENTS.items():
    for fid, val in m["sets"]:
        producers[fid].append(fk)

# step gates: op8 start_event (event trigger) + op1 spawn, with their cond get_flag gate
triggers_by_event = {}     # flag_key -> {"stage","cond","arg"}  (how the cutscene is started)
spawn_states = collections.defaultdict(list)  # stage -> [{npc_id, x, y, sprite, cond, arg}]
consumers = collections.defaultdict(list)  # flag id -> [(stage, role)]
for stg, info in steps.items():
    e2f = eventid_to_flagkey.get(stg, {})
    for s in info.get("steps", []):
        op = s["op"]
        cond, arg = s["cond_a"], s["arg_a"]
        gated = cond not in UNCOND
        if op == 8:  # start_event
            fk = e2f.get(s["params"][0])
            if fk:
                triggers_by_event[fk] = {"stage": stg, "cond": cond, "arg": arg}
                if gated:
                    consumers[cond].append((stg, f"start event {fk}"))
        elif op == 1:  # spawn an NPC/actor
            p = s["params"]
            spawn_states[stg].append({"npc_id": p[0], "x": p[1], "y": p[2],
                                      "sprite": p[4], "cond": cond, "arg": arg})
            if gated:
                consumers[cond].append((stg, f"spawn npc {p[0]}"))
        elif gated:
            consumers[cond].append((stg, f"op{op} step"))


def region_label(r):
    return REGION_NAME.get(r, f"region {hx(r)}")


def overlay_setters(fid):
    """set_flag(fid,val) immediate callsites mined from the disasm overlays/EXE."""
    out = []
    for s in flag_setters.get(hx(fid), []):
        v = s.get("val")
        vs = f"={v}" if v is not None else ""
        out.append(f"`set_flag({hx(fid)}{vs})` in {s['overlay']} (disasm L{s['line']})")
    return out


def flag_origin(fid):
    """Where a required flag comes from: producing events, then disasm set_flag sites."""
    out = []
    for fk in producers.get(fid, []):
        m = EVENTS.get(fk)
        if m:
            out.append(f"s{m['stage']} «{m['label']}» ({fk})")
    out.extend(overlay_setters(fid))
    return out


# ── ordering: group events by region, then by entry index (the global esdmg order) ──
def region_sort_key(r):
    # approximate story order; sub-areas sit right after their parent spine region
    order = [0x014a, 0x0112, 0x0120, 0x0127, 0x012e, 0x0135, 0x013c, 0x0143,
             0x0151, 0x0158, 0x0000]
    return order.index(r) if r in order else 99


regions = sorted({m["region"] for m in EVENTS.values()}, key=region_sort_key)
events_by_region = collections.defaultdict(list)
for m in EVENTS.values():
    events_by_region[m["region"]].append(m)
for r in events_by_region:
    events_by_region[r].sort(key=lambda m: m["entry"])

GEN_HEADERS = {
    "STORY_PROGRESSION.md": "Reading the whole story as a dependency graph of flags, events and chapters.",
    "EVENT_DEPENDENCIES.md": "Asking what a story event requires beforehand and what it unlocks afterwards.",
    "MAP_PROGRESS_STATES.md": "Asking which version of a map the player sees at a given chapter.",
    "NPC_AND_DIALOGUE_STATE_CHANGES.md": "Asking which NPCs change identity or dialogue as the story advances.",
    "CUTSCENE_DEPENDENCIES.md": "Looking up what one cutscene animates, moves and sets when it plays.",
    "GAME_WALKTHROUGH.md": "Following the intended play order as the binary itself numbers it.",
}


def write_doc(name: str, body: list) -> None:
    """Write a generated doc with its doc-index header (reach:/status:) built in —
    regeneration must not strip the headers added in d39d963c."""
    lines = ["---", f"reach: {GEN_HEADERS[name]}", "status: canonical", "---", ""]
    (OUT / name).write_text("\n".join(lines + body) + "\n")

GEN_NOTE = ("> Generated by `tools/build_story_progression.py` from decoded data "
            "(`wstag_events.json`, `story_steps.json`, `esdmg*.json`, `scenes/`, "
            "`screen_table.json`). Do not hand-edit — rerun the tool. Every event/flag "
            "traces to a source byte; absences are marked, not guessed.\n")

# ══════════════════════════════════════════════════════════════════════════════
# 1. STORY_PROGRESSION.md  (+ mermaid total-story graph)
# ══════════════════════════════════════════════════════════════════════════════
def emit_story_progression():
    L = ["# Story Progression — dependency graph (state machine)\n", GEN_NOTE]
    L.append("\nThe game gates story content through a **banked flag bitfield**. An "
             "event's `on_complete` *sets* flags; a step program's `cond` (`get_flag`) "
             "*requires* flags before it will spawn an actor or `start_event`. The "
             "**chapter** scalar that selects NPC spawn variants is itself derived from "
             "these flags (see `chapter-progression-decode.md`). This file is the "
             "high-level spine; per-event detail is in `EVENT_DEPENDENCIES.md`.\n")

    # chapter ladder spine
    L.append("\n## Chapter ladder (NPC-variant gate)\n")
    L.append("`state.chapter` = highest rung whose decoded milestone flag is set:\n")
    L.append("```")
    L.append("CHAPTER 1  (default, new game)")
    for r in sorted(chapters["ladder"], key=lambda x: x["chapter"]):
        L.append(f"   |  requires {hx(r['flag'])}  [{r['milestone']}]")
        L.append(f"CHAPTER {r['chapter']}")
    L.append("```")

    # mermaid: region spine + cross-region flag gates
    L.append("\n## Total-story graph (mermaid)\n")
    L.append("Region nodes = server areas (flag-key high16). A solid edge = a flag set "
             "in one region gates a step/event in another (a hard progression "
             "dependency). Chapter rungs annotate the spine.\n")
    L.append("```mermaid")
    L.append("flowchart TD")
    L.append("    START([NEW GAME]):::start")
    present = {m["region"] for m in EVENTS.values()}
    spine = [r for r in MAIN_SPINE if r in present]
    for r in spine:
        L.append(f'    R{r:04x}["{region_label(r)}<br/>flag-key {hx(r)}"]')
    # spine edges with chapter-rung annotations where a rung is crossed entering a region
    chapter_entering = {0x0135: 5, 0x013c: 6, 0x0143: 7}  # ch3 is intra-0112 (s212 download)
    L.append(f"    START --> R{spine[0]:04x}")
    for a, b in zip(spine, spine[1:]):
        lbl = f"|chapter {chapter_entering[b]}|" if b in chapter_entering else ""
        L.append(f"    R{a:04x} -->{lbl} R{b:04x}")
    # sub-areas hang off their parent spine region (not in the linear chain)
    for sub, parent in SUBAREA_PARENT.items():
        if sub in present and parent in spine:
            L.append(f'    R{sub:04x}["{region_label(sub)}"]:::sub')
            L.append(f"    R{parent:04x} -.sub-area.-> R{sub:04x}")
    # ch3 annotation (intra-region milestone)
    if 0x0112 in spine:
        L.append('    CH3{{"chapter 3: s212 Digimon download (0x4004)"}}:::ms')
        L.append("    R0112 -.-> CH3")
    # cross-region HARD gates: a flag set in region A gates a step in region B
    seen = set()
    for fid, cons in consumers.items():
        prods = {EVENTS[fk]["region"] for fk in producers.get(fid, [])}
        for pr in prods:
            for cstg, role in cons:
                evs = (steps.get(cstg) or {}).get("events")
                cr = (int(evs[0]["flag_key"], 16) >> 16) if evs and evs[0].get("flag_key") else None
                if cr is None or pr == cr or pr not in spine or cr not in spine:
                    continue
                key = (pr, cr, fid)
                if key in seen:
                    continue
                seen.add(key)
                L.append(f"    R{pr:04x} -. sets {hx(fid)}, unlocks .-> R{cr:04x}")
    L.append("    classDef start fill:#cde,stroke:#338;")
    L.append("    classDef sub fill:#eee,stroke:#999,font-size:11px;")
    L.append("    classDef ms fill:#fec,stroke:#a83;")
    L.append("```")

    # per-region ordered event list with requirements/sets/unlocks
    L.append("\n## Per-region progression\n")
    for r in regions:
        L.append(f"\n### {region_label(r)}  (`{hx(r)}`)\n")
        for m in events_by_region[r]:
            trig = triggers_by_event.get(m["flag_key"])
            req = []
            if trig and trig["cond"] not in UNCOND:
                req.append(f"get_flag({hx(trig['cond'])})")
            sets = ", ".join(hx(f) for f, v in m["sets"]) or "—"
            unl = []
            for sid, dest in m["handoffs"]:
                unl.append(f"→ s{dest} ({stage_name(dest)})" if dest else f"→ screen {sid}")
            L.append(f"- **s{m['stage']} · entry {m['entry']}** «{m['label']}»  ")
            L.append(f"  requires: {', '.join(req) or '(unconditional / talk-triggered)'} · "
                     f"sets: {sets} · handoff: {', '.join(unl) or '—'}")
    write_doc("STORY_PROGRESSION.md", L)


# ══════════════════════════════════════════════════════════════════════════════
# 2. EVENT_DEPENDENCIES.md
# ══════════════════════════════════════════════════════════════════════════════
def emit_event_dependencies():
    L = ["# Event Dependencies\n", GEN_NOTE,
         "\nEvery decoded story event as a node: its requirements (gating flags + the "
         "events that produce them), trigger, participants, the flags it sets, and what "
         "those flags unlock downstream.\n",
         "\n> **Consumer scope:** \"Unlocks\" lists flag consumers found in the **step-VM "
         "`cond` gates** (`story_steps.json`) + the chapter ladder + HANDOFF targets. "
         "Flags read by a **per-stage overlay handler** (e.g. s200's `get_flag(0x400d)` "
         "pre/post select, or `0x7401` read by wstag420/wstag376) are NOT in this dataset, "
         "so some events legitimately show \"no downstream consumer decoded\" even though a "
         "handler reads their flag. That is a dataset boundary, not an absence.\n",
         "\n> **Gate nature:** each `get_flag` requirement is tagged with its decoded "
         "**bank** source (`get-flag-banked-predicate-system.md`). Banks `0x00–0x40` are "
         "**stored bits**; banks `0x60+` are **VIRTUAL** — computed each call "
         "(current-context test, table scan, roster/item record), so they have **no "
         "setter by design**. Producers for stored bits are resolved two ways: the "
         "step-program `on_complete` sets, **and** every `set_flag` immediate mined from "
         "the whole disassembly (overlays + EXE) by `tools/scan_flag_setters.py` — so a "
         "stored-bit gate that names a producing `wstagNNN` overlay is fully accounted "
         "for. The only stored bits still without a located producer are the handful with "
         "**no `set_flag` callsite anywhere** (set via the `F0x80016988` table applier, "
         "whose caller is unresolved, or by a gameplay subsystem).\n"]
    for r in regions:
        L.append(f"\n## {region_label(r)} (`{hx(r)}`)\n")
        for m in events_by_region[r]:
            fk = m["flag_key"]
            trig = triggers_by_event.get(fk)
            L.append(f"\n### s{m['stage']} entry {m['entry']} — «{m['label']}»\n")
            L.append(f"- **flag_key:** `{fk}`  (region {hx(r)}, entry {m['entry']})"
                     + ("  ⚠️ esdmg entry approximate" if m["esdmg_approx"] else ""))
            L.append(f"- **Location:** s{m['stage']} — {stage_name(m['stage'])}")
            # requirements
            req = []
            if trig:
                if trig["cond"] not in UNCOND:
                    req.append(f"`get_flag({hx(trig['cond'])})` [{flag_nature(trig['cond'])}] "
                               f"— gate on the step-VM trigger in s{trig['stage']}")
                    for o in flag_origin(trig["cond"]):
                        req.append(f"  ← produced by {o}")
                    if not flag_origin(trig["cond"]):
                        if "VIRTUAL" in flag_nature(trig["cond"]):
                            req.append("  ← VIRTUAL predicate (computed at runtime — no setter exists by design)")
                        else:
                            req.append("  ← stored bit with NO `set_flag` callsite anywhere in the "
                                       "disassembly (EXE + all overlays, immediate or computed — "
                                       "verified by `tools/scan_flag_setters.py`). Set only via the "
                                       "table applier `F0x80016988` (no resolved caller) or a gameplay "
                                       "subsystem — see bank note.")
                else:
                    req.append(f"position trigger in s{trig['stage']} (step-VM, unconditional)")
            else:
                req.append("talk-triggered / per-stage handler (no op8 step gate found)")
            L.append("- **Requirements:**")
            for x in req:
                L.append(f"    - {x}")
            # trigger
            if trig:
                L.append(f"- **Trigger:** step-VM `start_event` in s{trig['stage']} "
                         f"(walk into the type-7 trigger region"
                         + (f", gated on {hx(trig['cond'])}" if trig["cond"] not in UNCOND else "")
                         + ")")
            else:
                L.append("- **Trigger:** interaction / per-stage overlay handler")
            # participants
            parts = []
            for a in m["actors"]:
                who = {1: "player", 2: "partner"}.get(a, f"NPC actor {a}")
                parts.append(who)
            if m["effects"]:
                parts.append("effects " + ",".join(str(e) for e in m["effects"]))
            L.append(f"- **Participants:** {', '.join(parts) or '—'}")
            # sets
            sets = m["sets"]
            L.append("- **Sets:** " + (", ".join(f"`{hx(f)}`={v}" for f, v in sets) or "—"))
            # unlocks
            unl = []
            for sid, dest in m["handoffs"]:
                unl.append(f"map transition → s{dest} ({stage_name(dest)})" if dest
                           else f"map transition → screen {sid}")
            for f, v in sets:
                cons = consumers.get(f, [])
                for cstg, role in cons:
                    unl.append(f"`{hx(f)}` enables {role} in s{cstg}")
                if f in LADDER:
                    unl.append(f"`{hx(f)}` advances chapter → {LADDER[f]}")
            L.append("- **Unlocks:**")
            if unl:
                for x in unl:
                    L.append(f"    - {x}")
            else:
                L.append("    - (no downstream flag consumer or handoff decoded)")
    write_doc("EVENT_DEPENDENCIES.md", L)


# ══════════════════════════════════════════════════════════════════════════════
# 3. MAP_PROGRESS_STATES.md   (n-field chapter states + flag-gated spawns)
# ══════════════════════════════════════════════════════════════════════════════
def emit_map_states():
    L = ["# Map Progress States\n", GEN_NOTE,
         "\nFor each story-relevant map: the **chapter states** (NPC spawn variants "
         "selected by `n`-field: a record is active when `chapter >= n`, max-n-per-slot "
         "wins), the events available on the map, and any **flag-gated step spawns** "
         "(op1 with a `get_flag` cond). Maps with no n-variants and no events are "
         "omitted.\n"]
    for sid in sorted(scenes, key=lambda s: (len(s), s)):
        stg = sid[1:]
        sc = scenes[sid]
        npcs = sc.get("npcs", [])
        ns = sorted({n.get("n") for n in npcs if n.get("n") not in (None, 1)})
        evs = events_by_stage.get(stg, [])
        gated_spawns = [s for s in spawn_states.get(stg, []) if s["cond"] not in UNCOND]
        if not ns and not evs and not gated_spawns:
            continue
        L.append(f"\n## MAP: s{stg} — {stage_name(stg)}\n")
        # chapter states
        thresholds = [1] + ns
        for ci, th in enumerate(thresholds):
            vis = collections.defaultdict(list)
            for n in npcs:
                nn = n.get("n", 1)
                if nn is not None and nn <= th:
                    vis[n.get("slot")].append(n)
            shown = []
            for slot, recs in vis.items():
                best = max(recs, key=lambda r: r.get("n", 0))
                shown.append(f"slot {slot}: npc {best.get('npc_id')} ({best.get('sprite')})")
            L.append(f"### STATE chapter ≥ {th}")
            L.append("Requirements:")
            L.append(f"- chapter >= {th}"
                     + ("" if th == 1 else f"  (milestone flag for ch{th})" if th in (3, 5, 6, 7) else ""))
            L.append("NPCs visible:")
            for s in sorted(shown):
                L.append(f"- {s}")
            if not shown:
                L.append("- (none)")
            L.append("")
        # events available
        if evs:
            L.append("Events available on this map:")
            for m in sorted(evs, key=lambda m: m["entry"]):
                trig = triggers_by_event.get(m["flag_key"])
                g = (f" [gate {hx(trig['cond'])}]" if trig and trig["cond"] not in UNCOND else "")
                L.append(f"- entry {m['entry']} «{m['label']}»{g}")
        if gated_spawns:
            L.append("\nFlag-gated step spawns (story-state actors):")
            for s in gated_spawns:
                L.append(f"- npc {s['npc_id']} at ({s['x']},{s['y']}) — requires "
                         f"get_flag({hx(s['cond'])}) [{flag_nature(s['cond'])}]")
    write_doc("MAP_PROGRESS_STATES.md", L)


# ══════════════════════════════════════════════════════════════════════════════
# 4. NPC_AND_DIALOGUE_STATE_CHANGES.md  (NPCs with >1 n-variant per slot)
# ══════════════════════════════════════════════════════════════════════════════
def emit_npc_states():
    L = ["# NPC & Dialogue State Changes\n", GEN_NOTE,
         "\nOnly NPCs whose presence/identity changes with story progression: a map "
         "slot carrying **multiple `n`-field variants** (the engine swaps which record "
         "is live as `chapter` crosses each `n`). Each variant is a distinct "
         "story-state of that slot.\n"]
    any_rows = False
    for sid in sorted(scenes, key=lambda s: (len(s), s)):
        stg = sid[1:]
        sc = scenes[sid]
        by_slot = collections.defaultdict(list)
        for n in sc.get("npcs", []):
            if n.get("slot") is not None:
                by_slot[n["slot"]].append(n)
        multi = {s: recs for s, recs in by_slot.items()
                 if len({r.get("n", 1) for r in recs}) > 1}
        if not multi:
            continue
        any_rows = True
        L.append(f"\n## s{stg} — {stage_name(stg)}\n")
        for slot, recs in sorted(multi.items()):
            recs = sorted(recs, key=lambda r: r.get("n", 1))
            L.append(f"### NPC slot {slot}")
            for i, r in enumerate(recs, 1):
                L.append(f"State {i} — Requirements: chapter >= {r.get('n', 1)}")
                L.append(f"- npc_id {r.get('npc_id')}  sprite {r.get('sprite')}  "
                         f"at ({r.get('x')},{r.get('y')})")
                dl = r.get("dialogues") or ([r["dialogue"]] if r.get("dialogue") else [])
                if dl:
                    L.append(f"- dialogue: {resolve_dialogue(dl[0])}")
            L.append("")
    if not any_rows:
        L.append("\n(No multi-variant NPC slots found in the current scene data.)\n")
    write_doc("NPC_AND_DIALOGUE_STATE_CHANGES.md", L)


# ══════════════════════════════════════════════════════════════════════════════
# 5. CUTSCENE_DEPENDENCIES.md   (per-event bytecode mechanics)
# ══════════════════════════════════════════════════════════════════════════════
def emit_cutscenes():
    L = ["# Cutscene Dependencies\n", GEN_NOTE,
         "\nEach decoded cutscene (wstag event bytecode): its trigger state, the sprites "
         "it animates, the movements/teleports/facing it issues, and the flags it "
         "requires vs sets. Sourced from the event `disasm` (the field interpreter "
         "opcodes SETPOS/WALKTO/SETANIM/SAY/HANDOFF).\n"]
    for r in regions:
        L.append(f"\n## {region_label(r)} (`{hx(r)}`)\n")
        for m in events_by_region[r]:
            fk = m["flag_key"]
            trig = triggers_by_event.get(fk)
            L.append(f"\n### CUTSCENE s{m['stage']} entry {m['entry']} — «{m['label']}»\n")
            L.append(f"- **Location:** s{m['stage']} — {stage_name(m['stage'])}")
            req = (f"`get_flag({hx(trig['cond'])})`" if trig and trig["cond"] not in UNCOND
                   else "(none decoded)")
            L.append(f"- **Flags required:** {req}")
            if trig:
                L.append(f"- **Trigger:** step-VM start_event in s{trig['stage']} "
                         "(walk into type-7 trigger region)")
            else:
                L.append("- **Trigger:** talk / per-stage handler")
            sprites = []
            for a in m["actors"]:
                sprites.append({1: "player(1)", 2: "partner(2)"}.get(a, f"actor {a}"))
            sprites += [f"effect {e}" for e in m["effects"]]
            L.append(f"- **Participants (sprites):** {', '.join(sprites) or '—'}")
            # animation summary
            mov = [a for a in m["anims"] if a.startswith("WALKTO")]
            fac = [a for a in m["anims"] if a.startswith("SETANIM")]
            tp = [d for d in m["disasm"] if d.startswith("SETPOS")]
            L.append("- **Animations / movement:**")
            L.append(f"    - teleports (SETPOS): {len(tp)}")
            L.append(f"    - walks (WALKTO): {len(mov)}")
            L.append(f"    - anim/facing (SETANIM): {len(fac)}")
            if m["handoffs"]:
                hs = ", ".join(f"s{d}" if d else f"screen {s}" for s, d in m["handoffs"])
                L.append(f"    - HANDOFF → {hs}")
            L.append("- **Flags set:** " + (", ".join(f"`{hx(f)}`={v}" for f, v in m["sets"]) or "—"))
    write_doc("CUTSCENE_DEPENDENCIES.md", L)


def _gate_str(cond, arg):
    """Render a step/event get_flag gate as a readable requirement."""
    if cond in UNCOND:
        return "always (no flag gate)"
    pol = "SET" if arg else "CLEAR"
    return f"`get_flag({hx(cond)})=={arg}`  ({pol}; {flag_nature(cond)})"


def cond_label(c):
    """Render one {id,expected} spawn condition readably, decoding bank 0x60 as a
    progress-ordinal test (§WS4.6) and bank 0x00 as a story flag."""
    fid, exp = c["id"], c["expected"]
    bank = (fid >> 8) & 0xfe
    if bank == 0x60:
        op = "==" if exp else "!="
        return f"ordinal {op} {beat_label(fid & 0x1ff)}"
    if bank == 0x70:
        lbl = roster_pred_label(fid)
        return lbl if exp else f"NOT ({lbl})"
    if 0x80 <= bank <= 0x92:
        return f"collection[{hx(fid & 0x1ff)}] {'obtained' if exp else 'NOT obtained'}"
    return f"flag `{hx(fid)}` {'SET' if exp else 'CLEAR'}"


def _spawn_gate_summary(stage):
    """Compact summary of flag-gated NPC spawns at a stage (record+0x0 flag-lists,
    §WS4.9), read from the generated scene JSON's `spawn_flags`."""
    sc = scenes.get(f"s{stage}")
    if not sc:
        return []
    rows = []
    for n in sc.get("npcs", []):
        sf = n.get("spawn_flags")
        if not sf:
            continue
        conds = " AND ".join(cond_label(c) for c in sf)
        rows.append((n.get("npc_id"), n.get("sprite", "?"), conds))
    return rows


def emit_walkthrough():
    """The literal play-order guide: every story beat in [0x8004b370] ordinal order,
    with the gate that reaches it, the cutscenes that fire (+ their flag gates, text,
    flags set, handoff), the chapter rung, and the flag-gated NPCs present."""
    L = ["# Game Walkthrough — the literal progression spine\n", GEN_NOTE,
         "\nThis is the **play-order** guide: the master story-progress ordinal "
         "`[0x8004b370]` (decoded in `field-script-engine-verified.md` §WS4.6, extracted by "
         "`tools/extract_progress_ordinal.py`) is a single linear counter — each beat's overlay "
         "writes its own value on completion, and the next stage's entry handler gates on "
         "`b370 == predecessor`. Walking the ordinal in order = walking the game. For each beat: "
         "the gate that admits it, the cutscene events it fires (with their own `get_flag` gates, "
         "first line of dialogue, flags set, and HANDOFF to the next map), the chapter rung, and "
         "the flag-gated NPCs that populate the map (`spawn_flags`, §WS4.9). Side/branch stages "
         "with no ordinal write are listed after the spine.\n"]

    # chapter rung lookup: milestone flag -> chapter number + stage
    rung_by_flag = {r["flag"]: r for r in chapters.get("ladder", [])}

    # ── overview table ──
    L.append("## Spine overview\n")
    L.append("| `b370` | stage | name | fires | → next |")
    L.append("|----|----|----|----|----|")
    spine = ordinal.get("ladder", [])
    for beat in spine:
        stg = beat["stage"]
        evs = events_by_stage.get(str(stg), [])
        nh = []
        for m in evs:
            nh += [f"s{d}" for _, d in m["handoffs"] if d]
        nxt = ", ".join(dict.fromkeys(nh)) or "—"
        L.append(f"| `0x{beat['ordinals'][0]:02x}` | s{stg} | {stage_name(stg)} | "
                 f"{len(evs)} event(s) | {nxt} |")

    L.append("\n## Chapter rungs (NPC-variant gate)\n")
    for r in chapters.get("ladder", []):
        L.append(f"- **Chapter {r['chapter']}** ← `{r['flag_hex']}` set at "
                 f"**{r['milestone']}**")

    # ── per-beat detail ──
    L.append("\n---\n\n## The spine, beat by beat\n")
    prev = None
    for beat in spine:
        stg = beat["stage"]
        ords = beat["ordinals"]
        marks = "/".join(f"0x{x:02x}" for x in ords)
        L.append(f"\n### `b370 = 0x{ords[0]:02x}` — s{stg} · {stage_name(stg)}\n")
        if prev is not None:
            L.append(f"- **Reached when** `[0x8004b370] == 0x{prev[0]:02x}` "
                     f"(after s{prev[1]}).")
        else:
            L.append("- **Start of the spine** (new-game opening).")
        L.append(f"- **On completion writes** `[0x8004b370] = {marks}`"
                 + ("  *(revisited at a later phase too)*" if len(ords) > 1 else "") + ".")
        # chapter rung set here?
        evs = events_by_stage.get(str(stg), [])
        for m in evs:
            for fid, val in m["sets"]:
                if fid in rung_by_flag and val:
                    r = rung_by_flag[fid]
                    L.append(f"- **➜ CHAPTER {r['chapter']}** unlocked here "
                             f"(sets `{r['flag_hex']}`).")
        # events
        if evs:
            L.append("- **Cutscene events:**")
            for m in sorted(evs, key=lambda m: m["entry"]):
                trig = triggers_by_event.get(m["flag_key"])
                gate = (_gate_str(trig["cond"], trig["arg"]) if trig
                        else "talk / per-stage handler")
                L.append(f"    - **entry {m['entry']}** «{m['label']}»")
                L.append(f"        - gate: {gate}")
                if m["sets"]:
                    L.append("        - sets: "
                             + ", ".join(f"`{hx(f)}`={v}" for f, v in m["sets"]))
                if m["handoffs"]:
                    hs = ", ".join(f"s{d}" if d else f"screen {s}"
                                   for s, d in m["handoffs"])
                    L.append(f"        - → HANDOFF {hs}")
        else:
            L.append("- *(no decoded cutscene events at this stage — "
                     "ordinal advanced by its overlay handler)*")
        # flag-gated NPCs
        rows = _spawn_gate_summary(stg)
        if rows:
            L.append(f"- **Flag-gated NPCs ({len(rows)} spawn records):**")
            for nid, sprite, conds in rows[:8]:
                L.append(f"    - npc {nid} ({sprite}) — spawn iff {conds}")
            if len(rows) > 8:
                L.append(f"    - …and {len(rows) - 8} more "
                         f"(see `MAP_PROGRESS_STATES.md` / `scenes/s{stg}.json`).")
        prev = (ords[0], stg)

    # ── side stages (events but no ordinal write) ──
    spine_stages = {str(b["stage"]) for b in spine}
    side = sorted((s for s in events_by_stage if s not in spine_stages),
                  key=lambda s: int(s))
    L.append("\n---\n\n## Branch / side stages (gated content, no ordinal write)\n")
    L.append("These stages host decoded cutscene events but do not advance the master "
             "ordinal — they are side beats reached off the spine (gated by their own "
             "flags). Full detail in `EVENT_DEPENDENCIES.md`.\n")
    for s in side:
        evs = events_by_stage[s]
        labels = "; ".join(f"e{m['entry']} «{m['label'][:40]}»" for m in evs[:3])
        more = f" +{len(evs) - 3} more" if len(evs) > 3 else ""
        L.append(f"- **s{s}** {stage_name(s)} — {len(evs)} event(s): {labels}{more}")

    write_doc("GAME_WALKTHROUGH.md", L)


if __name__ == "__main__":
    emit_story_progression()
    emit_event_dependencies()
    emit_map_states()
    emit_npc_states()
    emit_cutscenes()
    emit_walkthrough()
    print(f"events: {len(EVENTS)} · regions: {len(regions)} · "
          f"flags produced: {len(producers)} · flags consumed: {len(consumers)} · "
          f"op8 triggers: {len(triggers_by_event)}")
    print("wrote 5 docs to", OUT)
