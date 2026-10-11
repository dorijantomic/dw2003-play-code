// engine/systems/scene-step-ops.ts
//
// The position step's OTHER operations — every opcode the setup executor
// (`step-exec` 0x8008836c, pro/fieldstg.s:5558 `.L0x000056bc`) runs besides op 8,
// plus the decoded shape of the playback executor (`0x800885d4`, `.L0x00005924`).
// This is a port of one shared system: the disc's position step is a single routine
// with three static dispatch tables, and every stage supplies only its own step
// program (`tools/extract_story_trigger_grids.py` / story_steps.json, 24-byte records).
// Nothing here is per-place.
//
// ── The dispatch (all three tables are static data at the top of FIELDSTG.PRO,
//    load base 0x80082CB0; read straight out of web/assets/native/fieldstg.bin) ──
//
//   :5744  lhu $v0, 0x8($v0)          op = record+0x8
//   :574c  addiu $v1, $v0, -0x5 / sltiu $v0, $v1, 0x9 / beqz -> .L0x5840
//   :575c  addiu $v0, 0x2e48          table A = 0x80082E48 (file 0x198), ops 5..13
//   :5840  lhu $v0, 0x8($v0) / addiu $v1,$v0,-1 / sltiu $v0,$v1,0x7 / beqz -> .L0x587c
//   :5860  addiu $v0, 0x2e70          table B = 0x80082E70 (file 0x1c0), ops 1..7
//   :5948  sltiu $v0, $v1, 0xe        table C = 0x80082E98 (file 0x1e8), ops 1..14
//                                          (playback only)
//
// Table A is consulted FIRST and covers ops 5..13, so **ops 5 and 6 never reach
// table B** — its entries for them are unreachable data. That is the whole reason
// the walker's old "op 5/6 draws a `!`" was wrong: those two ops do something else
// entirely and draw nothing.
//
// ── What the setup ops do ──
//
// Every op that reaches one of the four tiny handlers at file 0x587c-0x589c loads a
// constant into $s0 and tail-jumps to the SHARED indicator tail:
//
//   :587c j .L0x58568 / move $s0,$zero   -> kind 0        ops 0, 9, 10, 14+
//   :5884 j .L0x58568 / li   $s0,2       -> kind 2        ops 2, 3
//   :588c j .L0x58568 / li   $s0,4       -> kind 4        op 4
//   :5894 j .L0x58568 / li   $s0,5       -> kind 5        op 7
//   :589c lw $a0,0x60($s0)               -> op 1, see arrowKind below
//
// and the tail (:58b8, RAM 0x80088568) is the whole bubble mechanism:
//
//   :58b8 lw $a0, ($s1)                  a0 = extra[0], the driver's previous bubble
//   :58c0 beqz $a0, :58fc                none yet on the first frame
//   :58c8 lw $v0, 0x28($a0) / jalr       bubble->setState(1)      [li $a1,1 :58d4]
//   :58e0 sw $s0, 8($v0)                 bubble+0x8 = the KIND
//   :58ec sw $zero, 0x64($v0)            bubble+0x64 = 0
//   :58f8 sw $zero, 0x68($v0)            bubble+0x68 = 0
//   :58fc move $a0,$zero / jal 0x80088144 / li $a2,6   spawn the new bubble
//   :5908 sw $v0, ($s1)                  extra[0] = it
//   :590c li $v0, 0x1                    exec returns 1
//
// The bubble itself is 0x80087f84 (`F0x80088144(0, ?, 6)` allocates 0x6c bytes,
// fieldstg.s:5490-5480). Its kind is read only by the draw as the anim-program row:
// the glyph is `bubble+0x60 >> 2` in a 0x160 pack and `+0x8` selects the row set
// (0x23..0x26 for kind 0, web/fieldcom.js KIND). Kind 0 is the "!" balloon; the
// walker's KIND names are those rows.
//
// ── op 5 and op 6 draw nothing ──
//
//   op 5 (:5778): sw param@+0xa -> (driver+0x58)+0x78      the player actor's word
//            and sw param@+0xa -> [0x8004B41C]              (lui 0x8005/addiu -0x4be4,
//                 :57a0, the jump's DELAY SLOT — 0x8005_0000-0x4BE4 = 0x8004B41C, not
//                 0x8005B41C). Returns 0, so the driver's frame sees "nothing ran".
//   op 6 (:57a4): lw $a0,param@+0xa ; lw $v0,[0x8009B718] (lui 0x800a/addiu -0x48e8 —
//            0x000a0000-0x48E8 = 0x8009B718) ; jalr with that pointer.
//            The cell ships in FIELDSTG.PRO's data tail (file 0x18A68) holding
//            0x80092908 = file 0xF758, which is
//                v0 = find_entity(5,1,-1); if (!v0) v0 = find_entity(5,2,-1);
//                v0->0x10c = 0;
//            — the player's own argument is ignored, so **op 6 clears your party
//            member's +0x10c word** (14 records, params 0 and 1 alike).
//
// ── ops 11, 12, 13 call the player actor ──
//
//   op 11 (:57ec): a0 = driver+0x58, a1 = driver+0x60 (the facing group)
//                  -> actor+0x150(actor, group)
//   op 12 (:5800): actor+0x154(actor)
//   op 13 (:5820): actor+0x158(actor, record+0xa)     [addiu $a1,0xa in the delay slot]
// All three return 0 with no bubble.
//
// ── op 1's arrow comes from the GRID BYTE, not from the record ──
//
//   :589c lw $a0, 0x60($s0)      the step-load facing group (grid byte >> 5)
//   :58a4 bne $a0, 4, :58b4 / sra $v0,$a0,1
//   :58b0 li $s0, 0xa            group 4 -> kind 10 (the lift arrow)
//   :58b4 addiu $s0, $v0, 6      otherwise kind = (group >> 1) + 6
//
// So kinds 6..9 are the four plain arrows and 10 the lift arrow, selected by the
// APPROACH DIRECTION the tile demands — which the grid byte already carries and which
// the facing cone at 0x80097624 gates on. The record's own param 3 (record+0xe) is
// NOT read by the indicator; the disc uses it only in the playback executor's op 1
// (:5998 `lhu $a3, 0xe($v0)`). Over all 291 shipped stages, group == param3 on only
// 3,078 of the 216,089 grid cells that name an op-1 record, so the two readings
// disagree almost everywhere; measured, not assumed (see .bunny-scratch/stepops-report.md).

