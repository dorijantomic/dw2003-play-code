// Headless regression for the real s415 stage-entry path. This intentionally
// enters through startGame/checkStageCutscene rather than the debug map picker,
// which does not boot the native stage or fire its automatic event.
//
// TWO PASSES, because this stage has two different things to prove.
//   1. Shipped game, NO ?nativeStages: the boulders. They are translated
//      (engine/systems/falling-object.ts, web/stage-objects.js), so the check
//      proves their frames reach the draw list AND the exact boulder pixels are
//      blitted onto the canvas. A rockfall that only appears under the research
//      flag is the bug this check exists to catch — that was the state before
//      the port, when the MIPS interpreter was the only producer of its frames.
//   2. Research route, ?nativeStages=1: the Bulbmon reveal (SETANIM 811, point
//      record 1) and the scrolling layer, which still run on the interpreter.
//      That pass cannot show boulders, because the translated route consumes
//      their registry ids first.
//
// Run with a web server on port 8742:
//   tools/run-playwright.sh tools/verify_s415.mjs [output-directory]
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const origin = `${baseUrl(8742)}`;
const outDir = resolve(process.argv[2] ?? "/tmp/s415-verification");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const errors = [];
const samples = [];
// Each pass gets its own context from the same seed. The ride sets a story flag
// as it runs, so the second pass must not inherit pass one's flag store or its
// entry cutscene would be skipped.
const SEED = {
  cookies: [],
  origins: [{
    origin,
    localStorage: [
      { name: "engineSchema", value: "2" },
      { name: "progressOrdinal", value: "6" },
      { name: "charId", value: "p003pken" },
      { name: "party", value: JSON.stringify(["p003pken", "p005koet", "p004kogu"]) },
    ],
  }],
};
let page = null;

// The boulder atlas rects for clips 70..77, straight out of the extracted
// point-sprite table. A drawImage of one of these rects is the boulder pixels
// actually reaching the canvas, which is the thing the sweep found missing.
const BOULDER_RECTS = (() => {
  const sprites = JSON.parse(
    readFileSync(new URL("../web/assets/data/point_sprites.json", import.meta.url), "utf8"),
  ).s415.sprites;
  const out = [];
  for (let clip = 70; clip <= 77; clip++) {
    for (const l of sprites[String(clip)] ?? []) out.push({ clip, x: l.x, y: l.y, w: l.w, h: l.h });
  }
  return out;
})();

/**
 * Watch every drawImage for one frame and report the boulder frames the frame
 * actually blitted. `drawStageObjectSprites` (web/effects.js) submits a rock as
 * drawImage(sheet, layer.x, layer.y, layer.w, layer.h, ...), so matching the
 * source rect against the atlas names the clip that reached the canvas.
 */
async function boulderBlits() {
  return page.evaluate(async (rects) => {
    const proto = CanvasRenderingContext2D.prototype;
    const real = proto.drawImage;
    const seen = [];
    proto.drawImage = function (...args) {
      if (args.length === 9) {
        const [, sx, sy, sw, sh] = args;
        const hit = rects.find((r) => r.x === sx && r.y === sy && r.w === sw && r.h === sh);
        if (hit) seen.push({ clip: hit.clip, dx: Math.round(args[5]), dy: Math.round(args[6]) });
      }
      return real.apply(this, args);
    };
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    } finally {
      proto.drawImage = real;
    }
    return seen;
  }, BOULDER_RECTS);
}

