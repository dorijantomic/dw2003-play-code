// OBJECTS set: our own generated models (TripoSR etc.), listed from the catalogue web/assets-lab/objects/objects.json (git-ignored, public repo).
// Built by tools/obj2glb.mjs: one row per object {id,name,category,kind,rel,source,licence,tris,bytes,date}. Every new row appears here by itself.
// Missing catalogue = no entries, no error. Vertex colours (COLOR_0) are kept by normaliseGeo and enabled by loader.js.
import { tris } from "./toolkit.js";
import { loadToon, loadRaw, partsGroup } from "./loader.js";

const BASE = new URL("../assets-lab/objects/", import.meta.url).href;
export const catalog = await fetch(BASE + "objects.json").then((r) => (r.ok ? r.json() : [])).then((j) => (Array.isArray(j) ? j : [])).catch(() => []);

/** longest extent in metres for the preview, per kind (default 2) */
const SIZE = { rock: 1.2, tree: 8, bush: 1.4, plant: 0.9, other: 2 };
const cap = (s) => String(s || "objects").replace(/^./, (c) => c.toUpperCase());
async function toonOf(it) {
  const url = BASE + it.rel, raw = await loadRaw(url, true), ext = Math.max(raw.size.x, raw.size.y, raw.size.z);
  return loadToon(url, { scale: (SIZE[it.kind] || SIZE.other) / Math.max(ext, 1e-3), shadeK: 0.86, rim: 0.16, vertexColors: true });
}
export const entries = catalog.filter((it) => it && it.id && it.rel).map((it) => ({
  id: `ob_${it.id}`, cat: cap(it.category), name: it.name || it.id, source: it.source || "own", licence: it.licence || "own", url: it.url, noSpin: false, tris: it.tris, flags: it.flags || null, paint: it.paint || null,
  make: async () => partsGroup((await toonOf(it)).parts),
}));
