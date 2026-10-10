---
reach: A stage overlay builds an object of its own -- falling rock, a spawner, a screen launcher, a battle hook -- and you want to know which stage does what, or whether the walker already has it.
status: log
---

# What each stage overlay builds for itself — 294 overlays, 432 create calls, 222 families

**Answer first.** Every field stage program (`~/ddw3/asm/dw2003/pro/wstag*.s`, 294
files) spawns its own extra objects through ONE shared resident call, and that
call's **first argument is the tick** — the routine the engine runs every frame
for that object. Reading the tick is therefore how you tell what the object *is*:
293 of the 294 stages make at least one, 432 calls in all, and they fall into
**222 families** when the tick is normalised. One family is in **167 stages**
(18 instructions, the same in all of them). The walker has cited only **13** of
the 222 — every one of them a shop-menu / help-menu screen launcher, nothing else.

Two of the numbers matter more than the total:

* **75 of the 432** ticks are not a routine start at all — they are a label
  *inside* a bigger routine, which the object runner can only enter at the
  routine's start. Reading a tick from its own address fingerprints a tail and
  merges unrelated objects.
* **88 of the 222** families' ticks call straight into the **battle** overlay
  (`fightstg` 0x800853F8 / 0x80089548) and 13 build battle participants
  (`F0x8001AE38`, `F0x8001B364`). A large part of "what a stage builds for
  itself" is **the stage's own battle-setup hook**, not a thing you see standing
  in the room.

`s260` is the only overlay with no create call at all, and that is a verified
zero, not a parse failure: `grep -c 'jal F0x800143dc\|jal F0x80014504'
wstag260.s` returns 0 and its whole body is `.word` data lines
(`wstag260.s:6` `.word 0x00020102 # srl $zr, $v0, 0x4`).

Inventory only. **Nothing here is ported by this change** and nothing in
`engine/` or `web/` was edited.

---

## 1. The create routine, read out of s415's builders

s415's falling-rock builders start at file offset 0x450 = **0x800A6230**. Quoted
exactly (`~/ddw3/asm/dw2003/pro/wstag415.s`):

```
.L0x00000450: addiu $sp, -0x18                    # .word 0x27bdffe8
.L0x00000454: move_ $a3, $a0                      # .word 0x00803821
.L0x00000458: lui $a0, 0x800a                     # .word 0x3c04800a
.L0x0000045c: addiu $a0, 0x5fa8                   # .word 0x24845fa8
.L0x00000460: li $a1, 0x74                        # .word 0x24050074
.L0x00000464: sw $ra, 0x10($sp)                   # .word 0xafbf0010
.L0x00000468: jal F0x800143dc                     # .word 0x0c0050f7
.L0x0000046c: move_ $a2, $zr                      # .word 0x00003021
.L0x00000470: sw $zr, 0x4($v0)                    # .word 0xac400004
```

`lui $a0, 0x800a` + `addiu $a0, 0x5fa8` is the **whole pair** — 0x800A5FA8,
which is file offset 0x1C8 of this overlay, not the low half. The call is
**`F0x800143DC`**, and its delay slot (`:0x800a624c` / the second builder's
`:0x800a624c`) carries the third argument.

`F0x800143DC` keeps that first argument and puts it where the runner reads it
(`~/ddw3/asm/dw2003/exe/fns.s`):

```
.L0x800143e4: move_ $s4, $a0
.L0x800144bc: sw $s4, 0x48($s0)
```

and the object runner calls through that word:

```
.L0x800181a8: lw $v0, 0x48($s0)
.L0x800181ac: lw $a1, 0x24($s0)
.L0x800181b0: jalr $v0
```

so the tick is called as `tick(object, object+0x24)`. **The argument that carries
the tick pointer is `$a0`.** `$a1` is the byte size (`li $a1, 0x74` = 116 for the
rock, and the tool reads and records it), `$a2` is an optional parent object
(`F0x800143F4` `move_ $s1, $a2`; a non-zero one is allocated and its count kept at
+0x20/+0x24), and `$a3` — the argument the s415 builders copy their own `$a0`
into — is stored at object+0x00 (`F0x800144CC` `sw $s3, ($s0)`) and pushed
through `D0x8004b7b4`.

`F0x80014504` is the same routine with `$a3` forced to zero, so the two are one
system (`fns.s:4938` `.L0x8001450c: jal F0x800143dc`). Across the 294 overlays the
two calls appear 356 and 76 times — **432**, and the tool's independent count
matches `grep` exactly.

## 2. The method: every one of these objects carries four frame counters

`F0x800143DC` also installs nine resident method pointers into the new object:
`+0x28 F0x80014274`, `+0x2C F0x80014288`, `+0x30 F0x80014298`, `+0x34
F0x800142A4`, `+0x38 F0x800142AC`, `+0x3C F0x800142C8`, `+0x40 F0x800142E0`,
`+0x44 F0x800142F4`, `+0x4C F0x80014308`. Read literally, `+0x38`
(`F0x800142AC`) is:

```
lw $v0, 0xc($a0)      ; take counter 0
sw $zr, 0x10($a0)     ; zero counters 1, 2, 3
sw $zr, 0x14($a0)
sw $zr, 0x18($a0)
addiu $v0, 0x1
jr $ra
sw $v0, 0xc($a0)      ; counter 0 = counter 0 + 1, return the new value
```

