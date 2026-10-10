"""
Auto-extract scripted STORY-BATTLE descriptors from the bytecode wstag overlays.

This is the bulk-automation pass for `tools/engine-convert/scripted-battles.ts`
(`SCRIPTED_BATTLES`), which was hand-authored one stage at a time (only s200 wired).
It covers every stage that uses the BYTECODE event system (123 of 294 overlays);
the native-controller stages (s200 X-press trigger excepted, s465 gondola, …) carry
their battle trigger in hand-written MIPS and need the m2c decompile pass instead.

What this recovers automatically, per the s200 keystone (battle-invocation.md):
  - the PRE / POST event pair (a SAY-bearing event that ARMS a banked flag in its
    on_complete fn, followed by an event that HANDOFFs to the next screen),
  - `armFlag`   = the get_flag-banked flag the PRE event's on_complete sets,
  - `preFlagKey`/`postFlagKey` = the two events' flag_keys (= esdmg entry indices),
  - `actor`     = the non-player NPC that speaks in the PRE event,
  - `handoff_to`= the POST event's HANDOFF destination stage.

What it CANNOT recover from bytecode (left null / as a candidate pool):
  - `screenId`  = the battle's enemy-party screen. The battle is invoked by the
    native per-stage trigger (scene_ctx+0x18, fn 0x800927a0), not by a bytecode op,
    so the screen id lives in native code / the trigger records. We attach the
    stage's random-encounter pool (stage_encounters.json) as the candidate set.
  - `wonFlag`   = a SYNTHETIC walker marker (engine bank 0x12); not in the ROM.

The on_complete flag decode reads RAW MIPS words from the overlay bytes (no text
parsing): it tracks immediate-building (lui/ori/addiu), recognises the exe flag API
base 0x80048abc, and emits set_flag(id,val) for every `jalr [base+0xc]` (get_flag is
+0x10). Delay slots are applied before the call is recorded (MIPS semantics).

Usage:
  python tools/extract_scripted_battles.py s200            # one stage, JSON
  python tools/extract_scripted_battles.py --all           # all bytecode stages
  python tools/extract_scripted_battles.py --all --stats   # summary to stderr
  python tools/extract_scripted_battles.py --all --output web/assets/data/scripted_battles.json
"""

import json
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wstag_events as W  # noqa: E402

FLAG_API_BASE = 0x80048ABC  # exe flag API struct; +0xc=set_flag(id,v), +0x10=get_flag(id,0)
_DATA = Path(__file__).resolve().parent.parent / "web/assets/data"
STAGE_ENCOUNTERS = _DATA / "stage_encounters.json"
FIELD_ENCOUNTERS = _DATA / "field_encounters.json"
EVENTS_DIR = _DATA.parent / "events"   # esdmgNNN.json (cutscene strings)

# An "arm" flag is a get_flag-banked progress flag (high nibble 4/7 in the 16-bit id),
# as opposed to a UI/scratch flag. s200 arms 0x400d (and fires the 0x7401 launcher).
_ARM_FLAG_MASK = 0xF000

# Bank 0x74 = the SCRIPTED-BATTLE LAUNCHER, not a bit array (ARENA-C011, decompiled
# set_flag dispatcher F0x800165ac: `if (var_s1 == 0x74) D0x8009b6a4(temp_s0);` — it calls
# the fieldstg routine with the id's low bits and DISCARDS the written value). That
# routine starts the current stage's scripted (rate-0) encounter record of that index.
# So a pre-fight event's on_complete firing set_flag(0x74NN) IS the battle invocation,
# and NN resolves the enemy party that bytecode alone cannot name.
_LAUNCH_BANK = 0x74

# Stored (bit-array) banks, from the set_flag dispatcher's F0x800155d4 arms — the same
# set engine/dw3/dw3-config.ts DW3_BANK_SCHEME.storedBanks carries. A candidate's arm
# flag must live in one of these, or the walker has nothing to gate PRE -> battle on.
_STORED_BANKS = frozenset({0x00, 0x02, 0x04, 0x06, 0x08, 0x0A, 0x0C, 0x0E,
                           0x10, 0x18, 0x1A, 0x1C, 0x20, 0x40})


def _bank(flag_id: int) -> int:
    return (flag_id >> 8) & 0xFE


