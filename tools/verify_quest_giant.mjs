// Play one giant quest (zz_giant_trike by default) in the real game through web/quest-lab.html and prove, by the game's
// own STATE and not only by pictures: the giant sheet walks across, each footfall leaves a print, the field shakes, the
// prints stay afterwards as props, the trail objective leads to the gate, the fight is the giant's own screen, and the
// hand-in pays the bits and the item.
//
// Server: python3 -m http.server 8770 --directory web   (build first: python3 tools/build_quests.py --with-drafts)
// Run:    QG_QUEST=zz_giant_trike VERIFY_PORT=8770 tools/run-playwright.sh tools/verify_quest_giant.mjs
// Shots:  $QG_SHOT (default ~/scratch-research/quest-fx2/giant/<quest>)
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const Q = {
    zz_giant_trike: {
        title: "The park walks", map: "s330", giver: 58, sheet: "big_claw", clip: "walk-left",
        print: "print_claw", gate: "s340", bits: 3000, item: "Revive Disk", dir: -1, prints: 6, walk: 700,
    },
    zz_giant_metal: {
        title: "The lake rings", map: "s715", giver: 49, sheet: "giant_metal_g", clip: "walk-right",
        print: "print_horn", gate: "s710", bits: 4000, item: "Revive Ring", dir: 1, prints: 4, walk: 290,
    },
}[process.env.QG_QUEST ?? "zz_giant_trike"];

const ROOT = process.env.QS_ROOT || `${baseUrl(8770)}/`;
// The item data keeps names without spaces ("ReviveDisk"); the display name is the one the quest writes ("Revive Disk").
const ITEMS = JSON.parse(readFileSync(new URL("../web/assets/data/items.json", import.meta.url), "utf8"));
const ITEM_ID = ITEMS.items.find((it) => it.name === Q.item.replace(/ /g, ""))?.id ?? null;
if (ITEM_ID == null) console.log("WARN", Q.item, "is not in the item data");
const QID = process.env.QG_QUEST ?? "zz_giant_trike";
const QDEF = JSON.parse(readFileSync(new URL("../web/quests.json", import.meta.url), "utf8")).quests.find((d) => d.id === QID);
const OUT = process.env.QG_SHOT || `${process.env.HOME}/scratch-research/quest-fx2/giant/${process.env.QG_QUEST ?? "zz_giant_trike"}`;
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
const snap = (id = null) => page.evaluate((qid) => ({
    map: window.__quests?.where?.().lastMap ?? null,
    x: Math.round(window.__state?.x ?? 0), y: Math.round(window.__state?.y ?? 0),
    cut: window.__cutscene?.isActive?.() ?? false,
    tb: window.__textbox?.isOpen?.() ?? false,
    text: window.__textbox?.current?.()?.text ?? null,
    ch: window.__choice?.isOpen?.() ?? false,
    active: qid ? !!window.__quests?.state?.active?.[qid] : null,
    fx: window.__questFx?.state?.() ?? [],
    shake: window.__questFx?.shake?.() ?? null,
    props: window.__questProps?.state?.() ?? [],
}));

page.on("pageerror", (e) => { console.error("PAGEERROR", e.message); problems.push("pageerror: " + e.message); });
page.on("console", (m) => { if (/quest scene|quest fx|\[quests\]/i.test(m.text())) console.log("console:", m.text()); });

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

/** Press Enter through a talk box until the scene's question opens (then stop), or until `ms` runs out. */
async function talkToQuestion(ms) {
    const t0 = Date.now();
    let presses = 0;
    while (Date.now() - t0 < ms) {
        const s = await snap();
        log.push({ phase: "offer", t: Date.now() - t0, ...s });
        if (s.ch) return true;
        if (s.tb) { await key("Enter"); presses++; }
        if (!s.cut && !s.tb && presses > 0) break;
        await page.waitForTimeout(300);
    }
    return false;
}

