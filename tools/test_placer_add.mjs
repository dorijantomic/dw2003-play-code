// Node unit test of the placer's "Add object..." pieces (no browser): file format (old file parses identically, asset entry round-trips),
// ground-drag maths (ray vs flat ground / sloped ground height function), picker entries from the registry (count, ob_grave1 present).
//   node tools/test_placer_add.mjs
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";
// the browser's importmap {"three": "./lib3d/three.module.js"} for node
const THREE_URL = pathToFileURL(fileURLToPath(new URL("../web/lib3d/three.module.js", import.meta.url))).href;
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) { return s === "three" ? { url: ${JSON.stringify(THREE_URL)}, shortCircuit: true } : n(s, c); }`));
import { normaliseData, newAssetEntry, isAssetEntry, groundPoint, pickerEntries } from "../web/placer-format.js";

let bad = 0;
const ok = (c, msg) => { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) bad++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ---- 1 file format
const M = Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0));
const old = { version: 1, pack: "p", savedAt: 5, edits: { "a/b|-1": { m: M }, "c|3": { hidden: true } }, added: [{ id: "a1", src: { path: "x/y", inst: 2 }, m: M }] };
const oldCopy = JSON.parse(JSON.stringify(old));
ok(JSON.stringify(normaliseData(JSON.parse(JSON.stringify(old)), "p")) === JSON.stringify(oldCopy), "old file parses byte-identical");
const bare = normaliseData({ version: 1, pack: "p" }, "p");
ok(Array.isArray(bare.added) && bare.added.length === 0 && typeof bare.edits === "object", "old file without edits/added gets empty ones");
const withAsset = JSON.parse(JSON.stringify(old)); withAsset.added.push(newAssetEntry("a2", "bio.ob_grave1", M));
const back = normaliseData(JSON.parse(JSON.stringify(withAsset)), "p");
ok(JSON.stringify(back) === JSON.stringify(withAsset), "file with asset entry round-trips through JSON");
ok(back.added.length === 2 && isAssetEntry(back.added[1]) && !isAssetEntry(back.added[0]) && back.added[1].asset === "bio.ob_grave1", "asset entry kept, src entry kept");
const badEntry = normaliseData({ added: [{ id: "z", asset: "x", m: [1, 2] }] }, "p");
ok(badEntry.added.length === 0, "asset entry with a bad matrix is dropped");

// ---- 2 ground drag maths
const flat = () => 0;
let p = groundPoint([100, 500, 200], [0, -1, 0], flat);
ok(near(p.x, 100) && near(p.y, 0) && near(p.z, 200), "straight down on flat ground -> (100,0,200)");
p = groundPoint([0, 300, 0], [3, -3, 0], flat);   // 45 degrees: hits y=0 at x=300
ok(near(p.x, 300) && near(p.y, 0) && near(p.z, 0), "45 degree ray on flat ground -> x=300");
const hill = (x, z) => 0.2 * x + 10;               // plane y = 0.2x + 10
p = groundPoint([0, 300, 0], [3, -3, 0], hill);     // ray: x=3t,y=300-3t ; 300-3t = 0.6t+10 -> t=290/3.6
const t = 290 / 3.6;
ok(near(p.x, 3 * t, 1e-2) && near(p.y, 300 - 3 * t, 1e-2) && near(p.y, hill(p.x, 0), 1e-3), `sloped ground 0.2x+10 -> x=${(3 * t).toFixed(3)} y=${(300 - 3 * t).toFixed(3)} (got ${p.x.toFixed(3)}, ${p.y.toFixed(3)})`);
ok(groundPoint([0, 10, 0], [1, 0, 0], flat) === null && groundPoint([0, 10, 0], [1, 1, 0], flat) === null, "ray level or going up -> null");
ok(groundPoint([0, -5, 0], [1, -1, 0], flat) === null, "origin below the ground height -> null (hit behind)");
p = groundPoint([0, 300, 0], [3, -3, 0], () => null, 7);
ok(p && near(p.y, 7), "no ground mesh under the hit (null) -> stays on start height");
const bump = (x) => (Math.abs(x - 250) < 40 ? 30 : 0);   // a small hill; ray still lands near it
p = groundPoint([0, 300, 0], [3, -3, 0], bump);
ok(p && near(p.y, bump(p.x), 1e-2), `bump: hit stands on the bump height (x=${p.x.toFixed(2)} y=${p.y.toFixed(2)})`);

// ---- 3 picker entries from the registry (node: file:// fetch shim so web/assets-lab/objects/objects.json is read as in the browser)
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  const s = String(u);
  if (s.startsWith("file:")) { try { const b = fs.readFileSync(fileURLToPath(s)); return new Response(b, { status: 200 }); } catch { return new Response("", { status: 404 }); } }
  return realFetch ? realFetch(u, o) : new Response("", { status: 404 });
};
// biome modules make canvas textures at load: a do-nothing document is enough to list them (nothing is drawn here)
const noop = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ||= { createElementNS: () => ({ style: {}, getContext: () => noop, addEventListener() {} }), createElement: () => ({ width: 1, height: 1, style: {}, getContext: () => noop, addEventListener() {} }), getElementById: () => null, querySelectorAll: () => [], addEventListener() {} };
let reg = null;
try { reg = await import("../web/built/registry.js"); } catch (e) { console.log("registry import failed:", e?.message || e); }
if (reg) {
  let all = null;
  try { all = await reg.listAllAssets(); } catch (e) { console.log("listAllAssets failed:", e?.message || e); }
  if (all) {
    const list = pickerEntries(all);
    const bySrc = {}; for (const a of list) bySrc[a.source] = (bySrc[a.source] || 0) + 1;
    console.log("registry:", all.length, "picker:", list.length, JSON.stringify(bySrc));
    ok(list.length > 0 && list.length === all.filter((a) => a.id !== "none" && a.id !== "default").length, "picker lists every registry asset except none/default");
    ok(new Set(list.map((a) => a.id)).size === list.length, "picker ids unique");
    const g = list.find((a) => a.id === "bio.ob_grave1");
    ok(!!g, "ob_grave1 present: " + (g ? `${g.id} | ${g.name} | ${g.source} | ${g.kinds.join(",")}` : "MISSING"));
    ok(list.some((a) => a.source === "Objects (own)"), "group 'Objects (own)' present");
    ok(list.some((a) => a.source === "Quaternius" || a.source === "Poly Haven"), "biome gallery sets present");
  } else bad++;
} else bad++;
console.log(bad ? `${bad} FAILED` : "ALL PASS");
process.exit(bad ? 1 : 0);
