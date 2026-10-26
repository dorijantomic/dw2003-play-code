// Play the zz_fx_demo quest (the scene-events demo: our own effect art, camera pan, a drop and a warp) in the real game
// through web/quest-lab.html, and photograph every step. Proves the scene-event steps on a live map.
//
// Server: python3 -m http.server 8770 --directory web   (build first: python3 tools/build_quests.py --with-drafts)
// Run:    VERIFY_PORT=8770 tools/run-playwright.sh tools/verify_quest_fx.mjs
// Shots:  $QS_SHOT (default ~/scratch-research/quest-fx)
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.QS_ROOT || `${baseUrl(8770)}/`;
const OUT = process.env.QS_SHOT || `${process.env.HOME}/scratch-research/quest-fx`;
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
    cut: window.__cutscene?.isActive?.() ?? false,
    cam: window.__cutscene?.camera ? { x: Math.round(window.__cutscene.camera.x), y: Math.round(window.__cutscene.camera.y), mode: window.__cutscene.camera.mode } : null,
    tb: window.__textbox?.isOpen?.() ?? false,
    ch: window.__choice?.isOpen?.() ?? false,
    fx: window.__questFx?.state?.() ?? [],
    fade: window.__questFx?.fade?.() ?? 0,
    drive: window.__questFx?.drive?.() ?? null,
}));

page.on("pageerror", (e) => { console.error("PAGEERROR", e.message); problems.push("pageerror: " + e.message); });
page.on("console", (m) => { if (/quest scene|quest fx|\[quests\]|SCENEEVENT/i.test(m.text())) console.log("console:", m.text()); });

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
// The lab panel is a DOM overlay: a button keeps focus after a click, and its own keydown handler stops Enter from reaching
// the game (and Enter on a focused button would press it again). Give the keyboard back to the canvas before every talk.
const takeKeys = () => page.evaluate(() => document.activeElement?.blur?.());
const key = async (k) => { await takeKeys(); await page.keyboard.press(k); };

/** Press Enter through talk until the scene's question opens (then stop and photograph it), or until `ms` runs out. */
async function talkToQuestion(ms) {
    const t0 = Date.now();
    const frames = [];
    let presses = 0;
    while (Date.now() - t0 < ms) {
        const s = await snap();
        frames.push(s); log.push({ phase: "offer", t: Date.now() - t0, ...s });
        if (s.ch) break;
        if (s.tb) { await key("Enter"); presses++; }
        if (frames.length % 2 === 1) await shot(`offer-${String(frames.length).padStart(2, "0")}`);
        if (!s.cut && !s.tb && presses > 0) break;
        await page.waitForTimeout(300);
    }
    return frames;
}

/** Sample (and photograph) a running scene densely; stop when it has ended (no cutscene, no box) for a moment. */
async function watch(ms, tag, every = 160) {
    const t0 = Date.now();
    const frames = [];
    let quiet = 0;
    while (Date.now() - t0 < ms) {
        const s = await snap();
        frames.push({ t: Date.now() - t0, ...s }); log.push({ phase: tag, t: Date.now() - t0, ...s });
        if (frames.length % 2 === 1) await shot(`${tag}-${String(frames.length).padStart(2, "0")}`);
        if (s.tb || s.ch) await key("Enter");
        if (!s.cut && !s.tb && !s.ch) { if (++quiet > 6) break; } else quiet = 0;
        await page.waitForTimeout(every);
    }
    return frames;
}