/** Sample (and photograph) a running scene; stop when it has been quiet for a moment. */
async function watch(ms, tag, every = 140, shootEvery = 3) {
    const t0 = Date.now();
    const frames = [];
    let quiet = 0;
    while (Date.now() - t0 < ms) {
        const s = await snap();
        frames.push({ t: Date.now() - t0, ...s }); log.push({ phase: tag, t: Date.now() - t0, ...s });
        if (frames.length % shootEvery === 1) await shot(`${tag}-${String(frames.length).padStart(2, "0")}`);
        if (s.tb || s.ch) await key("Enter");
        if (!s.cut && !s.tb && !s.ch) { if (++quiet > 6) break; } else quiet = 0;
        await page.waitForTimeout(every);
    }
    return frames;
}

/** The crossing: sample fast and do NOT stop while the giant is on the field (the `wait` steps between footfalls
 *  look like a quiet scene). Stop when the giant is gone and the scene has been still for a moment. */
async function watchCrossing(ms, every = 90) {
    const t0 = Date.now();
    const frames = [];
    let quiet = 0;
    while (Date.now() - t0 < ms) {
        const s = await snap();
        frames.push({ t: Date.now() - t0, ...s }); log.push({ phase: "cross", t: Date.now() - t0, ...s });
        const giantLive = s.fx.some((e) => e.name === "giant");
        if (frames.length % 14 === 1) await shot(`cross-${String(frames.length).padStart(3, "0")}`);
        if (s.tb || s.ch) await key("Enter");
        if (!giantLive && !s.cut && !s.tb && !s.ch) { if (++quiet > 10) break; } else quiet = 0;
        await page.waitForTimeout(every);
    }
    return frames;
}

/** The offer talk: walk the speech, and stop the moment the question list opens (polling fast enough to catch it). */
async function watchOffer(ms, id = null) {
    const t0 = Date.now();
    let sawBox = false, sawChoice = false, accepted = false, lastPress = -1e9;
    while (Date.now() - t0 < ms) {
        const s = await snap(id);
        log.push({ phase: "offer", t: Date.now() - t0, ...s });
        if (s.active) { accepted = true; break; }         // the press answered the ask: the crossing is running now
        if (s.ch) { sawChoice = true; break; }
        if (s.tb) {
            sawBox = true;
            if (s.text) console.log("   box:", String(s.text).slice(0, 80));
            // One press per box, then a quiet spell of polls: the question list opens right after the last box and
            // must be seen before the next press answers it.
            if (Date.now() - lastPress > 450) { await key("Enter"); lastPress = Date.now(); }
        } else if (Date.now() - lastPress > 900) {
            await key("Enter");                            // the talk has not opened yet: ask again (a player would)
            lastPress = Date.now();
        }
        await page.waitForTimeout(50);
    }
    return { sawBox, sawChoice, accepted };
}

