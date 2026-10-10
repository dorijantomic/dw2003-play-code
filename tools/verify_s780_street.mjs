// Visual + diagnostic probe for s780 (Kusanagi street corner) native ambience.
//
// Boot straight into the street with the shipped native MIPS interpreter
// running, capture a frame series, and report the interpreter's live objects,
// disabled callbacks and per-frame draw intents. Used as the before/after
// capture for the street-life rendering fix (car/lamp per-texel blending).
//
// Run:  python3 -m http.server 8741 --directory web &
//       tools/run-playwright.sh tools/verify_s780_street.mjs [outdir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] || "/tmp/s780-street";
const FRAMES = Number(process.env.FRAMES || 8);
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));

try {
  await page.goto(`${baseUrl(8741)}/?skipTitle=1&map=s780`);
  // First run shows the visual-style chooser; pick Authentic PS1.
  const style = page.locator("#asset-mode-authentic");
  if (await style.isVisible().catch(() => false)) await style.click();
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 15000 });
  // Re-enter the map so the opening broadcast's car spawn is caught live: the
  // first boot's cars can despawn while assets finish loading. ORDINAL sets the
  // story beat first (27 = the normal street state, which boots the manager and
  // the traffic-light writer).
  const ord = Number(process.env.ORDINAL || NaN);
  await page.evaluate((o) => {
    if (Number.isFinite(o)) window.__state.progressOrdinal = o;
    const idx = window.__state.manifest.maps.findIndex((m) => m.id === "s780");
    if (idx >= 0) window.__setMap(idx, null);
  }, ord);
  await page.waitForTimeout(250);

  const diag = await page.evaluate(async () => {
    const mod = await import("/native-stage.js");
    const rt = mod.nativeStage("s780");
    if (!rt) return { present: false };
    return {
      present: true,
      stageId: rt.stageId,
      pointTable: "0x" + rt.pointTable.toString(16),
      objects: (rt.rt.world?.objects ?? []).map((o) => ({
        cb: "0x" + o.cb.toString(16),
        id: o.id,
        alive: o.alive,
      })),
      cars: (rt.rt.world?.objects ?? [])
        .filter((o) => o.cb === 0x800a5ec0)
        .map((o) => ({
          state: rt.rt.mem.read32(o.addr + 0xc),
          sprite: rt.rt.mem.read8(o.addr + 0x60),
          x: rt.rt.mem.read32(o.addr + 0x68) >> 8,
          y: rt.rt.mem.read32(o.addr + 0x6c) >> 8,
        })),
      disabled: rt.rt.disabled,
      screenQuads: {
        count: rt.rt.screenQuads.length,
        sample: rt.rt.screenQuads.slice(0, 3),
      },
    };
  });
  console.log("DIAG", JSON.stringify(diag, null, 1));

  for (let i = 0; i < FRAMES; i++) {
    await page.screenshot({ path: `${OUT}/f${String(i).padStart(2, "0")}.png` });
    await page.waitForTimeout(Number(process.env.SHOT_MS || 400));
  }
  const after = await page.evaluate(async () => {
    const mod = await import("/native-stage.js");
    const rt = mod.nativeStage("s780");
    if (!rt) return { present: false };
    return {
      disabled: rt.rt.disabled,
      objects: rt.rt.world?.objects?.length ?? 0,
      drawCallsThisFrame: rt.rt.drawCalls.map(
        (c) => `${c.method}(${c.args.join(",")})`,
      ),
    };
  });
  console.log("AFTER", JSON.stringify(after, null, 1));
} finally {
  console.log("--- console log ---");
  for (const l of logs) console.log(l);
  await browser.close();
}
