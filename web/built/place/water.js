// PLACEMENT of the sea / lake surface (data only, no geometry, no material): which preset the recipe asks for (ocean:
// it has water / sea pieces; lake: it has mirror pieces), the ONE baked shore field (water.js shoreField / lakeField:
// distance to the land outline), the measured anchor colours, the recipe's water pieces as measured (for the report),
// and the sea ring's outline triangles (from the waterline out to FAR_R) for any other surface asset.
// Slot: water.surface (a surface). Default mod.water (web/built/water.js buildWater).
import { waterPreset, shoreField, lakeField, anchors, lakeAnchors, waterlineAt, WATER, LAKE_PRESET } from "../water.js";
import { itemsOnTriangles } from "../slots.js";

const bytes = (c) => (Array.isArray(c) ? c.map((v) => Math.max(0, Math.min(255, Math.round(v)))) : null);

/** the sea ring (same rings / sectors as water.js seaGeometry) as a flat triangle list, for a foreign surface asset */
function ringTriangles(field, P) {
  const NS = P.SECTORS, NR = P.RINGS, V = [];
  const r0 = Array.from({ length: NS + 1 }, (_, j) => Math.max(200, waterlineAt(field, (j / NS) * Math.PI * 2 - Math.PI) - P.OVERLAP));
  const at = (i, j) => { const az = (j / NS) * Math.PI * 2 - Math.PI, r = r0[j] * Math.pow(P.FAR_R / r0[j], i / (NR - 1)); return [Math.sin(az) * r, P.SEA_Y, Math.cos(az) * r]; };
  for (let i = 0; i < NR - 1; i++) for (let j = 0; j < NS; j++) V.push(...at(i, j), ...at(i + 1, j), ...at(i, j + 1), ...at(i, j + 1), ...at(i + 1, j), ...at(i + 1, j + 1));
  return Float32Array.from(V);
}

export function plan(pctx) {
  const { rec } = pctx;
  const preset = waterPreset(rec);
  if (!preset) return null;
  const P = preset === "lake" ? LAKE_PRESET : WATER;
  const field = preset === "lake" ? lakeField(rec, P) : shoreField(rec);
  const A = preset === "lake" ? lakeAnchors(P) : anchors(rec);
  const pieces = preset === "lake" ? [] : (rec.pieces || []).filter((p) => p.kind === "water" || p.kind === "sea").map((p) => {
    let pmin = Infinity, pmax = 0, ymin = Infinity, ymax = -Infinity;
    for (let i = 0; i < p.pos.length; i += 3) {
      const r = Math.hypot(p.pos[i], p.pos[i + 2]);
      pmin = Math.min(pmin, r); pmax = Math.max(pmax, r);
      ymin = Math.min(ymin, p.pos[i + 1]); ymax = Math.max(ymax, p.pos[i + 1]);
    }
    return { name: p.name, kind: p.kind, tris: p.tris, rmin: Math.round(pmin), rmax: Math.round(pmax), ymin: Math.round(ymin), ymax: Math.round(ymax),
             rows: p.rows ? p.rows.map((r) => r?.rgb || null) : null, p10: bytes(p.colours?.p10), p90: bytes(p.colours?.p90), drawn: false };
  });
  const ring = ringTriangles(field, P);
  const slot = {
    id: "water.surface", label: preset === "lake" ? "Lake surface" : "Sea surface", kind: "surface", layer: "sea", default: "mod.water",
    surface: { pos: [ring] }, items: itemsOnTriangles([ring]), userData: { kind: "sea" },
    data: { preset, P, field, anchors: A, pieces, keepOut: pctx.keepOut },
  };
  const inst = () => pctx.slots.instanceOf(slot.id) || {};
  const layer = {
    get meshes() { return pctx.slots.meshesOf(slot.id); },
    get materials() { return inst().materials || pctx.slots.meshesOf(slot.id).map((m) => m.material); },
    get field() { return inst().field || field; },
    get lake() { return inst().lake || null; },
    get info() { return pctx.info.water; },
    place: (k) => inst().place?.(k),
    setLayer(name, on) { if (name === "water" || name === "sea") { pctx.slots.setVisible(slot.id, on); return true; } return false; },
    setVisible: (v) => pctx.slots.setVisible(slot.id, v),
  };
  return { slots: [slot], layer, afterPlace: (st) => inst().place?.(st) };
}
