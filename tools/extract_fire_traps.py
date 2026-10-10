"""
Fire-trap (party-explosion) stage-event controller extractor.

WHAT IT IS.  A dungeon floor trap.  Standing on one of the marked regions of a
stage's type-7 trigger grid starts a stage event whose handler is not bytecode
but a native scene controller built by the overlay itself.  The controller takes
field control away from the player, plays a switch click, and then blows up each
member of the walking party in turn -- an explosion on top of each Digimon, and
that Digimon's stored current HP forced to exactly 1.  It never kills: the whole
party is left on 1 HP and control comes back.  Each trap region is ONE-SHOT; the
event's on_complete sets that region's own gate flag, which its step record tests
for "still clear", so a sprung trap is dead for the rest of the game.

DECODE (original assembly, wstag740/wstag741, 2026-07-28), correlated against the
controlled PCSX-Redux replay in
docs/research/field/captures/fire-dungeon-explosion-state4-2026-07-28.txt.

  event table record   {id, script_ptr=0, flag_key=0, native_fn=C, on_complete=F}
  C  (wstag740 0x800a606c)  constructs a 0x54-byte type-0x0c stage-event object
                            through F0x80014504 with update callback U.
  U  (wstag740 0x800a5de4)  the controller:
        phase 0 - look up field actor group 5, put it in mode 1, play SWITCH02
                  (packed id 0x800410bd), then wait WAIT_TICKS.
        phase i - for each key in the party-actor key table (2, 4, 8): look the
                  actor up, spawn the explosion effect at its (x, y), play
                  COMEX113 (0x800446c9), set the actor to mode 4, and store 1
                  into that party member's stored cur_hp; then wait WAIT_TICKS.
        end     - once the effects are done, release field control; the event
                  framework runs F, which is `set_flag(gate, 1)`.
      The HP write maps the party index through the active-roster slot array at
      0x80048da4 and lands at 0x80048d34 + slot*0x3dc + 0x788, i.e. the SAME
      halfword the replay's write breakpoint caught at 0x800494bc / PC 0x800a5fc0.
  E  (wstag740 0x800a64bc)  constructs a 0x6c-byte effect object at (x, y) with
                            update EU.
  EU (wstag740 0x800a6324)  runs TWO layered sprite components off the overlay's
                            generic {value, holdTicks} animator (the same routine
                            engine/systems/launch-pad.ts documents; this overlay
                            carries the 3-argument one-shot variant, so value 0xff
                            really does end a component).  Each component gets its
                            own y-sort offset, so one layer paints behind the
                            Digimon and one in front.  When both report END the
                            effect destroys itself.

WHAT IS NOT DECODED.  Behaviour with fewer than three walking Digimon (the replay
had three), and whether any stage outside the two Fire Dungeon rooms builds this
controller -- the scan below answers that structurally rather than by assumption.

Output: web/assets/data/fire_traps.json
    { "s740": { "waitTicks", "targetKeys": [...], "sounds": {...},
                "layers": [ {"ysortDy", "program": [[spriteId, holdTicks], ...]} ],
                "traps": [ {"eventId", "stepIndex", "gateFlag"} ] }, ... }

Run: python3 tools/extract_fire_traps.py           (all stages)
     python3 tools/extract_fire_traps.py s740      (specific stages)
"""

import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wstag_events as W

ROOT = Path(__file__).resolve().parent.parent
STEPS = ROOT / "web/assets/data/story_steps.json"
OUT = ROOT / "web/assets/data/fire_traps.json"

BASE = W.OVERLAY_BASE
ALLOC = 0x80014504          # the generic object constructor both ctors call
CONTROLLER_SIZE = 0x54      # `addiu a1, zero, 0x54` in C
CONTROLLER_TYPE = 0x0C      # `addiu a2, zero, 0xc`  in C
EFFECT_SIZE = 0x6C          # `addiu a1, zero, 0x6c` in E
HP_STORE_OFF = 0x788        # `sh rt, 0x788(rs)`     in U -- the cur_hp halfword
SCRIPT_END = 0xFF           # animator value that ENDS a component
SCRIPT_BLANK = 0x12C        # animator value that draws nothing this tick
MAX_SCRIPT = 64             # runaway guard when walking a sprite program


