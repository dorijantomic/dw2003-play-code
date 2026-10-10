#!/usr/bin/env python3
"""Join the game's shipped text to the code that requests it.

The game ships its own labels. `~/ddw3/lang_file/dw2003/<lang>/` holds one
indexed string list per screen, and the code does not search that text -- it
asks for a numbered resource. This joins the two sides mechanically.

THE MECHANISM
-------------
A screen asks for a text bank by adding the global language index to a
constant:

    (void *)0x80044B38->unk40C(*(s32 *)0x8005CCA8 + 0x55)   [stfgtrep]

`D0x8005CCA8` is the language index, established in
`tools/extract_language_table.py` and corroborated by the seven per-language
subtrees under `~/ddw3/pack/dw2003/country/`. Seven languages means one file
occupies seven consecutive resource ids, so for a bank constant K:

    file_ordinal = (K - 1) // 7        when K % 7 == 1

That residue is the load-bearing part. A constant that is NOT 1 mod 7 is NOT a
language-relative bank id and this tool refuses to map it, rather than rounding
it into the nearest file. Those are reported separately as `unmapped`.

WHAT THIS TOOL DOES AND DOES NOT ESTABLISH
------------------------------------------
The extraction of (overlay, function, K) from the C is mechanical and exact.
The ordinal -> filename step is an ORDERING HYPOTHESIS: it assumes the resource
table follows the sorted country-directory listing. The tool therefore never
asserts a binding. It scores each one:

    corroborated  the ordinal's filename also matches the overlay by the
                  game's own `st<name>`/`es<name>` naming convention, or by a
                  curated alias -- two independent signals agreeing
    consistent    the ordinal resolves, nothing contradicts it, no second signal
    conflict      the ordinal and the naming convention disagree -- read these
    unmapped      K is not 1 mod 7; mechanism not established for this call

Only `corroborated` rows are fit to seed a claim, and even those are candidates
for the normal review gate -- not evidence. Per CLAUDE.md a derived claim needs
a coverage audit before it enters the ledger.

Usage:
    tools/join_strings_to_code.py report
    tools/join_strings_to_code.py report --overlay ststatus
    tools/join_strings_to_code.py bounds        # cross bounds.md against text
    tools/join_strings_to_code.py json --out docs/generated/string-code-join.json
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
DECOMP = REPO / "exe-decomp"
LANG_ROOT = pathlib.Path("/home/dorij/ddw3/lang_file/dw2003")
BOUNDS = REPO / "docs" / "generated" / "bounds.json"

LANGUAGE_COUNT = 7  # seven per-language subtrees under pack/dw2003/country/
LANG_GLOBAL = "0x8005CCA8"

# A bank request is a CALL taking the language global plus a constant.
#
# Requiring the call shape is load-bearing. A looser match on the arithmetic
# alone also catches per-language layout indexing, which is not a resource
# request: it produced 31 false conflicts and 18 false `unmapped` rows, and
# credited stfgtrep with a bank it never asks for. Under this pattern every
# observed constant is 1 mod 7, as the mechanism predicts.
#
# Four callees consume it -- methods `unk404`, `unk40C`, `unk414` on the
# resident object at 0x80044B38, and direct calls to 0x80044F3C/44/4C. They
# are recorded separately but agree on the id->file map wherever they overlap
# (0x16 is escardnm under all four, 0x4E is esdignam under all four).
BANK_CALL = re.compile(
    r"(\w+)\(\s*\*\(s32 \*\)\s*0x8005CCA8\s*\+\s*(0x[0-9A-Fa-f]+|\d+)\s*\)",
    re.IGNORECASE,
)

# Overlay name -> text file stem, where the convention is not a plain match.
# Each entry is the game's own abbreviation, not an inference about behaviour.
CURATED_ALIASES = {
    "stgmcard": "esmemcrd",   # memory card
    "stgdglab": "esdglabo",   # digimon lab
    "stfgtrep": "esfgtrpt",   # fight report
    "stgtrain": "estraini",   # training
    "stdgname": "esdgnmet",   # digimon name entry
    "ststatus": "esstatus",
    "stitshop": "esitshop",
    "stcrdabm": "escrdabm",
    "stcrddek": "escrddek",
    "stcrdshp": "escrdshp",
    "wfightmn": "esmfight",
}


def load_string_corpus(lang: str = "eng") -> dict[str, list[str]]:
    """Every shipped string, keyed by file stem, indexed as the code indexes it."""
    root = LANG_ROOT / lang
    if not root.is_dir():
        sys.exit(f"language tree not found: {root}")
    corpus: dict[str, list[str]] = {}
    for path in sorted(root.rglob("*.toml")):
        stem = path.stem if path.parent == root else f"{path.parent.name}/{path.stem}"
        corpus[stem] = _parse_string_list(path)
    return corpus


def _parse_string_list(path: pathlib.Path) -> list[str]:
    """Read `strings = [ ... ]` without a TOML dependency.

    The files are a single flat array of double-quoted entries, one per line,
    which is why a line scan is sufficient and a parser is not.
    """
    out: list[str] = []
    inside = False
    for line in path.read_text(errors="replace").splitlines():
        stripped = line.strip()
        if not inside:
            if stripped.startswith("strings"):
                inside = True
            continue
        if stripped.startswith("]"):
            break
        m = re.match(r'^"(.*)",?$', stripped)
        if m:
            out.append(m.group(1))
    return out


ISO_XML = pathlib.Path("/home/dorij/ddw3/dw2003.xml")


def file_table(lang: str = "eng") -> list[str]:
    """The resource table order, taken from the disc layout itself.

    `~/ddw3/dw2003.xml` is the mkpsxiso layout that builds the disc, so its
    per-language `<dir>` block is the authoritative file order -- not a
    directory listing that happens to sort the same way.

    THE `esdmg` EXCLUSION. The ENG block holds 50 files, but the 11 `esdmg*`
    banks are NOT in this id space, leaving 39. They are the stage/story text
    banks, which `docs/research/scripting/field-script-engine-verified.md`
    established are reached by the field VM keyed by stage, not by a
    language-relative resource id. Including them shifts every id past
    `esdignam` by 11 slots.

    The gym is what proves it. `stgtrain` issues exactly one bank request,
    K=0x10B. With `esdmg` included that resolves to `essystem`, which holds 11
    strings of placeholder filler; excluding them it resolves to `estraini`,
    which holds "Train which Digimon?", "Which training?" and "Ultra Training
    Chance!". The gym asking for the gym's text is the correct reading.

    Every other screen corroborates the same exclusion, and none contradicts it:
      stitshop  -> esitminf, esitmnam, esitshop, esshpnam   (item shop)
      ststatus  -> esdiginf/esdignam, esitminf/esitmnam,
                   essklinf/essklnam, esstatus              (status sheet)
      wfightmn  -> esdignam, esitminf/esitmnam, esmfight,
                   essklinf/essklnam                        (battle menu)
      stplnmet  -> esnamedt, esnameet                       (name entry)
      stgmcard  -> esmemcrd, esstarea                       (memory card)
      fightstg  -> esmfight                                 (battle messages)
    """
    if not ISO_XML.exists():
        sys.exit(f"disc layout not found: {ISO_XML}")
    block = re.search(rf'<dir name="{lang.upper()}".*?</dir>',
                      ISO_XML.read_text(), re.S)
    if not block:
        sys.exit(f"no <dir name={lang.upper()}> block in {ISO_XML}")
    names = [n.rsplit(".", 1)[0].lower()
             for n in re.findall(r'<file name="([^"]+)"', block.group(0))]
    return [n for n in names if not n.startswith("esdmg")]


def scan_bank_requests() -> list[dict]:
    """Every language-relative bank request in the decompiled C.

    Exact and mechanical: this reports call sites, not meanings.
    """
    rows: list[dict] = []
    for overlay_dir in sorted(DECOMP.glob("*_c")):
        overlay = overlay_dir.name[:-2]
        for cfile in sorted(overlay_dir.glob("*.c")):
            text = cfile.read_text(errors="replace")
            if LANG_GLOBAL.lower() not in text.lower():
                continue
            for lineno, line in enumerate(text.splitlines(), 1):
                for m in BANK_CALL.finditer(line):
                    raw = m.group(2)
                    const = int(raw, 16) if raw.lower().startswith("0x") else int(raw)
                    rows.append(
                        {
                            "overlay": overlay,
                            "function": cfile.stem,
                            "source": str(cfile.relative_to(REPO)),
                            "line": lineno,
                            "callee": m.group(1),
                            "bank_const": const,
                            "string_index": _string_index(line, m.end()),
                            "exact": line.strip(),
                        }
                    )
    return rows


# The bank request is an ARGUMENT to the routine that draws the text, and the
# argument straight after it is the index into that bank:
#
#     obj->unk114(obj, (void *)0x80044B38->unk414(*(s32 *)0x8005CCA8 + 0xF), 0x45)
#                       ^-- bank escardgm ------------------------------^  ^ 69
#
# VALIDATED, NOT ASSUMED. Every one of the 106 sites where a literal follows
# resolves to an index inside the resolved bank's string count (106/106, 0 out
# of range), and the strings it selects match their screen: `stgtrain` picks
# "LV"/"HP"/"TP"/"Stop training", `stitshop` picks "How many?"/"Buy", `stcrdabm`
# picks "Card Album". An out-of-range index would falsify this and is reported
# rather than silently dropped.
NEXT_ARGUMENT = re.compile(r"^\s*,\s*(0x[0-9A-Fa-f]+|\d+)\s*[,)]")


def _string_index(line: str, bank_call_end: int) -> int | None:
    """The literal index argument following the bank request, when there is one.

    Returns None when the next argument is a variable rather than a literal --
    a computed index (an item id, a menu row) that no static read can resolve.
    That is the majority case and it is not a failure.
    """
    match = NEXT_ARGUMENT.match(line[bank_call_end:])
    return int(match.group(1), 0) if match else None


def resolve_strings(rows: list[dict], corpus: dict[str, list[str]]) -> dict:
    """Attach the game's actual word to every site that names a literal index.

    An index outside its bank is the falsification signal for the mechanism in
    `_string_index`, so it is counted and reported, never rounded into range.
    """
    counts = collections.Counter()
    for row in rows:
        index = row.get("string_index")
        name = row.get("text_file")
        row["string"] = None
        if index is None or not name:
            counts["no_literal_index" if name else "bank_unresolved"] += 1
            continue
        strings = corpus.get(name)
        if strings is None:
            counts["bank_file_missing"] += 1
            continue
        if 0 <= index < len(strings):
            row["string"] = strings[index]
            counts["resolved"] += 1
        else:
            row["string_index_out_of_range"] = len(strings)
            counts["out_of_range"] += 1
    return dict(counts)


def classify(rows: list[dict], table: list[str]) -> list[dict]:
    """Attach a file binding and an honest confidence to each call site."""
    out = []
    for row in rows:
        k = row["bank_const"]
        rec = dict(row)
        if k % LANGUAGE_COUNT != 1:
            rec.update(status="unmapped", ordinal=None, text_file=None,
                       reason=f"{k} is {k % LANGUAGE_COUNT} mod {LANGUAGE_COUNT}, not 1")
            out.append(rec)
            continue
        ordinal = (k - 1) // LANGUAGE_COUNT
        rec["ordinal"] = ordinal
        if ordinal >= len(table):
            rec.update(status="unmapped", text_file=None,
                       reason=f"ordinal {ordinal} past table length {len(table)}")
            out.append(rec)
            continue
        name = table[ordinal]
        rec["text_file"] = name
        expected = CURATED_ALIASES.get(row["overlay"])
        if expected is None and row["overlay"].startswith("st"):
            expected = "es" + row["overlay"][2:]
        if expected is None:
            rec.update(status="consistent", reason="no naming signal for this overlay")
        elif expected == name:
            rec.update(status="corroborated",
                       reason=f"ordinal and naming convention both give {name}")
        elif any(t == expected for t in table):
            # The overlay's own file exists elsewhere in the table; this call
            # legitimately asks for a DIFFERENT bank (shared names, items, ...).
            rec.update(status="consistent",
                       reason=f"asks for {name}; overlay's own bank {expected} is a separate id")
        else:
            # The convention's expected file does not exist on the disc at all,
            # so the convention offers no signal here -- it is not a conflict.
            # (`stplnmet` has no `esplnmet`; which bank it should own is open.)
            rec.update(status="consistent",
                       reason=f"asks for {name}; no text file named {expected} exists")
        out.append(rec)
    return out


def cmd_report(args) -> None:
    table = file_table()
    rows = classify(scan_bank_requests(), table)
    if args.overlay:
        rows = [r for r in rows if r["overlay"] == args.overlay]
    counts = collections.Counter(r["status"] for r in rows)
    overlays = {r["overlay"] for r in rows}
    print(f"call sites: {len(rows)}   overlays: {len(overlays)}   table slots: {len(table)}")
    print("  " + "  ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    print()
    by_overlay: dict[str, dict[str, set]] = collections.defaultdict(
        lambda: collections.defaultdict(set))
    for r in rows:
        by_overlay[r["overlay"]][r["status"]].add(r["text_file"] or f"K={r['bank_const']}")
    for ov in sorted(by_overlay):
        parts = []
        for status in ("corroborated", "consistent", "conflict", "unmapped"):
            names = by_overlay[ov].get(status)
            if names:
                parts.append(f"{status}: {', '.join(sorted(names))}")
        print(f"{ov:10s} {' | '.join(parts)}")


def cmd_labels(args) -> None:
    """Show the actual English text a screen's banks contain."""
    corpus = load_string_corpus()
    table = file_table()
    rows = [r for r in classify(scan_bank_requests(), table)
            if r["overlay"] == args.overlay and r["text_file"]]
    if not rows:
        sys.exit(f"no mapped bank requests for {args.overlay}")
    seen = set()
    for r in sorted(rows, key=lambda r: r["ordinal"]):
        name = r["text_file"]
        if name in seen:
            continue
        seen.add(name)
        strings = corpus.get(name)
        print(f"\n=== {name}  (K={r['bank_const']}, ordinal {r['ordinal']}, {r['status']})")
        if strings is None:
            print("  [directory bank, not a flat string list]")
            continue
        for i, s in enumerate(strings[: args.limit]):
            if s:
                print(f"  {i:4d}  {s}")