(the `sw $a1, 0x18($a0)` at `F0x800142A8` is the **delay slot** of the `jr` at
`:0x800142a4`, so `+0x34` is "counter 3 = `$a1`", not a no-op).

So `+0x0C`, `+0x10`, `+0x14`, `+0x18` are four frame counters, and the shape
almost every stage tick opens with is

```
lw $v0, 0xc($a0)      ; counter 0
beqz $v0, done        ; zero    -> skip
bltz $v0, done        ; negative-> skip
slti $v0, 0x4         ; 1..3    -> skip
lw $v0, 0x38($a0)     ; >= 4    -> bump the counter and go on
jalr $v0
```

That is the "every fourth frame" gate. In the JSON it is `self_method_calls` —
a call the tick loads out of the object it was handed, as opposed to a shared
service.

## 3. How the tool groups them, and where it refuses to

`tools/inventory_stage_objects.py`, per overlay:

1. every `jal F0x800143dc` / `jal F0x80014504`;
2. `$a0` **as of the call's delay slot**, by a forward constant fold over the
   enclosing routine (`arg_at`). Only a value that lands inside
   `[0x800A5DE0, 0x800A5DE0+size)` is accepted; a table-computed tick or one
   handed in by the caller is reported **unread with its reason**, never dropped;
3. the tick's **enclosing routine**, from after the previous `jr $ra` plus its
   delay slot (two words) to its own `jr $ra`. Not from the tick address — 75 of
   the 432 are mid-routine labels (`wstag232.s:0x800a5f64` opens
   `li $v0, 0x2` with no frame of its own; its real prologue is `:0x800a5ed4`);
4. **normalise**: mask an immediate that IS an overlay address, mask **both
   halves** of a `lui`+`addiu`/`ori` pair that together make one, mask a
   `jal`/`j`/branch target inside the overlay in either its numeric or its
   `D0x` data-symbol spelling (`jal D0x800a5de0` is the stage's own routine at
   overlay+0), and mask `.L0x........` local labels because a local label is a
   file offset that moves whenever the layout does. Keep every `jal` target
   **outside** the overlay, because that says what the tick calls on shared code;
5. `sha1` the token stream, take 12 hex digits. **One hash = one family.** The
   same body is *also* hashed with nothing masked, and the count lands in the
   table as `distinct raw bodies`: it says how many genuinely different copies of
   the code a family covers. The 167-stage family is **7 distinct texts**, and the
   only difference between them is local-label offsets (s201 `:0x800a5de4` and
   s202 `:0x800a5de4` are character-for-character the same 18 instructions;
   s220's `beqz` points at `.L0x00001274` where s201's points at
   `.L0x0000002c`). The 9-stage family is 5. The five 2-stage families are 1 each
   -- one copy, two stages.

Two accuracy guards that changed the answer, both worth naming because a pass
that skipped them would have shipped wrong numbers:

* the delay-slot argument store (`wstag415.s:0x800a624c`) — a tool that reads
  arguments backwards from the `jal` gets `$a2` from a store that has not
  happened yet;
* the routine start (75 ticks). With the tick address used as the start, the
  167-stage family read **167** stages; reading the enclosing routine it reads
  **167** but the 9-stage family drops to a different hash and two families that
  had merged split apart. The numbers in this document are the corrected ones.

**17 of the 294 overlays come out of the disassembler with no resolved mnemonic
at all** — their whole body is `.word` lines whose trailing comment is the
decoder's own text (`wstag825.s:6` `# Start of code` immediately followed by
`# End of code`, then `:7` `.word 0x01966754 # 0x1966754`). For those the comment
*is* the disassembly (same decoder, no symbol names resolved), so it is promoted
to instruction text and the overlay is flagged `raw_words`; every family found
only in such an overlay rests on weaker text, and `create_calls[].raw_words_overlay`
says so per member. **Verified negative:** no create call's tick lands on a table
word in a resolved overlay (the tool rejects any that does, and none were
rejected).

### The `ported` mark

Mechanical, and recorded per family with the file **and line** that justifies it:

* `ported` — a file under `engine/` or `web/` **binds** one of this family's tick
  addresses to a `tick` / `handler` / `routine` / `entry` / `address` / `task`
  field **and names the stage the address belongs to**. Both halves are needed:
  every overlay loads at `0x800A5DE0`, so `0x800a5e74` is s210's tick in s210
  and a different routine in s270.
* `partial` — nothing shipped binds a tick address, but a shipped file names the
  family hash. (No family currently scores this.)
* `none` — neither.

Addresses within 0x20 of `0x800A5DE0` are excluded from the citation test: that
is the load base every overlay shares (`tools/wstag_extract.py` `_OVERLAY_BASE`),
so `0x800A5DE4` in `engine/dw3/ui/native/help-menu-launcher.ts:5` is that
constant, not a citation. `address:` is accepted as a tick binding **on
evidence**: `help-menu-launcher.ts:163` binds `{ module: "pro/wstag210",
address: 0x800a5e74 }` and `:58` binds `export const HELP_TICK_S210 = 0x800a5e74;`
— the same address for the same stage.

Result: **13 ported, 209 none, 0 partial.** All 13 are native screen launchers:

