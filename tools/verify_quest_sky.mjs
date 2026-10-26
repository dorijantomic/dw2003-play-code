// Play the zz_sky_demo quest (the atmosphere demo: screen shake, fog on a map that has none, night, lightning) in the real
// game through web/quest-lab.html, and photograph every moment. Proves the `shake` / `weather` / `time` / `lightning` steps
// on a live map: the bridge's own profile has neither fog nor rain, the night has to come and go, and everything must be
// back exactly as it was when the scene ends.
//
// Server: python3 -m http.server 8770 --directory web   (build first: python3 tools/build_quests.py --with-drafts)
// Run:    VERIFY_PORT=8770 tools/run-playwright.sh tools/verify_quest_sky.mjs
// Shots:  $QS_SHOT (default ~/scratch-research/quest-fx2/sky)
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.QS_ROOT || `${baseUrl(8770)}/`;
const OUT = process.env.QS_SHOT || `${process.env.HOME}/scratch-research/quest-fx2/sky`;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const problems = [];
const expect = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) problems.push(msg); };
const log = [];
let n = 0;
const shot = async (tag) => {
    const el = await page.$("canvas#game");
    const st = await snap();
    const bits = [];
    if (st.sky?.weather) bits.push(`w-${st.sky.weather}${st.sky.weatherRamp >= 1 ? "" : "-in"}`);
    if (st.sky?.time) bits.push(`t-${st.sky.time}`);
    if (st.sky?.todForce != null) bits.push(`tod${Math.round(st.sky.todForce * 100)}`);
    if (st.shake && (st.shake.offset.x || st.shake.offset.y)) bits.push("shake");
    const name = `${String(++n).padStart(2, "0")}-${tag}${bits.length ? "-" + bits.join("_") : ""}.png`;
    if (el) writeFileSync(`${OUT}/${name}`, await el.screenshot());
    return name;
};
// A tiny mean-brightness probe of the game canvas: night is measurably darker, a lightning flash measurably brighter.
const snap = () => page.evaluate(() => {
    const cv = document.querySelector("canvas#game");
    let bright = null;
    if (cv && cv.width) {
        let probe = window.__skyProbe;
        if (!probe) { probe = document.createElement("canvas"); probe.width = 32; probe.height = 24; window.__skyProbe = probe; }
        const g = probe.getContext("2d", { willReadFrequently: true });
        g.drawImage(cv, 0, 0, 32, 24);
        const d = g.getImageData(0, 0, 32, 24).data;
        let s = 0;
        for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
        bright = Math.round(s / (32 * 24));
    }
    return {
        map: window.__quests?.where?.().lastMap ?? null,
        cut: window.__cutscene?.isActive?.() ?? false,
        cam: window.__cutscene?.camera ? { x: Math.round(window.__cutscene.camera.x), y: Math.round(window.__cutscene.camera.y) } : null,
        tb: window.__textbox?.isOpen?.() ?? false,
        ch: window.__choice?.isOpen?.() ?? false,
        sky: window.__questFx?.sky?.() ?? null,
        shake: window.__questFx?.shake?.() ?? null,
        profile: (() => { const p = window.__ambienceProfile?.("s205"); return p ? { fog: p.fog, rainy: p.rainy, snowy: p.snowy, open: p.open } : null; })(),
        todForce: typeof window.__todForce === "number" ? Math.round(window.__todForce * 1000) / 1000 : null,
        fogSwitch: window.__fx?.fog ?? null,
        bright,
    };
});

