// ANIME set: hand-painted / Ghibli-style Sketchfab models (CC-BY, author in the label + CREDITS.md) and CC0 packs (KayKit Forest).
//  1. grid: entries(tab) = the "Anime" category of every tab (name, author, licence, tris, draws)
//  2. biome: apply(tab, ctx, biome) = the per-tab "Use anime set" toggle (default OFF). It hides the weaker species (Quaternius trees/bushes/grass,
//     procedural palms, lily pads ...) and instances the anime models in their place: trees/palms = LODSpecies (mesh -> yaw impostor),
//     everything else = CullSet (16 m cells + frustum + GPU fade). Painted albedo is kept (no photo grade), shading is the gentle toon band.
// Catalog: assets/anime.json (built by tools/biome_build_anime_catalog.mjs from the download results; no disc data).
import * as THREE from "three";
import { rng, composeTRS, LODSpecies, bakeImpostor, CullSet, tris, terrainH } from "./toolkit.js";
import { loadToon, loadRaw, partsGroup } from "./loader.js";
import { beachH, shoreZ, POOLS } from "./beachproc.js";
import { lakeH, lakeD } from "./lakeproc.js";
import * as M from "./mtlaw.js";

const ASSETS = new URL("./assets/", import.meta.url).href;
export const catalog = await fetch(ASSETS + "anime.json").then((r) => (r.ok ? r.json() : [])).catch(() => []);

/** which kinds are listed in which tab's grid */
const TAB_KINDS = {
  forest: ["tree", "pine", "cherry", "deadtree", "bush", "plant", "grass", "flower", "mushroom", "wood", "rock"],
  beach: ["palm", "shell", "seaweed", "rock", "grass", "plant", "wood", "bush", "flower"],
  lake: ["lily", "reed", "seaweed", "willow", "tree", "cherry", "plant", "grass", "rock", "wood", "flower", "bush"],
  mountain: ["mountain", "snowtree", "pine", "rock", "cliff", "plant", "flower", "grass", "bush", "deadtree"],
  shared: ["grass", "rock", "flower", "plant", "bush", "mushroom", "wood", "kit", "other"],
};
/** target size per kind: [how, metres]  (h = height, m = largest extent) */
const SIZE = { tree: ["h", 8], pine: ["h", 9], snowtree: ["h", 8], cherry: ["h", 7], deadtree: ["h", 6], palm: ["h", 7], willow: ["h", 7], bush: ["m", 1.4], plant: ["m", 0.9], grass: ["m", 0.7],
  flower: ["m", 0.45], seaweed: ["h", 0.8], mushroom: ["m", 0.3], lily: ["m", 0.9], reed: ["h", 1.6], rock: ["m", 1.2], cliff: ["m", 6], mountain: ["m", 40], wood: ["m", 2.2], shell: ["m", 0.2], kit: ["m", 3], other: ["m", 2] };
const PAINT = { shadeK: 0.86, rim: 0.16 };           // gentle toon band, painted albedo untouched (no grade)

async function toonOf(it, o = {}) {
  const url = ASSETS + it.rel, raw = await loadRaw(url), [how, v] = SIZE[it.kind] || ["m", 1];
  const ext = how === "h" ? raw.size.y : Math.max(raw.size.x, raw.size.y, raw.size.z);
  return loadToon(url, { scale: v / Math.max(ext, 1e-3) * (o.mul || 1), ...PAINT, ...o });
}
const authorLine = (it) => (it.pack ? `${it.packName}` : `Sketchfab: ${it.author}`);
export function entries(tab) {
  const kinds = TAB_KINDS[tab] || [];
  return catalog.filter((it) => kinds.includes(it.kind)).map((it) => ({
    id: `an_${tab}_${it.id}`, cat: "Anime", name: `${it.name} (${it.kind})`, source: authorLine(it), licence: it.licence, url: it.url, noSpin: false,
    make: async () => partsGroup((await toonOf(it, { wind: 0.25, flutter: it.kind === "grass" || it.kind === "plant" ? 0.4 : 0.2 })).parts),
  }));
}

