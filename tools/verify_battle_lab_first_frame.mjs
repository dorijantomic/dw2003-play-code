// The Battle Lab's frame loop survives its first frame, and the picture it opens on is the
// shot the enemy chose.
//
// What was wrong: web/battle3d.js render() built its view matrix from `eye`/`look` it had never
// been given. The Battle Lab opens on the real idle camera (the decoded cut director,
// FIGHTSTG_F0x8008718c), whose first arm is the arena shot `[0x100]` — and that shot is read out
// of the fighters' staging records (tools/extract_smdldata.py -> web/assets/battle/
// model_placement.json), which arrive over the network. So on frame one the record was unset,
// mat4LookAt got undefined, and the throw killed the page's own requestAnimationFrame loop: the
// lab was frozen on frame 1 and every tool that drives it through the page saw nothing.
//
// What the original does instead, which is what this checks:
//   * the director OBJECT is created only after both fighters' staging records exist — the
//     fight's setup block (phase 1, sub-state 2) creates the near fighter, the far fighter and
//     THEN the director, each only if its slot is empty (fightstg.s:16136-16162); and
//   * a frame is drawn THROUGH the camera record or not at all: the record is the only source of
//     a view, nothing ever clears it, and both shot loaders leave the staging block untouched
//     when a record is missing (F0x8009257c .L0x800925ac/.L0x800925c8, F0x800923b4 .L0x800923f0).
//
// So this holds the placement table back on the wire and watches the frames that run before it
// lands: no exception, no camera, a dark screen. Then it releases it and checks the shot that
// appears is the enemy's own choice — `[0x100]` reads the far record's +0x44 (a 1-based canned
// shot number) and cuts that shot out of the NEAR side's twelve (F0x8009257c .L0x800925ec,
// F0x800923b4's 6*index eye/look and 2*index H reads).
//
// Server: python3 -m http.server <port> --directory web
// Run:    VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_battle_lab_first_frame.mjs
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.LAB_ROOT || baseUrl(8741);
const OUT = process.env.LAB_SHOT || ".bunny-scratch/battle-lab-first-frame";
mkdirSync(OUT, { recursive: true });

const placement = JSON.parse(readFileSync("web/assets/battle/model_placement.json", "utf8")).models;

/** How long the staging table is held back, in ms — long enough for many frames to run. */
const HOLD_MS = 2500;

// Count every animation frame the page runs, before any module loads, and keep the first frames
// that carry a camera record. The bug being checked is that the loop DIES, which nothing else in
// the page reports; and the record the fight opens on is only on screen for as long as its dwell
// lasts, so the picture has to be caught on the frame it is cut rather than polled for later.
const FRAME_PROBE = () => {
  window.__frames = 0;
  window.__opened = null;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => {
    window.__frames++;
    if (!window.__opened && window.__r) {
      const d = window.__r.__dnaDebug();
      if (d.camRecord) {
        window.__opened = {
          fields: d.camRecord.fields, kind: d.camRecord.kind, issuer: d.camRecord.issuer,
          eye: window.__r.getCameraInfo()?.eye ?? null, H: window.__r.getCameraInfo()?.H ?? null,
          frame: window.__frames,
        };
      }
    }
    return cb(t);
  });
};

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(FRAME_PROBE);

let release = null;
const held = new Promise((res) => { release = res; });
await page.route("**/battle/model_placement.json", async (route) => {
  await held;                       // the staging block has not landed yet
  await route.continue();
});

