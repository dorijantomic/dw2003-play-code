// Play the zz_ghost_demo quest (the ghost step and the drop/rise camera) in the real game through web/quest-lab.html, and
// photograph every beat. The assertions are the two things this task must prove:
//   * an NPC and the player draw faded and tinted while the step is on, and are back to normal when it is off / at the end;
//   * during the drop and the rise the player is INSIDE the view, even though a `pan` had moved the camera away first.
// Server: python3 -m http.server 8770 --directory web   (build first: python3 tools/build_quests.py --with-drafts)
// Run:    VERIFY_PORT=8770 tools/run-playwright.sh tools/verify_quest_ghost.mjs
// Shots:  $QS_SHOT (default ~/scratch-research/quest-fx2/ghost/shots)
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.QS_ROOT || `${baseUrl(8770)}/`;
const OUT = process.env.QS_SHOT || `${process.env.HOME}/scratch-research/quest-fx2/ghost/shots`;
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

/** The field state a verifier needs: where the player is, where the camera is, and where that puts the player on screen. */
const snap = () => page.evaluate(() => {
    const st = window.__state ?? {};
    const cam = window.__lastCam ?? { x: 0, y: 0, zoom: 1 };
    const cv = document.getElementById("game");
    const zoom = cam.zoom ?? 1;
    return {
        map: window.__quests?.where?.().lastMap ?? null,
        x: Math.round(st.x ?? 0), y: Math.round(st.y ?? 0),
        cam: { x: Math.round(cam.x ?? 0), y: Math.round(cam.y ?? 0) },
        // the player's position in the canvas's own pixels, exactly as the renderer projects it
        screen: { x: Math.round(((st.x ?? 0) - (cam.x ?? 0)) * zoom), y: Math.round(((st.y ?? 0) - (cam.y ?? 0)) * zoom) },
        view: { w: cv?.width ?? 0, h: cv?.height ?? 0 },
        cut: window.__cutscene?.isActive?.() ?? false,
        camMode: window.__cutscene?.camera?.mode ?? null,
        tb: window.__textbox?.isOpen?.() ?? false,
        ch: window.__choice?.isOpen?.() ?? false,
        ghost: window.__questFx?.ghost?.() ?? [],
        drive: window.__questFx?.drive?.() ?? null,
        text: window.__textbox?.current?.()?.text ?? null,
    };
});

page.on("pageerror", (e) => { console.error("PAGEERROR", e.message); problems.push("pageerror: " + e.message); });
page.on("console", (m) => { if (/quest scene|quest ghost|SCENEEVENT/i.test(m.text())) console.log("console:", m.text()); });

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
    // Four demos and a shipped flagship quest share Cipher (1005) on the bridge, and the quest layer offers whichever is
    // first in the list. Mark the others done so the ghost demo is the one Cipher offers. Browser-local, demos only.
    if (localStorage.getItem("dw.quests.v1") == null) {
        localStorage.setItem("dw.quests.v1", JSON.stringify({
            v: 1, active: {}, done: { zz_chase_demo: 1, zz_fx_demo: 1, zz_sky_demo: 1, f_cipher_standing_orders: 1 },
            visited: [], met: [], duelWins: 0, announced: {}, seen: {}, gen: { n: 0, def: null },
        }));
    }
});

const ready = () => page.waitForFunction(
    () => window.__state?.started && window.__quests?.defs?.length && document.getElementById("questlab"),
    null, { timeout: 60000 });
const takeKeys = () => page.evaluate(() => document.activeElement?.blur?.());
const key = async (k) => { await takeKeys(); await page.keyboard.press(k); };

/** Wrapped: the player's on-screen box overlaps the canvas (0..w, 0..h), with a small margin for the sprite's height. */
const playerInView = (s) => s.screen.x > 0 && s.screen.x < s.view.w && s.screen.y > 0 && s.screen.y < s.view.h;

/** Sample (and photograph) the running scene densely; Enter advances its lines; stop when it is over. */
async function watch(ms, tag, every = 90) {
    const t0 = Date.now();
    const frames = [];
    let quiet = 0;
    while (Date.now() - t0 < ms) {
        const s = await snap();
        frames.push({ t: Date.now() - t0, ...s });
        log.push({ phase: tag, t: Date.now() - t0, ...s });
        if (frames.length % 6 === 1) await shot(`${tag}-${String(frames.length).padStart(2, "0")}`);
        if (s.tb || s.ch) await key("Enter");
        if (!s.cut && !s.tb && !s.ch) { if (++quiet > 6) break; } else quiet = 0;
        await page.waitForTimeout(every);
    }
    return frames;
}

