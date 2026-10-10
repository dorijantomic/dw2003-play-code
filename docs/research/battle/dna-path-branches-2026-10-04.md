---
reach: Changing or checking DNA Digivolve refusals, cancels, partner admission, Blast gating, forced replacement, or the DNA action return; frontier DNA-Q001.
status: canonical
---

# DNA refusal and cancellation path

Claim `dna-path-answer-decode-and-branches` and claim
`dna-path-refusals-and-cancels` remain **partially_verified**. This is a static
assembly decode with browser checks and isolated original-code execution tests;
no emulator was started. Original-game statements below are the proposed claims,
with exact source quotes. The prior pane, recipes, price and clip-12 presentation
are preserved; their authority is
[the complete model §10f–g](digivolution-tech-system-decoded-2026-07-11.md)
and [the presentation decode](captures/dna-2026-07-14/clip12-full-script.md).

## Corrections to the interrupted pass

The interrupted pass misread the phase poll because it entered after the
instruction that supplies its comparison constant. At `fightstg.s:16317–16318`,
`beq $v1, $v0, .L0x80092b2c` has **`li $v0, -0x2` in its delay slot**.
The poll therefore compares the answer with **-2, not 2**. The forced poll has the
same entry at `0x80092c44/0x80092c48`. Cross on species names restarts the
partner picker on both paths, with no action and no MP debit. Cross on the
options returns to names; Cross on the command-mode partner picker returns to
Tag on the command list. These are three different return destinations.
`tests/lane-b/dna-path-branches.test.js` executes the entire original phase tick,
including the dispatch that the earlier opcode-only check omitted.

The interrupted pass also confused the receiver of `wfightmn`'s `+0x2C(6)`:
it is **the controller**, not the phase. The next controller step's entry comes
from `wfightmn.s:5133`, word `0x800A7B08`, and at file `0x1D64` it calls
`F0x80090C44(0, phase+0x68)`. Its allocated tick is `F0x8008F714`, confirmed at
`fightstg.s:14324–14328`. `F0x8008EE4C` / tick `F0x8008DAC0` is the item task,
not the DNA task. The existing complete model §10f already establishes this;
I disagree with the interrupted draft, not with that prior result.

The third correction is the pane's record byte `+0x1A`: it is the **Blast-active
flag**, not an already-fused flag. See `DNA-C008` (partially_verified) and
[battle RAM layout](battle-ram-layout.md:85). The session had forced that byte to
zero; the browser now passes the active Blast flag through the session seed.

## Decoded member census

The population comes from the original phase's two Tag poll blocks, the
partner scan, pane offer and confirm blocks, and the controller's dispatch table
and DNA step. The nine confirm refusals are separately enumerated from every
conditional branch between `0x80098550` and the first MP store `0x80098650`.
A test independently enumerates those raw branch words and compares the address
set. The code's member IDs must also equal this independently quoted table's IDs.
Shared list navigation and preview-page loops are not DNA refusal conditions;
they remain the established shared widget and carry-over-panel ports.

Source abbreviations: `fightstg.s` and `wfightmn.s` mean
`~/ddw3/asm/dw2003/pro/<name>`. Addresses beginning `0x0000` in
`wfightmn.s` are file offsets; RAM = file offset + `0x800A5DE0`.

