// Play zz_fx_all ("Cipher's full sweep") -- the one quest scene that uses EVERY step -- in the real game, from the offer
// to the hand-in, and photograph each moment. Then play it twice more and interrupt it, to prove an interrupted scene
// leaves nothing behind.
//
//   RUN A  the whole scene, start to end: shake thuds, fog on a map with no fog, night, lightning, a ghost, a crate that
//          falls/settles/slides/fades, a real mid-scene fight (won), a chase lap (kept), a drop, a rise, a fade, a warp.
//          Then the hand-in, and the prop the quest leaves on the bridge.
//   RUN B  the same scene, aborted half-way through (window.__cutscene.abort()): the sky, the ghosts, the shake and the
//          effect art must all be gone, and the map's own day back.
//   RUN C  the same scene, with F2 -> Extras -> Quests switched off half-way: the quest layer's art and sky go at once
//          while the conversation finishes (the switch is the player's own).
//
// Server: python3 -m http.server 8770 --directory web   (build first: python3 tools/build_quests.py --with-drafts)
// Run:    tools/run-playwright.sh tools/verify_quest_all.mjs
// Shots:  $QA_SHOT (default ~/scratch-research/quest-fx2/verify)
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.QA_ROOT || `${baseUrl(8770)}/`;
const OUT = process.env.QA_SHOT || `${process.env.HOME}/scratch-research/quest-fx2/verify`;
mkdirSync(OUT, { recursive: true });
const QID = "zz_fx_all";
const browser = await chromium.launch({ headless: true });
let page = null;
const problems = [];
const expect = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) problems.push(msg); };
let shots = 0;
const shot = async (tag) => {
    const el = await page.$("canvas#game");
    const name = `${String(++shots).padStart(2, "0")}-${tag}.png`;
    if (el) writeFileSync(`${OUT}/${name}`, await el.screenshot());
    return name;
};

// The page's own clock is the game's; the harness only presses what a player would.
const tapEnter = async (ms = 90) => {
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.down("Enter");
    await page.waitForTimeout(ms);
    await page.keyboard.up("Enter");
    await page.waitForTimeout(60);
};

/** What the field, the scene, the art and the sky are doing right now, plus the frame's mean brightness. */
const snap = () => page.evaluate(() => {
    const c = document.querySelector("canvas#game");
    let lum = null;
    if (c) {
        const t = (window.__qaTmp ||= document.createElement("canvas"));
        t.width = 40; t.height = 30;
        const g = t.getContext("2d", { willReadFrequently: true });
        try {
            g.drawImage(c, 0, 0, t.width, t.height);
            const d = g.getImageData(0, 0, t.width, t.height).data;
            let sum = 0;
            for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            lum = Math.round((sum / (d.length / 4)) * 10) / 10;
        } catch { lum = null; }
    }
    return {
        map: window.__quests?.where?.().lastMap ?? null,
        x: Math.round(window.__state?.x ?? 0), y: Math.round(window.__state?.y ?? 0),
        cut: window.__cutscene?.isActive?.() ?? false,
        tb: window.__textbox?.isOpen?.() ?? false,
        ch: window.__choice?.isOpen?.() ?? false,
        battle: window.__battle?.isActive?.() ?? false,
        fx: window.__questFx?.state?.() ?? [],
        fade: window.__questFx?.fade?.() ?? 0,
        drive: window.__questFx?.drive?.() ?? null,
        shake: window.__questFx?.shake?.() ?? null,
        sky: window.__questFx?.sky?.() ?? null,
        ghosts: window.__questFx?.ghost?.() ?? [],
        chase: window.__questChase?.() ?? null,
        chaseLast: window.__state?._questChaseLast ?? null,
        props: window.__questProps?.state?.() ?? [],
        tod: typeof window.__todForce === "number" ? Math.round(window.__todForce * 1000) / 1000 : null,
        zoomCam: window.__cutscene?.camera ? { x: Math.round(window.__cutscene.camera.x), y: Math.round(window.__cutscene.camera.y) } : null,
        text: (() => { const d = window.__textbox?.dialogue ?? null; return d ? (d.pages?.[d.pageIdx ?? 0] ?? []).join(" ") : null; })(),
        lum,
    };
});

