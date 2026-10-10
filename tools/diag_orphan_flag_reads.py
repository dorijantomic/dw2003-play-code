#!/usr/bin/env python3
"""Attribute the 11 orphan flags via applier tables + record arrays.

- Table entry word=(val<<16)|id ; term low16==0xffff ; id==0 treated as boundary/pad.
- Each 0xc-byte record = {guard_ptr(+0), set_ptr(+4), aux(+8)}: fieldstg applies set_ptr
  table iff guard_ptr table all-get_flag-true. set_ptr ids = SET; guard_ptr ids = REQUIRED.
- Virtual id (bank>=0x60) in a table => guard-only (can't be set).
- Overlay RAM base derived from self-pointers (0x800a....) landing on table/word offsets.
"""
import re, glob
from pathlib import Path

ASM = Path.home() / "ddw3" / "asm" / "dw2003"
TARGETS = {0x0000,0x007f,0x00f7,0x0111,0x0118,0x020d,0x020e,0x020f,0x0210,0x1a03,0x40a5}
MAXVAL = 1
WORD_DIR = re.compile(r"^\.L0x([0-9a-f]+):\s*\.word (0x[0-9a-f]+)")
WORD_CMT = re.compile(r"^\.L0x([0-9a-f]+):.*#\s*\.word (0x[0-9a-f]+)")

def load_words(path):
    d={}
    for ln in open(path, errors="replace"):
        m=WORD_DIR.match(ln) or WORD_CMT.match(ln)
        if m: d[int(m.group(1),16)]=int(m.group(2),16)&0xffffffff
    return d

def is_id(i): return i not in (0,0xffff) and ((i>>8)&0xfe)<=0x92
def is_virtual(i): return ((i>>8)&0xfe)>=0x60

def find_tables(w):
    """return dict start_off -> [(id,val),...]  (id!=0 boundaries, term 0xffff)"""
    offs=set(w); tables={}
    for o in sorted(w):
        lo=w[o]&0xffff
        if not is_id(lo) or (w[o]>>16)&0xffff>MAXVAL: continue
        if (o-4) in w:
            p=w[o-4]; plo=p&0xffff
            if is_id(plo) and (p>>16)&0xffff<=MAXVAL: continue  # not a start
        ent=[]; c=o
        while c in w:
            ww=w[c]; lo=ww&0xffff; hi=(ww>>16)&0xffff
            if lo==0xffff: tables[o]=ent; break
            if not is_id(lo) or hi>MAXVAL: break
            ent.append((lo,hi)); c+=4
    return tables

def derive_base(w, tables):
    """self-pointers 0x800a.... ; base B so that many pointers map to a table start."""
    ptrs=[w[o] for o in w if 0x800a0000<=w[o]<0x800b0000]
    if not ptrs: return None
    starts=set(tables)
    from collections import Counter
    sc=Counter()
    for p in ptrs:
        for s in starts:
            B=p-s
            if 0x800a0000<=B<0x800b0000: sc[B]+=1
    if not sc: return None
    B,_=sc.most_common(1)[0]
    return B

def find_records(w, B, tables):
    """records {g,s,aux} stride 0xc; both g,s point to table starts. return list of (g_off,s_off)."""
    if B is None: return []
    starts=set(tables)
    recs=[]
    for o in sorted(w):
        g,s=w.get(o),w.get(o+4)
        if g is None or s is None: continue
        if not(0x800a0000<=g<0x800b0000 and 0x800a0000<=s<0x800b0000): continue
        go,so=g-B,s-B
        if go in starts and so in starts: recs.append((go,so))
    return recs

def classify(tables, recs):
    """off -> role ('SET'/'GUARD'/'?')"""
    role={o:'?' for o in tables}
    for go,so in recs:
        if go in role: role[go]='GUARD'
        if so in role: role[so]='SET'
    # virtual-bearing tables can only be guards
    for o,ent in tables.items():
        if any(is_virtual(i) for i,_ in ent) and role[o]=='?': role[o]='GUARD'
    return role

print("flag    stage   role   value  table(condition)")
print("-"*92)
rows=[]
for path in sorted(glob.glob(str(ASM/"pro"/"*.s"))):
    name=Path(path).stem; w=load_words(path)
    if not w: continue
    tables=find_tables(w)
    if not any(any(i in TARGETS for i,_ in ent) for ent in tables.values()): continue
    B=derive_base(w,tables); recs=find_records(w,B,tables); role=classify(tables,recs)
    for o,ent in tables.items():
        for i,v in ent:
            if i in TARGETS:
                cond=" ".join(f"{a:#06x}={b}" for a,b in ent)
                rows.append((i,name,role[o],v,cond))
for i,name,r,v,cond in sorted(rows):
    print(f"0x{i:04x}  {name:8s} {r:6s} ={v:<5d} [{cond}]")