/** The one field of a 24-byte step record this module needs (the shape trigger-system exports). */
export interface StepOpRecord {
    op: number;
    params?: readonly number[];
}

/** FIELDSTG's indicator rows — the same names web/fieldcom.js KIND carries. */
export const INDICATOR_KIND = {
    exclaim: 0, smoke: 1, ladder: 2, dots: 3, doorGlyph: 4, tool: 5,
    arrowDown: 6, arrowLeft: 7, arrowUp: 8, arrowRight: 9, arrowLift: 10,
} as const;

/**
 * The kind an op writes into the bubble (fieldstg.s:587c-589c). `null` = the op draws
 * no bubble at all, which is the case for ops 5, 6, 8, 11, 12 and 13.
 */
export function indicatorKindForOp(op: number, group: number): number | null {
    switch (op) {
        case 2: case 3: return INDICATOR_KIND.ladder;                                     // :5884
        case 4: return INDICATOR_KIND.doorGlyph;                                          // :588c
        case 7: return INDICATOR_KIND.tool;                                                // :5894
        case 1: return arrowKind(group);                                                   // :589c
        // op 0, ops 9/10 and op >= 14 all reach the same kind-0 tail (:587c). Ops 9
        // and 10 get there through table A's entry for them (0x5840), which falls out
        // of table B's 7 entries; op 0 and op >= 14 fall out of table A entirely.
        default: return op === 5 || op === 6 || op === 8 || op === 11 || op === 12 || op === 13
            ? null : INDICATOR_KIND.exclaim;
    }
}

/** op 1's kind: the group the grid byte demands (fieldstg.s:589c-58b4). */
export function arrowKind(group: number): number {
    const g = group & 7;
    return g === 4 ? 10 : (g >> 1) + 6;
}

/** The three words op 5 writes, and the two records that write a caller-supplied value. */
/** op 6: the party-member entity it un-hides (1, else 2), and the word it clears. */
export const OP6_PARTY_SLOT = 1;
export const OP6_CLEARED_OFFSET = 0x10c;

export interface StepOpEffect {
    op: number;
    /** the bubble row, or null when this op draws none. */
    kind: number | null;
    /** op 5: the player actor word at +0x78. */
    actor78?: number;
    /** op 5: the global at 0x8004B41C. */
    global4b41c?: number;
    /** op 6: the party-member slot whose +0x10c word the callee clears. */
    partySlot?: number;
    /** ops 11/12/13: which player-actor slot was called. */
    actorSlot?: 0x150 | 0x154 | 0x158;
    /** its argument (op 11: the facing group; op 13: param 0). */
    actorArg?: number;
    /**
     * op 13 only — the launch pad the actor method was handed. `actor+0x158`
     * (fieldstg.s:5820, the body at :0xc79c) puts `&record[0xa]` — the record
     * ITSELF, not a copied value — into the pad controller it builds
     * (`F0x8008C610` at :0xc7e4 stores it at controller+0x54), and the controller
     * flies the leader to the record's own words:
     *
     *   `spawnX`  params[1] = record+0xc
     *   `spawnY`  params[2] = record+0xe
     *   `dirIndex` params[3] = record+0x10, char+0x60's 0-7 word, copied straight in
     *
     * They are carried as the record's raw words; naming the facing is the
     * consumer's job (engine/systems/field-movement.ts `fieldDirectionFromIndex`),
     * so this table and that one cannot drift apart.
     */
    pad?: { spawnX: number; spawnY: number; dirIndex: number };
}

/**
 * One setup op, as the disc runs it: the conds are already known to pass (the disc
 * returns before the dispatch otherwise, :5700/:5734).
 */