/** Start (once) the in-page bot that drives the player after the chase target; it does nothing when no chase runs. */
const startChaseBot = () => page.evaluate(() => {
    const bot = (window.__qaBot = { on: true, samples: [] });
    const tick = () => {
        if (!bot.on) return;
        const c = window.__questChase?.();
        const st = window.__state;
        const k = st.keys;
        if (!c) { for (const b of ["left", "right", "up", "down"]) k.delete(b); bot.done = true; requestAnimationFrame(tick); return; }
        const dx = c.x - st.x, dy = c.y - st.y, d = Math.hypot(dx, dy);
        const go = d > 48;
        const set = (b, on) => (on ? k.add(b) : k.delete(b));
        set("right", go && dx > 12); set("left", go && dx < -12);
        set("down", go && dy > 12); set("up", go && dy < -12);
        bot.samples.push({ d: Math.round(d), warn: !!c.warn, px: Math.round(st.x), py: Math.round(st.y) });
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
});
const stopChaseBot = () => page.evaluate(() => {
    const bot = window.__qaBot;
    if (!bot) return null;
    bot.on = false;
    for (const b of ["left", "right", "up", "down"]) window.__state?.keys?.delete(b);
    return { samples: bot.samples };
});

/** One step of a live battle, played the way a player plays it: read the line, pick Fight, tap the target. */
async function battleStep() {
    const st = await page.evaluate(() => {
        const b = window.__battleB?.();
        const p = window.__battle?.peek?.();
        const m = p?.messageLine;
        return {
            active: !!window.__battle?.isActive?.(),
            state: b?.state ?? null,
            holds: !!(m?.active && !m.finished && (m.holdsTurn || p?.waitsForLine)),
            report: window.__reportOpen?.() === true || window.__reportNative?.isOpen?.() === true,
            pages: !!b?._resultPages?.length, ready: !!b?._resultReady,
        };
    });
    if (!st.active) return st;
    // Shorten the live enemy to 1 HP only so the check stays bounded -- the same discipline the arena checks use.
    if (st.state === 2 && !st.holds) await page.evaluate(() => { const b = window.__battleB?.(); if (b?.enemy) b.enemy.hp = 1; });
    await tapEnter(70);
    return st;
}

/** Stand the player in front of Cipher on the Bridge. `prepare` also makes `QID` the lab's one offerable quest (the Go
 *  button's own call); the turn-in must NOT prepare, because prepare() takes the taken quest back off the board. */
async function standAtCipher({ prepare = true } = {}) {
    await page.goto(ROOT + "index.html?skipTitle=1&map=s205&noEncounters=1");
    await page.waitForFunction(() => window.__state?.started && window.__quests?.defs?.length, null, { timeout: 60000 });
    await page.waitForTimeout(1800);
    const setup = await page.evaluate(([id, doPrep]) => {
        const prep = doPrep ? window.__quests.lab.prepare(id) : null;
        const st = window.__state, sc = st.scenes.s205;
        const npc = sc.npcs.find((x) => x.npc_id === 1005);
        if (npc) { npc.spawn_flags = []; sc._cast = null; }
        if (npc) { st.x = npc.x; st.y = npc.y + 36; st.dir = "up"; st.moving = false; }
        return { prep, npc: npc ? { x: npc.x, y: npc.y } : null, status: window.__quests.status(id) };
    }, [QID, prepare]);
    await page.waitForTimeout(500);
    return setup;
}

/** Press Enter through the talk until the offer's question is open (or the budget runs out). */
async function toQuestion(ms = 25000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        const s = await snap();
        if (s.ch) return s;
        if (s.tb) await tapEnter();
        else { await page.evaluate(() => document.activeElement?.blur?.()); await page.keyboard.press("Enter"); await page.waitForTimeout(250); }
        await page.waitForTimeout(120);
    }
    return null;
}

/**
 * Play the running scene, sampling fast and photographing each moment the first time it shows. Handles the three things
 * a viewer must do: read lines, fight the fight, and drive during a chase. Stops when the scene has been quiet for a bit
 * or `ms` runs out.
 */
