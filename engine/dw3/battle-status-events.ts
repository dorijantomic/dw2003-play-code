/**
 * THE BATTLE STATUS-EVENT POOL — one module, every member.
 *
 * The original keeps a 99-slot, 28-byte-stride pool of timed events at `0x800a3868`
 * (`pro/fightstg.s:25706` `addiu $a1, $v0, 0x3868`, stride `0x1c` from
 * `:25764 addiu $a1, 0x1c`). The queue IS the battle clock: there is no frame tick,
 * `FIGHTSTG_F0x8009ba4c` (`pro/fightstg.s:25779`) picks the entry with the smallest
 * `+0x2` time, subtracts that time from every queued entry, and hands the fired entry's
 * code back to the caller (`pro/wfightstg.s:25818`-`:25870`).
 *
 * ## The pool, exactly
 *
 * | entry | size | meaning | written by |
 * |---|---|---|---|
 * | `+0x00` | u16 | event code; 0 means the slot is free | `FIGHTSTG_F0x8009b930` :25788 |
 * | `+0x02` | u16 | time remaining, in timeline units | :25791 |
 * | `+0x04` | u32 | side (0 player / 0x10 enemy) | :25797 |
 * | `+0x08` | u32 | slot index inside that side | :25797 (the loop copies six words) |
 * | `+0x0c` | u32 | payload 1 | :25797 |
 * | `+0x10` | u32 | payload 2 | :25797 |
 *
 * The enqueue copies the request at `0x800a4780` — `+0x00` code, `+0x04` time, then six
 * words from `+0x08` — into the first free slot, so **request `+0x0c` lands on entry
 * `+0x08` (the slot) and request `+0x10` lands on entry `+0x0c` (payload 1)**. The
 * per-code stagers below name which of those they mean.
 *
 * ## One timeline unit is one action's worth of delay
 *
 * `FIGHTSTG_F0x8009bda4(side, opcode)` (`pro/fightstg.s:26017`) is the delay function, not
 * a magnitude function — the old note that called it "magnitude" is withdrawn. Its
 * default arm is the speed-ratio formula: `trunc(base * opp.SPD / isqrt(own.SPD *
 * opp.SPD))` with `own = effstats(side)` and `opp = effstats(other side)`
 * (`:26168`-`:26294`), clamped by the per-opcode `[base, min, max]` triple at
 * `0x800a4384` (`:26296`-`:26302`). Opcode 0's triple is `[1000, 707, 1414]`, so one
 * nominal action is **707..1414 units** and the whole system is expressed in those.
 *
 * ## The member list is decoded, not hand-picked
 *
 * {@link STATUS_EVENT_CODES} has one row for every code any stager in `fightstg`
 * produces — the twenty-four rows of `FIGHTSTG_F0x8009cd1c`..`F0x8009d06c` plus the four
 * turn/outcome stagers before them — and each row names the stager routine that is its
 * only producer. `tests/battle-status-events.test.js` re-derives that list from the
 * shipped data and the ledger's own stager addresses, so the table cannot drift.
 */

/** Slots in the pool (`sltiu $v0, $v0, 0x63` — `:25756`, `:25760`). */
export const STATUS_EVENT_POOL_SIZE = 99;

/** Bytes per entry (`addiu $a1, 0x1c`). */
export const STATUS_EVENT_STRIDE = 0x1c;

/**
 * The per-opcode `[base, min, max]` triples at `0x800a4384`, read from the shipped
 * `pro/fightstg` image (`pro/fightstg.s:34855`-`:34875`). A `min` or `max` of 0 means
 * that bound is not applied (`:26296 beqz` / `:26300 beqz`).
 */
export const STATUS_EVENT_OPCODE_PARAMS: readonly (readonly [number, number, number])[] =
  Object.freeze([
    [1000, 707, 1414],   // 0: one nominal action
    [250, 176, 353],     // 1: the `-1` special command
    [2001, 1001, 0],     // 2: the repeating per-side status tick
    [2000, 0, 0],        // 3
    [2500, 0, 0],        // 4
    [3000, 0, 0],        // 5
    [3500, 0, 0],        // 6
    [4000, 0, 0],        // 7
    [0, 2000, 6000],     // 8
    [500, 1000, 0],      // 9
    [500, 1000, 0],      // 10
    [500, 500, 0],       // 11
    [2001, 0, 0],        // 12
]);

/**
 * The consumer chain: the 24-row pointer table at `0x800a5e6c`, indexed `code - 1`
 * (`pro/wfightmn.s:4090`-`:4107` — `lw $v0, 0x14($s0)` / `addiu $v1, $v0, -0x1` /
 * `sltiu $v0, $v1, 0x18` / `sll $v1, 0x2` / `addu $v1, $v0` / `lw $v0, ($v1)` /
 * `jr $v0`, where `+0x14` is the code the advance routine handed back).
 *
 * Twenty-three of the twenty-four entries are the SAME four-instruction thunk
 * (`move_ $a0, $s0` / `lw $v0, 0x2c($a0)` / `j 0x800a9fd4` / `li $a1, <opcode>`), so a
 * fired code becomes one **action type** the actor's own method is called with. Code 3's
 * entry (`0x800a9e18`) is the one real body — the mode-gated arm that reads the workspace
 * word `0x800a4460+0xd6`.
 *
 * Row `code - 1` = the action type, in code order. Read out of the shipped image
 * (`web/assets/native/screens/pro_wfightmn.bin`, each thunk's `li $a1, N` at offset 12).
 */
export const STATUS_EVENT_CONSUMER_ACTION_TYPES: readonly number[] = Object.freeze([
  0x07, 0x03, 0x02, 0x08, 0x09, 0x0a, 0x0b, 0x03,
  0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x10, 0x10, 0x12,
  0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x19, 0x1a,
]);

/**
 * The same chain's second hop: the action-type table at `0x800aade4`, indexed
 * `actionType - 3` (`pro/wfightmn.s:4051`-`:4058` — `addiu $v0, $v1, -0x3` /
 * `sltiu $v0, 0x18` / `sll $v1, 0x2` / `lw $v0, ($v1)` / `j 0x800a9fd4`, where the table
 * base is `lui $v0, 0x800b` + `addiu $v0, -0x521c` = **0x800aade4**). Its entries are the
 * per-actor machines of `pro/wfightmn.s`, and the first three (action types 3, 4 and 5) are
 * ZERO in the disc image — they are filled at run time, which is why they cannot be read.
 *
 * Row `actionType - 3`, action types 3..0x1a.
 */
export const STATUS_EVENT_ACTION_HANDLERS: readonly (number | null)[] = Object.freeze([
  null, null, null,
  0x800a7418, 0x800a77b4, 0x800a78d8, 0x800a7b08, 0x800a7c00,
  0x800a7fe4, 0x800a8118, 0x800a8260, 0x800a8458, 0x800a84d0,
  0x800a8770, 0x800a8770, 0x800a8770, 0x800a88cc,
  0x800a89f0, 0x800a8ac8, 0x800a8bf4, 0x800a8e90,
  0x800a8f88, 0x800a9584, 0x800a9640,
]);

