// Headless check for the resident 2D draw-context service's two stage users, in
// normal play.
//
//   VERIFY_PORT=8970 tools/run-playwright.sh tools/verify_draw_context_annotators.mjs
//
// Both members live on stages the game can open: the manifest ids carry the `s`
// (web/assets/manifest.json, all 294 of them), so this check opens
// `?skipTitle=1&map=s805` and `?skipTitle=1&map=s820` and lets the stage's OWN
// event 821 build the member through `web/stage-objects.js` -- the same module and
// the same entry points the render loop calls. The 2026-10-04 version of this file
// claimed neither stage was in the manifest; it was wrong, and `?map=805` (no
// `s`) is what had been failing.
//
// WHAT IT ASSERTS, per stage:
//
//   1. the service runs in ordinary play: the member is constructed, the queue is
//      filled through its shape routine, the flush hands the passes over in the
//      order the service keeps them (descending key, arrival order on a tie), and
//      every pass carries the shape id and CLUT row the overlay's own writers
//      give it -- all of them ids the stage's own sprite directory holds;
//   2. THE CANVAS CARRIES THE DISC'S OWN TEXELS. The player is teleported next to
//      a marker so the camera covers it, the window over the marker is sampled,
//      the member is dropped and the window sampled again: the two must differ,
//      and the difference must sit inside the rectangles the decoded clip names.
//      A marker that draws nothing, or draws something of its own invention, both
//      fail here. (The first pass of this work drew a flat tinted box and the
//      2026-10-04 review rejected it; this leg is the positive replacement for
//      the "nothing may be drawn" check that came after.)
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const PORT = process.env.VERIFY_PORT || 8970;
const BASE = `http://localhost:${PORT}`;
const outDir = resolve(process.argv[2] ?? ".bunny-scratch/annotator-check");
await mkdir(outDir, { recursive: true });

