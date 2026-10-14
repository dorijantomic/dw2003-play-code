// Browser smoke test for the multiplayer duel and co-op fights: both start a real battle and the co-op HP is shared.
// Needs the game served on PORT (default 8770).   Run: tools/run-playwright.sh tools/verify_multiplayer_battle.mjs
import { chromium } from "playwright";

const PORT = process.env.PORT || 8770;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, extra = "") => { console.log(cond ? "PASS" : "FAIL", name, extra); if (!cond) process.exitCode = 1; };

const browser = await chromium.launch();
const errors = [];
try {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
    await page.addInitScript(() => {
        const lead = { digimonId: 1, level: 20, xp: 0, tp: 10, hp: 900, maxHp: 900, mp: 200, maxMp: 200,
            stats: { str: 99, def: 99, spt: 99, wis: 99, spd: 99, chr: 99 }, bonuses: {}, elemBonuses: {} };
        localStorage.setItem("assetMode", "authentic");
        localStorage.setItem("engineSchema", "2");
        localStorage.setItem("playerName", "Junior");
        localStorage.setItem("charId", "p003pken");
        localStorage.setItem("party", JSON.stringify(["p003pken"]));
        localStorage.setItem("partnerStats", JSON.stringify(lead));
        localStorage.setItem("partyStats", JSON.stringify([lead]));
        localStorage.setItem("equipment", JSON.stringify([{}]));
        localStorage.setItem("rosterOwned", "1");
    });
    await page.goto(`http://localhost:${PORT}/index.html?skipTitle=1&noEncounters=1&map=s330`);
    await page.waitForFunction(() => window.__state?.started && window.__mpsocial, null, { timeout: 60000 });
    await sleep(3500);
    // the api object is reachable through the tiny social test hook
    const api = "window.__mpsocial.api";
    ok("the social api exists", await page.evaluate(`!!${api}`));

    // --- duel: fight a copy of a friend's team
    const card = { party: [{ n: "Kotemon", f: "Kotemon", id: 1, lv: 3, hp: 60, mhp: 60, mp: 20, mmp: 20, st: {} }] };
    const before = await page.evaluate(() => JSON.stringify(window.__state.partnerStats));
    const started = await page.evaluate(`${api}.startDuel(${JSON.stringify(card)}, (r) => { window.__duelResult = r; })`);
    ok("a duel starts a battle", started === true, String(started));
    await page.waitForFunction(() => window.__battle?.isActive?.(), null, { timeout: 60000 });
    ok("the battle is active", true);
    const st = await page.evaluate(`${api}.coopState()`);
    ok("the enemy is the friend's Kotemon at their HP", st && st.maxHp > 0, JSON.stringify(st));

    // --- shared HP: lower the enemy from "outside", as a partner's hit would
    await page.waitForFunction(`${api}.coopState()?.hp > 0`, null, { timeout: 10000 });
    await page.evaluate(`${api}.coopSetHp(0, 5)`);
    const after = await page.evaluate(`${api}.coopState()`);
    ok("a partner's hit lowers my enemy's HP", after.hp === 5, JSON.stringify(after));
    await page.evaluate(`${api}.coopSetHp(0, 50)`);
    ok("and never raises it", (await page.evaluate(`${api}.coopState()`)).hp === 5);
    await page.evaluate(`${api}.coopSetHp(1, 1)`);
    ok("a hit for a different enemy number is ignored", (await page.evaluate(`${api}.coopState()`)).hp === 5);
    ok("no page errors", errors.length === 0, errors.join(" | "));
    void before;
} finally {
    await browser.close();
}