async function playScene(ms, tag, { stopAt = null, onSample = null } = {}) {
    const t0 = Date.now();
    const seen = { shake: 0, fog: 0, night: 0, ghost: 0, crate: 0, slide: 0, battle: 0, chase: 0, driveDown: 0, driveUp: 0, fade: 0 };
    const frames = [];
    let quiet = 0;
    await startChaseBot();
    while (Date.now() - t0 < ms) {
        const s = await snap();
        frames.push(s);
        const first = async (key, cond, shotTag) => {
            if (!cond) return;
            seen[key]++;
            if (seen[key] === 1 && shotTag) await shot(shotTag);
        };
        await first("shake", !!(s.shake?.batch), `${tag}-01-shake`);
        await first("fog", s.sky?.weather === "fog" && (s.sky.weatherRamp ?? 0) > 0.85, `${tag}-02-fog`);
        await first("night", s.sky?.time === "night", `${tag}-03-night`);
        await first("ghost", s.ghosts.some((g) => g.actor === 1005), `${tag}-04-ghost`);
        await first("crate", s.fx.some((e) => e.name === "crate"), `${tag}-05-crate`);
        await first("slide", s.fx.some((e) => e.name === "crate" && e.moving === "slide"), `${tag}-06-crate-slide`);
        await first("battle", s.battle, `${tag}-07-battle`);
        await first("chase", !!s.chase, `${tag}-08-chase`);
        await first("driveDown", !!s.drive && (s.drive.moved ?? 0) > 0 && s.drive.dir > 0, `${tag}-09-drop`);
        await first("driveUp", !!s.drive && (s.drive.moved ?? 0) > 0 && s.drive.dir < 0, `${tag}-10-rise`);
        await first("fade", s.fade > 0.5, `${tag}-11-fade`);
        if (onSample) onSample(s, seen);
        if (stopAt && stopAt(s, seen)) { await stopChaseBot(); return { frames, seen, stopped: true, at: s }; }
        if (s.battle) { await battleStep(); quiet = 0; continue; }
        if (s.tb) { await tapEnter(); quiet = 0; continue; }
        if (s.ch) { await tapEnter(); quiet = 0; continue; }      // a question inside a scene: take the first row
        if (!s.cut && !s.chase && !s.battle) { if (++quiet > 8) break; } else quiet = 0;
        await page.waitForTimeout(110);
    }
    await stopChaseBot();
    return { frames, seen, stopped: false };
}

page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on("pageerror", (e) => { console.error("PAGEERROR", e.message); problems.push("pageerror: " + e.message); });
page.on("console", (m) => { if (/quest scene|quest fx|quest prop|\[quests\]|SCENEEVENT/i.test(m.text())) console.log("  console:", m.text().slice(0, 200)); });
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
    if (localStorage.getItem("dw.fx.v1") == null) localStorage.setItem("dw.fx.v1", "{}");
});

// A scene leftover check that a prop is not mistaken for: props are quest state, re-placed every frame on purpose.
const sceneArt = (s) => (s.fx ?? []).filter((e) => !String(e.name).startsWith("prop:"));

