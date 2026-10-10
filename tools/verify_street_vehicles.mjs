// Player-visible check: the Kusanagi City street corner in ORDINARY play.
//
// The cars that drive across the street during the A.O.A announcement, drawn
// by the translated system (engine/systems/street-vehicles.ts) instead of the
// original overlay machine code. Decode:
// docs/research/field/asuka-city-cars-and-news-screens-2026-10-04.md
//
// Boots the A.O.A announcement (s780 event 0) with no research flags — no
// ?nativeStages, so the original overlay machine code is NOT running — and
// reports the translated street vehicles: how many cars exist, whether they
// move between frames, and a frame series to look at.
//
// Run:  python3 -m http.server <port> --directory web &
//       VERIFY_PORT=<port> tools/run-playwright.sh .bunny-scratch/verify_cars.mjs [outdir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] || "/tmp/street-vehicles";
const FRAMES = Number(process.env.FRAMES || 6);
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));

try {
  await page.goto(`${baseUrl(8955)}/?skipTitle=1&map=s780`);
  const style = page.locator("#asset-mode-authentic");
  if (await style.isVisible().catch(() => false)) await style.click();
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 20000 });
  await page.waitForTimeout(1200);

  const read = async () =>
    page.evaluate(async () => {
      const fx = await import("/effects.js");
      return {
        cars: fx.streetVehicleProbe("s780"),
        native: (await import("/native-stage.js")).nativeStage("s780") !== null,
      };
    });

  const samples = [];
  for (let i = 0; i < FRAMES; i++) {
    samples.push(await read());
    await page.screenshot({ path: `${OUT}/f${String(i).padStart(2, "0")}.png` });
    await page.waitForTimeout(500);
  }
  console.log("SAMPLES", JSON.stringify(samples, null, 1));

  const withCars = samples.filter((s) => s.cars && s.cars.length > 0);
  const moved = withCars.length > 1 &&
    withCars.some((s, i) => i > 0 && JSON.stringify(s.cars) !== JSON.stringify(withCars[0].cars));
  console.log("NATIVE_RUNTIME_PRESENT", samples.some((s) => s.native));
  console.log("FRAMES_WITH_CARS", withCars.length, "MOVED", moved);
  console.log("VERDICT", withCars.length > 0 && moved && !samples.some((s) => s.native) ? "OK" : "FAIL");
} finally {
  console.log("--- console log ---");
  for (const l of logs) console.log(l);
  await browser.close();
}