try {
  await page.goto(`${ROOT}/battle-lab.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__r, null, { timeout: 20_000 });

  // ── Before the staging table lands ──────────────────────────────────────────
  await page.waitForTimeout(HOLD_MS);
  const early = await page.evaluate(() => ({
    frames: window.__frames,
    status: document.getElementById("status")?.textContent ?? "",
    record: window.__r.__dnaDebug().camRecord,
    cam: window.__r.getCameraInfo(),
  }));
  writeFileSync(`${OUT}/1-before.png`, await page.screenshot());
  console.log(`with the staging table held back: ${early.frames} frames drawn, `
              + `status "${early.status}", camera record ${early.record === null ? "unset" : "SET"}`);
  assert.deepEqual(errors, [], "the Battle Lab threw before its staging table landed");
  assert.ok(early.frames > 10,
    `the Battle Lab's frame loop stopped (${early.frames} frames in ${HOLD_MS} ms)`);
  assert.equal(early.record, null,
    "a camera record was installed before the fighters' staging records existed");
  assert.equal(early.cam, null, "a camera was published with no record behind it");

  // ── Release the staging table; the fight opens ─────────────────────────────
  release();
  const folders = await page.evaluate(() => ({
    player: document.getElementById("pModel").value,
    enemy: document.getElementById("eModel").value,
  }));
  // The shot the original cuts, read here from the staging table directly — NOT through the
  // renderer, so the check cannot agree with a renderer that got the decode wrong. `[0x100]`
  // takes the far record's word at +0x44 as a 1-based index into the NEAR record's own arrays
  // (F0x8009257c .L0x800925ec; F0x800923b4's `6*shot` eye/look and `2*shot` H).
  const keyOf = (folder) => String(Number(/^m(\d{3})/.exec(folder)?.[1]));
  const enemyKey = keyOf(folders.enemy), playerKey = keyOf(folders.player);
  const named = placement[enemyKey]?.shot | 0;
  const shotIndex = named - 1;
  const near = placement[playerKey]?.camera;
  assert.ok(named >= 1 && near && shotIndex < near.eye.length,
    `${folders.enemy} names no opening shot (+0x44 = ${placement[enemyKey]?.shot}), so this lab `
    + `matchup has no first frame to check; the default opponent must be a 0x48 record`);
  const want = { eye: near.eye[shotIndex], target: near.look[shotIndex], H: near.view[shotIndex] };
  await page.waitForFunction(() => window.__opened !== null, null, { timeout: 20_000 });
  await page.waitForTimeout(700);
  const live = await page.evaluate(() => ({
    opened: window.__opened, frames: window.__frames, cam: window.__r.getCameraInfo(),
  }));
  writeFileSync(`${OUT}/2-after.png`, await page.screenshot());

  assert.deepEqual(errors, [], "the Battle Lab threw after its staging table landed");
  assert.ok(live.opened, "the fight never cut a camera record once its staging records landed");
  console.log(`the fight opened on frame ${live.opened.frame} of the page`);
  assert.equal(live.opened.kind, "cut", "the opening cut is a cut, not a move or a preset");
  assert.equal(live.opened.issuer, "battle", "the battle's own camera owns the opening shot");
  const got = live.opened.fields;
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  assert.ok(eq(got.slice(0, 6), [...want.eye, ...want.target]),
    `the shot on screen is not the enemy's chosen canned shot.\n  record eye/target ${JSON.stringify(got.slice(0, 6))}`
    + `\n  +0x44 = ${named} names near shot ${shotIndex}: `
    + `${JSON.stringify([...want.eye, ...want.target])}`);
  assert.equal(got[13] | 0, want.H | 0,
    `the projection distance is ${got[13]}, the record's own H is ${want.H}`);
  assert.deepEqual(got.slice(6, 12), [0, 0, 0, 0, 0, 0],
    "the anchor and the three frame angles stay zeroed, so the shot is absolute (F0x800923b4)");
  assert.ok(live.frames > early.frames, "the frame loop stopped again once the fight opened");

  // The drawn eye is the record's own eye mapped into render space (ps1ToRender: ×MODEL_SCALE
  // with Y and Z negated), so the picture is checked against the record rather than trusted.
  const scale = 140 / 400;
  const wantEye = [want.eye[0] * scale, -want.eye[1] * scale, -want.eye[2] * scale];
  assert.ok(live.opened.eye.every((v, i) => Math.abs(v - wantEye[i]) <= 1),
    `the drawn eye ${JSON.stringify(live.opened.eye)} is not the record's ${JSON.stringify(wantEye)}`);
  assert.ok(Math.abs(live.opened.H - want.H) <= 1,
    `the drawn projection distance is ${live.opened.H}, the record's is ${want.H}`);

  console.log(`\nOK: ${early.frames} frames ran with no camera and no exception, and once the `
            + `staging records landed the fight opened on ${folders.enemy}'s own choice — `
            + `near shot ${shotIndex} of ${folders.player}'s ${near.eye.length} `
            + `(H ${want.H}), with ${live.frames - early.frames} more frames after it.`);
} finally {
  await browser.close();
}