export function execStepOp(op: number, group: number, params: readonly number[] = []): StepOpEffect {
    const kind = indicatorKindForOp(op, group);
    const out: StepOpEffect = { op, kind };
    if (op === 5) {
        const p = params[0] ?? 0;
        out.actor78 = p;
        out.global4b41c = p;
    } else if (op === 6) {
        // The callee ignores the argument op 6 hands it (fieldstg.s:57ac sets a0, the
        // routine at file 0xF758 never reads it), so only the slot matters.
        out.partySlot = OP6_PARTY_SLOT;
    } else if (op === 11) {
        out.actorSlot = 0x150;
        out.actorArg = group & 7;
    } else if (op === 12) {
        out.actorSlot = 0x154;   // actor+0x154(actor) — the disc passes no a1
    } else if (op === 13) {
        out.actorSlot = 0x158;
        out.actorArg = params[0] ?? 0;
        out.pad = {
            spawnX: params[1] ?? 0,
            spawnY: params[2] ?? 0,
            dirIndex: (params[3] ?? 0) & 7,
        };
    }
    return out;
}

/** The setup executor's effect for a sampled record. */
export function execStepRecord(step: StepOpRecord, group: number): StepOpEffect {
    return execStepOp(step.op, group, step.params ?? []);
}

/**
 * The decoded dispatch, op by op: which table owns it, where its handler is on the
 * disc, and what the handler reads out of the record. `record` names the offsets the
 * handler touches (u16 each), `param` the record field's index in `params`.
 */
export interface DecodedSetupOp {
    op: number;
    /** the static table whose entry the executor jumps through. */
    table: "A" | "B" | "out of range";
    /** the handler's file offset inside FIELDSTG.PRO. */
    handler: number;
    /** what the player sees. */
    shows: string;
    /** the record offsets read, and what each is. */
    reads: { at: string; what: string }[];
    /** every write the handler makes. */
    writes: string[];
}

export const SETUP_OPS: readonly DecodedSetupOp[] = [
    { op: 0, table: "B", handler: 0x587c, shows: 'the "!" balloon',
      reads: [], writes: ["bubble+0x8 = 0", "bubble+0x64 = 0", "bubble+0x68 = 0", "extra[0] = the new bubble"] },
    { op: 1, table: "B", handler: 0x589c, shows: "a direction arrow over your head",
      reads: [{ at: "+0x0/+0x2, +0x4/+0x6", what: "the two flag gates" }],
      writes: ["bubble+0x8 = (group>>1)+6, or 10 when group is 4", "bubble+0x64 = 0", "bubble+0x68 = 0", "extra[0] = the new bubble"] },
    { op: 2, table: "B", handler: 0x5884, shows: "the ladder icon",
      reads: [], writes: ["bubble+0x8 = 2", "bubble+0x64 = 0", "bubble+0x68 = 0", "extra[0] = the new bubble"] },
    { op: 3, table: "B", handler: 0x5884, shows: "the ladder icon",
      reads: [], writes: ["bubble+0x8 = 2", "bubble+0x64 = 0", "bubble+0x68 = 0", "extra[0] = the new bubble"] },
    { op: 4, table: "B", handler: 0x588c, shows: "the door icon",
      reads: [], writes: ["bubble+0x8 = 4", "bubble+0x64 = 0", "bubble+0x68 = 0", "extra[0] = the new bubble"] },
    { op: 5, table: "A", handler: 0x5778, shows: "nothing — it writes two words instead",
      reads: [{ at: "+0xa", what: "param 0, written to two places" }],
      writes: ["(player actor)+0x78 = param 0", "[0x8004B41C] = param 0"] },
    { op: 6, table: "A", handler: 0x57a4, shows: "nothing — it clears your party member's +0x10c",
      reads: [{ at: "+0xa", what: "param 0 — passed in a0 and then IGNORED by the callee" }],
      writes: ["find_entity(5,1,-1) or (5,2,-1) -> its +0x10c word = 0"] },
    { op: 7, table: "B", handler: 0x5894, shows: "the tool icon",
      reads: [], writes: ["bubble+0x8 = 5", "bubble+0x64 = 0", "bubble+0x68 = 0", "extra[0] = the new bubble"] },
    { op: 8, table: "A", handler: 0x57c0, shows: "the cutscene",
      reads: [{ at: "+0xa", what: "the event id handed to start_event" }],
      writes: ["extra+4 = the runner pointer (the per-visit latch)"] },
    { op: 9, table: "A", handler: 0x587c, shows: 'the "!" bubble (table A points it at the shared fall-through 0x5840, which then misses table B)',
      reads: [], writes: ["bubble+0x8 = 0", "bubble+0x64 = 0", "bubble+0x68 = 0", "extra[0] = the new bubble"] },
    { op: 10, table: "A", handler: 0x587c, shows: 'the second "!" bubble form, the same tail',
      reads: [], writes: ["bubble+0x8 = 0", "bubble+0x64 = 0", "bubble+0x68 = 0", "extra[0] = the new bubble"] },
    { op: 11, table: "A", handler: 0x57ec, shows: "nothing — it calls the player actor",
      reads: [{ at: "-", what: "the facing group at runner+0x60" }],
      writes: ["actor+0x150(actor, group)"] },
    { op: 12, table: "A", handler: 0x5800, shows: "nothing — it calls the player actor",
      reads: [], writes: ["actor+0x154(actor)"] },
    { op: 13, table: "A", handler: 0x5820, shows: "nothing — it calls the player actor",
      reads: [{ at: "+0xa", what: "param 0, the argument" }],
      writes: ["actor+0x158(actor, param 0)"] },
    { op: 14, table: "B", handler: 0x587c, shows: 'the "!" balloon (falls out of both tables)',
      reads: [], writes: ["bubble+0x8 = 0", "bubble+0x64 = 0", "bubble+0x68 = 0", "extra[0] = the new bubble"] },
];

