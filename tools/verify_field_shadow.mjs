// Headless visual check for the field character drop shadow, rendered by the
// real web/game.js through the web/ui-lab.html harness (no mock renderer).
//
// It measures the live canvas the way the decode doc measured the five
// authority-1 s415 reference captures (docs/research/field/character-drop-
// shadow-decoded-2026-07-27.md §10.3): pixels coloured exactly
// RGB(0x30,0x30,0x38), per row.
//
// The expected silhouette is derived at run time from the shipped texture
// web/assets/ui/field_shadow.png, so a texture regression fails here instead of
// being re-asserted against a hand-copied table.
//
// What is asserted, all against the rect engine/systems/field-shadow.ts predicts
// for the actor's own world position:
//   1. The player is moved to a fixed open-ground spot. Every shadow row at or
//      below the actor's own BILLBOARD BOTTOM must reproduce the texture
//      exactly, pixel for pixel. That bottom is the original's own rule, not a
//      guess: the renderer puts the quad's bottom row at the actor's own screen
//      row plus the frame's registered Y offset and the frame's height
//      (fieldstg.s:12919-12940, engine/systems/field-billboard-anchor.ts), which
//      is `frameBottomShift` in the shipped manifest. Nothing but a geometry
//      error can disturb the rows below it.
//   2. No shadow-coloured pixel anywhere in the rect may fall outside the
//      texture's opaque footprint — a shifted, scaled or stretched shadow fails.
//   3. Rows ABOVE that bottom must show the billboard punched through them:
//      that is what "drawn one OT bucket behind the actor" looks like.
//   3b. The shadow's bottommost opaque row must stay exact for EVERY actor. The
//      QUAD bottom does pass it for several packs (Kotemon registers +7, Renamon
//      +8, against an ellipse whose last opaque row sits +4), because those
//      textures carry transparent rows below their art — so this is a pixel
//      assertion about where the opaque content stops, not arithmetic on the
//      registration, and it is what fails if a frame is drawn a row too low.
//   4. web/assets/ref/s415_bulbmon_dialogue_ref.png — the original capture,
//      loaded into the same page and measured with the same colour test — must
//      still be that same silhouette.
//
// Rows that do not match are CLASSIFIED, not excused: the tool reads back the
// colour of whatever covers the missing pixels and reports it, because occlusion
// and a geometry error are otherwise indistinguishable from a pixel count.
//
// Run with a web server on port 8742:
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_field_shadow.mjs [output-directory]
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { fieldShadowRect } from "../web/vendor/engine.js";
import { baseUrl } from "./verify-base-url.mjs";

// The disc's own vertical registration per sprite, as build_assets.py baked it
// out of the frame lists' record word 4 plus each frame's own height. Read from
// the shipped manifest so the boundary below is the ORIGINAL's number and not the
// renderer's; tests/field-billboard-anchor.test.js is what proves each of those
// numbers equals the pack's decodable frame list (E0 + E6).
const manifest = JSON.parse(
  readFileSync(new URL("../web/assets/manifest.json", import.meta.url), "utf8"));
const maxBottomShift = new Map();
for (const sprite of [...manifest.characters, ...manifest.npcs]) {
  let max = null;
  for (const shifts of Object.values(sprite.frameBottomShift ?? {})) {
    for (const v of shifts) max = max === null ? v : Math.max(max, v);
  }
  if (max !== null) maxBottomShift.set(sprite.id, max);
}

// Deterministic open-ground spot on the field the lab boots into
// (index.html?skipTitle=1), chosen because nothing in the map's foreground
// overlay layer covers the shadow rect there — so the assertions below are about
// the renderer, not about wherever the player happened to be standing.
const PLAYER_PROBE = { x: 968, y: 232 };

const outDir = resolve(process.argv[2] ?? "/tmp/field-shadow-verification");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await page.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const frame = page.frames().find((f) => f.url().includes("index.html"));

