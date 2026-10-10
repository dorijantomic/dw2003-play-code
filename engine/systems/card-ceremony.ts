/** The duel's own ceremony opcode stream.
 *
 *  WHAT THIS IS. The disc does not implement its phases inline. It drives them
 *  by latching an opcode into `duel+0x421` and letting the SAME interpreter
 *  that runs card effects carry it out. Until 2026-08-26 our duel implemented
 *  the phases directly, which is why an audit on 2026-08-25 measured
 *  `0 of 74 ceremony opcodes ever executed` on our side while the disc's own
 *  trace spends ~87% of its frames inside the interpreter. That is now closed:
 *  the phases are issued and carried out as opcodes.
 *
 *  PROVENANCE — authority 1, one live capture. Every opcode and every ordering
 *  below was read off the pending-opcode latch `duel+0x421` in a rig trace of
 *  GUID save state 1 (LV 10, "Mother Nature Folder", CARD_NPC records 13/14),
 *  taken 2026-08-26 over 7,740 frames: a complete set 1 plus set 2 up to its
 *  Battle Phase. 111 launches, 39 distinct opcodes, of which 25 are ceremony
 *  opcodes no card program uses.
 *
 *    docs/research/card/captures/cardduel-state1-lv10-mothernature-condensed-2026-08-26.md
 *    docs/research/card/captures/cardduel-state1-lv10-mothernature-timeline-2026-08-26.md
 *    raw log: C:/dw3-rig/dumps/cardgame_full_state1_trace.txt
 *
 *  `duel+0x421` is the same field a previous decode used to identify the pile
 *  picker (the 34-sprite fan), so the extraction method is not novel here.
 *
 *  WHAT THIS MODULE DOES. `stepPhase` no longer implements the phases. It issues
 *  this stream and `applyCeremonyOp` in card-battle.ts carries each opcode out,
 *  which is the disc's own arrangement. There is no second implementation left:
 *  the Battle Phase IS `0x19 0x15 0x16 0x17 0x1D`, the Summon Phase IS
 *  `0x9A 0x9D 0x9E`, and `resolveBattle` is those five steps composed.
 *
 *  EVERY beat is "drive": the opcode IS the implementation and nothing else
 *  performs it. `0x70`, the targeting prompt, was the last hold-out; it is not
 *  on a phase's fixed list because the disc latches it when the play machine
 *  reaches the targeting step, so `raisePlayTarget` latches it dynamically at
 *  the moment a played card really has a target to ask about.
 *
 *  PACING is reproduced too. `tickDuel` in card-battle.ts advances the duel one
 *  FRAME at a time, and a beat OWNS the frame for the number of frames measured
 *  off the disc (`BEAT_FRAMES` below) before the next is latched — the banner
 *  holds, the coin toss turns over, the board sweep runs. `stepPhase` drains a
 *  phase's beats at once and `tickDuel` drains them one at a time; both call the
 *  same `applyCeremonyOp`, and a test asserts the two produce the identical
 *  opcode stream, score and outcome. There is one duel in here, drained two
 *  ways — not two duels.
 *
 *  LIMITS. One duel, one opponent, one folder, one language. The Compile Phase
 *  stream additionally carries whichever card programs were actually played, so
 *  the per-phase lists here are the CEREMONY only - the opcodes that fired with
 *  no card program driving them.
 */

import type { DuelPhaseKey, DuelState } from "./card-battle.ts";

/** How a beat is serviced. See the module header. */
export type CeremonyKind = "drive" | "inline";

export interface CeremonyBeat {
  /** the phase whose driver latched the opcode */
  phase: DuelPhaseKey;
  /** the value written to `duel+0x421` */
  op: number;
  kind: CeremonyKind;
  /** what the disc does with it, in player terms */
  note: string;
}

/** The phase announcement, one opcode per phase, 1:1 with the six phases.
 *
 *  Read off the latch immediately before each phase's mode became current:
 *  0xA0 at frame 5039 -> Start at 5064; 0xA1 at 5180 -> Draw at 5229; 0xA2 at
 *  601 -> Load at 669; 0xA3 at 898 -> Summon at 969; 0xA4 at 2500 -> Compile at
 *  2529; 0xA5 at 4255 -> Battle at 4285. Both sets agree.
 *
 *  The banner is NOT drawn by the phase that queues it: the phase queues it and
 *  the interpreter puts it up and holds it. */
export const BANNER_OPCODE: Readonly<Record<DuelPhaseKey, number>> = {
  start: 0xa0,
  draw: 0xa1,
  load: 0xa2,
  summon: 0xa3,
  compile: 0xa4,
  battle: 0xa5,
};

/** The ceremony each phase issues after its banner, in the observed order.
 *
 *  Compile's list is the play negotiation only - the prompts and the take-back.
 *  Everything else Compile issued in the capture belonged to a card program,
 *  not to the ceremony. Beats the machine latches on arrival rather than on
 *  schedule (0x70) are issued through `latchDynamic`, not listed here. */
export const PHASE_CEREMONY: Readonly<Record<DuelPhaseKey, readonly number[]>> = {
  start: [0xa7],
  draw: [0x14],
  // Load and Compile are THE SAME negotiation: modes 5 and 7 share the routine
  // F0x8009FDD8, so they issue the same stream. The capture saw only 0x98 in
  // the Load Phase because nothing was played that turn — 0x99 (the hand
  // selector) and 0x12 (clear the played row) only follow once a card is
  // actually taken. Reading the capture's Load list literally gives a Load
  // Phase that opens the negotiation and never closes it.
  //
  // 0x70 is NOT listed here even though the capture saw it in Compile: it is
  // latched when the play machine reaches the targeting step, not on schedule.
  load: [0x98, 0x99, 0x12],
  summon: [0x9a, 0x9d, 0x9e],
  compile: [0x98, 0x99, 0x12],
  // NOTHING is listed for the Battle Phase, and nothing is missing. Every one
  // of its states is enumerated in `BATTLE_PHASE_STATES` below and the stream
  // is built from that table by `battleCeremony` in card-battle.ts, because
  // which states run depends on the board: states 6 and 7 only run when BOTH
  // fields hold a card, and state 0x12 — the only one that latches 0x1C/0x1D —
  // only runs when the duel survives the set.
  battle: [],
};

/** What one Battle-Phase state waits for, and what it hands on to.
 *
 *  `0x800A0F94 runBattlePhase` is a 27-entry jump table at `0x80083990`
 *  (`cardgame.s:830-856`), indexed by `duel+0x2F9` (`:30921`) and
 *  range-checked by `sltiu $v0, $v1, 0x1b` (`:30923`), whose base is built by
 *  `lui $v0, 0x8008` + `addiu $v0, 0x3990` (`:30926-30927`) — 0x80083990 as the
 *  WHOLE pair, not 0x3990. EVERY row here is one table word, read in index
 *  order, with the routine behind it and the state it writes. Anchor: ledger
 *  `cardgame-battle-phase-every-state-anchored-2026-10-05`, evidence
 *  `EV-CARDGAME-BP-JUMPTABLE-2026-10-05` and the per-state evidence beside it.
 *
 *  `latch` is the value written to `duel+0x421`, or null when the state writes
 *  none. `wait` is what the state blocks on: a number is that literal, the
 *  strings name a decoded condition. */
