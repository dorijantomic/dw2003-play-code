#!/usr/bin/env python3
"""Every doc section that declares work OPEN must name a frontier id.

Why this exists
---------------
On 2026-08-17 a handoff shipped a section titled "What is genuinely open" whose
every claim was already decoded -- one part of it by that same session. The
section's own last line was "Record it against a frontier, because it has none."
That sentence was the tell, and nothing checked it.

An unbound "open" section is unfalsifiable: `frontiers` never lists it, so
`completion-check` cannot see it, and the next session reads it as live work.
A frontier id forces the assertion through the ledger, where a resolved status
or a contradicting claim would be visible.

This is the third round of the same failure. The tools were fixed on 2026-08-05
(a falsified census re-derived every run for a month), the cross-quoting docs the
same day, and the doc HEADERS on 2026-08-17. Prose is not checkable; a required
identifier is.

What counts as a violation
--------------------------
A heading that declares open work, whose section body contains no frontier id
(`ABCD-Q123`), no ledger claim id reference, and no explicit waiver.

Waive a section deliberately with a line containing `no-frontier:` plus a
reason, e.g.

    <!-- no-frontier: closed 2026-08-05, see claim foo-bar; kept for history -->

Adoption
--------
`--write-baseline` records today's violations so the check fails only on NEW
ones. Fix a baselined section by removing its entry.

The baseline lives under `docs/research/`, which is an INDEXED source, so writing
it marks the research index stale -- run `./dw3-research index` afterwards or
`handoff-check` will report staleness errors that look unrelated to this guard.

Usage
-----
    tools/check_open_work_frontiers.py                 # check (honours baseline)
    tools/check_open_work_frontiers.py --write-baseline
    tools/check_open_work_frontiers.py --all           # ignore baseline, show everything
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BASELINE = REPO / "docs/research/infra/open-work-frontier-baseline.json"

SCAN_DIRS = ("docs/todo", "docs/research")

# A frontier id, e.g. WORLD-Q002, CARD-Q001, UI-Q002.
FRONTIER_RE = re.compile(r"\b[A-Z][A-Z0-9]{1,12}-Q\d{2,4}\b")

# A ledger claim reference. Claim ids are kebab-case and long enough to be
# distinctive; requiring 3+ segments keeps ordinary hyphenated prose out.
CLAIM_RE = re.compile(r"\b[a-z0-9]+(?:-[a-z0-9]+){2,}\b")

WAIVER_RE = re.compile(r"no-frontier:", re.I)

# Headings that declare live work. Deliberately narrow: heading text only, never
# body prose, because body prose produces false positives on every history note.
OPEN_HEADING_RE = re.compile(
    r"""(?xi)
    (?:^|\W)
    (?: genuinely\s+open
      | (?:what|which)\s+(?:is|are|remains?)\s+(?:still\s+)?open
      | still\s+open
      | what\s+is\s+left
      | open\s+(?:questions?|work|items?|frontiers?|clauses?)
      | remaining\s+work
      | next\s+steps?
      | suggested\s+next\s+step
      | the\s+blocker
      | not\s+(?:yet\s+)?decoded
      | undecoded
      | unresolved
      | to\s*do\b
      | todo\b
    )
    """
)

# A heading that is explicitly historical is not a declaration of live work.
# Stems, not exact words: "closes"/"closed", "supersedes"/"superseded" and
# "resolves"/"resolved" all had to pass, and matching whole words let two
# resolution headings through on the first run.
CLOSED_HEADING_RE = re.compile(
    r"(?xi) (?: clos | resolv | falsif | supersed | retract | correct "
    r"| answer | histor | ship | \bdone\b | \bwrong\b ) "
)

HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")

# In-game dialogue quoted in guillemets. The generated story-progression docs
# title each cutscene with the line it opens on, and a character's own words are
# not a declaration of work: Junior's "Hmmm, I can't find Veemon... Hmm... what
# to do... Hmm..." matched `to\s*do` and failed the handoff on three headings in
# two generated files, which cannot be hand-edited to add a frontier.
DIALOGUE_RE = re.compile(r"\u00ab[^\u00bb]*\u00bb")


def iter_docs() -> list[Path]:
    out: list[Path] = []
    for rel in SCAN_DIRS:
        base = REPO / rel
        if base.is_dir():
            out.extend(sorted(base.rglob("*.md")))
    return out


def sections(text: str):
    """Yield (heading_line_no, heading_text, body_text) per heading."""
    lines = text.splitlines()
    marks = [
        (i, m.group(2).strip())
        for i, line in enumerate(lines, 1)
        if (m := HEADING_RE.match(line))
    ]
    for idx, (lineno, heading) in enumerate(marks):
        end = marks[idx + 1][0] - 1 if idx + 1 < len(marks) else len(lines)
        yield lineno, heading, "\n".join(lines[lineno:end])


def scan(claim_ids: set[str]) -> list[dict]:
    violations: list[dict] = []
    for path in iter_docs():
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        rel = path.relative_to(REPO).as_posix()
        for lineno, heading, body in sections(text):
            heading = DIALOGUE_RE.sub("", heading)
            if not OPEN_HEADING_RE.search(heading):
                continue
            if CLOSED_HEADING_RE.search(heading):
                continue
            blob = heading + "\n" + body
            if FRONTIER_RE.search(blob) or WAIVER_RE.search(blob):
                continue
            # A named ledger claim is an acceptable binding too: it puts the
            # assertion somewhere `handoff-check` can re-verify.
            if claim_ids & set(CLAIM_RE.findall(blob)):
                continue
            violations.append({"file": rel, "line": lineno, "heading": heading})
    return violations


def load_claim_ids() -> set[str]:
    ledger = REPO / "docs/research/evidence/ledger.json"
    if not ledger.is_file():
        return set()
    data = json.loads(ledger.read_text())
    return {c["id"] for c in data.get("claims", []) if c.get("id")}


def key(v: dict) -> str:
    return f"{v['file']}::{v['heading']}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--write-baseline", action="store_true")
    ap.add_argument("--all", action="store_true", help="ignore the baseline")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    violations = scan(load_claim_ids())

    if args.write_baseline:
        BASELINE.parent.mkdir(parents=True, exist_ok=True)
        BASELINE.write_text(
            json.dumps(
                {
                    "note": (
                        "Sections declaring open work with no frontier id, accepted at "
                        "adoption time. Fix one by naming its frontier, citing a claim, "
                        "or adding a `no-frontier: <reason>` waiver, then remove it here."
                    ),
                    "accepted": sorted(key(v) for v in violations),
                },
                indent=2,
            )
            + "\n"
        )
        print(f"wrote {BASELINE.relative_to(REPO)} with {len(violations)} accepted")
        return 0

    accepted: set[str] = set()
    if not args.all and BASELINE.is_file():
        accepted = set(json.loads(BASELINE.read_text()).get("accepted", []))

    new = [v for v in violations if key(v) not in accepted]

    if args.json:
        print(json.dumps({"total": len(violations), "new": new}, indent=2))
    else:
        print(
            f"open-work sections without a frontier: {len(violations)} total, "
            f"{len(accepted)} baselined, {len(new)} new"
        )
        for v in new:
            print(f"  {v['file']}:{v['line']}  {v['heading']}")
    if new:
        print(
            "\nEach section above declares work open but binds it to nothing. Name its "
            "frontier id, cite the ledger claim that settles it, or waive it with a "
            "`no-frontier: <reason>` line.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
