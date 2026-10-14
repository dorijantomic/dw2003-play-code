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
    page.on("pageerror", (e) => { errors.push(`${label}: ${e.message}`.slice(0, 200)); if (process.env.DEBUG) console.log(`  [${label} PAGEERROR]`, e.message.slice(0, 300)); });
    page.on("console", (m) => { if (/\[mpbattle\]|\[multiplayer\]/.test(m.text())) { errors.push(`${label}: ${m.text()}`.slice(0, 300)); if (process.env.DEBUG) console.log(`  [${label} LOG]`, m.text().slice(0, 300)); } else if (process.env.DEBUG && ["error", "warning"].includes(m.type())) console.log(`  [${label} ${m.type()}]`, m.text().slice(0, 240)); });
    if (process.env.DEBUG) page.on("response", (r) => { if (r.status() === 404) console.log(`  [${label} 404]`, r.url().slice(0, 160)); });
    await page.addInitScript(({ nm, hurt }) => {
        const lead = hurt ? { digimonId: 1, level: 3, xp: 0, tp: 10, hp: 120, maxHp: 120, mp: 50, maxMp: 50,
            stats: { str: 15, def: 10, spt: 10, wis: 10, spd: 30, chr: 10 }, bonuses: {}, elemBonuses: {} }
            : { digimonId: 1, level: 20, xp: 0, tp: 10, hp: 900, maxHp: 900, mp: 300, maxMp: 300,
            stats: { str: 99, def: 99, spt: 99, wis: 99, spd: 99, chr: 99 }, bonuses: {}, elemBonuses: {} };
        localStorage.setItem("assetMode", "authentic"); localStorage.setItem("engineSchema", "2"); localStorage.setItem("playerName", nm);
        localStorage.setItem("charId", "p003pken");
        const second = { digimonId: 4, level: 15, xp: 0, tp: 10, hp: 700, maxHp: 700, mp: 200, maxMp: 200,
            stats: { str: 80, def: 80, spt: 80, wis: 80, spd: 80, chr: 80 }, bonuses: {}, elemBonuses: {} };
        const two = nm === "SENIOR" && !hurt;           // SENIOR brings a second Digimon (Agumon) to swap in
        localStorage.setItem("party", JSON.stringify(two ? ["p003pken", "p006agum"] : ["p003pken"]));
        localStorage.setItem("partnerStats", JSON.stringify(lead)); localStorage.setItem("partyStats", JSON.stringify(two ? [lead, second] : [lead]));
        localStorage.setItem("equipment", JSON.stringify(two ? [{}, {}] : [{}])); localStorage.setItem("rosterOwned", "1");
    }, { nm: name, hurt: HURT });
    await page.goto(url + `&relay=ws://127.0.0.1:${relay.port}`);
    await page.waitForFunction(() => window.__state?.started && window.__mpsocial && window.__mpb, null, { timeout: 60000 });
    await sleep(2500);
    return page;
}

