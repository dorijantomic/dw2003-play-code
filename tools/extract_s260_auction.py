#!/usr/bin/env python3
"""Extract the s260 Cargo Tower AUCTION -> web/assets/data/auction_lots.json.

WHAT A PLAYER MEETS.  The Cargo Tower (s260) is the game's auction house.  Walk
in while the story stands on one of the sixteen auction beats and Mr. Smith is
already calling the lot: the crowd shouts bids, he asks "Bid at N BIT?", and a
Yes/No box takes your answer.  Yes pays the bid out of your BIT and hands you
the lot's item; No just passes.  Either way the scene walks you out to the Water
Tunnel.

THE SYSTEM, from the disc (all `verified` ledger claims):

  * The lot cycle is `FIELDSTG_runStoryEvents` (pro/fieldstg.s, RAM 0x80084b40):
    on a field load it scans FIELDSTG_progressEvents (0x80096bb8, 16 records
    {s32 progress, s32 flag, s32 condition, s16 script, s16 nextScript}) and
    starts the first record whose `progress` equals the master story ordinal
    [0x8004b370], whose flag (0x400+N) is CLEAR, and whose condition (0x7074+j,
    "money >= MONEY_REQUIRED[j]") holds; when the script ends it starts
    `nextScript`, the lot's question event.
    Claims: fieldstg-progressevents-table-2026-10-09, fieldstg-events-choice-wiring-2026-10-09.
  * The question is one of the sixteen FIELDSTG_askChoice0-15 tasks; its text
    entry comes from FIELDSTG_choices (0x80096b38, {u32 text = 0x1190000|entry,
    s16 events[2]}).  Claim: fieldstg-choices-table-2026-10-09,
    fieldstg-auction-bid-questions-2026-10-09.
  * The two answers start the lot's accepted / pass event; when that event ends
    its FIELDSTG_endChoiceNAnswerM handler runs: Answer1 sets flag 0x400+N;
    Answer0 additionally applies 0x707E+j (money -= MONEY_LOSSES[j], floor 0) and
    the lot's item code (bag count at save+0x7C+id += 1, cap 0x63 = 99), then
    flag 0x400+N.  Claims: fieldstg-endchoice-flag-handlers-2026-10-09,
    fieldstg-endchoice-code-consequences-2026-10-09, fieldstg-auction-lot-items-2026-10-09.
  * The lot scripts are wstag260 bytecode (the game's only pure-bytecode stage
    overlay), wired into the events table FIELDSTG_events at 0x80099844 (66
    records {s32 id, void*script, s32 text, void*start, void*end}).  The
    accepted and pass scripts end `HANDOFF 530 766 165` = the tower's scripted
    force-exit to the Water Tunnel (s275).  Claim:
    auction-script-entry-join-by-speaker-signature, docs/research/field/
    s260-cargo-tower-auction-decoded-2026-07-10.md.

WHAT THIS TOOL READS (all read-only):

  * ~/ddw3/asm/dw2003/pro/wstag260.s — the 50 auction scripts, disassembled with
    the shared wstag disassembler (tools/wstag_events.py).
  * web/assets/native/fieldstg.bin — the resident fieldstg image.  The events
    table, the choices table and the progress-events table are read at their RAM
    addresses (image base 0x80082cb0).
  * ~/ddw3/asm/dw2003/pro/fieldstg.s — the 32 endChoice handler bodies, whose
    `li $a0` constants carry the money code, the item code and the flag.
  * web/assets/data/bank70_rewards.json — the bank-0x70 amount tables
    (MONEY_REQUIRED / MONEY_LOSSES) extracted from the static EXE data.
  * web/assets/events/esdmg260.json — the text bank: the question line of every
    lot must read "Bid at N BIT?" for that lot's bid (the tool's independent
    check on the bid ladder).
  * web/assets/data/battlecmd/esitmnam.json — the item-name bank, checked
    against the claimed lot items.

Run: python3 tools/extract_s260_auction.py   (reads ~/ddw3, read-only; writes
web/assets/data/auction_lots.json).  Fails loudly on any cross-check mismatch.
"""
import json
import os
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
OUT = ROOT / "web/assets/data/auction_lots.json"

