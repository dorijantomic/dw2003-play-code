// One-member party (the user's live case): STATUS -> Digimon detail -> Back.
// tools/run-playwright.sh tools/repro_status_solo.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.DDW3_BASE || `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`;
const OUT = process.env.SOLO_SHOT || "/tmp/opencode/status-solo";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

const snap = async (name) => {
    const d = await page.evaluate(() => ({
        status: window.__status?.diagnostics?.() ?? null,
        menuScreen: window.__menu?.screen ?? null,
        menuOpen: window.__state?.menuOpen ?? null,
        sfx: window.__sfxLog ?? null,
    }));
    const s = d.status?.screen ?? {};
    writeFileSync(`${OUT}/${name}.json`, JSON.stringify({ ...d, status: { ...d.status, screen: s } }, null, 1) + "\n");
    await page.locator("#game").screenshot().then((b) => writeFileSync(`${OUT}/${name}.png`, b)).catch(() => {});
    console.log(name, JSON.stringify({
        open: d.status?.open, frames: d.status?.renderer?.frames, traps: d.status?.host?.traps,
        child: s.child ? s.child.toString(16) : s.child, childState: s.childState, unk10: s.childUnk10,
        unk14: s.childUnk14, unk18: s.childUnk18, menuScreen: d.menuScreen, menuOpen: d.menuOpen,
    }));
    return d;
};
const press = async (key, ms = 120) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await page.waitForTimeout(450); };

try {
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    await page.evaluate(() => {
        window.__state.bits = 4321;
        window.__state.party = ["p006rna", null, null];   // the player's one-Digimon party
        window.__state.digimonNames = { p006rna: "Renamon" };
        window.__state.partnerStats = {
            digimonId: 2, level: 1, xp: 0, tp: 0, hp: 140, maxHp: 140, mp: 200, maxMp: 200,
            stats: {}, elemBonuses: {},
        };
        window.__state.partyStats = [{ level: 1, xp: 0, tp: 0, hp: 140, maxHp: 140, mp: 200, maxMp: 200 }, null, null];
        window.__state.inventory = [];
        window.__sfxLog = [];
        const orig = window.__sfx.play.bind(window.__sfx);
        window.__sfx.play = (n, ...r) => { window.__sfxLog.push(n); return orig(n, ...r); };
        window.__labOpen("menu");
    });
    await page.waitForTimeout(500);
    for (let i = 0; i < 4; i++) await press("ArrowDown", 70);
    await press("Enter", 90);
    await page.waitForFunction(() => (window.__status?.diagnostics?.().renderer?.frames ?? 0) >= 60, null, { timeout: 30000 });
    await snap("1-picker");

    await press("Enter", 90);
    await page.waitForTimeout(1200);
    await snap("2-detail");

    await press("c", 90);           // Cross: the page's own back
    await page.waitForTimeout(1200);
    await snap("3-after-cross");

    await press("Escape", 90);      // Triangle -> translated Cross
    await page.waitForTimeout(1200);
    await snap("4-after-escape");

    await press("Escape", 90);
    await page.waitForTimeout(1200);
    await snap("5-after-escape-again");
    console.log("errors:", errors.length ? errors : "none");
} catch (e) {
    console.error("probe exception:", e.message, "errors:", errors);
} finally {
    await browser.close();
}