export interface BattlePhaseState {
  /** the sub-step byte `duel+0x2F9` */
  readonly state: number;
  /** the routine the jump-table word at `0x80083990 + state*4` names */
  readonly addr: number;
  /** what the player sees the state do */
  readonly note: string;
  /** effect opcode latched into `duel+0x421`, or null */
  readonly latch: number | null;
  /** the OTHER opcode the same state can latch, where the choice is a branch */
  readonly latchAlt?: number;
  /** the condition the state blocks on before it moves */
  readonly wait: string | null;
  /** the states this one can hand control to */
  readonly next: readonly number[];
  /** false for the two table words nothing ever enters */
  readonly reachable: boolean;
}

export const BATTLE_PHASE_STATES: readonly BattlePhaseState[] = Object.freeze([
  { state: 0x00, addr: 0x800a0fec, note: "wait for the board view to be free and its wipe to finish", latch: null, wait: "view+0x64 == 2 && duel+0x498 == 0", next: [0x01], reachable: true },
  { state: 0x01, addr: 0x800a101c, note: "scan YOUR board; one 0x19 per combo run, then hand over", latch: 0x19, wait: null, next: [0x01, 0x02], reachable: true },
  { state: 0x02, addr: 0x800a1048, note: "scan the opponent's board; one 0x1A per combo run", latch: 0x1a, wait: null, next: [0x02, 0x08], reachable: true },
  { state: 0x03, addr: 0x800a11a8, note: "wait for the Battle banner to finish opening", latch: null, wait: "view+0xE9B == 2", next: [0x04], reachable: true },
  { state: 0x04, addr: 0x800a11c4, note: "wait for Circle or Cross, then close that banner", latch: null, wait: "logical 0x0D or 0x0E", next: [0x05], reachable: true },
  { state: 0x05, addr: 0x800a125c, note: "wait for the banner to finish closing", latch: null, wait: "view+0xE9B == 0", next: [0x06], reachable: true },
  { state: 0x06, addr: 0x800a1278, note: "YOUR side attacks", latch: 0x15, wait: null, next: [0x07], reachable: true },
  { state: 0x07, addr: 0x800a1294, note: "the opponent's side attacks", latch: 0x16, wait: null, next: [0x0a], reachable: true },
  { state: 0x08, addr: 0x800a1078, note: "one 0x1B per queued card reveal, counting the queue down", latch: 0x1b, wait: null, next: [0x08, 0x09], reachable: true },
  { state: 0x09, addr: 0x800a10c8, note: "the attack: a Battle banner when both fields hold a card, otherwise the set is decided here", latch: null, wait: null, next: [0x03, 0x0a, 0x0b], reachable: true },
  { state: 0x0a, addr: 0x800a12ac, note: "WHO TOOK THE SET: the loser's Digimon leave the field one at a time — 0x18 when YOU took it, 0x17 when the opponent did", latch: 0x18, latchAlt: 0x17, wait: null, next: [0x0b], reachable: true },
  { state: 0x0b, addr: 0x800a12f8, note: "the set counter rolls for fifty-one ticks — sound 0x9C0002 and a grey 0x80 flash on the first tick, and the plate flickers between the old and the new value the whole time", latch: null, wait: "duel+0x2FC >= 0x33", next: [0x0c], reachable: true },
  { state: 0x0c, addr: 0x800a151c, note: "wait for the result window to finish opening", latch: null, wait: "view+0xE9B == 2, or view+0xDFA == 2 on a draw", next: [0x0d], reachable: true },
  { state: 0x0d, addr: 0x800a155c, note: "Circle or Cross closes the set result", latch: null, wait: "logical 0x0D or 0x0E", next: [0x0e], reachable: true },
  { state: 0x0e, addr: 0x800a161c, note: "wait for it to close, then raise the Current score window", latch: null, wait: "view+0xDFA == 2", next: [0x0f], reachable: true },
  { state: 0x0f, addr: 0x800a166c, note: "wait for the Current score window to finish opening", latch: null, wait: "view+0xDFA == 2", next: [0x10], reachable: true },
  { state: 0x10, addr: 0x800a1688, note: "Circle or Cross closes it", latch: null, wait: "logical 0x0D or 0x0E", next: [0x11], reachable: true },
  { state: 0x11, addr: 0x800a171c, note: "THE DUEL-OVER TEST: two sets is the duel, and the winner is named here", latch: null, wait: "view+0xDFA == 0", next: [0x12, 0x13], reachable: true },
  { state: 0x12, addr: 0x800a17e4, note: "the set-change sweep, aimed at one side — 0x1C at side 0 when YOU took the set, 0x1D at side 1 when the opponent did; then straight out to state 0x1A", latch: 0x1c, latchAlt: 0x1d, wait: null, next: [0x1a], reachable: true },
  { state: 0x13, addr: 0x800a1810, note: "wait for the duel result banner to finish opening", latch: null, wait: "view+0xE9B == 2", next: [0x14], reachable: true },
  { state: 0x14, addr: 0x800a182c, note: "Circle or Cross takes it down; only a win opens the per-opponent window", latch: null, wait: "logical 0x0D or 0x0E", next: [0x15, 0x19], reachable: true },
  { state: 0x15, addr: 0x800a18d8, note: "wait for it to close, then call the per-opponent sub-screen F0x8009DEC4 and raise that window", latch: null, wait: "view+0xE9B == 0", next: [0x16], reachable: true },
  { state: 0x16, addr: 0x800a192c, note: "wait for that window to finish opening", latch: null, wait: "view+0xDFA == 2", next: [0x17], reachable: true },
  { state: 0x17, addr: 0x800a1948, note: "Circle OR Cross ends the duel — the second gate at :31561 returns without a state only when Cross was NOT pressed", latch: null, wait: "logical 0x0D or 0x0E", next: [0x19], reachable: true },
  { state: 0x18, addr: 0x800a19d4, note: "a table word that is only the epilogue: it writes no state and never advances", latch: null, wait: null, next: [], reachable: false },
  { state: 0x19, addr: 0x800a19c8, note: "the duel is over — this routine returns 2", latch: null, wait: null, next: [], reachable: true },
  { state: 0x1a, addr: 0x800a19d0, note: "hand over to the mode machine — this routine returns 1", latch: null, wait: null, next: [], reachable: true },
]);

/** The Battle-Phase walk, opcode by battle-machine state.
 *
 *  CORRECTED 2026-10-05 against the assembly. The old table read the capture's
 *  FRAME numbers as state numbers, so every row after the first was one state
 *  late: 0x15 is latched by state 6, not 7; 0x16 by state 7, not 0x0A; 0x17 /
 *  0x18 by state 0x0A, not 0x0B; and 0x1C / 0x1D by state 0x12, not 0x1A —
 *  state 0x1A is the mode machine's return and latches nothing at all. */
