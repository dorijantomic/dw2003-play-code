// Play the zz_props_demo quest (props: our own art left on a map by a quest's state) in the real game through
// web/quest-lab.html, and photograph what is on the map at each step.
//
// Server: python3 -m http.server 8770 --directory web   (build first: python3 tools/build_quests.py --with-drafts)
// Run:    VERIFY_PORT=8770 tools/run-playwright.sh tools/verify_quest_props.mjs
// Shots:  $QP_SHOT (default ~/scratch-research/quest-fx2/props)
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.QP_ROOT || `${baseUrl(8770)}/`;
const OUT = process.env.QP_SHOT || `${process.env.HOME}/scratch-research/quest-fx2/props`;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const problems = [];
const expect = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) problems.push(msg); };
const log = [];
let n = 0;
const shot = async (tag) => {
    const el = await page.$("canvas#game");
    const name = `${String(++n).padStart(2, "0")}-${tag}.png`;
    if (el) writeFileSync(`${OUT}/${name}`, await el.screenshot());
    return name;
};
const snap = () => page.evaluate(() => ({
    map: window.__quests?.where?.().lastMap ?? null,
    x: Math.round(window.__state?.x ?? 0), y: Math.round(window.__state?.y ?? 0),
    status: window.__quests?.status?.("zz_props_demo") ?? null,
    done: window.__quests?.state?.done?.zz_props_demo ?? null,
    active: window.__quests?.state?.active?.zz_props_demo ?? null,
    props: window.__questProps?.state?.() ?? [],
    boxes: window.__questProps?.boxes?.() ?? [],
    cut: window.__cutscene?.isActive?.() ?? false,
    tb: window.__textbox?.isOpen?.() ?? false,
    ch: window.__choice?.isOpen?.() ?? false,
    cam: window.__lastCam ?? null,
}));
const record = (phase, s) => { log.push({ phase, ...s }); return s; };

page.on("pageerror", (e) => { console.error("PAGEERROR", e.message); problems.push("pageerror: " + e.message); });
page.on("console", (m) => { if (/quest props|quest fx|\[quests\]|prop:/i.test(m.text())) console.log("console:", m.text()); });

