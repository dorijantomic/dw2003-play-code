// F2 -> Screen -> "Sharp battle menus" (HD Remaster, ON by default): the battle's menu / letter / result sheets
// (ui/pgfgc00, cmfont, stfrpt) are drawn from their xBR-blended 4x copy (web/gpu-pixel-filter.js). The real game,
// headless, by numbers only (filtered draws counted per sheet; no screenshots):
//   HD, on:  the one-on-one battle's command menu and the many-vs-many fight's menus draw pgfgc00 filtered;
//   HD, off / Authentic: no filtered draw.
//
//   VERIFY_PORT=8090 tools/run-playwright.sh tools/verify_sharp_battle_menus.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(mode, fx, kind) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(({ mode, fx }) => {
        localStorage.setItem("assetMode", mode); localStorage.setItem("engineSchema", "2"); localStorage.setItem("charId", "p003pken");
        const lead = { digimonId: 1, level: 20, xp: 0, tp: 10, hp: 900, maxHp: 900, mp: 300, maxMp: 300, stats: { str: 99, def: 99, spt: 99, wis: 99, spd: 99, chr: 99 }, bonuses: {}, elemBonuses: {} };
        localStorage.setItem("party", JSON.stringify(["p003pken"])); localStorage.setItem("partnerStats", JSON.stringify(lead));
        localStorage.setItem("partyStats", JSON.stringify([lead])); localStorage.setItem("rosterOwned", "1");
        localStorage.setItem("dw.fx.v1", JSON.stringify(fx));
    }, { mode, fx });
    await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1&map=s330`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__state?.started && window.__mpb && window.__battle, null, { timeout: 60000 });
    await sleep(1500);
    if (kind === "1v1") {
        await page.evaluate(async () => { await window.__battle.loadData(); const st = window.__state; return window.__battle.startScreen(200, () => {}, () => {}, () => {}, { mapId: st.manifest.maps[st.mapIdx].id }); });
    } else {
        await page.evaluate(() => window.__mpb.practice({ foes: [1, 2].map(() => ({ name: "Kunemon", level: 5, hp: 900, mp: 10, stat_scale: 16 })) }));
        await page.waitForFunction(() => window.__mpb.fight?.nat?.mode === "cmd", null, { timeout: 60000 });
    }
    await sleep(9000);                                   // the battle opens and its command menu is up for a while
    const stats = await page.evaluate(async () => Object.fromEntries((await import("./gpu-pixel-filter.js")).pixelFilterStats));
    await context.close();
    assert.deepEqual(errors, []);
    const count = (name) => Object.entries(stats).filter(([k]) => k.includes(`/ui/${name}_sheet.png`)).reduce((s, [, v]) => s + v, 0);
    return { pgfgc00: count("pgfgc00"), cmfont: count("cmfont"), all: stats };
}

for (const [mode, fx, kind, want] of [
    ["hd", {}, "1v1", true], ["hd", {}, "2v2", true], ["hd", { uisharp: false }, "1v1", false], ["authentic", {}, "1v1", false],
]) {
    const r = await run(mode, fx, kind);
    console.log(mode, JSON.stringify(fx), kind, "filtered draws: pgfgc00", r.pgfgc00, "cmfont", r.cmfont);
    if (want) assert.ok(r.pgfgc00 > 0, "the battle menus are drawn sharp");
    else assert.equal(Object.keys(r.all).length, 0, "nothing filtered");
}
await browser.close();
console.log("verify_sharp_battle_menus: OK");
