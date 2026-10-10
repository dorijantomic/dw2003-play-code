---
reach: the branches that should trigger reading this — a battle line whose wording is in question; a new page kind asked of the in-battle message box; anything touching FIGHTSTG_F0x80099588, the panel method at +0xac, esmfight, or the bank 0x6a/0xa2/0x4e lookups the arms make; §11 is the whole category-4 heal-and-cure arm of the record machine 0x8008fbec — the sixteen techniques that heal or cure instead of hitting, who is healed, how much, and whether they can miss
status: log
---

# The in-battle message box: every page kind, and who asks for each

## 0. Answer first

The message box at the bottom of a 3D battle has **22 kinds of page**, and the game
decides which one by a single small number the caller passes in. Kinds 1 to 22 each have
their own arm — its own pair of lines and its own numbered slots — and anything outside
that range prints nothing at all and leaves the box empty. Nineteen of the 22 have at
least one caller in the two battle overlays; **kinds 6, 11 and 21 have none**, so those
three arms are dead in the shipped game. The walker can now build any of the 22, and the
two places where it used to type its own sentence — a landed steal and a weapon's HP
drain — now put up the game's own page.

## 1. The shared system, named before any edit

**The battle message box.** One object, built by `FIGHTSTG_F0x8009a298`
(`~/ddw3/asm/dw2003/pro/fightstg.s:24195`-`:24212`), which allocates 0xb4 bytes through
`F0x80014504` and installs two methods: the VM at `+0xac`
(`:24204 lui $v1, 0x800a` / `:24205 addiu $v1, -0x6a78` = 0x80099588) and the timed-close
switch at `+0xb0` (0x8009a254). Everything in this document is that one object.

This is **not** a converted copy with hand rows. The walker already runs a port of it:

* `engine/dw3/ui/native/battle-message-line.ts` — the 22-arm table (`BATTLE_MESSAGE_ARMS`),
  the element method offsets, the window art, the reveal cadence, and an oracle
  (`tests/lane-b/battle-message-line.test.js`) that runs the original VM through
  `engine/native` and compares the ordered element calls.
* `engine/dw3/ui/battle-message-session.ts` — the session that owns the two elements.
* `web/battle.js` — `sayOriginal(b, spec, walker)` / `sayWalker(b, walker)`: `spec` is the
  `+0xac` call, `walker` is the walker's own sentence kept for `?legacyBattleMsg=1` and
  for `peek()`.

What was missing is the other half: **what each kind's own call site writes into the
payload**. That is `engine/dw3/ui/native/battle-message-pages.ts`, added by this pass.

## 2. The switch, the bound, and the table

```
:23387 .L0x80099608: addiu $v1, $s0, -0x1    # $v1 = kind - 1
:23388 .L0x8009960c: sltiu $v0, $v1, 0x16     # the SHORT form of sltiu $v0, $v0, $v1
:23389 .L0x80099610: beqz  $v0, .L0x8009a204  # kind - 1 >= 22 -> the empty arm
:23390 .L0x80099614: sw    $zr, 0x78($s4)
:23391 .L0x80099618: lui   $v0, 0x8008
:23392 .L0x8009961c: addiu $v0, 0x318c         # table base 0x8008318c
:23393 .L0x80099620: sll    $v1, 0x2
:23394 .L0x80099624: addu   $v1, $v0
:23395 .L0x80099628: lw     $v0, ($v1)
:23396 .L0x8009962c: nop
:23397 .L0x80099630: jr     $v0
:23398 .L0x80099634: nop                     # the delay slot
```

Two facts that are easy to get wrong and are the reason this document exists:

* **Kind 0 is not arm 1.** The index is `kind - 1`, so kinds 1..22 are the 22 arms and
  kind 0 falls out with kind 23 and above.
* **`.L0x8009960c` is the SHORT form** `sltiu $v0, $v1, 0x16`, i.e. `sltiu $v0, $v0, $v1`
  — the `.s` text is not swapped, and `$v1` (not `$v0`) carries `kind - 1`.

The out-of-range arm `.L0x8009a204` writes **no text** and then hides both lines
(`:24154 lw $a0, ($s3)` / `:24156 lw $v0, 0x144($a0)` / `:24158 jalr $v0` /
`:24159 move_ $a1, $zr`, then the same for the second element at `:24160`-`:24165`). It is
the shared tail for kind 9 and kind 20 as well, which is why those two arms look empty.

The jump table is 22 words at `.L0x8008318c` (`fightstg.s:301`-`:322`).

**What every arm does, in order** (line numbers are `fightstg.s`):

1. `.L0x800995c8` / `.L0x800995f0` — if the two-word widget block at `self+0x24` is
   empty, build the two text elements: `F0x8001ae38(0x1005, 1, 0x14, 0xc2)` and
   `F0x8001ae38(0x1005, 1, 0x14, 0xd0)` — line one at native (20, 194), line two at
   (20, 208).
2. For each line: read the bank, then call the element's `+0x114` with the string. The
   bank argument is the immediate in the getter call's delay slot (`addiu $a0, 0x7f` for
   the message bank `0x7f`; `0x6a`, `0xa2` or `0x4e` for a few arms), and the string
   index is the immediate in the `+0x114` call's delay slot (`li $a2, <index>`).
3. Any numbered slot the arm fills goes in through `+0x118` (a number) or `+0x120`
   (a string), each with the slot number in its delay slot (`li $a1, 0x1`).
4. The shared tail `.L0x8009a01c` / `.L0x8009a040`: `self+0x7c = 2`, then
   `jal FIGHTSTG_F0x80098d14` with `a2 = payload[0]` (`:24035 lw $a2, ($s2)`,
   `:24037 sltu $v0, $zr, $a2`) — that is the side test that decides whether line one gets
   the **current actor's** name (`payload[0] == 0`) or the name of the fighter at
   `[0x800a4460 + 8]` (`payload[0] != 0`), and the tail's own test is
   `FIGHTSTG_F0x80098d14 :22789 bnez $a2`.

## 3. The 22 arms

Bank `0x7f` is `esmfight`, the battle message bank; it ships as
`web/assets/data/battlecmd/esmfight.json` (145 entries). Bank `0x6a` is the item-name bank,
indexed by ItemId, and ships as `battlecmd/esitmnam.json`. Banks `0xa2` (technique names)
and `0x4e` (species names) are **not shipped as banks** — the walker already resolves
those names itself (as kinds 3, 12 and 13 did before this pass), so the builders take the
name as an argument and the second slot carries it.

| kind | arm | line 1 | line 2 | slots | who asks |
|---:|---|---|---|---|---|
| 1 | `0x80099638` | `payload[0]` (`:23408 lw $a2, ($s2)`) | untouched | — | 19 |
| 2 | `0x80099678` | `esmfight[0x16]` (`:23428`) | `payload[0]` (`:23436`) | — | 41 |
| 3 | `0x800996f8` | `esmfight[0x16]` (`:23461`) | `esmfight[0x09]` `{1}!` (`:23475`) | 1 = bank `0xa2` by `payload[1]` (`:23476`, `:23479`) | 2 |
| 4 | `0x80099794` | `esmfight[0x16]` (`:23494`) | `esmfight[0x0b]` `{1} damage!` (`:23508`) | 1 = `payload[1]` (`:23512`) | 8 |
| 5 | `0x8009980c` | `esmfight[0x16]` (`:23527`) | `esmfight[0x0a]` `Counter! {1}!` (`:23541`) | 1 = bank `0xa2` by `payload[1]` (`:23545`, `:23548`) | 1 |
| 6 | `0x800998a8` | `esmfight[0x16]` (`:23564`) | `esmfight[0x25]` `Counter!` (`:23578`) | — | 0 |
| 7 | `0x80099908` | `esmfight[0x16]` (`:23591`) | `payload[0]` (`:23600`) | — | 9 |
| 8 | `0x8009998c` | `esmfight[0x16]` (`:23624`) | `esmfight[0x22]` `{1}HP healed!` (`:23638`) | 1 = `payload[1]` (`:23638`) | 2 |
| 9 | `0x80099a04` | — | — | — | 4 |
| 10 | `0x80099a28` | `esmfight[0x16]` (`:23661`) | `esmfight[0x27]` `HP gradually recovers.` (`:23675`) | — | 1 |
| 11 | `0x80099ad4` | `esmfight[0x16]` (`:23704`) | `esmfight[0x22]` (`:23718`) | 1 = `payload[2]` (`:23724`) | 0 |
| 12 | `0x80099b90` | `esmfight[0x16]` (`:23751`) | `esmfight[0x37]` `Digivolved! {1}!` (`:23765`) | 1 = bank `0x4e` by `payload[1]` (`:23770`, `:23773`) | 1 |
| 13 | `0x80099c2c` | `esmfight[0x4e]` `Next Digimon out!` (`:23790`) | `esmfight[0x4f]` `{1}!` (`:23804`) | 1 = bank `0x4e` by `payload[0]` (`:23808`, tail `:24147`) | 2 |
| 14 | `0x80099ca0` | `esmfight[0x16]` (`:23822`) | `esmfight[0x09]` `{1}!` (`:23833`) | 1 = bank `0x6a` by `payload[1]` (`:23838`, `:23841`) | 1 |
| 15 | `0x80099d3c` | `esmfight[0x16]` (`:23860`) | `esmfight[0x55]` `Poisoned: {1}` (`:23870`) | 1 = `payload[2]` (`:23874`) | 1 |
| 16 | `0x80099dd4` | `esmfight[0x16]` (`:23903`) | `esmfight[0x23]` `{1} X {2} = {3}!` (`:23917`) | 1 = `payload[1]` (`:23911`), 2 = `payload[2]` (`:23912`), 3 = their product (`:23914 mult $a2, $v0`, `:23931 move_ $a2, $s0`) | 2 |
| 17 | `0x80099e8c` | `esmfight[0x26]` `Stole` (`:23945`) | `esmfight[0x09]` `{1}!` (`:23956`) | 1 = bank `0x6a` by `payload[0]` (`:23960`, tail `:24147`) | 1 |
| 18 | `0x80099f00` | `esmfight[0x16]` (`:23974`) | `esmfight[0x22]` (`:23988`), or `esmfight[0x8f]` `{1} MP absorbed!` (`:23997`) when `payload[2] != 0` (`:23975 lw $v0, 0x8($s2)` / `:23977 bnez`) | 1 = `payload[1]` (`:24001`) | 2 |
| 19 | `0x80099fb0` | `esmfight[0x16]` (`:24016`) | `payload[1] + 0x49` (`:24026 lw $a2, 0x4($s2)` / `:24028 addiu $a2, 0x49`) | — | 1 |
| 20 | `0x8009a050` | — | — | — (it re-enters the VM) | 1 |
| 21 | `0x8009a088` | `esmfight[0x16]` (`:24076`) | `esmfight[0x22]` (`:24089`) | 1 = ring word 1 (`:24093 lw $a2, 0x50($v0)`) | 0 |
| 22 | `0x8009a168` | `esmfight[0x8c]` `Galacticmon learned a technique!` (`:24130`) | `esmfight[0x09]` `{1}!` (`:24139`) | 1 = bank `0xa2` by `payload[0]` (`:24142`, tail `:24147`) | 1 |

**Kind 20 is not an empty arm**: `.L0x8009a050 move_ $a0, $s4` / `.L0x8009a054 li $a1, 0x4`
/ `.L0x8009a058 jal FIGHTSTG_F0x80099588` — it re-enters the VM with **kind 4** and the
same payload, so the player reads `{1} damage!`; then `:24049 li $v0, 0x15` /
`:24050 sw $v0, 0x54($s4)` write 21 into the step ring and `:24057 j .L0x8009a204` hides
both lines. The port's builder returns the kind-4 page for it.

**Kind 9 is not an empty arm either**: `.L0x80099a08 jal FIGHTSTG_F0x80098de0` and
`.L0x80099a18 jal FIGHTSTG_F0x80099140` run the two helpers, and `:23649 j .L0x8009a204`
hides both lines. **I have not read those two helpers' bodies**, so I do not claim they
write nothing; what I claim is that this arm issues no `+0x114` / `+0x118` / `+0x120`
call of its own and lands on the hide-everything tail.

## 4. Every caller

Only two overlays build a panel: `pro/fightstg.s` (62 `jal FIGHTSTG_F0x8009a298` sites)
and `pro/wfightmn.s`, which never allocates one and asks 24 times on a panel somebody
else made. `pro/wfightts.s` has **none**, and no third overlay names the constructor
(`grep -rl F0x8009a298 ~/ddw3/asm/dw2003/` returns `pro/fightstg.s` alone), so the
census below is complete for the game's battle.

