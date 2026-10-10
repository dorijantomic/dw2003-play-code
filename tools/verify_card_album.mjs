// Visual check for the 2026-08-14 Card Album wiring: the album is keyed on the
// "ever obtained" flag, not the copy count, so spending the last copy of a card
// leaves it in the album with a count of zero.
//   — docs/research/ui/card-album-screen-2026-08-14.md
//
// This exercises the HAND-AUTHORED album (web/cardalbum.js): the native
// pro/stcrdabm route is the default now (tools/verify_native_album.mjs), so
// this verifier asks for the ?legacyAlbum=1 rollback.
//
// Run with: tools/run-playwright.sh tools/verify_card_album.mjs [outdir]
// Expects `python3 -m http.server 8742 --directory web` to be serving already.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/cardalbum";
mkdirSync(out, { recursive: true });

const b = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await p.goto(`${baseUrl(8742)}/ui-lab.html?legacyAlbum=1`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
console.log("game booted");

const frame = p.frames().find((f) => f.url().includes("index.html")) ?? p.mainFrame();

// The starter grant runs at boot, so page 1 already holds revealed cards.
await frame.evaluate(() => window.__labOpen("cardalbum"));
await p.waitForTimeout(700);
await p.screenshot({ path: `${out}/01-album-page1.png` });

// The starter's ids are scattered through the catalog, so find the first
// revealed card anywhere and page the album to it.
const before = await frame.evaluate(async () => {
  const cs = await import("./cardstate.js");
  const seen = [];
  for (let id = 1; id <= 315; id++) if (cs.seenCard(id)) seen.push(id);
  const id = seen[0] ?? null;
  return {
    revealed: seen.length,
    id,
    held: id == null ? 0 : cs.ownedCount(cs.cards(), id),
  };
});
console.log("before:", JSON.stringify(before));
const target = before.id != null && before.held > 0 ? before : null;
if (!target) throw new Error("no revealed card with copies to spend");

// Spend every copy. The disc's remove routine floors at zero and never touches
// the album byte.
const after = await frame.evaluate(async (id) => {
  const cs = await import("./cardstate.js");
  cs.loseCard(cs.cards(), id, 99);
  return { id, seen: cs.seenCard(id), held: cs.ownedCount(cs.cards(), id) };
}, target.id);
console.log("after: ", JSON.stringify(after));

if (after.held !== 0) throw new Error(`expected 0 copies, got ${after.held}`);
if (after.seen !== true) throw new Error("card fell out of the album — the flag was cleared");

// Page the album to it and put the cursor on it, so the detail line shows the
// zero count. Left/right are page flips; the in-page cursor is set directly.
const page = Math.floor((target.id - 1) / 12);
const cursor = (target.id - 1) % 12;
await frame.evaluate(({ page, cursor }) => {
  const alb = window.__cardAlbum;
  if (alb) { alb.page = page; alb.cursor = cursor; }
  else throw new Error("no __cardAlbum handle on the lab window");
}, { page, cursor });
await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/02-album-after-spending.png` });

// A card nobody has ever held draws the placeholder and no detail line.
const unseen = await frame.evaluate(async () => {
  const cs = await import("./cardstate.js");
  for (let id = 1; id <= 315; id++) if (!cs.seenCard(id)) return id;
  return null;
});
console.log("first never-held card id:", unseen);
if (unseen === null) throw new Error("every card is revealed — nothing to compare against");

// The stat line differs by card kind: (CP) for a Program card, AP and HP with
// the "/" clip between them for a Digimon. The catalog puts the 60 Program
// cards at ids 1..60, exactly five full pages, so no page mixes them — capture
// one of each.
const kinds = await frame.evaluate(async () => {
  const cs = await import("./cardstate.js");
  const out = [];
  for (let id = 1; id <= 72; id++) {
    cs.seeCard(cs.cards(), id);
    out.push({ id, kind: cs.cardById(id)?.kind, effect: !!cs.cardById(id)?.effect });
  }
  return out;
});
if (!kinds.slice(0, 12).every((k) => k.kind === "program")) throw new Error("page 1 is not all Programs");
if (!kinds.slice(60, 72).every((k) => k.kind === "digimon")) throw new Error("page 6 is not all Digimon");
const rosemon = kinds.find((k) => k.id === 69);
if (!rosemon?.effect) throw new Error("RosemonII carries no rule text");

await frame.evaluate(() => { window.__cardAlbum.page = 0; window.__cardAlbum.cursor = 0; });
await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/03-program-cards-cp-plate.png` });

// Page 6 is ids 61..72, and 69 is RosemonII — one of the five Digimon cards
// that carry a rule instead of a plain stat line.
await frame.evaluate(() => { window.__cardAlbum.page = 5; window.__cardAlbum.cursor = 8; });
await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/04-digimon-stats-and-rule.png` });

await b.close();
console.log("card album OK");
