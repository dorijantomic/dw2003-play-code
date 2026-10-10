"""Scratch: s9xx events / grids / estalk banks / points survey."""
import json
from pathlib import Path

ROOT = Path(__file__).parent.parent

ev = json.load(open(ROOT / "web/assets/events/wstag_events.json"))
grids = json.load(open(ROOT / "web/assets/data/story_trigger_grids.json"))
zgrids = json.load(open(ROOT / "web/assets/data/zone_grids.json"))
banks = json.load(open(ROOT / "data/stage_estalk_bank.json"))
points = json.load(open(ROOT / "web/assets/data/point_sprites.json"))
steps = json.load(open(ROOT / "web/assets/data/story_steps.json"))

def stage_events(st):
    key = str(st)
    if isinstance(ev, dict):
        v = ev.get(key) or ev.get(f"s{st}")
        return v
    return None

print("wstag_events top-level type:", type(ev).__name__,
      "keys sample:", list(ev)[:3] if isinstance(ev, dict) else ev[:1])
print("grids type:", type(grids).__name__,
      "sample:", list(grids)[:3] if isinstance(grids, dict) else None)
print("steps type:", type(steps).__name__,
      "sample keys:", list(steps)[:3] if isinstance(steps, dict) else None)

gst = grids.get("stages", grids)
zst = zgrids.get("stages", zgrids)
sst = steps.get("stages", steps)
pst = points.get("stages", points)
print("grid stage keys sample:", list(gst)[:4])
print("points keys sample:", list(pst)[:4])
print("steps keys sample:", list(sst)[:4])
for st in list(range(920, 975)):
    k = str(st)
    e = stage_events(st)
    n_ev = len(e) if e else 0
    g = gst.get(k) or gst.get(f"s{st}")
    gk = ("uniform" if isinstance(g, dict) and "uniform" in g else
          ("grid" if g else "-"))
    zg = "zg" if (zst.get(k) or zst.get(f"s{st}")) else "-"
    bank = banks.get(k) or banks.get(f"s{st}")
    bank = bank["bank"] if bank else "-"
    pt = pst.get(k) or pst.get(f"s{st}")
    n_pt = len(pt) if pt else 0
    stp = sst.get(k) or sst.get(f"s{st}")
    n_stp = len(stp) if stp else 0
    print(f"s{st}: events={n_ev} grid={gk} {zg} estalk={bank} "
          f"points={n_pt} steps={n_stp}")