// ------------------------------------------------------------------ per-tab environment + plan
const nz = (x, z, f, s) => M.vnoise(x, z, f, s);
const ENV = {
  forest: { H: (x, z) => terrainH(x, z), ok: (x, z) => Math.hypot(x, z) > 6.5, area: [0, 0, 68, 68],
    hide: /^(CommonTree|TwistedTree|Pine_\d|fir_tree|birch|ezoak|Bush_Common|shrub|Grass_Common|Grass_Wispy|Fern_1|fern_02|Plant_)/i,
    plan: [
      { kinds: ["tree", "pine", "cherry"], n: 200, maxSp: 5, minD: 3.6, lod: true, sc: [0.8, 1.3], dens: (x, z) => 0.25 + nz(x, z, 0.03, 1) },
      { kinds: ["bush"], n: 260, maxSp: 4, sc: [0.8, 1.5], fade: [34, 56] },
      { kinds: ["grass"], n: 900, maxSp: 4, sc: [0.8, 1.5], fade: [24, 44], dens: (x, z) => 0.2 + nz(x, z, 0.05, 4) },
      { kinds: ["plant"], n: 320, maxSp: 4, sc: [0.8, 1.4], fade: [28, 48] },
      { kinds: ["flower"], n: 240, maxSp: 4, sc: [0.8, 1.4], fade: [24, 44], dens: (x, z) => nz(x, z, 0.07, 9) },
      { kinds: ["mushroom"], n: 70, maxSp: 4, sc: [0.8, 1.6], fade: [26, 46] },
      { kinds: ["rock"], n: 40, maxSp: 4, sc: [0.7, 2.2], fade: [70, 110] },
      { kinds: ["wood"], n: 24, maxSp: 4, sc: [0.8, 1.5], fade: [60, 100] },
    ] },
  beach: { H: (x, z) => beachH(x, z), area: [0, 55, 100, 70],
    ok: (x, z) => { const D = z - shoreZ(x); return D > 6 && Math.hypot(x, z) > 4 && !POOLS.some(([px, pz, r]) => Math.hypot(x - px, z - pz) < r * 2.4); },
    hide: /^(palm |Rock_Medium|Grass_Common_Tall|Grass_Wispy_Tall|sea grape)/i,
    plan: [
      { kinds: ["palm"], n: 70, maxSp: 4, minD: 4, lod: true, sc: [0.8, 1.3], dens: (x, z) => 0.3 + nz(x, z, 0.04, 2), okx: (x, z) => z - shoreZ(x) > 10 },
      { kinds: ["bush"], n: 140, maxSp: 3, sc: [0.8, 1.5], fade: [34, 56], okx: (x, z) => z - shoreZ(x) > 16 },
      { kinds: ["grass"], n: 700, maxSp: 4, sc: [0.8, 1.5], fade: [26, 46], okx: (x, z) => z - shoreZ(x) > 11 },
      { kinds: ["plant", "flower"], n: 200, maxSp: 4, sc: [0.8, 1.4], fade: [28, 48], okx: (x, z) => z - shoreZ(x) > 12 },
      { kinds: ["rock"], n: 40, maxSp: 4, sc: [0.7, 2.2], fade: [80, 120] },
      { kinds: ["wood", "shell"], n: 40, maxSp: 8, sc: [0.8, 1.5], fade: [50, 90] },
      { kinds: ["seaweed"], n: 50, maxSp: 4, sc: [0.8, 1.5], fade: [40, 70], okx: (x, z) => z - shoreZ(x) < 10 },       // wrack line
    ] },
  lake: { H: (x, z) => lakeH(x, z), area: [0, -8, 105, 108], ok: (x, z) => lakeD(x, z) < -2.5 && Math.hypot(x, z - 16) > 5,
    hide: /^(willow|birch|alder|tree_small|Bush_Common|shrub|Grass_Common|Grass_Wispy|Plant_|white lily|pink lily|lily pad|lotus)/i,
    plan: [
      { kinds: ["willow", "tree", "cherry"], n: 90, maxSp: 4, minD: 4, lod: true, sc: [0.8, 1.3], okx: (x, z) => lakeD(x, z) < -4, mirror: true },
      { kinds: ["bush"], n: 150, maxSp: 3, sc: [0.8, 1.5], fade: [34, 56] },
      { kinds: ["reed"], n: 160, maxSp: 5, sc: [0.8, 1.5], fade: [36, 64], okx: (x, z) => lakeD(x, z) > -9 },          // bank reeds / cattails
      { kinds: ["grass", "reed"], n: 800, maxSp: 4, sc: [0.8, 1.5], fade: [26, 46], dens: (x, z) => 0.3 + nz(x, z, 0.05, 4) },
      { kinds: ["plant", "flower"], n: 220, maxSp: 4, sc: [0.8, 1.4], fade: [28, 48] },
      { kinds: ["rock"], n: 36, maxSp: 4, sc: [0.7, 2.0], fade: [80, 120] },
      { kinds: ["wood"], n: 20, maxSp: 3, sc: [0.8, 1.5], fade: [60, 100] },
      { kinds: ["lily"], n: 170, maxSp: 4, sc: [0.8, 1.6], fade: [46, 80], water: true },
    ] },
  mountain: { H: (x, z) => M.mtH(x, z), area: [0, -30, 90, 90], ok: (x, z) => M.waterDist(x, z) > 2 && Math.hypot(x - 2, z - 6) > 12,
    hide: /^(range \d|spruce|larch|fir_tree|Pine_|pine_sapling|Grass_Common|Grass_Wispy|Flower_|dandelion|Clover|Plant_1)/i,
    plan: [
      { kinds: ["snowtree", "pine"], n: 120, maxSp: 5, minD: 3.6, lod: true, sc: [0.8, 1.35], okx: (x, z, h) => h < 30 && M.mtInfo(x, z).ny > 0.82 },
      { kinds: ["bush", "plant", "flower"], n: 260, maxSp: 4, sc: [0.8, 1.4], fade: [30, 52], okx: (x, z, h) => h < 40 },
      { kinds: ["flower"], n: 150, maxSp: 5, sc: [0.8, 1.4], fade: [26, 48], okx: (x, z, h) => h < 40 },              // alpine flowers
      { kinds: ["grass"], n: 700, maxSp: 3, sc: [0.8, 1.4], fade: [26, 46], okx: (x, z, h) => h < 40 },
      { kinds: ["rock"], n: 50, maxSp: 4, sc: [0.8, 2.4], fade: [90, 140] },
      { kinds: ["cliff"], n: 14, maxSp: 3, sc: [1.2, 2.4], fade: [150, 220], far: true },
    ] },
  shared: { H: (x, z) => terrainH(x, z, 1.6), area: [0, 0, 68, 68], ok: (x, z) => Math.hypot(x, z) > 3,
    hide: /^(Grass_|Rock_Medium|rock_|stone_|boulder)/i,
    plan: [
      { kinds: ["grass"], n: 900, maxSp: 4, sc: [0.8, 1.5], fade: [26, 48] },
      { kinds: ["flower", "plant", "bush"], n: 320, maxSp: 5, sc: [0.8, 1.4], fade: [28, 48] },
      { kinds: ["rock"], n: 36, maxSp: 4, sc: [0.7, 2.2], fade: [80, 120] },
    ] },
};