async function canvasShot(name, tag) {
  await page.locator("#game").screenshot({ path: resolve(outDir, `${tag}-${name}.png`) });
  const sample = await page.evaluate(async (sampleName) => {
    const { nativeStage } = await import("./native-stage.js");
    const native = nativeStage("s415");
    const point = native?.pointTable;
    const mem = native?.rt?.mem;
    if (!window.__s415ReferenceCanvas) {
      const img = new Image();
      img.src = "assets/maps/s415.png";
      await img.decode();
      const ref = document.createElement("canvas");
      ref.width = 640; ref.height = 480;
      ref.getContext("2d").drawImage(img, 0, 0, 640, 480);
      window.__s415ReferenceCanvas = ref;
    }
    const liveCtx = document.getElementById("game").getContext("2d");
    const refCtx = window.__s415ReferenceCanvas.getContext("2d");
    // Bulbmon occupies this left/lower reveal region. It must match the bare
    // backdrop at arrival and differ materially after SETANIM 811 817.
    const box = [0, 180, 300, 268];
    const livePx = liveCtx.getImageData(...box).data;
    const refPx = refCtx.getImageData(...box).data;
    let delta = 0;
    for (let i = 0; i < livePx.length; i += 4) {
      delta += Math.abs(livePx[i] - refPx[i]);
      delta += Math.abs(livePx[i + 1] - refPx[i + 1]);
      delta += Math.abs(livePx[i + 2] - refPx[i + 2]);
    }
    delta /= (livePx.length / 4) * 3;
    return {
      name: sampleName,
      revealRegionDelta: delta,
      pos: window.__pos?.(),
      camera: window.__cutscene?.camera ? { ...window.__cutscene.camera } : null,
      pointRecords: point && mem ? [0, 1].map((i) => {
        const rec = point + i * 18;
        return {
          active: mem.read8(rec), sprite: mem.read8(rec + 4),
          x: mem.read16s(rec + 10), y: mem.read16s(rec + 12),
          ysort: mem.read16s(rec + 14),
        };
      }) : null,
      drawSprites: native?.rt?.drawCalls?.filter((c) => c.method === "drawSprite")
        .map((c) => c.args) ?? [],
      // The translated stage actors' own draw list (the falling rock).
      rockDraws: window.__stageObjects?.draws("s415") ?? [],
      nativeLoaded: !!native,
    };
  }, name);
  sample.blits = await boulderBlits();
  samples.push({ tag, ...sample });
  return sample;
}

/**
 * Enter s415 through the real stage-entry path and sample the ride until the
 * pre-battle cutscene ends. `query` is what the shipped game is asked for; the
 * two passes differ only there.
 */
async function playRide(query, tag) {
  const story = [];
  const context = await browser.newContext({
    viewport: { width: 900, height: 700 },
    storageState: SEED,
  });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const onConsole = (msg) => {
    const line = msg.text();
    if (line.includes("[STORY]")) story.push(line);
  };
  page.on("console", onConsole);
  try {
    await page.goto(`${origin}/?skipTitle=1&map=s415&noEncounters=1${query}`, {
      waitUntil: "load",
    });
    await page.waitForFunction(() => window.__state?.started && window.__engineBridge, null, {
      timeout: 30_000,
    });
    await page.waitForFunction(() => window.__cutscene?.isActive?.(), null, { timeout: 10_000 });
    assert.equal(await page.locator("#mapSelect").inputValue(), "s415", `${tag}: started on s415`);
    await canvasShot("00-arrival", tag);

    // Advance every dialogue/WAITCTX gate while sampling the rock's own frames
    // between gates. The cutscene remains the authority for its own timing.
    let sample = 1;
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const status = await page.evaluate(() => ({
        cutscene: window.__cutscene?.isActive?.() ?? false,
        textbox: window.__textbox?.isOpen?.() ?? false,
        battle: window.__battle?.isActive?.() ?? false,
      }));
      if (status.battle || !status.cutscene) break;
      if (status.textbox) {
        await canvasShot(`${String(sample++).padStart(2, "0")}-dialogue`, tag);
        await page.keyboard.press("Enter");
      }
      await page.waitForTimeout(350);
      await canvasShot(`${String(sample++).padStart(2, "0")}-motion`, tag);
    }

    const final = await page.evaluate(() => ({
      cutscene: window.__cutscene?.isActive?.() ?? false,
      battle: window.__battle?.isActive?.() ?? false,
    }));
    return { story, final, tag };
  } finally {
    page.off("console", onConsole);
    await context.close();
    page = null;
  }
}

