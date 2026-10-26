// The `ghost` scene step (web/quest-ghost.js): the compile side (data -> event) and the runtime side (per-actor alpha and
// tint, the cached tinted frame, and the clear that every scene exit goes through).
import test from "node:test";
import assert from "node:assert/strict";
import { compileScene } from "../web/quest-scenes.js";
import {
    questGhostSet, questGhostOf, questGhostActor, questGhostImage, questGhostClear, questGhostState, questGhostMap,
    installQuestGhostCamera, installQuestGhostGate, questSceneCameraToPlayer,
} from "../web/quest-ghost.js";
import { questFxClear } from "../web/quest-fx.js";

const pos = (id) => (id === 2 ? { x: 100, y: 200 } : { x: 923, y: 374 });

/** A field context stand-in: the alpha a ghost sets, and the drawImage calls it makes. */
function fakeCtx() {
    const calls = [];
    const stack = [];
    return {
        globalAlpha: 1,
        calls,
        depth: 0,
        save() { stack.push(this.globalAlpha); this.depth++; },
        restore() { if (stack.length) this.globalAlpha = stack.pop(); this.depth--; },
        drawImage(...args) { calls.push(args); },
    };
}

/** document.createElement("canvas") stand-in: one offscreen surface that records what was composited onto it. */
function fakeDocument() {
    const made = [];
    globalThis.document = {
        createElement(tag) {
            const ops = [];
            const g = {
                imageSmoothingEnabled: true,
                globalCompositeOperation: "source-over",
                globalAlpha: 1,
                fillStyle: "",
                drawImage: (...a) => ops.push(["drawImage", ...a]),
                fillRect: (...a) => ops.push(["fillRect", ...a]),
            };
            const cv = { tag, width: 0, height: 0, ops, g, getContext: () => g };
            made.push(cv);
            return cv;
        },
    };
    return made;
}

test("ghost compiles to one event: that character, alpha, tint", () => {
    const { events, errors } = compileScene([
        { ghost: 27, alpha: 0.4, tint: "#9FC8FF" },
        { ghost: "player" },
        { ghost: 27, off: true },
    ], { playerId: 2, pos });
    assert.deepEqual(errors, []);
    assert.deepEqual(events[0], { kind: "ghost", npc: 27, alpha: 0.4, tint: "#9FC8FF" });
    assert.deepEqual(events[1], { kind: "ghost", npc: "player", alpha: 0.5 });     // default half-faded, no tint
    assert.deepEqual(events[2], { kind: "ghost", npc: 27, off: true });
});

test("ghost data is checked when the scene is built", () => {
    const bad = (step) => compileScene([step], { playerId: 2, pos }).errors;
    assert.ok(bad({ ghost: "nobody" }).length);
    assert.ok(bad({ ghost: 27, alpha: 2 }).length);
    assert.ok(bad({ ghost: 27, tint: "blue" }).length);
    assert.ok(bad({ ghost: 27, tint: "#12345" }).length);
    assert.deepEqual(bad({ ghost: 27, alpha: 1 }), []);
    assert.deepEqual(bad({ ghost: 27 }), []);
});

test("the ghost table is per actor, and off puts one actor back without touching the other", () => {
    questGhostClear();
    questGhostSet({ kind: "ghost", npc: 27, alpha: 0.25, tint: "#9FC8FF" });
    questGhostSet({ kind: "ghost", npc: "player", alpha: 0.5 });
    assert.deepEqual(questGhostOf(27), { alpha: 0.25, tint: "#9fc8ff" });
    assert.deepEqual(questGhostOf("player"), { alpha: 0.5, tint: null });
    assert.deepEqual(questGhostState().map((g) => g.actor).sort(), [27, "player"].sort());
    questGhostSet({ kind: "ghost", npc: 27, off: true });
    assert.equal(questGhostOf(27), null);
    assert.ok(questGhostOf("player"));
    questGhostClear();
    assert.deepEqual(questGhostState(), []);
});

test("bad ghost data is ignored at runtime, never thrown", () => {
    questGhostClear();
    for (const ev of [null, {}, { npc: null }, { npc: "someone" }]) {
        assert.doesNotThrow(() => questGhostSet(ev));
    }
    assert.equal(questGhostOf(NaN), null);
    assert.deepEqual(questGhostState(), []);
    // an unreadable alpha falls back to the step's own default; an unreadable tint is dropped, not trusted
    questGhostSet({ npc: 27, alpha: "much", tint: "red" });
    assert.deepEqual(questGhostOf(27), { alpha: 0.5, tint: null });
    questGhostSet({ npc: 27, alpha: 4, tint: "#9fc8ff" });
    assert.deepEqual(questGhostOf(27), { alpha: 1, tint: "#9fc8ff" });
    questGhostClear();
});

