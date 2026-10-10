// The player's reported path: STATUS -> Digimon -> See Equipment -> Back.
// tools/run-playwright.sh tools/repro_status_equip.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.DDW3_BASE || `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`;
const OUT = process.env.EQUIP_SHOT || "/tmp/opencode/status-equip";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

const snap = async (name) => {
    const d = await page.evaluate(() => {
        const st = window.__status; if (!st?._host?.rt) return { status: st.diagnostics(), menuScreen: window.__menu?.screen ?? null };
        const read = (a) => st._host.read(a, 4) >>> 0;
        const page_ = st.diagnostics().screen?.child ?? 0;
        const aux = page_ ? read(page_ + 0x24) : 0;
        const win = aux ? read(aux + 0x10c) : 0;
        return { status: st.diagnostics(), menuScreen: window.__menu?.screen ?? null,
            pageUnk74: page_ ? read(page_ + 0x74) : null,
            winCb: win ? read(win + 0x48).toString(16) : null,
            winUnk10: win ? read(win + 0x10) : null };
    });
    const s = d.status?.screen ?? {};
    writeFileSync(`${OUT}/${name}.json`, JSON.stringify(d, null, 1) + "\n");
    await page.locator("#game").screenshot().then((b) => writeFileSync(`${OUT}/${name}.png`, b)).catch(() => {});
    console.log(name, JSON.stringify({ open: d.status?.open, frames: d.status?.renderer?.frames,
        traps: d.status?.host?.traps, unk10: s.childUnk10, unk14: s.childUnk14, unk18: s.childUnk18,
        pageUnk74: d.pageUnk74, winCb: d.winCb, winUnk10: d.winUnk10, menuScreen: d.menuScreen }));
    return d;
};
const press = async (key, ms = 120) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await page.waitForTimeout(500); };
const interactive = () => page.waitForFunction(() => (window.__status?.diagnostics?.().renderer?.frames ?? 0) >= 60, null, { timeout: 30000 });

try {
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    await page.evaluate(() => {
        window.__state.bits = 4321;
        window.__state.party = ["p006rna", null, null];
        window.__state.digimonNames = { p006rna: "Renamon" };
        window.__state.partnerStats = { digimonId: 2, level: 1, xp: 0, tp: 0, hp: 140, maxHp: 140, mp: 200, maxMp: 200, stats: {}, elemBonuses: {} };
        window.__state.partyStats = [{ level: 1, xp: 0, tp: 0, hp: 140, maxHp: 140, mp: 200, maxMp: 200 }, null, null];
        window.__state.inventory = [];
        window.__labOpen("menu");
    });
    await page.waitForTimeout(500);
    for (let i = 0; i < 4; i++) await press("ArrowDown", 70);
    await press("Enter", 90);
    await interactive();
    await snap("1-picker");

    await press("Enter", 90);            // Circle: the Digimon's detail
    await interactive();
    await page.waitForTimeout(600);
    await snap("2-detail");

    if (!process.env.DIGIVOLVE_ONLY) {
        await press("ArrowDown", 70);    // highlight See Equipment
        await page.waitForTimeout(300);
        await snap("3-see-equipment-highlight");
    }

    await press("Enter", 90);            // Circle: open the highlighted window
    await page.waitForTimeout(1500);
    await snap("4-equipment-open");

    await press("c", 90);                // Cross: back
    await page.waitForTimeout(1500);
    await snap("5-after-cross");

    await press("c", 90);
    await page.waitForTimeout(1500);
    await snap("6-after-cross-again");

    await press("Escape", 90);
    await page.waitForTimeout(1500);
    await snap("7-after-escape");
    console.log("errors:", errors.length ? errors : "none");
} catch (e) {
    console.error("probe exception:", e.message, "errors:", errors);
} finally {
    await browser.close();
}
