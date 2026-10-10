// The five NPC help counters open their eight-topic menu: talk to the Asuka City
// Main Lobby counter (s210, NPC 36 at 434,247) and the translated menu takes the screen
// (engine/dw3/ui/help-menu-session.ts, from wstag210 F0x800A5E74).
//
// What it asserts, by driving the REAL web/game.js in web/ui-lab.html (no mock, no walking bot
// — the player is placed on the tile in front of the counter and presses buttons):
//   1. the counter's own line is spoken first, and __talkTarget() names NPC 36 / estalk00[52];
//   2. closing that line opens the menu: eight painted titles, the cursor beside the first, the
//      list's own scroll marker, and step 2 (waiting for input);
//   3. Down moves the cursor one row (14 px) and Confirm on row 2 shows THAT row's page, typed
//      out, with the blinking "press to continue" marker;
//   4. confirming through the page returns to the list, and Confirm on "Return" (row 7) closes
//      the menu, leaving the field interactive again;
//   5. ?legacyHelpMenu=1 opens no menu (today's behaviour).
//
// Run with a server on this worktree's port:
//   python3 -m http.server 8774 --directory web
//   VERIFY_PORT=8774 tools/run-playwright.sh tools/verify_help_menu.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const PORT = 8774;
const origin = `${baseUrl(PORT)}`;
const args = process.argv.slice(2);
const legacy = args.includes("--legacy");
const outDir = resolve(args.find((a) => !a.startsWith("--")) ?? "captures/help-menu-2026-10-02");
await mkdir(outDir, { recursive: true });

const load = async (p) => JSON.parse(await readFile(new URL(`../web/${p}`, import.meta.url)));
const LAUNCH = await load("assets/data/talk_event_launches.json");
// The counter's own text and its menu's eight titles + seven pages, read out of the shipped
// strings so the check asserts the words the player sees.
const ESTALK = await load("assets/dialogue/estalk00.json");
const ESDMG = await load("assets/events/esdmg200.json");
const COUNTER_NPC = 36;
const COUNTER_X = 434;
const COUNTER_Y = 247;
const COUNTER_LINE = ESTALK["52"];
const TITLES = ESDMG["1"].strings.slice(0, 8);
const bit = 0x9003 & 0x1ff;
assert.equal(LAUNCH.events[bit], 8, "bank-0x90 bit 3 launches s210 event 8");