await page.addInitScript(() => {
    const put = (k, v) => { if (localStorage.getItem(k) == null) localStorage.setItem(k, v); };
    put("assetMode", "authentic");
    put("engineSchema", "2");
    put("progressOrdinal", "3");
    put("playerName", "Junior");
    put("charId", "p005koet");
    put("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
    put("packId", "B");
    put("bits", "1000");
    put("inventory", "[]");
});

const ready = () => page.waitForFunction(
    () => window.__state?.started && window.__quests?.defs?.length && document.getElementById("questlab"),
    null, { timeout: 60000 });
const takeKeys = () => page.evaluate(() => document.activeElement?.blur?.());
const key = async (k) => { await takeKeys(); await page.keyboard.press(k); };
/** Put the player at a world point, facing a direction, with no animation left over. */
const stand = (x, y, dir = "up") => page.evaluate(([x, y, dir]) => {
    const s = window.__state; s.x = x; s.y = y; s.dir = dir; s.moving = false; s.stopping = false;
}, [x, y, dir]);
/** Hold (or let go of) a direction through the game's own held-button set, the one the keyboard and a pad both fill. */
const hold = (dir, on) => page.evaluate(([dir, on]) => {
    const k = window.__state.keys;
    if (on) k.add(dir); else k.delete(dir);
}, [dir, on]);
/**
 * Press Enter through whatever the character is saying -- the ordinary line first, then the offer's walking scene and its
 * question (answered with the first option), or the turn-in -- until `cond(snapshot)` holds. Photographs the choice.
 */
async function talkThrough(cond, ms, tag) {
    const t0 = Date.now();
    let presses = 0, choices = 0, idlePresses = 0;
    let lastIdle = 0;
    while (Date.now() - t0 < ms) {
        const s = record(tag, await snap());
        if (cond(s)) return true;
        if (s.ch) { if (!choices++) await shot(`${tag}-choice`); await key("Enter"); presses++; }
        else if (s.tb) { await key("Enter"); presses++; }
        else if (!s.cut && Date.now() - lastIdle > 700) {
            // Nothing open: start the next talk (the offer only comes on the second talk with a character in a session).
            lastIdle = Date.now();
            await key("Enter");
            idlePresses++;
            if (idlePresses > 24) break;
        }
        await page.waitForTimeout(280);
    }
    return false;
}
/** Wait until the field is quiet (no scene, no text, no choice) -- input must not be swallowed by a running cutscene. */
async function quiet(ms = 6000) {
    const t0 = Date.now();
    let calm = 0;
    while (Date.now() - t0 < ms) {
        const s = await snap();
        if (!s.cut && !s.tb && !s.ch) { if (++calm > 3) return true; } else calm = 0;
        await page.waitForTimeout(200);
    }
    return false;
}

try {
    // ---- quest lab: find the demo, press Go ---------------------------------------------------------------
    await page.goto(ROOT + "quest-lab.html");
    await page.waitForURL(/questlab=1/, { timeout: 30000 });
    await ready();
    await page.waitForTimeout(1500);
    await page.fill("#questlab input[type=search]", "The lobby sign");
    await page.waitForTimeout(400);
    const row = page.locator("#questlab .q", { hasText: "The lobby sign" }).first();
    expect(await row.count() > 0, "the props demo is listed in the quest lab");
    await row.locator("button", { hasText: "Go" }).first().click();
    await takeKeys();
    await page.waitForURL(/map=s210/, { timeout: 30000 });
    await ready();
    await page.waitForTimeout(2200);
    await stand(529, 525, "up");                    // in front of the Geek, on free floor
    await page.waitForTimeout(400);
    const before = record("before-accept", await snap());
    console.log("  before", JSON.stringify({ map: before.map, status: before.status, props: before.props }));
    expect(before.map === "s210", `the lab put us in the lobby (${before.map})`);
    expect(before.status === "available", `the quest is on offer (${before.status})`);
    expect(before.props.length === 0, `no prop before accepting (${before.props.length})`);
    await shot("before-accept");

    // ---- accept: the ordinary chat first, then the offer; the new board appears at once, no reload -----------
    const asked = await talkThrough((s) => !!s.active, 45000, "accept");
    expect(asked, "talking twice reached the offer and taking it started zz_props_demo");
    await quiet();
    const accepted = record("accepted", await snap());
    console.log("  accepted", JSON.stringify({ active: !!accepted.active, props: accepted.props, boxes: accepted.boxes }));
    expect(!!accepted.active, "taking the offer started zz_props_demo");
    const newBoard = accepted.props.find((p) => p.key === "zz_props_demo#0");
    expect(!!newBoard, `the accepted prop is on the map (${JSON.stringify(accepted.props.map((p) => p.key))})`);
    expect(newBoard && newBoard.x === 560 && newBoard.y === 505, `it stands where it was authored (${newBoard?.x},${newBoard?.y})`);
    expect(newBoard && newBoard.onScreen, "web/quest-fx.js is drawing it");
    expect(newBoard && newBoard.solid, "it is marked solid");
    expect(accepted.boxes.length === 1, `one solid foot box (${JSON.stringify(accepted.boxes)})`);
    await stand(529, 525, "up");
    await page.waitForTimeout(500);
    await shot("accepted-board");

    // ---- solid: walking into it stops the player like a standing actor -------------------------------------
    await stand(560, 540, "up");
    await page.waitForTimeout(300);
    const startY = (await snap()).y;
    await hold("up", true);
    let minY = startY;
    for (let i = 0; i < 22; i++) {
        await page.waitForTimeout(80);
        const s = await snap();
        minY = Math.min(minY, s.y);
        if (i === 10) await shot("bump-against-board");
    }
    await hold("up", false);
    console.log("  bump: start y", startY, "min y while pushing up", minY, "| boxes", JSON.stringify((await snap()).boxes));
    expect(minY > 505, `the solid prop stopped the player (min y ${minY}, the prop's feet are 505)`);
    expect(minY < startY - 4, `the player did walk up into it (from ${startY} to ${minY})`);

    // ---- leave the map and come back: the board is still there (saved quest state) --------------------------
    await page.goto(ROOT + "index.html?skipTitle=1&map=s200&noEncounters=1");
    await page.waitForFunction(() => window.__state?.started && window.__quests, null, { timeout: 60000 });
    await page.waitForTimeout(1800);
    const away = record("away", await snap());
    expect(away.props.length === 0, `no prop on another map (${away.props.length})`);
    await page.goto(ROOT + "index.html?skipTitle=1&map=s210&noEncounters=1");
    await page.waitForFunction(() => window.__state?.started && window.__quests, null, { timeout: 60000 });
    await page.waitForTimeout(2200);
    await stand(560, 540, "up");                    // a reload drops the player at the map's own spawn: put him by the board
    await page.waitForTimeout(600);
    const back = record("back", await snap());
    console.log("  back", JSON.stringify({ map: back.map, props: back.props }));
    expect(back.props.some((p) => p.key === "zz_props_demo#0" && p.onScreen), "the board is back after a reload of the map");
    await shot("back-on-map");

    // ---- F2 -> Quests off hides it and brings it back, with no reload ---------------------------------------
    const toggle = () => page.evaluate(() => {
        const box = document.querySelector('#fx-panel input[data-fx="quests"]');
        if (!box) return null;
        box.click();
        return box.checked;
    });
    await page.evaluate(() => document.getElementById("fx-gear")?.click());
    await page.waitForTimeout(300);
    const off = await toggle();
    await page.waitForTimeout(900);
    const hidden = record("quests-off", await snap());
    console.log("  quests off:", off, "| props", hidden.props.length, "| solidAt", await page.evaluate(() => window.__questProps.solidAt("s210", 560, 500)));
    expect(off === false, "the Quests switch is off");
    expect(hidden.props.length === 0, `no prop while Quests is off (${hidden.props.length})`);
    expect(await page.evaluate(() => window.__questProps.solidAt("s210", 560, 500)) === false, "the solid box is gone too");
    await shot("quests-off");
    const on = await toggle();
    await page.waitForTimeout(900);
    const shown = record("quests-on", await snap());
    expect(on === true, "the Quests switch is on again");
    expect(shown.props.some((p) => p.onScreen), "the board is back with no reload");
    expect(await page.evaluate(() => window.__questProps.solidAt("s210", 560, 500)) === true, "and it blocks again");
    await shot("quests-on");
    await page.evaluate(() => document.getElementById("fx-gear")?.click());

    // ---- hand it in: the old board stays behind (the second prop, "done") ----------------------------------
    await page.goto(ROOT + "quest-lab.html");
    await page.waitForURL(/questlab=1/, { timeout: 30000 });
    await ready();
    await page.waitForTimeout(1200);
    await page.fill("#questlab input[type=search]", "The lobby sign");
    await page.waitForTimeout(400);
    const row2 = page.locator("#questlab .q", { hasText: "The lobby sign" }).first();
    await row2.locator("button", { hasText: "Goals" }).first().click();
    await page.waitForTimeout(600);
    console.log("  after Goals", JSON.stringify(await page.evaluate(() => ({
        status: window.__quests.status("zz_props_demo"),
        active: window.__quests.state.active.zz_props_demo ?? null,
    }))));
    await page.goto(ROOT + "index.html?skipTitle=1&map=s210&noEncounters=1");
    await page.waitForFunction(() => window.__state?.started && window.__quests, null, { timeout: 60000 });
    await page.waitForTimeout(2200);
    // A fresh page rebuilds the stage cast from the scene's spawn flags: clear the Geek's so he is standing there to be
    // talked to (the lab's Go did this in memory on the page it opened).
    const giver = await page.evaluate(() => {
        const st = window.__state, sc = st.scenes.s210;
        const npc = sc?.npcs?.find((n) => n.npc_id === 51);
        if (!npc) return null;
        npc.spawn_flags = [];
        sc._cast = null;
        return { x: npc.x, y: npc.y };
    });
    console.log("  Geek on the map at", JSON.stringify(giver));
    expect(!!giver, "the Geek is standing in the lobby to take the turn-in");
    await stand(529, 525, "up");
    await page.waitForTimeout(500);
    const handedIn = await talkThrough((s) => s.done != null, 35000, "turnin");
    expect(handedIn, "the turn-in was spoken and the quest is marked done");
    await quiet();
    const finished = record("done", await snap());
    console.log("  done", JSON.stringify({ props: finished.props, boxes: finished.boxes }));
    expect(finished.props.some((p) => p.key === "zz_props_demo#0"), "the accepted board is still there after the hand-in");
    expect(finished.props.some((p) => p.key === "zz_props_demo#1" && p.onScreen), "the old board appeared (after: done)");
    expect(finished.props.find((p) => p.key === "zz_props_demo#1")?.x === 584, "the old board is where it was authored");
    await stand(560, 540, "up");
    await page.waitForTimeout(500);
    await shot("both-boards");

    // ---- one more visit: both boards are there after a full reload (the saved quest state) -------------------
    await page.goto(ROOT + "index.html?skipTitle=1&map=s210&noEncounters=1");
    await page.waitForFunction(() => window.__state?.started && window.__quests, null, { timeout: 60000 });
    await page.waitForTimeout(2400);
    const revisit = record("revisit", await snap());
    expect(revisit.props.length === 2, `both boards stand on a later visit (${revisit.props.length})`);
    await stand(560, 540, "up");
    await page.waitForTimeout(400);
    await shot("after-reload");

    // ---- a reset of the quest layer drops them (state change, no reload) -----------------------------------
    await page.evaluate(() => window.__quests.lab.reset());
    await page.waitForTimeout(900);
    const reset = record("reset", await snap());
    expect(reset.props.length === 0, `a quest reset drops every prop (${reset.props.length})`);
    await shot("after-reset");
} catch (e) {
    console.error("ERROR", e?.stack ?? e);
    problems.push("exception: " + (e?.message ?? e));
    try { await shot("error"); } catch (_) { /* page gone */ }
} finally {
    writeFileSync(`${OUT}/run.json`, JSON.stringify({ problems, log }, null, 1));
    console.log(problems.length ? `PROBLEMS: ${problems.length}` : "ALL OK");
    for (const p of problems) console.log(" -", p);
    await browser.close();
    process.exit(problems.length ? 1 : 0);
}
