"""Sort every shared command the decompiled screen functions call into a kind.

Reads exe-decomp/{st*,cnty_sel,stagslct}_c. A call counts as known when it is
a proven or decoded resident service slot, a screen-table word that resolves
to a box-animation routine, a text-box or cursor command by slot (the slots
F0x8001ae38 and F0x8001b364 install), or a box method the same screen installs
at exactly one routine. Box commands are classed by slot, not by the proven
type of the called object. See docs/research/ui/captures/pause-menu-traced-2026-09-30.md
section 3d. Usage: python3 tools/count_screen_commands.py (TOP=n for more rows).
"""
import re,glob,collections,os,json,sys
inv=json.load(open("recovered/ddw3/function-inventory.json"))
base={}
for m in inv["modules"]:
    mid=m["id"].split("/")[-1]
    if m.get("load_base"): base[mid]=int(str(m["load_base"]),16) if isinstance(m["load_base"],str) else m["load_base"]
FOLD={"80091fdc","800858a0","800867e8","8008a2d8","80088fb4","80083378","80086730","80086fa0","80085c90","8008f22c","8008b8fc","8008c2dc","80083d70","80088438","80099d5c",
      "80092070","80085934","8008687c","8008a36c","80089048","8008340c","800867c4","80087034","80085d24","8008f2c0","8008b990","8008c370","80083e04","800884cc","80099df0"}
TWEEN={"80099e5c","80099ef0","80087fdc"}
# run-time table words read on the rig (stitshop, summary service_map)
RIG={("stitshop",0x8008d1b8):"8008c2dc",("stitshop",0x8008d1bc):"8008c370",("stitshop",0x8008d1b0):"8008c17c",("stitshop",0x8008d1b4):"8008c238",
     ("stitshop",0x8008d1cc):"8008c4cc",("stitshop",0x8008d1d0):"8008c510",("stitshop",0x8008d1d4):"8008c800"}
SHOPLOCAL={"8008c4cc":"party data","8008c510":"party data","8008c800":"party data"}  # can-use test, equip slot, equip (shop buy steps 0x15-0x20, rig wpnshop-trace1)
ALMOST={("stgtrain",0x8008d2b0):"box animation",("stgtrain",0x8008d2b4):"box animation"}  # call shape only
RES={}
def svc(b,kind,*slots):
    for s in slots: RES[b+int(s,16)]=kind
svc(0x8004B7D0,"buttons","3F4","3F8","3FC","408")
svc(0x80044B38,"data load","404","40C","414","424","428")
svc(0x8004DE10,"drawing","150","158","15C","16C","174","17C","188")
svc(0x80048D34,"party data","2718","2728","2750")
svc(0x80042B98,"item data","0","8")
OBJ={}
def obj(kind,*slots):
    for s in slots: OBJ[s]=kind
obj("screen step","28","2C","30","34","38","3C","40","44","4C")
obj("show/hide","144"); obj("cursor","80","84"); obj("layout","134","138","148","15C")
obj("text","110","114","118","120","130","11C","128","14C","160")
obj("text look","12C","13C")
obj("animation","140")
obj("layout","154","158","150","164")
obj("state query","168","16C","170")
obj("drawing","124")
# cursor: colour, rest time, frame time, freeze (F0x8001b0a4 fields +0x60/+0x74/+0x78/+0x7C)
obj("cursor","88","8C","90","94")
SHOPOBJ={"6E8":"list","6EC":"list","6F0":"list","6F4":"list","6F8":"list","6FC":"list","700":"list",
         "234":"side box","238":"side box","23C":"side box","240":"side box","244":"side box"}