def _launcher(setflags: list[dict]) -> dict | None:
    """The bank-0x74 write in an on_complete hook, or None.

    Exactly one, or nothing: the decoder walks the hook LINEARLY and does not follow
    branches, so two launcher writes in one hook may be the two arms of a conditional
    and taking either would be a guess. No hook in the shipped catalog has two, so this
    is a guard, not a live path — the count is asserted in the tests.
    """
    launches = [c for c in setflags if c["id"] and _bank(c["id"]) == _LAUNCH_BANK]
    return launches[0] if len(launches) == 1 else None


# ---------------------------------------------------------------------------
# on_complete native-fn flag decode (raw MIPS)
# ---------------------------------------------------------------------------

def decode_setflags(data: bytes, fn_off: int, limit: int = 400) -> list[dict]:
    """Decode set_flag(id, val) calls made by the native fn at byte `fn_off`.

    Returns [{"id": int, "val": int}], in call order. Stops at `jr $ra` or limit.
    """
    if fn_off <= 0 or fn_off + 4 > len(data):
        return []
    regval: dict[int, int] = {}   # reg -> computed integer value
    regrole: dict[int, str] = {}  # reg -> 'setflag' | 'getflag'
    calls: list[dict] = []

    def apply(w: int) -> None:
        op = (w >> 26) & 0x3F
        rs = (w >> 21) & 0x1F
        rt = (w >> 16) & 0x1F
        imm = w & 0xFFFF
        simm = imm - 0x10000 if imm >= 0x8000 else imm
        if op == 0x0F:        # lui rt, imm
            regval[rt] = imm << 16
            regrole.pop(rt, None)
        elif op == 0x09:      # addiu rt, rs, simm
            regval[rt] = ((regval.get(rs, 0) if rs else 0) + simm) & 0xFFFFFFFF
            regrole.pop(rt, None)
        elif op == 0x0D:      # ori rt, rs, imm
            regval[rt] = (regval.get(rs, 0) if rs else 0) | imm
            regrole.pop(rt, None)
        elif op == 0x23:      # lw rt, imm(rs)
            if regval.get(rs) == FLAG_API_BASE and imm == 0xC:
                regrole[rt] = "setflag"
            elif regval.get(rs) == FLAG_API_BASE and imm == 0x10:
                regrole[rt] = "getflag"
            else:
                regrole.pop(rt, None)
            regval.pop(rt, None)

    pc = fn_off
    for _ in range(limit):
        if pc + 4 > len(data):
            break
        w = struct.unpack_from("<I", data, pc)[0]
        if w == 0x03E00008:   # jr $ra
            break
        if (w >> 26) == 0 and (w & 0x3F) == 0x09:  # jalr rs
            rs = (w >> 21) & 0x1F
            if pc + 4 <= len(data):                 # apply delay slot first (MIPS)
                apply(struct.unpack_from("<I", data, pc + 4)[0])
            if regrole.get(rs) == "setflag":
                calls.append({"id": regval.get(4), "val": regval.get(5)})
        else:
            apply(w)
        pc += 4
    return [c for c in calls if c["id"] is not None]


# ---------------------------------------------------------------------------
# Per-stage extraction
# ---------------------------------------------------------------------------

def _say_actors(disasm: list[str]) -> list[int]:
    """Non-player speakers (actor id >= 3) in SAY ops, in order, de-duped."""
    out: list[int] = []
    for op in disasm:
        if op.startswith("SAY "):
            actor = int(op.split()[3])
            if actor >= 3 and actor not in out:
                out.append(actor)
    return out


def _stage_zones(stage: str) -> list[dict]:
    if not STAGE_ENCOUNTERS.exists():
        return []
    se = json.loads(STAGE_ENCOUNTERS.read_text()).get("stages", {})
    rec = se.get(stage) or se.get(stage.lstrip("s"))
    return (rec or {}).get("zones", [])


def _load_stage_pool(stage: str) -> list[int]:
    screens: list[int] = []
    for zone in _stage_zones(stage):
        for s in zone.get("slots", []):
            if s and s not in screens:
                screens.append(s)
    return screens


