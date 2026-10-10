// Raw GPU primitives on the native screens, from the original overlay's own
// packet publishes. Two named instances do not travel the recorded
// picture-service stream (ledger claim
// screen-rendering-model-misses-raw-gpu-primitives-2026-10-05, frontier
// RENDER2D-Q001):
//
//   - the 0x2A full-screen subtractive dim (pro/stgmcard F0x80082e7c and its
//     battle copy FIGHTSTG_F0x8008a8c4; docs/research/ui/screen-rendering-model.md §4)
//   - the memory-card screen's POLY_G4 transition bar (pro/stgmcard F0x80083c50,
//     ledger claim UI-STGMCARD-TRANSITION-QUAD-2026-08-14)
//
// They are captured at the packet-cursor publish (engine/native/raw-prims.ts +
// SET_DE30) and painted by the shared renderer (web/native-screen-render.js).
// This check boots pro/stgmcard in the lab, drives the slot-confirm and the
// later exit fade until both primitives have been produced, and pins:
//   - the captured intents: dim corners (0,0)/(320,0)/(0,256)/(320,256), one
//     equal colour triple, ABR 2, bucket 0 (the dim object's +0x54);
//     the bar's colour triples (0x7F,0x32,0xF2)/(0xD1,0x2F,0xDE) in the
//     0/1/0/1 vertex pattern and bucket 1;
//   - the renderer painted both (rawKinds);
//   - the dim's subtract on real canvas pixels: a before/after pair where the
//     darker pixel equals max(0, before - level) (the doc's mechanism, not an
//     alpha fade);
//   - before/mid screenshots and a state.json.
//
// Server: VERIFY_PORT=8755 tools/run-playwright.sh tools/verify_native_screen_raw_prims.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.NATIVE_SCREEN_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.NATIVE_SCREEN_RAW_SHOTS || "/tmp/native-screen-raw-prims";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 1050 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

/** Pixels of the 320x240 canvas at a few spots over the card UI and the fade. */
const sample = () =>
    page.evaluate(() => {
        const el = document.getElementById("c");
        const ctx = el.getContext("2d");
        const spots = [[40, 30], [160, 60], [160, 120], [200, 190], [100, 210]];
        const px = spots.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3)));
        const raws = window.__nativeScreenRawPrims();
        const render = window.__nativeScreenRender();
        const state = window.__nativeScreen();
        return {
            px,
            raws,
            rawKinds: render.rawKinds,
            raw: render.raw,
            frames: state.frames,
            traps: state.traps,
        };
    });

const press = async (word, hold = 130, wait = 620) => {
    await page.evaluate((w) => window.__nativeScreenPad(w), word);
    await page.waitForTimeout(hold);
    await page.evaluate(() => window.__nativeScreenPad(0));
    await page.waitForTimeout(wait);
};

