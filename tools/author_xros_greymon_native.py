#!/usr/bin/env python3
"""Author an original Xros Wars Greymon in the browser's native battle format.

All vertices, UVs, bone hierarchy and keyframes are generated here; no extracted
Greymon mesh, rig, or animation is copied. The reference informs the silhouette.
"""

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
FOLDER = "m605xros"
OUT = ROOT / "data/custom" / FOLDER
OUT.mkdir(parents=True, exist_ok=True)

# Atlas islands: four columns by four rows, each 64 units in the native 256 UV
# coordinate system. Geometry decides which region of the newly painted PNG it uses.
MATS = {
    "hide": (0, 0), "belly": (1, 0), "dark_hide": (2, 0), "orange": (3, 0),
    "steel": (0, 1), "steel_shadow": (1, 1), "bone": (2, 1), "mouth": (3, 1),
    "eye": (0, 2), "stripe": (1, 2), "plate": (2, 2), "claw": (3, 2),
    "tail": (0, 3), "gold": (1, 3), "joint": (2, 3), "back": (3, 3),
}


def uv(material, u, v):
    col, row = MATS[material]
    return [round(col * 64 + 2 + u * 60, 3), round(row * 64 + 2 + v * 60, 3)]


def keys(base, changes=None):
    records = {0: base, 40: base, 150: base, 200: base, 240: base,
               290: base, 350: base, 460: base, 500: base}
    if changes:
        records.update(changes)
    return [[*records[f], f] for f in sorted(records)]


class Bone:
    def __init__(self, name, parent, translation, rotations=None, translations=None):
        self.name = name
        self.parent = parent
        self.data = {"parent_slot": parent + 1 if parent is not None else 0,
                     "anim": {"ch1": keys(translation, translations),
                              "ch2": keys((0, 0, 0), rotations),
                              "ch3": [[4096, 4096, 4096, 0]]},
                     "verts": [], "faces": []}

    def triangle(self, p, material, tex=((0, 0), (1, 0), (.5, 1))):
        start = len(self.data["verts"])
        self.data["verts"].extend([list(map(lambda n: round(n, 3), q)) for q in p])
        face = [start, start + 1, start + 2]
        for t in tex:
            face += uv(material, *t)
        self.data["faces"].append(face)

    def quad(self, p, material, tex=((0, 0), (1, 0), (1, 1), (0, 1))):
        self.triangle((p[0], p[1], p[2]), material, (tex[0], tex[1], tex[2]))
        self.triangle((p[0], p[2], p[3]), material, (tex[0], tex[2], tex[3]))

    def loft_x(self, profile, material, sides=14, bands=None):
        """Organic surface along x: (x, center_y, center_z, radius_y, radius_z)."""
        rings = []
        for x, y, z, ry, rz in profile:
            rings.append([(x, y + ry * math.cos(2*math.pi*k/sides),
                           z + rz * math.sin(2*math.pi*k/sides)) for k in range(sides)])
        for i in range(len(rings)-1):
            for k in range(sides):
                j = (k+1) % sides
                chosen = bands(i, k) if bands else material
                u0, u1 = i/(len(rings)-1), (i+1)/(len(rings)-1)
                v0, v1 = k/sides, (k+1)/sides
                self.quad((rings[i][k], rings[i+1][k], rings[i+1][j], rings[i][j]),
                          chosen, ((u0,v0),(u1,v0),(u1,v1),(u0,v1)))
        for k in range(1, sides-1):
            self.triangle((rings[0][0],rings[0][k+1],rings[0][k]), material)
            self.triangle((rings[-1][0],rings[-1][k],rings[-1][k+1]), material)

    def loft_y(self, profile, material, sides=10, bands=None):
        rings = []
        for y, x, z, rx, rz in profile:
            rings.append([(x + rx * math.cos(2*math.pi*k/sides), y,
                           z + rz * math.sin(2*math.pi*k/sides)) for k in range(sides)])
        for i in range(len(rings)-1):
            for k in range(sides):
                j = (k+1) % sides
                chosen = bands(i,k) if bands else material
                self.quad((rings[i][k],rings[i+1][k],rings[i+1][j],rings[i][j]),chosen,
                          ((0,0),(1,0),(1,1),(0,1)))
        for k in range(1,sides-1):
            self.triangle((rings[0][0],rings[0][k],rings[0][k+1]),material)
            self.triangle((rings[-1][0],rings[-1][k+1],rings[-1][k]),material)

    def spike(self, base, tip, radius, material="bone", sides=7):
        bx,by,bz = base
        tx,ty,tz = tip
        axis = (tx-bx,ty-by,tz-bz)
        length = math.sqrt(sum(v*v for v in axis))
        axis = tuple(v/length for v in axis)
        ref = (0,0,1) if abs(axis[2]) < .8 else (0,1,0)
        a = cross(axis,ref); al = math.sqrt(sum(v*v for v in a)); a = tuple(v/al for v in a)
        b = cross(axis,a)
        ring = [tuple(base[h]+radius*(a[h]*math.cos(2*math.pi*k/sides)+b[h]*math.sin(2*math.pi*k/sides))
                      for h in range(3)) for k in range(sides)]
        mid = tuple(base[h]*.45+tip[h]*.55 for h in range(3))
        ring2 = [tuple(mid[h]+radius*.35*(a[h]*math.cos(2*math.pi*k/sides)+b[h]*math.sin(2*math.pi*k/sides))
                       for h in range(3)) for k in range(sides)]
        for k in range(sides):
            j=(k+1)%sides
            self.quad((ring[k],ring[j],ring2[j],ring2[k]),material)
            self.triangle((ring2[k],ring2[j],tip),material)

    def plate(self, polygon, peak, material="plate"):
        for i in range(len(polygon)):
            self.triangle((polygon[i],polygon[(i+1)%len(polygon)],peak), material,
                          ((0,0),(1,0),(.5,.8)))


