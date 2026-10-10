// The A.O.A news screens on the Kusanagi City street corner, in ordinary play.
//
// Boots s780 with NO research flag (no `?nativeStages`), so what runs is the
// translated game: web/stage-objects.js owns the stage's own actors and
// engine/systems/street-screens.ts is the screen driver. The check is the
// player's own: the corner screens are lit on an ordinary visit, and when the
// opening announcement reaches its `SETANIM 801 802` line they move to the news
// tiles and keep moving.
//
//   Run:  python3 -m http.server $PORT --directory web &
//         VERIFY_PORT=$PORT tools/run-playwright.sh tools/verify_s780_screens.mjs [outdir]
//
// NATIVE=1 adds the differential: the same driver inside the ORIGINAL machine
// code (the research route, one blank at a time) against the port, both started
// from the driver's boot state, reporting the first blank they disagree on. It
// needs `?nativeStages`, so it runs in its own page and calls the port directly.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] || "/tmp/s780-screens";
const PORT = process.env.VERIFY_PORT ?? "8741";
const BLANKS = Number(process.env.BLANKS || 240);
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const logs = [];
let failed = false;

function fail(why) {
    failed = true;
    console.log(`FAIL ${why}`);
}

/** The screens' own state: how many quads, and which tile each cursor shows.
 *  The engine bundle is imported from the same URL the game imports it from, so
 *  this is the very instance the running game ticks. */
const READ_SCREENS = async () => {
    const mod = await import("/vendor/engine.js");
    // A build without the port has no screens hook at all; report that as zero
    // quads instead of throwing, so the before/after capture still runs.
    const hook = window.__stageObjects?.screens;
    const quads = typeof hook === "function" ? hook() : [];
    const state = mod.streetScreenState ? mod.streetScreenState("s780") : null;
    return {
        route: typeof hook === "function",
        quads: quads.length,
        cursors: state ? state.cursors.map((c) => [c.sequence, c.position, c.value, c.remaining]) : null,
        tile0: quads[1] ? `${quads[1].u[0]}:${quads[1].v[0]}` : null,
        tile1: quads[13] ? `${quads[13].u[0]}:${quads[13].v[0]}` : null,
        blend: quads.filter((q) => q.cmd === 0x2e).length,
    };
};

