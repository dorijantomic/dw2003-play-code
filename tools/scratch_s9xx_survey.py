"""Scratch: survey wstag920-974 overlay contents (warps, events, points, npcs).

Classification input for the scene_missing bucket (task: burn-down bucket 2).
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import wstag_extract

STAGES = list(range(920, 975))


def main():
    rows = []
    for st in STAGES:
        try:
            data = wstag_extract.extract(st)
        except Exception as e:
            rows.append((st, f"EXTRACT FAIL: {e}"))
            continue
        warps = data.get("warps", [])
        npcs = data.get("npcs", [])
        summary = {
            "warps": [(w.get("screen"), w.get("x"), w.get("y"),
                       w.get("dir"), w.get("param")) for w in warps],
            "npcs": len(npcs),
            "keys": sorted(data.keys()),
        }
        rows.append((st, summary))
    for st, s in rows:
        print(f"s{st}: {s}")


if __name__ == "__main__":
    main()
