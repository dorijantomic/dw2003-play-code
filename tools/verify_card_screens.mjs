// Headless check of the four card-battle screens through the real web/game.js
// renderer in the UI lab: shop root, buy list, album, folder editor, duel.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/card-screens";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.addInitScript(() => localStorage.setItem("assetMode", "authentic"));
await page.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
// The lab hosts the real game in an iframe; __labOpen lives in that window.
await page.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
const frame = page.frames().find((f) => f.url().includes("index.html"));
// The lab routes keys to the game canvas only once it has focus.
const gameFrame = page.locator("#game");
await gameFrame.click({ position: { x: 20, y: 20 } });

// The catalog is fetched asynchronously; every screen below needs it.
await frame.waitForFunction(
  async () => (await fetch("assets/data/card_catalog.json").then((r) => r.json())).counts.total === 316,
);
await page.waitForTimeout(600);

const key = async (k) => { await page.keyboard.press(k); await page.waitForTimeout(120); };
const shot = async (name) => { await gameFrame.screenshot({ path: `${out}/${name}.png` }); };

async function open(screen) {
  await frame.evaluate(() => window.__labClose());
  await frame.evaluate((s) => window.__labOpen(s), screen);
  await gameFrame.click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(400);
}

// 1. Card shop root menu, then the buy list with real stock.
await open("cardshop");
await shot("shop-root");
await key("Enter");            // "Buy One Card"
await shot("shop-buy");
await key("ArrowRight");
await key("ArrowDown");
await shot("shop-buy-moved");
await key("Enter");            // CARD DETAIL / CONFIRM popup
await shot("shop-confirm");
await key("Escape");
await key("Escape");
await key("ArrowDown");        // "Open Booster"
await key("Enter");
await key("Enter");            // pull a booster
await shot("shop-booster");

// 2. Card album over the 316-card catalog.
await open("cardalbum");
await shot("album-page1");
await key("ArrowRight");
await shot("album-page2");

// 3. Folder editor. The disc opens on the THREE-FOLDER list, not on a card
// list — see docs/research/ui/card-folder-editor-2026-08-14.md.
await open("carddeck");
await shot("deck-folders");
await key("Enter");            // choose folder 1 -> Edit Folder / Change name
await shot("deck-options");
await key("Enter");            // Edit Folder -> the 40 slots, nine across
await shot("deck-grid");

// 4. A duel, stepped through a full round of the six decoded phases.
await open("cardduel");
await shot("duel-start");
for (const name of ["draw", "load", "summon", "compile", "battle"]) {
  await key("Enter");
  await shot(`duel-${name}`);
}

// 5. The same duel against a real CARD_NPC record. The disc names the opponent
// by the FOLDER they play and shows their level beside it, so record 22 must
// read "Asuka Duel King" / "LV 30" rather than the placeholder "Challenger".
await open("cardduel");
await frame.evaluate(() => window.__labDuel.open(null, "Duelist", null, 22));
await page.waitForTimeout(500);
await shot("duel-named-opponent");
const named = await frame.evaluate(async () => {
  const j = await fetch("assets/data/card_opponents.json").then((r) => r.json());
  const rec = (j.opponents ?? j.records).find((o) => o.id === 22);
  return { folderName: rec.folderName, level: rec.level };
});
assert.equal(named.folderName, "Asuka Duel King");
assert.equal(named.level, 30);

assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
console.log(`card screens OK -> ${out}`);
await browser.close();