| member | condition | player consequence | exact original line |
|---|---|---|---|
| `door-no-phase` | no phase object | No command screen opens. | `fightstg.s:16513` — `.L0x80092dac: beqz $a0, .L0x80092dd4` |
| `door-not-ready` | phase main state is not 1 | No command screen opens; this is not a side test. | `fightstg.s:16517` — `.L0x80092dbc: bne $v1, $v0, .L0x80092dd4` |
| `command-restart` | answer == -2 (loaded at 0x80092ab8) | Cancel blip; partner picker reopens; no MP or turn spent. | `fightstg.s:16349` — `.L0x80092b34: beq $v1, $v0, .L0x80092cec` |
| `command-wait` | answer == -1 | Pane stays open. | `fightstg.s:16351` — `.L0x80092b3c: beq $v1, $v0, .L0x80092d38` |
| `command-switch` | answer low nibble == 0 | Switch; selected species copied; no MP debit. | `fightstg.s:16353` — `.L0x80092b44: beqz $v0, .L0x80092d10` |
| `command-dna` | nonzero nibble after the two sentinel tests | DNA action 6; selected result action is retained. | `fightstg.s:16357` — `.L0x80092b54: li $v0, 0x6` |
| `forced-restart` | answer == -2 (loaded at 0x80092c48) | Cancel blip; forced partner picker reopens. | `fightstg.s:16453` — `.L0x80092cd4: beq $v1, $v0, .L0x80092cec` |
| `forced-wait` | answer == -1 | Pane stays open. | `fightstg.s:16455` — `.L0x80092cdc: bne $v1, $v0, .L0x80092d08` |
| `forced-no-dna-commit` | nonzero nibble after sentinels | No phase commit; no substitute Switch. See forced-path limit below. | `fightstg.s:16466` — `.L0x80092d08: bnez $v0, .L0x80092d38` |
| `picker-cancel` | picker answer == -2 on command route | Command list returns to Tag. | `fightstg.s:16329` — `.L0x80092ae4: beq $v1, $v0, .L0x80092afc` |
| `picker-absent` | party record species == 0 | Absent member is not listed. | `fightstg.s:21213` — `.L0x80097518: beqz $v0, .L0x8009758c` |
| `picker-active` | candidate is current actor | Current actor is not listed. | `fightstg.s:21217` — `.L0x80097528: beq $s0, $v0, .L0x8009758c` |
| `picker-mode-no-badge` | picker mode == 0 | DNA badge lookup is skipped. | `fightstg.s:21226` — `.L0x8009754c: beqz $v0, .L0x8009757c` |
| `picker-blast-no-badge` | actor Blast byte != 0 | DNA badge lookup is skipped. | `fightstg.s:21228` — `.L0x80097554: bnez $s4, .L0x8009757c` |
| `picker-no-reserve` | candidate count <= 0 | No reserve pane; Circle returns; Cross is ignored. | `fightstg.s:21248` — `.L0x800975a4: blez $v1, .L0x800975f8` |
| `picker-no-cross-forced` | picker mode == 0 | Cross does nothing; no cancel sound. | `fightstg.s:21296` — `.L0x80097664: beqz $v1, .L0x80097678` |
| `picker-cross` | Cross in mode 1 | Cancel blip 0x800450BD; answer -2. | `fightstg.s:21299` — `.L0x80097670: bnez $v0, .L0x8009788c` |
| `picker-ko` | selected member HP == 0 | Confirm blip 0x0004001C; picker remains; no refusal line. | `fightstg.s:21322` — `.L0x800976cc: beqz $v0, .L0x80097960` |
| `pane-blast` | actor Blast byte != 0 | Pair offer is not recomputed; fresh pane offers Switch only. | `fightstg.s:22139` — `.L0x80098348: bnez $v0, .L0x800983c0` |
| `pane-unpaired` | source partner id == 0 | Switch only. | `fightstg.s:22158` — `.L0x80098394: beqz $v1, .L0x800983b8` |
| `pane-no-result` | result action id == 0 | One row: Switch only, including a matched pair with no result. | `fightstg.s:22172` — `.L0x800983cc: beqz $v1, .L0x800983d8` |
| `pane-wrong-partner` | named partner id differs from selected profile id | Switch only; no DNA price. | `fightstg.s:22162` — `.L0x800983a4: bne $v1, $v0, .L0x800983b8` |
| `pane-names-cross` | Cross on names | Cancel blip 0x800450BD; answer -2; picker reopens. | `fightstg.s:22086` — `.L0x80098274: bnez $v0, .L0x8009841c` |
| `pane-rows-cross` | Cross on options | Cancel blip 0x800450BD; names return; no answer written. | `fightstg.s:22376` — `.L0x800986fc: bnez $v0, .L0x800984a0` |
| `switch-active-status` | actor status & 0x10 | Confirm blip then no change. | `fightstg.s:22272` — `.L0x8009855c: bnez $v0, .L0x80098790` |
| `switch-partner-status` | partner status & 0x10 | Confirm blip then no change. | `fightstg.s:22277` — `.L0x80098570: bnez $v0, .L0x80098790` |
| `active-mp` | signed actor MP < price | Grey DNA row; confirm blip 0x0004001C then no change, no refusal message. | `fightstg.s:22306` — `.L0x800985e4: bnez $v1, .L0x80098790` |
| `partner-mp` | signed partner MP < price | Grey DNA row; confirm blip 0x0004001C then no change, no refusal message. | `fightstg.s:22311` — `.L0x800985f8: bnez $v0, .L0x80098790` |
| `active-status-20` | actor status & 0x20 | Grey DNA row; confirm blip 0x0004001C then no change, no refusal message. | `fightstg.s:22316` — `.L0x8009860c: bnez $v0, .L0x80098790` |
| `partner-status-20` | partner status & 0x20 | Grey DNA row; confirm blip 0x0004001C then no change, no refusal message. | `fightstg.s:22321` — `.L0x80098620: bnez $v0, .L0x80098790` |
| `active-status-08` | actor status & 0x08 | Grey DNA row; confirm blip 0x0004001C then no change, no refusal message. | `fightstg.s:22323` — `.L0x80098628: bnez $v0, .L0x80098790` |
| `active-hp` | signed actor HP <= 0 | Grey DNA row; confirm blip 0x0004001C then no change, no refusal message. | `fightstg.s:22327` — `.L0x80098638: blez $v0, .L0x80098790` |
| `partner-hp` | signed partner HP <= 0 | Grey DNA row; confirm blip 0x0004001C then no change, no refusal message. | `fightstg.s:22331` — `.L0x80098648: blez $v0, .L0x80098790` |
| `turn-frozen` | actor status bit 2 set; roll decides whether commands are allowed | On a nonzero roll, frozen announcement and turn ends before Tag opens. | `wfightmn.s:1506` — `.L0x0000176c: beqz $v0, .L0x000017f8             ` |
| `turn-frozen-roll` | frozen roll returns zero | Zero allows command flow to continue. | `wfightmn.s:1512` — `.L0x00001784: beqz $v0, .L0x000017f8             ` |
| `turn-confused` | actor status bit 4 set | Controller branches to confused-turn step 17, not the command menu. | `wfightmn.s:1544` — `.L0x00001804: beqz $v0, .L0x00001824             ` |
| `controller-range` | phase result outside unsigned 0..6 | Battle-end path; unreachable from valid DNA phase outputs. | `wfightmn.s:1566` — `.L0x0000185c: beqz $v0, .L0x0000198c             ` |
| `controller-dna-step` | phase result 6 | Controller (not phase) enters its DNA step 6. | `wfightmn.s:1626` — `.L0x0000194c: li $a1, 0x6                        ` |
| `controller-dna-start` | DNA step first update | Starts shared technique action with phase result id; no eligibility retest. | `wfightmn.s:1888` — `.L0x00001d64: jal 0x80090c44                     ` |
| `controller-dna-wait` | action child still alive | Wait for action completion. | `wfightmn.s:1906` — `.L0x00001dac: bnez $v0, .L0x00001e0c             ` |
| `controller-enemy-absent` | enemy record species == 0 | Skip this enemy in post-action victory scan. | `wfightmn.s:1912` — `.L0x00001dc4: beqz $v0, .L0x00001ddc             ` |
| `controller-enemy-alive` | enemy HP != 0 | Continue to shared step 5 after action, not victory. | `wfightmn.s:1916` — `.L0x00001dd4: bnez $v0, .L0x00001d84             ` |
| `action-dna-clip` | technique clip == 12 | DNA announcement page kind 2, term 0x3A; shared action continues. | `fightstg.s:13007` — `.L0x8008f7d4: bne $v1, $v0, .L0x8008f7f8` |
| `action-opponent-sleep` | opponent status & 8 | Sets action targeting flag; not a DNA refusal. | `fightstg.s:13045` — `.L0x8008f86c: beqz $v0, .L0x8008f878` |
| `action-presentation-wait` | announcement child still alive | Wait before resolving action. | `fightstg.s:13065` — `.L0x8008f8bc: bnez $v0, .L0x80090c1c` |
| `action-special-mode` | battle mode byte 0x800A4436 != 0 | Alternate shared technique resolver; not a pane cancellation. | `fightstg.s:13069` — `.L0x8008f8cc: bnez $v0, .L0x8008f92c` |
| `action-category` | technique category outside 2..6 | Wait; shipped DNA actions use categories 2, 3 and 4 (data census). | `fightstg.s:13115` — `.L0x8008f984: beqz $v0, .L0x80090c1c` |
| `action-hit-kind` | category != 2 at damage branch | Skip hit task; category 2 starts shared hit task with DNA flag. | `fightstg.s:14220` — `.L0x80090ac8: bne $v1, $v0, .L0x80090c14` |
| `grey-switch-active` | actor status & 0x10 | Grey Switch label, no sound. | `fightstg.s:21794` — `.L0x80097df0: bnez $v0, .L0x80097e0c` |
| `grey-switch-partner` | partner status bit 0x10 clear | Bypass grey; otherwise palette 7, no sound. | `fightstg.s:21799` — `.L0x80097e04: beqz $v0, .L0x80097e20` |
| `grey-active-mp` | actor MP < price | Grey DNA label, no sound. | `fightstg.s:21859` — `.L0x80097ef4: bnez $v1, .L0x80097f10` |
| `grey-partner-mp` | partner MP >= price | Continue status tests; otherwise grey, no sound. | `fightstg.s:21864` — `.L0x80097f08: beqz $v0, .L0x80097f24` |
| `grey-active-status-20` | actor status & 0x20 | Grey DNA label, no sound. | `fightstg.s:21874` — `.L0x80097f30: bnez $v0, .L0x80097f54` |
| `grey-partner-status-20` | partner status & 0x20 | Grey DNA label, no sound. | `fightstg.s:21879` — `.L0x80097f44: bnez $v0, .L0x80097f54` |
| `grey-active-status-08` | actor status bit 8 clear | Continue HP tests; otherwise grey, no sound. | `fightstg.s:21881` — `.L0x80097f4c: beqz $v0, .L0x80097f68` |
| `grey-active-hp` | actor HP <= 0 | Grey DNA label, no sound. | `fightstg.s:21890` — `.L0x80097f70: blez $v0, .L0x80097f88` |
| `grey-partner-hp` | partner HP > 0 | Normal DNA palette; otherwise grey, no sound. | `fightstg.s:21894` — `.L0x80097f80: bgtz $v0, .L0x80097f9c` |
| `list-confirm-freeze` | shared list model +0x54 != 0 | Accepted choice stops list input; no extra sound. | `fightstg.s:25091` — `.L0x8009b018: bnez $v0, .L0x8009b0b4` |