/** The action type the fired code's consumer thunk calls the actor's method with. */
export function statusEventActionType(code: number): number | null {
  const row = STATUS_EVENT_CONSUMER_ACTION_TYPES[(code | 0) - 1];
  return row === undefined ? null : row;
}

/**
 * The `pro/wfightmn.s` machine the code's consumer reaches, or `null` for the three
 * run-time-populated action types.
 */
export function statusEventActionHandler(code: number): number | null {
  const type = statusEventActionType(code);
  if (type === null) return null;
  return STATUS_EVENT_ACTION_HANDLERS[(type | 0) - 3] ?? null;
}

/**
 * The four ailments, each with the code its recovery is queued under and the record `+0x1c`
 * bit that code's stager sets.
 *
 * The pairing is read off two independent places and they agree:
 *
 * | ailment | code | bit | stager's bit write | the caller that stages it |
 * |---|---|---|---|---|
 * | poison | `0x09` | `0x01` | `ori $v0, 0x1` `pro/fightstg.s:26743` | the apply arm with `li $v0, 0x1e` `:15200` |
 * | frozen | `0x0a` | `0x02` | `ori $v0, 0x2` `:26797` | `li $v0, 0x1f` `:15210` |
 * | confused | `0x0b` | `0x04` | `ori $v0, 0x4` `:26898` | `li $v0, 0x20` `:15220` |
 * | asleep | `0x0c` | `0x08` | `ori $v0, 0x8` `:26970` | `li $v0, 0x21` `:15230` |
 *
 * and the turn-start gate names the bits `FIGHTSTG_F0x80088564`: `0x8` is "Asleep!"
 * (`:5979`-`:5986`), `0x2` is "Frozen and can't move!" (`:5987`-`:6000`), `0x4` is the
 * confusion joke line (`:6003`-`:6040`).
 *
 * **This corrects the shipped table**: it had `0x0b` named "sleep" and `0x0c` named
 * "confused". The two lines above each settle the pairing on their own.
 */
export const STATUS_EVENT_AILMENTS: readonly {
  ailment: string; code: number; bit: number; id: number; delayOpcode: 8 | 9 | 10 | 11;
}[] = Object.freeze([
  { ailment: "poison", code: 0x09, bit: 0x01, id: 0x1e, delayOpcode: 8 },
  { ailment: "frozen", code: 0x0a, bit: 0x02, id: 0x1f, delayOpcode: 9 },
  { ailment: "confuse", code: 0x0b, bit: 0x04, id: 0x20, delayOpcode: 8 },
  { ailment: "sleep", code: 0x0c, bit: 0x08, id: 0x21, delayOpcode: 11 },
]);

/** The pool code one ailment's recovery is queued under, or `null`. */
export function statusEventAilmentCode(ailment: string): number | null {
  return STATUS_EVENT_AILMENTS.find((r) => r.ailment === ailment)?.code ?? null;
}

/** The record `+0x1c` bit one ailment's flag byte owns, or `null`. */
export function statusEventAilmentBit(ailment: string): number | null {
  return STATUS_EVENT_AILMENTS.find((r) => r.ailment === ailment)?.bit ?? null;
}


/** How a code's expiry reaches the game's own data. */
export type StatusEventPortState =
  /** Written onto a combatant record and reproduced by the walker. */
  | "ported"
  /** Decoded to a name and a target, but its effect needs machinery outside this port. */
  | "named-not-ported";

/** One member of the pool: a code, its only stager, and what its expiry does. */
export interface StatusEventCodeRow {
  /** The event code, the pool entry's `+0x00`. */
  readonly code: number;
  /** The plain-language name this member carries. */
  readonly name: string;
  /**
   * The one `FIGHTSTG_F0x8009*` routine that stages this code, as the address the disc's
   * own symbol map prints. `null` when a code has no producer in `fightstg`.
   */
  readonly stager: number | null;
  /** The delay opcode the stager asks {@link statusEventDelay} for, or `null`. */
  readonly delayOpcode: number | null;
  /**
   * The record `+0x1c` bit this code's STAGER sets, or `null` when it writes none.
   * Read off the stager's own `ori $v0, <bit>` immediately before
   * `sb $v0, 0x1c($v1)` (`pro/fightstg.s:26743` code 9, `:26797`…`:26798` code 10,
   * `:26898`-`:26899` code 11, `:26970`-`:26971` code 12), and named by the turn-start
   * gate `FIGHTSTG_F0x80088564` (`andi $v0, $v1, 0x8` → "Asleep!" `:5979`,
   * `0x2` → "Frozen and can't move!" `:5987`, `0x4` → the confusion joke `:6003`).
   */
  readonly recordBit?: number;
  /** Whether the expiry is reproduced here. */
  readonly portState: StatusEventPortState;
  /** Why a named-not-ported row is not ported. */
  readonly reason?: string;
}

/**
 * Every code any stager in `fightstg` produces, in code order. The twenty-four rows match
 * the twenty-four rows of the consumer table at `pro/wfightmn.s:4095`-`:4152`
 * (`index = code - 1`, `sltiu $v0, $v1, 0x18`), so a code that is staged is a code the
 * battle controller can fire.
 *
 * Codes `0x0d`/`0x0e`/`0x0f` and `0x10`/`0x11` are the ones the category-5 techniques
 * stage and the ones this module expires.
 */
