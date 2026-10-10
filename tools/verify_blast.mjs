// Headless visual verification of the Blast digivolution transformation.
//
//   npm run pw tools/verify_blast.mjs
//
// Serves nothing itself: point LAB_URL at a running web/ server, or let it use
// the default port below. Captures one screenshot per decoded phase boundary so
// the result can be laid beside the runtime contact sheets in
// docs/research/battle/captures/blast-presentation-2026-07-14/.
//
// Launch goes through `import { chromium } from "playwright"` with no
// executablePath, per CLAUDE.md — tools/run-playwright.sh supplies the userspace
// NSS/NSPR bundle this box needs.

import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const base = process.env.LAB_URL || `${baseUrl(8743)}/battle-test.html`;
// Which of the three sequences on the shared presentation manager to capture.
const SCREEN = process.env.SCREEN || "blast";
const url = new URL(base);
url.searchParams.set("autostart", "1");
url.searchParams.set("screen", SCREEN);
const outDir = process.env.OUT_DIR || `/tmp/${SCREEN}-browser`;
await mkdir(outDir, { recursive: true });

// One capture inside each captured phase, plus the frame just before the start
// and the frame after the end. Frame numbers are the capture's own.
const SHOT_SETS = {
  // Sequence 0x61 — the fully captured one, f24..f880.
  blast: [
    { frame: 0, tag: "00-before" },
    { frame: 100, tag: "01-push-in" },
    { frame: 250, tag: "02-vortex" },
    { frame: 330, tag: "03-ignite" },
    { frame: 400, tag: "04-wireframe" },
    { frame: 500, tag: "05-data-burst" },
    { frame: 566, tag: "06-flash-peak" },
    { frame: 630, tag: "07-resolve" },
    { frame: 720, tag: "08-second-fire" },
    { frame: 850, tag: "09-wind-down" },
  ],
  // Sequence 0x62 — the de-digivolution, 326 captured frames.
  revert: [
    { frame: 0, tag: "00-commit" },
    { frame: 60, tag: "01-breakdown" },
    { frame: 140, tag: "02-wireframe" },
    { frame: 190, tag: "03-flash" },
    { frame: 250, tag: "04-resolve" },
    { frame: 310, tag: "05-wind-down" },
  ],
  // Sequence 0x37 + the per-Digimon sequence — 739 captured frames.
  manualdv: [
    { frame: 0, tag: "00-commit" },
    { frame: 120, tag: "01-push-in" },
    { frame: 220, tag: "02-vortex" },
    { frame: 300, tag: "03-ignite" },
    { frame: 390, tag: "04-wireframe" },
    { frame: 500, tag: "05-data-burst" },
    { frame: 545, tag: "06-flash" },
    { frame: 640, tag: "07-resolve" },
    { frame: 710, tag: "08-wind-down" },
  ],
};
const SHOTS = SHOT_SETS[SCREEN];
if (!SHOTS) { console.error(`unknown SCREEN=${SCREEN}`); process.exit(1); }

const browser = await chromium.launch({
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist", "--enable-webgl"],
});

