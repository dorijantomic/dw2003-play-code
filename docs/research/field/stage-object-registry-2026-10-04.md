---
reach: Any field stage where a script does SETANIM on a number of 800 or more -- the crevice-ride boulders, the opening street's cars and news screens, the satellite dishes, the doors, the download halo.
status: canonical
---

# The field stage-object registry: every member on every stage (2026-10-04)

Scope: the `SETANIM` ids at 0x320 and above.  This is the *whole* system, not one
screen: one static table, 56 records, walked by two shared routines, resolved per
stage.  This began on 2026-10-04 as the inventory and the port plan, with
nothing here ported yet; the port status is now kept in §5, §7 and §8,
backed by `data/stage_registry_members.json`.

Machine-readable: `data/stage_registry_members.json`.
Regenerate every table below with

```sh
taskset -c 0 prlimit --as=4294967296 -- python3 tools/inventory_stage_registry.py --out data/stage_registry_members.json
taskset -c 0 prlimit --as=4294967296 -- python3 tools/inventory_stage_registry.py --records        # §5
taskset -c 0 prlimit --as=4294967296 -- python3 tools/inventory_stage_registry.py --doc-stages    # §6
taskset -c 0 prlimit --as=4294967296 -- python3 tools/inventory_stage_registry.py --doc-groups    # §7
taskset -c 0 prlimit --as=4294967296 -- python3 tools/inventory_stage_registry.py --unresolved   # §9
```

## 1. What a script line does

A stage's event bytecode is executed by fieldstg.  `SETANIM` is the eight-byte
opcode `1.1`, dispatched from file `0x2420` (`jal 0x80084dd0` at `0x2428`), and its handler
reads three halfwords out of the operand area:

```
.L0x0000213c: lh $s2, 0x2($a1)     # first operand  -- the object id
.L0x00002140: lh $s3, 0x4($a1)     # second
.L0x00002144: lh $s4, 0x6($a1)     # third
.L0x00002148: slti $v0, $s2, 0x320
.L0x0000214c: beqz $v0, .L0x00002180   # >= 0x320 -> the registry, below
.L0x00002150: move_ $s0, $a2          # (delay slot)
```

`slti $v0, $s2, 0x320` sets `$v0 = ($s2 < 0x320)`, so `beqz` takes the branch when
the id is 0x320 or more.  Below 0x320 the handler falls through to
`jal 0x80084d8c` (find the field actor whose slot `+0x64` holds the id) and calls
that actor's `+0x148` method with the second and third operands -- an ordinary
animation clip.  **At 0x320 and above it is a stage object, and this document is
about those.**

## 2. The registry walk, and how a record's constructor is called

The table is **static data inside FIELDSTG.PRO**, not runtime-populated BSS:
file `0x18738`, RAM `0x8009b3e8`, twelve-byte records
`{u32 id; u32 construct_fn; u32 draw_fn}`, terminated by `id == 0`.  The bytes
below are read out of the shipped image (`web/assets/native/fieldstg.bin`), so
they are the same 56 records on every stage.

`F0x8009243c` (file `0xf78c`) is the walk:

```
.L0x0000f78c: lui $v0, 0x800a
.L0x0000f790: lw $v1, -0x4c18($v0)      # $v1 = [0x8009b3e8], the first id
.L0x0000f798: beqz $v1, .L0x0000f7c4    # a zero id ends the table
.L0x0000f79c: addiu $a1, $v0, -0x4c18   # delay slot: $a1 = 0x8009b3e8
.L0x0000f7a0: lw $v0, ($a1)             # rec->id
.L0x0000f7a4: nop
.L0x0000f7a8: beq $v0, $a0, .L0x0000f7cc   # match: return the record pointer
.L0x0000f7ac: move_ $v0, $a1              # (delay slot)
.L0x0000f7b0: addiu $a1, 0xc             # twelve bytes to the next record
.L0x0000f7b4: lw $v0, ($a1)
.L0x0000f7bc: bnez $v0, .L0x0000f7a0     # loop while the id is not zero
.L0x0000f7c4: jr $ra
.L0x0000f7c8: move_ $v0, $zr            # not found -> 0
```

So a record with `id == 0` is the terminator and can never match: the loop tests
it before the compare.

`F0x80092484` (file `0xf7d4`) is the constructor, and it passes **the id** as the
only argument:

```
.L0x0000f7e0: jal 0x8009243c
.L0x0000f7e4: move_ $s0, $a0            # delay slot: keep the id
.L0x0000f7e8: beqz $v0, .L0x0000f804    # no record -> no instance
.L0x0000f7ec: move_ $v1, $zr            # (delay slot)
.L0x0000f7f0: lw $v0, 0x4($v0)          # rec->construct_fn
.L0x0000f7f4: nop
.L0x0000f7f8: jalr $v0                  # construct_fn($a0 = id)
.L0x0000f7fc: move_ $a0, $s0            # (delay slot)
.L0x0000f800: move_ $v1, $v0            # the instance is the return value
```

`F0x800924c8` (file `0xf818`) is the per-instruction handler, and it passes the
**instance** plus the other two operands, never the id:

```
.L0x0000f820: move_ $s0, $a0            # the instance
.L0x0000f824: move_ $a0, $a1            # look the record up by id again
.L0x0000f82c: move_ $s1, $a2            # second operand
.L0x0000f838: jal 0x8009243c
.L0x0000f83c: move_ $s2, $a3            # delay slot: third operand
.L0x0000f848: lw $v0, 0x8($v0)          # rec->draw_fn
.L0x0000f850: beqz $v0, .L0x0000f864    # a null draw is skipped
.L0x0000f854: move_ $a0, $s0            # draw_fn(instance, second, third)
```

The same handler's registry arm, from file `0x2180`, puts the two together, and
its ten slots are the whole lifetime budget:

```
.L0x00002180: move_ $a0, $s2
.L0x00002184: li $a1, -0x1
.L0x00002188: lui $v0, 0x8005
.L0x0000218c: lw $v0, -0x4844($v0)      # [0x8004b7bc]  (lui 0x8005 - 0x4844)
.L0x00002194: jalr $v0                  # EXE F0x8001810c: is the object already live?
.L0x00002198: move_ $a2, $a1            # (delay slot) $a2 = -1
.L0x0000219c: move_ $s1, $v0
.L0x000021a0: bnez $s1, .L0x000021e8    # live -> configure only
.L0x000021a8: move_ $v1, $zr            # (delay slot) slot index
.L0x000021ac: lw $v0, 0x10($s0)         # ten 4-byte slots at <field object>+0x10
.L0x000021b4: bnez $v0, .L0x000021d4    # slot taken -> next
.L0x000021b8: addiu $v1, 0x1            # (delay slot)
.L0x000021bc: jal 0x80092484            # construct
.L0x000021c0: move_ $a0, $s2            # (delay slot) $a0 = id
.L0x000021c4: beqz $v0, .L0x000021e0
.L0x000021c8: sw $v0, 0x10($s0)         # park the instance in the slot
.L0x000021d4: slti $v0, $v1, 0xa        # ten slots, then give up
.L0x000021d8: bnez $v0, .L0x000021ac
.L0x000021dc: addiu $s0, 0x4            # (delay slot)
.L0x000021e0: beqz $s1, .L0x000021f8    # nothing live -> do nothing
.L0x000021e8: move_ $a1, $s2
.L0x000021ec: move_ $a2, $s3
.L0x000021f0: jal 0x800924c8            # configure
.L0x000021f4: move_ $a3, $s4
.L0x00002210: li $v0, 0x4               # eight bytes consumed (4 halfwords)
```

Three things follow, and all three are load-bearing:

* **"already live" is keyed on the allocator's fourth argument.**  The lookup is
  EXE `F0x8001810c` -> `F0x8001804c`, which compares the resident object's `+0x00`
  against the id.  `F0x800143dc` stores its fourth argument at `obj+0x00` and only
  then registers the object (`exe/fns.s:0x800144c8-0x800144dc`), so the fourth
  argument *is* the object's public name.
* **An id that is fired twice reuses the same object** unless the ten slots ran
  out; a stage that fires eleven distinct ids on one field object silently drops
  the eleventh.
* **A null function pointer is skipped, not called** -- but only *after* the
  record has been found.  See §3 and §4.

## 3. A record's address is not a function

Every `wstag*.s` overlay loads at `0x800A5DE0`.  Six of the 56 records name
FIELDSTG's own resident code, and mean the same thing everywhere:

| id | construct_fn | draw_fn | what it is |
|---|---|---|---|
| `0x323`..`0x326` (803-806) | `0x80088190` | `0x800881b8` | the four speech bubbles |
| `0x32d` (813) | `0x80083cd8` | `0x800837ec` | the resident scene object (party gather on C 823) |
| `0x33a` (826) | `0x80084198` | `0x80084124` | -- no recovered script fires it |

The other 50 name a place *inside the stage overlay window*.  On the stage that
owns the id, that address is that stage's own routine; on any other stage it is
that stage's unrelated code or its data.  So the table holds one **address** per
id, and the overlay decides what it means.

**What happens when the resident overlay has no code at a record's constructor
address.**  The original does not test for it.  `F0x80092484` finds the record,
loads `rec->construct_fn`, and `jalr`s it unconditionally -- the only guard is on
the *record pointer*, not on the function.  So a fire on the wrong stage jumps
into whatever the loader left at that address: another stage's constructor (which
would allocate the wrong object and register it under the wrong id), a data word
read as instructions, or, once the address is past the image the loader copied,
whatever the previously loaded overlay left there.  There is no "not on this
stage" answer to print; the game relies on the data instead -- see the next
paragraph, and `ids_never_fired_by_a_recovered_script` in the JSON.

How wide is "past the image"?  The images the loader copies are the overlay's own
code and data: 672 bytes to 0x4b28 across the 294 overlays.  The largest
constructor address is `0x800a749c` (id `0x321`, offset `0x16bc`), which is inside
the biggest overlay and past the end of **233 of the 294**.  **I have not read the
overlays' declared BSS sizes**, so I cannot say whether an address past the image
is zeroed or still holds the previous overlay's bytes; the `draw here` column in §6
therefore only distinguishes "code in this stage's image", "a data word in this
stage's image", "outside this stage's image" and "null".

The records that never fire are the direct evidence for the rule.  `0x341` (833)
and `0x342` (834) are stage-owned records whose constructor is `0x800a5f60`, and
**no recovered script on any stage fires them**; read on 19 different stages that
address happens to look like a constructor, and on three of them (`s325`, `s326`,
`s421`) it resolves to each stage's own bootstrap at overlay+0.  A fire there
would construct the stage root object under the id 833.  The table's ids are
therefore allocated one stage each, and the scripts honour that: **every one of
the 48 stage-owned ids a script fires is fired by exactly one stage** (checked
over all 139 recovered script tables).  The one exception in the other direction
is id `0x32d` (813), which 120 stages fire -- because its constructor is
fieldstg's own, not theirs.

## 4. The thirteen records with no constructor

13 of the 50 stage-owned records have `construct_fn == 0`:
`0x32c`, `0x344`, `0x345`, `0x348`, `0x349`, `0x34a`, `0x34b`, `0x34c`, `0x34d`,
`0x34e`, `0x34f`, `0x352`, `0x353`.

They are not dead, and the original does not fault on them: **the owning stage
creates the object itself**, passing the id as the allocator's fourth argument, so
the object is already in the live list when the script fires the id and the
construct step is never reached.  s415 is the worked example -- `wstag415.s`
file `0x1104`, the delay slot of its `jal F0x800143dc`:

```
.L0x000010ec: lui $a0, 0x800a
.L0x000010f0: addiu $a0, 0x6c8c         # tick 0x800a6c8c
.L0x000010f4: li $a1, 0x60              # 96-byte object
.L0x000010f8: move_ $a2, $zr
.L0x00001100: jal F0x800143dc
.L0x00001104: li $a3, 0x32c             # registered as id 812
```

and s810 does it with three builders -- `wstag810.s` file `0x588`/`0x5c4`/`0x600`
call file `0x3e4`/`0x424`/`0x460` with `li $a0, 0x34c` / `0x34b` / `0x34a`.  Each of
those three is the same two instructions and the same allocator call:

```
.L0x00000424: move_ $a3, $a0                      # the id becomes the object's name
.L0x00000428: lui $a0, 0x800a
.L0x0000042c: addiu $a0, 0x5f00                   # tick 0x800a5f00, all three
.L0x00000430: li $a1, 0x68                        # a 104-byte object
.L0x00000438: jal F0x800143dc
```

so three registry ids address one object, and each builder stamps its own number
at `obj+0x52` (1, 3, 5).  **A port has to carry that shape: three ids, one
object.**

s810 also has a fallback, and it is worth reading before porting.  When the
resource lookup fails (`beqz $v0, .L0x00000610`) it calls file `0x498` with `0x1` /
`0x3` / `0x5` instead of `0x34a` / `0x34b` / `0x34c`.  File `0x498` builds the same
object -- same tick `0x800a5f00`, same `0x68` size, same `obj+0x52` stamp -- but
through `F0x80014504`, the three-argument wrapper whose delay slot is
`move_ $a3, $zr` (`exe/fns.s:0x8001450c-0x80014510`), so the object is **not
registered under any id** and it sets `obj+0x51 = 1`.  The live-object lookup
therefore cannot find it, and since the record's constructor is null a
`SETANIM 842` in that state would reach `jalr` on address zero.  **I have not
established whether s810's resource is ever missing in a shipped game**, so I am
not claiming the fallback runs; I am recording that it cannot be ported as "the
same builder with a different id", because it is not.

The same symmetry holds the other way: **20 records have `draw_fn == 0`** --
`0x322`, `0x330`-`0x339`, `0x33c`, `0x343`, `0x346`, `0x347`, `0x351`, `0x354`,
`0x355`, `0x356`, `0x357` -- and are construct-only.  The s415 boulders are ten of
them: one id per builder, each builder allocating a 0x74-byte object whose slot
number it stores at `obj+0x04`.

The walker's research interpreter guards the null constructor with `ctor !== 0`
(`engine/native/runtime.ts` `fireEffect`); the original needs no guard, and the
census reads the tick off the stage's own call instead.

## 5. The 56 records

`lives in` is `stage` for an address inside the stage overlay window, `fieldstg`
for fieldstg's own resident code, `null` for a zero word.  `owner` is the stage
whose scripts fire the id; for the fieldstg records it is the number of stages
that fire it.

| id | construct_fn | lives in | draw_fn | lives in | owner | tick it installs | family | port |
|---|---|---|---|---|---|---|---|---|
| `0x320` (800) | 0x800a6f8c | stage | 0x800a6f40 | stage | s780 | 0x800a6dc4 | `98fe3dbefb05` | ported |
| `0x321` (801) | 0x800a749c | stage | 0x800a7450 | stage | s780 | 0x800a72b0 | `721b07f03f45` | ported |
| `0x322` (802) | 0x800a635c | stage | 0x00000000 | null | s780 | 0x800a61c8 | `18a23268b60a` | ported |
| `0x323` (803) | 0x80088190 | fieldstg | 0x800881b8 | fieldstg | fieldstg, shared by 61 stage(s) | - | - | ported |
| `0x324` (804) | 0x80088190 | fieldstg | 0x800881b8 | fieldstg | fieldstg, shared by 18 stage(s) | - | - | ported |
| `0x325` (805) | 0x80088190 | fieldstg | 0x800881b8 | fieldstg | fieldstg, shared by 10 stage(s) | - | - | ported |
| `0x326` (806) | 0x80088190 | fieldstg | 0x800881b8 | fieldstg | fieldstg, shared by 4 stage(s) | - | - | ported |
| `0x327` (807) | 0x800a6510 | stage | 0x800a6540 | stage | s785 | 0x800a62b4 | `068918e43ec6` | ported |
| `0x328` (808) | 0x800a625c | stage | 0x800a6224 | stage | s790 | 0x800a6138 | `2f8f168ac7dd` | ported |
| `0x329` (809) | 0x800a6108 | stage | 0x800a60d0 | stage | s790 | 0x800a5df4 | `edfd4eaf74ec` | ported |
| `0x32a` (810) | 0x800a61fc | stage | 0x800a6148 | stage | s212 | 0x800a5ef4 | `53b7966aee5a` | ported |
| `0x32b` (811) | 0x800a6a98 | stage | 0x800a698c | stage | s415 | 0x800a6558 | `389277009daa` | ported |
| `0x32c` (812) | 0x00000000 | null | 0x800a6e88 | stage | s415 | 0x800a6c8c | `9e9f99e27a13` | interpreter only (the s415 scrolling layer, §21.3) |
| `0x32d` (813) | 0x80083cd8 | fieldstg | 0x800837ec | fieldstg | fieldstg, shared by 120 stage(s) | - | - | ported |
| `0x32e` (814) | 0x800a63ac | stage | 0x800a627c | stage | s680 | 0x800a5fd8 | `7d363a3ed472` | ported |
| `0x32f` (815) | 0x800a61e0 | stage | 0x800a6174 | stage | s225 | 0x800a5ef0 | `033edb715349` | ported |
| `0x330` (816) | 0x800a6230 | stage | 0x00000000 | null | s415 | 0x800a5fa8 | `493e32ee1e09` | ported |
| `0x331` (817) | 0x800a6264 | stage | 0x00000000 | null | s415 | 0x800a5fa8 | `493e32ee1e09` | ported |
| `0x332` (818) | 0x800a629c | stage | 0x00000000 | null | s415 | 0x800a5fa8 | `493e32ee1e09` | ported |
| `0x333` (819) | 0x800a62d4 | stage | 0x00000000 | null | s415 | 0x800a5fa8 | `493e32ee1e09` | ported |
| `0x334` (820) | 0x800a630c | stage | 0x00000000 | null | s415 | 0x800a5fa8 | `493e32ee1e09` | ported |
| `0x335` (821) | 0x800a6344 | stage | 0x00000000 | null | s415 | 0x800a5fa8 | `493e32ee1e09` | ported |
| `0x336` (822) | 0x800a637c | stage | 0x00000000 | null | s415 | 0x800a5fa8 | `493e32ee1e09` | ported |
| `0x337` (823) | 0x800a63b4 | stage | 0x00000000 | null | s415 | 0x800a5fa8 | `493e32ee1e09` | ported |
| `0x338` (824) | 0x800a63ec | stage | 0x00000000 | null | s415 | 0x800a5fa8 | `493e32ee1e09` | ported |
| `0x339` (825) | 0x800a6424 | stage | 0x00000000 | null | s415 | 0x800a5fa8 | `493e32ee1e09` | ported |
| `0x33a` (826) | 0x80084198 | fieldstg | 0x80084124 | fieldstg | fieldstg, fired by no recovered script | - | - | - |
| `0x33b` (827) | 0x800a628c | stage | 0x800a6218 | stage | s261 | 0x800a5dfc | `bf971cb78d27` | ported |
| `0x33c` (828) | 0x800a6010 | stage | 0x00000000 | null | s455 | 0x800a5ebc | `082ad78ee00e` | ported |
| `0x33d` (829) | 0x800a6028 | stage | 0x800a5ff0 | stage | s526 | 0x800a5de0 | `fd5376846836` | ported |
| `0x33e` (830) | 0x800a5fc8 | stage | 0x800a5f90 | stage | s460 | 0x800a5de0 | `b3698daed084` | ported |
| `0x33f` (831) | 0x800a65d4 | stage | 0x800a6598 | stage | s310 | 0x800a61d0 | `1cd887c34016` | ported |
| `0x340` (832) | 0x800a6b58 | stage | 0x800a6b1c | stage | s310 | 0x800a6758 | `b31f90eb65b7` | ported |
| `0x341` (833) | 0x800a5f60 | stage | 0x800a5f90 | stage | **no stage fires it** | - | - | - |
| `0x342` (834) | 0x800a5f60 | stage | 0x800a5f90 | stage | **no stage fires it** | - | - | - |
| `0x343` (835) | 0x800a61d8 | stage | 0x00000000 | null | s785 | 0x800a5f04 | `7263bace5430` | ported |
| `0x344` (836) | 0x00000000 | null | 0x800a6180 | stage | s795 | 0x800a5f00 | `d47fb42c495f` | ported |
| `0x345` (837) | 0x00000000 | null | 0x800a6174 | stage | s800 | 0x800a5f00 | `ef3997e796d4` | ported |
| `0x346` (838) | 0x800a73e4 | stage | 0x00000000 | null | s311 | 0x800a70f8 | `c56260af5983` | ported |
| `0x347` (839) | 0x800a6510 | stage | 0x00000000 | null | s800 | 0x800a6344 | `8aeef55f8f56` | ported |
| `0x348` (840) | 0x00000000 | null | 0x800a63c4 | stage | s805 | 0x800a60cc | `4eeafbc9e7fd` | ported |
| `0x349` (841) | 0x00000000 | null | 0x800a5f64 | stage | s805 | 0x800a5de4 | `a5d8a25da452` | ported |
| `0x34a` (842) | 0x00000000 | null | 0x800a6178 | stage | s810 | 0x800a5f00 | `956c552225e7` | ported |
| `0x34b` (843) | 0x00000000 | null | 0x800a6178 | stage | s810 | 0x800a5f00 | `956c552225e7` | ported |
| `0x34c` (844) | 0x00000000 | null | 0x800a6178 | stage | s810 | 0x800a5f00 | `956c552225e7` | ported |
| `0x34d` (845) | 0x00000000 | null | 0x800a67bc | stage | s820 | 0x800a6488 | `8d27f383b83b` | ported |
| `0x34e` (846) | 0x00000000 | null | 0x800a6170 | stage | s750 | 0x800a5ef0 | `2716f1dd9201` | ported |
| `0x34f` (847) | 0x00000000 | null | 0x800a6304 | stage | s545 | 0x800a6184 | `9187707023c0` | ported |
| `0x350` (848) | 0x800a6894 | stage | 0x800a6780 | stage | s545 | 0x800a648c | `87f18f7002a5` | ported |
| `0x351` (849) | 0x800a6198 | stage | 0x00000000 | null | s620 | 0x800a5f00 | `16a91e17f444` | ported |
| `0x352` (850) | 0x00000000 | null | 0x800a6018 | stage | s305 | 0x800a5eb8 | `0773c9088e9f` | ported |
| `0x353` (851) | 0x00000000 | null | 0x800a6018 | stage | s306 | 0x800a5eb8 | `5ec4a1092b44` | ported |
| `0x354` (852) | 0x800a72cc | stage | 0x00000000 | null | s310 | 0x800a70ac | `3b4e7923ac35` | ported |
| `0x355` (853) | 0x800a5fb4 | stage | 0x00000000 | null | s820 | 0x800a5eb8 | `a98d2790cb7c` | ported |
| `0x356` (854) | 0x800a609c | stage | 0x00000000 | null | s926 | 0x800a5f70 | `59a7b4d415ec` | ported |
| `0x357` (855) | 0x800a639c | stage | 0x00000000 | null | s925 | 0x800a6110 | `6280004a9cbc` | ported |

## 6. Every member on every stage

