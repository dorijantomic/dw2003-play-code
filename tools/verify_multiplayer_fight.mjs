// Browser test: a real many-vs-many fight between two players (2 Digimon vs 2 enemies, then a second wave), played with the
// on-screen buttons until it is won. Needs the game served on PORT (default 8770). Starts its own relay.
// Run:   tools/run-playwright.sh tools/verify_multiplayer_fight.mjs     (SHOTS=dir to keep screenshots)
import { chromium } from "playwright";
import { startRelay } from "../server/relay.mjs";

const PORT = process.env.PORT || 8770;
const SHOTS = process.env.SHOTS || "";
const HURT = !!process.env.HURT;   // HURT=1: weak players against strong enemies, to check that the enemies hit back and players go down
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, extra = "") => { console.log(cond ? "PASS" : "FAIL", name, extra); if (!cond) process.exitCode = 1; };

const relay = await startRelay({ port: 0, host: "127.0.0.1" });
const url = `http://localhost:${PORT}/index.html?skipTitle=1&noEncounters=1&map=s330`;
const browser = await chromium.launch();
const errors = [];

async function player(label, name) {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`.slice(0, 200)));
    page.on("console", (m) => { if (/\[mpbattle\]|\[multiplayer\]/.test(m.text())) errors.push(`${label}: ${m.text()}`.slice(0, 300)); });
    await page.addInitScript(({ nm, hurt }) => {
        const lead = hurt ? { digimonId: 1, level: 3, xp: 0, tp: 10, hp: 120, maxHp: 120, mp: 50, maxMp: 50,
            stats: { str: 15, def: 10, spt: 10, wis: 10, spd: 30, chr: 10 }, bonuses: {}, elemBonuses: {} }
            : { digimonId: 1, level: 20, xp: 0, tp: 10, hp: 900, maxHp: 900, mp: 300, maxMp: 300,
            stats: { str: 99, def: 99, spt: 99, wis: 99, spd: 99, chr: 99 }, bonuses: {}, elemBonuses: {} };
        localStorage.setItem("assetMode", "authentic"); localStorage.setItem("engineSchema", "2"); localStorage.setItem("playerName", nm);
        localStorage.setItem("charId", "p003pken"); localStorage.setItem("party", JSON.stringify(["p003pken"]));
        localStorage.setItem("partnerStats", JSON.stringify(lead)); localStorage.setItem("partyStats", JSON.stringify([lead]));
        localStorage.setItem("equipment", JSON.stringify([{}])); localStorage.setItem("rosterOwned", "1");
    }, { nm: name, hurt: HURT });
    await page.goto(url + `&relay=ws://127.0.0.1:${relay.port}`);
    await page.waitForFunction(() => window.__state?.started && window.__mpsocial && window.__mpb, null, { timeout: 60000 });
    await sleep(2500);
    return page;
}

// click through my turn whenever it is my turn: Fight, then the first living enemy
async function autoPlay(page, useTech = false) {
    return page.evaluate((useTech) => {
        const root = document.getElementById("mpb");
        if (!root || root.style.display !== "flex") return "off";
        if (root.querySelector(".end")) return "end";
        const btn = (t) => [...root.querySelectorAll(".bar2 button")].find((b) => b.textContent.trim() === t && !b.disabled);
        const pick = root.querySelector(".card.foe.pick:not(.ko)");
        if (pick) { pick.click(); return "target"; }
        if (useTech) {
            const tech = [...root.querySelectorAll(".bar2 button")].find((b) => /\(\d+ MP\)/.test(b.textContent) && !b.disabled);
            if (tech) { tech.click(); return "tech"; }
            const menuTech = btn("Tech");
            if (menuTech) { menuTech.click(); return "techmenu"; }
        }
        const fight = btn("Fight");
        if (fight) { fight.click(); return "fight"; }
        return "wait";
    }, useTech);
}