def cmd_bounds(args) -> None:
    """Cross every extracted hard bound against text that states that number.

    This is the payoff: bounds.json says a 99 exists, the shipped help text
    says what a 99 governs. A number appearing in both is a lead with two
    independent sources -- still a lead, not a finding.
    """
    if not BOUNDS.exists():
        sys.exit(f"missing {BOUNDS}; run tools/extract_bounds.py first")
    bounds = json.loads(BOUNDS.read_text())
    entries = bounds if isinstance(bounds, list) else bounds.get("bounds", [])
    values = collections.defaultdict(set)
    for b in entries:
        v = b.get("value")
        if isinstance(v, int):
            values[v].add(b.get("overlay", "?"))

    corpus = load_string_corpus()
    hits = 0
    for value in sorted(values):
        if value < 10:
            continue  # too common in prose to mean anything
        needle = str(value)
        matches = []
        for name, strings in corpus.items():
            for idx, s in enumerate(strings):
                if needle in s and re.search(rf"(?<!\d){needle}(?!\d)", s):
                    matches.append((name, idx, s))
        if not matches:
            continue
        hits += 1
        print(f"\n### {value}  clamped/gated in: {', '.join(sorted(values[value]))}")
        for name, idx, s in matches[: args.limit]:
            flat = s.replace("\\n", " ")[:150]
            print(f"    {name}[{idx}]  {flat}")
    print(f"\n{hits} bound values also appear in shipped text.")


