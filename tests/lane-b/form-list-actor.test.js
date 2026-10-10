// Lane B oracle for FIGHTSTG_F0x8009482c — the Digivolve form-list screen's constructor
// (fightstg.s:18030-18040):
//
//   .L0x8009482c  addiu $sp, -0x10
//   .L0x80094830  jal F0x80014504(0x80094478, 0x74, 0x1c)   ; the 0x74 object
//   .L0x80094838  sw $a0, 0x50($v0)      ; obj+0x50 = the caller's out word
//   .L0x8009483c  lw $v1, ($a0)          ; the caller's current answer word
//   .L0x80094840  sw $v1, 0x54($v0)      ; obj+0x54 = that word (the acting profile id)
//   .L0x80094844  li $v1, -1             ; "no answer yet"
//   .L0x80094848  sw $v1, ($a0)          ; *out = -1
//
// The saved profile word is what every keyed helper of the screen reads back
// (FORM_LIST_OUT / FORM_LIST_PROFILE). Ported as
// engine/dw3/ui/native/digivolve-form-menu.ts#formListActorConstruct; the boundary the
// test pins is that the answer word is copied BEFORE it is overwritten with -1, so the
// caller's prior value survives in the object while the caller sees "not answered".

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    formListActorConstruct, FORM_LIST_OUT, FORM_LIST_PROFILE,
} from "../../engine/dw3/ui/native/digivolve-form-menu.ts";

const SLOT = 0x9000;
const OUT = 0x8000;

function fakeMem(init = new Map()) {
    const m = init;
    const rd = (a, n, signed) => {
        let v = 0;
        for (let i = 0; i < n; i++) v |= (m.get((a + i) | 0) ?? 0) << (8 * i);
        if (signed) {
            const bits = 8 * n;
            if (v & (1 << (bits - 1))) v -= 1 << bits;
        }
        return v | 0;
    };
    const wr = (a, n, v) => {
        for (let i = 0; i < n; i++) m.set((a + i) | 0, (v >>> (8 * i)) & 0xff);
    };
    return {
        read8: (a) => rd(a, 1, false), read8s: (a) => rd(a, 1, true),
        read16: (a) => rd(a, 2, false), read16s: (a) => rd(a, 2, true),
        read32: (a) => rd(a, 4, false) >>> 0,
        write16: (a, v) => wr(a, 2, v), write32: (a, v) => wr(a, 4, v),
        get: (a) => rd(a, 4, false),
    };
}

const host = { allocateActor: () => SLOT };

test("0x8009482c formListActorConstruct: copies the caller's word, then marks it unanswered", () => {
    const mem = fakeMem(new Map([[OUT, 0x2a]]));   // profile 42 waiting
    const obj = formListActorConstruct(mem, OUT, host);
    assert.equal(obj, SLOT, "the object is the host's allocation");
    assert.equal(mem.read32(obj + FORM_LIST_OUT), OUT, "obj+0x50 = the caller's slot");
    assert.equal(mem.read32(obj + FORM_LIST_PROFILE), 0x2a,
        "obj+0x54 = the caller's word, saved before it is cleared");
    assert.equal(mem.read32(OUT), 0xffffffff, "the caller's answer word is set to -1 (not yet)");
});

test("0x8009482c formListActorConstruct: an already-answered caller is overwritten", () => {
    // A prior -2 (cancel) is copied like any word and then replaced by the -1 sentinel;
    // the object still carries the value the helper keys read.
    const mem = fakeMem(new Map([[OUT, 0xfffffffe]]));
    formListActorConstruct(mem, OUT, host);
    assert.equal(mem.read32(SLOT + FORM_LIST_PROFILE), 0xfffffffe);
    assert.equal(mem.read32(OUT), 0xffffffff);
});
