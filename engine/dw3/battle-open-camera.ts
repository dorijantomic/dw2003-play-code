// engine/dw3/battle-open-camera.ts
//
// THE BATTLE-OPEN CAMERA FLOURISH — the port of FIGHTSTG_F0x800a1fe0 (class 0x800a1fe0),
// the SECOND member of the camera-sequence-driver family (the first is the idle cut
// director, engine/dw3/battle-idle-director.ts).
//
// `pro/fightstg` creates one of these per battle as the battle controller's child slot 6
// (`wfightmn.s:1175-1178`, in the opening machine's phase-1 fighter-load body) and ticks it
// every frame the controller is ticked. On its FIRST tick it picks ONE of three scripted rows
// at random and plays it; when the row's `0xffff` terminator is reached it re-cuts the plain
// arena shot and self-destructs (state 3 -> the exe dispatcher frees it, `exe/fns.s:8883`,
// `:8900-8905`). So it owns the camera over the ARENA from the moment the fighters are loaded
// until its row ends, then leaves the plain arena shot on screen for the rest of the opening.
//
// ── The routines and the words they read ─────────────────────────────────────
//
//   self+0x0c  state        (0 setup, 1 play, 2 nothing, 3 re-cut the arena shot then free)
//   self+0x10  sub-state    (1..6; 0 and >6 take the default arm = dwell decrement only)
//   self+0x14  sub counter  (the sub-6 pan's setup runs ONCE, on its first tick)
//   self+0x28  SetState     (base class F0x80014274: `sw $a1,0xc($a0)`)
//   self+0x2c  SetSub1      (base class F0x80014288: `sw $a1,0x10($a0)` + clear +0x14/+0x18)
//   self+0x38  AdvState     (base class F0x800142ac: clear +0x10/+0x14/+0x18, +0x0c += 1)
//   self+0x50  the camera provider (the camera OBJECT's own methods; looked up by class id
//              through `[0x8004B610]->unk1AC(0x12,-1,-1)`): +0x100 = m100 (arena shot),
//              +0x104 = m104 (a canned per-model shot), +0xf8 = cut / instant-apply,
//              +0xfc = glide / move
//   self+0x54  the staged camera record this tick
//   self+0x5c  row          self+0x5e  index        self+0x68  dwell counter
//   self+0x60  the saved record +0x26     self+0x62  the saved record +0x24
//
// ── The row pick and the table (state 0, :32590-32647) ───────────────────────
//
//   r = [0x8004DC0C]() & 3 ; if (r == 3) r = 0 ; row = r
//
// `[0x8004DC0C]` is `rand_u16` (exe/fns.s:10116-10134), reached through the function pointer
// cell — the SAME stream every battle roll draws from, and the source this port draws from
// (`RAND_U16`, engine/dw3/random-stream.ts via battle-formulas.ts). Rows 0 (p 1/2), 1 and 2
// (p 1/4 each).
//
// The table 0x800A46A8 is THREE rows of three 32-bit words, each word packing
// `subState = high halfword` and `dwell = SIGNED low halfword`; a word whose low halfword is
// -1 (`0x0000ffff`) terminates the row. Extracted verbatim from the committed fightstg overlay
// image `web/assets/native/screens/pro_fightstg.bin` (base 0x80082cb0, file offset 0x219f8):
//
//   row 0  0x00060040 0x00030002 0x0000ffff  ->  (6,64) (3,2) END
//   row 1  0x00010020 0x00040020 0x0000ffff  ->  (1,32) (4,32) END
//   row 2  0x00020020 0x00040020 0x0000ffff  ->  (2,32) (4,32) END
//
// In player terms: row 0 = a ~1-second PAN around the arena then the plain shot; row 1 = cut
// to a FAR-side canned angle then a GLIDE back to the plain shot; row 2 = cut to a NEAR-side
// canned angle then a glide back. All three end by re-cutting the plain arena shot and freeing
// the object.
//
// ── The sub-state arms (jump table 0x800832B8, built at .s:32585-32847) ───────
//
//   sub 1 -> m104(far,  0)  then cut    (row 1's opening cut)
//   sub 2 -> m104(near, 8)  then cut    (row 2's opening cut)
//   sub 3 -> m100 (arena)   then cut
//   sub 4 -> m100, copy the record to the staging block, glide to it (duration = dwell)
//   sub 5 -> m104(near, 0xA), copy, glide   (DORMANT — none of the three rows selects it)
//   sub 6 -> m100 ONCE (guarded by +0x14), save record +0x24/+0x26, then every tick
//            +0x24 = saved24 - (dwell*0x155 >> 6), +0x26 = saved26 + (dwell << 5), then cut
//            (the pan; the two offsets are the anchor-frame angles shifted by -0x155/+0x800
//             and slid further each tick)
//
// ONE MORE WORD, easy to miss: arms 1-5 clear the sub-state to 0 on the way out. The clearing
// instruction (`sw $zr,0x10($s1)`, .s:32728 / :32780) sits in the DELAY SLOT of each arm's
// closing `j .L0x800a23fc`, so it runs on the same tick the arm does. That is why a cut/glide
// arm fires ONCE per word and the rest of the word's dwell is spent on the default arm (dwell
// decrement only) — while the pan (sub 6) does NOT clear it and therefore runs every tick. The
// dwell counter is `self+0x68`, decremented once per tick by the raw per-frame delta
// `[0x8004DF9C]()` (1 a frame), the same clock the idle director reads.
//
// ── Engine convention ───────────────────────────────────────────────────────
//
// `arena()` returns the camera object's m100 shot as the logical 14-word record the camera
// owner uses ([eye 0..2, target 3..5, anchor 6..8, angles 9..11, roll 12, H 13] — the SAME
// layout `web/fight/battle-camera.js fieldsFromShot` produces and the SAME one the idle
// director's arms read), and `canned(side, index)` returns m104's canned shot the same way.
// `side` is "player" for m104's argument 0 (the NEAR table) and "enemy" for 0x10 (the FAR
// table), exactly as `web/battle3d.js cannedShotSlot` already names them. The arms return the
// record the original installs through [0xf8] (a cut) or [0xfc] (a glide of `duration`
// frames), so the caller drives its one camera-record owner with them and nothing is
// re-implemented here.
//
// The oracle tests/engine/unit/battle-open-camera-oracle.test.ts runs the ORIGINAL instruction
// words of FIGHTSTG_F0x800a1fe0 out of the committed fightstg overlay image, with the provider
// methods and the base-class SetState/SetSub1/AdvState stubbed, and compares the walk, the
// dwell, the saved angles and the record after every tick to this port.

