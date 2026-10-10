// Lane B Phase 4 oracle: engine/dw3/ui/native/map-server.ts must match the
// original pro/ststatus body F0x8009A670.
//
// The original runs through engine/native on the shipped pro_ststatus.bin +
// resident.bin, with the stage-id cell seeded on both sides; the returned value
// is compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { mapServerFromStage, MAP_SERVER_STAGE_CELL } from "../../engine/dw3/ui/native/map-server.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const name = new Uint8Array(readFileSync(join(dir, "pro_ststatus.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: name.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const MAP_SERVER_FN = 0x8009a670;

test("mapServerFromStage matches F0x8009A670", () => {
    const rt = new NativeStageRuntime(name, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    const stages = [0, 1, 0x100, 0x26f, 0x270, 0x271, 0x2d6, 0x2d7, 0x2d8, 0xffff, 0xffffffff];
    for (const stage of stages) {
        rt.mem.write32(MAP_SERVER_STAGE_CELL, stage >>> 0);
        const oret = rt.cpu.call(MAP_SERVER_FN, [], 4000) | 0;
        const pret = mapServerFromStage(rt.mem) | 0;
        assert.equal(pret, oret, `stage ${stage >>> 0}`);
    }
});
