// F2 -> Extras -> "Practice 2 vs 2" (a test, off by default): on one computer, not in a room, a wild fight from the
// overworld becomes the many-vs-many co-op fight (web/mpbattle.js) with me and a computer-played partner against two
// wild Digimon. The real game, headless, by numbers only (no screenshots):
//   1. setting off: the same field trigger starts the game's own one-on-one battle (nothing changed);
//   2. setting on: the trigger starts the 2 vs 2 fight: 2 players + 2 foes in the shared state, all four models in the
//      3D arena, the wide multi camera on; the partner takes its turns by itself; I play mine with the pad buttons
//      until the fight is over; the game's post-battle screen comes up; the partner's records are not saved;
//   3. HD Remaster + F2 -> Screen -> "Battle camera a little further out": the multi shot's eye-to-target distance is
//      1.25x with the setting on (flipped frame by frame).
//
//   VERIFY_PORT=8090 tools/run-playwright.sh tools/verify_practice_2v2.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const MAP = process.env.MAP || "s330";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(fx, viewport = { width: 1600, height: 900 }) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (/\[mpbattle\]/.test(m.text())) errors.push(m.text()); });
    await page.addInitScript((fx) => {
        localStorage.setItem("assetMode", "hd");
        localStorage.setItem("engineSchema", "2");
        localStorage.setItem("playerName", "Tester");
        localStorage.setItem("charId", "p003pken");
        const lead = { digimonId: 1, level: 20, xp: 0, tp: 10, hp: 900, maxHp: 900, mp: 300, maxMp: 300,
            stats: { str: 99, def: 99, spt: 99, wis: 99, spd: 99, chr: 99 }, bonuses: {}, elemBonuses: {} };
        const second = { digimonId: 4, level: 15, xp: 0, tp: 10, hp: 700, maxHp: 700, mp: 200, maxMp: 200,
            stats: { str: 80, def: 80, spt: 80, wis: 80, spd: 80, chr: 80 }, bonuses: {}, elemBonuses: {} };
        localStorage.setItem("party", JSON.stringify(["p003pken", "p006agum"]));
        localStorage.setItem("partnerStats", JSON.stringify(lead)); localStorage.setItem("partyStats", JSON.stringify([lead, second]));
        localStorage.setItem("equipment", JSON.stringify([{}, {}])); localStorage.setItem("rosterOwned", "1");
        localStorage.setItem("dw.fx.v1", JSON.stringify(fx));
    }, fx);
    await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1&map=${MAP}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__state?.started && window.__mpb && window.__battle, null, { timeout: 60000 });
    await sleep(1500);
    return { context, page, errors };
}

// 1. setting off: the field trigger is the game's own one-on-one battle
{
    const { context, page, errors } = await boot({ practice2v2: false });
    await page.evaluate(() => window.__fieldToBattle());
    await page.waitForFunction(() => window.__battle.isActive() || !!window.__mpb.fight, null, { timeout: 20000 });
    const r = await page.evaluate(() => ({ battle: window.__battle.isActive(), mpb: !!window.__mpb.fight }));
    console.log("off:", JSON.stringify(r));
    assert.equal(r.mpb, false, "no 2 vs 2 with the setting off");
    assert.equal(r.battle, true, "the one-on-one battle");
    assert.deepEqual(errors, []);
    await context.close();
}