The kind is in `$a1` at the call, and **every panel call in both files is the same three
instructions**: `lw $a0, ($sN)`, `li $a1, <kind>`, `lw $v0, 0xac($a0)`, `nop`, `jalr $v0`,
`addiu $a2, $sN, <payload>`. There is no other register that loads `+0xac` in either
file, so the site list is mechanical and the check below reproduces it:

```sh
python3 - <<'PY'
import re
from collections import Counter
for ov, p in (("fightstg", "pro/fightstg.s"), ("wfightmn", "pro/wfightmn.s")):
    lines = open(f"~/ddw3/asm/dw2003/{p}", encoding="utf-8", errors="replace").read().split("\n")
    for j, l in enumerate(lines):
        if not re.search(r"lw\s+\$v0,\s*0xac\(\$a0\)", l):
            continue
        k = next((x for x in range(j + 1, j + 5) if re.search(r"jalr\s+\$v0", lines[x])), None)
        if k is None:
            continue
        d = re.search(r"(?:li\s+|addiu\s+)\$a1,\s*(0x[0-9a-f]+)", lines[k + 1])
        print(ov, j + 1, int(d.group(1), 0) if d else lines[k + 1].strip())
PY
```

Three traps, each of which changes the answer:

* **A `jalr` delay slot wins.** At `fightstg.s:12551`/`:12553`
  (`lw $a1, 0x10($s1)` / `lw $v0, 0xac($a0)` / `jalr $v0` / `addiu $a1, 0x5`) the load
  into `$a1` is **dead** — the delay slot's `addiu $a1, 0x5` is the kind. That site is
  kind 5.
* **A branch delay slot runs on BOTH paths.** At `fightstg.s:11858`-`:11873` the
  `bgtz`'s delay slot is `li $a1, 0x14`, so the site at `:11873` — which is reachable
  only by taking that branch (nothing else jumps to `:11871`) — is **kind 20**, while the
  fall-through at `:11862` has its own `li $a1, 0x4` and is kind 4.
* **Three sites write `$a1` from a register**, and a plain backwards search for a literal
  gets all three wrong. `:13594` is `move_ $a1, $s0` in the `beq`'s delay slot
  (`:13591`), and `$s0` is 8 at `:13579` — so it is **kind 8**, not kind 1, and the `-1`
  from `:13589` skips the call entirely. `:13749` is `move_ $a1, $a0` in the `beqz`'s
  delay slot (`:13744`) with `$a0 = 1` from `:13729`, so it is **kind 1**. The third
  register write is `wfightmn.s`'s, where every `li` is a `.word` pseudo-instruction.

Reading rule used: every instruction that writes `$a1` was followed over the whole
control-flow graph (delay slots included, calls modelled as call-plus-return, the
state-machine dispatch `jr $v0` followed through its own `.word` table), and every site
the flow could not settle was then read by hand.

### The census: 95 call sites, and where each kind's word comes from

`lw $v0, 0xac($a0)` + `jalr $v0` appears **71 times in `pro/fightstg.s` and 24 in
`pro/wfightmn.s`**, and every one of them is a panel call. Three sites print two
different kinds depending on the path (`:11323` and `:11447` are kind 1 or kind 2 by the
branch that reaches them, and `:13594` is kind 8, kind 9 or no call at all), so the
per-kind counts sum to 74 over 71 sites.

| kind | fightstg | wfightmn | total |
|---:|---:|---:|---:|
| 1 | 14 | 4 | **18** |
| 2 | 29 (+2 on the two shared sites) | 10 | **41** |
| 3 | 2 | 0 | 2 |
| 4 | 7 | 0 | 7 |
| 5 | 1 | 0 | 1 |
| 7 | 4 | 5 | 9 |
| 8 | 1 (+1 from `:13594`) | 0 | 2 |
| 9 | 3 (+1 from `:13594`) | 0 | 4 |
| 10 | 0 | 1 | 1 |
| 12 | 0 | 1 | 1 |
| 13 | 1 | 1 | 2 |
| 14 | 1 | 0 | 1 |
| 15 | 0 | 1 | 1 |
| 16 | 2 | 0 | 2 |
| 17 | 1 | 0 | 1 |
| 18 | 2 | 0 | 2 |
| 19 | 1 | 0 | 1 |
| 20 | 1 | 0 | 1 |
| 22 | 0 | 1 | 1 |

**Kinds 6, 11 and 21 have no caller**, which is a statement about the decoded corpus: the
constructor is named in one file, every `+0xac` call in the two battle overlays is in the
tables above, and no other overlay builds the object.

### The eighteen kind-1 sites and the word each one writes

This is the row the previous revision of this document left at five of nineteen. The
payload word is `esmfight` index for every kind-1 site, because the arm hard-codes bank
`0x7f` in the getter's delay slot (`:23405 addiu $a0, 0x7f`) — the `sh $v1, 0xd2($a0)`
at `:11791`/`:11820` is a different record's field, not the message bank.

**`pro/fightstg.s` — 14 sites.** Ten of them are the generic refusal `esmfight[0x2f]`
"No effect!", one per item arm; four carry a word of their own.

| vm site | routine / arm | payload[0] | the store |
|---:|---|---|---|
| 6153 | `FIGHTSTG_F0x80088564`, the `-5..-2` sub-state arm, when `FIGHTSTG_F0x80088394` returns something other than -1 | `0x4d` "Taking out Digimon!" | `:6149 li $v0, 0x4d` / `:6150 sw $v0, 0x50($s2)` |
| 11235 | item arm `0x8008dc00`, items 42-65 | `0x2f` "No effect!" | `:11231 li $v0, 0x2f` / `:11232 sw $v0, 0x50($s2)` |
| 11323 | item arm `0x8008dcd8`, items 66-69 — kind-1 path only | `0x2f` "No effect!" | **in the delay slot**: `:11300 li $v0, 0x2f` (the delay slot of `:11299 beqz $v0, .L0x8008ddb4`), stored at `:11320` |
| 11447 | item arm `0x8008ddd8`, item 70 Life Disk | `0x2f` "No effect!" | `:11443 li $v0, 0x2f` / `:11444 sw $v0, 0x50($s2)` |
| 11802 | item arm `0x8008e4e0`, items 77-83 (the seven field items) | `itemId + 0x16`, i.e. `esmfight[99..105]` = "Fire field!" .. "Dark field!" | `:11796 lw $v0, 0x70($s2)` / `:11798 addiu $v0, 0x16` / `:11799 sw $v0, 0x50($s2)` |
| 11830 | the same arm, the field it rolled | `0x74($s2) + 0x61`; `0x74($s2)` is `rand % 7 + 2` (`:10720`-`:10732`), so again `esmfight[99..105]` | `:11824 lw $v0, 0x74($s2)` / `:11826 addiu $v0, 0x61` / `:11827 sw $v0, 0x50($s2)` |
| 11907 | item arm `0x8008e6f8`, item 86 Chaos Wave | `0x2f` | `:11903` / `:11904` |
| 11991 | item arm `0x8008e8ac`, item 87 Charm Gas | `0x2f` | `:11987` / `:11988` |
| 12124 | item arm `0x8008ea5c`, item 88 Cursed Puppet | `0x2f` | `:12120` / `:12121` |
| 12184 | item arm `0x8008eb4c`, item 89 Spider Web | `0x2f` | `:12180` / `:12181` |
| 12272 | item arm `0x8008ecac`, item 90 TNT Ball | `0x2f` | `:12268` / `:12269` |
| 13414 | `FIGHTSTG_F0x8008f714`, damage-term **type 4** | `0x2f` | `:13410` / `:13411` |
| 13749 | the same machine, type 5, the trick arm | `0x2f` | `:13745 .L0x8009035c: li $v0, 0x2f` / `:13746 .L0x80090360: sw $v0, 0x64($s4)`; the kind is `move_ $a1, $a0` at `:13744` |
| 14081 | the same machine, category 6 | `record byte 7 + 0x61`, which for the disc's seven records (213-219, `elem1` 2..8) is `esmfight[0x63]`-"[0x69]` "Fire field!" .. "Dark field!" — **not** "Blasted!", which is `esmfight[0x61]` and needs `elem1` 0, a value no record has | `:14075 .L0x80090884: lbu $v0, 0x7($s5)` / `:14077 .L0x8009088c: addiu $v0, 0x61` / `:14078 .L0x80090890: sw $v0, 0x64($s4)` |

The item arms come from the 48-word dispatch table at `.L0x80082f1c`, indexed by
`itemId - 42` (`:11200 addiu $v1, $v0, -0x2b` / `:11201 sltiu $v0, $v1, 0x30`), and
`0x70($s2)` is the used ItemId — the same word kind 14's page reads at `:11157`.

**`pro/wfightmn.s` — 4 sites.**

| vm site | payload[0] | the store |
|---:|---|---|
| 1221 | `0x7` "Ambush!" | wfightmn `:1217 li $v0, 0x7` / `:1218 sw $v0, 0x50($s2)` |
| 2481 | `0x6a` "Field dissappeared!" | `:1247` / `:1248` |
| 3227 | `0x8b` "What! The body?!" | **in the delay slot**: `:3223 li $v0, 0x8b` (the delay slot of `:3221 bne $v1, $v0, .L0x00003274`), stored at `:3224` |
| 3415 | `0x52` "Battle won!" | **in the delay slot**: wfightmn `:3388 li $v0, 0x52` / `:3390 sw $v0, 0x50($s2)` (the delay slot of `jalr $v1` at `:3389`) |

**Two words this document previously named at these sites are wrong.** `esmfight[0x1c]`
"DNA DV" is not a kind-1 payload anywhere: its only writer is `fightstg.s:10900`
(`li $v0, 0x1c`) / `:10901` (`sw $v0, 0x6c($v1)`) where `$v1 = ($s0)`, the **damage-term
object** allocated at `:10692`, not the message payload. And `:12184` writes `0x2f`, as
the table above shows, not "DNA DV".

### Who asks for what, by routine

| kind | sites | what it is |
|---:|---|---|
| 1 | 18 | the one-line words: ten "No effect!" refusals, two field-name lines, "Ambush!", "Field dissappeared!", "What! The body?!", "Battle won!", "Taking out Digimon!", "Blasted!" |
| 2 | 41 | the outcome word under the name: "Attack!" (`:14560`), "Evade!" (`:12327`, `:14674`, `:14861`), the ailment cures and item effects, "No MP!", "Trying to flee." / "Fleeing!" / "Did not flee." (`:6134`, `:5887`, `:5947`), "Defeated!" (wfightmn `:3271`), "Run away!" (wfightmn `:2229`), "Can't run away!" / "Can't digivolve!" (`:13892`/`:13910`, reached through the shared tail at `:14021`), "Back to normal!" (`:15258`) |
| 3 | 2 | the **technique** announcement in the attack-resolution sequencer `FIGHTSTG_F0x80090e84`: `:14377` (in `FIGHTSTG_F0x80090c8c`, `payload[0] = 0x10` at `:14372`) and `:14583` |
| 4 | 7 | the damage page: `:10419`, `:11862`, `:12291`, `:13222`, `:14422`, `:14655`, `:14826` |
| 5 | 1 | `FIGHTSTG_F0x8008ee84` step 0 (`:12553`) — the technique machine's own announcement: `payload[0]` = the technique id (`:12546 lbu $v0, 0x70($s1)`), `payload[1]` = the name index from the skill record (`:12540 lh $v0, 0x8($v0)`) |
| 7 | 9 | a word under the name: "Awake!" (`:14743`, `:14193`, `:10564`), `esmfight[0x32]` "Speed [arrow-up]!" (`:11514`), "No more auto recover!" / "Normal strength!" / `esmfight[0x57]` / `esmfight[0x59]` (wfightmn `:2300`, `:2789`, `:2915`, `:3600`), and `esmfight[0x1c]` "DNA DV" (wfightmn `:2698`) |
| 8 | 2 | the item heal (`:11259` `li $a1, 0x8`) and the damage-cap arm (`:13594` with `$s0` = 8) |
| 9 | 4 | the silent beats: LifeDisk (`:11352`) and the two arms of the damage-cap decision (`:13366`, `:13484`, and `:13594` with `$s0` = 9) |
| 10 | 1 | the regen tick (wfightmn `:2429`), with the amount in `payload[2]` |
| 12 | 1 | "Digivolved! {1}!" (wfightmn `:1718`), `payload[0]` = 0 |
| 13 | 2 | "Next Digimon out!": the field command path (`fightstg.s:6212`) and the partner swap (wfightmn `:3469`) |
| 14 | 1 | the item announcement, `FIGHTSTG_F0x8008dac0` step 0 (`:11162`) |
| 15 | 1 | the poison tick (wfightmn `:2642`) |
| 16 | 2 | the two damage-computation machines: `FIGHTSTG_F0x8008cb70` (`:10341`, `payload[1]`/`[2]` = the two factors, all three slots numbers) and `FIGHTSTG_F0x8008f714` (`:13175`) |
| 17 | 1 | the steal, `FIGHTSTG_F0x80091534` opcode 5 (`:15004 li $a1, 0x11`, the call itself at `:15007`); `payload[0]` = the stolen ItemId written at `:15002` |
| 18 | 2 | the weapon's drains in the same machine: opcode 12 = HP (`:15055 li $a1, 0x12`, the call at `:15058`, `payload[2] = 0` at `:15053 sw $zr, 0x5c($s3)`) and opcode 32 = MP (`:15086 li $a1, 0x12`, the call at `:15089`, `payload[2] = $s7 = 1` from `:14951 li $s7, 0x1`) |
| 19 | 1 | the weapon's curse, opcode 33 (`:15171`); `payload[1]` is 0/1/2 from the stat-bit test at `:15093`-`:15107`, giving `esmfight[0x49]`/`[0x4a]`/`[0x4b]` |
| 20 | 1 | `FIGHTSTG_F0x8008dac0`'s damage item (CrimsonCable) when the amount exceeds 4 (`:11873`, the `bgtz` delay slot) |
| 22 | 1 | "Galacticmon learned a technique!" (wfightmn `:3957`) |