## Grey labels, sounds, and successful confirmation

The label routine duplicates the two Switch and seven DNA tests for palette 7;
see `fightstg.s:21792–21808` and `:21861–21900`, and the existing pane oracle
`tests/lane-b/fight-dna-menu.test.js`. The confirm routine plays packed sound
**0x0004001C** before checking eligibility (`0x80098508`, `0x80098530`).
Refusals all converge on `0x80098790`, the repaint, with no refusal text or
second sound. The price uses signed MP comparison; equality is accepted.
Switch tests bit 0x10 on both sides; DNA tests bit 0x20 on both, bit 0x08 on the
actor only. The partner's 0x08 and either member's 0x10 do not refuse DNA.
The meaning of 0x10/0x20 is not guessed: existing `DNA-C009` and
[battle formulas](battle-formula-leaves.md:371) record no identified applier.

Successful DNA subtracts MP once from both records (`0x80098650`,
`0x80098680`), writes the pane's result action through `+0x80`
(`0x800986bc–0x800986c8`), and freezes list input through the model's `+0x54`
(`0x800986f4`; shared list tick `0x8009AF4C`). The browser pane's private records
are preview state; the battle commits the same price once to live records.
No extra turn, HP, DV-gauge or permanent fused-form debit is added.

## Downstream path and requested edge cases

