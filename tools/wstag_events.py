"""
Extract and disassemble bytecode event scripts from all wstag overlays.

Each stage sNNN has a wstag overlay (wstag/dw2003/pro/wstagNNN.s) whose event
table is located at a stage-descriptor pointer (+0x24).  Each 0x14-byte record
has the form:
  {event_id u32, script_ptr u32, flag_key u32, native_fn u32, on_complete_fn u32}
terminated by event_id == 0xffffffff.

script_ptr points into the overlay bytecode; a value of 0 means the event is
handled by a native-code scene controller (native_fn).

Bytecode format (fieldstg interpreter at 0x80084ecc):
  Stream of 16-bit words.  First word: high byte = major opcode (signed;
  0 or >=7 terminates), low byte = sub-opcode.  Operands are s16 words.

Opcode table (decoded from fieldstg disassembly, session 2026-06-12):
  0.x / >=7.x    END (2 bytes)
  1.0            SETPOS  actor x y          (8 bytes)
  1.1            SETANIM actor a b          (8 bytes)  -- a=anim, b=facing; id>=800 = effect obj
  1.2            WALKTO  actor x y mode     (10 bytes)
  2.x            SAY/BIND slot p1 actor mode (10 bytes) -- mode 4: textbox create
  3.0            WAIT    n                  (4 bytes)
  3.1            WAITCTX                    (2 bytes)
  3.2            WAITIDLE actor             (4 bytes)
  3.3            WAITFLAG actor             (4 bytes)
  3.4            HANDOFF id x y p           (10 bytes)
  6.0            FN6A    a b                (6 bytes)
  6.1            FN6B    a b c              (8 bytes)

Usage:
  python tools/wstag_events.py s200          # one stage, JSON to stdout
  python tools/wstag_events.py s200 s210     # multiple stages
  python tools/wstag_events.py --all         # all stages, full JSON
  python tools/wstag_events.py --all --stats # summary table to stderr, JSON to stdout
  python tools/wstag_events.py --all --quiet # stats only, no script text

Output JSON:
  { "s200": [ { "id": 50, "flag": 17956875, "script_offset": 704,
                "native_fn": 0, "on_complete_fn": 248,
                "disasm": ["SETPOS 1 1048 212", ...] }, ... ], ... }
"""

import os
import json
import re
import struct
import sys
from pathlib import Path

ASM_DIR = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro"
OVERLAY_BASE = 0x800A5DE0
EVENTS_DIR = Path(__file__).parent.parent / "web/assets/events"
SCREEN_TABLE = Path(__file__).parent.parent / "data/screen_table.json"


# ---------------------------------------------------------------------------
# Overlay loading
# ---------------------------------------------------------------------------

def overlay_bytes(stage: str) -> bytes | None:
    path = ASM_DIR / f"wstag{stage}.s"
    if not path.exists():
        return None
    words = re.findall(r"\.word (0x[0-9a-f]+)", path.read_text())
    return b"".join(struct.pack("<I", int(w, 16)) for w in words)


def is_overlay_ptr(v: int, data: bytes) -> bool:
    return OVERLAY_BASE <= v < OVERLAY_BASE + len(data)


# An event's handler does not have to live in the wstag overlay: a record may
# point native_fn (or on_complete_fn) straight at a RESIDENT fieldstg/EXE
# routine below the overlay window. s740's event 9016 does exactly that
# (0x8008bf38), and because the back-scan below used to require an overlay
# pointer it broke at that record and discarded the stage's ENTIRE 19-record
# table -- which is why s740 shipped with `"events": []` and none of its 16
# fire-trap events could ever resolve. Resident pointers are kept as absolute
# RAM in `*_fn_ram`; the `*_fn` overlay offsets stay 0 for them so every
# existing consumer (audit_stage_coverage, the decode table, the native
# overlay builder) keeps its "offset into this overlay" meaning.
EXE_TEXT_START = 0x80010000


def is_resident_ptr(v: int) -> bool:
    return EXE_TEXT_START <= v < OVERLAY_BASE


