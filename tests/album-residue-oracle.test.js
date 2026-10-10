// Phase 4 oracle: engine/dw3/ui/album-residue.ts's two bodies must match
// pro/stcrdabm F0x80083734 (album_page_has_collected) and F0x8008304C
// (album_grid_draw_faces). Both originals run through engine/native on the
// shipped pro_stcrdabm.bin + resident.bin with the view-context builder, its
// five methods and the collection table stubbed; the ports run against the same
// memory and a host that logs the identical call stream.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    ALBUM_FACE_CLIP, ALBUM_FACE_PAIR_A, ALBUM_FACE_PAIR_B, ALBUM_PAGE_CELLS,
    albumGridDrawFaces, albumPageHasCollected,
} from "../engine/dw3/ui/album-residue.ts";
import { ALBUM_CARD_MAX, ALBUM_COLLECTION_BYTE, ALBUM_COLLECTION_TABLE } from "../engine/dw3/ui/native/album-grid.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stcrdabm.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777, playPackedSound() {} });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const HAS_COLLECTED = 0x80083734;
const DRAW_FACES = 0x8008304c;
const GRID = 0x80155000;
const CTX_FILL = 0x8001ebf8;
const S = {
    init: 0x0fe02000,
    resolve: 0x0fe02004,
    commit: 0x0fe02008,
    set4: 0x0fe0200c,
    setC: 0x0fe02010,
    view: 0x0fe02014,
};

let EVENTS = [];

const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
    image: resident,
    base: 0x80010000,
});

rt.cpu.setStub(CTX_FILL, (c) => {
    EVENTS.push(["init", c.reg(4) | 0]);
    const ctx = (c.reg(4) | 0) >>> 0;
    rt.mem.write32(ctx + 0x2c, S.resolve);
    rt.mem.write32(ctx + 0x30, S.commit);
    rt.mem.write32(ctx + 0x3c, S.set4);
    rt.mem.write32(ctx + 0x40, S.setC);
    rt.mem.write32(ctx + 0x44, S.view);
    return 0;
});
rt.cpu.setStub(S.resolve, (c) => { EVENTS.push(["card", c.reg(4) | 0]); return 0; });
rt.cpu.setStub(S.commit, () => { EVENTS.push(["commit"]); return 0; });
rt.cpu.setStub(S.set4, (c) => { EVENTS.push(["set4", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
rt.cpu.setStub(S.setC, (c) => { EVENTS.push(["setC", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
rt.cpu.setStub(S.view, (c) => { EVENTS.push(["view", c.reg(4) | 0, c.reg(5) | 0]); return 0; });

// A deterministic collection table: these cards were ever held.
for (const card of [5, 12, 100, 250]) {
    rt.mem.write8(ALBUM_COLLECTION_TABLE + card + ALBUM_COLLECTION_BYTE, 1);
}

const portHost = {
    initTextContext() { EVENTS.push(["init", 0]); },
    setCurrentObject4_8(x, y) { EVENTS.push(["set4", x | 0, y | 0]); },
    setCurrentObjectC_10(x, y) { EVENTS.push(["setC", x | 0, y | 0]); },
    resolveCardRecord(card) { EVENTS.push(["card", card | 0]); },
    setCurrentViewSize(col, row) { EVENTS.push(["view", col | 0, row | 0]); },
    commitCurrentView() { EVENTS.push(["commit"]); },
};

// The context-init log entry carries the original's stack address; both sides
// are normalised to the marker above so the call order is what is compared.
function normalise(events) {
    return events.map((e) => e.map((v, i) => (e[0] === "init" && i === 1 ? 0 : v | 0)));
}

function seed(base) {
    EVENTS = [];
    rt.mem.write32(GRID + 0x5c, base);
}

const HAS_CASES = [0, 1, 5, 11, 12, 99, 100, 302, 303, 304, 310, 312, 0x139, 0x13a, 0x13b, 0x200];
const FACE_CASES = [1, 5, 12, 100, 0x134, 0x136, 0x138, 0x139, 0x13a, 0x13b, 0x200];

test("albumPageHasCollected matches F0x80083734", () => {
    for (const base of HAS_CASES) {
        seed(base);
        const oracle = rt.cpu.call(HAS_COLLECTED, [GRID], 200000) | 0;
        seed(base);
        const ported = albumPageHasCollected(rt.mem, GRID) | 0;
        assert.equal(ported, oracle, `page base ${base}`);
    }
});

test("the collect scan's bounds and page length", () => {
    seed(13);
    assert.equal(albumPageHasCollected(rt.mem, GRID), 0, "an empty page of twelve");
    seed(5);
    assert.equal(albumPageHasCollected(rt.mem, GRID), 1, "a held card on the page");
    seed(101);
    assert.equal(albumPageHasCollected(rt.mem, GRID), 0, "the held card just below the page");
    seed(250);
    assert.equal(albumPageHasCollected(rt.mem, GRID), 1, "a held card further down the table");
    seed(303);
    assert.equal(albumPageHasCollected(rt.mem, GRID), 0, "the last full page, 303..314");
    // 310..314 are in range, so the out-of-range card 315 ends the page and the
    // body returns 1 without a flag read deciding it.
    seed(310);
    assert.equal(albumPageHasCollected(rt.mem, GRID), 1, "the short last page");
    seed(ALBUM_CARD_MAX);
    assert.equal(albumPageHasCollected(rt.mem, GRID), 1, "a page starting past the bound");
    assert.equal(ALBUM_PAGE_CELLS, 12);
});

test("albumGridDrawFaces matches F0x8008304C", () => {
    for (const base of FACE_CASES) {
        seed(base);
        rt.cpu.call(DRAW_FACES, [GRID], 200000);
        const oracle = normalise(EVENTS);

        seed(base);
        albumGridDrawFaces(rt.mem, GRID, portHost);
        const ported = normalise(EVENTS);

        assert.deepEqual(ported, oracle, `page base ${base}`);
    }
});

test("the face pass stages one twelve-cell sequence with the two literal pairs", () => {
    seed(1);
    albumGridDrawFaces(rt.mem, GRID, portHost);
    assert.deepEqual(EVENTS[0], ["init", 0]);
    assert.deepEqual(EVENTS[1], ["set4", ALBUM_FACE_PAIR_A, ALBUM_FACE_CLIP]);
    assert.deepEqual(EVENTS[2], ["setC", ALBUM_FACE_PAIR_B, ALBUM_FACE_CLIP]);
    const cells = EVENTS.filter((e) => e[0] === "card");
    assert.equal(cells.length, ALBUM_PAGE_CELLS, "twelve cells");
    assert.deepEqual(cells.map((e) => e[1]), Array.from({ length: 12 }, (_, i) => i + 1));
    const views = EVENTS.filter((e) => e[0] === "view");
    assert.deepEqual(views.map((e) => [e[1], e[2]]),
        [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1]],
        "six across then two down, the second row continuing the card counter");
    assert.equal(EVENTS.filter((e) => e[0] === "commit").length, 12, "one commit per cell");

    seed(0x139);
    EVENTS = [];
    albumGridDrawFaces(rt.mem, GRID, portHost);
    assert.equal(EVENTS.filter((e) => e[0] === "card").length, 2, "the short last page stops at the bound");
    assert.deepEqual(EVENTS.filter((e) => e[0] === "card").map((e) => e[1]), [0x139, 0x13a]);
});