function darts(n, seed, minD, area, ok) {
  const r = rng(seed), grid = new Map(), out = [], [cx0, cz0, hw, hd] = area; let tries = 0;
  while (out.length < n && tries++ < n * 50) {
    const x = cx0 + (r() * 2 - 1) * hw, z = cz0 + (r() * 2 - 1) * hd; if (!ok(x, z, r)) continue;
    const cx = Math.floor(x / minD), cz = Math.floor(z / minD); let bad = false;
    for (let i = -1; i <= 1 && !bad; i++) for (let j = -1; j <= 1 && !bad; j++) for (const p of grid.get((cx + i) + "," + (cz + j)) || []) if (Math.hypot(p[0] - x, p[1] - z) < minD) { bad = true; break; }
    if (bad) continue; out.push([x, z]); const k = cx + "," + cz; if (!grid.has(k)) grid.set(k, []); grid.get(k).push([x, z]);
  }
  return out;
}
function points(pl, env, seed) {
  const h = (x, z) => env.H(x, z);
  if (pl.water) return darts(pl.n, seed, 1.4, [0, -26, 56, 56], (x, z) => { const d = lakeD(x, z); return d > 1.2 && d < 17; });
  if (pl.far) return darts(pl.n, seed, 18, env.area, (x, z) => Math.hypot(x, z + 10) > 55);
  return darts(pl.n, seed, pl.minD || 0.5, env.area, (x, z, r) => env.ok(x, z) && (!pl.okx || pl.okx(x, z, h(x, z))) && (!pl.dens || r() < pl.dens(x, z)));
}

