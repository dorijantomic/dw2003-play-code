// PLACEMENT of the lake's mirror module (data only, no geometry, no material): whether water.js's real lake is bound
// (then only the grass bank is drawn here; the planar reflection mirrors whatever is bound), the land outline the faked
// surface follows (soilLand), and the measured colours the copies are tinted with (pine_mirror / rock_mirror / the
// tree ring pieces / the far pines' foot row). Slot: mirror.lake (items: a ring along the bank, for any other asset).
// Default mod.mirror (web/built/mirror.js buildMirror). REFLECTIONS FOLLOW A SWAP: on every change of a tree, far-pine
// or boulder slot the mirror is rebuilt from what is bound then.
import { soilLand } from "./land.js";
import { BANK } from "../mirror.js";
import { itemsOnRing } from "../slots.js";
const M = 400;

export function plan(pctx) {
  const { rec, info } = pctx;
  const col = (kind) => { const p = pctx.pieces(kind)[0]; return p ? { name: p.name, colours: p.colours } : null; };
  const pine = col("pine_mirror"), rock = col("rock_mirror");
  if (!pine && !rock) return null;
  const fp = pctx.pieces("far_pines")[0] || null;
  const real = info?.water?.preset === "lake";
  const slot = {
    id: "mirror.lake", label: "Lake bank + mirrored copies", kind: "bank", layer: "builtLake", default: "mod.mirror",
    items: itemsOnRing(24, (BANK.R0 + BANK.R1) / 2 * M, 0, 400), userData: { kind: "mirror" },
    data: { real, pine, rock, land: soilLand(rec), bg: rec.bg,
            ringColours: { wall: col("cypress_wall")?.colours || null, grove: col("cypress_grove")?.colours || null },
            farPines: fp ? { name: fp.name, rows: fp.rows || [] } : null },
  };
  // the copies are made from the bound tree / far-pine / boulder meshes: rebuild after any of those slots changes
  // (with the real lake the planar reflection already renders what is bound, nothing to rebuild)
  const SOURCES = /^(trees\.|boulders\.)/;
  if (!real) pctx.slots.on((id) => { if (SOURCES.test(id) && pctx.slots.get(slot.id)?.inst) pctx.slots.rebuild(slot.id); });
  const inst = () => pctx.slots.instanceOf(slot.id) || {};
  const layer = {
    get meshes() { return pctx.slots.meshesOf(slot.id); },
    get info() { return inst().info || null; },
    get lake() { return inst().lake || null; },
    get reflections() { return inst().reflections || []; },
    probeMaterial: (...a) => inst().probeMaterial?.(...a),
    setVisible: (v) => pctx.slots.setVisible(slot.id, v),
    place: (st) => inst().place?.(st),
  };
  return { slots: [slot], layer, afterPlace: (st) => inst().place?.(st) };
}