def _scripted_block(stage: str) -> list[int] | None:
    """The stage's SCRIPTED (rate-0) encounter block — the 8 records the bank-0x74
    launcher indexes (ARENA-C011/C012).

    It is the 4th zone of the selector record stored to scene_struct+0x20, i.e.
    descriptor +0x18 (`zones[]` is group-major/zone-minor, 4 blocks per selector
    record — see tools/extract_stage_encounters.py). Its leading rate word is zero, so
    the roaming encounter driver can never select it; only a script can.

    Returns None for a stage with more than one selector group: which group is live
    depends on the story ordinal or the runtime key, and picking one would be a guess.
    """
    zones = _stage_zones(stage)
    if len(zones) != 4:                      # 0 = no blocks; >4 = multiple selector groups
        return None
    block = zones[3]
    if block.get("rate_level") != 0:         # not the scripted block after all
        return None
    return list(block.get("slots", []))


_SCREEN_PARTY: dict[str, list[dict]] | None = None


def _screen_lead(screen: int) -> tuple[int, str] | None:
    """Lead (id, name) of a field-encounter screen's party, or None."""
    global _SCREEN_PARTY
    if _SCREEN_PARTY is None:
        _SCREEN_PARTY = (json.loads(FIELD_ENCOUNTERS.read_text()).get("screens", {})
                         if FIELD_ENCOUNTERS.exists() else {})
    party = _SCREEN_PARTY.get(str(screen))
    if not party:
        return None
    return party[0]["id"], party[0]["name"]


_SPEAKER_RE = re.compile(r"\[name\]([^\[]*)\[name\]")
_ESDMG_CACHE: dict[str, dict] = {}


def _esdmg_speakers(esdmg_stage, esdmg_entry) -> list[str]:
    """Non-player speaker names in a cutscene entry's strings (the `[name]X[name]`
    labels; the player uses `[player_name]`, which this regex skips). Used to name the
    boss for screenId resolution. Returns [] if the esdmg file/entry is absent."""
    if esdmg_stage is None or esdmg_entry is None:
        return []
    doc = _ESDMG_CACHE.get(esdmg_stage)
    if doc is None:
        p = EVENTS_DIR / f"esdmg{esdmg_stage}.json"
        doc = json.loads(p.read_text()) if p.exists() else {}
        _ESDMG_CACHE[esdmg_stage] = doc
    entry = doc.get(str(esdmg_entry)) or {}
    out: list[str] = []
    for s in entry.get("strings", []):
        for nm in _SPEAKER_RE.findall(s):
            if nm and nm != "player_name" and nm not in out:
                out.append(nm)
    return out


def _next_key(flag_key: str) -> str:
    """The flag_key of the next esdmg entry (region<<16 | entry); entry+1."""
    return f"{int(flag_key, 16) + 1:08x}"


def _norm_name(name: str) -> str:
    """Lowercase, drop non-alphanumerics, strip a trailing 'mon' so dialogue's
    truncated 'MasterTyranno' matches the roster's 'MasterTyrannomon'."""
    s = re.sub(r"[^a-z0-9]", "", name.lower())
    return s[:-3] if s.endswith("mon") and len(s) > 3 else s


def _resolve_screen_by_name(pool: list[int], names) -> int | None:
    """The one pool screen whose LEAD enemy matches a boss `name` from the dialogue.

    Resolves the native-trigger-bound screenId without a RAM trace (battle-invocation.md):
    the stage's trigger pool is `pool`; the boss is named in the PRE/POST esdmg cutscene.
    Match is on the normalised name (so 'MasterTyranno' == 'MasterTyrannomon'). Returns the
    screen only on a UNIQUE match; 0 or >=2 matches -> None (never guess)."""
    wanted = {_norm_name(n) for n in names if n}
    if not wanted:
        return None
    hits = set()
    for s in pool:
        lead = _screen_lead(s)
        if lead and _norm_name(lead[1]) in wanted:
            hits.add(s)
    return next(iter(hits)) if len(hits) == 1 else None


