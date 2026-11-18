// Look C fail-safe (web/ui-c/index.js): the scope may only swallow canvas pixels when look C is really on screen. Fake DOM, no browser.
import test from "node:test";
import assert from "node:assert/strict";

class El {
    constructor(tag) { this.tag = tag; this.children = []; this.parentNode = null; this.style = { setProperty() {} }; this.dataset = {}; this.className = ""; this.width = 300; this.height = 150; this.clientLeft = 0; this.clientTop = 0; this.clientWidth = 640; this.clientHeight = 480; this.classList = { contains: () => false }; }
    get isConnected() { let e = this; while (e.parentNode) e = e.parentNode; return e === doc.body; }
    append(...c) { c.forEach((x) => this.appendChild(x)); }
    appendChild(c) { c.parentNode?.children.splice(c.parentNode.children.indexOf(c), 1); c.parentNode = this; this.children.push(c); return c; }
    insertBefore(c, ref) { c.parentNode?.children.splice(c.parentNode.children.indexOf(c), 1); c.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
    remove() { if (this.parentNode) { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; } }
    getBoundingClientRect() { return { left: 0, top: 0, width: this.rw ?? 640, height: this.rh ?? 480, toJSON() { return this; } }; }
    getContext() { return { setTransform() {}, clearRect() {}, getTransform: () => ({ a: 2, d: 2, e: 0, f: 0 }) }; }
    querySelectorAll() { return []; }
}
const body = new El("body");
const stage = new El("div"); stage.id = "stage"; body.appendChild(stage);
const doc = {
    body, documentElement: { classList: { contains: () => false } }, styleSheets: [],
    fonts: { load: async () => [{}] }, fullscreenElement: null,
    getElementById: (id) => (id === "stage" ? stage : null),
    createElement: (t) => new El(t),
};
// what the browser would report for #ui-c-root; each test flips a knob
const css = { display: "block", visibility: "visible", opacity: "1", position: "absolute", zIndex: "12", ok: "1" };
globalThis.document = doc;
globalThis.window = globalThis;
const sibCss = new Map();   // element -> css overrides for a sibling of the root
globalThis.getComputedStyle = (el) => ({ ...css, ...(sibCss.get(el) ?? {}), getPropertyValue: (n) => (n === "--uic-ok" ? css.ok : "") });
globalThis.requestAnimationFrame = () => 1;
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "TestChrome/1" }, configurable: true });

let skew = 0; const realNow = performance.now.bind(performance); performance.now = () => realNow() + skew;   // jump the clock instead of waiting
const warns = [];
console.warn = (...a) => warns.push(a.join(" "));

const uiC = await import("../web/ui-c/index.js");
await new Promise((r) => setTimeout(r, 20));    // fonts promise

const canvas = new El("canvas"); canvas.width = 640; canvas.height = 480; canvas.parentNode = body;
canvas.getTransform = undefined;
const ctx = { canvas, getTransform: () => ({ a: 2, d: 2, e: 0, f: 0 }) };
const run = (key = "k") => { let painted = 0; const drew = uiC.scope(key, ctx, { enable: true, compose: () => [] }, () => { painted++; }); return { drew, painted }; };

test("healthy page: look C draws, no console line", () => {
    const r = run();
    assert.equal(r.drew, true); assert.equal(window.__uiC.off().broken, false); assert.equal(warns.length, 0);
});

test("CSS not applied (sentinel empty): pixels drawn, ONE `[ui-c] off:` line with the values", () => {
    css.ok = "";
    const r = run("a1");
    assert.equal(r.drew, false, "overlay gives up");
    assert.equal(r.painted, 2, "the painting runs again unswallowed in the same frame");
    assert.equal(warns.length, 1);
    assert.equal(window.__uiC.off().reason, "css not applied (--uic-ok sentinel missing)");
    assert.match(warns[0], /^\[ui-c\] off: css not applied \(--uic-ok sentinel missing\)/);
    for (const w of ["sentinel", "fonts", "ua", "TestChrome/1", "rect"]) assert.ok(warns[0].includes(w), w);
    // while broken: straight pixels, one fn call, no second line
    const r2 = run("a1");
    assert.deepEqual([r2.drew, r2.painted, warns.length], [false, 1, 1]);
    assert.equal(window.__uiC.layers().length, 0);
});

test("root hidden / zero rect / opacity 0: fail-safe each time, no duplicate line", async () => {
    css.ok = "1";
    const cases = [["display", "none"], ["visibility", "hidden"], ["opacity", "0"], ["zIndex", "auto"]];
    for (const [k, v] of cases) {
        const orig = css[k];
        skew += 3100;         // the broken state ends, look C is tried again
        css[k] = v;
        const before = warns.length;
        const r = run("b" + k);
        css[k] = orig;
        assert.equal(r.drew, false, k); assert.equal(r.painted, 2, k);
        assert.equal(warns.length, before, "only the first failure prints");
    }
});

test("root covered by an opaque higher sibling (the #title-screen case): fail-safe names it", () => {
    skew += 3100;
    const title = new El("div"); title.id = "title-screen"; stage.appendChild(title);
    sibCss.set(title, { display: "flex", position: "absolute", zIndex: "10", backgroundColor: "rgb(20, 20, 30)", opacity: "1" });
    const clear = run("cover0");                      // z 10 < root 12: not covering
    assert.equal(clear.drew, true);
    skew += 3100;
    sibCss.set(title, { display: "flex", position: "absolute", zIndex: "20", backgroundColor: "rgb(20, 20, 30)", opacity: "1" });
    const before = warns.length;
    const r = run("cover1");
    assert.equal(r.drew, false); assert.equal(r.painted, 2);
    assert.equal(warns.length, before, "the one line was already printed");
    assert.equal(window.__uiC.off().reason, "root covered by #title-screen");
    sibCss.delete(title); title.remove();
});

test("empty root rect: fail-safe", async () => {
    skew += 3100;
    const root = document.getElementById("stage").children.find((c) => c.id === "ui-c-root");
    root.rw = 0;
    const r = run("zero");
    root.rw = undefined;
    assert.equal(r.drew, false); assert.equal(r.painted, 2);
});

test("recovers: when the page is healthy again look C comes back after the retry delay", async () => {
    skew += 3100;
    const r = run("back");
    assert.equal(r.drew, true); assert.equal(r.painted, 1);
});

test("fonts failing: pixels, one line naming the failed faces (separate module instance)", async () => {
    warns.length = 0;
    document.fonts.load = async (f) => { if (f.includes("Russo")) throw new Error("blocked"); return []; };
    const m = await import("../web/ui-c/index.js?fonts");
    await new Promise((r) => setTimeout(r, 20));
    let painted = 0;
    const drew = m.scope("f", ctx, { enable: true, compose: () => [] }, () => { painted++; });
    assert.equal(drew, false); assert.equal(painted, 1);
    assert.equal(warns.length, 1);
    assert.match(warns[0], /^\[ui-c\] off: fonts failed to load/);
    assert.ok(warns[0].includes("error: blocked") && warns[0].includes("empty"));
});