export const STATUS_EVENT_CODES: readonly StatusEventCodeRow[] = Object.freeze([
  {
    code: 0x01, name: "battle outcome", stager: 0x8009c534, delayOpcode: null,
    portState: "named-not-ported",
    reason: "its selector decides win / lose / flee and the walker's battle end states " +
      "already own that; `sb $a0, 0x435c` :27111 is the selector byte and " +
      "`FIGHTSTG_F0x8009c534` preempts the queue to fire it.",
  },
  {
    code: 0x02, name: "player action turn", stager: 0x8009c4bc, delayOpcode: null,
    portState: "ported",
  },
  {
    code: 0x03, name: "enemy action turn", stager: 0x8009c4f8, delayOpcode: null,
    portState: "ported",
  },
  {
    code: 0x04, name: "the -1 special command", stager: 0x8009c578, delayOpcode: 1,
    portState: "named-not-ported",
    reason: "DW3 has no `-1` command in play (see battle-formula-leaves.md S8b), and the " +
      "consumer is consume-on-turn presentation only (fightstg.s:5975).",
  },
  {
    code: 0x05, name: "the per-side status tick", stager: 0x8009c5e8,
    delayOpcode: 2, portState: "ported",
  },
  {
    code: 0x06, name: "a per-fighter timed event", stager: 0x8009c6a4, delayOpcode: null,
    portState: "named-not-ported",
    reason: "its three callers pass the Blast / form-change payloads " +
      "(`li $v0, 0xbd` :26631), and those live on the form-change machine.",
  },
  {
    code: 0x07, name: "a global timed event", stager: 0x8009c740, delayOpcode: null,
    portState: "named-not-ported",
    reason: "the only stager is the camera / cutscene schedule on side -1 " +
      "(`li $v0, -0x1` :26685); the walker has no cutscene clock.",
  },
  {
    code: 0x08, name: "the Blast expiry", stager: 0x8009ce84, delayOpcode: null,
    portState: "named-not-ported",
    reason: "time is the clamped constant `0x7fff` :27142 and the consumer is the " +
      "form-change machine; the walker's Blast schedule is `tickBlastTurn` " +
      "(web/battle.js:2943).",
  },
  {
    code: 0x09, name: "the poison tick", stager: 0x8009c7d4, delayOpcode: null,
    recordBit: 0x01, portState: "ported",
  },
  {
    code: 0x0a, name: "ailment recovery (frozen)", stager: 0x8009c8b0, delayOpcode: 9,
    recordBit: 0x02, portState: "ported",
  },
  {
    code: 0x0b, name: "ailment recovery (confused)", stager: 0x8009c9c0,
    delayOpcode: 8, recordBit: 0x04, portState: "ported",
  },
  {
    code: 0x0c, name: "ailment recovery (asleep)", stager: 0x8009cb10, delayOpcode: 11,
    recordBit: 0x08, portState: "ported",
  },
  {
    code: 0x0d, name: "attack modifier expiry", stager: 0x8009cc20, delayOpcode: 12,
    portState: "ported",
  },
  {
    code: 0x0e, name: "defense modifier expiry", stager: 0x8009cc20, delayOpcode: 12,
    portState: "ported",
  },
  {
    code: 0x0f, name: "speed modifier expiry", stager: 0x8009cc20, delayOpcode: 12,
    portState: "ported",
  },
  {
    code: 0x10, name: "the cannot-flee lock expiry", stager: 0x8009cd1c, delayOpcode: null,
    portState: "ported",
  },
  {
    code: 0x11, name: "the cannot-digivolve lock expiry", stager: 0x8009cd1c,
    delayOpcode: null, portState: "ported",
  },
  {
    code: 0x12, name: "a zero-time cue", stager: 0x8009ced0, delayOpcode: null,
    portState: "named-not-ported",
    reason: "it writes only the code and `sw $zr, 0x4($a0)` :27190 — time zero, every " +
      "other field left as the previous request's — and its caller is presentation only.",
  },
  {
    code: 0x13, name: "the queued form-change expiry", stager: 0x8009cf00, delayOpcode: null,
    portState: "named-not-ported",
    reason: "`addiu $a1, $a0, 0x3` :27181 makes the delay opcode a CALLER's argument, " +
      "and the consumer is the form-change machine.",
  },
  {
    code: 0x14, name: "a preempted per-side cue", stager: 0x8009cf54, delayOpcode: null,
    portState: "named-not-ported",
    reason: "presentation cue: time 1, preempted, and no record write anywhere.",
  },
  {
    code: 0x15, name: "a preempted cue", stager: 0x8009cfb0, delayOpcode: null,
    portState: "named-not-ported",
    reason: "as code 0x14 — time 1, preempted, no record write.",
  },
  {
    code: 0x16, name: "technique 391's own expiry", stager: 0x8009cff4, delayOpcode: null,
    portState: "named-not-ported",
    reason: "the only stager is Helter Skelter's arm (`jal` pro/fightstg.s:13925) and " +
      "the time is the constant 1 (:27257); the consumer chain runs through the " +
      "form-change machine, so its effect is not readable from this job's evidence.",
  },
  {
    code: 0x17, name: "a preempted cue", stager: 0x8009d038, delayOpcode: null,
    portState: "named-not-ported",
    reason: "as code 0x14 — time 1, preempted, no record write.",
  },
  {
    code: 0x18, name: "the 3000-unit form cue", stager: 0x8009d06c, delayOpcode: null,
    portState: "named-not-ported",
    reason: "its stager also writes the form bytes `0x800a44db` and record `+0x82` / " +
      "`+0x86` (:27292-:27310), which is the form-change machine's own work.",
  },
]);

/** One queued event, the pool entry laid out as the disc's own struct. */
export interface StatusEventEntry {
  /** `+0x00` — 0 means the slot is free. */
  code: number;
  /** `+0x02` — time remaining in timeline units. */
  time: number;
  /** `+0x04` — 0 the player, `0x10` the enemy, `-1` for the singletons. */
  side: number;
  /** `+0x08` — the fighter's slot index inside that side. */
  slot: number;
  /** `+0x0c` — payload 1. */
  payload: number;
  /** `+0x10` — payload 2. */
  payload2: number;
}

/** A pool: 99 entries, index 0 first, as the disc keeps them. */
export type StatusEventPool = StatusEventEntry[];

/** An empty pool, every slot free. */
export function emptyStatusEventPool(): StatusEventPool {
  return Array.from({ length: STATUS_EVENT_POOL_SIZE }, () => ({
    code: 0, time: 0, side: 0, slot: 0, payload: 0, payload2: 0,
  }));
}

/** The two stat codes the pool carries, indexed by the stat number 0/1/2. */
export const STATUS_EVENT_STAT_CODES: readonly number[] = Object.freeze([
  0x0d, 0x0e, 0x0f,
]);

/** The two lock codes, in the order `.L0x800a43ec` lists them. */
export const STATUS_EVENT_LOCK_CODES: readonly number[] = Object.freeze([0x10, 0x11]);

/**
 * Which lock a code is: 0 for `0x10` (the record's `+0x1c` bit `0x10`, which
 * `pro/fightstg.s:27134 ori $v0, 0x10` sets) and 1 for `0x11` (bit `0x20`,
 * `:27141 ori $v0, 0x20`). `null` for every other code.
 */
export function statusEventLockIndex(code: number): 0 | 1 | null {
  if ((code | 0) === 0x10) return 0;
  if ((code | 0) === 0x11) return 1;
  return null;
}

/** The record `+0x1c` bit a lock code owns, or `null`. */
export function statusEventLockBit(code: number): number | null {
  const index = statusEventLockIndex(code);
  return index === null ? null : index === 0 ? 0x10 : 0x20;
}

/** The stat a code restores, 0 attack / 1 defense / 2 speed, or `null`. */
export function statusEventStatIndex(code: number): 0 | 1 | 2 | null {
  const index = STATUS_EVENT_STAT_CODES.indexOf(code | 0);
  if (index < 0) return null;
  return index as 0 | 1 | 2;
}

/**
 * `FIGHTSTG_F0x8009bba8` / `F0x8009bc94` — find the queued entry with this code, side and
 * slot, or `-1` (`pro/fightstg.s:25879`-`:25886` scans the 99 slots; `:25921 beq` compares
 * `+0x4` then `+0x8`).
 */