def cross(a,b):
    return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])


bones=[]
def bone(name,parent,translation,rotations=None,translations=None):
    b=Bone(name,parent,translation,rotations,translations)
    bones.append(b)
    return len(bones)-1,b


# The torso is long and low; neck/head project forward (+x, viewer-left).
torso_id, torso = bone("torso",None,(0,-1120,0),
                       rotations={10:(0,0,18),20:(0,0,-12),100:(0,0,-65),
                                  120:(0,0,65),180:(0,0,95),270:(0,0,-70),
                                  330:(0,0,330),420:(0,0,-90)},
                       translations={10:(0,-1150,0),20:(0,-1080,0),
                                     115:(120,-1080,0),130:(200,-1100,0),
                                     180:(-110,-1100,0),330:(0,-750,0),
                                     420:(60,-1120,0)})
torso.loft_x([(-680,100,0,190,200),(-530,10,0,310,340),(-300,-40,0,350,365),
              (0,-20,0,325,335),(300,-80,0,360,355),(520,-80,0,300,300),
              (650,-45,0,180,170)],"hide",16,
             lambda i,k: "belly" if 5<=k<=10 and i in (1,2,3,4) else
                         "orange" if i in (1,3,5) and k in (0,1,14,15) else "hide")
for x,y,z in [(-400,-350,-90),(-70,-360,-90),(320,-410,-80)]:
    torso.spike((x,y,z),(x-45,y-165,z-20),53,"back")
for side in (-1,1):
    z=side*335
    for x in (-300,-30,240):
        torso.quad([(x-85,-275,side*225),(x+35,-300,side*225),
                    (x+125,170,side*300),(x+5,185,side*300)],"orange")
    for x in (-430,-160,100,360):
        torso.plate([(x-95,-210,z),(x+85,-230,z),(x+80,20,z),(x-70,55,z)],
                    (x,-85,z+side*75),"stripe" if x in (-160,360) else "plate")

