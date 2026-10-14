// Which side of the arena a model's action scripts were written for, and mirroring them when it stands on the other.
//
// The disc authors every arena-absolute coordinate per side: a player species' hit sparks, projectiles and leaps
// aim down +z (toward the far side), an enemy model's down -z (claim
// fight-world-effect-coordinates-are-not-mirrored-per-side-2026-08-18; shipped data: player packs put 677 attack
// spawns at +z against 1 at -z, enemy packs 153 at -z against 65 at +z). That never mattered while every enemy
// stood on the far side. An enemy-only species the player now owns stands on the near side with its enemy-authored
// scripts, so its shots flew back at itself. The arena is symmetric about the origin (home z is +-(0x1400+standoff)),
// so turning a script around is x -> -x, z -> -z, plus half a turn on a projectile's yaw.

const SCREEN_Z = (z) => z === 32767 || z === -1 || Math.abs(z) > 20000;   // screen-space effects, not arena positions
const HALF_TURN = 2048;                                                    // PS1 angle units, 4096 = 360 degrees
const wrap = (a) => (((a + HALF_TURN) % 4096) + 4096) % 4096;

const cache = new WeakMap();
/** "player" when the model's scripts aim down +z, "enemy" when down -z (null for a model without action scripts). */
export function authoredSide(model) {
  const actions = model?.actions;
  if (!Array.isArray(actions)) return null;
  if (cache.has(actions)) return cache.get(actions);
  // A projectile's root yaw is the cleanest sign: 2048 (half a turn) in 223 of the 224 player-side records and 0 in all
  // 121 enemy-side ones. Hit-spark z is the fallback, and a model with neither is told apart by carrying the full set
  // of clips (the signature strike included): that is a player species, the rest are enemies.
  let yaw = 0, spark = 0;
  for (const a of actions) {
    for (const o of a?.ops ?? []) {
      const w = o.words;
      if (o.op === 6 && w?.[0] === 0 && w.length >= 8) yaw += (w[6] | 0) % 4096 ? 1 : -1;
      else if (o.op === 3 && w?.[0] === 0 && w.length >= 5 && !SCREEN_Z(w[4] | 0)) spark += w[4] | 0;
    }
  }
  const full = actions.filter((a) => a?.ops?.length).length >= 12;
  const side = yaw > 0 ? "player" : yaw < 0 ? "enemy" : spark > 0 ? "player" : spark < 0 ? "enemy" : full ? "player" : "enemy";
  cache.set(actions, side);
  return side;
}

/** A copy of an op list turned around (the donor clips of clip-fallback.js, which are player-authored). */
export function mirrorOps(ops) {
  return ops.map((o) => {
    const w = o.words ? o.words.slice() : o.words;
    if (!w) return o;
    if (o.op === 3 && w[0] === 0 && w.length >= 5 && !SCREEN_Z(w[4] | 0)) { w[2] = -(w[2] | 0); w[4] = -(w[4] | 0); }
    else if (o.op === 6 && w[0] === 0 && w.length >= 8) { w[2] = -(w[2] | 0); w[4] = -(w[4] | 0); w[6] = (w[6] | 0) - HALF_TURN; }
    else if (o.op === 2 && w[0] === 3) { w[2] = -(w[2] | 0); w[4] = -(w[4] | 0); }
    return { ...o, words: w };
  });
}

/** The hooks an action VM reports to, with every arena position turned around. */
export function mirrorHooks(h) {
  return {
    ...h,
    onMove: (rec) => h.onMove?.(rec?.kind === "to" ? { ...rec, x: -rec.x, z: -rec.z } : rec),
    onEffect: (rec) => h.onEffect?.(SCREEN_Z(rec.z | 0) ? rec : { ...rec, x: -rec.x, z: -rec.z }),
    setLunge: (l) => h.setLunge?.(l?.sub === 0 && l.from
      ? { ...l, from: [-l.from[0], l.from[1], -l.from[2]], to: [l.to[0], wrap(l.to[1]), l.to[2]] }
      : l),
  };
}