export const BATTLE_CEREMONY: readonly { readonly state: number; readonly op: number }[] =
  BATTLE_PHASE_STATES.filter((s) => s.latch !== null)
    .map((s) => ({ state: s.state, op: s.latch as number }));

/** One row of the screen that opens a duel: the folder chooser.
 *
 *  `F0x8009F110` is mode 2 of the card-battle screen's mode machine `F0x800A1B48`.
 *  Mode 2's UPDATE entry is the table word `0x80083A28[1] = 0x800A1C7C`, which is
 *  `cardgame.s:31739` — the routine's only call site — and its ENTER entry
 *  `0x80083A00[1] = 0x800A1BA0` (`cardgame.s:31683`) is what zeroes `duel+0x2F9`
 *  and `duel+0x2FC` before the first arm. It runs on the duel's own sub-step byte
 *  `duel+0x2F9` and dispatches through 22 words at `0x80083890`
 *  (`cardgame.s:766-787`), range-checked by `sltiu $v0, $v1, 0x16`
 *  (`cardgame.s:28973`). Read end to end on 2026-10-05, authority 2, which
 *  closes frontier CARD-Q007.
 *
 *  `wait` is what the state blocks on: a number is that many of the machine's
 *  own ticks, a string names a decoded condition, and null means it does not
 *  block. `sound` is the full sound id the arm plays — the `lui`/`ori` PAIR, so
 *  0x40019 and not 0x19. `next` are the states it can hand control to.
 *
 *  Two conventions in the walk below, both read off the delay slots rather than
 *  assumed. A state that blocks N ticks is entered on its own tick and is left
 *  on the tick its counter REACHES N, so the next arm runs N ticks later and the
 *  three plates are 12 ticks apart rather than 11; the bound itself is computed
 *  in the delay slot of the jump that tests it (`slti $v1, 0xb` at
 *  `cardgame.s:29037`, `j .L0x0001ca84`). And a delay slot always runs: state
 *  0's first branch is `bnez $a1, .L0x0001c4e0` (`cardgame.s:28986`) with
 *  `li $v0, 0x1` in the slot (`:28987`), and that 1 is the value
 *  `bne $v1, $v0` two lines later compares the context's +0xC against.
 *
 *  One thing in state 9 is NOT a delay slot and is worth saying so, because the
 *  slot above is the obvious place to look: the confirm block that computes
 *  `state+1` and `cursor*4` (`cardgame.s:29213-29216`) is ordinary straight-line
 *  code the branch at `:29203` skips over entirely. What it buys is the address
 *  — `sll $v1, 0x2` / `addu $v1, $s6, $v1` then `lw $a0, 0xc($v1)` is
 *  `arg1 + 0xC + cursor*4`, i.e. plate 0, 1 or 2 — so the plate that gets the
 *  one-shot at `:29217` is the SELECTED one, not the first. */
export interface FolderChooserState {
  /** the sub-step byte `duel+0x2F9` */
  readonly state: number;
  /** the routine the jump-table word at `0x80083890 + state*4` names */
  readonly addr: number;
  /** what the player sees the state do */
  readonly note: string;
  /** what the state blocks on before it moves */
  readonly wait: number | string | null;
  /** sound the arm plays, or null */
  readonly sound: number | null;
  /** the states this one can hand control to */
  readonly next: readonly number[];
  /** false only for a table word nothing enters */
  readonly reachable: boolean;
  /** why a state is never entered, when it is not */
  readonly reason: string | null;
}

export const FOLDER_CHOOSER_STATES: readonly FolderChooserState[] = Object.freeze([
  { state: 0x00, addr: 0x8009f174, note: "the opening gate: hold until the screen behind has finished its own opening — the context at arg1+0 must exist, its +0xC must read 1 and its +0x50 must be non-zero, and the wait has no timeout of any kind. Whichever half of the test passes, the state hands on to 0x01", wait: "arg1->unk0 != 0 && arg1->unk0->+0xC == 1 && arg1->unk0->+0x50 != 0", sound: null, next: [0x01], reachable: true, reason: null },
  { state: 0x01, addr: 0x8009f1bc, note: "the title band goes up reading escardgm 0x41 \"Choose a folder\" at y 38, and the FIRST folder plate appears at (23, 80). The band opener itself rings 0x40019 and so does the plate, so the same chime is asked for twice on this one tick", wait: null, sound: 0x40019, next: [0x02], reachable: true, reason: null },
  { state: 0x02, addr: 0x8009f220, note: "nothing happens for eleven ticks while the first plate finishes its own twelve-tick open", wait: 11, sound: null, next: [0x03], reachable: true, reason: null },
  { state: 0x03, addr: 0x8009f24c, note: "the SECOND folder plate appears at (23, 125)", wait: null, sound: 0x40019, next: [0x04], reachable: true, reason: null },
  { state: 0x04, addr: 0x8009f284, note: "nothing happens for eleven ticks while the second plate finishes its own twelve-tick open", wait: 11, sound: null, next: [0x05], reachable: true, reason: null },
  { state: 0x05, addr: 0x8009f2b0, note: "the THIRD folder plate appears at (23, 170)", wait: null, sound: 0x40019, next: [0x06], reachable: true, reason: null },
  { state: 0x06, addr: 0x8009f2e8, note: "nothing happens for eleven ticks while the third plate finishes its own twelve-tick open", wait: 11, sound: null, next: [0x07], reachable: true, reason: null },
  { state: 0x07, addr: 0x8009f314, note: "the cursor marker is created ON THE FIRST PLATE, at (23, 80) — it is the folder cursor, which is what §24.1 could not place", wait: null, sound: null, next: [0x08], reachable: true, reason: null },
  { state: 0x08, addr: 0x8009f334, note: "nothing happens for eleven ticks, and the choice is reset to the FIRST folder as it leaves — the chooser always opens on folder 1, whatever was active", wait: 11, sound: null, next: [0x09], reachable: true, reason: null },
  { state: 0x09, addr: 0x8009f374, note: "the picker: Up and Down move the choice over three folders and STOP at both ends — neither wraps, and an end press is silent because the sound is inside the arm that moved. Circle confirms. The marker is put back on the chosen plate on every single tick of this state, so it cannot drift.", wait: null, sound: 0x4001b, next: [0x0a], reachable: true, reason: null },
  { state: 0x0a, addr: 0x8009f574, note: "nothing happens at all for fifteen ticks — this is the beat the screen used to spend shrinking a row immediately", wait: 15, sound: null, next: [0x0b], reachable: true, reason: null },
  { state: 0x0b, addr: 0x8009f5a0, note: "the cursor marker shrinks away over five ticks and is gone, so the chosen row is a plain row again", wait: null, sound: null, next: [0x0c], reachable: true, reason: null },
  { state: 0x0c, addr: 0x8009f70c, note: "nothing happens for six ticks while the marker's own five-tick shrink finishes", wait: 6, sound: null, next: [0x0d], reachable: true, reason: null },
  { state: 0x0d, addr: 0x8009f5c0, note: "the FIRST plate goes, in folder order rather than in the order the player chose — a player who confirms folder 3 watches folder 1 leave first", wait: null, sound: 0x4001a, next: [0x0e], reachable: true, reason: null },
  { state: 0x0e, addr: 0x8009f5f8, note: "nothing happens for four ticks — the plate's own shrink runs SIX, so the next plate starts while the last frame of this one is still on screen, one tick of overlap", wait: 4, sound: null, next: [0x0f], reachable: true, reason: null },
  { state: 0x0f, addr: 0x8009f624, note: "the SECOND plate goes, still in folder order, whatever folder the player chose", wait: null, sound: 0x4001a, next: [0x10], reachable: true, reason: null },
  { state: 0x10, addr: 0x8009f65c, note: "nothing happens for four ticks, which is again shorter than the plate's own six", wait: 4, sound: null, next: [0x11], reachable: true, reason: null },
  { state: 0x11, addr: 0x8009f688, note: "the THIRD plate goes, still in folder order — the last thing on screen but the title band", wait: null, sound: 0x4001a, next: [0x12], reachable: true, reason: null },
  { state: 0x12, addr: 0x8009f6c0, note: "nothing happens for four ticks while the third plate finishes its own shrink", wait: 4, sound: null, next: [0x13], reachable: true, reason: null },
  { state: 0x13, addr: 0x8009f6ec, note: "the title band goes down over six units. Nothing is rung here in the chooser: the 0x4001A is played inside the band routine it calls (F0x8009BF5C), not by a bare sound call on this state", wait: null, sound: 0x4001a, next: [0x14], reachable: true, reason: null },
  { state: 0x14, addr: 0x8009f70c, note: "nothing happens; the band's own six-tick close runs. This is the SAME table word as state 0x0C — one routine serving both waits", wait: 6, sound: null, next: [0x15], reachable: true, reason: null },
  { state: 0x15, addr: 0x8009f750, note: "the duel is built: the chosen folder's forty card ids are copied out of the save, every card picture the duel can show is uploaded, the deck counters are set to a full forty, and this routine returns 1 — which is what moves the screen on to mode 10. On an EMPTY folder the first saved id reads zero and a built-in forty-card list is copied instead, verbatim", wait: null, sound: null, next: [], reachable: true, reason: null },
]);

