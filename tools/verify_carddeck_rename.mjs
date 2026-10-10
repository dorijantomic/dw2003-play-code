// Capture the Card Folder editor end to end: the folder list with its six
// colour counters, the Edit Folder / Change name submenu, the forty-slot grid,
// the swap list, the four-copy refusal, and the rename keyboard.
// Decode: docs/research/ui/card-folder-editor-2026-08-14.md
//
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_carddeck_rename.mjs [out-dir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
const out = process.argv[2] ?? "/tmp/carddeck-rename";
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
await p.click('[data-scr="carddeck"]');
const frame = p.frames().find((f) => f.url().includes("index.html"));
const canvas = await frame.$("canvas");
await p.waitForTimeout(1200);
await canvas.click();

const shot = async (name) => {
  await p.waitForTimeout(400);
  await canvas.screenshot({ path: `${out}/${name}.png` });
  console.log("shot", name);
};

// 1. The folder list: three folders, each with six colour counters.
await shot("01-folder-list");

// 2. The two-row submenu.
await p.keyboard.press("ArrowDown");
await p.keyboard.press("c");   // Cross confirms in this overlay
await shot("02-options");

// 3. The forty slots, nine across.
await p.keyboard.press("c");   // Cross confirms in this overlay
await shot("03-editor-grid");

// The last row holds four: walk to it and try to go right past the fourth.
for (let i = 0; i < 5; i++) await p.keyboard.press("ArrowDown");
for (let i = 0; i < 9; i++) await p.keyboard.press("ArrowRight");
console.log("slot on the last row after nine rights:", await frame.evaluate(() => window.__labDeck?.slot));
await shot("04-last-row-clamp");

// 4. The swap list. A brand-new save owns exactly the forty cards already in
// the folder, so nothing is placeable and the list will not open — the disc
// does the same (it requires a non-empty available list). Buy some cards first.
console.log("granted spares:", await frame.evaluate(() => {
  const m = window.__cards?.();
  const cat = window.__labCatalog?.();
  if (!m || !cat) return "no bridge";
  const ids = cat.cards.slice(60, 75).map((c) => c.id);
  for (const id of ids) m.owned.set(id, (m.owned.get(id) ?? 0) + 2);
  return ids.length;
}));
await p.keyboard.press("ArrowUp");
await p.keyboard.press("c");   // Cross confirms in this overlay
await shot("05-swap-list");

// 5. The refusal. Own nine copies of one card, put four of them in the folder,
// then point the real swap list at that card and confirm on a fifth.
console.log("setup:", await frame.evaluate(() => {
  const m = window.__cards?.();
  const deck = window.__labDeck;
  if (!m || !deck) return "no bridge";
  const f = m.folders[m.activeFolder];
  const id = f.cards[0];
  m.owned.set(id, 9);
  for (let i = 0; i < 4; i++) f.cards[i] = id;
  // Aim at a slot that does not already hold this card — re-picking the card
  // already in the slot is the disc's deliberate no-op, not a refusal.
  deck.slot = f.cards.findIndex((x, i) => i >= 4 && x !== id);
  // The swap list is the catalog filtered to what is still placeable, in
  // catalog order — find the row this card sits on and put the cursor there.
  const list = window.__labCatalog().cards.filter((c) => {
    const used = f.cards.filter((x) => x === c.id).length;
    return (m.owned.get(c.id) ?? 0) - used > 0;
  });
  const row = list.findIndex((c) => c.id === id);
  deck.listScroll = Math.max(0, row - 3);
  deck.listCursor = row - deck.listScroll;
  return { id, row, slot: deck.slot, cardInSlot: f.cards[deck.slot], copiesInFolder: f.cards.filter((x) => x === id).length };
}));
await p.keyboard.press("c");   // Cross confirms in this overlay
await shot("06-refusal");
console.log("message shown:", await frame.evaluate(() => window.__labDeck?.message));

// 6. The rename keyboard, reached from the submenu's second row.
await p.keyboard.press("c");        // the refusal waits for Cross (doc §4)
await p.keyboard.press("Escape");   // swap list -> grid
await p.keyboard.press("Escape");   // grid -> folder list
await p.keyboard.press("c");   // Cross: open the submenu
await p.keyboard.press("ArrowDown");
await p.keyboard.press("c");   // Cross: Change name
await shot("07-rename-keyboard");
console.log("screen:", await frame.evaluate(() => window.__labDeck?.screen));

console.log("folder name:", await frame.evaluate(() => {
  const m = window.__cards?.(); return m && m.folders[m.activeFolder].name;
}));
await b.close();