// ── exec#2, the PLAYBACK executor (`0x800885d4`, file 0x5924) ──
//
// This is the half of the position step that fires when the player PRESSES on a
// step tile. It is one routine with one static table (`0x80082E98`, file 0x1e8,
// ops 1..14) and one resident 0x68-byte driver object per stage
// (`F0x80014504(0x80088888, 0x68, 8)`, fieldstg.s:5998) that decides WHEN to call it:
//
//   :5bfc lw $a0, 0xc($s0) / beq $a0, 1, .L0x5c54   the driver's level-0 state word
//   :5c54 lw $v0, 0x58($s1) / bnez -> return          scene_struct+0x58 must be clear
//   :5c64 lw $v0, 0x54($s1) / bnez -> return          scene_struct+0x54 must be clear
//   :5c74 lw $v1, 0x10($s0)                           the level-1 sub-state word
//   :5c94 step-load(self)  ->  step-exec(self, extra)      sub-state 0 = indicators
//   :5cbc step-load(self)                              sub-state 1 = PLAYBACK
//   :5cf4 pad(0) / andi $v0,0x2000 / beqz -> return    Circle must be HELD
//   :5d10 lw $v0, 0x54($s1) / bnez -> return           (checked again, after the pad)
//   :5d20 extra[0]->setState(3)                       the bubble goes to state 3
//   :5d38 jal 0x800885d4                               the playback executor
//   :5d40 obj->0x3c(self)                             level-1 advance
//
// and when sub-state 1 is live but the step is NOT live, the other arm runs:
// `obj->0x2c(self,0)` then `extra[0]->setState(2)` (:5cc8-:5cf0) — the bubble is put
// away. So the disc owns ONE indicator lifetime and this executor runs only on a
// held Circle, which is why the walker must ask this table and not the setup one.

import { actorActionPlan, type ActorActionPlan } from "./step-actor-actions.ts";
import { routePairFromParams } from "./route-pair.ts";

/**
 * The two route halfwords a publishing op writes, in the shape the disc's own memory
 * uses: `d78` is `[0x80048D34 + 0x44]` and `d7a` is `+0x46` (engine/systems/route-pair.ts
 * carries the decode and the two writer sites). Both are read verbatim out of the step
 * record — the `+1` / `-0x1d` shifts belong to the reader, not to the store.
 */
function routePairWords(params: readonly number[]): { d78: number; d7a: number } {
    const pair = routePairFromParams(params);
    return { d78: pair.key, d7a: pair.companion };
}

/** One player-actor vtable call, as the playback executor makes it. */
export interface PlaybackActorCall {
    /** the vtable slot read off the player actor (a0) — 0x110..0x158. */
    slot: number;
    /**
     * a1, a2, a3, then the two stack words. `null` in place of a value the disc
     * passes as a POINTER into the step record, so the port never has to invent
     * an address: op 9/10/14 hand the launcher `record + 0xa`, which IS param 0.
     */
    args: (number | null)[];
}

/** The stage handoff the op performs — F0x8008B770 (op 1) / F0x8008B6D4 (op 14). */
export interface PlaybackHandoff {
    /** 0x8008B770 for op 1, 0x8008B6D4 for op 14 (the latter is the former's body). */
    fn: number;
    /** id, -1, param1<<8, param2<<8, param3, [0x3c on op 14 only]. */
    args: number[];
    /**
     * Ticks the disc waits BEFORE it loads the destination, i.e. the sixth argument.
     * 0x8008B6D4 stores it into the type-7 scene object's `+0x68` (fieldstg.s:8a78/
     * :8a84) and its phase-2 handler spends it there — `+0x68 -= GetTick()`, and the
     * load runs only on the frame the word has fallen to 0 or below (:8984/:898c/:89ac,
     * then :8994/:899c). Op 14 seeds 0x3c (60 ticks, one second at 60 Hz); op 1 reaches
     * the same body through the wrapper 0x8008B770, whose `sw $zr,0x14($sp)` (:8acc)
     * passes **0** — so an ordinary door changes stage with no wait at all.
     */
    holdTicks: number;
}