FIELD_BIN = ROOT / "web/assets/native/fieldstg.bin"
FIELD_BASE = 0x80082CB0          # fieldstg overlay load address
OVERLAY_BASE = 0x800A5DE0        # every wstag overlay's load address
EVENTS_ADDR = 0x80099844         # FIELDSTG_events, 66 records of 0x14 + {-1}
CHOICES_ADDR = 0x80096B38        # FIELDSTG_choices, 16 records of 8
PROGRESS_ADDR = 0x80096BB8       # FIELDSTG_progressEvents, 16 records of 0x10 + {-1}

# The sixteen story ordinals the lots sit on — the SAME sixteen beats
# engine/systems/ordinal-scene-variant.ts carries (both jump tables in
# F0x80091E60 / F0x80084B40 name them).
EXPECTED_PROGRESS = [5, 8, 12, 14, 16, 22, 24, 26, 28, 30, 31, 34, 36, 37, 38, 39]
# The 16 lots' granted items, from claim fieldstg-auction-lot-items-2026-10-09.
EXPECTED_ITEMS = [281, 287, 282, 288, 137, 149, 124, 98,
                  222, 232, 244, 243, 257, 269, 258, 271]
EXPECTED_BIDS = [800, 800, 1600, 1600, 2700, 2700, 4000, 4000,
                 6000, 6000, 8700, 8700, 11500, 17500, 24000, 32000]


def money_index(n: int) -> int:
    """The lot's index into MONEY_REQUIRED / MONEY_LOSSES.

    Read from FIELDSTG_progressEvents and the Answer0 handlers, not assumed: the
    first twelve lots share an amount in pairs (j = n >> 1, the claim's ladder),
    and the last four each take their own rung (j = n - 6), which is why the
    table's ten words cover sixteen lots.
    """
    return n >> 1 if n <= 11 else n - 6
# The tower's scripted force-exit: every accepted and pass script ends with it.
FORCE_EXIT = (530, 766, 165)     # screen, x, y (dir 1)

sys.path.insert(0, str(ROOT / "tools"))
import wstag_events as we  # noqa: E402  (the shared bytecode disassembler)

# Op lengths (words): the same table tools/diag_wstag260_scripts.py proved the
# blob parses with end to end.  2.0 (SAY) is handled separately at 10 bytes.
OP_LENS = {
    (1, 0): 8, (1, 1): 8, (1, 2): 10,          # SETPOS / SETANIM / WALKTO
    (3, 0): 4, (3, 1): 2, (3, 2): 4, (3, 3): 4, (3, 4): 10,   # WAIT / WAITCTX / WAITIDLE / WAITFLAG / HANDOFF
    (6, 0): 6, (6, 1): 8,                       # FN6A / FN6B
}


def wstag260_bytes() -> bytes:
    """The overlay image: every `.word` of the splat, in file order."""
    text = (DDW3 / "asm/dw2003/pro/wstag260.s").read_text()
    words = re.findall(r"^\.L0x[0-9a-f]+: \.word (0x[0-9a-f]+)", text, re.M)
    return b"".join(struct.pack("<I", int(w, 16)) for w in words)