import { RAND_U16 } from "./battle-formulas.ts";

/** The object's class id (`F0x800a246c` = `F0x80014504(0x800a1fe0, 0xa4, 0)`, .s:32868-32879). */
export const OPEN_CAMERA_CLASS = 0x800a1fe0;

/** The three-row script table (.s:35062-35070). */
export const OPEN_CAMERA_TABLE = 0x800a46a8;

/** The sub-state jump table (.s:376-381, RAM 0x800832b8). */
export const OPEN_CAMERA_ARM_TABLE = 0x800832b8;

/** A row terminator is a word whose low (signed) halfword is -1. */
export const OPEN_CAMERA_ROW_END = -1;

/** One word of a row: the sub-state (high halfword) and the dwell (signed low halfword). */
export interface OpenCamShot {
    readonly sub: number;
    readonly dwell: number;
}

/**
 * The three rows, verbatim from 0x800A46A8 — `(subState, dwell)` per word, terminator implied
 * by the row's end. Extracted from `web/assets/native/screens/pro_fightstg.bin`, NOT typed by
 * hand (see the module header for the raw words).
 */
export const OPEN_CAMERA_ROWS: readonly (readonly OpenCamShot[])[] = [
    [{ sub: 6, dwell: 64 }, { sub: 3, dwell: 2 }],
    [{ sub: 1, dwell: 32 }, { sub: 4, dwell: 32 }],
    [{ sub: 2, dwell: 32 }, { sub: 4, dwell: 32 }],
];

/**
 * The row a raw `rand_u16` return selects: `rand & 3`, with 3 remapped to 0. Rows 0, 1, 2
 * (0 at double weight). This is the ONLY randomness in the object.
 */
export function openCameraRow(rand: number): number {
    const r = (rand | 0) & 3;
    return r === 3 ? 0 : r;
}

