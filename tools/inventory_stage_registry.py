#!/usr/bin/env python3
"""Inventory of the field stage-object registry: EVERY member on EVERY stage.

The registry, and where it lives
------------------------------
`fieldstg.s` file `0x18738` (RAM `0x8009b3e8`) is a flat array of twelve-byte
records `{u32 id; u32 construct_fn; u32 draw_fn}`, walked linearly by
`F0x8009243c` and terminated by `id == 0`:

    .L0x0000f78c: lui $v0, 0x800a
    .L0x0000f790: lw $v1, -0x4c18($v0)      # $v1 = [0x8009b3e8], the first id
    .L0x0000f798: beqz $v1, .L0x0000f7c4    # zero id -> not found
    .L0x0000f79c: addiu $a1, $v0, -0x4c18   # delay slot: $a1 = 0x8009b3e8
    .L0x0000f7a0: lw $v0, ($a1)             # rec->id
    .L0x0000f7a8: beq $v0, $a0, .L0x0000f7cc   # match -> return the record
    .L0x0000f7b0: addiu $a1, 0xc            # next record
    .L0x0000f7bc: bnez $v0, .L0x0000f7a0    # loop while id != 0

It is STATIC data inside FIELDSTG.PRO, not runtime-populated BSS: the bytes
come out of the shipped image (`web/assets/native/fieldstg.bin`, authority 4),
and the same 56 records are there on every stage.

What the field VM does with an id >= 0x320
-----------------------------------------
`SETANIM` (`fieldstg` `F0x80084dd0`, file `0x2120`) reads three halfwords and
tests the FIRST against 0x320 (`.L0x00002148 slti $v0, $s2, 0x320` /
`.L0x0000214c beqz $v0, .L0x00002180` -- `slti` sets `$v0 = ($s2 < 0x320)`, so
`beqz` takes the >= 0x320 branch).  Below 0x320 it is an anim clip on a field
actor (`0x80084d8c` + the actor's `+0x148` method); at 0x320 and above it is the
registry route:

    look for a live object with this id  ([0x8004b7bc] = EXE F0x8001810c)
      -> miss -> take one of ten 4-byte slots at <field object>+0x10
              -> F0x80092484(id): lookup, then rec->construct_fn($a0 = id)
      -> F0x800924c8(instance, id, arg2, arg3): lookup, then rec->draw_fn
                                              (instance, arg2, arg3)

Both helpers SKIP a null function pointer (`.L0x0000f7e8 beqz $v0` on the
lookup, `.L0x0000f7f8` / `.L0x0000f850 beqz $v0` on the loaded word).

WHY A RECORD'S ADDRESS IS NOT A FUNCTION
----------------------------------------
Every `wstag*.s` overlay loads at `0x800A5DE0`, so `0x8009b3e8`'s 0x320-0x357
addresses either

  * name FIELDSTG's own resident code (ids 0x323-0x326 = the speech bubbles and
    0x32d = 813, at `0x80088190` / `0x80083cd8`), which means the same thing on
    every stage; or
  * name a place INSIDE THE STAGE OVERLAY WINDOW -- so the record's meaning is
    whatever the resident overlay happens to keep at that offset, and it is one
    different function per stage.  50 of the 56 records are of this kind.

This tool resolves every record against EVERY stage's own image, so a record
read on the wrong stage is visible rather than assumed away.

THE THIRTEEN RECORDS WITH NO CONSTRUCTOR
----------------------------------------
13 of the 50 stage-owned records have `construct_fn == 0`.  They are not
dead: the owning STAGE creates that object itself, passing the id as the
allocator's fourth argument, so the object is already in the live list when the
script fires the id and the construct step is never taken.  s415 is the worked
example (`wstag415.s` file `0x1104`, the delay slot of its `jal F0x800143dc`):

    .L0x000010ec: lui $a0, 0x800a
    .L0x000010f0: addiu $a0, 0x6c8c         # tick 0x800a6c8c
    .L0x000010f4: li $a1, 0x60              # 96-byte object
    .L0x00001100: jal F0x800143dc
    .L0x00001104: li $a3, 0x32c             # register it as id 812

The walker's research interpreter guards this with `ctor !== 0`
(`engine/native/runtime.ts` `fireEffect`); the original needs no guard because
the object is already there.

WHAT THIS TOOL DOES
-------------------
  1. reads all 56 records out of the shipped fieldstg image;
  2. for every one of the 294 stage overlays: every `SETANIM >= 0x320` id its
     recovered scripts fire, with the second and third operands and the events
     they come from;
  3. the record each id selects, and the code at that record's construct and
     draw address IN THAT STAGE'S OWN IMAGE -- including the tick the stage's
     allocator call installs and its family hash from
     `data/stage_object_families.json` when one matches;
  4. the reverse direction too: every allocator call in every overlay that
     registers an id in the registry's range, so a stage's own creations are
     listed even where no script table was recovered;
  5. members grouped by tick family, ranked by how many stages and how many
     script calls one port would cover;
  6. port status per member -- `ported` (with a citation the tool re-checks
     mechanically), `interpreter only` (the stage ships an overlay image, so
     `?nativeStages` runs the original code), or `none`;
  7. everything it could not resolve, with the reason.

Usage:
    python3 tools/inventory_stage_registry.py                 # summary to stderr
    python3 tools/inventory_stage_registry.py --out data/stage_registry_members.json
    python3 tools/inventory_stage_registry.py --records      # the 56 records
    python3 tools/inventory_stage_registry.py --stage s415   # one stage
    python3 tools/inventory_stage_registry.py --unresolved   # gaps + reasons
    python3 tools/inventory_stage_registry.py --doc-groups   # §7 family table
    python3 tools/inventory_stage_registry.py --doc-stages   # §6 per-stage table
"""

import argparse
import json
import re
import struct
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import inventory_stage_objects as iso  # noqa: E402  (one overlay parser, one set of rules)

FIELDSTG_IMAGE = REPO / "web/assets/native/fieldstg.bin"
FIELDSTG_BASE = 0x80082CB0
REGISTRY_RAM = 0x8009B3E8
REGISTRY_STRIDE = 12
OVERLAY_BASE = iso.OVERLAY_BASE  # 0x800A5DE0, every wstag overlay's load address

EVENTS = REPO / "web/assets/events/wstag_events.json"
FAMILIES = REPO / "data/stage_object_families.json"
FALLING = REPO / "web/assets/data/falling_objects.json"
NATIVE_MANIFEST = REPO / "web/assets/native/manifest.json"

SETANIM = re.compile(r"^SETANIM\s+(-?\d+)(?:\s+(-?\d+))?(?:\s+(-?\d+))?\s*$")
ID_MIN = 0x320


