import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/asset-modes";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

const chooserPage = await browser.newPage({ viewport: { width: 900, height: 620 } });
const chooserErrors = [];
chooserPage.on("pageerror", (error) => chooserErrors.push(error.message));
await chooserPage.goto(`${baseUrl(8742)}/index.html`, { waitUntil: "load" });
await chooserPage.locator("#asset-mode-screen:not([hidden])").waitFor();
await chooserPage.locator("#asset-mode-hd:not(:disabled)").waitFor();
await chooserPage.screenshot({ path: `${out}/first-launch.png` });
assert.deepEqual(chooserErrors, []);
await Promise.all([
  chooserPage.waitForNavigation(),
  chooserPage.locator("#asset-mode-authentic").click(),
]);
assert.equal(
  await chooserPage.evaluate(() => localStorage.getItem("assetMode")),
  "authentic",
);
assert.equal(await chooserPage.locator("#asset-mode-screen").isHidden(), true);

const hdPage = await browser.newPage({ viewport: { width: 900, height: 620 } });
await hdPage.addInitScript(() => localStorage.setItem("assetMode", "hd"));
const hdRequests = [];
hdPage.on("response", (response) => {
  if (response.url().includes("/assets-hd/")) hdRequests.push(response.url());
});
const hdErrors = [];
hdPage.on("pageerror", (error) => hdErrors.push(error.message));
await hdPage.goto(
  `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1&map=s415`,
  { waitUntil: "load" },
);
await hdPage.waitForFunction(() => window.__state?.started);
await hdPage.waitForFunction(() => window.__state?.mapImgs?.s415 instanceof Image);
const dimensions = await hdPage.evaluate(() => {
  const image = window.__state.mapImgs.s415;
  const map = window.__state.manifest.maps.find((entry) => entry.id === "s415");
  return {
    natural: [image.naturalWidth, image.naturalHeight],
    logical: [image.width, image.height],
    map: [map.width, map.height],
    selected: document.getElementById("assetModeSelect").value,
  };
});
assert.deepEqual(dimensions.natural, [1280, 960]);
assert.deepEqual(dimensions.logical, [320, 240]);
assert.deepEqual(dimensions.map, [320, 240]);
assert.equal(dimensions.selected, "hd");
assert.ok(hdRequests.some((url) => url.endsWith("/assets-hd/maps/s415.png")));
assert.deepEqual(hdErrors, []);
await hdPage.locator("#game").screenshot({ path: `${out}/hd-s415.png` });

const fallbackPage = await browser.newPage();
// A complete HD build may already contain this map. Make the missing-file
// condition deterministic in this isolated context, without deleting assets.
await fallbackPage.route('**/assets-hd/maps/s780.png', route =>
  route.fulfill({ status: 404, body: 'missing HD fixture' }));
await fallbackPage.addInitScript(() => localStorage.setItem("assetMode", "hd"));
const fallbackResponses = [];
fallbackPage.on("response", (response) => {
  if (response.url().includes("/maps/s780.png")) {
    fallbackResponses.push([response.url(), response.status()]);
  }
});
await fallbackPage.goto(
  `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1&map=s780`,
  { waitUntil: "load" },
);
await fallbackPage.waitForFunction(() => window.__state?.mapImgs?.s780 instanceof Image);
assert.ok(fallbackResponses.some(([url, status]) =>
  url.includes("/assets-hd/maps/s780.png") && status === 404));
assert.ok(fallbackResponses.some(([url, status]) =>
  url.includes("/assets/maps/s780.png") && status === 200));

await browser.close();
console.log(`OK — chooser, HD density, and native fallback verified; screenshots in ${out}`);