/** The `(sub, dwell)` word at `index` of `row`, or null past the last word (the terminator). */
export function openCameraShot(row: number, index: number): OpenCamShot | null {
    const r = OPEN_CAMERA_ROWS[row | 0];
    if (!r) return null;
    return r[index | 0] ?? null;
}

/** The 14-word logical camera record (see the module header's engine convention). */
export type OpenCamFields = number[];

/** The record the original installs this tick: a cut ([0xf8]) or a glide ([0xfc]). */
export type OpenCamAction =
    | { readonly kind: "cut"; readonly fields: OpenCamFields }
    | { readonly kind: "move"; readonly fields: OpenCamFields; readonly duration: number };

export interface BattleOpenCameraState {
    readonly state: number;
    readonly sub: number;
    readonly row: number;
    readonly index: number;
    readonly dwell: number;
    /** self+0x62 — the saved record +0x24 the pan slides. */
    readonly savedA: number;
    /** self+0x60 — the saved record +0x26 the pan slides. */
    readonly savedB: number;
    /** True once the state-3 tick has run: the exe dispatcher has freed the object. */
    readonly gone: boolean;
}

export interface BattleOpenCameraTick extends BattleOpenCameraState {
    /** What the arms installed this tick, or null (the default arm / a terminator tick). */
    readonly action: OpenCamAction | null;
    /**
     * The sub-state the arm that ran this tick DISPATCHED on — captured before arms 1-5 clear
     * the sub-state to 0 in their delay slot, so a probe can name which arm produced the cut.
     */
    readonly arm: number;
}

export interface BattleOpenCamera {
    /** ONE TICK: `delta` is `[0x8004DF9C]()` — the raw per-frame delta, 1 a frame. */
    update(delta: number): BattleOpenCameraTick;
    state(): BattleOpenCameraState;
}

export interface BattleOpenCameraOptions {
    /** The game's own random source; `RAND_U16` unless a caller injects one. */
    rand?: () => number;
    /** `[0x100]` m100 — the arena shot's 14 words. */
    arena?: () => OpenCamFields | null;
    /** `[0x104](side, index)` m104 — a canned shot's 14 words (0 = near, 0x10 = far). */
    canned?: (side: "player" | "enemy", index: number) => OpenCamFields | null;
}

const u16 = (v: number): number => v & 0xffff;

/**
 * The battle-open camera-sequence actor: the port of FIGHTSTG_F0x800a1fe0.
 *
 * `update(rawDelta)` is ONE TICK of the object's state machine and returns the record it
 * installs that tick (or null). The object's first `update` runs the state-0 setup AND falls
 * through into the play state in the same call, exactly as the ROM's `default:` case falls
 * into `case 1:`. Once the row terminates the object takes state 3, cuts the arena shot on
 * the next tick and reports `gone` — the exe has freed it and no later tick cuts.
 */