# ── the registry ────────────────────────────────────────────────────────────
def read_registry():
    """The records `{id, construct, draw}` and where each address lives.

    `home` is one of
      "fieldstg"  -- inside FIELDSTG's own image, the same routine on every stage
      "stage"     -- inside the stage overlay window, i.e. per-stage code
      "null"      -- the record has no such function (the original skips it)
    """
    try:
        blob = FIELDSTG_IMAGE.read_bytes()
    except OSError:
        return [], "no %s on disk; the registry is static data in FIELDSTG.PRO" % FIELDSTG_IMAGE
    off = REGISTRY_RAM - FIELDSTG_BASE
    out = []
    while off + REGISTRY_STRIDE <= len(blob):
        eid, ctor, draw = struct.unpack_from("<III", blob, off)
        if eid == 0:
            break
        out.append({
            "id": eid,
            "id_hex": "0x%03x" % eid,
            "ctor": ctor,
            "ctor_hex": "0x%08x" % ctor,
            "draw": draw,
            "draw_hex": "0x%08x" % draw,
            "ctor_home": home_of(ctor),
            "draw_home": home_of(draw),
            "file_offset": "0x%x" % off,
        })
        off += REGISTRY_STRIDE
    return out, None


def home_of(addr):
    """Which image an address belongs to.  See the module docstring."""
    if addr == 0:
        return "null"
    if FIELDSTG_BASE <= addr < FIELDSTG_BASE + 0x10000:
        return "fieldstg"
    if OVERLAY_BASE <= addr < OVERLAY_BASE + 0x20000:
        return "stage"
    return "outside"


# ── scripts ─────────────────────────────────────────────────────────────────
def read_scripts():
    """stage -> {id: {"params": [...], "events": [...]}} for SETANIM >= 0x320.

    Only `wstag_events.json` carries recovered bytecode (139 of the 294
    overlays); a stage absent from it has NO known member list from this side,
    and is reported as such rather than treated as member-less.
    """
    try:
        data = json.loads(EVENTS.read_text())
    except (OSError, ValueError):
        return {}, {}
    out = {}
    for stage, events in data.items():
        key = str(stage).lstrip("s")
        members = {}
        for ev in events:
            for line in ev.get("disasm", []):
                m = SETANIM.match(line.strip())
                if not m:
                    continue
                eid = int(m.group(1))
                if eid < ID_MIN:
                    continue
                args = [int(g) for g in m.groups()[1:] if g is not None]
                slot = members.setdefault(eid, {"params": set(), "events": set()})
                slot["params"].add(tuple(args))
                slot["events"].add(ev.get("id"))
        for slot in members.values():
            slot["params"] = sorted(list(p) for p in slot["params"])
            slot["events"] = sorted(e for e in slot["events"] if e is not None)
        if members:
            out[key] = members
    return out, set(str(k).lstrip("s") for k in data)


# ── the tick a stage installs for an id ─────────────────────────────────────
def tick_from_ctor(ov, addr):
    """The tick the registry's `construct_fn` at `addr` installs, in this overlay.

    `None` when the address is not in this stage's image, or the routine has no
    allocator call whose $a0 folds to an address inside the overlay.
    """
    if ov is None or not (OVERLAY_BASE <= addr < OVERLAY_BASE + ov["size"]):
        return None, "construct address is outside this stage's image"
    off = addr - OVERLAY_BASE
    if (off) in ov["words"]:
        return None, "construct address lands on a data word, not code"
    body, _ = iso.read_routine(ov, iso.routine_start(ov, off))
    for call_off, text in body:
        if text not in iso.CREATE_CALLS:
            continue
        tick, why = iso.resolve_tick(ov, call_off)
        if tick is None:
            continue
        return {"tick": tick, "call": OVERLAY_BASE + call_off,
                "routine": text.split(" ", 1)[1], "why": why,
                "size": iso.arg_at(ov, "$a1", call_off + 8)[0],
                "source": "registry construct_fn"}, why
    return None, "no allocator call in the construct routine"


def site_tick(site):
    """The tick one creation site installs, in the shape tick_from_ctor returns.

    `allocator_sites` reports the tick the call resolves; `id_builder_calls`
    reports the tick one level inside the stage's own `move_ $a3, $a0`
    builder.  Both are normalised here so a caller does not have to know which
    of the two shapes a site carries.
    """
    tick = site.get("tick")
    if isinstance(tick, dict):
        return tick
    if isinstance(tick, int):
        return {"tick": tick, "call": site["call"],
                "routine": site.get("routine", ""), "why": site.get("why", ""),
                "size": site.get("size"), "source": site["source"]}
    return None


def tick_from_site(sites):
    """The tick the STAGE installs for this id, from its own creation site.

    The thirteen records with `construct_fn == 0` are read here instead: the
    stage allocates the object itself with the id as the allocator's fourth
    argument, so the tick comes from that call, not from the record.
    """
    for site in sites:
        tick = site_tick(site)
        if tick is not None:
            return tick
    return None


def allocator_sites(ov):
    """Every allocator call in this overlay with $a3 folding to a registry id.

    This is the stage-native half of the system: a stage that registers an id
    itself (the thirteen records with no constructor do exactly this).
    """
    out = []
    if ov is None:
        return out
    for call_off in sorted(ov["ins"]):
        text = ov["ins"][call_off]
        if text not in iso.CREATE_CALLS:
            continue
        a3, _ = iso.arg_at(ov, "$a3", call_off + 8)
        if not isinstance(a3, int) or not (ID_MIN <= a3 <= 0x357):
            continue
        tick, why = iso.resolve_tick(ov, call_off)
        out.append({
            "id": a3, "id_hex": "0x%03x" % a3,
            "call": OVERLAY_BASE + call_off,
            "routine": text.split(" ", 1)[1],
            "tick": tick, "why": why,
            "size": iso.arg_at(ov, "$a1", call_off + 8)[0],
            "source": "stage allocator call",
        })
    return out


