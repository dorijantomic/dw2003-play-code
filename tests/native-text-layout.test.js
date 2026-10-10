// Browser text replay against the shipped registration font record. Canvas
// calls are recorded here; real pixels and opening state use the browser proof.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const font = JSON.parse(readFileSync("web/assets/ui/uifont.json", "utf8"));
const oldFetch = globalThis.fetch;
globalThis.fetch = async () => ({ json: async () => font });
globalThis.Image = class {
    set src(value) { this.url = value; queueMicrotask(() => this.onload?.()); }
};
const { decodeNativeText, drawNativeTextWidgets } = await import("../web/native-screen-text.js");
await new Promise(resolve => setImmediate(resolve));
globalThis.fetch = oldFetch;
delete globalThis.Image;

const resident = readFileSync("web/assets/native/screens/resident.bin");
const manifest = JSON.parse(readFileSync("web/assets/native/screens/manifest.json", "utf8"));
const entry = manifest.screens["pro/stplnmet"];
const overlay = readFileSync(`web/assets/native/screens/${entry.file}`);
const read8 = addr => {
    const a = addr >>> 0;
    return a >= entry.load_base && a < entry.load_base + overlay.length
        ? overlay[a - entry.load_base]
        : resident[a - manifest.resident.base] ?? 0;
};
const read32 = addr => (read8(addr) | read8(addr + 1) << 8 |
    read8(addr + 2) << 16 | read8(addr + 3) << 24) >>> 0;

test("registration text retains punctuation and spaces", () => {
    const chars = ["A", "~", "・", "?", "!", " ", "-"];
    const bytes = chars.flatMap(c => {
        const info = font.chars[c];
        return info.t === "b" ? [info.i + 4] : [1, info.i + 1];
    });
    assert.deepEqual(decodeNativeText([...bytes, 0]), { text: chars.join(""), unknown: [] });
});

test("registration uses its custom font offsets and both cell pitches", () => {
    const draws = [];
    const ctx = { drawImage: (...args) => draws.push(args) };
    const w = {
        font: 0x8008991c, visible: true, fixedPitch: true,
        penX: 47, penY: 91, cellWidth: 14, lineHeight: 18,
        alignWidth: 0, colour: 0, read8, read32,
        lines: [{ bytes: [0x0e, 0x0f, 2, 1, 0x10, 0], len: 6, flag: 0 }],
    };
    const stats = drawNativeTextWidgets(ctx, [w]);
    assert.equal(stats.unknown, 0);
    assert.deepEqual(draws.map(d => d.slice(5)), [
        [51, 94, 8, 12], [65, 94, 8, 12], [51, 112, 8, 12],
    ]);
});

test("ordinary title text keeps the resident face and proportional advance", () => {
    const draws = [];
    drawNativeTextWidgets({ drawImage: (...args) => draws.push(args) }, [{
        font: 0x8004dd8c, visible: true, fixedPitch: false,
        penX: 32, penY: 26, lineHeight: 14, alignWidth: 0, colour: 0,
        read8, read32, lines: [{ bytes: [0x0e, 0x0f, 0], len: 3, flag: 0 }],
    }]);
    assert.deepEqual(draws.map(d => d.slice(5)), [[33, 26, 8, 12], [40, 26, 8, 12]]);
});

test("insert records appear inline, never as extra rows below the message", () => {
    const draws = [];
    const encode = s => [...s].map(c => font.chars[c].i + 4);
    const stats = drawNativeTextWidgets({ drawImage: (...a) => draws.push(a) }, [{
        font: 0x8004dd8c, visible: true, fixedPitch: false,
        penX: 20, penY: 194, lineHeight: 14, alignWidth: 0, colour: 0,
        read8, read32, lines: [
            { bytes: [2, 5, 1, 0], len: 4, flag: 0 },
            { bytes: [...encode('Kotemon'), 0], len: 8, flag: 0 },
        ],
    }]);
    assert.deepEqual(stats.texts, ['Kotemon']);
    assert.equal(draws.length, 7);
    assert.ok(draws.every(a => a[6] === 194));
});