neck_id, neck = bone("neck",torso_id,(560,-90,0),
                     rotations={10:(0,0,-12),100:(0,0,-100),115:(0,0,70),
                                180:(0,0,130),270:(0,0,-180),330:(0,0,380),
                                420:(0,0,-140)})
neck.loft_x([(0,0,0,210,220),(100,-30,0,210,230),(220,-75,0,175,185),
             (330,-100,0,120,135)],"dark_hide",14)
for side in (-1,1):
    neck.plate([(40,-180,side*160),(190,-230,side*160),(250,-80,side*130),(80,40,side*210)],
               (170,-100,side*260),"steel_shadow")

head_id, head = bone("armored_head",neck_id,(290,-100,0),
                     rotations={10:(0,0,12),100:(0,0,-100),120:(0,0,120),
                                180:(0,0,140),270:(0,0,-180),330:(0,0,450),
                                420:(0,0,-120)})
# Broad wedge brow and long blunt muzzle, much lower than the horn crown.
head.loft_x([(-90,30,0,150,195),(25,0,0,200,260),(155,30,0,180,245),
             (310,95,0,155,195),(470,125,0,100,140),(570,120,0,70,105)],
            "dark_hide",16)
for side in (-1,1):
    z=side
    # Multi-faceted silver mask with two angled cheek panels, not a flat cone.
    head.plate([(-70,-110,z*155),(65,-200,z*185),(230,-150,z*170),(160,25,z*265)],
               (90,-135,z*295),"steel")
    head.plate([(140,-110,z*195),(325,-45,z*160),(450,65,z*130),(245,75,z*200)],
               (315,-25,z*235),"steel_shadow")
    head.plate([(130,60,z*230),(260,80,z*200),(330,170,z*150),(110,170,z*225)],
               (205,105,z*280),"steel")
    # Red eye is actual geometry on its own atlas region.
    head.plate([(105,-35,z*256),(205,-20,z*240),(202,35,z*240),(105,40,z*263)],
               (155,0,z*270),"eye")
    head.spike((90,-190,z*155),(25,-390,z*215),55,"steel")
    head.spike((220,-135,z*155),(220,-320,z*250),40,"steel")
    head.spike((370,15,z*110),(505,-185,z*145),50,"steel")
    head.spike((475,75,z*95),(635,10,z*95),28,"steel")
head.spike((510,65,0),(690,-85,0),55,"steel")

jaw_id, jaw = bone("hinged_jaw",head_id,(170,210,0),
                   rotations={100:(0,0,90),115:(0,0,370),125:(0,0,160),
                              180:(0,0,100),270:(0,0,-90),420:(0,0,400),
                              440:(0,0,220)})
jaw.loft_x([(-30,0,0,70,180),(80,35,0,85,195),(245,60,0,70,155),
            (390,60,0,32,100)],"mouth",12)
for side in (-1,1):
    jaw.plate([(0,-45,side*165),(150,-20,side*175),(360,25,side*105),
               (230,110,side*150)],(190,30,side*200),"steel_shadow")
    for x in (95,180,265,340):
        jaw.spike((x,-25,side*(155-x*.12)),(x+15,-95,side*(155-x*.12)),17,"bone",5)

# Grow the whole authored skull, including its helmet surfaces; do not stretch
# the torso or the jaw hinge along with it.
head.data["verts"]=[[round(c*1.42,3) for c in vertex] for vertex in head.data["verts"]]
jaw.data["verts"]=[[round(c*1.30,3) for c in vertex] for vertex in jaw.data["verts"]]

