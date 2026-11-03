#!/usr/bin/env python3
"""Prep FIBO inputs for the sprite lab: idle frame 0 of each drawn direction, 8x bicubic on white, centred on 1024x1024."""
import sys
from PIL import Image
S="web/extra_partners/x191demi_clips.png"; OUT="web/assets-lab/fibo-sprites/C/in"
sh=Image.open(S).convert("RGBA")
for name,col in (("down",0),("down-left",20),("left",40),("up-left",60),("up",80)):
    f=sh.crop((col*82,0,col*82+82,46)).resize((82*8,46*8),Image.BICUBIC)
    bg=Image.new("RGBA",(1024,1024),(255,255,255,255))
    bg.alpha_composite(f,((1024-656)//2,(1024-368)//2))
    bg.convert("RGB").save(f"{OUT}/{name}.png")
print("ok")