export interface PlaybackEffect {
    op: number;
    /** the player-actor slot this op calls, or null when it calls none. */
    actorCall?: PlaybackActorCall;
    /**
     * What the called slot does to the PLAYER ACTOR: the mode it switches the
     * character into and every write it makes. `engine/systems/step-actor-actions.ts`
     * is the port (the three slot bodies plus the mode blocks they enter); the
     * executor's half — which slot, with what — is here.
     */
    actorAction?: ActorActionPlan | undefined;
    /** the stage change this op performs, or null. */
    handoff?: PlaybackHandoff;
    /**
     * op 1 only: the key the disc compares against each entry of the 0x12-stride
     * list at `[0x80099D90]` (param 5), which it walks clearing `entry[0]` on a
     * match (fieldstg.s:59b8-5a04). Zero skips the walk entirely (:59c0).
     */
    listKey?: number;
    /**
     * The two route halfwords this op writes: ops 1, 9 and 10 only (the two writer
     * sites — see engine/systems/route-pair.ts). `d78` is `[0x80048D34 + 0x44]`,
     * `d7a` is `+0x46`, both read verbatim from the record's params[5] / params[6].
     * Absent on every other op, which is how "this op publishes nothing" is told
     * apart from "this op publishes zero".
     */
    routeWords?: { d78: number; d7a: number };
    /** op 9/10 only: the field-character transition launcher's mode word (a2). */
    launchMode?: number;
    /** op 14 only: the player-actor slot the disc calls BEFORE the handoff. */
    padSlot?: number;
}

/**
 * The disc's own shift for ops 2/3/4: `addiu $v0,-1 / sll $v0,4` (fieldstg.s:5a94/:5a98
 * and :5aec/:5af0). `addiu` SIGN-EXTENDS, so a record whose param 0 is 0 yields
 * 0xfffffff0, not 0xfff0 — the word is carried at full width.
 */
function times16(param0: number): number {
    const v = (param0 & 0xffff) - 1;
    return ((v << 4) >>> 0);
}

/**
 * Op 4's own shift, `lhu $v0,0xa($v1) / sll $v0,0x4` (fieldstg.s:5b28/:5b30) — the
 * bare `sll`, with NO `addiu $v0,-1` in front of it. Ops 2 and 3 do have that
 * subtract (`:5a94`, `:5aec`), which is why the three are not the same expression.
 */
function times16Raw(param0: number): number {
    return ((param0 & 0xffff) << 4) >>> 0;
}

/** `h`, the HANDOFF worker, and the two `<<8` shifts its caller builds (fieldstg.s:59a0/:59a4). */
const HANDOFF_WRAPPER = 0x8008b770;
const HANDOFF_BODY = 0x8008b6d4;

/**
 * One playback op, exactly as the executor runs it: `group` is the grid byte's
 * top three bits (the same value the indicator's arrow is chosen by) and `params`
 * is the step record's own seven u16 fields. Nothing here is per-place — every
 * stage supplies only its step program.
 */
export function execPlaybackOp(op: number, group: number, params: readonly number[] = []): PlaybackEffect {
    const g = group & 7;
    const p = (i: number) => (params[i] ?? 0) & 0xffff;
    const out: PlaybackEffect = { op };
    // The actor-side half of every op that calls a player-actor action slot. This is
    // the same call twice from two ends: the executor picks the slot and builds the
    // arguments, the actor slot decides what the CHARACTER does with them.
    out.actorAction = actorActionPlan(op, g, params) ?? undefined;
    switch (op) {
        case 1: // :5970 — the door/warp. The actor turns first, then the handoff runs,
                   // then the door list is walked and the two route halfwords land.
            out.actorCall = { slot: 0x110, args: [g] };
            out.handoff = {
                fn: HANDOFF_WRAPPER,
                args: [p(0), -1 >>> 0, (p(1) << 8) >>> 0, (p(2) << 8) >>> 0, p(3)],
                holdTicks: 0,
            };
            out.listKey = p(5);
            out.routeWords = routePairWords(params);
            break;
        case 2: // :5a80 — the player actor walks to a recorded cell.
            out.actorCall = { slot: 0x114, args: [g, p(1), p(2), times16(p(0))] };
            break;
        case 3: // :5ac0 — the same, but the disc folds the group into ONE argument, and
                   // the value is the opposite of the one the naive reading gives:
                   //   :5acc bne $v0,$v1,.L0x00005ad8   group != 1 -> branch TAKEN
                   //   :5ad0 li $a1,0x3                 the branch's DELAY SLOT, so it
                   //                                          runs on BOTH paths
                   //   :5ad4 li $a1,0x5                 reached only when the branch is
                   //                                          NOT taken, i.e. group == 1
                   // so a1 = 5 when the group is exactly 1 and 3 otherwise.
            out.actorCall = { slot: 0x118, args: [g === 1 ? 5 : 3, p(1), p(2), times16(p(0))] };
            break;
        case 4: // :5b14 — the climb. Its two coordinates are the engine's own globals
                   // `[0x80082E8C]`/`[0x80082E90]`, NOT the record (:5b18/:5b24), and its
                   // third argument is the BARE `sll 4` (:5b30) with no `addiu -1`.
            out.actorCall = { slot: 0x11c, args: [g, null, null, times16Raw(p(0))] };
            break;
        case 7: // :5b58 — a two-cell nudge. The handler writes its two parameters to
                   // sp+0x18 and sp+0x1c, NOT sp+0x10/sp+0x14, so this is an EIGHT
                   // argument call whose 5th and 6th words the disc never sets; those
                   // two slots are `null` here rather than invented.
            out.actorCall = { slot: 0x120, args: [g, p(0), p(1), null, null, p(0), p(1)] };
            break;
        case 9: // :5bac — the scene takes over: the DIGIMON dive.
        case 10: // :5ba4 — the same launcher with mode 0 (its `j` carries
                    // `move_ $a2,$zr` in the delay slot, so a2 really is 0).
                    // The handler body writes NEITHER route half — it hands
                    // `record + 0xa` to the launcher and returns. See
                    // `launcherRouteWords` for where the pair does land.
            out.actorCall = { slot: 0x124, args: [p(0), op === 9 ? 1 : 0] };
            out.launchMode = op === 9 ? 1 : 0;
            break;
        case 14: // :5a30 — the pad walk first (the SAME slot setup op 13 calls), then
                    // the handoff with one extra argument, 0x3c (:5a60/:5a64). Both calls
                    // happen in the SAME frame: the pad controller is built and the scene
                    // object's phase is raised before this handler reaches its epilogue, so
                    // the 0x3c-tick hold is spent with Junior already walking to the pad.
                    // The handoff does NOT wait for the walk — the hold is a fixed count
                    // (:5a60 `li $v0,0x3c`), and 0x3c is shorter than the pad's own 106-tick
                    // charge, so the load cuts the flight off before it would start.
            out.padSlot = 0x158;
            out.handoff = {
                fn: HANDOFF_BODY,
                args: [p(0), -1 >>> 0, (p(1) << 8) >>> 0, (p(2) << 8) >>> 0, p(3), 0x3c],
                holdTicks: 0x3c,
            };
            break;
        default:
            // ops 0, 5, 6, 8, 11, 12, 13 all hold 0x80088878, the executor's own
            // epilogue — they do nothing at all. (op 0 and op 15+ miss the table
            // entirely and land on the same epilogue, :594c `beqz`.)
            break;
    }
    return out;
}

