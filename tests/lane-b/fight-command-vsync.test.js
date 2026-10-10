// Lane B oracle: the battle command list's vsync blit F0x8009ABD8 and the two
// libgpu packet builders it calls (ClearOTag F0x80025C8C, SetDrawMove
// F0x8002918C) must match the original.
//
// The original runs through engine/native (the reference interpreter) with its
// real resident ClearOTag and SetDrawMove bodies; only the three GPU register
// services (BreakDraw, the idle poll and ContinueDraw) are stubbed. The port
// runs with the translated clearOtag/setDrawMove and the same three stubs.
// Every call, the menu fields, the rectangle, the four packets, the ordering
// table and the libgpu terminator are compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    commandMenuVsyncBlit, COMMAND_BLIT_OT, COMMAND_BLIT_PRIMS, COMMAND_BLIT_RECT,
} from "../../engine/dw3/ui/native/fight-command-menu.ts";
import { clearOtag, setDrawMove } from "../../engine/dw3/psyq-video.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const fight = new Uint8Array(readFileSync(join(dir, "pro_fightstg.bin")));
const entry = { size: fight.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const MENU = 0x80150000;
const BREAK_DRAW = 0x80028d8c;
const DRAW_SYNC = 0x80028e20;
const CONTINUE_DRAW = 0x80028e80;
const DEBUG_LEVEL = 0x80055efa;
const DEBUG_DISPATCH = 0x80055ef4;
const DEBUG_STUB = 0x0fdd0100;
const TERMINATOR = 0x80055fb8;

const LOG = [];
const CONTROL = { breakDraw: 0, syncBusy: 0 };

function runtime() {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0, playPackedSound() {} };
    const rt = new NativeStageRuntime(fight, entry, host, undefined, undefined, 0x80082cb0, {
        image: resident, base: 0x80010000,
    });
    rt.cpu.setStub(BREAK_DRAW, () => { LOG.push(["break"]); return CONTROL.breakDraw; });
    rt.cpu.setStub(DRAW_SYNC, (c) => {
        LOG.push(["sync", c.reg(4) | 0]);
        if (CONTROL.syncBusy > 0) { CONTROL.syncBusy -= 1; return -1; }
        return 0;
    });
    rt.cpu.setStub(CONTINUE_DRAW, (c) => { LOG.push(["continue", c.reg(4) >>> 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(DEBUG_STUB, (c) => { LOG.push(["debug", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) | 0]); return 0; });
    return rt;
}

function seed(rt, c) {
    for (let i = 0; i < 0x100; i += 4) rt.mem.write32(MENU + i, 0);
    // The command list's config (F0x8009B0C8 copies these to +0x58..+0x74).
    const config = [6, 0x11, 0x6e, 0x13, 0x22, 0x10, 0x6d, 0x13];
    config.forEach((v, i) => rt.mem.write32(MENU + 0x58 + i * 4, v));
    rt.mem.write32(MENU + 0x50, c.row);
    rt.mem.write32(MENU + 0x78, c.prev);
    rt.mem.write32(MENU + 0x7c, c.counter);
    for (let i = 0; i < 0x68; i += 4) rt.mem.write32(COMMAND_BLIT_PRIMS + i, 0xdead0000 + i);
    rt.mem.write32(COMMAND_BLIT_OT, 0x11000000);
    rt.mem.write32(COMMAND_BLIT_OT + 4, 0x22000000);
    rt.mem.write32(TERMINATOR, 0);
    // The shipped rectangle: x (rewritten each pass), y 0xF4, 12x12.
    rt.mem.write16(COMMAND_BLIT_RECT, 0x55);
    rt.mem.write16(COMMAND_BLIT_RECT + 2, 0xf4);
    rt.mem.write16(COMMAND_BLIT_RECT + 4, c.w ?? 12);
    rt.mem.write16(COMMAND_BLIT_RECT + 6, 12);
    rt.mem.write8(DEBUG_LEVEL, c.debug ?? 0);
    rt.mem.write32(DEBUG_DISPATCH, DEBUG_STUB);
    CONTROL.breakDraw = c.breakDraw ?? 0;
    CONTROL.syncBusy = c.syncBusy ?? 0;
}

function snapshot(rt) {
    const words = [];
    for (const off of [0x50, 0x78, 0x7c]) words.push(rt.mem.read32(MENU + off) >>> 0);
    for (let i = 0; i < 0x68; i += 4) words.push(rt.mem.read32(COMMAND_BLIT_PRIMS + i) >>> 0);
    words.push(rt.mem.read32(COMMAND_BLIT_RECT) >>> 0, rt.mem.read32(COMMAND_BLIT_RECT + 4) >>> 0);
    words.push(rt.mem.read32(TERMINATOR) >>> 0);
    return words;
}

function portHost(rt) {
    return {
        breakDraw: () => { LOG.push(["break"]); return CONTROL.breakDraw; },
        clearOTag: (ot, n) => clearOtag(rt.mem, ot, n, {
            debugDispatch: (a0, a1, a2) => LOG.push(["debug", a0 >>> 0, a1 >>> 0, a2 | 0]),
        }),
        setDrawMove: (p, r, x, y) => setDrawMove(rt.mem, p, r, x, y),
        drawSync: (mode) => {
            LOG.push(["sync", mode | 0]);
            if (CONTROL.syncBusy > 0) { CONTROL.syncBusy -= 1; return -1; }
            return 0;
        },
        continueDraw: (ot, saved) => LOG.push(["continue", ot >>> 0, saved | 0]),
    };
}

const CASES = [
    { name: "first blank after open", row: 0, prev: 0, counter: 0 },
    { name: "counter wraps at 12", row: 3, prev: 3, counter: 11 },
    { name: "selection moved down", row: 2, prev: 1, counter: 5 },
    { name: "selection moved up", row: 0, prev: 5, counter: 7 },
    { name: "GPU busy skips the blit", row: 4, prev: 1, counter: 2, breakDraw: -1 },
    { name: "interrupted chain resumes", row: 1, prev: 1, counter: 3, breakDraw: 0x00123456 },
    { name: "idle poll spins", row: 2, prev: 0, counter: 9, syncBusy: 3 },
    { name: "zero-width rectangle", row: 1, prev: 0, counter: 1, w: 0 },
    { name: "debug level 2 dispatch", row: 1, prev: 0, counter: 4, debug: 2 },
];

test("commandMenuVsyncBlit matches F0x8009ABD8 with the resident ClearOTag and SetDrawMove", () => {
    const rt = runtime();
    for (const c of CASES) {
        seed(rt, c);
        LOG.length = 0;
        rt.cpu.call(0x8009abd8, [MENU], 200000);
        const olog = LOG.slice();
        const ofields = snapshot(rt);

        seed(rt, c);
        LOG.length = 0;
        commandMenuVsyncBlit(rt.mem, MENU, portHost(rt));
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.deepEqual(snapshot(rt), ofields, `${c.name}: fields`);
    }
});

test("clearOtag and setDrawMove match F0x80025C8C and F0x8002918C", () => {
    const rt = runtime();
    for (const count of [1, 2, 5]) {
        for (const debug of [0, 1, 2]) {
            const run = (translated) => {
                for (let i = 0; i < 8; i++) rt.mem.write32(0x80160000 + i * 4, 0xab000000 | i);
                rt.mem.write32(TERMINATOR, 0);
                rt.mem.write8(DEBUG_LEVEL, debug);
                rt.mem.write32(DEBUG_DISPATCH, DEBUG_STUB);
                LOG.length = 0;
                const ret = translated
                    ? clearOtag(rt.mem, 0x80160000, count, { debugDispatch: (a, b, n) => LOG.push(["debug", a >>> 0, b >>> 0, n | 0]) })
                    : rt.cpu.call(0x80025c8c, [0x80160000, count], 20000);
                const words = Array.from({ length: 8 }, (_, i) => rt.mem.read32(0x80160000 + i * 4) >>> 0);
                return { ret: ret >>> 0, words, term: rt.mem.read32(TERMINATOR) >>> 0, log: LOG.slice() };
            };
            assert.deepEqual(run(true), run(false), `ClearOTag count ${count} debug ${debug}`);
        }
    }
    for (const [w, h, x, y] of [[12, 12, 0x11, 0x6e], [0, 12, 1, 2], [12, 0, -3, 0x1ff], [156, 12, 0x8000, -1]]) {
        const run = (translated) => {
            for (let i = 0; i < 8; i++) rt.mem.write32(0x80161000 + i * 4, 0xcd000000 | i);
            rt.mem.write16(0x80162000, 0x90);
            rt.mem.write16(0x80162002, 0xf4);
            rt.mem.write16(0x80162004, w);
            rt.mem.write16(0x80162006, h);
            if (translated) setDrawMove(rt.mem, 0x80161000, 0x80162000, x, y);
            else rt.cpu.call(0x8002918c, [0x80161000, 0x80162000, x, y], 20000);
            return Array.from({ length: 8 }, (_, i) => rt.mem.read32(0x80161000 + i * 4) >>> 0);
        };
        assert.deepEqual(run(true), run(false), `SetDrawMove ${w}x${h} at ${x},${y}`);
    }
});