| stage | id | params fired (arg2 arg3) | events | record ctor | tick installed | family | draw here | port |
|---|---|---|---|---|---|---|---|---|
| s200 | `0x323` | 805 57; 806 57 | 50 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s200 | `0x32d` | 823 1 | 50 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s202 | `0x32d` | 823 2 | 220 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s205 | `0x323` | 805 102; 806 102 | 100 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s205 | `0x32d` | 823 2 | 100 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s206 | `0x323` | 805 2; 805 103; 805 243; 806 2; 806 243 | 730,922 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s206 | `0x324` | 805 179; 805 244; 806 179; 806 244 | 730,922 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s206 | `0x325` | 805 245; 806 245 | 730 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s206 | `0x32d` | 823 2; 845 2 | 730,921,922 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s210 | `0x323` | 805 2; 805 106; 805 179; 806 2; 806 106; 806 179; 807 2 | 20,30,320,330,685 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s210 | `0x32d` | 823 2; 824 2; 825 2; 847 2; 847 107; 853 2; 853 107 | 20,30,58,310,685 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s211 | `0x323` | 805 194; 806 194 | 925 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s211 | `0x324` | 805 195; 806 195 | 925 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s211 | `0x325` | 805 196; 806 196 | 925 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s211 | `0x32d` | 823 2 | 925 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s212 | `0x323` | 805 1; 805 57; 806 1; 806 57; 807 1 | 10,11,12,271,273 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s212 | `0x324` | 805 11; 805 14; 806 11; 806 112 | 10,11,12,271 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s212 | `0x325` | 805 12; 805 50; 806 12; 806 50 | 10,11,12,271 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s212 | `0x326` | 805 53; 806 53 | 271 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s212 | `0x32a` | 815 1; 826 1; 826 64; 827 1; 827 66; 828 1 | 10,11,12 | 0x800a61fc | 0x800a5ef4 | `53b7966aee5a` | code in this stage's image (file 0x368) | ported |
| s212 | `0x32d` | 824 1; 825 1; 847 2; 853 2; 870 1; 871 1 | 10,11,12,271,352 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s220 | `0x32d` | 823 2; 824 2; 825 2 | 53,54,55,56 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s225 | `0x32f` | 837 1; 838 1 | 5 | 0x800a61e0 | 0x800a5ef0 | `033edb715349` | code in this stage's image (file 0x394) | ported |
| s226 | `0x323` | 805 1; 806 1; 807 1 | 935 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s226 | `0x324` | 805 12; 806 12 | 935 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s235 | `0x32d` | 823 2; 885 2 | 1200 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s236 | `0x32d` | 823 2; 885 2 | 1201 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s237 | `0x32d` | 823 2 | 300 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s245 | `0x323` | 805 30; 805 294; 806 30; 806 294 | 1250,1251 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s245 | `0x32d` | 823 2 | 1250,1251 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s261 | `0x32d` | 823 2; 876 2 | 1321,1326 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s261 | `0x33b` | 840 2; 841 2 | 1321,1326 | 0x800a628c | 0x800a5dfc | `bf971cb78d27` | code in this stage's image (file 0x438) | ported |
| s270 | `0x323` | 805 52; 805 206; 806 52; 806 55; 806 206; 807 52; 807 55 | 1415 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s270 | `0x324` | 805 55; 806 55 | 1415 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s270 | `0x32d` | 823 2; 824 2; 825 2; 842 2 | 59,65,1415,1521 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s280 | `0x32d` | 823 2; 824 2; 825 2 | 57,67,1523 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s285 | `0x323` | 805 37; 806 37; 807 37 | 40,272,340 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s295 | `0x323` | 805 2; 805 12; 805 108; 806 2; 806 12; 806 108 | 580,891,892 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s295 | `0x324` | 805 12; 805 67; 805 101; 806 12; 806 67; 806 101 | 580,891,892 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s295 | `0x325` | 805 32; 805 101; 806 32; 806 101 | 580,892 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s295 | `0x326` | 805 37; 806 37 | 580 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s295 | `0x32d` | 823 2 | 580 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s300 | `0x323` | 805 2; 805 304; 805 330; 806 2; 806 330; 807 2 | 349,570,571,572 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s300 | `0x32d` | 823 2; 845 2; 845 106; 851 2 | 349,570,571,572 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s305 | `0x323` | 805 1; 805 2; 805 12; 805 38; 805 101; 805 106; 805 107; 805 111; 806 1; 806 2; 806 12; 806 38; 806 101; 806 106; 806 107; 806 111; 807 2; 807 101 | 350,351,660,661,683,890,893,894,895,960 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s305 | `0x324` | 805 11; 805 39; 805 102; 805 106; 805 107; 806 11; 806 39; 806 102; 806 106; 806 107 | 350,683,890,893,894,895 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s305 | `0x325` | 805 101; 805 103; 806 101; 806 103 | 683,893,894,895 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s305 | `0x326` | 805 103; 806 103 | 683,890 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s305 | `0x32d` | 1 0; 823 2 | 895,960,965 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s305 | `0x352` | 821 2 | 661 | 0x00000000 | 0x800a5eb8 | `0773c9088e9f` | code in this stage's image (file 0x238) | ported |
| s306 | `0x323` | 805 1; 806 1 | 930,980 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s306 | `0x32d` | 823 2 | 966 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s306 | `0x353` | 821 1 | 930 | 0x00000000 | 0x800a5eb8 | `5ec4a1092b44` | code in this stage's image (file 0x238) | ported |
| s310 | `0x323` | 805 1; 805 2; 805 108; 805 109; 805 272; 806 1; 806 2; 806 109; 806 272 | 680,681,682,961 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s310 | `0x324` | 805 110; 805 273; 806 110; 806 273 | 680,961 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s310 | `0x325` | 805 119; 805 274; 806 119; 806 274 | 680,961 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s310 | `0x32d` | 873 2 | 681 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s310 | `0x33f` | 857 2 | 681 | 0x800a65d4 | 0x800a61d0 | `1cd887c34016` | code in this stage's image (file 0x7b8) | ported |
| s310 | `0x340` | 857 2 | 681 | 0x800a6b58 | 0x800a6758 | `b31f90eb65b7` | code in this stage's image (file 0xd3c) | ported |
| s310 | `0x354` | 821 2 | 681 | 0x800a72cc | 0x800a70ac | `3b4e7923ac35` | null (the original skips it) | ported |
| s311 | `0x323` | 805 1; 805 2; 805 103; 806 1; 806 2; 806 103 | 931,932,933,934,981 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s311 | `0x324` | 805 12; 805 101; 806 12; 806 101 | 933 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s311 | `0x325` | 805 12; 806 12 | 933 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s311 | `0x326` | 805 103; 806 103 | 933 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s311 | `0x32d` | 873 2 | 932 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s311 | `0x346` | 821 1; 821 838 | 981,982 | 0x800a73e4 | 0x800a70f8 | `c56260af5983` | null (the original skips it) | ported |
| s320 | `0x32d` | 823 2; 842 2 | 290 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s325 | `0x323` | 805 165; 806 2; 806 165 | 375,560 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s325 | `0x32d` | 823 2; 842 2 | 375,376,560 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s326 | `0x32d` | 823 2; 842 2 | 1281,1282 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s331 | `0x323` | 805 2; 805 178; 806 2; 806 11; 806 178; 807 2; 807 178 | 920,970 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s331 | `0x32d` | 823 2 | 920,970 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s340 | `0x323` | 805 2; 806 2 | 1310 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s340 | `0x32d` | 823 2; 842 2 | 1310 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s345 | `0x323` | 805 2; 805 283; 806 2; 806 283 | 1264 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s345 | `0x32d` | 823 2; 886 2 | 1264 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s360 | `0x32d` | 823 2; 885 2 | 1457 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s361 | `0x32d` | 823 2; 885 2 | 1205 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s366 | `0x323` | 805 45; 806 45 | 720 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s366 | `0x32d` | 823 2; 842 2 | 720 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s375 | `0x32d` | 823 2; 842 2 | 1260,1261 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s376 | `0x32d` | 823 2; 842 2 | 1283,1284 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s380 | `0x323` | 805 103; 806 2; 806 103; 807 2 | 205 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s380 | `0x32d` | 823 2 | 205 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s385 | `0x32d` | 823 2; 842 2 | 1275,1276,1421,1423,1425,1427,1429,1431 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s386 | `0x32d` | 823 2; 842 2 | 1436,1438,1440,1442,1444,1446 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s395 | `0x323` | 805 2; 805 12; 805 35; 806 2; 806 12; 806 35; 807 2 | 80,1299 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s395 | `0x324` | 805 12; 806 12 | 80 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s395 | `0x32d` | 823 2; 842 2; 869 2 | 80,1299,1305 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s400 | `0x323` | 805 2; 806 2; 807 2 | 1301,1302,1303,1304,1507,1508,1509 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s400 | `0x32d` | 823 2 | 1301,1302,1303,1304,1507,1508,1509 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s405 | `0x32d` | 823 2; 842 2 | 60,61 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s406 | `0x32d` | 823 2; 842 2 | 1285,1286 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s410 | `0x323` | 805 2; 806 2; 807 2 | 90,140 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s410 | `0x324` | 805 2; 806 2 | 140 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s410 | `0x32d` | 823 2; 824 2; 825 2 | 90,140,142,143 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s415 | `0x323` | 805 1; 806 1 | 150,151 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s415 | `0x32b` | 816 1; 817 811; 818 811; 819 811; 820 1 | 150,151 | 0x800a6a98 | 0x800a6558 | `389277009daa` | code in this stage's image (file 0xbac) | ported |
| s415 | `0x32c` | 822 1; 822 812 | 150,151 | 0x00000000 | 0x800a6c8c | `9e9f99e27a13` | code in this stage's image (file 0x10a8) | interpreter only |
| s415 | `0x32d` | 882 1; 883 1; 893 1 | 150,151 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s415 | `0x330` | 821 816 | 150 | 0x800a6230 | 0x800a5fa8 | `493e32ee1e09` | null (the original skips it) | ported |
| s415 | `0x331` | 821 817 | 150 | 0x800a6264 | 0x800a5fa8 | `493e32ee1e09` | null (the original skips it) | ported |
| s415 | `0x332` | 821 818 | 150 | 0x800a629c | 0x800a5fa8 | `493e32ee1e09` | null (the original skips it) | ported |
| s415 | `0x333` | 821 819 | 150 | 0x800a62d4 | 0x800a5fa8 | `493e32ee1e09` | null (the original skips it) | ported |
| s415 | `0x334` | 821 820 | 150 | 0x800a630c | 0x800a5fa8 | `493e32ee1e09` | null (the original skips it) | ported |
| s415 | `0x335` | 821 821 | 150 | 0x800a6344 | 0x800a5fa8 | `493e32ee1e09` | null (the original skips it) | ported |
| s415 | `0x336` | 821 822 | 150 | 0x800a637c | 0x800a5fa8 | `493e32ee1e09` | null (the original skips it) | ported |
| s415 | `0x337` | 821 823 | 150 | 0x800a63b4 | 0x800a5fa8 | `493e32ee1e09` | null (the original skips it) | ported |
| s415 | `0x338` | 821 819 | 150 | 0x800a63ec | 0x800a5fa8 | `493e32ee1e09` | null (the original skips it) | ported |
| s415 | `0x339` | 821 825 | 150 | 0x800a6424 | 0x800a5fa8 | `493e32ee1e09` | null (the original skips it) | ported |
| s420 | `0x32d` | 823 2; 842 2 | 70,71 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s421 | `0x323` | 805 2; 806 2 | 741 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s421 | `0x32d` | 823 2; 842 2 | 740,741 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s430 | `0x32d` | 823 2; 885 2 | 1210 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s431 | `0x32d` | 823 2; 885 2 | 1211 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s435 | `0x32d` | 823 2 | 950 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s440 | `0x32d` | 823 2; 824 2; 825 2 | 144 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s445 | `0x32d` | 823 2; 842 2 | 1265,1266 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s450 | `0x32d` | 823 2; 842 2 | 1279,1280 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s455 | `0x32d` | 876 1; 882 1; 883 1 | 360 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s455 | `0x33c` | 821 1 | 360 | 0x800a6010 | 0x800a5ebc | `082ad78ee00e` | null (the original skips it) | ported |
| s460 | `0x323` | 805 2; 806 2 | 370 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s460 | `0x32d` | 823 2; 842 2 | 370 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s460 | `0x33e` | 844 2 | 370 | 0x800a5fc8 | 0x800a5de0 | `b3698daed084` | code in this stage's image (file 0x1b0) | ported |
| s470 | `0x32d` | 823 2; 885 2 | 1215 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s471 | `0x32d` | 823 2; 885 2 | 1461 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s475 | `0x323` | 805 2; 806 2 | 160,180 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s475 | `0x32d` | 1 0; 823 2; 842 2; 877 2 | 160,180,181,190,200,230 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s480 | `0x323` | 805 133; 806 133 | 170,240 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s480 | `0x32d` | 823 2 | 170,240 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s485 | `0x323` | 805 2; 806 2 | 1530 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s485 | `0x32d` | 823 2; 882 2; 883 2 | 1530 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s486 | `0x323` | 805 2; 805 306; 806 2; 806 306 | 745 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s486 | `0x32d` | 823 2 | 745 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s490 | `0x32d` | 823 2; 842 2 | 1267,1268,1277,1278 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s500 | `0x323` | 805 11; 805 101; 806 11; 806 101 | 250,270 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s500 | `0x32d` | 823 2 | 250,270 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s505 | `0x32d` | 823 2; 885 2 | 1220 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s506 | `0x32d` | 823 2; 885 2 | 1221 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s520 | `0x32d` | 823 2; 842 2 | 260,261,695 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s521 | `0x323` | 805 2; 806 2 | 751 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s521 | `0x32d` | 823 2; 842 2 | 750,751 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s525 | `0x323` | 805 2; 805 102; 806 2; 806 102; 806 103; 807 103 | 550 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s525 | `0x324` | 805 103; 806 103 | 550 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s525 | `0x32d` | 823 2; 842 2 | 550,1273,1274 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s526 | `0x323` | 805 2; 806 2 | 760 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s526 | `0x32d` | 823 2; 842 2 | 760 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s526 | `0x33d` | 843 2 | 760 | 0x800a6028 | 0x800a5de0 | `fd5376846836` | code in this stage's image (file 0x210) | ported |
| s535 | `0x32d` | 823 2; 842 2 | 1262,1263 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s537 | `0x323` | 805 2; 805 141; 806 2; 806 141; 807 141 | 700 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s537 | `0x324` | 805 141; 806 141 | 700 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s537 | `0x32d` | 823 2; 842 2; 892 2 | 700,1455,1456 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s538 | `0x32d` | 823 2; 842 2 | 1287,1288 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s545 | `0x323` | 805 2; 806 2 | 710,711 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s545 | `0x32d` | 823 2; 873 2; 882 2; 883 2 | 710 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s545 | `0x34f` | 858 2 | 710 | 0x00000000 | 0x800a6184 | `9187707023c0` | code in this stage's image (file 0x524) | ported |
| s545 | `0x350` | 860 2; 861 2; 862 2; 863 2; 864 2; 865 2; 866 2; 867 2; 868 2 | 710 | 0x800a6894 | 0x800a648c | `87f18f7002a5` | code in this stage's image (file 0x9a0) | ported |
| s550 | `0x32d` | 823 2; 842 2; 885 2 | 1225,1269,1270 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s551 | `0x32d` | 823 2; 885 2 | 1226 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s555 | `0x323` | 805 105; 806 105 | 380 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s555 | `0x32d` | 823 2 | 380 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s560 | `0x32d` | 823 2; 885 2 | 1459 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s561 | `0x32d` | 823 2; 885 2 | 1463 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s565 | `0x32d` | 823 2; 842 2 | 1271,1272 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s580 | `0x323` | 805 2; 805 105; 805 285; 806 2; 806 105 | 440,450,470,480,490,500,520 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s580 | `0x32d` | 823 2; 845 2; 846 2; 847 2; 848 2; 849 2; 850 2; 851 2; 852 2; 853 2; 854 2; 855 2; 856 2 | 450,470,480,490,500,520 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s605 | `0x32d` | 823 2; 842 2 | 510,511 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s606 | `0x32d` | 823 2; 842 2 | 1289,1290 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s615 | `0x323` | 805 1; 805 2; 805 101; 806 1; 806 2; 806 101 | 530,531 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s615 | `0x324` | 805 101; 806 101 | 531 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s615 | `0x32d` | 823 2; 872 1; 894 1 | 530,531 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s616 | `0x32d` | 823 2; 842 2 | 1291,1292 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s620 | `0x323` | 805 1; 805 2; 805 11; 805 101; 805 104; 805 317; 806 1; 806 2; 806 11; 806 101; 806 104; 806 317; 807 104 | 532,540 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s620 | `0x324` | 805 11; 805 101; 806 11; 806 101 | 532 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s620 | `0x325` | 805 101; 805 104; 806 101; 806 104 | 532 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s620 | `0x32d` | 873 1; 875 1; 876 1; 898 1; 902 1 | 532 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s620 | `0x351` | 821 1 | 532 | 0x800a6198 | 0x800a5f00 | `16a91e17f444` | null (the original skips it) | ported |
| s625 | `0x323` | 805 2; 805 103; 806 2; 806 103 | 552 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s625 | `0x32d` | 842 2 | 552 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s646 | `0x323` | 805 45; 806 2; 806 45; 807 2 | 735 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s646 | `0x324` | 805 49; 806 49 | 735 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s646 | `0x32d` | 823 2 | 735 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s650 | `0x32d` | 823 2; 885 2 | 1458 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s651 | `0x32d` | 823 2; 885 2 | 1462 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s655 | `0x323` | 805 2; 805 122; 806 2; 806 122 | 430,431 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s655 | `0x32d` | 823 2; 842 2 | 430,431 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s656 | `0x32d` | 823 2 | 736 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s660 | `0x323` | 805 2; 805 69; 806 2; 806 69 | 415 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s660 | `0x32d` | 823 2; 885 2 | 415,1231 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s661 | `0x32d` | 823 2; 885 2 | 1230 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s675 | `0x32d` | 823 2 | 390,400,410 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s676 | `0x32d` | 823 2; 842 2 | 900,901 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s680 | `0x323` | 805 1; 806 1 | 412 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s680 | `0x32d` | 873 1 | 412 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s680 | `0x32e` | 829 814; 830 814; 831 814; 832 814; 833 814; 834 814; 835 814; 836 1; 891 1 | 412 | 0x800a63ac | 0x800a5fd8 | `7d363a3ed472` | code in this stage's image (file 0x49c) | ported |
| s685 | `0x323` | 805 2; 805 152; 806 2; 806 152; 807 2 | 690 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s685 | `0x32d` | 823 2; 894 1 | 413,421,690 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s700 | `0x32d` | 823 2; 885 2 | 1460 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s701 | `0x32d` | 823 2; 885 2 | 1464 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s730 | `0x32d` | 823 2; 885 2 | 1235 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s731 | `0x32d` | 823 2; 885 2 | 1236 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s735 | `0x32d` | 823 2 | 790 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s736 | `0x32d` | 823 2; 842 2 | 1293,1294 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s740 | `0x32d` | 823 2 | 800 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s741 | `0x32d` | 823 2; 842 2 | 1295,1296 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s745 | `0x32d` | 823 2 | 810 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s746 | `0x32d` | 823 2; 842 2 | 1297,1298 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s750 | `0x323` | 805 2; 805 13; 806 2; 806 13; 807 2 | 820,860,883,884 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s750 | `0x32d` | 823 2; 824 2; 825 2; 885 2 | 820,1245 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s750 | `0x34e` | 821 2 | 820,860,883 | 0x00000000 | 0x800a5ef0 | `2716f1dd9201` | code in this stage's image (file 0x390) | ported |
| s755 | `0x32d` | 823 2; 842 2 | 780,781 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s756 | `0x32d` | 823 2; 842 2 | 910,911 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s760 | `0x32d` | 823 2; 885 2 | 1240 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s761 | `0x32d` | 823 2; 885 2 | 1241 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s780 | `0x320` | 800 1; 804 1; 804 2 | 0,684,1500 | 0x800a6f8c | 0x800a6dc4 | `98fe3dbefb05` | code in this stage's image (file 0x1160) | ported |
| s780 | `0x321` | 801 1; 801 2; 801 801; 802 1; 802 2; 802 801 | 0,684,742,885,971,1500 | 0x800a749c | 0x800a72b0 | `721b07f03f45` | code in this stage's image (file 0x1670) | ported |
| s780 | `0x322` | 803 1; 803 2 | 0,971,1500 | 0x800a635c | 0x800a61c8 | `18a23268b60a` | null (the original skips it) | ported |
| s780 | `0x323` | 805 45; 805 53; 805 157; 805 272; 806 45; 806 157; 806 272 | 684,742,971 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s780 | `0x324` | 805 16; 805 47; 805 273; 806 16; 806 47; 806 273 | 684,742,971 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s780 | `0x325` | 805 45; 805 56; 805 274; 806 53; 806 56; 806 274 | 684,742,971 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s785 | `0x323` | 805 1; 805 12; 806 1; 807 1 | 1 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s785 | `0x324` | 805 11; 806 1 | 1 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s785 | `0x325` | 805 12; 806 1 | 1 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s785 | `0x327` | 808 12; 809 12; 810 1 | 1 | 0x800a6510 | 0x800a62b4 | `068918e43ec6` | code in this stage's image (file 0x760) | ported |
| s785 | `0x343` | 821 1 | 1 | 0x800a61d8 | 0x800a5f04 | `7263bace5430` | null (the original skips it) | ported |
| s790 | `0x323` | 805 13; 806 13 | 4 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s790 | `0x328` | 813 808; 814 1 | 4 | 0x800a625c | 0x800a6138 | `2f8f168ac7dd` | code in this stage's image (file 0x444) | ported |
| s790 | `0x329` | 811 1; 812 1; 813 808 | 4 | 0x800a6108 | 0x800a5df4 | `edfd4eaf74ec` | code in this stage's image (file 0x2f0) | ported |
| s795 | `0x323` | 805 2; 806 2 | 830,840,1505 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s795 | `0x32d` | 823 2; 887 2; 895 2 | 840 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s795 | `0x344` | 859 2 | 840 | 0x00000000 | 0x800a5f00 | `d47fb42c495f` | code in this stage's image (file 0x3a0) | ported |
| s800 | `0x323` | 805 2; 805 208; 806 2; 806 208 | 850,870,871,1506 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s800 | `0x32d` | 823 2; 887 2; 893 2; 895 2 | 850,870,871 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s800 | `0x345` | 859 2 | 850 | 0x00000000 | 0x800a5f00 | `ef3997e796d4` | code in this stage's image (file 0x394) | ported |
| s800 | `0x347` | 859 2 | 871 | 0x800a6510 | 0x800a6344 | `8aeef55f8f56` | null (the original skips it) | ported |
| s805 | `0x323` | 805 1; 805 210; 806 1; 806 210; 807 1 | 880,881 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s805 | `0x32d` | 873 1; 873 2; 882 1; 882 2; 883 1; 883 2 | 881,882 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s805 | `0x348` | 859 1; 859 2 | 881,882 | 0x00000000 | 0x800a60cc | `4eeafbc9e7fd` | code in this stage's image (file 0x5e4) | ported |
| s805 | `0x349` | 821 1; 821 2 | 881,882 | 0x00000000 | 0x800a5de4 | `a5d8a25da452` | code in this stage's image (file 0x184) | ported |
| s810 | `0x323` | 805 2; 806 2 | 990,1000,1010,1035 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s810 | `0x32d` | 823 2; 884 2; 887 2 | 990,1000,1010,1035 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s810 | `0x34a` | 859 2 | 990 | 0x00000000 | 0x800a5f00 | `956c552225e7` | code in this stage's image (file 0x398) | ported |
| s810 | `0x34b` | 859 2 | 1010 | 0x00000000 | 0x800a5f00 | `956c552225e7` | code in this stage's image (file 0x398) | ported |
| s810 | `0x34c` | 859 2 | 1000 | 0x00000000 | 0x800a5f00 | `956c552225e7` | code in this stage's image (file 0x398) | ported |
| s815 | `0x323` | 805 2; 805 208; 806 2; 806 208; 806 209 | 1020,1030,1040,1050 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s815 | `0x32d` | 823 2; 882 2; 883 2 | 1020,1030,1040,1050 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s820 | `0x323` | 805 1; 805 2; 806 1; 806 2 | 1060,1070,1080 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s820 | `0x32d` | 823 2; 873 2; 878 2; 879 2; 880 2; 881 2; 882 2; 882 813; 883 2; 883 813; 888 2; 889 2; 890 2 | 1070,1080 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s820 | `0x34d` | 821 2 | 1070 | 0x00000000 | 0x800a6488 | `8d27f383b83b` | code in this stage's image (file 0x9dc) | ported |
| s820 | `0x355` | 821 2 | 1080 | 0x800a5fb4 | 0x800a5eb8 | `a98d2790cb7c` | null (the original skips it) | ported |
| s925 | `0x357` | 821 1 | 1600 | 0x800a639c | 0x800a6110 | `6280004a9cbc` | null (the original skips it) | ported |
| s926 | `0x323` | 805 2; 806 2 | 1606 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s926 | `0x32d` | 823 2 | 1606 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s926 | `0x356` | 841 2 | 1606 | 0x800a609c | 0x800a5f70 | `59a7b4d415ec` | null (the original skips it) | ported |
| s927 | `0x323` | 805 2; 806 2 | 1608,1610 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s928 | `0x32d` | 823 2; 885 2 | 1612 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s931 | `0x323` | 805 255; 806 255 | 1614 | 0x80088190 | - | - | fieldstg resident (same routine on every stage) | ported |
| s931 | `0x32d` | 823 2 | 1614 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s946 | `0x32d` | 823 2; 885 2 | 1648 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s951 | `0x32d` | 823 2 | 1620,1622,1624,1626,1628 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
| s958 | `0x32d` | 823 2; 885 2 | 1646 | 0x80083cd8 | - | - | fieldstg resident (same routine on every stage) | ported |
## 7. Tick families, ranked by what one port would buy

| group | stages | members | script calls | ported | other | stages |
|---|---|---|---|---|---|---|
| `fieldstg record 0x80083cd8` | 120 | 120 | 239 | 120 | 0 | s200 s202 s205 s206 s210 s211 s212 s220 s235 s236 s237 s245 ... |
| `fieldstg record 0x80088190` | 61 | 93 | 196 | 93 | 0 | s200 s205 s206 s210 s211 s212 s226 s245 s270 s285 s295 s300 ... |
| `493e32ee1e09` | 1 | 10 | 10 | 10 | 0 | s415 |
| `721b07f03f45` | 1 | 1 | 6 | 1 | 0 | s780 |
| `956c552225e7` | 1 | 3 | 3 | 3 | 0 | s810 |
| `18a23268b60a` | 1 | 1 | 3 | 1 | 0 | s780 |
| `2716f1dd9201` | 1 | 1 | 3 | 1 | 0 | s750 |
| `53b7966aee5a` | 1 | 1 | 3 | 1 | 0 | s212 |
| `98fe3dbefb05` | 1 | 1 | 3 | 1 | 0 | s780 |
| `389277009daa` | 1 | 1 | 2 | 1 | 0 | s415 |
| `4eeafbc9e7fd` | 1 | 1 | 2 | 1 | 0 | s805 |
| `9e9f99e27a13` | 1 | 1 | 2 | 0 | 1 | s415 |
| `a5d8a25da452` | 1 | 1 | 2 | 1 | 0 | s805 |
| `bf971cb78d27` | 1 | 1 | 2 | 1 | 0 | s261 |
| `c56260af5983` | 1 | 1 | 2 | 1 | 0 | s311 |
| `033edb715349` | 1 | 1 | 1 | 1 | 0 | s225 |
| `068918e43ec6` | 1 | 1 | 1 | 1 | 0 | s785 |
| `0773c9088e9f` | 1 | 1 | 1 | 1 | 0 | s305 |
| `082ad78ee00e` | 1 | 1 | 1 | 1 | 0 | s455 |
| `16a91e17f444` | 1 | 1 | 1 | 1 | 0 | s620 |
| `1cd887c34016` | 1 | 1 | 1 | 1 | 0 | s310 |
| `2f8f168ac7dd` | 1 | 1 | 1 | 1 | 0 | s790 |
| `3b4e7923ac35` | 1 | 1 | 1 | 1 | 0 | s310 |
| `59a7b4d415ec` | 1 | 1 | 1 | 1 | 0 | s926 |
| `5ec4a1092b44` | 1 | 1 | 1 | 1 | 0 | s306 |
| `6280004a9cbc` | 1 | 1 | 1 | 1 | 0 | s925 |
| `7263bace5430` | 1 | 1 | 1 | 1 | 0 | s785 |
| `7d363a3ed472` | 1 | 1 | 1 | 1 | 0 | s680 |
| `87f18f7002a5` | 1 | 1 | 1 | 1 | 0 | s545 |
| `8aeef55f8f56` | 1 | 1 | 1 | 1 | 0 | s800 |
| `8d27f383b83b` | 1 | 1 | 1 | 1 | 0 | s820 |
| `9187707023c0` | 1 | 1 | 1 | 1 | 0 | s545 |
| `a98d2790cb7c` | 1 | 1 | 1 | 1 | 0 | s820 |
| `b31f90eb65b7` | 1 | 1 | 1 | 1 | 0 | s310 |
| `b3698daed084` | 1 | 1 | 1 | 1 | 0 | s460 |
| `d47fb42c495f` | 1 | 1 | 1 | 1 | 0 | s795 |
| `edfd4eaf74ec` | 1 | 1 | 1 | 1 | 0 | s790 |
| `ef3997e796d4` | 1 | 1 | 1 | 1 | 0 | s800 |
| `fd5376846836` | 1 | 1 | 1 | 1 | 0 | s526 |

## 8. Port status

Per member, from `data/stage_registry_members.json`:

| status | meaning | members |
|---|---|---|
| `ported` | a translated module claims the id, and the tool re-checks the citation | 260 |
| `interpreter only` | the stage ships an overlay image, so `?nativeStages` runs the original code; no translated module claims the id | 1 |
| `none` | neither | 0 |

Of the 260 ported members, 213 are the shared fieldstg records and 47 are
stage-owned:

| member | citation |
|---|---|
| `0x323` (803) on 61 stages, `0x324` on 18, `0x325` on 10, `0x326` on 4 -- 93 (stage, id) rows | `engine/systems/cutscene-manager.ts` (`BUBBLE_EFFECT_IDS`) |
| `0x32d` (813) on 120 stages | `engine/systems/cutscene-manager.ts` (`SCENE_OBJECT_ID`) + `engine/systems/field-movement.ts` (`followerGatherSample`) |
| `0x330`-`0x339` (816-825) on s415, ten ids, one object | `engine/systems/falling-object.ts`, driven by `web/assets/data/falling_objects.json` |
| `0x320` (800) on s780 | `engine/systems/street-vehicles.ts` (`BROADCAST_EFFECT_IDS`) |
| `0x32a`/`0x32f`/`0x34e`/`0x357` on s212 / s225 / s750 / s925 -- four pad flashes | `engine/systems/point-record-actor.ts` (`pad-flash` arm), one table (§11) |
| `0x343` on s785, `0x328`/`0x329` on s790, `0x344` on s795, `0x345`/`0x347` on s800 -- six decor drivers | `engine/systems/point-record-actor.ts` (`decor` arm), one table (§11) |
| `0x34f` on s545, `0x351` on s620, `0x32e` on s680 -- three more shapes of the same actor | `engine/systems/point-record-actor.ts` (the `point-record` recipe table and the new `slots` machine), one table (§13) |
| `0x348` (840) on s805, `0x34a`-`0x34c` (842-844) on s810, `0x355` (853) on s820 -- five picture drivers | `engine/systems/point-record-actor.ts` (`point-record` arm), one table (§11) |
| `0x33c` (828) on s455 -- the one-record copy | `engine/systems/point-record-actor.ts` (`single` arm), one table (§11) |
| `0x356` (854) on s926 -- the record that walks down the screen | `engine/systems/point-record-actor.ts` (`rise` arm), one table (§11) |
| `0x321` (801) on s780 | `engine/systems/street-screens.ts` (`SCREEN_QUAD_STRIDE`) |
| `0x322` (802) on s780 | `engine/systems/stinger-popup.ts` (`STINGER_EFFECT_ID`) |
| `0x354` (852) on s310, `0x346` (838) on s311 -- the two fixed still sprites | `engine/systems/stage-fixed-sprite.ts`, driven by `web/assets/data/stage_fixed_sprites.json` (§13) |
| `0x349` (841) on s805, `0x34d` (845) on s820 -- the two draw-context annotators | `engine/systems/shape-annotator.ts` through `engine/systems/draw-context.ts`; see docs/research/field/draw-context-service-2026-10-04.md |
| `0x352` (850) on s305, `0x353` (851) on s306 -- the two arena markers | `engine/systems/stage-slot-player.ts`, driven by `web/assets/data/stage_slot_players.json` (§14) |
| `0x33f` (831) and `0x340` (832) on s310 -- the two wall-picture stacks | `engine/systems/stage-slot-ensemble.ts`, driven by `web/assets/data/stage_slot_ensembles.json` (§16) |
| `0x350` (848) on s545 -- the pad owner, which builds five child objects | `engine/systems/point-record-actor.ts` (`parent` machine), driven by `web/assets/data/child_pool_parents.json` (§18) |
| `0x33b` (827) on s261 -- the two-slot writer, which moves the live field character | `engine/systems/point-record-actor.ts` (`two-slot` machine) + `engine/systems/field-character.ts`, one table (§19) |
| `0x33e` (830) on s460 and `0x33d` (829) on s526 -- the two `triple` parents, which build nine and twelve four-state row children | `engine/systems/point-record-actor.ts` (`triple` machine), the same `child_pool_parents.json` (§20) |
| `0x327` (807) on s785 -- the Online Center's scripted pictures | `engine/systems/point-record-actor.ts` (`picture-steps` machine), driven by `web/assets/data/point_record_actors.json` (§21.1) |
| `0x32b` (811) on s415 -- the crevice ride's Bulbmon walker | `engine/systems/point-record-actor.ts` (ride-walker machine), driven by `web/assets/data/point_record_actors.json` (§21.2) |

The 1 `interpreter only` member is the whole remaining port list, grouped by
family in §7.  Each row of §6 names the tick to port and the family it belongs to,
so one read of the family covers the stage.  **That one row, s415 `0x32c`, is
ported in code as of 2026-10-09 (the `scroll-layer` machine, §21.3.1, commit
842bf003); the generated census still reads it `interpreter only` until the
bookkeeping named in the closing note lands.**  Two notes on what moved:

* `0x33d` on s526 and `0x33e` on s460 install a tick that **is** their overlay's
  own base address (`0x800a5de0`), in families `fd5376846836` and `b3698daed084`
  -- different code from the 167-stage housekeeping family `2443b24b0d14` at the
  same address, so the shared-system rule "167 stages carry the same object"
  does not cover them.  **Both were read on 2026-10-05 (§18.5) and ported on
  2026-10-05 (§20)**: they are parent objects whose children are four-state row
  actors, and the `triple` machine in the same module now runs all seven of those
  children machines.
* `0x33b` (827) on s261 was the last member of this family waiting on the live
  field character; **§19 closes it**: the character is the one you are leading,
  its `+0x54` is its world Y in 16.8, and the member is ported as the `two-slot`
  machine.
* `0x349` (841) on s805 and `0x34d` (845) on s820 were ported on 2026-10-04 as
  the two stage users of the resident 2D draw-context service; see
  docs/research/field/draw-context-service-2026-10-04.md.

## 10. The pad-flash actor, ported 2026-10-04 (four members)

> **Joined 2026-10-04.** This section and 10b and 10c were three ports of ONE
> system and are now one module, one table and one extractor; §11 is the reading
> and the join. The three sections are kept as the per-member record.

This is the shared system the 2026-10-04 job assigned, and it is one system, not
thirteen objects: **the stage actors that claim a stage's three INACTIVE
point-sprite records and make a pad flash.**  The system was already written up
in `materialize-effect-actor.md` (2026-07-09) from s212 and s225, and both of
those were reachable only through the MIPS interpreter; the census recorded
them as `interpreter only`.  What changed here is that the system is ported
once, on the PAL-blank clock, and reached through the registry route the console
uses.

### 10.1 What a player sees

`SETANIM <id> <pad>` on one of these four stages makes a pad flash.  The actor
takes the stage's three `atlasFlag` 1/2/3 point records -- inactive in the image,
so nothing draws them -- moves them onto the pad the number names, and runs one
animation script per record: a beam opening and closing, a halo rising, a
figure resolving.  Then the records go dark again.

| stage | place | registry id | pads the script fires | what is on the pad |
|---|---|---|---|---|
| s212 | Asuka City -- Main Lobby | `0x32a` (810) | 815 / 826 / 827 (828 is a no-op) | the three Digimon-download pads, one per partner in a pack; each fires `DIGI_EN0/1/2` |
| s225 | Asuka City -- Login Room | `0x32f` (815) | 838 (837 is a no-op) | the login pad at (336, 274); fires env011 seq 1 |
| s750 | North Sector -- Chamber Room | `0x34e` (846) | 821 | the pad at (320, 186) |
| s925 | (no recovered stage name) | `0x357` (855) | 821 | one pad, baked into the constructor at (336, 274) -- the login room's own pixel |

### 10.2 The evidence

All quoted from the stage overlays, all at the overlay base `0x800A5DE0`
(so a `.L0x00000xxx` label is `0x800A5DE0 + xxx`).

**The actor is a resident state machine with a stage-owned TICK.**  s212's
constructor at file `0x41c` (`0x800a61fc`) is the registry record's
`construct_fn`:

```
.L0x0000041c: addiu $sp, -0x18
.L0x00000420: move_ $a3, $a0              # the id becomes the object's name
.L0x00000424: lui $a0, 0x800a
.L0x00000428: addiu $a0, 0x5ef4           # tick 0x800a5ef4
.L0x0000042c: li $a1, 0x70                # a 112-byte object
.L0x00000430: sw $ra, 0x10($sp)
.L0x00000434: jal F0x800143dc             # the shared allocator
.L0x00000438: move_ $a2, $zr
```

`F0x800143dc` stores that tick at `obj+0x48` (`exe/fns.s:0x800143e4`
`move_ $s4, $a0` / `:0x800144bc` `sw $s4, 0x48($s0)`) and installs the method
block at `+0x28..+0x44` (`exe/fns.s:0x80014454`-`:0x800144b4`), which is where
`+0x28 SET_STATE`, `+0x2c SET_SECOND`, `+0x38 ADV_STATE` and `+0x40 ADV_THIRD`
come from.  The tick dispatches on `obj+0x0c` (`wstag212` file `0x13c`:
`lw $v1, 0xc($s4)`), which is the state word.

**The claim.**  Every copy reads the stage's point table through the resident
global at `0x80099D90` and walks it in 0x12-byte records, taking the first three
whose tag byte is 1, 2 or 3:

```
.L0x000001d0: lw $a1, -0x6270($v0)        # lui 0x800a -> [0x80099D90]
.L0x000001d8: lbu $v0, 0x2($a1)           # the record count
.L0x000001f8: lbu $v0, -0x1($a0)          # the record's tag byte
.L0x00000200: addiu $v0, -0x1
.L0x00000204: sltiu $v0, 0x3              # tag in 0..2
.L0x00000210: sw $a1, 0x58($a2)           # park the record pointer at obj+0x58
.L0x0000021c: sh $v0, 0x8($a0)            # record X  = obj+0x50   (record +0xa)
.L0x00000228: sh $v0, 0xa($a0)            # record Y  = obj+0x54   (record +0xc)
.L0x00000248: sh $v0, 0xc($a0)            # record ysort = padY + ysortOff[i] (record +0xe)
```

The displacements are from `$a0`, which the loop set to **record + 2** at
`.L0x000001f0: addiu $a0, $a1, 0x2` and advances by the 0x12-byte stride at
`.L0x0000024c`, so the three cells are the record's own `+0xa` X, `+0xc` Y and
`+0xe` ysort — the layout `point-sprite-ambient-system.md` §"the 18-byte
placement record" tabulates. An earlier reading of this snippet listed them at
`0x8/0xa/0xc`; the values it named were right and the offsets were two bytes
low.

so `atlasFlag` 1..3 is the tag, and the three cells live at `obj+0x58`, `+0x60`
and `+0x68`.

**The stepper is shared with the rockfall.**  The routine each copy keeps at its
overlay base (s212 `0x800a5de4`, s545 `0x800a5e20`) walks `{s16 clip, u16 hold}`
entries, ends on `0xFF`, and subtracts `min(frameDelta, 4)` at depth 0 only:

```
.L0x0000007c: lhu $v0, 0x4($s0)          # the cell's index
.L0x00000084: addiu $v0, 0x1
.L0x00000088: sh $v0, 0x4($s0)
.L0x00000090: lhu $v1, 0x2($s1)          # the next entry's hold
.L0x0000009c: sh $v0, 0x6($s0)
.L0x000000a4: li $v0, 0xff
.L0x000000a8: beq $v1, $v0, .L0x000000c0 # 0xFF ends it
```

That is `engine/systems/falling-object.ts`'s `stepFallingSequence`, byte for
byte in behaviour, so the port imports it rather than writing it twice.  The two
callers read the terminator differently -- a rock's sequence loops, a pad script
stops -- so the port decides "finished" in its own tick.

**The two special sprite values.**  `0x12C` (300) blinks a record off for its
entry's duration: the tick stores `0` in the record's `active` byte
(`wstag212` file `0x2c0`: `sb $zr, ($s0)`, delay slot of the
`beq $v1, 0x12c` at `:0x2ac`) and `0xFF` ends the run and, with all three slots
ended, takes the actor to state 3 (`wstag212` file `0x1f8`: `lw $v0, 0x28($a0)`
/ `:0x200 jalr $v0` / `:0x204 li $a1, 0x3`).