try {
    await page.goto(`${ROOT}native-screen-lab.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.waitForFunction(
        () => typeof window.__nativeScreenList === "function" && window.__nativeScreenList().length >= 20,
        null,
        { timeout: 120000 },
    );
    await page.evaluate(() => window.__nativeScreenBoot("pro/stgmcard"));
    await page.waitForFunction(() => (window.__nativeScreen()?.frames ?? 0) >= 120, null, { timeout: 10000 });

    const before = await sample();
    await page.locator("#c").screenshot({ path: `${OUT}/stgmcard-before.png` });

    const seen = { dim: null, dimMax: 0, dimMin: 0xff, quad: null, mid: null };
    const note = (s) => {
        for (const p of s.raws) {
            if (p.kind === "polyG4" && !seen.quad) seen.quad = p;
            if (p.kind === "dimQuad") {
                if (!seen.dim) seen.dim = p;
                seen.dimMax = Math.max(seen.dimMax, p.intent.rgb[0]);
                seen.dimMin = Math.min(seen.dimMin, p.intent.rgb[0]);
            }
        }
    };
    note(before);

    // The slot-confirm creates the bar object and starts its spin; the exit fade
    // raises the dim. One drive, sampled between presses.
    for (const word of [0x2000, 0x2000, 0x4000, 0x2000, 0x0008]) {
        await page.evaluate((w) => window.__nativeScreenPad(w), word);
        await page.waitForTimeout(130);
        await page.evaluate(() => window.__nativeScreenPad(0));
        for (let i = 0; i < 16; i++) {
            const s = await sample();
            note(s);
            if (!seen.mid && s.raws.some((p) => p.kind === "dimQuad")) {
                const k = s.raws.find((p) => p.kind === "dimQuad").intent.rgb[0];
                if (k >= 16 && k <= 220) {
                    seen.mid = { k, px: s.px };
                    await page.locator("#c").screenshot({ path: `${OUT}/stgmcard-mid.png` });
                }
            }
            await page.waitForTimeout(45);
        }
    }
    // A few more samples in case the fade lands later.
    for (let i = 0; i < 80 && !(seen.mid && seen.dimMax - seen.dimMin >= 16); i++) {
        const s = await sample();
        note(s);
        if (!seen.mid && s.raws.some((p) => p.kind === "dimQuad")) {
            const k = s.raws.find((p) => p.kind === "dimQuad").intent.rgb[0];
            if (k >= 16 && k <= 220) {
                seen.mid = { k, px: s.px };
                await page.locator("#c").screenshot({ path: `${OUT}/stgmcard-mid.png` });
            }
        }
        await page.waitForTimeout(45);
    }

    const state = await page.evaluate(() => ({
        screen: window.__nativeScreen(),
        render: window.__nativeScreenRender(),
    }));
    writeFileSync(`${OUT}/state.json`, JSON.stringify({ before, seen, state }, null, 1) + "\n");

    const problems = [];
    if (errors.length) problems.push(`page errors: ${errors.join(" | ")}`);

    if (!seen.quad) {
        problems.push("the POLY_G4 transition bar was never captured");
    } else {
        const i = seen.quad.intent;
        const want = JSON.stringify([
            [0x7f, 0x32, 0xf2],
            [0xd1, 0x2f, 0xde],
            [0x7f, 0x32, 0xf2],
            [0xd1, 0x2f, 0xde],
        ]);
        if (i.cmd !== 0x38) problems.push(`bar cmd ${i.cmd}, expected 0x38`);
        if (JSON.stringify(i.rgb) !== want) problems.push(`bar colours ${JSON.stringify(i.rgb)} != ${want}`);
        if (seen.quad.bucket !== 1) problems.push(`bar bucket ${seen.quad.bucket}, expected 1 (its ctor's +0x54)`);
        // The emit site builds the quad from RotMatrix/ScaleMatrix/ApplyMatrixSV;
        // with those served as GTE no-ops every vertex landed on the rotation
        // pivot and this was a single point. A real bar has more than one vertex.
        const verts = i.x.map((x, k) => `${x},${i.y[k]}`);
        if (new Set(verts).size < 2) problems.push(`the bar's four vertices are all (${verts[0]}) - they collapsed to the pivot`);
    }

    if (!seen.dim) {
        problems.push("the 0x2A dim quad was never captured");
    } else {
        const i = seen.dim.intent;
        if (i.cmd !== 0x2a) problems.push(`dim cmd ${i.cmd}, expected 0x2A`);
        if (JSON.stringify(i.x) !== "[0,320,0,320]" || JSON.stringify(i.y) !== "[0,0,256,256]") {
            problems.push(`dim corners x=${JSON.stringify(i.x)} y=${JSON.stringify(i.y)}, expected the full screen`);
        }
        if (!(i.rgb[0] === i.rgb[1] && i.rgb[1] === i.rgb[2])) problems.push(`dim colour not one level: ${JSON.stringify(i.rgb)}`);
        if (i.abr !== 2) problems.push(`dim ABR ${i.abr}, expected 2 (subtract)`);
        if (seen.dim.bucket !== 0) problems.push(`dim bucket ${seen.dim.bucket}, expected 0 (its ctor's +0x54)`);
        if (!(seen.dimMax - seen.dimMin >= 16)) {
            problems.push(`the dim never ramped (levels ${seen.dimMin}..${seen.dimMax})`);
        }
    }

    const kinds = state.render?.rawKinds ?? {};
    if (!(kinds.polyG4 >= 1)) problems.push(`renderer painted no POLY_G4 (rawKinds ${JSON.stringify(kinds)})`);
    if (!(kinds.dimQuad >= 1)) problems.push(`renderer painted no dim quad (rawKinds ${JSON.stringify(kinds)})`);

    if (seen.mid) {
        // The doc's mechanism: subtrahend level k, pixel becomes max(0, c - k).
        let matched = 0;
        for (let i = 0; i < before.px.length; i++) {
            const b = before.px[i];
            const m = seen.mid.px[i];
            const expect = b.map((c) => Math.max(0, c - seen.mid.k));
            if (m.every((c, j) => Math.abs(c - expect[j]) <= 2) && JSON.stringify(m) !== JSON.stringify(b)) matched++;
        }
        if (matched === 0) {
            problems.push(
                `no pixel matched max(0, before - ${seen.mid.k}): before=${JSON.stringify(before.px)} during=${JSON.stringify(seen.mid.px)}`,
            );
        }
    } else {
        problems.push("no mid-ramp dim sample was taken; the subtract could not be pixel-checked");
    }
    if (state.screen?.traps !== 0) problems.push(`traps=${state.screen?.traps}`);

    if (problems.length) {
        console.error(`FAIL native screen raw primitives:\n- ${problems.join("\n- ")}`);
        process.exitCode = 1;
    } else {
        console.log(
            `PASS native screen raw primitives: bar colours ${JSON.stringify(seen.quad.intent.rgb[0])}/${JSON.stringify(seen.quad.intent.rgb[1])} ` +
                `(bucket ${seen.quad.bucket}); dim level ${seen.dimMin}->${seen.dimMax} (bucket ${seen.dim.bucket}); ` +
                `painted rawKinds=${JSON.stringify(kinds)}; shots ${OUT}/stgmcard-before.png ${OUT}/stgmcard-mid.png`,
        );
    }
} finally {
    await browser.close();
}