test("a ghosted actor draws inside its alpha; a normal actor is the plain call", () => {
    questGhostClear();
    const ctx = fakeCtx();
    let seen = null;
    questGhostActor(ctx, "player", () => { seen = ctx.globalAlpha; });
    assert.equal(seen, 1);
    assert.equal(ctx.depth, 0);                       // no save/restore around an actor that is not a ghost

    questGhostSet({ npc: "player", alpha: 0.25 });
    questGhostActor(ctx, "player", () => { seen = ctx.globalAlpha; });
    assert.equal(seen, 0.25);
    assert.equal(ctx.globalAlpha, 1);                 // and the context is back to normal after the actor
    assert.equal(ctx.depth, 0);
    questGhostClear();
});

test("alpha nests correctly if a real globalAlpha was already set (a reflection pass)", () => {
    questGhostClear();
    const ctx = fakeCtx();
    ctx.globalAlpha = 0.5;
    questGhostSet({ npc: 27, alpha: 0.5 });
    let seen = null;
    questGhostActor(ctx, 27, () => { seen = ctx.globalAlpha; });
    assert.equal(seen, 0.25);
    assert.equal(ctx.globalAlpha, 0.5);               // restored to what the caller had
    questGhostClear();
});

test("a tinted frame is composited once and cached; an untinted actor is a plain drawImage", () => {
    questGhostClear();
    const made = fakeDocument();
    const img = { name: "sheet" };
    const plain = fakeCtx();
    questGhostImage(plain, img, 0, 0, 24, 48, 10, 20);
    assert.deepEqual(plain.calls, [[img, 0, 0, 24, 48, 10, 20, 24, 48]]);
    assert.equal(made.length, 0);                     // nothing copied while no ghost is on

    questGhostSet({ npc: 27, alpha: 0.5, tint: "#9fc8ff" });
    const ctx = fakeCtx();
    questGhostActor(ctx, 27, () => {
        questGhostImage(ctx, img, 0, 0, 24, 48, 10, 20);
        questGhostImage(ctx, img, 0, 0, 24, 48, 10, 20);     // same frame again: the cached copy
        questGhostImage(ctx, img, 24, 0, 24, 48, 10, 20);    // a different frame: one more copy
    });
    assert.equal(made.length, 2);
    assert.equal(ctx.calls.length, 3);
    assert.equal(ctx.calls[0][0], made[0]);           // drawn from the offscreen copy, not the sheet
    assert.equal(ctx.calls[0][7], 24);                // at the same destination size
    assert.equal(ctx.calls[0][8], 48);
    const wash = made[0].ops.filter((o) => o[0] === "fillRect");
    assert.equal(wash.length, 1);
    assert.equal(made[0].getContext().globalCompositeOperation, "source-atop");
    questGhostClear();
    delete globalThis.document;
});

test("questFxClear is the one exit that puts every ghost back", () => {
    questGhostSet({ npc: 27, alpha: 0.5 });
    questGhostSet({ npc: "player", alpha: 0.3 });
    questFxClear();
    assert.deepEqual(questGhostState(), []);
});

test("the table the host publishes at state._questGhosts is the live one, emptied in place", () => {
    questGhostClear();
    const published = questGhostMap();
    questGhostSet({ npc: 1005, alpha: 0.35, tint: "#9fc8ff" });
    assert.deepEqual([...published.keys()], [1005], "the renderer's view of it has the actor the step named");
    assert.deepEqual([...published.keys()], [...questGhostMap().keys()]);
    questGhostSet({ npc: 1005, off: true });
    assert.deepEqual([...published.keys()], [], "off removes it from the same object");
    questGhostSet({ npc: 27, alpha: 0.5 });
    questFxClear();
    assert.deepEqual([...published.keys()], [], "and questFxClear empties it in place, so the host never re-reads a stale table");
    assert.equal(questGhostMap(), published, "the identity never changes");
});

test("F2 Quests off clears a ghost on the next actor drawn, and never throws", () => {
    questGhostClear();
    installQuestGhostGate(() => false);
    questGhostSet({ npc: 27, alpha: 0.5 });
    questGhostActor(fakeCtx(), 27, () => {});
    assert.deepEqual(questGhostState(), []);
    installQuestGhostGate(() => { throw new Error("no panel"); });
    questGhostSet({ npc: 27, alpha: 0.5 });
    questGhostActor(fakeCtx(), 27, () => {});
    assert.equal(questGhostState().length, 1, "a gate that cannot answer leaves the ghost alone");
    installQuestGhostGate(() => true);
    questGhostActor(fakeCtx(), 27, () => {});
    assert.equal(questGhostState().length, 1);
    questGhostClear();
    installQuestGhostGate(null);
});

test("the drop/rise camera call reaches the host action and survives a host with none", () => {
    let calls = 0;
    installQuestGhostCamera(() => { calls++; });
    questSceneCameraToPlayer();
    assert.equal(calls, 1);
    installQuestGhostCamera(null);
    assert.doesNotThrow(() => questSceneCameraToPlayer());
    installQuestGhostCamera(() => { throw new Error("host blew up"); });
    assert.doesNotThrow(() => questSceneCameraToPlayer());   // a camera that cannot move never blocks a fall
    installQuestGhostCamera(null);
});
