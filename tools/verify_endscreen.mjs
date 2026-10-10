// Capture the END card as a player meets it, from the real game module, on the
// translated route.
//
//   python3 -m http.server 8758 --directory web
//   VERIFY_PORT=8758 tools/run-playwright.sh tools/verify_endscreen.mjs [out-dir]
//
// The translated route runs with **/assets/native/** denied, so a single request
// for an original-code image or overlay would fail the run instead of quietly
// supplying the answer. Nothing here executes original instructions.
//
// What it shoots, and what each shot is evidence of:
//
//   01 arrival (level 15)   the card's first callback: nothing on screen, every sound stopped
//   02 mid-ramp (level 8)   the fade really is the palette row, half way up
//   03 settled (level 0)    the green END card
//   04 waiting              the wait a player can end with a button
//   05 fading out           the card leaving again
//   06 hand-off             the opening-movie request and the lab's close
//   07 legacy settled       the hand-written card, shot the same way, for the pair
//
// The first three levels are captured from a second card ticked to the level by hand,
// because the whole ramp is fifteen steps of two display ticks — about half a second,
// shorter than a headless screenshot, so waiting for it cannot photograph it. That
// card is the same adapter, the same session and the same extracted pack, painted into
// its own canvas; the card on screen is left alone. Every live shot is captured BEFORE
// its state is read, so the state printed beside a picture is never ahead of it.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? ".bunny-scratch/endscreen";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

const errors = [];
const blocked = [];

/** Open the lab with the original-code assets denied, on the route the query asks for. */
async function openLab(query) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.route("**/assets/native/**", (route) => {
        blocked.push(route.request().url());
        return route.abort();
    });
    await page.goto(`${baseUrl(8758)}/ui-lab.html${query}`, { waitUntil: "load" });
    await page.waitForFunction(() => {
        const f = document.getElementById("game");
        return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
    }, null, { timeout: 60000 });
    return page;
}

const game = (page) => page.frames().find((f) => f.url().includes("index.html"));

/** The card's own view of itself: state, sub-state, level, timer, clip and label. */
const readCard = (page) => game(page).evaluate(() => {
    const card = window.__labEnd;
    if (!card) return null;
    const d = card.diagnostics?.();
    return {
        execution: d?.execution ?? "legacy",
        state: card.state?.() ?? null,
        level: card.level?.() ?? null,
        clipId: card.clipId?.() ?? null,
        label: card.label?.() ?? null,
        stoppedSound: d?.stoppedSound ?? null,
        launches: d?.launches ?? null,
        viewColour: d?.viewColour ?? null,
    };
});

const canvasOf = (page) => game(page).$("canvas");

/** Shoot the live card, THEN read its state, so the printed state is never ahead of the image. */
const shot = async (page, name, note) => {
    const canvas = await canvasOf(page);
    await canvas.screenshot({ path: `${out}/${name}.png` });
    const state = await readCard(page);
    console.log(name, note ?? "", JSON.stringify(state), "(state read after the capture)");
    return state;
};

const savePng = (dataUrl, name) =>
    writeFileSync(`${out}/${name}.png`, Buffer.from(dataUrl.split(",")[1], "base64"));

// ── the translated route ────────────────────────────────────────────────────
const page = await openLab("");
await page.click('[data-scr="endscreen"]');
// Wait for the card's own first callback, not just for the open flag: that is the
// callback that raises the state, hides the card and stops every sound.
await page.waitForFunction(
    () => document.getElementById("game").contentWindow.__labEnd?.state?.() != null,
    null, { timeout: 15000 });

// The three exact levels of the ramp, from a second card ticked to each level by hand.
const ramp = await game(page).evaluate(async (want) => {
    const mod = await import("./endscreen-translated.js");
    await mod.loadEndCardTranslated();
    const frames = [];
    for (const level of want) {
        const card = mod.createEndCardTranslated();
        card.open();
        // open() subscribes to the table it was already given; let that land before
        // ticking, or the shared update loop leaves the card alone.
        await new Promise((resolve) => setTimeout(resolve, 0));
        // One display tick at a time until the wanted level. The card only exists after
        // its first callback, so the loop has to start from "nothing".
        for (let i = 0; i < 60; i++) {
            const have = card.state()?.level;
            if (have === level) break;
            if (have != null && have < level) break;
            card.step(1 / 60);
        }
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        card.draw(canvas.getContext("2d"), 640, 480);
        const state = card.state();
        frames.push({
            want: level, level: state?.level ?? null, sub: state?.sub ?? null,
            clipId: card.clipId(), label: card.label(), png: canvas.toDataURL("image/png"),
        });
        card.cancel();
    }
    return frames;
}, [15, 8, 0]);