# ---------------------------------------------------------------------------
# Minimal MIPS word reading -- enough to follow constants and calls, no capstone
# ---------------------------------------------------------------------------

def _words(data, off, limit):
    """(offset, word) for `limit` instructions from `off`, stopping after the
    delay slot of the function's `jr $ra`."""
    out = []
    for i in range(off, min(off + limit * 4, len(data) - 4), 4):
        w = struct.unpack_from("<I", data, i)[0]
        out.append((i, w))
        if len(out) >= 2 and out[-2][1] == 0x03E00008:   # jr $ra + delay slot
            break
    return out


def _fields(w):
    op = w >> 26
    return op, (w >> 21) & 31, (w >> 16) & 31, w & 0xFFFF


def _simm(imm):
    return imm - 0x10000 if imm & 0x8000 else imm


def scan(data, off, limit=512):
    """Walk a function, resolving `lui`/`addiu`/`ori` register constants.

    Returns a dict of everything the callers below need:
      consts   [(offset, reg, value)]  every fully built 32-bit constant
      ori      [value]                 constants completed with `ori` -- how this
                                       overlay builds PACKED SOUND IDS, as opposed
                                       to the `addiu`-completed RAM table bases
      tables   [value]                 constants used as an INDEXED table base
                                       (`addu` of an `sll .., 2` then loaded)
      loaded   [value]                 addresses read through a `lw` whose base
                                       register holds a known constant -- how the
                                       effect walks its array of script pointers
      jals     [target]                jal targets, in order
      waits    [imm]                   `slti` immediates testing a value that was
                                       just stored back to memory -- the controller's
                                       accumulate-until-threshold wait, as opposed to
                                       its small state-machine bounds
      addiu_a3 [simm]                  `addiu a3, a3, imm` adjustments, in order
      stores   {offset}                `sh` store displacements seen
    """
    upper, const = {}, {}
    res = {"consts": [], "ori": [], "tables": [], "loaded": [], "jals": [],
           "waits": [], "addiu_a3": [], "stores": set()}
    shifted = set()                     # regs currently holding `x << 2`
    summed = {}                         # reg -> table base it was added to
    stored = set()                      # regs whose value was just `sw`-ed out
    for i, w in _words(data, off, limit):
        op, rs, rt, imm = _fields(w)
        simm = _simm(imm)
        just_stored, stored = stored, set()
        if op == 0x0F:                                  # lui rt, imm
            upper[rt] = imm << 16
            const.pop(rt, None)
        elif op == 9:                                   # addiu rt, rs, imm
            if rt == 7 and rs == 7:                     # addiu a3, a3, imm
                res["addiu_a3"].append(simm)
            elif rs == 0:
                const[rt] = imm
                upper.pop(rt, None)
            elif rs in upper:
                v = upper[rs] + simm
                const[rt] = v
                res["consts"].append((i, rt, v))
                if rt != rs:
                    upper.pop(rt, None)
            else:
                const.pop(rt, None)
        elif op == 0x0D and rs in upper:                # ori rt, rs, imm
            v = upper[rs] | imm
            const[rt] = v
            res["consts"].append((i, rt, v))
            res["ori"].append(v)
        elif op == 0 and (w & 0x3F) == 0:               # sll rd, rt, sa
            rd, sa = (w >> 11) & 31, (w >> 6) & 31
            (shifted.add if sa == 2 else shifted.discard)(rd)
        elif op == 0 and (w & 0x3F) == 0x21:            # addu rd, rs, rt
            rd = (w >> 11) & 31
            if rs in shifted and rt in const:
                summed[rd] = const[rt]
            elif rt in shifted and rs in const:
                summed[rd] = const[rs]
            else:
                summed.pop(rd, None)
        elif op == 0x23:                                # lw rt, off(rs)
            if rs in summed and summed[rs] not in res["tables"]:
                res["tables"].append(summed[rs])
            if rs in const and const[rs] + simm not in res["loaded"]:
                res["loaded"].append(const[rs] + simm)
            const.pop(rt, None)
        elif op == 0x2B:                                # sw rt, off(rs)
            stored = {rt}
        elif op == 3:                                   # jal target
            res["jals"].append((w & 0x03FFFFFF) << 2 | 0x80000000)
        elif op == 0x0A:                                # slti rt, rs, imm
            if rs in just_stored:
                res["waits"].append(imm)
        elif op == 0x29:                                # sh rt, off(rs)
            res["stores"].add(simm)
    return res