try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
    page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
    await page.goto(`${baseUrl(PORT)}/?skipTitle=1&map=s780`);
    const style = page.locator("#asset-mode-authentic");
    if (await style.isVisible().catch(() => false)) await style.click();
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 20000 });
    // The translated driver must own this stage, not the interpreter.
    const route = await page.evaluate(async () => {
        const ns = await import("/native-stage.js");
        return { native: !!ns.nativeStage("s780"), search: location.search };
    });
    console.log(`ROUTE ${JSON.stringify(route)}`);
    if (route.search.includes("nativeStages")) fail("booted with the research flag");
    if (route.native) fail("the interpreter owns this stage, so the port stood down");

    // Re-enter so the opening announcement runs from its first line, then stand
    // where the screen row is on the picture (the driver's own record table puts
    // the column screens between map x 335 and x 399). Only the camera moves.
    await page.evaluate(() => {
        const idx = window.__state.manifest.maps.findIndex((m) => m.id === "s780");
        if (idx >= 0) window.__setMap(idx, null);
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
        window.__state.x = 300;
        window.__state.y = 210;
        window.__state.dir = "up";
    });
    await page.waitForTimeout(400);

    const street = await page.evaluate(READ_SCREENS);
    console.log(`STREET ${JSON.stringify(street)}`);
    if (!street.route) fail("this build has no street-screen route at all");
    if (street.quads !== 40) fail(`expected 40 screen quads on an ordinary visit, saw ${street.quads}`);
    if (street.blend !== 20) fail(`expected 20 blended frame quads, saw ${street.blend}`);
    if (!street.cursors) fail("no driver state: the screens are not the translated driver");
    await page.screenshot({ path: `${OUT}/street.png` });

    // Walk the announcement the way a player does: press on through the
    // dialogue until the screens move to the news tiles.
    const seen = new Set();
    let news = null;
    for (let s = 0; s < 90 && !news; s++) {
        await page.keyboard.press("Enter");
        await page.waitForTimeout(90);
        await page.keyboard.press("Space");
        const sample = await page.evaluate(READ_SCREENS);
        seen.add(sample.tile0);
        if (sample.cursors && sample.cursors[0][0] === 2 && sample.cursors[1][0] === 5) news = sample;
        if (s === 4) await page.screenshot({ path: `${OUT}/during.png` });
        await page.waitForTimeout(220);
    }
    if (!news) {
        fail("the screens never reached the news tiles in 90 seconds of announcement");
    } else {
        console.log(`NEWS ${JSON.stringify(news)}`);
        console.log(`TILES ${[...seen].join(" ")}`);
        if (seen.size < 4) fail(`the screens did not animate (${seen.size} distinct tiles seen)`);
        // The announcement walks its speakers around, so put the camera back on
        // the screen row for the shot; only the camera moves.
        await page.evaluate(() => {
            window.__state.x = 300;
            window.__state.y = 210;
            window.__state.dir = "up";
        });
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/news.png` });
    }
    await page.close();

    if (process.env.NATIVE) {
        // The differential: the ORIGINAL driver, one blank at a time, against the
        // port. Both are put back into the driver's boot state first -- the six
        // words the original's own first tick writes (state 0, then sequence /
        // sentinel for both cursors) -- so the two walks start together.
        const page2 = await browser.newPage({ viewport: { width: 1024, height: 768 } });
        page2.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
        page2.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
        await page2.goto(`${baseUrl(PORT)}/?skipTitle=1&map=s780&nativeStages=1`);
        const style2 = page2.locator("#asset-mode-authentic");
        if (await style2.isVisible().catch(() => false)) await style2.click();
        await page2.waitForFunction(() => window.__state?.started, null, { timeout: 20000 });
        await page2.waitForTimeout(400);
        const diff = await page2.evaluate(async (blanks) => {
            const ns = await import("/native-stage.js");
            const eng = await import("/vendor/engine.js");
            const rt = ns.nativeStage("s780");
            const drv = (rt.rt.world?.objects ?? []).find((o) => o.cb === 0x800a72b0);
            if (!drv) return { error: "no driver object in the interpreter" };
            const m = rt.rt.mem;
            // boot state: state 0, then the pair the state-0 arm installs
            m.write32(drv.addr + 0x0c, 0);
            m.write32(drv.addr + 0x50, 1);
            m.write32(drv.addr + 0x54, -1);
            m.write32(drv.addr + 0x58, 0);
            m.write32(drv.addr + 0x5c, 0);
            m.write32(drv.addr + 0x60, 0);
            m.write32(drv.addr + 0x64, 4);
            m.write32(drv.addr + 0x68, -1);
            m.write32(drv.addr + 0x6c, 0);
            m.write32(drv.addr + 0x70, 0);
            m.write32(drv.addr + 0x74, 0);
            eng.clearStreetScreens("s780");
            const first = [];
            for (let i = 0; i < blanks; i++) {
                ns.tickNativeStage("s780", [1]);
                const orig = rt.rt.screenQuads.map((q) =>
                    [q.cmd, q.x.join(","), q.y.join(","), q.u.join(","), q.v.join(","), q.texpage, q.clut].join("|"),
                );
                const oc = [
                    m.read32(drv.addr + 0x50), m.read32(drv.addr + 0x58), m.read32(drv.addr + 0x5c), m.read32(drv.addr + 0x60),
                    m.read32(drv.addr + 0x64), m.read32(drv.addr + 0x6c), m.read32(drv.addr + 0x70), m.read32(drv.addr + 0x74),
                ];
                eng.tickStreetScreens("s780", 1);
                const d = eng.streetScreenState("s780");
                const port = eng.streetScreenDraws("s780").map((q) =>
                    [q.cmd, q.x.join(","), q.y.join(","), q.u.join(","), q.v.join(","), q.texpage, q.clut].join("|"),
                );
                const pc = d.cursors.flatMap((c) => [c.sequence, c.position, c.value, c.remaining]);
                if (i < 3) first.push({ blank: i, origCursors: oc, portCursors: pc, quads: orig.length });
                const same =
                    JSON.stringify(orig) === JSON.stringify(port) && JSON.stringify(oc) === JSON.stringify(pc);
                if (!same) {
                    return {
                        blank: i,
                        origCursors: oc,
                        portCursors: pc,
                        origQuads: orig.length,
                        portQuads: port.length,
                        firstQuadOrig: orig[1],
                        firstQuadPort: port[1],
                        origHead: orig.slice(0, 2),
                        portHead: port.slice(0, 2),
                    };
                }
            }
            return { blanks, identical: true, first };
        }, BLANKS);
        console.log(`DIFF ${JSON.stringify(diff)}`);
        if (diff.error) fail(diff.error);
        else if (!diff.identical) fail(`the port and the original disagree at blank ${diff.blank}`);
        await page2.close();
    }
} finally {
    console.log("--- console log ---");
    for (const l of logs.slice(-30)) console.log(l);
    console.log(failed ? "VERDICT FAIL" : "VERDICT OK");
    await browser.close();
    process.exitCode = failed ? 1 : 0;
}
