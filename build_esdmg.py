"""
Parse esdmg story-event dirs from ddw3 into JSON assets for the browser game.

Each esdmgNNN/ directory has K.toml files (0-indexed) with a `strings` list.
strings[0] is always empty; entries equal to "a" are filler and are dropped.

Output: web/assets/events/esdmgNNN.json  — object keyed by entry index string.
"""

import os
import json
from pathlib import Path

import toml

LANG = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "lang_file/dw2003/eng"
OUT = Path(__file__).parent / "web/assets/events"


def _is_choice(strings):
    """True if this entry is a choice menu rather than a cutscene."""
    if len(strings) < 3:
        return False
    prompt = strings[1]
    options = strings[2:]
    return (
        "[pause]" not in prompt
        and all(len(s) < 30 and "[" not in s for s in options)
    )


def _parse_entry(strings):
    # KEEP THE DISC'S LINE POSITIONS. A cutscene SAY operand is a DIRECT index into the raw
    # string list (raw line 0 is always empty; SAY p1 reads R[p1]), and the walker resolves a
    # line as `strings[p1 - 1]` (web/game.js; engine/systems/cutscene-manager.ts
    # `const raw = _strings?.[p1 - 1]`). Removing ONLY the leading placeholder shifts the whole
    # list by one, which is exactly that -1 — so the mapping holds. Removing an interior "a"
    # filler does NOT: it shifts every line AFTER it, and the walker then reads the wrong page
    # or past the end. esdmg200 entry 13 (the Digimon Lab's Digimon Navi) has one such filler at
    # raw index 6 and its last SAY is p1=7 ("That's all of the information"), which the walker
    # dropped entirely. So keep the list verbatim after the placeholder; the fillers are never
    # displayed because the scripts skip them, exactly as the disc does.
    if _is_choice(strings):
        content = [s for s in strings[1:] if s and s != "a"]
        if not content:
            return None
        return {"type": "choice", "prompt": content[0], "options": content[1:]}
    content = list(strings[1:])
    if not any(content):
        return None
    return {"type": "cutscene", "strings": content}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for esdmg_dir in sorted(LANG.glob("esdmg*")):
        stage_id = esdmg_dir.name[5:]  # "200" from "esdmg200"
        entries = {}
        for toml_path in sorted(esdmg_dir.glob("*.toml"),
                                key=lambda p: int(p.stem)):
            data = toml.load(toml_path)
            strings = data.get("strings", [])
            parsed = _parse_entry(strings)
            if parsed:
                entries[toml_path.stem] = parsed
        out_path = OUT / f"esdmg{stage_id}.json"
        out_path.write_text(json.dumps(entries, indent=1))
        choices = sum(1 for e in entries.values() if e["type"] == "choice")
        print(f"esdmg{stage_id}: {len(entries)} entries ({choices} choices)")


if __name__ == "__main__":
    main()