Two `+0xac` reads are **not** calls to this VM and are excluded:

* `fightstg.s:24286` (`.L0x8009a3e4`) is followed by `beqz $v0, .L0x8009a4b8`, so it is a
  **null test on the method pointer**, not a call.
* `fightstg.s:27470` in `FIGHTSTG_F0x8009d2c4` calls through `[0x800a4580 + 0xac]`, and
  `FIGHTSTG_F0x8009d2c4 :27454 addiu $s2, 0x4580` makes `$s2` the **battle manager**,
  not a message panel. Its `$a1` is a struct field, not a kind.

One site is a call whose kind is not a literal: `.L0x80098c0c`, inside the reveal machine
`FIGHTSTG_F0x80098a84`. There `$a1` is the ring word read at `:22705 lw $a1, 0x50($v0)`
and `$a2` is `move_ $a2, $zr` (`:22715`) — a **null payload**. That is the panel
re-issuing the page it already holds, not a new one.

Eleven further `lw $v0, 0xac($N)` sites in `fightstg.s` are other objects' method slots
(`0xac($s1)` at `:3721`, `0xac($sp)` at `:6426`, `0x262c($a0)`/`0x2630($a0)` text-string
methods at `:3509`/`:3699`, and the reveal machine's own re-issue at `:22712`); none of
them carries a payload in `$a2`, so none is a page.

## 5. Where each kind lives in the walker now

| kind | walker |
|---:|---|
| 1, 2, 4, 7, 8, 9 | `engine/dw3/battle-items.ts` (`ITEM_PAGE_KIND_*`), `MSG_KIND` in `web/battle.js` |
| 3, 12, 13 | `web/battle.js` `techniqueSpec`, the digivolve page, `MSG_KIND.NEXT_OUT` |
| 4, 10, 15 | `engine/dw3/battle-ailment-display.ts` (the damage page, the regen tick, the poison tick) |
| 14 | `engine/dw3/battle-items.ts` `itemAnnouncementPage` (commit 18c84435) |
| 7 | `engine/dw3/battle-confusion.ts` `JOKE_GAG_KIND` |
| 5, 6, 11, 16, 17, 18, 19, 20, 21, 22 | **new**: `engine/dw3/ui/native/battle-message-pages.ts` `battleMessagePage()` |

The two typed sites this pass switched to the original's page:

* `web/battle.js` `trySteal` returned the flat suffix `" Stole <item>!"`. It now returns
  `{ text, page }`, where `page` is `battleMessagePage(17, …)` — line one "Stole", line
  two the item's own name from the shipped bank `0x6a` — and the page goes into
  `setResultPages` as its own page after the damage page, the way the original's weapon
  machine asks for it separately (`fightstg.s:15005`).
* `web/battle.js` `applyWeaponSecondary` returned `" Drained <n> HP!"` for a signature
  weapon's HP drain. It now returns `page = battleMessagePage(18, …)`, which is
  `<name>` / `<n>HP healed!`, and `payload[2]` is 0, so the MP arm is not taken.

## 6. What I did not establish

Everything §9 closed is struck out of this list rather than left to rot here.

1. ~~**`FIGHTSTG_F0x80098de0` and `FIGHTSTG_F0x80099140`** (kind 9's two helpers) are
   unread.~~ **Closed in §9.4.** The first is the *candidate scan*: it clears a counter at
   `self+0xa8` (`:22839 .L0x80098de4: sw $zr, 0xa8($a0)`) and, for every combatant of the
   side `payload[0]` selects, records `payload[1]` into `self+0x9c[count]` when that
   combatant's current HP is **below** its maximum (`:22863 .L0x80098e44: lh $v1, 0x8($a2)`
   / `:22867 .L0x80098e54: lh $v0, 0x6($a2)` / `:22869 .L0x80098e5c: slt $v0, $v1, $v0`, which
   is the short form `slt $v0, $v0, $v1`). The second is the *apply* pass: it sets **line
   two's own text to `esmfight[0x15]` "No items."** (`:23107 .L0x800991b4: lw $v0, 0x114($a0)`
   / `:23109 .L0x800991bc: jalr $v0` / `:23110 .L0x800991c0: addiu $a2, 0x15` — the delay
   slot beats the `lw $a2, 0xa8($s4)` at `:23106`) and then calls one helper per recorded
   candidate. So kind 9 is not silent after all, and the walker's "the box prints nothing"
   reading of §3's kind 9 was wrong.
2. ~~**Kind 16's event is not named.**~~ **Closed in §9.3.** It is the record machine's
   **second and later application of the same technique**, and the player reads
   `<damage> X <hits> = <damage x hits>!`.
3. **Kind 5's event is named but the split is not.** §9.5 read the machine: step 0 always
   asks **kind 5** (`:12547 lw $v1, 0x78($s1)` reads the technique-name index and
   `:12553 .L0x8008f0e0: lw $v0, 0xac($a0)` / `:12555 .L0x8008f0e8: jalr $v0` / `:12556 addiu $a1, 0x5`), and the
   `lw $a1, 0x10($s1)` in front of it is **dead** — a `jalr` delay slot wins. Kind 3's two
   sites are the attack-resolution sequencer `FIGHTSTG_F0x80090e84` (`:14377`, `:14583`).
   So the two words are `Counter! <technique>!` and `<technique>!`, from two different
   machines. **Which techniques reach the kind-5 machine is still not established**: the
   machine is reached only through a pointer, has no named caller anywhere in
   `~/ddw3/asm/dw2003/`, and `tools/lift_installed_routines.py --list` reports 8 installed
   routines in `fightstg`, none of them these.
4. **The MP drain (kind 18, `payload[2] != 0`) and the weapon curse (kind 19) have no
   walker event at all.** §9.6 settled where the MP drain lives — it is **technique 392**,
   the one category-5 technique that moves MP between party members — and the port builds
   its page. Nothing in the walker performs that transfer, so the page is still never
   asked for. The weapon curse (kind 19) is unchanged: the only writer of `payload[1]`'s
   0/1/2 is the stat-bit test in `FIGHTSTG_F0x80091534`, and the walker's signature weapons
   do not curse a stat.
5. ~~**The damage-term records themselves are not decoded.**~~ **Closed in §9.1-§9.2.**
   They are the disc's 443-row technique table, already extracted by
   `tools/extract_fight_tech_table.py`; record byte 4 is the **attack category**, and the
   five categories are named in §9.2.
6. **The ailment that owns `FIGHTSTG_F0x80088564`'s `-5..-2` sub-state** (the arm that
   prints "Taking out Digimon!") is not named. The sub-state is `$a1`, the function's own
   argument (`:6116` `bgez $a1`), and the routine it calls, `FIGHTSTG_F0x80088394`, picks a
   party record off `self+0x78`.
7. ~~**The category-4 heal AMOUNT is not in the walker.**~~ **Closed in §10.3.** The word
   at `[0x800a4614]` is not a table but ONE function pointer, and the routine behind it
   computes the amount from the technique record's own `+0x02` power and the acting
   Digimon's WISDOM. Ported as `damageTermHealAmount`.
8. ~~**Category 6's page is unreachable in the walker's play.**~~ **Closed in §10.2**, and
   the population was ten techniques larger than this paragraph said: SEVENTEEN techniques
   animate a script that fires no strike, not seven.
9. **The record machine's three entry points have no named caller.** `FIGHTSTG_F0x8008cb70`,
   `FIGHTSTG_F0x8008f714` and `FIGHTSTG_F0x8008ee84` each start with their own prologue and
   their own `.global`, yet `grep -rn "8008f714\|8008cb70\|8008ee84"
   ~/ddw3/asm/dw2003/` returns the three definitions and nothing else — no `jal`, no
   `.word` in any overlay's data, no store of the address. They are reached through
   function pointers in EXE data, the same image that holds the technique table, and
   `~/ddw3/asm/dw2003/exe/*.s` carries code only (0 `.word` lines in `f0.s`). So **how the
   box reaches them is not established**; what they do once reached is read in full above.

## 7. Every line the walker typed itself, and what it is now

`sayOriginal(b, spec, walker)` puts up the original's two lines and keeps the walker's
sentence in `b.message` for `?legacyBattleMsg=1` and `peek()`. `sayWalker(b, walker)`
means the opposite: there is a line in the box and the original has no page for it. This
table is the census of the second kind, and it is what
`tests/battle-message-saywalker-census.test.js` holds the code to — a sixth call fails
that test until it has a row here.

Sixteen call sites existed on 2026-10-04. Twelve of them are gone:

| what it typed | original event | what the code does now |
|---|---|---|
| the line again after the Blast cinematic | the Blast cinematic's own end page | the original's box is empty when the transformation ends: "Blasted!" is asked for when the gauge saturates, **before** the transformation plays, and it is `wfightmn`'s own kind-2 page — `li $v0, 0x61` / `sw $v0, 0x50($s4)` / `li $a1, 0x2` at `wfightmn.s:2977`-`:2981` — not the record machine's category-6 arm (that one prints the field words). The revert has no page. `clearBattleLine(b)` at the end of `advanceBlastPresentation` |
| `""` before the Digivolution cinematic | none | `clearBattleLine(b)` before the presentation; the original builds its "Digivolved! {1}!" page (`kind 12`) only when the sequence ends (`wfightmn.s:1717`-`:1719`), which the walker already did through `blastShow.endSpec` |
| `"<name> <ailment word>"` in the gate's `else` | the ailment gate's own page | `ts.spec` is always present for a skipped turn, so the arm is gone: `sayOriginal(b, ts.spec, ts.prefix)` |
| `"<name> evaded!"` in the gate's `else` | the evasion page | `FIGHTSTG_F0x80090e84` prints it on its own (`fightstg.s:14670`-`:14674`) |
| `"Not enough MP!"` in the gate's `else` | the technique-MP refusal | `esmfight[0x8d]` "No MP!" through `kind 2` at `fightstg.s:10219`-`:10227` (the cost test is `:10210`-`:10212`), and the command-gate arm prints the same word at `:6104`-`:6113` |
| `"<name> ran away!"` in the gate's `else` | the flee beat | `esmfight[0x43]` "Run away!", written by the Run command itself at `wfightmn.s:2222`-`:2231` |
| `"<name> couldn't escape!"` in the gate's `else` | the flee refusal | `esmfight[0x60]` "Did not flee." at `fightstg.s:5942`-`:5947` |
| `"<tech>! <enemy> evaded!"` as one sentence | **two** pages | `FIGHTSTG_F0x80090e84` asks for the technique announcement (`kind 3`, `:14582`-`:14583`) and then, when nothing landed, the evasion page (`kind 2`, `:14673`-`:14674`) — the same two calls it makes for a technique that lands, where the second is the damage page. `setResultPages` now puts both up, so the player presses Circle twice as the original does |
| `"<enemy> has been defeated!"` as a typed page | the fallen enemy's page | `esmfight[0x51]` "Defeated!" through `kind 2` at `wfightmn.s:3265`-`:3271`, built by `defeatedSpec`. The DNA fusion's own damage page (`:4192`) took the box's `kind 4` page with it |
| nothing — the enemy's technique name was inside one sentence | **two** pages | the enemy's technique announcement is `enemyTechniqueSpec` (`kind 3` with `payload[0] = 0x10`, `fightstg.s:14573`), the first page of the sequence; the damage page (`:14654`-`:14655`) is the second. A sequence of **one** page still goes straight to `sayOriginal`/`sayWalker` and not through `setResultPages`, because that is what makes it a Circle-gated page — turning the enemy's ordinary damage line into one would have added a press the player never made |
| `"No techs!"` | **none** | the original's command list always offers the row — `FIGHTSTG_F0x80093cf4` builds six text widgets and sets each to `esmfight[1 + row]`, `fightstg.s:17547`-`:17569` — and the command gate's two quiet arms print no page at all (`:6218`-`:6221`, `:6236`-`:6240`). It is now the walker's own notice over the list (`b.menuNotice`), the route "Cannot digivolve." already took |

