// Lane B oracle: engine/dw3/ui/native/end-card.ts must match the title overlay's
// END card — F0x80082E9C (create the screen root), F0x80082D70 (the root's own
// frame callback: the whole display setup), F0x8008483C (create the sequence
// object), F0x80084628 (the six-state sequence) and F0x8008453C (the draw).
// The originals run through engine/native on resident.bin + pro_stdwtitl.bin
// (overlay load base 0x80082CB0).
//
// The shared resident services are the EXISTING translated ones on both sides:
// the task factory and its four state methods go to TranslatedTaskTree, and the
// display setup goes to the translated resetDisplayService / setDisplayPacketIndex
// / setDisplayRegion / registerDisplayView / setRectColour, so the display service
// object and the registered view are compared field by field after real code ran
// on both sides. Only the device edges are stubbed (the heap allocators, the
// ordering-table clear, GsInit3D, setGeomOffset), exactly as
// tests/card-battle-scene-oracle.test.js does.
//
// What a player sees and what each divergence in the port closes:
//   the card fades up from nothing to bright green, holds, waits for the player,
//   fades back to nothing, holds, and asks for the opening movie; all sound
//   stops the moment the card appears; holding Start ends the wait, because the
//   original samples the pad every frame; the fade steps once per callback, so a
//   frame delta above two must not over-advance the card.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { TranslatedTaskTree } from "../../engine/dw3/ui/translated-task-tree.ts";
import { BASE_TABLE } from "../../engine/dw3/ui/create-text-element.ts";
import { ShopDrawIntents } from "../../engine/dw3/ui/shop-draw-intents.ts";
import {
    DISPLAY_ALLOC_ZEROED, DISPLAY_HEAP_ALLOC, DISPLAY_SERVICE, DISPLAY_SERVICE_FIELDS,
    DISPLAY_SERVICE_INIT_FLAG, VIEW_POOL_TABLE,
} from "../../engine/dw3/display-service.ts";
import {
    END_CARD_CLIP_BY_LANGUAGE, END_CARD_CREATE, END_CARD_DRAW, END_CARD_FADE_TICKS,
    END_CARD_HOLD_AFTER_FADE_IN, END_CARD_HOLD_AFTER_FADE_OUT, END_CARD_LANGUAGE,
    END_CARD_LEVEL, END_CARD_LEVEL_MAX, END_CARD_ROOT_EXTRA, END_CARD_ROOT_SIZE, END_CARD_ROOT_TICK,
    END_CARD_SEQUENCE_CREATE, END_CARD_SEQUENCE_SIZE, END_CARD_SEQUENCE_TICK, END_CARD_SKIP_BUTTON,
    END_CARD_STATE, END_CARD_SUB, END_CARD_TIMER, END_CARD_WAIT_FOR_PLAYER,
    endCardClipForLanguage, endCardCreate, endCardDraw, endCardRootTick, endCardSequenceCreate, endCardTick,
} from "../../engine/dw3/ui/native/end-card.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(root, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(root, "pro_stdwtitl.bin")));
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const OVERLAY_BASE = 0x80082cb0;

// ── boundary stubs, shared by both sides ────────────────────────────────────
// F0x800143DC: the base task object factory. The card's two creators call
// F0x80014504, whose own body (resident.bin) loads $a3 with zero in the `jal`
// delay slot, so the wrapper runs as shipped and the key both objects register
// with is proved to be 0 rather than assumed. The runtime's core stub on that
// wrapper comes off first so the shipped four instructions execute.
const ALLOC_WRAPPER = 0x80014504;
const ALLOC = 0x800143dc;
const RESOLVE_CELL = 0x80044f5c;          // [0x80044F5C](handle): the pack resolver
const LAUNCHER_CELL = 0x8004b440;         // [0x8004B440](code, 0)
const DELTA_CELL = 0x8004df9c;            // [0x8004DF9C](): the frame delta
const PAD_SERVICE = 0x8004b7d0;           // +0x3F4 the port word, +0x408 the button's bit
const STOP_SOUND_CELL = 0x80055c64;       // D0x80055C64 = F0x80020204
const TEXT_CTX_CTOR = 0x8001ffa8;         // F0x8001FFA8, the multi-line layout context
const DRAW_CTX_CTOR = 0x8001f648;         // F0x8001F648, the 2-D draw context
const HEAP_ALLOC_HIGH = DISPLAY_HEAP_ALLOC + 4;
const CLEAR_OT = 0x80025d54;              // F0x80025D54, the ordering-table clear
const GS_INIT = 0x8002990c;               // F0x8002990C GsInit3D
const SET_GEOM = 0x8002b3ec;              // F0x8002B3EC setGeomOffset
const RELEASE_CELL = DISPLAY_SERVICE + DISPLAY_SERVICE_FIELDS.releaseMethod;
const TASK_METHODS = { 0x28: [0x80014274, 1], 0x2c: [0x80014288, 1], 0x38: [0x800142ac, 0], 0x3c: [0x800142c8, 0] };

// host stubs
const STUB = 0x0fe60000;
const S_CTX_PUBLISH = STUB + 0x00;
const S_CTX_PAIR = STUB + 0x04;
const S_CTX_LAYOUT = STUB + 0x08;
const S_DRAW_LAYER = STUB + 0x0c;
const S_DRAW_ORIGIN = STUB + 0x10;
const S_DRAW_PALETTE = STUB + 0x14;
const S_DRAW_SPRITE = STUB + 0x18;
const S_PAD_READ = STUB + 0x1c;
const S_PAD_BIT = STUB + 0x20;
const S_DELTA = STUB + 0x24;
const S_STOP = STUB + 0x28;
const S_LAUNCH = STUB + 0x2c;
const S_RESOLVE = STUB + 0x30;
const S_HEAP = STUB + 0x34;
const S_HEAP_HIGH = STUB + 0x38;
const S_HEAP_ZERO = STUB + 0x3c;
const S_RELEASE = STUB + 0x40;

