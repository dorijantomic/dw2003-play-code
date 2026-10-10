// What is the See Equipment sub-window doing at the wedge?
// tools/run-playwright.sh tools/probe_status_window.mjs
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
const BASE = process.env.DDW3_BASE || `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
await page.evaluate(() => {
    window.__state.bits = 4321;
    window.__state.party = ["p006rna", null, null];
    window.__state.digimonNames = { p006rna: "Renamon" };
    window.__state.partnerStats = { digimonId: 2, level: 1, xp: 0, tp: 0, hp: 140, maxHp: 140, mp: 200, maxMp: 200, stats: {}, elemBonuses: {} };
    window.__state.partyStats = [{ level: 1, xp: 0, tp: 0, hp: 140, maxHp: 140, mp: 200, maxMp: 200 }, null, null];
    window.__labOpen("menu");
});
const press = async (k, ms = 100) => { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k); await page.waitForTimeout(500); };
const interactive = () => page.waitForFunction(() => (window.__status?.diagnostics?.().renderer?.frames ?? 0) >= 60, null, { timeout: 30000 });
const dump = () => page.evaluate(() => {
    const st = window.__status, rt = st._host.rt, mem = rt.mem;
    const read = (a) => st._host.read(a, 4) >>> 0;
    const page_ = read(rt.world.objects[0].addr + 0x24) ? (window.__status.diagnostics().screen.child) : 0;
    const aux = read(page_ + 0x24);
    const win = aux ? read(aux + 0x10c) : 0;
    const count = page_ ? read(page_ + 0x20) : 0;
    const arr = page_ ? read(page_ + 0x24) : 0;
    const slots = [];
    for (let i = 0; i < Math.min(count, 24); i++) slots.push(read(arr + i * 4).toString(16));
    return {
        count, slots,
        page: page_ ? page_.toString(16) : page_, aux: aux ? aux.toString(16) : aux, win: win ? win.toString(16) : win,
        winState: win ? read(win + 0xc) : null, winCb: win ? read(win + 0x48).toString(16) : null,
        winUnk10: win ? read(win + 0x10) : null, winUnk14: win ? read(win + 0x14) : null,
        winUnk18: win ? read(win + 0x18) : null, winUnk74: win ? read(win + 0x74) : null,
        winAlive: win ? rt.world.objects.some((o) => (o.addr >>> 0) === win && o.alive) : null,
        objs: rt.world.objects.filter((o) => o.alive).map((o) => ({ a: o.addr.toString(16), cb: o.cb.toString(16) })),
    };
});
for (let i = 0; i < 4; i++) await press("ArrowDown", 70);
await press("Enter");
await interactive();
await press("Enter");
await interactive();
await press("ArrowDown", 70);
await press("Enter");
await page.waitForTimeout(1500);
console.log("AT WEDGE:", JSON.stringify(await dump(), null, 1));
await press("c");
await page.waitForTimeout(1200);
console.log("AFTER CROSS:", JSON.stringify(await dump(), null, 1));
await browser.close();