export function findStatusEvent(
  pool: StatusEventPool, code: number, side: number, slot: number,
): number {
  for (let i = 0; i < pool.length; i++) {
    const e = pool[i];
    if (!e || e.code === 0) continue;
    if (e.code !== (code | 0)) continue;
    if ((e.side | 0) !== (side | 0)) continue;
    if ((e.slot | 0) !== (slot | 0)) continue;
    return i;
  }
  return -1;
}

/**
 * `FIGHTSTG_F0x8009b930` — copy the request into the first FREE slot
 * (`beqz $v0` :25742 takes the branch that keeps looking) and return its index, or `-1`
 * when all 99 are taken.
 */
export function enqueueStatusEvent(pool: StatusEventPool, entry: StatusEventEntry): number {
  for (let i = 0; i < pool.length; i++) {
    const e = pool[i];
    if (!e) continue;
    if (e.code !== 0) continue;
    e.code = entry.code | 0;
    e.time = entry.time | 0;
    e.side = entry.side | 0;
    e.slot = entry.slot | 0;
    e.payload = entry.payload | 0;
    e.payload2 = entry.payload2 | 0;
    return i;
  }
  return -1;
}

/**
 * `FIGHTSTG_F0x8009b9d0` — the preempt enqueue: add the request's time (floored at 2) to
 * EVERY queued entry, then insert the request with time 1
 * (`pro/fightstg.s:25780`-`:25792`, `:25798 beqz` / `:25788 li $v0, 0x1`).
 */
export function preemptStatusEvent(pool: StatusEventPool, entry: StatusEventEntry): number {
  const time = Math.max(2, entry.time | 0);
  for (const e of pool) {
    if (!e || e.code === 0) continue;
    e.time = (e.time + time) & 0xffff;
  }
  return enqueueStatusEvent(pool, { ...entry, time: 1 });
}

/** What `FIGHTSTG_F0x8009ba4c` hands back: the fired entry's index, code and time. */
export interface StatusEventPick {
  index: number;
  code: number;
  time: number;
}

/**
 * The per-code "free the slot when it fires" table at `0x800a3800`, read as
 * `code * 4` (`sll $v0, 0x18` / `sra $v0, 0x16` `pro/fightstg.s:25844`-`:25848`).
 *
 * `1` frees the entry, `-1` leaves it queued (the repeating members), `0` fires nothing
 * (`:25856 beq $v1, -1` → return without clearing, `:25860 bnez` → clear, `:25856`'s
 * fall-through returns zero).
 */
export const STATUS_EVENT_KEEP_QUEUED_CODES: readonly number[] = Object.freeze([0x04, 0x06, 0x09]);

/** Whether the table at `0x800a3800` frees this code's slot when it fires. */
export function statusEventFreesSlot(code: number): boolean {
  return (code | 0) !== 0 && !STATUS_EVENT_KEEP_QUEUED_CODES.includes(code | 0);
}

/**
 * `FIGHTSTG_F0x8009ba4c` — pick the entry with the smallest `+0x2`, subtract that time
 * from every queued entry (the delta queue, `pro/fightstg.s:25830`-`:25844`), and return
 * the fired entry. `null` when nothing is queued.
 */
export function pickNextStatusEvent(pool: StatusEventPool): StatusEventPick | null {
  let best = -1;
  let bestTime = 0x7fff;
  for (let i = 0; i < pool.length; i++) {
    const e = pool[i];
    if (!e || e.code === 0) continue;
    const time = e.time | 0;
    // A strictly earlier entry always wins. One that is NOT strictly earlier only takes
    // over from an incumbent whose code is 2 or 3 -- `lhu $v0, ($v1)` / `addiu $v0, -0x2`
    // / `sltiu $v0, 0x2` / `beqz $v0` on the INCUMBENT's code, not the newcomer's
    // (`pro/fightstg.s:25799`-`:25812`). So those two codes yield on a tie and the earlier
    // slot keeps an otherwise equal one.
    const incumbentCode = best >= 0 ? pool[best]!.code | 0 : 0;
    if (time < bestTime || (best >= 0 && ((incumbentCode - 2) >>> 0) < 2)) {
      best = i;
      bestTime = time;
    }
  }
  if (best < 0) return null;
  for (const e of pool) {
    if (!e || e.code === 0) continue;
    e.time = (e.time - bestTime) & 0xffff;
  }
  const fired = pool[best];
  if (!fired) return null;
  return { index: best, code: fired.code | 0, time: bestTime };
}

/**
 * `FIGHTSTG_F0x8009bd44` — free the queued entry whose code, side and slot match, over
 * all 99 slots (`pro/fightstg.s:25959`-`:25987`). `0x1c` per step, `< 0x63` bound.
 */
export function removeStatusEvent(
  pool: StatusEventPool, code: number, side: number, slot: number,
): boolean {
  const index = findStatusEvent(pool, code, side, slot);
  const entry = index < 0 ? null : pool[index];
  if (!entry) return false;
  entry.code = 0;
  return true;
}

/**
 * `FIGHTSTG_F0x8009bda4`'s integer square root: a ten-step Babylonian loop seeded at 999
 * (`li $a0, 0x3e7` / `li $a1, 0x9`, 0x8009c224-0x8009c264). Each step halves
 * `guess + value/guess` toward zero — `srl $v1, $v0, 0x1f` / `addu $v0, $v1` / `sra $a0, $v0, 1`.
 */
export function statusEventIsqrt(value: number): number {
  let guess = 999;
  for (let n = 9; n >= 0; n--) {
    const sum = Math.floor(value / guess) + guess;
    guess = sum >>> 1;
  }
  return guess;
}

/** The two sides of the delay formula's speed ratio. */
export interface StatusEventSpeed {
  /** The side handed to `FIGHTSTG_F0x8009bda4` — its effective SPD. */
  own: number;
  /** The OTHER side's effective SPD. */
  opp: number;
}

/**
 * `FIGHTSTG_F0x8009bda4`'s default arm, for every opcode outside the jump table
 * (`0x800831e4`) — the opcodes 0, 1 and 3..7 (`:26016 sltiu` / `:26022 beqz`).
 *
 * `delay = trunc(base * opp.SPD / isqrt(own.SPD * opp.SPD))`, which is
 * `base * sqrt(opp.SPD / own.SPD)`, then the opcode's floor and ceiling when they are
 * non-zero.
 *
 * The numerator's SPD is the OTHER side's. The arm calls the getter `[0x800a4600]` twice
 * (`pro/fightstg.s:26283-:26305`): first with the side byte it was HANDED and flag 1
 * (`jalr` at 0x8009c1e8), then with the complementary byte `0x10 - side` and flag 0
 * (`jalr $v1` at 0x8009c21c). That second `jalr` has `move_ $s0, $v0` in its DELAY SLOT,
 * which runs before the call, so `$s0` keeps the FIRST result (the handed side); then
 * `move_ $a3, $v0` (0x8009c228) takes the second result (the other side). The multiply
 * reads `lh $v0, 0xa($a3)` (0x8009c284), so a faster `own` side gets a SHORTER delay.
 * The flag only picks which scratch block the getter fills (0x800a4580 / 0x800a45c0,
 * `FIGHTSTG_F0x8009ec94` 0x8009ecc0-0x8009ecd8); the stats come from the side byte and
 * record passed in `$a0`/`$a2`.
 */