let allFrames = [];
try {
    // ═════════════════ RUN A: the whole scene ══════════════════════════════════════════════════════════════════════
    console.log("RUN A: offer -> the full sweep -> hand-in -> the prop");
    const setup = await standAtCipher();
    console.log("  setup", JSON.stringify(setup));
    expect(setup?.npc?.x === 896 && setup?.npc?.y === 296, "Cipher is on the Bridge at his post");
    await tapEnter();
    const q = await toQuestion(25000);
    expect(!!q?.ch, "the offer spoke in the game's own box and asked its question");
    await shot("runA-00-offer-choice");
    await tapEnter();                                    // "Run it"
    await page.waitForTimeout(500);
    const taken = await page.evaluate((id) => ({ active: !!window.__quests.state.active[id], status: window.__quests.status(id) }), QID);
    expect(taken.active, `answering "Run it" took the quest (${JSON.stringify(taken)})`);

    const run = await playScene(200000, "runA");
    allFrames = run.frames;
    const f = run.frames;
    const any = (pred) => f.filter(pred);
    const dayLum = f.slice(2, 20).map((s) => s.lum).filter((v) => v != null);
    const baseline = dayLum.length ? dayLum.sort((a, b) => a - b)[Math.floor(dayLum.length / 2)] : null;
    const nightLum = any((s) => s.sky?.time === "night").map((s) => s.lum).filter((v) => v != null);
    const nightMedian = nightLum.length ? [...nightLum].sort((a, b) => a - b)[Math.floor(nightLum.length / 2)] : null;
    const flashPeak = Math.max(...any((s) => s.sky?.time === "night" && Math.abs((s.sky.timeRamp ?? 0) - 1) < 0.05).map((s) => s.lum ?? 0), 0);

    console.log("  frames", f.length, "| brightness day", baseline, "night", nightMedian, "peak at night", Math.round(flashPeak));
    expect(run.seen.shake > 0, `the shake shook the field (${run.seen.shake} frames with a batch)`);
    const shakeOff = any((s) => s.shake?.offset && (Math.abs(s.shake.offset.x) + Math.abs(s.shake.offset.y) > 0));
    expect(shakeOff.length > 0, `the shake really offset the field (${shakeOff.length} frames, e.g. ${JSON.stringify(shakeOff[0]?.shake?.offset)})`);
    expect(run.seen.fog > 0, `fog was set on the Bridge, which has no fog in its own profile (${run.seen.fog} frames)`);
    expect(run.seen.night > 0, `night was set in the middle of the day (${run.seen.night} frames)`);
    expect(nightMedian != null && baseline != null && nightMedian < baseline - 8, `the frame really got darker at night (${baseline} -> ${nightMedian})`);
    expect(flashPeak > (nightMedian ?? 0) + 6, `the lightning lit the frame up (night ${nightMedian} -> flash ${Math.round(flashPeak)})`);
    expect(run.seen.ghost > 0, `Cipher was ghosted (${run.seen.ghost} frames)`);
    expect(run.seen.crate > 0, `the crate effect was on the map (${run.seen.crate} frames)`);
    const ys = any((s) => s.fx.some((e) => e.name === "crate")).map((s) => s.fx.find((e) => e.name === "crate").y);
    expect(new Set(ys).size > 3, `the crate fell through several heights (${new Set(ys).size} distinct y, ${Math.min(...ys)} -> ${Math.max(...ys)})`);
    expect(run.seen.slide > 0, `the crate was then slid along the floor (${run.seen.slide} frames moving=slide)`);
    expect(run.seen.battle > 0, `a real fight started mid-scene (${run.seen.battle} frames in battle)`);
    expect(f.some((s) => s.battle) && f.at(-1)?.battle === false, "the fight was won and the scene went on after it");
    expect(run.seen.chase > 0, `the chase ran (${run.seen.chase} frames)`);
    const chaseLast = f.at(-1)?.chaseLast ?? null;
    expect(chaseLast?.result === 0, `the player kept up with Cipher (${JSON.stringify(chaseLast)})`);
    expect(run.seen.driveDown > 0 && run.seen.driveUp > 0, `the drop and the rise both drove the player (${run.seen.driveDown}/${run.seen.driveUp} frames)`);
    expect(run.seen.fade > 0, `the screen faded (${run.seen.fade} frames over 0.5)`);
    const end = await snap();
    expect(end.map === "s320", `the warp carried the player to the sewers (${end.map})`);
    expect(!end.cut, "the scene ended at the warp");
    expect(sceneArt(end).length === 0, `no effect art was left behind (${sceneArt(end).length} live)`);
    expect(end.sky == null && end.tod == null, `the sky is back to the map's own (${JSON.stringify({ sky: end.sky, tod: end.tod })})`);
    expect(end.ghosts.length === 0, `no ghost was left (${end.ghosts.length})`);
    expect(end.shake?.batch == null, "no shake was left");
    await shot("runA-12-sewers");

    // ---- hand in: meet the goal, come back to Cipher, and see the board the quest leaves -----------------------
    await page.evaluate((id) => window.__quests.lab.finishGoals(id), QID);
    await page.waitForTimeout(300);
    const turnSetup = await standAtCipher({ prepare: false });   // back to the Bridge, quest still taken (the prop is "after: done")
    console.log("  turn-in setup", JSON.stringify(turnSetup));
    expect(["active", "ready"].includes(turnSetup?.status), `the taken quest is still with the player on the way back (${turnSetup?.status})`);
    await page.waitForTimeout(800);
    const beforeDone = await snap();
    const propBefore = beforeDone.props.some((p) => p.sheet === "frame");
    expect(!propBefore, `the board is not on the bridge before the hand-in (${JSON.stringify(beforeDone.props)})`);
    await shot("runA-13-before-turnin");
    await tapEnter();
    const turnin = await playScene(20000, "runA-turnin");
    await page.waitForTimeout(600);
    const done = await page.evaluate((id) => ({
        done: JSON.parse(localStorage.getItem("dw.quests.v1") || "{}").done?.[id] ?? null,
        status: window.__quests.status(id),
        props: window.__questProps.state(),
    }), QID);
    console.log("  after the hand-in", JSON.stringify(done));
    expect(done.done != null && done.status === "done", `the quest is done after the turn-in (${done.status})`);
    expect(turnin.frames.some((s) => s.tb), "the turn-in spoke in the game's own box");
    expect(done.props.some((p) => p.sheet === "frame" && p.x === 936 && p.y === 302), `the board the quest left stands beside Cipher (${JSON.stringify(done.props)})`);
    await page.waitForTimeout(700);
    await shot("runA-14-prop-after-done");

    // The board is quest state, not a scene effect: a scene's own clear must not eat it (the next tick re-places it).
    await page.evaluate(() => { window.__playQuestScene([{ say: null, name: "", text: "A line with no scene of its own." }]); });
    const propScene = await playScene(10000, "propcheck");
    await page.waitForTimeout(500);
    const afterScene = await snap();
    expect(propScene.frames.some((s) => s.cut), "a second (plain) scene really played over the board");
    expect(sceneArt(afterScene).length === 0, `the scene left no effect art (${sceneArt(afterScene).map((e) => e.name)})`);
    expect(afterScene.props.some((p) => p.sheet === "frame"), `the board survived the scene's clear (props: ${afterScene.props.map((p) => p.sheet)})`);
    await shot("runA-15-prop-after-a-scene");

    // ═════════════════ RUN B1: abort while the field is shaking ═════════════════════════════════════════════════════
    console.log("RUN B1: accept again and abort the scene while it is shaking");
    const setupB1 = await standAtCipher();
    expect(setupB1?.npc != null, "Cipher is still on the Bridge for run B1");
    await tapEnter();
    const qB1 = await toQuestion(25000);
    expect(!!qB1?.ch, "run B1 reached the offer's question");
    await tapEnter();                                    // "Run it"
    const runB1 = await playScene(20000, "runB1", {
        stopAt: (s, seen) => seen.shake > 0 && !!s.shake?.batch && (Math.abs(s.shake.offset?.x ?? 0) + Math.abs(s.shake.offset?.y ?? 0) > 0),
    });
    const midB1 = runB1.at ?? await snap();
    console.log("  aborting mid-shake", JSON.stringify({ shake: midB1.shake, cut: midB1.cut }));
    expect(runB1.stopped && !!midB1.shake?.batch, "the scene was still shaking when it was aborted");
    await shot("runB1-01-mid-shake");
    await page.evaluate(() => { window.__cutscene.abort(); });
    await page.waitForTimeout(1200);
    const afterB1 = await snap();
    console.log("  after the abort", JSON.stringify({ cut: afterB1.cut, shake: afterB1.shake, sky: afterB1.sky, fx: sceneArt(afterB1).length }));
    expect(!afterB1.cut, "the scene is over after the abort");
    expect(afterB1.shake?.batch == null, `no shake was left (${JSON.stringify(afterB1.shake?.batch)})`);
    expect(!afterB1.shake?.offset || (afterB1.shake.offset.x === 0 && afterB1.shake.offset.y === 0), `the field is back in place (${JSON.stringify(afterB1.shake?.offset)})`);
    expect(afterB1.sky == null && sceneArt(afterB1).length === 0, "and nothing else of the scene is on the map");
    await shot("runB1-02-after-abort");

    // ═════════════════ RUN B2: abort with the sky, a ghost and the crate all showing ══════════════════════════════
    console.log("RUN B2: accept again, let fog/night/ghost/crate show, then abort the scene");
    const setupB = await standAtCipher();
    expect(setupB?.npc != null, "Cipher is still on the Bridge for run B2");
    await tapEnter();
    const qB = await toQuestion(25000);
    expect(!!qB?.ch, "run B2 reached the offer's question");
    await tapEnter();                                    // "Run it"
    const runB = await playScene(30000, "runB", {
        stopAt: (s, seen) => seen.fog > 0 && seen.night > 0 && seen.ghost > 0 && seen.crate > 0,
    });
    const midB = runB.at ?? await snap();
    console.log("  mid-scene before the abort", JSON.stringify({
        sky: midB.sky, ghosts: midB.ghosts.length, fx: sceneArt(midB).map((e) => e.name), shake: midB.shake?.batch ?? null, tod: midB.tod,
    }));
    expect(runB.stopped, "the scene reached fog + night + ghost + crate before the interruption");
    await shot("runB-01-mid-scene");
    const aborted = await page.evaluate(() => { window.__cutscene.abort(); return true; });
    expect(aborted, "the cutscene was aborted half-way (the dev skip path)");
    await page.waitForTimeout(1500);
    const afterB = await snap();
    console.log("  after the abort", JSON.stringify({
        cut: afterB.cut, tb: afterB.tb, map: afterB.map, sky: afterB.sky, tod: afterB.tod,
        ghosts: afterB.ghosts.length, shake: afterB.shake?.batch ?? null, fx: sceneArt(afterB).map((e) => e.name), props: afterB.props.map((p) => p.sheet),
    }));
    expect(!afterB.cut, "the scene is over after the abort");
    expect(afterB.sky == null, `the weather override is gone (${JSON.stringify(afterB.sky)})`);
    expect(afterB.tod == null, `the map's own day is back (${JSON.stringify(afterB.tod)})`);
    expect(afterB.ghosts.length === 0, `no ghost was left (${afterB.ghosts.length})`);
    expect(afterB.shake?.batch == null, "no shake was left");
    expect(sceneArt(afterB).length === 0, `no effect art was left (${sceneArt(afterB).map((e) => e.name)})`);
    expect(afterB.map === "s205", `the player is still on the Bridge (${afterB.map})`);
    expect(afterB.props.length === 0, "the board is gone because the lab reset this quest for the run (prepare clears its done state)");
    await shot("runB-02-after-abort");

    // ═════════════════ RUN C: F2 -> Extras -> Quests off half-way ═════════════════════════════════════════════════
    console.log("RUN C: switch the quest layer off mid-scene");
    const setupC = await standAtCipher();
    expect(setupC?.npc != null, "Cipher is on the Bridge for run C");
    await tapEnter();
    const qC = await toQuestion(25000);
    expect(!!qC?.ch, "run C reached the offer's question");
    await tapEnter();
    const runC = await playScene(30000, "runC", {
        stopAt: (s, seen) => seen.fog > 0 && seen.night > 0 && seen.ghost > 0 && seen.crate > 0,
    });
    expect(runC.stopped, "run C reached the scene's sky + ghost + art before the switch");
    const beforeC = await snap();
    await shot("runC-01-before-switch");
    await page.evaluate(() => { window.__fx.quests = false; });
    await page.waitForTimeout(900);
    const afterC = await snap();
    console.log("  quests off", JSON.stringify({
        fxBefore: sceneArt(beforeC).length, fxAfter: sceneArt(afterC).length,
        skyBefore: beforeC.sky, skyAfter: afterC.sky, ghosts: afterC.ghosts.length, cut: afterC.cut,
    }));
    expect(sceneArt(beforeC).length > 0, `art was on the map before the switch (${sceneArt(beforeC).length})`);
    expect(sceneArt(afterC).length === 0, `art went with the quest layer (${sceneArt(afterC).length} left)`);
    expect(afterC.sky == null, `the scene's sky went with it (${JSON.stringify(afterC.sky)})`);
    expect(afterC.ghosts.length === 0, `the ghost went with it (${afterC.ghosts.length})`);
    expect(afterC.cut, "the conversation itself is allowed to finish (the switch is not a scene kill)");
    await shot("runC-02-after-switch");
    await page.evaluate(() => { window.__fx.quests = true; });
    await page.evaluate(() => { window.__cutscene.abort(); });
    await page.waitForTimeout(800);
    const afterC2 = await snap();
    expect(!afterC2.cut && afterC2.sky == null && sceneArt(afterC2).length === 0, "and after the scene ends the field is clean");
    await shot("runC-03-clean");

    writeFileSync(`${OUT}/run.json`, JSON.stringify({
        problems,
        runA: { frames: allFrames.length, seen: run.seen, chaseLast, end: { map: end.map, sky: end.sky, fx: sceneArt(end).length } },
        runB1: { seen: runB1.seen, after: { shake: afterB1.shake?.batch ?? null, offset: afterB1.shake?.offset ?? null, sky: afterB1.sky } },
        runB2: { seen: runB.seen, after: { sky: afterB.sky, tod: afterB.tod, ghosts: afterB.ghosts.length, fx: sceneArt(afterB).length } },
        runC: { seen: runC.seen, before: { fx: sceneArt(beforeC).length, sky: beforeC.sky }, after: { fx: sceneArt(afterC).length, sky: afterC.sky } },
        brightness: { day: baseline, night: nightMedian, flash: Math.round(flashPeak) },
    }, null, 1));
} catch (e) {
    console.error("ERROR", e?.stack ?? e);
    problems.push("exception: " + (e?.message ?? e));
    try { await shot("error"); } catch { /* page gone */ }
} finally {
    console.log(problems.length ? `PROBLEMS: ${problems.length}` : "ALL OK");
    for (const p of problems) console.log(" -", p);
    await browser.close();
    process.exit(problems.length ? 1 : 0);
}