try {
  // Pass 1: the shipped game. No interpreter, no research flag.
  const shipped = await playRide("", "shipped");
  const ship = samples.filter((s) => s.tag === "shipped");
  assert.equal(shipped.final.battle, true, "Bulbmon battle 323 followed the entry cutscene");
  assert.ok(shipped.story.some((line) => line.includes("ENTER s415")), "real stage-entry trace present");
  assert.ok(shipped.story.some((line) => line.includes("01350004")), "s415 PRE event trace present");
  assert.equal(ship.some((s) => s.nativeLoaded && s.drawSprites.length > 0), false,
    "the shipped pass really ran without the MIPS interpreter");

  // Clips 70..77 are the rockfall's whole frame family: wstag415 0x800a7328
  // holds {70,8},{71,8},{72,8},{73,8},{255,0} and 0x800a733c the tail
  // {74,8},{75,8},{76,8},{77,8},{255,0} -- the end marker is clip 255, not -1,
  // and no clip outside 70..77 is named by either run.
  const rockFrames = ship.flatMap((s) => s.rockDraws.map((d) => d.clip));
  assert.ok(
    rockFrames.some((c) => c >= 70 && c <= 77),
    `boulder frames reached the browser draw list (saw ${JSON.stringify([...new Set(rockFrames)])})`,
  );
  const blits = ship.flatMap((s) => s.blits);
  assert.ok(
    blits.some((b) => b.clip >= 70 && b.clip <= 77),
    `boulder pixels reached the canvas (saw ${JSON.stringify([...new Set(blits.map((b) => b.clip))])})`,
  );
  const painted = [...new Set(blits.map((b) => b.clip))].sort((a, b) => a - b);
  // Each clip holds 8 frames but a sample is 350 ms apart, so which members of
  // the family a run catches is timing, not behaviour. What must hold: every
  // blitted frame is inside the decoded family, and both animation runs show
  // (70..73 is the boulder, 74..77 the chips that follow it).
  // The frame-exact comparison is tools/verify_s415_rockfall_oracle.mjs; this
  // pass only proves both runs reach the canvas in normal play.
  assert.ok(painted.some((c) => c >= 70 && c <= 73), `no boulder frame (70..73) in ${JSON.stringify(painted)}`);
  assert.ok(painted.some((c) => c >= 74 && c <= 77), `no chip frame (74..77) in ${JSON.stringify(painted)}`);
  assert.ok(
    painted.every((c) => c >= 70 && c <= 77),
    `no frame outside the decoded family: ${JSON.stringify(painted)}`,
  );
  assert.ok(painted.some((c) => c <= 73), `the boulder run never showed: ${JSON.stringify(painted)}`);
  assert.ok(painted.some((c) => c >= 74), `the chip run never showed: ${JSON.stringify(painted)}`);

  // Pass 2: the research route, which still owns the Bulbmon reveal.
  const native = await playRide("&nativeStages=1", "native");
  const nat = samples.filter((s) => s.tag === "native");
  assert.equal(native.final.cutscene, false, "pre-battle cutscene completed");
  assert.deepEqual(errors, [], `page errors: ${errors.join("; ")}`);
  const reveal = nat.find((s) =>
    s.camera?.x === 216 && s.camera?.y === 373 &&
    s.pointRecords?.[1]?.active === 1 && s.pointRecords[1].sprite === 50
  );
  assert.ok(reveal, "Bulbmon point record was live during the FN6B reveal camera");
  const revealDest = [
    reveal.pointRecords[1].x - (reveal.camera.x - 160) - 56,
    reveal.pointRecords[1].y - (reveal.camera.y - 140) - 104,
  ];
  assert.ok(
    revealDest[0] >= 0 && revealDest[0] < 320 && revealDest[1] >= 0 && revealDest[1] < 240,
    `Bulbmon projected off-screen: ${revealDest}`,
  );
  assert.ok(nat[0].revealRegionDelta < 20, "Bulbmon leaked into the arrival composition");
  assert.ok(
    nat.some((s) =>
      s.camera?.x === 216 &&
      s.revealRegionDelta > nat[0].revealRegionDelta + 20
    ),
    "Bulbmon never became visibly distinct from the backdrop",
  );

  const report = {
    outDir, final: native.final, shipped: shipped.final,
    boulderClips: painted, boulderBlits: blits.length, errors, samples,
  };
  await writeFile(resolve(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true, outDir, final: native.final, boulderClips: painted,
    boulderBlits: blits.length, sampleCount: samples.length,
  }, null, 2));
} finally {
  await browser.close();
}