def id_builder_calls(ov):
    """Calls that pass a registry id in $a0 into one of the stage's own builders.

    s810 hands 0x34c/0x34b/0x34a to `0x800a61c4`/`0x800a6200`/`0x800a623c`
    (file 0x58c/0x5c4/0x600), each of which is a `move_ $a3, $a0` wrapper around
    the shared allocator, so the id never reaches an allocator call as a literal.
    Resolving them one level keeps the census whole.
    """
    out = []
    if ov is None:
        return out
    for call_off in sorted(ov["ins"]):
        text = ov["ins"][call_off]
        op = text.split(" ", 1)[0]
        if op != "jal" or text in iso.CREATE_CALLS:
            continue
        target = iso.target_value(text.split(" ", 1)[1] if " " in text else "")
        if target is None or not (OVERLAY_BASE <= target < OVERLAY_BASE + ov["size"]):
            continue
        a0, _ = iso.arg_at(ov, "$a0", call_off + 8)
        if not isinstance(a0, int) or not (ID_MIN <= a0 <= 0x357):
            continue
        t_off = target - OVERLAY_BASE
        if t_off in ov["words"]:
            continue
        body, _ = iso.read_routine(ov, iso.routine_start(ov, t_off))
        if not any("move_ $a3, $a0" in t for _, t in body):
            continue
        tick, why = None, "builder takes the id as $a0"
        for b_off, b_text in body:
            if b_text in iso.CREATE_CALLS:
                tick, why = iso.resolve_tick(ov, b_off)
                if tick is not None:
                    tick = {"tick": tick, "call": OVERLAY_BASE + b_off,
                            "routine": b_text.split(" ", 1)[1], "why": why,
                            "size": iso.arg_at(ov, "$a1", b_off + 8)[0],
                            "source": "stage builder 0x%08x" % target}
                break
        out.append({
            "id": a0, "id_hex": "0x%03x" % a0,
            "call": OVERLAY_BASE + call_off,
            "builder": target,
            "tick": tick, "why": why,
        })
    return out


