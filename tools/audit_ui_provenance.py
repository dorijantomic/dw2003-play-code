#!/usr/bin/env python3
"""Audit how much of the walker's menu geometry is read from the original game
versus measured off a screenshot.

Every menu screen ships a `web/assets/data/<screen>_ui.json` describing its
layout. Those files already carry human-written provenance notes (`provenance`,
`disasm`, `note`, `status`, `_source`), but the notes are prose scattered across
eleven files, so nobody can answer "how much of this is still guesswork" without
reading all of them.

This script answers it mechanically. It walks every geometry number in those
files, finds the provenance note governing it, and bins it:

  runtime   the value was compared against the real console (rig, framebuffer,
            save state, RAM read) -- the strongest evidence there is
  traced    the value was read out of the original code (disassembly, a named
            function, an overlay line reference)
  measured  the value was eyeballed off a screenshot or otherwise guessed --
            this is the number we are trying to drive to zero
  unknown   no provenance note governs the value at all

`unknown` is not innocent. It means nobody wrote down where the number came
from, so it is guesswork until proven otherwise; the summary counts it against
us alongside `measured`.

Usage:
    .venv/bin/python3 tools/audit_ui_provenance.py            # summary table
    .venv/bin/python3 tools/audit_ui_provenance.py --detail   # every unresolved value
    .venv/bin/python3 tools/audit_ui_provenance.py --screen stgtrain
    .venv/bin/python3 tools/audit_ui_provenance.py --json     # machine-readable
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
UI_DATA = REPO / "web" / "assets" / "data"

# Keys whose values are screen geometry. Matched case-insensitively against the
# whole key, or as a prefix/suffix for the compound forms the extractors emit
# (`iconX`, `cellW`, `x0`, `text_y`, ...).
GEOMETRY_EXACT = {
    "x", "y", "w", "h", "cx", "cy", "dx", "dy",
    "x0", "y0", "x1", "y1", "w0", "h0",
    "left", "top", "right", "bottom",
    "width", "height", "cols", "rows", "pitch", "stride",
    "originx", "originy", "anchorx", "anchory",
    "cellw", "cellh", "colw", "rowh", "step", "spacing", "gap",
    "padx", "pady", "offsetx", "offsety",
}
GEOMETRY_PATTERN = re.compile(
    r"(^|_)(x|y|w|h)\d*$|"
    r"(x|y|w|h)$|"
    r"(pos|origin|anchor|coord|rect|bbox|geom|offset|inset|margin|pad)",
    re.IGNORECASE,
)

# Keys that hold a provenance note rather than data.
NOTE_KEYS = ("provenance", "disasm", "_provenance", "_source", "source",
             "note", "notes", "status", "verified", "evidence", "x_note")

RUNTIME_RE = re.compile(
    r"\brig\b|framebuffer|save[\s_-]?state|sstate|pcsx|redux|"
    r"\bRAM\b|runtime (?:read|capture|compare)|live[\s-]",
    re.IGNORECASE,
)
TRACED_RE = re.compile(
    r"\bdisasm\b|disassembl|\bTRACED\b|\bF0x[0-9a-fA-F]{8}\b|\bD0x[0-9a-fA-F]{8}\b|"
    r"\.s L0x|\.s L\d|decompil|exe-decomp|\bm2c\b|assembly|transcri|"
    r"\bsp[0-9A-Fa-f]{2}\(|vtable|slot \+?0x|"
    # A note naming the original overlay source file, an extractor that reads
    # it, or a concrete table address is citing the game, not a screenshot.
    r"\b\w+\.s\b|tools/extract_\w+\.py|@ ?0x8[0-9a-fA-F]{6,7}\b|"
    # A value taken from an extracted original data file (a language TOML, an
    # extracted pack) is game-derived too, even though it is not disassembly.
    r"lang_file/|\b\w+\.toml\b|\bes[a-z]{4,8}\b",
    re.IGNORECASE,
)
MEASURED_RE = re.compile(
    r"pixel[\s-]?measured|measured off|off a (?:live )?screenshot|"
    r"eyeball|\bguess(?:ed|work)?\b|approximat|by hand|hand-?tuned|"
    r"\bNOT a disasm fact\b|placeholder|interim|fabricat",
    re.IGNORECASE,
)

# An explicit announcement that a previously weak value has been resolved. Such
# a note usually quotes the old measured value, which would otherwise make the
# corrected value read as still-measured.
RESOLVED_RE = re.compile(
    r"\b(TRACED|RESOLVED|CORRECTED)\b(?=[^.]{0,80}\b(replac|supersed|instead "
    r"of|rather than|was|old)\b)|"
    r"\b(TRACED|RESOLVED|CORRECTED) \d{4}-\d{2}-\d{2}\b")

VERDICTS = ("runtime", "traced", "measured", "unknown")


@dataclass
class Finding:
    screen: str
    path: str
    value: object
    verdict: str
    reason: str


@dataclass
class ScreenReport:
    screen: str
    counts: dict = field(default_factory=lambda: dict.fromkeys(VERDICTS, 0))
    findings: list = field(default_factory=list)
    open_gaps: list = field(default_factory=list)

    @property
    def total(self) -> int:
        return sum(self.counts.values())

    @property
    def solid(self) -> int:
        return self.counts["runtime"] + self.counts["traced"]


def is_geometry_key(key: str) -> bool:
    k = key.lower()
    if k in GEOMETRY_EXACT:
        return True
    # Avoid matching note/id/string keys that happen to end in a letter.
    if k in {"index", "max", "type", "id", "kind", "page", "clip", "pack"}:
        return False
    return bool(GEOMETRY_PATTERN.search(k))


def classify(note: str) -> tuple[str, str]:
    """Classify a provenance note.

    Measured normally wins over traced when both appear, because a note saying
    "traced, but these two anchors are pixel-measured" is flagging the weaker
    half and that is the half we care about. The exception is a note that
    explicitly announces a resolution -- "TRACED 2026-08-05, replacing the
    pixel-measured (112,192)" -- where the measured wording is describing what
    the value USED to be.
    """
    if not note:
        return "unknown", ""
    resolved = RESOLVED_RE.search(note)
    if (m := MEASURED_RE.search(note)) and not resolved:
        return "measured", m.group(0)
    if m := RUNTIME_RE.search(note):
        return "runtime", m.group(0)
    if m := TRACED_RE.search(note):
        return "traced", m.group(0)
    return "unknown", ""


def classify_with_fallback(own: str, inherited: str) -> tuple[str, str]:
    """Classify by the value's own note, falling back to the section's."""
    verdict, reason = classify(own)
    if verdict != "unknown":
        return verdict, reason
    return classify(inherited)


def collect_note(obj: dict) -> str:
    """Join every provenance note attached directly to this object."""
    parts = []
    for k in NOTE_KEYS:
        v = obj.get(k)
        if isinstance(v, str):
            # Keep the key name in the text: a `disasm` key is itself the
            # claim that the value was read out of the original code, even
            # when its prose is a bare file offset.
            parts.append(f"{k}: {v}")
    return "\n".join(parts)


def walk(node, screen: str, report: ScreenReport, path: str = "",
         inherited_note: str = "") -> None:
    if isinstance(node, dict):
        # A value's own note takes precedence, and it falls back to the
        # section's note only when it says nothing conclusive itself. Combining
        # the two is wrong in both directions: a child's weak note ("role
        # unresolved") would discard the section's disasm citation, while a
        # section's prose ("the old doc guessed at this pack") would leak the
        # word "guessed" onto children that carry their own disasm.
        note = collect_note(node)
        effective = (note, inherited_note)
        for key, value in node.items():
            if key in NOTE_KEYS:
                continue
            sub = f"{path}.{key}" if path else key
            if isinstance(value, (dict, list)):
                walk(value, screen, report, sub, note or inherited_note)
            elif isinstance(value, bool):
                continue
            elif isinstance(value, (int, float)) and is_geometry_key(key):
                verdict, reason = classify_with_fallback(*effective)
                report.counts[verdict] += 1
                report.findings.append(
                    Finding(screen, sub, value, verdict, reason))
    elif isinstance(node, list):
        # Lists of coordinate pairs/quads are common; index them positionally.
        for i, value in enumerate(node):
            if isinstance(value, (dict, list)):
                walk(value, screen, report, f"{path}[{i}]", inherited_note)


def audit_file(path: Path) -> ScreenReport:
    screen = path.stem.replace("_ui", "")
    report = ScreenReport(screen)
    data = json.loads(path.read_text())
    walk(data, screen, report)
    gaps = data.get("open_gaps") if isinstance(data, dict) else None
    if isinstance(gaps, list):
        report.open_gaps = [g if isinstance(g, str) else json.dumps(g)
                            for g in gaps]
    return report


# Geometry does not only live in the *_ui.json files. Where a screen's layout
# was never extracted, the walker module carries the numbers inline and says so
# in a comment. Those admissions are the other half of the honest tally.
WEB = REPO / "web"
CODE_MARKER_RE = re.compile(
    r"pixel[\s-]?measured|approximat\w*|eyeball\w*|hand-?tuned|"
    r"\bguess(?:ed|ing|work)?\b|\bnot disasm\b|\binterim\b",
    re.IGNORECASE,
)
# Comments that describe the rule ("do not fill with guesses", "rather than
# guessing") are policy statements, not admissions of a guessed value.
CODE_EXEMPT_RE = re.compile(
    r"without guessing|rather than guessing|do not fill with guesses|"
    r"violate the no-guessing rule|instead of guessed|no-guessing",
    re.IGNORECASE,
)


def audit_code() -> list[tuple[str, int, str]]:
    """Return (file, line, text) for each self-reported approximation in the
    walker's UI modules."""
    hits = []
    for path in sorted(WEB.glob("*.js")):
        try:
            lines = path.read_text(errors="replace").splitlines()
        except OSError:
            continue
        for n, line in enumerate(lines, 1):
            if "//" not in line and "*" not in line:
                continue
            if CODE_EXEMPT_RE.search(line):
                continue
            if CODE_MARKER_RE.search(line):
                hits.append((path.name, n, line.strip()))
    return hits


