// Play the zz_chase_demo quest (the `chase` scene step) in the real game, and photograph it.
//
// Two runs of the same lap on the Asuka Bridge (s205):
//   A. a small in-page "hands on the d-pad" bot drives the player behind Cipher -> the run is kept (answer 0), the talk
//      step completes and the quest can be handed in;
//   B. the player stands still -> the gap holds over `lose` -> answer 1, the scene stops at once (the words after it never
//      play), the step stays open, and talking again starts the lap again (a lost chase never fails the quest).
//
// Server: python3 -m http.server 8770 --directory web   (build first: python3 tools/build_quests.py --with-drafts)
// Run:    VERIFY_PORT=8770 tools/run-playwright.sh tools/verify_quest_chase.mjs
// Shots:  $QS_SHOT (default ~/scratch-research/quest-fx2/chase)
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.QS_ROOT || `${baseUrl(8770)}/`;
const OUT = process.env.QS_SHOT || `${process.env.HOME}/scratch-research/quest-fx2/chase`;
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
const snap = () => page.evaluate(() => {
    const c = window.__questChase?.() ?? null;
    const dlg = window.__textbox?.dialogue ?? null;
    return {
        map: window.__quests?.where?.().lastMap ?? null,
        x: Math.round(window.__state?.x ?? 0), y: Math.round(window.__state?.y ?? 0),
        cut: window.__cutscene?.isActive?.() ?? false,
        cam: window.__cutscene?.camera ? { x: Math.round(window.__cutscene.camera.x), y: Math.round(window.__cutscene.camera.y), mode: window.__cutscene.camera.mode } : null,
        tb: window.__textbox?.isOpen?.() ?? false,
        ch: window.__choice?.isOpen?.() ?? false,
        chase: c && { x: Math.round(c.x), y: Math.round(c.y), d: Math.round(c.distance), warn: !!c.warn, moving: !!c.moving, over: !!c.over },
        last: window.__state?._questChaseLast ?? null,
        battle: window.__battle?.isActive?.() ?? false,
        text: dlg ? (dlg.pages?.[dlg.pageIdx ?? 0] ?? []).join(" ") : null,
        obj: window.__quests?.state?.active?.zz_chase_demo?.p?.[0] ?? null,
        status: window.__quests?.status?.("zz_chase_demo") ?? null,
        followers: (window.__followers ?? []).filter((f) => !f.parked).map((f) => ({ x: Math.round(f.x), y: Math.round(f.y) })),
    };
});

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

const takeKeys = () => page.evaluate(() => document.activeElement?.blur?.());
/**
 * One confirm press. The real key first; if the box is still up after it (a headless frame clock can swallow a key edge),
 * advance the same box through the API the key calls, so a long scene never stalls the verifier.
 */
const confirm = async () => {
    await takeKeys();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    const open = await page.evaluate(() => window.__textbox?.isOpen?.() ?? false);
    if (open) { await page.evaluate(() => window.__textbox.advance()); await page.waitForTimeout(250); }
};

/** Confirm through talk until `done(snap)` is true (a question open, a chase running, ...), or `ms` runs out. */
async function pressUntil(done, ms, tag) {
    const t0 = Date.now();
    let i = 0;
    while (Date.now() - t0 < ms) {
        const s = await snap();
        log.push({ phase: tag, t: Date.now() - t0, ...s });
        if (done(s)) return s;
        if (s.tb || s.ch) await confirm();
        else { await takeKeys(); await page.keyboard.press("Enter"); await page.waitForTimeout(300); }
        if (++i % 3 === 0) await shot(`${tag}-${String(i).padStart(2, "0")}`);
        await page.waitForTimeout(150);
    }
    return null;
}

