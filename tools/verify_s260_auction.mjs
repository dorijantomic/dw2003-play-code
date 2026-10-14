// Headless check for the s260 Cargo Tower auction, driven through the REAL web/game.js
// in the web/ui-lab.html harness (no mock renderer).
//
// Decode: docs/research/field/s260-cargo-tower-auction-decoded-2026-07-10.md and the
// ledger's eight `verified` claims (see engine/systems/auction.ts's header).  In one
// breath: on a field load at the Cargo Tower, FIELDSTG_runStoryEvents starts the lot
// whose story beat is current, whose flag (0x400+N) is clear and whose bid you can
// afford; the open script plays, the question asks "Bid at N BIT?", and the answer's
// script runs — Yes pays the bid, grants the item and closes the lot, No just closes
// it — after which the script's own HANDOFF walks you out to the Water Tunnel (s275).
//
// What a player meets: walk into the Cargo Tower on the lot's story beat.  Mr. Smith
// calls the lot, the crowd shouts, he asks for the bid, you answer Yes or No, and the
// scene puts you back out in the Water Tunnel.
//
//   python3 -m http.server 8791 --directory web
//   VERIFY_PORT=8791 tools/run-playwright.sh tools/verify_s260_auction.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const load = async (p) => JSON.parse(await readFile(new URL(`../web/${p}`, import.meta.url)));
const AUCTION = await load("assets/data/auction_lots.json");
const ESDMG = await load("assets/events/esdmg260.json");

// ── static: the lot table's own numbers ─────────────────────────────────────
const LOT0 = AUCTION.lots[0];
assert.equal(AUCTION.lots.length, 16);
assert.equal(LOT0.bid, 800);
assert.equal(LOT0.item, 281);                     // Divine Barrier
assert.equal(LOT0.progress, 5, "lot 0 sits on story beat 5");
assert.equal(LOT0.flag, 0x400);
assert.match(ESDMG[String(LOT0.entries.choice)].strings[0], /Bid at 800 BIT\?/);
const accepted = AUCTION.events[String(LOT0.events.accepted)];
assert.equal(accepted.disasm.at(-2), "HANDOFF 530 766 165 1");
assert.equal(accepted.disasm.at(-1), "END");

const PORT = Number(process.env.VERIFY_PORT ?? 8791);
const PARTY = ["p003pken", "p005koet", "p004kogu"];
const browser = await chromium.launch();
const errors = [];

/** One clean boot of the lab, seeded at the tower on lot 0's beat.  A fresh boot per
 *  case is deliberate: the lot's flag closes it for good, so cases would leak.
 *
 *  The jump into the tower goes through __setMap + the scene-skipper's fireStageEnter,
 *  which IS checkStageCutscene — the same function the arrival fade's completion calls
 *  (web/game.js) and the one that arms the auction.  A debug jump skips the fade, so
 *  the probe supplies that one call; nothing else about the arrival is faked. */
async function boot(ordinal, bits) {
    const context = await browser.newContext({
        viewport: { width: 1100, height: 900 },
        storageState: {
            cookies: [],
            origins: [{
                origin: `http://localhost:${PORT}`,
                localStorage: [
                    { name: "engineSchema", value: "2" },
                    { name: "party", value: JSON.stringify(PARTY) },
                    { name: "charId", value: PARTY[0] },
                    { name: "bits", value: String(bits) },
                    { name: "progressOrdinal", value: String(ordinal) },
                ],
            }],
        },
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://localhost:${PORT}/ui-lab.html`, { waitUntil: "load" });
    await page.waitForFunction(() => {
        const f = document.getElementById("game");
        return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
    }, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const frame = page.frames().find((f) => f.url().includes("index.html"));
    // A seeded lab boot can leave the opening's own scene up; end it so the tower's
    // arrival is the next thing that happens.
    await frame.evaluate(() => {
        if (window.__cutscene.isActive()) window.__cutscene.start([], null, () => {});
    });
    await frame.waitForFunction(() => !window.__cutscene.isActive(), null, { timeout: 15000 });
    // Seed the beat + wallet and walk into the tower.
    const arrived = await frame.evaluate(async ([ordinal, bits]) => {
        window.__engine.state.vars.set("$story.ordinal", ordinal);
        window.__engine.state.vars.set("$party.bit", bits);
        window.__auctionLog = [];
        const orig = window.__cutscene.start.bind(window.__cutscene);
        window.__cutscene.start = (ops, strings, done, hooks) => {
            window.__auctionLog.push({ first: (ops || [])[0] ?? null, line: (ops || []).find((o) => o.startsWith("SAY")) ?? null });
            return orig(ops, strings, done, hooks);
        };
        const idx = window.__state.manifest.maps.findIndex((m) => m.id === "s260");
        window.__setMap(idx, { x: 232, y: 421 });
        for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r));
        window.__stageEnter("s260");   // = checkStageCutscene (see the boot doc above)
        // Wait for the arrival fade to clear and the auction's first script to start.
        for (let i = 0; i < 600; i++) {
            await new Promise((r) => requestAnimationFrame(r));
            if (window.__cutscene.isActive()) return { fired: true, map: window.__state.manifest.maps[window.__state.mapIdx].id };
        }
        return { fired: false, map: window.__state.manifest.maps[window.__state.mapIdx].id };
    }, [ordinal, bits]);
    return { page, frame, arrived };
}

/** Page whatever is up (textbox / cutscene) until `stop()` is true or the bound runs out. */
async function pageUntil(frame, stop, bound = 900) {
    return frame.evaluate(async ([stopSrc, bound]) => {
        const stop = eval(stopSrc);
        const press = () => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
            window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));
        };
        for (let i = 0; i < bound; i++) {
            if (stop()) return true;
            if (window.__textbox.isOpen() || window.__dialogueBox.isOpen() || window.__cutscene.isActive()) press();
            await new Promise((r) => requestAnimationFrame(r));
            await new Promise((r) => requestAnimationFrame(r));
        }
        return stop();
    }, [stop.toString(), bound]);
}

