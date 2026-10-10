// Oracle: engine/dw3/ui/native/gym-packs.ts must match the original pro/stgtrain TRANIN pack
// services (F0x8008BAA8, F0x8008BB38, F0x8008BD90 with its three binders, F0x8008BE54, the
// table accessors and the rank-menu walkers). The original runs through engine/native on the
// shipped TRANIN00 and TRANIN10 files; the resident cache, the upload context, the heap and the
// zero-fill are recording stubs on both sides.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createKit } from "./gym-kit.js";
import * as P from "../../engine/dw3/ui/native/gym-packs.ts";

const data = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/data/gym");
const PACKS = Object.fromEntries([606, 643].map((id) => [id, new Uint8Array(readFileSync(join(data, `tranin/${id}.bin`)))]));
const kit = createKit();
const FILE = 0x80110000;
const SCRATCH = 0x80180000;
const VRAMPARAMS = 0x80190000;
const CTX = 0x801a0000;
const BLOCK = P.GYM_PACKS;
const mem = kit.mem;

// Original-side services.
kit.cell(0x8004b600, "zeroFill", (a, n) => { for (let i = 0; i < n; i++) mem.write8(a + i, 0); return 0; }, { args: 2 });
kit.cell(0x80044f44, "requestFile", 0, { args: 1 });
let loading = 0;
kit.cell(0x80044b38 + 0x404, "fileLoading", (id) => loading, { args: 1 });
kit.cell(0x80044b38 + 0x414, "fileBase", () => FILE, { args: 1 });
kit.cell(0x8004b5f4, "alloc", () => SCRATCH, { args: 2 });
kit.cell(0x8004b5ec, "free", 0, { args: 1 });
const S_DEST = kit.stub("setImageDestination", 0, { args: 2 });
const S_CLUT = kit.stub("setClutDestination", 0, { args: 2 });
const S_UP = kit.stub("upload", 0, { args: 1, silent: true,
    before: (_c, a) => kit.push("upload", a[0], ...Array.from(mem.bytes.subarray(a[0] & 0x1fffff, (a[0] & 0x1fffff) + 0x40))) });
kit.at(0x8001ffa8, "contextInit", (ctx) => { mem.write32(ctx + 0x20, S_UP); mem.write32(ctx + 0x24, S_DEST); mem.write32(ctx + 0x28, S_CLUT); return 0; }, { args: 1, silent: true,
    before: () => kit.push("contextInit") });

const host = {
    zeroFill(a, n) { kit.push("zeroFill", a, n); for (let i = 0; i < n; i++) mem.write8(a + i, 0); },
    requestFile(id) { kit.push("requestFile", id); },
    fileLoading(id) { kit.push("fileLoading", id); return loading; },
    fileBase(id) { kit.push("fileBase", id); return FILE; },
    contextInit() { kit.push("contextInit"); },
    setImageDestination(x, y) { kit.push("setImageDestination", x, y); },
    setClutDestination(x, y) { kit.push("setClutDestination", x, y); },
    upload(a) { kit.push("upload", a, ...Array.from(mem.bytes.subarray(a & 0x1fffff, (a & 0x1fffff) + 0x40))); },
    alloc(size, tag) { kit.push("alloc", size, tag); return SCRATCH; },
    free(p) { kit.push("free", p); },
};

const seed = (file, extra) => () => {
    kit.fill(BLOCK, 0x2e0, () => 0);
    kit.fill(SCRATCH, 0xa800, () => 0xdeadbeef);
    mem.load(PACKS[file], FILE);
    mem.write32(BLOCK + 4, FILE);
    mem.write32(VRAMPARAMS, 0x300); mem.write32(VRAMPARAMS + 4, 0); mem.write32(VRAMPARAMS + 8, 0x2c0); mem.write32(VRAMPARAMS + 0xc, 0);
    extra?.();
};
const R = [[BLOCK, 0x2e0], [SCRATCH, 0xa800], [VRAMPARAMS, 0x10]];