/** The machine's own tick for each state, walked from `from` at `startAt`.
 *
 *  A state costs one tick of its own, plus `wait` ticks more if it blocks: the
 *  arm that changes state is the LAST tick of the wait, not one past it, which
 *  is why a state whose wait reads 11 puts the next plate 12 ticks after the
 *  last and not 11. That single convention is the whole reason the three folder
 *  plates are 12 ticks apart and the take-down runs 45 ticks from the confirm. */
function walkStates(from: number, startAt: number): readonly (number | null)[] {
  const ticks: (number | null)[] = FOLDER_CHOOSER_STATES.map(() => null);
  let at = startAt;
  for (let s = from; s < FOLDER_CHOOSER_STATES.length; s++) {
    const row = FOLDER_CHOOSER_STATES[s]!;
    ticks[s] = at;
    at += typeof row.wait === "number" ? row.wait : 1;
  }
  return Object.freeze(ticks);
}

/** When the chooser's OPEN side runs: plate 0 on tick 0, plate 1 on 12, plate 2
 *  on 24, the cursor marker on 36 and the first tick that accepts a button on
 *  48. States 10..21 are null here because they run on the confirm's clock. */
export const FOLDER_CHOOSER_OPEN_TICKS = walkStates(1, 0);

/** The TAKE-DOWN side, counted from the tick the confirm was accepted on tick 0.
 *  Fifteen ticks of nothing, then the marker at 16, the three plates at 23, 28
 *  and 33, the title band at 38, and the deck load at 45. */
export const FOLDER_CHOOSER_CLOSE_TICKS = walkStates(10, 1);

/** The forty card ids the duel is built from when the chosen folder is EMPTY.
 *
 *  State 0x15 tests the folder's first saved card (`cardgame.s:29368`) and, on
 *  zero, copies this built-in list instead (`cardgame.s:29393`) — the one place
 *  a duel in this game can begin on a deck the player did not choose. Read out
 *  of the overlay's data at `0x800A5C74`, 40 halfwords (`lhu`, `cardgame.s:29395`,
 *  source stepping two bytes at a time), and copied VERBATIM: the save path
 *  subtracts one from every id (`cardgame.s:29385`) and this path does not.
 *
 *  So the table below is already in the DISC'S OWN duel numbering, which counts
 *  from zero, while this browser counts cards from ONE everywhere else — the
 *  album, the collection and `tools/extract_card_catalog.py` ("card ids are
 *  1-based") all hand us one-based ids, and the folder records the chooser reads
 *  are the save's own one-based halfwords (`engine/dw3/save-block.ts:86`).
 *  Raising the table by one here is therefore not a fudge: it is what makes this
 *  deck name the same forty cards the disc names, and it is the ONLY place in the
 *  browser that holds a zero-based duel id. Before 2026-10-05 it did not, so an
 *  empty folder duelled on ToyAgumon where the disc duels on Gotsumon, and on
 *  Freeze Bug where the disc duels on Eclipse Undo. */
const FOLDER_FALLBACK_DECK_DUEL: readonly number[] = Object.freeze([
  312, 42, 43, 310, 310, 310, 33, 33, 80, 41,
  49, 49, 49, 49, 49, 49, 49, 49, 49, 49,
  9, 9, 9, 9, 9, 9, 9, 9, 9, 9,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
]);

export const FOLDER_FALLBACK_DECK: readonly number[] =
  Object.freeze(FOLDER_FALLBACK_DECK_DUEL.map((id) => id + 1));

/** What each ceremony opcode does, and whether our duel drives it as an opcode.
 *
 *  The glosses are the established readings; the `kind` is a statement about
 *  OUR code, not about the disc. Everything is "drive". */