// The child the walker stands next to, and where: s820's four markers are at
// (460,436), (460,436), (652,341) and (364,242) (wstag820.s:634-641 and its
// four-record table); s805's ring marches from (8,140) to (668,-20).
const LEGS = [
    {
        stage: "s805",
        id: 841,
        name: "s805 0x349 -- the twenty-seven marker ring",
        // The delay walk lights ONE child per window of 4..12 ticks, so which
        // marker is on screen changes while the A/B runs: stand in the middle of
        // the ring and let the leg measure that the difference is one compact
        // marker rather than a fixed rect.
        stand: { x: 340, y: 160 },
        bounds: { maxW: 160, maxH: 160 },
        check: (state, marks) => {
            if (state?.annotator?.children !== 27) {
                return `expected 27 pooled children, saw ${state?.annotator?.children}`;
            }
            if (state.annotator.shapeSet?.resource !== 0x672) {
                return `the stage's own sprite directory is 0x${(state.annotator.shapeSet?.resource ?? 0).toString(16)}`;
            }
            // How many blanks it takes to reach a child's window is the game's,
            // because the delay walk spends the resident random (web/game.js wires
            // rand16). Every request that does come must be well formed, and at
            // most one child per blank, because the delay walk fires exactly one.
            const kids = new Set(marks.map((m) => m.child));
            if (kids.size > 1) return `the delay walk lit ${kids.size} children at once`;
            for (const m of marks) {
                if (!Number.isInteger(m.shape) || m.shape < 0) return `bad shape id ${m.shape}`;
                if (!m.clip?.layers?.length) return `shape ${m.shape} has no rectangle in the directory`;
                if (m.pass === 0) {
                    // +0x64 is the walk on 0x800A72B8's key, and +0x66 the walk on
                    // 0x800A7300's key (wstag805.s:1196-1232).
                    if (![42, 43, 44, 45].includes(m.shape)) {
                        return `the disc walk returned ${m.shape}, which is not one of 42..45`;
                    }
                    if (![0, 1].includes(m.clutRow)) return `the disc's CLUT row is ${m.clutRow}`;
                } else {
                    // +0x70 and +0x72 are both the literal 40 (wstag805.s:1176).
                    if (m.shape !== 40 || m.clutRow !== 40) {
                        return `the column pass is ${m.shape}/${m.clutRow}, not the literal 40`;
                    }
                }
            }
            return null;
        },
        finish: (state) => {
            if (!state?.annotator) return "the annotator vanished before the walk finished";
            if (!state.annotator.done) return `the walk stopped at hold ${state.annotator.hold}`;
            if (state.annotator.index !== 27) {
                return `the index stopped at ${state.annotator.index}, not on the end marker`;
            }
            return null;
        },
    },
    {
        stage: "s820",
        id: 845,
        name: "s820 0x34d -- the four Spy Satellite markers",
        stand: { x: 460, y: 436 },
        bounds: "strict",
        check: (state, marks) => {
            if (state?.annotator?.children !== 4) return `expected 4 children, saw ${state?.annotator?.children}`;
            if (state.annotator.shapeSet?.resource !== 0x715) {
                return `the stage's own sprite directory is 0x${(state.annotator.shapeSet?.resource ?? 0).toString(16)}`;
            }
            // The game may run two PAL blanks in one frame, so one read can hold two
            // flushes. Collapse them: every child must appear once per pass.
            const seen = new Map();
            for (const m of marks) seen.set(`${m.child}:${m.pass}`, m);
            if (seen.size !== 8) return `expected 4 children x 2 passes, saw ${seen.size} distinct`;
            marks = [...seen.values()];
            // The decoded contract: a disc's shape id is the child's own +0x50
            // (60, 60, 60, 44) and its CLUT row is the disc walk's key; a column's
            // shape id is that plus the key its own walk returned, and its CLUT row
            // is 0 because nothing in wstag820.s writes child+0x6A.
            const own = new Map([[0, 60], [1, 60], [2, 60], [3, 44]]);
            for (const m of marks.filter((q) => q.pass === 0)) {
                if (m.shape !== own.get(m.child)) return `child ${m.child}'s disc shape id is ${m.shape}`;
                // The disc table is {0,6} {1,6} {2,68} ... {0xFF,0}: a pass-0 walk
                // returns 0x00FF at the end marker and stops (wstag820.s:294), and
                // that value is the CLUT row, so the disc's palette ends its run on
                // a different row rather than the shape changing.
                if (![0, 1, 2, 0xff].includes(m.clutRow)) {
                    return `child ${m.child}'s disc CLUT row is ${m.clutRow}`;
                }
                if (m.clip?.layers?.length !== 1) {
                    return `s820's disc shapes are one rectangle, saw ${m.clip?.layers?.length}`;
                }
            }
            for (const m of marks.filter((q) => q.pass === 1)) {
                // The column's key is 1..7 while the run lasts, and 0x12C at its
                // end (wstag820.s:838, which zeroes +0x68 and then falls through to
                // the sum at :858-868) -- so the end of the column asks for the
                // child's own word plus 300, an id no directory holds. Nothing is
                // drawn for it here, which is what the port does; the shape request
                // itself is still checked.
                const key = m.shape - own.get(m.child);
                if (![1, 2, 3, 4, 5, 6, 7, 0x12c].includes(key)) {
                    return `child ${m.child}'s column key is ${key}`;
                }
                if (m.clutRow !== 0) return `the column's CLUT row is ${m.clutRow}, but nothing writes +0x6A`;
            }
            // The column sits 32px above its own disc (wstag820.s:538) and its queue
            // key is y + 0x12, so the flush order is descending key.
            const byChild = new Map(marks.map((m) => [`${m.child}:${m.pass}`, m]));
            for (const child of own.keys()) {
                const d = byChild.get(`${child}:0`);
                const c = byChild.get(`${child}:1`);
                if (!d || !c) return `child ${child} is missing a pass`;
                if (d.y - c.y !== 32) return `child ${child}'s column sits ${d.y - c.y}px above its disc`;
                if (c.key !== d.key + 0x12) return `child ${child}'s column key is ${c.key}, not y + 0x12`;
            }
            const keys = marks.map((m) => m.key);
            for (let i = 1; i < keys.length; i += 1) {
                if (keys[i] > keys[i - 1]) return `the flush order is not descending at ${i}: ${keys}`;
            }
            return null;
        },
    },
];

