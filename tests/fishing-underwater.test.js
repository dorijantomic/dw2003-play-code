// Underwater fishing view: state mapping (fishing state -> scene phase) and theme lookup.
// Pure (web/fishing-underwater-state.js); no browser, no three.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    phaseFor, progressFor, sizeFor, themeFor, themeIdFor, THEMES, DEFAULT_THEME, PHASES,
    SETTLE_TICKS, METER_TOP, HOLD_TICKS, FULL_SPEED,
} from "../web/fishing-underwater-state.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const extras = read("../data/authored/web/assets/data/fishing_extras.json");
const fishing = (run, rest = {}) => ({ run: { phase: "settle", band: null, timer: 0, meter: 0, speed: 0x100, ...run }, pending: null, ...rest });

test("constants mirror engine/systems/fishing.ts", () => {
    const src = readFileSync(new URL("../engine/systems/fishing.ts", import.meta.url), "utf8");
    const num = (name) => Number(new RegExp(`export const ${name} = (0x[0-9a-f]+|\\d+);`).exec(src)[1]);
    assert.equal(SETTLE_TICKS, num("CAST_SETTLE_TICKS"));
    assert.equal(METER_TOP, num("METER_MAX"));
    assert.equal(HOLD_TICKS, num("RESOLVE_TICKS"));
    assert.equal(FULL_SPEED, num("METER_SPEED"));
});

test("phaseFor maps every fishing phase", () => {
    assert.equal(phaseFor(null), "idle");
    assert.equal(phaseFor(undefined), "idle");
    assert.equal(phaseFor({}), "idle");
    assert.equal(phaseFor(fishing({ phase: "settle" })), "cast");
    assert.equal(phaseFor(fishing({ phase: "sweep" })), "wait");
    assert.equal(phaseFor(fishing({ phase: "brake" })), "strike");
    assert.equal(phaseFor(fishing({ phase: "hold", band: 1 })), "bite");
    assert.equal(phaseFor(fishing({ phase: "hold", band: 2 })), "bite");
    assert.equal(phaseFor(fishing({ phase: "hold", band: 0 })), "miss");
    assert.equal(phaseFor(fishing({ phase: "hold", band: null })), "strike");
    assert.equal(phaseFor(fishing({ phase: "over" }, { pending: 4 })), "reel");
    assert.equal(phaseFor(fishing({ phase: "over" }, { pending: 7 })), "reel");
    assert.equal(phaseFor(fishing({ phase: "over" }, { pending: null })), "gone");
    assert.equal(phaseFor(fishing({ phase: "weird" })), "idle");
    for (const ph of ["settle", "sweep", "brake", "hold", "over"]) assert.ok(PHASES.includes(phaseFor(fishing({ phase: ph }))));
});

test("the band is not read before the hold (no odds shown early)", () => {
    assert.equal(phaseFor(fishing({ phase: "sweep", band: 2 })), "wait");
    assert.equal(phaseFor(fishing({ phase: "brake", band: 2 })), "strike");
    assert.equal(sizeFor(fishing({ phase: "sweep" })), "shadow");
});

test("progressFor reads the game's own counters and clamps to 0..1", () => {
    assert.equal(progressFor(null), 0);
    assert.equal(progressFor(fishing({ phase: "settle", timer: SETTLE_TICKS / 2 })), 0.5 * SETTLE_TICKS / SETTLE_TICKS);
    assert.equal(progressFor(fishing({ phase: "settle", timer: 9999 })), 1);
    assert.equal(progressFor(fishing({ phase: "sweep", meter: METER_TOP / 2 })), 0.5);
    assert.equal(progressFor(fishing({ phase: "brake", speed: FULL_SPEED })), 0);
    assert.equal(progressFor(fishing({ phase: "brake", speed: 0 })), 1);
    assert.equal(progressFor(fishing({ phase: "hold", timer: HOLD_TICKS })), 1);
    assert.equal(progressFor(fishing({ phase: "hold", timer: -5 })), 0);
    assert.equal(progressFor(fishing({ phase: "over" })), 0);
});

test("sizeFor: band 1 small, band 2 big, otherwise a shadow", () => {
    assert.equal(sizeFor(fishing({ phase: "hold", band: 1 })), "small");
    assert.equal(sizeFor(fishing({ phase: "hold", band: 2 })), "big");
    assert.equal(sizeFor(fishing({ phase: "hold", band: 0 })), "shadow");
    assert.equal(sizeFor(null), "shadow");
});

test("a full cast walks cast -> wait -> strike -> bite -> reel in order", () => {
    const f = fishing({ phase: "settle" });
    const seen = [phaseFor(f)];
    for (const [ph, extra] of [["sweep", {}], ["brake", {}], ["hold", { band: 2 }], ["over", {}]]) {
        f.run.phase = ph; Object.assign(f.run, extra);
        if (ph === "over") f.pending = 7;
        seen.push(phaseFor(f));
    }
    assert.deepEqual(seen, ["cast", "wait", "strike", "bite", "reel"]);
});

test("every theme used by fishing_extras.json has a look", () => {
    for (const a of extras.areas) assert.ok(THEMES[a.theme], `theme ${a.theme} of ${a.id}`);
    for (const [id, t] of Object.entries(THEMES)) {
        assert.ok(["sand", "rock", "ice", "mud"].includes(t.floor), id);
        assert.ok(t.density > 0 && t.density < 0.3, id);
        assert.ok(t.rocks >= 0 && t.rocks <= 10, id);
        for (const k of ["fog", "top", "deep", "light", "floorColor", "mote"]) assert.ok(Number.isInteger(t[k]) && t[k] >= 0 && t[k] <= 0xffffff, `${id}.${k}`);
    }
    for (const id of ["sea", "lake", "cold", "swamp"]) assert.ok(THEMES[id]);
});