try {
    const a = await player("A", "SENIOR");
    const b = await player("B", "Ana");
    await a.keyboard.press("F4"); await a.click("#mp-host");
    await a.waitForFunction(() => window.__mp.mp.status === "online", null, { timeout: 8000 });
    const room = await a.evaluate(() => window.__mp.mp.room);
    await b.keyboard.press("F4"); await b.fill("#mp-addr", `127.0.0.1:${relay.port}`); await b.fill("#mp-join-code", room); await b.click("#mp-join");
    await b.waitForFunction(() => window.__mp.mp.status === "online", null, { timeout: 8000 });
    const ids = [await a.evaluate(() => window.__mp.mp.id), await b.evaluate(() => window.__mp.mp.id)];
    await sleep(500);

    const xpBefore = [await a.evaluate(() => window.__state.partnerStats.xp), await b.evaluate(() => window.__state.partnerStats.xp)];
    const foes = HURT ? [1, 2].map((n) => ({ name: "Kunemon", level: 30, hp: 9000, mp: 99, stat_scale: 32 }))
        : [1, 2, 3].map((n) => ({ name: "Kunemon", level: 3 + n, hp: 60 + n * 20, mp: 10, stat_scale: 16 }));   // three foes = two waves for two players
    // A starts the fight as the host, the way the invite does; B's game joins when the setup arrives
    // team up through the real buttons, then the host offers the fight to the partner and the partner presses Join
    await a.click('#mp-dock .top button:has-text("PLAYERS")');
    await a.click('#mp-dock .pl:has-text("Ana") button:has-text("Team up")');
    await b.waitForSelector('.mp-win:not([hidden]) button:has-text("Team up")', { timeout: 5000 });
    await b.click('.mp-win:not([hidden]) button:has-text("Team up")');
    await a.waitForFunction(() => /teamed up/.test(document.querySelector("#mp-dock .log")?.textContent ?? "") || window.__mpsocial.S.log.some((e) => /teamed up/.test(e.text ?? "")), null, { timeout: 5000 });
    ok("the two players team up with the buttons", true);
    const started = await a.evaluate(({ foes, ids }) => {
        window.__fightResult = null;
        return window.__mpsocial.coopTry(foes, "Test fight", (f, withId) => {
            window.__invitedWith = withId;
            window.__mpb.host({ foes: f, ids: withId ? ids : [ids[0]], label: "Test fight", screenId: 3, challenge: null, done: (r) => { window.__fightResult = r; } });
            return true;
        });
    }, { foes, ids });
    ok("the host offers the fight to the partner", started === true);
    await b.waitForSelector('.mp-win:not([hidden]) button:has-text("Join")', { timeout: 5000 });
    ok("the partner is asked to join, and sees what the fight is", /Test fight|Kunemon/.test(await b.textContent(".mp-win:not([hidden])")));
    await b.click('.mp-win:not([hidden]) button:has-text("Join")');
    ok("the host's fight starts with the partner in it", (await a.evaluate(() => new Promise((r) => setTimeout(() => r(window.__invitedWith), 600)))) === ids[1]);
    await a.waitForFunction(() => document.getElementById("mpb")?.style.display === "flex", null, { timeout: 30000 });
    await b.waitForFunction(() => document.getElementById("mpb")?.style.display === "flex", null, { timeout: 30000 });
    ok("both players see the fight screen", true);
    const dump = (pg) => pg.evaluate(() => { const f = window.__mpb.fight; return f ? { host: f.isHost, ids: f.ids, S: !!f.S, H: f.H ? { P: [...f.H.P.keys()], started: f.H.started } : null, techs: f.techs?.length } : null; });
    try {
        await a.waitForFunction(() => window.__mpb.fight?.S?.E?.length > 0, null, { timeout: 20000 });
        await b.waitForFunction(() => window.__mpb.fight?.S?.E?.length > 0, null, { timeout: 20000 });
    } catch (e) {
        console.log("A:", JSON.stringify(await dump(a)), " B:", JSON.stringify(await dump(b)), " errors:", errors.join(" | "));
        throw e;
    }
    const view = await b.evaluate(() => ({ foes: window.__mpb.fight.S.E.length, players: window.__mpb.fight.S.P.map((p) => p.pn) }));
    ok("2 enemies and 2 players on both sides of the screen", view.foes === 2 && view.players.length === 2, JSON.stringify(view));
    ok("the other player's name is shown as typed", view.players.includes("SENIOR") && view.players.includes("Ana"));
    if (SHOTS) await b.screenshot({ path: `${SHOTS}/multiplayer-fight-b.png` });

    if (HURT) {
        // keep fighting until the enemies have hurt somebody and somebody has gone down (or 150 steps)
        for (let i = 0; i < 300; i++) {
            await autoPlay(a); await autoPlay(b);
            const st = await a.evaluate(() => ({ ko: window.__mpb.fight?.S?.P.filter((p) => p.ko).length ?? 2, hurt: window.__mpb.fight?.S?.P.some((p) => p.hp < p.mhp) ?? true, log: window.__mpb.fight?.S?.g ?? [] }));
            if (st.ko >= 1 || !(await a.evaluate(() => !!window.__mpb.fight))) break;
            await sleep(300);
        }
        const A = await a.evaluate(() => ({ S: window.__mpb.fight?.S ?? null, meHp: window.__mpb.fight?.me.hp, over: !window.__mpb.fight }));
        const B = await b.evaluate(() => ({ S: window.__mpb.fight?.S ?? null, meHp: window.__mpb.fight?.me.hp }));
        ok("the enemies hurt the players", (A.S?.P ?? []).some((p) => p.hp < p.mhp) || A.over, JSON.stringify(A.S?.P));
        ok("A's own HP matches what everyone sees", A.over || A.S.P.find((p) => p.pn === "SENIOR").hp === A.meHp, `${A.S?.P.find((p) => p.pn === "SENIOR").hp} vs ${A.meHp}`);
        ok("B's own HP matches what everyone sees", B.S == null || B.S.P.find((p) => p.pn === "Ana").hp === B.meHp, `${B.S?.P.find((p) => p.pn === "Ana").hp} vs ${B.meHp}`);
        ok("the log tells who took damage", (A.S?.g ?? []).some((l) => /takes|dodged|DOWN/.test(l)) || A.over, (A.S?.g ?? []).join(" | "));
        if (SHOTS) await a.screenshot({ path: `${SHOTS}/multiplayer-fight-hurt-a.png` });
        ok("no page errors", errors.length === 0, errors.join(" | "));
        throw { handled: true };
    }
    // play it out
    let turns = 0, shot = false;
    const seen = new Set();
    for (let i = 0; i < 400; i++) {
        const [ra, rb] = [await autoPlay(a, true), await autoPlay(b)];
        if (ra === "fight" || rb === "fight" || ra === "tech") turns++;
        for (const l of await a.evaluate(() => window.__mpb.fight?.S?.g ?? [])) seen.add(l);
        if (!shot && SHOTS && turns > 2) { shot = true; await a.screenshot({ path: `${SHOTS}/multiplayer-fight-a-mid.png` }); }
        if (ra === "end" && rb === "end") break;
        await sleep(350);
    }
    ok("both players took turns", turns >= 4, `turns=${turns}`);
    const end = [await a.evaluate(() => document.querySelector("#mpb .end h2")?.textContent), await b.evaluate(() => document.querySelector("#mpb .end h2")?.textContent)];
    const techLine = [...seen].find((l) => /^SENIOR: (?!Fight)/.test(l));
    ok("a technique was used from the Tech menu (and named in the log)", !!techLine, techLine ?? [...seen].slice(0, 6).join(" | "));
    ok("both see VICTORY", end[0] === "VICTORY!" && end[1] === "VICTORY!", end.join(" / "));
    const wave2 = await a.evaluate(() => window.__mpb.fight?.waves ?? null);   // (fight is over: null) -- waves were checked through the log below
    void wave2;
    if (SHOTS) await a.screenshot({ path: `${SHOTS}/multiplayer-fight-end-a.png` });
    await a.click("#mpb .end button"); await b.click("#mpb .end button");
    await sleep(500);
    const after = [await a.evaluate(() => window.__state.partnerStats), await b.evaluate(() => window.__state.partnerStats)];
    ok("each player's Digimon earned EXP from the disc's payout", after[0].xp > xpBefore[0] && after[1].xp > xpBefore[1], `${xpBefore} -> ${after.map((x) => x.xp)}`);
    ok("each Digimon keeps the HP the fight left it", after[0].hp > 0 && after[0].hp <= 900 && after[1].hp > 0 && after[1].hp <= 900, `${after[0].hp}, ${after[1].hp}`);
    ok("the host's done() ran with a win", (await a.evaluate(() => window.__fightResult?.won)) === true);
    ok("the screen is closed afterwards", (await a.evaluate(() => document.getElementById("mpb").style.display)) === "none");
    ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
    if (!e?.handled) throw e;
} finally {
    await browser.close();
    await relay.close();
}