| family | stages | cited by |
|---|---|---|
| `4763e169653c` | s210 | `engine/dw3/ui/native/help-menu-launcher.ts:58,163` |
| `95733040de1c` | s924 | `engine/dw3/ui/native/help-menu-launcher.ts:164` |
| `c792cd63159e` | s924 | `engine/dw3/ui/native/help-menu-launcher.ts:165` |
| `3beef61ba852` | s935 | `engine/dw3/ui/native/help-menu-launcher.ts:166` |
| `09f8b182ef08` | s935 | `engine/dw3/ui/native/help-menu-launcher.ts:167` |
| `fe3af631a77d` | s210 | `engine/dw3/ui/native/yesno-launcher.ts:42` |
| `11460d9e2afe` | s210 | `engine/dw3/ui/native/yesno-launcher.ts:76` |
| `045250affb02` | s220 | `engine/dw3/ui/native/yesno-launcher.ts:77` |
| `3b22d7b2a937` | s220 | `engine/dw3/ui/native/yesno-launcher.ts:78` |
| `06a2b8525fdc` | s220 | `engine/dw3/ui/native/yesno-launcher.ts:79` |
| `3acdd0b88c0d` | s270 | `engine/dw3/ui/native/yesno-launcher.ts:80` |
| `c88a1e10539d` | s270 | `engine/dw3/ui/native/yesno-launcher.ts:81` |
| `50224a886991` | s280 | `engine/dw3/ui/native/yesno-launcher.ts:82` |

Six further families have an address mentioned in shipped code on a line that
does **not** bind it as that stage's tick; those are recorded in
`address_hits_not_naming_a_tick` and do not count. The clearest is `2f8ca75023ff`
(s780), where `web/game.js:4884` reads
`// THEN starts the opening scene (wstag780 0x800a74cc calls the event` — a
comment that names the stage and the address but says nothing about what the
address is, so it is **not** counted. A reader who disagrees has the line.

## 4. The five biggest unported families, read from their assembly

Ranked by stage count, then create calls, then hash — the same order as the
table in §5. "The counter" in each paragraph is the object word at `+0x0C`, the
stage's own step/state number; `+0x38` is the bump method of §2.

### `2443b24b0d14` — 167 stages, one object each (18 instructions)

The single biggest family, and the smallest tick: `s201` at `0x800a5de4`, and the
same eighteen instructions in 167 overlays -- 7 distinct texts, differing only in
local-label offsets (`s201` `:0x800a5de4`, `s202` `:0x800a5de4`, `s220` `:0x800a5e74`,
`s924` `:0x800a5de0`, …).
Read from `wstag201.s:5-24`: it reads the counter at `+0x0C`, returns if the
counter is 0 or negative, returns if it is 1, 2 or 3, and on reaching 4 calls the
object's own `+0x38` method once. **It draws nothing, reads nothing outside the
object, and writes nothing but the counter.** It is pure frame housekeeping — a
once-per-four-frames no-op — which is exactly why 167 stages can each afford one
and why the number 167 says nothing about gameplay. Its builder
(`wstag201.s:0x800a5e2c`) creates it at size 0x54/0x58, saves the caller's
argument at object `+0x50`, and then calls one function pointer read out of the
overlay's own table (`lw $v0, 0x70c4($v0)` with `$v0 = 0x800a0000`) — **which
routine that is, and why the builder calls it right after creating this, is not
read.**

### `7c920b2a1f47` — 9 stages, a repeating spawner (25 instructions)

`s232` at `0x800a5ff8`, also in s233, s481, s555, s630, s645, s730, s731, s949.
Same gate as above, then one thing: `jal 0x800a5fcc`, and the word that comes back
is stored **through the caller's own second argument** (`sw $v0, ($s1)` where
`$s1 = $a1`), before the `+0x38` bump. What it calls is worth reading because it
is the shape of the whole family: `wstag232.s:0x800a5fcc` is itself a *builder* —
`lui $a0, 0x800a` / `addiu $a0, 0x5ed4`, `li $a1, 0x58`, `jal F0x80014504`. So
this tick is **a parent that, every fourth frame once its counter matures, creates
one child object of the stage's own other tick and hands the child's pointer back
to whoever asked**. Read from `wstag232.s:0x800a5f64-0x800a5fa0`, the child of the
s232 copy is a 62-instruction task (its own family, `3270ff4c7ce2` in an earlier
run) that opens two halfword words from the overlay's table into `+0x52` and
`+0x56` and then runs the stage's own routine at `+0x50` and `+0x54`. **What the
child does with those words is not read here.**

### `3016edc3ed51` — s730 and s731 (48 instructions)

`s730` at `0x800a5ed4`. It is the same four-frame gate with an extra state arm:
`+0x0C == 1` jumps away, `+0x0C` in 2..3 returns, and otherwise it bumps the
counter, zeroes `+0x50`, copies a halfword out of the overlay's own table into
`+0x52` (`lhu $v0, 0x61e6($v0)`), then walks a byte list — read `+0x2` of a global,
step `+0x12`, and for each entry whose byte is 1 it calls the stage's routine at
overlay+0 with the address of `object+0x50`, writes 2 back over that byte, and
stops on the first zero byte. So it is **a per-frame walker over a fixed-length
byte table, handing out one "cell" of `object+0x50` per matured frame**. It draws
nothing and calls no shared service. **What the overlay+0 routine does with the
cell is not read.**

### `e45a283b4132` — s830 and s960 (29 instructions)