**s925's pad is a constructor literal.**  Its record's `draw_fn` is null, so
there is no configure routine to read a pad from, and the extractor finds the
pad where it is actually written (`wstag925` file `0x5bc`):

```
.L0x000005c0: move_ $a3, $a0
.L0x000005c4: lui $a0, 0x800a
.L0x000005c8: addiu $a0, 0x6110           # tick 0x800a6110
.L0x000005cc: li $a1, 0x70
.L0x000005d4: jal F0x800143dc
.L0x000005dc: li $v1, 0x150              # 336
.L0x000005e0: sw $v1, 0x50($v0)
.L0x000005e4: li $v1, 0x112              # 274
.L0x000005e8: sw $v1, 0x54($v0)
```

336, 274 is the same pixel as s225's login pad, which is why the two stages show
the same flash.

**The sounds.**  s212's configure routine plays a per-pad packed id from the
table right after the coord table -- `0x010c0000/1/2` = `DIGI_EN0/1/2`; s225 and
s750's tick play one fixed id instead (`0x00cc0001` = env011 seq 1, and
`0x01000000`).  These are music stems, not sfx samples, so they go to the jingle
player (`web/game.js` `PACKED_JINGLES`), not through the stage-objects sound
sink.

### 10.3 What was ported

`engine/systems/point-record-actor.ts` (the `pad-flash` arm) -- pure and testable, no DOM and no fetch:

| function | what it is |
|---|---|
| `fireMaterializeEffect(stage, registryId, sub, config)` | the configure half: pick the pad the sub-operand names, seed each slot's hold timer from its script's first entry, return the run (with its cue) |
| `tickMaterializeEffect(stage, config, delta)` | one PAL blank: `min(delta, 4)` per slot through the shared stepper, and the run ends when every script has |
| `materializeWrites(stage, config, recordIndices)` | this frame's per-record writes: `active`, `spriteId`, and the pad position with the stage's signed-byte Y and y-sort offsets |
| `MATERIALIZE_EFFECT_IDS` | the registry id per stage, from `data/stage_registry_members.json` |

Hooked with **one dispatch line per module** in `web/stage-objects.js`
`fireStageObject` (guarded by `MATERIALIZE_EFFECT_IDS[stageId]?.includes(id)`,
the registry's own test) and one line in `tickStageObjects`, so the run advances
on the same `advanceFieldBlanks()` list the rocks and the cars use.  The old
second implementation -- a per-rendered-frame timer in `web/effects.js` -- is
gone; `effects.js` now only asks the port for the writes to apply to the ambient
renderer it already owns.

Tables stay data.  `tools/extract_materialize_effects.py` was generalised (the
script table is found by looking for a pointer run whose targets all parse,
the offset tables by pairing each `addu` with its `lbu` and the store it feeds,
and a construct-only copy's pad by the constructor's `li`/`sw` pair) and now
reports the copies it cannot read instead of skipping them silently.  It decodes
**4 stages, 12 scripts**.  No effect table is hand-typed.

### 10.4 The other nine members, and why they are not ported here

They are not this system.  Each is a different per-stage object that happens to
share the allocator; porting them would be nine single-case ports, which is the
thing this repository forbids.  What is established for each, from its own code:

| member | what its code is | why not ported |
|---|---|---|
| s455 `0x33c` (828) | the **one-slot** form of this actor: the same claim read and the same shared stepper, but the script is passed to the stepper directly (`wstag455` file `0x1d4`: `addiu $a1, 0x6378`), there is no pointer table and no command handler, and the pad is never moved | a second shape of the ported system. It needs the extractor's 1-slot branch finished and its own tables; it is not a different system, and leaving it is a gap, not a decision |
| s926 `0x356` (854) | **not** a script actor: one frame after the claim it decrements the record's own halfword, adds `0x100` to the live object named 5 (`wstag926` file `0x274`: `lw $v1, 0x54($v0)` / `:0x27c addiu $v1, 0x100`), and destroys itself at 150 blanks (`:0x28c slti $v0, 0x96`) | a different system (a camera/zoom timer). Needs its own read of what object 5 is |
| s261 `0x33b` (827) | a **two-record** claim that then dispatches through a per-stage jump table kept at the overlay base (`wstag261` file `0x15c`: `addiu $v0, 0x5de0` / `:0x168 sll $v1, 0x2` / `:0x174 jr $v0`) | a different dispatch shape; the jump table's targets are per stage |
| s460 `0x33e` (830) | its tick is the stage's **own bootstrap** at the overlay base, a four-state machine calling three per-stage routines (`wstag460` file `0x20` `jal 0x800a6358`, `:0x28 jal 0x800a67b8`, `:0x3c jal 0x800a6f54`) | a different object that shares the load-base address with the 167-stage housekeeping family (`2443b24b0d14`); §8 already flags it |
| s526 `0x33d` (829) | the same shape as s460, a different copy of it | as s460 |
| s545 `0x34f` (847) and `0x350` (848) | a **one-object, two-id** stage actor whose constructor takes the pad from its **caller's arguments** (`wstag545` file `0x2ac`: `sw $s1, 0x50($v0)` / `:0x2b0 sw $s2, 0x54($v0)`, with `$s1`/`$s2` the caller's `$a1`/`$a2`) | the pad is a parameter here, so it is not a per-stage table at all; porting it needs the caller chain read |
| s620 `0x351` (849) | a four-state claim actor with **no draw routine at all** on its record (`wstag620` file `0x120`, the tick) | nothing visible to draw from the record; what it drives is not established |
| s680 `0x32e` (814) | a **332-byte** object (`li $a1, 0x14c`) with its own state machine and a slot-init that the extractor's pointer-run rule does not match | a different object; the largest single-object shape in this job |

The other 27 `interpreter only` members are the same kind of work; §7 ranks
them.  Nothing here says they are unread -- they are unread, and this job did not
reach them.

## 9. What is unresolved, and what I did not establish

* **155 of the 294 overlays have no recovered event table.**
  `tools/wstag_events.py --all` recovers 139 (384 events, 315 scripted).  For those
  155 stages this tool can say which ids their own code creates (the
  `stage_created` flag) but **cannot produce a script-confirmed member list**, and
  it does not pretend to: they are listed in `unresolved` with that reason.  A
  stage there may own a member this census never sees.
* **The `code_candidates` section is an upper bound, not a member list.**  215
  (stage, id) pairs have a record whose constructor reads as an allocator-backed
  routine in that stage's image; 35 of them are confirmed members (every stage-owned
  record that has a constructor resolves in exactly its own stage), and the rest
  are coincidental reads of an unrelated address.  12 land on a stage's own
  overlay base.  Do not treat this section as membership.
* **Ids `0x33a` (826), `0x341` (833), `0x342` (834) are fired by no recovered
  script.**  I have not established whether the 155 script-less stages fire them,
  nor whether `0x33a`'s fieldstg constructor has any other caller.
* **The overlay load size is not established.**  I read the code and data each
  `.s` file contains (672 to 0x4b28 bytes) but not the declared BSS, so "outside
  this stage's image" in §6 means "past the file's own words", not "past the
  memory the loader reserved".
* **The 22 `interpreter only` members are not decoded here**, apart from the
  four pad flashes in §10, the six decor drivers in §10b, the five point-record
  drivers in §10c, and the members §10.4 names.  The largest single object by
  script calls is now s780's screen driver (`0x321`, 6 calls, family
  `721b07f03f45`) -- see §7.
* **The extractor's own coverage.**  `tools/extract_materialize_effects.py`
  decodes 4 stages of the ~46 overlays that carry this actor's claim read, and
  prints a one-line reason for each of the 42 it cannot.  Those reasons are
  "the tick carries no readable script table" for most, which means a different
  shape (one-slot, two-record, jump-table) and not a failure to find data.
* **Not checked:** whether the ten-slot budget at `<field object>+0x10` is ever
  exhausted in play, which would drop a construct; and what the third operand is
  read for beyond the configure call.

## 10b. Six members ported: the Kusanagi City / Undersea Base "tagged decor"

**Answer first.** Six of the 22 `interpreter only` members are one shared
system, and it is not the one the census guessed.  A stage overlay ships a few
of its OWN point-sprite records switched off (`active` byte+0 == 0) and tagged
with an `atlas` byte (record+1) of 1..N, then builds one actor object that
**claims those records by tag** and drives them: writing `active`, `spriteId`
(record+4) and `ctr` (record+9, the palette-row offset the ambient renderer
adds), and in one member sliding a record by adding to the X halfword at
record+0xc.  Ported as the `decor` arm of `engine/systems/point-record-actor.ts`, with the
per-stage scripts and tags extracted by `tools/extract_decor_drivers.py`.

This is the system `point-sprite-ambient-system.md` describes plus the
`stage-anim-step-tagged-decor` family of
`stage-overlay-shared-routines-2026-08-11.md` §6 -- and it is the same system
`s212`'s and `s225`'s materialize halo is a hand row of
(`materialize-effect-actor.md`, `web/effects.js` `fireMaterialize`).  **The
walker had a converted copy with two hand rows and no shared port; this change
adds the shared port and does not add another hand row.**  Those two stages were
not re-wired in this pass -- see "what I did not do".

### The shared pieces, and where each is read

| piece | where | note |
|---|---|---|
| the object layout | EXE `F0x800143dc` (`exe/fns.s:4866`) | `+0x28` setState, `+0x2c` setClip, `+0x38` advance state, `+0x40` advance counter AND clear the timer, `+0x44` tick the timer, `+0x48` the per-frame callback |
| the record claim | fieldstg `F0x80089548` / `F0x800894d8` (`fieldstg.s:0x6898`/`0x6828`) | store the tag and the table head in the globals at `0x8005b8fc`/`0x8005b8f8`, then scan from the head for the first record whose byte+1 matches; 0 when there is none |
| the script stepper | each overlay's own routine at its base -- `wstag785` `0x800a5de4`, `wstag795`/`wstag800` `0x800a6224`, `wstag790` `0x800a5de4` | `{u16 entry, s16 hold}` cursor over `{s16 value, u16 hold}` ending on value `0xff`; the delta comes through the global function pointer at `0x8004df9c` and is clamped to 4 |
| the record bytes | `point-sprite-ambient-system.md` §"the 18-byte placement record" | `+0` active, `+1` atlas (the tag), `+4` spriteId, `+9` ctr, `+0xc` the X high half |

`F0x80089548` is reached as `jal 0x80089548` from the overlays, and while a
field stage is up that address is **fieldstg's** routine, not fightstg's --
`fieldstg.s:0x6898` is the three-instruction wrapper above.  `fightstg.s` has
code at the same address because both overlays load at `0x80082cb0`;
`stage-overlay-object-families-2026-10-04.md` §"88 of the 222" reads those
calls as battle-overlay entries, which is wrong for field play.

### The six members, and what the player sees

Every id below is `SETANIM <id> <sub> <arg>` as the shipped
`web/assets/events/wstag_events.json` fires it.

| stage / id | tick | records claimed (atlas tag -> record) | what the player sees |
|---|---|---|---|
| s785 `0x343` (835) | `wstag785 0x800a5f04` | 4->5, 3->6, 2->7, 1->0, all at (299,232) | the Online Center's wall display lights up: sprite 74 (0..5) and sprite 71 (0..11) cycle for ever behind sprite 70, which plays 0..13 once and then switches itself off |
| s790 `0x328` (808) | `wstag790 0x800a6138` | 1->8 at (418,191) | the Chamber Room's panel changes picture, from the ROM's sprite 4 to sprite 0, when the scene sends `SETANIM 808 814 1` |
| s790 `0x329` (809) | `wstag790 0x800a5df4` | 2->5, 3->4, 4->0, 5->6, 6->7, 7->1, 8->2, 9->3 | four panels slide one map pixel right over 8 blanks, two of them slide eight more, then the two dark flash pairs at (428,172) and (407,138) light up, play their 16-frame cycle and are replaced by their long-loop partners (sprites 55 and 56), with packed sounds `0x8100383c` at the start and `0x01000002` at the light-up |
| s795 `0x344` (836) | `wstag795 0x800a5f00` | 1->9, 2->8, both at (414,834) | the Magasta B1F console blinks its front screen (sprite 70, two frames) from the moment the stage loads; `SETANIM 836 859 2` plays sprites 71..80 once at 4 blanks each, then holds 80 with sprite 81 behind it at palette row 81 |
| s800 `0x345` (837) | `wstag800 0x800a5f00` | 1->9, 2->8, both at (898,764) | the same shape as B1F, on the B2F console |
| s800 `0x347` (839) | `wstag800 0x800a6344` | 3->19, 4->18, both at (1550,338) | construct-only (the registry's draw pointer is null): record 19 plays sprite 54 upward at 6 blanks each and then the record is left pointing at sprite 255, which the atlas does not carry, so the panel goes dark |

Three things in that table are original quirks the port keeps rather than tidies:

* **s795's 836 and s800's 837 have no registry constructor.**  Their records'
  `construct_fn` is `0x00000000`, so the stage builds them itself at stage entry
  (§4) and they are already animating before any script fires an id.
  `constructDecorDrivers` builds them from the table's `registryCtor` field, so
  the blink is not lost the way a SETANIM-only route would lose it.
* **s790's 808 and 809 need two SETANIMs each.**  The scene opens with
  `SETANIM 808 813 808` / `809 813 808`, which their draw handlers do not
  answer: that only constructs the object, its own first tick advances the state
  (and EXE `F0x800142ac` clears the clip in the same call), and it parks.  The
  later `814` / `812` sets the clip, and only then does the work start.
* **s800's 839 arms a cursor by writing 1 into the word its stepper reads as the
  entry index**, and seeds the holds four bytes past where that overlay's
  form-B stepper reads them (`wstag800 0x800a63f8` writes obj+0x58; the stepper
  called at `0x800a645c` reads obj+0x58/obj+0x5a).  So its first shown frame is
  the script's third value, 54, and both holds start at 0.  Its third and
  fourth passes read script pointers that are not script addresses in the
  shipped image (`0x00fd00e2`, `0x00000118`) and only ever write the record the
  original never lights, so nothing visible depends on them.

### The extraction is a self-check, not a transcription

`tools/extract_decor_drivers.py` reads each overlay image
(`web/assets/native/sNNN.bin`, base `0x800a5de0`) and writes
`web/assets/data/decor_drivers.json`.  Nothing is hand-entered as a value: the
tags are resolved against `point_sprites.json`, the animation scripts are parsed
out of the overlay's own data, the cursor seed holds and the packed sound ids are
read from the image, and `registryCtor` is read out of fieldstg's own registry
table.  What IS hand-entered is the ADDRESS of each site, paired with the
instruction text the decode read there; the tool re-reads that text from
`~/ddw3/asm/dw2003/pro/wstagNNN.s` and requires the image to hold the same word
the `.s` prints.  **222 anchors** are checked, and a mismatch stops the build.

## 10c. The point-record drivers (ported 2026-10-04, s805 / s810 / s820)

Five of the seven stage-owned members on these three stages are ONE system, and
it is the point-record writer §7 already named as the "missing writer": an
object that claims some of the stage's ambient point-sprite records by their
atlas byte and then writes `active` / `spriteId` / `ctr` into them every blank.
The port is the `point-record` arm of `engine/systems/point-record-actor.ts` (pure and
testable) with each stage's own sequences in the generated
`engine/dw3/point-driver-tables.ts`, hooked through the existing single route
`web/stage-objects.js` (`fireStageObject` / `paceStageObjects`, one PAL 50 Hz
blank).  `web/effects.js` gains one dispatch line so the writes land in the
records the ordinary point renderer already draws -- no second renderer.

### 10.1 The claim walk, and who calls the stepper

Every one of the five walks the same table: the global at `0x8009FD90` (reached
as `lui $v0, 0x800a` / `lw $a1, -0x6270($v0)`, i.e. `0x800A0000 - 0x6270`), 18-byte
records, terminated when `record+2 == 0`, matching `record+1`:

```
wstag805.s:0x338: lw $a0, -0x6270($v0)      # 0x8009FD90
wstag805.s:0x340: lbu $v0, 0x2($a0)         # record+2: the terminator
wstag805.s:0x348: beqz $v0, .L0x00000428
wstag805.s:0x368: lbu $v1, -0x1($a1)        # record+1: the atlas byte
wstag810.s:0x1c0: lbu $v1, -0x1($a0)
wstag820.s:0x13c: lbu $v0, -0x1($v1)
```

**Last match wins**, because the walk stores into the same slot on every match
and only walks on (`wstag810.s:0x1ac`/`0x1b4` and `0x1d0`/`0x1d8` write
`sw $a1, 0x54($s2)` / `sw $a1, 0x5c($s2)` inside the loop).  `claimRecord()`
reproduces that.

The stepper is the same routine copied into each overlay -- `0x800A5FCC`
(wstag805 file 0x1ec), `0x800A5DE0` (wstag810 file 0x0), `0x800A5DE0` (wstag820
file 0x0).  **The `jal` words are mislabelled in the `.s` files**: wstag810 and
wstag820 print `jal D0x800a5de0`, which is the disassembler reading the whole
`jal` word `0x0c029778` as an address.  The target is `0x800A9DF0`, which is not
in those files at all; the real copies are the ones at each overlay's own file 0,
and they agree.  Header layout is `{index @ +4, hold @ +6}` in all three.  Per
call, in the original's order:

```
wstag810.s:0x34: lw $v0, -0x2064($v0)      # [0x8004DF9C] = the resident random
wstag810.s:0x3c: jalr $v0                  # ... called
wstag810.s:0x44: move_ $v1, $v0
wstag810.s:0x48: slti $v0, $v1, 0x5        # rand = min(rand, 4)
wstag810.s:0x54: li $v1, 0x4
wstag810.s:0x58: bnez $s4, .L0x00000070    # no-decrement flag ($a3 here)
wstag810.s:0x60: lhu $v0, 0x6($s1)         # hold
wstag810.s:0x68: subu $v0, $v1            # hold -= rand
wstag810.s:0x6c: sh $v0, 0x6($s1)
wstag810.s:0x78: bgtz $v0, .L0x000000fc   # hold > 0 -> return script[index]
wstag810.s:0x88: addiu $v0, 0x1
wstag810.s:0x8c: sh $v0, 0x4($s1)          # index++
wstag810.s:0xa4: sh $v0, 0x6($s1)         # hold += entry.delay  <-- a DELAY SLOT
wstag810.s:0xa8: lh $v1, ($s0)
wstag810.s:0xac: li $v0, 0xff
wstag810.s:0xb8: j 0x800a5ee0              # the stop arm's return
wstag810.s:0xf4: jal D0x800a5de0 ; addiu $a3, $s4, 0x1   # tail call, no-decrement set
```

Two facts a reader must not get wrong:

* the delay store at `0xa4` is the `beqz`'s **own delay slot**, so the end
  entry's delay is charged on the end-marker path too;
* the tail call sets the no-decrement argument, so **one call advances at most
  one entry**.  `stepPointScript()` reproduces both.

The end marker is a **value of `0x00FF`**, not -1: every copy compares
`li $v0, 0xff` (`wstag805.s:0x28c`, `wstag810.s:0xac`, `wstag820.s:0xa0`).  The
three copies differ in what they do ON the marker, and the port keeps all three:

| copy | third argument | on the 0xFF marker |
|---|---|---|
| wstag805 | none | read the marker's `next` byte and jump there (`0x298`-`0x2bc`) |
| wstag810 / wstag820 | 0 | rewind to entry 0 and charge entry 0's delay (`wstag810.s:0xd0`-`0xe8`) |
| wstag810 / wstag820 | non-zero | return 0xFF and leave the header alone (`wstag810.s:0xa8`-`0xb8`) |

The three copies also disagree on **which argument** is the no-decrement flag --
`$a2` in wstag805 (`0x23c`) and wstag820 (`0x50`), `$a3` in wstag810 (`0x58`).
Every call site in these three stages passes 0, so the port always decrements;
that is recorded rather than guessed.

### 10.2 s805 `0x348` (840) -- the machine room's four records

The handler is `wstag805.s:0x5e4`: `li $v0, 0x35b` / `bne $a1, $v0, return`, then
`lui $a0, 0x34` + `ori $a0, 0x4` = packed `0x00340004` through
`[0x8005+0x5c48]`, then `setState(2)`.  The stage fires it twice --
`SETANIM 840 859 1` (event 881) and `SETANIM 840 859 2` (event 882) -- and **both
land in the same arm**, because the handler never reads the third operand.  The
player therefore sees one look, not two, and state 1 is unreachable in play.

The claim walk takes four tags (1, 2, 3, 4) out of the pointer table at
`0x800A72A8` = `{0x800A7218, 0x800A726C, 0x800A7288, 0x800A7250}` and seeds each
slot's hold from `lbu $v0, 0x2($v0)` on that pointer (`0x3b4`, `0x3ec`, `0x408`, `0x41c`): **4, 8, 4, 8**.  All four records sit at
(235,78); they are the stage's entire point-sprite table.

**What the player sees.** In state 2 the machine's four sprite slots read: slot 0
on clip 2 with palette row 0, slot 1 on clip 21 with palette row 21, slot 2 on
clip 22 with the palette row cycling 0..5 (and back to 0 when the script reaches
300), slot 3 dark.  Switch to state 1 by hand and slots 1 and 2 go dark, slot 3
lights on clip 19 with the same six-row pulse, and slot 0 is unchanged.

The sprite bytes are the surprise, and they are the original's, not a mistranslation:
**all four arms put `sb $v0, 0x4($s0)` in the `jal`'s OWN delay slot**, so the
sprite written is whatever the `li` in front of the call left in `$v0`:

```
wstag805.s:0x4f8: li $v0, 0x2      ; the arm's own constant, not the call's result
wstag805.s:0x530: jal 0x800a5fcc
wstag805.s:0x538: sb $v0, 0x4($s0)  ; -> 2, always
```

So slot 0 is pinned to clip 2 in **both** states and the 23..35 run behind it only
advances the header; slot 2's palette row store is in a `j`'s delay slot
(`0x568`) so it is pinned to 21 too.  Only slot 2 (`0x5a8`, after the call) and
slot 3 (`0x4bc`, after the call) store the stepper's return value.  Clip 2 is not
in s805's sprite directory at all, so nothing is drawn there on either machine.

### 10.3 s810 `0x34a`/`0x34b`/`0x34c` (842/843/844) -- three stations

One object shape, one handler, one tick (`wstag810.s:0x120`), three wrappers that
differ only in the number they stamp into `obj+0x52`: `5` (`:0x47c`), `3`
(`:0x440`), `1` (`:0x408`).  The claim walk reads that field as its tag and takes
the tag **and the tag above it** (`0x188` / `0x1c4`), so each id owns a pair of
records: 842 tags 5+6 (the station at 1327,256), 843 tags 3+4 (1295,80), 844 tags
1+2 (910,80).

The handler (`wstag810.s:0x398`) takes sub `0x35b`, sets the running flag, rewinds
slot 0's index and hold from the overlay byte at `0x800A719E` (= 4), and calls
`setState(2)`.  The stage fires all three with `SETANIM 842|843|844 859 2`.  The
first tick after the claim arms the run the same way and leaves state 0
(`0x1f4`-`0x228`), which is why the table's `claimState` is 2 here and 0 on the
other two stages.

**What the player sees.** Each station's front record walks clips **71 through 84**
on palette row 0 and then holds on 84; its back record sits on clip 70 with the
palette row pulsing 0..5.  In state 1 the front record shows clip 85 with rows
0..2 and the back record goes dark.  State 1 is not reachable in play here either
-- every firing is mode 2, and the handler ignores the third operand.

### 10.4 s820 `0x355` (853) -- a member with no picture, only a sound

853 is the one that the census's "twenty null draws" list calls construct-only,
and reading it confirms the flag is the whole story:

* the record has a **constructor** at `0x800A5FB4` (`wstag820.s:0x1d4`): it
  allocates the object and plays `lui $a0, 0x4` / `ori $a0, 0x1d` = packed
  `0x0004001D`, the same TELEPORT id the launch pad plays;
* the record's **configure slot is null**, so the stage script's
  `SETANIM 853 821 2` (event 1080, the last beat of the Spy Satellite finale)
  constructs the object and stops there;
* the tick's state 0 arm (`wstag820.s:0x10c`-`0x174`) claims the single ambient
  record at (268,164), zeroes the stepper header and **returns**.  The animating
  arm is state 1 (`0x178`), and nothing in the overlay ever calls `setState(1)`
  on this object.

So the console plays the teleport chime and the room's one background record --
inactive in the ROM -- stays inactive.  The port reproduces exactly that: the
claim, the constructor's sound, and no record writes.  The sequence is still
carried in the table with `end: "stop"`, because wstag820's copy of the stepper
has no restart arm at all (`0xa4` branches straight to the epilogue), so the arm
at `0x178` would play 61..67 once and then write active 0 and `setState(3)`
(`0x1ac`-`0x1bc`).  `tests/point-record-actors.test.js` drives that arm directly
so the dead branch is pinned rather than merely described.

### 10.5 The two members this did NOT port, and why

`0x349` (841, s805) and `0x34d` (845, s820) are the other two stage-owned members
of these stages, and they are one family with each other -- **not** with the point
record drivers.  841 is a sequencer over **27 pooled children**:

```
wstag805.s:0x064: lui $v0, 0x800a
wstag805.s:0x068: addiu $s0, $v0, 0x709c      # the 27 descriptors
wstag805.s:0x088: slti $v0, $s2, 0x1b                          # 27 of them
wstag805.s:0x07c: jal 0x800a6990                              # the child constructor
wstag805.s:0x0a0: addiu $s1, $v0, 0x71e0                      # 28-entry halfword table
wstag805.s:0x0bc: slt $v0, $a0, $v0                           # hold >= table[index]
wstag805.s:0x0fc: jalr $v0 ; li $a1, 0x2                      # child[index]->setState(2)
wstag805.s:0x128: li $v0, 0x1000 ; bne $v1, $v0, .L0x00000148
wstag805.s:0x13c: jalr $v0 ; li $a1, 0x1                      # and back to state 1
```

so the 27 stations light up one after another on a rand-driven delay walk (the
table runs 0, 4, 12, 16 ... 196, then 4096 as the end marker), then the sequencer
rebuilds them.  845 is a single instance of the same child class, built
unconditionally by the stage's entry routine at `0x800A71AC` (flag 2 ->
`jal 0x800A6774`).

Those children draw through the **resident 2D draw-context service**, not
through the point-sprite records: each allocates `0x1002` bytes through the
pointer at `0x8004DF8C`, culls itself with that object's `+0x128` clip-rectangle
method (`wstag820.s:0x5e4`, which is a window test on `(x, y, w, h)`), and emits
two passes through its `+0x14c` method with a stage shape table.  It is the same
two-pass "disc plus column" shape the **launch pad** uses
(`engine/systems/launch-pad.ts`, rendered by `web/effects.js drawLaunchPads`), and
it is a *different* rendering system from the point records: the pads are
stage-actor records the walker cuts clips for, while 841's children and 845 draw
through the draw context with the overlay's own shape tables and palette rows
that nothing in the walker extracts.

**Reported as a shared-system gap, not worked around.**  The walker's launch-pad
copy is a converted copy: `web/assets/data/launch_pads.json` +
`drawLaunchPads` are keyed to launch pads, and there is no port of the draw
context's `+0x14c` emitter, of the per-stage shape tables at `0x800A62DC` /
`0x800A72B8`-family addresses, or of the culling rectangle.  Adding a hand row for
841 or 845 would be exactly the per-case override the repository rule forbids, so
neither id is claimed, both stay `interpreter only`, and the port that would serve
all three (launch pad, 841, 845) is named here as the next piece of work.

### 10.6 What the port does not reproduce