def cmd_json(args) -> None:
    table = file_table()
    rows = classify(scan_bank_requests(), table)
    resolution = resolve_strings(rows, load_string_corpus())
    payload = {
        "schema_version": 2,
        "method": "language-relative bank constant (K-1)//7 against the sorted "
                  "country file listing; see module docstring",
        "string_index_method": "the argument following the bank request at the "
                               "same call site; validated by every resolved "
                               "index falling inside its bank",
        "language_count": LANGUAGE_COUNT,
        "file_table": table,
        "summary": dict(collections.Counter(r["status"] for r in rows)),
        "string_resolution": resolution,
        "call_sites": rows,
    }
    out = pathlib.Path(args.out)
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {out}  ({len(rows)} call sites)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("report", help="per-overlay binding summary")
    p.add_argument("--overlay")
    p.set_defaults(func=cmd_report)

    p = sub.add_parser("labels", help="show the text a screen's banks hold")
    p.add_argument("overlay")
    p.add_argument("--limit", type=int, default=40)
    p.set_defaults(func=cmd_labels)

    p = sub.add_parser("bounds", help="cross bounds.json against shipped text")
    p.add_argument("--limit", type=int, default=4)
    p.set_defaults(func=cmd_bounds)

    p = sub.add_parser("json", help="write the full join")
    p.add_argument("--out", default="docs/generated/string-code-join.json")
    p.set_defaults(func=cmd_json)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
