#!/usr/bin/env node
// K19b debug: why do a few bones' matrices differ between node poseFromChannels and the page?
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import * as FA from "../web/fight/firing-axis.js";

const ROOT = resolve(import.meta.dirname, "..");
const { createServer } = await import("node:http");
const { readFile } = await import("node:fs/promises");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".css": "text/css" };
const server = createServer(async (req, res) => {
  try {
    const rel = decodeURIComponent(new URL(req.url, "http://local").pathname);
    const body = await readFile(resolve(ROOT, "." + rel));
    res.writeHead(200, { "content-type": TYPES[rel.slice(rel.lastIndexOf("."))] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("x"); }
});
await new Promise((d) => server.listen(8127, "127.0.0.1", d));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://127.0.0.1:8127/web/anim-viewer.html");
await page.waitForFunction(() => !!window.__r, null, { timeout: 60000 });

const CASES = [["m213wgre", 1460], ["m254pldr", 1367], ["m369duke", 760]];
for (const [folder, frame] of CASES) {
  const pg = await page.evaluate(async ({ folder, frame }) => {
    const { buildBoneWorldMatrices } = await import("/web/battle3d.js");
    const raw = await fetch(`assets/battle/models/${folder}/anim.json`).then((r) => r.json());
    const bw = buildBoneWorldMatrices(raw, frame, null);
    return {
      mats: bw.mats.map((m) => [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10], m[12], m[13], m[14]]),
      ch2: raw.bones.map((b) => b.anim?.ch2 ?? null),
      parents: raw.bones.map((b) => b.parent_slot),
      n: raw.num_bones,
    };
  }, { folder, frame });
  const model = JSON.parse(readFileSync(resolve(ROOT, "web/assets/battle/models", folder, "anim.json"), "utf8"));
  const pose = FA.poseFromChannels(model, frame);
  let worst = { d: 0 };
  for (let i = 0; i < pg.n; i++) {
    for (let k = 0; k < 9; k++) {
      const a = k < 3 ? pose.rot[i][k] : k < 6 ? pose.rot[i][k] : pose.rot[i][k];
      const d = Math.abs(a - pg.mats[i][k]);
      if (d > worst.d) worst = { d, bone: i, k };
    }
  }
  console.log(`\n${folder} frame ${frame}  n=${pg.n}  worst bone ${worst.bone} elem ${worst.k} diff ${worst.d}`);
  const b = worst.bone;
  const ch2 = pg.ch2[b];
  console.log("  ch2 len", ch2?.length, "first", JSON.stringify(ch2?.[0]), "last", JSON.stringify(ch2?.[ch2.length - 1]));
  console.log("  parents", JSON.stringify(pg.parents));
  console.log("  page rot", pg.mats[b].slice(0, 9).map((v) => v.toFixed(4)).join(" "));
  console.log("  node rot", pose.rot[b].map((v) => v.toFixed(4)).join(" "));
  // walk the parents and print each ancestor's channel extent
  let i = b;
  const chain = [];
  while (i >= 0) { chain.push(i); const p = (pg.parents[i] ?? 0) - 1; if (p === i) break; i = p; }
  for (const a of chain.reverse()) console.log(`   bone ${a} parent ${pg.parents[a]} ch2 frames ${pg.ch2[a]?.map((r) => r[3]).slice(0, 12)} vals ${JSON.stringify(pg.ch2[a]?.slice(0, 3))}`);
}
await browser.close();
server.close();