// caller-owned scratch: the layout context, the DRAWENV, the pack and the arena.
const CTX = 0x80190000;
const ENV = 0x80190040;
const PACK = 0x80190100;
const ARENA = 0x801a0000;
const ARENA_END = 0x801f0000;
const ORIG_STACK = 0x801ff000;            // the frames the calls build below
// F0x80082D70 keeps its own layout context in its own frame (`addiu $sp, -0x58`,
// context at `sp+0x10`, so sp-0x48), which with the CPU's stack at 0x801ffcf0 is
// this address. Its words are compared on the frame the root builds them; after
// that the original's draw frame (sp-0xD0, 0xA0 bytes) reuses the same stack
// bytes, so there is nothing lasting left there to compare.
const ORIG_CTX = 0x801ffca8;

const OT_POOL_SIZES = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096];

const LOG = [];
const CTL = {};
let S = null; // the fresh translated services of one run

const arg = (c, i) => c.reg(4 + i) | 0;
const reg = (c, i) => c.reg(4 + i) >>> 0;

const rt = new NativeStageRuntime(overlay, entry,
    { setFlag() {}, getFlag: () => 0, rand16: () => 1 },
    undefined, undefined, OVERLAY_BASE, { image: resident, base: 0x80010000 });
const mem = rt.mem;
rt.cpu.gp = 0x8005cb50;
rt.cpu.clearStub(ALLOC_WRAPPER);
// The overlay's own jump-table targets inside the card's callbacks: the card must
// run as shipped, so no auto-stub inside the card's own range.
for (const a of rt.cpu.stubAddresses()) if (a >= 0x80084628 && a < 0x8008483c) rt.cpu.clearStub(a);

function bump(size, zeroed) {
    const n = Math.max(4, (size >>> 0) + 3 & ~3);
    const p = CTL.arena;
    CTL.arena += n;
    assert.ok(CTL.arena < ARENA_END, "the scenario arena ran out");
    if (zeroed) for (let a = p; a < p + n; a += 4) mem.write32(a, 0);
    return p;
}

const hostImpl = {
    callMethod(target, slot, args) {
        target >>>= 0;
        LOG.push(["method", target, slot, ...args.map((a) => a | 0)]);
        if (S.tree.tasks.has(target)) { S.tree.callMethod(target, slot, args); return 0; }
        throw new Error(`untranslated method ${slot.toString(16)}`);
    },
    createTask(handler, size, extra, key) {
        LOG.push(["task", handler >>> 0, size | 0, extra | 0, key | 0]);
        const obj = S.tree.allocate(handler >>> 0, size, extra);
        // F0x800143DC: the base state-method table, the handler, the scheduler key.
        for (const [off, value] of BASE_TABLE) if (off !== 0x48) mem.write32(obj + off, value);
        mem.write32(obj, key);
        return obj;
    },
    layoutBuffer: () => CTX,
    drawEnvScratch: () => ENV,
    layoutContext(ctx, pairX, pairY) {
        LOG.push(["ctxInit"]);
        // F0x8001FFA8's default volume word +0x18, and its own +0x1C slot
        // publishing itself as the active instance; publishing changes nothing
        // the card can see, so only the default is kept.
        mem.write32((ctx >>> 0) + 0x18, 0xa800);
        hostImpl.callSlot(ctx, 0x24, [pairX, pairY]);
    },
    // The context is caller-owned scratch: the original builds it in its own
    // stack frame and the port in its own buffer, so its address cannot match by
    // construction and the log names the slot instead.
    callSlot(ctx, slot, args) {
        LOG.push(["ctxSlot", slot, ...args.map((a) => a | 0)]);
        if (slot === 0x24) { mem.write32((ctx >>> 0) + 0x08, args[0] | 0); mem.write32((ctx >>> 0) + 0x0c, args[1] | 0); }
    },
    layoutPackTexture(ctx, pack) {
        LOG.push(["ctxLayout", pack >>> 0]);
        mem.write32((ctx >>> 0), pack >>> 0);
    },
    resolvePack(handle) {
        LOG.push(["resolvePack", handle >>> 0]);
        return PACK;
    },
    drawInit: () => { LOG.push(["drawInit"]); S.draw.initDrawContext(); return CTX + 0x80; },
    drawCall(_ctx, slot, args) {
        // the sprite draw's first argument is a pack pointer, so it is logged
        // unsigned on both sides
        LOG.push(["drawSlot", slot, ...args.map((a) => a >>> 0)]);
        S.draw.callSlot(slot, args, "END card");
    },
    frameDelta() { LOG.push(["delta"]); return CTL.delta; },
    padRead() { LOG.push(["padRead"]); return CTL.pad >>> 0; },
    padBit(port, code) { LOG.push(["padBit", port | 0, code | 0]); return code | 0; },
    stopAllSound() { LOG.push(["stopAllSound"]); },
    launchScreen(code, a) { LOG.push(["launch", code >>> 0, a | 0]); },
    // display-service edges: the port supplies these as host callbacks and the
    // original's resident service reaches them through its own cells, so both
    // sides log the same edges in the same order.
    releaseView(handle) {
        LOG.push(["releaseView", handle >>> 0]);
        for (let i = 0; i < DISPLAY_SERVICE_FIELDS.viewCount; i++) {
            const slot = DISPLAY_SERVICE + i * 4;
            if ((mem.read32(slot + DISPLAY_SERVICE_FIELDS.viewBase) | 0) === 0) continue;
            if ((mem.read32(slot + DISPLAY_SERVICE_FIELDS.viewHandle) >>> 0) !== (handle >>> 0)) continue;
            mem.write32(slot + DISPLAY_SERVICE_FIELDS.viewBase, 0);
            mem.write32(slot + DISPLAY_SERVICE_FIELDS.viewHandle, 0);
            return;
        }
    },
    alloc: (size, tag) => { LOG.push(["alloc", size >>> 0, tag | 0]); return bump(size, false); },
    allocZeroed: (size, tag) => { LOG.push(["allocZeroed", size >>> 0, tag | 0]); return bump(size, true); },
    clearOTag(base, entries) {
        LOG.push(["clearOTag", base >>> 0, entries | 0]);
        for (let i = 0; i < (entries | 0); i++) mem.write32((base >>> 0) + i * 4, 0x00ffffff);
    },
    gsInit3D: () => { LOG.push(["gsInit3D"]); },
    setGeomOffset: (x, y) => { LOG.push(["setGeomOffset", x | 0, y | 0]); },
};