# ---------------------------------------------------------------------------
# Event table discovery
# ---------------------------------------------------------------------------

def is_valid_flag(flag: int) -> bool:
    if flag == 0:
        return True
    if flag < 0x100:
        return True
    hb = (flag >> 24) & 0xFF
    # Known flag namespaces: 0x01, 0x03, 0x05, 0x07, 0x09, 0x11, 0x13, 0x15
    return hb in (0x01, 0x03, 0x05, 0x07, 0x09, 0x11, 0x13, 0x15)


def find_event_table(data: bytes) -> list[dict]:
    """Find the event table by back-scanning from 0xffffffff terminators.

    Returns a list of dicts with keys: id, script_offset (or 0), flag,
    native_fn (or 0), on_complete_fn (or 0).
    """
    sz = len(data)
    best: list[dict] = []

    for off in range(0, sz - 4, 4):
        v = struct.unpack_from("<I", data, off)[0]
        if v != 0xFFFFFFFF:
            continue
        # Back-scan for valid 0x14-byte event records ending at `off`
        records: list[dict] = []
        cur = off - 0x14
        while cur >= 0:
            eid, scr, flag, nat, comp = struct.unpack_from("<5I", data, cur)
            if eid > 0x7FFF:
                break
            # scr must be overlay bytecode or 0; the two handler slots may also
            # point at a resident EXE routine (see is_resident_ptr).
            if scr != 0 and not is_overlay_ptr(scr, data):
                break
            if nat != 0 and not (is_overlay_ptr(nat, data) or is_resident_ptr(nat)):
                break
            if comp != 0 and not (is_overlay_ptr(comp, data) or is_resident_ptr(comp)):
                break
            # At least one of scr/nat must be non-zero (otherwise not a real event)
            if scr == 0 and nat == 0:
                break
            if not is_valid_flag(flag):
                break
            records.insert(0, {
                "id": eid,
                "flag": flag,
                "flag_key": f"{flag:08x}",
                "script_offset": scr - OVERLAY_BASE if scr else 0,
                "native_fn": nat - OVERLAY_BASE if is_overlay_ptr(nat, data) else 0,
                "native_fn_ram": nat,
                "on_complete_fn": comp - OVERLAY_BASE if is_overlay_ptr(comp, data) else 0,
                "on_complete_fn_ram": comp,
            })
            cur -= 0x14
        if len(records) > len(best):
            best = records

    return best


# ---------------------------------------------------------------------------
# Bytecode disassembler
# ---------------------------------------------------------------------------

def _s16(data: bytes, off: int) -> int:
    v = struct.unpack_from("<H", data, off)[0]
    return v - 0x10000 if v >= 0x8000 else v