`s830` at `0x800a5ee4`: gate, then load a pointer from the overlay's own table
(`lw $a0, -0x626c($v0)` → `0x800A5B74`), read two halfwords from
`0x80058D34+0x44/+0x46`, and call **overlay+4** — the stage's own routine — with
those four values; then bump the counter. It allocates nothing, keeps no state
beyond the counter, and produces nothing a player sees: it is **a once-per-four-frames
hand-off into the stage's own step routine**, i.e. the throttled half of a stage's
frame work. **Which of the two call arguments is the argument and which the two
halfwords is read from the callee, not settled here.**

### `493e32ee1e09` — s415, ten objects (162 instructions) — the worked example

`s415` at `0x800a5fa8`, ten create calls (`wstag415.s:0x800a6230` .. `:0x800a643c`,
each 0x74 = 116 bytes, each writing a distinct 0..8 into `object+0x04` at
`:0x800a6250`, `:0x800a6288`, … — so one builder, ten instances, told apart by
that word). Read from `wstag415.s:121-282`: it reads the step word at `+0x0C`;
step 1 (`:0x800a6224`) is the fall and is the only arm with work; steps 0 and
negative return, steps 2 and 3 skip to the exit. The fall arm indexes a
**16-bytes-per-rock row** in the overlay's own table at `+0x1570` with the rock's
own `+0x04` (`sll $v0, 0x4`, `lh` at `+0x4`, `+0x6`, `+0x8`, `+0xa`, `+0xc`,
`+0xe`), stores the row's x into `+0x5C` shifted left 8, the row's y into `+0x60`
also shifted left 8 (the packed `y<<8|x` position every one of these objects
uses), and the row's `+0xA` word into `+0x64`. Each frame it multiplies the rock's
speed at `+0x68` by the row's `+0xC` word and adds the frame count read through
`0x8005DE10+0x18C` (`mult $v1, $v0` / `mflo $t0`), storing the sum into `+0x5C` —
the speed-times-frames pixel drop. When `+0x58` reaches `0x245` (581) the rock is
done (`:0x800a6414` `slti $v0, 0x245`), and it calls the object's own `+0x38`
after that. It also calls `0x8005DE10+0x17C` with `$a0 = 0x1002` on entry
(`:0x800a5efc`) — one allocator for a stage-owned cell — and, while `+0x50` is
non-zero, a method at `+0x14C` on the object it is handed
(`:0x800a6404 jalr $v0`) with a fixed overlay handler `0x800a5ee8` in `$a1`,
which is how a rock announces itself to the stage. **What the falling rock is
drawn as, and what `0x800a5ee8` does, is not read.**

## 5. Family table

`tools/inventory_stage_objects.py --doc-table` prints exactly this table.
`stages` counts distinct field stages, `create calls` counts the
`jal F0x800143dc` / `jal F0x80014504` sites, `tick insns` is the length of
the tick's *enclosing routine* -- that is what the family hash is taken
over, so a tick that is a label inside a bigger routine is compared whole,
not by its tail -- and `distinct raw bodies` counts the tick's instruction
texts with **nothing** masked, which is how many genuinely different copies
one family covers.