// ── the original's side of every stub ────────────────────────────────────────
const st = (a, f) => rt.cpu.setStub(a, f);
st(ALLOC, (c) => hostImpl.createTask(reg(c, 0), arg(c, 1), arg(c, 2), arg(c, 3)));
for (const [slot, [addr, n]] of Object.entries(TASK_METHODS)) {
    st(addr, (c) => hostImpl.callMethod(reg(c, 0), Number(slot), Array.from({ length: n }, (_, k) => arg(c, 1 + k))));
}
// The display service's own edges. The resident image carries the real method
// pointers (D0x8004DE10+0x150 = F0x8001D714, +0x154 = F0x8001D7C4, +0x16C =
// F0x8001DBE0, +0x174 = F0x8001D8CC), so the original runs its own display setup
// and reaches the host edges below through the cells its body reads: the two
// heap allocator cells D0x8004B5DC+0x18/+0x1C, the zeroed allocator at
// 0x8004B5FC, the ordering-table clear F0x80025D54, GsInit3D, setGeomOffset and
// the service's own +0x170 release slot.
mem.write32(DISPLAY_HEAP_ALLOC, S_HEAP);
mem.write32(HEAP_ALLOC_HIGH, S_HEAP_HIGH);
mem.write32(DISPLAY_ALLOC_ZEROED, S_HEAP_ZERO);
st(S_HEAP, (c) => hostImpl.alloc(reg(c, 0), 2));
st(S_HEAP_HIGH, (c) => hostImpl.alloc(reg(c, 0), 2));
st(S_HEAP_ZERO, (c) => hostImpl.allocZeroed(reg(c, 0), 2));
st(CLEAR_OT, (c) => { hostImpl.clearOTag(reg(c, 0), arg(c, 1)); return 0; });
st(GS_INIT, () => { hostImpl.gsInit3D(); return 0; });
st(SET_GEOM, (c) => { hostImpl.setGeomOffset(reg(c, 0), reg(c, 1)); return 0; });
mem.write32(RELEASE_CELL, S_RELEASE);
st(S_RELEASE, (c) => { hostImpl.releaseView(reg(c, 0)); return 0; });
mem.write32(RESOLVE_CELL, S_RESOLVE);
st(S_RESOLVE, (c) => hostImpl.resolvePack(reg(c, 0)));
mem.write32(DELTA_CELL, S_DELTA);
st(S_DELTA, () => hostImpl.frameDelta());
mem.write32(PAD_SERVICE + 0x3f4, S_PAD_READ);
mem.write32(PAD_SERVICE + 0x408, S_PAD_BIT);
st(S_PAD_READ, (c) => hostImpl.padRead(arg(c, 0)));
st(S_PAD_BIT, (c) => hostImpl.padBit(arg(c, 0), arg(c, 1)));
mem.write32(STOP_SOUND_CELL, S_STOP);
st(S_STOP, () => { hostImpl.stopAllSound(); return 0; });
mem.write32(LAUNCHER_CELL, S_LAUNCH);
st(S_LAUNCH, (c) => { hostImpl.launchScreen(reg(c, 0), reg(c, 1)); return 0; });

// F0x8001FFA8 builds the layout context on the caller's stack and the card then
// calls two of its slots; the stub installs the same three stub pointers (the
// +0x1C slot is the context publishing itself, which changes nothing the card
// can see, so it stays out of the call log).
st(TEXT_CTX_CTOR, (c) => {
    const ctx = reg(c, 0);
    LOG.push(["ctxInit"]);
    mem.write32(ctx + 0x1c, S_CTX_PUBLISH);
    mem.write32(ctx + 0x24, S_CTX_PAIR);
    mem.write32(ctx + 0x2c, S_CTX_LAYOUT);
    mem.write32(ctx + 0x18, 0xa800);
    st(S_CTX_PUBLISH, () => 0);
    st(S_CTX_PAIR, (p) => { hostImpl.callSlot(ctx, 0x24, [arg(p, 0), arg(p, 1)]); return 0; });
    st(S_CTX_LAYOUT, (p) => { hostImpl.layoutPackTexture(ctx, reg(p, 0)); return 0; });
    return 0;
});

// F0x8001F648 builds the 2-D draw context on the card's stack; the card then
// calls +0x7C, +0x74, +0x88 and +0x84 through its own table.
st(DRAW_CTX_CTOR, (c) => {
    const ctx = reg(c, 0);
    LOG.push(["drawInit"]);
    mem.write32(ctx + 0x74, S_DRAW_ORIGIN);
    mem.write32(ctx + 0x7c, S_DRAW_LAYER);
    mem.write32(ctx + 0x84, S_DRAW_SPRITE);
    mem.write32(ctx + 0x88, S_DRAW_PALETTE);
    st(S_DRAW_LAYER, (p) => { hostImpl.drawCall(ctx, 0x7c, [arg(p, 0), arg(p, 1)]); return 0; });
    st(S_DRAW_ORIGIN, (p) => { hostImpl.drawCall(ctx, 0x74, [arg(p, 0), arg(p, 1)]); return 0; });
    st(S_DRAW_PALETTE, (p) => { hostImpl.drawCall(ctx, 0x88, [arg(p, 0)]); return 0; });
    st(S_DRAW_SPRITE, (p) => { hostImpl.drawCall(ctx, 0x84, [reg(p, 0), reg(p, 1), reg(p, 2), reg(p, 3)]); return 0; });
    return 0;
});