def disassemble_script(data: bytes, offset: int) -> list[str]:
    """Disassemble bytecode script at byte offset within overlay data.

    Returns list of pseudo-assembly strings.  Stops at END or data overrun.
    Hard limit of 2000 instructions to guard against bad offsets.
    """
    pc = offset
    sz = len(data)
    ops: list[str] = []
    limit = 2000

    while pc + 2 <= sz and limit > 0:
        limit -= 1
        word = struct.unpack_from("<H", data, pc)[0]
        major = (word >> 8) & 0xFF
        sub = word & 0xFF
        smajor = major if major < 128 else major - 256

        if smajor == 0 or smajor >= 7:
            ops.append("END")
            break

        if smajor == 1:
            if sub == 0:  # SETPOS actor x y
                if pc + 8 > sz:
                    ops.append(f"SETPOS <truncated>")
                    break
                actor = _s16(data, pc + 2)
                x = _s16(data, pc + 4)
                y = _s16(data, pc + 6)
                ops.append(f"SETPOS {actor} {x} {y}")
                pc += 8
            elif sub == 1:  # SETANIM actor a b
                if pc + 8 > sz:
                    ops.append(f"SETANIM <truncated>")
                    break
                actor = _s16(data, pc + 2)
                a = _s16(data, pc + 4)
                b = _s16(data, pc + 6)
                ops.append(f"SETANIM {actor} {a} {b}")
                pc += 8
            elif sub == 2:  # WALKTO actor x y mode
                if pc + 10 > sz:
                    ops.append(f"WALKTO <truncated>")
                    break
                actor = _s16(data, pc + 2)
                x = _s16(data, pc + 4)
                y = _s16(data, pc + 6)
                mode = _s16(data, pc + 8)
                ops.append(f"WALKTO {actor} {x} {y} {mode}")
                pc += 10
            else:
                ops.append(f"OP1.{sub} <unknown sub>")
                break

        elif smajor == 2:  # SAY/BIND slot p1 actor mode
            if pc + 10 > sz:
                ops.append(f"SAY <truncated>")
                break
            slot = _s16(data, pc + 2)
            p1   = _s16(data, pc + 4)
            actor = _s16(data, pc + 6)
            mode  = _s16(data, pc + 8)
            ops.append(f"SAY {slot} {p1} {actor} {mode}")
            pc += 10

        elif smajor == 3:
            if sub == 0:  # WAIT n
                if pc + 4 > sz:
                    ops.append(f"WAIT <truncated>")
                    break
                n = _s16(data, pc + 2)
                ops.append(f"WAIT {n}")
                pc += 4
            elif sub == 1:  # WAITCTX
                ops.append("WAITCTX")
                pc += 2
            elif sub == 2:  # WAITIDLE actor
                if pc + 4 > sz:
                    ops.append(f"WAITIDLE <truncated>")
                    break
                actor = _s16(data, pc + 2)
                ops.append(f"WAITIDLE {actor}")
                pc += 4
            elif sub == 3:  # WAITFLAG actor
                if pc + 4 > sz:
                    ops.append(f"WAITFLAG <truncated>")
                    break
                actor = _s16(data, pc + 2)
                ops.append(f"WAITFLAG {actor}")
                pc += 4
            elif sub == 4:  # HANDOFF id x y p
                if pc + 10 > sz:
                    ops.append(f"HANDOFF <truncated>")
                    break
                sid = _s16(data, pc + 2)
                x   = _s16(data, pc + 4)
                y   = _s16(data, pc + 6)
                p   = _s16(data, pc + 8)
                ops.append(f"HANDOFF {sid} {x} {y} {p}")
                pc += 10
            else:
                ops.append(f"OP3.{sub} <unknown sub>")
                break

        elif smajor == 6:
            if sub == 0:  # FN6A a b
                if pc + 6 > sz:
                    ops.append(f"FN6A <truncated>")
                    break
                a = _s16(data, pc + 2)
                b = _s16(data, pc + 4)
                ops.append(f"FN6A {a} {b}")
                pc += 6
            elif sub == 1:  # FN6B a b c
                if pc + 8 > sz:
                    ops.append(f"FN6B <truncated>")
                    break
                a = _s16(data, pc + 2)
                b = _s16(data, pc + 4)
                c = _s16(data, pc + 6)
                ops.append(f"FN6B {a} {b} {c}")
                pc += 8
            else:
                ops.append(f"OP6.{sub} <unknown sub>")
                break

        else:
            ops.append(f"OP{smajor}.{sub} <unknown major>")
            break

    return ops


# ---------------------------------------------------------------------------
# Per-stage extraction
# ---------------------------------------------------------------------------

def _load_screen_table() -> dict[int, str]:
    if not SCREEN_TABLE.exists():
        return {}
    raw = json.loads(SCREEN_TABLE.read_text())
    return {int(k): f"s{v['stage']}" for k, v in raw.items()}


# region (flag_key high16) → esdmg file number. The AUTHORITATIVE bank selector:
# every event's flag_key = region<<16 | entry, and all events on a stage share one
# region (an esdmg text bank serves a whole region, not one map). Built lazily from
# the stages that own an exact esdmg{N}.json (e.g. s300 → region 0x127 → esdmg300),
# so e.g. s395 (region 0x127, no esdmg395) correctly resolves to esdmg300 instead of
# floor-picking esdmg305 (which belongs to the unrelated region 0x12e of s305).
_REGION_TO_FILE: dict[int, str] | None = None


