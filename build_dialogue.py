"""
Extracts NPC dialogue from the ddw3 repo's localization files into JSON.

Only entries that look like real dialogue (contain markup) are kept, as a
sparse {index: string} map — most slots are the placeholder "a".
"""

import os
import json
from pathlib import Path

import toml

LANG = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "lang_file/dw2003/eng"
OUT = Path(__file__).parent / "web/assets/dialogue"

FILES = [f"estalk{i:02d}" for i in range(10)]  # all talk files


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        strings = toml.load(LANG / f"{name}.toml")["strings"]
        entries = {str(i): s for i, s in enumerate(strings) if "[" in s}
        (OUT / f"{name}.json").write_text(json.dumps(entries, indent=0))
        print(f"{name}: {len(entries)} dialogue entries of {len(strings)}")


if __name__ == "__main__":
    main()