def walk_script(data: bytes, pc: int) -> tuple[list[str] | None, int]:
    """Walk one script from `pc` to its end. Returns (disasm lines, end pc).

    The last script (event 1409, lot 15's pass) runs to the end of the overlay
    with no END word; the data end is treated as the terminator, exactly as the
    runner's cursor would leave the blob.
    """
    lines: list[str] = []
    while pc + 2 <= len(data):
        word = struct.unpack_from("<H", data, pc)[0]
        major, sub = (word >> 8) & 0xFF, word & 0xFF
        sm = major if major < 128 else major - 256
        if sm == 0 or sm >= 7:
            lines.append("END")
            return lines, pc + 2
        if sm < 0:
            return None, pc
        if sm == 2:
            lines.append("SAY " + " ".join(str(v) for v in struct.unpack_from("<4h", data, pc + 2)))
            pc += 10
        elif (sm, sub) in OP_LENS:
            n = OP_LENS[(sm, sub)]
            operands = struct.unpack_from(f"<{n // 2 - 1}h", data, pc + 2)
            name = {(1, 0): "SETPOS", (1, 1): "SETANIM", (1, 2): "WALKTO",
                    (3, 0): "WAIT", (3, 1): "WAITCTX", (3, 2): "WAITIDLE",
                    (3, 3): "WAITFLAG", (3, 4): "HANDOFF",
                    (6, 0): "FN6A", (6, 1): "FN6B"}[(sm, sub)]
            lines.append(name + " " + " ".join(str(v) for v in operands))
            pc += n
        else:
            return None, pc
    # The blob ran out: the last script (event 1409, lot 15's pass) has no END
    # word, and the runner's cursor leaves the data there.  Treat the data end
    # as the terminator, exactly as the runner would.
    lines.append("END")
    return (lines if lines else None), pc


def segment_scripts(data: bytes) -> dict[int, list[str]]:
    """Every script in the overlay, keyed by file offset."""
    out: dict[int, list[str]] = {}
    pc = 0
    while pc + 2 <= len(data):
        lines, end = walk_script(data, pc)
        if lines is None:
            raise SystemExit(f"wstag260: parse break at {end:#x} (started {pc:#x})")
        out[pc] = lines
        pc = end
        while pc + 2 <= len(data) and struct.unpack_from("<H", data, pc)[0] == 0:
            pc += 2
    return out


def read_fieldstg_tables() -> tuple[list[dict], list[dict], list[dict]]:
    data = FIELD_BIN.read_bytes()

    def at(ram: int) -> int:
        return ram - FIELD_BASE

    events: list[dict] = []
    off = at(EVENTS_ADDR)
    for _ in range(200):
        eid, script, text, start, end = struct.unpack_from("<iIIII", data, off)
        if eid == -1:
            break
        events.append({"id": eid, "script": script, "text": text, "start": start, "end": end})
        off += 0x14
    else:
        raise SystemExit("events table: no -1 terminator in 200 records")

    choices = []
    off = at(CHOICES_ADDR)
    for i in range(16):
        text, e0, e1 = struct.unpack_from("<Ihh", data, off + i * 8)
        choices.append({"text": text, "entry": text & 0xFFFF, "accept": e0, "pass": e1})

    progress = []
    off = at(PROGRESS_ADDR)
    for _ in range(32):
        prog, flag, cond, script, nexts = struct.unpack_from("<iiiHH", data, off)
        if prog == -1:
            break
        progress.append({"progress": prog, "flag": flag & 0xFFFF, "condition": cond & 0xFFFF,
                         "script": script, "next": nexts})
        off += 0x10
    else:
        raise SystemExit("progressEvents: no -1 terminator in 32 records")
    return events, choices, progress


