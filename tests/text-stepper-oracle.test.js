// Phase 4 oracle: engine/dw3/ui/text-window.ts stepToken (F0x8001A48C) plus the
// two handlers it completes (textNextGlyph F0x8001AA10, textHandlerPlayerName
// F0x8001ABA4) must reproduce the originals on the same widget, line, scratch
// and cursor. engine/native runs the original addresses as the oracle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { stepToken, textHandlerPlayerName, textNextGlyph } from "../engine/dw3/ui/text-window.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SELF = 0x80170000;
const LINE = SELF + 0x5c;          // line record 0
const SIB = SELF + 0x5c + 0xc;     // line record 1
const TOK_A = 0x80171000;
const TOK_B = 0x80171040;
const BUF0 = 0x80172000;
const BUF1 = 0x80172200;
const FONT = 0x80173000;
const GLYPH = 0x80174000;
const EXT = 0x80174800;
let PORT_HEAP = 0x80176000;
const WIN = 0x200;

const SWAP = (v) => ((v >>> 8) | ((v & 0xff) << 8)) & 0xffff;

function runtime() {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.mem.write32(FONT + 4, GLYPH);
    rt.mem.write32(FONT + 8, EXT);
    rt.mem.write16(FONT + 0x14, 0x20);
    rt.mem.write16(FONT + 0x16, 3);
    // the player-name literal F0x8001ABA4 installs: give it bytes so the install
    // is observable (the shipped image has it zeroed at this point)
    for (const [i, ch] of [..."PLAYER\0"].entries()) rt.mem.write8(0x80048d88 + i, ch.charCodeAt(0));
    for (let c = 0; c < 0x20; c++) {
        rt.mem.write8(GLYPH + 11 * c + 9, 5);
        rt.mem.write8(GLYPH + 11 * c + 7, 0);
        rt.mem.write8(EXT + 11 * c, 0);
    }
    return rt;
}

function portHost(rt) {
    return {
        alloc(size) {
            const n = ((size >>> 0) + 0xf) & ~0xf;
            const p = PORT_HEAP;
            PORT_HEAP += n;
            for (let a = p; a < p + n; a += 4) rt.mem.write32(a, 0);
            return p;
        },
        free() {},
        stringById() { return 0; },
    };
}

function seedWidget(rt, self) {
    for (let i = 0; i < WIN; i += 4) rt.mem.write32(self + i, 0);
    rt.mem.write32(self + 0x50, FONT);
    rt.mem.write8(self + 0xc3, 0);
    rt.mem.write16(self + 0xaa, 0);
}

function seedLine(rt, rec, buf, bytes, cursor, flag) {
    rt.mem.write32(rec + 0, buf);
    rt.mem.write16(rec + 6, bytes.length);
    rt.mem.write16(rec + 8, cursor);
    rt.mem.write16(rec + 0xa, flag);
    for (let i = 0; i < 32; i++) rt.mem.write8(buf + i, 0);
    for (let i = 0; i < bytes.length; i++) rt.mem.write8(buf + i, bytes[i] & 0xff);
}

function seedTok(rt, tok, code, type) {
    rt.mem.write16(tok + 0x14, code & 0xffff);
    rt.mem.write16(tok + 0x16, type & 0xffff);
    rt.mem.write32(tok + 0xc, 0xdeadbeef);
}

function state(rt, self, tok, cursorAddr) {
    return {
        ret: undefined,
        cursor: rt.mem.read16(cursorAddr) & 0xffff,
        glyph: rt.mem.read32(tok + 0xc) >>> 0,
        code: rt.mem.read16(tok + 0x14) & 0xffff,
        type: rt.mem.read16(tok + 0x16) & 0xffff,
        c3: rt.mem.read8(self + 0xc3),
        tok10: rt.mem.read32(tok + 0x10) >>> 0,
        tok18: rt.mem.read16(tok + 0x18) & 0xffff,
        a4: rt.mem.read16(self + 0xa4) & 0xffff,
        a6: rt.mem.read16(self + 0xa6) & 0xffff,
        bf: rt.mem.read8(self + 0xbf),
    };
}

function lineState(rt, rec) {
    // The install buffers live in different arenas on the two sides, so compare
    // the record fields, whether a buffer is set, and the marked source buffer
    // (the caller's buffer, where the operand byte is stamped), not the
    // allocated bytes - those are covered by the line-setter oracles.
    return {
        length: rt.mem.read16(rec + 6) & 0xffff,
        cursor: rt.mem.read16(rec + 8) & 0xffff,
        flag: rt.mem.read16(rec + 0xa) & 0xffff,
        cap: rt.mem.read16(rec + 4) & 0xffff,
        hasBuffer: (rt.mem.read32(rec) | 0) !== 0,
    };
}

function srcMark(rt, src) {
    return Array.from({ length: 8 }, (_, i) => rt.mem.read8(src + i));
}

