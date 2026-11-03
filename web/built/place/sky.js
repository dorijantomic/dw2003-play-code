// PLACEMENT of the sky (data only, no geometry, no material): the recipe's sky ring as measured (its profile = height ->
// radius, its band ymin..ymax, its colours: bottom / median / top / p90), the zenith (rec.bg) and haze colours, whether
// the ring floats above the floor (band mode: the colour is read where the view ray meets the ring) and whether 3D
// cloud banks stand in the ring (not in band mode). Slots: sky.dome (surface: the ring's own triangles for any other
// sky asset) and sky.clouds (the ring band, items around it). Defaults mod.sky / mod.clouds (web/built/sky.js).
// The viewer's "sky time" switch (sky.js setBuiltSkyMode) sets data.mode and rebuilds both slots.
import { current } from "../sky.js";
import { itemsOnRing } from "../slots.js";

/** the sky numbers of a recipe (also used by sky.js createBuiltSky, the checkers' stand-alone sky) */
export function skyData(rec, opts = {}) {
  const p = rec.pieces.find((q) => q.kind === "sky");
  if (!p) return null;
  const sky = { kind: "sky", name: p.name, colours: p.colours, profile: p.profile, ymin: p.ymin, ymax: p.ymax, rmin: p.rmin, rmax: p.rmax, md: p.md, pos: p.pos };
  const band = opts.band ?? (sky.ymin > 0);
  return { sky, bg: rec.bg, haze: rec.pieces.find((q) => q.kind === "haze")?.colours?.all, band, opts, mode: opts.mode,
           clouds: !(opts.clouds === false || (band && opts.clouds !== true)) };
}

export function plan(pctx) {
  const D = skyData(pctx.rec);
  if (!D) return null;
  const { sky } = D;
  const slots = [{
    id: "sky.dome", label: "Sky dome", kind: "sky", layer: "builtSky", parent: "world", default: "mod.sky", data: D,
    surface: sky.pos?.length ? { pos: [Float32Array.from(sky.pos)], renderOrder: -1000 } : null,
    items: itemsOnRing(12, sky.rmax || 20000, sky.ymax || 4000, 4000),
  }];
  if (D.clouds) slots.push({
    id: "sky.clouds", label: "Cloud banks", kind: "cloud", layer: "builtClouds", parent: "world", default: "mod.clouds", data: D,
    items: itemsOnRing(10, sky.rmax || 20000, (sky.ymin + sky.ymax) / 2 || 3000, ((sky.ymax - sky.ymin) || 2000) * 0.6), userData: { kind: "clouds" },
  });
  if (!slots[0].surface) delete slots[0].surface;
  // the camera-following dome is the bound default's mesh (none when another sky asset is bound)
  pctx.slots.on((id) => { if (id === "sky.dome") pctx.camera.userData.sky = pctx.slots.instanceOf(id)?.dome || null; });
  current.rebuildWith = (mode) => {
    D.mode = mode;
    pctx.slots.rebuild("sky.dome");
    if (D.clouds) pctx.slots.rebuild("sky.clouds");
    return current.sky;
  };
  return { slots };
}