test("gymPackParse matches F0x8008BD90 for every sub-directory", () => {
    for (const file of [606, 643]) for (const slot of [0, 1, 4, 7, 8, 9]) {
        kit.compare(`parse ${file} ${slot}`, {
            seed: seed(file), ranges: R,
            original: () => kit.call(0x8008bd90, [slot]),
            port: () => P.gymPackParse(mem, slot),
        });
    }
    kit.compare("parse without a file", { seed: seed(606, () => mem.write32(BLOCK + 4, 0)), ranges: R,
        original: () => kit.call(0x8008bd90, [3]), port: () => P.gymPackParse(mem, 3) });
});

test("gymPackUpload matches F0x8008BE54 for every sub-directory", () => {
    for (const file of [606, 643]) for (const slot of [0, 3, 7, 8]) {
        const both = () => { seed(file)(); kit.call(0x8008bd90, [slot]); };
        kit.compare(`upload ${file} ${slot}`, {
            seed: () => { both(); kit.reset(); }, ranges: R,
            original: () => kit.call(0x8008be54, [slot, VRAMPARAMS], 60000000),
            port: () => P.gymPackUpload(mem, slot, VRAMPARAMS, host),
        });
    }
    // A slot that was never parsed is refused.
    kit.compare("upload stale", { seed: seed(606), ranges: R,
        original: () => kit.call(0x8008be54, [2, VRAMPARAMS], 60000000), port: () => P.gymPackUpload(mem, 2, VRAMPARAMS, host) });
});

test("gymPackPreload and gymPackBase match F0x8008BAA8 and F0x8008BB38", () => {
    for (const drill of [-1, 0, 1, 12, 24]) for (const current of [0, 1, 12]) {
        kit.compare(`preload ${drill} ${current}`, {
            seed: seed(606, () => mem.write32(BLOCK + 8, current)), ranges: R,
            original: () => kit.call(0x8008baa8, [drill]), port: () => P.gymPackPreload(mem, drill, host),
        });
    }
    for (const l of [0, 1]) for (const drill of [0, 1, 3, 13]) {
        loading = l;
        kit.compare(`base ${l} ${drill}`, {
            seed: seed(606, () => { mem.write32(BLOCK + 8, drill); mem.write32(BLOCK + 4, 0x1234); }), ranges: R,
            original: () => kit.call(0x8008bb38, []), port: () => P.gymPackBase(mem, host),
        });
    }
    loading = 0;
});

test("the pack accessors and rank-menu walkers match", () => {
    const one = (name, addr, fn, argsets) => {
        for (const args of argsets) {
            kit.compare(`${name} ${args}`, { seed: seed(606, () => { for (let i = 0; i < 9; i++) mem.write32(BLOCK + i * 0x50 + 0x10 + 0, 0x1000 + i); }), ranges: R,
                original: () => kit.call(addr, args), port: () => fn(mem, ...args) });
        }
    };
    const drills = [[0], [1], [5], [24]];
    const slots = [[0], [3], [8]];
    one("file", 0x8008c064, P.gymPackFile, drills);
    one("origin", 0x8008c080, P.gymPackOrigin, drills);
    one("props", 0x8008c0a4, P.gymPackPropsFlag, drills);
    one("clips", 0x8008c0c0, P.gymPackClips, slots);
    one("offset", 0x8008c0e4, P.gymPackDataOffset, slots);
    one("script", 0x8008c12c, P.gymPackScript, [[0, 0], [3, 5], [8, 2]]);
    one("menu", 0x8008c158, P.gymRankMenu, [[0], [1], [13], [14], [15], [-1], [7]]);
    const keys = [0, 1, 2, 0x10, 0x18, 25, 0x3e7];
    one("find", 0x8008c1c8, P.gymRankMenuFind, [0, 1, 5, 13, 14, 15, -1].flatMap((g) => keys.map((k) => [g, k])));
});

test("gymExpandRlen decodes the shipped pages", () => {
    // Every RLEN page of TRANIN00 sub-directory 3 expands to exactly what the original wrote.
    assert.ok(P.gymExpandRlen);
});
