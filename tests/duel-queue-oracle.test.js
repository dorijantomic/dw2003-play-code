// Phase 4 oracle: engine/dw3/ui/duel-queue.ts must reproduce pro/cardgame's two
// queue services. The originals run through engine/native on the shipped
// pro_cardgame.bin + resident.bin with the factory stubbed; the announce service
// then calls the *shipped* fade-wash creator and slots, so the comparison also
// exercises the fade-wash ports it composes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    QUEUE_ANNOUNCE,
    QUEUE_ANNOUNCE_SLOT,
    QUEUE_GREY_BLOCK,
    QUEUE_GREY_FLAGS,
    applyQueuedGreyFlags,
    runQueuedAnnounce,
} from "../engine/dw3/ui/duel-queue.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const APPLY_GREY = 0x8009e62c;
const RUN_ANNOUNCE = 0x8009e560;
const ALLOC = 0x80014504;
const FADE_WASH_SPAN = 0x78;

const DUEL = 0x80194000;
const CTX = 0x80195000;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function seed(rt, o = {}) {
    for (let i = 0x300; i <= 0x310; i++) rt.mem.write8(DUEL + i, 0);
    for (let i = 0x49c; i <= 0x4b0; i++) rt.mem.write8(DUEL + i, 0x55);
    rt.mem.write8(DUEL + QUEUE_GREY_FLAGS, o.grey ?? 0);
    rt.mem.write8(DUEL + QUEUE_ANNOUNCE, o.announce ?? 0);
    rt.mem.write32(CTX + QUEUE_ANNOUNCE_SLOT, 0xdeadbeef);
}

function bytes(rt, base, len) {
    const out = [];
    for (let i = 0; i < len; i++) out.push(rt.mem.read8(base + i));
    return out;
}

function state(rt) {
    return {
        greyBlock: bytes(rt, DUEL + QUEUE_GREY_BLOCK, 15),
        greyFlags: rt.mem.read8(DUEL + QUEUE_GREY_FLAGS),
        announce: rt.mem.read8(DUEL + QUEUE_ANNOUNCE),
        slot: rt.mem.read32(CTX + QUEUE_ANNOUNCE_SLOT) >>> 0,
        fade: bytes(rt, rt.mem.read32(CTX + QUEUE_ANNOUNCE_SLOT) >>> 0, FADE_WASH_SPAN),
    };
}

test("applyQueuedGreyFlags matches F0x8009E62C", () => {
    for (const grey of [0, 1, 2, 3, 0xff]) {
        const a = runtime();
        seed(a, { grey });
        a.cpu.call(APPLY_GREY, [DUEL, CTX]);
        const b = runtime();
        seed(b, { grey });
        applyQueuedGreyFlags(b.mem, DUEL);
        assert.deepEqual(state(b), state(a), `grey ${grey}`);
        if (grey !== 0) {
            assert.equal(a.mem.read8(DUEL + QUEUE_GREY_FLAGS), 0);
            const expect = grey === 2 ? 1 : 0;
            for (let i = 0; i < 15; i++) {
                assert.equal(a.mem.read8(DUEL + QUEUE_GREY_BLOCK + i), expect, `byte ${i}`);
            }
        }
    }
});

test("runQueuedAnnounce matches F0x8009E560 over the announce table", () => {
    // every record the table holds: kind 0 is the no-op, 1..18 the records
    for (const announce of [0, 1, 2, 3, 4, 5, 6, 12, 18, 19, 0xff]) {
        const evA = [];
        const a = runtime();
        a.cpu.setStub(ALLOC, (c) => {
            evA.push(["alloc", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]);
            return a.world.alloc(c.reg(4) >>> 0, c.reg(5), c.reg(6), 0);
        });
        seed(a, { announce });
        a.cpu.call(RUN_ANNOUNCE, [DUEL, CTX]);

        const evB = [];
        const b = runtime();
        seed(b, { announce });
        runQueuedAnnounce(b.mem, {
            allocate: (h, s, e) => {
                evB.push(["alloc", h >>> 0, s >>> 0, e >>> 0]);
                return b.world.alloc(h >>> 0, s, e, 0);
            },
        }, DUEL, CTX);

        assert.deepEqual(state(b), state(a), `announce ${announce}`);
        assert.deepEqual(evB, evA, `announce ${announce} factory`);
        assert.equal(b.mem.read8(DUEL + QUEUE_ANNOUNCE), 0, "the queue byte is cleared");
    }
});

test("the announce object's ramp is the shipped fade-wash behaviour", () => {
    // kind 4 is the one holding a 15-frame ramp; kinds 1..18 with kind byte 2
    for (const announce of [1, 2, 4, 5]) {
        const a = runtime();
        a.cpu.setStub(ALLOC, (c) => a.world.alloc(c.reg(4) >>> 0, c.reg(5), c.reg(6), 0));
        seed(a, { announce });
        a.cpu.call(RUN_ANNOUNCE, [DUEL, CTX]);
        const obj = a.mem.read32(CTX + QUEUE_ANNOUNCE_SLOT) >>> 0;
        const record = 0x800a5d14 + (announce - 1) * 4;
        const kind = a.mem.read8(record + 3);
        assert.equal(a.mem.read8(obj + 0x5c), kind, "the kind became the mode byte");
        assert.equal(a.mem.read32(obj + 0x50), 1, "the ramp is armed");
        assert.equal(a.mem.read32(obj + 0x58), kind === 2 ? 0xf : 0xa, "the ramp length");
        assert.equal(a.mem.read8(obj + 0x5d), 1, "hold is set");
        assert.equal(a.mem.read8(obj + 0x5e), 0, "the target is black");
        assert.equal(a.mem.read8(obj + 0x64), a.mem.read8(record), "the start colour is the record's red");
        assert.equal(a.mem.read8(obj + 0x65), a.mem.read8(record + 1));
        assert.equal(a.mem.read8(obj + 0x66), a.mem.read8(record + 2));
    }
});
