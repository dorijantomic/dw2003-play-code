// Phase 4 oracle: engine/dw3/ui/gym-partner-draw.ts gymPartnerHudDraw must
// emit the same ordered draw intents and update the same portrait/blink
// counters as the original F0x80084838. The original runs through
// engine/native's draw-intent recorder; the port through an equivalent
// recorder. The pack resolver, the party-slot resolver and the frame tick are
// shared stubs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { gymPartnerHudDraw } from "../engine/dw3/ui/gym-partner-draw.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stgtrain = new Uint8Array(readFileSync(join(dir, "pro_stgtrain.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stgtrain.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

// Party position -> roster slot; the real resolver is a u32[3] table. Keep it
// deterministic and inside the 8 animation rows (each row is 7 u32 wide).
const ROSTER = [2, 0, 5, 1, 3, 4, 6, 7];
const ROSTER_STUB = 0x0fd30001;
const PACK_STUB = 0x0fd30000;
const PACK_PTR = 0x80190000;
const OBJ_A = 0x801a0000;
const OBJ_B = 0x801a1000;
const FRAME = 5000;
const OFFSETS = [0x50, 0x54, 0x58, 0x5c, 0x60, 0x64, 0x68, 0x6c, 0x70, 0x74,
    0x80, 0x84, 0x88, 0x8c, 0x90, 0x94, 0x98, 0x9c,
    0xa8, 0xb8, 0xc8, 0xd8, 0xe8, 0xf8, 0x108, 0x110, 0x114];

const ARITY = { setLayer: 2, setOrigin: 2, setScale: 3, setPos: 2, m_0x88: 1, drawSprite: 4 };

function runtime() {
    const rt = new NativeStageRuntime(stgtrain, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(ROSTER_STUB, (c) => ROSTER[c.reg(4) & 7]);
    rt.mem.write32(0x8004b44c, ROSTER_STUB);
    rt.cpu.setStub(PACK_STUB, () => PACK_PTR);
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.mem.write32(0x8004de20, FRAME);
    return rt;
}

const rt = runtime();

function norm(list) {
    return list.map(([m, a]) => [m, a.slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function fixture(obj, o) {
    for (let i = 0; i < 0x120; i += 4) rt.mem.write32(obj + i, 0);
    rt.mem.write32(obj + 0x50, o.layer ?? 0x1000);
    rt.mem.write32(obj + 0x54, o.bucket ?? 6);
    rt.mem.write32(obj + 0x58, o.clip ?? 0x2d);
    rt.mem.write32(obj + 0x5c, o.blinkPhase ?? 0);
    rt.mem.write32(obj + 0x60, o.blinkOn ?? 0);
    rt.mem.write32(obj + 0x64, o.podCount ?? 0);
    rt.mem.write32(obj + 0x68, o.selectedPod ?? 0);
    rt.mem.write32(obj + 0x6c, o.stripOn ?? 0);
    rt.mem.write32(obj + 0x70, o.stripPhase ?? 0);
    rt.mem.write32(obj + 0x74, o.stripTimer ?? 0);
    for (const [off, key] of [[0xa8, "foldA"], [0xb8, "foldB"], [0xc8, "foldC"],
        [0xd8, "foldG"], [0xe8, "foldH"], [0xf8, "foldD"], [0x108, "foldF"]]) {
        rt.mem.write32(obj + off, o[key] ?? 0);
    }
    rt.mem.write32(obj + 0x98, o.selFrame ?? 0);
    rt.mem.write32(obj + 0x9c, o.selTimer ?? FRAME);
    for (let i = 0; i < 4; i++) {
        if (o.podFrames && o.podFrames[i] !== undefined) rt.mem.write32(obj + 0x80 + i * 8, o.podFrames[i]);
        if (o.podTimers && o.podTimers[i] !== undefined) rt.mem.write32(obj + 0x84 + i * 8, o.podTimers[i]);
    }
}

function portHost(intents) {
    return {
        initDrawContext() {},
        setLayer(t, b) { intents.push(["setLayer", [t, b, 0, 0]]); },
        setOrigin(x, y) { intents.push(["setOrigin", [x, y, 0, 0]]); },
        setScale(x, y, z) { intents.push(["setScale", [x, y, z, 0]]); },
        setPos(x, y) { intents.push(["setPos", [x, y, 0, 0]]); },
        paletteShift(v) { intents.push(["m_0x88", [v, 0, 0, 0]]); },
        drawSprite(p, c, x, y) { intents.push(["drawSprite", [p, c, x, y]]); },
        packResolve() { return PACK_PTR; },
        frameTick() { return rt.mem.read32(0x8004de20) | 0; },
        rosterSlot(pos) { return ROSTER[pos & 7]; },
    };
}

function runCase(label, o) {
    fixture(OBJ_A, o);
    fixture(OBJ_B, o);
    const before = rt.drawCalls.length;
    rt.cpu.call(0x80084838, [OBJ_A]);
    const oracle = norm(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;

    const portIntents = [];
    gymPartnerHudDraw(rt.mem, OBJ_B, portHost(portIntents));

    assert.deepEqual(norm(portIntents), oracle, `${label}: intents`);
    for (const off of OFFSETS) {
        assert.equal(rt.mem.read32(OBJ_B + off) | 0, rt.mem.read32(OBJ_A + off) | 0,
            `${label} +0x${off.toString(16)}`);
    }
}

test("gymPartnerHudDraw matches F0x80084838", () => {
    runCase("idle", {});
    runCase("all folds open", { foldA: 0x1000, foldB: 0x1000, foldC: 0x1000, foldD: 0x1000, foldF: 0x1000, foldG: 0x1000, foldH: 0x1000, podCount: 2, selectedPod: 1, stripOn: 1 });
    runCase("all folds partial", { foldA: 0x800, foldB: 0x400, foldC: 0x900, foldD: 0x300, foldF: 0x700, foldG: 0x200, foldH: 0x600, podCount: 3, selectedPod: 2, stripOn: 1 });
    runCase("strip only", { stripOn: 1, stripPhase: 3, stripTimer: FRAME - 11, selectedPod: 2 });
    runCase("strip too soon", { stripOn: 1, stripPhase: 1, stripTimer: FRAME - 3 });
    runCase("portrait advance", { podCount: 3, podFrames: [0, 3, 5], podTimers: [FRAME - 13, FRAME - 20, FRAME], selFrame: 0, selTimer: FRAME - 13 });
    runCase("portrait anim end", { podCount: 3, podFrames: [4, 1, 6], podTimers: [FRAME - 13, FRAME - 13, FRAME - 13], selFrame: 5, selTimer: FRAME - 13 });
    runCase("portrait frame wrap", { podCount: 1, podFrames: [6], podTimers: [FRAME - 13], selFrame: 6, selTimer: FRAME - 13 });
    runCase("blink open", { blinkOn: 1, blinkPhase: 5, clip: 0x31 });
    runCase("blink limit", { blinkOn: 1, blinkPhase: 0x5f, clip: 0x30 });
    runCase("pod d loop", { foldD: 0x1000, podCount: 3, selectedPod: 2 });
    runCase("everything", {
        foldA: 0x1000, foldB: 0x800, foldC: 0x1000, foldD: 0x400, foldF: 0x1000,
        foldG: 0x800, foldH: 0x1000, podCount: 3, selectedPod: 2, stripOn: 1,
        stripPhase: 2, stripTimer: FRAME - 12, blinkOn: 1, blinkPhase: 9,
        podFrames: [1, 4, 5], podTimers: [FRAME - 13, FRAME - 13, FRAME],
        selFrame: 4, selTimer: FRAME - 13,
    });
});
