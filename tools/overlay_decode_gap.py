#!/usr/bin/env python3
"""What an overlay's existing decodes do NOT cover.

Given an overlay, list its functions that no evidence anchor and no claim
statement reaches. The point is to stop re-reading ground that is already
established, and to aim effort at the residue instead.

Coverage is judged four ways, deliberately kept apart because they are not the
same strength of knowledge:

  anchored    -- an evidence record cites this overlay's source at this
                 function. This is real establishment.
  named       -- a claim statement or a research document mentions the address,
                 with nothing anchored there. Per CLAUDE.md this is NOT prior
                 work; it means somebody wrote the address down.
  mechanical  -- classify_overlay_functions.py recognises the body as a derivable
                 shape (wrapper, setter, config block, the standard object
                 lifecycle). Not a knowledge gap: the tool emits its row.
  residue     -- none of the above. This is the real work queue.

**This tool UNDER-reports coverage, and knowing how matters more than the
count.** It matches ADDRESSES, and the project's reporting contract forbids
addresses in the plain-language overlay and system documents — so a function can
be read, written up in player language, extracted into shipped data and still be
counted here as untouched. That is not hypothetical:

  * `stgtrain` reported 50 of 60 undecoded on 2026-08-14. Its overlay document
    opens "53 functions, all read", 60 decompiled C files sit in
    `exe-decomp/stgtrain_c/`, its roll tables are extracted into
    `web/assets/data/progression.json`, and the gym ships. The 50 was the count
    of functions whose address nobody happened to type.
  * `stcrddek` reported 2 of 46 anchored while having been read in full twice.

So the header now prints the OTHER surfaces — the overlay document's own
coverage sentence, how many dated research documents name the overlay, and
whether a decompiled corpus exists — before any per-function number. Read those
first. A high residue count next to "the overlay doc says all read" means the
addresses were never written down, not that the work was never done.

Usage:
    python3 tools/overlay_decode_gap.py ststatus
    python3 tools/overlay_decode_gap.py fieldstg --show-named
    python3 tools/overlay_decode_gap.py stgtrain --residue-only
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

ADDR_RE = re.compile(r"0x[0-9a-fA-F]{8}")
LEDGER = pathlib.Path("docs/research/evidence/ledger.json")
DECOMP = pathlib.Path("exe-decomp")
DOCS = pathlib.Path("docs/research")


def overlay_functions(overlay: str) -> list[str]:
    d = DECOMP / f"{overlay}_c"
    if not d.is_dir():
        sys.exit(f"no decompiled directory for {overlay}")
    return sorted(f.stem.lstrip("F").lower() for f in d.glob("*.c"))


def load_ledger() -> tuple[dict, dict]:
    led = json.loads(LEDGER.read_text())
    ev = led["evidence"]
    ev = {e["id"]: e for e in ev} if isinstance(ev, list) else ev
    claims = led["claims"]
    claims = {c["id"]: c for c in claims} if isinstance(claims, list) else claims
    return ev, claims


def anchored_addresses(ev: dict, overlay: str) -> set[str]:
    """Addresses whose evidence cites THIS overlay's source.

    Scoping by source path matters: overlays share address ranges, so an anchor
    in another overlay at the same address says nothing about this one.
    """
    want = (f"{overlay}_c", f"pro/{overlay}.s", f"{overlay}.s")
    out: set[str] = set()
    for e in ev.values():
        src = str(e.get("source", ""))
        if not any(w in src for w in want):
            continue
        for field in ("locator", "summary", "exact"):
            out |= {a.lower() for a in ADDR_RE.findall(str(e.get(field, "")))}
    return out


def named_addresses(claims: dict, overlay: str) -> set[str]:
    """Addresses a claim statement mentions while naming this overlay."""
    out: set[str] = set()
    for c in claims.values():
        blob = json.dumps(c)
        if overlay not in blob:
            continue
        out |= {a.lower() for a in ADDR_RE.findall(blob)}
    return out


def mechanical_addresses(overlay: str) -> set[str]:
    """Functions classify_overlay_functions.py can write up without a person.

    Imported rather than re-implemented so the two tools cannot drift about what
    counts as boilerplate. A failure to import leaves the set empty, which only
    makes this tool report MORE residue — never less.
    """
    try:
        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
        from classify_overlay_functions import scan  # type: ignore
    except Exception:
        return set()
    try:
        rows = scan(DECOMP / f"{overlay}_c")
    except Exception:
        return set()
    return {str(r["addr"]).lower() for r in rows if r.get("auto")}


def other_surfaces(overlay: str) -> dict:
    """The coverage this tool cannot see by matching addresses.

    Every field here is a POINTER to read, never a verdict: the overlay
    document's own coverage sentence, the dated research documents that name the
    overlay, and whether a decompiled corpus exists at all.
    """
    out: dict = {"overlay_doc": None, "coverage_sentence": None,
                 "dated_docs": [], "decompiled": 0}
    d = DECOMP / f"{overlay}_c"
    if d.is_dir():
        out["decompiled"] = len(list(d.glob("*.c")))

    doc = DOCS / "overlays" / f"{overlay}.md"
    if doc.is_file():
        out["overlay_doc"] = str(doc)
        # The convention is a bolded coverage claim in the opening lines, e.g.
        # "**53 functions, all read**". Report it verbatim; do not parse a number
        # out of it and present that as measured coverage.
        head = doc.read_text(errors="replace").split("\n")[:12]
        for line in head:
            if re.search(r"\bfunctions?\b", line) and re.search(r"\d", line):
                out["coverage_sentence"] = line.replace("*", "").strip()
                break

    for f in sorted(DOCS.rglob("*.md")):
        if f == doc or "overlays/" in str(f):
            continue
        try:
            if overlay in f.read_text(errors="replace"):
                out["dated_docs"].append(str(f))
        except OSError:
            continue
    return out


def doc_addresses(overlay: str) -> set[str]:
    """Addresses appearing in any research document that names the overlay."""
    out: set[str] = set()
    for f in DOCS.rglob("*.md"):
        try:
            text = f.read_text(errors="replace")
        except OSError:
            continue
        if overlay not in text:
            continue
        out |= {a.lower() for a in ADDR_RE.findall(text)}
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("overlay")
    ap.add_argument("--show-named", action="store_true",
                    help="also list the merely-named functions")
    ap.add_argument("--residue-only", action="store_true",
                    help="print just the residue addresses, one per line")
    ap.add_argument("--json", type=pathlib.Path)
    args = ap.parse_args()

    fns = overlay_functions(args.overlay)
    ev, claims = load_ledger()
    anchored = anchored_addresses(ev, args.overlay)
    named = named_addresses(claims, args.overlay) | doc_addresses(args.overlay)
    mechanical = mechanical_addresses(args.overlay)

    rows = []
    for a in fns:
        if a in anchored:
            state = "anchored"
        elif a in named:
            state = "named"
        elif a in mechanical:
            state = "mechanical"
        else:
            state = "residue"
        rows.append((a, state))

    if args.residue_only:
        for a, state in rows:
            if state == "residue":
                print(f"0x{a[2:]}")
        return 0

    n = len(rows)
    states = ("anchored", "named", "mechanical", "residue")
    counts = {s: sum(1 for _, x in rows if x == s) for s in states}
    surfaces = other_surfaces(args.overlay)

    # The surfaces this tool cannot measure come FIRST, because the per-function
    # numbers below are an address match and have been read as a decode verdict
    # three times now.
    print(f"{args.overlay}: {n} functions")
    print()
    print("  READ THIS FIRST — coverage this tool cannot see:")
    if surfaces["overlay_doc"]:
        print(f"    overlay doc  : {surfaces['overlay_doc']}")
        if surfaces["coverage_sentence"]:
            print(f"    it says      : {surfaces['coverage_sentence']}")
    else:
        print("    overlay doc  : none")
    print(f"    dated docs   : {len(surfaces['dated_docs'])} naming this overlay")
    for f in surfaces["dated_docs"][:6]:
        print(f"                   {f}")
    if len(surfaces["dated_docs"]) > 6:
        print(f"                   ... and {len(surfaces['dated_docs']) - 6} more")
    print(f"    decompiled   : {surfaces['decompiled']} C files on disk")
    print()
    print("  address-matched coverage:")
    print(f"    anchored (real prior work) : {counts['anchored']:4d}")
    print(f"    named only (NOT prior work): {counts['named']:4d}")
    print(f"    mechanical (derivable)     : {counts['mechanical']:4d}")
    print(f"    residue                    : {counts['residue']:4d}")
    print()
    print("Per CLAUDE.md 'named only' is not prior work, so the nominal queue is")
    print(f"  named + residue = {counts['named'] + counts['residue']} functions —")
    print("but subtract whatever the documents above already cover in prose.")
    print("The plain-language docs are FORBIDDEN from printing addresses, so a")
    print("fully-read overlay can still score high here. Check before you read.")
    print()

    for a, state in rows:
        if state == "residue" or (state == "named" and args.show_named):
            print(f"  0x{a[2:]}  {state}")

    if args.json:
        args.json.write_text(json.dumps(
            {"overlay": args.overlay, "counts": counts, "surfaces": surfaces,
             "rows": [{"addr": a, "state": s} for a, s in rows]}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
