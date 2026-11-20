// PLACEMENT of the beach sand and the shore band (data only, no geometry, no material): the recipe's sand / shore
// pieces as SURFACE outlines (triangles, picture rows), their measured colours, the shore's per-vertex greenness and
// blade colours (grass.js reads them on the mesh), and the ONE waterline bake (water.js shoreField: a distance field to
// the land outline) + the water's measured anchor colours, which the wet sand shares with the sea.
// Slot: sand.ground (a surface; other things stand on it: pctx.addGround). Default mod.sand (web/built/sand.js buildSand).
import { SAND, rowValue } from "../sand.js";
import { shoreField, anchors } from "../water.js";
import { itemsOnTriangles } from "../slots.js";

export function plan(pctx) {
  const { rec, info } = pctx;
  const pieces = rec.pieces.filter((p) => p.kind === "sand" || p.kind === "shore");
  if (!pieces.length) return null;
  const field = shoreField(rec), A = anchors(rec);
  const list = pieces.map((p) => {
    const n = p.pos.length / 3, row = new Float32Array(n);
    if (p.uvr) row.set(p.uvr.slice(0, n));
    const out = { name: p.name, kind: p.kind, pos: new Float32Array(p.pos), row, colours: p.colours, tris: p.tris };
    if (p.kind === "shore" && p.rows?.some(Boolean)) {
      out.rows = Array.from({ length: SAND.ROWS }, (_, k) => (p.rows[k] || p.rows.find(Boolean)).rgb);
      out.green = new Float32Array(n);
      for (let i = 0; i < n; i++) out.green[i] = rowValue(p.rows, row[i], (r) => r.green);
      // blade colours on the shore: the measured greens of the band's two greenest picture rows
      const greenest = p.rows.filter(Boolean).sort((a, b) => b.green - a.green).slice(0, 2).map((r) => r.rgb)
        .sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
      out.blade = { p10: greenest[0], p90: greenest[greenest.length - 1] };
    }
    info.pieces[p.name] = { kind: p.kind, tris: p.tris };
    return out;
  });
  const sandHi = rec.pieces.find((p) => p.kind === "sand")?.colours?.p90 || [];
  const slot = {
    id: "sand.ground", label: "Sand + shore band", kind: "surface", layer: "sand", default: "mod.sand",
    surface: { pos: list.map((q) => q.pos) }, items: itemsOnTriangles(list.map((q) => q.pos)),
    data: { pieces: list, field, anchors: A, sandHi },
  };
  pctx.addGround(slot.id);
  const meshes = () => pctx.slots.meshesOf(slot.id);
  const layer = {
    get meshes() { return meshes(); }, get ground() { return meshes(); },
    get shore() { return meshes().filter((m) => m.userData.kind === "shore"); },
    get info() { return info.sand; },
    setVisible: (v) => pctx.slots.setVisible(slot.id, v),
  };
  return { slots: [slot], layer };
}