| family | stages | create calls | tick insns | distinct raw bodies | ported | stages |
|---|---|---|---|---|---|---|
| `2443b24b0d14` | 167 | 167 | 18 | 7 | none | s201 s202 s203 s211 s218 s219 s220 s221 s230 s231 s235 s236 s237 s238 s240 s241 s245 s246 s250 s251 s255 s256 s270 s271 s275 s276 s281 s286 s290 s291 s296 s301 s315 s316 s321 s330 s331 s336 s340 s341 s345 s346 s350 s351 s355 s356 s360 s361 s365 s366 s370 s371 s380 s381 s386 s396 s401 s410 s411 s425 s426 s430 s431 s435 s436 s441 s446 s451 s456 s465 s466 s470 s471 s476 s485 s486 s491 s495 s496 s500 s501 s505 s506 s530 s531 s540 s551 s556 s560 s561 s566 s570 s571 s576 s581 s586 s590 s591 s595 s596 s600 s601 s610 s611 s621 s631 s646 s650 s651 s656 s660 s661 s686 s690 s691 s695 s696 s700 s701 s705 s706 s710 s711 s715 s716 s720 s721 s725 s726 s760 s761 s920 s921 s922 s923 s924 s926 s928 s929 s930 s931 s932 s933 s934 s935 s936 s937 s938 s939 s940 s941 s942 s943 s944 s945 s946 s947 s948 s950 s951 s952 s953 s955 s956 s957 s958 s959 |
| `7c920b2a1f47` | 9 | 9 | 25 | 5 | none | s232 s233 s481 s555 s630 s645 s730 s731 s949 |
| `3016edc3ed51` | 2 | 2 | 48 | 1 | none | s730 s731 |
| `8a2925103871` | 2 | 2 | 133 | 1 | none | s745 s746 |
| `e45a283b4132` | 2 | 2 | 29 | 1 | none | s830 s960 |
| `ee8fda406595` | 2 | 2 | 27 | 1 | none | s825 s845 |
| `f8e395c10400` | 2 | 2 | 96 | 1 | none | s325 s326 |
| `493e32ee1e09` | 1 | 10 | 162 | 1 | none | s415 |
| `956c552225e7` | 1 | 4 | 158 | 1 | none | s810 |
| `033edb715349` | 1 | 2 | 161 | 1 | none | s225 |
| `06c2e8edd1c5` | 1 | 2 | 241 | 1 | none | s311 |
| `17a6a9bb5bfa` | 1 | 2 | 157 | 1 | none | s226 |
| `190fdd4a9be8` | 1 | 2 | 123 | 1 | none | s526 |
| `19d612eecb83` | 1 | 2 | 170 | 1 | none | s526 |
| `1cd887c34016` | 1 | 2 | 242 | 1 | none | s310 |
| `2700487e355d` | 1 | 2 | 110 | 1 | none | s526 |
| `389277009daa` | 1 | 2 | 269 | 1 | none | s415 |
| `41eb2b149323` | 1 | 2 | 125 | 1 | none | s460 |
| `706b2ffac20f` | 1 | 2 | 183 | 1 | none | s460 |
| `7263bace5430` | 1 | 2 | 168 | 1 | none | s785 |
| `8d27f383b83b` | 1 | 2 | 164 | 1 | none | s820 |
| `b31f90eb65b7` | 1 | 2 | 241 | 1 | none | s310 |
| `c36a6b84d53f` | 1 | 2 | 230 | 1 | none | s526 |
| `c56260af5983` | 1 | 2 | 164 | 1 | none | s311 |
| `d47fb42c495f` | 1 | 2 | 160 | 1 | none | s795 |
| `ef3997e796d4` | 1 | 2 | 157 | 1 | none | s800 |
| `f9077159350f` | 1 | 2 | 241 | 1 | none | s311 |
| `fec505e99d53` | 1 | 2 | 178 | 1 | none | s460 |
| `01496e4a03c7` | 1 | 1 | 33 | 1 | none | s925 |
| `024b3093c4f5` | 1 | 1 | 34 | 1 | none | s640 |
| `02846bd3d471` | 1 | 1 | 29 | 1 | none | s961 |
| `038d4e3cddb9` | 1 | 1 | 22 | 1 | none | s335 |
| `043029c1d0a2` | 1 | 1 | 29 | 1 | none | s968 |
| `045250affb02` | 1 | 1 | 367 | 1 | ported | s220 |
| `046a122f107f` | 1 | 1 | 88 | 1 | none | s810 |
| `05592dccbe70` | 1 | 1 | 155 | 1 | none | s805 |
| `06051a57885a` | 1 | 1 | 79 | 1 | none | s421 |
| `068918e43ec6` | 1 | 1 | 151 | 1 | none | s785 |
| `06a2b8525fdc` | 1 | 1 | 367 | 1 | ported | s220 |
| `0773c9088e9f` | 1 | 1 | 88 | 1 | none | s305 |
| `082ad78ee00e` | 1 | 1 | 85 | 1 | none | s455 |
| `09f8b182ef08` | 1 | 1 | 603 | 1 | ported | s935 |
| `0b36b2c8127f` | 1 | 1 | 37 | 1 | none | s521 |
| `0b82a5ab2d72` | 1 | 1 | 29 | 1 | none | s971 |
| `0c6541ef9aa8` | 1 | 1 | 40 | 1 | none | s606 |
| `0d19fafce85c` | 1 | 1 | 29 | 1 | none | s967 |
| `0edfef6ffd94` | 1 | 1 | 40 | 1 | none | s538 |
| `0f63395eb447` | 1 | 1 | 29 | 1 | none | s966 |
| `0fe001e3d8c6` | 1 | 1 | 36 | 1 | none | s790 |
| `0ffa26b672be` | 1 | 1 | 34 | 1 | none | s676 |
| `1040b1d39891` | 1 | 1 | 46 | 1 | none | s205 |
| `10c3c60f5555` | 1 | 1 | 62 | 1 | none | s927 |
| `11460d9e2afe` | 1 | 1 | 367 | 1 | ported | s210 |
| `127dddb5d97b` | 1 | 1 | 40 | 1 | none | s616 |
| `13f552916a25` | 1 | 1 | 34 | 1 | none | s605 |
| `14ee1a733754` | 1 | 1 | 29 | 1 | none | s974 |
| `1686e21b7e01` | 1 | 1 | 29 | 1 | none | s641 |
| `16a91e17f444` | 1 | 1 | 166 | 1 | none | s620 |
| `187cb7747f25` | 1 | 1 | 25 | 1 | none | s954 |
| `18a23268b60a` | 1 | 1 | 101 | 1 | none | s780 |
| `1a105fd2fb25` | 1 | 1 | 37 | 1 | none | s520 |
| `1a85e7ad14ca` | 1 | 1 | 40 | 1 | none | s535 |
| `1ad6cac5e487` | 1 | 1 | 40 | 1 | none | s480 |
| `1c8f64718e65` | 1 | 1 | 87 | 1 | none | s805 |
| `1e58922cd41a` | 1 | 1 | 164 | 1 | none | s815 |
| `221524f4cb3b` | 1 | 1 | 40 | 1 | none | s565 |
| `250902f25494` | 1 | 1 | 40 | 1 | none | s326 |
| `2716f1dd9201` | 1 | 1 | 160 | 1 | none | s750 |
| `291c04fcdf15` | 1 | 1 | 40 | 1 | none | s445 |
| `2bd5a21bd871` | 1 | 1 | 55 | 1 | none | s206 |
| `2d5e5f878754` | 1 | 1 | 92 | 1 | none | s780 |
| `2f8ca75023ff` | 1 | 1 | 57 | 1 | none | s780 |
| `2f8f168ac7dd` | 1 | 1 | 59 | 1 | none | s790 |
| `301ee1fbc469` | 1 | 1 | 66 | 1 | none | s815 |
| `31566ead9eab` | 1 | 1 | 34 | 1 | none | s755 |
| `32a378d614a1` | 1 | 1 | 42 | 1 | none | s400 |
| `3732a812d1c5` | 1 | 1 | 27 | 1 | none | s840 |
| `3a3ea7b8af23` | 1 | 1 | 189 | 1 | none | s305 |
| `3acdd0b88c0d` | 1 | 1 | 367 | 1 | ported | s270 |
| `3b22d7b2a937` | 1 | 1 | 367 | 1 | ported | s220 |
| `3b4e7923ac35` | 1 | 1 | 136 | 1 | none | s310 |
| `3b78004ff044` | 1 | 1 | 49 | 1 | none | s405 |
| `3beef61ba852` | 1 | 1 | 587 | 1 | ported | s935 |
| `3c5306dc6763` | 1 | 1 | 29 | 1 | none | s972 |
| `3d2349925ef5` | 1 | 1 | 120 | 1 | none | s481 |
| `3d36874182e3` | 1 | 1 | 86 | 1 | none | s820 |
| `3db7ae6494c4` | 1 | 1 | 28 | 1 | none | s526 |
| `3dfc18d3fadc` | 1 | 1 | 164 | 1 | none | s736 |
| `3f8ff7f820f9` | 1 | 1 | 102 | 1 | none | s741 |
| `43972bc0f613` | 1 | 1 | 28 | 1 | none | s460 |
| `446969d9ec88` | 1 | 1 | 54 | 1 | none | s395 |
| `451003418910` | 1 | 1 | 53 | 1 | none | s406 |
| `461828ecd2b5` | 1 | 1 | 40 | 1 | none | s450 |
| `462d6e36246e` | 1 | 1 | 37 | 1 | none | s675 |
| `4763e169653c` | 1 | 1 | 603 | 1 | ported | s210 |
| `481d8cf7ac5e` | 1 | 1 | 27 | 1 | none | s860 |
| `4827f183345f` | 1 | 1 | 29 | 1 | none | s895 |
| `4a63a75886f4` | 1 | 1 | 40 | 1 | none | s376 |
| `4e312271d221` | 1 | 1 | 164 | 1 | none | s310 |
| `4eeafbc9e7fd` | 1 | 1 | 190 | 1 | none | s805 |
| `50224a886991` | 1 | 1 | 367 | 1 | ported | s280 |
| `51faa0804af0` | 1 | 1 | 102 | 1 | none | s740 |
| `52ffb4731303` | 1 | 1 | 164 | 1 | none | s800 |
| `53b7966aee5a` | 1 | 1 | 149 | 1 | none | s212 |
| `53c579403512` | 1 | 1 | 34 | 1 | none | s635 |
| `54bf1a4325af` | 1 | 1 | 179 | 1 | none | s205 |
| `57d7f7a13c31` | 1 | 1 | 40 | 1 | none | s550 |
| `59a7b4d415ec` | 1 | 1 | 75 | 1 | none | s926 |
| `5bd18ba5798f` | 1 | 1 | 120 | 1 | none | s480 |
| `5c2451265548` | 1 | 1 | 40 | 1 | none | s385 |
| `5cff13078461` | 1 | 1 | 29 | 1 | none | s890 |
| `5dd73de0fc1e` | 1 | 1 | 30 | 1 | none | s680 |
| `5ec4a1092b44` | 1 | 1 | 88 | 1 | none | s306 |
| `60ba894ff839` | 1 | 1 | 34 | 1 | none | s625 |
| `61308b47d87d` | 1 | 1 | 37 | 1 | none | s455 |
| `6280004a9cbc` | 1 | 1 | 163 | 1 | none | s925 |
| `660a16233d6a` | 1 | 1 | 164 | 1 | none | s735 |
| `68280c0bbc3e` | 1 | 1 | 164 | 1 | none | s745 |
| `69224c725ad5` | 1 | 1 | 263 | 1 | none | s934 |
| `6a03ab4a15bf` | 1 | 1 | 30 | 1 | none | s685 |
| `6b09c97539c9` | 1 | 1 | 162 | 1 | none | s740 |
| `6bbbc0ad4d46` | 1 | 1 | 116 | 1 | none | s800 |
| `6d274aff9546` | 1 | 1 | 116 | 1 | none | s795 |
| `6d7c98e36c65` | 1 | 1 | 164 | 1 | none | s810 |
| `6e129c9fd590` | 1 | 1 | 67 | 1 | none | s745 |
| `6e3b5f72c002` | 1 | 1 | 27 | 1 | none | s440 |
| `6f5693d09430` | 1 | 1 | 103 | 1 | none | s780 |
| `705e75969b82` | 1 | 1 | 106 | 1 | none | s475 |
| `721b07f03f45` | 1 | 1 | 104 | 1 | none | s780 |
| `732da2debe11` | 1 | 1 | 43 | 1 | none | s306 |
| `757ee5e73391` | 1 | 1 | 48 | 1 | none | s545 |
| `793386b5df29` | 1 | 1 | 164 | 1 | none | s750 |
| `7c5b7f2d3a31` | 1 | 1 | 41 | 1 | none | s785 |
| `7cf99fe9698f` | 1 | 1 | 67 | 1 | none | s815 |
| `7d0a615a7221` | 1 | 1 | 49 | 1 | none | s927 |
| `7d363a3ed472` | 1 | 1 | 169 | 1 | none | s680 |
| `7e8f6054b793` | 1 | 1 | 83 | 1 | none | s780 |
| `7f66b2dc089e` | 1 | 1 | 37 | 1 | none | s575 |
| `7fd99294fa7f` | 1 | 1 | 164 | 1 | none | s746 |
| `809fce2d59dd` | 1 | 1 | 91 | 1 | none | s630 |
| `84cf2a852ae2` | 1 | 1 | 84 | 1 | none | s310 |
| `84d71ef4f4c7` | 1 | 1 | 77 | 1 | none | s545 |
| `877613de32ef` | 1 | 1 | 84 | 1 | none | s311 |
| `87f18f7002a5` | 1 | 1 | 189 | 1 | none | s545 |
| `8a6bcc7d0ed8` | 1 | 1 | 49 | 1 | none | s415 |
| `8aeef55f8f56` | 1 | 1 | 115 | 1 | none | s800 |
| `8c4f6d16f722` | 1 | 1 | 91 | 1 | none | s640 |
| `8d36f25b05ab` | 1 | 1 | 29 | 1 | none | s965 |
| `9187707023c0` | 1 | 1 | 96 | 1 | none | s545 |
| `92b93146af31` | 1 | 1 | 162 | 1 | none | s741 |
| `94681c529e4b` | 1 | 1 | 108 | 1 | none | s212 |
| `9533b585e6ff` | 1 | 1 | 50 | 1 | none | s210 |
| `95733040de1c` | 1 | 1 | 603 | 1 | ported | s924 |
| `95957f23e795` | 1 | 1 | 29 | 1 | none | s969 |
| `983ddcb0b521` | 1 | 1 | 55 | 1 | none | s795 |
| `98fe3dbefb05` | 1 | 1 | 95 | 1 | none | s780 |
| `99fb33d77549` | 1 | 1 | 83 | 1 | none | s620 |
| `9a04da672118` | 1 | 1 | 85 | 1 | none | s375 |
| `9d3e6b7af4b8` | 1 | 1 | 82 | 1 | none | s800 |
| `9e9f99e27a13` | 1 | 1 | 127 | 1 | none | s415 |
| `9ead3eee012e` | 1 | 1 | 40 | 1 | none | s325 |
| `a24c2f561a4c` | 1 | 1 | 67 | 1 | none | s746 |
| `a5d8a25da452` | 1 | 1 | 96 | 1 | none | s805 |
| `a60e40b380c8` | 1 | 1 | 29 | 1 | none | s880 |
| `a78412642a44` | 1 | 1 | 53 | 1 | none | s954 |
| `a98d2790cb7c` | 1 | 1 | 63 | 1 | none | s820 |
| `ac52ab612150` | 1 | 1 | 51 | 1 | none | s285 |
| `ad7a37003b8d` | 1 | 1 | 27 | 1 | none | s835 |
| `ae466f602c3a` | 1 | 1 | 37 | 1 | none | s615 |
| `aed12dd5be39` | 1 | 1 | 29 | 1 | none | s875 |
| `b12d72af33c8` | 1 | 1 | 91 | 1 | none | s635 |
| `b31ff0ebf3e9` | 1 | 1 | 29 | 1 | none | s865 |
| `b3698daed084` | 1 | 1 | 108 | 1 | none | s460 |
| `b4616d0d99c6` | 1 | 1 | 64 | 1 | none | s295 |
| `b636e0233f74` | 1 | 1 | 57 | 1 | none | s490 |
| `b9057685ddd4` | 1 | 1 | 29 | 1 | none | s885 |
| `bb099a4a9d3a` | 1 | 1 | 50 | 1 | none | s580 |
| `bcd01b6bd89f` | 1 | 1 | 147 | 1 | none | s625 |
| `be3b947c23cb` | 1 | 1 | 62 | 1 | none | s300 |
| `bf6169da5a92` | 1 | 1 | 40 | 1 | none | s226 |
| `bf769bf04ffe` | 1 | 1 | 29 | 1 | none | s964 |
| `bf971cb78d27` | 1 | 1 | 263 | 1 | none | s261 |
| `c231ff959a92` | 1 | 1 | 37 | 1 | none | s420 |
| `c397463c2f74` | 1 | 1 | 141 | 1 | none | s750 |
| `c68db52d1b9a` | 1 | 1 | 85 | 1 | none | s949 |
| `c792cd63159e` | 1 | 1 | 603 | 1 | ported | s924 |
| `c7d7f32ea415` | 1 | 1 | 29 | 1 | none | s970 |
| `c88a1e10539d` | 1 | 1 | 367 | 1 | ported | s270 |
| `ca2d7e73d5ac` | 1 | 1 | 62 | 1 | none | s233 |
| `cb5171ac2e94` | 1 | 1 | 44 | 1 | none | s406 |
| `cc53c80cf56d` | 1 | 1 | 91 | 1 | none | s645 |
| `cd58830c174f` | 1 | 1 | 27 | 1 | none | s855 |
| `d0c0f34bcb41` | 1 | 1 | 65 | 1 | none | s735 |
| `d191cbe47461` | 1 | 1 | 41 | 1 | none | s320 |
| `d4fa82b83f46` | 1 | 1 | 91 | 1 | none | s555 |
| `d54955402b2f` | 1 | 1 | 65 | 1 | none | s736 |
| `d72b0348bfb7` | 1 | 1 | 42 | 1 | none | s585 |
| `d769f2b81516` | 1 | 1 | 38 | 1 | none | s780 |
| `dc813893e0d4` | 1 | 1 | 27 | 1 | none | s850 |
| `dcc9d6bf527a` | 1 | 1 | 29 | 1 | none | s963 |
| `dfc0ef314f8f` | 1 | 1 | 47 | 1 | none | s756 |
| `e39b1a1ffc21` | 1 | 1 | 29 | 1 | none | s973 |
| `e6a0e2f0dac3` | 1 | 1 | 45 | 1 | none | s375 |
| `e7a9453d61df` | 1 | 1 | 38 | 1 | none | s200 |
| `ec6d3ca28a42` | 1 | 1 | 48 | 1 | none | s280 |
| `eca33b706333` | 1 | 1 | 30 | 1 | none | s225 |
| `edfd4eaf74ec` | 1 | 1 | 183 | 1 | none | s790 |
| `eeae1f8e3c1a` | 1 | 1 | 29 | 1 | none | s962 |
| `ef6227fddce7` | 1 | 1 | 40 | 1 | none | s525 |
| `f262f7edd391` | 1 | 1 | 37 | 1 | none | s655 |
| `f2e3ee14bd0c` | 1 | 1 | 112 | 1 | none | s311 |
| `f3f75f018d08` | 1 | 1 | 40 | 1 | none | s740 |
| `f6b9874c82e4` | 1 | 1 | 53 | 1 | none | s405 |
| `f7a222ea4c70` | 1 | 1 | 22 | 1 | none | s261 |
| `f84004238c29` | 1 | 1 | 29 | 1 | none | s636 |
| `fa49c2a191e5` | 1 | 1 | 112 | 1 | none | s310 |
| `fc318a8aa959` | 1 | 1 | 42 | 1 | none | s537 |
| `fc5bfaee4f84` | 1 | 1 | 29 | 1 | none | s870 |
| `fcc8c99db1b9` | 1 | 1 | 62 | 1 | none | s232 |
| `fd5376846836` | 1 | 1 | 132 | 1 | none | s526 |
| `fe3af631a77d` | 1 | 1 | 367 | 1 | ported | s210 |
| `fe559983a22c` | 1 | 1 | 40 | 1 | none | s741 |

