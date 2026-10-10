// The post-battle win screen's right-hand bars are a partner's DIGIVOLUTIONS.
// A partner banks digivolve EXP against its own base form too, so its base sat
// in the same ledger the bars are built from and took the first bar.  This
// script builds the rows through the real builder and captures the screen.
//
// This exercises the HAND-AUTHORED screen (web/fightreport.js): the native
// pro/stfgtrep route is the default now (tools/verify_native_report.mjs), so
// this verifier asks for the ?legacyReport=1 rollback.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/fightreport-forms";
mkdirSync(out, { recursive: true });

const b = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html?legacyReport=1`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });

await p.click('[data-scr="fightreport"]');
const frame = p.frames().find((f) => f.url().includes("index.html"));
const canvas = await frame.$("canvas");
await p.waitForFunction(async () => {
  const screen = await import("./screenpack.js");
  const font = await import("./uifont.js");
  return screen.packReady(screen.loadPack("stfrpt")) && font.fontReady();
}, null, { timeout: 30000 });

async function openReport(keepBase) {
  return frame.evaluate(async (keepBase) => {
    const { buildFightReportRows } = await import("./battle.js");
    const profiles = {
      1: { name: "Kotemon" }, 30: { name: "Dinohumon" }, 31: { name: "Greymon" },
    };
    const roster = [{
      rookieId: 1, name: "Kotemon",
      stats: {
        level: 4, xp: 278,
        formLedger: [{ id: 1, formLevel: 4 }, { id: 30, formLevel: 3 }, { id: 31, formLevel: 1 }],
      },
    }];
    const rows = buildFightReportRows(roster, [], profiles, {});
    if (keepBase) {
      rows[0].forms = [{ id: 1, name: "Kotemon", level: 4 },
        { id: 30, name: "Dinohumon", level: 3 }, { id: 31, name: "Greymon", level: 1 }];
    }
    // The lab button opens a default report first. Close it so both captures
    // begin from the same state instead of inheriting different row phases.
    window.__labFightReport.close();
    window.__labFightReport.open({
      rows, rewardXp: 268,
      pages: [{ kind: "bits", value: 645, message: "645 Bits" }],
    });
    return rows[0].forms.map((f) => f.name);
  }, keepBase);
}

async function waitForSettledReport() {
  await p.waitForFunction(() => {
    const report = document.getElementById("game")?.contentWindow?.__labFightReport;
    return report?._open && report.rowPhase?.[0] === 5 && report.vsync >= 60;
  }, null, { timeout: 10000 });
  await frame.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  return frame.evaluate(() => {
    const report = window.__labFightReport;
    return {
      open: report._open,
      rowPhase: [...report.rowPhase],
      pageIndex: report.pageIndex,
      vsync: report.vsync,
      row: structuredClone(report.rows[0]),
      page: structuredClone(report.pages[0]),
    };
  });
}

async function captureCanvas(path, baseline = false) {
  // A compositor screenshot can catch the live canvas between draw calls.
  // Paint once through the real report renderer and serialise on the page's
  // main thread so the proof contains one complete frame.
  const capture = await canvas.evaluate((node, baseline) => {
    const clean = document.createElement("canvas");
    clean.width = node.width;
    clean.height = node.height;
    const ctx = clean.getContext("2d");
    const calls = [];
    const drawImage = ctx.drawImage.bind(ctx);
    ctx.drawImage = (...args) => {
      calls.push(args.slice(1).map((value) => Number(value)));
      drawImage(...args);
    };
    window.__labFightReport.draw(ctx, clean.width, clean.height);
    const pixels = ctx.getImageData(0, 0, clean.width, clean.height).data;
    let diff = null;
    if (baseline) {
      window.__fightReportProofPixels = new Uint8ClampedArray(pixels);
    } else {
      const before = window.__fightReportProofPixels;
      let minX = clean.width;
      let minY = clean.height;
      let maxX = -1;
      let maxY = -1;
      let changed = 0;
      for (let y = 0; y < clean.height; y++) {
        for (let x = 0; x < clean.width; x++) {
          const i = (y * clean.width + x) * 4;
          if (pixels[i] === before[i]
              && pixels[i + 1] === before[i + 1]
              && pixels[i + 2] === before[i + 2]) continue;
          changed += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      diff = { changed, bbox: changed ? [minX, minY, maxX + 1, maxY + 1] : null };
    }
    return { png: clean.toDataURL("image/png"), calls, diff };
  }, baseline);
  writeFileSync(path, Buffer.from(capture.png.slice(capture.png.indexOf(",") + 1), "base64"));
  return capture;
}

// A Kotemon that has fought: its own base record is in the ledger beside the
// two digivolutions it has learned.  `keepBase` reproduces the old behaviour.
const before = await openReport(true);
const beforeState = await waitForSettledReport();
const beforeCapture = await captureCanvas(`${out}/before.png`, true);

const result = await openReport(false);
const afterState = await waitForSettledReport();
const afterCapture = await captureCanvas(`${out}/after.png`);

console.log("before bars:", JSON.stringify(before));
console.log("after  bars:", JSON.stringify(result));
console.log("before state:", JSON.stringify(beforeState));
console.log("after  state:", JSON.stringify(afterState));
console.log("draw calls:", beforeCapture.calls.length, "before,", afterCapture.calls.length, "after");
console.log("pixel diff:", JSON.stringify(afterCapture.diff));
if (JSON.stringify(before) !== JSON.stringify(["Kotemon", "Dinohumon", "Greymon"])) {
  console.log("FAIL: before capture does not reproduce the old three bars");
  process.exitCode = 1;
} else if (JSON.stringify(result) !== JSON.stringify(["Dinohumon", "Greymon"])) {
  console.log("FAIL: after capture does not show only learned forms");
  process.exitCode = 1;
} else if (!afterCapture.diff?.changed
    || afterCapture.diff.bbox[0] < 270 || afterCapture.diff.bbox[1] < 80
    || afterCapture.diff.bbox[2] > 580 || afterCapture.diff.bbox[3] > 170) {
  console.log("FAIL: pixels outside the three digivolution bars changed");
  process.exitCode = 1;
} else console.log("OK: the base holds the plate only");
await b.close();