export function createBattleOpenCamera({
    rand = RAND_U16,
    arena,
    canned,
}: BattleOpenCameraOptions = {}): BattleOpenCamera {
    let state = 0;                 // self+0x0c
    let sub = 0;                   // self+0x10
    let subCounter = 0;            // self+0x14
    let row = 0;                   // self+0x5c
    let index = 0;                 // self+0x5e
    let dwell = 0;                 // self+0x68
    let savedA = 0;                // self+0x62 (record +0x24)
    let savedB = 0;                // self+0x60 (record +0x26)
    let record: OpenCamFields | null = null;  // self+0x54
    let gone = false;

    const arenaRaw = (): OpenCamFields | null => (arena ? arena() : null);
    const cannedRaw = (side: "player" | "enemy", i: number): OpenCamFields | null =>
        (canned ? canned(side, i) : null);

    /**
     * The state-0 setup (:32590-32647): AdvState (+0x0c = 1), pick the row, read its first
     * word into the dwell and through SetSub1 into the sub-state, allocate the camera provider
     * and take the arena shot into +0x54. It then FALLS THROUGH into state 1 (the ROM's
     * `default:` case runs the `case 1:` body).
     */
    function setup(): void {
        state = 1;                 // AdvState (F0x800142ac)
        row = openCameraRow(rand());
        index = 0;
        subCounter = 0;
        const e = openCameraShot(row, index);
        dwell = e ? e.dwell : 0;
        sub = e ? e.sub : 0;       // SetSub1 (F0x80014288)
        record = arenaRaw();       // `[0x100]` -> +0x54
    }

    /** The advance: index+1, then either the next word or the SetState(3) terminator. */
    function advance(): boolean {
        index += 1;
        const e = openCameraShot(row, index);
        if (!e) { state = 3; return false; }   // terminator -> SetState(3), no cut, no dwell dec
        dwell = e.dwell;
        sub = e.sub;
        subCounter = 0;
        return true;
    }

    /**
     * The sub-state dispatch (:32585-32847). Returns the action the arm installs, or null for
     * the default arm (sub 0 / >6, dwell decrement only).
     */
    function runArm(): OpenCamAction | null {
        switch (sub) {
            case 1: {
                const f = cannedRaw("enemy", 0);       // m104(0x10, 0) — the far table
                if (!f) return null;
                record = f;
                sub = 0;                               // delay slot of the arm's closing jump
                return { kind: "cut", fields: f };
            }
            case 2: {
                const f = cannedRaw("player", 8);      // m104(0, 8) — the near table
                if (!f) return null;
                record = f;
                sub = 0;
                return { kind: "cut", fields: f };
            }
            case 3: {
                const f = arenaRaw();                  // m100
                if (!f) return null;
                record = f;
                sub = 0;
                return { kind: "cut", fields: f };
            }
            case 4: {
                const f = arenaRaw();                  // m100 -> staging copy -> glide
                if (!f) return null;
                record = f.slice();
                sub = 0;                               // delay slot (after [0xfc] returns)
                return { kind: "move", fields: record, duration: dwell };
            }
            case 5: {
                const f = cannedRaw("player", 10);     // m104(0, 0xA) -> staging copy -> glide
                if (!f) return null;
                record = f.slice();
                sub = 0;
                return { kind: "move", fields: record, duration: dwell };
            }
            case 6: {
                // The pan. Its setup runs ONCE (+0x14 guard): take the arena shot, save its
                // +0x24/+0x26, then offset them by -0x155/+0x800.
                if (subCounter === 0) {
                    const f = arenaRaw();
                    if (!f) return null;
                    record = f;
                    savedA = u16(f[9]!);
                    savedB = u16(f[10]!);
                    f[9] = u16(savedA - 0x155);
                    f[10] = u16(savedB + 0x800);
                    subCounter = 1;
                }
                const f = record;
                if (!f) return null;
                // +0x24 = saved24 - (dwell*0x155 >> 6) ; +0x26 = saved26 + (dwell << 5)
                let v = (dwell | 0) * 0x155;
                if (v < 0) v += 0x3f;
                v >>= 6;
                f[9] = u16(savedA - v);
                f[10] = u16(savedB + ((dwell | 0) << 5));
                return { kind: "cut", fields: f };
            }
            default:
                return null;   // sub 0 / >6: the default arm — nothing but the dwell decrement
        }
    }

    function snapshot(action: OpenCamAction | null, arm = sub): BattleOpenCameraTick {
        return { action, arm, state, sub, row, index, dwell, savedA, savedB, gone };
    }

    function update(delta: number): BattleOpenCameraTick {
        // State 3 (:32848-32860): take the arena shot and instant-apply it — the plain arena
        // re-cut. The exe then destroys the object (a state-3 tick runs once), so after it the
        // object is GONE and no later tick cuts.
        if (state === 3) {
            const f = arenaRaw();
            record = f;
            gone = true;
            return snapshot(f ? { kind: "cut", fields: f } : null);
        }
        if (gone) return snapshot(null);

        if (state === 0) setup();

        // state 1: the dwell gate, then the arm, then the decrement.
        if (dwell <= 0) {
            if (!advance()) return snapshot(null);   // the terminator tick: SetState(3), no action
        }
        const arm = sub;
        const action = runArm();
        dwell = (dwell | 0) - (delta | 0);
        return snapshot(action, arm);
    }

    return {
        update,
        state: (): BattleOpenCameraState => ({ state, sub, row, index, dwell, savedA, savedB, gone }),
    };
}