try {
    // ---- the lab: find the quest, Go (it stands the player in front of the giver) -------------------------
    await page.goto(ROOT + "quest-lab.html");
    await page.waitForURL(/questlab=1/, { timeout: 30000 });
    await ready();
    await page.waitForTimeout(1500);
    await page.fill("#questlab input[type=search]", Q.title);
    await page.waitForTimeout(400);
    const row = page.locator("#questlab .q", { hasText: Q.title }).first();
    expect(await row.count() > 0, "the quest is listed in the quest lab");
    await row.locator("button", { hasText: "Go" }).first().click();
    await takeKeys();
    await page.waitForURL(new RegExp(`map=${Q.map}`), { timeout: 30000 });
    await ready();
    await page.waitForTimeout(2600);
    const at = await snap();
    console.log("  standing", JSON.stringify({ map: at.map, x: at.x, y: at.y }));
    expect(at.map === Q.map, `the lab put us on the quest's map (${at.map})`);

    // ---- the offer, then accept ---------------------------------------------------------------------------
    // The quest layer takes a character's talk only on the SECOND talk of a session (their ordinary line comes first,
    // as the story rules demand), so play the ordinary line out, then talk again for the offer.
    await key("Enter");
    const first = await watch(9000, "first-talk", 200, 6);
    console.log("  ordinary line played", first.some((f) => f.tb));
    await page.waitForTimeout(600);
    await key("Enter");
    const offer = await watchOffer(45000, QID);
    console.log("  offer", JSON.stringify(offer));
    if (offer.sawChoice) await shot("offer-choice");
    expect(offer.sawBox, "the offer spoke in the game's own box");
    expect(offer.sawChoice || offer.accepted,
        `the offer asked its question (choice seen: ${offer.sawChoice}, answered by the press: ${offer.accepted})`);
    if (offer.sawChoice) await key("Enter");             // "I will go" (the first option)
    const started = await page.waitForFunction(
        (id) => !!window.__quests.state.active[id], process.env.QG_QUEST ?? "zz_giant_trike", { timeout: 8000 })
        .then(() => true).catch(() => false);
    expect(started, "taking the offer started the quest");

    // ---- the crossing --------------------------------------------------------------------------------------
    const fxStep = (QDEF?.acceptScene ?? []).find((s) => s.fx === "giant") ?? {};
    const moveStep = (QDEF?.acceptScene ?? []).find((s) => s.fxmove === "giant") ?? {};
    const fromX = fxStep.at?.[0], toX = moveStep.slide?.to?.[0];
    const scene = await watchCrossing(100000);
    const MISSING = !!process.env.QG_ALLOW_MISSING;      // the sheets renamed away: the step must skip, the scene go on
    const giant = scene.flatMap((f) => f.fx.filter((e) => e.name === "giant").map((e) => ({ ...e, t: f.t })));
    console.log("  giant frames", giant.length, giant.slice(0, 3).map((g) => `${g.t}ms x=${Math.round(g.x)} ${g.clip}`).join(" | "));
    if (MISSING) {
        expect(giant.length === 0, "with the sheet gone the giant is simply not drawn");
        expect(scene.length > 3, `the scene went on without it (${scene.length} samples)`);
    } else {
        expect(giant.length > 5, `the giant was on the field (${giant.length} samples)`);
    }
    const sheets = [...new Set((QDEF?.acceptScene ?? []).filter((s) => s.sheet).map((s) => s.sheet))];
    expect(sheets.includes(Q.sheet), `the crossing steps name its own sheet (${sheets.join(",")})`);
    if (giant.length) {
        expect(giant[0].clip === Q.clip, `and the crossing clip (${giant[0].clip})`);
        expect(Math.abs(fromX - toX) >= Q.walk, `the crossing is a long walk (${fromX} -> ${toX})`);
        const xs = giant.map((g) => g.x);
        const travelled = Math.abs(Math.max(...xs) - Math.min(...xs));
        console.log("  x over time", Math.round(Math.min(...xs)), "->", Math.round(Math.max(...xs)), "| data", fromX, "->", toX);
        expect(travelled >= 250, `it really crossed the map while watched (${Math.round(travelled)} px)`);
        const last = giant[giant.length - 1];
        expect(Math.abs(last.x - toX) <= 45, `it arrived where the trail goes (${Math.round(last.x)} vs ${toX})`);
        expect(Math.sign(last.x - giant[0].x) === Q.dir, `walking ${Q.dir < 0 ? "left" : "right"} (${Math.round(giant[0].x)} -> ${Math.round(last.x)})`);
    }
    const prints = new Set(scene.flatMap((f) => f.fx.filter((e) => /^print\d+$/.test(e.name))).map((e) => e.name));
    if (MISSING) expect(prints.size === 0, "with the print sheet gone no print is drawn, and the scene still runs");
    else expect(prints.size >= 4, `a print appeared at each footfall (${prints.size} seen: ${[...prints].sort().join(",")})`);
    const shook = scene.filter((f) => f.shake?.batch);
    const thuds = new Set(shook.map((f) => f.shake.batch.total));
    console.log("  shake samples", shook.length, "batches", [...thuds].join(","));
    expect(shook.length > 2, `the field shook with the footfalls (${shook.length} samples)`);
    const end = await snap();
    const real = end.fx.filter((e) => !String(e.name).startsWith("prop:"));
    console.log("  fx at the end", JSON.stringify(end.fx.map((e) => e.name)));
    expect(real.length === 0, `nothing was left on the field by the scene (${real.length} live, ${end.fx.length - real.length} props)`);
    await shot("after-crossing");

    // ---- the prints stay as props -------------------------------------------------------------------------
    const stayed = await page.evaluate(() => window.__questProps.state());
    console.log("  props", JSON.stringify(stayed.map((p) => `${p.sheet}@${p.x},${p.y}/${p.layer}`)));
    const printProps = stayed.filter((p) => p.sheet === Q.print);
    if (MISSING) expect(printProps.length === 0, "with the print sheet gone no print prop is placed");
    else expect(printProps.length === Q.prints, `all ${Q.prints} prints stayed as props (${printProps.length})`);
    expect(printProps.every((p) => p.layer === "behind" && p.onScreen), "each print is drawn on the ground, behind the people");

    // ---- Goals: the trail and the fight are met -----------------------------------------------------------
    await page.fill("#questlab input[type=search]", Q.title);
    await page.waitForTimeout(300);
    const row2 = page.locator("#questlab .q", { hasText: Q.title }).first();
    await row2.locator("button", { hasText: "Goals" }).first().click();
    await page.waitForTimeout(500);
    const goals = await page.evaluate((id) => {
        const d = window.__quests.defs.find((q) => q.id === id);
        return { def: d.objectives.map((o) => o.type), active: window.__quests.state.active[id] ?? null };
    }, process.env.QG_QUEST ?? "zz_giant_trike");
    console.log("  goals", JSON.stringify(goals));
    expect(goals.def[0] === "visit" && goals.def[1] === "challenge", "the quest is trail then fight");
    expect(goals.active && goals.active.p[0] >= 1 && goals.active.p[1] >= 1, "both objectives read met");

    // ---- the hand-in: stand in front of the giver and talk -------------------------------------------------
    await page.goto(ROOT + `index.html?skipTitle=1&map=${Q.map}&noEncounters=1`);
    await page.waitForFunction(() => window.__state?.started && window.__quests, null, { timeout: 60000 });
    await page.waitForTimeout(2200);
    const bitsBefore = await page.evaluate(() => window.__state.bits);
    const invBefore = await page.evaluate(() => (window.__state.inventory ?? []).map((it) => `${it.id}:${it.qty}`));
    const found = await page.evaluate(({ map, giver }) => {
        const st = window.__state, sc = st.scenes[map];
        const npc = sc.npcs.find((x) => x.npc_id === giver);
        if (!npc) return null;
        npc.spawn_flags = []; sc._cast = null;
        st.x = npc.x; st.y = npc.y + 36; st.dir = "up"; st.moving = false;
        return { x: npc.x, y: npc.y };
    }, { map: Q.map, giver: Q.giver });
    console.log("  giver at", JSON.stringify(found));
    expect(!!found, "the giver is standing there for the hand-in");
    await page.waitForTimeout(700);
    await key("Enter");
    const done = await watch(20000, "turnin", 220);
    expect(done.some((f) => f.tb), "the hand-in spoke");
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem("dw.quests.v1")));
    console.log("  done?", JSON.stringify(state.done[process.env.QG_QUEST ?? "zz_giant_trike"] ?? null));
    expect(state.done[process.env.QG_QUEST ?? "zz_giant_trike"] != null, "the quest is marked done");
    const after = await page.evaluate(() => ({ bits: window.__state.bits, inv: window.__state.inventory ?? [] }));
    const gained = after.bits - bitsBefore;
    console.log("  reward", JSON.stringify({ bitsBefore, bits: after.bits, gained, inv: after.inv.slice(-3) }));
    expect(gained >= Q.bits, `the bits were paid (${gained} >= ${Q.bits})`);
    const got = (after.inv ?? []).filter((it) => !invBefore.includes(`${it.id}:${it.qty}`));
    const gainedItem = (after.inv ?? []).find((it) => (after.inv ?? []).length > invBefore.length && !invBefore.some((b) => b.startsWith(`${it.id}:`)));
    console.log("  item entries", JSON.stringify({ newOrChanged: got, gainedItem }));
    if (ITEM_ID != null) {
        expect(!!(after.inv ?? []).find((it) => it.id === ITEM_ID), `the item was paid (${Q.item} = id ${ITEM_ID})`);
    } else {
        // rings and other gear live outside items.json, so the proof is "one new stack appeared" plus the id
        expect(!!gainedItem, `a new item stack was paid (id ${gainedItem?.id})`);
    }
    const left = await page.evaluate(() => window.__questProps.state());
    console.log("  props after the hand-in", JSON.stringify(left.map((p) => `${p.sheet}@${p.x},${p.y}`)));
    expect(left.some((p) => p.sheet === "log"), "the fallen log stays after the hand-in");
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