SELF_TEST_CASES = [
    # (own note, inherited note, expected verdict)
    ("pixel-measured off a screenshot", "", "measured"),
    ("eyeballed until it looked right", "", "measured"),
    ("this is a placeholder", "", "measured"),
    ("", "", "unknown"),
    ("role unresolved -- candidate: percent-format string", "", "unknown"),
    ("disasm: file 0x2234 a2=0x10 a3=0x20", "", "traced"),
    ("F0x80086c0c draws it", "", "traced"),
    ("verified against the rig framebuffer save state 5", "", "runtime"),
    # A weak own note must fall back to the section's citation, not bury it.
    ("role unresolved", "disasm: F0x80085ecc", "traced"),
    # A section's prose must NOT override a value's own measurement...
    ("pixel-measured 2026-07-12", "disasm: F0x80086c0c", "measured"),
    # ...nor leak a historical "guessed" onto a value that cites code.
    ("disasm: stplnmet.s L5563", "the old todo doc guessed at this pack",
     "traced"),
    # An explicit correction quoting the superseded measurement reads as traced.
    ("TRACED 2026-08-05, replacing the pixel-measured (112,192)", "", "traced"),
    # But merely mentioning tracing elsewhere does not launder a measurement.
    ("box is pixel-measured; the plate around it is traced", "", "measured"),
]


