// Lane B oracle: engine/dw3/ui/native/battle-loss.ts must match the original's loss
// sequence — the branch that decides it, the defeat effect, the fade and the exit.
//
// The originals run through engine/native. Both overlays are loaded into ONE runtime
// (pro/fightstg as the overlay at 0x80082CB0, pro/wfightmn mapped at 0x800A5DE0 on top
// of the resident image, which does not overlap: fightstg ends at 0x800A4CB0), so the
// exit in wfightmn really calls the effect and the fade in fightstg.
//
//   F0x8009C534                    the result byte and its three-word record
//   F0x800A8F88 (.L0x00003450)     the loss branch: jingle, message 0x53, the effect
//   F0x8008CB44 -> F0x8008C93C     the defeat effect: the shot, phase 2 at 0xF0, the orbit
//   F0x8008AAAC / F0x8008A83C / F0x8008AA08 / F0x8008A8C4   the fade and the grey it draws
//   F0x800A7C00                    the exit: wait for phase 2, fade, then the launch
//
// The task factory F0x80014504 -> F0x800143DC and the four base state methods are the
// EXISTING translated ones on both sides (TranslatedTaskTree plus the base method table
// the allocator writes), and so is F0x8001DA84/F0x8001E028 for the exit's view-colour
// call. Only the device and workspace edges are stubbed, each one logging the call it
// stands for so both sides are compared in the original's own order.
//
// What a player sees, and what each divergence in the port closes:
//   "Annihilated..." goes up in the battle's own message window on the original's arm 1
//   with the payload word the branch wrote; the GAMEOVER jingle plays; the camera cuts to
//   the original's close shot of your Digimon and turns two of 4096 a frame while the
//   models drop to quarter speed; the screen then darkens one step of 0xFF00/10 per tick
//   — 25, 51, 76 ... the grey the quad is drawn with — holds black, and the title screen
//   is asked for on the frame after that. The frame it is asked for is compared here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { TranslatedTaskTree } from "../../engine/dw3/ui/translated-task-tree.ts";
import { BASE_TABLE } from "../../engine/dw3/ui/create-text-element.ts";
import {
    DISPLAY_SERVICE, DISPLAY_SERVICE_FIELDS, findRegisteredHandleByKey,
} from "../../engine/dw3/display-service.ts";
import { RECT_COLOUR, setRectColour } from "../../engine/dw3/display-view.ts";
import { BattleLossSession } from "../../engine/dw3/ui/battle-loss-session.ts";
import { frameClock } from "../../engine/systems/frame-clock.ts";
// The walker's own pre-port loss beat, kept as the ?legacyLoss=1 rollback. The test
// below drives it against the original's numbers; web/battle.js is imported for that
// one function.
import { lossExitFrame } from "../../web/battle.js";
import {
    LOSS_EFFECT_CHILD_EXTRA, LOSS_EFFECT_CHILD_SIZE, LOSS_EFFECT_CHILD_TICK,
    LOSS_EFFECT_COUNTER, LOSS_EFFECT_EXTRA, LOSS_EFFECT_PHASE2_UNITS,
    LOSS_EFFECT_SIZE, LOSS_EFFECT_TICK, LOSS_FADE_CREATE, LOSS_FADE_DIRECTION, LOSS_FADE_LEVEL,
    LOSS_FADE_RAMP,
    LOSS_FADE_STEP, LOSS_FADE_TICK, LOSS_GAMEOVER_SOUND, LOSS_LAUNCH_TITLE,
    LOSS_MESSAGE_ID, LOSS_MESSAGE_KIND, LOSS_MESSAGE_WORD, LOSS_MODE, LOSS_RESULT_BYTE,
    LOSS_RESULT_RECORD, LOSS_SET_RESULT, LOSS_SLOT_EFFECT, LOSS_SLOT_FADE, LOSS_STATE,
    LOSS_EXIT, LOSS_TICK, LOSS_VIEW_KEY, LOSS_WRITE_BACK, LOSS_YAW_WORD, lossBranch, lossEffectTick,
    lossExitTick, lossFadeArm, lossFadeCreate, lossFadeGrey, lossFadeLevel, lossFadeTick,
    lossSetResult,
} from "../../engine/dw3/ui/native/battle-loss.ts";

/** F0x8008A83C, the method F0x8008AAAC installs at the fade's +0x64. */
const FIGHTSTG_FADE_ARM = 0x8008a83c;