## 6. What I did not establish

1. **What the 209 `none` families actually are.** I read the top five (§4) and
   the worked example. The other 204 are named by hash only. Each one needs its
   own assembly pass, and the biggest of them are the **per-stage copies of the
   same battle-setup and screen-launcher code** — s210, s924, s935 and s961 each
   carry their own 587- to 603-instruction copy of the help-menu launcher, and
   s305/s310/s400/s405/s526/s780 each carry their own 57- to 367-instruction
   battle hook that ends in `jal fightstg+0x800853F8`. Those are **one shared
   system with per-stage data**, not 20 unrelated objects, and reading them as one
   family is the next job, not this one.
2. **Why 167 stages need a tick that does nothing.** `2443b24b0d14` is read as
   frame housekeeping and that is all it says. Whether it is the shared "every
   fourth frame" hook the rest of the engine expects, and what the function
   pointer its builder calls out of the overlay table at `0x800A70C4` is, are both
   **not read**.
3. **`F0x800143DC`'s fourth argument.** It lands at object+0x00 and goes through
   `D0x8004B7B4`; I did not read what that list is for, so a create call whose
   `$a3` is a stage pointer and one whose `$a3` is zero are recorded the same way.
4. **Whether any stage object is visible.** The table says what each tick *reads
   and writes*, not what a player sees. No family here has been checked against a
   running game, and nothing in `engine/` or `web/` was changed to find any of it.