/** The executor's effect for a sampled step record. */
export function execPlaybackRecord(step: StepOpRecord, group: number): PlaybackEffect {
    return execPlaybackOp(step.op, group, step.params ?? []);
}

/** Opcodes the playback table gives a real body to; everything else does nothing. */
export const PLAYBACK_ACTIVE_OPS: readonly number[] = [1, 2, 3, 4, 7, 9, 10, 14];

/** Ops 2 and 3 are the LADDER: the player's own climb along a rail. */
export function isLadderPlayback(op: number): boolean {
    return op === 2 || op === 3;
}

/**
 * The facing a ladder mount hands the player actor — `a1`, which both mount bodies store
 * straight into `entity+0x60`: the bottom mount at pro/fieldstg.s:12601
 * (`sw $s3,0x60($s4)`, mode 0x43 handed in at :12596) and the top mount at :12644
 * (`sw $s3,0x60($s4)`, mode 0x44 at :12639). It is `a1` of the call the op's own handler
 * builds, so it is read out of the port's actor call rather than re-derived from the grid
 * byte:
 *
 *   op 2 (bottom, handler at pro/fieldstg.s:5799 `.L0x00005a80`): `lw $a1,0x60($s0)` —
 *       the record's OWN group, verbatim (:5808 `.L0x00005aa4`).
 *   op 3 (top, handler at :5815 `.L0x00005ac0`): `bne $v0,$v1` (:5818) with
 *       `li $a1,0x3` in the DELAY SLOT (:5819) and `li $a1,0x5` on the fall-through
 *       (:5820) — so a1 = 5 when the group is exactly 1, and 3 otherwise.
 *
 * Both mounts then pick the side from that same word — `beq $s3,$v0(=5)` at :12605 /
 * :12648 puts 0 into `entity+0x8c` and the fall-through puts 1 — so one `a1` decides both
 * the sprite side and the facing the step gate reads back (the same `entity+0x60` the
 * step-load compares against its facing cone, pro/fieldstg.s:5546 `lw $v0,0x60($s1)`).
 *
 * The shipped stages only ever carry these four shapes: 94 bottom tiles with group 3 and
 * 120 with group 5, and 119 top tiles with group 1 and 96 with group 7. So a ladder always
 * mounts you looking up-left or up-right — the top of a ladder turns you the other way
 * from its foot — and a two-way guess off the group alone gets 309 of the 429 armed rail
 * ends mirrored the wrong way (see tests/ladder-arming-census.test.js).
 */
export function ladderMountFacing(effect: PlaybackEffect | null | undefined): number | null {
    const a1 = effect?.actorCall?.args?.[0];
    return typeof a1 === "number" ? a1 & 7 : null;
}

/** One ladder endpoint, as the record's params[1]/params[2] carry it (px). */
export interface LadderEnd { x: number; y: number }

