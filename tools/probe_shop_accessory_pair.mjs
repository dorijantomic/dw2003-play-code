// Bounded original/browser comparison: one accessory worn, second slot empty.
// Run through tools/run-playwright.sh with the web server on port 8742.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/shop-accessory-pair";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const results = new Map();
for (const [name, native] of [["reference", true], ["browser", false]]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const executableRequests = [];
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
    window.__state.equipment = [{ acc0: 300 }, {}, {}];
    window.__labOpen("shop", 1);
  });
  const press = async (key, ms = native ? 850 : 110) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(70);
    await page.keyboard.up(key);
    await page.waitForTimeout(ms);
  };
  await page.waitForTimeout(native ? 1600 : 400);
  await press("c"); // BUY
  await press("z"); // effect card
  await page.locator("#game").screenshot({ path: `${out}/${name}-card.png` });
  const before = await page.evaluate(() => ({
    slots: [0x80049864, 0x80049866].map(a => window.__shop._host?.read(a, 2) ?? null),
    preview: window.__shop._equipCards?.(window.__state)?.[0]?.preview ?? null,
    text: window.__nativeScreenTextDump?.().flatMap(w => w.decoded?.map(x => x.text) ?? []).join(" ") ?? "",
  }));
  await press("z");
  for (let i = 0; i < 4; i++) await press("c"); // item, qty, Buy, Equip? Yes
  await page.locator("#game").screenshot({ path: `${out}/${name}-before-equip.png` });
  await press("c", native ? 1250 : 350); // equip first member
  await page.locator("#game").screenshot({ path: `${out}/${name}-after-equip.png` });
  const after = await page.evaluate(() => ({
    slots: [0x80049864, 0x80049866].map(a => window.__shop._host?.read(a, 2) ?? null),
    equipment: window.__state.equipment?.[0] ?? null,
    inventory: window.__state.inventory,
    screen: window.__shop.screen,
    traps: window.__shop.diagnostics?.().host?.traps ?? 0,
  }));
  console.log(name, JSON.stringify({ before, after, errors }));
  results.set(name, { before, after, errors, executableRequests });
  await page.close();
}
await browser.close();
const reference = results.get("reference");
const ordinary = results.get("browser");
assert.deepEqual(reference.errors, []);
assert.deepEqual(ordinary.errors, []);
assert.deepEqual(ordinary.executableRequests, []);
assert.equal(reference.after.traps, 0);
assert.deepEqual(reference.before.slots, [300, 0]);
assert.deepEqual(reference.after.slots, [300, 292]);
assert.deepEqual(ordinary.after.equipment, { acc0: 300, acc1: 292 });
assert.deepEqual(ordinary.before.preview.rows.slice(0, 2), [
  { stat: "chr", before: 4, after: 7 },
  { stat: "str", before: 48, after: 58 },
]);
assert.equal(ordinary.before.preview.slot, "acc1");
writeFileSync(`${out}/result.json`, JSON.stringify(Object.fromEntries(results), null, 2) + "\n");
console.log("shop accessory pair: OK");
