// Phase 4 oracle: the engine/dw3 port of the resident party-context accessors
// must return exactly what the original EXE functions return for the same input.
// The resident image is loaded through engine/native (the interpreter), and each
// original address is called directly; this is the plan's "interpreter as oracle".

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    PARTY_MAP,
    partyPositionToRosterSlot,
    persistentRosterSlot,
} from "../engine/dw3/party-context.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

function runtime() {
    return new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
}

test("partyPositionToRosterSlot matches the interpreter (F0x80016D94)", () => {
    const rt = runtime();
    const map = [3, 5, 0, 0xffffffff, 9];
    for (let i = 0; i < map.length; i++) rt.mem.write32(PARTY_MAP + i * 4, map[i] >>> 0);
    for (let pos = 0; pos < 6; pos++) {
        const oracle = rt.cpu.call(0x80016d94, [pos]) | 0;
        assert.equal(partyPositionToRosterSlot(rt.mem, pos), oracle, `position ${pos}`);
    }
});

test("persistentRosterSlot matches the interpreter (F0x80017B4C)", () => {
    const rt = runtime();
    for (let slot = 0; slot < 8; slot++) {
        const oracle = rt.cpu.call(0x80017b4c, [slot]) >>> 0;
        assert.equal(persistentRosterSlot(slot), oracle, `slot ${slot}`);
    }
});