/**
 * The decoded geometry of one climb, read out of the two mount bodies
 * (`F0x8008f128` file 0xc478 bottom, `F0x8008f1d4` file 0xc524 top) and the four
 * step-on/dismount mode blocks they hand over to. All line citations are
 * `pro/fieldstg.s`.
 *
 * - `side` is `entity+0x8c`: both mounts compare the facing they were handed
 *   against 5 (`beq $s3,$v0` at :12605/:12648) and store 0 when it matches,
 *   else 1 — the same word the sprite side and the step-off direction read.
 * - The bottom mount pins the foot cell verbatim: x = params[1], y = params[2],
 *   offset 0 (:12602-:12604). The head mount pins the head cell (:12645/:12646)
 *   and its step-on block (mode 0x44, file 0xd950) then moves ONTO the rail:
 *   `x = head.x + 16` when side is 1, `- 16` when 0 (:13925-:13932), and
 *   `y = head.y + 24 + height` with the climb offset seeded to `height`
 *   (:13933-:13938) — so the first drawn row is `head.y + 24`.
 * - `height` is the record's own `(params[0] - 1) << 4` — the stack argument the
 *   op handlers build (`addiu $v0,-1 / sll $v0,0x4` at :5a94/:5aec) and the
 *   mounts store at `entity+0x94` (:12606/:12647). The climb blocks compare
 *   `entity+0x90` against it (up :13851-:13855, down :13874) — it is NOT the
 *   endpoint span: the census over all 216 shipped rails has `span = height + 24`
 *   for 132 of them, `+13..+28` for the rest, and the missing 24 px are the
 *   dismount step-off.
 * - `baseY` is the ground row the shadow is pinned to: the bottom mount's
 *   `y`, and for the head mount `head.y + 24 + height` — both the rail's foot
 *   row, because the climb offset `entity+0x90` is subtracted from the drawn row
 *   (file 0xe3d8-0xe3fc) and added back for the shadow (file 0xcbf8).
 */
export interface LadderClimbPlan {
    /** The rail x the whole climb runs on. */
    railX: number;
    /** The rail's foot ground row — where the drop shadow stays. */
    baseY: number;
    /** The drawn row the climb starts from. */
    startY: number;
    /** The climb length in px: the record's `(params[0]-1)<<4`. */
    height: number;
    /** `entity+0x8c`: 0 when the mount handed facing 5, else 1. */
    side: number;
    fromBottom: boolean;
}

export function ladderClimbPlan(
    bottom: LadderEnd,
    top: LadderEnd,
    mountFacing: number,
    fromBottom: boolean,
    recordHeight: number,
): LadderClimbPlan {
    const side = (mountFacing & 7) === 5 ? 0 : 1;
    // A rail whose record height is not positive cannot climb; the disc ships
    // ids 3..18 ((params[0]-1)<<4 = 32..272 px), so the fallback never fires on
    // the shipped data and exists only so a malformed call cannot divide the
    // climb by nothing.
    const height = recordHeight > 0 ? recordHeight : Math.abs(bottom.y - top.y);
    if (fromBottom) {
        return { railX: bottom.x, baseY: bottom.y, startY: bottom.y, height, side, fromBottom };
    }
    return {
        railX: top.x + (side ? 16 : -16),
        baseY: top.y + 24 + height,
        startY: top.y + 24,
        height,
        side,
        fromBottom,
    };
}

/** The drawn position of a climb `progress` px up from the mount (entity+0x90). */
export function ladderClimbPosition(
    plan: LadderClimbPlan,
    progress: number,
): { x: number; y: number } {
    return { x: plan.railX, y: plan.baseY - progress };
}

/**
 * Where a finished climb leaves the actor.
 *
 * The top end (mode 0x45, file 0xda6c) steps off when its clip completes: x
 * moves 16 px sideways AGAINST the side word (:14017-:14021 — the head mount's
 * ±16 in reverse, so the landing is the head cell) and y drops by `24 + height`
 * (:14025-:14028), landing on the head cell's row. The bottom end (mode 0x46,
 * file 0xd9f8) shifts nothing — the climb's own `offset <= 0` clamp already left
 * the actor on the foot row — and only stores 0 into `entity+0x60` (:13983), so
 * the player comes off facing down.
 */
export function ladderDismountEnd(
    plan: LadderClimbPlan,
    atTop: boolean,
): { x: number; y: number } {
    if (!atTop) return { x: plan.railX, y: plan.baseY };
    return { x: plan.railX + (plan.side ? -16 : 16), y: plan.baseY - 24 - plan.height };
}
/** Ops 1 and 14 change stage; op 1 is the ordinary door, op 14 the pad-style handoff. */
export function isStageChangePlayback(op: number): boolean {
    return op === 1 || op === 14;
}
/** Ops 9 and 10 are the DIGIMON dive (hole) and the Submarimon dive (water). */
export function isDivePlayback(op: number): boolean {
    return op === 9 || op === 10;
}

