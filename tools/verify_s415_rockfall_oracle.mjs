// Rockfall oracle — the ported falling rock against the ORIGINAL machine code.
//
// The s415 boulders can be run two ways: engine/systems/falling-object.ts (the
// translated port, what the game plays) and the MIPS interpreter running
// wstag415's own tick 0x800a5fa8 and draw 0x800a5ee8 verbatim (the research
// route, `?nativeStages`). This puts one rock of each kind on the stage in the
// SAME frame and compares their streams, so the port is checked against the
// disc rather than against my own reading of it.
//
// Both are constructed through window.__stageObjects: `fire` builds the ported
// rock, `nativeFire` pushes the same registry id down the interpreter. The
// engine bridge gives the ported route first refusal, so nothing else can
// construct these ids while this runs.
//
//   tools/run-playwright.sh tools/verify_s415_rockfall_oracle.mjs [out-dir]

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const origin = `${baseUrl(8742)}`;
const outDir = resolve(process.argv[2] ?? "/tmp/s415-rockfall-oracle");
await mkdir(outDir, { recursive: true });

const IDS = [816, 817, 818, 819, 820, 821, 822, 823, 824, 825];
const FRAMES = 90;

const browser = await chromium.launch();
const context = await browser.newContext({
    viewport: { width: 900, height: 700 },
    storageState: {
        cookies: [],
        origins: [{
            origin,
            localStorage: [
                { name: "engineSchema", value: "2" },
                { name: "assetMode", value: "authentic" },
                { name: "progressOrdinal", value: "6" },
                { name: "charId", value: "p003pken" },
                { name: "party", value: JSON.stringify(["p003pken", "p005koet", "p004kogu"]) },
            ],
        }],
    },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
    await page.goto(`${origin}/?skipTitle=1&map=s415&noEncounters=1&nativeStages=1`, {
        waitUntil: "load",
    });
    await page.waitForFunction(() => window.__state?.started && window.__engineBridge, null, {
        timeout: 30_000,
    });

    // One rock of each kind, both born in this frame. `fire` first, then
    // `nativeFire`, and the ids are already live so the cutscene's own
    // SETANIM 816..825 cannot add a second generation.
    const born = await page.evaluate((ids) => {
        window.__stageObjects.clear("s415");
        const ported = ids.filter((id) => window.__stageObjects.fire(id, id, "s415"));
        const native = ids.filter((id) => window.__stageObjects.nativeFire(id, "s415"));
        return { ported, native };
    }, IDS);
    assert.equal(born.ported.length, IDS.length, `ported rocks: ${JSON.stringify(born.ported)}`);
    assert.equal(born.native.length, IDS.length, `native rocks: ${JSON.stringify(born.native)}`);

    // Sample both streams once per rendered frame. The interpreter clears
    // rt.drawCalls at the top of its own tick and the render loop runs that
    // tick before the frame is presented, so a rAF registered after the game's
    // sees the calls for the frame just drawn.
    const stream = await page.evaluate(async (frames) => {
        const { nativeStage } = await import("./native-stage.js");
        const native = nativeStage("s415");
        if (!native) return { error: "native stage did not boot" };
        const ported = [];
        const original = [];
        for (let f = 0; f < frames; f++) {
            await new Promise((r) => requestAnimationFrame(r));
            original.push(
                native.rt.drawCalls
                    .filter((c) => c.method === "drawSprite" && c.args[1] >= 70 && c.args[1] <= 77)
                    .map((c) => ({ clip: c.args[1], x: c.args[2], y: c.args[3] }))
                    .sort((p, q) => p.clip - q.clip || p.x - q.x),
            );
            ported.push(
                window.__stageObjects.draws("s415")
                    .map((d) => ({ clip: d.clip, x: d.x, y: d.y }))
                    .sort((p, q) => p.clip - q.clip || p.x - q.x),
            );
        }
        return { ported, original };
    }, FRAMES);

    assert.ok(!stream.error, stream.error ?? "");
    const { ported, original } = stream;

    // The original must actually be animating, or the comparison is vacuous.
    const originalClips = [...new Set(original.flat().map((e) => e.clip))].sort((a, b) => a - b);
    assert.deepEqual(
        originalClips,
        [70, 71, 72, 73, 74, 75, 76, 77],
        "the original's own drawSprite calls name the whole rockfall family",
    );

    const portedClips = [...new Set(ported.flat().map((e) => e.clip))].sort((a, b) => a - b);
    assert.deepEqual(portedClips, originalClips, "the port animates the same clips");

    // Both sets are ten rocks born in the same frame, so the per-frame lists
    // must agree clip for clip and pixel for pixel.
    let comparedFrames = 0;
    for (let f = 0; f < Math.min(ported.length, original.length); f++) {
        if (!ported[f].length && !original[f].length) continue;
        assert.deepEqual(
            ported[f].map((e) => e.clip),
            original[f].map((e) => e.clip),
            `frame ${f} clip list`,
        );
        for (let i = 0; i < ported[f].length; i++) {
            assert.deepEqual(
                ported[f][i],
                original[f][i],
                `frame ${f} rock ${i}`,
            );
        }
        comparedFrames++;
    }
    assert.ok(comparedFrames >= 20, `only ${comparedFrames} frames had rocks on both sides`);

    const report = {
        outDir, frames: FRAMES, comparedFrames,
        clips: originalClips,
        firstWithRocks: original.findIndex((e) => e.length),
        lastWithRocks: original.length - 1 - [...original].reverse().findIndex((e) => e.length),
        sampleFrame: original.findIndex((e) => e.length),
        errors,
    };
    await writeFile(resolve(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    assert.deepEqual(errors, [], `page errors: ${errors.join("; ")}`);
    console.log(JSON.stringify({ ok: true, ...report }, null, 2));
} finally {
    await browser.close();
}