def _resolve_screen(pool: list[int]) -> dict | None:
    """HEURISTIC enemy hint for a scripted battle, from the stage's random pool.

    Scripted battles reuse a screen that is also in the stage's random pool (verified:
    s200 Genji = screen 200 ∈ pool; s545 Bulbmon ∈ pool). When EVERY pool screen with a
    known party shares ONE lead enemy, that enemy is a high-confidence hint for the
    scripted fight (e.g. s545 pool [12,315] = both Bulbmon). The exact screen is soft
    (same-enemy screens are near-equivalent), so it is offered as `screenIdHint`, never
    as a verified `screenId`. When the pool has multiple distinct enemies (s200), we do
    NOT guess — `screenId`/hint stay null, to be pinned by hand or the native trigger.

    NB: this never fires on the one ground-truth case (s200 declines), so all hints are
    unverified by construction — treat as leads, not facts."""
    leads = [(s, _screen_lead(s)) for s in pool]
    leads = [(s, ld) for s, ld in leads if ld is not None]
    if not leads:
        return None
    enemy_ids = {ld[0] for _, ld in leads}
    if len(enemy_ids) == 1:
        s, (eid, name) = leads[0]
        return {"screenIdHint": s, "enemyId": eid, "enemyName": name, "ambiguous": False}
    return {"screenIdHint": None, "ambiguous": True,
            "candidates": [{"screen": s, "enemyId": ld[0], "enemyName": ld[1]}
                           for s, ld in leads]}


