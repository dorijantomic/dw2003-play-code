// Card 14: one name-bytes encoder. Every screen borrows encodeNativeScreenText from web/name-bytes.js
// instead of carrying its own copy, and the shared one caps a name at 23 bytes (the roster record's field).
// web/native-screen.js re-exports it for the native screens; the translated ones import the home directly.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { encodeNativeScreenText } from "../web/name-bytes.js";

const src = (f) => readFileSync(new URL(`../web/${f}`, import.meta.url), "utf8");

const SCREENS = ["gym-translated.js", "lab-translated.js", "save-translated.js", "fightreport-translated.js", "shop-translated.js"];

test("the shared encoder is the roster record's codec and caps at 23 bytes", () => {
    assert.deepEqual(encodeNativeScreenText("7"), [0x04 + 7]);
    assert.deepEqual(encodeNativeScreenText("Az"), [0x0e + 0, 0x28 + 25]);
    assert.deepEqual(encodeNativeScreenText("!"), [0x01, 0x01]);
    assert.equal(encodeNativeScreenText("a".repeat(30)).length, 23);
    // a two-byte extended space may not straddle the cap
    assert.equal(encodeNativeScreenText(`${"a".repeat(22)}!`).length, 23);
});

test("no screen keeps a private copy of the codec", () => {
    for (const f of SCREENS) {
        const text = src(f);
        assert.doesNotMatch(text, /function encodeName\(/, `${f} still defines encodeName`);
        assert.doesNotMatch(text, /const encodeName = /, `${f} still defines encodeName`);
        assert.doesNotMatch(text, /function encodeGymName|export function encodeGymName/, `${f} still defines encodeGymName`);
        assert.match(text, /import \{ encodeNativeScreenText \} from "\.\/name-bytes\.js";/, `${f} does not import the shared codec`);
    }
});

test("every name-bytes site goes through the shared codec", () => {
    const sites = {
        "gym-translated.js": "nameBytes: encodeNativeScreenText(",
        "lab-translated.js": "nameBytes: encodeNativeScreenText(",
        "save-translated.js": "playerNameBytes: encodeNativeScreenText(",
        "fightreport-translated.js": "nameBytes: encodeNativeScreenText(",
        "shop-translated.js": "nameBytes: encodeNativeScreenText(",
    };
    for (const [f, needle] of Object.entries(sites)) {
        assert.ok(src(f).includes(needle), `${f} does not call encodeNativeScreenText`);
        assert.ok(!src(f).includes("encodeGymName("), `${f} still calls encodeGymName`);
    }
    // save used to write the player name uncapped; the shared encoder is the only writer now
    assert.equal(src("save-translated.js").split("encodeNativeScreenText(state.playerName)").length, 2);
});
