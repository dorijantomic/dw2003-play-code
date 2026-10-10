// The story card grant, end to end in the running walker.
//
// A dialogue state's on_close write into game-state bank 0x92 gives the player
// a card. The walker used to route that bank into the ITEM bag, so the grant
// added a phantom item with the card's id and no card at all. This drives the
// real applyStoryFlag path and checks the card arrives.
//   — CARD-STORY-GRANTS-2026-08-14, CARD-COLLECTION-ENTRY-POINTS-2026-08-14
//
// Run with: tools/run-playwright.sh tools/verify_card_grant.mjs [outdir]
// Expects `python3 -m http.server 8742 --directory web` to be serving already.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/cardgrant";
mkdirSync(out, { recursive: true });

const b = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
console.log("game booted");

const frame = p.frames().find((f) => f.url().includes("index.html")) ?? p.mainFrame();

// Flag 0x92B7 = bank 0x92, index 0xB7 = 183 = Gabumon. This is the exact
// on_close entry the Asuka Inn character carries (s235, npcs[12], state 0).
const GABUMON = 183;
const FLAG = 0x92b7;

const before = await frame.evaluate(async (id) => {
  const cs = await import("./cardstate.js");
  return {
    copies: cs.ownedCount(cs.cards(), id),
    seen: cs.seenCard(id),
    bagItems: window.__state.inventory.length,
  };
}, GABUMON);
console.log("before:", JSON.stringify(before));

// Fire the grant through the real story-flag path, exactly as closing that
// character's textbox does.
await frame.evaluate((flag) => window.__applyStoryFlag(flag, 1), FLAG);

const after = await frame.evaluate(async (id) => {
  const cs = await import("./cardstate.js");
  return {
    copies: cs.ownedCount(cs.cards(), id),
    seen: cs.seenCard(id),
    bagItems: window.__state.inventory.length,
    phantomItem: window.__state.inventory.some((s) => s.id === id),
  };
}, GABUMON);
console.log("after: ", JSON.stringify(after));

if (after.copies !== before.copies + 1) throw new Error(`expected one more copy, got ${after.copies}`);
if (!after.seen) throw new Error("the card did not enter the album");
if (after.phantomItem) throw new Error("the grant added a phantom ITEM — bank 0x92 is still misrouted");
if (after.bagItems !== before.bagItems) throw new Error("the item bag changed");

// And the read side: "do you own this card" must answer from the collection.
const reads = await frame.evaluate((flag) => ({
  held: window.__storyFlags.get(flag),
  unheld: window.__storyFlags.get(0x9200 | 0x1c8),
}), FLAG);
console.log("flag reads:", JSON.stringify(reads));
if (reads.held !== 1) throw new Error(`the granted card should read 1, got ${reads.held}`);
if (reads.unheld !== 0) throw new Error(`an unheld card should read 0, got ${reads.unheld}`);

// Show it in the album: page to Gabumon and capture the cell.
await frame.evaluate((id) => {
  window.__labOpen("cardalbum");
  const alb = window.__cardAlbum;
  alb.page = Math.floor((id - 1) / 12);
  alb.cursor = (id - 1) % 12;
}, GABUMON);
await p.waitForTimeout(700);
await p.screenshot({ path: `${out}/01-granted-card-in-album.png` });

await b.close();
console.log("card grant OK");