# ── port status ─────────────────────────────────────────────────────────────
# Each entry is a CITATION the tool re-checks, so a port that is renamed or
# deleted turns its members back into `none` instead of quietly staying green.
# This is a list of what has been ported -- not a list of what exists: every
# member comes from the registry and the scripts, and an uncited member is
# `none` or `interpreter only`.
PORTS = [
    {
        "stage": "*", "ids": [0x323, 0x324, 0x325, 0x326],
        "files": ["engine/systems/cutscene-manager.ts"],
        "must_contain": ["BUBBLE_EFFECT_IDS", "803", "804", "805", "806"],
        "why": "the four speech-bubble ids are handled by the cutscene manager itself",
    },
    {
        "stage": "*", "ids": [0x32d],
        "files": ["engine/systems/cutscene-manager.ts",
                  "engine/systems/field-movement.ts"],
        "must_contain": ["SCENE_OBJECT_ID", "813", "PARTY_GATHER"],
        "why": "id 813 is the resident scene object; C 823 is the party gather",
    },
    {
        "stage": "415", "ids": list(range(0x330, 0x33A)),
        "files": ["engine/systems/falling-object.ts"],
        "must_contain": ["falling"],
        "data_check": "falling",
        "why": "the crevice-ride rockfall, one builder per id in the registry order",
    },
    # ── THE point-record actor system: fifteen members, ONE module ──────────
    # Every one of these claims its stage's own dormant point-sprite records by
    # their atlas byte and animates them through the stepper its overlay repeats
    # at its own base. `data_check: "actors"` makes the census read the member's
    # id out of the ONE table, so a member cannot be marked ported without the
    # table carrying it.
    {
        # The pad-flash arm. s925's record has no configure routine and its pad
        # is a literal in its constructor, so the id alone arms it; the others
        # are armed by the id plus SETANIM's second operand.
        "stage": "212", "ids": [0x32a],
        "files": ["engine/systems/point-record-actor.ts"],
        "must_contain": ["0x32a", "pad-flash", "firePadFlash"],
        "data_check": "actors",
        "why": "the Asuka City lobby download halo, three pads, one script each",
    },
    {
        "stage": "225", "ids": [0x32f],
        "files": ["engine/systems/point-record-actor.ts"],
        "must_contain": ["0x32f", "pad-flash"],
        "data_check": "actors",
        "why": "the Asuka City login-room pad flash (SETANIM 815 838)",
    },
    {
        "stage": "750", "ids": [0x34e],
        "files": ["engine/systems/point-record-actor.ts"],
        "must_contain": ["0x34e", "pad-flash"],
        "data_check": "actors",
        "why": "the north-sector chamber-room pad (SETANIM 846 821)",
    },
    {
        "stage": "925", "ids": [0x357],
        "files": ["engine/systems/point-record-actor.ts"],
        "must_contain": ["0x357", "pad-flash"],
        "data_check": "actors",
        "why": "a construct-only copy: the pad is a constructor literal, no "
               "configure routine on the record",
    },
    {
        "stage": "780", "ids": [0x320],
        "files": ["engine/systems/street-vehicles.ts"],
        "must_contain": ["BROADCAST_EFFECT_IDS", "0x320"],
        "why": "the street broadcast object that owns the four car slots",
    },
    {
        # The "tagged decor" arm: one member per stage, five shapes.
        "stage": "785", "ids": [0x343],
        "files": ["engine/systems/point-record-actor.ts"],
        "must_contain": ["0x800a5f04", "tickStacked"],
        "data_check": "actors",
        "why": "the Online Center's four stacked point records light up and cycle",
    },
    {
        "stage": "790", "ids": [0x328, 0x329],
        "files": ["engine/systems/point-record-actor.ts"],
        "must_contain": ["0x800a6138", "0x800a5df4"],
        "data_check": "actors",
        "why": "the Chamber Room's re-pointed record and its eight-record reveal",
    },
    {
        "stage": "795", "ids": [0x344],
        "files": ["engine/systems/point-record-actor.ts"],
        "must_contain": ["0x800a5f00", "tickFire"],
        "data_check": "actors",
        "why": "the Magasta B1F panel blinks, then plays its ten-frame fire",
    },
    {
        "stage": "800", "ids": [0x345, 0x347],
        "files": ["engine/systems/point-record-actor.ts"],
        "must_contain": ["0x800a6344", "tickOneshot"],
        "data_check": "actors",
        "why": "the Magasta B2F panel (same shape as B1F) and its one-shot pair",
    },
    {
        "stage": "805", "ids": [0x348],
        "files": ["engine/systems/point-record-actor.ts"],
        "must_contain": ["tickRecord", "follow-u8"],
        "data_check": "actors",
        "why": "the machine room's four picture slots: one object, one claim "
               "walk, and four `sb` bytes that PIN their clip in a jal's delay "
               "slot",
    },
    {
        "stage": "810", "ids": [0x34a, 0x34b, 0x34c],
        "files": ["engine/systems/point-record-actor.ts"],
        "must_contain": ["0x34a", "0x34b", "0x34c"],
        "data_check": "actors",
        "why": "one point-record shape, three builders stamping atlas tags "
               "5/3/1: the three stations' six ambient records",
    },
    {
        "stage": "820", "ids": [0x355],
        "files": ["engine/systems/point-record-actor.ts"],
        "must_contain": ["0x355", "stop-u16"],
        "data_check": "actors",
        "why": "sound-only on the console: a registry constructor with a null "
               "configure slot, so the SETANIM only builds it and plays "
               "0x0004001D",
    },
    {
        # The one-record copy of the same claim actor: s455 claims the tag-1 row
        # of its own point table, runs one {clip, hold} script through the shared
        # stepper and never moves the record, so it is a shape of the ported
        # system rather than a stage of its own.
        "stage": "455", "ids": [0x33c],
        "files": ["engine/systems/point-record-actor.ts"],
        "must_contain": ["0x33c", "single", "tickSingle"],
        "data_check": "actors",
        "why": "the Bios Swamp one-record copy: claim, one script, no pad",
    },
    {
        # The no-script copy of the same actor: one claimed record walked up the
        # screen a pixel a blank for 150 blanks, then left lit where it stopped.
        "stage": "926", "ids": [0x356],
        "files": ["engine/systems/point-record-actor.ts"],
        "must_contain": ["0x356", "rise", "tickRise", "riseBlanks"],
        "data_check": "actors",
        "why": "the rising copy: no script, a pixel a blank for 150 blanks",
    },
    {
        # s545's row one script away from the `single` shape: a passive flash
        # state the stage's command switches out of, then one script that hands
        # the row back to the flash when it ends.
        "stage": "545", "ids": [0x34f],
        "files": ["engine/systems/point-record-actor.ts"],
        "must_contain": ["0x34f", "advance", "cue"],
        "data_check": "actors",
        "why": "the null-ctor flash row the stage builds for itself at entry",
    },
    {
        "stage": "620", "ids": [0x351],
        "files": ["engine/systems/point-record-actor.ts"],
        "must_contain": ["0x351", "slots", "grid", "tickGrid"],
        "data_check": "actors",
        "why": "four claimed rows whose clip goes into one of the record's two "
               "animation bytes, each slot picking its script out of the "
               "overlay's own 8-byte-entry table",
    },
    {
        "stage": "680", "ids": [0x32e],
        "files": ["engine/systems/point-record-actor.ts"],
        "must_contain": ["0x32e", "lanes", "tickLanes", "rise-u8"],
        "data_check": "actors",
        "why": "eleven lane rows and three traffic rows off one claim walk, and "
               "the stepper's end entry carries the one-shot rise that walks a "
               "lane down the screen",
    },
    {
        # The one member with NO record claim: it draws picture ids straight
        # out of the stage's own sprite directory, stepped by a 4-blank
        # counter, anchored on the character the SETANIM's operand names
        # (wstag785 file 0x4d4 tick / 0x760 configure / 0x428 draw helper).
        "stage": "785", "ids": [0x327],
        "files": ["engine/systems/point-record-actor.ts"],
        "must_contain": ["0x327", "picture-steps", "firePictureSteps",
                         "tickPictureSteps"],
        "data_check": "actors",
        "why": "the Online Center's picture stepper: three 4-blank pictures "
               "then an arm-word picture, anchored on the script's character",
    },
    {
        # The one member of the family that carries a FALL INTEGRATOR: it
        # claims the tag-1 row, drops onto the rail with a bounce and a cue,
        # then runs the three roll-in scripts through the one-shot copy of the
        # shared stepper, writing active/spriteId/X/Y into the claimed row
        # every tick (wstag415 tick file 0x778, integrator file 0x8b8-0x974,
        # configure file 0xbac).  Found by its own code: a whole-body census
        # over the 294 wstag images finds exactly one copy of its start and
        # integrator signatures, both in s415.
        "stage": "415", "ids": [0x32b],
        "files": ["engine/systems/point-record-actor.ts",
                  "web/assets/data/point_record_actors.json"],
        "must_contain": ["0x32b", "ride-walker", "fireRideWalker",
                         "tickRideWalker", "hold-u16"],
        "data_check": "actors",
        "why": "the crevice ride's Bulbmon: one claimed row it falls onto "
               "the rail, bounces and then runs the three roll-in sequences "
               "through the one-shot stepper",
    },
    {
        "stage": "780", "ids": [0x321],
        "files": ["engine/systems/street-screens.ts"],
        "must_contain": ["SCREEN_QUAD_STRIDE", "0x321"],
        "why": "the wall/column screen driver (ported 2026-10-04)",
    },
    {
        "stage": "780", "ids": [0x322],
        "files": ["engine/systems/stinger-popup.ts"],
        "must_contain": ["STINGER_EFFECT_ID", "0x322"],
        "why": "the corner stinger; its registry record has a NULL draw, so the "
               "opcode only constructs it and the object animates itself",
    },
    {
        "stage": "305", "ids": [0x352],
        "files": ["engine/systems/stage-slot-player.ts",
                  "web/assets/data/stage_slot_players.json"],
        "must_contain": ["claimSlot", "tickSlotPlayer", "SLOT_END_CLIP"],
        "why": "the Master Room's arena marker: claims the slot tagged 1 and writes its sprite every frame",
    },
    {
        "stage": "306", "ids": [0x353],
        "files": ["engine/systems/stage-slot-player.ts",
                  "web/assets/data/stage_slot_players.json"],
        "must_contain": ["claimSlot", "tickSlotPlayer", "SLOT_END_CLIP"],
        "why": "the same routine and the same clip run in the second Master Room overlay",
    },
    {
        "stage": "805", "ids": [0x349],
        "files": ["engine/systems/shape-annotator.ts", "web/stage-objects.js"],
        "must_contain": ['{ stage: "805", member: "0x349", id: 841 }', "tickS805Annotator", "fireAnnotator"],
        "why": "Magasta 1F's twenty-seven-marker ring, drawn through the ported 0x1002 draw-context service",
    },
    {
        "stage": "820", "ids": [0x34d],
        "files": ["engine/systems/shape-annotator.ts", "web/stage-objects.js"],
        "must_contain": ['{ stage: "820", member: "0x34d", id: 845 }', "tickS820Annotator", "fireAnnotator"],
        "why": "the Spy Satellite control room's four beacons, drawn through the ported 0x1002 draw-context service",
    },
    {
        "stage": "310", "ids": [0x354],
        "files": ["engine/systems/stage-fixed-sprite.ts",
                  "web/assets/data/stage_fixed_sprites.json"],
        "must_contain": ["FIXED_SPRITE_BURST_HIDE", "tickFixedSprite", "0x354"],
        "why": "the Asuka-side A.o.A. Headquarters wall machine, pinned at (620,252)",
    },
    {
        "stage": "311", "ids": [0x346],
        "files": ["engine/systems/stage-fixed-sprite.ts",
                  "web/assets/data/stage_fixed_sprites.json"],
        "must_contain": ["FIXED_SPRITE_BURST_HIDE", "tickFixedSprite", "0x346"],
        "why": "the Amaterasu-side twin of the same family, pinned at (271,411)",
    },
    # ── THE display-slot ensemble: two members, ONE module ──────────────────
    # One object claims a RUN of six consecutive tags in the field's own 18-byte
    # display chain and gives each slot its own picture or clip run. Found by its
    # own code over 294 overlays, so these two are the whole family.
    {
        # THE two-slot writer: one object that claims TWO rows by explicit tag
        # compares and drives the live field character's world Y (the resident
        # object named 5) through a six-arm clip machine.  The extractor finds
        # the shape by its own instruction words over EVERY wstag image, so the
        # one table is the family's member list; s934 carries the same copy of
        # the code and nothing constructs it, which the extractor's own census
        # names.
        "stage": "261", "ids": [0x33b],
        "files": ["engine/systems/point-record-actor.ts",
                  "engine/systems/field-character.ts",
                  "web/assets/data/point_record_actors.json"],
        "must_contain": ["0x33b", "two-slot", "tickTwoSlot", "fireTwoSlot",
                         "fieldCharAddY"],
        "data_check": "actors",
        "why": "the Cargo Tower's lift: two rows and the player itself, moved "
               "together by a six-clip sequence and a 127-pixel blink",
    },
    {
        # THE child-pool parent: one object that claims a row of its own and
        # builds five CHILD objects through the shared child allocator, then runs
        # a six-arm clip machine that pokes one child at a time. The children's
        # own shape is the ported pad flash, so this is the module's `parent`
        # machine rather than a new renderer. `tools/extract_child_pool_parents.py`
        # finds the shape by its own code over 294 overlays, so this table IS the
        # member list of the family.
        "stage": "545", "ids": [0x350],
        "files": ["engine/systems/point-record-actor.ts",
                  "web/assets/data/child_pool_parents.json"],
        "must_contain": ["tickParent", "tickParentChild", "fireParent"],
        "data_check": "parents",
        "why": "the Bug Maze Pit's pad owner: its own row plus five child "
               "objects, each claiming one more row and running one script",
    },
    {
        # THE triple parents: one object whose state 0 builds a dozen CHILD
        # objects -- three makers on s460, five on s526 -- and whose state 2 pokes
        # every one of them; the children are FOUR-STATE row actors with their own
        # claim walk, their own stepper and, for two of the makers, their own
        # heading integrator.  The same shape in one module as the `parent`
        # machine beside it, because it is the same child allocator, the same
        # method block and the same stepper.  `tools/extract_child_pool_parents.py`
        # finds the shape by its own code over 294 overlays, so this table IS the
        # member list of the family.
        "stage": "460", "ids": [0x33e],
        "files": ["engine/systems/point-record-actor.ts",
                  "web/assets/data/child_pool_parents.json"],
        "must_contain": ["tickTriple", "tickTripleChild", "fireTriple",
                         "walkTripleChild", "buildTriplePool", "stageLoadGate",
                         "0x33e"],
        "data_check": "parents",
        "why": "the Arena's nine children: seven wanderers plus a pair of twin "
               "rows and one single row, each claiming its own tag -- and only "
               "below the stage's own story-ordinal gate, because above it the "
               "command constructs the parent with no pool at all",
    },
    {
        "stage": "526", "ids": [0x33d],
        "files": ["engine/systems/point-record-actor.ts",
                  "web/assets/data/child_pool_parents.json"],
        "must_contain": ["tickTriple", "tickTripleChild", "fireTriple",
                         "walkTripleChild", "buildTriplePool", "stageLoadGate",
                         "0x33d"],
        "data_check": "parents",
        "why": "twelve children from four makers: nine wanderers, a pair of twin "
               "rows and two single rows, one of which holds a fixed picture -- "
               "and only below the stage's own story-ordinal gate, because above "
               "it the command constructs the parent with no pool at all",
    },
    {
        "stage": "310", "ids": [0x33f, 0x340],
        "files": ["engine/systems/stage-slot-ensemble.ts",
                  "web/assets/data/stage_slot_ensembles.json"],
        "must_contain": ["ENSEMBLE_STEADY_MODE", "tickEnsemble", "0x33f", "0x340"],
        "data_check": "ensembles",
        "why": "the A.o.A. Headquarters wall pictures: two stacks of six, one "
               "object each, six frames per pass",
    },
]