RES[0x8004B5EC]="memory"; RES[0x8004B5DC+0x18]="memory"; RES[0x8004B5DC+0x1C]="memory"
RES[0x8004DC0C]="random"; RES[0x80042B98+0xC]="item data"; RES[0x80055C48]="sound"
svc(0x80048D34,"party data","2734","2738","2748","270C","2708","2714")
svc(0x8004DE10,"drawing","154","184","18C")
EXTRA=json.load(open(sys.argv[1])) if len(sys.argv)>1 else {}
words={}
def word_at(mod,addr):
    if (mod,addr) in RIG: return RIG[(mod,addr)]
    if mod not in words:
        w={}
        p=os.path.expanduser(f"~/ddw3/asm/dw2003/pro/{mod}.s")
        if os.path.exists(p):
            for line in open(p,errors="ignore"):
                m=re.match(r"\.L0x([0-9a-f]{8}): \.word 0x([0-9a-f]{8})",line)
                if m: w[int(m.group(1),16)]=m.group(2)
        words[mod]=w
    return words[mod].get(addr-base.get(mod,0))
call=re.compile(r"(?:\(void \*\)|\*\(\S+\s\(\*\*\)\([^)]*\)\))?(0x800[0-9A-F]{5})?\)?->unk(-?[0-9A-F]+)\(")
OWN=collections.defaultdict(lambda:collections.defaultdict(set))
for d in glob.glob("exe-decomp/*_c"):
    mod=os.path.basename(d)[:-2]
    for f in glob.glob(d+"/F0x*.c"):
        for sl,t in re.findall(r"->unk([0-9A-F]+) = \(?[^;]*?(0x800[0-9A-F]{5});",open(f,errors="ignore").read()):
            OWN[mod][sl].add(t)
tot=none=allk=almost=0; left=collections.Counter(); kinds=collections.Counter(); ex={}
per=collections.defaultdict(lambda:[0,0])
for d in glob.glob("exe-decomp/*_c"):
    mod=os.path.basename(d)[:-2]
    if not re.match(r"(st\w+|cnty_sel|stagslct)$",mod): continue
    for f in glob.glob(d+"/F0x*.c"):
        s=open(f,errors="ignore").read(); tot+=1; per[mod][0]+=1
        # A local name that only ever holds one table address stands for that table.
        assigns=collections.defaultdict(set)
        for v,rhs in re.findall(r"\b([A-Za-z_]\w*) = ([^;]+);",s): assigns[v].add(rhs.strip())
        for v,rh in assigns.items():
            vals=set()
            for r in rh:
                r2=re.sub(r"^\((?:void|s32|u32) \*?\)","",r).strip()
                if re.fullmatch(r"0x[0-9A-Fa-f]+(\s*[-+]\s*0x[0-9A-Fa-f]+)?",r2): vals.add(eval(r2))
                else: vals.add(None)
            if len(vals)==1 and None not in vals:
                a=vals.pop()
                if 0x80010000<=a<0x800c0000: s=re.sub(r"\b"+v+r"->unk","(void *)0x%08X->unk"%a,s)
        cs=call.findall(s)
        if not cs: none+=1; per[mod][1]+=1; continue
        ok=True; alm=False
        for b,x in cs:
            k=None
            if b:
                a=int(b,16)+int(x,16)
                if a in RES: k=RES[a]
                elif str(a) in EXTRA: k=EXTRA[str(a)]
                else:
                    t=word_at(mod,a)
                    if t in FOLD: k="box animation"
                    elif t in TWEEN: k="animation"
                    elif t in SHOPLOCAL: k=SHOPLOCAL[t]
                    elif (mod,a) in ALMOST: k=ALMOST[(mod,a)]; alm=True
                    key=(mod,hex(a),t)
            else:
                if x in OBJ: k=OBJ[x]
                elif mod=="stitshop" and x in SHOPOBJ: k=SHOPOBJ[x]
                elif len(OWN[mod].get(x,()))==1: k="own box method"
                key=("obj",x)
            if k: kinds[k]+=1
            else: ok=False; left[key]+=1; ex.setdefault(key,os.path.basename(f))
        if ok and not alm: allk+=1; per[mod][1]+=1
        elif ok: almost+=1
print("functions",tot,"no shared",none,"all known",allk,"readable",none+allk,f"{(none+allk)/tot:.0%}","almost",almost)
print("kinds",dict(kinds.most_common()))
print("unknown commands",len(left),"uses",sum(left.values()))
for k,v in left.most_common(int(os.environ.get("TOP","30"))): print(" ",k,v,ex[k])
print({m:f"{r}/{t}" for m,(t,r) in sorted(per.items())})