// ── scenario plumbing ────────────────────────────────────────────────────────
const zero = (a, n) => mem.bytes.fill(0, a & 0x1fffff, (a & 0x1fffff) + n);
const DEFAULT = { language: 2, delta: 1, pad: 0 };

function freshServices() {
    const classes = new Map([
        [END_CARD_ROOT_TICK, { name: "END card screen", childSlots: [0], tick() {} }],
        [END_CARD_SEQUENCE_TICK, { name: "END card sequence", childSlots: [], tick() {} }],
    ]);
    const tree = new TranslatedTaskTree(mem, classes);
    return { tree, draw: new ShopDrawIntents(mem) };
}

function reset(c) {
    Object.assign(CTL, DEFAULT, { arena: ARENA }, c.ctl ?? {});
    zero(0x80100000, 0x90000);
    S = freshServices();
    zero(CTX, 0x200);
    zero(ORIG_CTX, 0x40);
    zero(ENV, 0x60);
    zero(PACK, 0x40);
    // The original builds its layout context and DRAWENV on its own stack, which
    // call() points at ORIG_STACK; that window is cleared, nothing else (the RAM
    // mask wraps, so a sweep from there would wipe the loaded overlay too).
    zero(ORIG_STACK, 0x1000);
    // the display service: its own state is zeroed, its method cells keep the
    // shipped pointers the original calls through
    for (let i = 0; i < 0x150; i++) mem.write8(DISPLAY_SERVICE + i, 0);
    for (let i = 0; i < OT_POOL_SIZES.length; i++) mem.write16(VIEW_POOL_TABLE + i * 2, OT_POOL_SIZES[i]);
    mem.write32(DISPLAY_SERVICE_INIT_FLAG, c.init ?? 0);
    mem.write32(END_CARD_LANGUAGE, CTL.language);
    mem.write32(LANGUAGE_WRITER, 0);
    LOG.length = 0;
}
const LANGUAGE_WRITER = 0x8005cca0;

function snap(rootTask, ctxAddr) {
    const out = [];
    const words = (a, n) => { for (let i = 0; i < n; i += 4) out.push(mem.read32(a + i) >>> 0); };
    words(rootTask, END_CARD_ROOT_SIZE);
    const extra = mem.read32(rootTask + 0x24) >>> 0;
    words(extra, END_CARD_ROOT_EXTRA);
    const card = mem.read32(extra) >>> 0;
    if (card >= 0x80100000 && card < 0x801a0000) words(card, END_CARD_SEQUENCE_SIZE);
    // the display service object and the view it registered
    words(DISPLAY_SERVICE, 0x1d8);
    const slot = mem.read32(DISPLAY_SERVICE + DISPLAY_SERVICE_FIELDS.viewBase) >>> 0;
    if (slot) words(slot, 0x16c);
    if (ctxAddr) {
        out.push(mem.read32(ctxAddr) >>> 0, mem.read32(ctxAddr + 8) >>> 0,
            mem.read32(ctxAddr + 0xc) >>> 0, mem.read32(ctxAddr + 0x18) >>> 0);
    }
    return out;
}

/**
 * A frame snapshot starts after the root object and its extra block; the card
 * object follows. `out[f]` is the state after callback f-1, and `trace[f]` (what
 * a scenario's script sees) is the same moment, so the log in `out[f]` belongs to
 * callback f-1.
 */
const SNAP_CARD = END_CARD_ROOT_SIZE / 4 + END_CARD_ROOT_EXTRA / 4;
/** Level and timer are the two halfwords of one word (0x50 and 0x52). */
const snapLevel = (words) => (words[SNAP_CARD + END_CARD_LEVEL / 4] << 16) >> 16;
const snapTimer = (words) => (words[SNAP_CARD + END_CARD_LEVEL / 4] >>> 16);
const snapSub = (words) => words[SNAP_CARD + END_CARD_SUB / 4] | 0;

const origCreate = () => rt.cpu.call(END_CARD_CREATE, [], 5000) >>> 0;
const portCreate = () => endCardCreate(hostImpl);
const origSeqCreate = () => rt.cpu.call(END_CARD_SEQUENCE_CREATE, [], 5000) >>> 0;
const portSeqCreate = () => endCardSequenceCreate(hostImpl);
const origRootTick = (t, x) => rt.cpu.call(END_CARD_ROOT_TICK, [t, x], 200000);
const portRootTick = (t, x) => endCardRootTick(mem, hostImpl, t, x);
const origCardTick = (t) => rt.cpu.call(END_CARD_SEQUENCE_TICK, [t], 200000);
const portCardTick = (t) => endCardTick(mem, hostImpl, t);

/**
 * Raise the card, then run `frames` of the scheduler: the root callback, then the
 * sequence callback the root created. `script(frame, ctl, root)` runs before each
 * frame (it plays the player: held buttons, a changed frame delta).
 */
