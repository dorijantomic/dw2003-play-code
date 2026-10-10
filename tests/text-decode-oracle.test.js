// Phase 4 oracle: engine/dw3/ui/text-decode.ts decodeTextToken must match the
// resident decoder F0x8001D264 on every input. The original runs through
// engine/native on the shipped resident image; the port reads the same memory
// and the same kind-1 font record and its two Shift-JIS tables.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    TEXT_FONT_KIND1, TEXT_SJIS_FIRST, TEXT_SJIS_LAST, TEXT_TOKEN_END,
    TEXT_TOKEN_INVALID, TEXT_TOKEN_NEWLINE, decodeTextToken,
} from "../engine/dw3/ui/text-decode.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const FN = 0x8001d264;
const TOKEN = 0x80150000;
const FONT = TEXT_FONT_KIND1;

const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
    image: resident,
    base: 0x80010000,
});

function runOriginal(b0, b1, convert) {
    rt.mem.write8(TOKEN, b0 & 0xff);
    rt.mem.write8(TOKEN + 1, b1 & 0xff);
    return rt.cpu.call(FN, [TOKEN, convert | 0, FONT], 200000) | 0;
}

function runPort(b0, b1, convert) {
    rt.mem.write8(TOKEN, b0 & 0xff);
    rt.mem.write8(TOKEN + 1, b1 & 0xff);
    return decodeTextToken(rt.mem, TOKEN, convert | 0, FONT) | 0;
}

test("decodeTextToken matches F0x8001D264 for every byte pair", () => {
    const trails = [0x00, 0x01, 0x3f, 0x40, 0x4e, 0x4f, 0x5b, 0x9f, 0xc0, 0xf1, 0xff];
    let cases = 0;
    for (let convert = 0; convert <= 1; convert++) {
        for (let b0 = 0; b0 <= 0xff; b0++) {
            for (const b1 of trails) {
                const oracle = runOriginal(b0, b1, convert);
                const ported = runPort(b0, b1, convert);
                assert.equal(ported, oracle, `convert=${convert} bytes ${b0.toString(16)} ${b1.toString(16)}`);
                cases += 1;
            }
        }
    }
    assert.ok(cases >= 5000, "the sweep covers both codecs");
});

test("the font record and the two tables are the shipped ones", () => {
    assert.equal(rt.mem.read32(FONT + 0x0c) >>> 0, 0x8004e010, "table A pointer");
    assert.equal(rt.mem.read32(FONT + 0x10) >>> 0, 0x8004e3bc, "table B pointer");
    assert.equal(rt.mem.read16s(FONT + 0x14), 0x00ea, "the signed basic limit");
    assert.equal(rt.mem.read16(FONT + 0x16), 0x0072, "the extended count");
    assert.equal(TEXT_SJIS_FIRST, 0x824f);
    assert.equal(TEXT_SJIS_LAST, 0x8394);
});

test("the documented pairs decode to the documented glyph codes", () => {
    // 0x8358 ス -> basic 167; 0x815B ー -> table B ext 12; 0x8358 again.
    assert.equal(decodeTextToken(rt.mem, token([0x83, 0x58]), 1, FONT), 0x00ab);
    assert.equal(decodeTextToken(rt.mem, token([0x81, 0x5b]), 1, FONT), 0x010d);
    assert.equal(decodeTextToken(rt.mem, token([0x00]), 1, FONT), TEXT_TOKEN_END);
    assert.equal(decodeTextToken(rt.mem, token([0x0a]), 1, FONT), TEXT_TOKEN_NEWLINE);
    assert.equal(decodeTextToken(rt.mem, token([0xff, 0xff]), 1, FONT), TEXT_TOKEN_INVALID,
        "a pair outside both tables");
    assert.equal(decodeTextToken(rt.mem, token([0x01, 0x10]), 0, FONT), 0x0110,
        "native extended pair");
    assert.equal(decodeTextToken(rt.mem, token([0x20]), 0, FONT), 0x20, "native basic code");
    assert.equal(decodeTextToken(rt.mem, token([0xf0]), 0, FONT), TEXT_TOKEN_INVALID,
        "native code above the basic limit");
});

// A scratch byte string the decoder can read.
const SCRATCH = 0x80150100;
function token(bytes) {
    rt.mem.write8(SCRATCH + bytes.length, 0);
    for (let i = 0; i < bytes.length; i++) rt.mem.write8(SCRATCH + i, bytes[i]);
    return SCRATCH;
}

function overlay(name) {
    return new Uint8Array(readFileSync(join(dir, name)));
}

// Walk a convert-mode string the way the drawer does: every token is a
// two-byte pair until the 0x0400 terminator, which consumes one byte.
function decodeString(bytes) {
    const out = [];
    const at = token(bytes);
    for (let i = 0; i < bytes.length;) {
        const v = decodeTextToken(rt.mem, at + i, 1, FONT) | 0;
        rt.mem.write8(at + i, bytes[i]);
        rt.mem.write8(at + i + 1, bytes[i + 1] ?? 0);
        const oracle = rt.cpu.call(FN, [at + i, 1, FONT], 200000) | 0;
        assert.equal(v, oracle, `shipped string token at ${i}`);
        out.push(v >>> 0);
        if ((v & 0xff00) === 0x0400) break;
        i += 2;
    }
    return out;
}

test("the shipped label strings decode to the documented sequences", () => {
    // pro/soundtst title: サウンドテスト (RAM 0x8008435C = file offset 0x16AC).
    const sound = overlay("pro_soundtst.bin");
    const soundTitle = [...sound.slice(0x16ac, 0x16ac + 15)];
    assert.deepEqual(soundTitle.slice(0, 8), [0x83, 0x54, 0x83, 0x45, 0x83, 0x93, 0x83, 0x68]);
    assert.deepEqual(decodeString(soundTitle),
        [0x00a7, 0x0098, 0x00e3, 0x00bb, 0x00b8, 0x00ab, 0x00ba, 0x0400],
        "サウンドテスト");

    // pro/stagslct title: ステージセレクト (RAM 0x800849A4 = offset 0x1CF4).
    const stage = overlay("pro_stagslct.bin");
    const stageTitle = [...stage.slice(0x1cf4, 0x1cf4 + 17)];
    assert.deepEqual(decodeString(stageTitle),
        [0x00ab, 0x00b8, 0x010d, 0x00aa, 0x00ad, 0x00de, 0x00a1, 0x00ba, 0x0400],
        "ステージセレクト");

    // pro/shocktst title: しんどうテスト (RAM 0x80082D68 = offset 0xB8).
    const shock = overlay("pro_shocktst.bin");
    const shockTitle = [...shock.slice(0xb8, 0xb8 + 15)];
    assert.deepEqual(shockTitle.slice(0, 8), [0x82, 0xb5, 0x82, 0xf1, 0x82, 0xc7, 0x82, 0xa4]);
    const shockCodes = decodeString(shockTitle);
    assert.equal(shockCodes.length, 8, "seven pairs and the terminator");
    assert.equal(shockCodes[7] >>> 0, 0x0400, "しんどうテスト ends");
    assert.ok(shockCodes.every((c) => (c >>> 0) !== 0x0300), "no undecodable pair in the title");
});