const here = dirname(fileURLToPath(import.meta.url));
const screens = join(resolve(here, "../.."), "web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(screens, "resident.bin")));
const fight = new Uint8Array(readFileSync(join(screens, "pro_fightstg.bin")));
const wfight = new Uint8Array(readFileSync(join(screens, "pro_wfightmn.bin")));
const FIGHT_BASE = 0x80082cb0;
const WFIGHT_BASE = 0x800a5de0;
const entry = { size: fight.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

// ── the walker's own blocks, outside the task tree's range ────────────────────
const SCREEN = 0x801f0000;   // the battle controller: its +0x14 is the exit's mode word
const BLOCK = 0x801f0100;     // the controller's child pointers: +0x18 effect, +0x1C window/fade
const WINDOW = 0x801f0200;    // the message window F0x8009A298 built
const VIEW = 0x801f0300;      // the display view registered under key 0x1000
const OWNER = 0x801f0400;     // what [0x800A37FC] returns: a group's owning object
const CAM = 0x801f0500;       // the effect's camera object (self+0x50)
const ANIM = 0x801f0600;      // the class-0x15 animation manager
const CLS14 = 0x801f0700;     // the class-0x14 object
const PRIM1 = 0x801f0800;     // the layer F0x8008A8C4 builds the fade's quad in (0x180 bytes)
const PRIM2 = 0x801f0a00;     // the draw target F0x8008A8C4 ors its mask into
/** Each block and how much of it is cleared before every run. */
const BLOCKS = [[SCREEN, 0x100], [BLOCK, 0x100], [WINDOW, 0x100], [VIEW, 0x100], [OWNER, 0x100],
    [CAM, 0x100], [ANIM, 0x100], [CLS14, 0x100], [PRIM1, 0x180], [PRIM2, 0x100]];

// ── the boundary stubs, shared by both sides ─────────────────────────────────
const ALLOC_WRAPPER = 0x80014504;   // F0x80014504: $a3 is zeroed in its own delay slot
const ALLOC = 0x800143dc;           // F0x800143DC: the base task object
const SET_RESULT = 0x8009c534;     // stubbed only where the log must match exactly
const RESULT_WALK = 0x8009b9d0;     // F0x8009B9D0: the 99-entry workspace walk
const MESSAGE_WINDOW = 0x8009a298;  // F0x8009A298: the message window
// `lui $s0, 0x8005 / addiu $s0, -0x49F0` = 0x8004B610, and the entry arm reads its
// +0x1AC: [0x8004B7BC], the class allocator the camera / animation / class-0x14 objects
// are built from.
const CLASS_ALLOC = 0x8004b610 + 0x1ac;
const SOUND_CELL = 0x80055c48;      // [0x80055C48]: the packed-sound player
const SLOWMO_CELL = 0x800a4548;     // [0x800A4548]: F0x8009E510, the slow-motion level
const DELTA_CELL = 0x8004df9c;      // [0x8004DF9C]: the frame delta
const LAUNCHER_CELL = 0x8004b440;   // [0x8004B440]: the resident launcher
const RECORD_CELL = 0x8004b44c;     // [0x8004B44C]: one group's outcome record
const RAND_CELL = 0x8004dc0c;       // [0x8004DC0C]: the workspace's random
const OWNER_CELL = 0x800a37fc;      // [0x800A37FC]: a group's owning object
const VIEW_LOOKUP_CELL = 0x8004df8c;// [0x8004DF8C]: F0x8001DA84 (seeded by the runtime)
const VIEW_COLOUR = 0x8001e028;     // F0x8001E028: setRectColour
const VIEW_LOOKUP = 0x8001da84;
// F0x8008A8C4 resolves two GPU primitives out of the display service's own table
// (D0x8004DE10+0x17C, +0x158) and hands the primitive to +0x15C. +0x158 and +0x15C are
// already the runtime's draw-target getter/setter; +0x17C is stubbed here to a block, and
// that block's own +0x138 (the primitive's method slot) is stubbed too.
const PRIM_METHOD = 0x0fe70034;   // the layer object F0x8008A8C4 builds its quad in

const STUB = 0x0fe70000;
const S_CAM_PRESET = STUB + 0x00;   // camera->+0x104: camMgr->[0x104](0, 0xB)
const S_CAM_TURN = STUB + 0x04;     // camera->+0xF8: the shot re-apply
const S_MOTION = STUB + 0x08;       // animMgr->+0xE8: the motion 0x17
const S_CLASS14 = STUB + 0x0c;      // class-0x14 ->+0x188
const S_SOUND = STUB + 0x10;
const S_SLOWMO = STUB + 0x12;
const S_DELTA = STUB + 0x14;
const S_LAUNCH = STUB + 0x18;
const S_RECORD = STUB + 0x1c;
const S_RAND = STUB + 0x20;
const S_OWNER = STUB + 0x24;
const S_WRITEBACK = STUB + 0x28;
const S_WINDOW = STUB + 0x2c;
const S_MESSAGE = STUB + 0x30;     // window->+0xAC
const S_CLASS_ALLOC = STUB + 0x38;

const LOG = [];
const CTL = { delta: 1, rand: 12345 };
let S = null;   // the shared translated services of one run

const reg = (c, i) => c.reg(4 + i) >>> 0;
const arg = (c, i) => c.reg(4 + i) | 0;

// ── the one runtime: fightstg as the overlay, wfightmn mapped above it ─────────
const rt = new NativeStageRuntime(fight, entry,
    { setFlag() {}, getFlag: () => 0, rand16: () => 1 },
    undefined, undefined, FIGHT_BASE, { image: resident, base: 0x80010000 });
const mem = rt.mem;
rt.mem.load(wfight, WFIGHT_BASE);
{
    const inner = rt.cpu.execGuard;
    rt.cpu.execGuard = (pc) => inner(pc) || (pc >= WFIGHT_BASE && pc < WFIGHT_BASE + wfight.length);
}
rt.cpu.gp = 0x8005cb50;
// F0x80014504's own body runs (so the scheduler key is proved to be 0) and reaches the
// stubbed F0x800143DC, as the resident factory does.
rt.cpu.clearStub(ALLOC_WRAPPER);
// Nothing inside the routines under test may be auto-stubbed.
for (const a of rt.cpu.stubAddresses()) {
    if ((a >= 0x8008a7c0 && a < 0x8008ac00) || (a >= 0x8008c500 && a < 0x8008cc00)
        || (a >= 0x8009c500 && a < 0x8009c600) || (a >= 0x800a7c00 && a < 0x800a7d00)
        || (a >= 0x800a7c00 && a < 0x800a9200)) rt.cpu.clearStub(a);
}

// ── the one object factory, on both sides ────────────────────────────────────
// The three classes are BattleLossSession's own: the port's turns run through the
// shared TranslatedTaskTree, so this file compares the shipped wiring and not a
// private re-implementation of it. `terminalTick` is the resident stepper's rule that a
// state-3 object is stepped once and then retired (F0x80018140).
const classes = new Map([
    [LOSS_EFFECT_TICK, {
        name: "defeat effect", childSlots: [0], terminalTick: true,
        tick: (obj, extra) => lossEffectTick(mem, portHost(), obj, extra),
    }],
    [LOSS_EFFECT_CHILD_TICK, { name: "defeat effect child", childSlots: [], tick() {} }],
    [LOSS_FADE_TICK, { name: "battle fade", childSlots: [], tick: (obj) => lossFadeTick(mem, obj) }],
]);
/** F0x800143DC on both sides: the base method table, the handler and the scheduler key. */
function allocObject(handler, size, extra, key) {
    const task = S.tree.allocate(handler >>> 0, size, extra);
    for (const [off, value] of BASE_TABLE) if (off !== 0x48) mem.write32(task + off, value);
    mem.write32(task, key >>> 0);
    return task;
}
const st = (a, f) => rt.cpu.setStub(a, f);
st(ALLOC, (c) => {
    LOG.push(["task", reg(c, 0), arg(c, 1), arg(c, 2), arg(c, 3)]);
    return allocObject(reg(c, 0), arg(c, 1), arg(c, 2), reg(c, 3));
});
st(RESULT_WALK, () => 0);           // the workspace walk: a boundary, not an event
// F0x8009A298 builds the window BEFORE the branch chooses an outcome
// (pro/wfightmn.s .L0x00003434), so both sides start with it in block+0x1C and the build
// itself is the caller's step, not the branch's.
st(MESSAGE_WINDOW, () => WINDOW);
st(S_MESSAGE, (c) => { LOG.push(["message", reg(c, 0), arg(c, 1), reg(c, 2)]); return 0; });
mem.write32(CLASS_ALLOC, S_CLASS_ALLOC);
st(S_CLASS_ALLOC, (c) => {
    const kind = arg(c, 0);
    LOG.push(["classAlloc", kind]);
    return kind === 0x12 ? CAM : kind === 0x15 ? ANIM : CLS14;
});
st(S_CAM_PRESET, (c) => { LOG.push(["camPreset", arg(c, 1), arg(c, 2)]); return 0; });
st(S_CAM_TURN, () => { LOG.push(["camTurn"]); return 0; });
st(S_MOTION, (c) => { LOG.push(["motion", arg(c, 1), arg(c, 2), arg(c, 3)]); return 0; });
st(S_CLASS14, (c) => { LOG.push(["cls14", arg(c, 1)]); return CLS14; });
st(S_SOUND, (c) => { LOG.push(["sound", reg(c, 0)]); return 0; });
mem.write32(SLOWMO_CELL, S_SLOWMO);
st(S_SLOWMO, (c) => { LOG.push(["slowMo", arg(c, 0)]); return 0; });
mem.write32(DELTA_CELL, S_DELTA);
st(S_DELTA, () => CTL.delta);
mem.write32(LAUNCHER_CELL, S_LAUNCH);
st(S_LAUNCH, (c) => {
    LOG.push(["launch", reg(c, 0), reg(c, 1)]);
    // F0x80016B88 (exe/fns.s:7367-7371): the pending screen code and its argument.
    mem.write32(0x8004b3fc, reg(c, 0));
    mem.write32(0x8004b404, reg(c, 1));
    return 0;
});
mem.write32(RECORD_CELL, S_RECORD);
st(S_RECORD, (c) => { LOG.push(["outcomeRecord", arg(c, 0)]); return 0; });
mem.write32(RAND_CELL, S_RAND);
st(S_RAND, () => { LOG.push(["rewardRand"]); return CTL.rand; });
mem.write32(OWNER_CELL, S_OWNER);
st(S_OWNER, () => { LOG.push(["rewardOwner"]); return OWNER; });
st(LOSS_WRITE_BACK, () => { LOG.push(["writeBack"]); return 0; });
// [0x8004DF8C] is seeded with F0x8001DA84 by the runtime's own global table, so the
// exit's view lookup runs for real; only the view's +0x12C is ours to point at.
mem.write32(VIEW_LOOKUP_CELL, VIEW_LOOKUP);
st(PRIM_METHOD, () => PRIM1);
// [0x80055C48] the packed-sound player: the branch's jingle. The runtime seeds the cell
// with its own recording stub; this one names the id so both sides log the same value.
mem.write32(SOUND_CELL, S_SOUND);

// ── scenario plumbing ────────────────────────────────────────────────────────
const zero = (a, n) => mem.bytes.fill(0, a & 0x1fffff, ((a & 0x1fffff) + n));

/**
 * The RAM both sides read before anything runs: the screen's mode word and its +0x2C
 * method, the three dead group records at 0x800A4470+group*0x20 (halfwords +0 and +8),
 * the record at 0x800A3868 whose +4 word is the decision, the group index byte at
 * 0x800A4359, one live group at 0x800A44D0+group*0x20 so the exit's reward block divides
 * by one, the display view under key 0x1000, and the camera/animation objects the
 * effect's entry arm builds.
 */
function seed() {
    zero(0x80100000, 0xa0000);
    S = { tree: new TranslatedTaskTree(mem, classes) };
    LOG.length = 0;
    Object.assign(CTL, { delta: 1, rand: 12345 });
    for (const [block, size] of BLOCKS) zero(block, size);
    mem.write32(SCREEN + 0x0c, 0);
    mem.write32(SCREEN + 0x2c, 0x80014288);   // the screen's own +0x2C: F0x80014288
    mem.write16(SCREEN + LOSS_MODE, 1);      // the jump table's arm 1 is the outcome arm
    mem.write32(0x800a4359, 0);             // the group index byte the arm reads
    mem.write32(0x800a3868 + 4, 0);         // [rec+4] == 0 -> the loss branch
    zero(0x800a4470, 0x60);                 // three dead groups
    mem.write16(0x800a44d0, 1);             // one live group, so the reward block's
    mem.write16(0x800a44d0 + 0x18, 1);      // div is by one and its owner is found
    // D0x8004DE10's two arrays (F0x8001DA84 walks them, +0x60 and +0xD8, 0x1E slots).
    // Slot 0 is the view the exit's mode-1 arm turns the colour off on, under key 0x1000;
    // slot 1 is the layer F0x8008A8C4 builds the fade's quad in, which the SAME cell looks
    // up under 0x1006 — the fade's +0x50 sheet word, read as the handle.
    mem.write32(DISPLAY_SERVICE + DISPLAY_SERVICE_FIELDS.viewBase, VIEW);
    mem.write32(DISPLAY_SERVICE + DISPLAY_SERVICE_FIELDS.viewHandle, 0x1000);
    mem.write32(DISPLAY_SERVICE + DISPLAY_SERVICE_FIELDS.viewBase + 4, PRIM1);
    mem.write32(DISPLAY_SERVICE + DISPLAY_SERVICE_FIELDS.viewHandle + 4, 0x1006);
    mem.write32(WINDOW + 0xac, S_MESSAGE);   // the window's own show method
    mem.write32(VIEW + 0x12c, VIEW_COLOUR);   // the view's +0x12C: F0x8001E028
    mem.write32(CAM + 0x104, S_CAM_PRESET);
    mem.write32(CAM + 0xf8, S_CAM_TURN);
    mem.write32(ANIM + 0xe8, S_MOTION);
    mem.write32(CLS14 + 0x188, S_CLASS14);
    mem.write32(0x8004de30, PRIM2);         // what [D0x8004DE10+0x158] answers
    mem.write32(PRIM1 + 0x138, PRIM_METHOD); // the primitive's own method slot
    // the shot's angles: `camMgr->[0x104]` zeroes them, and the orbit adds to +0x26
    mem.write16(LOSS_YAW_WORD, 0);
    // the pending-selector request F0x80016B88 writes: no run starts with one pending
    mem.write32(0x8004b3fc, 0);
    mem.write32(0x8004b404, 0);
}

/** The port's own host: the same calls, in the same order, as the stubs above. */
function portHost() {
    return {
        createTask(handler, size, extra, key) {
            LOG.push(["task", handler >>> 0, size | 0, extra | 0, key | 0]);
            return allocObject(handler, size, extra, key);
        },
        baseMethod28(obj, state) { S.tree.callMethod(obj, 0x28, [state]); },
        baseMethod2C(obj, state) {
            mem.write32(obj + 0x10, state | 0);
            mem.write32(obj + 0x14, 0);
            mem.write32(obj + 0x18, 0);
        },
        baseMethod38(obj) { S.tree.callMethod(obj, 0x38); },
        openMessageWindow(window, kind, payload) { LOG.push(["message", window >>> 0, kind | 0, payload >>> 0]); },
        frameDelta() { return CTL.delta; },
        playSound(id) { LOG.push(["sound", id >>> 0]); },
        // F0x8008C93C .L0x8008C988-.L0x8008CA44, in the original's own order: the
        // type-0x12 camera and its preset 0xB, the class-0x15 manager and its motion
        // 0x17, and the class-0x14 object's +0x188(0x10). The port builds none of that
        // picture — it records the calls, so the beat happens in the original's order.
        armDefeatEffect() {
            LOG.push(["classAlloc", 0x12]);
            LOG.push(["camPreset", 0, 0xb]);
            LOG.push(["classAlloc", 0x15]);
            LOG.push(["motion", 0x17, 0x1e, 0x1e]);
            LOG.push(["classAlloc", 0x14]);
            LOG.push(["cls14", 0x10]);
            return CAM;   // the effect keeps the camera at its +0x50
        },
        turnDefeatCamera() { LOG.push(["camTurn"]); },
        slowMotion(level) { LOG.push(["slowMo", level | 0]); },
        defeatChildTick() {},
        selectReward() { LOG.push(["rewardRand"]); LOG.push(["rewardOwner"]); LOG.push(["rewardRand"]); },
        writeOutcomeRecords() { for (const group of [0, 1, 2]) LOG.push(["outcomeRecord", group]); },
        clearViewColour() { lossClearViewColour(mem); },
        writeBack() { LOG.push(["writeBack"]); },
        launchScreen(code, a) {
            LOG.push(["launch", code >>> 0, a >>> 0]);
            mem.write32(0x8004b3fc, code >>> 0);
            mem.write32(0x8004b404, a >>> 0);
        },
        returnToField() {},
    };
}

// the exit's view-colour edge, wired to the two existing translations exactly as
// BattleLossSession does
const lossClearViewColour = (m) => {
    const view = findRegisteredHandleByKey(m, LOSS_VIEW_KEY);
    if (view === 0) return;
    setRectColour(m, view, 0, 0, 0);
};

/** The constant a `lui` + `addiu`/`ori` pair builds — the whole pair, never one
 *  instruction word: the high half and the sign-extended immediate field. */
function luiAddiu(addr) {
    const hi = (mem.read32(addr) & 0xffff) << 16;
    return (hi + ((mem.read32(addr + 4) << 16) >> 16)) >>> 0;
}

const words = (a, n, out = []) => {
    for (let i = 0; i < n; i += 4) out.push(mem.read32(a + i) >>> 0);
    return out;
};
/** Everything both sides must agree on after one frame. */
function snap(effect, fade) {
    const out = [];
    words(SCREEN, 0x60, out);
    words(BLOCK, 0x20, out);
    out.push(mem.read8(LOSS_RESULT_BYTE));
    words(LOSS_RESULT_RECORD, 0xc, out);
    if (effect !== 0) { words(effect, LOSS_EFFECT_SIZE, out); words(effect + 0x58, 4, out); }
    if (fade !== 0) words(fade, 0x68, out);
    out.push(mem.read32(VIEW + RECT_COLOUR.valid), mem.read32(VIEW + RECT_COLOUR.r));
    out.push(mem.read32(0x8004b3fc), mem.read32(0x8004b404));
    out.push(mem.read32(LOSS_YAW_WORD) & 0xffff);
    return out;
}

// ── tests ────────────────────────────────────────────────────────────────────

test("F0x8009C534(2) writes the result byte and the three-word record", () => {
    seed();
    LOG.length = 0;
    rt.cpu.call(LOSS_SET_RESULT, [2], 20000);
    assert.deepEqual(LOG, [], "the workspace walk F0x8009B9D0 is the boundary, not an event");
    const native = [mem.read8(LOSS_RESULT_BYTE), ...words(LOSS_RESULT_RECORD, 0xc)];
    seed();
    lossSetResult(mem, 2);
    assert.deepEqual([mem.read8(LOSS_RESULT_BYTE), ...words(LOSS_RESULT_RECORD, 0xc)], native);
    assert.deepEqual(native, [2, 1, 1, 0xffffffff], "result 2, record 1 / 1 / -1");
});

test("the loss branch: the jingle, message 0x53, the effect, and the panel it opens", () => {
    seed();
    LOG.length = 0;
    rt.cpu.call(LOSS_TICK, [SCREEN, BLOCK], 400000);
    const nativeLog = LOG.slice();
    const nativeScreen = words(SCREEN, 0x60);
    const nativeBlock = words(BLOCK, 0x20);
    const nativeByte = mem.read8(LOSS_RESULT_BYTE);
    assert.ok(nativeLog.some((e) => e[0] === "message"), "the shared tail opens the line");

    seed();
    const host = portHost();
    LOG.length = 0;
    // the window is built by the arm before the branch: the same two words, so the
    // controller block the branch leaves behind is the same on both sides
    lossBranch(mem, host, SCREEN, BLOCK, WINDOW);
    mem.write32(BLOCK + LOSS_SLOT_FADE, WINDOW);
    assert.deepEqual(LOG.slice(), nativeLog, "the branch's calls, in order");
    assert.deepEqual(words(SCREEN, 0x60), nativeScreen, "the screen object");
    assert.deepEqual(words(BLOCK, 0x20), nativeBlock, "the controller block");
    assert.equal(mem.read8(LOSS_RESULT_BYTE), nativeByte);
    // What the player is shown, read off the same words.
    assert.ok(nativeLog.some((e) => e[0] === "sound" && e[1] === LOSS_GAMEOVER_SOUND),
        `the GAMEOVER jingle 0x${LOSS_GAMEOVER_SOUND.toString(16)}`);
    assert.equal(mem.read32(SCREEN + LOSS_MESSAGE_WORD), LOSS_MESSAGE_ID, "esmfight 0x53");
    const opened = nativeLog.find((e) => e[0] === "message");
    assert.equal(opened[2], LOSS_MESSAGE_KIND, "the window's arm 1");
    assert.equal(opened[3], SCREEN + LOSS_MESSAGE_WORD, "the payload is the screen's own word");
    // `[screen+0x2C](screen, 2)` is F0x80014288: +0x10 = 2, and +0x14/+0x18 zeroed, which
    // is what puts the exit back in mode 0.
    assert.equal(mem.read32(SCREEN + 0x10) | 0, 2);
    assert.equal(mem.read32(SCREEN + LOSS_MODE) | 0, 0, "the exit's mode word is cleared");
    assert.equal(mem.read32(BLOCK + LOSS_SLOT_EFFECT) >>> 0, 0x80100000, "the effect is in +0x18");
});

test("the defeat effect: the shot on entry, phase 2 at 0xF0, and the orbit in both phases", () => {
    // One object, stepped 250 times, both sides: the entry arm's own calls, then one
    // counter and one turn per frame, then the phase-3 reset.
    const run = (original) => {
        seed();
        const effect = allocObject(LOSS_EFFECT_TICK, LOSS_EFFECT_SIZE, LOSS_EFFECT_EXTRA, 0);
        const extra = effect + 0x58;
        const out = [];
        for (let f = 0; f < 250; f++) {
            LOG.length = 0;
            if (original) rt.cpu.call(LOSS_EFFECT_TICK, [effect, extra], 200000);
            else lossEffectTick(mem, portHost(), effect, extra);
            out.push([LOG.slice(), mem.read32(effect + LOSS_STATE) | 0,
                mem.read32(effect + LOSS_EFFECT_COUNTER) | 0,
                mem.read32(LOSS_YAW_WORD) & 0xffff]);
        }
        return { out, effect };
    };
    const o = run(true);
    const p = run(false);
    for (let f = 0; f < o.out.length; f++) {
        assert.deepEqual(p.out[f][0], o.out[f][0], `frame ${f}: calls`);
        assert.deepEqual(p.out[f].slice(1), o.out[f].slice(1), `frame ${f}: state, counter, yaw`);
    }
    const frame0 = o.out[0][0];
    assert.deepEqual(frame0, [
        ["classAlloc", 0x12], ["camPreset", 0, 0xb], ["classAlloc", 0x15], ["motion", 0x17, 0x1e, 0x1e],
        ["classAlloc", 0x14], ["cls14", 0x10], ["slowMo", 2],
        ["task", LOSS_EFFECT_CHILD_TICK, LOSS_EFFECT_CHILD_SIZE, LOSS_EFFECT_CHILD_EXTRA, 0],
        ["camTurn"],
    ], "the entry arm's own order, with the camera preset, the motion and the slow motion");
    assert.equal(o.out[0][1], 1, "+0x38 raised the phase to 1");
    assert.equal(o.out[0][2], 1, "the entry frame counts too");
    // The phase-2 frame is the one whose counter reaches 0xF0 (slti $v1, $v1, 0xF0).
    const phase2 = o.out.findIndex((row) => row[1] === 2);
    assert.equal(phase2 + 1, LOSS_EFFECT_PHASE2_UNITS, "phase 2 on the 240th counted frame");
    assert.equal(o.out[phase2 - 1][2], LOSS_EFFECT_PHASE2_UNITS - 1, "the counter reached 0xF0");
    // Phase 2 stops counting and keeps turning. The counter reads 0 there and not 240
    // because the counter IS the object's second state word (+0x10), and the phase-2 raise
    // goes through +0x28 (F0x80014274), which zeroes every state below the one it sets.
    const last = o.out[o.out.length - 1];
    assert.equal(last[2], 0, "phase 2 raised state 0, which cleared the counter word");
    assert.equal(last[3], (2 * o.out.length) & 0xffff, "and the yaw is still 2 a frame");
    // Phase 3 (the mode-1 arm's `effect->+0x28(effect, 3)`) is the slow motion going back.
    seed();
    const effect = allocObject(LOSS_EFFECT_TICK, LOSS_EFFECT_SIZE, LOSS_EFFECT_EXTRA, 0);
    mem.write32(effect + LOSS_STATE, 3);
    LOG.length = 0;
    rt.cpu.call(LOSS_EFFECT_TICK, [effect, effect + 0x58], 200000);
    const phase3 = LOG.slice();
    seed();
    const effect2 = allocObject(LOSS_EFFECT_TICK, LOSS_EFFECT_SIZE, LOSS_EFFECT_EXTRA, 0);
    mem.write32(effect2 + LOSS_STATE, 3);
    LOG.length = 0;
    lossEffectTick(mem, portHost(), effect2, effect2 + 0x58);
    assert.deepEqual(LOG, phase3);
    assert.deepEqual(phase3, [["slowMo", 0]], "phase 3 lowers the slow-motion level, nothing else");
});

test("the fade: 0xFF00 in ten steps, the grey it is drawn with, and the level held", () => {
    const run = (original) => {
        seed();
        const out = [];
        let fade = 0;
        if (original) {
            fade = rt.cpu.call(LOSS_FADE_CREATE, [], 20000) >>> 0;
            mem.write32(fade + 0x64, FIGHTSTG_FADE_ARM);   // the class's arming method
            rt.cpu.call(FIGHTSTG_FADE_ARM, [fade, 0, 10], 20000);
        } else {
            fade = lossFadeCreate(mem, portHost());
            lossFadeArm(mem, portHost(), fade, 0, 10);
        }
        for (let f = 0; f < 13; f++) {
            LOG.length = 0;
            if (original) rt.cpu.call(mem.read32(fade + 0x48), [fade], 400000);
            else lossFadeTick(mem, fade);
            out.push([mem.read32(fade + LOSS_STATE) | 0, lossFadeLevel(mem, fade),
                // F0x8008A8C4 writes the quad into the draw target it fetches at
                // .L0x8008A908 (D0x8004DE10+0x158) and leaves the new one behind at
                // D0x8004DE30, so the grey is the colour byte of whatever target is
                // current: `sra $a0, 0x8` lands at +4/+5/+6.
                // ... and leaves the NEXT target behind at D0x8004DE30, so this frame's
                // quad is the one 0x20 below the target it just published.
                original ? mem.read8(mem.read32(0x8004de30) - 0x20 + 6) : lossFadeGrey(mem, fade),
                mem.read32(fade + LOSS_FADE_STEP) | 0, mem.read32(fade + LOSS_FADE_RAMP) | 0]);
        }
        return { out, fade };
    };
    const o = run(true);
    const p = run(false);
    assert.equal(o.fade, p.fade, "the fade object's address");
    for (let f = 0; f < o.out.length; f++) {
        assert.deepEqual(p.out[f], o.out[f], `frame ${f}: state, level, grey, step, ramp`);
    }
    // F0x8008A83C put the object in state 1 with the ramp armed, level 0 and step
    // 0xFF00/10 = 6528, so EVERY tick from here on is a ramp tick: one step and one draw.
    const step = 0xff00 / 10;
    assert.deepEqual(o.out[0], [1, step, step >> 8, step, 1], "the first tick after the arming");
    assert.deepEqual(o.out.map((r) => r[1]), [step, 2 * step, 3 * step, 4 * step, 5 * step,
        6 * step, 7 * step, 8 * step, 9 * step, 0xff00, 0xff00, 0xff00, 0xff00]);
    // F0x8008A96C: the grey each channel carries is the level's high byte, truncated — so
    // the first tenth of the fade is 25, not 26.
    assert.deepEqual(o.out.map((r) => r[2]), [25, 51, 76, 102, 127, 153, 178, 204, 229, 255, 255, 255, 255]);
    // `slt $v0, 0xFF00, level` is strict, so the tenth tick lands the level ON 0xFF00 and
    // only the eleventh passes it: state 2 is raised one tick after the level is full.
    assert.equal(o.out[9][1], 0xff00, "the level is full on the tenth tick");
    assert.equal(o.out[9][0], 1, "and the object is still ramping");
    assert.equal(o.out[10][0], 2, "state 2 on the tick that passes 0xFF00");
    assert.deepEqual(o.out.slice(10).map((r) => r[0]), [2, 2, 2], "and it is held there");
});

test("the fade-out arm: the level ramps down to zero and lands on state 2 as the original does", () => {
    // F0x8008A83C(fade, 1, 10): the same arming call with a non-zero direction. The
    // tick's level store is the DIRECTION TEST's own delay slot (`.L0x8008AA68 sw $v0,
    // 0x5c($a1)`), so the fade-out arm writes the ramping level too — the arm the port
    // used to hold at 0xFF00 — and `bgez $v0, .L0x8008AA94` keeps the state at 1 while
    // the sum is still >= 0: the tick that lands ON zero keeps ramping, and the first
    // tick that would pass it stores 0 and raises state 2 (`.L0x8008AA8C sw $zr`).
    const run = (original) => {
        seed();
        const out = [];
        let fade = 0;
        if (original) {
            fade = rt.cpu.call(LOSS_FADE_CREATE, [], 20000) >>> 0;
            mem.write32(fade + 0x64, FIGHTSTG_FADE_ARM);   // the class's arming method
            rt.cpu.call(FIGHTSTG_FADE_ARM, [fade, 1, 10], 20000);
        } else {
            fade = lossFadeCreate(mem, portHost());
            lossFadeArm(mem, portHost(), fade, 1, 10);
        }
        for (let f = 0; f < 14; f++) {
            LOG.length = 0;
            if (original) rt.cpu.call(mem.read32(fade + 0x48), [fade], 400000);
            else lossFadeTick(mem, fade);
            out.push([mem.read32(fade + LOSS_STATE) | 0, lossFadeLevel(mem, fade),
                original ? mem.read8(mem.read32(0x8004de30) - 0x20 + 6) : lossFadeGrey(mem, fade),
                mem.read32(fade + LOSS_FADE_STEP) | 0, mem.read32(fade + LOSS_FADE_RAMP) | 0,
                mem.read32(fade + LOSS_FADE_DIRECTION) | 0]);
        }
        return { out, fade };
    };
    const o = run(true);
    const p = run(false);
    assert.equal(o.fade, p.fade, "the fade object's address");
    for (let f = 0; f < o.out.length; f++) {
        assert.deepEqual(p.out[f], o.out[f], `frame ${f}: state, level, grey, step, ramp, direction`);
    }
    // The arming call starts the level at 0xFF00 with step -0xFF00/10 and every tick
    // subtracts it. The tenth tick lands the level exactly ON zero and the object is
    // still ramping there; the eleventh is the first sum that would pass zero, so that
    // is where the level is pinned to 0 and state 2 arrives.
    const step = 0xff00 / 10;
    assert.deepEqual(o.out[0], [1, 0xff00 - step, (0xff00 - step) >> 8, -step, 1, 1],
        "the first tick after the arming call");
    assert.deepEqual(o.out.map((r) => r[1]), [0xff00 - step, 0xff00 - 2 * step, 0xff00 - 3 * step,
        0xff00 - 4 * step, 0xff00 - 5 * step, 0xff00 - 6 * step, 0xff00 - 7 * step,
        0xff00 - 8 * step, 0xff00 - 9 * step, 0, 0, 0, 0, 0],
        "the level, tenth by tenth, down to zero and held");
    assert.deepEqual(o.out.map((r) => r[0]), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2],
        "state 2 on the tick whose sum would pass zero, not on the one that lands on it");
    // The grey the quad is drawn with, the level's high byte: the same readout the
    // fade-in test uses, from the draw the fade-out arm still makes every tick.
    assert.deepEqual(o.out.map((r) => r[2]),
        [229, 204, 178, 153, 127, 102, 76, 51, 25, 0, 0, 0, 0, 0]);
});

test("the whole loss, frame by frame: the same calls, the same words, the same launch frame", () => {
    // 260 frames: the exit builds the fade on frame 240, the ramp is full on 250, and the
    // title is asked for on 252. Both sides run the SAME memory and the SAME object
    // factory, so every word is compared directly.
    const FRAMES = 260;
    const run = (original) => {
        seed();
        const host = portHost();
        let effect = 0;
        let fade = 0;
        const exit = () => ({
            block: BLOCK,
            mode: SCREEN + LOSS_MODE,
            createFade: () => {
                fade = original ? (rt.cpu.call(LOSS_FADE_CREATE, [], 20000) >>> 0)
                    : lossFadeCreate(mem, host);
                return fade;
            },
        });
        if (original) rt.cpu.call(LOSS_TICK, [SCREEN, BLOCK], 400000);
        else { mem.write32(BLOCK + LOSS_SLOT_FADE, WINDOW); lossBranch(mem, host, SCREEN, BLOCK, WINDOW); }
        effect = mem.read32(BLOCK + LOSS_SLOT_EFFECT) >>> 0;
        const out = [];
        let launched = -1;
        for (let f = 0; f < FRAMES; f++) {
            LOG.length = 0;
            if (original) {
                rt.cpu.call(LOSS_EXIT, [SCREEN, BLOCK], 400000);
            } else {
                lossExitTick(mem, host, exit());
            }
            // The exit stores the fade it has just built at block+0x1C itself (the
            // original's `sw $a0, 0x1c($s5)`), so the slot is where the frame's new object
            // is found — before the two objects the block names take their turn.
            if (fade === 0) {
                const slot = mem.read32(BLOCK + LOSS_SLOT_FADE) >>> 0;
                if (slot !== 0 && slot !== WINDOW) fade = slot;
            }
            if (effect !== 0) {
                if (original) {
                    rt.cpu.call(mem.read32(effect + 0x48), [effect, mem.read32(effect + 0x24)], 400000);
                    // The resident stepper retires an object whose state reads 3 at the top
                    // of its turn (F0x80018140), and the child walk writes each child's
                    // return value back over its slot (F0x80018230). The port gets both
                    // from TranslatedTaskTree; the original's side is modelled here, since
                    // this harness IS its framework.
                    if (mem.read32(effect + LOSS_STATE) === 3) {
                        const slot = mem.read32(effect + 0x24);
                        mem.write32(slot, 0);
                        effect = 0;
                    }
                } else {
                    S.tree.tick(effect);
                    // The tree retires the object the same frame (the state-3 arm runs
                    // once, then the walk writes 0 back over the slot), so this side has
                    // to drop it exactly where the original's harness does.
                    if (!S.tree.tasks.has(effect)) effect = 0;
                }
            }
            if (fade !== 0) {
                if (original) rt.cpu.call(mem.read32(fade + 0x48), [fade], 400000);
                else S.tree.tick(fade);
            }
            if (launched < 0 && LOG.some((e) => e[0] === "launch")) launched = f;
            out.push([LOG.slice(), snap(effect, fade), lossFadeLevel(mem, fade), lossFadeGrey(mem, fade)]);
        }
        return { out, launched, effect, fade };
    };
    const o = run(true);
    const p = run(false);
    assert.equal(p.launched, o.launched, "the frame the title screen is asked for");
    assert.equal(o.launched, 252, "F0x800A7C00's mode-2 arm, 252 frames after the branch");
    assert.equal(p.fade, o.fade, "the fade object's address");
    for (let f = 0; f < o.out.length; f++) {
        const d = p.out[f][1].findIndex((v, i) => v !== o.out[f][1][i]);
        assert.deepEqual(p.out[f][0], o.out[f][0], `frame ${f}: calls`);
        assert.deepEqual(p.out[f][1], o.out[f][1],
            `frame ${f}: memory word ${d} (${p.out[f][1][d]} vs ${o.out[f][1][d]})`);
        assert.deepEqual(p.out[f].slice(2), o.out[f].slice(2), `frame ${f}: fade level and grey`);
    }
    // The beat the player watches, frame by frame. SNAP_FADE is where the fade object's
    // own task state sits in a snapshot once the fade exists; the effect's 21 words and
    // its extra pointer sit in front of it until the effect is retired, so SNAP_GONE is
    // the same word on the frames after that.
    const SNAP_HEAD = 24 + 8 + 1 + 3;
    const SNAP_FADE = SNAP_HEAD + (LOSS_EFFECT_SIZE / 4) + 1 + LOSS_STATE / 4;
    const SNAP_GONE = SNAP_HEAD + LOSS_STATE / 4;
    assert.equal(o.out[0][2], 0, "no fade while the effect counts");
    assert.equal(o.out[239][2], 0, "still none on the frame before phase 2");
    assert.ok(o.out[240][0].some((e) => e[0] === "outcomeRecord"), "the exit's group records");
    // The exit built the fade and armed it on frame 240, so the fade's own turn in that
    // same frame is already its first ramp tick.
    assert.equal(o.out[240][2], 6528, "the first tenth of the fade");
    assert.deepEqual(o.out.slice(240, 250).map((r) => r[3]), [25, 51, 76, 102, 127, 153, 178, 204, 229, 255],
        "the grey the quad is drawn with, tenth by tenth");
    assert.equal(o.out[249][2], 0xff00, "the level is full");
    assert.deepEqual(o.out.slice(240, 250).map((r) => r[1][SNAP_FADE]), new Array(10).fill(1),
        "the fade ramps for ten ticks");
    assert.equal(o.out[250][1][SNAP_FADE], 2, "and raises its state on the tick that passes 0xFF00");
    assert.equal(o.out[251][1][SNAP_HEAD], 0, "the retired effect drops out of the controller's slots");
    // Mode 1 turns the view's rectangle colour off and raises the effect's phase 3; the
    // effect's own turn in that same frame is the slow-motion level going back to normal,
    // which the resident stepper runs before it retires a state-3 object.
    assert.deepEqual(o.out[251][0], [["slowMo", 0]],
        "mode 1: the effect to phase 3, and phase 3 lowers the slow motion in the same frame");
    assert.deepEqual(o.out[251][1][SNAP_GONE], 2, "the fade is still full and held");
    assert.deepEqual(o.out[252][0], [["writeBack"], ["launch", LOSS_LAUNCH_TITLE, 0]],
        "the mode-2 arm: the write-back, then the launch");
    // And the pending selector's two words are the request F0x80016B88 stores.
    assert.equal(mem.read32(0x8004b3fc), LOSS_LAUNCH_TITLE);
    assert.equal(mem.read32(0x8004b404), 0);
});

test("the view's rectangle colour is turned off before the launch", () => {
    seed();
    const host = portHost();
    // Straight to mode 1 with a finished fade, as the exit's own arm finds it.
    mem.write32(SCREEN + LOSS_MODE, 1);
    mem.write32(BLOCK + LOSS_SLOT_FADE, allocObject(LOSS_FADE_TICK, 0x68, 0, 0));
    const fade = mem.read32(BLOCK + LOSS_SLOT_FADE) >>> 0;
    mem.write32(fade + LOSS_STATE, 2);
    mem.write32(BLOCK + LOSS_SLOT_EFFECT, allocObject(LOSS_EFFECT_TICK, LOSS_EFFECT_SIZE, LOSS_EFFECT_EXTRA, 0));
    const before = [mem.read8(VIEW + RECT_COLOUR.r), mem.read8(VIEW + RECT_COLOUR.g),
        mem.read8(VIEW + RECT_COLOUR.b), mem.read8(VIEW + RECT_COLOUR.valid)];
    assert.deepEqual(before, [0, 0, 0, 0], "seeded cleared");
    mem.write8(VIEW + RECT_COLOUR.r, 0x1f);
    mem.write8(VIEW + RECT_COLOUR.g, 0x1f);
    mem.write8(VIEW + RECT_COLOUR.b, 0x1f);
    mem.write8(VIEW + RECT_COLOUR.valid, 1);
    LOG.length = 0;
    rt.cpu.call(LOSS_EXIT, [SCREEN, BLOCK], 400000);
    const native = [mem.read8(VIEW + RECT_COLOUR.r), mem.read8(VIEW + RECT_COLOUR.g),
        mem.read8(VIEW + RECT_COLOUR.b), mem.read8(VIEW + RECT_COLOUR.valid)];
    assert.equal(mem.read32(SCREEN + LOSS_MODE), 2, "the arm advances the mode word");
    seed();
    const host2 = portHost();
    mem.write32(SCREEN + LOSS_MODE, 1);
    mem.write32(BLOCK + LOSS_SLOT_FADE, allocObject(LOSS_FADE_TICK, 0x68, 0, 0));
    const fade2 = mem.read32(BLOCK + LOSS_SLOT_FADE) >>> 0;
    mem.write32(fade2 + LOSS_STATE, 2);
    mem.write32(BLOCK + LOSS_SLOT_EFFECT, allocObject(LOSS_EFFECT_TICK, LOSS_EFFECT_SIZE, LOSS_EFFECT_EXTRA, 0));
    mem.write8(VIEW + RECT_COLOUR.r, 0x1f);
    mem.write8(VIEW + RECT_COLOUR.g, 0x1f);
    mem.write8(VIEW + RECT_COLOUR.b, 0x1f);
    mem.write8(VIEW + RECT_COLOUR.valid, 1);
    assert.equal(lossExitTick(mem, host2, { block: BLOCK, mode: SCREEN + LOSS_MODE, createFade: () => 0 }), 0);
    assert.deepEqual([mem.read8(VIEW + RECT_COLOUR.r), mem.read8(VIEW + RECT_COLOUR.g),
        mem.read8(VIEW + RECT_COLOUR.b), mem.read8(VIEW + RECT_COLOUR.valid)], native,
        "[0x8004DF8C](0x1000)->+0x12C(0, 0, 0) turns the view's rectangle colour off");
    assert.deepEqual(native, [0, 0, 0, 0]);
    assert.ok(host && host2, "both hosts were built");
});

test("the shipped overlays carry the tables and routine bodies this port reads", () => {
    assert.equal(mem.read32(0x800a5e3c + 4) >>> 0, 0x800a9110,
        "the mode jump table's arm 1 is the outcome arm (pro/wfightmn.s .L0x00001E1C)");
    // F0x8008C93C's phase-2 test is `slti $v1, $v1, 0xF0` — the counter on both sides,
    // not the frame delta the disassembler's text suggests.
    assert.equal(mem.read32(0x8008cab0) >>> 0, 0x286300f0);
    // F0x8008AAAC installs its arming method at the fade's +0x64:
    // `lui 0x8009 / addiu -0x57C4` = 0x8008A83C, which is the F0x8008A83C the exit calls.
    assert.equal(luiAddiu(0x8008aac8), FIGHTSTG_FADE_ARM);
    // F0x8008CB44's descriptor: `lui 0x8009 / addiu -0x36C4` = the effect's own tick.
    assert.equal(luiAddiu(0x8008cb48), LOSS_EFFECT_TICK);
    // F0x8008C910's child descriptor, and the loss branch's jingle and message id.
    assert.equal(luiAddiu(0x8008c914), LOSS_EFFECT_CHILD_TICK);
    // The branch's jingle is a lui/ori pair split across a call: `lui $a0, 0x6004`
    // (0x800A9238) and `ori $a0, 0x8` in the jalr delay slot (0x800A924C) — 0x60040008
    // whole, never 0x8 or 0x4008 on its own.
    assert.equal(mem.read32(0x800a9238) >>> 0, 0x3c046004, "`lui $a0, 0x6004`");
    assert.equal(mem.read32(0x800a924c) >>> 0, 0x34840008, "`ori $a0, 0x8`, in the delay slot");
    assert.equal(((mem.read32(0x800a9238) & 0xffff) << 16) | (mem.read32(0x800a924c) & 0xffff),
        LOSS_GAMEOVER_SOUND, "the pair is the GAMEOVER jingle");
    // `li $v0, 0x53` sits in the delay slot of the screen's own +0x2C call, and the
    // store of that word is in the same slot one instruction earlier.
    assert.equal(mem.read32(0x800a925c) >>> 0, 0x24020053, "`li $v0, 0x53` in the delay slot");
    assert.equal(mem.read32(0x800a9264) >>> 0, 0xae420050, "`sw $v0, 0x50($s2)`, the screen's message word");
});

test("the walker's old hand-written fade is not this fade, tenth by tenth", () => {
    // The rollback the port replaced (?legacyLoss=1) computed the beat as a formula:
    // lossExitFrame(frames) returns fade = (floor(f - 0xF0) + 1) / 10, and the canvas
    // drew it as Math.round(fade * 255). The original draws the fade's quad with the
    // level's HIGH BYTE (F0x8008a96c `sra $a0, 0x8`), so its greys are 25, 51, 76 ...
    // where the formula's are 26, 51, 77 ...: five of the ten ticks are wrong, and the
    // formula has no exit object, no mode word, no result byte and no message-window
    // call at all. This test is the "before" half of the port's proof -- it fails if the
    // rollback is ever mistaken for the original's numbers.
    const legacyGreys = [];
    for (let f = 240; f < 250; f++) {
        legacyGreys.push(Math.round(lossExitFrame(f).fade * 255));
    }
    assert.deepEqual(legacyGreys, [26, 51, 77, 102, 128, 153, 179, 204, 230, 255],
        "what ?legacyLoss=1 draws");
    const frameClockFed = [];
    const session = new BattleLossSession(
        { playSound: () => {}, armDefeatEffect: () => {}, turnDefeatCamera: () => {}, slowMotion: () => {} },
        { onLaunch: () => {} });
    const before = frameClock.frameDelta();
    session.begin();
    for (let f = 0; f < 260; f++) {
        frameClock.feedFrame(1);
        session.tick();
        frameClockFed.push(session.fadeGrey());
    }
    frameClock.feedFrame(before);
    assert.deepEqual(frameClockFed.slice(240, 250), [25, 51, 76, 102, 127, 153, 178, 204, 229, 255],
        "what the ported session draws, read off the fade object's own level");
    const differing = legacyGreys.map((g, i) => (g === frameClockFed[240 + i] ? null : 240 + i)).filter((f) => f !== null);
    assert.deepEqual(differing, [240, 242, 244, 246, 248], "the five ticks the port fixes");
});

test("the session the game runs reproduces the original's frames", () => {
    // The shipped session owns its own memory, so it is checked against the numbers the
    // oracle just proved against the originals: the fade level and grey per frame, the
    // frame the title is asked for, and the panel call the branch made.
    const session = new BattleLossSession(
        { playSound: () => {}, armDefeatEffect: () => {}, turnDefeatCamera: () => {}, slowMotion: () => {} },
        { onLaunch: () => {} });
    const before = frameClock.frameDelta();
    session.begin();
    const levels = [];
    const greys = [];
    let launched = -1;
    for (let f = 0; f < 260; f++) {
        // One displayed frame at the delta the oracle stubbed ([0x8004DF9C]() == 1),
        // published through the SHARED clock the session reads. The game feeds this
        // clock from MenuDisplayClock (engine/dw3/ui/pad-words.ts:38), so the session
        // never keeps a counter of its own.
        frameClock.feedFrame(1);
        session.tick();
        levels.push(session.fadeLevel());
        greys.push(session.fadeGrey());
        if (launched < 0 && session.finished()) launched = f;
        assert.equal(session.state().mode, f < 240 ? 0 : f < 251 ? 1 : 2, `frame ${f}: the exit's mode`);
    }
    frameClock.feedFrame(before);
    assert.equal(session.result, 2, "the result byte the branch set");
    assert.equal(session.launchCode(), LOSS_LAUNCH_TITLE);
    assert.equal(launched, 252, "the same frame the original asks for the title");
    assert.deepEqual(greys.slice(240, 250), [25, 51, 76, 102, 127, 153, 178, 204, 229, 255],
        "the same grey per tick, from the frame the exit builds the fade on");
    assert.equal(levels[250], 0xff00, "the same held level");
    assert.equal(levels[0], 0, "no fade while the effect counts");
    assert.equal(session.messages.length, 1, "one line, opened on the branch's own call");
    assert.equal(session.messages[0][0], LOSS_MESSAGE_KIND, "the window's arm 1");
    assert.equal(session.mem.read32(session.messages[0][1]), LOSS_MESSAGE_ID,
        "the payload word the branch wrote, read back out of the session's own memory");
    assert.equal(session.messageId, LOSS_MESSAGE_ID);
    assert.equal(session.jingle, LOSS_GAMEOVER_SOUND);
    assert.equal(session.fadeTicks, 10);
});