const state = (frame) => frame.evaluate(() => ({
    map: window.__state.manifest.maps[window.__state.mapIdx].id,
    bits: Number(window.__engine.state.vars.get("$party.bit") ?? 0),
    flag0: window.__engine.state.flags.get(0x400, 1),
    hasItem: window.__engine.state.inventory.has(281),
    choiceOpen: window.__choice.isOpen(),
    prompt: window.__choice.prompt,
    options: [...window.__choice.options],
    cursor: window.__choice.cursorIdx,
    log: window.__auctionLog,
}));

// ── case 1: bid 800 and take lot 0 ──────────────────────────────────────────
{
    const { page, frame, arrived } = await boot(5, 800);
    assert.equal(arrived.fired, true, "the auction must fire on arrival");
    // The question box: page the open script until it is up.
    const asked = await pageUntil(frame, () => window.__choice.isOpen());
    assert.equal(asked, true, "the question box must open after the open script");
    let s = await state(frame);
    assert.equal(s.choiceOpen, true);
    assert.match(s.prompt, /Bid at 800 BIT\?/, `prompt: ${JSON.stringify(s.prompt)}`);
    assert.deepEqual(s.options, ["Yes, bid.", "No, I'll pass."]);
    assert.equal(s.cursor, 0, "the cursor starts on Yes");
    assert.equal(s.bits, 800, "no money moved yet");
    // Yes (cursor is already on it).
    await frame.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
        window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));
    });
    // Page the accepted script; it ends with the force-exit to s275.
    const left = await pageUntil(frame, () => window.__state.manifest.maps[window.__state.mapIdx].id !== "s260");
    assert.equal(left, true, "the accepted script must hand the player to s275");
    s = await state(frame);
    assert.equal(s.map, "s275", "warped to the Water Tunnel");
    assert.equal(s.bits, 0, "the 800 BIT bid was paid");
    assert.equal(s.hasItem, true, "Divine Barrier joined the bag");
    assert.equal(s.flag0, true, "the lot is closed");
    // The scene played the lot's own scripts, in the disc's order.
    assert.ok(s.log.length >= 2, `scripts played: ${JSON.stringify(s.log)}`);
    assert.equal(s.log[0].line, "SAY 0 1 30 0", "the open script ran first");
    await page.close();
}

// ── case 2: pass on lot 0 ───────────────────────────────────────────────────
{
    const { page, frame, arrived } = await boot(5, 800);
    assert.equal(arrived.fired, true, "the auction must fire on arrival");
    assert.equal(await pageUntil(frame, () => window.__choice.isOpen()), true);
    // Move the cursor to No and confirm.
    await frame.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
        window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowDown" }));
        window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
        window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));
    });
    const left = await pageUntil(frame, () => window.__state.manifest.maps[window.__state.mapIdx].id !== "s260");
    assert.equal(left, true, "the pass script must hand the player to s275");
    const s = await state(frame);
    assert.equal(s.map, "s275");
    assert.equal(s.bits, 800, "a pass costs nothing");
    assert.equal(s.hasItem, false, "and grants nothing");
    assert.equal(s.flag0, true, "but the lot still closes");
    await page.close();
}

// ── case 3: cannot afford lot 0 ─────────────────────────────────────────────
{
    const { page, frame, arrived } = await boot(5, 100);
    assert.equal(arrived.fired, false, "an unaffordable lot must not fire");
    const s = await state(frame);
    assert.equal(s.map, "s260", "the tower simply loads");
    assert.equal(s.bits, 100);
    assert.equal(s.flag0, false, "the lot stays open for a richer visit");
    await page.close();
}

// ── case 4: off the lot's beat ──────────────────────────────────────────────
{
    const { page, frame, arrived } = await boot(6, 800);
    assert.equal(arrived.fired, false, "the lot fires only on its own story beat");
    await page.close();
}

await browser.close();
// The seeded lab boot draws the player one frame before its sheet has resolved; that
// drawImage TypeError reproduces on master with no auction code and belongs to the
// harness, not to this flow. Everything else must be clean.
const unrelated = /drawImage/;
const real = errors.filter((e) => !unrelated.test(e));
assert.deepEqual(real, [], `page errors: ${real.join(" | ")}`);
console.log("s260 auction: 4 cases pass (bid, pass, unaffordable, off-beat)");
