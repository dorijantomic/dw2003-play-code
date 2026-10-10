#!/usr/bin/env python3
"""Validate the master player-facing presentation coverage register."""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "docs/research/presentation/master-manifest.json"


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def markdown_rows(path: Path, pattern: str) -> int:
    matcher = re.compile(pattern)
    return sum(1 for line in path.read_text().splitlines() if matcher.match(line))


def screen_draw_counts(path: Path) -> dict[str, int]:
    data = json.loads(path.read_text())
    counts = Counter(overlays=len(data))
    for routines in data.values():
        for routine in routines:
            counts["routines"] += 1
            for call in routine["calls"]:
                if call["op"] == "draw":
                    counts["picture_draws"] += 1
                elif call["op"] == "text_element":
                    counts["text_elements"] += 1
    counts["units"] = counts["picture_draws"] + counts["text_elements"]
    return dict(counts)


def main() -> int:
    errors: list[str] = []
    data = json.loads(MANIFEST.read_text())
    source_sets = {row["id"]: row for row in data.get("source_sets", [])}

    measured = {
        "overworld-field-rows": {
            "units": markdown_rows(
                ROOT / "docs/research/field/field-gap-2026-09-03.md",
                r"^\| [A-G][0-9]+ \|",
            )
        },
        "screen-object-method-rows": {
            "units": markdown_rows(
                ROOT / "docs/research/ui/screen-methods-walker-sweep-2026-09-03.md",
                r"^\|.*\| \*\*(?:BUILT|DIFFERS|MISSING|OUT-OF-SCOPE|UNCHECKED|FIXED 2026-09-03|PARTLY FIXED 2026-09-03)\*\* \|",
            )
        },
        "screen-draw-elements": screen_draw_counts(
            ROOT / "docs/generated/screen-draw-calls.json"
        ),
        "stage-descriptors": {
            "units": len(json.loads((ROOT / "docs/generated/stage-descriptors.json").read_text()))
        },
        "sound-effect-triggers": {
            "units": len(json.loads((ROOT / "docs/research/audio/sfx-triggers.json").read_text()))
        },
        "common-sound-identities": {
            "units": len(json.loads((ROOT / "docs/research/audio/soundtst-common-ids.json").read_text()))
        },
    }
    for set_id, actual in measured.items():
        declared = source_sets.get(set_id)
        if declared is None:
            fail(errors, f"missing source set: {set_id}")
            continue
        for key, value in actual.items():
            if declared.get(key) != value:
                fail(errors, f"{set_id}.{key}: declared {declared.get(key)!r}, measured {value!r}")

    contract = data.get("row_contract", {})
    required = contract.get("required", [])
    original_required = contract.get("original_required", [])
    walker_required = contract.get("walker_required", [])
    validation_required = contract.get("validation_required", [])
    ids: set[str] = set()
    verdicts = set(data.get("verdicts", []))
    for index, row in enumerate(data.get("rows", [])):
        where = f"rows[{index}]"
        row_id = row.get("id")
        if not row_id:
            fail(errors, f"{where}: missing id")
        elif row_id in ids:
            fail(errors, f"{where}: duplicate id {row_id}")
        else:
            ids.add(row_id)
        for key in required:
            if key not in row:
                fail(errors, f"{where}: missing {key}")
        for key in original_required:
            if key not in row.get("original", {}):
                fail(errors, f"{where}.original: missing {key}")
        for key in walker_required:
            if key not in row.get("walker", {}):
                fail(errors, f"{where}.walker: missing {key}")
        for key in validation_required:
            if key not in row.get("validation", {}):
                fail(errors, f"{where}.validation: missing {key}")
        if row.get("verdict") not in verdicts:
            fail(errors, f"{where}: invalid verdict {row.get('verdict')!r}")

    if data.get("status") == "complete":
        pending = [row["id"] for row in data.get("source_sets", []) if row.get("status") != "expanded"]
        if pending:
            fail(errors, "complete manifest has unexpanded source sets: " + ", ".join(pending))
        unfinished = [row["id"] for row in data.get("rows", []) if row.get("verdict") != "matches"]
        if unfinished:
            fail(errors, "complete manifest has unfinished rows: " + ", ".join(unfinished))

    if errors:
        print(f"presentation-manifest: FAIL ({len(errors)} errors)")
        for error in errors:
            print(f"error={error}")
        return 1
    print(
        "presentation-manifest: OK "
        f"rows={len(data.get('rows', []))} source_sets={len(source_sets)} "
        f"status={data.get('status')}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