def port_lookup(falling):
    """(stage, id) -> {"ported": cite, "basis": ...}, verified or dropped."""
    table, broken = {}, []
    for entry in PORTS:
        text = []
        ok = True
        for rel in entry["files"]:
            try:
                text.append((REPO / rel).read_text(errors="replace"))
            except OSError:
                ok = False
                broken.append("%s is missing" % rel)
                break
        joined = "\n".join(text)
        for needle in entry["must_contain"]:
            if needle not in joined:
                ok = False
                broken.append("%s does not name %r" % (entry["files"][0], needle))
        if entry.get("data_check") == "falling":
            builders = falling.get(entry["stage"], {}).get("builders") or []
            cited = {b.get("effectId") for b in builders}
            missing = [i for i in entry["ids"] if i not in cited]
            if missing:
                ok = False
                broken.append(
                    "web/assets/data/falling_objects.json s%s builders do not carry "
                    "id(s) %s" % (entry["stage"], ", ".join("0x%03x" % i for i in missing)))
        if entry.get("data_check") == "ensembles":
            # The extractor scans every wstag overlay, so this table IS the
            # member list: a citation that loses an id, or an id the extractor
            # does not find, shows up as a broken citation here.
            try:
                doc = json.loads(
                    (REPO / "web/assets/data/stage_slot_ensembles.json").read_text())
            except (OSError, ValueError) as exc:
                broken.append("web/assets/data/stage_slot_ensembles.json: %s" % exc)
                continue
            stage_doc = (doc.get("stages") or {}).get("%s" % entry["stage"]) or {}
            cited = {int(m["id"]) for m in stage_doc.values()}
            missing = [i for i in entry["ids"] if i not in cited]
            if missing:
                ok = False
                broken.append(
                    "web/assets/data/stage_slot_ensembles.json s%s does not carry "
                    "id(s) %s" % (entry["stage"], ", ".join("0x%03x" % i for i in missing)))
        if entry.get("data_check") == "parents":
            # The extractor's table is the member list of the child-pool family,
            # so a citation that loses an id -- or an id the extractor does not
            # find -- shows up as a broken citation here.
            try:
                doc = json.loads(
                    (REPO / "web/assets/data/child_pool_parents.json").read_text())
            except (OSError, ValueError) as exc:
                broken.append("web/assets/data/child_pool_parents.json: %s" % exc)
                continue
            members = (doc.get("stages") or {}).get("s" + entry["stage"]) or {}
            listed = {int(k, 16) for k in members}
            missing = [i for i in entry["ids"] if i not in listed]
            if missing:
                ok = False
                broken.append(
                    "web/assets/data/child_pool_parents.json s%s does not carry "
                    "id(s) %s" % (entry["stage"], ", ".join("0x%03x" % i for i in missing)))
        if entry.get("data_check") == "actors":
            # The ONE table (tools/extract_point_record_actors.py --check) is the
            # member list: a citation that loses its id, or an id the table does
            # not carry, shows up as a broken citation here.
            try:
                table_doc = json.loads(
                    (REPO / "web/assets/data/point_record_actors.json").read_text())
            except (OSError, ValueError) as exc:
                broken.append("web/assets/data/point_record_actors.json: %s" % exc)
                continue
            members = (table_doc.get("stages") or {}).get("s" + entry["stage"]) or {}
            listed = {int(k) for k in members}
            missing = [i for i in entry["ids"] if i not in listed]
            if missing:
                broken.append(
                    "web/assets/data/point_record_actors.json s%s does not carry "
                    "id(s) %s" % (entry["stage"], ", ".join("0x%03x" % i for i in missing)))
        if not ok:
            continue
        for eid in entry["ids"]:
            table[(entry["stage"], eid)] = {
                "files": entry["files"], "why": entry["why"],
            }
    return table, broken


