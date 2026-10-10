"""Scratch: who warps INTO underground screens 736-750 (0x2e0-0x2ee)?

Also dump full warp records (with spawn coords) for s960-s974 and bases
s825-s895, and doors/ladders counts.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import wstag_extract

ASM = Path.home() / "ddw3/asm/dw2003/pro"

UNDER = set(range(736, 751))

print("=== inbound warps to screens 736-750, scanning all overlays ===")
for p in sorted(ASM.glob("wstag*.s")):
    st = p.stem[5:]
    try:
        data = wstag_extract.extract(int(st))
    except Exception:
        continue
    if not data:
        continue
    for w in data.get("warps", []):
        if w.get("screen") in UNDER:
            print(f"  s{st} -> screen {w['screen']} {w}")

print()
print("=== full warp/door/ladder dump: s960-974 and s825-s895 ===")
for st in list(range(960, 975)) + list(range(825, 900, 5)):
    try:
        data = wstag_extract.extract(st)
    except Exception as e:
        print(f"s{st}: FAIL {e}")
        continue
    if not data:
        print(f"s{st}: no data")
        continue
    print(f"s{st}: doors={len(data.get('doors', []))} "
          f"ladders={len(data.get('ladders', []))}")
    for w in data.get("warps", []):
        print(f"   warp {w}")