const CEREMONY: Readonly<Record<number, { kind: CeremonyKind; note: string }>> = {
  0x12: { kind: "drive" , note: "clear the played row at the end of the turn" },
  0x14: { kind: "drive" , note: "the six-card draw" },
  0x15: { kind: "drive" , note: "battle: apply the damage to the block totals" },
  0x16: { kind: "drive" , note: "battle: drain the attack across the row" },
  // CORRECTED 2026-08-27. This was glossed "battle: transfer the damage",
  // which is 0x15/0x16's job (both call F0x80093624/F0x80093710, the drain,
  // aimed at one side each). 0x17 and 0x18 call F0x80093ADC/F0x80093B10 —
  // `enterClearPlayedRow` — from the last occupied slot backwards.
  0x17: { kind: "drive" , note: "battle: you lost, and your Digimon leave the field one at a time" },
  0x18: { kind: "drive" , note: "battle: you won, and the opponent's Digimon leave the field one at a time" },
  0x19: { kind: "drive" , note: "battle: open the phase and take the board" },
  // CORRECTED 2026-08-27, against F0x80094B9C. The pair 0x1C/0x1D is one
  // routine aimed at one side each (the third argument is the side: 0 for
  // 0x1C, 1 for 0x1D). It empties that side's FIELD one Digimon at a time,
  // each into the discard of the player who owns it, and then walks BOTH
  // players' hands back into their decks one card every three ticks. It is
  // not "the played row into discard", which is what two shipped documents
  // said until today. `endSet` already performs both halves.
  0x1d: { kind: "drive" , note: "battle: the field empties into its owners' discards and both hands walk back into the decks" },
  0x70: { kind: "drive" , note: "the targeting prompt - which board slot the play acts on" },
  0x98: { kind: "drive" , note: "the two-answer box - \"Use a Program Card?\"" },
  0x99: { kind: "drive" , note: "the hand selector, per-card legality marked" },
  0x9a: { kind: "drive" , note: "the summon browser" },
  0x9d: { kind: "drive" , note: "auto-pick the affordable summons off the pile" },
  0x9e: { kind: "drive" , note: "the five-step board sweep" },
  0xa0: { kind: "drive", note: "announce the Start Phase" },
  0xa1: { kind: "drive", note: "announce the Draw Phase" },
  0xa2: { kind: "drive", note: "announce the Load Phase" },
  0xa3: { kind: "drive", note: "announce the Summon Phase" },
  0xa4: { kind: "drive", note: "announce the Compile Phase" },
  0xa5: { kind: "drive", note: "announce the Battle Phase" },
  0xa7: { kind: "drive", note: "the coin toss" },

  // The ten a card program performs. Until 2026-08-27 our duel ran every one of
  // these inside the interpreter without ever latching it, so the screen never
  // saw them: 19 distinct beats issued against the disc's 38. The rules were
  // already right; what was missing was that each step is its own beat.
  //
  // Read from the two dispatch tables (enter 0x80082CF8 indexed (op-1)*4,
  // update 0x80082FB0 indexed op*4) and the handlers behind them.
  // The resolution stack. 0x2B/0x2D push a level, 0x2C/0x2E restore one, and
  // the animation atlas corrects both primitive names: F0x8009C350 and
  // F0x8009C2D0 are slideBothPanelsOut / slideBothPanelsIn, not
  // closeOverlay / resetScreen. The rules half already ran in the VM; what
  // was missing is that the player watches the HUD leave and come back.
  // 0x3F and 0x42 move ONE card and the player watches it go. The VM already
  // moved it in the model; without a beat the screen only caught up at the
  // next sync, so the card teleported.
  0x3f: { kind: "drive", note: "the card under the cursor leaves your hand for the trash" },
  0x42: { kind: "drive", note: "the chosen card comes out of the pile and into your hand" },
  0x2b: { kind: "drive", note: "a card program nests: both HUD panels slide off" },
  0x2d: { kind: "drive", note: "a card program nests again: both HUD panels slide off" },
  0x2c: { kind: "drive", note: "the nested program unwinds: both HUD panels slide back" },
  0x2e: { kind: "drive", note: "the nested program unwinds again: both HUD panels slide back" },
  0x13: { kind: "drive", note: "the card you played rises into the centre of the board" },
  0x2f: { kind: "drive", note: "\"Pick a Card to Trash.\" - and it waits for a button" },
  0x30: { kind: "drive", note: "\"No Cards in Deck.\" - and it waits for a button" },
  0x31: { kind: "drive", note: "\"There are too many Digimon cards in field. Select which to throw away.\"" },
  0x4c: { kind: "drive", note: "the survivors slide along the row to close the gaps" },
  0x4d: { kind: "drive", note: "the marked cards are destroyed, one slot at a time" },
  0x53: { kind: "drive", note: "Goburimon is summoned into the next free slot" },
  0x55: { kind: "drive", note: "Hagurumon is summoned into the next free slot" },
  0x5a: { kind: "drive", note: "the board's AP and HP totals are added back up" },
  0x8d: { kind: "drive", note: "the play is shown centre stage and the slots it may hit light up" },
  0xae: { kind: "drive", note: "the slots the play may hit light up and one is taken" },

  // THE TWO PILE PICKERS, decoded 2026-08-30. Both raise the SAME surface the
  // walker already draws for 0xA9/0xAB/0xAD - one browser that retitles itself
  // - and NOT the 0x99 hand selector. `openPilePicker` (F0x8008BAA4) writes the
  // zone into `duel+0x438` from (side, kind): kind 0 is the hand and takes its
  // count from +0x5A6, kind 1/2 the deck from +0x5A4, kind 3 the trash from
  // +0x5A2; your side gets 5/7/9 and the opponent's 11/13/15. `0xAA` enters
  // with kind 0 and `0xAC` with kind 2, so 0xAA fans out a HAND and 0xAC a
  // DECK - which is what `PILE_PICKERS` in the VM already models.
  0xaa: { kind: "drive", note: "your hand fans out and the weakest card in it is thrown" },
  0xac: { kind: "drive", note: "the pile is sorted, fans out, and one card is taken from it" },
};

/** The ten opcodes a CARD PROGRAM performs that the disc animates.
 *
 *  Everything a program does that the player can SEE. An opcode outside this
 *  set changes the rules without touching the screen, and replaying it would
 *  only cost a frame. `0x70` is in the set but is latched by
 *  `raisePlayTarget`, not from here, because the disc asks it before the
 *  program starts. */
export const PROGRAM_BEATS: readonly number[] =
  Object.freeze([0x13, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x3f, 0x42,
                 0x4c, 0x4d, 0x53, 0x55, 0x5a, 0x8d, 0xaa, 0xac, 0xae]);

/** THE THREE MESSAGE OPCODES, corrected 2026-08-27.
 *
 *  Every prior gloss in this repository read 0x2F, 0x30 and 0x31 as
 *  presentation — "a flourish, a hold, the summon flash". They are none of
 *  those. All three call one routine, F0x80094FDC, and differ only in the
 *  number they hand it, and that number is not an effect index: the routine
 *  passes it straight to the view's prompt-open method as a MESSAGE ID. Read
 *  against the duel's own string bank the three are ordinary sentences, and
 *  each one fits where its programs put it — the card that "plays a summon
 *  flash" before a board picker and a destroy is in fact asking which Digimon
 *  to throw away because the field is full.
 *
 *  Ids from the enter dispatch arms; text from
 *  ~/ddw3/lang_file/dw2003/eng/escardgm.toml, whose entry N is line N+2. */
export const DUEL_MESSAGE: Readonly<Record<number, number>> = {
  0x2f: 0x39, // "Pick a Card to Trash."
  0x30: 0x35, // "No Cards in Deck."
  0x31: 0x3b, // "There are too many Digimon cards in\nfield. Select which to throw away."
};