* **Palette rows the walker has not cut.**  The originals store a `ctr` on several
  records (s805's slots 2 and 3, s810's back records) and the walker's
  `web/assets/data/point_sprites.json` only carries `clip@row` for the clips the
  point-record cutter was told about, so a row the extractor has not cut falls
  back to the base clip.  The extractor change is
  `tools/extract_point_sprites.py` (`pad_clip_ids` becomes "every clip this
  stage's own code can draw"); it is not applied here because `web/assets` is not
  this run's to regenerate.
* **s805 clip 2** is written into slot 0 in both states and is absent from the
  directory, so nothing is drawn -- as on the console.
* **`?nativeStages` still wins.**  `fireStageObject` stands the port down when the
  stage's overlay image is live, so no record is driven twice.

### 10.7 Proof

`tests/point-record-actors.test.js` fails on the pre-port tree,
because `POINT_DRIVER_TABLES` does not exist there at all, and it pins:

* the member list is exactly `805/840 810/842 810/843 810/844 820/853`, and the two
  uncited members of these stages are still `0x349` and `0x34d`;
* every driver's id is fired by its own stage's recovered script with the sub its
  handler accepts, and the one construct-only driver really has a null draw slot;
* the claim walk keeps the LAST match, and each stage's records are claimed where
  the ROM puts them;
* the end marker is `0xFF`, and the three end arms are the three originals';
* s805's four panels byte for byte, including that the sprite byte is pinned by a
  delay slot while two palette rows are not;
* s810's 71..84 run, its hold at 84, its running-flag clear, its back record's
  70 plus 0..5 pulse, and that s810's SETANIM rewinds where s805's does not;
* 853 writes nothing for 300 blanks and its constructor sound is `0x0004001D`.

`tools/extract_point_driver_tables.py --check` re-derives every sequence and hold
from the overlay words and is run by that suite, so a hand edit of the generated
table fails.  `tests/stage-registry-members.test.js` pins the new counts.

## 11. THE point-record actor system: its members, one module (2026-10-04)

**Answer first.** Sections 10, 10b and 10c were three ports of ONE system, and
they are now one module, one stepper, one claim, one table, one extractor, one
test file and one browser check.  What a player sees did not change except in
one room, and there the change is a fix: **the machine room's first picture slot
(s805) now changes picture on the console's cycle instead of sitting on one
clip**, and **the three Spy Satellite stations' back picture (s810) keeps
pulsing after their front picture stops**, which it did not before.

### 11.1 Why it is one system, from the assembly

Three pieces are shared verbatim and have one copy each.

**The claim**, fieldstg `F0x80089548` / `F0x800894d8`
(`~/ddw3/asm/dw2003/pro/fieldstg.s` file 0x6898 and 0x6828):

```
.L0x000068a0: sw  $a0, -0x4704($v0)    # 0x8005b8fc = the atlas tag wanted
.L0x000068a8: lw  $v1, -0x6270($v0)    # 0x80099d90 = the stage's point table
.L0x000068b4: jal 0x800894d8
.L0x000068b8: sw  $v1, -0x4708($v0)    # 0x8005b8f8 = the walk cursor
.L0x0000682c: lw  $a0, -0x4708($v0)    # resume where the last call stopped
.L0x00006834: lbu $v0, 0x2($a0)        # record+2 == 0 ends the table
.L0x00006850: lbu $v0, -0x1($v1)       # record+1 = the atlas tag
.L0x00006870: bnez $v0, .L0x00006850   # walk on in 0x12-byte strides
.L0x00006860: j   0x80089528           # match: the cursor steps +0x12, ret 1
```

The walk RESUMES, so asking for the next tag finds the next record.  No table
read so far carries a repeated tag, so a first-match walk and the original's
resumable one agree -- and `claimedSameTagTwice` is asserted false for all
eleven stages so a future repeat cannot diverge silently.

**The stepper**, one routine repeated at every overlay's own base.
`wstag785.s` file 0x04 and `wstag810.s` file 0x0 are the same twenty
instructions; they differ in two places only -- where the cursor header sits in
the object, and whether the entry's hold is read as a halfword or a byte:

| copy | cursor index / hold | entry hold read | end arm on value `0x00ff` |
|---|---|---|---|
| `wstag785/212/225/750/795/800/790` base | `0x0` / `0x2` | `lhu 0x2($s0)` | `$a2 == 0` -> entry 0, charge its hold; `$a2 != 0` -> return 0xff, cursor past the end |
| `wstag810` base (file 0x00) | `0x4` / `0x6` | `lbu 0x2($s0)` | the same two arms |
| `wstag805` (file 0x1ec) | `0x4` / `0x6` | `lbu 0x2($s0)` | **only** the end entry's THIRD byte: `lbu $v1, 0x3($s0)` / `sh $v1, 0x4($s1)` at :0x298/:0x2a8 |
| `wstag820` (file 0x24) | `0x4` / `0x6` | `lhu 0x2($s1)` | **only** the stop arm: `beq $v1, $v0, .L0x000000bc` at :0xa4 goes straight to the epilogue, with no `$a2` test at all |

The end marker is a VALUE, `li $v0, 0xff` in every copy; no copy compares -1.
`stepPointRecordCursor` is that routine with the variant as a parameter, and
each member names its own copy in the table.

**The method block**, EXE `F0x800143dc`: `+0x28` setState, `+0x2c` setClip,
`+0x38` advance state, `+0x3c` advance clip, `+0x40` advance counter, `+0x44`
tick the timer, `+0x48` the per-frame callback.

### 11.2 The per-member table: which original code each member runs

Seventeen members, five machine shapes (`pad-flash`, `decor`, `point-record`,
`single`, `rise`; the last two are §12's and are in the same module and the same
table).  Every row's `tick` is the address the overlay's own constructor
installs, and every `stepper` is that overlay's copy, READ OUT OF THE IMAGE by
`stepper_copy()` rather than asserted -- which is how §12 found that s455 carries
the `stop-u16` copy and s926 carries none.

| member | machine | registry ctor | draw | tick | claims | stepper |
|---|---|---|---|---|---|---|
| s212 `0x32a` (810) | pad-flash | `0x800a61fc` | - | `0x800a5ef4` | tags 1-3, moved onto the pad the operand names | `base-u16` |
| s225 `0x32f` (815) | pad-flash | `0x800a61e0` | - | `0x800a5ef0` | tags 1-3 | `base-u16` |
| s750 `0x34e` (846) | pad-flash | null (stage-built) | - | `0x800a5ef0` | tags 1-3 | `base-u16` |
| s925 `0x357` (855) | pad-flash | `0x800a639c` | - | `0x800a6110` | tags 1-3, pad is a constructor literal | `base-u16` |
| s785 `0x343` (835) | decor `stacked` | `0x800a61d8` | null | `0x800a5f04` | tags 1-4 | `base-u16` |
| s790 `0x328` (808) | decor `resprite` | `0x800a625c` | `0x800a6224` | `0x800a6138` | tag 1 | `base-u16` |
| s790 `0x329` (809) | decor `reveal` | `0x800a6108` | `0x800a60d0` | `0x800a5df4` | tags 2-9, slides X and waits on a live `ctr` | `base-u16` |
| s795 `0x344` (836) | decor `fire` | null (stage-built) | `0x800a6180` | `0x800a5f00` | tags 1-2 | `base-u16` |
| s800 `0x345` (837) | decor `fire` | null (stage-built) | `0x800a6174` | `0x800a5f00` | tags 1-2 | `base-u16` |
| s800 `0x347` (839) | decor `oneshot` | `0x800a6510` | null | `0x800a6344` | tags 3-4 | `base-u16` |
| s805 `0x348` (840) | point-record | null (stage-built) | `0x800a63c4` | `0x800a60cc` | tags 1-4, four per-panel recipes | `follow-u8` |
| s810 `0x34a`/`0x34b`/`0x34c` (842/843/844) | point-record | null (stage-built) | `0x800a6178` | `0x800a5f00` | tags 5/3/1 and one above | `base-u8` |
| s820 `0x355` (853) | point-record | `0x800a5fb4` | null | `0x800a5eb8` | tag 1; sound only | `stop-u16` |
| s455 `0x33c` (828) | `single` | `0x800a6010` | null | `0x800a5ebc` | tag 1, left in place, one 16-entry script | `stop-u16` (§12.4) |
| s926 `0x356` (854) | `rise` | `0x800a609c` | null | `0x800a5f70` | tag 1, walked down a pixel a blank for 150 blanks | none: the overlay carries no stepper (§12.4) |

### 11.3 Two faults the join found, both in the delay slots

Both are the kind the assembly reading rules exist for, and both were in the
point-record port rather than in the other two.

**s805's first panel was pinned that is not.**  Four arms store a record's
sprite byte at `sb $v0, 0x4($s0)`.  Three of them are `jal 0x800a5fcc`'s own
**delay slot** -- file 0x4b8, 0x560 and 0x588 -- so the byte is the `li`
constant that was already in `$v0` and the stepper's return value can never
reach it.  The fourth, file 0x538, is an ordinary instruction after the `jal` at
0x530, so it stores the stepper's RETURN value.  The earlier reading took the
`li $v0, 0x2` at file 0x4f8 for a fourth pin; that immediate is the delay slot
of the panel-2 compare at 0x4f4, and the `jal` overwrites `$v0` anyway.  The
consequence was that the machine room's front picture at (235,78) sat on clip 2
for ever.  `tests/point-record-actors.test.js` now asserts all four arms.

**The run flag gates one recipe, not every panel.**  `beqz $v0, .L0x00000330`
at `wstag810.s` file 0x2f8 is the ONLY test of the object's run flag
(`obj[0x50]`) in the whole system.  Gating every panel on it froze each
station's back picture the moment its front sequence ended; the back picture now
carries the `gated` mark alone and keeps pulsing, which is what the console does.

### 11.4 What the join does NOT change

* **The pad-flash scripts carry no `0x00ff` on the disc.**  `parse_script` stops
  at the terminator and drops it, because that arm tests the stepper's RETURN
  value (wstag212.s file 0x2a0/0x2a4).  The run therefore ends when the cursor
  walks past the last entry, which `padSlotEnded` reads off the cursor.  This is
  the pre-existing rule from §10, kept rather than silently changed.
* **s785's 807 was ported on 2026-10-05** (commit 17e2a642, the `picture-steps`
  machine of `engine/systems/point-record-actor.ts`; see §21.1).  **s820's
  841/845** are still not ported; they draw through the console's
  general-purpose 2D drawing service, which has no port here (§10.4, §9).
* **The 22 remaining `interpreter only` members** are untouched.

## What you will see

**Before this job**: with `?nativeStages` the four pad flashes played, because
the MIPS interpreter ran the stage overlays.  Without it they did not -- the
actor existed only as data, and the `SETANIM` that should have started it had
nothing to construct it.  In the shipped game the download halos in the Asuka
City lobby and the login-room flash were simply absent.

**After**, in ordinary play with no research flags:

1. Load a save in the Asuka City lobby (s212) and let the per-pack download
   cutscene run.  Each partner's pack lights one of the three pads in turn --
   the beam opens, a halo rises, the figure resolves, and the pad goes dark --
   and the `DIGI_EN0/1/2` cue plays on the frame the flash starts.  This is
   event 10/11/12 of `wstag_events.json`, gated on flags 01120003/4/5.
2. Walk into the Asuka City login room (s225).  On the arrival event the login
   pad at (336, 274) flashes once with the login whoosh.
3. North-sector chamber room (s750), event 820: the pad at (320, 186) flashes.
4. `tools/verify_point_record_actors.mjs` drives all five machines and reads
   the claimed point records back off the screen.

The timing is per PAL 50 Hz blank through the shared clock, so the flash holds
its 211-blank beam for the same number of frames the console does regardless of
the monitor's refresh rate.

Stand in the Undersea Base Magasta B1F (`?skipTitle=1&map=s795`) and the
control console's four screens already pulse -- two frames of the front one,
four blanks each, from the moment the room loads.  Put the player on the console
and send `SETANIM 836 859 2`, the way the room's own scene does: the front screen
runs a ten-frame flash (sprites 71 to 80, four blanks each) and then holds its
last frame with the rear screen lit behind it.  The B2F console at `map=s800`
behaves the same way, and its far panel plays a one-shot before going dark.

Checked with `tools/verify_point_record_actors.mjs`, which fires all six members with
no research flags (`?nativeStages` is off, so the original overlay machine code
is not running) and reports the frames each one put into the point records; see
`.bunny-scratch/shots/s795-before-859.png` (console dark) against
`s795-after-859.png` (console lit).

### What I did not do

* **`s785 0x327` (807) was read here, and has since been ported** (commit
  17e2a642, 2026-10-05; the `picture-steps` machine of
  `engine/systems/point-record-actor.ts`, see §21.1).  Two readings in this
  bullet were wrong and are corrected here rather than deleted: the pack
  `0x01c7` = resource 455 is **S785TMPK.BIN, s785's own sprite directory**,
  which the walker already extracts (`web/assets/data/point_sprites.json["s785"]`),
  so no asset was missing; and the position source is **not a live sound
  object** -- the `obj+0x54` handle is the tagged cast/NPC object (`find(5,
  operand, -1)` over the actor whose `+0x04` is the third operand, i.e. npc 12),
  read at its `+0x50`/`+0x54` world pixels.  The tick draws pictures 50..61
  through the resident 2-D sprite emitter at that anchor:
  `[0x80044f5c](0x01c70001)` resolves the pack and `F0x8001ED6C(shapeSet,
  picture, x, y)` emits the cel.  The Online Center scene sends `SETANIM 807 808
  12`, `807 809 12` and `807 810 1` while two NPCs are speaking, so the pictures
  play over the character the operand names.
* **No converted copy with hand rows is left for this system.**  The earlier
  `web/effects.js fireMaterialize` / `materialize_effects.json` pair that §10
  wrote is gone, and so is the one the lead branch grew at §12's two shapes: both
  are now this module and this table.
* **The remaining 18 `interpreter only` members are untouched**, and §12.5 names
  each of the ones that belong to THIS actor with the shape it is (s620's
  four-record grid, s680's lane table, s261's six-step sequence, s545's two
  copies) rather than leaving them as a count.

## 12. The claim actor's other two shapes, folded into that module (2026-10-04)

§10 ported one shape of the shared system — the three-record copy that MOVES its
records onto a pad — and §11 joined the rest into ONE module and ONE extractor.
This section ports two more shapes of **the same actor** into that module: no
second file, no second hook, no second table. The per-stage numbers come out of
the same `tools/extract_point_record_actors.py`, and the three fixes below are
the ones that stopped it seeing these two at all.

### 12.1 What a player sees

| stage | place | registry id | what is on screen |
|---|---|---|---|
| s455 | South Sector — Bios Swamp | `0x33c` (828) | the shrine's own sprite, dark until the stage's event 360 fires `SETANIM 828 821`, then lit and running its 16-frame script (clips 11…25, four blanks each) with a short cue |
| s926 | (no recovered stage name) | `0x356` (854) | one row of the stage's own point table lights up and walks **down** the screen a pixel a blank for 150 blanks (three seconds), then stops 149 pixels lower than the table put it and stays lit there |

Neither moves a record: the pad flash relocates its rows onto the pad the
command names, these two light the row exactly where the stage's point table put
it. s455's record is at map pixel (1038, 93) with sprite 11 — the same sprite
its script opens on — and s926's at (256, 336) with sprite 2.

### 12.2 The evidence

All lines quoted from the stage overlays, whose base is `0x800A5DE0`.

**The shared state machine and the shared stepper** are as §10.2 read them: the
TICK is at `obj+0x48`, `+0x38` advances the state and clears the three
sub-counters (`exe/fns.s:0x800142ac`), and each copy keeps its own copy of the
`{s16 clip, u16 hold}` stepper over a cell whose index is at `+4` and whose
countdown is at `+6`.

