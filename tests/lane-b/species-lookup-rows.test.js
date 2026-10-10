// Oracle: exe f0 (0x800134E8) over f1 (0x800134AC), the species getter every
// screen calls through [0x8005CCA0]. f1 walks the profile table by value0 and
// stops at `slti cur_idx, 0x34` (exe/f1.s:26), so it finds rows 0..51 only.
// The table itself is 55 rows long, and the walker's id bridge walks all 55.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    gameFormId, profileIndex, profileRecord, profileRowFormId, walkerIdOf,
} from "../../engine/dw3/ui/native/pause-status.ts";

const here = dirname(fileURLToPath(import.meta.url));
const resident = new Uint8Array(readFileSync(join(here, "../../web/assets/native/screens/resident.bin")));
const BASE = 0x80010000;
const mem = {
    read16: (a) => resident[a - BASE] | (resident[a - BASE + 1] << 8),
    read8: (a) => resident[a - BASE],
    read32: (a) => (resident[a - BASE] | (resident[a - BASE + 1] << 8)
        | (resident[a - BASE + 2] << 16) | (resident[a - BASE + 3] << 24)) >>> 0,
};
const TABLE = 0x8003ef5c, STRIDE = 0x58;

test("the getter cell is f0 in the disc's own resident image", () => {
    assert.equal(mem.read32(0x8005cca0), 0x800134e8);
});

test("the getter finds each of the first 52 rows by its own value0", () => {
    for (let row = 0; row < 52; row++) {
        const form = profileRowFormId(mem, row);
        assert.equal(profileRecord(mem, form), (TABLE + row * STRIDE) >>> 0, `row ${row}`);
    }
});

test("the last three forms have no record, as f1's 52-row scan leaves them", () => {
    for (const form of [468, 469, 470]) {
        assert.equal(profileIndex(mem, form), -1, `form ${form}`);
        assert.equal(profileRecord(mem, form), 0, `form ${form}`);
    }
});

test("the walker's id bridge still covers all 55 rows", () => {
    assert.deepEqual([53, 54, 55].map((id) => gameFormId(mem, id)), [468, 469, 470]);
    assert.deepEqual([468, 469, 470].map((form) => walkerIdOf(mem, form)), [53, 54, 55]);
});
