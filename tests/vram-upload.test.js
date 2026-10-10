// Unit check for engine/native/vram.ts: the upload record's shape and the
// transfer length. A LoadImage RECT's w/h count VRAM halfwords, so the copied
// byte count is w*h*2 regardless of the pixel format (accepted
// vram-sample-contract answer, section 3).

import { test } from "node:test";
import assert from "node:assert/strict";
import { VramMap } from "../engine/native/vram.ts";

test("VramMap copies w*h*2 bytes and records the rect", () => {
    const mem = new Uint8Array(0x2000);
    for (let i = 0; i < mem.length; i++) mem[i] = i & 0xff;
    const vram = new VramMap();
    const load = vram.upload(320, 256, 0x20, 0x20, 0x100, 8, false, (a) => mem[a]);
    assert.equal(load.x, 320);
    assert.equal(load.y, 256);
    assert.equal(load.w, 0x20);
    assert.equal(load.h, 0x20);
    assert.equal(load.bpp, 8);
    assert.equal(load.clut, false);
    assert.equal(load.pixels.length, 0x20 * 0x20 * 2, "32x32 VRAM halfwords = 2048 bytes");
    assert.equal(load.pixels[0], 0);
    assert.equal(load.pixels[1], 1);
    assert.equal(load.pixels[0x100], 0, "the source byte pattern is copied in order");

    // a palette rect (256x1) transfers 512 bytes
    const pal = vram.upload(0, 0, 0x100, 1, 0x400, 16, true, (a) => mem[a]);
    assert.equal(pal.pixels.length, 0x100 * 2);
    assert.equal(pal.bpp, 16);
    assert.equal(pal.clut, true);
    assert.equal(vram.loads.length, 2);
});

test("VramMap.find returns the newest upload covering the point", () => {
    const vram = new VramMap();
    const read = () => 0;
    vram.upload(0, 0, 0x10, 0x10, 0, 8, false, read);
    const second = vram.upload(8, 8, 0x10, 0x10, 0, 8, false, read);
    assert.equal(vram.find(9, 9), second, "overlap resolves to the newer upload");
    assert.equal(vram.find(1, 1)?.x, 0, "a point only the first covers");
    assert.equal(vram.find(0x40, 0x40), null, "outside every rect");
    vram.clear();
    assert.equal(vram.loads.length, 0);
});
