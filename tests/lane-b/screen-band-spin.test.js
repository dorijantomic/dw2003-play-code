// Proves the shared band spin helper (engine/dw3/ui/native/screen-band-spin.ts)
// keeps the counter the three chrome draws used to inline: +0x5C paces one step
// every other call, +0x58 advances 0..0x5F then holds, and clip 8 is drawn at
// (spin, spin) every call. Invented numbers only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BAND_SPIN_LIMIT, BAND_SPIN_CLIP, screenBandSpin } from "../../engine/dw3/ui/native/screen-band-spin.ts";

const OBJ = 0x80150000;
const PACK_HANDLE = 0x0fd40000;
const PACK_PTR = 0x80190000;

function makeMem(seed) {
    const words = new Map(Object.entries(seed));
    return {
        reads: [],
        writes: [],
        read32(addr) {
            this.reads.push(addr);
            return words.get(String(addr)) | 0;
        },
        write32(addr, value) {
            this.writes.push([addr, value | 0]);
            words.set(String(addr), value | 0);
        },
        get(addr) {
            return words.get(String(addr)) | 0;
        },
    };
}

function makeHost() {
    return {
        draws: [],
        drawSprite(packPtr, clip, x, y) {
            this.draws.push([packPtr, clip, x, y]);
        },
        packResolve(handle) {
            return handle === PACK_HANDLE ? PACK_PTR : 0;
        },
    };
}

test("the toggle paces the counter: an idle call only flips +0x5C", () => {
    const mem = makeMem({ [OBJ + 0x58]: 5, [OBJ + 0x5c]: 0 });
    const host = makeHost();
    screenBandSpin(mem, OBJ, PACK_HANDLE, host);
    assert.equal(mem.get(OBJ + 0x58), 5, "counter untouched on the off call");
    assert.equal(mem.get(OBJ + 0x5c), 1, "toggle set");
    assert.deepEqual(host.draws, [[PACK_PTR, BAND_SPIN_CLIP, 5, 5]]);
});

test("an armed call steps the counter and clears the toggle", () => {
    const mem = makeMem({ [OBJ + 0x58]: 5, [OBJ + 0x5c]: 1 });
    const host = makeHost();
    screenBandSpin(mem, OBJ, PACK_HANDLE, host);
    assert.equal(mem.get(OBJ + 0x58), 6);
    assert.equal(mem.get(OBJ + 0x5c), 0);
    assert.deepEqual(host.draws, [[PACK_PTR, BAND_SPIN_CLIP, 6, 6]]);
});

test("the counter stops at the limit instead of running on", () => {
    const mem = makeMem({ [OBJ + 0x58]: BAND_SPIN_LIMIT - 1, [OBJ + 0x5c]: 1 });
    const host = makeHost();
    screenBandSpin(mem, OBJ, PACK_HANDLE, host);
    assert.equal(mem.get(OBJ + 0x58), 0, "past the limit the step wraps to 0");
    assert.deepEqual(host.draws, [[PACK_PTR, BAND_SPIN_CLIP, 0, 0]]);
});

test("repeated calls alternate and never pass the limit", () => {
    const mem = makeMem({ [OBJ + 0x58]: 0, [OBJ + 0x5c]: 0 });
    const host = makeHost();
    for (let i = 0; i < 8; i++) screenBandSpin(mem, OBJ, PACK_HANDLE, host);
    assert.deepEqual(host.draws.map((d) => d[2]), [0, 1, 1, 2, 2, 3, 3, 4]);
    assert.ok(host.draws.every((d) => d[1] === BAND_SPIN_CLIP && d[2] === d[3]));
});
