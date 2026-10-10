#!/usr/bin/env python3
"""Extract per-map encounter zone-map geometry, fully offline.

End-to-end chain, all decoded from disasm (no emulator):

  1. wstagNNN init calls set_resource(4, id) with id=(file#<<16)|sub  -> the type-4 zone map
     (extract_zone_resource_ids.py; here re-parsed inline).
  2. file# indexes the EXE master file table:
        LBA_OFFSETS    [u32;2382] @ 0x80044f6c   -> disc sector
        LBA_LEN_SECTORS[u16;2382] @ 0x800474a4   -> sector count
     (read from SLES_039.36 inside the disc image; exe loads @0x80010000, t_addr from PS-X header).
  3. archive = those sectors; starts with a u32 offset-TOC; sub-resource = archive + TOC[sub]
     (resolver F0x800140d8).
  4. sub-resource = 6-section grid pyramid (loader 0x800927fc):
        hdr   : 6x u32 section offsets @ +0
        sec0  : u8 w, u8 h, u8 grid[w*h]      (128px tiles)
        sec1  : u8[]                          (quadtree, bit 0x40)
        sec2-4: u16[]                         (bits 0x20,0x10,0x08)
        sec5  : u8[] 8x8 leaf blocks          -> 1-based zone id
     zonecheck 0x80092914 traversal: zone = sec5[ n*64 + (y&7)*8 + (x&7) ].

Outputs a per-stage grid (cell-resolution zone ids) the walker can sample instead of
the "merge all zones" approximation:

  python3 tools/extract_zone_grids.py --json   # -> web/assets/data/zone_grids.json

JSON shape per stage: single-zone maps collapse to {"uniform": z}; multi-zone maps emit
{"cell": px, "w": cols, "h": rows, "grid": [zone ids row-major]} so the walker can do
zone = grid[(y//cell)*w + (x//cell)] (index = zone-1 selects the stage's encounter block).
"""
from pathlib import Path
import struct, sys, re, glob, json, os
from collections import Counter