export function statusEventDelay(opcode: number, speed: StatusEventSpeed): number {
  const base = STATUS_EVENT_OPCODE_PARAMS[opcode | 0]?.[0] ?? 0;
  const own = Math.max(1, speed.own | 0);
  const opp = Math.max(1, speed.opp | 0);
  const delay = Math.trunc((base * opp) / Math.max(1, statusEventIsqrt(own * opp)));
  return statusEventClamp(delay, opcode | 0);
}

/** The opcode's `min` / `max` tail (`pro/fightstg.s:26296`-`:26308`). */
export function statusEventClamp(delay: number, opcode: number): number {
  const params = STATUS_EVENT_OPCODE_PARAMS[opcode | 0];
  if (!params) return delay | 0;
  const [, min, max] = params;
  let out = delay | 0;
  if (min !== 0 && out < min) out = min;
  if (max !== 0 && out > max) out = max;
  return out;
}

/**
 * One nominal action, in timeline units: `FIGHTSTG_F0x8009bda4(side, 0)`, which every
 * action-resolution epilogue asks for (see battle-formula-leaves.md "Timeline advance
 * rule"). Opcode 0's triple is `[1000, 707, 1414]`.
 *
 * The original ALWAYS hands this routine the player side's byte (`move_ $a0, $zr` in
 * the delay slot of the `jalr`, `pro/wfightmn.s:1210`, `:1272`, `:1295`) and halves the
 * answer before re-enqueuing (`srl`/`addu`/`sra $a0, 0x1`, `:1216`-`:1219`), so the
 * walker's `own` is the player's SPD whatever side just acted. The half is left to the
 * timeline that owns turn order; this port only needs the unit one action is worth.
 */
export function statusEventActionDelay(ownSpd: number, oppSpd: number): number {
  return statusEventDelay(0, { own: ownSpd, opp: oppSpd });
}

/**
 * How long a stat change lasts — opcode **12** (`0x8009c130`), the arm
 * `FIGHTSTG_F0x8009cc20` takes whenever its fourth argument is non-zero (the category-5
 * arms all pass the target's slot, `lw $a3, 0x54($s4)` `pro/fightstg.s:13770`).
 *
 * `delay = 2000 + rand % 2001 + 10 * own[+0x06]` — the owning side's effective **SPT**
 * (`lh $v1, 0x6($s0)` `:26204`), which is `0x800a4580`'s `+0x06`. Opcode 12's triple is
 * `[2001, 0, 0]`, so neither bound applies.
 */
export function statusEventStatDelay(ownSpt: number, rand: () => number): number {
  const roll = Math.max(0, Math.trunc((rand() * 0x10000) >>> 0)) % 2001;
  return 2000 + roll + 10 * Math.max(0, ownSpt | 0);
}

/**
 * The delay routine's own eleven-row jump table at `0x800831e4`, indexed `opcode - 2`
 * (`addiu $v1, $s4, -0x2` / `sltiu $v0, $v1, 0xb` / `beqz` to the default arm /
 * `lui $v0, 0x8008` / `addiu $v0, 0x31e4` / `sll $v1, 0x2` / `jr $v0`,
 * `pro/fightstg.s:26023`-`:26037`).
 *
 * `null` is the DEFAULT arm `0x8009c1bc` — the speed-ratio formula, which every opcode
 * outside 2..12 also takes. The other rows name the arm routine.
 */
export const STATUS_EVENT_DELAY_ARMS: readonly (number | null)[] = Object.freeze([
  0x8009bdf4, // opcode  2 — the per-side tick's own arm
  null,        // opcode  3
  null,        // opcode  4
  null,        // opcode  5
  null,        // opcode  6
  null,        // opcode  7
  0x8009be7c, // opcode  8 — the confusion-recovery arm
  0x8009bec8, // opcode  9 — the frozen-recovery arm
  0x8009bf90, // opcode 10 — the timed-confusion arm
  0x8009c058, // opcode 11 — the asleep-recovery arm
  0x8009c130, // opcode 12 — the stat arm
]);

/** Which arm an opcode's delay takes, or `null` for the default speed-ratio arm. */
export function statusEventDelayArm(opcode: number): number | null {
  return STATUS_EVENT_DELAY_ARMS[(opcode | 0) - 2] ?? null;
}

/** What an own arm of the delay routine is given besides the draw. */
export interface StatusEventOwnDelayInput {
  /** The 16-bit draw the routine takes from `[0x8005 - 0x23f4]`. */
  readonly draw: number;
  /** `lh $v0, 0x6($s1)` — the HANDED side's effective SPT (block `0x800a4580` + 0x06). */
  readonly ownSpt: number;
  /**
   * The global `0x800a435d` — the ailment id byte the three cure stagers write
   * (`sb $s0, 0xaf5($s5)` / `sb $s4, 0x435d($v0)`).
   */
  readonly ailmentId: number;
  /** The other side's first stat-pair field (`lh $a0, 0x14|$12|$10($s0)`). */
  readonly otherA: number;
  /** The other side's second stat-pair field (`lh $v1, 0x1c|$1e|$20($s0)`). */
  readonly otherB: number;
}

/** The 16-bit draw the routine takes from `[0x8005 - 0x23f4]` (`jalr $v1`). */
export function statusEventDraw(rand: () => number): number {
  return Math.max(0, Math.trunc((rand() * 0x10000) >>> 0)) & 0xffff;
}

/**
 * Opcode **2** — the per-side tick's own arm `0x8009bdf4`
 * (`pro/fightstg.s:26038`-`:26071`): `rand % params[2][0] + 10 * own SPT`, then the
 * opcode's own clamp.
 *
 * The arm asks the stat getter **once**, with flag 1, so it reads the block of the side
 * byte it was HANDED (`0x800a4580`) and the OTHER side's numbers never enter it.
 */
export function statusEventTickDelay(ownSpt: number, rand: () => number): number {
  const base = STATUS_EVENT_OPCODE_PARAMS[2]![0];
  const roll = statusEventDraw(rand) % base;
  return statusEventClamp(roll + 10 * Math.max(0, ownSpt | 0), 2);
}