def _build_region_map() -> dict[int, str]:
    global _REGION_TO_FILE
    if _REGION_TO_FILE is not None:
        return _REGION_TO_FILE
    m: dict[int, str] = {}
    for p in EVENTS_DIR.glob("esdmg*.json"):
        if not p.stem[5:].isdigit():
            continue
        num = p.stem[5:]
        data = overlay_bytes(num)              # the owning stage's overlay
        if data is None:
            continue                            # no wstag overlay → region unknown
        evs = find_event_table(data)
        if not evs:
            continue
        region = evs[0]["flag"] >> 16
        m.setdefault(region, num)               # first/owning file wins
    _REGION_TO_FILE = m
    return m


def _find_esdmg_area(stage: str, region: int | None = None) -> tuple[str, dict] | tuple[None, None]:
    """Return (area_key, esdmg_dict) for the best esdmg file for this stage.

    Prefers the file owning this event's flag_key region (the authoritative
    bank selector). Falls back to exact stage match, then to the largest
    available esdmg number <= the stage number. Returns (None,None) when no
    suitable file exists.
    """
    # Region-based selection (authoritative)
    if region is not None:
        area = _build_region_map().get(region)
        if area is not None:
            f = EVENTS_DIR / f"esdmg{area}.json"
            if f.exists():
                return area, json.loads(f.read_text())
    stage_num = int(stage)
    # Try exact match
    exact = EVENTS_DIR / f"esdmg{stage}.json"
    if exact.exists():
        return stage, json.loads(exact.read_text())
    # Collect all available esdmg numbers
    available = sorted(
        int(p.stem[5:]) for p in EVENTS_DIR.glob("esdmg*.json")
        if p.stem[5:].isdigit()
    )
    # Floor: largest available number <= stage_num
    candidates = [n for n in available if n <= stage_num]
    if not candidates:
        return None, None
    area = str(max(candidates))
    return area, json.loads((EVENTS_DIR / f"esdmg{area}.json").read_text())


def _match_esdmg(stage: str, events: list[dict]) -> None:
    region = events[0]["flag"] >> 16 if events else None
    area, esdmg = _find_esdmg_area(stage, region)
    if esdmg is None:
        for ev in events:
            ev.update(esdmg_stage=stage, esdmg_entry=None, esdmg_approx=False)
        return
    for ev in events:
        say_count = sum(1 for op in ev["disasm"] if op.startswith("SAY "))
        # Authoritative source: flag_key low16 IS the esdmg entry index
        # (flag_key = region<<16 | esdmg_entry; verified in
        #  docs/research/field-script-engine-verified.md §WS4.1). This supersedes
        # the SAY-count heuristic below, which mis-mapped events whose line count
        # collides with another entry (e.g. s200 PRE has 3 lines like entry 0, so
        # it was wrongly mapped to 0 instead of 11).
        flag_entry_idx = ev["flag"] & 0xFFFF
        flag_entry = esdmg.get(str(flag_entry_idx))
        if flag_entry is not None:
            # flag_key low16 IS the entry index — trust it whenever it resolves to a
            # real entry in the area bank. (We previously also required the entry's
            # string count to equal the SAY-op count, but a cutscene's SAY ops index a
            # SUBSET of the entry's strings — e.g. s410 event 142 has 2 SAYs into the
            # 3-string gondola entry 31 — so that check FALSELY rejected the authoritative
            # entry and fell through to the SAY-count guess below, which picked the wrong
            # same-line-count entry, e.g. esdmg400 #2 'Seiryu Leader…'.)
            ev.update(esdmg_stage=area, esdmg_entry=flag_entry_idx, esdmg_approx=False)
            continue
        # Fallback: SAY-count heuristic ONLY when flag low16 does not index a real entry
        # in the resolved area bank (rare — a region whose bank we can't pin exactly).
        if say_count == 0:
            ev.update(esdmg_stage=area, esdmg_entry=None, esdmg_approx=False)
            continue
        matches = [
            int(k) for k, e in esdmg.items()
            if len(e.get("strings", [])) == say_count
        ]
        if not matches:
            ev.update(esdmg_stage=area, esdmg_entry=None, esdmg_approx=False)
        elif len(matches) == 1:
            ev.update(esdmg_stage=area, esdmg_entry=matches[0], esdmg_approx=False)
        else:
            ev.update(esdmg_stage=area, esdmg_entry=matches[0], esdmg_approx=True)