page.on("pageerror", (e) => { console.error("PAGEERROR", e.message); problems.push("pageerror: " + e.message); });
page.on("console", (m) => { if (/quest scene|quest fx|ambience: s205|SCENEEVENT/i.test(m.text())) console.log("console:", m.text()); });

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
async function watch(ms, tag, every = 120) {
    const t0 = Date.now();
    const frames = [];
    let quiet = 0;
    while (Date.now() - t0 < ms) {
        const s = await snap();
        frames.push({ t: Date.now() - t0, ...s }); log.push({ phase: tag, t: Date.now() - t0, ...s });
        if (frames.length % 2 === 1) await shot(`${tag}-${String(frames.length).padStart(2, "0")}`);
        if (s.tb || s.ch) await key("Enter");
        if (!s.cut && !s.tb && !s.ch) { if (++quiet > 8) break; } else quiet = 0;
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
    await page.fill("#questlab input[type=search]", "Cipher's bridge drill");
    await page.waitForTimeout(400);
    const row = page.locator("#questlab .q", { hasText: "Cipher's bridge drill" }).first();
    expect(await row.count() > 0, "the sky demo quest is listed in the quest lab");
    await row.locator("button", { hasText: "Go" }).first().click();
    await takeKeys();
    await page.waitForURL(/map=s205/, { timeout: 30000 });
    await ready();
    await page.waitForTimeout(2600);
    const at = await snap();
    console.log("  standing", JSON.stringify({ map: at.map, cam: at.cam, profile: at.profile, bright: at.bright }));
    expect(at.map === "s205", `the lab put us on the Bridge (${at.map})`);
    expect(!!at.profile && at.profile.fog === false && at.profile.rainy === false,
        `the bridge's own profile has no fog and no rain (${JSON.stringify(at.profile)})`);

    // ---- Offer: find OUR offer (other demo quests share Cipher, so decline theirs first) --------------------
    let offer = [];
    let gotOurs = false;
    for (let attempt = 0; attempt < 5 && !gotOurs; attempt++) {
        await key("Enter");
        offer = await talkToQuestion(20000);
        const prompt = await page.evaluate(() => (window.__choice?.isOpen?.() ? window.__choice.prompt : null));
        gotOurs = !!prompt && /drill/i.test(prompt);
        console.log("  offer", attempt, JSON.stringify(prompt));
        if (!gotOurs) {
            await shot(`offer-other-${attempt}`);
            await page.evaluate(() => {                 // "Not now", so the next talk offers the next quest
                const ch = window.__choice;
                if (!ch?.isOpen?.()) return;
                while (ch.cursorIdx < ch.options.length - 1) ch.moveDown();
                ch.confirm();
            });
            await page.waitForTimeout(1400);
        }
    }
    expect(offer.some((f) => f.tb), "the offer spoke in the game's own box");
    expect(offer.some((f) => f.ch), "the offer asked its question");
    expect(gotOurs, "the sky demo's own offer came up");
    await shot("offer-choice");
    const dayBright = offer.length ? offer[0].bright : at.bright;

    // ---- The drill ------------------------------------------------------------------------------------
    await key("Enter");                                // "Run it"
    await page.waitForTimeout(500);
    const active = await page.evaluate(() => window.__quests.state.active.zz_sky_demo ?? null);
    expect(!!active, "taking the offer started zz_sky_demo");
    const run = await watch(60000, "drill", 110);

    const shakeFrames = run.filter((f) => f.shake && (f.shake.offset.x || f.shake.offset.y));
    const fogFrames = run.filter((f) => f.sky && f.sky.weather === "fog" && f.sky.weatherRamp >= 1);
    const nightFrames = run.filter((f) => f.sky && f.sky.time === "night" && f.sky.todForce != null && f.sky.todForce > 0.7);
    const clearFrames = run.filter((f) => f.sky && f.sky.weather === "clear");
    const end = await snap();
    const nightBright = nightFrames.length ? Math.min(...nightFrames.map((f) => f.bright ?? 999)) : null;
    const flash = nightFrames.length ? Math.max(...nightFrames.map((f) => f.bright ?? 0)) : null;

    console.log("  shake frames", shakeFrames.length, "| fog frames", fogFrames.length, "| night frames", nightFrames.length,
        "| clear frames", clearFrames.length);
    console.log("  brightness day", dayBright, "| night min", nightBright, "| night max (flash)", flash, "| after", end.bright);
    console.log("  shake sample", JSON.stringify(shakeFrames[0]?.shake ?? null));
    console.log("  sky during fog", JSON.stringify(fogFrames[0]?.sky ?? null));
    console.log("  sky during night", JSON.stringify(nightFrames[0]?.sky ?? null));
    console.log("  after the scene", JSON.stringify({ sky: end.sky, shake: end.shake, todForce: end.todForce, bright: end.bright }));

    expect(shakeFrames.length > 0, `the field shook (${shakeFrames.length} sampled frames with an offset)`);
    expect(shakeFrames.every((f) => Math.abs(f.shake.offset.x) <= 6 && Math.abs(f.shake.offset.y) <= 6), "the shake never passed its 4 px amplitude by much");
    expect(fogFrames.length > 0, "fog came up on a map whose own profile has none");
    expect(nightFrames.length > 0, "night came up on the bridge");
    expect(nightBright != null && dayBright != null && nightBright < dayBright - 12, `night is visibly darker (${nightBright} vs ${dayBright})`);
    expect(flash != null && nightBright != null && flash > nightBright + 12, `a lightning flash lit the frame (${flash} vs ${nightBright})`);
    expect(clearFrames.length > 0, "the step put the weather back to clear before the scene ended");
    expect(end.sky === null, `the scene's sky override is gone after it (${JSON.stringify(end.sky)})`);
    expect(!end.shake || (!end.shake.offset.x && !end.shake.offset.y), "no shake offset is left");
    expect(end.todForce === null, `the day cycle is back under the panel's control (${end.todForce})`);
    expect(!end.cut && !end.tb, "the scene ended");
    await shot("after-scene");

    // ---- The player's own F2 switches: a scene effect obeys them, unless the step says force ---------------------------------
    const fogAllows = () => page.evaluate(() => window.__ambienceSceneAllows?.("fog") ?? null);
    const midScene = async (steps) => {
        const running = page.evaluate((s) => window.__playQuestScene(s), steps);   // resolves when the scene ends
        await page.waitForTimeout(900);
        const state = { allows: await fogAllows(), sky: await page.evaluate(() => window.__questFx.sky()) };
        await running;
        return state;
    };
    await page.evaluate(() => { window.__fx.fog = false; });              // the player switched fog OFF in F2
    const hold = [{ wait: 240 }];
    const offPlain = await midScene([{ weather: "fog", strength: 1, frames: 2 }, ...hold]);
    const offForced = await midScene([{ weather: "fog", strength: 1, frames: 2, force: true }, ...hold]);
    await page.evaluate(() => { window.__fx.fog = true; });
    const onPlain = await midScene([{ weather: "fog", strength: 1, frames: 2 }, ...hold]);
    console.log("  panel switches:", JSON.stringify({ offPlain: offPlain.allows, offForced: offForced.allows, onPlain: onPlain.allows }));
    expect(offPlain.sky?.weather === "fog" && offPlain.allows === false,
        `fog switched off in F2 stays off even though the scene asked (${JSON.stringify(offPlain)})`);
    expect(offForced.allows === true, `force: true shows it anyway (${JSON.stringify(offForced)})`);
    expect(onPlain.allows === true, `a switched-on effect draws (${JSON.stringify(onPlain)})`);
    expect((await page.evaluate(() => window.__questFx.sky())) === null, "the override is gone after those scenes too");
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