/**
 * Opcode **8** — the arm `0x8009be7c`, which is the only one that takes NO stat getter
 * call at all (`pro/fightstg.s:26072`-`:26090`). It draws once, divides with the magic
 * `0x830e3cfd` (`lui $v1, 0x830e` / `ori $v1, 0x3cfd`, `mult` / `mfhi $t0` /
 * `addu $v1, $t0, $v0` / `sra $v1, 0xc` / `subu $a1, $v1, $a0`), rebuilds `q * 63 * 127`
 * (`sll $a0, $a1, 0x6` / `subu $a0, $a1` / `sll $v1, $a0, 0x7` / `subu $v1, $a0` =
 * `q * 8001`) and subtracts.
 *
 * **The disc's own divisor and multiplier disagree.** The magic-and-shift pair divides by
 * **2710** (`q` is zero for every draw below 2710 and one at 2710), while the rebuild
 * multiplies by 8001 — so the arm computes `draw - 8001 * (draw / 2710)`, which is
 * negative for every draw from 2710 up. Opcode 8's triple is `[0, 2000, 6000]`, so the
 * `2000` floor is what that leaves: **the confusion recovery is 2000 units for every
 * draw from 2710 up, and `max(2000, draw)` below it.** This is the routine's arithmetic,
 * not a reading of it; the previous port computed `draw % 8001`, which this arm does not.
 */
export function statusEventConfusionDelay(rand: () => number): number {
  const draw = statusEventDraw(rand);
  const q = statusEventDivide2710(draw);
  const roll = draw - q * 63 * 127;
  return statusEventClamp(roll, 8);
}

/**
 * The opcode-8 arm's divide: `((mulhi(draw, 0x830e3cfd) + draw) >> 12) - (draw >> 31)`.
 * Reproduced instruction for instruction, so it keeps the magic's own off-by-one edges
 * (255 of the 65536 draws land one above `floor(draw / 2710)`).
 */
export function statusEventDivide2710(draw: number): number {
  const n = (draw | 0) & 0xffff;
  // `mult` is a signed 64-bit multiply and `mfhi` keeps its HIGH word, so the product has
  // to be formed in full (it is at most 1.5e14, well inside a double's exact range) and the
  // high half then wrapped back to a signed 32-bit word before the add.
  const high = Math.floor((0x830e3cfd * n) / 0x100000000) | 0;
  const sum = (high + n) | 0;
  return (sum >> 12) - (n >> 31);
}

/**
 * Opcodes **9**, **10** and **11** — the three recovery arms `0x8009bec8`, `0x8009bf90`
 * and `0x8009c058`, which share one shape (`pro/fightstg.s:26091`-`:26135`, `:26141`-`:
 * 26190`, `:26191`-`:26244`). Each asks the getter TWICE: flag 1 first for the side it was
 * handed and flag 0 second for `0x10 - side`, and the shared tail reads
 * `lh $v0, 0x6($s1)` for the HANDED side's SPT and `0x435d($v1)` for the ailment id. The
 * second `jalr` again carries `move_ $s1, $v0` in its DELAY SLOT, so `$s1` keeps the
 * handed-side block and `$s0` ends up holding the OTHER side's block.
 *
 * `delay = rand % 500 + 8 * (ownSpt + ailmentId) + K - 8 * (otherA + otherB)`, clamped:
 *
 * | opcode | ailment | `K` | `otherA` | `otherB` | floor |
 * |---|---|---|---|---|---|
 * | 9 | frozen | 3000 | `lh $a0, 0x14($s0)` | `lh $v1, 0x1c($s0)` | 1000 |
 * | 10 | confusion with a technique | 3000 | `lh $a0, 0x12($s0)` | `lh $v1, 0x1e($s0)` | 1000 |
 * | 11 | asleep | 1000 | `lh $a0, 0x10($s0)` | `lh $v1, 0x20($s0)` | 500 |
 */
export function statusEventRecoveryDelay(
  opcode: 9 | 10 | 11, input: StatusEventOwnDelayInput,
): number {
  const base = STATUS_EVENT_OPCODE_PARAMS[opcode]![0];
  const stat = 8 * (
    Math.max(0, input.ownSpt | 0) + (input.ailmentId | 0)
    - (input.otherA | 0) - (input.otherB | 0)
  );
  const roll = (input.draw >>> 0) % base;
  const k = opcode === 11 ? 1000 : 3000;
  return statusEventClamp(roll + stat + k, opcode);
}

/**
 * One ailment's recovery delay, exactly as its stager computes it: the code's own delay
 * opcode, that opcode's arm, and the arm's arithmetic.
 *
 * `FIGHTSTG_F0x8009c8b0` (frozen) always asks opcode 9 (`:26700 li $a1, 0x9`),
 * `FIGHTSTG_F0x8009cb10` (asleep) always opcode 11 (`:26933 li $a1, 0xb`), and
 * `FIGHTSTG_F0x8009c9c0` (confused) asks **opcode 8 when its second argument is zero and
 * opcode 10 when it is not** — `bnez $s0, .L0x8009ca30` (`:26849`) with `move_ $s2, $v0`
 * in the delay slot, where `$s0` is the caller's `$a1` and NOT the find result (that is
 * `$v0`, which lands in `$s2`). Every caller in `fightstg` passes the action's own
 * technique id there (`lw $a1, 0x24($s6)`, `0x800a43f4+0x24`) and the two confusion
 * appliers pass a literal zero (`:11951`, `:12007`), so **opcode 8 is what actually runs**.
 */
export function statusEventAilmentDelay(
  ailment: string, input: StatusEventOwnDelayInput, techniqueId = 0,
): number {
  if (ailment === "poison") return 1000; // `li $v0, 0x3e8` :26742 — no delay call at all
  if (ailment === "frozen") return statusEventRecoveryDelay(9, input);
  if (ailment === "sleep") return statusEventRecoveryDelay(11, input);
  const opcode = (techniqueId | 0) === 0 ? 8 : 10;
  if (opcode === 8) return statusEventConfusionDelay(() => input.draw / 0x10000);
  return statusEventRecoveryDelay(10, input);
}

/**
 * How long a stat change lasts when its stager's fourth argument is ZERO — the shape the
 * opcode-8 arm computes. Kept for the callers that only need the draw.
 */
export function statusEventStatDelayUnrefreshing(rand: () => number): number {
  return statusEventConfusionDelay(rand);
}


/**
 * How long one of the two locks lasts — `FIGHTSTG_F0x8009cd1c`
 * (`pro/fightstg.s:27092`-`:27104`).
 *
 * The routine divides the draw by **101** with the magic `0x288df0cb` (`lui $v1, 0x288d`
 * / `ori $v1, 0xf0cb`), rebuilds `101 * q` (`sll 1` / `addu` / `sll 3` / `addu` / `sll 2`
 * / `addu`, `:27096`-`:27100`) and subtracts, so the value is `rand % 101`. That becomes
 * the TIME directly: `+100`, times the technique record's own `+0x0c`
 * (`lbu $v1, 0xc($s4)` `:27092`, `mult` / `mflo $a1` `:27100`-`:27102`).
 */
export function statusEventLockDelay(
  magnitude: number, rand: () => number,
): number {
  const draw = Math.max(0, Math.trunc((rand() * 0x10000) >>> 0));
  return (draw % 101 + 100) * Math.max(0, magnitude | 0);
}