5. **One known citation I did not count.** `web/game.js:4884` names
   `wstag780 0x800a74cc` in a comment; the line does not say the address is a
   tick, so family `2f8ca75023ff` (s780) is marked `none` and the line is recorded
   in `address_hits_not_naming_a_tick`. If a reader says the comment *is* a
   citation, that family's mark changes and nothing else does.

## 7. Reproducing this

```sh
python3 tools/inventory_stage_objects.py                       # summary on stderr
python3 tools/inventory_stage_objects.py --stats               # per-stage table
python3 tools/inventory_stage_objects.py --unread              # overlays with unread calls
python3 tools/inventory_stage_objects.py --family <hash>       # one tick, with addresses
python3 tools/inventory_stage_objects.py --doc-table           # the table in section 5
python3 tools/inventory_stage_objects.py --stage s415          # s415's create calls
python3 tools/inventory_stage_objects.py --out data/stage_object_families.json
node --test tests/stage-object-families.test.js
```

`--no-ship` skips the `engine/`+`web/` citation scan (about 17 s of the 18 s run).
The tool reads `~/ddw3/asm/dw2003/pro/wstag*.s` read-only and writes only
`data/stage_object_families.json`.

Ledger: `STAGE-OVERLAY-OBJECT-CREATE-2026-10-04`, status `partially_verified`.