def rd_of(word):
    return (word >> 11) & 31


# ---------------------------------------------------------------------------
# Structure recognition
# ---------------------------------------------------------------------------

def alloc_call(data, fn_off):
    """`(update_fn, size, type)` if `fn_off` is one of the two thin constructors
    (build an object through F0x80014504 with a callback), else None."""
    s = scan(data, fn_off, limit=32)
    if ALLOC not in s["jals"]:
        return None
    upd = next((v for _, r, v in s["consts"] if r == 4), None)   # a0 = callback
    if upd is None:
        return None
    # a1 = size, a2 = type are plain `addiu rX, zero, imm`; re-read them.
    size = kind = None
    for _, w in _words(data, fn_off, 32):
        op, rs, rt, imm = _fields(w)
        if op == 9 and rs == 0:
            if rt == 5: size = imm
            elif rt == 6: kind = imm
    return (upd, size, kind)


def read_program(data, addr):
    """The `{u16 value, u16 holdTicks}` animator script at RAM `addr`."""
    off = addr - BASE
    prog = []
    for i in range(MAX_SCRIPT):
        if off + i * 4 + 4 > len(data):
            return None
        value, hold = struct.unpack_from("<2H", data, off + i * 4)
        prog.append([value, hold])
        if value == SCRIPT_END:
            return prog
    return None


def effect_layers(data, eff_ctor_off):
    """The explosion's two sprite components: [{ysortDy, program}] or None."""
    built = alloc_call(data, eff_ctor_off)
    if not built or built[1] != EFFECT_SIZE:
        return None
    eu = scan(data, built[0] - BASE, limit=256)
    ptr_table = next((v for v in eu["loaded"] if W.is_overlay_ptr(v, data)), None)
    if ptr_table is None:
        return None
    dys = eu["addiu_a3"]
    if len(dys) != 2:
        return None
    off = ptr_table - BASE
    if off < 0 or off + 8 > len(data):
        return None
    layers = []
    for i, dy in enumerate(dys):
        addr = struct.unpack_from("<I", data, off + i * 4)[0]
        prog = read_program(data, addr) if W.is_overlay_ptr(addr, data) else None
        if prog is None:
            return None
        layers.append({"ysortDy": dy, "program": prog})
    return layers


