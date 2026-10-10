// Lane B Phase 4 oracle: engine/dw3/ui/native/cnty-creators.ts must match the
// original pro/cnty_sel object creators F0x80084394 / F0x800832D8 / F0x80083804 /
// F0x80083A68 / F0x80083CEC.
//
// Each original runs through engine/native on the shipped pro_cnty_sel.bin +
// resident.bin with F0x80014504 stubbed on both sides, comparing the allocator
// request and the returned pointer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    countrySelectRootCreate,
    countrySelectFadeCreate,
    countrySelectLeftCreate,
    countrySelectRightCreate,
    countrySelectBottomCreate,
} from "../../engine/dw3/ui/native/cnty-creators.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const name = new Uint8Array(readFileSync(join(dir, "pro_cnty_sel.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: name.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const ALLOC_FN = 0x80014504;
const OBJ = 0x80150000;

function runtime() {
    const rt = new NativeStageRuntime(name, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    return rt;
}

const CASES = [
    { name: "root", fn: 0x80084394, port: (h) => countrySelectRootCreate(h) },
    { name: "fade", fn: 0x800832d8, port: (h) => countrySelectFadeCreate(h) },
    { name: "left", fn: 0x80083804, port: (h) => countrySelectLeftCreate(h) },
    { name: "right", fn: 0x80083a68, port: (h) => countrySelectRightCreate(h) },
    { name: "bottom", fn: 0x80083cec, port: (h) => countrySelectBottomCreate(h) },
];

test("country-select creators match the original thunks", () => {
    const rt = runtime();
    const calls = [];
    rt.cpu.setStub(ALLOC_FN, (c) => {
        calls.push([c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]);
        return OBJ;
    });

    for (const c of CASES) {
        calls.length = 0;
        const oret = rt.cpu.call(c.fn, [], 20000);
        const ocalls = calls.slice();

        calls.length = 0;
        const pret = c.port({ alloc(cb, size, extra) { calls.push([cb >>> 0, size | 0, extra | 0]); return OBJ; } });

        assert.deepEqual(calls, ocalls, `${c.name}: alloc args`);
        assert.equal(pret >>> 0, oret >>> 0, `${c.name}: returned pointer`);
    }
});