function runCase(rt, label, setup, call, origAddr = 0x8001a48c, origArgs = null, skipSrc = false) {
    // run the original on the A scratch, the port on the B scratch
    setup();
    const oracleRet = rt.cpu.call(origAddr, origArgs ? origArgs() : [SELF, LINE, TOK_A, LINE + 8]) | 0;
    const fa = state(rt, SELF, TOK_A, LINE + 8);
    fa.ret = oracleRet;
    const la = { l0: lineState(rt, LINE), l1: lineState(rt, SIB), l6: lineState(rt, SELF + 0x5c + 6 * 0xc), src: srcMark(rt, BUF0) };
    setup();
    const ret = call();
    const fb = state(rt, SELF, TOK_B, LINE + 8);
    fb.ret = ret | 0;
    const lb = { l0: lineState(rt, LINE), l1: lineState(rt, SIB), l6: lineState(rt, SELF + 0x5c + 6 * 0xc), src: srcMark(rt, BUF0) };
    for (const k of ["ret", "cursor", "glyph", "code", "type", "c3", "tok10", "tok18", "a4", "a6", "bf"]) {
        assert.equal(fb[k], fa[k], `${label} ${k}`);
    }
    if (skipSrc) {
        delete la.src;
        delete lb.src;
    }
    assert.deepEqual(lb, la, `${label} line records`);
}

test("stepToken matches F0x8001A48C on the non-control types", () => {
    const rt = runtime();
    for (const flag of [0, 1]) {
        for (const [type, code] of [[0, 4], [0, 9], [1, 0], [1, 1], [1, 3], [1, 4], [3, 0], [4, 0], [5, 0], [9, 0]]) {
            runCase(rt, `type=${type} code=${code} flag=${flag}`, () => {
                seedWidget(rt, SELF);
                seedLine(rt, LINE, BUF0, [4, 0, 0, 0], 0, flag);
                seedLine(rt, SIB, BUF1, [0, 0, 0, 0], 0, 0);
                seedTok(rt, TOK_A, code, type);
                seedTok(rt, TOK_B, code, type);
                rt.mem.write16(LINE + 8, 0);
            }, () => stepToken(rt.mem, portHost(rt), SELF, LINE, TOK_B, LINE + 8));
        }
    }
});

test("stepToken matches F0x8001A48C on the control types", () => {
    const rt = runtime();
    for (const flag of [0, 1]) {
        for (const code of [1, 2]) {
            for (const operand of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
                runCase(rt, `control flag=${flag} code=${code} operand=${operand}`, () => {
                    seedWidget(rt, SELF);
                    rt.mem.write8(SELF + 0xbf, 2);
                    seedLine(rt, LINE, BUF0, [4, 2, operand, 1, 6, 0], 1, flag);
                    seedLine(rt, SIB, BUF1, [4, 5, 0], 0, 0);
                    seedTok(rt, TOK_A, code, 2);
                    seedTok(rt, TOK_B, code, 2);
                    rt.mem.write16(LINE + 8, 1);
                }, () => stepToken(rt.mem, portHost(rt), SELF, LINE, TOK_B, LINE + 8));
            }
        }
    }
});

test("textNextGlyph matches F0x8001AA10", () => {
    const rt = runtime();
    for (const bytes of [[4, 5, 0], [0], [2, 3, 1], [4, 5, 6, 7, 0]]) {
        runCase(rt, `nextGlyph [${bytes}]`, () => {
            seedWidget(rt, SELF);
            seedLine(rt, LINE, BUF0, [4, 2, 1, 0], 0, 0);
            seedLine(rt, SIB, BUF1, bytes, 0, 0);
            seedTok(rt, TOK_A, 0, 0);
            seedTok(rt, TOK_B, 0, 0);
        }, () => textNextGlyph(rt.mem, portHost(rt), SELF, LINE, TOK_B), 0x8001aa10, () => [SELF, LINE, TOK_A]);
    }
    // a sibling line with no buffer takes the literal-install path
    runCase(rt, "nextGlyph missing buffer", () => {
        seedWidget(rt, SELF);
        seedLine(rt, LINE, BUF0, [4, 2, 1, 0], 0, 0);
        rt.mem.write32(SIB + 0, 0);
        seedTok(rt, TOK_A, 0, 0);
        seedTok(rt, TOK_B, 0, 0);
    }, () => textNextGlyph(rt.mem, portHost(rt), SELF, LINE, TOK_B), 0x8001aa10, () => [SELF, LINE, TOK_A]);
});

test("textHandlerPlayerName matches F0x8001ABA4", () => {
    const rt = runtime();
    for (const n of [0, 1, 5, 6, 0xff]) {
        runCase(rt, `playerName n=${n}`, () => {
            seedWidget(rt, SELF);
            seedLine(rt, LINE, BUF0, [4, 2, 0, n, 0], 1, 0);
            seedLine(rt, SIB, BUF1, [0, 0, 0, 0], 0, 0);
            seedTok(rt, TOK_A, 0, 0);
            seedTok(rt, TOK_B, 0, 0);
        }, () => textHandlerPlayerName(rt.mem, portHost(rt), SELF, LINE), 0x8001aba4, () => [SELF, LINE, TOK_A], n === 0);
    }
});

test("stepToken composes the control handlers end to end", () => {
    const rt = runtime();
    for (const operand of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        runCase(rt, `full control operand=${operand}`, () => {
            seedWidget(rt, SELF);
            rt.mem.write8(SELF + 0xbf, 3);
            seedLine(rt, LINE, BUF0, [4, 2, operand, 1, 6, 0], 1, 0);
            seedLine(rt, SIB, BUF1, [4, 5, 0], 0, 0);
            seedTok(rt, TOK_A, 2, 2);
            seedTok(rt, TOK_B, 2, 2);
            rt.mem.write16(LINE + 8, 1);
        }, () => {
            const r1 = stepToken(rt.mem, portHost(rt), SELF, LINE, TOK_B, LINE + 8);
            return r1 | 0;
        });
    }
    assert.equal(SWAP(0x8254), 0x5482);
});