/** How long a program beat holds, in the duel's own LOGIC ticks.
 *
 *  These are NOT `BEAT_FRAMES` values and must not be scaled by 60/50. Every
 *  entry in `BEAT_FRAMES` was measured latch-to-latch against the PAL screen,
 *  so it is in 50Hz displayed frames; these are durations the handlers
 *  themselves WRITE into the view, which the disc counts at 60Hz — the same
 *  clock the walker's own scheduler runs on, so they carry over 1:1.
 *
 *  CONFIRMED 2026-08-27, and it was worth confirming: every one of these
 *  numbers is compared against a counter fed by a resident supplier that had
 *  never been read, and a note left on 2026-08-27 warned that they all assume
 *  it returns 1. It does not — three field dumps hold 1, two battle dumps hold
 *  3 and 4. It does not matter. The supplier publishes the whole number of
 *  SIXTIETHS OF A SECOND accumulated since the last update: an 8.8 accumulator
 *  gains 0x100 per interrupt at 60Hz and 0x133 (1.1992) at 50Hz, so both add
 *  about 60 a second, and a late update publishes its backlog at once rather
 *  than stretching the animation. A beat length is therefore wall-clock time
 *  in sixtieths, which is exactly what the walker's scheduler counts.
 *  Ledger: `cardduel-beat-durations-are-sixtieths-not-frames-2026-08-27`.
 *
 *  A zero means the handler writes no single duration this table could carry.
 *  0x5A is arithmetic with nothing to show. 0x4D is a real variable: each marked
 *  card shakes, waits, squeezes over five and waits again, and the beat only
 *  looks for the next marked slot once the last one reports done - so its length
 *  is however many cards were marked, which no constant can hold. Those hold no
 *  frames; their animation is scheduled by the screen and outlives the beat. Do
 *  not invent a number for them.
 *
 *  0x4C is NOT one of those, and was wrongly listed as one until 2026-08-27: its
 *  handler issues every survivor's move in a single pass, all of them travelling
 *  together. Its length is a single counter for the whole board rather than a
 *  per-card cost -- and it is TWENTY, not the ten each slide takes. The handler
 *  loads 0x14 into its wait after every slide has already been issued, and only
 *  when that runs out does it swap the underlying records. Reading the move's
 *  own duration and stopping there gives ten and is wrong by half.
 *
 *  0x31 is input-gated, and genuinely so: its update waits for the message
 *  window to finish its 12-tick wipe, then polls the pad for Circle or Cross
 *  with no timeout of any kind, then waits for the window to close again. A
 *  player who never presses never leaves it. The only exit without a button is
 *  the caller's: when the play-history side byte is set, both halves of the
 *  opcode are skipped and the beat completes at once. */
export const PROGRAM_BEAT_TICKS: Readonly<Record<number, number | null>> = {
  0x13: 10,   // the glide into the played fan
  // NOT MEASURED, and 0 is a refusal to invent one rather than a claim that
  // the disc is instant: the 2026-08-26 capture never ran either opcode, so
  // no gap between latches exists for them. 0 lets the move reach the screen
  // on its own beat without asserting a length. Same posture as 0x5A.
  0x3f: 0,
  0x42: 0,
  0x2b: 10,   // the panels leave over ten (F0x8009C350's own duration)
  0x2d: 10,
  0x2c: 20,   // and come back over twenty (F0x8009C2D0's)
  0x2e: 20,
  0x2f: null, // the three message windows: no timeout, they wait for Circle or Cross
  0x30: null,
  0x31: null,
  0x4c: 20,   // every survivor slides at once over ten, then a shared wait of twenty
  0x4d: 0,    // variable: one marked card at a time, each waiting for the last
  0x53: 40,   // two legs of 20
  0x55: 40,
  0x5a: 0,    // arithmetic only
  0x8d: 20,   // the panels come in over 20
  0xae: 20,
  // The two pile pickers carry NO timer over the stage that matters. Their
  // driver `tickPilePicker` (F0x8008C044) is a four-state machine on
  // `duel+0x423`/`+0x422`, and only the two ends are timed, both off the pile
  // rather than off a constant:
  //   * the fan opens while `(duel+0x4D4)*4 + 14 >= duel+0x424`, so it holds
  //     `4*rows + 15` ticks (cardgame.s:.L0x0000969c). `+0x4D4` is READ at four
  //     sites in this overlay and WRITTEN at none, so the row count is not
  //     established and the length cannot be stated.
  //   * the commit closes while `(duel+0x434)*4 + 5 >= duel+0x424`, so it holds
  //     `4*count + 6` ticks (cardgame.s:.L0x00009814) - four per card in the
  //     pile, which is a formula and not a number.
  // Between them sits the input stage, which polls the pad and never times out.
  // So `null`: the beat waits on the pick, exactly as 0x99 does, and neither
  // end's length is invented here.
  0xaa: null,
  0xac: null,
};

/** The three places a played card comes to rest on the centre row.
 *
 *  The table at `0x800A5910`, eight bytes an entry, indexed by how deep the
 *  play stack is (`duel+0x575`). Read as 8.8 fixed point the three entries are
 *  (81, 97), (131, 97) and (181, 97) — which is where `DUEL_BOARD.centreX = 81`
 *  comes from. It is three wide, not eight. */
export const PLAYED_FAN: readonly (readonly [number, number])[] =
  Object.freeze([[81, 97], [131, 97], [181, 97]] as const);

/** Where a card enters from before it takes its place: the deck's own corner of
 *  the centre row, written as the immediates 0xE500 / 0x6100. */
export const PLAY_ENTRY: readonly [number, number] = Object.freeze([229, 97] as const);

/** How long the entering card takes to grow from nothing to full size. */
export const PLAY_ENTRY_TICKS = 8;

/** How many frames a beat OWNS before the next one is latched — the disc's
 *  pacing, measured as the gap between consecutive writes to `duel+0x421` in
 *  the 2026-08-26 capture.
 *
 *  `null` means the beat is INPUT-GATED: it holds the frame until the player
 *  answers, so it has no fixed length. Those are the prompts and browsers, and
 *  their measured gaps in the capture are an artefact of the trace's own input
 *  pulse (one tap every 60 frames), not of the game — the summon browser's
 *  "946 frames" is just how long the robot took to press square. Do not read a
 *  duration into them.
 *
 *  The timed values below are the ones the capture actually establishes, and
 *  the repeated ones agree with themselves across the two sets: 0x15 and 0x16
 *  both 168, 0xA2 151 and 152, 0xA3 71 and 71. One duel, one folder. */
/*  0x2B/0x2C/0x2D/0x2E are deliberately NOT in this table. Their durations
 *  come from the slide routines' own tick counts, which are already the
 *  walker's clock, so they live in `PROGRAM_BEAT_TICKS` and must not be run
 *  through the 50Hz-to-60Hz stretch. Putting them in both tables made
 *  `beatFrames` return the unstretched value and the ceremony unit test
 *  caught it. */
export const BEAT_FRAMES: Readonly<Record<number, number | null>> = {
  0xa0: 25,   // announce Start   (frame 5039 -> Start current at 5064)
  0xa1: 49,   // announce Draw
  0xa2: 151,  // announce Load
  0xa3: 71,   // announce Summon
  0xa4: 101,  // announce Compile
  0xa5: 63,   // announce Battle
  0xa7: 116,  // the coin toss plays out
  0x14: 231,  // the six-card deal
  0x12: 48,   // clear the played row
  0x19: 130,  // battle opens
  0x15: 168,  // damage onto the totals
  0x16: 168,  // the attack drains
  0x17: 171,  // the loser's board is swept away, card by card
  // WALKER: 0x18 is the same routine aimed at the other side, and the capture
  // never saw it — the player lost that duel. Its length is 0x17's, which is a
  // stated assumption, not a measurement.
  0x18: 171,
  0x1d: 84,   // the set is awarded
  0x9d: 3,    // the auto-pick is instant
  0x9e: 221,  // the board sweep
  // input-gated: these hold the frame until answered
  0x70: null, // which slot does the play act on
  0x98: null, // "Use a Program Card?"
  0x99: null, // the hand selector
  0x9a: null, // the summon browser
};

