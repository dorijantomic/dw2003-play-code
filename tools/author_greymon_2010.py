#!/usr/bin/env python3
"""Author a complete 2010-style Greymon mesh and texture, independent of PS1 faces.

The output is an ordinary UV-mapped OBJ with semantic body-part groups. The
custom-model compiler binds those groups to the existing animation skeleton.
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageOps


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data/custom/m005xros-paint.png"
OUT = ROOT / "data/custom/greymon2010"
MATERIALS = {
    "skin": (0, 0), "skin_dark": (1, 0), "stripe": (2, 0), "steel": (3, 0),
    "steel_dark": (0, 1), "claw": (1, 1), "mouth": (2, 1), "eye": (3, 1),
}


def uv(material, u, v):
    col, row = MATERIALS[material]
    return ((col + 0.04 + u * 0.92) / 4, (row + 0.04 + v * 0.92) / 4)


class Mesh:
    def __init__(self):
        self.lines = ["# Hand-authored Greymon 2010 mesh; one group per animation bone"]
        self.vertices = 0
        self.texcoords = 0
        self.group = None
        self.triangles = 0

    def select(self, name):
        self.group = name
        self.lines.append(f"g {name}")

    def triangle(self, points, material, coords=((0, 0), (1, 0), (.5, 1))):
        if not self.group:
            raise ValueError("select a body part before adding faces")
        ids = []
        for p, tc in zip(points, coords):
            self.vertices += 1
            self.texcoords += 1
            self.lines.append("v " + " ".join(f"{x:.3f}" for x in p))
            self.lines.append("vt " + " ".join(f"{x:.6f}" for x in uv(material, *tc)))
            ids.append(f"{self.vertices}/{self.texcoords}")
        self.lines.append("f " + " ".join(ids))
        self.triangles += 1

    def quad(self, p, material, coords=((0, 0), (1, 0), (1, 1), (0, 1))):
        self.triangle((p[0], p[1], p[2]), material, (coords[0], coords[1], coords[2]))
        self.triangle((p[0], p[2], p[3]), material, (coords[0], coords[2], coords[3]))

    def ellipsoid(self, center, radii, material, slices=12, stacks=7, bands=None):
        slices = min(slices, 7)
        stacks = min(stacks, 4)
        cx, cy, cz = center
        rx, ry, rz = radii
        def point(s, t):
            phi = math.pi * s / stacks
            theta = 2 * math.pi * t / slices
            return (cx + rx * math.sin(phi) * math.cos(theta),
                    cy + ry * math.cos(phi),
                    cz + rz * math.sin(phi) * math.sin(theta))
        for s in range(stacks):
            for t in range(slices):
                mat = bands(s, t) if bands else material
                p = (point(s, t), point(s, t+1), point(s+1, t+1), point(s+1, t))
                self.quad(p, mat, ((t/slices, s/stacks), ((t+1)/slices, s/stacks),
                                   ((t+1)/slices, (s+1)/stacks), (t/slices, (s+1)/stacks)))

    def taper(self, start, end, radius0, radius1, material, sides=9, segments=3,
              accent=None):
        sides = min(sides, 5)
        segments = min(segments, 2)
        d = [end[i]-start[i] for i in range(3)]
        length = math.sqrt(sum(x*x for x in d))
        axis = [x/length for x in d]
        trial = (0, 0, 1) if abs(axis[2]) < .8 else (0, 1, 0)
        a = cross(axis, trial)
        al = math.sqrt(sum(x*x for x in a))
        a = [x/al for x in a]
        b = cross(axis, a)
        def ring(s, t):
            q = s / segments
            radius = radius0 * (1-q) + radius1 * q
            ang = 2 * math.pi * t / sides
            return tuple(start[i] + d[i]*q + radius*(a[i]*math.cos(ang)+b[i]*math.sin(ang))
                         for i in range(3))
        for s in range(segments):
            for t in range(sides):
                mat = accent if accent and s == 1 and t % 3 == 0 else material
                self.quad((ring(s,t),ring(s,t+1),ring(s+1,t+1),ring(s+1,t)), mat,
                          ((t/sides,s/segments),((t+1)/sides,s/segments),
                           ((t+1)/sides,(s+1)/segments),(t/sides,(s+1)/segments)))
        # End caps make the mesh solid through rotations.
        for t in range(sides):
            self.triangle((start,ring(0,t+1),ring(0,t)),material)
            self.triangle((end,ring(segments,t),ring(segments,t+1)),material)

    def horn(self, base, mid, tip, radius, material="steel"):
        self.taper(base, mid, radius, radius*.56, material, sides=8, segments=2)
        self.taper(mid, tip, radius*.56, 3, material, sides=8, segments=2)

    def armor_plate(self, corners, peak, material="steel"):
        for i in range(4):
            self.triangle((corners[i], corners[(i+1)%4], peak), material)
        self.quad(corners, "steel_dark")

    def save(self, path):
        path.write_text("\n".join(self.lines) + "\n")
        print(f"mesh: {self.triangles} triangles, {self.vertices} authored corners")


def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def paint_texture():
    """Use AI-painted source as material, laid out as eight explicit UV islands."""
    source = Image.open(SOURCE).convert("RGBA")
    tex = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    crops = {
        "skin": (205, 50, 460, 320),
        "skin_dark": (770, 0, 1025, 270),
        "stripe": (480, 0, 735, 255),
        "steel": (0, 0, 190, 190),
        "steel_dark": (960, 160, 1215, 410),
        "claw": (835, 110, 1090, 365),
        "mouth": (195, 200, 365, 370),
        "eye": (445, 255, 620, 430),
    }
    for name, (col, row) in MATERIALS.items():
        tile = ImageOps.fit(source.crop(crops[name]), (256, 256), method=Image.Resampling.LANCZOS)
        if name == "skin_dark":
            tile = ImageEnhance.Brightness(tile).enhance(.68)
        if name == "steel_dark":
            tile = ImageEnhance.Brightness(tile).enhance(.56)
        if name == "mouth":
            tile = ImageEnhance.Brightness(tile).enhance(.72)
        tile.putalpha(255)
        tex.paste(tile, (col*256, row*256))
    # Colored lower tiles remain available for more parts in the editable atlas.
    draw = ImageDraw.Draw(tex)
    draw.rectangle((0,512,1023,1023), fill=(0,0,0,0))
    tex.save(OUT / "texture.png")


def author_mesh():
    m = Mesh()
    m.select("chest")
    m.ellipsoid((0,-130,-20),(410,350,550),"skin",slices=14,stacks=8,
                bands=lambda s,t: "stripe" if t in (1,2,8,9) and s in (3,4,5) else "skin")
    for side in (-1,1):
        m.armor_plate(((side*260,-350,-160),(side*390,-250,-50),
                       (side*370,-120,180),(side*220,-290,140)),
                      (side*650,-530,-100),"steel_dark")
    for z in (-280,-40,200):
        m.horn((0,-420,z),(0,-570,z+45),(0,-735,z+125),70,"skin_dark")

    m.select("neck")
    m.taper((0,80,140),(0,-460,-260),280,230,"skin",sides=12,segments=6,
            accent="stripe")
    for side in (-1,1):
        m.armor_plate(((side*170,-320,-250),(side*260,-170,-200),
                       (side*250,-70,-20),(side*150,-230,-60)),
                      (side*390,-470,-170),"steel_dark")

    m.select("head")
    m.ellipsoid((0,-180,-490),(445,340,540),"skin_dark",slices=16,stacks=9)
    m.taper((0,-120,-600),(0,-120,-1300),330,220,"skin_dark",sides=12,segments=5)
    m.ellipsoid((0,-180,-680),(455,285,470),"steel_dark",slices=14,stacks=6)
    m.horn((0,-420,-1010),(0,-770,-1130),(0,-1220,-1260),150,"steel")
    for side in (-1,1):
        m.horn((side*310,-350,-620),(side*650,-520,-530),
               (side*1100,-760,-390),135,"steel")
        m.horn((side*350,-240,-300),(side*560,-200,-140),
               (side*800,-160,20),90,"steel_dark")
        m.ellipsoid((side*410,-125,-820),(75,90,155),"eye",slices=10,stacks=5)
        m.armor_plate(((side*260,-310,-960),(side*410,-300,-820),
                       (side*370,-100,-740),(side*230,-120,-900)),
                      (side*570,-380,-850),"steel")
    for side in (-1,1):
        for z in (-1010,-790,-570):
            m.horn((side*390,-90,z),(side*510,-110,z+10),
                   (side*700,-170,z+30),45,"steel_dark")

    m.select("jaw")
    m.taper((0,70,-360),(0,140,-1120),320,170,"mouth",sides=12,segments=5)
    for side in (-1,1):
        for z in (-930,-740,-550):
            m.horn((side*180,80,z),(side*230,-25,z-25),
                   (side*250,-155,z-50),35,"claw")

    for side, names in ((1,("right_upper_arm","right_forearm","right_hand")),
                        (-1,("left_upper_arm","left_forearm","left_hand"))):
        m.select(names[0])
        m.taper((side*40,-80,-20),(side*120,360,-40),155,125,"skin",sides=11,segments=5,
                accent="stripe")
        m.armor_plate(((side*65,-50,-140),(side*200,20,-90),
                       (side*220,210,10),(side*85,140,-20)),
                      (side*390,-190,-90),"steel_dark")
        m.select(names[1])
        m.taper((0,-30,0),(0,400,-10),130,110,"skin",sides=10,segments=5,
                accent="stripe")
        m.taper((0,160,0),(0,320,0),158,155,"steel_dark",sides=10,segments=2)
        m.select(names[2])
        m.ellipsoid((0,100,0),(180,190,180),"skin_dark",slices=12,stacks=6)
        for dx in (-120,0,120):
            m.horn((dx,230,-65),(dx,360,-140),(dx,570,-310),58,"claw")

    m.select("hips")
    m.ellipsoid((0,280,30),(470,420,470),"skin",slices=16,stacks=9,
                bands=lambda s,t: "stripe" if s in (3,4) and t%5<2 else "skin")
    for side in (-1,1):
        m.armor_plate(((side*280,60,-250),(side*430,170,-170),
                       (side*420,430,50),(side*260,280,30)),
                      (side*650,120,-210),"skin_dark")

    for side, names in ((1,("right_thigh","right_shin","right_ankle","right_foot")),
                        (-1,("left_thigh","left_shin","left_ankle","left_foot"))):
        m.select(names[0])
        m.taper((0,-70,0),(side*40,460,-100),250,185,"skin",sides=12,segments=5,
                accent="stripe")
        m.armor_plate(((side*60,60,-220),(side*250,120,-110),
                       (side*235,320,30),(side*45,270,-70)),
                      (side*360,-30,-170),"skin_dark")
        m.select(names[1])
        m.taper((0,-60,-30),(0,330,30),180,130,"skin_dark",sides=11,segments=5,
                accent="stripe")
        m.select(names[2])
        m.taper((0,-60,0),(0,270,0),150,155,"skin",sides=10,segments=4)
        m.select(names[3])
        m.ellipsoid((0,0,-200),(270,155,380),"skin_dark",slices=12,stacks=6)
        for dx in (-170,0,170):
            m.horn((dx,20,-420),(dx,10,-560),(dx,-40,-780),68,"claw")

    for name, start, end, r0, r1 in (
        ("tail_base",(0,0,0),(0,80,470),225,150),
        ("tail_mid",(0,0,0),(0,80,430),150,85),
        ("tail_tip",(0,0,0),(0,50,500),85,5),
    ):
        m.select(name)
        m.taper(start,end,r0,r1,"skin_dark",sides=11,segments=7,accent="stripe")
        for z in (130,300):
            m.horn((0,-r0*.75,z),(0,-r0-90,z+30),
                   (0,-r0-240,z+80),max(35,r0*.34),"steel_dark")

    m.save(OUT / "mesh.obj")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    paint_texture()
    author_mesh()