**Six of those eleven were unreachable.** Four branched on `if (prefix)`, and `prefix` is
the empty string on every path that reaches them: `engine/dw3/battle-combat.ts:565` sets
`const prefix = ""` and only the skipped-turn return (`:603`) fills it in, and every one of
those four sites sits *after* the `if (ts.skipped) return`. The test
"a turn that is NOT skipped carries no typed prefix" pins that.

### The seven that are left

| line in `web/battle.js` | where | why it is still there |
|---:|---|---|
| 4262 | `setResultPages` | the first page of a sequence the walker composed and the original has no single page for. Every page that does have one is passed as `{ text, spec }` and goes through `sayOriginal`, so this is the fallback, not the rule |
| 4293 | `showItemPage` | an item handler's single page when that handler asks for none. Every handler in the band 66-90 returns its own `+0xac` call (`engine/dw3/battle-items.ts`), so this is reached only by an item effect the walker invented |
| 4447 | `advanceAfterResult` | the turn's status pages when one of them has no page. The poison tick (`kind 15`) and the regen tick (`kind 10`) are pages; the timed cures are not, because the disc has no writer for a frozen/confused/poison cure word — see the note at `web/battle.js:4203` |
| 6239 | `applyEnemyAction` | the enemy's whole **category-5** arm (2026-10-05), for the same reason as the category-4 arm below: `battleScriptedPlanFor` builds the record machine's own page — kind 2 with `esmfight[0x36]` "Saving Chi!" for Soul Charge 209 / Misshukikou 210 and `esmfight[0x46]` "Generating!" for Gilead Plant 400 (`pro/fightstg.s:13877` and `:14048`), kind 2 with the stat words and the two lock words for the rest, kind 9 for the three party-wide ones, kind 18 for the MP drain — so this fires only when that page is null, i.e. never for a technique that reaches an arm at all, and for 391 (Helter Skelter), whose arm deliberately builds **no** page (`:13930` writes 3 into the panel's own `+0xc`). Knightmon's `move_2` is 209 and Raidenmon's `move_1` is 400, so an enemy does charge; the byte the arm writes (combatant record `+0x0E`) is the damage tail's stage-3 operand on whichever side acts next. |
| 6250 | `applyEnemyAction` | the category-4 arm, for the same reason as `setResultPages`: the record machine's own page is passed as `{ text, spec }`, so this fires only when `restore.page` declines it. The enemy's heal and cure put up `restore.page` through `sayOriginal` one line above, because the record machine's category-4 handler always builds a page (§11). |
| 6348 | `applyEnemyAction` | the enemy's page sequence, when `damageSpec` declines it, and it now declines it for **one** reason only: a counter reaction. The record machine (`§9`, `engine/dw3/battle-damage-terms.ts`) owns the hit page, so the single-hit and the multi-hit case both put up the box's own `kind 4` page; the counters still have no page on this path, because the only `esmfight[0x0a]` page is `kind 5` inside `FIGHTSTG_F0x8008ee84` — and that machine announces a technique being **used**, not a counter reaction landing |
| 7298 | `handleKey` | a later page of the same sequence, for the same reason as the first |

**Menu messages that are not the battle box.** `"Cannot digivolve."` and now
`"No techs!"` are `b.menuNotice`, drawn by `drawMenuNotice` (`web/battle.js:7930`) in a
panel at (118, 194, 186, 25) — the walker's own notice strip over the list. The original's
nearest counterparts are `esmfight[0x45]` "Can't digivolve!" and `esmfight[0x44]`
"Can't run away!", and both are **story-flag** refusals in the damage machine
(`fightstg.s:13892`/`:13910`, reached through the shared kind-2 tail at `:14021`, each
behind a `[0x800a4648](0xd3)` / `[0x800a464c](0xd4)` flag test) — not empty-list refusals.
Which flag ids 0xd3, 0xd4 and 0x187 name is **not** established, so the walker does not
gate those two words and does not pretend the notice strip is the original's page.

## 8. Checks

* `tests/battle-message-pages.test.js` — one test per kind (22), each rendering the two
  lines a player reads out of the shipped English bank, plus two tests that the two typed
  sites from the previous pass now ask for the original's page, plus the census test that
  this document, the arm table and `BATTLE_MESSAGE_PAGE_KINDS` list the same kinds and the
  same arm addresses.
* `tests/battle-message-saywalker-census.test.js` — the census of this section: the
  `sayWalker` call sites in `web/battle.js` must be exactly the five rows above, each row
  must exist here at the line number it claims, a non-skipped turn must carry no `prefix`
  (which is what deleted six branches), a skipped turn must always carry the original's
  page, and the defeated page, the enemy's technique page, the two-page technique miss,
  the "No techs!" route and the two empty-box beats must each read as the disc's own words.
  **Every one of these fails on the branch tip**: `web/battle.js` carried sixteen
  `sayWalker` calls, `defeatedSpec` and `enemyTechniqueSpec` did not exist, the defeated
  and technique-miss pages were typed sentences, and "No techs!" went into the battle box.
* **`tools/verify_battle_damage_terms.mjs`** — the record machine's own check. It drives
  FIVE of the disc's own records in normal play, one per category, off the shipped command
  and Tech lists, with `Math.random` pinned to 0 so every accuracy roll lands, and compares
  the page the box put up with the page `damageTermPage()` builds from the same shipped
  record — the page's kind, its payload words, and its two lines composed through the same
  arm table. What it read this pass: category 2 record 1 → `kind 4` `Kumamon` /
  `619 damage!`; category 3 record 104 → `kind 4` `Kumamon` / `5280 damage!` (the shared
  body); category 4 record 189 → `kind 2` `Kotemon` / `HP gradually recovers.`; category 5
  record 198 → `kind 2` `Kumamon` / `Strength [arrow-up]!`. Unlike the drain check below,
  its captures **do** show the box, because the read is taken only once the session's own
  spec and its two drawn lines agree: `.bunny-scratch/shots/battle-damage-terms/term-4-189.png`
  is the category-4 record's page on screen, `Kotemon` over `HP gradually recovers.`, with
  the two HP plates above it — before this pass that same turn showed the walker's own
  `Kumamon took 9 damage!`. **Category 6 is asserted as a gap, not skipped** (§6 item 8).
* `tools/verify_battle_message_pages.mjs` — drives a real battle with the real draining
  signature weapon (item 173, `+0x35` proc / `+0x36` ratio) and reads the box's own state
  while the drain page is up: kind 18, `payload [0, 200, 0]`, `slots ["200"]`, and the
  two composed lines `Kotemon` / `200HP healed!`. `PAGES_LEGACY=1` reruns the same fight
  against `?legacyBattleMsg=1` and shows the walker's own `" Drained 200 HP!"` on one
  line — the BEFORE state. **The drain roll is pinned**: the check now stubs `Math.random`
  to 0 before the fight, which is the walker's own RNG (`RAND_U16` is
  `(Math.random() * 0x10000) | 0`, `engine/dw3/battle-formulas.ts:70`) and makes the
  attack land and the drain fire on the first attempt. Before this it retried up to eight
  times and could fail by chance, which is what happened once on 2026-10-04.
* **Not proved by a picture.** The verifier's `canvas#game` read lands a frame before the
  one the session state reports, so the captures in
  `.bunny-scratch/shots/battle-message-pages/` do **not** contain the box. The check
  therefore reads the session's own state, which is what the player is shown; a
  before/after screenshot of the drain page is **not** something this pass produced.
  `.bunny-scratch/shots/battle-item-announce/announce-02-effect-page.png` is the same box
  showing a kind-8 page, taken by the item-announce verifier.
## 9. The damage-term record machine (2026-10-04, second pass)

### 9.1 Where the 18-byte records come from

They are **the disc's technique table**, and it was already extracted before this pass.
`tools/extract_fight_tech_table.py` reads all 443 rows out of
`~/ddw3/rust/dw2003_exe_data/src/data.rs` (`D0x80042bdc: [Unknown3; 443]`, declared from
technique index 1, so technique *T* lives at `0x80042bca + 18 * T`) and ships them as
`web/assets/data/fight_tech_table.json`. **There is no code writer**: the machine only
ever *reads* the table, and the five categories are the only thing that reaches all 443
rows. The extractor's own header cites the field map at
`../fight-3d/tech-effects-decode.md`, and the same map is in
`3d-battle-complete-model-2026-08-19.md` §"The technique record".

Every field, with the reader that settles it:

| off | field | what it is | the read that settles it |
|---:|---|---|---|
| +0x00 | `mp` | MP cost | `lh` at `:10210` against the actor's MP |
| +0x02 | `power` | power | `battle-formula-leaves.md` §Physical |
| **+0x04** | `category` | **the attack category, 2..6** | `:13111 .L0x8008f974: lbu $v0, 0x4($s5)` then `sltiu $v0, $v1, 0x5` |
| +0x05 | `f3` | target byte (1..4) | `ststatus` F0x80093a58 tests `== 3` for a single target |
| +0x06 | `elemCtx` | the low half of the target halfword | `battle-formula-leaves.md` §Accuracy ("the halfword at +0x06") |
| **+0x07** | `elem1` | element 1, and **the field technique's word**: `elem1 + 0x61`, which for 213-219 is `esmfight[0x63]`-"[0x69]` "Fire field!" .. "Dark field!" | `:14075 .L0x80090884: lbu $v0, 0x7($s5)` / `:14077 .L0x8009088c: addiu $v0, 0x61` / `:11826 .L0x8008e59c: addiu $v0, 0x61` (the same shape, on the seven field ITEMS) |
| +0x08 | `scalar` | the per-skill scalar | `battle-formula-leaves.md` |
| +0x09 | `elem2` | element 2 (1..11) | `battle-formula-leaves.md` step 2 |
| **+0x0a** | `dispatch` | the special-op code; **0x1f picks the repeat arm** | `:13150 .L0x8008fa10: lbu $v1, 0xa($v0)` / `:13151 .L0x8008fa14: li $v0, 0x1f` / `:13152 .L0x8008fa18: bne $v1, $v0, .L0x8008fa50` |
| +0x0b | `f8` | a 7-bit mask | still unread |
| **+0x0c** | `crit` | the effect's own multiplier: `:12936 .L0x8008f6c4: lbu $a3, 0xc($s5)` / `:13759 .L0x80090394: mult $v0, $a3` | and `:14060 .L0x80090848: lbu $v1, 0xc($s5)` in the Blast gauge |
| +0x0d | `sigEffect` | the signature-effect slot | `special-attack-backdrop-decode.md` |
| +0x0e | `effect` | the effect type | `tech-effects-decode.md` |
| +0x0f | `motion` | the attack motion id | `renamon-motion-table-map.md` |
| **+0x10** | `clip` | the action-script clip; **clip 12 takes the "Skill" page** | `:13005 .L0x8008f7cc: lbu $v1, 0x10($s0)` / `:13006 .L0x8008f7d0: li $v0, 0xc` |
| +0x11 | `f14` | the hit count | `3d-battle-complete-model` §The technique record |

**The census over the shipped 443 rows:** 322 records of category 2, 80 of category 3,
16 of category 4, 18 of category 5 and 7 of category 6. Nothing outside 2..6 occurs, so
the `sltiu` bound rejects nothing in the disc's data and the census is exactly five.

### 9.2 The five handlers, named

`.L0x80083004` (`:203`-`:207`), indexed `category - 2`:

