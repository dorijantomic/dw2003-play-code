// Bounded ordinary-route check for the translated Card Folder chooser.
// Run with tools/run-playwright.sh tools/verify_translated_folder.mjs [output-dir].
//
// It aborts every assets/native/** request from page load (the interpreter's
// executable images), opens the folder chooser through the lab entry point,
// drives it with real key events and refuses any screen that does not report
// execution: "translated".
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const output = process.argv[2] ?? "/tmp/translated-folder";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const failures = [];
const requests = [];
page.on("pageerror", (error) => failures.push(error.message));
page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
await page.route("**/assets/native/**", (route) => {
  requests.push(route.request().url());
  return route.abort();
});
await page.addInitScript(() => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken"]));
  const starter = Array.from({ length: 40 }, (_, i) => i + 1);
  localStorage.setItem("cardCollection", JSON.stringify({
    owned: starter.map((id) => [id, 2]),
    seen: [...starter],
    folders: [
      { name: "Ted", cards: starter },
      { name: "Amy", cards: Array.from({ length: 40 }, (_, i) => i + 41) },
      { name: "", cards: [] },
    ],
    activeFolder: 0, packs: [],
  }));
});
const press = async (key) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(70);
  await page.keyboard.up(key);
  await page.waitForTimeout(180);
};
const reader = () => page.evaluate(() => {
  const session = window.__labDeck?._session;
  if (!session) return null;
  return {
    picker: session.mem.read32(session.root + 0x10) | 0,
    cursor: session.mem.read32(session.root + 0x60) | 0,
    flag70: session.mem.read32(session.root + 0x70) | 0,
  };
});
try {
  await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started);
  await page.evaluate(() => window.__labOpen("carddeck"));
  await page.waitForFunction(() => window.__labDeck?._session, null, { timeout: 10000 });
  await page.waitForFunction(() => window.__labDeck?._session?.mem.read32(window.__labDeck._session.root + 0x10) === 4,
    null, { timeout: 10000 });
  await page.locator("#game").screenshot({ path: `${output}/chooser.png` });

  const settled = await reader();
  if (settled.picker !== 4) failures.push(`chooser did not settle on the menu: ${JSON.stringify(settled)}`);
  const labels = await page.evaluate(() => window.__labDeck._session.widgets.textWidgets().length);
  if (labels !== 25) failures.push(`chooser built ${labels} labels, wanted 25`);

  // The cursor moves with the d-pad.
  await press("ArrowDown");
  const down = await reader();
  if (down.cursor !== 1) failures.push(`ArrowDown did not move the cursor: ${JSON.stringify(down)}`);
  await press("ArrowUp");
  if ((await reader()).cursor !== 0) failures.push("ArrowUp did not move the cursor back");

  // Confirm (the word bit the walker reaches with `c`) opens the submenu.
  await press("c");
  await page.waitForFunction(() => window.__labDeck?._session?.mem.read32(window.__labDeck._session.root + 0x10) === 0xd,
    null, { timeout: 10000 });
  await page.locator("#game").screenshot({ path: `${output}/submenu.png` });

  // Back (Escape) closes the submenu and returns to the three-folder menu.
  await press("Escape");
  await page.waitForFunction(() => window.__labDeck?._session?.mem.read32(window.__labDeck._session.root + 0x10) === 4,
    null, { timeout: 10000 });

  // Back on the menu leaves through the ported popup fade.
  await press("Escape");
  await page.waitForFunction(() => !window.__labDeck.isOpen(), null, { timeout: 10000 });

  const diagnostic = await page.evaluate(() => window.__labDeck.diagnostics());
  if (diagnostic.execution !== "translated") failures.push(`Folder runs ${diagnostic.execution} logic`);
  if (diagnostic.renderer.clips === 0) failures.push("Folder pictures did not paint");
  if (requests.length) failures.push(`Executable asset requests: ${requests.length}`);
  if (failures.length) throw new Error(failures.join("\n"));
  console.log(JSON.stringify({ result: "pass", output, clips: diagnostic.renderer.clips,
    labels, requests: requests.length }));
} finally {
  await browser.close();
}