/** Pick up to maxSp catalog items of the kinds, lightest per kind first (keeps tris and draws down). */
function pick(kinds, maxSp, triMax) {
  const per = kinds.map((k) => catalog.filter((it) => it.kind === k && it.tris > 0 && it.tris <= triMax && !it.noScatter).sort((a, b) => a.tris - b.tris));
  const out = []; let i = 0;
  while (out.length < maxSp && per.some((l) => i < l.length)) { for (const l of per) if (i < l.length && out.length < maxSp) out.push(l[i]); i++; }
  return out;
}

/**
 * Mountain-tab backdrop: the anime "mountain" models (Sketchfab, distant ranges) as a far ring replacing the procedural range layers (which the hide regex turns off).
 * Each model is scaled to a ~380 m wide / 70-130 m high silhouette, its base buried, ring radius 285-325 m (inside the 500 m far plane), centred on the camera xz
 * like the procedural ranges (no parallax). Aerial haze = the fog colour mixed over the final colour, stronger for the outer layers.
 */
async function mountainBackdrop(root, info) {
  const list = catalog.filter((it) => it.kind === "mountain"); if (!list.length) return 0;
  const fogCol = new THREE.Color(0xc9dcec).convertLinearToSRGB(), g = new THREE.Group(); g.name = "anime mountain backdrop"; let n = 0;
  for (let i = 0; i < list.length; i++) {
    const it = list[i], raw = await loadRaw(ASSETS + it.rel), ext = Math.max(raw.size.x, raw.size.z, 1e-3), hz = 0.42 + 0.18 * (i % 3);
    let k = 380 / ext; if (raw.size.y * k < 70) k = 70 / raw.size.y; if (raw.size.y * k > 130) k = 130 / raw.size.y;   // silhouette 70-130 m high
    const tl = await loadToon(ASSETS + it.rel, { scale: k, ...PAINT, ground: false });
    for (const p of tl.parts) { const m = p.mat; m.userData.tag = "mtnhaze"; m.fog = false; const prev = m.onBeforeCompile;
      m.onBeforeCompile = (sh, r) => { prev(sh, r); sh.uniforms.uHazeC = { value: fogCol }; sh.uniforms.uHazeK = { value: hz };
        sh.fragmentShader = "uniform vec3 uHazeC; uniform float uHazeK;\n" + sh.fragmentShader.replace("#include <dithering_fragment>", "gl_FragColor.rgb = mix(gl_FragColor.rgb, uHazeC, uHazeK);\n#include <dithering_fragment>"); }; }
    const a = (i / list.length) * Math.PI * 2 + 0.4, R = 285 + (i % 3) * 20, grp = partsGroup(tl.parts);
    grp.position.set(Math.cos(a) * R, -22 - raw.box.min.y * k, Math.sin(a) * R); grp.rotation.y = -a + Math.PI / 2 + (i % 2 ? Math.PI : 0);
    grp.traverse((o) => { o.frustumCulled = false; }); g.add(grp); n++;
    info.species.push({ name: `anime mountain ${it.id}`, n: 1, tris: tl.tris });
  }
  root.userData.follow = (cam) => { g.position.set(cam.position.x, 0, cam.position.z); };
  root.add(g); return n;
}

