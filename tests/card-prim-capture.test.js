// Unit check for the card-prim parser in engine/native/runtime.ts: the cursor
// hook (SET_DE30) must capture exactly the 0x1C-byte sprite + DR_TPAGE the card
// class's +0x34 emit publishes, and ignore every other prim shape. Layout and
// bounds from the accepted vram-sample-contract answer section 2.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SET_DE30 = 0x8001d854;
const CURSOR = 0x8004de30;
const ARENA = 0x80140000;

function runtime() {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

/** Write a card sprite + DR_TPAGE at `at`; overrides let tests break the shape. */
function writeCardPacket(rt, at, o = {}) {
    const x = o.x ?? 320;
    const y = o.y ?? 256;
    const u = o.u ?? 0x21;
    const v = o.v ?? 0x40;
    const clut = o.clut ?? ((256 >> 6) << 6) | 0x0f;
    const cmd = o.cmd ?? 0x64;
    const tpage = o.tpage ?? 0x1a0;
    rt.mem.write8(at + 3, o.tag ?? 4);
    rt.mem.write8(at + 4, 0x80);
    rt.mem.write8(at + 5, 0x80);
    rt.mem.write8(at + 6, 0x80);
    rt.mem.write8(at + 7, cmd);
    rt.mem.write16(at + 8, x & 0xffff);
    rt.mem.write16(at + 0xa, y & 0xffff);
    rt.mem.write8(at + 0xc, u & 0xff);
    rt.mem.write8(at + 0xd, v & 0xff);
    rt.mem.write16(at + 0xe, clut & 0xffff);
    rt.mem.write16(at + 0x10, 0x20);
    rt.mem.write16(at + 0x12, 0x20);
    rt.mem.write32(at + 0x18, (0xe1000000 | (o.tpageWord ?? tpage)) >>> 0);
}

test("the cursor hook captures the card sprite and its DR_TPAGE", () => {
    for (const cmd of [0x64, 0x66]) {
        const rt = runtime();
        const at = ARENA + 0x100;
        writeCardPacket(rt, at, { cmd, x: -12, y: 0x120, u: 0x1f, v: 0x22, clut: 0x01c3, tpage: 0x1a5 });
        rt.mem.write32(CURSOR, at);
        rt.cpu.call(SET_DE30, [at + 0x1c]);
        assert.equal(rt.cardPrims.length, 1, `cmd=0x${cmd.toString(16)} captured`);
        const p = rt.cardPrims[0];
        assert.equal(p.cmd, cmd);
        assert.equal(p.x, -12, "signed x");
        assert.equal(p.y, 0x120, "signed y");
        assert.equal(p.u, 0x1f);
        assert.equal(p.v, 0x22);
        assert.equal(p.clut, 0x01c3);
        assert.equal(p.tpage, 0x1a5, "texpage is the low 9 bits of the DR_TPAGE word");
        assert.equal(rt.mem.read32(CURSOR) >>> 0, (at + 0x1c) >>> 0, "cursor published");
    }
});

test("the cursor hook ignores every other prim shape", () => {
    const shapes = [
        ["wrong length (a 40-quad batch)", (rt, at) => { rt.mem.write32(CURSOR, at); rt.cpu.call(SET_DE30, [at + 0x28 * 40]); }],
    ];
    for (const [name, go] of shapes) {
        const rt = runtime();
        const at = ARENA + 0x200;
        writeCardPacket(rt, at);
        go(rt, at);
        assert.equal(rt.cardPrims.length, 0, name);
    }
    const negatives = [
        ["tag byte not 4", { tag: 9 }],
        ["tint not neutral", {}],
        ["command not 0x64/0x66", { cmd: 0x2c }],
        ["DR_TPAGE missing", { tpageWord: 0x12345678 }],
    ];
    for (const [name, o] of negatives) {
        const rt = runtime();
        const at = ARENA + 0x300;
        writeCardPacket(rt, at, o);
        if (name === "tint not neutral") rt.mem.write8(at + 5, 0x7f);
        rt.mem.write32(CURSOR, at);
        rt.cpu.call(SET_DE30, [at + 0x1c]);
        assert.equal(rt.cardPrims.length, 0, name);
    }
});