/** Sample (and photograph) a running scene; stop when nothing of it is on screen for a moment. */
async function watch(ms, tag, every = 180) {
    const t0 = Date.now();
    const frames = [];
    let quiet = 0;
    while (Date.now() - t0 < ms) {
        const s = await snap();
        frames.push({ t: Date.now() - t0, ...s }); log.push({ phase: tag, t: Date.now() - t0, ...s });
        if (frames.length % 2 === 1) await shot(`${tag}-${String(frames.length).padStart(2, "0")}`);
        if (s.tb || s.ch) await confirm();
        if (!s.cut && !s.tb && !s.ch) { if (++quiet > 6) break; } else quiet = 0;
        await page.waitForTimeout(every);
    }
    return frames;
}

/** Load the Bridge with Cipher present, prepare the quest, and stand in front of him (what the quest lab's Go does). */
async function standAtCipher() {
    await page.goto(ROOT + "index.html?skipTitle=1&map=s205&noEncounters=1");
    await page.waitForFunction(() => window.__state?.started && window.__quests?.defs?.length, null, { timeout: 60000 });
    await page.waitForTimeout(2200);
    const setup = await page.evaluate(() => {
        const prep = window.__quests.lab.prepare("zz_chase_demo");
        const st = window.__state, sc = st.scenes.s205;
        const npc = sc.npcs.find((x) => x.npc_id === 1005);
        if (npc) { npc.spawn_flags = []; sc._cast = null; }
        if (!npc) return { prep, npc: null };
        st.x = npc.x; st.y = npc.y + 36; st.dir = "up"; st.moving = false;
        return { prep, npc: { x: npc.x, y: npc.y } };
    });
    await page.waitForTimeout(600);
    return setup;
}

/** Take the offer (talk until the question, answer "Run it"). */
async function acceptQuest() {
    const offer = await pressUntil((s) => s.ch, 25000, "offer");
    expect(!!offer, "the offer reached its question");
    await shot("offer-choice");
    await confirm();
    await page.waitForTimeout(700);
    const st = await page.evaluate(() => ({ active: !!window.__quests.state.active.zz_chase_demo, status: window.__quests.status("zz_chase_demo") }));
    expect(st.active, `answering "Run it" took the quest (${JSON.stringify(st)})`);
}