try {
    // ---- quest lab: find the demo, press Go ---------------------------------------------------------------
    await page.goto(ROOT + "quest-lab.html");
    await page.waitForURL(/questlab=1/, { timeout: 30000 });
    await ready();
    await page.waitForTimeout(1500);
    await page.fill("#questlab input[type=search]", "The bridge remembers");
    await page.waitForTimeout(400);
    const row = page.locator("#questlab .q", { hasText: "The bridge remembers" }).first();
    expect(await row.count() > 0, "the ghost demo is listed in the quest lab");
    await row.locator("button", { hasText: "Go" }).first().click();
    await takeKeys();
    await page.waitForURL(/map=s205/, { timeout: 30000 });
    await ready();
    await page.waitForTimeout(2600);
    const at = await snap();
    console.log("  standing", JSON.stringify({ map: at.map, x: at.x, y: at.y }));
    expect(at.map === "s205", `the lab put us on the Asuka Bridge (${at.map})`);
    await shot("offer-before-talk");

    // ---- offer: Enter through the lines, answer "Watch it" -------------------------------------------------
    await key("Enter");
    let offer = [];
    let presses = 0;
    for (let i = 0; i < 80; i++) {
        const s = await snap();
        offer.push(s);
        if (s.ch) break;
        if (s.tb) { await key("Enter"); presses++; }
        // her ordinary chat is always the first talk; the offer comes on the next one (quests.js)
        else if (!s.cut && presses < 8) { await key("Enter"); presses++; }
        await page.waitForTimeout(300);
    }
    expect(offer.some((f) => f.tb), "the offer spoke in the game's own box");
    expect((await snap()).ch, "the offer asked its question");
    await shot("offer-choice");

    // ---- the scene -------------------------------------------------------------------------------------
    // A 25 fps trace of the field, recorded inside the page: the coarse sampler below spends most of its time taking
    // screenshots, so the drive (three seconds) would slip between two samples. The trace is the evidence for the drop.
    await page.evaluate(() => {
        window.__ghostTrace = [];
        window.__ghostTraceTimer = setInterval(() => {
            const st = window.__state ?? {}, cam = window.__lastCam ?? { x: 0, y: 0 };
            const cv = document.getElementById("game");
            window.__ghostTrace.push({
                t: Math.round(performance.now()), x: st.x ?? 0, y: st.y ?? 0,
                cx: cam.x ?? 0, cy: cam.y ?? 0, zoom: cam.zoom ?? 1, w: cv?.width ?? 0, h: cv?.height ?? 0,
                drive: window.__questFx?.drive?.() ?? null,
                ghost: window.__questFx?.ghost?.() ?? [],
            });
        }, 40);
    });
    await key("Enter");                                  // "Watch it"
    await page.waitForTimeout(600);
    const frames = await watch(45000, "scene", 120);
    const trace = await page.evaluate(() => { clearInterval(window.__ghostTraceTimer); return window.__ghostTrace ?? []; });
    const withScreen = (f) => ({ ...f, screen: { x: Math.round((f.x - f.cx) * f.zoom), y: Math.round((f.y - f.cy) * f.zoom) }, view: { w: f.w, h: f.h } });

    const ghostFrames = frames.filter((f) => f.ghost.some((g) => g.actor === 1005));
    const ghostOff = frames.filter((f) => ghostFrames.length && !f.ghost.some((g) => g.actor === 1005));
    const playerGhost = frames.filter((f) => f.ghost.some((g) => g.actor === "player"));
    const driveFrames = trace.map(withScreen).filter((f) => f.drive);
    const panned = frames.filter((f) => f.cut && f.camMode === "pan" && !playerInView(f));
    const dropFrames = driveFrames.filter((f) => f.drive.moved > 8);

    console.log("  frames", frames.length, "| ghost 1005", ghostFrames.length, "| after off", ghostOff.length,
        "| player ghost", playerGhost.length, "| drive", driveFrames.length, "| panned away", panned.length);

    // 1. the ghost is on, with the step's alpha and tint
    expect(ghostFrames.length > 2, `Cipher was drawn as a ghost (${ghostFrames.length} frames)`);
    const spec = ghostFrames[0]?.ghost.find((g) => g.actor === 1005);
    expect(spec && Math.abs(spec.alpha - 0.35) < 1e-6, `the ghost carries the step's alpha (${JSON.stringify(spec)})`);
    expect(spec?.tint === "#9fc8ff", `the ghost carries the step's tint (${spec?.tint})`);
    // 2. off puts him back, well before the scene ends
    expect(ghostOff.length > 2, `the ghost was switched off mid-scene (${ghostOff.length} frames after it)`);
    expect(!frames.at(-1).ghost.length, `no ghost survived the scene (${JSON.stringify(frames.at(-1).ghost)})`);
    // 3. the player can be ghosted too, at his own alpha
    const ps = playerGhost[0]?.ghost.find((g) => g.actor === "player");
    expect(playerGhost.length > 2 && Math.abs(ps.alpha - 0.4) < 1e-6, `the player was drawn as a ghost (${JSON.stringify(ps)})`);

    // 4. the camera first pans AWAY from the player, then the drop is watched from the player
    expect(panned.length > 0, `the camera panned to a point away from the player (${JSON.stringify(panned[0]?.cam)})`);
    const offscreenDuringDrop = dropFrames.filter((f) => !playerInView(f));
    console.log("  drop frames", dropFrames.length, "| player on screen", dropFrames.filter(playerInView).length);
    if (dropFrames.length) {
        console.log("  drop sample", JSON.stringify(dropFrames.slice(0, 6).map((f) => ({ drive: Math.round(f.drive.moved), y: f.y, cam: f.cam, screen: f.screen }))));
    }
    expect(dropFrames.length > 3, `the drop drive ran (${dropFrames.length} frames)`);
    expect(offscreenDuringDrop.length === 0, `the player stayed in view during the whole drop (${offscreenDuringDrop.length} frames off screen)`);
    // the camera is ON the player: the screen row is near the field camera's own centre, not the map's top edge
    const centred = dropFrames.filter((f) => Math.abs(f.screen.y - f.view.h / 2) < f.view.h * 0.45);
    expect(centred.length > dropFrames.length * 0.6, `the drop was watched from the player (${centred.length}/${dropFrames.length} centred)`);
    // the same for the climb back up (the second drive of the scene), and the player is in view for every sampled
    // frame of both drives -- not only for the ones that happened to be sampled mid-fall
    let episodes = 0;
    for (let i = 0; i < trace.length; i++) if (trace[i].drive && !trace[i - 1]?.drive) episodes++;
    const driveOffscreen = driveFrames.filter((f) => !playerInView(f));
    expect(episodes >= 2, `the drop and the rise both drove the player (${episodes} drives)`);
    expect(driveOffscreen.length === 0, `the player stayed in view through the drop AND the rise (${driveOffscreen.length} off screen)`);

    const end = await snap();
    console.log("  end", JSON.stringify({ map: end.map, x: end.x, y: end.y, ghost: end.ghost, cut: end.cut }));
    expect(!end.cut, "the scene ended on its own");
    expect(end.ghost.length === 0, "every ghost is cleared after the scene");
    await shot("after-scene");

    // ---- F2 -> Extras -> Quests switched off while a ghost is showing -----------------------------------------
    const played = await page.evaluate(() => {
        window.__fx.quests = true;
        // A second scene, played through the game's own path, that leaves one ghost on for a couple of seconds.
        window.__playQuestScene([{ ghost: 1005, alpha: 0.3, tint: "#9fc8ff" }, { wait: 150 }]);
        return true;
    });
    expect(played, "a second scene was started to hold a ghost on screen");
    await page.waitForTimeout(900);
    const ghostOn = await page.evaluate(() => window.__questFx.ghost());
    expect(ghostOn.some((g) => g.actor === 1005), `the second scene has a ghost on (${JSON.stringify(ghostOn)})`);
    await shot("f2-ghost-on");
    await page.evaluate(() => { window.__fx.quests = false; });
    await page.waitForTimeout(500);
    const ghostAfterF2 = await page.evaluate(() => window.__questFx.ghost());
    expect(ghostAfterF2.length === 0, `F2 Quests off takes the ghost off the screen (${JSON.stringify(ghostAfterF2)})`);
    await shot("f2-ghost-off");
    await page.evaluate(() => { window.__fx.quests = true; });
    await page.waitForTimeout(3200);                   // let that scene reach its END

    writeFileSync(`${OUT}/log.json`, JSON.stringify(log, null, 1));
} catch (e) {
    console.error("ERROR", e?.stack ?? e);
    problems.push("exception: " + (e?.message ?? e));
    try { await shot("error"); } catch (_) { /* page gone */ }
} finally {
    await browser.close();
}
console.log(problems.length ? `\n${problems.length} PROBLEM(S)` : "\nALL OK");
process.exit(problems.length ? 1 : 0);