# Arms: shoulders, bent forearms, broad hands and separate hooked claws.
for side,label in [(-1,"near"),(1,"far")]:
    z=side*280
    upper_id, upper = bone(f"{label}_upper_arm",torso_id,(345,80,z),
                           rotations={10:(0,0,20*side),100:(0,0,-180*side),
                                      125:(0,0,260*side),270:(0,0,-280*side),
                                      330:(0,0,450*side)})
    upper.loft_y([(0,0,0,110,125),(80,-10,side*40,155,155),
                  (215,15,side*95,125,140),(340,80,side*125,80,90)],
                 "hide",12,lambda i,k:"orange" if i==1 and k in (1,2,3,4) else "hide")
    upper.plate([(-100,20,side*95),(20,-40,side*105),(125,115,side*150),
                 (-70,150,side*160)],(10,60,side*225),"plate")
    fore_id, fore = bone(f"{label}_forearm",upper_id,(75,310,side*120),
                         rotations={10:(0,0,-20*side),100:(0,0,220*side),
                                    125:(0,0,-160*side),270:(0,0,240*side),
                                    330:(0,0,-250*side)})
    fore.loft_y([(0,0,0,80,95),(100,50,side*20,125,120),
                 (250,110,side*50,120,115),(315,150,side*70,85,85)],
                "hide",12,lambda i,k:"stripe" if i==1 and k in (0,1,2,3) else "hide")
    hand_id, hand = bone(f"{label}_hand",fore_id,(150,285,side*65),
                         rotations={100:(0,0,-170*side),125:(0,0,270*side),
                                    270:(0,0,-130*side)})
    hand.loft_x([(-80,0,0,95,100),(25,10,0,115,130),
                 (125,55,0,80,115),(180,85,0,35,65)],"dark_hide",12)
    for k in (-1,0,1):
        hand.spike((130,60,k*70),(315,105,k*90),32,"claw")
    hand.spike((65,120,side*110),(195,185,side*160),35,"claw")

# Powerful legs retain their own floor-contact hierarchy.
for side,label in [(-1,"near"),(1,"far")]:
    z=side*245
    thigh_id, thigh = bone(f"{label}_thigh",torso_id,(-390,230,z),
                           rotations={10:(0,0,18*side),115:(0,0,-90*side),
                                      180:(0,0,140*side),270:(0,0,-100*side),
                                      330:(0,0,360*side)})
    thigh.loft_y([(0,0,0,200,170),(110,-70,side*25,220,180),
                  (270,-55,side*55,170,150),(390,35,side*75,110,110)],
                 "hide",14,lambda i,k:"orange" if i==1 and k in (1,2,3,4,5) else "hide")
    thigh.plate([(-195,10,side*95),(-5,-50,side*120),(120,180,side*170),
                 (-175,230,side*150)],(-20,70,side*250),"stripe")
    shin_id, shin = bone(f"{label}_shin",thigh_id,(35,370,side*60),
                         rotations={10:(0,0,-15*side),115:(0,0,100*side),
                                    180:(0,0,-140*side),330:(0,0,-280*side)})
    shin.loft_y([(0,0,0,120,125),(140,25,side*15,130,125),
                 (320,90,side*15,75,90),(420,100,side*15,80,95)],"hide",12)
    shin.plate([(-100,60,side*90),(80,75,side*95),(150,285,side*75),
                (-25,315,side*90)],(50,180,side*155),"plate")
    foot_id, foot = bone(f"{label}_foot",shin_id,(100,420,side*15),
                         rotations={115:(0,0,-60*side),180:(0,0,110*side),
                                    330:(0,0,200*side)})
    foot.loft_x([(-130,0,0,80,110),(-10,25,0,95,140),
                 (155,55,0,65,155),(250,65,0,35,120)],"dark_hide",12)
    for k in (-1,0,1):
        foot.spike((215,45,k*100),(385,55,k*120),33,"claw")