function scenario(name, frames, script, c = {}) {
    // `ctx` is where each side keeps the caller's layout context: the port's own
    // scratch, and the original's stack frame. A scenario's `seed` runs once,
    // just after the first pair of callbacks, so it can put the card into a state
    // the first callback would not have reached.
    const record = (create, rootTick, cardTick, ctx) => {
        reset(c);
        const task = create();
        const out = [[LOG.slice(), snap(task)]];
        const extra = mem.read32(task + 0x24) >>> 0;
        for (let f = 0; f < frames; f++) {
            script?.(f, CTL, task, mem.read32(extra) >>> 0);
            LOG.length = 0;
            // The original builds the DRAWENV it copies into each view in its own
            // stack frame, and F0x8001DBE0 does not write the tail of that struct,
            // so both sides' scratch is cleared before every callback: what the
            // console would have found there is leftover stack, not game state.
            zero(ORIG_STACK, 0x1000);
            zero(ENV, 0x60);
            rootTick(task, extra);
            const card = mem.read32(extra) >>> 0;
            if (card !== 0) cardTick(card);
            if (f === 0) c.seed?.(task, extra, card);
            // the layout context only exists on the frame the root builds it
            out.push([LOG.slice(), snap(task, f === 0 ? ctx : 0)]);
        }
        return { out, task };
    };
    const o = record(origCreate, origRootTick, origCardTick, ORIG_CTX);
    const p = record(portCreate, portRootTick, portCardTick, CTX);
    assert.equal(p.task, o.task, `${name}: screen root address`);
    for (let f = 0; f < o.out.length; f++) {
        assert.deepEqual(p.out[f][0], o.out[f][0], `${name} frame ${f - 1}: calls`);
        const d = p.out[f][1].findIndex((v, i) => v !== o.out[f][1][i]);
        assert.deepEqual(p.out[f][1], o.out[f][1], `${name} frame ${f - 1}: memory word ${d} (${p.out[f][1][d]} vs ${o.out[f][1][d]})`);
    }
    return o;
}

const cardOf = (task) => mem.read32(mem.read32(task + 0x24) >>> 0) >>> 0;
const stateOf = (task) => [mem.read32(task + END_CARD_STATE) | 0, mem.read32(cardOf(task) + END_CARD_SUB) | 0];
/** The card object's own state word: +0x28(3) parks it there. */
const cardStateOf = (task) => mem.read32(cardOf(task) + END_CARD_STATE) | 0;
const levelOf = (task) => (mem.read32(cardOf(task) + END_CARD_LEVEL) << 16) >> 16;
const timerOf = (task) => (mem.read32(cardOf(task) + END_CARD_TIMER) << 16) >> 16;

// ── tests ────────────────────────────────────────────────────────────────────

test("the shipped overlay carries the tables the port assumes", () => {
    // The language dispatch's seven-word table at overlay file offset 0, and the
    // six-entry sub-state table at +0x20 (the gate is `sltiu 6`, so entry 6 of
    // the file's third table is never reached).
    const targets = [0x80084584, 0x80084584, 0x80084584, 0x8008458c, 0x80084594, 0x8008459c, 0x8008458c];
    for (let i = 0; i < 7; i++) assert.equal(mem.read32(OVERLAY_BASE + 4 * i) >>> 0, targets[i], `language ${i}`);
    const subs = [0x800846c4, 0x80084714, 0x80084720, 0x80084774, 0x800847a8, 0x800847d4];
    subs.forEach((a, i) => assert.equal(mem.read32(OVERLAY_BASE + 0x20 + 4 * i) >>> 0, a, `sub-state ${i}`));
    // The view descriptor the root hands the display service: (0, 0, 320, 240).
    assert.deepEqual([0, 2, 4, 6].map((o) => (mem.read16(0x80087c4c + o) << 16) >> 16), [0, 0, 320, 240]);
    // The four bodies each store one clip index; the port's table reproduces it.
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(endCardClipForLanguage), [0, 0, 0, 2, 3, 1, 2]);
    assert.deepEqual([...END_CARD_CLIP_BY_LANGUAGE], [0, 0, 0, 2, 3, 1, 2]);
    for (const out of [7, 8, 99, 0x7fffffff, 0xffffffff]) {
        assert.equal(endCardClipForLanguage(out), 0, `language ${out} keeps clip 0`);
    }
});

test("the two factories allocate what F0x80014504 is given", () => {
    // Each side gets its own reset: the arena hands out the same address twice,
    // so comparing the two allocations needs one run each.
    reset({});
    assert.equal(origCreate(), 0x80100000);
    assert.deepEqual(LOG.splice(0), [["task", END_CARD_ROOT_TICK, END_CARD_ROOT_SIZE, END_CARD_ROOT_EXTRA, 0]]);
    assert.equal(origSeqCreate(), 0x80100058);
    assert.deepEqual(LOG.splice(0), [["task", END_CARD_SEQUENCE_TICK, END_CARD_SEQUENCE_SIZE, 0, 0]]);
    reset({});
    assert.equal(portCreate(), 0x80100000);
    assert.deepEqual(LOG.splice(0), [["task", END_CARD_ROOT_TICK, END_CARD_ROOT_SIZE, END_CARD_ROOT_EXTRA, 0]]);
    assert.equal(portSeqCreate(), 0x80100058);
    assert.deepEqual(LOG.splice(0), [["task", END_CARD_SEQUENCE_TICK, END_CARD_SEQUENCE_SIZE, 0, 0]]);
});

test("the first callback builds the display, silences the machine and draws nothing", () => {
    const o = scenario("entry", 1, null);
    const log = o.out[1][0];
    // The setup, in the original's own order: the service reset, the packet
    // budget's two buffers, the 320x240 region and its two device writes, the
    // layout context and its pair, the pack layout, the view's zeroed object, its
    // copied draw env, its two ordering tables, the sequence object, then +0x38.
    assert.deepEqual(log, [
        ["alloc", 0xa000, 2], ["alloc", 0xa000, 2],
        ["gsInit3D"], ["setGeomOffset", 0, 0],
        ["ctxInit"], ["ctxSlot", 0x24, 0x280, 0],
        ["resolvePack", 0x08a60001], ["ctxLayout", PACK],
        ["allocZeroed", 0x16c, 2], ["alloc", 16, 2], ["alloc", 16, 2],
        // the two four-word ordering tables the view owns, carved after the two
        // 0xA000 packet buffers and the 0x16C view itself
        ["clearOTag", ARENA + 0x14000 + 0x16c, 4], ["clearOTag", ARENA + 0x14000 + 0x17c, 4],
        ["task", END_CARD_SEQUENCE_TICK, END_CARD_SEQUENCE_SIZE, 0, 0],
        ["method", o.task, 0x38],
        ["method", cardOf(o.task), 0x38],
        ["stopAllSound"],
    ]);
    // the entry frame draws nothing: only the setup ran
    assert.ok(!log.some((e) => e[0] === "drawSlot"), "the entry callback draws nothing");
    assert.deepEqual(stateOf(o.task), [1, 0]);
    assert.equal(levelOf(o.task), END_CARD_LEVEL_MAX);
    assert.equal(timerOf(o.task), 0);
});