def extract_stage(stage: str) -> dict | None:
    data = W.overlay_bytes(stage)
    if data is None:
        return None
    W._SCREEN_TABLE = W._SCREEN_TABLE or W._load_screen_table()
    events = W.extract_stage(stage)  # adds disasm, esdmg_entry, handoff_to
    if not events:
        return None

    # Attach on_complete set_flags + speakers to each event.
    for ev in events:
        ev["on_complete_setflags"] = decode_setflags(data, ev["on_complete_fn"])
        ev["say_actors"] = _say_actors(ev["disasm"])

    # Derive battle candidates: a PRE event whose on_complete ARMS a banked flag (0x4xxx)
    # or FIRES the bank-0x74 scripted-battle launcher, paired with the next HANDOFF-bearing
    # event (the post-battle transition). A battle is signalled either by an NPC challenger
    # (an actor >= 3 speaks — Genji/Suzaku) OR by a post-battle HANDOFF (player-monologue
    # triggers, e.g. s545 Bulbmon). screenId comes from the launcher when the hook fires one
    # (authoritative), else from an unambiguous boss-name match against the stage pool.
    pool = _load_stage_pool(stage)
    block = _scripted_block(stage)
    resolved = _resolve_screen(pool)
    by_key = {e["flag_key"]: e for e in events}
    candidates = []
    consumed: set[int] = set()   # id()s of events already taken as a POST
    for i, pre in enumerate(events):
        if id(pre) in consumed:
            continue               # this event is the POST half of an earlier battle
        arm = [c for c in pre["on_complete_setflags"]
               if c["id"] and (c["id"] & _ARM_FLAG_MASK) == 0x4000]
        launch = _launcher(pre["on_complete_setflags"])
        if not arm and launch:
            # The hook starts a fight but arms no 0x4xxx progress flag — the arena finale
            # arms 0x100c (ARENA-C010), which the old 0x4xxx-only rule dropped on the floor,
            # leaving the challenge and the victory line with no battle between them. Any
            # stored-bank flag the same hook sets can gate PRE -> battle just as well.
            arm = [c for c in pre["on_complete_setflags"]
                   if c["id"] and _bank(c["id"]) in _STORED_BANKS]
        if not arm:
            continue
        # POST = the post-battle event: prefer the next HANDOFF-bearing event (the
        # transition, e.g. s200 -> s220); else the consecutive-entry event (flag_key+1,
        # the reward cutscene) for bosses that END in place (e.g. s405 MasterTyranno).
        post = next((e for e in events[i + 1:] if e.get("handoff_to")), None)
        if post is None:
            post = by_key.get(_next_key(pre["flag_key"]))
        npc = pre["say_actors"][0] if pre["say_actors"] else None
        if npc is None and post is None:
            continue   # no challenger and no post-transition => not a battle chain
        if post is not None:
            consumed.add(id(post))
        # Resolve the native-trigger-bound screenId by matching the boss named in the
        # PRE/POST cutscene against the stage pool (battle-invocation.md); else null.
        boss_names = (_esdmg_speakers(pre.get("esdmg_stage"), pre.get("esdmg_entry"))
                      + (_esdmg_speakers(post.get("esdmg_stage"), post.get("esdmg_entry"))
                         if post else []))
        # The launcher WINS: it is the invocation itself, read out of the hook that runs,
        # where the name match is an inference from who speaks in the cutscene. Slot ->
        # record NN of the scripted block. A slot holding 0 is an empty record, so it
        # resolves nothing and the name match is left to try.
        slot = (launch["id"] & 0x1FF) if launch else None
        screen_id = None
        resolution = None
        if slot is not None and block and slot < len(block) and block[slot]:
            screen_id = block[slot]
            resolution = f"bank74-launcher:0x{launch['id']:x} slot {slot}"
        if screen_id is None:
            screen_id = _resolve_screen_by_name(pool, boss_names)
            resolution = ("name-match:" + ",".join(boss_names)) if screen_id is not None else None
        cand = {
            "actor": npc,                       # None = player-triggered (monologue)
            "trigger": "npc" if npc is not None else "player",
            "armFlag": arm[0]["id"],
            "armFlagHex": f"0x{arm[0]['id']:x}",
            "launchFlag": launch["id"] if launch else None,
            "launchSlot": slot,
            "preFlagKey": pre["flag_key"],
            "preEsdmgEntry": pre.get("esdmg_entry"),
            "postFlagKey": post["flag_key"] if post else None,
            "postEsdmgEntry": post.get("esdmg_entry") if post else None,
            "handoff_to": post.get("handoff_to") if post else None,
            # screenId from the bank-0x74 launcher (authoritative) else boss-name ∩ pool
            # (null when no/ambiguous match); the pool also gives a softer HEURISTIC hint.
            "screenId": screen_id,
            "screenIdResolution": resolution,
            "screenIdHint": resolved.get("screenIdHint") if resolved else None,
            "enemyHint": resolved.get("enemyName") if resolved else None,
            "screenId_ambiguous": bool(resolved and resolved.get("ambiguous")),
            "screenId_pool": pool,              # candidate screens (native-trigger-bound)
        }
        candidates.append(cand)

    return {"events": events, "battle_candidates": candidates}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    args = sys.argv[1:]
    do_all = "--all" in args
    do_stats = "--stats" in args
    output = None
    if "--output" in args:
        output = Path(args[args.index("--output") + 1])

    if do_all:
        stages = W._all_stages()
    else:
        stages = [a.lstrip("s") if a[:1] == "s" and a[1:].isdigit() else a
                  for a in args if not a.startswith("--")]
        if "--output" in args and output is not None:
            stages = [s for s in stages if s != output.name and s != str(output)]
    if not stages:
        print(__doc__, file=sys.stderr)
        sys.exit(0)

    W._SCREEN_TABLE = W._load_screen_table()
    results: dict[str, dict] = {}
    n_cand = 0
    for s in stages:
        r = extract_stage(s)
        if r is None:
            continue
        if r["battle_candidates"] or do_all:
            results[f"s{s}"] = r
            n_cand += len(r["battle_candidates"])

    if do_stats:
        with_cand = [k for k, v in results.items() if v["battle_candidates"]]
        all_c = [(k, c) for k in with_cand for c in results[k]["battle_candidates"]]
        paired = [(k, c) for k, c in all_c if c.get("postFlagKey")]
        resolved = [(k, c) for k, c in all_c if c.get("screenId") is not None]
        print(f"Bytecode stages: {len(results)}  battle candidates: {n_cand}  "
              f"stages with >=1 candidate: {len(with_cand)}", file=sys.stderr)
        print(f"COVERAGE: paired {len(paired)}/{len(all_c)}   "
              f"screenId resolved {len(resolved)}/{len(all_c)}", file=sys.stderr)
        print("  RESOLVED (wireable):", file=sys.stderr)
        for k, c in resolved:
            print(f"    {k}: actor {c['actor']} -> screen {c['screenId']} "
                  f"[{c.get('screenIdResolution')}]", file=sys.stderr)
        print("  UNRESOLVED (frontier):", file=sys.stderr)
        for k, c in all_c:
            if c.get("screenId") is None:
                why = ("unpaired" if not c.get("postFlagKey")
                       else "pool-ambiguous" if c.get("screenId_ambiguous")
                       else "no-name/name-miss")
                print(f"    {k}: actor {c['actor']}  pre {c['preFlagKey']}  "
                      f"post {c['postFlagKey']}  [{why}]", file=sys.stderr)

    out = json.dumps(results, indent=2)
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(out)
        print(f"Wrote {len(results)} stages to {output}", file=sys.stderr)
    else:
        print(out)


if __name__ == "__main__":
    main()
