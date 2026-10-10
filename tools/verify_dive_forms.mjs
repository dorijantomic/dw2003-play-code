// Visual check for the Digi-Egg traversal forms: warp onto a seabed screen and
// an underground screen and confirm the PLAYER renders as Submarimon / Digmon,
// with no party trail, then step back to a surface screen and confirm Junior.
//
// Run: npm run pw tools/verify_dive_forms.mjs   (server on :8741 must be up)
import { chromium } from "playwright";
import { mkdir as _mkdir } from "node:fs/promises";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = "/tmp/claude-1000/-home-dorij-ddw3-walker/bb28e25c-64ff-4e68-b8f0-335c85f999d0/scratchpad";
await _mkdir(OUT, { recursive: true });

const CASES = [
  { screen: "s825", expect: "Submarimon", sprite: "p122sbmm" },
  { screen: "s865", expect: "Digmon", sprite: "p123digm" },
  { screen: "s200", expect: null, sprite: null },
];

const browser = await chromium.launch();
let bad = 0;
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); bad++; });
  // ?skipTitle=1 drops straight into the field, so the first-launch visual-style
  // chooser (which covers the title) does not block a "New Game" click. The dive
  // network is built at load either way.
  await page.goto(`${baseUrl(8741)}/?skipTitle=1&map=s200`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 30000 });
  await page.waitForTimeout(1200);

  // The section map is built after the scenes load; assert it before warping.
  const net = await page.evaluate(() => {
    const n = window.__state.diveNetwork;
    return n ? [...n.entries()] : null;
  });
  console.log("dive network:", net ? net.length + " screens" : "MISSING");
  if (!net) { console.log("FAIL: diveNetwork was never built"); bad++; }

  for (const c of CASES) {
    const ok = await page.evaluate((screen) => {
      const i = window.__state.manifest.maps.findIndex((m) => m.id === screen);
      if (i < 0) return false;
      window.__setMap(i);
      return true;
    }, c.screen);
    if (!ok) { console.log(`SKIP ${c.screen}: not in the manifest`); continue; }
    await page.waitForTimeout(400);

    const got = await page.evaluate(() => ({
      form: window.__state.diveForm?.name ?? null,
      sprite: window.__state.diveForm?.sprite ?? null,
      followers: window.__activeFollowerCount?.() ?? null,
    }));
    const pass = got.form === c.expect && got.sprite === c.sprite
      && (c.expect === null || got.followers === 0);
    console.log(
      `${pass ? "PASS" : "FAIL"} ${c.screen}: form=${got.form} sprite=${got.sprite} followers=${got.followers}`
      + ` (expected form=${c.expect})`);
    if (!pass) bad++;
    await page.screenshot({ path: `${OUT}/dive_${c.screen}.png` });
  }
  console.log(bad === 0 ? "\nALL CHECKS PASSED" : `\n${bad} CHECK(S) FAILED`);
} finally {
  await browser.close();
}
process.exit(bad === 0 ? 0 : 1);