| category | handler | what it is | how many records |
|---:|---:|---|---:|
| 2 | `0x8008f9a8` (`:13124`) | **an ordinary physical attack** | 322 |
| 3 | `0x8008f9a8` (`:204` is a second copy of the same word) | **an ordinary magical attack** | 80 |
| 4 | `0x8008fbec` (`:13269`) | **the heal-and-cure family** | 16 |
| 5 | `0x8009021c` (`:13665`) | **the scripted family** — stat up/down, Chi, the flag refusals, the MP transfer, "Generating!" | 18 |
| 6 | `0x800907cc` (`:14029`) | **the seven field techniques** — 213-219 are `Fire Field` .. `Dark Field` in the shipped skill bank, and the page is `esmfight[elem1 + 0x61]`, the same words the seven field items print | 7 |

Categories 2 and 3 are the **same body, byte for byte** — that is why 402 of the 443
records reach one arm. Category 4's 16 members are technique 100, the five field heals
184-188, 189, the eight cures 190-197 and 375. Category 5's 18 members are 198-212, 391,
392 and 400.

**What the walker's ports read as words**, from the shipped English bank:
category 4 prints `HP gradually recovers.` (189), `Cured!` / `Defrost!` /
`Conscious!` / `All status cured!` (190/192/194/196, out of the four-word table at
`.L0x800a3460` = `[0x28, 0x29, 0x2a, 0x2c]`), `<n>HP healed!` (184-186, with the amount
capped at the missing HP), `No effect!` (the even cures when nothing matches), and nothing at
all for 100/375, the odd cures 191/193/195/197 and 187/188.
Category 5 prints `Strength / Defense / Speed [arrow-up]!` and the matching
`[arrow-down]!` words, `Saving Chi!`, `Can't run away!`, `Can't digivolve!`,
`<n> MP absorbed!` and `Generating!` — the stat words are the third halfword of the two
eight-byte tables at `.L0x800a33cc` (198, 200, 202, 204-208) and `.L0x800a3414`
(199, 201, 203), read at `:13777 .L0x800903dc: lh $v0, 0x6($s3)`.

**Category 4 is not the "damage-cap family" the previous revision's code implied, and a
heal is capped rather than refused.** The arms compare the technique id against 0x64 (100),
0xbd (189), 0xbe..0xc5 (190..197) and 0x177 (375) first (`:13272`-`:13284`), and the arm
they fall through to is `.L0x8008ff90`, which reads the technique's own heal amount from
`[0x800a4614]` (`:13516 lw $v0, 0x4614($v0)` / `:13518 .L0x8008ffd0: jalr $v0`) and compares
it with the target's missing HP — maximum at `roster + 0x08` minus current at `roster + 0x06`
(`:13568 .L0x80090098: lh $v1, 0x6($v0)` / `:13569 .L0x8009009c: lh $v0, 0x8($v0)` /
`:13571 .L0x800900a4: subu $v1, $v0`).

**The amount is capped at the missing HP, not refused.** `slt $v0, $a2, $v1` at `:13572
.L0x800900a8` and `move_ $a2, $v1` at `:13575 .L0x800900b4` put the missing HP in `$a2` when
the heal is larger, `slt $v0, $a0, $a2` at `:13577 .L0x800900bc` and `move_ $a2, $a0` at
`:13580 .L0x800900c8` put the heal back when it is smaller, and the page is **kind 8** in
both cases — `li $s0, 0x8` at `:13579 .L0x800900c4` — with the capped amount in word 2
(`:13581 .L0x800900cc: sw $a2, 0x5c($s4)`). So a 60-point heal on a target missing 10 heals
**10** and prints `10HP healed!`; there is no "No effect!" on this arm. The first version of
this section claimed the opposite and was wrong; the only `esmfight[0x2f]` on this handler is
the cure window's own refusal (`:13410 li $v0, 0x2f` → `:13413 li $a1, 0x1`).

`187` and `188` are split off by `slti $v1, 0xbb` at `:13523 .L0x8008ffe4` and take the
three-slot path instead: word 1 is 0 (`:13555`) and word 2 the amount capped at the largest
over-full gap (`:13549`/`:13551`/`:13554`/`:13557`), with `li $s0, 0x9` at `:13553`. With no
over-full slot, `beqz $a2, .L0x800900d4` at `:13547` builds **no page at all**.

