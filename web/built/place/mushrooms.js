// PLACEMENT of the glowing mushroom clusters (meft1008 wall_06; data only): one cluster per upright card of the
// "mushroom" pieces standing on the floor, 8 stems spread over the card's footprint (hero at its centre at the card's
// full height, 2 mid, 5 small), a pulse phase per cluster (shared noise at its centre), the halo / pool gains and the
// spore cloud positions. Items = the stems. Default asset: mod.mushrooms (web/built/mushrooms.js buildMushrooms).
import { rng, itemsFrom, layerFacade } from "../slots.js";
import { MUSH } from "../mushrooms.js";
const M = 400;

export function plan(pctx) {
  const S = pctx.S;
  const pieces = pctx.pieces("mushroom");
  const cards = pieces.flatMap((p) => (p.cards || []).map((c) => ({ ...c, piece: p.name, colours: p.colours })))
    .filter((c) => c.base[1] >= -1.0);   // never build under the floor (the floor pieces carry mirrored copies)
  if (!cards.length) return null;
  const r = rng(MUSH.SEED);
  const lerp = (a, b) => a[0] + (b[0] - a[0]) * r();
  const clusters = [], stems = [];
  cards.forEach((c, ci) => {
    const [bx, , bz] = c.base, H = c.h, dir = c.dir || [0, 1];
    const across = [-dir[1], dir[0]];                       // the card's own sideways basis
    const phase = 6.2832 * S.fbm3JS(bx / M, 0, bz / M);      // ONE phase per cluster, CPU-side (no noise3 per pixel)
    const hf = [MUSH.HERO];
    for (let k = 0; k < 2; k++) hf.push(lerp(MUSH.MID, MUSH.MID));
    for (let k = 0; k < 5; k++) hf.push(lerp(MUSH.SMALL, MUSH.SMALL));
    const cl = { i: ci, piece: c.piece, c: [bx, 0, bz], r: Math.hypot(bx, bz), az: Math.atan2(bx, bz) * 180 / Math.PI,
                 cardH: H, w: c.w, phase, fade: 1, stems: [] };
    for (let k = 0; k < MUSH.STEMS; k++) {
      const u = k === 0 ? 0 : (r() * 2 - 1);
      const v = k === 0 ? 0 : (r() * 2 - 1);
      const ox = dir[0] * u * MUSH.FOOT * c.w * 0.5 + across[0] * v * MUSH.FOOT_ACROSS * M;
      const oz = dir[1] * u * MUSH.FOOT * c.w * 0.5 + across[1] * v * MUSH.FOOT_ACROSS * M;
      const h = Math.max(0.12 * M, H * hf[k]);
      const leanAz = Math.atan2(ox, oz) + (r() - 0.5) * 0.6;   // lean away from the cluster centre
      const lean = (MUSH.LEAN[0] + (MUSH.LEAN[1] - MUSH.LEAN[0]) * r()) * Math.PI / 180;
      const st = { k, cluster: ci, c: [bx + ox, 0, bz + oz], h, yaw: r() * 6.2832, lean, leanAz, phase, fade: 1, capY: 0.837 * h };
      stems.push(st); cl.stems.push(st);
    }
    clusters.push(cl);
  });
  // the glow's own spots, drawn from the same random stream in the same order as before the split
  const hGain = new Float32Array(stems.length), hRad = new Float32Array(stems.length);
  stems.forEach((st, i) => { hRad[i] = MUSH.HALO_R * st.h; hGain[i] = st.k === 0 ? 1.0 : 0.55 + 0.3 * r(); });
  const pGain = new Float32Array(clusters.length);
  clusters.forEach((cl, i) => { pGain[i] = 0.85 + 0.3 * r(); });
  const nSp = clusters.length * MUSH.SPORES;
  const spPos = new Float32Array(nSp * 3), spPhase = new Float32Array(nSp), spSize = new Float32Array(nSp);
  let si = 0;
  for (const cl of clusters) {
    for (let k = 0; k < MUSH.SPORES; k++, si++) {
      const a = r() * 6.2832, rr = (MUSH.SPORE_R[0] + (MUSH.SPORE_R[1] - MUSH.SPORE_R[0]) * r()) * M;
      spPos[si * 3] = cl.c[0] + Math.sin(a) * rr;
      spPos[si * 3 + 1] = (MUSH.SPORE_Y[0] + (MUSH.SPORE_Y[1] - MUSH.SPORE_Y[0]) * r()) * M;
      spPos[si * 3 + 2] = cl.c[2] + Math.cos(a) * rr;
      spPhase[si] = r() * 6.2832;
      spSize[si] = MUSH.SPORE_SIZE * M * (0.6 + 0.8 * r());
    }
  }
  const c0 = pieces[0].colours || {};
  const slot = { id: "mushrooms.clusters", label: "Glowing mushrooms", kind: "mushroom", layer: "builtMushrooms", default: "mod.mushrooms",
                 items: itemsFrom(stems.map((st) => ({ p: st.c, yaw: st.yaw, h: st.h, rad: st.h * 0.3 }))), frustumCulled: false,
                 data: { clusters, stems, hGain, hRad, pGain, spores: { n: nSp, pos: spPos, phase: spPhase, size: spSize }, colours: c0 } };
  return { slots: [slot], layer: layerFacade(pctx.slots, slot.id) };
}