**s455 — the one-record copy** (`wstag455`, TICK `0x800a5ebc`, the registry
record's constructor at file `0x230` passes it to `F0x800143dc`):

```
.L0x00000150: li $a1, 0x1                         # the tag it claims
.L0x00000158: lbu $v0, -0x1($v1)                  # one record's atlas byte
.L0x00000160: bne $v0, $a1, .L0x0000016c          # not ours -> next record
.L0x00000168: sw $a0, 0x50($s1)                   # park the record at obj+0x50
...
.L0x000001cc: addiu $a0, $s1, 0x50                # the stepper's cell
.L0x000001d0: lui $a1, 0x800a
.L0x000001d4: addiu $a1, 0x6378                   # the one script, file 0x598
.L0x000001dc: jal 0x800a5de4                      # the stage's own stepper
...
.L0x000001b4: lui $a0, 0x8004
.L0x000001bc: lw $v0, 0x5c48($v0)                 # the packed-id player
.L0x000001c4: jalr $v0
.L0x000001c8: ori $a0, 0x213e                     # cue 0x8004213E
```

The cue plays once: the arm at file `0x188` reads the object's own second
counter (`lw $v0, 0x10($s1)` / `bnez $v0, .L0x000001cc`) and only the first pass
reaches the sound. The script itself is sixteen `{clip, hold}` entries at file
`0x598` — `0x0004000b`, `0x0004000c`, … `0x00040019`, then the `0xFF`
terminator `0x03e700ff` — clips 11 to 25 four blanks each, which is why the
row's own ROM sprite (11) is where the animation starts.

**s926 — the no-script copy** (`wstag926`, TICK `0x800a5f70`, the registry
record's constructor at file `0x2bc`):

```
.L0x000001f4: lbu $v0, -0x1($v1)                  # the tag-1 row
.L0x00000208: lhu $v0, 0xa($v1)                   # its Y ($v1 = record + 2)
.L0x00000210: addiu $v0, -0x1
.L0x00000214: sh $v0, 0xa($v1)                    # one pixel off
.L0x00000218: sb $a1, ($a0)                       # and light it
...
.L0x00000254: lhu $v1, 0xc($s0)                   # every blank: Y += 1
.L0x0000025c: addiu $v1, 0x1
.L0x00000260: sh $v1, 0xc($s0)
.L0x00000264: lw $v1, 0x54($s1)                   # count the blanks
.L0x0000028c: slti $v0, 0x96                      # 150 of them, then stop
```

Note the order in the last two: the copy **moves first and counts second**, so
the 150th blank is the last move and the row ends 149 pixels below where the
stage's table put it. After the bound it takes its state-3 arm, which is empty —
the row stays lit where it stopped, and the port keeps writing for the same
reason.

### 12.3 What was ported

`engine/systems/point-record-actor.ts`, extended in place — no second module and
no second hook. The two members are two more `machine` values beside the three
that were already there:

| addition | what it is |
|---|---|
| `machine: "single"` + `tickSingle` | one claimed record, one script, the record left where the stage's point table put it; the cue plays on the ONE blank the object's own counter is still zero |
| `machine: "rise"` + `tickRise` | no script at all: `claimShift` once, `riseBy` per blank, `riseBlanks` blanks, then the state goes to the empty arm and the row stays lit where it stopped |
| `member.rise` | the three numbers the overlay's own code states: the halfword it moves, the pixel the claim takes off it, and the blank bound |
| `member.tags` read from the claim loop | the `atlasFlag` byte each member claims, so the draw and the port cannot disagree about which row a slot owns |

The hook did not change and there is nothing new in it: `web/stage-objects.js`
already dispatched through `firePointRecordStageObject` (one line) and already
ticked through `tickPointRecordStageObjects` (one line), and both members are
reached by those same two lines because both tables live in
`web/assets/data/point_record_actors.json`. The in-place cue goes out through
`setPointRecordActorSound`, the same packed-sound sink every other arm of this
module uses, which is a different sink from the pad arm's music stem — a pad cue
is a jingle the cutscene watcher hands to the music player, and these two have
no cutscene command to hang theirs on. **That last sentence was wrong in the
browser and is corrected in §12.5.**

### 12.4 Three fixes in the one extractor, and what they bought

**Identity is the TICK the allocator installs.** The extractor used to take the
overlay's *first* claim read of the point table, which is not necessarily the
registry member's. `installed_ticks()` now resolves the `$a0` of every
`jal F0x800143dc` / `jal F0x80014504` in the overlay (`jal`'s 26-bit field is a
word offset, so the target is `field << 2`), and `member_ticks()` intersects that
with the ticks `data/stage_registry_members.json` already resolved per member.
This is what keeps **s460 and s526 out**: their member record installs their own
overlay's root-object tick, and the claim read they carry belongs to a different,
nested object of theirs (three claim reads on s460, none of them a member's tick).
Before the fix the extractor reported both as pad flashes.

**The stepper call can be a direct `jal`.** The one-slot rule looked for
`jalr $v0`; s455 calls its stepper with `jal 0x800a5de4` (file `0x1dc`), so the
copy was invisible. `stepper_sites()` now takes both shapes and resolves the
script as the second argument at the call, which also stopped a stage whose tick
merely *holds* a parseable constant (s310) from being read as a copy.

**The claimed tags are data, not an assumption.** `claim_tags()` reads the
constant the claim loop compares (`li $a1, 1` / `bne`, or the
`addiu -1 ; sltiu N` range) and `rise_shape()` reads the no-script shape's three
numbers — the halfword it moves, the pixel the claim takes off it, and the blank
bound — refusing anything it cannot find in the tick.

**A fourth reading, added here.** `stepper_copy()` now names which copy of the
stepper each overlay's BASE (`0x800a5de4`, file 0x04) really carries, by its own
instructions, instead of the module asserting one: `base-u8` is the copy that
reads the entry's hold with `lbu 0x2($s0)` (0x92030002) where the other three use
`lhu` (0x96020002); `follow-u8` is the only copy whose end arm reads the entry's
THIRD byte (`lbu 0x3($s0)` at wstag805 file 0x298); `stop-u16` is the only copy
with no `$a2` test. **This corrected a claim rather than confirming one.**
s455's overlay-base copy has `beq $v1, $v0, .L0x000000c0` at file 0xa8 going
straight to the epilogue — no `$a2` test anywhere in it — so it is the SAME copy
wstag820 carries, not the `base-u16` one the earlier reading named. The call site
passes `move_ $a2, $zr` in the `jal`'s delay slot (file 0x1e0) and the operand is
ignored, exactly as on wstag820. And **s926 carries no stepper at all** (`grep -c
"sll $v1, 0x2" wstag926.s` is 0): the rise shape has no script and calls none, so
its member records `null` rather than a variant it never runs.

The result: **17 members in 13 stages, 344 anchors** (was 15 in 12 and 340), five
`machine` values, and the fifteen existing members' entries unchanged apart from
the one field the new reading corrects.

### 12.5 The six members of this job that are still not ported

They are named here with the shape each one is, because leaving them unnamed is
how they get lost. Five of the six are **more shapes of this same actor** and are
gaps in it; the sixth is a different system.

| member | shape, from its own code | what it needs |
|---|---|---|
| s620 `0x351` (849) | a **four-record grid**: the claim takes every row tagged 1..4 (`addiu $v0, -1 ; sltiu $v0, 0x4`, file `0x1a8`/`0x1ac`), each slot picks its script out of an 8-byte-entry table at `0x800a7648` indexed `index*8 + slot*32` (`:0x29c addu $v0, $s7` / `:0x334 lw $a1, ($s4)`), the entry's `+4` is the stepper's loop flag and its `+6` the script index to switch to when a script ends (`:0x2e0 lh $v1, 0x6($v0)`); three of the four slots write the clip into the record's `ctr` byte instead of its sprite (`:0x338 sb $s0, 0x9($s3)`) and the fourth also plays a cue on clip 52 (`:0x350` / `ori $a0, 0x1`) | a `grid` shape in the extractor (the table walk) and in the module (per-slot script switch). The four rows and their sprites are in `web/assets/data/point_sprites.json` (61, 62, 60, 50) |
| s680 `0x32e` (814) | **eleven lane slots plus three traffic slots**: the claim fills lane slots of 0x14 bytes in table order for every row tagged 1..7 and traffic slots 8 bytes apart for rows tagged 8..10 (`:0x294 sh $zr, 0x12c($a2)` / `:0x2a4 addiu $a2, 0x8`), each lane steps its own script and adds a one-shot rise to the row's Y until it passes 401 (`:0x368 slti $v0, 0x191`), and its configure routine is an eight-entry jump table at the overlay base keyed on `arg2 - 0x33D` (`:0x4d4` / `:0x4e8 addiu $v0, 0x5de0`) that lights lanes by tag and starts a phase which also writes the live object named 5 | a `lanes` shape, plus the configure jump table. I read the claim and the animate half; I have **not** read the eight jump-table targets |
| s261 `0x33b` (827) | **two rows and a six-step sequence**: the claim takes the rows tagged 2 and 3 and drops each 127 pixels when a mode word is set (`:0x0d4 addiu $v0, -0x7f`), then the animate state dispatches through a six-entry jump table at the overlay base on its own second counter (`:0x160 addiu $v0, 0x5de0` / `:0x174 jr $v0`), whose first target sets both rows' Y, saves the live object named 5's `+0x54`, plays `0x8004103C` and advances (`:0x17c`-`:0x1c8`) | the six per-stage steps read one at a time. I read the claim, the dispatcher and the first step; the other four targets are unread |
| s545 `0x34f` (847) | the **one-record copy again** — §12's `single` shape — with a flash state between scripts: state 1 lights the row with sprite 24 and writes `ctr` 9 (`:0x460 sb $v1, 0x4($v0)` / `:0x46c sb $v1, 0x9($v0)`), state 2 runs the script and jumps back to state 1 on the terminator (`:0x4e8 jalr $v0` / `:0x4ec li $a1, 0x1`) | `single` plus a between-script flash, so it is one recipe away in the table and one arm away in `tickSingle`. Not blocked, just not reached: **this run ported two members and left this one**, and §12's own two arms are the proof the shape is the same code |
| s545 `0x350` (848) | a second, different actor on the same stage (its tick is file `0x6ac`) | its own read |
| s460 `0x33e` (830), s526 `0x33d` (829) | **not this system.** Their member record installs their own overlay's root-object tick (file `0x0`), a four-state machine that builds eight sub-objects through three per-stage routines (`wstag460` file `0x40 jal 0x800a6358` / `0x48 jal 0x800a67b8` / `0x5c jal 0x800a6f54`) and then drives their ticks in state 2. This is the stage's own object director, and porting it is porting a whole stage's object tree | a separate read, and the census already flags it (§8) |

**The twenty-five stages the extractor now decodes, seventeen members of which
are ported.** The other stages whose overlays this extractor reads a copy of are
named in `data/stage_registry_members.json` as `interpreter only` rows with their
ticks: they are decoded, not ported, and each one needs a `PORTS` entry plus its
own before/after capture to say what a player sees. **This run ported the two
members this job named (s455 `0x33c`, s926 `0x356`) and left the rest of that
list alone** — the table already carries the fix that made them visible (the TICK
identity rule), which is the shared part; what is left per stage is data plus a
capture, and a capture is what says what a player sees.

### 12.6 What is not established

* **The live object named 5.** s926 writes `+0x100` into it every blank
  (`:0x274 lw $v1, 0x54($v0)` / `:0x27c addiu $v1, 0x100`), s261 saves its
  `+0x54` (`:0x1a0 lw $v0, 0x54($a0)`) and s680 adds to it (`:0x448`-`:0x454`).
  It is fieldstg's own resident stage object — fieldstg file `0xe4bc` allocates a
  0x15C-byte object with TICK `0x80090FB0` and the name 5 — but **I have not read
  what its `+0x54` field means**, so the write is not ported. s926's port is
  therefore its visible half only: the row slides down and stops where the console
  stops it, and the timer it also drives does not move.
  **SETTLED 2026-10-05 by §19**: the object is the field character -- the one you
  are leading -- and `+0x54` is its world Y in 16.8 fixed point (`0x100` = one
  pixel), so the write moves the player and the ROOM scrolls.  All three drivers
  are ported, s261 `0x33b` with them.
* **Whether the claim loops pick the first or the last row of a repeated tag.**
  No decoded loop breaks out of its walk, so a repeated tag would leave the LAST
  matching row claimed; the port's rule is the FIRST. **Measured this run** over
  every shipped point-sprite table, excluding the `0x00FF` FIELDCOM sentinel (no
  overlay's claim loop compares against it — `extract_point_sprites.py:412`):
  seven stages carry a repeated claimable tag, `s421`, `s555`, `s630`, `s635`,
  `s640`, `s645` and `s680`. **None of the seventeen ported members is on one**
  — each claims a tag its own table carries exactly once — so the two rules agree
  on everything shipped. That is a measurement, not a proof: a new member landing
  on one of those seven stages will get the first row where the original would
  take the last, and `tests/point-record-actors.test.js` pins the seven names so
  that case fails the test rather than shipping quietly. Reading the resume
  cursor (0x8005b8f8) properly is what would settle it for all of them.
* **The north-sector pad's cue `0x01000000`.** It is the one pad cue that is not
  a `PACKED_JINGLES` stem (`env024:entry_02`), so the jingle route plays nothing
  for it, and §12.7's fix deliberately keeps it off the sample route rather than
  double-play the other three. **I have not established** whether `entry_02` is a
  BGM stem the jingle player could name or an area-env sample, so s750's pad is
  still quiet. A row in `web/game.js` `PACKED_JINGLES`, or a decision that this
  one goes out as a sample, is what would close it.
Nothing yet -- this run is inventory and plan only.  The port plan is §7 and §8:
one read per tick family, largest coverage first, through the shared route
`web/stage-objects.js` `fireStageObject`, with the stage's own creation call as
the membership test so no hand row is added.
### 12.7 Two faults this pass found in the ported half, and what a player could not hear

Both are in the shared system, not in one member, and both were invisible to
`tests/point-record-actors.test.js` because that file wires the engine's own
setter directly. The browser is where they showed up.

**The cue channel was never wired, so eight members were silent.** The module
keeps a module-level `soundSink` for the cues an actor plays at build, fire and
`single` time — the three moments that happen before any per-stage host exists —
and `web/effects.js` `setPointRecordActorSound` stored the callback in its own
`playStageSound` without ever calling the module's setter. Nothing else in `web/`
called it, so `soundSink` stayed `null` and every `playSound` in the module was a
no-op. A probe on the s455 shrine: the engine asks for the sound (a sink
installed by hand hears exactly one `0x8004213E`), and the game's own sink never
reaches `sfx.playPacked`. The three cues that were lost, with what the packed
player resolves them to:

| member | cue | resolves to | what the player was missing |
|---|---|---|---|
| s455 `0x33c` (828) | `0x8004213E` | `comat102` | the shrine's cue as its row lights |
| s820 `0x355` (853) | `0x0004001D` | `teleport` | the only thing this member does |
| s805 `0x348` (840) | `0x00340004` | `bgm011:gondra_s` | the cue on the machine room's panel change |

The fix is the house pattern `web/stage-objects.js` `setStageObjectSound` already
uses (store locally, then forward into the module): `web/effects.js`
`setPointRecordActorSound` now also calls the engine's setter. The four pad
flashes are NOT part of that: their cues are music stems, `pointRecordPadRun`
publishes them and `web/game.js` `PACKED_JINGLES` hands them to the jingle
player. `firePadFlash` was ALSO pushing them down the sample sink, which
contradicted the comment on `pointRecordPadRun` and would have doubled the
jingle the moment the sink came alive; that call is gone, so each cue now has
exactly one route. `s750`'s stem is the one gap this leaves: `0x01000000`
resolves to `env024:entry_02` and has no `PACKED_JINGLES` row, so that pad is
still quiet. It is a row missing from `web/game.js`'s jingle table, not from
this module.

**The record offsets in the §11 claim snippet were two bytes low.** The loop sets
`$a0 = record + 2` and strides by `0x12`, so `sh $v0, 0x8($a0)` is the record's
`+0xa`, not `+0x8`. The three cells are `+0xa` X, `+0xc` Y, `+0xe` ysort, which
is what `point-sprite-ambient-system.md` tabulates and what the §12 snippet
already used. Values were right; offsets are now right too.

Proof: `tools/verify_point_record_actors.mjs` reads the packed word out of
`sfx.playPacked` in the page, so the shrine's cue is a browser assertion and not
a unit-test claim. Before the fix it read `heard 0`; after, `heard 1`.

## 13. Reading every member: what each one puts on screen (2026-10-04)
The eight members this pass was asked about are not eight things. They are
**three shapes**, and each shape's decode says plainly whether the walker can
draw it. All eight run through the resident allocator `EXE F0x800143dc`, whose
method block is at `obj+0x28..+0x44` and whose tick is the pointer at `+0x48`;
the shared method words are `+0x28` SET_STATE, `+0x2c` SET_COUNTER_A, `+0x38`
ADV_STATE, `+0x3c`/`+0x40`/`+0x44` the three counter advances, and `+0x4c` the
destructor (`~/ddw3/asm/dw2003/exe/fns.s:4740-4934`).

### 13.1 The field's 18-byte display slots, and who writes them

Six of the eight — s305 `0x352`, s306 `0x353`, s310 `0x33f`, s310 `0x340`,
s311 `0x346` and s415 `0x32b` — are **channel players over one shared field
list**, and none of them draws anything itself. Each walks the same 18-byte
record chain held at RAM `0x80099D90`, claims the record whose tag byte matches
one of its own tags, and then writes that record's clip and position back.

The chain, from the reader side (`fieldstg.s:0a018-0a178`, the routine that
builds the field's own draw list out of it):

```
.L0x0000a064: lw $s0, -0x6270($v1)      # $s0 = [0x80099d90], the chain head
.L0x0000a078: lh $v0, 0xc($s0)          # a record is live iff its +0xc != 0
.L0x0000a090: addiu $a1, $s0, 0xc
.L0x0000a098: lbu $v0, -0xb($a1)        # the tag byte at record + 0x1
.L0x0000a0a0: bne $v0, $t1, .L0x0000a0fc   # 0xff ends the walk
.L0x0000a0ac: lh $v1, -0x2($a1)         # record + 0xa  -> the sprite x
.L0x0000a0bc: lh $v1, ($a1)             # record + 0xc  -> the sprite y
.L0x0000a0fc: addiu $a1, 0x12            # the record stride is 0x12
.L0x0000a100: lh $v0, ($a1)             # the next record's +0xc
.L0x0000a108: bnez $v0, .L0x0000a098
```

so the record is `{u8 active; u8 tag; u8 live; u8 ?; u8 clip; u8 ?; u8 ?; u8 ?;
u8 palette; s16 x; s16 y}` — **CONFIRMED**, because the writer's end of frame
stores exactly those four fields (`wstag415.s:0b70-0b9c`, the main actor's
`F0x800a6558`):

```
.L0x00000b70: lw $v1, 0x5c($s0)         # the record it claimed at start-up
.L0x00000b74: lbu $v0, 0x50($s0)        # its current clip
.L0x00000b7c: sb $v0, 0x4($v1)          # record + 4 = clip
.L0x00000b88: sh $v0, 0xa($v1)          # record + 0xa = x
.L0x00000b94: sb $v0, ($v1)             # record + 0 = active
.L0x00000b98: sh $a0, 0xc($v1)          # record + 0xc = y
```

This confirms and narrows ledger claim `stage-anim-step-tagged-decor-forms`,
whose limitation said the tag byte's meaning was not established: **the tag
byte is the channel number a stage object claims, and the record is a display
slot with a clip, a position and a live flag.** The `+9` byte the six-channel
form also writes is the palette index, the same `ctr` the point-sprite records
carry.

The two Master Room members and the two A.o.A. Headquarters six-channel members
all have a `draw_fn == 0` record or a configure handler that only stores
`active/clip/x/y`, so **their whole visible effect is that chain**. The walker's
field has no chain and no reader for it, so porting the writers would move
nothing a player can see.

> **CORRECTED 2026-10-04, later the same day — this conclusion was wrong.** The
> walker's field *does* have the chain and *does* have its reader:
> `web/assets/data/point_sprites.json` IS the chain, per stage, and
> `web/effects.js` `prepareEffects`/`eachRecord` read it, skipping any record
> whose `activeOverride` is 0 — the interpreter bridge already fills that array
> from the original's own memory. What was missing is a translated WRITER, and
> §14 ports one for the single-channel shape. The corrected layout also
> settles the `+0xc` question below: `+0xc` is the record's **y**, and the
> stride-`0x12` walk this document quotes from the fieldstg reader terminates on
> **`size` at `+2`**, which is what the overlay writers themselves test.

| member | stage | ctor | tick | tag(s) it claims | what it writes |
|---|---|---|---|---|---|
| `0x352` (850) | s305 | 0 | `0x800a5eb8` | 1 | `active`, `clip` = 5 or the run's own clip (the "clip 10" phase is dead code, §14); plays packed sound `0xa0042fcb` |
| `0x353` (851) | s306 | 0 | `0x800a5eb8` | 1 | the same code, its own table at `0x800a6738` |
| `0x33f` (831) | s310 | `0x800a65d4` | `0x800a61d0` | 5..10 | six channels: `active`, `clip`, `palette`, over a four-state machine |
| `0x340` (832) | s310 | `0x800a6b58` | `0x800a6758` | 11..16 | the same six channels, second instance: stride 12, tag base 11 (§15) |
| `0x32b` (811) | s415 | `0x800a6a98` | `0x800a6558` | 1 | the crevice ride's main actor: `active`, `clip`, x, y, plus its own five phases |

`s305`/`s306` are the **same code**: the two overlays differ only in the two
table immediates (`.L0x0000012c` and `.L0x000001bc`, `0x800a7ffc` against
`0x800a6738`), so their differing family hashes `0773c9088e9f` and
`5ec4a1092b44` are an artefact of hashing the data address, not of different
code. **One port covers both.** The census does not know that yet.

### 13.2 The fixed still sprites — s310 `0x354` and s311 `0x346` (PORTED)

These two are self-drawing, so they are the ones the walker can show. Both are
the same builder over the same allocator (`wstag310.s:1494-1508`,
`wstag311.s:160c-1620`), the same two clip runs, and the same draw callback
shape, so one port covers the pair.

```
wstag310.s .L0x000014f4  lui $a0, 0x800a
wstag310.s .L0x000014f8  addiu $a0, 0x70ac      # tick 0x800a70ac
wstag310.s .L0x000014fc  li $a1, 0x6c            # a 108-byte object
wstag310.s .L0x00001508  jal F0x800143dc
wstag310.s .L0x00001510  lui $a0, 0x4
wstag310.s .L0x00001518  li $v0, 0x26c
wstag310.s .L0x0000151c  sw $v0, 0x54($s0)      # x = 620
wstag310.s .L0x00001520  li $v0, 0xfc
wstag310.s .L0x00001524  sw $v0, 0x58($s0)      # y = 252
wstag310.s .L0x00001528  lui $v0, 0x8005
wstag310.s .L0x0000152c  lw $v0, 0x5c48($v0)    # the resident packed-id player
wstag310.s .L0x00001534  jalr $v0
wstag310.s .L0x00001538  ori $a0, 0x1d          # cue 0x0004001D
wstag310.s .L0x00001540  li $v1, 0x14
wstag310.s .L0x00001544  sw $v1, 0x50($v0)      # base clip = 20
```

**The cue, and a corrected reading.** The earlier pass called `0x0004001d` a
"sprite-bank resource" and did not play it. It is the packed-sound player at
`0x80055c48` -- the same cue the sound-only member on s820 plays at build time
(`0x0004001d`, §10c) -- and the low half of the pair sits in the `jalr`'s
**delay slot** (`ori $a0, 0x1d` at file 0x1538, after the call), so `lui $a0,
0x4` + `ori $a0, 0x1d` is the WHOLE word. `tools/extract_stage_fixed_sprites.py`
now mines that pair out of both builders into `buildSound`, and the port plays it
through the same `setStageObjectSound` sink the rocks use, so the machine's
arrival is audible where before it was silent.

s311 pins `(271, 411)` with base clip 42 and additionally calls
`obj->0x28(obj, 2)`, so it starts already in its drawing state; s310 starts at
0 and takes the reset band on its first tick.

**What the player sees.** One decoration standing at that fixed point with its
palette cycling, and a second sprite 32 pixels higher for the length of a
one-shot burst. In A.o.A Headquarters that is the machinery on the wall of both
floors; the burst is the part that swings. The burst run opens on clip **300**,
which the tick turns into "no sprite" (`wstag310.s:13e0-141c`), so the burst is
hidden for its first 18 blanks and the standing sprite is up from the first
frame.

The draw callback (`wstag310.s:1118-11e4`) opens a **320x256** window
(`li $a0, 0x140` / `li $a1, 0x100` at file 0x1174/0x1184 -- `0x100` is 256,
not 240; the visible screen is 320x240 and the extra sixteen lines are the
window's overscan rows), begins
**layer 6** for the standing sprite and **layer 4** for the burst (drawn 32
higher), and submits the pair read at `obj+0x64 + extra*4` — the first halfword
is the sprite and the second is its palette index, which is exactly the
`sid@ctr` shape `tools/extract_point_sprites.py` already emits.

`tools/extract_stage_fixed_sprites.py` finds the family in every overlay by its
own code — a `F0x800143dc(tick, 0x6c, 0, id)` builder that pins x, y and a base
clip, and a tick that compares its burst clip against 300 — and reads the
registry id out of the shipped fieldstg image. It finds **2 members over 294
overlays, and both are these two**, so the census above is the whole family and
not a hand list. `engine/systems/stage-fixed-sprite.ts` is the port; the tables
are in `web/assets/data/stage_fixed_sprites.json`.

**Checks.** `node --test tests/stage-fixed-sprite.test.js` (the census re-runs
the extractor and compares the decoded member list with the shipped tables);
`tools/verify_fixed_sprites.mjs` boots each of the two rooms **with no research
flag** — no `?nativeStages`, so the original overlay machine code is not
running — fires the member with the stage script's own `SETANIM` line, and
reports VERDICT OK for both: each sprite alive on 20/20 samples, two layer jobs
queued, the palette value walking the decoded run, the burst clips appearing and
then going, a 40x24 atlas rect resolved, and 9 (s310) / 12 (s311) distinct
checksums over the decoration's own canvas box against one before it existed.
The `tests/stage-fixed-sprite.test.js` file fails at import against the
pre-change `web/vendor/engine.js`, and `tests/stage-registry-members.test.js`
fails its two new assertions against the pre-change census.

### 13.3 s415 `0x32c` — the two-texture scrolling layer (PORTED 2026-10-09)

`0x32c` has no constructor; s415 builds the object itself
(`wstag415.s:10ec-1108`, the delay slot `li $a3, 0x32c` of `jal F0x800143dc`
with tick `0x800a6c8c`, size 0x60) and its registry `draw_fn` `0x800a6e88` only
arms it: `if (arg2 == 0x336) obj->0x2c(1)` — that is, `SETANIM 812 822 …`, and
822 is one of the falling-rock ids. Its tick moves a two-texture layer
horizontally and wraps it, and `wstag415.s:0x10a8`'s sibling `0x800a6b04` draws
the pair.

**PORTED 2026-10-09 (commit 842bf003).** The authority-1 conflict this section
used to carry is settled, and the layer now runs. A genuine first arrival (story
flag `0x4018` clear) slides: the layer object (id `0x32c`, tick `0x800a6c8c`)
holds a still band for ~136 frames, then slides at a steady 8 px right / 4 px up
per frame, decays 16 (0x10) per frame to a stop at frame 650, and the rock-wall
art settles behind the platform. On a **revisit** (flag `0x4018` set) the same
object is built with speed 0 and never moves — which is exactly the static
backdrop the 2026-07-18 capture measured. That earlier capture is therefore a
revisit (or a window after the slide had already stopped), not a first arrival;
`docs/research/field/s415-deeper-crevice-ride-decode.md` records the
reconciliation. The geometry below is unchanged and fully read; the pixels are
the stage's own background pack `S415BG01` (resource `0x769`, TMPK members 2 and
4), **not** `s415mask`. The browser runs it as the `scroll-layer` machine in
`engine/systems/point-record-actor.ts`, gated on flag `0x4018`.
Ledger: `s415-scroll-layer-geometry-and-visibility-settled-2026-10-09`,
`s415-scroll-layer-ported-as-a-shared-scroll-machine-2026-10-09`.

### 13.4 What this pass did not establish

* **The display-slot reader is outside the recovered fieldstg listing.** The
  chain is at `0x80099D90` and its reader allocates its draw list at
  `fieldstg.s:0a018`, but the object that then draws each slot is tick
  `0x8009c98c`, and `~/ddw3/asm/dw2003/pro/fieldstg.s` ends before that file
  offset. So the slots' on-screen presentation is still unread; only their
  layout and their writers are. I have not verified what a player sees from the
  six channel players and am not claiming it.
* **s310's two six-channel members (`0x33f`, `0x340`) and s311's copy** were
  read only as far as the shared shape: the four-state gate, the six-channel
  loop and the two write forms. Their per-channel clip tables were not
  transcribed, because with no reader nothing would show them.
* The 12-byte-stride walk has **two** terminators in the code — the tag byte
  `0xff` and the `+0xc` live flag — and code in the corpus uses each on its
  own; I have not established which is authoritative for a given chain.

---

## 14. The display-slot channel players — s305 `0x352` and s306 `0x353` (PORTED)

**This corrects §13.1's conclusion.** That section said the walker's field "has
no chain and no reader for it". **It does.** `tools/extract_point_sprites.py`
already extracts the chain per stage into `web/assets/data/point_sprites.json`,
and `web/effects.js` is its reader: `prepareEffects` builds an `activeOverride`
array and an `rt[i].sprite` per record and `eachRecord` skips a record whose
override is 0. The interpreter bridge fills those same arrays from the
original's own memory (`web/effects.js:344-352`, `native.pointTable`); what was
missing in ordinary play is a **translated writer**, and that is what this commit
adds — `web/effects.js setPointSlot` is the writer half of the reader that
already ships.

Two registry records resolve, each in its own overlay, to **the same routine**:

| member | overlay | builder | tick | table | tag | sound |
|---|---|---|---|---|---|---|
| `0x352` (850) | s305 | `0x800a6084` | `0x800a5eb8` | `0x800a7ffc` | 1 | `0xa0042fcb` |
| `0x353` (851) | s306 | `0x800a6084` | `0x800a5eb8` | `0x800a6738` | 1 | `0xa0042fcb` |

The two overlays' ticks are **identical instruction for instruction** (measured
with `difflib` over the normalised body, 88 instructions, zero differences) and
even their clip tables hold identical bytes — `{(5,4),(6,4),(7,4),(8,4),(9,4),
(255,…)}`. So their differing family hashes `0773c9088e9f` and `5ec4a1092b44` are
an artefact of hashing the table address, and **one port covers both**. That is
the same situation as s305/s306 sharing `F0x800a6018` and `F0x800a5eb8`, because
every stage overlay loads at `0x800a5de0`: wstag306's configure handler IS
wstag305's, at the same address. The registry therefore lists **both** ids
against that one word, and the extractor breaks the tie with the stage's own
recovered bytecode — the id the stage's scripts fire is the id the stage owns
(`SETANIM 850 821 2` in s305 event 661, `SETANIM 851 821 1` in s306 event 930).

**THE CLAIM.** The overlay walks the chain and stores into its cursor block
every slot whose tag byte at `+1` matches, **without breaking**, so the LAST
match wins; the walk ends on the `size == 0` terminator at `+2`
(`wstag305.s:0x110-0x164`). Both stages ship exactly one slot tagged 1, at
**(382, 196)**, layer 6, sprite 5, and **inactive in ROM** — which is why the
marker has never appeared.

**THE BAND HAS TWO BRANCHES WHOSE DELAY SLOTS OVERWRITE THE REGISTER THEY
TEST.** A PS1 runs a branch's delay slot before the branch resolves:

```
wstag305.s .L0x00000188  beq $a0, $v1, .L0x000001b0   # counter == the state word (1)
wstag305.s .L0x0000018c  slti $v0, $a0, 0x2             # ... delay slot
wstag305.s .L0x00000190  bnez $v0, .L0x000001a4         # $v0 = (counter < 2)
wstag305.s .L0x00000194  li $v0, 0x5                    # ... delay slot: $v0 = 5
wstag305.s .L0x000001a4  sb $v0, 4($s0)                 # the clip is 5, ALWAYS
wstag305.s .L0x000001ac  sb $v1, ($s0)                  # ... delay slot of the j: live
```

`bnez $v0` is taken whatever the test computed, so **every** counter value other
than 1 pins clip 5, and the `counter == 2` block at `wstag305.s:0x218-0x220` —
`li $v0, 0xa` / `sb $v0, 4($s0)`, the **clip 10** — is **dead code on the
console**. Read as ordinary flow it looks like a three-phase intro. It is not
one, and no player ever sees clip 10.
`tools/extract_stage_slot_players.py` refuses any band whose shape it does not
model rather than shipping that reading, and `tests/stage-slot-player.test.js`
asserts no counter value reaches the clip-10 block.

**WHAT THE PLAYER SEES.** `SETANIM 850 821 2` builds the object; the configure
handler `F0x800a6018` plays the packed voice **COMCD115** through
`[0x80055C48]`, stores the handle at `obj+0x50`, clears the clip cursor and
raises the counter to 1 with `obj->0x2c(obj, 1)`. On its next frame the object
claims the slot; from then on the marker at (382, 196) is **live** and walks its
five sprites 5,6,7,8,9 at four blanks each — about 0.4 s. On the 255 marker the
slot's sprite becomes 255, which no ids table resolves, so the marker **blinks
out for one frame**; the counter advances, and the voice is **stopped** through
`[0x80055C50]` — the stop half of the same packed-sound pair. From then on the
counter is 2, every value pins clip 5, and the marker **settles on sprite 5 and
stays**. In the Master Room that is the marker standing in the middle of the
arena, and a champion's line plays over it.

**Checks.** `node --test tests/stage-slot-player.test.js` (9 tests: the census's
member list, the delay-slot reading, the claim rule, the state gate, the
configure sub-command, and a 40-blank walk over s305's real chain that visits
5,6,7,8,9 and 255 and settles on 5).
`tools/verify_slot_players.mjs` boots each room **with no research flag** — no
`?nativeStages`, so the original overlay machine code is not running — fires the
member with the stage script's own line, and reports VERDICT OK for both: the
slot claimed is index 3 (the ROM-inactive tag-1 record), the chain stays at state
1, the counter reaches 2, the last clip is 5, and 8 (s305) / 7 (s306) distinct
checksums appear over the marker's own canvas box against one taken with the
camera already settled and the marker not yet built. s305's run caught the 255
blank on camera. The new test file fails at import against the pre-change
`web/vendor/engine.js`, and `tests/stage-registry-members.test.js` fails its new
assertions against the pre-change census (226/35 instead of 228/33).

## 15. The four members the PREVIOUS pass did not finish

**Two of these four are now translated: see §16.** The table below is the earlier
pass's state, kept because its decode notes are the starting point §16 built on;
the `why` column for `0x33f` and `0x340` is answered there.

### 15.1 The four members, and exactly why

| member | stage | decode status | why it is not in this commit |
|---|---|---|---|
| `0x33f` (831) | s310 | **read in full.** `F0x800a61d0` (file 0x3f0-0x7b4): the state gate, the claim walk, six cursor blocks at `0x54`+8n, a computed jump over the overlay's own method table at `0x800A5DE0` indexed by `tag-5`, four sub-phases, and the second jump table at `0x800A5DF8`. It claims tags **5..10**. | **answered in §16**: the earlier pass read the structure but did not transcribe the per-channel tables, and the phase count it calls four is three reachable phase shapes over six slots (§16.4). |
| `0x340` (832) | s310 | **read, and it is the same code.** `F0x800a6758` (file 0x978-0xd38) is identical to `0x800a61d0` instruction for instruction except its immediates: cursor stride **12** not 8, cursor offsets `0x54,0x60,0x6c,0x78,0x84,0x90`, tag base **11** (`addiu $v1, $v0, -0xb`), its own jump tables at `0x800A5E10`/`0x800A5E28`, its own five clip tables, its own stepper at `0x800a6638`, and sub-phase-2 clips 41/17/18 instead of 40/2/3/4. It claims tags **11..16**. | **answered in §16**, with one correction to the note above: the two pinned clips this member shows are **18 and 19**, not 18 -- `li $v0, 0x12` at file `0xc18` and `li $v0, 0x13` at `0xc1c`, the delay slots that reach the clip store. |
| `0x32b` (811) | s415 | **read as far as the claim.** `F0x800a6558` (file 0x778-0xbb0, interleaved with the overlay's five methods): the same claim walk, tag 1, the cursor at `0x54/0x58/0x5a`, five phases, and each tick it writes the claimed slot's sprite and position. | the phase bodies are a further ~0x400 bytes of interleaved code, plus the physics and the three canned sequences (`0x800a73f0/0x800a7418/0x800a7428`, already claimed by `s415-two-animation-players-hold-and-loop-2026-08-12`). Not transcribed here. |
| `0x32c` (812) | s415 | **read** (`0x800a6c8c` moves a two-texture layer and wraps it, `0x800a6b04` draws it). | blocked on a documented conflict, not on reading: the runtime capture in `docs/research/field/s415-deeper-crevice-ride-decode.md` puts the Deeper Crevice backdrop's best-fit shift at **(0, 0)** — it does not scroll — and the reconciliation ("the layer this object moves is not the backdrop the capture measured") is stated there as **not established**. Porting a scrolling layer the authority-1 capture says does not scroll would invent player-visible behaviour. One runtime check naming which layer moves settles it. |

So: that pass translated **4 of its 8** (`0x354`, `0x346`, `0x352`, `0x353`)
and left four, of which two have since been translated (§16). The shared system
all of them run through — the field's 18-byte display-slot chain at `0x80099D90`,
read by `web/effects.js` — is ported once per writer shape and written through
one route (`web/stage-objects.js fireStageObject` → `web/effects.js setPointSlot`),
so what the two still untranslated members need is translation, not new
plumbing.

## 16. THE display-slot ensembles: s310 `0x33f` and `0x340`, two members, one module (2026-10-05)

**THE SHARED SYSTEM IS §14's, not a new one.** Every member in this section is a
**writer into the field's own 18-byte display chain** at `0x80099D90` — the same
chain `tools/extract_point_sprites.py` extracts per stage, the same
`web/effects.js setPointSlot` writes through, and the same reader that draws it.
So this is the third writer *shape* over one system, not a third system:

| shape | members | port |
|---|---|---|
| one slot, claimed by tag, clip run | `0x352` (s305), `0x353` (s306) | `engine/systems/stage-slot-player.ts` (§14) |
| **six slots claimed at once, one phase each** | **`0x33f`, `0x340` (s310)** | **`engine/systems/stage-slot-ensemble.ts` (this section)** |
| two slots, a shared timer, a 30-tick counter, a "is object 5 live" query | `0x33b` (s261) | not translated (§16.6) |
| a parent that builds nine / thirteen children out of three / five makers | `0x33e` (s460), `0x33d` (s526) | not translated (§16.6; re-read in §18.5, which corrects the "ten / twelve" counts) |

### 16.1 The seven members this job was given, by tick and family

Read from each member's own allocator call — the **first argument is the tick**
and it is what the object runner enters (`EXE F0x800143dc` / `F0x80014504`) — so
each row's tick identifies that member and nothing else. "lines" is the
`wstagNNN.s` file range of the tick itself.

| member | stage | tick | file range | object size | family | shape |
|---|---|---|---|---|---|---|
| `0x33b` (827) | s261 | `0x800a5dfc` | `0x1c`-`0x434` | `0x6c` | two-slot display writer (**new family**) | writes two slots it claims by tag 2 and 3; answers subs 840/841 |
| `0x33f` (831) | s310 | `0x800a61d0` | `0x3f0`-`0x7b4` | `0x84` | **six-slot ensemble, 2 members** | claims tags 5..10, stride 8 — **ported here** |
| `0x340` (832) | s310 | `0x800a6758` | `0x978`-`0xd38` | `0x9c` | **six-slot ensemble, 2 members** | claims tags 11..16, stride 12 — **ported here** |
| `0x32b` (811) | s415 | `0x800a6558` | `0x778`-`0xbb0` | `0x78` | crevice-ride actor, **second shape** | a five-phase physics actor with a clip table of its own and a per-clip cue; a sibling of the ported rockfall, not the same shape |
| `0x32c` (812) | s415 | `0x800a6c8c` | `0xeac`-`0x1124` | `0x60` | scroll driver (**new family**) | its record has a **NULL constructor** (`0x00000000`), so its tick comes from the stage's own allocator call at file `0x1100` |
| `0x33e` (830) | s460 | `0x800a5de0` | `0x0`-`0x214` | `0x50` | parent object + children (**new family**) | the tick IS the overlay base; state 0 is straight-line code that builds **nine** child objects from **three** makers, seven of them through the maker at file `0x1174` (`F0x80014504`, tick `0x800a6c2c`, storing the triple `(slot, group, kind)` at the child's `+0x52/+0x53/+0x54`), and state 2 drives each. Corrected 2026-10-05: see §18.5 |
| `0x33d` (829) | s526 | `0x800a5de0` | `0x0`-`0x210` | `0x50` | parent object + children (**new family**) | the same shape as `0x33e` over its own tables: **thirteen** pointers, nine of them from its `file 0x5b8` maker with `$a0` 1..9 and `$a1` 0,0,1,1,1,2,2,3,3, and four from four other makers. Corrected 2026-10-05: see §18.5 |

**Four of the seven share the display-chain system; three do not.** `0x32b` and
`0x32c` are the crevice ride's own actors and `0x33f`/`0x340`'s siblings' parent
objects are separate families; naming them apart here is the point of the table.

### 16.2 The two members, and what the extractor found

`tools/extract_display_slot_ensembles.py` finds the shape in **all 294 `wstag`
overlays** by its own code and returns exactly these two, so the member list is
not a hand list:

* the chain-head read `lui $vX, HI` / `lw $aY, LO($vX)` whose address is
  `0x80099d90` (`wstag310.s:0x43c`);
* a tag-range test `addiu $vX, -TAGBASE` + `sltiu $vY, 6` (`:0x488`);
* a six-entry **claim table** dispatched through `lw`/`jr` (`:0x0` for `0x33f`,
  `:0x30` for `0x340`), whose six bodies each store a record pointer, a cursor
  index and a cursor timer;
* a six-entry **phase table** eight bytes later (`:0x18`, `:0x48`), whose six
  bodies are the six slots' own jobs;
* a constructor the fieldstg effect registry names (`0x800a65d4` → id 831,
  `0x800a6b58` → id 832), read out of the shipped `FIELDSTG.PRO`.

Every anchor is checked against the overlay and a shape it cannot describe is
**refused** (`UnmodelledShape`), not shipped as a guess. Over 294 overlays it
finds two members and refuses nothing else into the table; s311 carries a
display-chain walk with **no registry constructor** behind it and is therefore
not a member of this system — membership is the registry, never the code alone.

### 16.3 What the player sees

In **A.o.A. Headquarters** six pictures share one point on the wall at map
(550, 116), and a second stack of six sits at (430, 103). `SETANIM 831 857 2`
and `SETANIM 832 857 2` (event 681, the only script line that fires either) build
the two objects. From then on:

* the first stack is **two dark pictures**, a **flickering pair** (pictures 0 and 1
  alternating every four blanks), a **slow cycle** of fourteen 104x96 pictures at
  twelve blanks apiece, and two **pinned** pictures (3 and 4);
* the second stack is the same arrangement at the other end of the room, with
  eleven pictures in the slow cycle and two pinned (18 and 19).

Before this port the wall showed only the records' ROM baseline sprites, because
nothing in ordinary play wrote them: those six records are `active: 0` in the
extracted chain, which is why the walker drew nothing there.

### 16.4 The three things the earlier pass's note did not carry

1. **The phase counter and the slot cursor are the same register.** Both start at
   zero and both advance once per frame (`wstag310.s:0x560`-`0x578` sets them,
   `:0x73c`-`0x74c` advances them), so a "phase" is not a time step applied to one
   slot — it is that slot's permanent job, and a whole pass is **six frames, one
   slot per frame**. The earlier note's "four sub-phases" counts neither that nor
   the mode dispatch around it.
2. **Three of the four mode arms are dead or terminal.** The mode word at
   `obj+0x50` is written in exactly four places in the object (`:0x554`, `:0x784`,
   `:0x788`, and the configure handler `:0x7e4`): state 0 sets it to **2**, the
   handler sets it to **3**, and the pass-closed test moves 1→2 and 3→0. So mode
   **2** is the steady state the object never leaves, mode **3** is the one-shot
   flash a *second* SETANIM starts, mode **0** is terminal, and mode **1** — which
   has its own arm with its own two run tables at file `0x5d4`/`0x5fc` — is
   **never set**, so no player reaches it and this port does not model it. Saying
   so is the honest reading; modelling it would be shipping an unreachable path.
3. **A `run` phase's clip reaches its store through a shared block.** Phase 2
   (`0x648`) does not call the stepper itself: it sets `$a1` and `j 0x67c`
   (`:0x65c`), which is phase 3's call. The two phases therefore run **different
   tables through one call site**, and a phase-body reader that stops at the jump
   reads phase 2 as a phase with no run at all.

### 16.5 The flash, and why the shipped game only sees the steady pass

The configure handler (`0x800a6598`, the registry's own draw word) answers one
sub-command, **857** (`li $v0, 0x359`), and on it re-seeds two cursors and sets
the mode to 3. s310's script fires each member **once**, so in ordinary play the
object is built and never configured: the wall only ever cycles. The flash is
ported anyway, because the handler is real code and a second fire reaches it —
and it is the more interesting half: the two runs play the steady pictures
**backwards** (`0x800a83c4` is 39, 38, …, 28), each run's 255 marker **clears** its
slot's clip rather than writing it, two finished runs take the mode to 0, and the
wall then stays dark for good.

### 16.6 What this pass did NOT translate, and why

| member | why it is still `interpreter only` |
|---|---|
| `0x33b` (827), s261 | Same system, a **third shape**: two slots claimed by explicit tag compares (`:0x9c`, `:0xa4`), a 30-tick shared counter (`slti $v1, 0x1e`, `:0x204`), a "is object 5 already live" query through `[0x8004b7bc]` (`:0x13c`), and its own six-entry table at the overlay base. It is ~0x400 bytes of code that shares the claim walk and nothing else. Not read past the claim and the counter. |
| `0x33e` (830), s460 and `0x33d` (829), s526 | Same system, a **fourth shape**, and the largest: a parent whose tick *is* the overlay base, whose state 0 spawns ten (s460) or twelve (s526) child objects each with its own `(slot, group, kind)` triple, and whose state 2 applies three different per-child operations. Each child then runs a three-state machine of its own (s460 file `0xe4c`) that claims one slot by tag and moves it. Porting the parent without the children would draw nothing, and porting it is a second job's worth of decode. |
| `0x32b` (811), s415 | **Not the display-chain system.** A crevice-ride physics actor with a five-phase table at the overlay base, three canned run tables (`0x800a73f0`, `0x800a7418`, `0x800a7428`), per-clip cues at `0x800a42c1`/`0x800a4648`/`0x800a4103c` and a screen-shake multiply at `:0x8b8`. It is a **second shape of the already-ported rockfall** (`engine/systems/falling-object.ts`), which keeps its own 16-byte record table; this one has no table at all and drives its clips from those three run tables. |
| `0x32c` (812), s415 | **Not the display-chain system**, and **blocked on a documented conflict** carried over from §15: the runtime capture in `docs/research/field/s415-deeper-crevice-ride-decode.md` puts the Deeper Crevice backdrop's best-fit shift at **(0, 0)** — it does not scroll — while this object's tick (`0x800a6c8c`) steps a 16.16 offset and calls the layer mover `0x800a6b04` every frame. Porting a scrolling layer an authority-1 capture says does not scroll would invent player-visible behaviour. **One runtime check naming which layer moves settles it.** That check needs an emulator session, which this pass is not allowed to start. |

**So the honest total for this job is 2 of 7 members translated**, both of them
the whole of the six-slot shape (the census proves the shape has no third member),
and the five left are three further writer shapes over the same chain plus two
crevice-ride actors that are not in that system at all.

### 16.7 Checks

* `python3 tools/extract_display_slot_ensembles.py --check` — 2 members over 1
  overlay out of 294 scanned; the two tables' addresses, both claim layouts, both
  phase bands, both flash bands and both configure re-seeds printed and matched by
  eye against `wstag310.s`.
* `node --test tests/stage-slot-ensemble.test.js` — 14 tests: the member list, the
  anchors, the claim (including the terminator and the last-match rule), the
  cursor seeds, the six-frames-per-pass shape, the three phase shapes, both run
  slots advancing, the state gate, the configure sub-command, the flash running
  backwards and going dark, the 255 marker, and the table/member-list agreement.
* `node --test tests/stage-registry-members.test.js` — the census pins 249
  ported / 12 interpreter-only and this section's two rows.
* `tools/verify_slot_ensembles.mjs` — boots A.o.A. Headquarters with **no
  research flag** (`?nativeStages` off, so no original machine code runs), fires
  `SETANIM 831 857 2` and `SETANIM 832 857 2` through the walker, and reports
  which of the twelve records went live and which pictures they hold.

## 17. Three more shapes of the same actor (2026-10-05)

§10-§12 ported seventeen members.  This section adds three more -- `s545`
`0x34f` (847), `s620` `0x351` (849) and `s680` `0x32e` (814) -- to the SAME
module and the SAME table, and leaves two of this job's five members named with
what they are.  Nothing here is a new system: one claim walk, one stepper, one
method block, three more per-member state machines.

### 13.1 The member table

| member | tick | object | family | what it is | shape | port |
|---|---|---|---|---|---|---|
| s545 `0x34f` (847) | `0x800a6184` (file `0x3a4`) | 0x58 bytes, NULL ctor -- the stage builds it at entry (`wstag545` file `0xae4` `jal 0x800a633c` / `:0xb4c li $a0, 0x34f`) | one claimed row | the `point-record` recipe table with an `advance` arm | `point-record` | ported |
| s620 `0x351` (849) | `0x800a5f00` (file `0x120`) | 0x80 bytes, NULL draw -- `SETANIM 849 821 1` only builds it | four claimed rows, one per 0xc-byte slot block | the new `slots` machine, `grid` kind | `slots` | ported |
| s680 `0x32e` (814) | `0x800a5fd8` (file `0x1f8`) | 0x14c bytes | eleven lane rows and three traffic rows off ONE claim walk | the new `slots` machine, `lanes` kind | `slots` | ported |
| s545 `0x350` (848) | `0x800a648c` (file `0x6ac`) | 0x60 bytes, parent `0x14` = FIVE child slots | five child pad-flash actors plus its own row | `parent` | **ported 2026-10-05, see §18** (13.6 below is the read it was ported from) |
| s785 `0x327` (807) | `0x800a62b4` (file `0x4d4`) | 0x58 bytes | a four-clip sprite-packet player | **a different system**: see 13.6 | `picture-steps` (2026-10-05) | ported |

### 13.2 s545's 847: the recipe table's `advance` and `cue` arms

Four states, ONE claimed row and no pad, so it is the `point-record` machine of
§10 with two recipe fields the other members did not need.

* **state 0 is the claim arm** and its tail is the object's own `+0x38`
  (`wstag545` file `0x3e0` `lw $v0, 0x38($s0)` / `:0x3e8 jalr $v0`), which clears
  the clip, the counter and the timer and steps the state.  The port does the
  walk at construction, so the recipe for that state is
  **`{"advance": true}`** and nothing else -- `PointRecipe.advance`.  Every copy
  of this actor has that tail (wstag455 file `0xdc`, wstag805 file `0x338`); it
  was already true of three ported members and simply was not written down, and
  `s805`'s and `s810`'s own claim arms are the same instruction.
* **state 1 is a PASSIVE frame the row sits in until the room's command
  arrives**: `sb $v1, ($v0)` / `li $v1, 0x18` / `sb $v1, 0x4($v0)` /
  `li $v1, 0x9` / `sb $v1, 0x9($v0)` (file `0x45c`-`0x46c`) -- active 1, sprite
  24, `ctr` 9.  Nothing advances the state here, so this is where the row sits
  from the moment the room loads until the scene's `SETANIM 847 858 2` reaches
  the configure arm (file `0x530` `li $v0, 0x35a` / `:0x544 li $a1, 0x2`
  `setState(2)`).
* **state 2 is the script arm.**  It tests its own clip
  (`file 0x474 lw $v0, 0x10($s0)` / `:0x47c bnez $v0`), and on the one pass that
  finds it zero it rewinds the cursor, latches clip 1 through `obj+0x2c`
  (`:0x490`/`:0x498`) and plays **`0x004C0002`** (`:0x4a0 lui $a0, 0x4c` /
  `:0x4b4 ori $a0, 0x2`).  That is `PointRecipe.cue` plus
  `PointRecipe.latchClip`: the latch is what makes the cue fire once, because
  the overlay's own `+0x10` is the gate.
* **The 0x00ff blank is the FLASH again, and the reason is a jump delay slot.**
  The end arm calls `setState(1)` (`:0x4e8 jalr $v0` / `:0x4ec li $a1, 0x1`),
  then `j 0x800a62f0` with the delay slot `sb $v0, 0x9($s1)` where `$v0` was
  `li $v0, 0x9` (`:0x4f0`), and its TARGET is file `0x500` -- which is the arm
  that writes active 1 and sprite 24, so the jump steps OVER the ordinary
  `sb $v1, 0x9($s1)` at file `0x4fc`.  Net: `ctr` 9, sprite 24, row live.  That
  is `endWrites`, and it is why the port does not store the stepper's own `0xFF`
  here.

What a player sees: the row at map pixel (663,340) -- the stage's own tag-1
record -- carries sprite 24 with palette row 9 from the moment the room loads,
and when the scene's command lands it runs a nineteen-frame run (clips 9 down to
0 and back up to 8, four to ten blanks each) with sprite 24 pinned on every one
of them and the palette row walking the script's values, and the flash frame
comes back both at the run's end and at the run's restart.

### 13.3 s620's 849: the `grid` kind -- four rows, one entry table

One object, four claimed rows, four 0xc-byte slot blocks from `obj+0x50`, and
each slot's clip goes into ONE of the record's two animation bytes.  Nothing
about that is a formula; it is the overlay's own flag byte at `slot+3`, seeded
in the claim arm and tested in the animate loop, so the extractor reads it:

| slot | row | claim's tag | script index the claim leaves | flag byte | writes | cue |
|---|---|---|---|---|---|---|
| 0 | 0 (335,351) sprite 61 | 1 | 2 | `sh $zr, 0x53($s4)` = 0 | `ctr` (record+9) | -- |
| 1 | 1 (345,372) sprite 62 | 2 | 2 | `sh $zr, 0x5f($s4)` = 0 | `ctr` | -- |
| 2 | 2 (477,356) sprite 60 | 3 | 1 | `sh $zr, 0x6b($s4)` = 0 | `ctr` | -- |
| 3 | 3 (489,350) sprite 50 | 4 | 1 | `sb $v0, 0x77($s4)` = 1 | `spriteId` (record+4) | `0x54000001` on clip 52 (`li $v0, 0x34`, file `0x330`) |

The write arm is `file 0x324 lbu $v0, 0x53($s1)` / `:0x32c bnez $v0` ->
`:0x338 sb $s0, 0x9($s3)` (flag 0) or `:0x36c sb $s0, 0x4($s3)` (flag 1), and
the cue sits in the flag-1 arm only, guarded by the slot's own second flag byte
(`file 0x344 lbu $v1, 0x52($s1)` / `:0x364 sb $zr, 0x52($s1)`).

**The script is an ENTRY, not an address.**  The loop reads
`table + slot * 0x20 + index * 8` out of the overlay's own table at `0x800a7648`
(`file 0x28c sll $v0, 0x3` / `:0x290 sll $s2, 0x5` / `:0x298 addu $v0, $s7` /
`:0x29c lw $a1, ($v0)`), hands the entry's `+4` halfword to the stepper as its
**third argument** (`file 0x2a0 lh $a2, 0x4($v0)`, so each entry's loop flag IS
the stepper's `$a2`), and its `+6` halfword is the index to switch to when that
script ends (`file 0x2e0 lh $v1, 0x6($v0)`).  A zero `+6` puts the row out: the
`j` at file `0x2f0` writes 0 into the slot and lands on the record-off arm
(`:0x370 sb $zr, ($s3)`).  On a real switch the cursor is rewound from the NEW
script's first hold (`file 0x2fc sh $zr, 0x58($s1)` / `:0x318 lhu $v0, 0x2($v0)`
/ `:0x320 sh $v0, 0x5a($s1)`) and the slot writes nothing on that blank, because
the `j` at file `0x31c` goes straight to the epilogue.

Two consequences the port reproduces rather than tidies:

* **Slot 2's script opens on 300**, which is the blink-off value
  (`file 0x2b8 li $v0, 0x12c`), and it opens with a hold of 90 blanks.  So
  s620's third row goes dark the moment the room is built and stays dark for
  three seconds, then walks a run of 0,1,2,1,0,... and back.  Slots 0 and 1 start
  on index 2, whose `+6` is 3, so they switch to index 3's short loop; slots 2 and
  3 start on index 1, whose `+6` is 0, so they go dark for good.
* **Only slot 3 changes its sprite**, so three of the four rows animate their
  palette row and never their sprite, exactly as on the console.

### 13.4 s680's 814: the `lanes` kind, and a FIFTH stepper copy

One claim walk (`file 0x244`-`0x2f4`) sorts EVERY point row into one of two slot
arrays and keeps walking -- it does not break out:

* rows whose atlas byte is **1..7** fill **eleven** 0x14-byte lane slots in
  TABLE ORDER (`file 0x288 slti $v0, $v1, 0x8`), each taking the next row of the
  overlay's own **11-pointer script table at `0x800a6790`** (`file 0x2c8 lw $v0,
  ($t0)` / `:0x2d4 addiu $t0, 0x4`), and each storing its own tag in two words
  (`:0x2b0 sh $v0, 0x5a($a0)` / `:0x2c4 sw $v0, 0x50($a0)`) so the configure
  routine can find it by tag;
* rows tagged **8..10** fill **three** 8-byte traffic slots (`:0x294 sh $zr,
  0x12c($a2)` / `:0x2a4 addiu $a2, 0x8`) which have **no script at all**.

Because the walk takes the k-th MATCHING ROW, s680 is one of the seven stages
whose table carries a repeated claimable tag -- three rows carry tag 3 and three
carry tag 4 -- so **the port cannot use `claimRecord`'s first-match walk here**,
and does not: `PointLaneSlot.index` carries the walk's own ordered result and
`tests/point-record-actors.test.js` re-derives it from the table and checks every
slot.

**The fifth stepper copy.**  `wstag680` file `0xfc` reads the cursor at `+0xc`
and the hold at `+0xe` as a DELAY BYTE, has no `$a2` test at all, and its end
arm is one nothing else does: `file 0x1a8 lbu $v0, 0x3($s0)` reads the end
entry's **third byte**, `:0x1b0 sh $zr, 0xc($s1)` puts the index back to **zero**
rather than following it, and `:0x1b4 sw $v0, 0x4($s1)` parks the byte in the
**cursor's own `+4` word**.  That word is the lane's rise: the animate arm reads
it (`:0x34c lhu $v1, 0x54($s1)`), adds it to the record's own Y (`:0x358 sh $v0,
0xc($s0)`) and zeroes it (`:0x35c sw $zr, 0x54($s1)`).  So the script's end entry
IS the lane's one-shot walk down the screen, which is what `PointStepperVariant`
`"rise-u8"` and `PointCursor.rise` are for.  `-- $s0 is the SCRIPT BASE again at
file 0x1ac, so the `lbu $v1, 0x2($s0)` at 0x1b8 charges entry 0's delay, not the
end entry's.`

The lane loop stops a lane once its row reaches Y 401 (`file 0x368 slti $v0,
0x191`), and the traffic loop slides its row down exactly one pixel a blank on
the same bound with no script and no sprite write (`file 0x3d8 sra $v1, 0x18` is
`addu $v0, $v1, 1`; the bound at `:0x3ec`; the stop at `:0x3f8`).

**The configure routine** is a 63-entry jump table at the overlay base keyed on
`sub - 829` (`file 0x4d4 addiu $v1, $s1, -0x33d` / `:0x4d8 sltiu $v0, $v1, 0x3f`
/ `:0x4e8 addiu $v0, 0x5de0`).  Only eight entries do anything, and the extractor
reads each arm's words rather than the subId:

| subId | the arm | effect |
|---|---|---|
| 829..835 | `li $a2, 1..7` in the `j`'s delay slot | light every lane slot carrying that tag, by writing 1 into the lane's **cursor index** (`file 0x57c lh $v0, 0x5a($a0)` / `:0x584 bne $a2, $v0` / `:0x58c sh $a1, 0x58($a0)`) -- so a lit lane starts at **entry 1**, and plays `0xEC000001` (`file 0x5a0`/`:0x5b4`) |
| 831 | `sh $v0, 0x12c($s0)` before the `j` | also starts traffic slot 0 |
| 833 | `sh $v0, 0x13c($s0)` | also starts traffic slot 2 |
| 835 | `sw $zr, 0x74($a0)` in the `j`'s delay slot | also starts traffic slot 1 and clears **lane slot 1's row pointer** |
| 836 | `move_ $a2, $zr` (`file 0x508`) | nothing: the loop's own `beqz $a2` returns |
| 891 | `sh $v0, 0x148($s0)` (`file 0x568`) | starts the live-object drive (13.6) |
| 837..890 | the table points at the loop entry with `$a2` still 0 | nothing |

What a player sees: a road of eleven rows of lights.  Firing subId 829 makes the
one row tagged 1 run its three-frame cycle (15, 16, then 14) and drop 72 pixels
down the screen, then go quiet; subId 833 makes a second row cycle and drop one
row of a different height, and also starts a traffic row sliding down one pixel
a blank until it passes 401.

**A quirk the port keeps, because the original has it.**  The registry's handler
constructs AND configures in one call (fieldstg file `0x21bc` then `0x21c8`), and
the claim arm zeroes every lane index and every traffic index
(`file 0x2b8 sh $zr, 0x58($a0)` / `:0x294 sh $zr, 0x12c($a2)`).  So **the first
`SETANIM` a stage sends is wiped by the claim on the very next blank**, and only
the second one lands.  s680's recovered script sends each subId once, which is
why the lane rows only move from the scene's later events.  Both the unit test
and the browser check fire twice and say so.

### 13.5 What changed in the shared module

No second file, no second hook, no second table.  `web/stage-objects.js` already
dispatched through `firePointRecordStageObject` (one line) and ticked through
`tickPointRecordStageObjects` (one line), and all three members are reached by
those same two lines.

| addition | what it is |
|---|---|
| `PointRecipe.advance` | the claim arm's tail is the object's own `+0x38`; three ported members already had it and did not write it down |
| `PointRecipe.cue` / `cueClip` / `latchClip` | a cue an arm plays on ONE blank, gated by the object's own clip register, and the `setClip` that makes the gate fire once |
| `PointStepperVariant` `"rise-u8"` + `PointCursor.rise` | the fifth stepper copy: the end entry's third byte is a one-shot RISE the stepper parks in the cursor's own `+4` word |
| `machine: "slots"` with `kind: "grid"` / `"lanes"` | two shapes of the multi-slot actor: N claimed rows, N cursors, N scripts, and ONE record byte per slot |
| `fireSlots` | the `lanes` configure routine, keyed on the subId, reading the jump table's arms out of the overlay |
| `tickGrid` / `tickLanes` | the two animate halves |

The extractor's own changes are in `tools/extract_point_record_actors.py`:
`SLOT_SITES` (the two multi-slot members, anchored instruction by instruction),
`s545 0x34f` added to `POINT_SITES`, and four readers -- `nearest_li`,
`claim_rows`, `store_const` and the two `build_*_member` functions.  `claim_rows`
is the important one: it returns the **k-th matching row in table order**, which
is what the original's non-breaking walk takes and what `claimRecord`'s
first-match rule cannot express.

Anchor count 519, of which 175 are this section's.  Every one is checked against
`~/ddw3/asm/dw2003/pro/wstagNNN.s` AND the shipped image, so a mistyped address
stops the build: this section's anchors caught **eleven wrong addresses and one
wrong register class** while it was being written (including the trap that
`$s4` is register 20, not 28).

### 13.6 The two members of this job that were still `interpreter only` (both since ported)

Both are named here with the whole of what was read, so the next job starts from
facts and not from a re-read.

**s545 `0x350` (848) -- the pad owner.  PORTED 2026-10-05; see §18.**  (What
follows is the read it was ported from, kept because §18 quotes it.)  Its tick is
file `0x6ac`, its object is
0x60 bytes and its constructor passes **`li $a2, 0x14`** as the parent, which is
FIVE child slots (EXE `F0x800143dc` file `0x14440 bgez $a0` / `:0x14450 sw $v0,
0x20($s0)`, and `F0x80018230` is the routine that walks that child array).  Its
state 0 does two things: it claims **its own** tag-2 row at map pixel (701,371)
into its own cursor (`file 0x1b8 slti $v0, 0x8` is the traffic test, `:0x720 sh
$zr, 0x5c($s3)` / `:0x730 sw $a0, 0x58($s3)` / `:0x734 sh $v0, 0x5e($s3)`), and
it builds **five child objects** through the routine at file `0x274`, whose TICK
is **`0x800a5f20`** (file `0x140`) -- NOT this member's own tick, and not
`0x34f`'s.  Each child gets three words out of the overlay's own table at
`0x800a6df4` (five 12-byte rows: `{x, y, tag}` = (648,471,3), (815,368,4),
(592,287,5), (775,457,6), (564,369,7)), stored at the child's `+0x58` (the tag it
claims), `+0x50` (x) and `+0x54` (y).  **The child's tick is the pad-flash shape
already ported in §10**: it claims the row carrying its own tag, moves it to
`(obj+0x50, obj+0x54)`, hides it in state 1, and in state 2 runs one script
(`0x800a6d24`, clips 11..23) with sprite = the step value.  (Those five rows are
already at those five coordinates in s545's own point table, so the move is a
no-op on screen.)  The parent then has a **clip** machine over six arms
(`file 0x7a4 sltiu $v0, $v1, 0x6` / `:0x7b0 addiu $v0, 0x5de0`): clip 0 hides its
own row, clips 1 and 3 run its own scripts `0x800a6da8` (clips 0..8) and
`0x800a6dd0` (10, 9) and on their end write sprite 8 or 9 and move to clip 2 or
4, clips 2 and 4 **poke one child** into state 2 (`file 0x950 lw $v0, 0x50($s3)`
/ `:0x964 addu $v0, $s1, $v0` / `:0x978 jalr $v0` `setState(2)` / `:0x980 sw $zr,
0x50($s3)`), and clip 5 runs `0x800a6ddc` looping with no end test after playing
`0x004C0001`.  The configure arm is an 8-entry jump table at `0x800a5df8` keyed
on `sub - 861` (`file 0x9c8 addiu $v1, $s1, -0x35d`): 861/862/863 set clip
1/3/5, 864..868 set `obj+0x50` to 1..5 (which child the next clip-2/4 arm pokes),
and it plays **`0x8004474A`** on every command whose `obj+0x54` is zero -- which
this overlay never sets, so the cue plays on **every** `SETANIM`.  What is not
ported: the five children are five OBJECTS on the original, and this module's
actors have no child objects, so porting this needs a child-array in the module
rather than another `kind`.  It is one machine arm, not a new system -- and that is what §18 ported.

**s785 `0x327` (807) -- a different system, ported 2026-10-05 (commit 17e2a642;
claim `online-center-scripted-pictures-play-again-2026-10-05`).**  Its tick is
file **`0x4d4`** (the `0x2b4` written at §13.1 and in the first reading of this
paragraph is an arithmetic slip: `0x800a62b4 - 0x800a5de0 = 0x4d4`, and the
ctor's own `addiu $a0, 0x62b4` confirms it), a four-clip animation player that
draws pictures 50..61 through the resident 2-D sprite emitter at `wstag785` file
`0x428`, at a position read out of a **tagged cast object**, not a sound.  Two
readings here were wrong and are corrected rather than deleted: the pack `0x01c7`
= resource 455 is `LBA_S785TMPK_BIN_IDX` -- **S785TMPK.BIN, s785's own sprite
directory**, which the walker already extracts, so no asset is missing; and
`obj+0x54` is **not** the handle `playSound(5, 12, -1)` returned -- the configure
handler's `find(5, operand, -1)` stores the active object of type 5 whose `+0x04`
is the third operand, i.e. the cast/NPC actor the scene names (npc 12) -- which
is why the scene's own `SETANIM 807 808 12`, `807 809 12` and `807 810 1` name
operand 12.  The pictures play over that character's world pixels minus `0x18`.
It is **not** the point-record actor (no claim walk, no stepper, no record
table), so it is its own machine -- the `picture-steps` machine -- rather than a
hand row.

### 13.7 What you will see

**Before**: with no research flags, s545's row at (663,340) stayed dark, s620's
four rows stayed dark, and s680's eleven lane rows never changed from the
static sprite their ROM table carries -- none of the three members existed, and
the `SETANIM`s the rooms' own scenes send constructed nothing because the
records they animate have no constructor the walker could reach.

**After**, in ordinary play with no `?nativeStages`:

1. Load a save that puts you in the s545 room and stand near (663,340).  The row
   is lit from the moment the room loads -- sprite 24, palette row 9 -- and the
   scene's own `SETANIM 847 858 2` starts a nineteen-frame run with sprite 24
   pinned and the palette row walking 9,8,7,6,5,... and back, with one soft cue
   at the start.
2. Enter s620 (`?skipTitle=1&map=s620`) and stand near (477,356).  Four rows
   light: three of them animate their palette row only, the fourth animates its
   sprite 50,51,52,...,59, and the third goes dark for three seconds first
   because its script opens on the blink-off value 300.
3. Enter s680 (`?skipTitle=1&map=s680`) and stand near (120,160).  When the
   scene's event sends `SETANIM 814 829 814`, the row tagged 1 runs 15,16,14 and
   drops 72 pixels down the screen.

`tools/verify_point_record_actors.mjs` drives all three with no research flags
and reads the frames back off the point records; screenshots land in
`.bunny-scratch/shots/pra3b/` (`s545-847-before.png` / `s545-847-after.png`,
`s620-849-before.png` / `s620-849-after.png`, `s680-32e-before.png` /
`s680-32e-after.png`).

### 13.8 What I did not do

* **s545 `0x350` is no longer `interpreter only`** -- §18 gave the module its
  child array and ported it.  **s785 `0x327` is no longer either** -- it was
  ported on 2026-10-05 as the `picture-steps` machine (commit 17e2a642; see
  §21.1), and the "raw sprite-packet surface" this bullet named turned out to be
  the resident 2-D emitter the walker already draws through.
* **The live object named 5.**  s680's subId 891 starts a drive that adds one
  pixel a blank to the `+0x54` of fieldstg's own resident stage object
  (fieldstg file `0xe4bc` allocates it, tick `0x80090FB0`, name 5) and keeps a
  counter that only advances past 121 (`wstag680` file `0x468 slti $v1, 0x79`).
  This is the **same open gap §12.6 already names**: the walker has no object
  named 5 and does not compute what its `+0x54` means, so the drive is read and
  recorded here and not written.  It does not affect any row on screen.
  **SETTLED and PORTED 2026-10-05 by §19.4**: the object is the field character
  and `+0x54` is its world Y in 16.8, so the drive pushes the PLAYER down with a
  growing step (0x40 a blank over 122 blanks, 1172 pixels in all) rather than
  touching a row.
* **`s680`'s `rise-u8` end entry keeps its garbage hold.**  s680's lane scripts
  end `(255, 0x4800)` and `(255, 0x5000)`: the end entry's hold halfword is the
  NEXT table's first value, because `parse_script` stops at the 0xff.  The port
  charges entry 0's delay on top, which is what the original does
  (`wstag680` file `0x1ac move_ $s0, $s2` puts the SCRIPT BASE back in `$s0`),
  so the 0x48 and 0x50 never reach a cursor -- but the table still carries them,
  and the tests read the rise out of the THIRD byte, which is the one the code
  uses.
* **The other eight `interpreter only` members** are untouched.

Nothing yet -- this run is inventory and port only; the port plan is §7 and §8.

## 18. THE child-pool parent: s545 `0x350`, one member, ported 2026-10-05

**THE SHARED SYSTEM IS §11's, with one thing it did not have: a child array.**
The member is the same object -- one claimed row, one own script per clip, the
same shared stepper, the same method block at EXE `F0x800143dc` -- except that
its first state also **builds other objects through the shared child allocator**
(`F0x80014504`, which is `jal F0x800143dc` with `move_ $a3, $zr`; the count at `+0x20` and the base at `+0x24` come from its third argument -- corrected in §20), and
one of its clip arms pokes one of them into its script state. So this is a
`parent` machine in `engine/systems/point-record-actor.ts`, not a new module and
not a second renderer, and the children are the already-ported `pad-flash` actor.

### 18.1 The four members this job was given, read from their own allocator calls

The **first argument to the allocator is the tick** -- that is what identifies the
member -- and the second is its object size. Each row below is read out of the
overlay's own `jal F0x800143dc` / `jal F0x80014504` call, not from a name.

| member | stage | tick (allocator arg 1) | file offset | size | child slots | children it builds | status |
|---|---|---|---|---|---|---|---|
| `0x350` (848) | s545 | `0x800a648c` | `wstag545.s` `0x6ac` | `0x60` | `0x14` = 20 | **five**, one maker (`file 0x274` -> `0x800a6054`) | **ported** |
| `0x33e` (830) | s460 | `0x800a5de0` (the overlay base) | `wstag460.s` `0x0` | `0x50` | 9 pointers | **nine, from three makers** | interpreter only (18.5) |
| `0x33d` (829) | s526 | `0x800a5de0` (the overlay base) | `wstag526.s` `0x0` | `0x50` | 13 pointers | **thirteen, from five makers** | interpreter only (18.5) |
| `0x33b` (827) | s261 | `0x800a5dfc` | `wstag261.s` `0x1c` | `0x6c` | 0 | none -- two slots of its own | ported (§19) |

### 18.2 What the parent is, read out of `wstag545.s`

* **State 0 claims its own row and builds the five children.**  It walks the
  field's own display chain (`file 0x6f0 lw $a0, -0x6270($v0)` = `[0x80099d90]`)
  for tag **2**, parks the row's own halfword at `obj+0x5e` and the chain
  pointer at `obj+0x58` (`file 0x720`-`0x734`), then runs the row table at
  `0x800a6df4` five times (`file 0x758`/`0x774 slti $v0, $s2, 0x5`), calling the
  maker at `file 0x274` and storing each child pointer through the array
  (`file 0x770 sw $v0, ($s1)` / `0x77c addiu $s1, 0x4`).
* **The children are `pad-flash` objects and nothing else.**  The maker's tick is
  **`0x800a5f20`** (`file 0x140` -- *not* the parent's tick and not `0x34f`'s),
  its object is `0x64` bytes (`file 0x298 li $a1, 0x64`), and each child gets
  `{x, y, tag}` = (648,471,3), (815,368,4), (592,287,5), (775,457,6), (564,369,7)
  out of the same table, parked at its `+0x50`/`+0x54`/`+0x58`.  It claims the row
  carrying its own tag, hides it in state 1, and in state 2 runs **one** script,
  `0x800a6d24` = clips 11..23, with sprite = the step value.  **Those five rows are
  already at those five map pixels in s545's own chain**, so the move is a no-op on
  screen -- which is why the port writes the coordinates and the room does not jump.
* **The clip machine has six arms and they OVERLAP**, so the table records flags,
  not kinds.  Clip 0 hides the parent's own row (`file 0x7d0 sb $zr, ($s0)`, in the
  delay slot of the `j` that targets `0x950`) **and then runs clip 2's body**;
  clips 1 and 3 run their own scripts and fall into the same shared tail
  (`file 0x850` / `0x8d4`); clips 2 and 4 are that tail: `lw $v0, 0x50($s3)` /
  `beqz` / `addiu $v0, -0x1` / `sll $v0, 0x2` / `addu $v0, $s1, $v0` /
  `lw $a0, ($v0)` / `lw $v0, 0x28($a0)` / `jalr $v0` `setState(2)` /
  `sw $zr, 0x50($s3)` (`file 0x950`-`0x980`).
* **The selector is ONE BASED and its zero means "none"**, which is why the
  parent's five arms are `li $v0, 1..5` in a `j`'s **delay slot**
  (`file 0xa64`-`0xa88`, all five storing `obj+0x50` at `0xa88`).
* **The stepper's third argument differs per arm, and that is visible.**  Clips 1
  and 3 pass `li $a2, 0x1` (`file 0x7fc` / `0x880`) and so **stop** on the `0x00ff`
  marker, which is where sprite 8 / sprite 9 and clip 2 / clip 4 come from
  (`file 0x838`/`0x84c`, `0x8bc`/`0x8d0`); clip 5 passes `move_ $a2, $zr`
  (`file 0x930`) and **restarts**, so its pair 10, 9 loops for ever.
* **Every `SETANIM` plays `0x8004474A`**, because the gate the handler tests
  (`file 0x9bc lw $v0, 0x54($s0)` / `0x9c4 bnez`) is the one word state 0 zeroes
  (`file 0x788`, a `jalr` delay slot) and nothing ever sets again.  The handler's
  tail is `setCounter(0)` (`file 0xa90`), which is what arms the new clip's first
  blank.

### 18.3 The order fact that a naive port gets wrong

**A command sent in the same instant as the construct is lost.**  State 0's tail
zeroes *both* the gate and the selector, in the two delay slots around its own
`jalr` (`file 0x788 sw $zr, 0x54($a0)` and `file 0x790 sw $zr, 0x50($a0)` --
delay-slot instructions always run), so `SETANIM 848 864` arriving before the
object's first frame pokes nothing.  The room's own script never does this:
event 710 sends `SETANIM 848 860` at line 2 and the first child selector at line
30, with a walk to the far corner and a spoken line in between, so the object has
taken its claim frame long before.  `tests/child-pool-parents.test.js` pins both
halves of that, because the shipped game is the second half.

### 18.4 What changed in the shared module

No new file, no second hook, no second table for the runtime.  `web/effects.js`
loads `child_pool_parents.json` beside the other point-record tables and
`firePointRecordStageObject` asks the parent table second, so a stage that names
id 848 does not know which table carried it.

| addition | what it is |
|---|---|
| `machine: "parent"` + `PointParentChildSpec` / `PointParentClip` | the child array, and the six-arm clip table read out of the overlay |
| `PointActor.children` / `.selector` | the live child objects, and obj+0x50's one-based "which child" |
| `fireParent` / `setClip` / `tickParent` / `tickParentChild` | the configure arm, and the two animate halves |
| `PointParentChildSpec.arm` | the call site's own third argument to the stepper, per clip |

`tools/extract_child_pool_parents.py` is the new extractor: it finds the shape by
its own code over all 294 `wstag` overlays, returns the three parents it can
describe, and **refuses** the thirteen builders whose three fields are parked in
an order it cannot name (they are listed in the table's
`buildersRefusedForAnotherTripleOrder`, so the refusal is evidence and not a
silent gap).  `tools/inventory_stage_registry.py` carries the new `PORTS` entry
with `data_check: "parents"`, so the census re-checks the citation against the
extractor's own table.

### 18.5 The three members of this job that are still `interpreter only`

**`0x33e` (830) s460 and `0x33d` (829) s526 -- a DIFFERENT shape, and the job
order's "ten / twelve children" is not what the code does.**  Their ticks are
their overlays' own base address (`0x800a5de0`, file `0x0`), so the routine at the
base *is* the object runner.  s460's state 0 is straight-line code, not a loop:
it calls **three different makers** and stores nine pointers:

| maker (file) | tick | size | how many | what it parks in the child |
|---|---|---|---|---|
| `0x578` | `0x800a6118` | `0x5c` | 1 | nothing: the maker only calls `F0x80014504` with `$a2 = 0` (§20 correction) |
| `0x9d8` | `0x800a64a4` | `0x64` | 1 | nothing: the maker only calls `F0x80014504` with `$a2 = 0` (§20 correction) |
| `0x1174` | `0x800a6c2c` | `0x80` | **7** | `(slot, group, kind)` at its `+0x52`/`+0x53`/`+0x54` (`file 0x11a8`-`0x11b0`) |

with the seventh call's pointer stored twice (file `0xd8` and `0xdc`; corrected in §20).  s526 is
the same shape over its own tables: nine calls to its `file 0x5b8` maker with
`$a0` 1..9 and `$a1` 0,0,1,1,1,2,2,3,3, plus four children from four other
makers, thirteen pointers in all.  **So the family this job found is not one
shape but two**: s545 is *one maker, five pad-flash children* -- the children are
already ported, which is why it ports -- while s460/s526 are *three or five
makers, nine or thirteen children*, and **three or five of those children are
four-state actors with their own claim walk and their own stepper**
(`wstag460 file 0xe4c` dispatches on `obj+0x0c` 0/1/2/3 and its state 0 walks the
chain for the tag the parent parked at `+0x52`).  No ported module models them, so
porting the parents alone would draw nothing: **this is a shared-system gap in
the child-actor system, not a per-member omission**, and it is the next job.

**`0x33b` (827) s261 -- the two-slot writer, read end to end and not ported.**
Same display chain, a third shape.  Its state 0 claims the rows tagged **2** and
**3** by explicit compares (`file 0x9c beq $v0, $t0` / `0xa4 beq $v0, $a3`) and
keeps the **last** match of each, lighting the tag-3 row and darkening the tag-2
row (`file 0x10c sb $a2, ($a1)` with `$a2 = 1`, `file 0xe0 sb $zr, ($a1)` in a
`j`'s delay slot).  Its state 2 is a **six-arm clip machine over the six words at
the overlay base** (`file 0x15c`-`0x178`): clip 0 lights both rows and plays
`0x8004103C`; clip 1 adds a frame count to a counter and does nothing until it
reaches **30** (`file 0x204 slti $v1, 0x1e`), then advances the clip and plays
`0x01080001`; clips 2 and 4 walk both rows' `+0xc` halfwords by a per-index delta
from a table at `0x800a66a0` and stop on the entry `1000`; clip 3 is a **254-step
blink** that jumps both rows by `±0x7f` on every other index and restores the
saved Y when the index runs out; clip 5 turns the tag-2 row off and flips
`obj+0x58`.  Its configure arm answers **840** (`setState(2)`, direction 0) and
**841** (`setState(2)`, direction 1) (`file 0x44c`-`0x49c`).  Two facts make it a
job of its own rather than a row in this one: it calls **"is object 5 already
live"** through `[0x8004b7bc]` every frame (`file 0x13c`), which §13.8 already
names as the walker's open gap, and it **drives that object**.  The answer goes
to `$a0` (`file 0x150 move_ $a0, $v0`).  The clip arms then write the found
object's word `+0x54`: clip 0 saves it at `obj+0x64` (`file 0x1a0 lw $v0,
0x54($a0)` / `0x1a8 sw $v0, 0x64($s0)`); clips 2 and 4 store `obj+0x64` plus the
table delta into it (`file 0x284`-`0x290 sw $v0, 0x54($a0)`); clip 3 steps it by
`±0x100` (`file 0x3b0`-`0x3c0`, `0x3e4`-`0x3f4`) and its restore writes
`obj+0x64 - 0x7f00` (`file 0x334`-`0x340`).  The arms do not test `$a0` for
zero.  The two rows are written only through `$s2 = obj+0x50` and
`$s1 = obj+0x54`, loaded before the call (`file 0x138`, `0x140`), and
`obj+0x54` itself is never overwritten.  So both rows move together, and the
object named 5 moves with them: the same delta in clips 2 and 4, but `0x100`
per row step in clip 3 and `0x7f00` against the rows' `0x7f` in its restore.  This is the same
`+0x54` word that s926 `0x356` and s680 subId 891 write (§13.8).  Porting it
needs that object first; nothing about this member is unread.

### 18.6 What you will see

**Before** (ordinary play, no research flags): in **Network Break -- Bug Maze Pit**
the five pads and the wide step above them are simply not there.  All six rows are
`active: 0` in the stage's own extracted chain, and nothing in ordinary play wrote
them, because the `SETANIM 848` lines the room's scene sends constructed nothing.

**After**, with the room's own nine `SETANIM 848` lines replayed:

1. The room's scene builds the object, the walker crosses to the far corner, and
   the five pads come on **one at a time**, 24 to 96 blanks apart -- each is a
   small stepped platform with a green rim, and each starts its own thirteen-frame
   cycle (pictures 11 through 23) the moment it is named.
2. The step above them plays the **appear**: nine pictures, four blanks each, and
   it parks on the last one.
3. Then a two-picture **flash** alternates a few times and parks on the other of
   the pair.
4. Then it settles into that same two-picture pair and **loops for ever**, with one
   soft cue at the start, and all five pads keep cycling beside it.

`tools/verify_child_pool_parents.mjs` drives exactly that in ordinary play with
**no `?nativeStages`**, at one fixed camera, and reports which rows went live and
which pictures they hold.  Captures: `.bunny-scratch/child-pool-parents/before.png`
(bare floor) and `after.png` (two stepped platforms with green rims and the pad
glowing beside the player), plus one per `SETANIM`.

### 18.7 Checks

* `python3 tools/extract_child_pool_parents.py --check` -- 3 parents over 294
  overlays, the tick, size, child-slot count, child count, every child tick, the
  clip table, all six clip arms and all eight configure sub-commands printed; 13
  further builders refused by name.
* `node --test tests/child-pool-parents.test.js` -- 19 tests: the member list, the
  object's own words, the five children and their shared script, the six
  overlapping clip arms, the eight configure arms, the scene's own nine commands
  with their waits, the wiped-selector order fact, the appear, the flash, the
  loop, the children's own run, the census split, and "a stage with no parent
  answers false".
* `node --test tests/stage-registry-members.test.js`,
  `node --test tests/point-record-actors.test.js` -- the census pins **255 ported /
  6 interpreter only**, up one from 254 / 7, and `broken_port_citations` empty.
* `node --test 'tests/*.test.js' 'tests/lane-b/*.test.js'` -- 3645 tests, 0 fail.
  `npm run test:engine` -- 597 tests, 0 fail.  `npx tsc --noEmit` -- clean.
* `tools/verify_child_pool_parents.mjs`, `tools/verify_point_record_actors.mjs`,
  `tools/verify_slot_ensembles.mjs` -- all `VERDICT OK` on port 8993, each in
  ordinary play with the original machine code off.

### 18.8 What I did not do

* **`0x33e` and `0x33d` are not ported** and neither are their children; 18.5
  names the three (s460) / five (s526) child machines and their ticks.  Nothing
  about them is unread -- the parent is read to its epilogue and the child's state
  dispatch is read -- but three new child actors is a second decode, and the
  honest total for this job stays **1 of 4**.
* **`0x33b` WAS not ported** when this section was written: it moves the live
  object named 5 (18.5), which was then the gap §13.8 carried.  **§19 closes it**
  -- the object is the field character, and the member is ported as the
  `two-slot` machine.
* **The `parent` machine has no child-object lifetime.**  A child stays in its
  state 2 for ever once poked, because the original has no arm that puts one back;
  a stage that wanted to stop a pad would need the clip arms this member does not
  have.  No such stage exists in the 294 overlays the extractor scanned, so
  nothing observable is missing.

## 19. THE live field character: what `+0x54` is, and the three members that drive it (2026-10-05)

§12.6 and §13.8 both left one question open, and it is now closed: **the live
object fieldstg registers as NAME 5 is the character you are leading, and its
`+0x54` is that character's own world Y in 16.8 fixed point.** With the word read,
s926 `0x356` and s680 `0x32e` finish (they were each missing exactly one write)
and s261 `0x33b` ports whole.

### 19.1 The object, from its own allocator call

fieldstg file `0xe4bc` is the only place in the disc that builds it, and it says
who it is in four instructions:

```
.L0x0000e4e0: lui $a0, 0x8009
.L0x0000e4e4: addiu $a0, 0xfb0      # 0x80090FB0 -- the TICK
.L0x0000e4e8: li $a1, 0x15c        # a 0x15C-byte object
.L0x0000e4ec: li $a2, 0x10
.L0x0000e4f0: li $a3, 0x5          # registered as NAME 5
.L0x0000e4fc: jal F0x800143dc
```

The first allocator argument is the tick, so the runner at `0x80090FB0` (file
`0xe300`..`0xe4b8`) is this object and no other.  **It is the field character,
because two other routines look name 5 up and immediately read its position:**

* fieldstg file `0xf908`-`0xf944` (`F0x800925a8`): `li $a0, 0x5` /
  `lw $v0, -0x4844($v0)` = `[0x8004b7bc]` / `jalr`, then `lw $a3, 0x58($v0)` /
  `lw $t0, 0x5c($v0)` -- it hands the FOUND object's two pixel words straight to
  the zone checker as the player's x/y (`+0x58`/`+0x5c`, §19.2).
* fieldstg file `0x93c8` (`F0x8008c078`): the same lookup, and its caller
  documents the pair as "the character's x/y at the moment of the transition".

### 19.2 `+0x50` and `+0x54` are the world X and Y, and the pixels are `>> 8`

The constructor copies the map origin in and splits each half:

```
.L0x0000e744: addiu $v0, -0x6280    # 0x80099D80, the field's own state
.L0x0000e748: lw $t0, 0x64($v0)
.L0x0000e750: sw $t0, 0x50($s2)     # +0x50 = the X origin
.L0x0000e74c: lw $t1, 0x68($v0)
.L0x0000e754: sw $t1, 0x54($s2)     # +0x54 = the Y origin
.L0x0000e764: lw $v0, 0x50($s2)
.L0x0000e768: lw $v1, 0x54($s2)
.L0x0000e76c: sra $v0, 0x8          # X >> 8
.L0x0000e770: sra $v1, 0x8          # Y >> 8
.L0x0000e774: sw $v0, 0x58($s2)     # +0x58 = X in whole pixels
.L0x0000e77c: sw $v1, 0x5c($s2)     # +0x5c = Y in whole pixels
```

and the runner does it again every frame, with the character's jump height taken
off Y first (`exe-decomp/fieldstg_c/F0x80090fb0.c:36-37`):

```
arg0->unk58 = (s32) arg0->unk50 >> 8;
arg0->unk5C = (s32) (arg0->unk54 - arg0->unk90) >> 8;
```

so **`0x100` is one pixel** and `+0x90` is the jump height (case `0x41` raises it
`0x100` a blank to a ceiling at `+0x94`), never a fourth coordinate.  Three more
lines say the same thing from three directions:

* the shadow the runner registers every frame is built from the same two words.
  The tick's own lines name the callback as the PAIR `lui $a1, 0x8009` /
  `addiu $a1, -0xad4` = **0x8008F52C** (file `0xe434`-`0xe438`) and hand it the
  character and its `+0x5c` (`file 0xe444 lw $a3, 0x5c($s0)` with
  `move_ $a2, $s0` in the `jalr`'s delay slot), and `F0x8008f52c` (file `0xc87c`)
  reads both halves and subtracts the camera origin it asks the service for:
  `file 0xc8d0 lw $t0, 0x58($s1)` / `0xc8d4 lw $t1, 0x5c($s1)` /
  `0xc8e0 lw $v0, 0x11c($s5)`;
* every move folds a displacement into both halves: the animate routine the tick
  calls (`jal 0x8008fed0` at file `0xe3d0`) reaches the direction helper through
  `[0x8009b70c]` (`0x80092ca0`, which multiplies a scaled pair out of the table at
  `0x8009B724` by the actor's magnitude `+0x68`) and adds the returned pair to
  `+0x50` and `+0x54` at file `0xd310`-`0xd344` and `0xd3b4`-`0xd3e8`;
* case `0x44` jumps with `arg0->unk54 = arg0->unk54 + 0x1800 + arg0->unk94`
  -- `0x1800` is 24 pixels.

**What a player sees:** when a stage object writes `+0x54`, YOU move down (or up)
the map, the camera follows as far as the room allows, and the room scrolls
around you.  It is the character itself moving, not a scroll offset and not a
water level.

### 19.3 The ported module

`engine/systems/field-character.ts` owns that one word and nothing else.  The
walker's `state.y` already IS the pixel part -- it is the character's map Y, and
the camera, the sprite and every proximity test read it -- so the port carries the
**whole-pixel displacement** the three drivers produce, in 16.8, and
`web/game.js` folds the whole-pixel part into `state.y` once per frame *before* the
camera reads it.  That is the same place the original's own `+0x5c` split happens,
and it has to be there: applied after the camera, the player would bob a pixel
every frame instead of the room scrolling.  The sub-pixel remainder stays in the
module, so s680's quarter-pixel step lands on the fourth blank, exactly as the
original's `>> 8` does; the whole-pixel part is in `state.y`, which the save block
already stores, so a save during a drive loses at most 0.75 px.

### 19.4 The three members, and what each one does in play

| member | place | the write | what a player sees |
|---|---|---|---|
| s926 `0x356` (854) | Amaterasu City -- Arena Front Desk | `+0x100` a blank for 150 blanks (`wstag926` file `0x274`/`0x27c`/`0x280`) | the room's own row walks down the screen a pixel a blank for three seconds **and you walk down with it**, so the room scrolls instead of the row sliding.  Before this port the row slid down the screen on its own, which was the visible half. |
| s680 `0x32e` (814) sub 891 | Byakko City -- Storage Room | a phase halfword at `obj+0x14a` grows `0x40` a blank and is added to `+0x54`; a counter at `obj+0x144` stops it at 121 (`wstag680` file `0x434`-`0x474`) | you are pushed **down** with a growing step -- a quarter pixel, half a pixel, ... 122 blanks later a little over two pixels a frame, 1172 pixels in all: a fall, and it stays where it lands |
| s261 `0x33b` (827) | Amaterasu City -- Cargo Tower | six clips that drive `+0x54` with the same delta they give the two rows they claim | you and two rows of the room travel together 127 pixels up (840) or down (841), over a five-second blink |

The census moves to **256 ported / 5 interpreter only**; `s261`'s 827 is the only
member that changed.

### 19.5 s261 `0x33b` read end to end

The member is the `two-slot` machine in `engine/systems/point-record-actor.ts`,
and every number is mined by `tools/extract_point_record_actors.py`, which finds
the shape by its own six instruction words over **every** `wstag` image: the name-5
lookup, `[0x8004b7bc]`, and a SIX-entry clip table built at the overlay base
(`li $a0, 0x5` / `lw $v0, -0x4844($v0)` / `move_ $a2, $zr` / `sltiu $v0, $v1, 0x6`
/ `lui $v0, 0x800a` / `addiu $v0, 0x5de0`).

* **State 0 is the claim** (file `0x5c`-`0x128`): two explicit compares against
  tags 2 and 3 (`:0x9c` / `:0xa4`) and a walk that does NOT break out of a match
  (`:0x11c bnez $v0, .L0x00000094`), so each slot keeps the LAST row carrying its
  tag; the tag-2 row goes dark (`:0xe0 sb $zr, ($a1)`) and the tag-3 row lights
  (`:0x10c sb $a2, ($a1)`).  **In play the claim never runs**: `F0x80084dd0`
  constructs the object and calls its configure routine in the same call (file
  `0x21c4` then `0x21f0`), and both configure arms set state 2.  So the claim's
  127-pixel drop -- which needs the direction word already set -- is unreachable,
  and `obj+0x68`/`obj+0x6a` stay zero, which is what clip 3's restore reads.
* **State 2 is the six-clip machine** (file `0x12c`-`0x17c`), and it KEEPS the found
  character in `$a0` across the dispatch (`file 0x150 move_ $a0, $v0`), which is
  what the lead's `20596efc` correction pinned:

| clip | file | what it does |
|---|---|---|
| 0 | `0x17c` | lights the tag-2 row, zeroes the wait counter, saves all three Y words (both rows and the character's `+0x54`) and plays `lui $a0, 0x8004` / `ori $a0, 0x103c` = **0x8004103C** |
| 1 | `0x1b8` | counts blanks in `obj+0x5a` until **30** (`slti $v1, 0x1e`), then advances, zeroes the per-index cursor in the advanceClip delay slot, and plays `lui $a0, 0x108` / `ori $a0, 0x1` = **0x01080001** |
| 2 = 4 | `0x240` | walks the signed-halfword delta table at `0x800a66a0` (`file 0x8c0`) and writes **saved + delta** into both rows' Y *and* into the character's `+0x54`; the entry **1000** ends it |
| 3 | `0x2c0` | the **254-step blink**: one pixel on every OTHER index, up when the direction word is 0 and down when it is 1, then a restore -- the rows to what the CLAIM saved plus or minus 127, the character to its own clip-0 word **plus or minus 0x7f00** (127 pixels in 16.8), re-saving all three in the advanceClip delay slot |
| 5 | `0x3f8` | turns the tag-2 row off, `setState(1)` and flips the direction word |

  States 1 and 3 are the epilogue.  A clip of 6 or more takes clip 0's arm.

* **The delta table** is nine halfwords read out of the overlay: `1, 2, 1, 0,
  -1, -2, -1, 0, 1000`.  The first eight sum to **zero**, so the slide is a
  two-pixel wobble around the saved position rather than a travel.
* **The two configure arms** (file `0x438`) are 840 -> `setState(2)` and direction
  0 (`:0x480 sh $zr, 0x58($s0)`, in the `j`'s delay slot) and 841 -> `setState(2)`
  and direction 1 (`:0x498`).  Neither touches the clip, so the second command in
  a room re-enters whichever clip the run had reached -- which is how the room's own
  two events (1321 and 1326) reverse the lift half way through it.
* **What the run leaves behind:** the player's position moves 127 pixels (up on
  840, down on 841) and stays there, and the two rows end 127 pixels above their
  table position (840) or at the map's top edge (841).  That is the original's
  arithmetic, not the port's: clip 3 re-saves the restore values into the words
  clip 4 then slides from.

### 19.6 The family's census, and s934's dead copy

The scan finds the shape in **two** of the 294 overlays.  `s934` carries the same
copy of the machine -- the same six clips, and a delta table with the same nine
values at its own address `0x800a65b8` instead of `0x800a66a0`, which is why the
extractor matches the slide arm by the FORM of its `addiu` rather than by the
number.  **Nothing constructs it**: no registry member names `0x33b` on that stage
and no code in `wstag934.s` calls its builder (file `0x4ac`, `grep -c 'jal
0x800a628c'` = 0).  The extractor's own census records it in
`twoSlotCensus.copiesWithoutAMember`, with the reason, so a stage that ever does
construct it shows up as a new member instead of silently going unported.

### 19.7 What you will see

**Before** (ordinary play, no research flags): in the Cargo Tower the two rows the
member claims are simply drawn where the stage's own table put them and nothing
else happens; `SETANIM 827 840` / `841` constructs nothing, because the registry
constructor is only reached through the MIPS interpreter behind `?nativeStages`.
In the Arena Front Desk the one row slides **down the screen** for three seconds
and stops 149 pixels lower, while the player and the room stay put -- and the
player has not moved a pixel.  In the Storage Room `SETANIM 814 891` does nothing
at all: the drive is read and recorded here and not written.

**After**, in ordinary play with no `?nativeStages`:

1. **Cargo Tower** (`?skipTitle=1&map=s261`, then `SETANIM 827 840`): about half a
   second after the command the two rows light, the room holds still for thirty
   blanks, and then you and both rows rise together for five seconds while the
   room scrolls down past you.  The run ends with you 127 pixels higher up the map
   and the two rows 127 pixels above where the stage put them.
   `SETANIM 827 841` is the same thing downwards, and ends with you 127 pixels
   lower and the two rows at the top edge of the room.
2. **Arena Front Desk** (`?skipTitle=1&map=s926`, `SETANIM 854 841`): you and the
   room's glowing platform walk down the map together a pixel a frame for three
   seconds.  The platform stays beside you and the room scrolls until the camera
   reaches the room's own edge; after the bound both stop, 150 pixels lower than
   where the command found you.
3. **Storage Room** (`?skipTitle=1&map=s680`, `SETANIM 814 829` then
   `SETANIM 814 891`): the lane rows light as before, and you are pushed down with
   a growing step for 122 blanks -- a quarter of a pixel a frame to a little over
   two -- 1172 pixels in all.  Then it stops and you stay where you landed.

`tools/verify_object5_slide.mjs` drives all three in ordinary play with the
original machine code off and reads the character's own word out of the page
(`window.__fieldChar`), the player's map position and the camera.  Measured on one
run: s261 `charPixels 0 → -127` with `playerY 340 → 213`; s926 `0 → 150` with
`playerY 336 → 486` and the row within a pixel of the player throughout; s680
`0 → 1906` with the drive's own counter at 122.  Captures in
`.bunny-scratch/object5-slide/` (`s261-before.png` / `s261-after.png`,
`s926-before.png` / `s926-after.png`, `s680-before.png` / `s680-after.png`).

### 19.8 Checks

* `.venv/bin/python3 tools/extract_point_record_actors.py --check` -- 21 members
  over 294 overlays, 604 anchors verified, and the two-slot census printed with
  the one member, the one copy nothing constructs, and no refusals.
* `node --test tests/two-slot-writers.test.js` -- 18 tests: the fixed point and
  its flooring, the family census and s934's dead copy, the member's own numbers,
  the delta table, the claim and why a construct never runs it, both directions'
  whole six-clip runs, the two other drivers, and "there is one carrier for the
  word".  **Eight of the eighteen fail on the pre-port module**
  (`git show HEAD:engine/systems/point-record-actor.ts`), so they are not
  tautologies.
* `node --test tests/point-record-actors.test.js`,
  `tests/stage-registry-members.test.js`, `tests/child-pool-parents.test.js` -- the
  pins move to 21 members and 256 / 5, `broken_port_citations` empty.
* `node --test 'tests/*.test.js' 'tests/lane-b/*.test.js'` -- 0 fail.
  `npm run test:engine` -- 0 fail.  `npx tsc --noEmit` -- clean.
* `tools/verify_object5_slide.mjs`, `tools/verify_point_record_actors.mjs`,
  `tools/verify_slot_ensembles.mjs` -- all `VERDICT OK` on port 8993, each in
  ordinary play with the original machine code off.

### 19.9 What this pass did not establish, and did not do

* **s680's eleven lane rows and three traffic rows are still the ported `lanes`
  shape from §17**; only the drive is new here.  Nothing about them changed.
* **s460 `0x33e` and s526 `0x33d` are still `interpreter only`** (§18.5): three
  and five child makers whose children are four-state actors no ported module
  models.  That is the remaining shared-system gap in this system, and it is not
  this job.
* **The walker's `state.y` is a float and the original's word is 32-bit.**  The
  port keeps the 16.8 remainder in the module and the whole pixels in `state.y`, so
  the two agree to within a pixel; a stage that moved the character while the
  player was also walking would differ from the original by the walker's own
  sub-pixel accumulation, which is the walker's `FIELD_WALK_STEP` question and not
  this one's.
* **The claim's 127-pixel drop is unreachable and is ported as unreachable.**
  It is kept because the code is there and a stage that constructs the object
  without configuring it would run it; nothing in the 294 overlays does.
* **I have not run the original.**  Every statement above is read out of the
  overlay, the shared method block or the checked decompilation, and the three
  rooms' own event tables are cited for the commands; what the rooms LOOK like
  during the run is my reading of the numbers, and the captures are the walker's.

## 20. THE `triple` parents: s460 `0x33e` and s526 `0x33d`, two members, one machine (2026-10-05)

**THE SHARED SYSTEM IS §11's, with a child ARRAY and a four-state child.**
Both members are the same object the `parent` machine of §18 already models --
one claimed row of its own, a pool of child objects built through the shared
child allocator, the same method block at EXE `F0x800143dc`, the same copy of the
shared stepper per overlay -- except that the pool is **nine and twelve objects
made by three and four makers**, and every one of those children is a **four-state
row actor** with its own claim walk and, for two of the makers, its own heading
integrator.  So it is the `triple` machine in the same module, not a new module
and not a second renderer.

### 20.1 Do s460's and s526's children share one shape? Yes -- and s526's nine-times maker IS one of s460's makers

The maker's own allocator call names the child, because **the first argument to
`F0x800143dc` / `F0x80014504` is the tick**.  Read that way the family is **seven
distinct child machines over two overlays**, and each overlay's children are four
states over the same block:

| member | maker (file) | child tick | size | states | claims | what it is |
|---|---|---|---|---|---|---|
| s460 | `0x578` | `0x800a6118` | `0x5c` | 0/1/2/3 | tag **10** | single row, two scripts |
| s460 | `0x9d8` | `0x800a64a4` | `0x64` | 0/1/2/3 | tags **8** and **9** | twin rows, two scripts each |
| s460 | `0x1174` | `0x800a6c2c` | `0x80` | 0/1/2/3 | the tag stamped at its own `+0x52` | **the walker** |
| s526 | `0x5d0` | `0x800a6178` | `0x5c` | 0/1/2/3 | tag **21** | single row, two scripts |
| s526 | `0x9e0` | `0x800a64fc` | `0x64` | 0/1/2/3 | tags **19** and **20** | twin rows |
| s526 | `0xd60` | `0x800a693c` | `0x5c` | 0/1/2/3 | tag **22** | single row, one FIXED picture |
| s526 | `0x15b8` | `0x800a6fb4` | `0x88` | 0/1/2/3 | the stamped tag **and the stamped tag + 9** | the walker, again |

**The two walkers are the same machine.**  s460's `0xe4c` and s526's `0x11d4` have
the same dispatch, the same claim, the same two scripts, the same countdown and
the same integrator, down to the field offsets (`+0x70` counter, `+0x72` period,
`+0x74` speed, `+0x76` heading, `+0x64`/`+0x68` in 16.8, `+0x6c`/`+0x6e` in whole
pixels), the same radius **30** (`li $a1, 0x1e`), the same `andi 0xfff` mask, the
same `(rand & 0xf) - 7` jitter and the same `F0x8002abcc` / `F0x8002ac9c` pair.
s526's copy differs in three places and they are all its own state-0 setup: it
reads `+0x7e` and `+0x86` out of an indirect table rather than a literal, and it
claims a **second** row, the one whose tag is **nine** higher, parking it at its
own `+0x80` (`addiu $v0, 0x9` against the stamped byte, `wstag526` file `0x12d0`).
**Its object is `0x88` bytes against s460's `0x80`**, which is that second row's
parking word.

**s526's nine-times maker therefore matches an s460 maker**: it is s460's
`0x1174` maker shape -- allocate, then `sw $a0, 0x54` / `sb $a1, 0x53` /
`sb $a2, 0x52` on the child -- and it builds the same walker.  The difference is
the tick and the object size, and s460's seven calls all carry kind 0 where
s526's nine carry kinds 0,5,0,5,0,0,2,5,3.

### 20.2 The parent, read end to end

**The parent IS its child array.**  The allocator's third argument is the entry
count of a companion array it allocates beside the object and points at from
`+0x24` (`F0x800143dc`: `+0x20` = `count >> 2`, `+0x24` = the base), and the two
constructors are the only two instructions that name it: `li $a2, 0x24` on s460
(file `0x204`, **36** entries) and `li $a2, 0x30` on s526 (file `0x264`, **48**).
The runner's second argument is that base, which is why its stores are
`sw $v0, ($s0)` / `sw $v0, 4($s0)` / ... and its loads in state 2 are the same
addresses read back.

**State 0 builds, state 2 pokes, states 1 and 3 are the epilogue.**  s460 file
`0x40`-`0xec` calls `0x800a6358` (the `0x578` maker), `0x800a67b8` (the `0x9d8`
maker) and then `0x800a6f54` (the `0x1174` maker) **seven times**, storing each
pointer in the call's own DELAY SLOT (`sw $v0, ($s0)` at `0x4c`,
`sw $v0, 4($s0)` at `0x50` ... `sw $v0, 0x20($s0)` at `0xd8` and again at `0xdc`,
so the seventh child is parked in two slots).  Nine children, ten stores.  State 2
(`0xf8`-`0x198`) calls each child's own configure routine in the same order --
`jal 0x800a630c` then `jal 0x800a676c` then `jal 0x800a6f08` seven times -- and
then `[+0x28](1)` in the `jalr`'s delay slot, which is `setState(1)`.

s526 is the same shape over its own tables: **three** bare makers (`0x63b0`,
`0x67f0`, `0x6b40`) and then `0x800a7398` **nine** times with `$a0` 1..9, `$a1`
0,0,1,1,1,2,2,3,3 and `$a2` 0,5,0,5,0,0,2,5,3.  Twelve children, thirteen
stores -- the last pointer is written twice (`sw $v0, 0x28($s0)` at `0x108` and
`sw $v0, 0x2c($s0)` at `0x10c`).

**Each parent's own draw handler answers ONE sub id and it is `setState(2)`:**
`li $v0, 0x34c` / `bne $a1, $v0` / `lw $v0, 0x28($a0)` / `jalr $v0` with
`li $a1, 0x2` in the delay slot (`wstag460` file `0x1bc`-`0x1d4`), and the same
with `li $v0, 0x34b` on s526 (file `0x21c`-`0x234`).  The census's own event table
has one line each: s460 event 370 sends `844 2`, s526 event 760 sends `843 2`.

### 20.3 The child machine, read end to end

Every child dispatches on `obj+0x0c` over **four** states, and the method block is
the one EXE `F0x800143dc` installs: `+0x28` setState (which zeroes `+0x10`,
`+0x14` and `+0x18`), `+0x2c` setClip, `+0x38` advanceState (`state + 1`, and the
three sub-slots clear with it).

* **State 0 is the claim** (`wstag460` file `0x37c`-`0x3f8`).  It parks the
  selector at `+0x50` with its own literal, clears `+0x58`, seeds `+0x5a` out of
  its first script's first frame hold (`lhu $v1, 0x2($v0)` / `sh $v1, 0x5a`), then
  walks the field's own display chain -- `lw $a0, -0x6270($v0)` = `[0x80099d90]`,
  the byte before `+2` is the tag, the stride is `0x12` -- comparing against the
  tag its maker stamped, and parks the row it stops at in its own `+0x54` (or
  `+0x5c` for a twin's second row).  It leaves through `[+0x38]`.
* **State 1 runs the FIRST script** (`0x3fc`-`0x478`).  The call site passes
  `move_ $a2, $zr`, so the stepper **restarts** on the `0x00ff` marker.  It lights
  every row it claimed while its selector is non-zero and writes `0` when the
  selector is zero, then runs the **shared tail**: `lh $vX, 0x50($s1)` against the
  value its own configure parked, and a halfword at `+0x52` counts down until it
  reaches zero, when the arm calls `setState(2)` and clears the selector in that
  call's DELAY SLOT.
* **State 2 runs the SECOND script** (`0x47c`-`0x510`).  `li $a2, 0x1`, so it
  **stops** on the marker; the marker's own arm darkens the row, calls
  `setState(1)` and clears the selector.  Its `obj+0x10` is the sub-slot the
  method block zeroes on every state change, so the arm's one-time setup -- the
  two holds re-seeded out of the second scripts -- runs on the first blank of the
  state only.
* **State 3 is the epilogue.**

### 20.4 Three facts the walker's port has to carry

**A delay slot ALWAYS runs, and it runs BEFORE a call returns.**  Two arms store
into the record's picture byte in the stepper call's own delay slot, where `$v0`
still holds the literal the call site loaded -- `li $v0, 0x3c` / `jal` /
`sb $v0, 4($s0)` (`wstag460` file `0x41c`-`0x428`) -- so that row's picture is the
**constant 60** and the record's palette byte at `+9`, stored two instructions
later, is the step value.  The same code in state 2 parks **61** (`li $v0, 0x3d`).
On s526's copy the two are **2** and, on the fixed-picture machine, **33**
(`li $v0, 0x21`).  Reading the delay slot as the call's return is how a bunny gets
all four wrong.

**The twin reads its clip out of a byte table by its row index.**  `wstag460`
file `0x7fc`-`0x818` does `lw $a1, ($s5)` for the script and
`addu $v0, $s1, $s6` / `lbu $v0, ($v0)` for the picture, over the four bytes at
`0x800a73d8` = **62, 63, 64, 65**; state 1 takes the first pair and state 2 the
second (`lbu $v0, 0x2($v0)`).  s526's twin instead takes the step value and
parks `0` in the palette byte.

**The walkers RE-CLAIM instead of running a second script.**  Their configure
routine writes the countdown into a **word** at `+0x58` (`sw $v0, 0x58($a0)`,
`li $v0, 0x3c`), and when it runs out the arm **jumps back to state 0** --
`j 0x800a6ef0` is file `0xef0`, the top of the claim -- with
`sh $v0, 0x50($s0)` (selector 3) in the DELAY SLOT (`0x1050`-`0x105c`, and
`0x1450`-`0x145c` on s526).  The claim's own `sh 1, 0x50` then puts the selector
back, **which is why the copies' `selector == 3` arm -- the one that bleeds the
speed by four a blank until it reads under 17, `0xffc`-`0x102c` -- never runs**.
It is dead code in the shipped build and the port does not invent a way in.

### 20.5 s460's fourth child claims nothing, and that is the original

s460's seven stamped slots are 1..7 and its own table carries tags
1,2,3,5,6,7,8,9,10 -- **no row is tagged 4**.  That child's claim walk finds
nothing, so its `+0x78` keeps whatever the allocator left and its arm writes
through it.  The port records the claim as `index: null` and the child writes
nothing, which is the only answer that cannot be wrong about memory the disc never
wrote.  s526 has no such gap: its nine stamped slots claim tags 1..9 and their
nine `+9` partners claim 10..18, and all eighteen rows exist.

### 20.6 What changed in the shared module

> **2026-10-05 (the gate pass).** One more thing changed here and nothing else
> did: the pool is no longer built by `createPointActor` but by the parent's own
> state-0 arm, and the module carries the members' `stageLoadGate` so the stage
> load can build them below their bound. See §20.7.2.

No new file, no second hook, no second table for the runtime.
`web/assets/data/child_pool_parents.json` -- already loaded beside the other
point-record tables -- carries the two members with `machine: "triple"`, so a
stage that names 830 or 829 does not know which table carried it.

| addition | what it is |
|---|---|
| `machine: "triple"` + `PointTriple` / `PointTripleMachine` / `PointTripleArm` / `PointTripleWalk` / `PointTripleChild` | the pool, one machine per maker, one slot per maker call |
| `PointActor.pool` / `TripleChildState` | the live children and their own object words |
| `fireTriple` / `tickTriple` / `tickTripleChild` / `claimTripleChild` / `stepTripleArm` | the parent's poke and the child's four states |
| `walkTripleChild` | the integrator's counter, period gate, Manhattan test and position words |
| `fireChildPoolParent` | now takes the `triple` machine as well as `parent` |

`tools/extract_child_pool_parents.py` is the same extractor with the `triple`
shape added.  It finds the shape by its own code over all 294 overlays, returns
**three** parents, and **refuses** the thirteen builders whose three fields are
parked in a third order it cannot name -- s310's and s311's ensembles, which are a
different family already ported in `engine/systems/stage-slot-ensemble.ts`.  The
refusal is in the table's own summary, so it is evidence rather than a silent gap.

Three fixes in the extractor were needed to read the children's arms at all, and
each is a rule worth keeping: **`move_` copies have to be tracked** (an arm keeps
the stepper's return in a second register for the palette byte);
**the stepper's return only becomes visible two instructions after the `jal`**, so
a store in the delay slot sees the pre-call register; and the active byte's show
value is **the one literal `1`** among the three paths, because the two hide arms
store a register zero.

### 20.7 The ORDER NOTE, settled (2026-10-05)

**What `[0x8004b7bc]` searches, read to the end.** It is a function pointer, and
the exe holds the routine it points at:

```
.L0x8001810c: addiu $sp, -0x18
.L0x80018110: la_ $v0, D0x8004b610          ; the 100-slot resident array
.L0x80018118: sw $ra, 0x10($sp)
.L0x8001811c: sw $a0, 0x190($v0)            ; the wanted TYPE
.L0x80018120: sw $a1, 0x194($v0)            ; the wanted ID
.L0x80018124: sw $a2, 0x198($v0)            ; the wanted SUB
.L0x80018128: jal F0x8001804c
.L0x8001812c: sw $zr, 0x19c($v0)            ; the cursor starts at slot 0
.L0x80018130: lw $ra, 0x10($sp)
```

and `F0x8001804c` (`exe/fns.s:8783`) is the linear scan:

```
.L0x8001804c: lui $v0, %hi(D0x8004b610)
.L0x80018054: lw $a1, 0x19c($v1)            ; the cursor, in words
.L0x8001805c: slti $v0, $a1, 0x64           ; 0x64 = 100 slots
.L0x80018060: beqz $v0, .L0x80018104
.L0x80018064: li $t0, -0x1
.L0x8001806c: sll $v0, $a1, 0x2
.L0x80018070: addu $a2, $v0, $a3            ; the i-th slot
.L0x80018074: lw $a0, ($a2)                 ; the object in it
.L0x8001807c: beqz $a0, .L0x800180f4
.L0x80018084: lw $v1, 0x190($a3)            ; wanted type
.L0x8001808c: beq $v1, $t0, .L0x800180a4    ; -1 means ANY
.L0x80018094: lw $v0, ($a0)                 ; obj+0x00
.L0x8001809c: bne $v0, $v1, .L0x800180f4
.L0x800180a4: lw $v1, 0x194($a3)            ; wanted id
.L0x800180ac: beq $v1, $t0, .L0x800180c4
.L0x800180b4: lw $v0, 0x4($a0)              ; obj+0x04
.L0x800180bc: bne $v0, $v1, .L0x800180f4
.L0x800180c4: lw $v1, 0x198($a3)            ; wanted sub
.L0x800180cc: beq $v1, $t0, .L0x800180e4
.L0x800180d4: lw $v0, 0x8($a0)              ; obj+0x08
.L0x800180dc: bne $v0, $v1, .L0x800180f4
.L0x800180e4: sw $v0, 0x19c($a3)            ; the cursor ADVANCES past a match
.L0x800180e8: lw $v0, ($a2)
.L0x800180ec: jr $ra
```

So the three arguments ARE the identity, matched against the object's own first
three words, and `-1` in any slot means "whatever it is". **And the object's
first word IS the registry id**: `F0x800143dc` (`exe/fns.s:4865`, decompiled at
`exe-decomp/c/F0x800143dc.c:36-39`) ends with

```
    if (arg3 != 0) {
        temp_s0->unk0 = arg3;
        D0x8004b7b4(temp_s0);
    }
```

— `arg3` is the id the builder passed in `$a3`, `unk0` is `obj+0x00`, and
`D0x8004b7b4` is the REGISTER half of the same pair, which is what puts the
object in the 100-slot array. **So the SETANIM handler's `[0x8004b7bc](id, -1,
-1)` does find a stage-created instance, by the id its own builder stamped into
it.** (The `-0x4844` in the handler's `lw` is not a low half: `lui $v0, 0x8005`
plus `lw $v0, -0x4844($v0)` is the whole address 0x8004b7bc.)

**The whole handler, read end to end** (`fieldstg` file `0x2120` =
`F0x80084dd0`, decompiled at `exe-decomp/fieldstg_c/F0x80084dd0.c`):

```
s32 F0x80084dd0(void *arg1, void *arg2) {
    s16 id  = arg1->unk2;      // file 0x213c  lh $s2, 0x2($a1)
    s16 sub = arg1->unk4;      // file 0x2140  lh $s3, 0x4($a1)
    s16 arg = arg1->unk6;      // file 0x2144  lh $s4, 0x6($a1)
    s32 *p  = arg2;            // file 0x2150  move_ $s0, $a2 (a DELAY SLOT)
    if (id < 0x320) { ... } else {
        obj = [0x8004b7bc](id, -1, -1);            // file 0x2180-0x2198
        if (obj == 0) {                            // file 0x21a0  bnez $s1
            for (k = 0; k < 10; k++) {             // file 0x21a8-0x21d8
                if (p[4] == 0) {                   // file 0x21ac  lw $v0, 0x10($s0)
                    obj = record->ctor(id);        // file 0x21bc  jal 0x80092484
                    p[4] = obj;                    // file 0x21c8  sw (delay slot)
                    break;
                }
                p += 1;                            // file 0x21dc  addiu $s0, 0x4
            }
        }
        if (obj != 0) record->draw(obj, sub, arg); // file 0x21f0  jal 0x800924c8
    }
    return 4;
}
```

Three things in that are new since this section was first written. The
`beqz $s1` at 0x21e0 and the `beqz $v0` at 0x21c4 mean **nothing is configured
unless an object exists**; the ten slots are a **ten-handle pool** at
`arg2+0x10` (the pointer advances by 4 while the field stays at `+0x10`, so it
is ten consecutive words, not ten structs); and `record->ctor` /
`record->draw` are the registry record's `+4` and `+8`, with
`F0x8009243c` (file 0xf78c) matching the record's **`+0` word against the id**
and walking in twelves until a record whose `+0` is zero.

**The registry constructor for both members does NOT set a state.** s460 file
`0x1e8` (`0x800a5fc8`) is four instructions of allocator:

```
.L0x000001ec: move_ $a3, $a0                  ; the id into the allocator's 4th arg
.L0x000001f0: lui $a0, 0x800a
.L0x000001f4: addiu $a0, 0x5de0               ; the parent's own tick, file 0
.L0x000001f8: li $a1, 0x50                    ; 80 bytes
.L0x00000204: li $a2, 0x24                    ; 36 array entries
.L0x00000200: jal F0x800143dc
```

(s526's is file `0x248`, the same with `0x30` = 48 entries.) `F0x800143dc`
stores the tick at `obj+0x48`, the array at `obj+0x24`, and calls no state
method. **And the draw handler's whole body is one guarded arm** (s460 file
`0x1b0`):

```
.L0x000001b4: beqz $a0, .L0x000001d8
.L0x000001bc: li $v0, 0x34c
.L0x000001c0: bne $a1, $v0, .L0x000001d8
.L0x000001c8: lw $v0, 0x28($a0)
.L0x000001d0: jalr $v0
.L0x000001d4: li $a1, 0x2                     ; setState(2), in the DELAY SLOT
```

**So an event-created parent arrives with no state of its own and is put
straight into state 2.** Its first tick is state 2, and state 2's nine (s460) /
twelve (s526) child-configure calls each begin `beqz $a0, .L0x00000540`
(s460 file `0x52c`) and return at once on the NULL pointer, before the parent's
own `setState(1)`.

### 20.7.1 The stage-load gate, and what I could NOT establish about it

Each stage DOES contain an ordinal-gated creation of its own parent, and it is
real code:

```
wstag460 file 0x1208-0x1228          wstag526 file 0x164c-0x166c
  lui   $v0, 0x8005                    lui   $v0, 0x8005
  lw    $v0, -0x4c90($v0)   ; 0x8004b370   lw    $v0, -0x4c90($v0)   ; 0x8004b370
  slti  $v0, 0xf          ; below 15    slti  $v0, 0x1e          ; below 30
  beqz  $v0, .L0x122c     ; skip        beqz  $v0, .L0x1670     ; skip
  jal   0x800a5fc8        ; the ctor    jal   0x800a6028        ; the ctor
  li    $a0, 0x33e        ; DELAY SLOT  li    $a0, 0x33d        ; DELAY SLOT
  sw    $v0, ($s0)        ; DELAY SLOT  sw    $v0, ($s0)        ; DELAY SLOT
```

`slti $v0, 0xf` is the **short form** of `slti $v0, $v0, 0xf`; the `.s` text is
not swapped. The gate sits in a one-shot object — `0x800A6FAC` on s460,
`0x800A73F0` on s526 — whose first tick calls its own `+0x38` (advanceState, so
it runs exactly once) and only then reads the ordinal. The parent is stored
into the poller's *second* argument, `$s0 = $a1` in the `beqz`'s delay slot.

**The bound and the event's own completion are the same number.** s460 event
370's `on_complete_fn` is `0x800A7078` (file `0x1298`), which is
`li $v0, 0xf` / `sw $v0, -0x4c90($v1)` — it sets `[0x8004b370] = 15`.
s526 event 760's is `0x800A74BC` (file `0x16dc`), `li $v0, 0x1e` /
`sw $v0, -0x4c90($v1)` — it sets it to **30**. So each stage closes its own
scene by walking its own parent gate shut, and the event that carries the
`SETANIM` is the same event.

**What I could not establish: whether the poller ever runs.** Its only factory
is `0x800A701C` (s460 file `0x123c`) and `0x800A7460` (s526 file `0x1680`), and
neither address is named anywhere inside its own overlay — not by a `jal`, not
by a `lui`+`addiu` pair, not by a data word. One global table does name them: a
**222-record table at RAM `0x8009A958`** (`fieldstg` file `0x17ca8`), records of
twelve bytes `{factory, id, param}`, where the s460 factory is record `id 567`
(`0x237`, file `0x17e64`) and s526's is `id 687` (`0x2af`, file `0x18404`).
**I have not established that any instruction walks that table.** An exhaustive
scan of every `lui`+`addiu`/`ori` pair and every load/store offset in all 294
`wstag` overlays and `exe/fns.s` forms exactly two addresses in
`[0x8009A958, 0x8009B3C0]`, and both are the registry one step further on
(`0x8009B3C4` and `0x8009B3E8`); nothing forms an address inside the spawn
table. A zero from that search is not an absence, so this is stated as open:
**the gate's reachability is unproven in both directions.** What IS settled is
that the SETANIM path does not consult the ordinal at all — neither
`F0x80092484` nor `F0x800924c8` reads it — so the event behaves identically on
both sides.

### 20.7.2 Both orders, and the port

| | below the gate | at or above the gate |
|---|---|---|
| who builds the parent | the stage's own one-shot object, at load | the SETANIM event, through the registry ctor |
| the parent's first tick | state 0: **build the pool**, then state 1 | state 2: every child-configure returns on a NULL child, then state 1 |
| what the event's `setState(2)` finds | a BUILT parent; nine/twelve children get their countdown | an UNBUILT parent; the pool stays empty for life |
| what a player sees | the rows light up and the walkers move | **nothing at all** — the rows stay as the stage's own point table placed them |

Both sides are in the one code path, through the existing stage-object module
(`engine/systems/point-record-actor.ts`, the `triple` machine):

* the pool build moved OUT of `createPointActor` and INTO the parent's own
  state-0 arm (`buildTriplePool`, called from `tickTriple`), so a parent that
  never sees state 0 has no pool — exactly as on the disc;
* `constructPointRecordActors(stageId, ordinal)` now also builds the gated
  members, and only while `ordinal < gate.below`. The bound, the ordinal's
  address, the poller's tick and factory and its spawn-table row are all read
  out of the overlay by `tools/extract_child_pool_parents.py`, which refuses a
  `triple` member it cannot find a gate for rather than defaulting to one;
* `fireChildPoolParent` is unchanged in shape and now hands over an unbuilt
  parent when nothing existed, which is the event's own answer.

`web/effects.js` reads the ordinal through one new setter
(`setPointRecordOrdinal`), wired in `web/game.js` beside the existing
`setStageObjectOrdinal` from the same `state.progressOrdinal` — one source, two
hand-overs, because `effects.js` and `stage-objects.js` import each other.

### 20.8 What you will see

**Below the gate** (a fresh game, or any save whose story step is under 15 when
you walk into the Arena): exactly what §20.8 of the previous revision described.
One second after `SETANIM 830 844`, **nine children come up at once**; one row
lights on **picture 60**, a **pair** on **62 and 63**, and **six of the seven
walkers** light on **13 and 14** and start walking. s526 (`?skipTitle=1&map=s526`,
`SETANIM 829 843`) gives **twelve children**, including a row that holds
**picture 33** and **nine walkers** that each light two rows.

**At or above the gate** (walk into either room again after its scene has run —
the story step is then 15 or 30 and only goes up): **nothing happens.** The
rows these members claim are drawn where the stage's own table put them, the
command is consumed, and no child ever appears. That is the original's
behaviour, and the previous revision's "nine children come up" was the port
building a pool the disc never builds on this side of the gate.

`tools/verify_triple_parents.mjs` drives both rooms in ordinary play, in each
direction, and reads the children's own words out of the page
(`window.__pointRecordActors`), reporting the built flag, the pool length and
which rows changed. Captures: `.bunny-scratch/triple-parents/s460-before.png` /
`s460-after.png`, the same pair for s526, and the above-gate pair.

### 20.9 Checks

* `tools/extract_child_pool_parents.py --check` -- 3 members over 294 overlays,
  2 `triple` + 1 `pads`, the 13 refused builders named, and both gates decoded
  from the overlays' own code.
* `node --test tests/triple-parents.test.js` -- 25 tests: the member list, the
  two objects and their companion arrays, the two configure subs, the seven
  child machines and the one shape they share, the stamped arguments and the
  missing tag 4, both countdowns, both byte tables and speed tables, the whole
  run of each of the three shapes, **and both sides of both ordinal gates**.
  **The old table fails 12 of them**: `git show
  HEAD:web/assets/data/child_pool_parents.json` has no `stageLoadGate` key at
  all, and `git show HEAD:engine/systems/point-record-actor.ts` builds the pool
  inside `createPointActor`.
* `node --test tests/child-pool-parents.test.js`,
  `tests/stage-registry-members.test.js`, `tests/point-record-actors.test.js`,
  `tests/two-slot-writers.test.js` -- the census pins stay at **260 ported / 1
  interpreter only** and `broken_port_citations` is empty (this pass's count was
  258/3; 807 and the ride walker ported after it -- see §21).
* `node --test 'tests/*.test.js' 'tests/lane-b/*.test.js'` -- 3797 tests, 0 fail.
  `npm run test:engine` -- 597 tests, 0 fail. `npx tsc --noEmit` -- clean.
* `tools/verify_triple_parents.mjs`, `tools/verify_child_pool_parents.mjs`,
  `tools/verify_point_record_actors.mjs`, `tools/verify_object5_slide.mjs` --
  all `VERDICT OK` on port 8993, each in ordinary play with the original machine
  code off.

### 20.10 What this pass did not establish, and did not do

* **The stage-load gate's reachability is open** (§20.7.1). The poller's only
  factory is named by a 222-record spawn table in FIELDSTG's image and by
  nothing else I can find, and I could not find an instruction that walks that
  table. The port therefore implements BOTH orders and lets the ordinal choose,
  which is correct whichever way the disc's loader goes; it does NOT claim the
  below-gate order is the one a player meets.
* **The walkers' HEADING is not the original's** (§20.10 of the previous
  revision, unchanged). The integrator aims by reading the game's single random
  stream `[0x8004DC0C]`; the walker's is `Math.random()`, so no port could
  reproduce the path frame for frame. The integrator's counter, period gate,
  Manhattan test, `sin`/`cos` step and row write are the original's.
* **I have not run the original.** Every statement above is read out of the two
  overlays, `fieldstg`, the shared method block (`exe/fns.s:0x80014274`-
  `0x800143dc`), the checked registry (`fieldstg` file `0x18738`) and the
  shipped table, and the captures are the walker's.
* **s680's lane rows and the two display-slot ensembles are unchanged.**

## 21. The last three interpreter-only members, read (2026-10-05)

At this pass the census was **258 ported / 3 interpreter only**, and these three
were the remainder (section 8 and `tests/stage-registry-members.test.js`). All
three were read end to end this pass.  **Two of the three have since been
ported** -- 807 as the `picture-steps` machine (commit 17e2a642, 2026-10-05) and
415 `0x32b` as the ride walker (commit c9c9e724, 2026-10-05) -- so the census is
now **260 ported / 1 interpreter only**, and the one member left is **s415
`0x32c`**, the scrolling layer (see §21.3).  The per-member notes below are kept
as the reads they were.

### 21.1 s785 `0x327` — the Online Center's scripted pictures (PORTED 2026-10-05)

Tick `0x800A62B4` (`wstag785` file `0x4d4`, an 88-byte object), draw handler
`0x800A6540` (file `0x760`), registry ctor `0x800A6510` (file `0x730`, tick
`0x800A62B4`). The census's own event list gives its three subs: **808, 809,
810**.

The tick dispatches on `obj+0x0c` over four states (file `0x4e8` `lw $v1,
0xc($s1)`; state 0 at `0x510`, state 1 at `0x528`, state 2 at `0x678`, state 3
at `0x71c`). State 0 is one call to its own `+0x38` and then `j 0x800a64fc`.
**State 1 is the whole shape**, and it dispatches again on `obj+0x10` over four
sub-slots, three of which are the same six instructions with a different
literal:

```
.L0x00000540: li $s0, 0x32          ; sub 0   picture 50
.L0x000005a0: li $s0, 0x33          ; sub 1   picture 51
.L0x000005e0: li $s0, 0x34          ; sub 2   picture 52
.L0x00000554: lw $v0, -0x2064($v0)  ; [0x8004df9c], the frame delta
.L0x0000055c: jalr $v0
.L0x00000564: lw $v1, 0x14($s1)     ; obj+0x14, the blank counter
.L0x0000056c: addu $v1, $v0
.L0x00000570: sw $v1, 0x14($s1)
.L0x00000574: slti $v1, 0x4         ; short form: (obj+0x14) < 4
.L0x00000578: bnez $v1, .L0x00000714
.L0x00000580: lw $v0, 0x3c($s1)
.L0x00000588: jalr $v0              ; advanceSub1, so the sub-slot advances
```

and the fourth sub-slot alternates instead of stepping:

```
.L0x00000640: lui $v0, 0x8005
.L0x00000644: lw $v1, 0x14($s1)
.L0x00000648: lw $v0, -0x2064($v0)  ; the frame delta
.L0x0000064c: sra $v1, 0x3           ; the counter >> 3
.L0x00000650: andi $v1, 0x1
.L0x00000658: addiu $s0, $v1, 0x38   ; picture 56 or 57
```

**So a player sees the Online Center's scripted pictures**: a picture that
steps 50 -> 51 -> 52 every four blanks, then the "armed" picture the scene's own
word selects (`SETANIM 807 808 12`), drawn above the character the script names
(npc 12) at that character's world pixels minus `0x18`.  It claims no point
record at all: it is a counter-and-compare machine rather than the
`point-record` row's script table.

**Ported 2026-10-05** as the `picture-steps` machine of
`engine/systems/point-record-actor.ts` (commit 17e2a642; claim
`online-center-scripted-pictures-play-again-2026-10-05`), with its data in
`web/assets/data/point_record_actors.json` and its browser verifier
`tools/verify_point_record_actors.mjs`.  **The name "lamp" is not used for 807
anywhere in the source**; this repository's lamp is the separate s780
street-lights system (`engine/dw3/street-light-tables.ts`), and 807 is the
Online Center's *scripted-picture* player.

### 21.2 s415 `0x32b` — a walker that moves a 16.8 position across the map (PORTED 2026-10-05)

Tick `0x800A6558` (`wstag415` file `0x778`, a 120-byte object), draw handler
`0x800A698C` (file `0xbac`), registry ctor `0x800A6A98` (file `0xcb8`, tick
`0x800A6558`). Its event list gives five subs: **816, 817, 818, 819, 820**; the
draw handler answers 817 (`li $v0, 0x331`) and 818 (`li $v0, 0x332`, file
`0xbc0`/`0xbd0`).

Four states again (`lw $v1, 0xc($s0)` at file `0x788`; state 1 at `0x874`, state
2 and above past `0xb9c`). **State 0 is the setup, and it is a position and a
heading**:

```
.L0x000007a8: lw $v0, 0x4($s0)      ; obj+0x04, the target/companion handle
.L0x000007b0: bnez $v0, .L0x000007f4
.L0x000007b4: lui $v1, 0x1
.L0x000007b8: li $v0, 0x9600        ; 0x9600 = 150 px in 16.8
.L0x000007bc: sw $v0, 0x60($s0)
.L0x000007c0: li $v0, 0xe600        ; 0xe600 as signed 16.8 = -26 px
.L0x000007c4: sw $v0, 0x64($s0)
.L0x000007c8: sh $zr, 0x72($s0)
.L0x000007cc: sw $zr, 0x6c($s0)
.L0x000007d0: sw $zr, 0x68($s0)
.L0x000007d8: sh $zr, 0x70($s0)
```

**So a player sees whatever `obj+0x04` names start moving from 150, -26 and
travel**, on the same 16.8 integrator the `triple` children run — `+0x70`
counter, `+0x72` period, `+0x64`/`+0x68` position, `+0x6c`/`+0x6e` whole pixels
— which §20.4 read for the children.

**Ported 2026-10-05** (commit c9c9e724; claim
`ride-walker-script-ported-as-a-shared-machine-2026-10-05`): the deeper crevice's
Bulbmon drops onto its rail with a bounce and a thud and rolls in through the
ride's three sequences, as a shared ride-walker machine in
`engine/systems/point-record-actor.ts`.  Its integrator and its claim are the
`triple` children's; they live in a DIFFERENT overlay with its own tables, its
own speed table and its own heading routine, so this is a second `walk`-family
machine in the same module, read out of `wstag415`.

### 21.3 s415 `0x32c` — NOT a point-record actor: a screen/geometry object

Tick `0x800A6C8C` (`wstag415` file `0xeac`, 96 bytes), draw handler `0x800A6E88`
(file `0x10a8`). **Its registry record has a NULL constructor** (the thirteen
null-ctor records of section 4), so the census takes its tick from the stage's
own allocator call instead. Its only draw arm is `li $v0, 0x336` /
`[+0x2c](self, 1)` — one sub, 822.

And the tick is not a display actor at all:

```
.L0x00000eac: addiu $sp, -0x58       ; a 0x58 frame, where the other two use 0x18-0x20
.L0x00000ee0: jal F0x8001ffa8
.L0x00000ee4: addiu $a0, sp, 0x10    ; a vector on the stack
.L0x00000ee8: li $a0, 0x280          ; 640 -- the PAL frame's width
.L0x00000f08: jalr $v0
.L0x00000f0c: li $a1, 0xf0           ; 240 -- and its height
.L0x00000f10: lui $s0, 0x8004
.L0x00000f14: addiu $s0, 0x4b38
.L0x00000f18: lw $v0, 0x414($s0)     ; [0x8004b84c]
.L0x00000f20: jalr $v0
```

**So this is a screen-geometry object: it builds a vector with the resident 2-D
helper and calls three resident routines with the frame's 640x240.** It is not
a member of the point-record system, so "port it through the module whose shape
it matches" has no answer inside `point-record-actor.ts` — the module it
matches is the screen/geometry one, which is a different system and a different
job.

**Ported 2026-10-09.** The system it belongs to is the stage's own scenery
layer, and it is now ported: `engine/systems/point-record-actor.ts` carries a
`scroll-layer` machine (its own `web/assets/data/scroll_layers.json` table, cut
from the stage's `S415BG01` background pack by `tools/extract_scroll_layers.py`),
gated on story flag `0x4018`, proven by `tools/verify_scroll_layer.mjs` (VERDICT
OK, 14/14) and `tests/scroll-layer.test.js` (9 pass). It is deliberately NOT
folded into the point-record claim machinery: the machine shares the module's
registry and tick loop but claims no point record. Commit `842bf003`.

#### 21.3.1 The scenery layer's geometry, read 2026-10-09

The tick quoted above is only this object's **static band** (states other than 1,
`wstag415.s:0xec0`): it binds the 640x240 draw frame and blits the stage's own
textures `0x769`/`0x76A`. The branch that scrolls the scenery is `state == 1`
(`beq`, `wstag415.s:0xec8` -> file `0xfb8`), and its draw is a separate routine
`0x800a6b04` (file `0xd24`). Its spawner `0x800a6ec0` (file `0x10e0`) allocates
it through the resident factory `F0x800143dc` — size `0x60`, id `0x32c`, tick
`0x800a6c8c` — which is exactly why its registry record has a NULL constructor:
**s415 builds this object itself** (the section-4 "the record has no constructor,
the stage builds it" case).

The tile-to-screen mapping (`0x800a6b04`), exactly:

```
x = obj+0x50 >> 8                       # pixels, 8.8 fixed point
y = (obj+0x54 >> 8) + 0x100             # vertical bias 256 px
draw sheet A (packed 0x075E0002) at (x,        y)
draw sheet A                    at (x-0x200,  y+0x100)
draw sheet B (packed 0x075E0004) at (x+0x100, y)
draw sheet B                    at (x-0x100,  y+0x100)
```

Each sheet is redrawn one tile period to the left and a half-period down, so the
pair wraps as it moves; the period is `0x200` px in x and `0x100` px in y. The
two sheets are the same art in two CLUT rows (`page,clut` = `(0x280,0x000)` for A
and `(0x280,0x100)` for B). The draw goes through the **shared shape emitter**
`F0x8001ed6c(shapeSet, id, x, y)` — the same call the ported rockfall uses
(`engine/systems/draw-context.ts`, `shape-annotator.ts`) — so it is not a
per-stage draw.

The scroll (`0x800a6c8c`, `state == 1`):

* x speed `obj+0x58 = 0x800` (8 px/tick), y speed `obj+0x5C = 0x400` (4 px/tick);
  each tick x decays `0x10` and y is set to `x>>1`, clamped at 0 — so the picture
  slides **right and up**, fast then easing to a stop by ~128 ticks (~2.5 s);
* packed sound `0x340003` plays on the first decelerating tick;
* `obj+0x50 += obj+0x58`, `obj+0x54 -= obj+0x5C`, then
  `if obj+0x50 > 0x1FFFF { obj+0x50 -= 0x20000; obj+0x54 += 0x10000 }`;
* both accumulators start at **0** — the factory allocates through the zero-fill
  `F0x80017cb0` (`fns.s` L8506; the shared `zeroFill` parity test) — so the first
  draw is at `(0, 0x100)`.

The two sheets are the stage's own TMPK sub-entries **2 and 4**: the packed ids
`0x075E0002`/`0x075E0004` are the stage descriptor's shape-set handle `0x075E`
(`F0x800a7068`, `+0xC`) with the low half the member — the packing
`tools/extract_annotator_tables.py` states verbatim — i.e. `s415tmpk/2` and
`s415tmpk/4`. Their frame records live in `2/0.bin`/`4/0.bin` (24 x 14-byte
frames each). **Corrected 2026-10-09:** their **pixels** come from the stage's
own **background pack `S415BG01`** (resource `0x769`), staged as six 8bpp
128x256 tiles into a 768x256 atlas — NOT from the stage MASK pack, whose sheet is
384 px wide and cannot hold these frames (the mask serves the point sprites).
Proven by `tools/extract_scroll_layers.py` and the shipped
`web/assets/data/scroll_layers.json`.

**Where it stands (2026-10-09).** Both blockers are closed and the layer is
ported. (1) The authority-1 conflict is settled: a live first-visit capture found
the layer sliding (still band ~136 frames, then 8 px right / 4 px up per frame,
decaying `0x10` per frame to a stop at frame 650) and the revisit branch static
(speed 0), so the 2026-07-18 "backdrop static" reading was a revisit or a
post-stop window, not a first arrival; the crevice document records the
reconciliation. (2) The pixels **are** cut: the art is the stage's own background
pack `S415BG01` (resource `0x769`, TMPK members 2 and 4, 24 tiles of 64x128),
**not** `s415mask` (that sheet is 384 px wide, too narrow for these frames),
extracted by `tools/extract_scroll_layers.py` into
`web/assets/effects/scroll/s415.png` plus `web/assets/data/scroll_layers.json`.
(3) The shipped port draws the 24 tiles from the extracted sheet through the same
shared shape emitter, so the frame records' field semantics are no longer
load-bearing for the port.
Ledger: `s415-scroll-layer-geometry-and-visibility-settled-2026-10-09`,
`s415-scroll-layer-ported-as-a-shared-scroll-machine-2026-10-09`.

#### 21.3.2 The visit-word polarity tension (2026-10-09) — recorded, not smoothed

The live first-visit capture and the raw static branch **disagree** about which
flag state produces the sliding layer, and this is left standing rather than
quietly reconciled:

- **Observed (authority 1).** On a genuine first arrival the capture found story
  flag `0x4018` **clear** and the layer object (`0x800acc18`) with its visit word
  `obj+4 == 0`, and the layer **sliding**. Flipping that single flag bit changed
  the branch: `obj+4` went `0 → 1` and the layer went static.
- **Raw branch (authority 2).** The scene entry `F0x800a6efc` in `wstag415.s`
  reads `flag == 0 → F0x800a6ec0(1)`, i.e. the visit word **1** when the flag is
  clear — the opposite. Ledger claim
  `s415-event-150-151-selected-by-flag-4018-2026-08-12` records it as "flag clear
  → parameter 1".

Both cannot be right. The port ships the **observed** behaviour (flag clear →
slides), because that is what the original provably does on screen; the polarity
therefore lives in exactly one named place in the port —
`engine/systems/point-record-actor.ts`, the `scroll-layer` machine's
`visit = flagSet ? 1 : 0`. **Do not "fix" either side from memory.** What would
settle them: (a) a fresh disassembly of `F0x800a6efc`'s two `jal F0x800a6ec0`
sites and their delay slots, reading which literal each passes against the
`0x4018` test — the assembly settles this statically at authority 2; and/or (b) a
rig read that logs the `0x4018` bit, `obj+4`, and which of events 150/151 fires,
all on the same first visit.
Ledger: `s415-scroll-layer-visit-word-polarity-tension-2026-10-09`.

### 21.4 What this pass did not do for the three

* No new machine, no new table and no new verifier for any of the three (this
  pass; the two ports named above followed). The census was **258 ported / 3
  interpreter only** and the pins in `tests/stage-registry-members.test.js` were
  unchanged, which is the honest state: reading a member is not porting it.  The
  census now reads **260 ported / 1 interpreter only**.
* §21.1 and §21.2 name the exact shape each matched and what was missing, which
  is what the two later ports built from.
* I did not run the original, and **s415 `0x32c` (the scrolling layer) now has
  its runtime capture**: on a first visit it slides (8 px right / 4 px up per
  frame, easing to a stop); on a revisit it is static (see §21.3.1).
  **SUPERSEDED 2026-10-09: the geometry is read, the visibility is settled, the
  pixels are cut and the layer is ported as the `scroll-layer` machine (commit
  842bf003).**

> **Count correction 2026-10-06 (commit 0837687c).** The in-place halo shape is now mined for **26 stages / 31 members** (was 18/23): eight stages build the actor with their own allocator and run it unregistered. Five repeating-tag copies are refused by name (their arm writes every matching record), four overlays are a different actor, two stages belong to the slot-ensemble system. Evidence `EV-POINT-ACTORS-26-STAGES-2026-10-06`; the claim `point-record-actors-mined-for-26-stages-2026-10-06`.


> **Count and prose correction 2026-10-09.** The generated census
> (`data/stage_registry_members.json`, `tools/inventory_stage_registry.py`) reads
> **260 ported / 1 interpreter only (s415 `0x32c`)**, and this document now says
> so: §5's `0x327` and `0x32b` rows, §7's `068918e43ec6` and `389277009daa`
> families, §8's counts and citation list, §11.4, §12, §13.1, §13.6, §13.8, §20.9
> and §21 were corrected (rows for 807 and for 0x32b, and the count statements
> they feed).  s785's 807 was ported 2026-10-05 (commit 17e2a642, the
> `picture-steps` machine); the earlier reading of its pack as absent (it is
> S785TMPK.BIN, resource 455) and of its anchor as a live sound object (it is the
> tagged cast object the scene names, operand 12) is struck wherever it
> appeared.  s415 `0x32b` was ported 2026-10-05 (commit c9c9e724).  Claim:
> `stage-registry-stale-807-reading-corrected-2026-10-09`.  The name "lamp" for
> 807 is wrong: this repository's lamp is the s780 street-lights system.


> **§5 port-column tidy 2026-10-09.** §5's `port` column was still the
> 2026-10-04 snapshot: 22 of its cells read `interpreter only` for members the
> generated census (`data/stage_registry_members.json`,
> `tools/inventory_stage_registry.py`) records as `ported`, each cited to the
> machine that ports it in §8 -- `0x321`, `0x322`, `0x328`, `0x329`, `0x32a`,
> `0x32e`, `0x32f`, `0x33f`, `0x340`, `0x343`, `0x344`, `0x345`, `0x347`,
> `0x348`, `0x34a`-`0x34c`, `0x34e`, `0x34f`, `0x351`, `0x355`, `0x357`.  §7 was
> regenerated from `tools/inventory_stage_registry.py --doc-groups` (21 family
> rows carried the pre-port `0 | 1` counts); §6 already matched the tool.  The
> one member still `interpreter only` is s415 `0x32c`, the scrolling layer
> (§21.3).  The dated per-pass counts above (§9, §10.4, §11.4, §12, §12.5, §13.8)
> are the scope of the run that wrote them and are read against §5/§7/§8 and the
> census.

> **The s415 scrolling layer is ported; the census's one `interpreter only` row
> lags it (2026-10-09, commit 842bf003).** s415 `0x32c` now runs in ordinary play
> as the `scroll-layer` machine in `engine/systems/point-record-actor.ts` (its own
> `web/assets/data/scroll_layers.json`, cut from the stage's `S415BG01` background
> pack by `tools/extract_scroll_layers.py`), gated on story flag `0x4018` and
> proven by `tools/verify_scroll_layer.mjs` (VERDICT OK, 14/14) and
> `tests/scroll-layer.test.js` (9 pass). A live first-visit capture settled its
> visibility: it slides 8 px right / 4 px up per frame and eases to a stop, and is
> static on a revisit — which is the static backdrop the 2026-07-18 capture
> measured. §13.3 and §21.3/§21.3.1 say so; ledger claims
> `s415-scroll-layer-geometry-and-visibility-settled-2026-10-09` and
> `s415-scroll-layer-ported-as-a-shared-scroll-machine-2026-10-09`.
>
> The generated census (`data/stage_registry_members.json`,
> `tools/inventory_stage_registry.py`) and this document's generated tables (§5's
> `0x32c` cell, §6's s415 `0x32c` row, §7's `9e9f99e27a13` row, §8's counts) still
> read **260 ported / 1 interpreter-only**, because flipping them needs two steps
> outside a records pass that may not edit tests: (a) the census's `PORTS` table
> given a `scroll-layer` citation (and its `data_check` able to see the member),
> and (b) `tests/stage-registry-members.test.js` — whose pinned `members_ported
> == 260` / `members_interpreter_only == 1` and hard-coded twenty-three-member list
> the automated census check compares against — updated in the same change. The
> port and its machine are unaffected by that bookkeeping.
