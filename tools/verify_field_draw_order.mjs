// Field draw order + the walk-sound trigger -- the browser proof for the port
// of the original's ONE ordering rule (web/draw-order.js) and the player-only
// footstep.
//
// Decode: docs/research/field/draw-context-service-2026-10-04.md sections 4-5;
// docs/research/field/point-sprite-ambient-system.md (a record's layer byte is
// its ordering bucket); docs/research/field/asuka-city-cars-and-news-screens-
// 2026-10-04.md (the street-prop drawer's bucket 2, the stinger's bucket 7).
//
// Asserts, all against the shipped tree rather than hand-copied numbers:
//   1. web/draw-order.js exists and groups a base + its sub-parts into ONE
//      drawable keyed by the base's baseline, drawn in emission order.
//   2. On s780 with the traffic-light corner armed (master ordinal 27, its own
//      gate), the broadcast's street-prop lamp glows are submitted on the
//      in-front band (bucket 2) -- not y-sorted behind their own pole housing.
//   3. The corner stinger is submitted behind every entity (its bucket 7).
//   4. During a scripted NPC walk with the player standing, the player's
//      footstep counter does NOT advance (only the player's own move handler
//      emits the step).
// Writes a canvas capture per phase into <outdir>.
//
// Run with a web server on port 8788 (or set VERIFY_URL):
//   python3 -m http.server 8788 --directory web
//   tools/run-playwright.sh tools/verify_field_draw_order.mjs <outdir>
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const OUT = process.argv[2] || ".dw3-research/playtest-field-order-port-2026-10-07/browser";
const URL = process.env.VERIFY_URL || "http://localhost:8788";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

async function enter(mapId) {
    await page.goto(`${URL}/index.html?skipTitle=1&map=${mapId}`);
    const style = page.locator("#asset-mode-authentic");
    if (await style.isVisible().catch(() => false)) await style.click();
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 30000 });
    await page.evaluate((id) => {
        const i = window.__state.manifest.maps.findIndex((m) => m.id === id);
        if (i >= 0) window.__setMap(i, null);
    }, mapId);
    await page.waitForTimeout(200);
}

let failures = 0;
async function check(name, fn) {
    try { await fn(); console.log(`PASS  ${name}`); }
    catch (e) { failures++; console.log(`FAIL  ${name}: ${e.message}`); }
}

try {
    await enter("s780");

    // 1. The one rule exists and behaves.
    await check("the composite push groups a base and its sub-parts into one drawable", async () => {
        const r = await page.evaluate(async () => {
            const mod = await import("/draw-order.js");
            const d = [];
            const seen = [];
            mod.pushComposite(d, 231, [() => seen.push("housing"), () => seen.push("lamp")]);
            d[0].draw();
            return { len: d.length, y: d[0].y, seen, infront: mod.IN_FRONT_OF_ENTITIES, behind: mod.BEHIND_ENTITIES };
        });
        assert.equal(r.len, 1, "base + sub-part is ONE drawable");
        assert.equal(r.y, 231, "keyed by the base's baseline");
        assert.deepEqual(r.seen, ["housing", "lamp"], "sub-parts draw in order");
        assert.equal(r.infront, Infinity);
        assert.equal(r.behind, -Infinity);
    });

    // 2 + 3. The street-prop band and the stinger band, on the live corner.
    await check("the street-prop lamps submit in front of every entity, the stinger behind", async () => {
        await page.evaluate(() => { window.__state.progressOrdinal = 27; window.__logDrawOrder = true; });
        await page.evaluate(() => {
            const i = window.__state.manifest.maps.findIndex((m) => m.id === "s780");
            if (i >= 0) window.__setMap(i, null);
        });
        await page.waitForTimeout(1200);
        await page.evaluate(() => { if (window.__textbox?.isOpen?.()) window.__textbox.close(); });
        await page.waitForTimeout(400);
        const comps = await page.evaluate(() => window.__drawComposites ?? []);
        const props = comps.filter((c) => c.tag === "street-prop");
        assert.ok(props.length > 0, "the street-prop drawer submitted this frame (corner armed)");
        for (const p of props) {
            assert.ok(p.key === Infinity,
                `street-prop must be on the in-front band, got key ${p.key}`);
        }
        const stingers = comps.filter((c) => c.tag === "stinger");
        for (const s of stingers) {
            assert.equal(s.key, -Infinity, "the stinger must draw behind every entity");
        }
        // Capture the corner so the lamps-on-housing fix is visible.
        await page.evaluate(() => window.__teleport?.(240, 250));
        await page.waitForTimeout(500);
        await page.locator("#game").screenshot({ path: `${OUT}/corner-ordinal27.png` });
    });

    // 4. The footstep fires only while the PLAYER walks.
    await check("a scripted NPC walk leaves the player's footstep counter still", async () => {
        await enter("s780");
        assert.equal(await page.evaluate(() => typeof window.__footstepCount), "function",
            "the player's step counter is instrumented (the player-only gate is present)");
        await page.evaluate(() => { window.__gameSpeed = 3; });
        let windows = 0;
        let advanced = 0;
        let prev = null;
        for (let i = 0; i < 400; i++) {
            await page.keyboard.press("Enter");
            const s = await page.evaluate(() => ({
                walk: window.__cutscene?.walking?.() ?? 0,
                playerMoving: !!window.__state?._cutTarget,
                fs: window.__footstepCount?.(),
            }));
            if (prev && s.walk > 0 && !s.playerMoving && prev.walk > 0 && !prev.playerMoving) {
                windows += 1;
                advanced += Math.max(0, (s.fs ?? 0) - (prev.fs ?? 0));
            }
            prev = s;
            if (windows >= 5) break;
            await page.waitForTimeout(70);
        }
        await page.evaluate(() => { window.__gameSpeed = 1; });
        assert.ok(windows > 0, "an NPC-only walk window was sampled (where the step used to fire)");
        assert.equal(advanced, 0, `the player's step counter advanced ${advanced} across ${windows} NPC-only walk frames`);
    });

    await page.screenshot({ path: `${OUT}/opening-full.png` });
    console.log(errs.length ? `page errors: ${errs.slice(0, 4).join(" | ")}` : "no page errors");
} finally {
    await browser.close();
}
console.log(failures ? `RESULT: ${failures} check(s) FAILED` : "RESULT: all checks passed");
process.exit(failures ? 1 : 0);
