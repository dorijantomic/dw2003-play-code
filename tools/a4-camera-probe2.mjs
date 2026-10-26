#!/usr/bin/env node
// a4-camera-probe2.mjs — why is a giant extra partner framed too close in the real battle?
// Loads the real page with one species as the lead partner, starts a field battle, and
// reports the near-camera decision the renderer would make: rest size, chosen reference,
// fit scale k and the camera it produces; plus a canvas frame of the command-menu shot.
// Usage: tools/run-playwright.sh tools/a4-camera-probe2.mjs --port 8104 --species 144 --folder m441raiz
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const PORT = Number(arg("port", 8104));
const ROOT = `http://localhost:${PORT}`;
const species = Number(arg("species", 144));
const folder = arg("folder", "m441raiz");
const OUT = "/home/dorij/scratch-research/anim-sheets";

const member = (digimonId) => ({
  digimonId, level: 40, xp: 0, tp: 30, hp: 1200, maxHp: 1200, mp: 400, maxMp: 400,
  stats: { str: 200, def: 120, spt: 90, wis: 90, spd: 90, chr: 30 },
  bonuses: {}, elemBonuses: {},
  equippedForms: [digimonId, 0, 0],
  formLedger: [{ id: digimonId, formLevel: 5, dvexp: 0, techSlots: [156, 0, 0, 0, 0, 0] }],
});

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
await context.addInitScript((seed) => {
  localStorage.clear();
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("progressOrdinal", "3");
  localStorage.setItem("playerName", "Review");
  localStorage.setItem("charId", "p005koet");
  localStorage.setItem("party", JSON.stringify(["p005koet"]));
  localStorage.setItem("packId", "B");
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", JSON.stringify([{ id: 43, qty: 5 }]));
  localStorage.setItem("partnerStats", JSON.stringify(seed));
  localStorage.setItem("partyStats", JSON.stringify([seed]));
  localStorage.setItem("equipment", JSON.stringify([{}]));
}, member(species));
const page = await context.newPage();
page.on("pageerror", (e) => console.error("PAGEERROR", e.message));
await page.goto(`${ROOT}/?skipTitle=1&map=s320&noEncounters=1`, { waitUntil: "load", timeout: 90_000 });
await page.waitForFunction(() => window.__state?.started, null, { timeout: 60_000 });
for (let i = 0; i < 20; i++) {
  const open = await page.evaluate(() => window.__textbox?.isOpen?.() ?? false);
  if (!open) break;
  await page.keyboard.press("Enter"); await page.waitForTimeout(150);
}
console.log("learned:", await page.evaluate(() => window.__extraRoster?.learnAll?.() ?? -1));
await page.evaluate(() => window.__fieldToBattle?.());
await waitForCommandMenu(page, { timeout: 60_000 });
await page.waitForTimeout(1400);

const frame = await page.evaluate(() => {
  const c = document.querySelector("canvas#game");
  return c ? c.toDataURL("image/png") : null;
});
if (frame) {
  const f = `${OUT}/a4-camera-${folder}-menu.png`;
  writeFileSync(f, Buffer.from(frame.split(",")[1], "base64"));
  console.log("menu canvas frame:", f);
}

const probe = await page.evaluate(async (folderName) => {
  const mod = await import("/battle3d.js");
  const table = (await (await fetch("assets/battle/model_placement.json")).json()).models;
  const sizes = (await (await fetch("assets/battle/camera_ref_sizes.json")).json()).sizes;
  const anim = window.__battle3d?.playerAnimator;
  const model = anim?.model ?? null;
  const key = mod.modelKeyFromFolder(folderName);
  const rec = table[key];
  const rest = model ? mod.modelRestSize(model) : null;
  let aabb = null;
  if (model) {
    const { mats } = mod.buildBoneWorldMatrices(model, anim.currentFrame(), null);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let b = 0; b < model.bones.length; b++) {
      const m = mats[b];
      const px = m[12], py = m[13], pz = m[14];
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
      if (pz < z0) z0 = pz; if (pz > z1) z1 = pz;
    }
    aabb = { h: y1 - y0, w: x1 - x0, d: z1 - z0, y0, y1, x0, x1 };
  }
  const own = rest ? Math.max(rest.h, 0.5 * rest.w) : null;
  const pick = mod.closestCameraRef(sizes, rest, table);
  const refRec = pick ? table[pick.key] : null;
  const refFrame = pick ? Math.max(pick.h, 0.5 * pick.w) : null;
  const kRaw = (own && refFrame) ? own / refFrame : null;
  const k = kRaw != null ? Math.min(3, Math.max(0.5, kRaw)) : null;
  let fitted = null;
  if (refRec?.camera && own && refFrame) {
    const refSlot = mod.arenaSlot(refRec, "player");
    const ownSlot = mod.arenaSlot(rec, "player");
    const cam = mod.fitNearCamera(refRec.camera, refSlot, ownSlot, k);
    fitted = { eye0: cam.eye[0], look0: cam.look[0], view0: cam.view[0],
      refEye0: refRec.camera.eye[0], refLook0: refRec.camera.look[0], refView0: refRec.camera.view[0],
      refSlot, ownSlot };
  }
  const plain = mod.nearCameraFor(table, key);
  return {
    key, recEye: rec?.camera?.eye?.length ?? null, standoff: rec?.standoff,
    rest, own, idleAabb: aabb, pick, refFrame, kRaw, k, fitted,
    plainEye: plain ? plain.eye?.[0] : null, plainLen: plain ? plain.eye?.length : null,
  };
}, folder);
console.log(JSON.stringify(probe, null, 1));
await browser.close();