// ── Pass 1: the expected silhouette, the reference capture, and the scene ──
const scene = await frame.evaluate(async (probe) => {
  const loadPixels = async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
  };

  // Expected silhouette, derived from the shipped texture: an opaque mask plus
  // the [left, span] of every non-empty row.
  const tex = await loadPixels("assets/ui/field_shadow.png");
  const texMask = [];
  const textureRows = [];
  for (let y = 0; y < tex.h; y++) {
    let lo = -1, hi = -1;
    for (let x = 0; x < tex.w; x++) {
      const opaque = tex.data[(y * tex.w + x) * 4 + 3] !== 0;
      texMask.push(opaque);
      if (!opaque) continue;
      if (lo < 0) lo = x;
      hi = x;
    }
    if (lo >= 0) textureRows.push({ row: y, left: lo, span: hi - lo + 1 });
  }

  // The original capture, measured with the same colour test (native 1x).
  const ref = await loadPixels("assets/ref/s415_bulbmon_dialogue_ref.png");
  const refRows = [];
  for (let y = 0; y < ref.h; y++) {
    let lo = -1, hi = -1;
    for (let x = 0; x < ref.w; x++) {
      const i = (y * ref.w + x) * 4;
      if (ref.data[i] !== 0x30 || ref.data[i + 1] !== 0x30 || ref.data[i + 2] !== 0x38) continue;
      if (lo < 0) lo = x;
      hi = x;
    }
    if (lo >= 0) refRows.push(hi - lo + 1);
  }

  window.__state.x = probe.x;
  window.__state.y = probe.y;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  return {
    cam: window.__lastCam,
    texW: tex.w, texMask, textureRows, refRows,
    actors: (window.__lastAnimDebug ?? []).map((d) => ({
      label: d.label, x: d.x, y: d.y, sprite: d.sprite,
    })),
  };
}, PLAYER_PROBE);

await page.locator("#game").screenshot({ path: resolve(outDir, "field.png") });

const { zoom } = scene.cam;
console.log(`camera ${JSON.stringify(scene.cam)}`);
console.log(`texture rows (derived from field_shadow.png): ${
  scene.textureRows.map((r) => `${r.row}:${r.left}+${r.span}`).join(" ")}`);
console.log(`reference capture rows: ${scene.refRows.join(", ")}`);

// The extracted texture must still be the 25x11 ellipse every comparison is against.
assert.equal(scene.textureRows.length, 11, "texture no longer has 11 opaque rows");
assert.equal(Math.max(...scene.textureRows.map((r) => r.span)), 25);
// ...and the original capture must still be that same silhouette. Only its last
// 9 rows are unoccluded (decode §10.3: rows 106-114 = texture rows 4-12).
assert.deepEqual(
  scene.refRows.slice(-9), scene.textureRows.map((r) => r.span).slice(2),
  "reference capture no longer matches the extracted texture",
);

// ── Pass 2: measure each actor against its engine-predicted rect ──
const texH = scene.texMask.length / scene.texW;
const probes = scene.actors.map((a) => {
  const rect = fieldShadowRect({ screenX: a.x - scene.cam.x, actorScreenY: a.y - scene.cam.y });
  // INDEPENDENT ANCHOR. Everything below measures the render against `rect`, so
  // without this the whole check would be self-consistent: change the engine's
  // formula and the expected pixels move with it (verified — a deliberate +2 row
  // offset in the engine still "passed" before this was added). The decode says
  // the sprite is centred on the actor's own ground point, so re-derive the rect
  // from the ACTOR's position and the texture's own dimensions and require the
  // engine to agree. This duplication is the point of an oracle, and it is why
  // the tool can catch an engine regression at all.
  const anchor = {
    x: Math.round(a.x - scene.cam.x) - scene.texW / 2,
    y: Math.round(a.y - scene.cam.y) - texH / 2,
    w: scene.texW,
    h: texH,
  };
  assert.deepEqual(
    rect, anchor,
    `${a.label}: the engine's shadow rect is not the texture centred on the actor's ground point`,
  );
  // The original's billboard bottom row, from the disc's own registration:
  // the actor's screen row + (frame-list word 4 + the frame's texture height).
  // The MAX over the sprite's rows and frames is used, so the boundary below is
  // the lowest row ANY of its frames can reach.
  const shift = maxBottomShift.get(a.sprite);
  assert.equal(typeof shift, "number",
    `${a.label} (${a.sprite}): no per-frame vertical registration in the manifest`);
  return {
    label: a.label,
    rect,
    shift,
    billboardBottomY: Math.round(a.y - scene.cam.y) + shift,
  };
});

