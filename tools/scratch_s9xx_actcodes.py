"""Scratch: all sig-record act codes in s9xx + underground base overlays."""
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import wstag_extract

DIRS = {1: "down", 3: "left", 5: "up", 7: "right"}


def main():
    for st in list(range(960, 975)) + list(range(920, 960)) \
            + list(range(825, 900, 5)):
        data = wstag_extract.overlay_bytes(st)
        if data is None:
            print(f"s{st}: no overlay")
            continue
        recs = wstag_extract.sig_records(data)
        by_act = Counter(r[1] for r in recs)
        interesting = [r for r in recs if r[1] not in (0, 1, 2, 3, 4)]
        print(f"s{st}: acts={dict(sorted(by_act.items()))}")
        for off, act, screen, x, y, d, param in interesting:
            print(f"    act={act} screen={screen} x={x} y={y} "
                  f"dir={DIRS.get(d, d)} param={param}")


if __name__ == "__main__":
    main()