# Four tapered, curved sections carry the tail to a genuine narrow tip.
tail_parent = torso_id
for i,(tx,ty,length,r0,r1) in enumerate([
        (-650,100,330,210,170),(-300,55,330,170,120),
        (-310,-45,320,120,72),(-305,-65,280,72,16)]):
    tid, tail = bone(f"tail_{i}",tail_parent,(tx,ty,0),
                     rotations={10:(0,35*(-1)**i,0),20:(0,-35*(-1)**i,0),
                                100:(0,100*(-1)**i,0),125:(0,-130*(-1)**i,0),
                                270:(0,70*(-1)**i,0),330:(0,-190*(-1)**i,0),
                                420:(0,160*(-1)**i,0),445:(0,-150*(-1)**i,0)})
    tail.loft_x([(0,0,0,r0,r0*.95),(-length*.25,20,0,r0*.9,r0*.88),
                 (-length*.55,35,0,(r0+r1)*.5,(r0+r1)*.48),
                 (-length*.83,15,0,r1,r1*.92),(-length,0,0,r1*.82,r1*.78)],
                "tail",12,lambda ring,k:"orange" if ring in (1,3) and k in (0,1,2,10,11) else "tail")
    for x in (-length*.24,-length*.62):
        tail.spike((x,-r0*.8,0),(x-45,-r0*1.7,0),r0*.23,"back",6)
    tail_parent=tid


def timeline(start,end,loop=False):
    table=[{"value":f,"loop_target":0,"aux":None} for f in range(start,end+1)]
    table.append({"value":32768 if loop else 65535,"loop_target":0,"aux":None})
    return {"table":table}


timelines=[{"table":[]} for _ in range(62)]
for slot,a,b,loop in [(0,0,40,True),(1,0,40,True),(2,220,240,False),
                       (3,180,190,False),(4,190,200,False),(5,320,335,False),
                       (6,336,350,False),(10,320,350,False),
                       (14,100,110,False),(15,111,120,False),
                       (16,121,130,False),(17,131,140,False),
                       (18,141,150,False),(20,100,110,False),
                       (21,111,120,False),(22,121,130,False),
                       (23,131,140,False),(24,141,150,False),
                       (26,100,110,False),(27,111,120,False),
                       (28,121,130,False),(29,131,140,False),
                       (30,141,150,False),(32,100,110,False),
                       (33,111,120,False),(34,121,130,False),
                       (35,131,140,False),(36,141,150,False),
                       (38,400,420,False),(44,260,290,True),
                       (45,260,290,True),(50,400,420,False),
                       (51,421,440,False),(52,441,460,False)]:
    timelines[slot]=timeline(a,b,loop)


def op(code,*words):
    return {"op":code,"words":list(words)}


def action_for(i):
    if i==0:
        return [op(2,0,0,1),op(255)]
    if i in (1,2,3,4):
        slot={1:3,2:4,3:10,4:2}[i]
        return [op(2,0,0,slot),op(2,0,0,0),op(2,0,0,1),op(255)]
    if i in (5,6,7,8):
        base={5:14,6:20,7:26,8:32}[i]
        ops=[]
        for offset in range(5):
            ops += [op(2,0,0,base+offset),op(2,0,0,0)]
            if offset==2: ops.append(op(10,99,0))
        return ops+[op(2,0,0,1),op(255)]
    if i in (10,16):
        return [op(2,0,0,44),op(2,0,0,0),op(255)]
    if i in (11,12,13):
        return [op(2,0,0,50),op(2,0,0,0),op(2,0,0,51),op(10,99,0),
                op(2,0,0,0),op(2,0,0,52),op(2,0,0,0),op(2,0,0,1),op(255)]
    return [op(2,0,0,1),op(255)]


model={"folder":FOLDER,"num_bones":len(bones),"total_frames":500,
       "clips":[{"index":i,"present":True,"start_frame":0,"end_frame":500,
                  "loop_count":1} for i in range(18)],
       "bones":[dict(b.data,anim_bin=i+1,mesh_bin=i+1) for i,b in enumerate(bones)],
       "timeline":timelines,
       "actions":[{"ops":action_for(i),"overrun":False} for i in range(18)]}
