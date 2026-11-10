import test from "node:test";
import assert from "node:assert/strict";
import { createPartnerFallback } from "../web/glossary-fallback.js";

const ctx = () => { const ops = []; return { ops, save: () => ops.push("save"), restore: () => ops.push("restore"), translate: (...a) => ops.push(["t", ...a]), scale: (...a) => ops.push(["s", ...a]) }; };

test("a new partner without a model draws its numbered picture (0x400 + (slot-8)*16 + frame), 2x, centred", () => {
    const drawn = [];
    const f = createPartnerFallback({ partners: () => [{ id: 190, slot: 9 }], draw: (c, id, x, y) => { drawn.push([id, x, y]); return true; }, now: () => 400 });
    const c = ctx();
    assert.equal(f(c, { partnerId: 190 }, 100, 50, 144, 72), true);
    assert.deepEqual(drawn, [[0x400 + 16 + 2, 0, 0]]);
    assert.deepEqual(c.ops[1], ["t", 100 + 40, 50 + 4]);
    assert.deepEqual(c.ops[2], ["s", 2, 2]);
    assert.equal(c.ops.at(-1), "restore");
});

test("no partner id, or an id that is not a new partner, or a picture not ready: false", () => {
    const f = createPartnerFallback({ partners: () => [{ id: 190, slot: 9 }], draw: () => false });
    assert.equal(f(ctx(), { partnerId: null }, 0, 0, 144, 72), false);
    assert.equal(f(ctx(), { partnerId: 5 }, 0, 0, 144, 72), false);
    assert.equal(f(ctx(), { partnerId: 190 }, 0, 0, 144, 72), false);
});
