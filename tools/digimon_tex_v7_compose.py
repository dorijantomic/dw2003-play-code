#!/usr/bin/env python3
"""V7 compose: digimon_tex_v7_compose.py <model> <joined.png> <orig.png> <out.png>
Config #7 of ~/digimon-quest/sweep.py: compose(m,[joined],match=1,hl=8,lf=4,lfa=0.7,clip=60,hfo=0.0,flat=(2,20),sharp=0.5).
Prints the tex_quality metrics as one JSON line."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image
import digimon_tex_quest as Q, tex_quality as tq
m, joined, orig, out = sys.argv[1:5]
r = Q.compose(m, [joined], orig_path=orig, match=1, hl=8, lf=4, lfa=0.7, clip=60, hfo=0.0, flat=(2, 20), sharp=0.5)
Image.fromarray(r, "RGBA").save(out)
q = tq.measure(m, out, orig=orig)
print(json.dumps({k: (float(v) if hasattr(v, "item") or isinstance(v, float) else v)
                  for k, v in q.items() if isinstance(v, (int, float)) or hasattr(v, "item")}))