// 2 + 3. setting on
{
    const { context, page, errors } = await boot({ practice2v2: true, battlewide: true }, { width: 2000, height: 720 });
    await page.keyboard.press("f");                                  // window fill, the user's setup
    await page.waitForFunction(() => document.documentElement.classList.contains("window-fill"));
    const savedBefore = await page.evaluate(() => localStorage.getItem("partyStats"));
    await page.evaluate(() => window.__fieldToBattle());
    await page.waitForFunction(() => window.__mpb.fight?.S?.E?.length > 0, null, { timeout: 30000 });
    const view = await page.evaluate(() => { const f = window.__mpb.fight; return { players: f.S.P.map((p) => [p.id, p.pn, p.n]), foes: f.S.E.map((e) => e.n), oneOnOne: window.__battle.isActive() }; });
    console.log("on:", JSON.stringify(view));
    assert.equal(view.players.length, 2, "two players");
    assert.equal(view.foes.length, 2, "two foes");
    assert.equal(view.oneOnOne, false, "not the one-on-one battle");
    assert.ok(view.players.some((p) => p[0] === -1 && p[1] === "Partner"), "the computer partner");
    await page.waitForFunction(() => { const f = window.__mpb.fight; return f?.r3d && f.S && [...f.S.P.map((p) => "p" + p.id), ...f.S.E.map((e) => "e" + e.i)].every((k) => f.r3d.getFighterScreen(k)); }, null, { timeout: 40000 });
    console.log("all four in the 3D arena");
    await sleep(2500);

    // the fight canvas fills the window (window fill on a wide window), not just its first width
    const fill = await page.evaluate(() => { const U = document.getElementById("mpb"), v = U.querySelector("canvas.view"); return { root: [U.clientWidth, U.clientHeight], view: [v.clientWidth, v.clientHeight], backing: [v.width, v.height] }; });
    console.log("fill:", JSON.stringify(fill));
    assert.ok(Math.abs(fill.view[0] - fill.root[0]) <= 1 && Math.abs(fill.view[1] - fill.root[1]) <= 1, "the scene canvas fills the fight screen");
    assert.ok(Math.abs(fill.backing[0] - fill.root[0]) <= 1, "and renders at that width");

    // the line-up: no two fighters of one side overlap (their posed boxes, render units), the line is slanted, the arena is larger
    const lay = await page.evaluate(() => window.__mpb.fight.r3d.getMultiLayout());
    console.log("layout: arenaScale", lay.arenaScale.toFixed(3), JSON.stringify(lay.fighters.map((f) => ({ id: f.id, dx: Math.round(f.dx), dz: Math.round(f.dz), w: Math.round(f.restW), x: f.aabb && [Math.round(f.aabb.min[0]), Math.round(f.aabb.max[0])] }))));
    for (const side of ["player", "enemy"]) {
        const fs = lay.fighters.filter((f) => f.side === side && f.aabb).sort((a, b) => a.aabb.min[0] - b.aabb.min[0]);
        assert.equal(fs.length, 2, side + " two fighters");
        const clear = fs[1].aabb.min[0] - fs[0].aabb.max[0];
        console.log(side, "clearance between the two boxes (render units):", clear.toFixed(1));
        assert.ok(clear > 0, side + " boxes do not overlap");
        assert.ok(Math.abs(fs[0].dz - fs[1].dz) > 0, side + " slanted");
    }
    assert.ok(lay.arenaScale > 1.2, "the arena is drawn larger");

    // 3. the multi shot, wider by 1.25 with the setting on (frame by frame, same page)
    const rows = await page.evaluate(async () => {
        const r = window.__mpb.fight.r3d;
        const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        const read = () => { const c = r.getCameraInfo(); return { d: Math.hypot(c.eye[0] - c.look[0], c.eye[1] - c.look[1], c.eye[2] - c.look[2]), mode: r.getCameraMode() }; };
        const out = [];
        for (let i = 0; i < 6; i++) {
            window.__fx.battlewide = false; await frame(); const a = read();
            window.__fx.battlewide = true; await frame(); const b = read();
            window.__fx.battlewide = false; await frame(); const c = read();
            out.push({ a, b, c });
            await new Promise((res) => setTimeout(res, 400));
        }
        window.__fx.battlewide = true;
        return out;
    });
    let compared = 0;
    for (const { a, b, c } of rows) {
        const base = (a.d + c.d) / 2, ratio = b.d / base, drift = Math.abs(a.d - c.d) / base;
        console.log("multi shot", b.mode, "ratio", ratio.toFixed(4), "drift", drift.toFixed(4));
        if (drift > 0.01) continue;
        compared++;
        assert.ok(Math.abs(ratio - 1.25) < 0.01, `multi ratio ${ratio}`);
    }
    assert.ok(compared >= 2, "at least two steady frames compared");

    // play: the partner acts by itself; I press circle on my command list and on the target
    const seenBot = new Set(), seenMe = new Set();
    for (let i = 0; i < 600; i++) {
        const s = await page.evaluate(() => {
            const f = window.__mpb.fight;
            if (!f) return { over: true, report: !!window.__reportNative?.isOpen?.() };
            const S = f.S;
            return { over: false, t: S?.t ?? null, ph: S?.ph, mine: S?.t === "p1" && f.nat?.mode === "cmd" && f.nat.diagnostics().widgets.cmd.active,
                target: f.cmd?.stage === "target", g: S?.g ?? [] };
        });
        if (s.over) break;
        if (s.t === "p-1") seenBot.add(s.g.at(-1));
        if (s.mine) { await page.evaluate(() => window.__mpb.key("circle")); seenMe.add(i); await sleep(300); continue; }
        if (s.target) { await page.evaluate(() => window.__mpb.key("circle")); await sleep(300); continue; }
        await page.evaluate(() => { for (const e of window.__mpb.fight?.H?.arena?.E ?? []) e.rec.hp = Math.min(e.rec.hp, 30); });   // keep it short
        await sleep(250);
    }
    const log = await page.evaluate(() => [...(window.__mpb.fight?.H?.log ?? [])]);
    console.log("bot turns seen:", seenBot.size, "my turns:", seenMe.size, log.join(" | "));
    assert.ok(seenBot.size >= 1, "the partner took a turn by itself");
    assert.ok(seenMe.size >= 1, "I took a turn with the pad");
    // the last hit and the victory pose play first (about 3 s), then the game's own post-battle screen
    const report = await page.waitForFunction(() => !window.__mpb.fight && window.__reportNative?.isOpen?.() === true, null, { timeout: 30000 }).then(() => true, () => false);
    console.log("post-battle screen:", report);
    assert.ok(report, "the game's own post-battle screen");
    for (let i = 0; i < 60 && (await page.evaluate(() => window.__reportNative.isOpen())); i++) { await page.keyboard.press("Enter"); await sleep(600); }
    await sleep(800);
    const after = await page.evaluate(() => ({ party: JSON.parse(localStorage.getItem("partyStats")).length, shown: document.getElementById("mpb").style.display, xp: window.__state.partnerStats.xp }));
    console.log("after:", JSON.stringify(after), "before party", JSON.parse(savedBefore).length);
    assert.equal(after.party, JSON.parse(savedBefore).length, "the partner's copy was not added to my party");
    assert.equal(after.shown, "none", "the fight screen is closed");
    assert.ok(after.xp > 0, "my Digimon got the win's EXP");
    assert.deepEqual(errors, []);
    await context.close();
}

await browser.close();
console.log("verify_practice_2v2: OK");
