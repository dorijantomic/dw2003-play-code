// Host pad-input service check (Phase 3): boot a native screen root, tick to a
// baseline, then drive it with single-frame button presses through
// window.__nativeScreenPad and report when its content appears. This proves the
// resident controller-input record service is host-served: the original screen
// reads pressed/held through F0x80018854/F0x80018878 and reacts.
//
// The page runs with a PUMPED frame clock (requestAnimationFrame replaced by a
// zero-delay timer) for the whole check, and its second phase puts the merchant's
// BUY item list on screen and presses Down once. That is the point of the clock:
// the console counts a held key's auto-repeat in frames (16, then 6, then 4 —
// exe/fns.s:9784-9789 with the divisor 0x10 from :9042-9043), so a "press" the
// caller measures in milliseconds is a tap on a slow box and a hold on a fast one.
// One press must move the merchant's cursor one row at any frame rate.
//
// Env: NATIVE_SCREEN_MODULE (default pro/stgtrain), NATIVE_SCREEN_SHOT.
// Run: .opencode/autonomy/check-browser tools/verify_native_screen_pad.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
import {
    SHOP_BUTTONS,
    SHOP_KEYS,
    bootShopLab,
    openBuyList,
    pressKey,
    visibleTexts,
} from "./native-screen-shop-lab.mjs";

const ROOT = process.env.NATIVE_SCREEN_ROOT || `${baseUrl(8742)}/`;
const MODULE = process.env.NATIVE_SCREEN_MODULE || "pro/stgtrain";
const OUT = process.env.NATIVE_SCREEN_SHOT || "/tmp/native-screen-pad";
mkdirSync(OUT, { recursive: true });

const B = { Start: 0x0008, Up: 0x0010, Right: 0x0020, Down: 0x0040, Left: 0x0080,
            Triangle: 0x1000, Circle: 0x2000, Cross: 0x4000, Square: 0x8000 };

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

// The lab's frame clock, pumped: every frame is a zero-delay timer, so the page
// draws faster than at the display's rate (measured per run and reported below).
// A press must not care how fast that is. setTimeout and not a MessageChannel
// pump: an unclamped task loop starves the fetches that load the 20 overlays.
await page.addInitScript(() => {
    const timers = new Map();
    let next = 1;
    window.requestAnimationFrame = (cb) => {
        const id = next++;
        timers.set(id, setTimeout(() => { timers.delete(id); cb(performance.now()); }, 0));
        return id;
    };
    window.cancelAnimationFrame = (id) => { clearTimeout(timers.get(id)); timers.delete(id); };
});

async function snap() {
    return page.evaluate(() => {
        const s = window.__nativeScreen();
        const w = window.__nativeTextWidgets();
        return {
            frames: s.frames, traps: s.traps, drawIntents: s.drawIntents,
            widgets: w.length,
            withText: w.filter((x) => x.lines.some((l) => l.len > 0)).length,
            texts: w.flatMap((x) => x.lines.filter((l) => l.len > 0).map((l) => l.len)),
            decoded: window.__nativeScreenTextDump()
                .flatMap((x) => x.decoded)
                .map((d) => (d && d.text) || "")
                .filter((t) => t.length),
        };
    });
}

/** Tap a button: hold one frame, release one frame. */
async function tap(button) {
    await page.evaluate((b) => window.__nativeScreenPad(b), button);
    await page.waitForFunction((n) => window.__nativeScreen().frames >= n + 2, (await snap()).frames, { timeout: 8000 });
    await page.evaluate(() => window.__nativeScreenPad(0));
    await page.waitForFunction((n) => window.__nativeScreen().frames >= n + 2, (await snap()).frames, { timeout: 8000 });
}

const problems = [];
const report = {};