/**
 * WRITER SITE B — the pair the DIVE LAUNCHER publishes, for ops 9 and 10.
 *
 * The executor's op-9/10 arm writes neither half itself: it hands `record + 0xa` to the
 * field character's vtable slot +0x124 (fieldstg.s:14682 installs `F0x8008F3E4`), which
 * raises the type-7 transition entity through the constructor `F0x8008C078`. That
 * constructor stashes the pointer it was given at `obj + 0x7C` (fieldstg.s:9486), and the
 * entity's handler `F0x8008AA10` reads it back as `$s4 + 0x7c`:
 *
 *   .L0x00008904 lw $v0,0x7c($s4)   / :890c lhu $v0,0xa($v0)  -> [0x80048D34+0x44]  (:8914)
 *   .L0x00008918 lw $v0,0x7c($s4)   / :8920 lhu $v0,0xc($v0)  -> [0x80048D34+0x46]  (:8928)
 *
 * `rec` IS `record + 0xa`, so `rec+0x0A` is `record+0x14` and `rec+0x0C` is `record+0x16` —
 * the identical two fields op 1 stores at :5a18 / :5a2c. Site B is therefore not an
 * independent writer: it is op 1's pair, reached by the other two opcodes, one call
 * deeper. `undefined` for every other opcode, which is how "publishes nothing" is told
 * apart from "publishes zero".
 */
export function launcherRouteWords(
    op: number,
    params: readonly number[] = [],
): { d78: number; d7a: number } | undefined {
    return isDivePlayback(op) ? routePairWords(params) : undefined;
}
/**
 * The stage handoff's own countdown: how many ticks the disc waits after the handoff is
 * requested and before the destination stage is actually loaded. It is the handoff's
 * SIXTH argument — `scene_obj+0x68` in 0x8008B6D4 (fieldstg.s:8a78/:8a84), spent by the
 * type-7 phase-2 handler at :8984-:89c8. Read through the port rather than written here,
 * so a host cannot disagree with the op table about it: 0x3c for op 14, 0 for op 1 (the
 * wrapper 0x8008B770 passes a zero in that slot, :8acc), 0 for every op with no handoff.
 */
export function handoffHold(op: number): number {
    return execPlaybackOp(op, 0).handoff?.holdTicks ?? 0;
}

/**
 * The playback executor's table (`0x80082E98`, file 0x1e8, ops 1..14) — the shape of
 * every entry, re-derived from the image by tests/lane-b/scene-step.test.js.
 */
export interface DecodedPlaybackOp {
    op: number;
    handler: number;
    /** what the player sees. */
    shows: string;
    /** what it calls, and with what. */
    does: string;
}

export const PLAYBACK_OPS: readonly DecodedPlaybackOp[] = [
    { op: 1, handler: 0x5970, shows: "the door/warp fires and you are moved",
      does: "actor+0x110(actor, group); 0x8008B770(param0, -1, param1<<8, param2<<8, param3); a 0x12-stride list at [0x80099D90] is walked and entry[0] cleared when its key byte equals param5; [0x80048D78] = param5, [0x80048D7A] = param6" },
    { op: 2, handler: 0x5a80, shows: "the player walks",
      does: "actor+0x114(actor, group, param1, param2, (param0-1)*16)" },
    { op: 3, handler: 0x5ac0, shows: "the player turns / stops",
      does: "actor+0x118(actor, group==1 ? 5 : 3, param1, param2, (param0-1)*16) — the li $a1,3 is the bne's DELAY SLOT, so it runs on both paths (:5ad0/:5ad4)" },
    { op: 4, handler: 0x5b14, shows: "the player climbs",
      does: "actor+0x11c(actor, group, [0x80082E8C], [0x80082E90], param0<<4) — the bare sll, no addiu -1 (:5b30)" },
    { op: 5, handler: 0x5bc8, shows: "nothing", does: "the executor's epilogue" },
    { op: 6, handler: 0x5bc8, shows: "nothing", does: "the executor's epilogue" },
    { op: 7, handler: 0x5b58, shows: "the player is moved two cells",
      does: "actor+0x120(actor, group, param0, param1, <unset>, <unset>, param0, param1) — sp+0x18/sp+0x1c, not sp+0x10/sp+0x14" },
    { op: 8, handler: 0x5bc8, shows: "nothing", does: "the executor's epilogue" },
    { op: 9, handler: 0x5bac, shows: "the scene takes over (the DIGIMON dive)",
      does: "actor+0x124(actor, record+0xa) with a2 = 1" },
    { op: 10, handler: 0x5ba4, shows: "the scene releases the player (the water dive)",
      does: "actor+0x124(actor, record+0xa) with a2 = 0" },
    { op: 11, handler: 0x5bc8, shows: "nothing", does: "the executor's epilogue" },
    { op: 12, handler: 0x5bc8, shows: "nothing", does: "the executor's epilogue" },
    { op: 13, handler: 0x5bc8, shows: "nothing", does: "the executor's epilogue" },
    { op: 14, handler: 0x5a30, shows: "Junior walks to a launch pad and the stage hands off 0x3c ticks later",
      does: "actor+0x158(actor, record+0xa); 0x8008B6D4(param0, -1, param1<<8, param2<<8, param3, 0x3c) — the sixth word seeds the type-7 scene object's +0x68, a countdown its phase-2 handler spends before it loads the destination (:8984/:8994/:89c8). Op 1 reaches the same body through 0x8008B770, which passes ZERO there (:8acc), so a door crosses at once" },
];