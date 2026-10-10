// Repeatable captures of the screens the pause menu reaches: the Card Album's
// detail popup, the folder list, the folder editor with and without its explain
// panel, the rename keyboard, and SORT's swap bracket.
//
//   python3 -m http.server 8742 --directory web    # in another shell
//   tools/run-playwright.sh tools/shot_menu_screens.mjs <output-directory>
//
// It grants a few cards first, because the lab boots with an empty collection
// and the album's popup opens only for a card the player has held.
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
const outDir = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html`);
await p.waitForTimeout(6000);
const frame = p.frames().find((f) => f.url().includes("index.html")) ?? p.mainFrame();

async function shot(name, fn) {
  await frame.evaluate(() => window.__labClose?.());
  await p.waitForTimeout(300);
  await frame.evaluate((n) => window.__labOpen(n), name.screen);
  await p.waitForTimeout(900);
  const cv = await frame.$("canvas");
  await cv.click({ position: { x: 5, y: 5 } });
  await p.waitForTimeout(200);
  if (fn) { await fn(); await p.waitForTimeout(700); }
  const c = await frame.$("canvas");
  await c.screenshot({ path: `${outDir}/${name.file}.png` });
  console.log("shot", name.file);
}

const key = async (k, n = 1) => {
  for (let i = 0; i < n; i++) { await p.keyboard.press(k); await p.waitForTimeout(180); }
};

// The album's popup opens only for a card the player has held, and the lab
// boots with an empty collection, so grant a few first.
await frame.evaluate(async () => {
  const cs = await import("./cardstate.js");
  for (const id of [1, 2, 3, 61, 70]) cs.grantCard(cs.cards(), id, 3);
});
await shot({ screen: "cardalbum", file: "album-popup" }, async () => {
  await key("c");
});
await shot({ screen: "carddeck", file: "deck-folders" });
await shot({ screen: "carddeck", file: "deck-editor" }, async () => {
  await key("Enter"); await key("c");
});
await shot({ screen: "carddeck", file: "deck-editor-explain" }, async () => {
  await key("c"); await key("c"); await key("e");
});
await shot({ screen: "carddeck", file: "deck-rename" }, async () => {
  await key("c"); await key("ArrowDown"); await key("c");
});
await shot({ screen: "menu", file: "menu-sort" }, async () => {
  await key("ArrowDown"); await key("Enter");  // SORT
  await key("Enter");                          // pick slot 0
  await key("ArrowDown", 2);                   // hover slot 2
});
await b.close();
