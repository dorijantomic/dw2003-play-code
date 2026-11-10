// One resident pack table, not five. The battle screens that draw the same chrome and glyph packs
// take the names from resident-data.js; the two keys of each map are the only two the disc uses here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RESIDENT_PACK_NAMES, RESIDENT_PACKS } from "../web/resident-data.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The five screens that shared the copy (card 19), by their source path.
const SCREENS = [
    "web/battletag-translated.js",
    "web/battleform-translated.js",
    "web/battletech-translated.js",
    "web/battledna-translated.js",
    "web/battleitem-translated.js",
];

test("the shared maps name the resident glyphs and the battle chrome", () => {
    assert.deepEqual(RESIDENT_PACK_NAMES, { 0x02860000: "cmfont", 0x04550000: "pgfgc00" });
    assert.deepEqual(RESIDENT_PACKS, { 646: "cmfont", 1109: "pgfgc00" });
});

test("the directory word and the disc index name the same pack", () => {
    for (const [index, name] of Object.entries(RESIDENT_PACKS)) {
        const directory = Number(index) << 16;
        assert.equal(RESIDENT_PACK_NAMES[directory], name, `${index} and ${directory} disagree`);
    }
});

test("every screen takes the maps from resident-data and declares neither", () => {
    for (const rel of SCREENS) {
        const src = readFileSync(join(root, rel), "utf8");
        assert.match(src, /RESIDENT_PACK_NAMES, RESIDENT_PACKS \} from "\.\/resident-data\.js"/, `${rel} does not import the shared maps`);
        assert.doesNotMatch(src, /^const PACK_NAMES =/m, `${rel} still declares PACK_NAMES`);
        assert.doesNotMatch(src, /^const PACKS =/m, `${rel} still declares PACKS`);
        assert.match(src, /packs: RESIDENT_PACKS/, `${rel} does not pass the shared pack index table`);
        assert.match(src, /RESIDENT_PACK_NAMES\[directory >>> 0\]/, `${rel} does not resolve the directory word`);
    }
});
