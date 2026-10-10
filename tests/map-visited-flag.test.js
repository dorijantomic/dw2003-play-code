// The pause-menu MAP page's revealed-location markers, and where they come from.
//
// The original has ONE store. Every field entry sets a bit for the place you
// walked into — pro/fieldstg.s .L0x00008008-.L0x00008028: the screen-id getter,
// `addiu $a0, $v0, 0x1e00`, then set_flag with $a1 = 1 — and the MAP page reads
// the same bits back through get_flag(0x2000 | (id & 0xff), 1)
// (F0x8009A6B8, exe-decomp/ststatus_c/F0x8009a6b8.c:21). For the field screen
// ids 0x200..0x2D6 those two spellings are the same number, because
// 0x1E00 + id == 0x2000 | (id & 0xff) over that whole range.
//
// The walker used to keep a parallel list (`visitedMaps` in localStorage) for the
// same question. These tests drive the real chain: the engine's field entry (the
// writer) -> the browser adapter the page is handed -> the page's own port of the
// scan (F0x8009A6B8) -> the marker table it fills.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// menu.js fetches its decoded layout (assets/data/status_ui.json) at import time,
// so serve the real file from disk and import the module afterwards.
globalThis.fetch = async (url) => ({
    json: async () => JSON.parse(readFileSync(`web/${String(url)}`, "utf8")),
});
if (typeof globalThis.localStorage === "undefined") {
    const mem = Object.create(null);
    globalThis.localStorage = {
        getItem: (k) => (k in mem ? mem[k] : null),
        setItem: (k, v) => { mem[k] = String(v); },
        removeItem: (k) => { delete mem[k]; },
    };
}
if (typeof globalThis.window === "undefined") globalThis.window = globalThis;

const { GameEngine } = await import("../engine/index.ts");
const { PauseRootSession } = await import("../engine/dw3/ui/pause-root-session.ts");
const { pauseMapContext, mapPs1Id, mapSeenFlag, migrateVisitedMaps } = await import("../web/menu.js");
const { mapSeenReader } = await import("../web/status-translated.js");
const { pauseResources, pauseSeed } = await import("./helpers/pause-resources.js");
await new Promise((r) => setTimeout(r, 50)); // let the layout fetch land

const table = JSON.parse(readFileSync("data/screen_table.json", "utf8"));
const content = JSON.parse(readFileSync("web/assets/engine-content.json", "utf8"));
const walkerMap = JSON.parse(readFileSync("web/assets/data/status_ui.json", "utf8")).screens.map.walker_map;

/** The engine the browser builds: the banked store plus the decoded screen table. */
const startedEngine = () => new GameEngine(content, { screenTable: table });
/** How web/game.js reads one flag out of it. */
const flagReader = (engine) => (id) => engine.state.flags.get(id, 1);

test("the MAP page marks a place through the flag store, with no parallel list", () => {
    const engine = startedEngine();
    // Three arrivals, the field's own writer each time.
    for (const stage of ["s696", "s716", "s780"]) engine.loadStage(stage);
    // The player's save has no legacy marker list at all — a save written by this build.
    const state = { manifest: { maps: [{ id: "s780" }] }, mapIdx: 0, visitedMaps: new Set() };
    const context = pauseMapContext(state, undefined, flagReader(engine));

    assert.equal(mapPs1Id(state), 0x2d7, "s780 is screen 0x2d7");
    for (const stage of ["696", "716"]) {
        const ps1 = walkerMap[stage].ps1;
        assert.ok(context.seen.includes(ps1), `s${stage} (screen 0x${ps1.toString(16)}) is marked`);
    }
    // The page's own reader: the flag id the original asks for, out of the same store.
    const seen = mapSeenReader(context);
    for (const stage of ["696", "716", "780"]) {
        const ps1 = walkerMap[stage].ps1;
        assert.equal(seen(mapSeenFlag(ps1)), true, `mapSeen(0x${mapSeenFlag(ps1).toString(16)})`);
    }
    assert.equal(seen(mapSeenFlag(walkerMap["200"].ps1)), false, "a place never entered stays unmarked");
    // The whole decoded field table agrees: entry writes exactly the id the page reads.
    for (const [id, rec] of Object.entries(table)) {
        engine.state.flags.set(0x1e00 + Number(id), false);
        engine.loadStage(`s${rec.stage}`);
        assert.equal(
            engine.state.flags.get(mapSeenFlag(Number(id)), 1),
            true,
            `screen ${id} is marked by the write the page reads`,
        );
    }
});

test("a place walked into earlier lights its marker on the page", () => {
    const engine = startedEngine();
    engine.loadStage("s780"); // 0x2d7 — the page's own server
    engine.loadStage("s696"); // 0x2ca — walked into earlier this session
    // The whole chain the player sees: field entry writes the bit, the browser adapter
    // hands the page a reader, the page's own scan fills its marker table.
    const state = { manifest: { maps: [{ id: "s780" }] }, mapIdx: 0, visitedMaps: new Set() };
    const reader = mapSeenReader(pauseMapContext(state, undefined, flagReader(engine)));
    const stage = walkerMap["780"].ps1;
    const session = new PauseRootSession(2, pauseSeed("map", { stage, mapSeen: (id) => (reader(id) ? 1 : 0) }),
        pauseResources(2), { playSound: () => {} });
    for (let i = 0; i < 300 && !session.finished(); i++) session.tick([]);
    const obj = session.pageObject();
    const zones = (slot) => session.mem.read32(obj + 0xa8 + slot * 4);
    // The disc's stage->marker row table at 0x8009b5fc; the scan writes slot row & 0x7f.
    const rowOf = (ps1) => session.mem.read8(0x8009b5fc + (ps1 & 0xff)) & 0x7f;
    assert.equal(zones(rowOf(0x2ca)), 1, "the place you walked into earlier is marked");
    assert.equal(zones(rowOf(0x2ce)), 0, "and a place you never entered is not");
});

test("an old save's marker list becomes the same flags, once", () => {
    const engine = startedEngine();
    const written = [];
    const store = {
        get: (id) => engine.state.flags.get(id, 1),
        set: (id, value) => {
            written.push(id);
            engine.state.flags.set(id, value);
        },
    };
    // A save from the build that kept `visitedMaps`: three places, one bogus id.
    const visited = [200, 696, 780, 9999];
    migrateVisitedMaps(visited, table, store);
    assert.deepEqual(written, [0x2000, 0x20ca, 0x20d7], "9999 is not a field screen, so it is dropped");
    for (const id of written) assert.equal(engine.state.flags.get(id, 1), true);
    // Already-marked places are not written again, so a returning player's save does
    // not churn and the migration cannot clear a bit the field wrote.
    written.length = 0;
    migrateVisitedMaps(visited, table, store);
    assert.deepEqual(written, []);
    // A place the old list does not have stays clear.
    assert.equal(engine.state.flags.get(mapSeenFlag(walkerMap["716"].ps1), 1), false);
});