The controller owns step 6 → `F0x80090C44` → tick `F0x8008F714`. Every distinct
DNA result selected by the profile records uses clip 12 and categories 2, 3 or 4; the data
census in the tests enumerates the profile table rather than a hand recipe list.
The action's announcement distinguishes clip 12 (`0x8008F7D4`), sets term 0x3A,
then waits for its child. It calls the shared technique resolver for normal
battle mode (`0x8008F8DC`); this is not another partner/MP gate. Category 2 later
creates the shared hit task with the DNA flag (`0x80090AD0–0x80090AE0`).
The existing clip-12 director supplies the temporary fused model and restores
the actor; there is no permanent "partner already fused" state to reject
(complete model §10f, recorded runtime comparison there).

* **Absent/dead/no reserve:** admission skips absent forms and the actor, not
  dead members. Dead members stay grey and refuse Circle. No reserve is the
  existing message pane, not an automatically destroyed list.
* **No pair/no result:** the pane offers only Switch. All profile rows and all
  emitted result IDs are covered by the existing pairing census and the new
  category/clip census.
* **Confused/frozen actor:** the original controller's shared turn gate runs
  before command selection. Frozen's nonzero roll ends the turn; confusion
  selects step 17. The pane itself adds neither a confusion nor frozen test.
  Existing canonical proof: battle-formula-leaves.md:612–620 and
  `frozen-gate-blocks-the-command-menu-turn-2026-10-03`.
