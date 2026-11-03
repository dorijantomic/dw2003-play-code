// Pure helpers of the placer (no DOM, no three.js): the placements file format and the ground-drag maths. Tested in node (tools/test_placer_add.mjs).
// File: { version: 1, pack, savedAt, edits: {...}, added: [ { id, src: { path, inst }, m } | { id, asset: "<registry id>", m } ] }.
// Old files (only src entries) parse exactly as before: this only fills missing edits / added and drops an asset entry whose m is not 16 numbers.
export const isAssetEntry = (a) => !!a && typeof a.asset === "string" && a.asset.length > 0;
const okM = (m) => Array.isArray(m) && m.length === 16 && m.every((v) => typeof v === "number" && Number.isFinite(v));
export function normaliseData(raw, pack) {
  const d = raw && typeof raw === "object" ? raw : { version: 1, pack, savedAt: 0, edits: {}, added: [] };
  d.edits ||= {};
  d.added = Array.isArray(d.added) ? d.added : [];
  d.added = d.added.filter((a) => a && (isAssetEntry(a) ? okM(a.m) && typeof a.id === "string" : true));
  return d;
}
export const newAssetEntry = (id, asset, m) => ({ id, asset, m: Array.from(m) });

/** The picker list: every registry asset that can stand as an object (all but "none" and "default"), sorted by source, then name. */
export function pickerEntries(assets) {
  return assets.filter((a) => a && a.id && a.id !== "none" && a.id !== "default")
    .map((a) => ({ id: a.id, name: a.name || a.id, source: a.sourceGroup || a.source || "?", licence: a.licence || "?", kinds: a.kinds || [] }))
    .sort((x, y) => x.source.localeCompare(y.source) || x.name.localeCompare(y.name));
}

/** Where a ray meets the ground. Ray o + t*d (arrays [x,y,z], d need not be unit); heightFn(x, z) -> ground y or null.
 *  Starts on the plane y = h0 and re-aims at the height found under the hit (fixed point; a slope converges when slope*|dx/dy| < 1).
 *  Returns { x, y, z }, or null (ray not going down, or the hit is behind the origin). */
export function groundPoint(o, d, heightFn, h0 = 0, iters = 8) {
  if (!(d[1] < -1e-9)) return null;
  let h = h0, p = null;
  for (let i = 0; i < iters; i++) {
    const t = (h - o[1]) / d[1];
    if (!(t > 0)) return null;
    p = { x: o[0] + d[0] * t, y: h, z: o[2] + d[2] * t };
    const g = heightFn(p.x, p.z);
    if (g == null || !Number.isFinite(g)) return p;
    if (Math.abs(g - h) < 1e-4) { p.y = g; return p; }
    h = g;
  }
  p.y = h; return p;
}