def _resolve_handoffs(events: list[dict], screen_table: dict[int, str]) -> None:
    for ev in events:
        for op in ev["disasm"]:
            if op.startswith("HANDOFF "):
                parts = op.split()
                sid, hx, hy, hdir = int(parts[1]), int(parts[2]), int(parts[3]), int(parts[4])
                ev["handoff_to"] = screen_table.get(sid, None)
                ev["handoff_x"] = hx
                ev["handoff_y"] = hy
                ev["handoff_dir"] = hdir
                break


_SCREEN_TABLE: dict[int, str] = {}

def extract_stage(stage: str) -> list[dict] | None:
    data = overlay_bytes(stage)
    if data is None:
        return None
    events = find_event_table(data)
    for ev in events:
        if ev["script_offset"]:
            ev["disasm"] = disassemble_script(data, ev["script_offset"])
        else:
            ev["disasm"] = []
    _match_esdmg(stage, events)
    _resolve_handoffs(events, _SCREEN_TABLE)
    return events


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _all_stages() -> list[str]:
    return sorted(
        p.stem.replace("wstag", "")
        for p in ASM_DIR.glob("wstag*.s")
    )


def main():
    args = sys.argv[1:]
    do_all = "--all" in args
    do_stats = "--stats" in args
    do_quiet = "--quiet" in args
    output_path = None
    for i, a in enumerate(args):
        if a == "--output" and i + 1 < len(args):
            output_path = Path(args[i + 1])
            break
    # Accept both "200" and "s200" forms; skip --output and its value
    skip_next = False
    stages = []
    for a in args:
        if skip_next:
            skip_next = False
            continue
        if a == "--output":
            skip_next = True
            continue
        if a.startswith("--"):
            continue
        stages.append(a.lstrip("s") if a[:1] == "s" and a[1:].isdigit() else a)

    if do_all:
        stages = _all_stages()
    elif not stages:
        print(__doc__, file=sys.stderr)
        sys.exit(0)

    global _SCREEN_TABLE
    _SCREEN_TABLE = _load_screen_table()

    results: dict[str, list[dict]] = {}
    total_events = 0
    total_scripted = 0
    total_native = 0
    stages_with_events = 0

    for s in stages:
        evs = extract_stage(s)
        if evs is None:
            if not do_quiet and not do_all:
                print(f"# s{s}: overlay not found", file=sys.stderr)
            continue
        if evs:
            results[f"s{s}"] = evs
            total_events += len(evs)
            stages_with_events += 1
            for ev in evs:
                if ev["script_offset"]:
                    total_scripted += 1
                else:
                    total_native += 1

    if do_stats:
        print(
            f"Stages with events: {stages_with_events}/{len(stages)}  "
            f"Total events: {total_events}  "
            f"Bytecode: {total_scripted}  Native: {total_native}",
            file=sys.stderr,
        )
        if not do_quiet:
            for key, evs in results.items():
                ids_hex = " ".join(f"0x{ev['id']:x}" for ev in evs)
                print(f"  {key}: [{ids_hex}]", file=sys.stderr)

    if not do_quiet:
        out = json.dumps(results, indent=2)
        if output_path:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(out)
            print(f"Wrote {len(results)} stages to {output_path}", file=sys.stderr)
        else:
            print(out)


if __name__ == "__main__":
    main()