const browser = await chromium.launch();
const context = await browser.newContext({
    viewport: { width: 900, height: 760 },
    storageState: {
        cookies: [],
        origins: [{
            origin,
            localStorage: [
                { name: "engineSchema", value: "2" },
                { name: "charId", value: "p003pken" },
                { name: "party", value: JSON.stringify(["p003pken", "p005koet", "p004kogu"]) },
                // Ordinal 34 (0x22) is when the counter stands in the Main Lobby in the state that
                // carries the bank-0x90 write: bank 0x60 gates are progress-ordinal equality
                // (web/flag-store.js), and this NPC record spawns on 0x7022 == 1, 0x6016 == 0.
                { name: "progressOrdinal", value: "34" },
            ],
        }],
    },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${origin}/ui-lab.html${legacy ? "?legacyHelpMenu=1" : ""}`, { waitUntil: "load" });
const frame = await (async () => {
    await page.waitForFunction(() => {
        const f = document.getElementById("game");
        return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
    }, null, { timeout: 40000 });
    return page.frames().find((f) => f.url().includes("index.html"));
})();

const raf = (n) => frame.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r));
}, n);
// The menu reads the pad HELD each display frame (its own +0x3F4 word), so a key must stay down
// across frames; a same-tick down/up pair is never seen.
const press = async (key, hold = 6) => {
    await frame.evaluate((k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k })), key);
    await raf(hold);
    await frame.evaluate((k) => window.dispatchEvent(new KeyboardEvent("keyup", { key: k })), key);
    await raf(2);
};
const diag = () => frame.evaluate(() => window.__helpMenu?.diagnostics?.() ?? null);
const open = () => frame.evaluate(() => window.__helpMenu?.isOpen?.() === true);
const painted = () => frame.evaluate(() => (window.__helpMenu?.diagnostics?.().painted ?? []).slice());

// Boot into the Asuka City Main Lobby and put the player on the tile in front of the counter.
const arrived = await frame.evaluate(async ([x, y]) => {
    const st = window.__state;
    const idx = st.manifest.maps.findIndex((m) => m.id === "s210");
    if (idx < 0) throw new Error("s210 must be in the map manifest");
    window.__setMap(idx, { x, y });
    for (let i = 0; i < 40; i++) await new Promise((r) => requestAnimationFrame(r));
    st.x = x;
    st.y = y;
    st.dir = "up";
    for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
    return st.manifest.maps[st.mapIdx].id;
}, [COUNTER_X, COUNTER_Y + 16]);
assert.equal(arrived, "s210", "the lab reached the Asuka City Main Lobby");
await raf(10);
// Face the counter: pick the first tile in front of it that the game's own talk probe
// resolves to the counter (the lobby has other NPCs standing near it).
let target = null;
const spots = [];  // the lobby has other NPCs standing near the counter
for (const dy of [16, 24, 32, 40]) for (const dx of [0, -8, 8, -16, 16, -24, -32]) for (const dir of ["up", "up-right", "right"])
    spots.push([COUNTER_X + dx, COUNTER_Y + dy, dir]);
for (const [x, y, dir] of spots) {
    target = await frame.evaluate(async ([px, py, pd]) => {
        const st = window.__state;
        st.x = px;
        st.y = py;
        st.dir = pd;
        for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
        return window.__talkTarget();
    }, [x, y, dir]);
    if (target?.npc === COUNTER_NPC) break;
}
assert.equal(target?.npc, COUNTER_NPC, `expected the counter at ${COUNTER_X},${COUNTER_Y}, got ${JSON.stringify(target)}`);
assert.equal(target?.state?.dialogue?.index, 52, `expected estalk00[52], got ${JSON.stringify(target?.state)}`);
assert.equal(target?.state?.on_close?.[0]?.id, 0x9003, "that state carries the bank-0x90 write");
assert.match(COUNTER_LINE, /Which topic would you/, `counter line: ${COUNTER_LINE}`);
console.log(`counter line: ${COUNTER_LINE.slice(0, 70)}`);

// Talk: the line speaks first, and paging past its close is what fires the launcher.
await press(" ");
// The facade's isOpen() also covers the help menu, so page the COUNTER'S OWN line by the
// translated box alone.
await frame.waitForFunction(() => window.__dialogueBox?.isOpen?.() === true, null, { timeout: 8000 });
await page.screenshot({ path: resolve(outDir, legacy ? "02-counter-line.png" : "02-counter-line.png") });
for (let i = 0; i < 40 && (await frame.evaluate(() => window.__dialogueBox.isOpen())); i++) await press(" ", 4);
await raf(20);

if (legacy) {
    const d = await diag();
    assert.equal(await open(), false, "?legacyHelpMenu=1 must not open the menu");
    assert.equal(d.menu, null, "no menu session is created");
    assert.equal(d.ticks, 0, "the menu never ticks");
    assert.deepEqual(errors, [], `page errors: ${errors.join("; ")}`);
    console.log("OK rollback: talking to the counter opens no menu");
} else {
    await frame.waitForFunction(() => window.__helpMenu?.isOpen?.() === true, null, { timeout: 15000 });
    // Let the window finish folding open and the eight titles land.
    try {
        await frame.waitForFunction(() => window.__helpMenu.diagnostics().state?.step === 2, null, { timeout: 15000 });
    } catch (error) {
        console.error("menu state at timeout:", JSON.stringify(await diag()));
        throw error;
    }
    const list = await painted();
    for (const title of TITLES) {
        assert.ok(list.some((t) => t.includes(title)), `"${title}" must be on screen, got ${JSON.stringify(list)}`);
    }
    let d = await diag();
    assert.equal(d.state.selection, 0, "the cursor starts on the first row");
    assert.equal(d.state.rows, 8, "eight rows");
    assert.ok(!d.failed, `session failed: ${d.error}`);
    // The window folds open over 16 display ticks before the list takes input.
    assert.ok(d.ticks >= 18, `the menu ticked ${d.ticks} times`);
    // The list's own scroll marker (CMFONT glyph 0x24) is drawn while it folds in, and the
    // row texts came from esdmg200 entry 1.
    const draws = await frame.evaluate(() => window.__helpMenu.diagnostics().state);
    assert.equal(draws.state, 1);
    await page.screenshot({ path: resolve(outDir, "01-eight-topics.png") });
    console.log(`menu open: ${list.length} painted texts, state ${JSON.stringify(d.state)}`);

    // Down twice: the cursor walks the rows 14 px at a time.
    await press("ArrowDown");
    await press("ArrowDown");
    assert.ok((await painted()).length > 0);
    await page.screenshot({ path: resolve(outDir, "03-cursor-on-row-2.png") });
    d = await diag();
    assert.equal(d.state.selection, 2, "two downs land on row 2");

    // Confirm row 2: the page appears BELOW the eight titles (rows at x 189 / y 33..131, the
    // page widget at 18,176), typed out six ticks a glyph, with the end-of-text marker above it.
    const page2 = ESDMG["1"].strings[10];
    await press(" ");
    await frame.waitForFunction(() => {
        const p = window.__helpMenu?.diagnostics?.().painted ?? [];
        return p.length > 9 && p[9].length > 0;
    }, null, { timeout: 20000 });
    // The typewriter grows the page; sample it and keep the longest run to compare with the
    // original's own words (esdmg200 entry 1, string 11 = the page on row 2).
    let longest = "";
    for (let i = 0; i < 240; i++) {
        const now = (await painted())[9] ?? "";
        if (now.length > longest.length) longest = now;
        if (longest.length >= 24) break;
    }
    assert.ok(longest.length >= 3, `the page must type itself out, got ${JSON.stringify(longest)}`);
    assert.ok(page2.replace(/\s+/g, " ").startsWith(longest.replace(/\s+/g, " ")),
        `the page must be esdmg200[1] string 11; got ${JSON.stringify(longest.slice(0, 40))}`);
    await page.screenshot({ path: resolve(outDir, "04-page-row-2.png") });
    d = await diag();
    assert.ok(d.state.pageFold !== 0, `the page's own fold must run: ${JSON.stringify(d.state)}`);
    assert.ok(d.state.promptPhase <= 4 || d.state.pendingPage === 0, "the blinking prompt cycles 0..4");
    console.log(`page row 2: ${JSON.stringify(longest.slice(0, 60))}...`);


    // Confirm through the page (it may hold more than one screen of text) until the list takes
    // input again, then walk to "Return" (row 7) and close.
    const screens = [];
    for (let i = 0; i < 24; i++) {
        const step = (await diag()).state.step;
        if (step === 2) break;
        screens.push((await painted())[9] ?? "");
        await press(" ", 4);
    }
    // Every screen of the topic is its own text: the page holds more than one, and the player
    // turns through them with confirm.
    assert.ok(screens.filter((t, i) => i === 0 || t !== screens[i - 1]).length >= 2,
        `the topic must have more than one screen: ${JSON.stringify(screens)}`);
    await frame.waitForFunction(() => window.__helpMenu.diagnostics().state?.step === 2, null, { timeout: 20000 });
    assert.ok((await painted()).length >= 8, "the eight titles are still there");
    for (let i = 0; i < 5; i++) await press("ArrowDown");
    d = await diag();
    assert.equal(d.state.selection, 7, `"Return" is row 7, got ${d.state.selection}`);
    await page.screenshot({ path: resolve(outDir, "05-return-row.png") });
    await press(" ");
    await frame.waitForFunction(() => window.__helpMenu.isOpen() === false, null, { timeout: 20000 });
    await raf(30);
    const after = await frame.evaluate(() => ({
        textbox: window.__textbox.isOpen(),
        help: window.__helpMenu.isOpen(),
        cutscene: window.__cutscene.isActive(),
        closes: window.__helpMenu.diagnostics().closes,
    }));
    assert.equal(after.textbox, false, "the talk finished with the menu");
    assert.equal(after.cutscene, false, "no cutscene is left running");
    assert.equal(after.closes, 1, "onClose fired once");
    await page.screenshot({ path: resolve(outDir, "06-closed.png") });
    assert.deepEqual(errors, [], `page errors: ${errors.join("; ")}`);
    console.log(`closed: ${JSON.stringify(after)}`);
    console.log("OK help menu: eight topics, page on row 2, Return closes it");
}

await browser.close();