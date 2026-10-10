"""Scratch: emit an arrival pad (screen, x, y) for each s92x-s95x alias screen,
from any OTHER alias overlay's act-1 record targeting it. Bash-batch format."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import wstag_extract

pads = {}
for st in range(920, 960):
    data = wstag_extract.overlay_bytes(st)
    if data is None:
        continue
    for off, act, sid, x, y, d, param in wstag_extract.sig_records(data):
        if act == 1 and 624 <= sid <= 671 and sid not in pads:
            pads[sid] = (x, y, f"from s{st}")

for sid in range(624, 672):
    if sid in pads:
        x, y, src = pads[sid]
        print(f'  "{sid} {x} {y}"   # {src}')
    else:
        print(f"# screen {sid}: NO inbound act-1 pad")
