// Headless rendering gate for any native battle model; uses the real viewer.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const model = process.argv[2];
const output = resolve(process.argv[3] ?? `/tmp/${model}-captures`);
const frames = (process.argv[4] ?? "0,100,300,500").split(",").map(Number);
const source = process.argv[5] ? resolve(process.argv[5]) : null;
const battleLab = process.env.BATTLE_LAB === "1";
if (!/^m[0-9]{3}[a-z0-9_]+$/.test(model) || frames.some(f => !Number.isInteger(f) || f < 0)) {
  throw new Error("usage: verify_generated_model.mjs mNNNname [capture-dir] [comma-separated frames]");
}
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".css": "text/css" };
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/favicon.ico") { res.writeHead(204); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, "http://local").pathname);
    let path;
    if (source && pathname === `/web/assets/battle/models/${model}/anim.json`) path = resolve(source, "anim.json");
    else if (source && pathname === `/web/assets/battle/textures/${model}.png`) path = resolve(source, "texture.png");
    else path = resolve(root, "." + pathname);
    if (!path.startsWith(root + "/") && !(source && path.startsWith(source + "/"))) throw new Error("outside repository");
    const body = await readFile(path);
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch();
try {
  await mkdir(output, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text()); });
  page.on("requestfailed", request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("response", response => {
    if (response.status() >= 400 && !response.url().endsWith("/slot_map.json"))
      errors.push(`${response.status()} ${response.url()}`);
  });
  const port = server.address().port;
  await page.goto(`http://127.0.0.1:${port}/web/${battleLab ? "battle-lab" : "model-viewer"}.html?model=${model}`, { waitUntil: "networkidle" });
  if (battleLab) {
    await page.waitForFunction(expected => document.querySelector("#pModel")?.value === expected, model);
    const canvas = page.locator("#cv");
    const before = resolve(output, `${model}-battle-before.png`);
    const during = resolve(output, `${model}-battle-attack.png`);
    const after = resolve(output, `${model}-battle-after.png`);
    await page.waitForTimeout(500);
    await canvas.screenshot({ path: before });
    await page.locator("#atkP").click();
    await page.waitForTimeout(550);
    await canvas.screenshot({ path: during });
    await page.waitForTimeout(2300);
    await canvas.screenshot({ path: after });
    const log = await page.locator("#log").innerText();
    if (errors.length) throw new Error(`browser errors: ${errors.join(" | ")}`);
    console.log(JSON.stringify({ model, battleLab: true, screenshots: [before, during, after], log: log.slice(0, 500), webgl: "ok" }));
    process.exitCode = 0;
  } else {
  await page.waitForFunction(expected => document.querySelector("#modelSel")?.value === expected, model);
  await page.locator("#clipSel").selectOption("-1");
  await page.locator("#autoPlay").uncheck();
  if (process.env.WIREFRAME === "1") await page.locator("#wireframe").check();
  const canvas = page.locator("#c");
  const shots = [];
  for (const [angle, dx] of [["front", 0], ["side", 280], ["rear", 280]]) {
    if (dx) {
      const box = await canvas.boundingBox();
      const x = box.x + box.width/2, y = box.y + box.height/2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x+dx, y, { steps: 12 });
      await page.mouse.up();
    }
    for (const frame of frames) {
      await page.locator("#frameScrub").evaluate((slider, f) => {
        slider.value = String(f);
        slider.dispatchEvent(new Event("input", { bubbles: true }));
      }, frame);
      await page.waitForTimeout(120);
      const status = await page.evaluate(() => {
        const canvas = document.querySelector("#c");
        const gl = canvas.getContext("webgl");
        return { contextLost: gl.isContextLost(), error: gl.getError(), width: canvas.width,
                 height: canvas.height, frame: Number(document.querySelector("#frameScrub").value) };
      });
      if (status.contextLost || status.error || !status.width || !status.height || status.frame !== frame) {
        throw new Error(`WebGL failed at ${angle} frame ${frame}: ${JSON.stringify(status)}; browser: ${errors.join(" | ")}`);
      }
      const path = resolve(output, `${model}-${angle}-f${frame}.png`);
      await canvas.screenshot({ path });
      shots.push(path);
    }
  }
  if (errors.length) throw new Error(`browser errors: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ model, frames, screenshots: shots, webgl: "ok" }));
  }
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