* **Enemy side:** the player DNA commit explicitly passes side 0. The generic
  technique task accepts a side argument, so a phase-ready test alone does NOT
  prove that enemy-authored clip-12 techniques can never occur. No new enemy DNA
  menu was invented; enemy action data remains the existing AI system.
* **Forced switch:** mode 0 suppresses Cross on the picker and DNA badges;
  pane Cross still restarts it. A nonzero accepted pane answer has no forced
  phase commit. The original forced constructor also leaves result out pointer
  `+0x80` zero (`0x80092CA8` calls the unwrapped constructor), whereas row 1
  stores through it at `0x800986C8`. The browser preserves no commit rather than
  inventing a Switch. The console consequence of that zero-address write is not
  established. A bounded capture at `0x800986C8` and `0x80092D08` during a
  forced replacement with an eligible pair would settle whether this route
  actually occurs and what survives it. No hardware fault behavior is guessed.
* **Fight ending during fusion:** controller `0x800A7BAC` waits for the action
  child before scanning the three enemy records (`0x800A7BBC–0x800A7BC8`). It
  never interrupts that child because an enemy reached zero HP. The shared
  presentation restores the original model before the browser commits the hit.
  The late asynchronous-model callbacks already guard battle identity.

## Walker comparison and supported members

The shared original system is the battle command phase and its partner/pane
children, followed by the controller's shared technique action. These are ports,
not a converted table with per-place overrides. The fixes are shared:
`dnaAnswerAction` now handles both mode paths; pane cancel reopens the picker;
the forced nonzero arm commits no action; the session seed preserves Blast and
the resident status byte. Both shared list and pane seeds preserve Blast.
The pane's answered species also replaces the previously highlighted form for
Switch/DNA (`fightstg.s:16473–16477`); `dnaAnswerForm` checks all 55 profile rows
through the existing species mapping, rather than committing a stale form. The existing pane and party eligibility ports already
match the nine confirm refusal branches and remain intact.

The legacy hand-drawn pane consumes the same answer decoder. Its legacy
presentation is retained; it does not replace the production translated pane.
Special battle resolver mode `0x800A4436 != 0` is recorded above but is not
claimed to have new browser fidelity in this pass; its console presentation
requires an authored special-mode battle and bounded capture at `0x8008F92C`.
Static refusal/cancel decisions are settled; these presentation/corrupt-pointer
observations do not justify inventing extra refusal conditions.

## Validation and reproduction

See `.bunny-scratch/dnabranches-report.md` for current command results, old-code
failure proof and capture paths. The automated Tag route seeds the first story
battle, chooses Tag then a live partner and a form, presses Cross on the pane's
names, and reads the reopened partner picker. A second Cross on that picker
returns to Tag in the command menu; MP stays unchanged. The Blast check opens
an otherwise valid pair and verifies Switch is the only offered row.

No new original-emulator playing knowledge was learned. Browser route lessons
are recorded in the shared gameplay playbook with the verifier and capture paths.