def read_controller(data, ctor_off):
    """Decode the fire-trap controller reachable from constructor `ctor_off`.
    Returns the stage-wide parameters, or None if this is a different controller."""
    built = alloc_call(data, ctor_off)
    if not built or built[1] != CONTROLLER_SIZE or built[2] != CONTROLLER_TYPE:
        return None
    u = scan(data, built[0] - BASE, limit=256)
    if HP_STORE_OFF not in u["stores"]:
        return None                                  # not the HP-forcing controller
    if not u["tables"]:
        return None
    key_table = u["tables"][0]
    if not u["waits"] or len(set(u["waits"])) != 1:
        return None
    wait = u["waits"][0]
    # Packed sound ids: the ONLY constants the controller completes with `ori`
    # (its RAM table bases all use `addiu`), and both live in the 0x8004 page.
    sounds = [v for v in u["ori"] if (v >> 24) == 0x80]
    if len(sounds) != 2:
        return None
    eff_ctor = next((t for t in u["jals"]
                     if W.is_overlay_ptr(t, data) and effect_layers(data, t - BASE)), None)
    if eff_ctor is None:
        return None
    layers = effect_layers(data, eff_ctor - BASE)
    off = key_table - BASE
    keys = []
    for i in range(8):
        if off + i * 4 + 4 > len(data):
            break
        v = struct.unpack_from("<I", data, off + i * 4)[0]
        if not (0 < v < 0x100):                      # the table is short and small
            break
        keys.append(v)
    if not keys:
        return None
    return {
        "waitTicks": wait,
        "targetKeys": keys,
        "sounds": {"arm": "0x%08x" % sounds[0], "blast": "0x%08x" % sounds[1]},
        "layers": layers,
    }


# ---------------------------------------------------------------------------
# Per-stage extraction
# ---------------------------------------------------------------------------

def extract_stage(stage, step_stages):
    data = W.overlay_bytes(stage)
    if not data:
        return None
    events = W.find_event_table(data)
    natives = {}
    for e in events:
        if e["script_offset"] or not e["native_fn"]:
            continue
        natives.setdefault(e["native_fn"], []).append(e)
    for ctor_off, group in sorted(natives.items()):
        ctrl = read_controller(data, ctor_off)
        if ctrl is None:
            continue
        # Pair each trap event with the step record that starts it and the gate
        # flag its own on_complete sets. Both come from story_steps.json, which
        # already decodes the step program and every event's on_complete writes.
        ss = step_stages.get(stage.lstrip("s"), {})
        sets_by_id = {e["event_id"]: e.get("sets") or [] for e in ss.get("events", [])}
        traps = []
        ids = {e["id"] for e in group}
        for idx, step in enumerate(ss.get("steps", [])):
            if step["op"] != 8 or step["params"][0] not in ids:
                continue
            eid = step["params"][0]
            sets = sets_by_id.get(eid, [])
            traps.append({
                "eventId": eid,
                "stepIndex": idx,
                # The step gate and the on_complete write must name the SAME flag —
                # that identity is what makes a region one-shot. Recorded from the
                # step so the runtime never has to guess, and cross-checked below.
                "gateFlag": step["cond_a"],
                "setsFlag": sets[0][0] if len(sets) == 1 else None,
            })
        if traps:
            ctrl["traps"] = traps
            return ctrl
    return None


def main(argv):
    stages = [a.lstrip("s") for a in argv if a.lstrip("s").isdigit()]
    if not stages:
        stages = [str(s) for s in W._all_stages()]
    step_stages = json.loads(STEPS.read_text())["stages"]
    out, problems = {}, []
    for s in stages:
        got = extract_stage(s, step_stages)
        if not got:
            continue
        for t in got["traps"]:
            if t["setsFlag"] is not None and t["setsFlag"] != t["gateFlag"]:
                problems.append(
                    f"s{s} event {t['eventId']}: step gate 0x{t['gateFlag']:x} but "
                    f"on_complete sets 0x{t['setsFlag']:x}")
        out["s" + s] = got
    if problems:
        print("gate/on_complete mismatch — the one-shot identity does not hold:",
              file=sys.stderr)
        for p in problems:
            print("  " + p, file=sys.stderr)
        return 1
    OUT.write_text(json.dumps(out, indent=2) + "\n")
    n = sum(len(v["traps"]) for v in out.values())
    print(f"wrote {OUT.relative_to(ROOT)}: {len(out)} stage(s), {n} trap regions")
    for k, v in out.items():
        print(f"  {k}: {len(v['traps'])} regions, keys {v['targetKeys']}, "
              f"wait {v['waitTicks']}, layers "
              f"{[len(l['program']) for l in v['layers']]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