def self_test() -> int:
    failures = []
    for own, inherited, expected in SELF_TEST_CASES:
        got, _ = classify_with_fallback(own, inherited)
        if got != expected:
            failures.append((own, inherited, expected, got))
    for own, inherited, expected, got in failures:
        print(f"FAIL expected={expected} got={got}\n  own={own!r}\n"
              f"  inherited={inherited!r}")
    print(f"self-test: {len(SELF_TEST_CASES) - len(failures)}"
          f"/{len(SELF_TEST_CASES)} passed")
    return 1 if failures else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--screen", help="audit one screen only")
    ap.add_argument("--detail", action="store_true",
                    help="list every measured/unknown value")
    ap.add_argument("--json", action="store_true", dest="as_json",
                    help="emit machine-readable output")
    ap.add_argument("--self-test", action="store_true",
                    help="check the classifier still bins known notes "
                         "correctly (guards against a lenient rule turning "
                         "every value 'traced')")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    files = sorted(UI_DATA.glob("*_ui.json"))
    if args.screen:
        files = [f for f in files if f.stem.replace("_ui", "") == args.screen]
        if not files:
            print(f"no such screen: {args.screen}", file=sys.stderr)
            return 2
    if not files:
        print(f"no *_ui.json under {UI_DATA}", file=sys.stderr)
        return 2

    reports = [audit_file(f) for f in files]

    code_hits = [] if args.screen else audit_code()

    if args.as_json:
        print(json.dumps({
            "code_approximations": [
                {"file": f, "line": n, "text": t} for f, n, t in code_hits],
            "screens": [{
                "screen": r.screen,
                "counts": r.counts,
                "total": r.total,
                "open_gaps": len(r.open_gaps),
                "findings": [vars(f) for f in r.findings],
            } for r in reports],
        }, indent=1))
        return 0

    width = max(len(r.screen) for r in reports)
    print(f"{'screen':<{width}}  {'runtime':>7} {'traced':>6} "
          f"{'measured':>8} {'unknown':>7}  {'total':>5}  {'solid':>6}  gaps")
    print("-" * (width + 52))
    totals = dict.fromkeys(VERDICTS, 0)
    for r in sorted(reports, key=lambda r: (r.solid / r.total if r.total else 1)):
        for k in VERDICTS:
            totals[k] += r.counts[k]
        pct = f"{100 * r.solid / r.total:.0f}%" if r.total else "--"
        print(f"{r.screen:<{width}}  {r.counts['runtime']:>7} "
              f"{r.counts['traced']:>6} {r.counts['measured']:>8} "
              f"{r.counts['unknown']:>7}  {r.total:>5}  {pct:>6}  "
              f"{len(r.open_gaps)}")
    grand = sum(totals.values())
    solid = totals["runtime"] + totals["traced"]
    print("-" * (width + 52))
    print(f"{'ALL':<{width}}  {totals['runtime']:>7} {totals['traced']:>6} "
          f"{totals['measured']:>8} {totals['unknown']:>7}  {grand:>5}  "
          f"{100 * solid / grand:.0f}%" if grand else "no values found")

    if code_hits:
        by_file: dict[str, int] = {}
        for f, _, _ in code_hits:
            by_file[f] = by_file.get(f, 0) + 1
        print(f"\nself-reported approximations in walker UI code: "
              f"{len(code_hits)} across {len(by_file)} files")
        for f, n in sorted(by_file.items(), key=lambda kv: -kv[1]):
            print(f"   {n:>3}  web/{f}")
        if args.detail:
            print()
            for f, n, t in code_hits:
                print(f"   web/{f}:{n}  {t[:150]}")

    if args.detail:
        for r in reports:
            weak = [f for f in r.findings if f.verdict in ("measured", "unknown")]
            if not weak:
                continue
            print(f"\n== {r.screen}: {len(weak)} unresolved")
            for f in weak:
                tag = "MEASURED" if f.verdict == "measured" else "unknown "
                extra = f"  ({f.reason})" if f.reason else ""
                print(f"   {tag}  {f.path} = {f.value}{extra}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