/**
 * Stage a stat-modifier expiry, exactly as `FIGHTSTG_F0x8009cc20` does
 * (`pro/fightstg.s:26984`-`:27046`): the code comes from `.L0x800a43e0[stat]`
 * (`:26986`-`:26995`), an existing `{code, side, slot}` entry's `+0x02` is REPLACED by
 * the new delay (`:27012`-`:27016`), and a missing one is enqueued with the time, the
 * side, the slot and the stat index (`sw` `:27038`-`:27044`).
 *
 * Returns the pool index, or `-1`.
 */
export function stageStatusEventStat(
  pool: StatusEventPool,
  side: number, slot: number, stat: 0 | 1 | 2,
  ownSpt: number, rand: () => number,
): number {
  const code = STATUS_EVENT_STAT_CODES[stat] ?? 0x0d;
  const time = statusEventStatDelay(ownSpt, rand);
  const existing = findStatusEvent(pool, code, side, slot);
  const found = existing >= 0 ? pool[existing] : null;
  if (found) {
    found.time = time;
    return existing;
  }
  return enqueueStatusEvent(pool, { code, time, side, slot, payload: stat, payload2: stat });
}

/**
 * Stage one of the two locks, exactly as `FIGHTSTG_F0x8009cd1c` does
 * (`pro/fightstg.s:27049`-`:27140`): it takes `[0x800a4468]`, the player's active slot
 * (`:27078`/`lw $s1, 0x4468($v0)`), finds the code on the PLAYER side
 * (`move_ $a1, $zr` `:27076`) with that slot (`:27086 move_ $a2, $s1`), refreshes an
 * existing entry's time or enqueues a new one, and sets the record's lock bit
 * (`:27134` / `:27141`).
 */
export function stageStatusEventLock(
  pool: StatusEventPool, lockIndex: 0 | 1, slot: number,
  magnitude: number, rand: () => number,
): number {
  const code = STATUS_EVENT_LOCK_CODES[lockIndex] ?? 0x10;
  const time = statusEventLockDelay(magnitude, rand);
  const existing = findStatusEvent(pool, code, 0, slot);
  const found = existing >= 0 ? pool[existing] : null;
  if (found) {
    found.time = time;
    return existing;
  }
  return enqueueStatusEvent(pool, {
    code, time, side: 0, slot, payload: lockIndex, payload2: slot,
  });
}

/** Whether a lock is currently held, read from the pool rather than a walker flag. */
export function statusEventLockHeld(
  pool: StatusEventPool, lockIndex: 0 | 1, side: number, slot: number,
): boolean {
  const code = STATUS_EVENT_LOCK_CODES[lockIndex] ?? 0x10;
  return findStatusEvent(pool, code, side, slot) >= 0;
}

/**
 * What one ailment's stager needs besides the pool.
 *
 * The three cure stagers take the SIDE BYTE (`andi $s2, $a0, 0xff`, which is `0` or
 * `0x10`), read that side's ACTIVE fighter slot out of `0x800a4468 + 4 * (side != 0)`
 * (`lw $a2, 0x8($s4)` `pro/fightstg.s:26790`, `:26845`, `:26950`) and use THAT as the
 * slot they search with and write into the entry — the caller's own slot argument is
 * ignored by 0x0a and 0x0c, and by 0x0b it is only the delay-opcode selector.
 */
export interface StatusEventAilmentStage {
  /** 0 the player's side, `0x10` the enemy's — the raw byte the stager is handed. */
  readonly side: number;
  /** `[0x800a4468 + 4 * (side != 0)]`: the side's active fighter slot. */
  readonly slot: number;
  /** The ailment, which picks the code, the record bit and the delay opcode. */
  readonly ailment: string;
  /** The record `+0x38` byte the apply machine hands over — the ailment's own id. */
  readonly ailmentId: number;
  /** Everything the delay arm needs. */
  readonly delay: StatusEventOwnDelayInput;
  /** The action's technique id, which selects opcode 8 or 10 for confusion. */
  readonly techniqueId?: number;
}

/**
 * One ailment's recovery entry, staged exactly as its stager does.
 *
 * Every one of the three is the SAME shape, and the difference is only which fields the
 * refresh writes:
 *
 * | code | stager | delay | refresh rewrites | enqueue writes | record |
 * |---|---|---|---|---|---|
 * | `0x09` | `F0x8009c7d4` | none — `li $v0, 0x3e8` `:26742` | `+0x0c` (the payload) `sw $s3, 0xc($v0)` `:26720` | code/time/side/slot/payload `:26721`-`:26730` | `record[+0x1c] |= 0x01` `:26743`-`:26744` |
 * | `0x0a` | `F0x8009c8b0` | opcode 9 `:26700` | `+0x02` only, in the `j`'s delay slot `sh $a1, 0x2($v0)` `:26690` | code/time/side/activeSlot `:26789`-`:26797` | `record[+0x1d] = id` `:26790`, `record[+0x1c] |= 0x02` `:26797`-`:26798` |
 * | `0x0b` | `F0x8009c9c0` | opcode 8 or 10 `:26853`/`:26857` | `+0x02` only `sh $a1, 0x2($v0)` `:26869` | code/time/side/activeSlot `:26870`-`:26883` | `record[+0x1f] = id` `:26897`, `record[+0x1c] |= 0x04` `:26898`-`:26899` |
 * | `0x0c` | `F0x8009cb10` | opcode 11 `:26933` | `+0x02` only `sh $v1, 0x2($v0)` `:26946` | code/time/side/activeSlot `:26947`-`:26955` | `record[+0x1e] = id` `:26969`, `record[+0x1c] |= 0x08` `:26970`-`:26971` |
 *
 * All four **re-stage in place**: an entry already queued for the same code and side is
 * never duplicated, its remaining time is replaced (or, for poison, its payload), and the
 * flag byte is set again. Returns the pool index, or `-1`.
 */
export function stageStatusEventAilment(
  pool: StatusEventPool, stage: StatusEventAilmentStage,
): number {
  const code = statusEventAilmentCode(stage.ailment);
  if (code === null) return -1;
  const existing = findStatusEvent(pool, code, stage.side, stage.slot);
  const found = existing >= 0 ? pool[existing] : null;
  if (found) {
    if (code === 0x09) {
      // `F0x8009c7d4` refreshes the payload and NOT `+0x02` — its delay slot stores the
      // register it names (`$s3`), which is the caller's third argument, not the time.
      found.payload = stage.ailmentId | 0;
    } else {
      found.time = statusEventAilmentDelay(stage.ailment, stage.delay, stage.techniqueId);
    }
    return existing;
  }
  return enqueueStatusEvent(pool, {
    code,
    time: code === 0x09
      ? 1000
      : statusEventAilmentDelay(stage.ailment, stage.delay, stage.techniqueId),
    side: stage.side,
    slot: stage.slot,
    payload: stage.ailmentId | 0,
    payload2: stage.slot | 0,
  });
}

