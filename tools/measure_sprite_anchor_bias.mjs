// Measures each actor's sprite content-center vs its shadow center on the live
// canvas, against the same quantity measured on the authority-1 s415 reference
// captures (docs/research/field/character-drop-shadow-decoded-2026-07-27.md §5:
// original bias -0.46px for the player). Run:
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/measure_sprite_anchor_bias.mjs [outdir]
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { fieldShadowRect } from "../web/vendor/engine.js";
import { baseUrl } from "./verify-base-url.mjs";

const outDir = resolve(process.argv[2] ?? "/tmp/opencode/captures");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
await page.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await page.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const frame = page.frames().find((f) => f.url().includes("index.html"));

const scene = await frame.evaluate(async (probe) => {
  const s = window.__state;
  s.x = probe.x; s.y = probe.y;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { cam: window.__lastCam, actor: (window.__lastAnimDebug ?? []).find((d) => d.label === "player") ?? { x: probe.x, y: probe.y } };
}, { x: 968, y: 232 });
const zoom = 2;
const rect = fieldShadowRect({ screenX: scene.actor.x - scene.cam.x, actorScreenY: scene.actor.y - scene.cam.y });

const result = await frame.evaluate(async ({ rect, zoom }) => {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data, W = canvas.width, H = canvas.height;
  const at = (x, y) => {
    const i = ((y * W) + x) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  };
  // device rect: native rect scaled by zoom
  const R = { x: rect.x * zoom, y: rect.y * zoom, w: rect.w * zoom, h: rect.h * zoom };
  // device px = native px * zoom (the lab canvas is a zoomed 640x448 backbuffer)
  const shadowPts = [];
  for (let y = Math.max(0, R.y | 0); y < Math.min(H, R.y + R.h); y++)
    for (let x = Math.max(0, R.x | 0); x < Math.min(W, R.x + R.w); x++) {
      const [r, g, b] = at(x, y);
      if (r === 0x30 && g === 0x30 && b === 0x38) shadowPts.push([x, y]);
    }
  if (!shadowPts.length) return { error: "no shadow pixels at predicted rect", rect };
  const sx0 = Math.min(...shadowPts.map((p) => p[0]));
  const sx1 = Math.max(...shadowPts.map((p) => p[0]));
  const feetY = Math.max(...shadowPts.map((p) => p[1]));
  const scx = (sx0 + sx1) / 2;
  const cxs = [];
  for (let y = Math.max(0, feetY - 40); y < feetY; y++)
    for (let x = Math.max(0, scx - 16 * zoom); x < Math.min(W, scx + 1 + 16 * zoom); x++) {
      const [r, g, b] = at(x, y);
      if (Math.abs(r - 0x30) + Math.abs(g - 0x30) + Math.abs(b - 0x38) < 30) continue;
      cxs.push(x);
    }
  const cx = cxs.reduce((a, b) => a + b, 0) / cxs.length;
  return { shadowX0: sx0, shadowX1: sx1, shadowCx: scx, contentCx: cx, bias: cx - scx, n: cxs.length };
}, { rect, zoom });

console.log(JSON.stringify(result, null, 1));
await page.locator("#game").screenshot({ path: resolve(outDir, "sprite-anchor-bias.png") });
await browser.close();