test("the display setup: packet budget, region, view and the view colour", () => {
    for (const init of [0, 1]) {
        const o = scenario(`init ${init}`, 1, null, { init });
        const log = o.out[1][0];
        assert.ok(!log.some((e) => e[0] === "releaseView"), `init ${init}: no view to release`);
        const slot = mem.read32(DISPLAY_SERVICE + DISPLAY_SERVICE_FIELDS.viewBase) >>> 0;
        assert.ok(slot !== 0, "the card registered a view");
        assert.equal(mem.read32(DISPLAY_SERVICE + DISPLAY_SERVICE_FIELDS.viewHandle) >>> 0, 0x100);
        // the view's own rectangle colour, the one the card asks for and no
        // ordinary menu does
        assert.deepEqual([slot + 0x18, slot + 0x19, slot + 0x1a, slot + 0x1b]
            .map((a) => mem.read8(a)), [1, 0x1f, 0x1f, 0x1f]);
        // four ordering-table words for view type 2 (D0x8004DFA0 indexed by 1)
        assert.equal(mem.read32(slot + 0x64) | 0, 4);
        // the region: 320x240, not the 640x480 interlaced pair
        assert.equal((mem.read16(DISPLAY_SERVICE + 0x38 + 4) << 16) >> 16, 320);
        assert.equal((mem.read16(DISPLAY_SERVICE + 0x38 + 6) << 16) >> 16, 240);
        assert.equal((mem.read16(DISPLAY_SERVICE + 0x4c + 4) << 16) >> 16, 320);
        // the layout context the card built, and the pack it laid out
        assert.deepEqual([0, 8, 0xc, 0x18].map((o2) => mem.read32(CTX + o2) >>> 0),
            [PACK, 0x280, 0, 0xa800]);
        assert.ok(log.some((e) => e[0] === "resolvePack" && e[1] === 0x08a60001), "the texture half of end__all");
        assert.ok(log.some((e) => e[0] === "gsInit3D") && log.some((e) => e[0] === "setGeomOffset"));
    }
    // a second begin releases the view the first one registered
    reset({});
    const first = origCreate();
    origRootTick(first, mem.read32(first + 0x24) >>> 0);
    LOG.length = 0;
    const second = endCardCreate(hostImpl);
    endCardRootTick(mem, hostImpl, second, mem.read32(second + 0x24) >>> 0);
    assert.ok(LOG.some((e) => e[0] === "releaseView"), "the service reset released the old view");
});

test("the whole card: fade in, hold, wait, fade out, hold, movie request", () => {
    const trace = [];
    // trace[f] is the state before callback f (and the same words the scenario's
    // frame snapshot holds), so trace[f + 1] is the card after callback f.
    const watch = (f, ctl, task) => trace.push([...stateOf(task), levelOf(task), timerOf(task)]);
    const o = scenario("full", 160, watch);
    const frames = o.out.slice(1).map(([log]) => log);
    // Callback 0 is the entry frame: it raises the state, hides the card and
    // silences the machine, and draws nothing. Callback 1 draws it at level 15.
    assert.deepEqual(frames[0].filter((e) => e[0] === "drawSlot"), []);
    assert.deepEqual(frames[1].filter((e) => e[0] === "drawSlot"), [
        ["drawSlot", 0x7c, 0x100, 1],
        ["drawSlot", 0x74, 0x280, 0],
        ["drawSlot", 0x88, 15],
        ["drawSlot", 0x84, PACK, 0, 0, 0],
    ]);
    assert.ok(frames[1].some((e) => e[0] === "resolvePack" && e[1] === 0x08a60000), "the sprite half of end__all");
    assert.ok(frames[0].some((e) => e[0] === "resolvePack" && e[1] === 0x08a60001), "the texture half");
    // One level per callback, and only on every second callback: the fade step is
    // two timer units and the timer only grows by one per callback.
    assert.deepEqual(trace.slice(1, 11).map((r) => r[2]), [15, 15, 15, 14, 14, 13, 13, 12, 12, 11]);
    // The fade-in ends at level 0 on callback 31 (fifteen steps from callback 3)
    // and raises the hold on callback 32.
    assert.deepEqual(trace[31].slice(0, 3), [1, 0, 1], "one step left");
    assert.deepEqual(trace[32].slice(0, 3), [1, 1, 0], "level 0 raised sub-state 1");
    // The hold runs the 0x78 = 120 timer units it was given, one per callback.
    assert.deepEqual(trace[151].slice(0, 4), [1, 1, 0, 120]);
    assert.deepEqual(trace[152].slice(0, 2), [1, 2], "the 0x78 hold ran out");
    // Nothing samples the pad before the wait: the wait is the only sub-state
    // that reads it, and its own test below covers the sampling.
    assert.ok(!frames.slice(0, 152).some((log) => log.some((e) => e[0] === "padRead")),
        "the pad is untouched until the wait");
});