/**
 * The per-side status tick, `FIGHTSTG_F0x8009c5e8` (`pro/fightstg.s:26565`-`:26611`).
 *
 * Its `find` searches with the slot `(side != 0)` — the side INDEX, not a fighter slot
 * (`sltu $v0, $zr, $s1` `:26570` / `move_ $a2, $s2` `:26573`) — while the enqueue it falls
 * back to writes that side's ACTIVE fighter slot (`lw $v1, 0x8($v0)` `:26601`, where `v0`
 * is `0x800a4460 + 4 * (side != 0)`). Both are reproduced: the search uses the index, the
 * entry carries the active slot. The payload is the fixed `0xbd` (`li $v0, 0xbd` `:26602`),
 * which is the effect byte that stages it (`li $v0, 0xbd` `:13278` / `jal` `:13289`).
 *
 * An existing entry is REFRESHED — only its `+0x02` is rewritten, and the write is the
 * `j`'s delay slot `sh $a1, 0x2($v0)` `:26690`, so it runs on both paths.
 */
export function stageStatusEventSideTick(
  pool: StatusEventPool, side: number, ownSpt: number, rand: () => number,
): number {
  const sideIndex = (side | 0) !== 0 ? 1 : 0;
  const existing = findStatusEvent(pool, 0x05, side, sideIndex);
  const found = existing >= 0 ? pool[existing] : null;
  if (found) {
    found.time = statusEventTickDelay(ownSpt, rand);
    return existing;
  }
  return enqueueStatusEvent(pool, {
    code: 0x05,
    time: statusEventTickDelay(ownSpt, rand),
    side,
    // The caller supplies the side's active fighter slot; the pool row keeps it as the
    // entry's own `+0x08`, which is what every consumer reads.
    slot: sideIndex,
    payload: 0xbd,
    payload2: 0xbd,
  });
}

/**
 * Cure one ailment: free its recovery entry from the pool.
 *
 * This is the free half of `FIGHTSTG_F0x8009c330` (`pro/fightstg.s:26376`-`:26443`), the
 * disc's one "an ailment ends now" routine: `which` 0..3 picks the bit out of the four-byte
 * table at `0x800a43dc` (`0x3f040201` — poison `0x01`, frozen `0x02`, confused `0x04`,
 * all three `0x3f`), clears it with `nor $v0, $zr, $v0` / `and $v1, $v0` /
 * `sb $v1, 0x1c($a2)` (`:26421`-`:26425`), and then frees the matching pool entry from the
 * companion table at `0x800a43d4` (`0x0c0b0a09` — which 0 → code `0x09`, 1 → `0x0a`,
 * 2 → `0x0b`, 3 → `0x0c`) with `sh $zr, ($v0)` (`:26443`).
 *
 * The walker's own flag byte is the ailment's presence in `c.ailments`, so freeing the
 * entry IS the cure. Returns true when an entry was freed.
 */
export function cureStatusEvent(
  pool: StatusEventPool | undefined, ailment: string, side: number, slot: number,
): boolean {
  if (!pool || pool.length !== STATUS_EVENT_POOL_SIZE) return false;
  const code = statusEventAilmentCode(ailment);
  if (code === null) return false;
  return removeStatusEvent(pool, code, side, slot);
}

/** What one expiry did. */
export interface StatusEventExpiry {
  code: number;
  name: string;
  side: number;
  slot: number;
  /**
   * `'stat'` = put the modifier halfword back to zero; `'lock'` = release the lock;
   * `'ailment'` = the recovery came due, so the record's ailment bit is cleared;
   * `'poison'` = the recurring poison tick came due.
   */
  kind: "stat" | "lock" | "ailment" | "poison";
  /** The stat number, for `kind === 'stat'`. */
  stat?: 0 | 1 | 2;
  /** The lock index, for `kind === 'lock'`. */
  lock?: 0 | 1;
  /** The record `+0x1c` bit this expiry releases, for `kind === 'lock' | 'ailment'`. */
  bit?: number;
  /** The ailment, for `kind === 'ailment' | 'poison'`. */
  ailment?: string;
  /** The payload the stager stored, for `kind === 'poison'`. */
  payload?: number;
}

/**
 * Advance the pool by `units` of timeline and return every expiry, in the order the
 * original fires them.
 *
 * The pick is the original's own: the smallest `+0x2` wins, its time comes off EVERY
 * queued entry (`pro/fightstg.s:25830`-`:25844`), and `0x800a3800`'s word decides whether
 * the slot is freed (`:25850`-`:25870`). An entry whose code keeps it queued stays, with
 * its time already spent — exactly as the original leaves the poison tick until the
 * consumer reloads its `+0x02`.
 */
export function advanceStatusEvents(pool: StatusEventPool, units: number): StatusEventExpiry[] {
  const out: StatusEventExpiry[] = [];
  const fired = new Set<number>();
  let left = Math.max(0, Math.trunc(units));
  for (;;) {
    const pick = pickNextStatusEvent(pool);
    if (!pick) break;
    if (pick.time > left) {
      // Not due inside this budget. The walker's advance is a budget in timeline units,
      // not a pick: the time that HAS passed still comes off every entry, so a step of
      // 1000 units walks a 2500-unit event 1000 closer without firing it.
      for (const e of pool) {
        if (!e || e.code === 0) continue;
        e.time = (e.time + pick.time - left) & 0xffff;
      }
      break;
    }
    // A code that KEEPS its slot (0x800a3800's `-1`: codes 4, 6 and 9) is left queued with
    // its time already spent, and the disc reloads that `+0x02` inside the consumer
    // machine before the next advance. The walker's consumer does the same, so one advance
    // must never see the same entry twice -- otherwise a zero-time survivor would fire
    // again on the very next pick and the loop would never end.
    if (fired.has(pick.index)) break;
    fired.add(pick.index);
    left -= pick.time;
    const entry = pool[pick.index];
    if (!entry) break;
    const row = STATUS_EVENT_CODES.find((r) => r.code === pick.code) ?? null;
    const stat = statusEventStatIndex(pick.code);
    const lock = statusEventLockIndex(pick.code);
    const ail = STATUS_EVENT_AILMENTS.find((r) => r.code === pick.code) ?? null;
    if (row && stat !== null) {
      out.push({
        code: pick.code, name: row.name, side: entry.side, slot: entry.slot,
        kind: "stat", stat,
      });
    } else if (row && lock !== null) {
      out.push({
        code: pick.code, name: row.name, side: entry.side, slot: entry.slot,
        kind: "lock", lock, bit: statusEventLockBit(pick.code) ?? 0,
      });
    } else if (ail) {
      out.push({
        code: pick.code, name: row?.name ?? ail.ailment,
        side: entry.side, slot: entry.slot,
        kind: ail.code === 0x09 ? "poison" : "ailment",
        ailment: ail.ailment, bit: ail.bit, payload: entry.payload | 0,
      });
    }
    if (statusEventFreesSlot(pick.code)) {
      entry.code = 0;
      entry.time = 0;
      entry.payload = 0;
      entry.payload2 = 0;
    }
  }
  return out;
}