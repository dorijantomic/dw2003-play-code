// Bounded original/browser comparison: replacing sword and shield with Claymore.
// Run through tools/run-playwright.sh with the web server on port 8742.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/shop-two-hand-swap";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const results = new Map();
for (const [name, native] of [["reference", true], ["browser", false]]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [], executableRequests = [];
  page.on("pageerror", error => errors.push(error.message));
  if (!native) await page.route("**/assets/native/**", route => {
    executableRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1${native ? "&nativeShop=1" : ""}`);
  await page.waitForFunction(() => window.__state?.started);
  await page.evaluate(() => {
    window.__state.bits = 10000;
    window.__state.inventory = [];
    window.__state.equipment = [{ right: 92, left: 275 }, {}, {}];
    window.__labOpen("shop", 10);
  });
  const press = async (key, ms = native ? 850 : 110) => {
    await page.keyboard.down(key); await page.waitForTimeout(70);
    await page.keyboard.up(key); await page.waitForTimeout(ms);
  };
  await page.waitForTimeout(native ? 1600 : 400);
  await press("c"); // BUY
  await press("ArrowRight");
  for (let i = 0; i < 3; i++) await press("ArrowDown"); // Claymore, row 4 right
  await page.locator("#game").screenshot({ path: `${out}/${name}-selected.png` });
  const selected = await page.evaluate(() => ({
    item: window.__shop._selected?.(window.__state)?.id ?? null,
    text: window.__nativeScreenTextDump?.().flatMap(w => w.decoded?.map(x => x.text) ?? []).join(" ") ?? "",
  }));
  for (let i = 0; i < 4; i++) await press("c"); // item, qty, Buy, Equip? Yes
  await page.locator("#game").screenshot({ path: `${out}/${name}-before-equip.png` });
  await press("c", native ? 1250 : 350);
  await page.locator("#game").screenshot({ path: `${out}/${name}-after-equip.png` });
  const after = await page.evaluate(() => ({
    slots: [0x80049860, 0x80049862].map(a => window.__shop._host?.read(a, 2) ?? null),
    bag: [92, 275, 176].map(id => window.__shop._host?.read(0x80048d34 + 0x7c + id, 1) ?? null),
    equipment: window.__state.equipment?.[0] ?? null,
    inventory: window.__state.inventory,
    traps: window.__shop.diagnostics?.().host?.traps ?? 0,
  }));
  const result = { selected, after, errors, executableRequests };
  console.log(name, JSON.stringify(result));
  results.set(name, result);
  await page.close();
}
await browser.close();
const reference = results.get("reference"), ordinary = results.get("browser");
assert.deepEqual(reference.errors, []);
assert.deepEqual(ordinary.errors, []);
assert.deepEqual(ordinary.executableRequests, []);
assert.equal(reference.after.traps, 0);
assert.deepEqual(reference.after.slots, [176, 176]);
assert.deepEqual(ordinary.after.equipment, { right: 176, left: 176 });
assert.equal(ordinary.after.inventory.find(slot => slot.id === 92)?.qty, 1);
assert.equal(ordinary.after.inventory.find(slot => slot.id === 275)?.qty, 1);
writeFileSync(`${out}/result.json`, JSON.stringify(Object.fromEntries(results), null, 2) + "\n");
console.log("shop two hand swap: OK");