def native_stages():
    """Stages that ship an overlay image, i.e. that `?nativeStages` can run."""
    try:
        manifest = json.loads(NATIVE_MANIFEST.read_text())
    except (OSError, ValueError):
        return set()
    return set(str(k).lstrip("s") for k, v in manifest.items() if v.get("root_ctor", -1) >= 0)


# ── the census ──────────────────────────────────────────────────────────────
def build(stages=None):
    records, reg_err = read_registry()
    if reg_err:
        raise SystemExit(reg_err)
    by_id = {r["id"]: r for r in records}
    scripts, stages_with_scripts = read_scripts()
    try:
        fam_data = json.loads(FAMILIES.read_text())
    except (OSError, ValueError):
        fam_data = {"families": []}
    tick_family = {}
    for fam in fam_data["families"]:
        for call in fam["create_calls"]:
            tick_family[(str(call["stage"]), call["tick"])] = fam["hash"]
    try:
        falling = json.loads(FALLING.read_text())
    except (OSError, ValueError):
        falling = {}
    ports, broken_ports = port_lookup(falling)
    native = native_stages()

    overlays = {}
    for stage in stages:
        overlays[stage] = iso.parse_overlay(stage)

    members, unresolved, stage_rows = {}, [], []
    for stage in stages:
        ov = overlays[stage]
        sites = allocator_sites(ov) + id_builder_calls(ov)
        by_site = {}
        for site in sites:
            by_site.setdefault(site["id"], []).append(site)
        ids = set(scripts.get(stage, {}))
        ids |= set(by_site)
        rows = []
        for eid in sorted(ids):
            rec = by_id.get(eid)
            row = {
                "id": eid, "id_hex": "0x%03x" % eid,
                "script_calls": len(scripts.get(stage, {}).get(eid, {}).get("events", [])),
                "params": scripts.get(stage, {}).get(eid, {}).get("params", []),
                "events": scripts.get(stage, {}).get(eid, {}).get("events", []),
                "stage_created": bool(by_site.get(eid)),
                "creation_sites": by_site.get(eid, []),
                "problems": [],
            }
            if rec is None:
                row["problems"].append("no registry record with this id")
                unresolved.append({"stage": stage, "id": eid,
                                   "reason": "no record in the 0x8009b3e8 table"})
            else:
                row["record"] = {"ctor": rec["ctor_hex"], "draw": rec["draw_hex"],
                                 "ctor_home": rec["ctor_home"],
                                 "draw_home": rec["draw_home"],
                                 "file_offset": rec["file_offset"]}
                row["owner"] = ("fieldstg" if rec["ctor_home"] == "fieldstg"
                                else "stage")
                tick, why = tick_from_ctor(ov, rec["ctor"])
                row["construct"] = {"resolves": tick is not None, "reason": why,
                                    "tick": tick}
                if tick is None and row["stage_created"]:
                    tick = tick_from_site(row["creation_sites"])
                    why = ("record has no constructor; the tick comes from the "
                           "stage's own allocator call")
                    row["construct"] = {"resolves": tick is not None, "reason": why,
                                        "tick": tick}
                if tick is not None:
                    row["tick"] = "0x%08x" % tick["tick"]
                    row["tick_call"] = "0x%08x" % tick["call"]
                    row["object_size"] = tick["size"]
                    row["tick_source"] = tick["source"]
                    fam = tick_family.get((stage, tick["tick"]))
                    if fam:
                        row["family"] = fam
                elif not row["stage_created"] and rec["ctor_home"] == "stage":
                    row["problems"].append(why)
                    unresolved.append({"stage": stage, "id": eid, "reason": why})
                draw = draw_in_overlay(ov, rec["draw"])
                row["draw_here"] = draw
            # port status
            cite = ports.get((stage, eid)) or ports.get(("*", eid))
            if cite:
                row["port"] = "ported"
                row["port_cite"] = cite["files"]
                row["port_basis"] = cite["why"]
            elif stage in native:
                row["port"] = "interpreter only"
                row["port_cite"] = ["web/native-stage.js", "engine/native/runtime.ts"]
                row["port_basis"] = ("the stage ships an overlay image, so "
                                     "?nativeStages runs the original code; no "
                                     "translated module claims this id")
            else:
                row["port"] = "none"
                row["port_basis"] = ("no translated module claims this id and the "
                                     "stage ships no overlay image")
            rows.append(row)
        if rows:
            members[stage] = rows
            stage_rows.append({
                "stage": stage,
                "overlay_size": ov["size"] if ov else 0,
                "raw_words_overlay": bool(ov and ov["raw_words"]),
                "has_script_table": stage in stages_with_scripts,
                "members": len(rows),
                "ported": sum(1 for r in rows if r["port"] == "ported"),
                "interpreter_only": sum(1 for r in rows if r["port"] == "interpreter only"),
                "none": sum(1 for r in rows if r["port"] == "none"),
            })
        if stage not in stages_with_scripts:
            unresolved.append({
                "stage": stage,
                "reason": ("no event table recovered by tools/wstag_events.py "
                           "(139 of 294 overlays), so no script-confirmed member "
                           "list; members below come from the stage's own "
                           "allocator calls only"),
            })

    candidates = code_candidates(records, overlays, members, tick_family)
    groups = group_by_family(members)
    summary = {
        "generated_by": "tools/inventory_stage_registry.py",
        "registry_ram": "0x%08X" % REGISTRY_RAM,
        "registry_file_offset": "0x%x" % (REGISTRY_RAM - FIELDSTG_BASE),
        "registry_stride": REGISTRY_STRIDE,
        "fieldstg_base": "0x%08X" % FIELDSTG_BASE,
        "overlay_base": "0x%08X" % OVERLAY_BASE,
        "setanim_handler": {"file": "0x2120", "ram": "0x%08X" % (FIELDSTG_BASE + 0x2120)},
        "lookup_fn": {"file": "0xf78c", "ram": "0x%08X" % (FIELDSTG_BASE + 0xf78c)},
        "construct_fn": {"file": "0xf7d4", "ram": "0x%08X" % (FIELDSTG_BASE + 0xf7d4)},
        "configure_fn": {"file": "0xf818", "ram": "0x%08X" % (FIELDSTG_BASE + 0xf818)},
        "records": len(records),
        "records_fieldstg_owned": sorted(r["id_hex"] for r in records if r["ctor_home"] == "fieldstg"),
        "records_stage_owned": sum(1 for r in records if r["ctor_home"] != "fieldstg"),
        "records_with_null_ctor": sorted(r["id_hex"] for r in records if r["ctor"] == 0),
        "records_with_null_draw": sorted(r["id_hex"] for r in records if r["draw"] == 0),
        "stages_scanned": len(stages),
        "stages_with_a_script_table": len(stages_with_scripts),
        "stages_with_members": len(members),
        "members_total": sum(len(v) for v in members.values()),
        "members_ported": sum(1 for v in members.values() for r in v if r["port"] == "ported"),
        "members_interpreter_only": sum(1 for v in members.values() for r in v if r["port"] == "interpreter only"),
        "members_none": sum(1 for v in members.values() for r in v if r["port"] == "none"),
        "shared_ids": sorted({r["id_hex"] for v in members.values() for r in v
                              if r.get("record", {}).get("ctor_home") == "fieldstg"}),
        "ids_never_fired_by_a_recovered_script": sorted(
            r["id_hex"] for r in records
            if not any(r["id"] in v for v in scripts.values())),
        "stage_owned_members": sum(
            1 for v in members.values() for r in v if r.get("owner") == "stage"),
        "fieldstg_owned_members": sum(
            1 for v in members.values() for r in v if r.get("owner") == "fieldstg"),
        "tick_families": len(groups),
        "code_only_candidates": sum(len(v) for v in candidates.values()),
        "code_candidates_on_the_overlay_base_tick": sum(
            1 for v in candidates.values() for c in v if c["tick_at_overlay_base"]),
        "code_candidates_that_are_confirmed_members": sum(
            1 for v in candidates.values() for c in v if c["confirmed_member"]),
        "broken_port_citations": broken_ports,
    }
    return {
        "summary": summary,
        "records": records,
        "stages": stage_rows,
        "members": members,
        "code_candidates": candidates,
        "tick_families": groups,
        "unresolved": unresolved,
    }


