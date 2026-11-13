// web/mp-goto.js: where to stand next to a friend you are warped to.
import test from "node:test";
import assert from "node:assert/strict";
import { pickSpotNear, GOTO_TIMEOUT_MS } from "../web/mp-goto.js";

const open = () => true;
const size = { w: 640, h: 480 };

test("open ground: a spot just below the friend, close but not on top of them", () => {
    assert.deepEqual(pickSpotNear(open, 300, 200, size), { x: 300, y: 220 });
});

test("never returns a blocked spot: a wall below pushes the choice to another side", () => {
    const wallBelow = (x, y) => !(y > 205);
    const p = pickSpotNear(wallBelow, 300, 200, size);
    assert.ok(p && wallBelow(p.x, p.y));
    assert.ok(Math.hypot(p.x - 300, p.y - 200) >= 20);
});

test("a friend in a closet: the nearest free spot further out is used", () => {
    const closet = (x, y) => Math.hypot(x - 300, y - 200) >= 50;
    const p = pickSpotNear(closet, 300, 200, size);
    assert.ok(p && closet(p.x, p.y));
    assert.ok(Math.hypot(p.x - 300, p.y - 200) < 60);
});

test("spots outside the map are skipped", () => {
    const p = pickSpotNear(open, 5, 470, size);
    assert.ok(p.x >= 0 && p.y >= 0 && p.x < 640 && p.y < 480);
});

test("everything blocked: null (the caller says no room, the player is not moved)", () => {
    assert.equal(pickSpotNear(() => false, 300, 200, size), null);
});

test("same input, same spot; the timeout is the co-op one", () => {
    assert.deepEqual(pickSpotNear(open, 77, 91, size), pickSpotNear(open, 77, 91, size));
    assert.equal(GOTO_TIMEOUT_MS, 14000);
});