def read_endchoice_handlers(events: list[dict]) -> dict[int, dict]:
    """The 32 endChoice handlers, keyed by their RAM address.

    Each handler is a straight-line body: `li $a0, <code>` / set_flag call,
    repeated.  The money code (0x70xx), the item code (0x8xxx) and the flag
    (0x400+N) are read out of the `li $a0` immediates, in the order the handler
    applies them (claim fieldstg-endchoice-flag-handlers-2026-10-09).
    """
    text = (DDW3 / "asm/dw2003/pro/fieldstg.s").read_text()
    lines = text.splitlines()
    # fieldstg.s labels spell FILE OFFSETS (the overlay loads at FIELD_BASE), so
    # the label for RAM 0x800915a0 is `.L0x0000e8f0`.  Every instruction line
    # carries its own label, so map the label to the LINE INDEX and walk forward
    # to the routine's `jr $ra`.
    label_re = re.compile(r"^\.L0x([0-9a-f]{8}):")
    start_line: dict[int, int] = {}
    for i, line in enumerate(lines):
        m = label_re.match(line)
        if m:
            start_line[int(m.group(1), 16)] = i

    handlers: dict[int, dict] = {}
    for ev in events:
        ram = ev["end"]
        if ram == 0 or ram in handlers:
            continue
        i = start_line.get(ram - FIELD_BASE)
        if i is None:
            raise SystemExit(f"handler 0x{ram:08x} (event {ev['id']}) has no label in fieldstg.s")
        codes = []
        for line in lines[i:]:
            m = re.match(r"\.L0x[0-9a-f]+: li \$a0, (0x[0-9a-f]+)", line)
            if m:
                codes.append(int(m.group(1), 16))
            if "jr $ra" in line:
                break
        handlers[ram] = {"codes": codes}
    return handlers