DISC = str(Path(os.environ.get("DW3_DISC") or Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "build/iso/dw2003.bin"))
WSTAG_DIR = str(Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro")
RAW, UO, UL = 2352, 24, 2048
EXE_LBA_OFFSETS = 0x80044f6c
EXE_LBA_LENS    = 0x800474a4
CELL = 32   # lookup-grid sample resolution in world px (matches pyramid sec2)

WORD = re.compile(r'#\s*\.word\s+(0x[0-9a-fA-F]+)')

def wstag_words(path):
    out=[]
    for line in open(path):
        m=WORD.search(line) or re.search(r'\.word\s+(0x[0-9a-fA-F]+)\s*#', line)
        out.append(int(m.group(1),16) if m else None)
    return out

def zone_id_for_stage(stage):
    """Return (file#, sub) for the stage's type-4 zone map, or None."""
    path=f"{WSTAG_DIR}/wstag{stage}.s"
    if not os.path.exists(path): return None
    w=wstag_words(path)
    for i in range(len(w)-5):
        if w[i]==0x24040004:                                  # li $a0,4
            if w[i+1] is None or (w[i+1]&0xffff0000)!=0x3c050000: continue
            hi=w[i+1]&0xffff
            window=w[i+2:i+6]
            # lw $v0,0x40(rs) with ANY base reg (the seabed/circuit overlays use
            # $s1, not $s0 — hardcoding 0x8e020040 hid all 15 maze grids)
            if not any(x is not None and (x>>26)==0x23 and ((x>>16)&31)==2
                       and (x&0xffff)==0x40 for x in window): continue
            if 0x0040f809 not in window: continue
            j=w.index(0x0040f809,i+2,i+6)
            id=(hi<<16)|_sub_lo(w[j+1] if j+1<len(w) else None, 4)
            return id>>16, id&0xffff
    return None

def _sub_lo(delay, type_val):
    """Sub-index low half from the jalr delay slot: `ori $a1,imm` (imm) or
    `or $a1,$a0` (== the type value in $a0 — the s96x alias overlays use this
    form for type-7/sub-7, which the ori-only matcher misread as sub 0)."""
    if delay is not None and (delay&0xffff0000)==0x34a50000: return delay&0xffff
    if delay==0x00a42825: return type_val                     # or $a1,$a0
    return 0

class Disc:
    def __init__(self, path):
        self.f=open(path,'rb')
        hdr=self.sector(24)
        assert hdr[:8]==b'PS-X EXE', "EXE not at LSN 24"
        self.t_addr=struct.unpack_from('<I',hdr,0x18)[0]
        self.t_size=struct.unpack_from('<I',hdr,0x1c)[0]
        self.img=self.sectors(24,(0x800+self.t_size+UL-1)//UL)[0x800:0x800+self.t_size]
    def sector(self,l): self.f.seek(l*RAW+UO); return self.f.read(UL)
    def sectors(self,l,c): return b''.join(self.sector(l+i) for i in range(c))
    def exe_u32(self,r): return struct.unpack_from('<I',self.img,r-self.t_addr)[0]
    def exe_u16(self,r): return struct.unpack_from('<H',self.img,r-self.t_addr)[0]
    def file_bytes(self,fn):
        lba=self.exe_u32(EXE_LBA_OFFSETS+fn*4); ln=self.exe_u16(EXE_LBA_LENS+fn*2)
        if lba==0 or ln==0: return None,lba,ln
        return self.sectors(lba,ln),lba,ln

def parse_pyramid(archive, sub):
    res=archive[struct.unpack_from('<I',archive,sub*4)[0]:]
    off=struct.unpack_from('<6I',res,0)
    if off[0]<0x18 or not all(off[i]<off[i+1] for i in range(5)): return None
    return res,off

def make_zc(res,off):
    w=res[off[0]]; h=res[off[0]+1]
    def zc(x,y):
        tx=x>>7; ty=y>>7
        if tx<0 or ty<0 or tx>=w or ty>=h: return 0
        n=res[off[0]+2+ty*w+tx]
        n=res[off[1]+n*4+(2 if y&0x40 else 0)+(1 if x&0x40 else 0)]
        n=struct.unpack_from('<H',res,off[2]+(n*4+(2 if y&0x20 else 0)+(1 if x&0x20 else 0))*2)[0]
        n=struct.unpack_from('<H',res,off[3]+(n*4+(2 if y&0x10 else 0)+(1 if x&0x10 else 0))*2)[0]
        n=struct.unpack_from('<H',res,off[4]+(n*4+(2 if y&0x08 else 0)+(1 if x&0x08 else 0))*2)[0]
        return res[off[5]+n*64+(y&7)*8+(x&7)]
    return w,h,zc

def extract(disc, stage):
    fs=zone_id_for_stage(stage)
    if not fs: return None
    fn,sub=fs
    arch,lba,ln=disc.file_bytes(fn)
    if arch is None: return dict(stage=stage,file=fn,sub=sub,error="unmapped file")
    pr=parse_pyramid(arch,sub)
    if not pr: return dict(stage=stage,file=fn,sub=sub,error="bad pyramid header")
    res,off=pr
    w,h,zc=make_zc(res,off)
    if w==0 or h==0:
        return dict(stage=stage,file=fn,sub=sub,error=f"degenerate grid {w}x{h}")
    zones=Counter()
    wc, hc = (w*128)//CELL, (h*128)//CELL
    grid=[]
    try:
        for ty in range(h):
            for tx in range(w):
                for yy in range(0,128,8):
                    for xx in range(0,128,8):
                        zones[zc(tx*128+xx,ty*128+yy)]+=1
        for cy in range(hc):
            for cx in range(wc):
                grid.append(zc(cx*CELL+CELL//2, cy*CELL+CELL//2))
    except IndexError:
        return dict(stage=stage,file=fn,sub=sub,error="traversal OOB (compressed/misparsed?)")
    # Collapse a uniform non-zero map to a scalar; otherwise keep the cell grid.
    nz=set(g for g in grid if g)
    lookup = {"uniform": nz.pop()} if len(nz)<=1 else {"cell":CELL,"w":wc,"h":hc,"grid":grid}
    return dict(stage=stage,file=fn,sub=sub,lba=lba,sectors=ln,w=w,h=h,
                max_zone=max(zones), zones=dict(sorted(zones.items())), lookup=lookup)

def main():
    stages=[a for a in sys.argv[1:] if a.isdigit()]
    if not stages:
        stages=[re.search(r'wstag(\d+)',f).group(1) for f in sorted(glob.glob(f"{WSTAG_DIR}/wstag*.s"))]
    disc=Disc(DISC)
    rows=[]
    for s in stages:
        r=extract(disc,s)
        if r: rows.append(r)
    ok=[r for r in rows if 'error' not in r]
    bad=[r for r in rows if 'error' in r]
    print(f"type-4 zone maps: {len(rows)}  parsed OK: {len(ok)}  errors: {len(bad)}")
    for r in ok:
        print(f"  s{r['stage']}: file {r['file']:#x} sub {r['sub']} LBA{r['lba']} "
              f"grid {r['w']}x{r['h']} zones1..{r['max_zone']} {r['zones']}")
    for r in bad:
        print(f"  s{r['stage']}: file {r['file']:#x} sub {r['sub']} ERROR {r['error']}")
    if '--json' in sys.argv:
        out=os.path.join(os.path.dirname(__file__),'..','web','assets','data','zone_grids.json')
        doc={'_comment':'Per-stage zone lookup grids from the zonecheck grid-pyramid '
                        '(fieldstg fn 0x80092914). zone = uniform, or grid[(y//cell)*w + (x//cell)]; '
                        'index = zone-1 selects the stage encounter block. See '
                        'docs/research/battle-invocation.md (the zone map).',
             'stages':{r['stage']:r['lookup'] for r in ok}}
        json.dump(doc, open(os.path.normpath(out),'w'))
        print(f"wrote {os.path.normpath(out)}: {len(ok)} stages "
              f"({sum(1 for r in ok if 'uniform' in r['lookup'])} uniform, "
              f"{sum(1 for r in ok if 'grid' in r['lookup'])} gridded)")

if __name__=='__main__':
    main()