def code_candidates(records, overlays, members, tick_family):
    """Ids whose record reads as an allocator-backed ctor in a stage's image.

    THIS IS AN UPPER BOUND, NOT A MEMBER LIST.  A record names an ADDRESS inside
    the stage overlay window, so on any stage whose image reaches that offset the
    address reads as *something*; it is only the owning stage's own routine when
    a script proves it.  The one systematic false positive is the stage root
    object: every overlay keeps its own bootstrap at overlay+0 (`data/
    stage_object_families.json` family `2443b24b0d14`, 167 stages), so any record
    landing there looks like a ctor on every stage it fits.  Those are flagged
    `is_stage_root_object` and must not be counted as members.
    """
    out = {}
    for stage, ov in overlays.items():
        if ov is None:
            continue
        confirmed = {row["id"] for row in members.get(stage, [])}
        hits = []
        for rec in records:
            if rec["ctor"] == 0 or rec["ctor_home"] != "stage":
                continue
            tick, why = tick_from_ctor(ov, rec["ctor"])
            if tick is None:
                continue
            start = iso.routine_start(ov, rec["ctor"] - OVERLAY_BASE)
            hits.append({
                "id": rec["id"], "id_hex": rec["id_hex"],
                "record_ctor": rec["ctor_hex"],
                "tick": "0x%08x" % tick["tick"],
                "family": tick_family.get((stage, tick["tick"])),
                "tick_at_overlay_base": tick["tick"] == OVERLAY_BASE,
                "routine_start": "0x%08x" % (OVERLAY_BASE + start),
                "confirmed_member": rec["id"] in confirmed,
            })
        if hits:
            out[stage] = hits
    return out


def draw_in_overlay(ov, addr):
    """Where a record's draw address lands in this stage's image."""
    if addr == 0:
        return "null (the original skips it)"
    if ov is None:
        return "no image"
    if not (OVERLAY_BASE <= addr < OVERLAY_BASE + ov["size"]):
        if FIELDSTG_BASE <= addr < FIELDSTG_BASE + 0x10000:
            return "fieldstg resident (same routine on every stage)"
        return "outside this stage's image"
    off = addr - OVERLAY_BASE
    if off in ov["words"]:
        return "a data word in this stage's image, not code"
    return "code in this stage's image (file 0x%x)" % off


def group_key(row):
    """One group's name.

    Prefer the decoded tick family, so the same object copied into two stages
    is one group.  Fall back to the tick address when no family hash is on
    record, then to the record's constructor (which groups the shared
    fieldstg records), then to "no tick".
    """
    if row.get("family"):
        return row["family"]
    if row.get("tick"):
        return "tick %s" % row["tick"]
    rec = row.get("record") or {}
    if rec.get("ctor_home") == "fieldstg":
        return "fieldstg record %s" % rec.get("ctor")
    if rec.get("ctor") == "0x00000000":
        return "no constructor (stage-created) %s" % row["id_hex"]
    return "unread %s" % row["id_hex"]