/**
 * Swap the weaker species of a built biome for the anime set. Mutates biome (hides groups, wraps update, adjusts info.species).
 * Returns { hidden, added, tris }.
 */
export async function apply(tab, ctx, biome) {
  const env = ENV[tab]; if (!env) return null;
  const { renderer } = ctx, root = new THREE.Group(); root.name = "anime set";
  const lods = [], cull = new CullSet(), info = biome.info;
  // hide the weaker species (top-level groups under the biome root, also nested one level)
  const hid = new Set(); const hide = (o) => { for (const c of o.children) { if (c.name && env.hide.test(c.name)) { c.visible = false; hid.add(c.name); } else if (c.isGroup && !c.children.some((k) => k.isInstancedMesh) && c.children.length < 40) hide(c); } };
  hide(biome.root);
  info.species = info.species.filter((s) => !env.hide.test(s.name));
  let added = 0, seed = 700;
  for (const pl of env.plan) {
    const triMax = pl.lod ? 12000 : pl.kinds.includes("cliff") ? 12000 : pl.kinds.includes("rock") || pl.kinds.includes("wood") ? 6000 : 3500;
    const items = pick(pl.kinds, pl.maxSp, triMax); if (!items.length) continue;
    const pts = points(pl, env, seed++); if (!pts.length) continue;
    for (let s = 0; s < items.length; s++) {
      const it = items[s], mine = pts.filter((_, i) => i % items.length === s); if (!mine.length) continue;
      const r = rng(seed * 31 + s), mats = new Float32Array(mine.length * 16);
      const sink = pl.far ? -1.2 : it.kind === "rock" ? -0.12 : -0.05;
      const tl = await toonOf(it, { wind: pl.lod ? 0.3 : it.kind === "rock" || it.kind === "cliff" || it.kind === "wood" ? 0 : 0.5, flutter: pl.lod ? 0.5 : 0.35, trans: pl.lod ? 0.25 : 0, fade: pl.fade || null });
      mine.forEach(([x, z], i) => {
        const y = pl.water ? 0.03 : env.H(x, z) + sink;
        composeTRS(mats, i, x, y, z, r() * 6.283, pl.sc[0] + (pl.sc[1] - pl.sc[0]) * r(), pl.lod ? 0.03 * r() : it.kind === "rock" || it.kind === "cliff" ? 0.1 * r() : 0.12 * r(), r() * 6.283);
      });
      const name = `anime ${it.kind} ${it.id}`;
      if (pl.lod) {
        const imp = bakeImpostor(renderer, partsGroup(tl.parts), 8, 256);
        const sp = new LODSpecies(name, [{ parts: tl.parts }, { impostor: imp.factory }], mats, mine.length, [42]); lods.push(sp); root.add(sp.group);
        if (pl.mirror) { const rs = new LODSpecies(name + " (mirror)", [{ impostor: imp.factory }], mats, mine.length, [0]); rs.group.traverse((x) => x.layers.set(1)); rs.update({ position: new THREE.Vector3(0, 0, 0) }, true); root.add(rs.group); }
        info.impostors = (info.impostors || 0) + 1;
      } else { const g = cull.add(tl.parts, mats, mine.length, name); root.add(g); }
      info.species.push({ name, n: mine.length, tris: tl.parts.reduce((a, p) => a + tris(p.geo), 0) }); added += mine.length;
    }
  }
  if (tab === "mountain") added += await mountainBackdrop(root, info);
  biome.root.add(root);
  const upd = biome.update;
  biome.update = (camera, frame) => { upd(camera, frame); if (root.userData.follow) root.userData.follow(camera); for (const s of lods) s.update(camera, frame === 0); cull.update(camera, frame === 0); };
  return { hidden: [...hid], added, species: info.species.filter((s) => s.name.startsWith("anime ")).length };
}
