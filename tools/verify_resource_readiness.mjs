// tools/verify_resource_readiness.mjs — the browser's resource gate.
//
// The original blocks on a required file (the resident 64-entry cache's miss path,
// RESRC-Q001); the browser equivalent is the loader pair in web/assets.js plus the
// per-stage readiness set in web/game.js (`readyStageIds`, exposed as
// window.__assetLocality()). The plan's engine-resource acceptance:
//   * cold and warm loads reach the same ready state, and
//   * a failed REQUIRED load must not report the stage ready.
//
// Cold = first visit in a fresh context. Warm = the same URL reloaded with the
// browser cache primed. Failed = the stage's own map image aborted at the network.
//
// Server: python3 -m http.server 8742 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_resource_readiness.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.RESRC_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.RESRC_SHOT || ".dw3-research/autonomous-plan/shots/resource-readiness";
const MAP = process.env.RESRC_MAP || "s320";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const errors = [];
const results = { map: MAP, errors };

async function boot({ abortMap = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 640, height: 480 } });
  const page = await context.newPage();
  const logs = [];
  let mapRequests = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => { if (r.url().includes(`/maps/${MAP}.png`)) mapRequests += 1; });
  page.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") logs.push(m.text()); });
  if (abortMap) await page.route(`**/maps/${MAP}.png`, (r) => r.abort());
  await page.addInitScript(() => localStorage.setItem("assetMode", "authentic"));
  await page.goto(`${ROOT}?skipTitle=1&noEncounters=1&map=${MAP}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 30_000 });
  const snap = () => page.evaluate((id) => {
    const loc = window.__assetLocality?.() ?? {};
    const img = window.__state.mapImgs?.[id];
    return {
      map: window.__state.manifest.maps[window.__state.mapIdx].id,
      retained: loc.retainedStages ?? null,
      ready: loc.readyStages ?? null,
      mapImgState: typeof img === "string" ? img : (img ? "image" : null),
      mapImg: img && img !== "loading" && typeof img === "object"
        ? { w: img.naturalWidth, h: img.naturalHeight, same: img.src.includes(`/maps/${id}.png`) }
        : null,
    };
  }, MAP);
  return { page, context, snap, logs, requests: () => mapRequests };
}

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };

try {
  // ── Cold ──────────────────────────────────────────────────────────────────
  const cold = await boot();
  let coldReady = null;
  try {
    await cold.page.waitForFunction(
      (id) => (window.__assetLocality?.().readyStages ?? []).includes(id), MAP,
      { timeout: 15_000 });
    coldReady = true;
  } catch { coldReady = false; }
  results.cold = await cold.snap();
  results.cold.logs = cold.logs;
  writeFileSync(`${OUT}/cold.png`,
    Buffer.from((await cold.page.evaluate(() => document.querySelector("canvas#game").toDataURL("image/png"))).split(",")[1], "base64"));
  if (!coldReady) fail(`cold load never marked ${MAP} ready: ${JSON.stringify(results.cold)}`);
  await cold.context.close();

  // ── Warm (same URL, cache primed) ────────────────────────────────────────
  const warm = await boot();
  let warmReady = null;
  try {
    await warm.page.waitForFunction(
      (id) => (window.__assetLocality?.().readyStages ?? []).includes(id), MAP,
      { timeout: 15_000 });
    warmReady = true;
  } catch { warmReady = false; }
  results.warm = await warm.snap();
  results.warm.logs = warm.logs;
  writeFileSync(`${OUT}/warm.png`,
    Buffer.from((await warm.page.evaluate(() => document.querySelector("canvas#game").toDataURL("image/png"))).split(",")[1], "base64"));
  if (!warmReady) fail(`warm load never marked ${MAP} ready: ${JSON.stringify(results.warm)}`);
  if (results.cold.map !== results.warm.map) fail(`cold/warm landed on different maps`);
  if (results.cold.mapImg?.w !== results.warm.mapImg?.w || results.cold.mapImg?.h !== results.warm.mapImg?.h)
    fail(`cold/warm loaded a different map image: ${JSON.stringify([results.cold.mapImg, results.warm.mapImg])}`);
  await warm.context.close();

  // ── Failed required load ─────────────────────────────────────────────────
  const bad = await boot({ abortMap: true });
  await bad.page.waitForTimeout(3000);
  results.failed = await bad.snap();
  results.failed.logs = bad.logs;
  writeFileSync(`${OUT}/failed.png`,
    Buffer.from((await bad.page.evaluate(() => document.querySelector("canvas#game").toDataURL("image/png"))).split(",")[1], "base64"));
  results.failed.requests = bad.requests();
  if ((results.failed.ready ?? []).includes(MAP))
    fail(`an aborted required map load still reported ${MAP} ready`);
  if (results.failed.mapImgState !== "failed")
    fail(`the failed map load was not latched: ${JSON.stringify(results.failed)}`);
  if (results.failed.requests > 2)
    fail(`the failed map load was re-requested every frame (${results.failed.requests} requests)`);
  const warns = bad.logs.filter((l) => l.includes("map load failed"));
  if (warns.length !== 1)
    fail(`the aborted map load warned ${warns.length} times (want exactly once)`);
  await bad.context.close();

  if (errors.length) fail(`${errors.length} page error(s): ${errors.slice(0, 3).join("; ")}`);
  console.log("RESULT", JSON.stringify({ ok: !failed, ...results }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