The cure window also has a test the first version of this section did not mention: the even
half (190, 192, 194, 196) compares the target's ailment byte `lbu $v1, 0x1c($v1)` (`:13385
.L0x8008fdbc`) against the byte mask `.L0x800a3434[slot]` (`:13380 .L0x8008fdac` /
`:13382 .L0x8008fdb0`) with `and $v1, $v0` (`:13387 .L0x8008fdc4`). The table's first word is
`0x3f040201` (`:33881`), so the four masks are `0x01, 0x02, 0x04, 0x3f`. A match asks **kind
2** with the cure word; no match falls to `beqz $v1, .L0x8008fe20` (`:13388`) and asks **kind
1** with `esmfight[0x2f]` "No effect!". Nothing about capping damage.

### 9.3 Kind 16's event

**It is the record machine's second and later application of the same technique.** The
flag is `ctx+0x41`, set once the applier has run (`:27668` and `:28256`, at the end of
`FIGHTSTG_F0x8009d4b8` the multi-hit applier and `FIGHTSTG_F0x8009ddd8`). When it is set
and the record's `dispatch` byte is **not** 0x1f, the arm writes the **constant 31** into
payload word 0 (`:13151 .L0x8008fa14: li $v0, 0x1f` / `:13166 .L0x8008fa50: sw $v0, 0x64($s4)` — not the record's
byte), `ctx+0x28` into word 1 and `ctx+0x34` into word 2, and asks **kind 16**
(`:4595 li $a1, 0x10`). The kind-16 arm fills slots 1 and 2 from words 1 and 2 and slot 3
with their product (`:7244 lw $a2, 0x4($s2)` / `:7213 lw $v0, 0x8($s2)` / `:23914 .L0x80099e44: mult $a2, $v0
$a2, $v0` / `:23918 .L0x80099e54: mflo $s0` / `:23931 .L0x80099e88: move_ $a2, $s0`), so the player reads

```
<base damage> X <hits> = <base damage x hits>!
```

and `self+0x58` is that product clamped to 9999 (`:13186 .L0x8008faa0: bnez $v0, .L0x8008fb74` /
`:13187 .L0x8008faa4: li $v0, 0x270f`). The **only** technique whose `dispatch` byte *is* 0x1f is **406**, and it takes the other arm
instead (`:13152 .L0x8008fa18: bne $v1, $v0, .L0x8008fa50` not taken). That arm is still a
**damage page**: word 0 is the 0/16 side selector `sllv $v0, $s1, $a1` (`:13160
.L0x8008fa38`), word 1 is the running total `ctx+0x60 + ctx+0x64` (`:13154 .L0x8008fa20: lw
$v0, 0x60($s0)` / `:13155 .L0x8008fa24: lw $v1, 0x64($s0)` / `:13157 .L0x8008fa2c: addu $v0,
$v1` / `:13162 .L0x8008fa40: sw $v1, 0x68($s4)`), the kind is **4** — `li $a1, 0x4` at `:13156
.L0x8008fa28`, not the `li $a1, 0x2` of the evasion arm two hundred lines down — and it
reaches the shared call through `j .L0x8008fb64` at `:13164 .L0x8008fa48`. So the player
reads `<name>` / `<total> damage!`.

**This corrects the first version of this section**, which read `:13156 li $a1, 0x4` as a
kind 2 and then read the 0/16 selector as an `esmfight` index. The kind is 4, and the same
selector the hit arm writes into word 0 (`:13215 .L0x8008fb14: sll $v0, $s1, 0x4` / `:13216
.L0x8008fb18: sw $v0, 0x64($s4)`) is what makes the shared tail name the **target**: 16 for
the player's partner attacking, 0 for the enemy.

### 9.4 Kind 9's two helpers

* **`FIGHTSTG_F0x80098de0`** (`:22838`) is the **candidate scan**. It clears a counter at
  `self+0xa8` (`:22839 .L0x80098de4: sw $zr, 0xa8($a0)`), takes the side from `payload[0]`
  (`:22838 .L0x80098de0: lw $v0, ($a1)` / `:22841 .L0x80098dec: sltu $v0, $zr, $v0` /
  `:22842 .L0x80098df0: sll $v1, $v0, 0x1` / `:22843 .L0x80098df4: addu $v1, $v0` /
  `:22844 .L0x80098df8: sll $v1, 0x5` / `:22845 .L0x80098dfc: lui $v0, 0x800a` /
  `:22846 .L0x80098e00: addiu $v0, 0x4470`) and walks the three 0x20-byte combatant records
  (`:22859 .L0x80098e34: lh $v0, ($a2)` / `:22863 .L0x80098e44: lh $v1, 0x8($a2)` /
  `:22867 .L0x80098e54: lh $v0, 0x6($a2)` / `:22869 .L0x80098e5c: slt $v0, $v1, $v0`, the short
  form `slt $v0, $v0, $v1`, so current HP at `+0x06` below maximum at `+0x08`). For each such
  combatant it stores `payload[1]` into `self+0x9c[count]` and bumps the count
  (`:22872 .L0x80098e68: lw $v1, 0xa8($a0)` / `:22877 .L0x80098e7c: sw $a1, 0x9c($v0)` /
  `:22878 .L0x80098e80: sw $v1, 0xa8($a0)`). `payload[1] >= 10` skips the walk entirely
  (`:22848 .L0x80098e08: sltiu $v0, $a1, 0xa`) and dispatches through a ten-word table at
  `.L0x8008313c` instead.
* **`FIGHTSTG_F0x80099140`** (`:23077`) is the **apply pass**, and **it is not silent**. It
  reads the ring words at `$s8[0]` and `$s8[4]` (`:23099 .L0x80099194: lbu $s0, ($s8)` /
  `:23101 .L0x8009919c: lw $s7, 0x4($s8)`), resolves bank `0x7f` for the first
  (`:23100 .L0x80099198: lw $v0, 0x414($s2)` / `:23102 .L0x800991a0: jalr $v0` /
  `:23103 .L0x800991a4: addiu $a0, 0x7f`), and then sets **line two's own text to
  `esmfight[0x15]` "No items."** through the element's `+0x114` (`:23105 .L0x800991ac: lw $a0,
  ($s3)` / `:23107 .L0x800991b4: lw $v0, 0x114($a0)` / `:23109 .L0x800991bc: jalr $v0` /
  `:23110 .L0x800991c0: addiu $a2, 0x15` — the `jalr` delay slot beats the
  `lw $a2, 0xa8($s4)` at `:23106`). It then walks the recorded list (`:23121 .L0x800991ec: lw
  $a0, 0x9c($s0)`), calls one helper per candidate (`:23122 .L0x800991f0: lw $v0, 0x2718($s2)`
  / `:23124 .L0x800991f8: jalr $v0`) and, for every helper that did **not** return a negative
  value (`bltz $a0, .L0x80099238` at `:23127`), writes that combatant's own species name
  into the element's `+0x120` (`:23136 .L0x80099228: lw $v0, 0x120($a0)` /
  `:23138 .L0x80099230: jalr $v0` / `:23139 .L0x80099234: addiu $a3, $s1, 0x1`), then moves on
  (`:23142 .L0x80099240: slt $v0, $s1, $v0`). A second walk of the same list
  (`:23155 .L0x80099274: lw $v0, 0x9c($s2)`) does the same through bank `0x4e`
  (`:23173 .L0x800992bc: addiu $a0, 0x4e`).

So **§3's kind 9 row is wrong**: kind 9 does not "write no text". The arm itself issues no
element call, but its second helper writes `esmfight[0x15]` into line two. The walker has
no event that reaches it, so nothing was ported; the reading stands.

### 9.5 Kind 5 versus kind 3 — the two technique announcements

`FIGHTSTG_F0x8008ee84` step 0 is a technique announcement that asks **kind 5**. The three
instructions in front of it are

```
:12540 .L0x8008f0ac: lh $v0, 0x8($v0)     # the skill record's own name index
:12542 .L0x8008f0b4: sw $v0, 0x78($s1)     # self+0x78, the technique-NAME index
:12546 .L0x8008f0c4: lbu $v0, 0x70($s1)    # self+0x70, the technique's own word
:12547 .L0x8008f0c8: lw $v1, 0x78($s1)     # ... read back
:12549 .L0x8008f0d0: sw $v0, 0x50($s1)     # payload word 0
:12550 .L0x8008f0d4: sw $v1, 0x54($s1)     # payload word 1
:12551 .L0x8008f0d8: lw $a0, ($s3)         # the panel
:12552 .L0x8008f0dc: lw $a1, 0x10($s1)     # DEAD -- the delay slot overwrites it
:12553 .L0x8008f0e0: lw $v0, 0xac($a0)     # its +0xac method
:12554 .L0x8008f0e4: nop
:12555 .L0x8008f0e8: jalr $v0
:12556 addiu $a1, 0x5        # the kind, in the delay slot
```

**The `jalr` delay slot wins**, so the kind is 5 and the `lw $a1` is dead. So the box
reads `<name>` / `Counter! <technique>!` — `esmfight[0x16]` on line one and `esmfight[0x0a]`
`Counter! {1}!` on line two with the technique name in slot 1.

Kind 3's two sites are both in the attack-resolution sequencer `FIGHTSTG_F0x80090e84`
(`:14377` with `payload[0] = 0x10` at `:14372`, and `:14583`), so it reads `<name>` /
`<technique>!`. **The two words come from two different machines**, not from a choice
between two arms of one. Which techniques reach the kind-5 machine is **not established**
(§6 item 7).

The one caller I could read is the record machine's own **`ctx+0x42`** arm
(`:12992 .L0x8008f798: lw $v0, 0x445c($v0)` / `:13000 .L0x8008f7b8: jalr $v0` / `:12999 .L0x8008f7b4: li $a1, 0x68` is a
**memset of the whole action context**), which then asks **kind 3** with
`esmfight[0x3a]` "DNA DV!" when the record's clip byte is 12, and **kind 2** with
`esmfight[side]` otherwise (`:13005 .L0x8008f7cc: lbu $v1, 0x10($s0)` / `:13006 .L0x8008f7d0: li $v0, 0xc` /
`:13007 .L0x8008f7d4: bne $v1, $v0, .L0x8008f7f8` / `:13008 .L0x8008f7d8: li $a1, 0x3` / `:13010 .L0x8008f7e0: li $v0, 0x3a` /
`:13015 .L0x8008f7f4: li $a1, 0x2`). That is the **command-gate page**: the player's own Digimon
announced as "Fight" or its basic technique name.

### 9.6 Where the MP drain and the weapon curse live

* **The MP drain (kind 18 with `payload[2] != 0`) is technique 392**, the only
  category-5 member with `dispatch` 29. `.L0x80090654` does **not** walk the party
  (corrected 2026-10-05): `:13938 lw $a0, 0xc($v0)` is the **enemy's** active index and
  `:13939 lw $v1, 0x8($v0)` the **player's** — with `addiu $v0, 0x10` at `:13940` giving
  `0x80042bca + 0x10 = 0x800a4470`, so `$t0` is the PLAYER's record and `$a0` the
  ENEMY's (`addu $t0, $v1, $v0` `:13974`). It moves the source's own maximum MP
  (`lh $v1, 0xa($t0)` `:13950`) times `record[+0x0c]` over 128, capped at what the source
  has (`:13944 .L0x80090678: lh $a2, 0xc($t0)` / `:13946 .L0x80090680: beqz $a2,
  .L0x8009072c`, `:13951 .L0x80090694: mult $v1, $v0` / `:13954 .L0x800906a0: sra $a3, $v1, 0x7` / `:13957 .L0x800906ac: slt $v0, $a2, $a3`),
  adds it to the enemy's `+0x0c` (`:13969 .L0x800906c4: addu $v0, $a3` /
  `:13970 sh $v0, 0xc($a0)`), debits the player (`:13973 .L0x800906d4: subu $v0, $a3` /
  `:13974 sh $v0, 0xc($t0)`), clamps the receiver at its own `+0x0a` (`:13975`-`:13984`)
  and floors the source at 0 (`:13987`-`:13991`). It writes word 0 = the
  source's remaining MP or 0x10, word 1 = the amount moved and word 2 = **1**
  (`:13980 .L0x80090708: li $v0, 0x10` / `:13982 .L0x80090710: sw $v0, 0x64($s4)` /
  `:13984 .L0x80090718: sw $a3, 0x68($s4)` / `:13983 .L0x80090714: li $v0, 0x1` /
  `:13985 .L0x8009071c: sw $v0, 0x6c($s4)`), and asks **kind 18** — `li $a1, 0x12` at `:13988
  .L0x80090728` is the delay slot of `j .L0x800907b4` at `:13987 .L0x80090724`. Payload word 2 being non-zero is exactly what
  selects `esmfight[0x8f]` `{1} MP absorbed!` over `esmfight[0x22]` in the kind-18 arm
  (`:23975 lw $v0, 0x8($s2)` / `:23977 bnez`).
* **The three refusals in this handler are ROLLS, not story flags** (corrected
  2026-10-05; the full reading is `battle-formula-leaves.md` §3b). The words at
  `0x800a4640` / `0x800a4648` / `0x800a464c` are FUNCTION POINTERS — `:35036`-`:35039`
  `.word 0x800a13c0 / 0x800a1458 / 0x800a1508 / 0x800a1558` — and each body is
  `(rand & 0x7f) < record[+0x0B]` for the technique id the arm's delay slot names, so
  211 "Can't run away!", 212 "Can't digivolve!" and 391's silence each land 80/128,
  80/128 and 96/128 of the time — and a lost roll puts the getter's own zero into word 0
  (`sw $v0, 0x64($s4)` `:13896`), which kind 1 reads as the EMPTY `esmfight[0x00]`, a
  blank box, never `esmfight[0x2f]` "No effect!".
* **The weapon curse (kind 19) is unchanged** by this pass: the only writer of its
  0/1/2 payload word is the stat-bit test in `FIGHTSTG_F0x80091534` (`:15093`-`:15107`),
  and the walker's signature weapons do not curse a stat. Not ported.

### 9.7 What shipped

`engine/dw3/battle-damage-terms.ts` is the port: the record contract, the five-word
dispatch table, all five handlers' page choices, the per-technique arm tables for the two
hand-written categories (`DAMAGE_TERM_ARMS_CATEGORY4`, `DAMAGE_TERM_ARMS_CATEGORY5`), the
decoded stat-word table, and `damageTermCategoriesIn()` for the census.
`web/battle.js`'s `damageSpec` now goes through it, so the hit page is the record
machine's and **the walker's own `"(N hits)"` tally no longer forces a typed sentence into
the box** — the original's `kind 4` arm writes no hit count anywhere, so there was never a
hit count for the box to show.

`tests/battle-damage-terms.test.js` is the census and the per-category page check: the
dispatch table equals the assembly's five words; every category in the shipped 443 records
has a handler; `sltiu` rejects everything outside 2..6; every technique of categories 4 and
5 is on exactly one arm and the arm list equals the disc's own id list; and each category's
page composes to the shipped English bank's words. `tests/battle-message-saywalker-census.test.js`
holds the remaining typed lines, and §7's table is their row list.

**2026-10-05: the category-5 family is the WHOLE of it now.** §9.6's corrections above
changed three page choices (the two roll arms' blank line, the three party-wide stat ids'
kind 9, and 392's direction), and `battle-formula-leaves.md` §3b carries the per-record
census. `engine/dw3/battle-damage-terms.ts` holds all eight arms with their writes, and
`web/battle.js::battleScriptedPlanFor` is the one entry point both sides call.
`tests/battle-category5-scripted.test.js` is the census plus one behaviour test per arm.
**Still not here, and named:** §9.4's kind-9 line two (`esmfight[0x15]` "No items.") — the
walker's kind-9 arm draws nothing, which is why the category-4 party heal's check asserts
the KIND only. That is the kind-9 arm itself, shared with the cure window, and it is its
own job.

---

## 10. What starts a technique's result, and why seventeen of them had none

### 10.1 The trigger is the record, and the answer to "which of the three" is "none of them"

The three candidates were the action script's strike opcode, the script's end, and the
attack-resolution sequencer `FIGHTSTG_F0x80090e84`. Each is ruled out by its own
instructions.

**The strike opcode is presentation.** `FIGHTSTG_F0x8008c454` is the action VM's op10. It
reads the attacker's active part (`+0x94` indexing the part array at `+0x58`, reading
`+0x70`) for the two contact types `0x62`/`0x63` and spawns an effect through
`FIGHTSTG_F0x8009b774`; it reads nothing of the technique table and calls nothing of the
record machine.

**The sequencer does not call the record machine either.** `FIGHTSTG_F0x80090e84`
(`fightstg.s:14470`-`:14883`) is itself a *step* of the same technique-execution object —
it dispatches on `self+0x0c` (`:14485`) and its own tail writes the next step with
`sw $s0, 0xc($s1)` (`:14881`). Its complete `jal` list over those 414 lines is
`FIGHTSTG_F0x8009a298` (the page object, five times), `0x800aa1f0` / `0x800aa9f0` /
`0x800aa110` (sounds), `FIGHTSTG_F0x8009c4f8`, `FIGHTSTG_F0x8009cf54` (twice),
`FIGHTSTG_F0x80091b54` (the weapon object) and `FIGHTSTG_F0x8009d0ec`. The record machine
is not among them, and what it does at the end of a landed attack is hand the attack to
the workspace instruction queue (`FIGHTSTG_F0x8009d0ec`, `:14876`, which appends the
instruction with id `0x18`) and then idle in its own step 3 (`:14493`-`:14498`: state 3
returns without touching `self+0x0c`).

**So the trigger is the technique's own step, and its gate is one byte of the record.**
The apply arm of the record machine reads the technique id off `self+0x54`, forms
`0x80042bca + 18 * id`, reads `record +0x04`, and dispatches through the five-word table —
`fightstg.s:13096 lw $v0, 0x54($s4)` / `:13099 sll $v1, $v0, 0x3` / `:13100 addu $v1, $v0` /
`:13101 sll $v1, 0x1` / `:13102 lui $v0, 0x8004` / `:13103 addiu $v0, 0x2bca` /
`:13104 addu $s5, $v1, $v0` / `:13111 lbu $v0, 0x4($s5)` / `:13114 sltiu $v0, $v1, 0x5` /
`:13115 beqz $v0, .L0x80090c1c` / `:13118 sll $v1, 0x2` / `:13122 jr $v0`. **Record
`+0x10`, the action clip, appears nowhere on that path.** Whatever the animation does, the
record machine runs.

**What I did not establish:** the instruction inside `wfightmn`'s state-24 handler that
enters that step. The handler is reached — `FIGHTSTG_F0x8009d0ec` enqueues instruction id
`0x18` (`:27330 li $a0, 0x18`), `wfightmn.s:4044`-`:4048` maps a state to
`word[0x800aade4 + 4*(state-3)]`, and index 21 of that table is `0x800a97bc`
(`wfightmn.s:5132`+`21*4`, file `0x5054`), which dispatches its five sub-states through the
table at `0x800a5e54` (`wfightmn.s:3711`-`:3718`) — but the pointer `0x8008f714` appears
**nowhere but its own definition**: `grep -rn "8008f714" ~/ddw3/asm/dw2003/` returns the one
line, and the extracted executable data (`~/ddw3/rust/dw2003_exe_data/src/data.rs`, the
image that holds the technique table itself) holds no word in `0x8008f7xx`. So the last
link is read here as "the technique's own step", not as a named caller, and it is recorded
as unread rather than guessed.

### 10.2 The population: SEVENTEEN techniques, not seven

Reading every shipped `anim.json` (`web/assets/battle/models/*/anim.json`, 246 model
directories, 4,428 clip scripts) and asking each script whether it contains `op10` with
`words[0] === 99` — the strike the VM's `justHit` names — gives the partition. **Two clips
fire no strike in any model that ships them:**

| clip | models with a script | of those, with a strike | techniques on it |
|---|---|---|---|
| **12** | 23 | **0** | 374-380, 432-434 (10) |
| **15** | 53 | **0** | 213-219 (7) |

Clip 15 is the field technique, and its script is `op4 / op4 / wait 90 / op4 / wait 60 /
op255` — no `op10` at all. **Clip 12 is the big-attack cinematic** and the earlier revision
of this document missed it: its only `op10` is type `66`, a non-contact effect, in all 23
models (`m005grey/anim.json`, `m056digi/anim.json` and the rest). It also matters for the
delivered game that **none of clip 12's ten records is in the shipped skill bank**
(`web/assets/data/digimon.json` -> `skills[]` names ids from the clip-5, 6, 8, 9, 10, 11,
13, 15 and 16 sets only), so no player can pick one off the Tech list today; the seven
field techniques can, and `tools/verify_battle_damage_terms.mjs` now drives Fire Field.

Four further clips are only strike-less **per model**: clip 9 in 5 models, clip 10 in 16,
clip 11 in 1, clip 16 in 2. A fifth case is the empty script — 4 models ship clip 5 empty —
which `ActorAnimator.setAction` already answers by reporting no start
(`web/fight/actor-animator.js`, `this.setIdle(); return false`).

`tests/battle-technique-result-paths.test.js` holds this as a census over all 443 rows:
it partitions the rows by the clip the record names and by whether that clip can strike at
all, and asserts **both** partitions are non-empty and fully decided.

### 10.3 `[0x800a4614]` is one routine, not a table, and the amount is decoded

§9.2 and §6 item 7 called `[0x800a4614]` a table the walker had not extracted. It is not:
`fightstg.s:35025 .L0x800a4614: .word 0x800a0108` is a single word, entry 5 of the
quantity-getter table that begins at `fightstg.s:35020 .L0x800a4600: .word 0x8009ec94`.
The category-4 arm calls through it — `:13513 lui $v0, 0x800a` / `:13514 lbu $a0, 0x50($s4)`
/ `:13515 lw $a1, 0x54($s4)` / `:13516 lw $v0, 0x4614($v0)` / `:13518 jalr $v0` — and
`FIGHTSTG_F0x800a0108` (`:30517`) is:

```
:30519 .L0x800a0110: move_ $s0, $a1            # the technique id
:30533 .L0x800a0148: sll $v0, $s0, 0x3         # id * 8
:30534 .L0x800a014c: addu $v0, $s0             # + id   = id * 9
:30535 .L0x800a0150: sll $v0, 0x1              # * 2    = id * 18
:30537 .L0x800a0158: addiu $v1, 0x2bca         # 0x80042bca
:30538 .L0x800a015c: addu $v0, $v1             # the record
:30539 .L0x800a0160: lhu $v1, 0x2($v0)         # record +0x02, the POWER
:30540 .L0x800a0164: lh $v0, 0x4588($a0)       # effective stat block +0x08
:30542 .L0x800a016c: mult $v0, $v1             # wisdom * power
:30543 .L0x800a0170: mflo $v0
:30544 .L0x800a0174: bgez $v0, .L0x800a0180
:30545 .L0x800a0178: sll $v1, 0x6              # DELAY SLOT: power * 64, both sides
:30546 .L0x800a017c: addiu $v0, 0x7            # only when negative: bgez skips it
:30547 .L0x800a0180: sra $v0, 0x3              # / 8
:30548 .L0x800a0184: addu $v1, $v0             # the amount
:30549 .L0x800a0188: slti $v0, $v1, 0x2710
:30550 .L0x800a018c: bnez $v0, .L0x800a0198
:30552 .L0x800a0194: li $v1, 0x270f             # otherwise 9999
```

**`amount = (power << 6) + (wisdom * power) / 8`, the divide truncating toward zero (the `+ 7` runs only for a negative product, because `bgez` jumps over it), capped at 9999.** (Lead correction 2026-10-04: the helper first read the `+ 7` as a round-up on every path.) `sll $v1, 0x6` is
in the delay slot of `bgez`, so the power term is added on both sides of the branch.
`0x800a4588` is `+0x08` of the effective stat block `FIGHTSTG_F0x8009ec94` builds, which
carries five core stats at `+0x02 .. +0x0a` (`:29325 sh $v1, 0x2($a0)`, five iterations to
`:29330 slti $v0, $s1, 0x5`); `+0x0a` is independently confirmed as SPEED, so `+0x08` is
**WISDOM**. The walker has wisdom, so this is ported
(`damageTermHealAmount(record.power, actor.wis)`), and the same arm's heal application is
ported with it: `:13568 lh $v1, 0x6($v0)` / `:13569 lh $v0, 0x8($v0)` / `:13571 subu $v1,
$v0` is `MAXIMUM - CURRENT`, capped at `:13572`-`:13580`, the capped amount stored at
`:13581 sw $a2, 0x5c($s4)`, and the heal applied at `:13640 lh $v0, 0x8($a1)` /
`:13641 lh $v1, 0x6($a1)` / `:13651 sh $v0, 0x8($a1)`.

**That last pair also corrects §9.2**, which read the two roster offsets the other way round
("maximum at `roster + 0x08` minus current at `roster + 0x06`"). The heal the same arm
applies reads its cap from `+0x06` and stores into `+0x08`, so `+0x06` is the maximum and
`+0x08` the current HP. The missing-HP subtraction at `:13571` is `MAXIMUM - CURRENT`, which
is the only reading under which the cap is ever positive.

### 10.4 What shipped, and what is still open

`web/battle.js` gained one shared rule instead of seventeen exceptions:
`armPendingImpact(b, commit)` / `commitPendingImpact(b)`. All three `commitImpact` sites —
the basic attack, the player's technique and the enemy's — arm before the attack starts, and
the `ST.RESULT_MSG` tick commits an armed result **as soon as no action is playing**. The
strike stays the early commit, so a technique that lands on a blow still puts its page up at
the blow. No technique can lose its page now, and no technique's page waits for an animation
that does not exist.

**Open, and named** — the first two were open when this section was written and are closed in
**§11**:

* ~~**Techniques 187-188** heal the three party slots rather than the actor.~~ **Closed in
  §11.3.** The three-slot walk at `:13602`-`:13633` is ported, and so is the amount cap that
  goes with it.
* ~~**Whether a category-4 heal rolls for accuracy at all.**~~ **Closed in §11.0.** The
  applier `FIGHTSTG_F0x8009e0cc` reads the category byte at `:28463` and reaches the accuracy
  getters for categories 2 and 3 only (`:28465` / `:28467`), so a heal or a cure cannot miss.
  This paragraph was right that the announce step at `:12987`-`:12989` settles nothing — the
  applier is the other question, and it is answered.
* **`FIGHTSTG_F0x8008ee84`'s kind-5 announcement** (the "Counter! {1}!" page, §6 item 3) is
  still reached through no named caller.

Checks: `tests/battle-technique-result-paths.test.js` (the 443-row census, the clip
partition, the heal formula), `tools/verify_battle_damage_terms.mjs` (six categories driven
in play, the field technique now included), `tools/verify_battle_message_pages.mjs`,
`tools/verify_first_story_battle.mjs` and, for the heal arm itself,
`tools/verify_category4_restore.mjs` (§11).

## 11. Category 4, the whole heal-and-cure arm (2026-10-04, third pass)

### 11.0 Answer first

Sixteen of the game's techniques never hit anything. Sixteen is the **whole** population:
read straight out of the shipped records, exactly those sixteen say the attack category is 4.
`0x8008fbec` picks between **six** arms using five comparisons on the technique number and
nothing else, and this pass has every one of them ported on **both** sides of a battle:

| arm | techniques | what a player sees |
|---|---|---|
| `0x8008fe94` | 100 | nothing in the box; every party member on the floor gets their full HP back |
| `0x8008fc38` | 189 | `<name>` / `HP gradually recovers.` |
| `0x8008fca8` | 190, 192, 194, 196 | `<name>` / `Cured!`, `Defrost!`, `Conscious!`, `All status cured!` — or `No effect!` when the *active* member is clean, while the rest of the party is cured anyway |
| `0x8008fca8` | 191, 193, 195, 197 | nothing in the box; every **standing** party member carrying the ailment is cured |
| `0x8008ff10` | 375 | nothing in the box; the whole party is filled and every ailment is gone |
| `0x80090070` | 184, 185, 186 | `<name>` / `<n>HP healed!`, where `<n>` never exceeds the wound |
| `0x8008fff8` | 187, 188 | nothing in the box; **every standing** party member is healed, not just the one that acted |

Two facts the earlier two passes had backwards, both settled here:

* **A heal or a cure cannot miss.** The applier `FIGHTSTG_F0x8009e0cc` reads the record's own
  category byte and reaches the accuracy getters for categories **2 and 3 only**
  (fightstg.s:28463 `lbu $v1, 0x4($s4)` / :28465 / :28467 `beq`), sending every other
  category — 4 included — down a roll-free path at `:28468`-`:28470`. §10.4 called this open
  and said the walker keeps its own roll; it does not any more, because a category-4 technique
  never enters the attack resolver at all.
* **A heal too big for the wound does not read "No effect!".** A branch **delay slot runs
  whether or not the branch is taken**, and `li $s0, 0x8` (`:13579`) is the delay slot of the
  `beqz` at `:13578`. It therefore always loads, and the box always asks kind 8 once there is
  a wound to close; what `slt $v0, $a0, $a2` (`:13577`) actually chooses is only which number
  goes in — the raw amount or the missing HP. Same for `li $s0, 0x9` (`:13553`) on the party
  arm. A 2026-10-04 reading of this handler took both for conditional loads and had a big
  heal answering "No effect!"; it does not. The **only** two passes that answer "No effect!"
  are a heal arm with nothing missing at all (`:13576` / `:13547`, which leave `$s0` at the
  `-1` its own delay slot loaded at `:13519`, so the shared tail asks kind 2 with
  `esmfight[0x2f]` at `:13654`/`:13658`), and the even half of the cure window whose active
  member is clean (`:13388` / `:13410` / `:13413`).

### 11.1 The classifier, which is five instructions long

```
:13269 .L0x8008fbec: lbu $v0, 0x50($s4)     # the SIDE
:13270 .L0x8008fbf0: lw $v1, 0x54($s4)     # the technique id
:13271 .L0x8008fbf4: sw $v0, 0x64($s4)     # payload word 0 = the side
:13272 .L0x8008fbf8: slti $v0, $v1, 0xc6
:13273 .L0x8008fbfc: beqz $v0, .L0x8008fc24  #   >= 198 -> the 375 test
:13274 .L0x8008fc00: slti $v0, $v1, 0xbe
:13275 .L0x8008fc04: beqz $v0, .L0x8008fca8  #   >= 190 -> the cure window
:13276 .L0x8008fc08: li $v0, 0x64             # 100
:13277 .L0x8008fc0c: beq $v1, $v0, .L0x8008fe94
:13278 .L0x8008fc10: li $v0, 0xbd             # 189
:13279 .L0x8008fc14: beq $v1, $v0, .L0x8008fc38
:13283 .L0x8008fc24: li $v0, 0x177            # 375, on the >= 198 path
:13284 .L0x8008fc28: beq $v1, $v0, .L0x8008ff10
:13281 .L0x8008fc1c: j  .L0x8008ff90           # everything else
:13286 .L0x8008fc30: j  .L0x8008ff90           # ... and everything else above 198
```

Those five comparisons are the ONLY ones in the routine — nothing looks at the category again,
nothing looks at the record's power, and there is no per-technique row anywhere. The two
`lui $v0, 0x800a` at `:13280` and `:13285` are what make `$v0` (and so `$s1` on the heal arm)
come out right. The eight-word table at `.L0x8008301c` (`:209`-`:216`) then gives the cure
window its slot, `0,0,1,1,2,2,3,3` for ids 190..197, and `andi $v0, 0x1` over the id
(`:13353`) splits each pair into an even half and an odd half.

### 11.2 The three slots, and which number is the maximum

Each side keeps three **0x20-stride** combatant records: `0x800a4470` for the player and
`0x800a44d0` for the enemy, which is `0x800a4470 + side * 0x60` (the cure window builds it that
way at `:13336`-`:13338`, and the heal arm's enemy base is `addiu $s1, $v0, 0x4470` `:13505` /
`addiu $s1, 0x60` `:13506`). Inside one record:

| offset | what | read at |
|---|---|---|
| `+0x00` | "this slot holds a Digimon" | `lh $v0, ($a0)` `:13528`, `:12896`, `:26413` |
| `+0x06` | **maximum** HP | `lhu $v0, 0x6($a0)` `:13536`, `:13568`, `:13645` |
| `+0x08` | **current** HP | `lh $v1, 0x8($a0)` `:13532`, `:13569`, `:13652` |
| `+0x1c` | the ailment bitmask | `lbu $v1, 0x1c($v1)` `:13385`, `lbu $v0, 0x1c($a2)` `:26420` |

The side's **active** index is `[0x800a4460 + 8 + side * 4]`'s word 8 (`:13560`-`:13564`,
and the same at `:13376`-`:13378`), and the record it names is reached by `sll $v0, $a1, 0x5`
(`:13566`) — the `0x20` stride again.

**Which side a technique acts on.** Technique 100 and technique 375 write `sw $zr, 0x64($s4)`
(`:13480`) and walk `0x800a4470` outright (`addiu $a0, $v0, 0x4470` `:13443`, and
`FIGHTSTG_F0x8008f5d4` builds `$s6 = 0x800a4470` at `:12883`), so they restore the **player's**
party whichever side cast them. Every other arm acts on the **casting** side, from
`lbu $v0, 0x50($s4)`.

### 11.3 Arm by arm

**100, `0x8008fe94` — put the fallen ones back on their feet.** Step 0 builds the panel, puts 0
in word 0 and 5 in word 1 (`li $v0, 0x5` `:13451`, the delay slot of `j .L0x8008ff38`), and
asks kind 9 (`:13483`). Step 1 walks the player's three slots (`:13452`-`:13467`), skipping a
slot that holds nothing (`lh $v0, ($s0)` `:13453` / `beqz` `:13455`), skipping one already
standing (`lh $v0, 0x8($s0)` `:13457` / `bnez` `:13459`), and giving the rest their maximum
from `+0x06` (`:13461`) into `+0x08` (`:13463`, that store is the delay slot of the
`jal 0x800a6920` at `:13462`). It touches **no** ailment.

**375, `0x8008ff10` — best condition.** Same page shape, word 1 = 6 (`li $v0, 0x6` `:13479`).
Step 1 calls `FIGHTSTG_F0x8008f5d4` on slot indices 0, 1 and 2 (`:13494`-`:13498`). That helper
skips an empty slot (`:12896`/`:12898`), cancels **six** pending status events read a word at a
time out of `.L0x800a3438` = `[9, 10, 11, 12, 16, 17]` (`:33882`-`:33887`; `lw $a0, ($s0)`
`:12906`, `slti $v0, $s1, 0x6` `:12919`), zeroes the **whole** ailment byte (`sb $zr,
0x1c($s0)` `:12933`) and fills HP from `+0x06` (`:12931` / `:12934`).

**189, `0x8008fc38` — Auto Recover.** It does not touch HP itself. It stages the status event
(`FIGHTSTG_F0x8009c5e8(side)` `:13289`, whose technique field is 189 — `li $v0, 0xbd` `:26602`
/ `sw $v0, 0x10($a0)` `:26603` — aimed at the active slot, `lw $v1, 0x8($v0)` `:26601`) and the
roster event (`FIGHTSTG_F0x8009c6a4(roster, 189)` `:13299`, event code 6, `li $a0, 0x6`
`:26622`). The page is `esmfight[0x27]` `HP gradually recovers.` in word 0 (`:13305`) with the
side in word 1 (`:13307`), kind 2 (`:13309`).

**The cure window, `0x8008fca8`, 190..197.** Two halves, and they differ in more than the page.

*The even half (190, 192, 194, 196).* The page tests the **active** record's ailment byte
against `.L0x800a3434` = the bytes `0x01, 0x02, 0x04, 0x3f` (`:33881`; `lbu $v0, ($v0)`
`:13382`, `lbu $v1, 0x1c($v1)` `:13385`, `and $v1, $v0` `:13387`). A match asks kind 2 with
`.L0x800a3460[slot]` = `[0x28, 0x29, 0x2a, 0x2c]` (`:33892`-`:33895`, read at `:13390`-`:13393`,
`li $a1, 0x2` `:13401`); a miss falls to `beqz $v1, .L0x8008fe20` (`:13388`) and asks **kind 1**
with `esmfight[0x2f]` (`:13410` / `:13413`). But **the cure runs either way**: step 1
(`:13420`) is a separate step from the page, and it calls `FIGHTSTG_F0x8009c330` on slot indices
0, 1 and 2 (`:13433`/`:13434`). That helper skips only an **empty** slot (`lh $v0, ($a2)`
`:26413` / `beqz` `:26415`) — it does **not** test current HP, so it cures a fallen member too —
and clears the bit `.L0x800a43dc[slot]` = `0x3f040201` reads as a **byte** (`:26417`-`:26425`).

*The odd half (191, 193, 195, 197).* Word 0 is the side (`:13356`/`:13358`), word 1 is
`.L0x800a3450[slot]` = `[1, 2, 3, 4]` (`:33888`-`:33891`, read at `:13357`-`:13363`), and the page
is **kind 9** (`:13365`). The arm then leaves through `.L0x80090c1c`, its own epilogue, so it
never runs `FIGHTSTG_F0x8009c330` at all. The cure is the **page's own scan**: kind 9's arm
(`.L0x80099a04`, `:23642`-`:23649`) hands the payload to `FIGHTSTG_F0x80098de0` (the candidate
scan) and `FIGHTSTG_F0x80099140` (the apply pass), and word 1 picks row `slot + 1` of the
ten-row table at `.L0x8008313c` (`:281`-`:290`). Those rows are, in order: the damaged scan
(`slt $v0, $v1, $v0` `:22869`), poisoned, frozen, confused, **any** ailment (`beqz $v0` `:22989`
— the whole byte, not a bit), the fallen scan (`bnez $v0` `:23014` skips a living record),
present-only, and present-and-alive three times. Rows 1-4 also require current HP non-zero, so
a **fallen** member is never cured by the odd half, unlike the even half's.

**184..186, `0x80090070` — the acting Digimon's own heal.** The amount comes from ONE routine:
`[0x800a4614]` is a single word (`:35025`) holding `0x800a0108` (`lw $v0, 0x4614($v0)`
`:13516` / `jalr` `:13518`), which returns `(power << 6) + (wisdom * power) / 8` where the
divide adds 7 **only when the product is negative** (`bgez $v0, .L0x800a0180` `:30544` jumps
over `addiu $v0, 0x7` `:30546`, then `sra $v0, 0x3` `:30547`), capped at 9999 (`slti $v0, $v1,
0x2710` `:30549` / `li $v1, 0x270f` `:30552`). Wisdom is the effective stat block's fourth core
stat, `lh $v0, 0x4588($a0)` `:30540`. The arm then caps that at the active record's
`max - current` and asks kind 8 with the smaller of the two (see 11.0), and applies the same
number at `:13630`-`:13652`, holding the result at the maximum read from `+0x06` (`:13645` /
`:13646`).

**187, 188, `0x8008fff8` — the party heal.** The walk keeps the **largest** `max - current`
over the three slots that are present **and** standing (`:13528`-`:13546`), and the page is
kind 9 with word 1 = 0 (`:13555`) and word 2 that capped amount (`:13557`). The apply at
`:13602`-`:13633` adds `ctx+0x5c` — which on this path is still the **raw** amount, because the
`sw $a0, 0x5c($s4)` at `:13525` is the delay slot of the split `bnez $v1, .L0x80090070` at
`:13524` and the capping `sw $a2, 0x5c($s4)` at `:13581` is on the other arm — to every slot
that is present and standing, holding each at its own maximum.

### 11.4 What the box actually draws for the kind-9 arms

100, 187, 188, 375 and the odd half of the cure window all ask **kind 9**, whose own arm writes
no text of its own: it copies the payload into the step ring and calls the two helpers
(`:23642`-`:23649`). The apply pass's last act is a ten-row dispatch on payload word 1
(`sltiu $v0, $s7, 0xa` `:23186`, table `.L0x80083164` `:291`-`:300`) that sets line two's text
to `esmfight[0x22]`, `[0x28]`, `[0x29]`, `[0x2a]`, `[0x2c]`, `[0x2d]`, `[0x2e]`, `[0x30]`,
`[0x31]`, `[0x32]` (`:23208`, `:23225`, `:23237`, `:23249`, `:23261`, `:23273`, `:23285`,
`:23297`, `:23309`, `:23320`) — index 0 alone also writes payload word 2 into it as a number
(`lw $a2, 0x8($s8)` `:23210`). That is why the port carries the ring words: **the heal the party
arm shows a player is the amount the page would name, capped at the worst-off member's
missing HP.**

But the arm then lands on `.L0x8009a204` (`:23649`), which calls the line object's `+0x144`
method with `$a1 = 0` on **both** lines (`:24154`-`:24165`). `+0x144` is `F0x8001a23c`
`setTextElementFlagC1`, whose whole body is "(s16)[62] != 0 : [c1] = v else [c1] = 0"
(`engine/dw3/ui/text-element-setters.ts`), and this document has read it since §9.4 as hiding
both lines. **This pass did not re-decide that** — the port leaves kind 9 drawing nothing, as it
did before, and only makes the payload carry the words the original wrote. §9.4's reading
still stands, and it is still the one open question this document has about kind 9.

### 11.5 What shipped, and what is still not here

The port is `category4RestorePlan` / `damageTermCategory4Arm` in
`engine/dw3/battle-damage-terms.ts`, and both sides of the battle call it through one gate in
`web/battle.js` (`battleRestorePlanFor`, at the player's technique and at the enemy's). A
category-4 technique therefore never reaches `resolveAttack`, never rolls for accuracy, and
never damages the other side. The walker's three party members are the original's three combatant
records, in `b.playerRecords[0..2]` order — the same order the HP plate's three pips read.

**Not done, and named:**

* **The enemy side has one record, not three.** The walker models a single enemy fighter, as
  record 0; slots 1 and 2 of the enemy's `0x800a44d0` read as empty, which is exactly what the
  original's walk does with a slot that holds no Digimon. So a party-wide enemy heal touches
  the one fighter the walker has.
* **`$s1` on the heal arm's side-0 path is not set by this routine.** `beqz $v1, .L0x8008ffa4`
  (`:13504`) skips the `addiu $s1, $v0, 0x4470` / `addiu $s1, 0x60` pair (`:13505`-`:13506`),
  and nothing between the routine's prologue (`:12958`-`:12968`, which only **saves** `$s1`) and
  that test writes it — the only other writes on the whole path are the side flags at `:13133`
  and `:13302`, which are 0/1, not pointers. Every other arm in the handler walks `0x800a4470`
  outright, so the port uses the player base for side 0. That is an **inference from the other
  arms**, not something the instruction stream states for this one, and it is not established
  what the caller actually leaves in `$s1`.
* **Kind 9's visibility** is §6 item 5, unchanged.

Checks: `tests/battle-category4-restore.test.js` (the census, all six arms, both sides),
`tests/battle-damage-terms.test.js` (the summary API), `tests/battle-technique-result-paths.test.js`
(the heal getter), and in real play `tools/verify_category4_restore.mjs` — which drives five of
the disc's own techniques through the shipped command and Tech lists and reads the three party
records back: 188 fills all three standing members, 186 fills the actor and prints
`820HP healed!` for an 820-point wound, 191 cures both poisoned members and leaves the clean one,
196 clears every ailment off two members, 100 puts the fallen member back on its feet without
touching its own ailment. Also `tools/verify_battle_damage_terms.mjs`,
`tools/verify_battle_message_pages.mjs`, `tools/verify_first_story_battle.mjs`.

## 12. The enemy's attack announcement plate (2026-10-07)

**Answer first: the kind-2 attack plate is a SHARED page, and only the player's side
reached it.** `FIGHTSTG_F0x80090e84`, the attack-resolution sequencer, builds kind 2 with
payload word 0 = `0x08` (`esmfight[0x08]` "Attack!") for whichever fighter swings
(`pro/fightstg.s:14548`-`:14556`); the shared tail names the acting side. The walker put
that page up only from the player's own command confirm (`confirmCommand` /
`confirmJokePick`), so a player choosing Fight announced itself and an enemy's ordinary
attack did not — the enemy action never called the plate at all. A named technique
already had its own page (`kind 3`, `enemyTechniqueSpec`), which is why the gap showed
only on an ordinary enemy attack.

What shipped: one builder `attackPageSpec(name)` (exported, next to `evadePageSpec`), the
inner `attackSpec(b, name)` reduced to a call on it, and `applyEnemyAction` now announces
its basic attack through it before the damage page — `if (!skillName) sayOriginal(b,
attackSpec(b, name), ...)`, gated on the basic-attack word so a technique keeps its
kind-3 page. The enemy's MISS now also prints the box's own evasion page (the shared
`evadeSpec`, `esmfight[0x1d]` "Evade!"), where it used to leave a typed sentence.

A player sees, before the fix: the enemy attacks and the box shows only
`<defender>` / `<n> damage!`. After: `<enemy>` / `Attack!` while the enemy swings, then
the damage page. Checks: `tests/battle-enemy-attack-plate.test.js` (fails on the branch
tip — `attackPageSpec` did not exist and `applyEnemyAction` carried no such call) and the
probe captures in `captures/playtest-2026-10-07-you/`. The canvas read lags the session
state by a frame (the caveat already recorded in §8), so the definitive read is the
session's page sequence `peek()` reports, which is what the box is opened from.