test("the rest of the card at one callback per step: fade out, hold, movie, park", () => {
    // A frame delta of 0x1000 keeps every hold one callback long while the fade
    // still steps exactly one level per callback (the original has no catch-up),
    // so the whole sequence fits in 56 callbacks.
    const t = [];
    const o = scenario("whole", 57, (f, ctl, task) => t.push([...stateOf(task), levelOf(task), timerOf(task)]),
        { ctl: { delta: 0x1000 } });
    // only the original's own run: watch() appends for both sides
    const seen = t.slice(0, 57);
    const sub = [];
    for (let i = 1; i < seen.length; i++) if (seen[i][1] !== seen[i - 1][1]) sub.push([i, seen[i][1], seen[i][2]]);
    assert.deepEqual(sub, [
        [25, 1, 0],   // level 0 raised the 0x78 hold
        [26, 2, 0],   // one callback: the timer cleared the hold
        [31, 3, 0],   // 0x4650 = 18000 / 0x1000 = 5 callbacks of the wait
        [54, 4, 15],  // the fade-out is over and the 0x3C hold began
        [55, 5, 15],  // one callback: the hold cleared and the movie was asked for
        [56, 0, 15],  // +0x28(3) parked the card and cleared its sub-phases
    ]);
    // The card leaves the fade at level 15 again: the ramp ends where it began.
    assert.deepEqual(seen[55].slice(0, 3), [1, 5, 15]);
    const handoff = o.out[56][0];
    assert.ok(handoff.some((e) => e[0] === "launch" && e[1] === 0xe01), "callback 55 asks for the movie");
    assert.ok(handoff.some((e) => e[0] === "method" && e[2] === 0x28 && e[3] === 3), "+0x28(3) parks the card");
    // Parked: the card's own gate leaves states 2 and 3 alone, so it draws no
    // more and its sub-phases stay as +0x28 cleared them.
    assert.ok(!o.out[57][0].some((e) => e[0] === "drawSlot"), "a parked card draws nothing");
    assert.equal(cardStateOf(o.task), 3, "the card is parked in state 3");
    assert.deepEqual(stateOf(o.task), [1, 0], "the screen root is untouched, the card's sub-phases are cleared");
});

test("each language takes the picture its own body names", () => {
    for (const language of [0, 1, 2, 3, 4, 5, 6, 7, 13, 0x7fffffff]) {
        const o = scenario(`lang ${language}`, 2, null, { ctl: { language } });
        const draws = o.out[2][0].filter((e) => e[0] === "drawSlot" && e[1] === 0x84);
        assert.equal(draws.length, 1, `language ${language}: one sprite draw`);
        assert.deepEqual(draws[0], ["drawSlot", 0x84, PACK, endCardClipForLanguage(language), 0, 0]);
    }
});

test("the frame delta drives the timer, and one callback never steps twice", () => {
    // A delta above the two-frame step must still move one level per callback
    // (the original has no catch-up loop): this is the walker's old divergence.
    for (const delta of [1, 2, 3, 7, 0x3c, -5]) {
        const o = scenario(`delta ${delta}`, 6, null, { ctl: { delta } });
        const levels = o.out.slice(1).map(([, words]) => snapLevel(words));
        // The entry callback hides the card; nothing has faded yet.
        assert.equal(levels[0], 0x0f, `delta ${delta}: hidden after the entry callback`);
        // Every callback either steps once or does not step at all; it never jumps
        // two levels in one callback, whatever the delta is.
        for (let i = 1; i < levels.length; i++) {
            assert.ok(Math.abs(levels[i] - levels[i - 1]) <= 1, `delta ${delta}: one level per callback`);
        }
        // The fade step is two timer units and the timer starts at zero. A delta
        // of one therefore steps on every other callback; a delta of two refills
        // the timer to exactly the step, so from the second callback on it steps
        // every callback; and a negative delta wraps the halfword negative, which
        // the `slti 2` guard reads as "not yet", so the card never moves.
        const timers = o.out.slice(1).map(([, words]) => snapTimer(words));
        if (delta === 1) {
            assert.deepEqual(levels, [15, 15, 15, 14, 14, 13], "delta 1: a step every other callback");
            assert.deepEqual(timers, [0, 1, 2, 1, 2, 1], "delta 1: the timer alternates");
        } else if (delta < 0) {
            assert.deepEqual(levels, [15, 15, 15, 15, 15, 15], `delta ${delta}: the timer never reaches the step`);
            assert.deepEqual(timers, [0, 1, 2, 3, 4, 5].map((n) => (n * delta) & 0xffff),
                `delta ${delta}: the timer falls by the delta every callback`);
        } else {
            assert.deepEqual(levels, [15, 15, 14, 13, 12, 11], `delta ${delta}: a step every callback`);
        }
    }
    // delta 0 freezes the card on its level while the timer waits for the step.
    const o = scenario("delta 0", 8, null, { ctl: { delta: 0 } });
    assert.equal(levelOf(o.task), 0x0f);
    assert.deepEqual(stateOf(o.task), [1, 0]);
});

test("the pad is sampled every callback while the card waits", () => {
    // The button the original reads is logical button 3: the pad's Start bit. The
    // wait is the third sub-state, so the card is walked there with a frame delta
    // that makes the fade-in fifteen callbacks, the 0x78 hold one (callback 17)
    // and the wait itself 0x4650 / 0x100 = 70 more.
    const FAST = { ctl: { delta: 0x100 } };
    const hold = (bit) => (f, ctl) => { ctl.pad = 1 << bit; };
    const o = scenario("start held", 40, hold(3), FAST);
    // Callback 18 is the first in sub-state 2 and the button is already down, so
    // the wait ends on that very callback.
    assert.equal(cardStateOf(o.task), 3, "it skipped the wait, ran the rest of the card and parked");
    assert.ok(o.out[19][0].some((e) => e[0] === "method" && e[2] === 0x3c), "callback 18 ended the wait");
    assert.ok(!o.out.slice(20, 25).some(([log]) => log.some((e) => e[0] === "padRead")),
        "the wait is over, so the pad is read no more");
    // Only the pad word's bit 3 ends the wait. With this delta the wait itself
    // runs 0x4650 / 0x100 = 70 callbacks, so after 40 callbacks a card that was
    // never skipped is still in sub-state 2, and one that was has walked the whole
    // rest of the card and parked.
    for (const bit of [0, 1, 2, 4, 5, 6, 7, 8, 13, 31]) {
        const p = scenario(`bit ${bit}`, 40, hold(bit), FAST);
        const sub = snapSub(p.out[40][1]);
        assert.equal(sub, bit === 3 ? 0 : 2, `bit ${bit}`);
        assert.equal(cardStateOf(p.task), bit === 3 ? 3 : 1, `bit ${bit}: card state`);
    }
    const none = scenario("no button", 40, null, FAST);
    assert.equal(snapSub(none.out[40][1]), 2, "no button: still waiting");
    // The pad is read on every callback of the wait, in the original's order: the
    // held word first, then the bit its logical button code occupies.
    const waited = scenario("sampled", 30, null, FAST);
    for (let f = 19; f < 23; f++) {
        const entries = waited.out[f][0].filter((e) => e[0] === "padRead" || e[0] === "padBit");
        assert.deepEqual(entries, [["padRead"], ["padBit", 0, 3]], `callback ${f - 1}: the pad is sampled`);
    }
    // and it is not read at all before the wait
    assert.ok(!waited.out.slice(1, 19).some(([log]) => log.some((e) => e[0] === "padRead")),
        "the pad is untouched before the wait");
});