for (const [i, name] of ["01-translated-arrival", "02-translated-mid-ramp", "03-translated-settled-level0"]
    .entries()) {
    const frame = ramp[i];
    console.log(name, `the card painted at level ${frame.want}`,
        JSON.stringify({ level: frame.level, sub: frame.sub, clipId: frame.clipId, label: frame.label }));
    savePng(frame.png, name);
    assert.equal(frame.level, frame.want, `the ramp frame is at level ${frame.want}`);
}
assert.equal(ramp[0].clipId, "0#15", "level 15 is the pack's invisible row");
assert.equal(ramp[2].clipId, "0", "level 0 is the settled picture");
assert.equal(ramp[2].label, "END", "language 2 takes the END picture");

// The live card, still climbing the ramp a moment after its first callback. The three
// exact levels above are the ones a picture can pin down; this read is what says the
// card on screen is the same object: translated, and it stopped the machine once.
const live = await readCard(page);
console.log("live-card-mid-fade", "the card on the lab canvas, one sound-stop recorded",
    JSON.stringify(live));
assert.equal(live.execution, "translated", "the card runs translated logic");
assert.equal(live.stoppedSound, 1, "every sound stopped when the card appeared");
// The colour the card asked its display view for. Recorded, never decided: the open
// question is .bunny-scratch/endcard-report.md 5.1 / boot-gap row D5, so nothing here
// asserts what it should look like on screen.
assert.deepEqual(live.viewColour, [31, 31, 31], "the card asked its view for (0x1F, 0x1F, 0x1F)");

await page.waitForFunction(
    () => document.getElementById("game").contentWindow.__labEnd?.state?.()?.level === 0,
    null, { timeout: 15000 });
await shot(page, "04-translated-settled", "the green card on the lab canvas");

// Sub-state 2 is the wait, 0x4650 timer units long. Hold nothing and check the card
// is sitting in it.
await page.waitForFunction(
    () => document.getElementById("game").contentWindow.__labEnd?.state?.()?.sub === 2,
    null, { timeout: 20000 });
const waiting = await shot(page, "05-translated-waiting", "waiting for the player");
assert.equal(waiting.state.sub, 2, "the card is in the wait");

// Holding Start (the pad's bit 3) ends the wait on the very callback it is
// sampled in - the port reads the held word every frame, no keypress needed.
// The walker keys off the game window's own keydown, so the event is dispatched
// there and held with no matching keyup until the wait is over.
const holdKey = (frame, key) => frame.evaluate(
    (k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })), key);
const releaseKey = (frame, key) => frame.evaluate(
    (k) => window.dispatchEvent(new KeyboardEvent("keyup", { key: k, bubbles: true })), key);
await holdKey(game(page), "i");
await page.waitForFunction(
    () => {
        const st = document.getElementById("game").contentWindow.__labEnd?.state?.();
        return st && st.sub >= 3;
    }, null, { timeout: 10000 });
const skipped = await shot(page, "06-translated-fading-out", "Start held: the wait is over");
assert.ok(skipped.state.sub >= 3, "holding Start ended the wait");
await releaseKey(game(page), "i");

// And the card hands on: its last callback asks the resident launcher for the
// first opening movie, which the walker does not ship, so the lab closes it.
// In the game frame the card stays reachable as window.__labEnd after the lab
// closes it, so its recorded launch request outlives state.endScreen.
const handed = await game(page).waitForFunction(
    () => (window.__labEnd?.launches?.().length ?? 0) > 0 && !window.__state.endScreen,
    null, { timeout: 30000 })
    .then(() => game(page).evaluate(() => ({
        launches: window.__labEnd.launches(),
        endScreen: !!window.__state.endScreen,
    })));
console.log("07-translated-handed-on", "the last callback asked for the opening movie", JSON.stringify(handed));
assert.deepEqual(handed.launches, [0xe01], "the card asked for the first opening movie");
assert.equal(handed.endScreen, false, "the lab closed the card, as it always has");

// ── the legacy route, for the before/after pair ─────────────────────────────
const legacy = await openLab("?legacyEnd=1");
await legacy.click('[data-scr="endscreen"]');
await legacy.waitForFunction(
    () => document.getElementById("game").contentWindow.__labEnd?.state?.() === 1
        || document.getElementById("game").contentWindow.__labEnd?.state?.() === 0,
    null, { timeout: 10000 });
await legacy.waitForTimeout(2500);
const legacySettled = await shot(legacy, "08-legacy-settled", "the hand-written card, for comparison");
assert.equal(legacySettled.execution, "legacy");
assert.equal(legacySettled.level, 0, "the hand-written card settles too");
await legacy.close();

assert.deepEqual(errors, [], "no page errors");
assert.deepEqual(blocked, [], "no request for an original-code asset");
console.log("ok: translated END card, no executable asset requested");

await browser.close();