/** True when the beat waits on the player rather than on a timer. */
export const beatIsInputGated = (op: number): boolean =>
  PROGRAM_BEAT_TICKS[op] === null || (!(op in PROGRAM_BEAT_TICKS) && BEAT_FRAMES[op] === null);

/** The beats whose update polls the pad and carries NO timer of any kind.
 *
 *  The seven phase/challenge banners are one routine. Their shared update
 *  `F0x80089580` (`cardgame.s:6715-6799`) is a four-step machine on the step
 *  byte `duel+0x422`: step 1 waits for the info banner and the prompt window to
 *  finish opening, step 2 polls pad port 0 for logical `0xD` (Circle) or `0xE`
 *  (Cross) and advances on either, step 3 closes both windows, step 4 waits for
 *  them to go. `duel+0x424`, the beat timer, is never touched. A player who
 *  never presses never leaves the banner.
 *
 *  So the six numbers `BEAT_FRAMES` carries for `0xA0`..`0xA5` are how long ONE
 *  player took to press in the 2026-08-26 capture, not durations the game
 *  chooses — which is why they range from 25 to 151 for six identical banners.
 *  They stay in that table because they are the measurement; this set is what
 *  the game actually does with them.
 *
 *  Ledger: `cardduel-phase-banners-are-one-routine-and-wait-for-a-button-2026-08-27`.
 *  Write-up: `docs/research/card/cardduel-animation-atlas-2026-08-26.md`.
 *
 *  A headless duel (`DuelState.human === null`) has nobody to press, so it
 *  falls back to the measured hold. See `tickDuel`. */
export const BEAT_WAITS_FOR_BUTTON: ReadonlySet<number> =
  new Set([0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6,
           // 0x1B, the card reveal, is the eighth. Its update is an eight-step
           // machine whose step 6 polls the pad the same way the banners' step
           // 2 does -- port 0, the pressed word -- with no timer of its own,
           // so the plate stays up until the player presses (model doc G.12).
           0x1b]);

/** True when the beat's update polls the pad and has no timeout. */
export const beatWaitsForButton = (op: number): boolean => BEAT_WAITS_FOR_BUTTON.has(op);

/** The disc's DISPLAY rate. SLES03936 is the PAL release: the screen refreshes
 *  50 times a second, and every duration in BEAT_FRAMES above was measured
 *  latch-to-latch against that refresh, so those numbers are in 50Hz displayed
 *  frames. */
export const DISC_HZ = 50;

/** The walker's own clock — `Math.floor(performance.now() / (1000 / 60))` in
 *  web/game.js, i.e. one tick per animation frame at 60Hz. */
export const WALKER_HZ = 60;

/** Frames this beat holds the screen; 0 for anything with no measured pacing.
 *
 *  THE TWO CLOCKS. Established 2026-08-26 by sampling the resident frame-delta
 *  global `D0x8004DE28` on the rig once per vsync over 900 frames: it reads 1 on
 *  720 frames and 2 on 180 — mean exactly 1.2000, in a clean period-5 pattern,
 *  one 2 every fifth frame. The disc runs 60Hz game LOGIC on a 50Hz PAL DISPLAY.
 *
 *  That leaves the duel with two different units, and they must not be confused:
 *
 *    * a card sprite's `duration` (DEAL_DURATION and friends in card-animation.ts)
 *      is read straight out of the sprite object, so it counts LOGIC ticks — 60
 *      a second. The walker steps one per animation frame at 60Hz, so those
 *      tweens already run at the right wall-clock speed. Nothing to correct.
 *    * BEAT_FRAMES was measured against the 50Hz DISPLAY, so it counts displayed
 *      frames. Holding a beat for that many walker frames at 60Hz ran the whole
 *      ceremony 20% fast: the 151-frame Load banner is 3.02s on the disc and was
 *      2.52s here.
 *
 *  So the conversion happens HERE, at the point of use, and `BEAT_FRAMES` keeps
 *  the verbatim measured numbers — they are the evidence, and scaling them in
 *  place would destroy it. */
export const beatFrames = (op: number): number => {
  // A program beat's duration is written by the handler in logic ticks, which
  // are already the walker's own clock — no 60/50 conversion. See
  // `PROGRAM_BEAT_TICKS`.
  const ticks = PROGRAM_BEAT_TICKS[op];
  if (ticks !== undefined) return ticks ?? 0;
  const measured = BEAT_FRAMES[op];
  if (measured == null) return 0;
  return Math.round(measured * (WALKER_HZ / DISC_HZ));
};

/** Every ceremony opcode this module knows, ascending. */
export const CEREMONY_OPCODES: readonly number[] =
  Object.keys(CEREMONY).map(Number).sort((a, b) => a - b);

export const ceremonyGloss = (op: number): string => CEREMONY[op]?.note ?? `opcode 0x${op.toString(16)}`;

export const ceremonyKind = (op: number): CeremonyKind => CEREMONY[op]?.kind ?? "inline";

/** Latch one opcode, exactly as the disc writes `duel+0x421`, and record it.
 *
 *  Returns the beat so a caller that owns a "drive" opcode can act on it. */
export function latch(duel: DuelState, phase: DuelPhaseKey, op: number): CeremonyBeat {
  const beat: CeremonyBeat = { phase, op, kind: ceremonyKind(op), note: ceremonyGloss(op) };
  duel.ceremony.push(beat);
  return beat;
}

/** Latch an opcode the machine reached rather than one the phase scheduled.
 *
 *  Some beats are not on the phase's fixed list: the disc latches them when the
 *  play machine actually arrives at them. `0x70`, the targeting prompt, is the
 *  one that behaves this way — it is issued only when a played card's program
 *  really has a target to ask about. The phase it is attributed to is whichever
 *  phase is currently running. */
export function latchDynamic(duel: DuelState, op: number): CeremonyBeat {
  const beat = latch(duel, duel.ceremonyPhaseKey, op);
  duel.beat.replay.push(op);
  return beat;
}

/** Latch one step of a card program so the screen plays it out.
 *
 *  The interpreter has ALREADY applied the step's rules, so this queues it on
 *  the screen-only lane. Anything outside `PROGRAM_BEATS` is silent on the disc
 *  and is dropped rather than costing a frame. */
export function latchProgramBeat(duel: DuelState, op: number): boolean {
  if (!PROGRAM_BEATS.includes(op)) return false;
  latch(duel, duel.ceremonyPhaseKey, op);
  duel.beat.replay.push(op);
  return true;
}

/** Issue a phase's whole ceremony: the banner first, then the phase's own
 *  opcodes in the captured order. Called at the top of each phase. */