test("every sub-state, from every signed timer and level", () => {
    const seed = (s, sub, level, timer) => (task) => {
        mem.write32(task + END_CARD_STATE, s);
        const card = cardOf(task);
        mem.write32(card + END_CARD_SUB, sub);
        if (level !== null) mem.write16(card + END_CARD_LEVEL, level & 0xffff);
        if (timer !== null) mem.write16(card + END_CARD_TIMER, timer & 0xffff);
    };
    const levels = [0, 1, 14, 15, 16, 0x7fff, 0x8000, 0xffff];
    const timers = [0, 1, 2, 3, 0x77, 0x78, 0x79, 0x3b, 0x3c, 0x3d, 0x464f, 0x4650, 0x4651, 0x7fff, 0x8000, 0xffff];
    for (const sub of [-1, 0, 1, 2, 3, 4, 5, 6, 9, 0x7fffffff]) {
        for (const timer of timers) scenario(`state 1 sub ${sub} timer ${timer}`, 3, null,
            { seed: seed(1, sub, 8, timer), ctl: { delta: 1 } });
    }
    for (const level of levels) for (const timer of [0, 1, 2, 3]) {
        scenario(`fade in level ${level} timer ${timer}`, 3, null, { seed: seed(1, 0, level, timer) });
        scenario(`fade out level ${level} timer ${timer}`, 3, null, { seed: seed(1, 3, level, timer) });
    }
    // the root's own gate: only states <= 0 and >= 4 run the setup
    for (const s of [-1, 0, 1, 2, 3, 4, 7, 0x7fffffff]) {
        scenario(`root state ${s}`, 2, null, { seed: seed(s, 0, 15, 0) });
    }
    // the card's own gate: states 2 and 3 do nothing at all
    for (const s of [-1, 0, 1, 2, 3, 4, 9]) scenario(`card state ${s}`, 3, null, { seed: seed(s, 0, 4, 8) });
});

test("holding a button only ends the wait, it never skips the fades", () => {
    for (const sub of [0, 1, 3, 4]) {
        scenario(`held in sub ${sub}`, 6, (f, ctl) => { ctl.pad = 0x8; }, { seed: (task) => {
            mem.write32(task + END_CARD_STATE, 1);
            const card = cardOf(task);
            mem.write32(card + END_CARD_SUB, sub);
            mem.write16(card + END_CARD_LEVEL, 8);
            mem.write16(card + END_CARD_TIMER, 4);
        } });
    }
});

test("the card keeps drawing after it has handed on, and its last frame is blank", () => {
    const o = scenario("handoff", 3, null, { seed: (task) => {
        mem.write32(task + END_CARD_STATE, 1);
        const card = cardOf(task);
        mem.write32(card + END_CARD_SUB, 5);
        mem.write16(card + END_CARD_LEVEL, 15);
        mem.write16(card + END_CARD_TIMER, 0);
    } });
    // The seed runs just after callback 0, so callback 1 is the first in sub-state 5.
    assert.ok(o.out[2][0].some((e) => e[0] === "launch" && e[1] === 0xe01), "callback 1 asks for the movie");
    // sub-state 5 still falls into the common tail, so the card draws once more
    assert.deepEqual(o.out[2][0].filter((e) => e[0] === "drawSlot" && e[1] === 0x88), [["drawSlot", 0x88, 15]]);
    // and then the card is parked: state 3 does nothing at all, so it draws no
    // more and the launcher is not asked a second time.
    const after = o.out[3][0];
    assert.ok(!after.some((e) => e[0] === "launch"), "the parked card asks nothing");
    assert.ok(!after.some((e) => e[0] === "drawSlot"), "the parked card draws nothing");
    assert.equal(cardStateOf(o.task), 3, "state 3 with its sub-phases cleared");
});

test("the draw routine on its own, over random levels", () => {
    let rng = 0x2f6e21;
    const rand = () => ((rng = (Math.imul(rng, 1103515245) + 12345) >>> 0) >>> 8);
    for (let n = 0; n < 24; n++) {
        const level = rand() & 0xffff;
        const language = [0, 1, 2, 3, 4, 5, 6, 7, 0x40, 0x7fffffff][rand() % 10];
        reset({ ctl: { language } });
        const task = origCreate();
        const card = origSeqCreate();
        mem.write16(card + END_CARD_LEVEL, level);
        LOG.length = 0;
        origCardTick(card);
        const first = LOG.splice(0);
        const words = [];
        for (let i = 0; i < END_CARD_SEQUENCE_SIZE; i += 4) words.push(mem.read32(card + i) >>> 0);
        const firstWords = words.slice();
        LOG.length = 0;
        rt.cpu.call(END_CARD_DRAW, [card], 5000);
        const oracle = LOG.splice(0);
        LOG.length = 0;
        endCardDraw(mem, hostImpl, card);
        assert.deepEqual(LOG, oracle, `random draw ${n}: calls`);
        assert.deepEqual(words, firstWords, `random draw ${n}: the object is not written`);
        assert.ok(first.length > 0);
    }
});