try {
    // ---- Quest lab, find the demo, press Go ---------------------------------------------------------------
    await page.goto(ROOT + "quest-lab.html");
    await page.waitForURL(/questlab=1/, { timeout: 30000 });
    await ready();
    await page.waitForTimeout(1500);
    await page.fill("#questlab input[type=search]", "Cipher's field test");
    await page.waitForTimeout(400);
    const row = page.locator("#questlab .q", { hasText: "Cipher's field test" }).first();
    expect(await row.count() > 0, "the demo quest is listed in the quest lab");
    await row.locator("button", { hasText: "Go" }).first().click();
    await takeKeys();
    await page.waitForURL(/map=s205/, { timeout: 30000 });
    await ready();
    await page.waitForTimeout(2600);            // the panel's pending "Go" stands the player in front of Cipher
    const at = await snap();
    console.log("  standing", JSON.stringify({ map: at.map, x: at.x, y: at.y }));
    expect(at.map === "s205", `the lab put us on the Bridge (${at.map})`);

    // ---- Offer: three lines, then the question; answer "Run it" ------------------------------------------
    await key("Enter");
    const offer = await talkToQuestion(20000);
    expect(offer.some((f) => f.tb), "the offer spoke in the game's own box");
    expect(offer.some((f) => f.ch), "the offer asked its question");
    await shot("offer-choice");
    const q1 = await page.evaluate(() => JSON.parse(localStorage.getItem("dw.quests.v1")).active);
    console.log("  before answering", JSON.stringify(q1));

    // ---- The test scene: fade, pan, crate fall, drop, warp -------------------------------------------------
    await key("Enter");                                // "Run it" (the first option)
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({
        active: window.__quests.state.active, ch: window.__choice?.isOpen?.() ?? false,
        tb: window.__textbox?.isOpen?.() ?? false, cut: window.__cutscene?.isActive?.() ?? false,
        text: window.__textbox?.current?.()?.text ?? null,
    }));
    console.log("  after the answer", JSON.stringify(after));
    expect(!!after.active.zz_fx_demo, "taking the offer started zz_fx_demo");
    const test = await watch(40000, "test", 150);
    const sawFade = test.some((f) => f.fade > 0.5);
    const crateFrames = test.filter((f) => f.fx.some((e) => e.name === "crate"));
    const ys = crateFrames.map((f) => f.fx.find((e) => e.name === "crate").y);
    const moving = crateFrames.filter((f) => f.fx.find((e) => e.name === "crate").moving === "fall");
    const panFrame = test.find((f) => f.cut && f.cam && Math.abs(f.cam.x - 1056) < 40 && Math.abs(f.cam.y - 200) < 40);
    const driveFrames = test.filter((f) => f.drive);
    console.log("  crate y over time", ys.join(","));
    console.log("  frames with crate", crateFrames.length, "of", test.length, "| falling", moving.length, "| pan frames", test.filter((f) => f.cam).length);
    expect(crateFrames.length > 3, `the crate effect appeared on the map (${crateFrames.length} frames)`);
    expect(new Set(ys).size > 3, `the crate fell through several heights (${new Set(ys).size})`);
    if (ys.length) {
        expect(Math.min(...ys) < 150 && Math.max(...ys) >= 318, `it started high (${Math.min(...ys)}) and settled on the stair floor (${Math.max(...ys)})`);
    }
    expect(moving.length > 0, "the fall motion ran (moving=fall)");
    expect(!!panFrame, `the camera panned to the stair landing (${panFrame ? JSON.stringify(panFrame.cam) : "never saw it"})`);
    expect(sawFade, "the screen faded to black and back");
    expect(driveFrames.length > 0, "the drop drive ran (the player's own Y was being moved)");
    const end = await snap();
    console.log("  end", JSON.stringify({ map: end.map, x: end.x, y: end.y, fx: end.fx, cut: end.cut }));
    expect(end.map === "s320", `the warp carried the player to the sewers (${end.map})`);
    expect(end.fx.length === 0, `no effect art was left behind (${end.fx.length} live)`);
    expect(!end.cut, "the scene ended at the warp");
    await shot("after-warp");

    // ---- Turn-in: meet the goal, then talk to Cipher again --------------------------------------------
    await page.fill("#questlab input[type=search]", "Cipher's field test");
    await page.waitForTimeout(300);
    const row2 = page.locator("#questlab .q", { hasText: "Cipher's field test" }).first();
    await row2.locator("button", { hasText: "Goals" }).first().click();
    await page.waitForTimeout(600);
    console.log("  after Goals", JSON.stringify(await page.evaluate(() => ({
        status: window.__quests.status("zz_fx_demo"), active: window.__quests.state.active.zz_fx_demo ?? null,
        done: window.__quests.state.done.zz_fx_demo ?? null,
    }))));
    // "Go" would call lab.prepare() and take the active quest away again, so go back by the ordinary map URL and stand in
    // front of Cipher by hand (the two things the lab would have done).
    await page.goto(ROOT + "index.html?skipTitle=1&map=s205&noEncounters=1");
    await page.waitForFunction(() => window.__state?.started && window.__quests, null, { timeout: 60000 });
    await page.waitForTimeout(2200);
    const found = await page.evaluate(() => {
        const st = window.__state, sc = st.scenes.s205;
        let npc = sc.npcs.find((x) => x.npc_id === 1005);
        if (npc) { npc.spawn_flags = []; sc._cast = null; }
        if (!npc) return null;
        st.x = npc.x; st.y = npc.y + 36; st.dir = "up"; st.moving = false;
        return { x: npc.x, y: npc.y };
    });
    console.log("  Cipher at", JSON.stringify(found));
    expect(!!found, "Cipher is on the Bridge to take the turn-in");
    await page.waitForTimeout(600);
    console.log("  before turn-in talk", JSON.stringify(await page.evaluate(() => ({
        status: window.__quests.status("zz_fx_demo"), active: window.__quests.state.active.zz_fx_demo ?? null,
        map: window.__quests.where().lastMap,
    }))));
    await key("Enter");
    const done = await watch(15000, "turnin", 250);
    expect(done.some((f) => f.tb), "the turn-in spoke");
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem("dw.quests.v1")));
    console.log("  done?", JSON.stringify(state.done.zz_fx_demo ?? null));
    expect(state.done.zz_fx_demo != null, "the quest is marked done after the turn-in");
    const bits = await page.evaluate(() => ({ bits: window.__state.bits, inv: window.__state.inventory?.length ?? null }));
    console.log("  after reward", JSON.stringify(bits));
    await shot("turnin-end");
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