/** Drive the player behind the chase target through the game's own d-pad state, once per animation frame. */
const startBot = () => page.evaluate(() => {
    const bot = (window.__bot = { on: true, samples: [] });
    const tick = () => {
        if (!bot.on) return;
        const c = window.__questChase?.();
        const st = window.__state;
        const k = st.keys;
        if (!c) { for (const b of ["left", "right", "up", "down"]) k.delete(b); bot.done = true; return; }
        const dx = c.x - st.x, dy = c.y - st.y, d = Math.hypot(dx, dy);
        const go = d > 48;
        const set = (b, on) => (on ? k.add(b) : k.delete(b));
        set("right", go && dx > 12); set("left", go && dx < -12);
        set("down", go && dy > 12); set("up", go && dy < -12);
        bot.samples.push({ d: Math.round(d), warn: !!c.warn, px: Math.round(st.x), py: Math.round(st.y), tx: Math.round(c.x), ty: Math.round(c.y) });
    };
    const loop = () => { if (!bot.on) return; tick(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
});
const stopBot = () => page.evaluate(() => {
    const bot = window.__bot;
    if (!bot) return null;
    bot.on = false;
    for (const b of ["left", "right", "up", "down"]) window.__state.keys.delete(b);
    return { samples: bot.samples, done: !!bot.done };
});
const chaseOver = () => page.waitForFunction(() => !window.__questChase?.(), null, { timeout: 40000 });

try {
    // ======================= A. kept up =======================
    const setup = await standAtCipher();
    console.log("  setup", JSON.stringify(setup));
    expect(setup?.npc?.x === 896 && setup?.npc?.y === 296, "Cipher is on the Bridge at his post");
    await acceptQuest();

    // The quest's one objective is the lap itself: talk again and the scene begins with the chase in it.
    const started = await pressUntil((s) => !!s.chase, 25000, "start");
    console.log("  chase begins", JSON.stringify(started?.chase));
    expect(!!started?.chase, "the chase step started (the machine is running)");
    expect(!!started?.cut, "the scene is still the active cutscene around the run");
    await shot("chase-begin");

    await startBot();
    const runFrames = [];
    let battleSeen = false, camFollowed = 0;
    for (let i = 0; i < 120; i++) {                      // up to ~24 s of real play
        const s = await snap();
        runFrames.push(s); log.push({ phase: "run", t: i, ...s });
        if (i % 4 === 0) await shot(`chase-${String(i / 4 | 0).padStart(2, "0")}`);
        if (s.battle) battleSeen = true;
        if (s.cam && Math.abs(s.cam.x - s.x) < 260 && Math.abs(s.cam.y - s.y) < 200) camFollowed++;
        if (!s.chase) break;
        await page.waitForTimeout(200);
    }
    const bot = await stopBot();
    const last = (await snap()).last;
    const samples = bot?.samples ?? [];
    const dmin = Math.min(...samples.map((s) => s.d));
    const warnFrames = samples.filter((s) => s.warn).length;
    console.log("  chase over", JSON.stringify(last), "bot samples", samples.length, "closest", dmin, "warn frames", warnFrames);
    expect(!battleSeen, "no battle interrupted the chase");
    expect(last?.result === 0, `staying with him is answer 0 (${JSON.stringify(last)})`);
    expect(samples.length > 20, `the bot really walked the lap with him (${samples.length} samples)`);
    expect(dmin < 90, `the player stayed close (closest gap ${dmin} px of the 96 px allowance)`);
    expect(camFollowed > 3, `the camera stayed on the player while he ran (${camFollowed} samples)`);

    // The words after a kept-up lap play, then the talk step completes.
    const tail = await watch(20000, "tail", 220);
    expect(tail.some((f) => f.tb), "the scene went on with Cipher's line after the run");
    const afterRun = await page.evaluate(() => ({ p: window.__quests.state.active.zz_chase_demo?.p ?? null, status: window.__quests.status("zz_chase_demo") }));
    console.log("  objective after the run", JSON.stringify(afterRun));
    expect(afterRun.p?.[0] === 1, "the talk step completed on a kept-up lap");
    await shot("after-run");

    // Hand in.
    await pressUntil((s) => !!s.tb || !!s.ch, 10000, "turnin-start");
    await watch(15000, "turnin", 250);
    const done = await page.evaluate(() => JSON.parse(localStorage.getItem("dw.quests.v1")).done.zz_chase_demo ?? null);
    expect(done != null, "the quest is done after the turn-in");
    await shot("turnin-end");

    // ======================= B. lost, then retried =======================
    await standAtCipher();
    await acceptQuest();
    const lostStart = await pressUntil((s) => !!s.chase, 25000, "lost-start");
    expect(!!lostStart?.chase, "the lap started for the loss run");
    await shot("lost-begin");
    // stand still: the target runs off and the gap holds over `lose`
    const lostFrames = [];
    for (let i = 0; i < 60; i++) {                       // up to ~12 s
        const s = await snap();
        lostFrames.push(s); log.push({ phase: "lost", t: i, ...s });
        if (i === 2) await shot("lost-warning");
        if (!s.chase) break;
        await page.waitForTimeout(200);
    }
    const lostWarn = lostFrames.some((f) => f.chase?.warn);
    const lostLast = (await snap()).last;
    console.log("  lost run", JSON.stringify(lostLast), "warning seen", lostWarn);
    expect(lostWarn, "the target blinked a warning before the run was lost");
    expect(lostLast?.result === 1, `standing still loses it (answer 1: ${JSON.stringify(lostLast)})`);
    // The scene must stop AT the loss: no "you kept up" line, no cutscene, and the step stays open.
    await page.waitForTimeout(800);
    const afterLoss = await snap();
    console.log("  after the loss", JSON.stringify({ cut: afterLoss.cut, obj: afterLoss.obj, status: afterLoss.status, text: afterLoss.text }));
    expect(!afterLoss.cut, "a lost chase ends the scene at once (no cutscene left running)");
    expect(afterLoss.obj === 0, "the talk step stayed open (nothing was completed by a loss)");
    expect(afterLoss.status === "active", `the quest is still active (${afterLoss.status})`);
    expect(!/kept up/i.test(afterLoss.text ?? ""), `the words after the run did not play (${JSON.stringify(afterLoss.text)})`);
    await shot("after-loss");

    // Retry: the same talk runs the lap again.
    const again = await pressUntil((s) => !!s.chase, 25000, "retry");
    expect(!!again?.chase, "talking to Cipher again starts the lap again (a lost chase is retryable)");
    await shot("retry-begin");
    // Let this one go too, and check nothing is left behind afterwards.
    await chaseOver();
    await page.waitForTimeout(1500);
    const end = await snap();
    console.log("  end", JSON.stringify({ map: end.map, cut: end.cut, tb: end.tb, chase: end.chase, last: end.last, obj: end.obj, status: end.status }));
    expect(!end.cut, "nothing is running after the second loss");
    expect(end.status === "active", `the quest is still there to retake (${end.status})`);
    await shot("end");

    // ======================= C. an effect as the target =======================
    // The step also takes an fx by name: place our own sheet in a scene, then chase it. Driven directly through the host
    // hook so the step's fx branch is exercised without a second quest. (The retry line of the run above is still up:
    // a scene cannot start over a box, so close it first.)
    for (let i = 0; i < 8 && (await snap()).tb; i++) await confirm();
    await page.waitForTimeout(500);
    await page.evaluate(() => {
        const st = window.__state;
        const x = Math.round(st.x), y = Math.round(st.y);
        window.__fxProbe = window.__playQuestScene([
            { fx: "probe", sheet: "crate", at: [x, y - 6] },
            { chase: "probe", path: [[x - 60, y - 30], [x - 180, y - 30], [x - 180, y + 40]], speed: 100, lose: 130, frames: 600 },
            { say: "player", name: "Junior", text: "It rolled away." },
        ]);
    });
    const fxOn = await page.waitForFunction(() => !!window.__questChase?.(), null, { timeout: 20000 }).then(() => true).catch(() => false);
    expect(fxOn, "an effect (an fx by name) can be the chase target");
    const fxBegin = await snap();
    console.log("  fx chase begins", JSON.stringify(fxBegin.chase));
    expect(fxBegin.chase?.x !== undefined, "the fx target is being moved by the machine");
    await shot("fx-begin");
    await startBot();
    for (let i = 0; i < 80; i++) {
        const s = await snap();
        log.push({ phase: "fx-run", t: i, ...s });
        if (i % 6 === 0) await shot(`fx-chase-${String(i).padStart(2, "0")}`);
        if (!s.chase) break;
        await page.waitForTimeout(200);
    }
    const fxBot = await stopBot();
    const fxLast = (await snap()).last;
    console.log("  fx chase over", JSON.stringify(fxLast), "samples", fxBot?.samples?.length ?? 0);
    expect(fxLast?.result === 0, `keeping up with the effect is answer 0 (${JSON.stringify(fxLast)})`);
    expect(fxLast?.target === "probe", `the answer names the effect as the target (${JSON.stringify(fxLast?.target)})`);
    await watch(8000, "fx-tail", 240);      // the line after it, then the scene's own cleanup

    // ======================= D. the scene dying under a chase =======================
    // A stage entry, a warp or the title screen ends the cutscene without the step's own exit path: the chase must not
    // survive it (no cutscene, no chase, the target back in its idle pose).
    await page.evaluate(() => { window.__playQuestScene([{ chase: 1005, path: [[830, 300], [760, 300]], speed: 90, lose: 400, frames: 600 }]); });
    const orphanOn = await page.waitForFunction(() => !!window.__questChase?.(), null, { timeout: 15000 }).then(() => true).catch(() => false);
    expect(orphanOn, "a chase can start on its own for the orphan check");
    await page.evaluate(() => window.__cutscene.abort());       // exactly what a stage entry / title screen does
    const cleaned = await page.waitForFunction(() => !window.__questChase?.(), null, { timeout: 5000 }).then(() => true).catch(() => false);
    const orphan = await page.evaluate(() => {
        const npc = window.__state.scenes.s205.npcs.find((n) => n.npc_id === 1005);
        return { chase: window.__state._questChase, target: window.__state._questChaseTarget, chasing: !!npc?._chasing, keys: [...window.__state.keys] };
    });
    console.log("  orphan chase cleanup", JSON.stringify(orphan));
    expect(cleaned, "a chase whose scene ends under it is cleared (no chase left running)");
    expect(!orphan.chase && orphan.target === null, "state._questChase is back to false and the target forgotten");
    expect(!orphan.chasing, "the target is back in its idle pose");
    expect(orphan.keys.length === 0, `no held movement key is left behind (${JSON.stringify(orphan.keys)})`);

    // ======================= E. the quest layer switched off mid-run =======================
    // F2 -> Extras -> Quests going OFF while the run is live: the layer's own clear must end the step, not leave the field
    // locked on a cutscene that waits for an answer nobody will send.
    await page.evaluate(() => { window.__playQuestScene([{ chase: 1005, path: [[830, 300], [700, 300], [640, 380]], speed: 90, lose: 400, frames: 900 }]); });
    const offOn = await page.waitForFunction(() => !!window.__questChase?.(), null, { timeout: 15000 }).then(() => true).catch(() => false);
    expect(offOn, "the chase started for the switch-off check");
    await page.evaluate(() => { window.__fx.quests = false; });
    const offCleared = await page.waitForFunction(() => !window.__questChase?.() && !window.__cutscene.isActive(), null, { timeout: 6000 }).then(() => true).catch(() => false);
    const offState = await page.evaluate(() => {
        const npc = window.__state.scenes.s205.npcs.find((n) => n.npc_id === 1005);
        return { chase: window.__state._questChase, chasing: !!npc?._chasing, fx: window.__fx.quests };
    });
    console.log("  quests off mid-run", JSON.stringify(offState));
    expect(offCleared, "switching the quest layer off mid-run ends the step and the scene (no locked field)");
    expect(!offState.chase && !offState.chasing, "the chase and the target's walk pose are gone");
    await page.evaluate(() => { window.__fx.quests = true; });
    await page.waitForTimeout(400);
    await shot("quests-off-mid-run");

    // ======================= F. a chase that cannot run never blocks =======================
    // An unknown character: the scene cannot be cast, so the host skips it rather than blocking on it.
    const noCast = await page.evaluate(async () => {
        const r = await window.__playQuestScene([{ chase: 9999, path: [[800, 300]] }, { say: "player", name: "Junior", text: "Nobody here." }]);
        return { r, cut: window.__cutscene.isActive() };
    });
    console.log("  chase with an absent character", JSON.stringify(noCast));
    expect(noCast.r === null, "a chase naming a character who is not on the map makes the scene skip (null), never hang");
    // An unknown effect name: the step is skipped inside the scene and the scene goes on to its end.
    const noFx = await page.evaluate(async () => {
        const r = await window.__playQuestScene([{ chase: "no-such-fx", path: [[800, 300]], speed: 100 }]);
        return { r, chase: !!window.__questChase?.(), cut: window.__cutscene.isActive() };
    });
    console.log("  chase with a missing effect", JSON.stringify(noFx));
    expect(noFx.chase === false && noFx.cut === false, "a chase naming an effect that is not there is skipped, the scene still ends");
    await shot("skip-checks");
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