// play my turn through the game's own menus with the pad buttons, the way a player would: command list -> (list) -> target
async function nativeTurn(page, plan, label = "", shots = false) {
    const s = await page.evaluate(() => {
        const root = document.getElementById("mpb");
        if (!root || root.style.display !== "flex") return "off";
        if (root.querySelector(".end")) return "end";
        const f = window.__mpb.fight; if (!f?.S) return "wait";
        const me = "p" + window.__mp.mp.id;
        return f.S.ph === "play" && f.S.t === me && f.nat?.mode === "cmd" && f.nat.diagnostics().widgets.cmd.active ? "mine" : "wait";
    });
    if (s !== "mine") return s;
    const kind = plan.shift() ?? "fight";
    const key = (b) => page.evaluate((b) => window.__mpb.key(b), b);
    const modeIs = (m) => page.waitForFunction((m) => window.__mpb.fight?.nat?.mode === m && window.__mpb.fight.nat.diagnostics().widgets[m]?.active, m, { timeout: 8000 }).catch(async (e) => {
        console.log("WAITING FOR", m, "->", JSON.stringify(await page.evaluate(() => { const f = window.__mpb.fight; return f ? { cmd: f.cmd ? { stage: f.cmd.stage } : null, nat: f.nat?.diagnostics(), items: f.kit.items().length } : null; })).slice(0, 700));
        throw e;
    });
    const downs = async (n) => { for (let i = 0; i < n; i++) { await key("down"); await sleep(140); } };
    const shot = async (name) => { if (shots && SHOTS) { await sleep(250); await page.screenshot({ path: `${SHOTS}/multiplayer-menu-${name}.png` }); } };
    const target = async () => {
        // the pick may take a moment to appear on a slow screen; or the order was already sent (a single enemy left)
        const got = await page.waitForFunction(() => { const f = window.__mpb.fight; return !f || f.cmd?.stage === "target" || (!f.cmd && !f.nat?.mode); }, null, { timeout: 4000 }).then(() => true, () => false);
        if (process.env.DEBUG) console.log("  target wait:", got, JSON.stringify(await page.evaluate(() => { const f = window.__mpb.fight; return f ? { stage: f.cmd?.stage, mode: f.nat?.mode, t: f.S?.t } : null; })));
        if (got && await page.evaluate(() => window.__mpb.fight?.cmd?.stage === "target")) { await shot(label + "target"); await key("circle"); }
    };
    await shot(label + "command");
    if (kind === "fight") { await key("circle"); await target(); }
    else if (kind === "tech") { await page.evaluate(() => { window.__techName = window.__mpb.fight?.techs?.[0]?.name ?? null; }); await downs(1); await key("circle"); await modeIs("tech"); await sleep(500); await shot(label + "tech"); await key("circle"); await target(); }
    else if (kind === "item") { await downs(4); await key("circle"); await modeIs("item"); await sleep(500); await shot(label + "item"); await key("circle"); await target(); }
    else if (kind === "dv") { await downs(2); await key("circle"); await modeIs("form"); await sleep(600); await shot(label + "digivolve"); await key("down"); await sleep(200); await key("circle"); }
    else if (kind === "tag") { await downs(3); if (process.env.DEBUG) console.log("  tag turn: before circle", JSON.stringify(await page.evaluate(() => { const f = window.__mpb.fight; return { g: f.S.g, stage: f.cmd?.stage, mode: f.nat.mode, row: f.cmdRow, S: f.S.t, act: f.act, party: f.party.map((m) => m.rec.hp), cmd: f.nat.diagnostics().widgets.cmd }; }))); await key("circle"); if (process.env.DEBUG) { await sleep(500); console.log("  tag turn: after circle", JSON.stringify(await page.evaluate(() => { const f = window.__mpb.fight; return { stage: f.cmd?.stage, mode: f.nat.mode, row: f.cmdRow, page: f.nat.diagnostics().page }; }))); } await modeIs("tag"); await sleep(600); await shot(label + "tag"); await key("circle"); }
    return kind;
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
    await b.evaluate(() => { const ps = window.__state.partnerStats; ps.formLedger = [{ id: 39, formLevel: 1, dvexp: 0, techSlots: [] }]; ps.equippedForms = [39]; });   // Ana can digivolve
    await a.evaluate(() => { window.__state.inventory.push({ id: 43, qty: 2 }); window.__state.partnerStats.hp = 300; });   // two PowerCharges in A's bag, and A is hurt
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
    // the scene is the game's own 3D battle: every Digimon is a real model in one arena, with a plate floating over it
    await a.waitForFunction(() => { const f = window.__mpb.fight; return f?.r3d && f.S && ["p" + f.S.P[0].id, "p" + f.S.P[1].id, "e" + f.S.E[0].i, "e" + f.S.E[1].i].every((k) => f.r3d.getFighterScreen(k)); }, null, { timeout: 30000 });
    ok("all four Digimon stand in the 3D arena (A's screen)", true);
    await b.waitForFunction(() => { const f = window.__mpb.fight; return f?.r3d && f.S && ["p" + f.S.P[0].id, "p" + f.S.P[1].id, "e" + f.S.E[0].i, "e" + f.S.E[1].i].every((k) => f.r3d.getFighterScreen(k)); }, null, { timeout: 30000 });
    ok("all four Digimon stand in the 3D arena (B's screen)", true);
    ok("the screen is in 3D mode with a plate over each Digimon", await b.evaluate(() => document.getElementById("mpb").classList.contains("d3") && document.querySelectorAll("#mpb .plate").length === 4));
    ok("the other player's name is shown as typed", view.players.includes("SENIOR") && view.players.includes("Ana"));
    await sleep(3500);                                           // let the arena finish loading
    if (SHOTS) await b.screenshot({ path: `${SHOTS}/multiplayer-fight-b.png` });

    if (HURT) {
        // keep fighting until the enemies have hurt somebody and somebody has gone down (or 150 steps)
        for (let i = 0; i < 300; i++) {
            await nativeTurn(a, []); await nativeTurn(b, []);
            const st = await a.evaluate(() => ({ ko: window.__mpb.fight?.S?.P.filter((p) => p.ko).length ?? 2, hurt: window.__mpb.fight?.S?.P.some((p) => p.hp < p.mhp) ?? true, log: window.__mpb.fight?.S?.g ?? [] }));
            if (st.ko >= 1 || !(await a.evaluate(() => !!window.__mpb.fight))) break;
            await sleep(300);
        }
        const A = await a.evaluate(() => ({ S: window.__mpb.fight?.S ?? null, meHp: window.__mpb.fight?.me.hp, over: !window.__mpb.fight }));
        const B = await b.evaluate(() => ({ S: window.__mpb.fight?.S ?? null, meHp: window.__mpb.fight?.me.hp }));
        ok("the enemies hurt the players", (A.S?.P ?? []).some((p) => p.hp < p.mhp) || A.over, JSON.stringify(A.S?.P));
        ok("A's own HP matches what everyone sees", A.over || A.S.P.find((p) => p.pn === "SENIOR").hp === A.meHp, `${A.S?.P.find((p) => p.pn === "SENIOR").hp} vs ${A.meHp}`);
        ok("B's own HP matches what everyone sees", B.S == null || B.S.P.find((p) => p.pn === "Ana").hp === B.meHp, `${B.S?.P.find((p) => p.pn === "Ana").hp} vs ${B.meHp}`);
        ok("the log tells who took damage", (A.S?.g ?? []).some((l) => /\d+ damage!|Evade!|KO!|Poisoned/.test(l)) || A.over, (A.S?.g ?? []).join(" | "));
        if (SHOTS) await a.screenshot({ path: `${SHOTS}/multiplayer-fight-hurt-a.png` });
        ok("no page errors", errors.length === 0, errors.join(" | "));
        throw { handled: true };
    }
    // play it out through the game's own menus: A uses an item, then swaps to Agumon (Tag), then a technique; Ana digivolves
    let turns = 0;
    const FASTWIN = !!process.env.FASTWIN;      // (quick run for the post-battle screen: every foe is one hit from defeat)
    const anaForms = new Set(), seen = new Set(), planA = FASTWIN ? [] : ["item", "tag", "tech"], planB = FASTWIN ? [] : ["dv"];
    const did = new Set();
    for (let i = 0; i < 500; i++) {
        if (!did.has("techName")) { did.add("techName"); await a.evaluate(() => { window.__techName = window.__mpb.fight?.techs?.[0]?.name ?? null; }); }
        if (FASTWIN) await a.evaluate(() => { for (const e of window.__mpb.fight?.H?.arena?.E ?? []) e.rec.hp = Math.min(e.rec.hp, 1); });
        const [ra, rb] = [await nativeTurn(a, planA, "a-", planA.length === 3), await nativeTurn(b, planB, "b-", planB.length === 1)];
        if (SHOTS && ra && !["wait", "off", "end"].includes(ra) && !did.has("dmgshot")) { did.add("dmgshot"); await sleep(1200); await a.screenshot({ path: `${SHOTS}/multiplayer-damage-a.png` }); await sleep(1200); await a.screenshot({ path: `${SHOTS}/multiplayer-damage-a2.png` }); for (const n of [3, 4, 5]) { await sleep(900); await a.screenshot({ path: `${SHOTS}/multiplayer-damage-a${n}.png` }); } }
        if (process.env.DEBUG && ra && !["wait", "off", "end"].includes(ra)) { await sleep(2500); console.log("  A did", ra, JSON.stringify(await a.evaluate(() => ({ g: window.__mpb.fight?.S?.g, P: window.__mpb.fight?.S?.P.map((p) => [p.pn, p.n, p.hp, p.mhp]), stage: window.__mpb.fight?.cmd?.stage, t: window.__mpb.fight?.S?.t })))); }
        if (ra && ra !== "wait" && ra !== "off" && ra !== "end") { turns++; did.add("a-" + ra); }
        if (rb && rb !== "wait" && rb !== "off" && rb !== "end") { turns++; did.add("b-" + rb); }
        const nm = await b.evaluate(() => window.__mpb.fight?.S?.P.find((p) => p.pn === 'Ana')?.n); if (nm) anaForms.add(nm);
        const forms = await a.evaluate(() => window.__mpb.fight?.S?.P.find((p) => p.pn === 'SENIOR')?.n); if (forms) did.add("A:" + forms);
        for (const l of await a.evaluate(() => window.__mpb.fight?.S?.g ?? [])) seen.add(l);
        if (ra === "end" && rb === "end") break;
        // won: the fight screen steps aside for the game's own post-battle screen, so the loop is over
        if ((await a.evaluate(() => !!window.__reportNative?.isOpen?.())) && (await b.evaluate(() => !!window.__reportNative?.isOpen?.()))) break;
        await sleep(250);
    }
    const itemDone = did.has("a-item"), dvDone = did.has("b-dv");
    ok("both players took turns", turns >= 3, `turns=${turns}`);
    if (!FASTWIN) {
    ok("A swapped to the second Digimon with the Tag screen", [...did].some((x) => x.startsWith("A:Agumon")) && did.has("a-tag"), JSON.stringify([...did]));
    const bag = await a.evaluate(() => window.__state.inventory.find((x) => x.id === 43)?.qty ?? 0);
    ok("A used a PowerCharge from the Item menu: named in the log, it healed, taken from the bag", itemDone && [...seen].some((l) => /used Power ?Charge/i.test(l)) && [...seen].some((l) => /SENIOR: 500 ?HP healed/.test(l)) && bag === 1, `done=${itemDone} bag=${bag} ${[...seen].slice(0, 5).join(" | ")}`);
    ok("Ana digivolved from the Digivolve menu: her Digimon changed on the shared screen", dvDone && anaForms.size >= 2, JSON.stringify([...anaForms]));
    const techName = await a.evaluate(() => window.__techName ?? null);
    const techLine = [...seen].find((l) => techName && l === `SENIOR: ${techName}!`);
    ok("a technique was used from the Tech menu (and named in the log)", !!techLine, techLine ?? [...seen].slice(0, 6).join(" | "));
    }
    // the game's own post-battle screen comes up for each player (the fight screen steps aside)
    const reportUp = (pg) => pg.waitForFunction(() => window.__reportNative?.isOpen?.() === true, null, { timeout: 25000 }).then(() => true, () => false);
    const up = [await reportUp(a), await reportUp(b)];
    ok("both players get the game's own post-battle screen", up[0] && up[1], up.join(" / "));
    ok("the fight screen stepped aside for it", (await a.evaluate(() => document.getElementById("mpb").style.display)) === "none" && (await b.evaluate(() => document.getElementById("mpb").style.display)) === "none");
    await sleep(2500);
    if (SHOTS) { await a.screenshot({ path: `${SHOTS}/multiplayer-report-a.png` }); await b.screenshot({ path: `${SHOTS}/multiplayer-report-b.png` }); }
    for (let i = 0; i < 60; i++) {
        const open = [await a.evaluate(() => window.__reportNative.isOpen()), await b.evaluate(() => window.__reportNative.isOpen())];
        if (!open[0] && !open[1]) break;
        if (open[0]) await a.keyboard.press("Enter");
        if (open[1]) await b.keyboard.press("Enter");
        await sleep(700);
    }
    ok("both leave the post-battle screen with the confirm button", !(await a.evaluate(() => window.__reportNative.isOpen())) && !(await b.evaluate(() => window.__reportNative.isOpen())));
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
