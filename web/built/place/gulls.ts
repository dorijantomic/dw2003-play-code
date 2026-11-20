// PLACEMENT of the seagulls (data only): one gull per PICTURE COPY of each upright card of the "gulls" pieces, at its
// copy's centre; it keeps that distance from the fight centre and glides round on that circle, bobbing inside its
// card's height range (web/built/gulls.js header has the measured rule). motion(t, i) = where gull i is at time t;
// KEEP-OUT (place): the whole orbit (every ORBIT_STEP_DEG, the bob range in one sphere) against the fight radius and
// every view cone; a gull that fails is hidden. Default asset: mod.gulls (web/built/gulls.js buildGulls).
import { rng, itemsFrom, layerFacade } from "../slots.js";
import { GULL, verticalReach } from "../gulls.js";   // the default gull's shape numbers (span rule, vertical reach)

export function plan(pctx) {
  const pieces = pctx.pieces("gulls");
  const cards = pieces.flatMap((p) => (p.cards || []).map((c) => ({ ...c, piece: p.name, colours: p.colours })));
  if (!cards.length) return null;
  const reach = verticalReach();
  const r = rng(GULL.SEED);
  const copiesOf = (c) => Math.max(1, Math.round(c.copies || 1));
  const gulls = [], cardCopies = [];
  cards.forEach((c, ci) => {
    const copies = c.dir ? copiesOf(c) : 1, dir = c.dir || [0, 0];   // no dir = no way to split the card: one bird
    cardCopies.push(copies);
    const cw = c.w / copies, hs = 0.5 * GULL.SPAN_K * cw;
    const yc = c.base[1] + c.h / 2;
    const room = Math.min(c.h / 2 - reach.up * hs, c.h / 2 - reach.dn * hs);
    for (let k = 0; k < copies; k++) {
      const off = ((k + 0.5) / copies - 0.5) * c.w;              // copy k's centre along the card's own dir
      const cx = c.base[0] + off * dir[0], cz = c.base[2] + off * dir[1];
      const lerp = (a) => a[0] + (a[1] - a[0]) * r();
      gulls.push({ i: gulls.length, card: ci, copy: k, copies, piece: c.piece, cw,
                   R: Math.hypot(cx, cz), az0: Math.atan2(cx, cz), yc, hs, y0: c.base[1], y1: c.base[1] + c.h,
                   bob: GULL.BOB_K * Math.max(0, room), w: lerp(GULL.ORBIT_W), bw: lerp(GULL.BOB_W), bph: r() * 6.2832,
                   g: [r() * 6.2832, r() * 6.2832, lerp(GULL.ENV_W)], hidden: false });
    }
  });
  /** where gull q is at time t (s): centre and yaw */
  const at = (q, t) => {
    const az = q.az0 + q.w * t;
    return { c: [q.R * Math.sin(az), q.yc + q.bob * Math.sin(t * q.bw + q.bph), q.R * Math.cos(az)], yaw: az + Math.PI / 2, az };
  };
  const c0 = pieces[0].colours || {};
  const keep = { exactTests: 0, hiddenWhy: [] };
  const items = itemsFrom(gulls.map((q) => { const a = at(q, 0); return { p: a.c, yaw: a.yaw, h: q.hs, rad: q.hs }; }));
  const slot = {
    id: "gulls.flock", label: "Seagulls", kind: "bird", layer: "builtGulls", default: "mod.gulls", items, frustumCulled: false,
    data: { gulls, cards: cards.length, cardCopies, reach, at, keep, colours: { p90: c0.p90, green: c0.green || c0.all, p10: c0.p10, accent: c0.accent },
            band: { r: [Math.min(...gulls.map((q) => q.R)), Math.max(...gulls.map((q) => q.R))],
                    y: [Math.min(...pieces.map((p) => p.ymin ?? Infinity)), Math.max(...pieces.map((p) => p.ymax ?? -Infinity))] } },
    motion: (t, i) => { const q = gulls[i]; if (!q) return null; const a = at(q, t); return { p: a.c, yaw: a.yaw, h: q.hs, hidden: q.hidden }; },
    place(st) {   // keep-out over the whole orbit: one sphere per sample holding the gull and its bob range
      st = st || {};
      const fightR = st.fightR ?? 0;
      const M2 = Math.max(0, ...(st.rings || []).map((g) => g.r), ...(st.fighters || []).map((f) => Math.hypot(f.c[0], f.c[2]) + f.r));
      let exact = 0;
      for (const q of gulls) {
        const rho = q.hs * 1.05 + q.bob;   // the wing reach is < 1 half span in every direction (+5 %)
        q.why = null;
        if (q.R - rho > Math.max(fightR, M2)) { q.hidden = false; continue; }   // wholly outside every eye and fighter
        exact++;
        for (let d = 0; d < 360 && !q.why; d += GULL.ORBIT_STEP_DEG) {
          const az = d * Math.PI / 180, c = [q.R * Math.sin(az), q.yc, q.R * Math.cos(az)];
          if (q.R - rho < fightR) q.why = "fight";
          else q.why = pctx.keepOut.reject(c, rho);
        }
        q.hidden = !!q.why;
      }
      keep.exactTests = exact; keep.hiddenWhy = gulls.filter((q) => q.hidden).map((q) => [q.i, q.why]);
      return items;
    },
  };
  return { slots: [slot], layer: layerFacade(pctx.slots, slot.id) };
}