def group_by_family(members):
    """Members grouped by the tick family they install, ranked by coverage.

    One port of one family covers every stage and every script call in the
    group, so the ranking is by how much a single port buys.
    """
    groups = {}
    for stage, rows in members.items():
        for row in rows:
            key = group_key(row)
            g = groups.setdefault(key, {
                "family": key,
                "stages": [],
                "members": 0,
                "script_calls": 0,
                "ports": {},
                "example": [],
            })
            g["stages"].append(stage)
            g["members"] += 1
            g["script_calls"] += row["script_calls"]
            g["ports"][row["port"]] = g["ports"].get(row["port"], 0) + 1
            if len(g["example"]) < 6:
                g["example"].append({
                    "stage": stage, "id": row["id_hex"],
                    "tick": row.get("tick"), "port": row["port"]})
    out = []
    for g in groups.values():
        g["stages"] = sorted(set(g["stages"]), key=int)
        g["stage_count"] = len(g["stages"])
        out.append(g)
    out.sort(key=lambda g: (-g["stage_count"], -g["script_calls"], -g["members"], g["family"]))
    return out


# ── reporting ───────────────────────────────────────────────────────────────
def print_records(data):
    for rec in data["records"]:
        print("%s  ctor %s (%-8s)  draw %s (%-8s)" % (
            rec["id_hex"], rec["ctor_hex"], rec["ctor_home"],
            rec["draw_hex"], rec["draw_home"]))


def print_stage(data, stage):
    stage = stage.lstrip("s")
    rows = data["members"].get(stage)
    if not rows:
        print("no members for s%s" % stage)
        return
    for row in rows:
        rec = row.get("record") or {}
        print("%s  params %s  ctor %s  draw %s  tick %s  family %s  port %s" % (
            row["id_hex"], row["params"] or "-", rec.get("ctor", "-"),
            rec.get("draw", "-"), row.get("tick", "-"),
            row.get("family", "-"), row["port"]))
        for problem in row["problems"]:
            print("      ! %s" % problem)


def print_unresolved(data):
    for item in data["unresolved"]:
        if "id" in item:
            print("s%s id %s: %s" % (item["stage"], "0x%03x" % item["id"], item["reason"]))
    seen = set()
    for item in data["unresolved"]:
        if "id" not in item and item["stage"] not in seen:
            seen.add(item["stage"])
            print("s%s: %s" % (item["stage"], item["reason"]))


def print_doc_stages(data):
    """One row per stage: every member with its tick, family and port status."""
    print("| stage | id | params fired (arg2 arg3) | events | record ctor | "
          "tick installed | family | draw here | port |")
    print("|---|---|---|---|---|---|---|---|---|")
    for stage in sorted(data["members"], key=int):
        for row in data["members"][stage]:
            rec = row.get("record") or {}
            params = "; ".join(" ".join(str(x) for x in p) for p in row["params"]) or "-"
            events = ",".join(str(e) for e in row["events"]) or "-"
            print("| s%s | `%s` | %s | %s | %s | %s | %s | %s | %s |" % (
                stage, row["id_hex"], params, events, rec.get("ctor", "-"),
                row.get("tick", "-"), ("`%s`" % row["family"]) if row.get("family") else "-",
                row.get("draw_here", "-"), row["port"]))


def print_doc_groups(data):
    """One row per tick family: which stages and script calls one port covers."""
    print("| group | stages | members | script calls | ported | other | stages |")
    print("|---|---|---|---|---|---|---|")
    for g in data["tick_families"]:
        others = sum(v for k, v in g["ports"].items() if k != "ported")
        print("| `%s` | %d | %d | %d | %d | %d | %s |" % (
            g["family"], g["stage_count"], g["members"], g["script_calls"],
            g["ports"].get("ported", 0), others,
            " ".join("s%s" % s for s in g["stages"][:12]) +
            (" ..." if g["stage_count"] > 12 else "")))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", type=Path, default=None, help="write the JSON here")
    ap.add_argument("--records", action="store_true", help="the 56 registry records")
    ap.add_argument("--stage", default=None, help="one stage's members")
    ap.add_argument("--unresolved", action="store_true", help="gaps and reasons")
    ap.add_argument("--doc-stages", action="store_true",
                    help="markdown per-stage member table for the research doc")
    ap.add_argument("--doc-groups", action="store_true",
                    help="markdown per-family table for the research doc")
    args = ap.parse_args(argv)

    stages = sorted((p.stem[5:] for p in iso.ASM_DIR.glob("wstag*.s")), key=int)
    data = build(stages)
    s = data["summary"]

    if args.records:
        print_records(data)
        return 0
    if args.stage:
        print_stage(data, args.stage)
        return 0
    if args.unresolved:
        print_unresolved(data)
        return 0
    if args.doc_stages:
        print_doc_stages(data)
        return 0
    if args.doc_groups:
        print_doc_groups(data)
        return 0

    print("registry records      : %d  (fieldstg-owned %d, stage-owned %d)"
          % (s["records"], len(s["records_fieldstg_owned"]), s["records_stage_owned"]),
          file=sys.stderr)
    print("null constructor      : %d  %s" % (len(s["records_with_null_ctor"]),
                                              " ".join(s["records_with_null_ctor"])),
          file=sys.stderr)
    print("null draw             : %d  %s" % (len(s["records_with_null_draw"]),
                                              " ".join(s["records_with_null_draw"])),
          file=sys.stderr)
    print("overlays scanned      : %d (%d carry a recovered script table)"
          % (s["stages_scanned"], s["stages_with_a_script_table"]), file=sys.stderr)
    print("stages with members   : %d" % s["stages_with_members"], file=sys.stderr)
    print("members               : %d  ported %d / interpreter only %d / none %d"
          % (s["members_total"], s["members_ported"], s["members_interpreter_only"],
             s["members_none"]), file=sys.stderr)
    print("tick families         : %d" % s["tick_families"], file=sys.stderr)
    print("unresolved entries    : %d" % len(data["unresolved"]), file=sys.stderr)
    for line in s["broken_port_citations"]:
        print("BROKEN PORT CITATION: %s" % line, file=sys.stderr)
    print("ranked tick families (family, stages, members, script calls, ports):",
          file=sys.stderr)
    for g in data["tick_families"][:40]:
        print("  %-16s stages=%-3d members=%-3d calls=%-3d %s" % (
            g["family"], g["stage_count"], g["members"], g["script_calls"],
            " ".join("%s=%d" % (k, v) for k, v in sorted(g["ports"].items()))),
            file=sys.stderr)
    if len(data["tick_families"]) > 40:
        print("  ... %d more" % (len(data["tick_families"]) - 40), file=sys.stderr)

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(data, indent=1) + "\n")
        print("wrote %s" % args.out, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())