const errors = [];
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => errors.push("JS: " + e.message));
  page.on("response", (res) => {
    // slot_map.json is an OPTIONAL per-model file that no shipped model has
    // (`ls web/assets/battle/models/*/slot_map.json` = 0); the loader probes for
    // it and falls back. Its 404 fires for every battle capture and predates
    // this script, so it is not a failure here.
    if (res.status() >= 400 && !/favicon|slot_map\.json/i.test(res.url()))
      errors.push(`HTTP ${res.status()} ${res.url()}`);
  });
  await page.goto(url.href, { waitUntil: "load" });

  // Wait for the transformation to actually start.
  await page.waitForFunction(() => !!window.__battleB?.()?.blastShow, { timeout: 40000 });

  // The lab stretches #c with CSS, so element screenshots come back portrait
  // while the game actually renders 640x480 landscape. Pin the CSS box to the
  // backing store so the capture is the frame the game composed, not a squashed
  // version of it — the first pass judged framing against the distorted image.
  await page.evaluate(() => {
    const c = document.getElementById("c");
    c.style.width = c.width + "px";
    c.style.height = c.height + "px";
    c.style.maxWidth = "none";
    c.style.maxHeight = "none";
  });
  const canvas = page.locator("#c");

  // Bank the HP the presentation starts with, so "did it heal?" can be answered
  // for every program rather than only when the bar happens to start full.
  let hpAtStart = await page.evaluate(() => window.__battleB?.()?.player?.hp ?? null);

  for (const shot of SHOTS) {
    // SEEK rather than poll. Waiting for the live counter to pass a frame
    // overshot badly — a "flash peak" request at f566 was photographed at f650,
    // by which time the flash is over — because the presentation advances far
    // faster than the polling interval. Assigning the frame and letting exactly
    // one animation tick render puts the capture where it was asked for.
    // REALTIME=1 lets the presentation and the effect instances advance together
    // on the wall clock. Seeking moves only the presentation frame; the effect
    // channel streams step in real time, so a seek shows their sprites at
    // whatever scale they had reached, not the scale that frame should have.
    if (shot.frame > 0 && !process.env.REALTIME) {
      // A short program can finish while the previous screenshot is being
      // taken — the revert is only 326 frames (~5.4 s) and six shots cost more
      // wall clock than that. Re-arm it through the same real entry point
      // before seeking, so every shot has a live presentation to seek within.
      await page.evaluate((hook) => {
        if (!window.__battleB?.()?.blastShow) window[hook]?.();
      }, { blast: "__battleBlast", revert: "__battleRevert", manualdv: "__battleDv" }[SCREEN]);
      await page.evaluate((f) => {
        const b = window.__battleB?.();
        if (b?.blastShow) b.blastShow.frame = f;
      }, shot.frame);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      // Re-seek after the render. The lab clamps its frame delta at 250 ms, so a
      // single tick can advance ~15 capture frames and two can overrun a short
      // program's end — which is how the revert's last shot came back as
      // "(not running)". The pixels are from the first seek; this keeps the
      // reported frame honest about where they were taken.
      await page.evaluate((f) => {
        const b = window.__battleB?.();
        if (b?.blastShow) b.blastShow.frame = f;
      }, shot.frame);
    }
    const state = await page.evaluate(() => {
      const b = window.__battleB?.();
      const s = b?.blastShow?.state;
      return s ? {
        frame: Math.round(b.blastShow.frame), phase: s.phase,
        vo: +s.voidAlpha.toFixed(2), rb: +s.ribbonAlpha.toFixed(2),
        fire: +s.fireIntensity.toFixed(2), wire: +s.wireframeAlpha.toFixed(2),
        hex: +s.hexagramAlpha.toFixed(2), flash: +s.flashAlpha.toFixed(2),
        solid: +s.solidAlpha.toFixed(2), healed: s.healed,
        hp: b.player?.hp, maxHp: b.player?.maxHp,
        fx: window.__battle3d?.getEffectDraw?.()?.list?.length ?? null,
      } : { frame: null, phase: "(not running)", hp: b?.player?.hp };
    });
    await canvas.screenshot({ path: `${outDir}/blast-${shot.tag}.png` });
    console.log(shot.tag.padEnd(16), JSON.stringify(state));
  }

  // The heal must have landed by the end, and the run must finish on its own.
  await page.waitForFunction(() => !window.__battleB?.()?.blastShow, { timeout: 40000 })
    .catch(() => { errors.push("presentation never finished"); });
  const end = await page.evaluate(() => {
    const b = window.__battleB?.();
    return { running: !!b?.blastShow, hp: b?.player?.hp, maxHp: b?.player?.maxHp };
  });
  console.log("end:", JSON.stringify(end));
  // Only Blast-on heals. The captures record NO heal at revert, and manual DV
  // leaves every live combat value in place — so asserting a full bar for those
  // two would pin the opposite of what the disc does.
  if (SCREEN === "blast" && end.hp !== end.maxHp) {
    errors.push(`heal did not land: ${end.hp}/${end.maxHp}`);
  }
  if (SCREEN !== "blast" && hpAtStart != null && end.hp !== hpAtStart) {
    errors.push(`${SCREEN} changed HP ${hpAtStart} -> ${end.hp}; its capture records no heal`);
  }

  console.log("page errors:", errors.length ? errors.join(" ;; ") : "none");
  console.log("WROTE", outDir);
  failed = errors.length > 0;
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
