// Drive the native See Equipment window all the way: slot list -> item list ->
// confirm, and watch the roster record's equipment halfwords and bag counts.
//   tools/run-playwright.sh tools/probe_status_equip_apply.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.DDW3_BASE || `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`;
const OUT = process.env.EQUIP_SHOT || "/tmp/opencode/status-equip-apply";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

const snap = async (name) => {
    const d = await page.evaluate(() => {
        const st = window.__status, read = (a) => st._host.read(a, 4) >>> 0;
        const page_ = st.diagnostics().screen?.child ?? 0;
        const aux = page_ ? read(page_ + 0x24) : 0;
        const win = aux ? read(aux + 0x10c) : 0;
        const rec = 0x80049494;
        return {
            open: st.isOpen(), traps: st.diagnostics().host?.traps,
            pageUnk10: page_ ? read(page_ + 0x10) : null,
            pageUnk74: page_ ? read(page_ + 0x74) : null,
            win, winCb: win ? read(win + 0x48).toString(16) : null,
            winState: win ? read(win + 0x10) : null,
            winUnk5C: win ? read(win + 0x5c) : null,
            winUnk60: win ? read(win + 0x60) : null,
            winUnk64: win ? read(win + 0x64) : null,
            winUnk68: win ? read(win + 0x68) : null,
            winUnk6C: win ? read(win + 0x6c) : null,
            winCand: win ? Array.from({ length: 8 }, (_, i) => read(win + 0x3a0 + i * 2) & 0xffff) : null,
            winList: win ? Array.from({ length: 8 }, (_, i) => read(win + 0x78 + i * 2) & 0xffff) : null,
            equip: [0x3c8, 0x3ca, 0x3cc, 0x3ce, 0x3d0, 0x3d2].map((o) => read(rec + o) & 0xffff),
            bag92: st._host.read(0x80048d34 + 0x7c + 92, 1) & 0xff,
            bag215: st._host.read(0x80048d34 + 0x7c + 215, 1) & 0xff,
            equip92: st._host.read(0x80048d34 + 0x20f + 92, 1) & 0xff,
            equip215: st._host.read(0x80048d34 + 0x20f + 215, 1) & 0xff,
            objects: st._host.rt.world.objects.length,
        };
    });
    writeFileSync(`${OUT}/${name}.json`, JSON.stringify(d, null, 1) + "\n");
    await page.locator("#game").screenshot().then((b) => writeFileSync(`${OUT}/${name}.png`, b)).catch(() => {});
    console.log(name, JSON.stringify(d));
    return d;
};
const press = async (key, ms = 100) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await page.waitForTimeout(600); };
const interactive = () => page.waitForFunction(() => (window.__status?.diagnostics?.().renderer?.frames ?? 0) >= 60, null, { timeout: 30000 });

try {
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    await page.evaluate(() => {
        window.__state.bits = 4321;
        window.__state.party = ["p003pken", null, null];
        window.__state.digimonNames = { p003pken: "Kotemon" };
        window.__state.partnerStats = { digimonId: 1, level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25, stats: {}, elemBonuses: {} };
        window.__state.partyStats = [{ level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 }, null, null];
        window.__state.inventory = [{ id: 92, qty: 1 }, { id: 215, qty: 1 }];
        window.__labOpen("menu");
    });
    await page.waitForTimeout(500);
    for (let i = 0; i < 4; i++) await press("ArrowDown", 70);
    await press("Enter", 90);
    await interactive();
    await press("Enter", 90);            // detail
    await page.waitForTimeout(700);
    await press("ArrowDown", 70);        // See Equipment
    await press("Enter", 90);            // open window (state 3)
    await page.waitForTimeout(900);
    await snap("1-window-slot-list");
    await press("Enter", 90);            // open item list
    await page.waitForTimeout(900);
    await snap("2-item-list");
    await press("ArrowDown", 70);        // row 0 is the remove/none sentinel
    await snap("3-cursor-item");
    await press("Enter", 90);            // equip the highlighted item
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(400); await snap(`4-after-equip-${i}`); }
    await press("Enter", 90);            // reopen the list (state 3 -> grid)
    await page.waitForTimeout(900);
    await snap("5-list-again");
    await press("Enter", 90);            // row 0 = remove
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(400); await snap(`6-after-remove-${i}`); }
    await press("c", 90);                // Cross: back out of window
    await page.waitForTimeout(900);
    await snap("7-after-cross");
    console.log("errors:", errors.length ? errors.join(" | ") : "none");
} finally {
    await browser.close();
}