def main() -> None:
    overlay = wstag260_bytes()
    scripts = segment_scripts(overlay)
    events, choices, progress = read_fieldstg_tables()
    handlers = read_endchoice_handlers(events)
    amounts = json.loads((ROOT / "web/assets/data/bank70_rewards.json").read_text())["amount_tables"]
    esdmg = json.loads((ROOT / "web/assets/events/esdmg260.json").read_text())
    item_names = json.loads((ROOT / "web/assets/data/battlecmd/esitmnam.json").read_text())["strings"]

    # --- the 66-record events table -----------------------------------------
    assert len(events) == 66, f"expected 66 event records, got {len(events)}"
    openers = [e for e in events if e["id"] in (1320, 1325)]
    assert [e["id"] for e in openers] == [1320, 1325], "the two opener records lead the table"
    for e in openers:
        assert e["script"] != 0 and e["start"] == 0 and e["end"] == 0, f"opener {e['id']} shape"

    # --- the sixteen lots ----------------------------------------------------
    lots = []
    for n in range(16):
        # Four consecutive ids per lot, stepping by 5: open / question / accepted / pass.
        want = [1331 + 5 * n, 1332 + 5 * n, 1333 + 5 * n, 1334 + 5 * n]
        rows = [e for e in events if e["id"] in want]
        assert [r["id"] for r in rows] == want, f"lot {n}: event ids {[r['id'] for r in rows]} != {want}"
        op, q, acc, pas = rows

        p = progress[n]
        assert p["progress"] == EXPECTED_PROGRESS[n], f"lot {n}: progress {p['progress']}"
        assert p["flag"] == 0x400 + n, f"lot {n}: flag {p['flag']:#x}"
        assert p["condition"] == 0x7074 + money_index(n), f"lot {n}: condition {p['condition']:#x}"
        assert p["script"] == op["id"] and p["next"] == q["id"], f"lot {n}: progress pair"

        # The question record: no script, no text; its start is askChoiceN.
        assert q["script"] == 0 and q["text"] == 0 and q["start"] != 0 and q["end"] == 0, \
            f"lot {n}: question record shape"
        # The accepted / pass records: a script, a text entry, an end handler.
        assert acc["script"] != 0 and acc["end"] != 0, f"lot {n}: accepted shape"
        assert pas["script"] != 0 and pas["end"] != 0, f"lot {n}: pass shape"

        ch = choices[n]
        assert ch["accept"] == acc["id"] and ch["pass"] == pas["id"], f"lot {n}: choices wiring"

        # The end handlers carry money code / item code / flag, in that order.
        acc_codes = handlers[acc["end"]]["codes"]
        pas_codes = handlers[pas["end"]]["codes"]
        assert len(acc_codes) == 3, f"lot {n}: Answer0 has {len(acc_codes)} li $a0 constants"
        assert len(pas_codes) == 1, f"lot {n}: Answer1 has {len(pas_codes)} li $a0 constants"
        money_code, item_code, flag_code = acc_codes
        assert money_code == 0x707E + money_index(n), f"lot {n}: money code {money_code:#x}"
        assert flag_code == 0x400 + n, f"lot {n}: Answer0 flag {flag_code:#x}"
        assert pas_codes[0] == 0x400 + n, f"lot {n}: Answer1 flag {pas_codes[0]:#x}"
        assert (item_code >> 8) & 0xFE in range(0x80, 0x90), f"lot {n}: item code bank {item_code:#x}"
        item = item_code & 0x1FF
        assert item == EXPECTED_ITEMS[n], f"lot {n}: item {item} != claimed {EXPECTED_ITEMS[n]}"

        # The bid: MONEY_REQUIRED[j] / MONEY_LOSSES[j] (identical ladders), and
        # the question text must say exactly that amount.
        j = money_index(n)
        assert amounts["compare"]["values"][j] == amounts["subtract"]["values"][j], f"lot {n}: ladders differ"
        bid = amounts["compare"]["values"][j]
        assert bid == EXPECTED_BIDS[n], f"lot {n}: bid {bid} != claimed {EXPECTED_BIDS[n]}"
        q_entry = esdmg[str(ch["entry"])]
        assert q_entry["type"] == "cutscene" and len(q_entry["strings"]) == 3, \
            f"lot {n}: question entry {ch['entry']} shape"
        m = re.search(r"Bid at (\d+) BIT\?", q_entry["strings"][0])
        assert m, f"lot {n}: question text does not ask for a bid: {q_entry['strings'][0]!r}"
        assert int(m.group(1)) == bid, f"lot {n}: text asks {m.group(1)}, table says {bid}"

        # Text entries per lot block: lot 0 is [open, accepted, choice, pass],
        # every later lot [open, choice, accepted, pass].
        base = 0 if n == 0 else 4 * n
        entries = ({"open": base, "accepted": base + 1, "choice": base + 2, "pass": base + 3}
                   if n == 0 else
                   {"open": base, "choice": base + 1, "accepted": base + 2, "pass": base + 3})
        assert ch["entry"] == entries["choice"], f"lot {n}: choice entry {ch['entry']}"
        assert (op["text"] & 0xFFFF) == entries["open"], f"lot {n}: open entry {op['text'] & 0xFFFF}"
        assert (acc["text"] & 0xFFFF) == entries["accepted"], f"lot {n}: accepted entry"
        assert (pas["text"] & 0xFFFF) == entries["pass"], f"lot {n}: pass entry"
        # Every text handle names region 0x119 = ESDMG260.
        for row in (op, acc, pas):
            assert (row["text"] >> 16) == 0x0119, f"lot {n}: text region {row['text'] >> 16:#x}"

        # Scripts: the open/accepted/pass disassembly, and the force-exit.
        def script_of(ram: int) -> list[str]:
            off = ram - OVERLAY_BASE
            assert off in scripts, f"lot {n}: script 0x{ram:08x} is not a script start"
            return scripts[off]

        open_d, acc_d, pass_d = script_of(op["script"]), script_of(acc["script"]), script_of(pas["script"])
        assert open_d[-1] == "END" and acc_d[-1] == "END" and pass_d[-1] == "END", f"lot {n}: script ends"
        for d in (acc_d, pass_d):
            handoffs = [ln for ln in d if ln.startswith("HANDOFF")]
            assert handoffs and handoffs[-1] == f"HANDOFF {FORCE_EXIT[0]} {FORCE_EXIT[1]} {FORCE_EXIT[2]} 1", \
                f"lot {n}: force-exit missing ({handoffs})"
        # SAY counts: every line of the entry is spoken, and every SAY that
        # names a line (p1 >= 1) names one of the entry's lines.  p1 = 0 SAYs
        # are spacing ops with no window (the runner reads string p1 - 1 = -1).
        def spoken_lines(dis: list[str]) -> set[int]:
            return {int(ln.split()[2]) for ln in dis if ln.startswith("SAY") and int(ln.split()[2]) >= 1}

        for kind in ("open", "accepted", "pass"):
            want = set(range(1, len(esdmg[str(entries[kind])]["strings"]) + 1))
            got = spoken_lines({"open": open_d, "accepted": acc_d, "pass": pass_d}[kind])
            assert got == want, f"lot {n}: {kind} SAY lines {sorted(got)} != entry lines {sorted(want)}"

        name = item_names[item] if item < len(item_names) else None
        lots.append({
            "n": n,
            "progress": p["progress"],
            "flag": p["flag"],
            "condition": p["condition"],
            "money_index": j,
            "bid": bid,
            "item": item,
            "item_code": f"0x{item_code:04x}",
            "item_name": name,
            "events": {"open": op["id"], "question": q["id"], "accepted": acc["id"], "pass": pas["id"]},
            "entries": entries,
            "handlers": {"question": f"0x{q['start']:08x}", "accept": f"0x{acc['end']:08x}", "pass": f"0x{pas['end']:08x}"},
        })

    # --- the 50 scripts ------------------------------------------------------
    scripted = [e for e in events if e["script"] != 0]
    assert len(scripted) == 50, f"expected 50 scripted events, got {len(scripted)}"
    by_id = {}
    for e in scripted:
        off = e["script"] - OVERLAY_BASE
        assert off in scripts, f"event {e['id']}: script 0x{e['script']:08x} is not a script start"
        by_id[str(e["id"])] = {"entry": e["text"] & 0xFFFF, "disasm": scripts[off]}

    out = {
        "_comment": (
            "The s260 Cargo Tower auction, read from the disc: the 16 lots of "
            "FIELDSTG_progressEvents/FIELDSTG_choices/FIELDSTG_events, the 50 wstag260 "
            "scripts disassembled, and the endChoice handlers' money/item/flag writes. "
            "Generated by tools/extract_s260_auction.py — do not hand-edit."
        ),
        "source": {
            "overlay": "pro/wstag260.s",
            "tables": "web/assets/native/fieldstg.bin (FIELDSTG_events 0x80099844, "
                      "FIELDSTG_choices 0x80096b38, FIELDSTG_progressEvents 0x80096bb8)",
            "handlers": "pro/fieldstg.s (FIELDSTG_endChoiceNAnswerM bodies)",
            "amounts": "web/assets/data/bank70_rewards.json (MONEY_REQUIRED/MONEY_LOSSES)",
            "text": "web/assets/events/esdmg260.json (region 0x119)",
            "claims": [
                "fieldstg-auction-bid-questions-2026-10-09",
                "fieldstg-auction-lot-items-2026-10-09",
                "fieldstg-choices-table-2026-10-09",
                "fieldstg-events-choice-wiring-2026-10-09",
                "fieldstg-progressevents-table-2026-10-09",
                "fieldstg-endchoice-flag-handlers-2026-10-09",
                "fieldstg-endchoice-code-consequences-2026-10-09",
                "auction-script-entry-join-by-speaker-signature",
            ],
        },
        "lots": lots,
        "openers": [{"event": e["id"], "entry": e["text"] & 0xFFFF} for e in openers],
        "events": by_id,
        "force_exit": {"screen": FORCE_EXIT[0], "x": FORCE_EXIT[1], "y": FORCE_EXIT[2], "stage": 275},
        "questions": {"text_bank": "esdmg260", "region": 0x0119, "answers": 2},
    }
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(lots)} lots, {len(by_id)} scripts, "
          f"bids {lots[0]['bid']}..{lots[-1]['bid']}")


if __name__ == "__main__":
    main()
