// B040: the MAP page's marker for a place is record place + 1 of the marker table 0x8009AB60 (record 0 is a blank).
// F0x8009a698 gives the place (byte table 0x8009B5FC & 0x7F); F0x8009913c puts the arrow on `(place + 1) * 0xC`;
// F0x8009a6b8 fills visit slot `place` and F0x80098b84 draws record slot + 1; the hover name is string id = record.
// status_ui.json screens.map.markers keeps records 1..46 with `loc` = the record number, so the place's marker is the
// record whose loc is place + 1 (web/menu/pure.js mapMarkerRecord), not markers[place - 1].
// Real data (web/assets) is needed: the test skips when it is not there.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

const UI_FILE = "web/assets/data/status_ui.json";
const have = existsSync(UI_FILE);

globalThis.fetch = async (url) => ({ json: async () => JSON.parse(readFileSync(`web/${String(url)}`, "utf8")) });
if (typeof globalThis.localStorage === "undefined") {
    const mem = Object.create(null);
    globalThis.localStorage = {
        getItem: (k) => (k in mem ? mem[k] : null),
        setItem: (k, v) => { mem[k] = String(v); },
        removeItem: (k) => { delete mem[k]; },
    };
}
if (typeof globalThis.window === "undefined") globalThis.window = globalThis;

const { mapMarkerRecord } = await import("../web/menu/pure.js");

test("a place number points at marker record place + 1", () => {
    assert.equal(mapMarkerRecord(0), 1);
    assert.equal(mapMarkerRecord(19), 20);
    assert.equal(mapMarkerRecord(45), 46);
});

test("known stages land on their own marker and name (s202 Asuka City, s720 Legendary Gym, s495 South Cape)", { skip: !have }, () => {
    const M = JSON.parse(readFileSync(UI_FILE, "utf8")).screens.map;
    assert.equal(M.markers.length, 46, "records 1..46 (the blank record 0 is not kept)");
    M.markers.forEach((r, i) => assert.equal(r.loc, i + 1, "loc = record number"));
    for (const [stage, name] of [["202", "Asuka City"], ["720", "Legendary Gym"], ["495", "South Cape"], ["335", "Wire Forest Entrance"]]) {
        const wm = M.walker_map[stage];
        const rec = M.markers.find((r) => r.loc === mapMarkerRecord(wm.loc));
        assert.ok(rec, `s${stage} has a marker`);
        assert.equal(M.location_names.asuka[rec.loc], name, `s${stage} (place ${wm.loc}) -> record ${rec.loc}`);
    }
    // s202 Asuka City: place 19 -> record 20 at (186, 119); the old markers[place - 1] was record 19 (South Cape, 158, 223)
    const asuka = M.markers.find((r) => r.loc === mapMarkerRecord(M.walker_map["202"].loc));
    assert.deepEqual([asuka.x, asuka.y], [186, 119]);
});

test("the MAP pane opens with the cursor on record place + 1 (s202 -> Asuka City)", { skip: !have }, async () => {
    const { _drawMapPane } = await import("../web/menu/draw-map.js");
    const { MS } = await import("../web/menu/state.js");
    MS.UI ??= JSON.parse(readFileSync(UI_FILE, "utf8"));
    const M = MS.UI.screens.map, C = M.cursor;
    // a do-nothing 2D context (every method returns a zero-width measure, so the font-less text path runs too)
    const ctx = new Proxy({}, { get: () => () => ({ width: 0 }) });
    const m = { mapInit: false, time: 0 };
    const state = { manifest: { maps: [{ id: "s202" }] }, mapIdx: 0, keys: new Set(), visitedMaps: [] };
    _drawMapPane(ctx, state, m, 0);
    const rec = M.markers.find((r) => r.loc === 20);
    // the init pans until the cursor reaches the arrow point record + 12 (unless the scroll limit stops the pan)
    assert.equal(m.mapCX - m.mapSX, rec.x + C.lock_offset);
    assert.equal(m.mapCY - m.mapSY, rec.y + C.lock_offset);
    assert.equal(m.mapHover, 20, "the cursor sits on the visited Asuka City marker, so the hover is record 20");
});
