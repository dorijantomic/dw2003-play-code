// Follow the s780 opening cutscene (auto-advancing dialogue) and sample the
// wall-screen drivers + stinger effect each second, so the announcement's
// "different TV animation" (SETANIM 801 802 / SETANIM 802 803) can be compared.
//
// Run:  tools/run-playwright.sh tools/probe_s780_opening.mjs [outdir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] || "/tmp/s780-opening";
const SECONDS = Number(process.env.SECONDS || 90);
const DUMP_AT = Number(process.env.DUMP_AT || -1);
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));

async function sample() {
  return page.evaluate(async () => {
    const mod = await import("/native-stage.js");
    const rt = mod.nativeStage("s780");
    if (!rt) return { present: false };
    const objs = (rt.rt.world?.objects ?? []).filter((o) => o.alive);
    const channels = (addr) =>
      [0x50, 0x54, 0x58, 0x5c, 0x60, 0x64, 0x68, 0x6c, 0x70, 0x74].map(
        (off) => rt.rt.mem.read32(addr + off),
      );
    const driver = objs.find((o) => o.cb === 0x800a72b0);
    const stinger = objs.find((o) => o.cb === 0x800a61c8);
    const keys = new Map();
    for (const q of rt.rt.screenQuads)
      keys.set(`${q.texpage}:${q.clut}`, (keys.get(`${q.texpage}:${q.clut}`) || 0) + 1);
    return {
      present: true,
      objects: objs.map((o) => `0x${o.cb.toString(16)}#${o.id}`),
      cc: driver ? channels(driver.addr) : null,
      cc2: (() => {
        const d2 = objs.filter((o) => o.cb === 0x800a72b0)[1];
        return d2 ? channels(d2.addr) : null;
      })(),
      stinger: stinger
        ? { ctr: rt.rt.mem.read32(stinger.addr + 0x50), st: rt.rt.mem.read32(stinger.addr + 0xc) }
        : null,
      quads: rt.rt.screenQuads.length,
      keys: [...keys.entries()].map(([k, n]) => `${k}x${n}`).join(" "),
      disabled: rt.rt.disabled.length,
      textbox: window.__state?.dialogueOpen ?? null,
    };
  });
}

try {
  await page.goto(`${baseUrl(8741)}/?skipTitle=1&map=s780`);
  const style = page.locator("#asset-mode-authentic");
  if (await style.isVisible().catch(() => false)) await style.click();
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 15000 });
  if (process.env.REENENTER !== "0") {
    await page.evaluate(() => {
      const idx = window.__state.manifest.maps.findIndex((m) => m.id === "s780");
      if (idx >= 0) window.__setMap(idx, null);
    });
    await page.waitForTimeout(250);
  }

  for (let s = 0; s < SECONDS; s++) {
    // Advance any open dialogue box; harmless when none is open.
    await page.keyboard.press("Enter");
    await page.waitForTimeout(120);
    await page.keyboard.press("Space");
    const info = await sample();
    console.log(`t=${s}s ${JSON.stringify(info)}`);
    if (s === DUMP_AT) {
      const quads = await page.evaluate(async () => {
        const mod = await import("/native-stage.js");
        const rt = mod.nativeStage("s780");
        return rt.rt.screenQuads.map((q) => ({
          x: [q.x[0], q.x[1], q.x[2], q.x[3]],
          y: [q.y[0], q.y[1], q.y[2], q.y[3]],
          u: [q.u[0], q.u[1], q.u[2], q.u[3]],
          v: [q.v[0], q.v[1], q.v[2], q.v[3]],
          tp: q.texpage,
          cl: q.clut,
          cmd: q.cmd,
        }));
      });
      console.log("QUADS " + JSON.stringify(quads));
    }
    await page.screenshot({ path: `${OUT}/t${String(s).padStart(3, "0")}.png` });
    await page.waitForTimeout(880);
  }
} finally {
  console.log("--- console log ---");
  for (const l of logs.slice(-40)) console.log(l);
  await browser.close();
}
