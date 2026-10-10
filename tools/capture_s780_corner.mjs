// Before/after capture for the Kusanagi City street corner's traffic lights and
// the corner stinger, in ORDINARY play (no ?nativeStages).
//
// Walks the camera up to the top-left of the corner, where the pole records and
// the stinger live, and shoots the frame with the corner at master story
// ordinal 0x1B (the beat the overlay builds it on) and at ordinal 0 (the
// opening announcement), so the two states can be compared by eye.
//
// Run:  python3 -m http.server <port> --directory web &
//       VERIFY_PORT=<port> tools/run-playwright.sh tools/capture_s780_corner.mjs [outdir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] || "/tmp/s780-corner-cap";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));

/** Put the player where the corner's props and the pole records are on screen. */
const stand = (x, y) => page.evaluate(([px, py]) => window.__teleport(px, py), [x, y]);

try {
  await page.goto(`${baseUrl(8966)}/?skipTitle=1&map=s780`);
  const style = page.locator("#asset-mode-authentic");
  if (await style.isVisible().catch(() => false)) await style.click();
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 20000 });

  // Ordinal 0x1B: the traffic-light corner exists. Stand between the two poles.
  await page.evaluate(() => {
    window.__state.progressOrdinal = 27;
    const idx = window.__state.manifest.maps.findIndex((m) => m.id === "s780");
    if (idx >= 0) window.__setMap(idx, null);
  });
  await page.waitForTimeout(400);
  await stand(270, 215);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/after-lamps.png` });
  console.log(
      "AFTER",
      JSON.stringify(
          await page.evaluate(async () => {
              const eng = await import("/vendor/engine.js");
              return {
                  glows: eng.streetGlowDraws("s780"),
                  props: eng.streetPropDraws("s780"),
                  writes: eng.streetLightWrites("s780"),
              };
          }),
      ),
  );

  // Ordinal 0: the corner is not built at all, so nothing of it is drawn. The
  // debug clear is here because re-entering the stage through the map index does
  // not itself run the stage-entry cutscene check the game loop runs.
  await page.evaluate(() => {
    window.__state.progressOrdinal = 0;
    window.__stageObjects.clear("s780");
    const idx = window.__state.manifest.maps.findIndex((m) => m.id === "s780");
    if (idx >= 0) window.__setMap(idx, null);
  });
  await page.waitForTimeout(400);
  await stand(270, 215);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/before-lamps.png` });
  console.log(
      "BEFORE",
      JSON.stringify(
          await page.evaluate(async () => {
              const eng = await import("/vendor/engine.js");
              return {
                  glows: eng.streetGlowDraws("s780"),
                  props: eng.streetPropDraws("s780"),
                  writes: eng.streetLightWrites("s780"),
              };
          }),
      ),
  );

  // The stinger: stand near map (218,71) — where the overlay's popup draw puts
  // its clip — and play the announcement until one is up, then shoot the same
  // frame with and without it.
  await stand(240, 105);
  await page.waitForTimeout(300);
  const seen = new Set();
  const deadline = Date.now() + 90000;
  let live = null;
  while (Date.now() < deadline && seen.size < 6) {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(40);
    await page.keyboard.press("Space");
    const d = await page.evaluate(async () => {
      const eng = await import("/vendor/engine.js");
      return eng.stingerPopupDraws("s780");
    });
    if (d?.length) {
      seen.add(d[0].clip);
      if (!live && d[0].clip >= 4) live = d[0];
      await page.screenshot({ path: `${OUT}/stinger-${d[0].clip}.png` });
    }
    await page.waitForTimeout(70);
  }
  console.log("STINGER clips", [...seen].sort((a, b) => a - b).join(","), "live", JSON.stringify(live));
  if (live) {
    await page.screenshot({ path: `${OUT}/after-stinger.png` });
    await page.evaluate(async () => {
      const eng = await import("/vendor/engine.js");
      eng.clearStingerPopup("s780");
    });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/before-stinger.png` });
  }
} finally {
  await browser.close();
}