const measured = await frame.evaluate(async (input) => {
  const { probes, textureRows, texMask, texW, zoom, probe, actors } = input;
  // Re-pin the probe position and let two frames render, then confirm the scene
  // is still the one the rects were computed from — an actor walked by a cutscene
  // between the passes would otherwise be compared against stale geometry.
  window.__state.x = probe.x;
  window.__state.y = probe.y;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const now = (window.__lastAnimDebug ?? []).map((d) => ({ label: d.label, x: d.x, y: d.y }));
  const drifted = now.length !== actors.length || now.some((d, i) =>
    d.label !== actors[i].label || d.x !== actors[i].x || d.y !== actors[i].y);

  const canvas = document.getElementById("game");
  const width = canvas.width;
  const px = canvas.getContext("2d").getImageData(0, 0, width, canvas.height).data;
  const at = (x, y) => {
    const i = (y * width + x) * 4;
    return [px[i], px[i + 1], px[i + 2]];
  };
  const isShadow = (x, y) => {
    const [r, g, b] = at(x, y);
    return r === 0x30 && g === 0x30 && b === 0x38;
  };
  const texRowCount = texMask.length / texW;

  const rows = probes.map(({ label, rect, shift, billboardBottomY }) => {
    const measuredRows = [];
    for (const texRow of textureRows) {
      // EVERY device row of the texel row is checked, not just the first: at
      // zoom 2 each texture row paints two of them.
      for (let k = 0; k < zoom; k++) {
        const deviceY = (rect.y + texRow.row) * zoom + k;
        const x0 = (rect.x + texRow.left) * zoom;
        const x1 = x0 + texRow.span * zoom - 1;
        let lo = -1, hi = -1, count = 0;
        const covers = new Map();
        for (let x = x0; x <= x1; x++) {
          if (isShadow(x, deviceY)) {
            if (lo < 0) lo = x;
            hi = x;
            count++;
          } else {
            const key = at(x, deviceY).join(",");
            covers.set(key, (covers.get(key) ?? 0) + 1);
          }
        }
        const expectedCount = x1 - x0 + 1;
        measuredRows.push({
          texRow: texRow.row, deviceY, count, expectedCount,
          // At or below the billboard's own bottom row the actor's sprite
          // cannot reach, by the original's rule.
          belowBillboard: deviceY >= billboardBottomY * zoom,
          status: count === expectedCount ? "exact"
            : count === 0 ? "absent"
            : lo === x0 && hi === x1 ? "interior-hole"
            : "edge-covered",
          covers: [...covers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
        });
      }
    }

    // Any shadow-coloured pixel inside the rect that is NOT part of the
    // texture's footprint: a shifted, scaled or stretched shadow shows up here.
    let outside = 0;
    for (let dy = 0; dy < texRowCount * zoom; dy++) {
      for (let dx = 0; dx < texW * zoom; dx++) {
        if (!isShadow(rect.x * zoom + dx, rect.y * zoom + dy)) continue;
        if (!texMask[Math.floor(dy / zoom) * texW + Math.floor(dx / zoom)]) outside++;
      }
    }
    return { label, rect, shift, rows: measuredRows, outside };
  });

  return { drifted, now, actors: rows };
}, {
  probes, textureRows: scene.textureRows, texMask: scene.texMask, texW: scene.texW,
  zoom, probe: PLAYER_PROBE, actors: scene.actors,
});

assert.equal(
  measured.drifted, false,
  `actors moved between the two passes: ${JSON.stringify(measured.now)} vs ${JSON.stringify(scene.actors)}`,
);

const tally = (rows, s) => rows.filter((r) => r.status === s).length;
const describe = (rows) => {
  const all = new Map();
  for (const r of rows) for (const [c, n] of r.covers) all.set(c, (all.get(c) ?? 0) + n);
  return [...all.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([c, n]) => `rgb(${c})x${n}`).join(", ") || "nothing";
};
const rowLabel = (r) =>
  `${r.status} at texture row ${r.texRow} (device y ${r.deviceY}, ${r.count}/${r.expectedCount} px` +
  `${r.belowBillboard ? ", below the billboard bottom" : ""}, covered by ${describe([r])})`;

let player = null;
for (const actor of measured.actors) {
  console.log(
    `${actor.label}: rect ${JSON.stringify(actor.rect)} logical px, billboard bottom +${actor.shift} rows; ` +
    `${actor.rows.length} device rows checked — ${tally(actor.rows, "exact")} exact, ` +
    `${tally(actor.rows, "interior-hole")} punched through by the billboard, ` +
    `${tally(actor.rows, "edge-covered")} covered at an edge, ` +
    `${tally(actor.rows, "absent")} absent; ${actor.outside} stray px outside the texture footprint`,
  );
  for (const r of actor.rows.filter((r2) => r2.status === "edge-covered" || r2.status === "absent")) {
    // Classified, not excused: say what is actually on top of those pixels.
    console.log(`  ${actor.label}: ${rowLabel(r)}`);
  }
  if (actor.label === "YOU") player = actor;
}

assert.ok(player, "the player was not among the drawn actors");

// 1. Every player row at or below the billboard's bottom must be pixel-exact.
const belowBillboard = player.rows.filter((r) => r.belowBillboard);
assert.ok(belowBillboard.length >= 1,
  `no device row falls below the billboard's bottom (+${player.shift} rows)`);
assert.deepEqual(
  belowBillboard.filter((r) => r.status !== "exact").map(rowLabel), [],
  "player shadow rows below the billboard's bottom do not match the extracted texture",
);

// 2. Nothing outside the texture's footprint.
assert.equal(player.outside, 0, "shadow pixels fall outside the texture footprint");

// 3. Draw order: the billboard must punch through the rows above its bottom.
assert.ok(
  player.rows.some((r) => !r.belowBillboard && r.status !== "exact"),
  "the billboard does not occlude the shadow at all — it is not drawn behind the actor",
);

// 3b. The far rim of the shadow survives every actor: the ellipse's last opaque
// row sits 4 rows below the ground row (rect.y = groundRow - 8, last row 12), so
// the actor's own opaque content must stop above it whatever its quad does.
const rimRow = scene.textureRows[scene.textureRows.length - 1].row;
for (const actor of measured.actors) {
  const rim = actor.rows.filter((r) => r.texRow === rimRow);
  assert.ok(rim.length > 0, `${actor.label}: the shadow's last row was never checked`);
  assert.deepEqual(
    rim.filter((r) => r.status !== "exact").map(rowLabel), [],
    `${actor.label}: the shadow's far rim (+${rimRow - 8} rows) is covered by its own sprite, ` +
    `though its quad bottom is +${actor.shift}`,
  );
}

assert.deepEqual(errors, [], "page errors");
console.log(
  `OK — the player's ${belowBillboard.length} unoccludable device rows (at or below its own ` +
  `billboard bottom, +${player.shift} rows from the ground row) match the shipped texture ` +
  `exactly at the engine's rect, no stray pixels, the billboard occludes the rest, and every ` +
  `actor's shadow keeps its far rim.`,
);
console.log(`Screenshot: ${resolve(outDir, "field.png")}`);
await browser.close();