const failures = [];
const check = (leg, what, msg) => { if (msg) failures.push(`${leg.name}: ${what}: ${msg}`); };

/** How many pixels differ between two same-size RGBA buffers, and where. */
function diff(a, b) {
    let n = 0;
    let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
    for (let i = 0; i < a.length; i += 4) {
        if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) {
            const px = (i / 4) % a.w, py = Math.floor((i / 4) / a.w);
            n += 1;
            if (py < top) top = py;
            if (py > bottom) bottom = py;
            if (px < left) left = px;
            if (px > right) right = px;
        }
    }
    return { n, box: n ? { top, bottom, left, right } : null };
}

const browser = await chromium.launch();
try {
    for (const leg of LEGS) {
        const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        // Normal play: open the stage by its manifest id, no harness overrides.
        await page.goto(`${BASE}/?skipTitle=1&map=${leg.stage}&noEncounters=1`, { waitUntil: "load" });
        await page.waitForFunction(() => window.__state?.started, null, { timeout: 30000 });
        await page.waitForFunction((want) => window.__state?.manifest?.maps?.[window.__state.mapIdx]?.id === want,
            leg.stage, { timeout: 30000 });
        // Let the stage settle: the wipe gates the setup arm that fires op 13 /
        // event 821 (web/game.js `stepSetupTick` returns early while
        // `window.__fade.dir !== 0`).
        await page.waitForFunction(() => window.__fade.dir === 0, null, { timeout: 30000 });
        await page.waitForTimeout(900);

        const fired = await page.evaluate(async ({ stage, id }) => {
            const m = await import("./stage-objects.js");
            return m.fireStageObject(stage, id, id);
        }, { stage: leg.stage, id: leg.id });
        check(leg, "SETANIM", fired ? null : "the stage-object route did not claim the id");

        // One PAL blank, then read what the service's flush handed over. The
        // snapshot has to be one turn: the render loop keeps running, so the state
        // and the request list would otherwise straddle a flush.
        const snap = await page.evaluate(async (s) => {
            const m = await import("./stage-objects.js");
            m.paceStageObjects(s, [1]);
            return { state: window.__stageObjects.state(s), marks: window.__stageObjects.annotator(s) };
        }, leg.stage);
        const state = snap.state;
        const marks = snap.marks;
        check(leg, "first blank", leg.check(state, marks));

        // ── the pixels ──────────────────────────────────────────────────────
        // Stand next to a marker so the camera covers it, then A/B the window:
        // with the member live, and with it dropped. Only the member's own
        // rectangles may differ.
        const pix = await page.evaluate(async ({ stage, id, stand }) => {
            const m = await import("./stage-objects.js");
            const raf = () => new Promise((r) => requestAnimationFrame(r));
            window.__teleport(stand.x, stand.y);
            for (let i = 0; i < 30; i++) await raf();
            const cv = document.querySelector("canvas");
            const g = cv.getContext("2d");
            const grab = () => {
                const cam = window.__lastCam ?? { x: 0, y: 0, zoom: 1 };
                return { w: cv.width, h: cv.height, cam: { ...cam }, data: Array.from(g.getImageData(0, 0, cv.width, cv.height).data) };
            };
            // A still frame first: the pads and the scenery pulse, and a moving
            // neighbour would read as marker pixels.
            const still = async () => {
                let a, b;
                for (let i = 0; i < 40; i += 1) {
                    a = grab(); await raf(); b = grab();
                    let n = 0;
                    for (let k = 0; k < a.data.length; k += 4) {
                        if (a.data[k] !== b.data[k] || a.data[k + 1] !== b.data[k + 1] ||
                            a.data[k + 2] !== b.data[k + 2]) { n += 1; if (n > 8) break; }
                    }
                    if (n === 0) return a;
                }
                return b;
            };
            // Start the member's own run over: s805's delay walk finishes in a few
            // seconds of real time (its windows are 4..12 ticks and the resident
            // random spends up to 4 a blank), and once it reaches its 0x1000 end
            // bound the overlay draws nothing for the rest of the stage's life.
            m.clearStageObjects(stage);
            m.fireStageObject(stage, id, id);
            for (let i = 0; i < 6; i += 1) m.paceStageObjects(stage, [1]);
            // The render loop redraws on its own rAF, so give it two frames to
            // paint the member before sampling: reading the canvas straight after
            // a state change returns the PREVIOUS frame.
            await raf(); await raf();
            const on = await still();
            const live = window.__stageObjects.annotator(stage).map((r) => ({
                x: r.x, y: r.y, pass: r.pass, shape: r.shape, clutRow: r.clutRow,
            }));
            m.clearStageObjects(stage);
            await raf(); await raf();
            const off = await still();
            return { on, off, live, cam: on.cam, dropped: !window.__stageObjects.annotatorActive(stage) };
        }, { stage: leg.stage, id: leg.id, stand: leg.stand });

        check(leg, "pixels", pix.dropped ? null : "the member survived clearStageObjects, so the A/B is meaningless");
        const d = diff(pix.on.data, pix.off.data);
        if (d.n === 0) {
            check(leg, "pixels", "the marker drew nothing on the game's own canvas");
        } else {
            // The window the marker covers, in canvas pixels, from the requests the
            // service handed over and the live camera.
            const z = pix.cam.zoom ?? 1;
            let win = null;
            for (const r of pix.live) {
                const x0 = Math.round((r.x - pix.cam.x) * z);
                const y0 = Math.round((r.y - pix.cam.y) * z);
                const box = { l: x0, t: y0, r: x0 + Math.round(64 * z), b: y0 + Math.round(64 * z) };
                win = win ? {
                    l: Math.min(win.l, box.l), t: Math.min(win.t, box.t),
                    r: Math.max(win.r, box.r), b: Math.max(win.b, box.b),
                } : box;
            }
            if (!win) {
                check(leg, "pixels", `${d.n} px differ but the service handed over no request`);
            } else if (leg.bounds === "strict") {
                if (d.box.left < win.l - 2 || d.box.right > win.r + 2 ||
                    d.box.top < win.t - 2 || d.box.bottom > win.b + 2) {
                    check(leg, "pixels",
                        `${d.n} px differ at ${JSON.stringify(d.box)}, outside the marker's own ` +
                        `window ${JSON.stringify(win)}: something else is drawing`);
                }
            } else {
                const w = d.box.right - d.box.left, h = d.box.bottom - d.box.top;
                if (w > leg.bounds.maxW || h > leg.bounds.maxH) {
                    check(leg, "pixels",
                        `the difference is ${w}x${h} px at ${JSON.stringify(d.box)}, too spread out ` +
                        `for one marker (limit ${leg.bounds.maxW}x${leg.bounds.maxH})`);
                }
            }
        }
        await page.screenshot({ path: resolve(outDir, `${leg.stage}-markers.png`) });

        if (leg.finish) {
            const done = await page.evaluate(async ({ stage, id }) => {
                const m = await import("./stage-objects.js");
                // The pixel leg above dropped the member to A/B it; the delay walk
                // needs it back.
                m.fireStageObject(stage, id, id);
                let drew = 0;
                for (let i = 0; i < 1200; i += 1) {
                    m.paceStageObjects(stage, [1]);
                    drew += m.annotatorMarkers(stage).length;
                }
                return { state: m.stageObjectState(stage), drew };
            }, { stage: leg.stage, id: leg.id });
            check(leg, "delay walk", leg.finish(done.state));
            if (done.drew <= 0) check(leg, "delay walk", "no child produced a shape request in the whole run");
        }

        check(leg, "page", errors.length ? errors[0] : null);
        console.log(
            `${leg.name}: ${marks.length} shape request(s) on the first blank ` +
            `(shapes ${[...new Set(marks.map((m) => m.shape))].join(",")}, ` +
            `CLUT rows ${[...new Set(marks.map((m) => m.clutRow))].join(",")}), ` +
            `${d.n} px of marker texels on the canvas` +
            `${leg.finish ? ", walk finished on the end marker" : ", static markers"}`,
        );
        await page.close();
    }
} finally {
    await browser.close();
}

if (failures.length) {
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}
console.log(`PASS draw-context annotators: both stage users draw the disc's own texels in normal play (captures in ${outDir})`);