try {
    await page.goto(`${ROOT}ui-lab.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.waitForSelector('button[data-scr="nativescreen"]', { timeout: 10000 });
    await page.click('button[data-scr="nativescreen"]');
    await page.waitForURL(/native-screen-lab\.html/, { timeout: 10000 });
    await page.waitForFunction(() => window.__nativeScreen?.()?.screensLoaded === 20, null, { timeout: 10000 });
    await page.evaluate((m) => window.__nativeScreenBoot(m), MODULE);
    await page.waitForFunction((m) => { const s = window.__nativeScreen?.(); return s && s.module === m && s.booted && s.frames >= 12; }, MODULE, { timeout: 10000 });

    const log = [{ step: "baseline", ...(await snap()) }];
    for (const name of process.env.NATIVE_SCREEN_TAPS?.split(",") || ["Start", "Circle", "Down", "Circle", "Cross"]) {
        await tap(B[name]);
        log.push({ step: name, ...(await snap()) });
        await page.screenshot({ path: `${OUT}/${MODULE.replace("/", "_")}-${log.length - 1}-${name}.png` });
    }
    await page.screenshot({ path: `${OUT}/${MODULE.replace("/", "_")}.png` });
    console.log(`pad sequence ${MODULE}: ${log.map((l) => `${l.step}{text=${l.withText},draws=${l.drawIntents}}`).join(" -> ")}`);
    if (log.some((l) => l.traps > 0)) problems.push(`traps during the ${MODULE} pad sequence`);

    /* ── one press is one row, at whatever frame rate the box manages ───────── */

    // Count the frames in which the Down bit is in the merchant's PRESSED word
    // (record 0x8004B818, the word F0x80018854 returns) while one press lands.
    // Sample the pad record on the frame boundary, AFTER the lab's own loop has
    // ticked (this probe registers behind the lab's callback, so it reads what the
    // screen just read). One entry per lab frame: the last sample of a frame wins,
    // which is the record the screen saw on it.
    await page.addInitScript(() => {
        const raw = window.requestAnimationFrame.bind(window);
        window.__padSamples = new Map();
        window.__padWatch = null;
        window.__watchPad = (on) => {
            if (!on) { window.__padWatch = null; return; }
            window.__padSamples = new Map();
            const step = () => {
                const f = window.__nativeScreen().frames;
                window.__padSamples.set(f, {
                    f,
                    t: Date.now(),
                    held: window.__nativeScreenKeys().word,
                    pressed: window.__nativeScreenRead(0x8004b818, 2),
                    repeat: window.__nativeScreenRead(0x8004b81a, 2),
                });
                if (window.__padWatch) window.__padWatch = raw(step);
            };
            window.__padWatch = raw(step);
        };
    });
    await bootShopLab(page, ROOT, "pro/stitshop");
    await openBuyList(page);

    // The merchant's BUY list is two columns; the cursor walks down the left one
    // at 14 pixels a row (stitshop.s:4612 `addiu $a3, 0x24` with the *14 pitch at
    // :4609-:4611, and the columns 33 apart at :4606 `addiu $a2, 0x37`). The left
    // column's names are the widgets at x 55 (the same predicate the driver's
    // `waitBuyList` uses); one press must land on the SECOND of them.
    const leftColumn = (await visibleTexts(page))
        .filter((w) => w.x >= 50 && w.x <= 60 && w.y >= 30 && w.y <= 90)
        .sort((a, b) => a.y - b.y)
        .map((w) => w.text);
    const panelName = async () => (await visibleTexts(page))
        .filter((w) => w.y >= 110 && w.y <= 120)
        .sort((a, b) => a.x - b.x)
        .map((w) => w.text)[0];
    const before = await panelName();

    await page.evaluate(() => window.__watchPad(true));
    await pressKey(page, SHOP_KEYS.down);
    await page.evaluate(() => window.__watchPad(false));
    const after = await panelName();
    const edges = [...(await page.evaluate(() => [...window.__padSamples.values()]))]
        .sort((a, b) => a.f - b.f);
    const downBit = SHOP_BUTTONS.down.bit;
    const edgeFrames = edges.filter((e) => (e.pressed & downBit) !== 0).map((e) => e.f);
    const repeatFrames = edges.filter((e) => (e.repeat & downBit) !== 0).map((e) => e.f);
    // The frames the key was physically down for. A press is ONE published frame
    // of held word; this is the number that does not depend on how fast the box
    // drew, and it is what decides whether the console's 16-frame auto-repeat is
    // ever reached.
    const heldFrames = edges.filter((e) => (e.held & downBit) !== 0).length;
    // How fast the lab actually drew while the press landed: the frames the
    // wall-clock second around the press covered. A 90 ms hold at this rate is the
    // number of frames that used to decide whether a "press" was a tap.
    const span = Math.max(1, edges[edges.length - 1].t - edges[0].t);
    const fps = Math.round(((edges.length - 1) * 1000) / span);
    await page.screenshot({ path: `${OUT}/shop-one-press.png` });
    report.shop = { leftColumn, before, after, heldFrames, edgeFrames, repeatFrames, fps, sampled: edges.length };

    if (leftColumn.length < 2) problems.push(`the merchant's list has no second row (${JSON.stringify(leftColumn)})`);
    if (before !== leftColumn[0]) problems.push(`the list opens on ${JSON.stringify(before)}, its first row ${JSON.stringify(leftColumn[0])}`);
    if (after !== leftColumn[1]) {
        problems.push(
            `one Down press moved the cursor from ${JSON.stringify(before)} to ${JSON.stringify(after)}; ` +
            `one row is ${JSON.stringify(leftColumn[1])} (a two-row jump means the press was held long enough ` +
            `to cross the console's own 16-frame auto-repeat, exe/fns.s:9784-9789)`,
        );
    }
    if (heldFrames > 2) {
        problems.push(
            `one press held the key down for ${heldFrames} published frames; a press is one frame, and ` +
            `${heldFrames} frames is ${heldFrames - 1} past the console's first auto-repeat (exe/fns.s:9042)`,
        );
    }
    if (edgeFrames.length !== 1) problems.push(`one press raised the pressed edge on ${edgeFrames.length} frames: ${edgeFrames}`);
    if (repeatFrames.length) problems.push(`one press also auto-repeated on frames ${repeatFrames}`);
    console.log(
        `one press on the merchant (pumped clock, ${fps} fps): ` +
        `${JSON.stringify(before)} -> ${JSON.stringify(after)}, key held ${heldFrames} frame(s), ` +
        `pressed edge on frame(s) ${edgeFrames}, auto-repeat on ${JSON.stringify(repeatFrames)}`,
    );

    writeFileSync(`${OUT}/pad-sequence.json`, JSON.stringify({ module: MODULE, log, errors, ...report }, null, 1) + "\n");
    if (errors.length) problems.push(`page errors: ${errors.join(" | ")}`);
    if (problems.length) {
        console.error(`FAIL native screen pad:\n- ${problems.join("\n- ")}`);
        process.exitCode = 1;
    } else {
        console.log("PASS native screen pad: the sequence traps nothing and one press moves the merchant's cursor one row");
    }
} finally {
    await browser.close();
}
