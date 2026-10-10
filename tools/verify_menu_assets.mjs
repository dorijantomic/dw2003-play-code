// Scratch: drive the real game in headless Chromium, open the pause menu,
// walk to the status-detail screen, and screenshot each step to verify the
// real decoded assets (backdrop, portraits, stat/element icons) render.
// The title's Continue is not the way in any more: the memory card in LOAD mode
// answers with its own selector 0xE00, the TITLE SCREEN, when the player leaves
// it without loading (pro/stgmcard.s 0x4dc4-0x4e2c), so it starts no game. This
// script only wants the pause menu, so it boots the field directly (?skipTitle=1
// reads the same seeded state Continue used to restore).
// Run: VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_menu_assets.mjs <outdir>
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? ".";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
page.on("console", (m) => { if (m.type() === "error") console.log("PAGE-ERR:", m.text()); });
page.on("pageerror", (e) => console.log("PAGE-EXC:", e.message));

// Seed a 3-member party matching the savestates (Kotemon lead, Renamon, Patamon).
await page.addInitScript(() => {
  localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
  localStorage.setItem("partnerStats", JSON.stringify({
    digimonId: 1, level: 1, xp: 4, hp: 90, maxHp: 150, mp: 80, maxMp: 100,
    tp: 0, bonuses: {}, techs: [1],
  }));
  localStorage.setItem("inventory", JSON.stringify([
    { id: 1, qty: 2 }, { id: 16, qty: 1 }, { id: 210, qty: 1 },
  ]));
  localStorage.setItem("bits", "600");
  localStorage.setItem("introSeen", "1");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p002plyl");
});
await page.goto(`${baseUrl(8741)}/?skipTitle=1&noEncounters=1`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__state?.started === true, null, { timeout: 30_000 });
await page.waitForTimeout(3000);

const shot = (n) => page.screenshot({ path: `${out}/menu_${n}.png` });
const key = async (k, ms = 400) => { await page.keyboard.press(k); await page.waitForTimeout(ms); };

await key("i", 900);            // open menu -> home
await shot("1_home");
await key("s"); await key("s"); await key("s"); await key("s"); // down to STATUS
await key("Enter", 600);        // -> status-list (Choose Digimon)
await shot("2_chooselist");
await key("Enter", 600);        // -> status-detail (Kotemon)
await shot("3_detail");
await browser.close();
console.log("shots written to", out);