test("theme lookup follows the stage's area; unknown stage falls back", () => {
    for (const [stage, rec] of Object.entries(extras.stages)) {
        const area = extras.areas.find((a) => a.id === rec.area);
        assert.equal(themeIdFor(extras, stage), area.theme, stage);
        assert.equal(themeFor(extras, stage), THEMES[area.theme]);
    }
    assert.equal(themeIdFor(extras, "s202"), "town");
    assert.equal(themeIdFor(extras, "no-such-stage"), DEFAULT_THEME);
    assert.equal(themeIdFor(null, "s202"), DEFAULT_THEME);
    assert.equal(themeIdFor({ stages: { x: { area: "a" } }, areas: [{ id: "a", theme: "nonsense" }] }, "x"), DEFAULT_THEME);
});

// ---- GPU safety: budget guard, shared context, context loss (fake renderer, no browser) ----
import { createBudgetGuard } from "../web/fishing-underwater-state.js";

test("budget guard: trips only when a 30-frame average is over 4 ms; warm-up frames ignored", () => {
    const g = createBudgetGuard(30, 4, 2);
    g.record(500); g.record(500);                       // shader compile frames: ignored
    for (let i = 0; i < 30; i++) assert.equal(g.record(1), false);
    assert.equal(g.tripped, false);
    for (let i = 0; i < 29; i++) assert.equal(g.record(9), false);   // window not yet full
    assert.equal(g.record(9), true);
    assert.equal(g.tripped, true);
    assert.equal(g.record(0), true);                    // stays off for the session
});

function fakeEnv() {
    const calls = [];
    const listeners = {};
    const canvas = { width: 0, height: 0, addEventListener: (n, f) => { listeners[n] = f; } };
    globalThis.document = { hidden: false, createElement: () => canvas };
    let isLost = false;
    const fake = {
        domElement: canvas,
        setPixelRatio() {}, setClearColor() {}, setViewport: (...a) => calls.push(["viewport", ...a]),
        setScissor() {}, setScissorTest: (v) => calls.push(["scissor", v]),
        setSize: (w, h) => { canvas.width = w; canvas.height = h; },
        render: () => calls.push(["render"]),
        getContext: () => ({ isContextLost: () => isLost, getExtension: () => null }),
    };
    return { fake, canvas, listeners, calls, lose: () => { isLost = true; listeners.webglcontextlost({ preventDefault() {} }); } };
}
const live = () => fishing({ phase: "sweep", meter: 100 });

test("underwater draws into the shared context corner, restores state, and one context only", async () => {
    const env = fakeEnv();
    let made = 0;
    const shared = await import("../web/gl-shared.js");
    shared.__setSharedFactory(() => { made++; return env.fake; });
    const uw = await import("../web/fishing-underwater.js");
    uw.__resetForTest();
    let clock = 0; uw.__setClock(() => (clock += 1));      // 1 ms per call pair = well under budget
    const c = uw.renderUnderwater(live(), "s340", extras, 1);
    assert.equal(c, env.canvas);
    assert.deepEqual(env.calls.find((x) => x[0] === "viewport"), ["viewport", 0, 0, uw.UW_W, uw.UW_H]);
    assert.deepEqual(env.calls.filter((x) => x[0] === "scissor").map((x) => x[1]), [true, false]);
    uw.renderUnderwater(live(), "s340", extras, 1.02);
    assert.equal(made, 1);
    assert.equal(shared.sharedContextCount(), 1);
});

test("context lost: inset off, nothing drawn, no retry", async () => {
    const env = fakeEnv();
    const shared = await import("../web/gl-shared.js");
    let made = 0;
    shared.__setSharedFactory(() => { made++; return env.fake; });
    const uw = await import("../web/fishing-underwater.js");
    uw.__resetForTest();
    uw.__setClock(() => 0);
    assert.ok(uw.renderUnderwater(live(), "s340", extras, 1));
    env.lose();
    const before = env.calls.length;
    for (let i = 0; i < 5; i++) assert.equal(uw.renderUnderwater(live(), "s340", extras, 2 + i * 0.02), null);
    assert.equal(env.calls.length, before);             // not a single GL call after the loss
    assert.equal(uw.underwaterInfo().failed, true);
    assert.equal(made, 1);                              // never re-created
});

test("over budget: inset turns itself off for the session", async () => {
    const env = fakeEnv();
    const shared = await import("../web/gl-shared.js");
    shared.__setSharedFactory(() => env.fake);
    const uw = await import("../web/fishing-underwater.js");
    uw.__resetForTest();
    let clock = 0; uw.__setClock(() => (clock += 5));    // 5 ms per frame (t1 - t0)
    let off = -1;
    for (let i = 0; i < 40 && off < 0; i++) if (uw.renderUnderwater(live(), "s340", extras, 1 + i * 0.02) === null) off = i;
    assert.ok(off >= 31 && off <= 33, `tripped at frame ${off}`);
    assert.equal(uw.underwaterInfo().failed, true);
    assert.equal(uw.renderUnderwater(live(), "s340", extras, 5), null);
});