export function issueCeremony(duel: DuelState, phase: DuelPhaseKey, stream?: readonly number[]): CeremonyBeat[] {
  const beats = [latch(duel, phase, BANNER_OPCODE[phase])];
  for (const op of stream ?? PHASE_CEREMONY[phase]) beats.push(latch(duel, phase, op));
  return beats;
}


/** The opcodes issued so far, in order. */
export const issuedOpcodes = (duel: DuelState): number[] => duel.ceremony.map((b) => b.op);

/** How much of the ceremony our duel now issues, and how much of what it issues
 *  it actually drives rather than performing inline. This is the number the
 *  2026-08-25 audit measured as `0 of 74`. */
export function ceremonyCoverage(duel: DuelState): {
  issued: number;
  distinct: number;
  driven: number;
  inline: number;
} {
  const seen = new Set(duel.ceremony.map((b) => b.op));
  return {
    issued: duel.ceremony.length,
    distinct: seen.size,
    driven: duel.ceremony.filter((b) => b.kind === "drive").length,
    inline: duel.ceremony.filter((b) => b.kind === "inline").length,
  };
}

/** What the disc DRAWS for a beat — the third unit this module has to keep
 *  straight, beside displayed frames and logic ticks.
 *
 *  Every duel beat is one of three things, and the difference is not cosmetic:
 *
 *    * `animates` — the beat reaches at least one animation primitive through
 *      the method table F0x8009D310 installs into the view object at duel start.
 *      Something moves on screen. If the walker has no case for it, the player
 *      is missing a picture the original showed.
 *    * `logic`    — the beat has callees but reaches no animation primitive.
 *      It changes the rules, not the screen. The walker's generic "make the
 *      sprites match the model" is the CORRECT response, not a stand-in.
 *    * `noop`     — the beat falls straight to the shared exit. The disc draws
 *      nothing and neither should we.
 *
 *  That distinction is what makes an unhandled beat reportable. Without it every
 *  unhandled opcode looks identical, and the 57 rules-only beats drown out the
 *  ones that are genuinely missing artwork.
 *
 *  GENERATED, do not hand-edit: rows come from
 *  docs/research/card/cardduel-opcode-atlas.md, written by
 *  tools/cardduel_opcode_atlas.py, which resolves each opcode's enter and update
 *  callees through the runtime table. tests/engine/unit/card-opcode-class.test.ts
 *  re-parses that document and fails if this table drifts from it. */
export type DuelOpcodeClass = "animates" | "logic" | "noop";

/** The duel's opcode space is 0x01..0xAE. */
export const DUEL_OPCODE_COUNT = 174;

export const OPCODE_CLASS: Readonly<Record<number, DuelOpcodeClass>> = {
  0x01: "logic",      0x02: "noop",       0x03: "noop",       0x04: "noop",
  0x05: "noop",       0x06: "noop",       0x07: "logic",      0x08: "logic",
  0x09: "logic",      0x0a: "logic",      0x0b: "logic",      0x0c: "logic",
  0x0d: "logic",      0x0e: "logic",      0x0f: "logic",      0x10: "logic",
  0x11: "noop",       0x12: "animates",   0x13: "animates",   0x14: "animates",
  0x15: "animates",   0x16: "animates",   0x17: "animates",   0x18: "animates",
  0x19: "animates",   0x1a: "animates",   0x1b: "animates",   0x1c: "animates",
  0x1d: "animates",   0x1e: "animates",   0x1f: "animates",   0x20: "animates",
  0x21: "animates",   0x22: "animates",   0x23: "animates",   0x24: "animates",
  0x25: "animates",   0x26: "animates",   0x27: "animates",   0x28: "animates",
  0x29: "animates",   0x2a: "logic",      0x2b: "animates",   0x2c: "animates",
  0x2d: "animates",   0x2e: "animates",   0x2f: "animates",   0x30: "animates",
  0x31: "animates",   0x32: "logic",      0x33: "logic",      0x34: "logic",
  0x35: "logic",      0x36: "logic",      0x37: "logic",      0x38: "logic",
  0x39: "logic",      0x3a: "logic",      0x3b: "logic",      0x3c: "logic",
  0x3d: "logic",      0x3e: "animates",   0x3f: "animates",   0x40: "animates",
  0x41: "animates",   0x42: "animates",   0x43: "animates",   0x44: "animates",
  0x45: "logic",      0x46: "logic",      0x47: "logic",      0x48: "animates",
  0x49: "animates",   0x4a: "noop",       0x4b: "logic",      0x4c: "animates",
  0x4d: "animates",   0x4e: "animates",   0x4f: "animates",   0x50: "animates",
  0x51: "animates",   0x52: "animates",   0x53: "animates",   0x54: "animates",
  0x55: "animates",   0x56: "animates",   0x57: "animates",   0x58: "animates",
  0x59: "animates",   0x5a: "animates",   0x5b: "logic",      0x5c: "animates",
  0x5d: "logic",      0x5e: "logic",      0x5f: "logic",      0x60: "logic",
  0x61: "logic",      0x62: "logic",      0x63: "logic",      0x64: "logic",
  0x65: "logic",      0x66: "logic",      0x67: "logic",      0x68: "logic",
  0x69: "logic",      0x6a: "logic",      0x6b: "logic",      0x6c: "logic",
  0x6d: "logic",      0x6e: "logic",      0x6f: "logic",      0x70: "animates",
  0x71: "animates",   0x72: "animates",   0x73: "animates",   0x74: "animates",
  0x75: "animates",   0x76: "animates",   0x77: "animates",   0x78: "animates",
  0x79: "animates",   0x7a: "animates",   0x7b: "animates",   0x7c: "animates",
  0x7d: "animates",   0x7e: "animates",   0x7f: "animates",   0x80: "animates",
  0x81: "animates",   0x82: "animates",   0x83: "animates",   0x84: "animates",
  0x85: "logic",      0x86: "logic",      0x87: "logic",      0x88: "logic",
  0x89: "logic",      0x8a: "logic",      0x8b: "logic",      0x8c: "logic",
  0x8d: "animates",   0x8e: "animates",   0x8f: "animates",   0x90: "animates",
  0x91: "animates",   0x92: "animates",   0x93: "animates",   0x94: "animates",
  0x95: "animates",   0x96: "logic",      0x97: "animates",   0x98: "animates",
  0x99: "animates",   0x9a: "animates",   0x9b: "animates",   0x9c: "animates",
  0x9d: "animates",   0x9e: "animates",   0x9f: "animates",   0xa0: "animates",
  0xa1: "animates",   0xa2: "animates",   0xa3: "animates",   0xa4: "animates",
  0xa5: "animates",   0xa6: "animates",   0xa7: "animates",   0xa8: "animates",
  0xa9: "animates",   0xaa: "animates",   0xab: "animates",   0xac: "animates",
  0xad: "animates",   0xae: "animates",
};

/** True when the original draws something for this beat, so a walker that has
 *  no case for it is visibly missing something. False for rules-only and no-op
 *  beats, where falling through to a plain sprite resync is what the disc does. */
export const beatNeedsAnimation = (op: number): boolean =>
  OPCODE_CLASS[op] === "animates";