(OUT/"anim.json").write_text(json.dumps(model,separators=(",",":")))
(OUT/"bone_names.json").write_text(json.dumps([b.name for b in bones],indent=2)+"\n")


def paint_atlas():
    image=Image.new("RGBA",(1024,1024),(0,0,0,0))
    base_colors={
        "hide":(58,78,143),"belly":(82,103,161),"dark_hide":(30,46,88),
        "orange":(234,112,43),"steel":(170,184,199),"steel_shadow":(87,104,132),
        "bone":(229,225,201),"mouth":(67,27,44),"eye":(191,38,71),
        "stripe":(218,96,36),"plate":(119,146,180),"claw":(112,129,157),
        "tail":(51,69,125),"gold":(212,162,79),"joint":(36,49,92),
        "back":(70,83,110)}
    for name,(col,row) in MATS.items():
        tile=Image.new("RGBA",(256,256),(*base_colors[name],255))
        draw=ImageDraw.Draw(tile,"RGBA")
        # All texture marks are generated with fixed locations so edits retain UVs.
        if name in ("hide","belly","dark_hide","tail","joint"):
            for y in range(-10,270,15):
                for x in range(-10+(y//15%2)*7,270,15):
                    draw.arc((x,y,x+12,y+11),20,155,fill=(149,171,218,42),width=1)
                    draw.arc((x+1,y+1,x+12,y+13),170,335,fill=(13,28,66,36),width=1)
            for k in range(45):
                x=(k*91+37)%256; y=(k*63+89)%256
                draw.ellipse((x,y,x+2,y+2),fill=(11,28,59,47))
        if name in ("orange","stripe"):
            for k in range(-3,9):
                x=k*45
                draw.polygon([(x,0),(x+19,0),(x+130,255),(x+105,255)],
                             fill=(255,176,64,120))
                draw.line([(x+22,0),(x+133,255)],fill=(107,43,33,110),width=5)
            for y in range(20,255,38):
                draw.line([(0,y),(255,y+18)],fill=(255,208,104,90),width=2)
        if name in ("steel","steel_shadow","plate","back","gold"):
            for k in range(-2,7):
                x=k*64
                draw.polygon([(x,0),(x+45,0),(x+85,256),(x+35,256)],
                             fill=(235,244,255,35))
                draw.line([(x,0),(x+35,256)],fill=(19,37,62,180),width=5)
                draw.line([(x+5,4),(x+39,252)],fill=(227,238,252,160),width=2)
            for x,y in ((28,30),(165,46),(85,160),(212,220)):
                draw.ellipse((x-5,y-5,x+5,y+5),fill=(32,44,63,230))
                draw.ellipse((x-2,y-2,x+1,y+1),fill=(236,245,255,220))
        if name=="bone":
            for k in range(0,256,22):
                draw.line([(0,k),(255,k+80)],fill=(152,142,129,65),width=2)
        if name=="mouth":
            for k in range(0,256,31):
                draw.arc((k,-30,k+40,200),10,95,fill=(208,82,100,80),width=5)
        if name=="eye":
            draw.ellipse((16,18,240,238),fill=(216,40,71,255),outline=(255,184,111,255),width=14)
            draw.ellipse((93,30,155,225),fill=(16,21,35,255))
            draw.ellipse((111,46,132,93),fill=(255,248,230,245))
            draw.arc((25,20,230,235),180,345,fill=(77,9,38,210),width=18)
        if name=="claw":
            for k in range(6):
                x=k*53-40
                draw.polygon([(x,256),(x+42,0),(x+67,0),(x+25,256)],fill=(165,182,202,210))
                draw.line([(x+45,0),(x+3,256)],fill=(244,247,246,190),width=3)
        image.paste(tile,(col*256,row*256))
    image.save(OUT/"texture.png")


paint_atlas()
print(f"{FOLDER}: {len(bones)} original bones, {sum(len(b.data['faces']) for b in bones)} triangles, 1024x1024 RGBA atlas")
