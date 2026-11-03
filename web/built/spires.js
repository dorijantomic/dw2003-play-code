// ROCK SPIRES of the BUILT arena (Arena Viewer look=built only; recipe kind "spire", meft1002 = South Cape / Shell
// Beach). What the original draws is a big cliff WALL of many tall, PALE lavender-white rock pillars packed side by
// side, dark green shrubs on their ledges and in the cracks, a rock mass behind the pillars that fills every gap, and
// pillar islands standing in the sea. This module builds that, from the recipe's own numbers.
//
// WHERE  one WALL PANEL per upright PICTURE CARD of the recipe's spire pieces (`cards`, measured from the arena's own
//        triangles by tools/arena_built_recipe.py: base / dir / w / h / copies). A card is one tile of the original's
//        cardboard cliff: w wide, h tall, standing with its BASE POINT at the card's base, `copies` picture repeats
//        across it. A panel keeps all of them:
//          - its azimuth and radius are the card's own XZ; its azimuth span is the card's own width at that radius
//            (2 atan(w / 2r)), so the six panels tile the measured arc az -140.7 .. -38.3 (that is what the measured
//            cards are: the facets of one ring). Its pillars run EDGE TO EDGE across that span (t = i / (n - 1)), so
//            the last pillar of one card and the first of the next are exactly one pitch apart - a centre-in-slot
//            spread (t = (i + 0.5) / n) stops half a pitch short of both edges and opened a ~1 deg slot of SKY at
//            every seam; the checker now renders the wall alone on a magenta clear and counts the columns that see
//            background right through it;
//          - its pillar pitch is the recipe's own picture repeat, w / copies (340..393 u on the four big cards), i.e.
//            PILLAR_W_K x h, and its pillar count is round(w / pitch) but NEVER below MIN_PER_PANEL - a narrow card
//            (666 u at the flanks) would otherwise round down to ONE pillar and read as a bollard, not a cut wall.
//            That count is a hard invariant: `Math.max(undefined, n)` is NaN, and one NaN there poisons the pitch, the
//            radius, the panel's axis and its mass's column count, i.e. 208 card vertices and the whole rock buffer;
//          - its top is the card's own height: base 273.3 + 3136 = 3409.3 = the pieces' measured ymax, exactly.
//        Two card kinds, told apart by measurement, not by name:
//          wall    stands on the arena's own shore: the sand/shore meshes (ctx.ground) have a vertex within
//                  GROUND_PATCH of the base whose y equals the card's base y (GROUND_TOL). On meft1002 the six wall
//                  cards (w 666-1963, h 3136, base y 273.3 = the shore rim's measured plateau) are the wall.
//          island  stands in the sea: no sand under it, its base y is the WATER pieces' measured surface (waterTop, 0
//                  on meft1002) and water/sea geometry is within WATER_PATCH of its base in xz (meft1002's eight cards
//                  at base y 0, r 5783-9930, every one within 45 units of a water/sea triangle). An island is a
//                  cluster of pillars sharing one fused foot; its skirt runs from the base down to below the water
//                  pieces' measured floor (waterFloor, -1192.8) by STACK_SKIRT_BURY, so no gap can open at the water.
//        A card that is neither on the shore nor in the water is skipped and listed in info.spires.skipped.
// SHAPE  (research: ~/dw3-knowledge/research/r4/rocks.md section 5, P0 items 1 and 4)
//        1. TOWER GENERATOR. A pillar is a lathed radius profile - talus flare, stem pinch (the undercut), tapering
//           body, domed shoulder, flat broken top - cut by two near-vertical joint families and a bedding sawtooth, so
//           one pillar reads as a few thin columns packed together. The joints drift with height (the "+ y * 0.022"
//           trick of maxliebscher's limestone grammar), which is what makes them look cut, not extruded. Every pillar
//           of every panel, the mass behind them and the sea islands are merged into ONE indexed BufferGeometry: one
//           draw call for the whole cliff.
//        2. The wall LEANS BACK: each pillar is sheared outward with height by the piece's own MEASURED lean (wall_00:
//           its nearest radius goes 4111.5 at the base to ~4403 at the top, 292 u over 3136 = 5.3 deg), so the face is
//           battered like a cliff instead of standing like a cylinder.
//        3. SCRAPE PASS (gl-rock, Erkaman, MIT): SCRAPES flattened, near-vertical, soft-edged planes per pillar, so
//           the flanks are chiselled facets rather than a lathe. It only ever cuts INWARD, so a pillar's footprint
//           radius R stays a true upper bound and the keep-out proof below holds exactly.
//        4. A MASS behind the pillars (one low strip per panel) fills the cracks between them, so the wall reads as one
//           cliff with dark joints and never as a picket fence with sky through it.
// MATERIAL  (P0 items 2-3) The rock is NOT toon-banded any more: it is a smooth key + sky fill + ground bounce + rim
//        over the SAME shared light uniforms (uLightDir / uLightColor / uAmbient / uShadowTint / uSkyFill /
//        uGroundBounce / uRimColor / uShadeK / uShadowMix: sun by day, moon by night), with
//          triplanar grain   one fbm3 of the shared 3D noise, sampled in the plane of the dominant normal axis (the
//                            recipe ships no textures, so the "texture" is the shared noise, evaluated metrically)
//          strata            horizontal beds along world y, faded out on upward faces, drifting the albedo between the
//                            piece's MEASURED p90 (pale) and `other` (mid) tones
//          baked AO          per vertex - groove bottoms, joint bottoms, the crack between two pillars, the band under
//                            every shelf, the foot, and the whole mass behind. Each term is a NARROW window on the
//                            thing that occludes (a groove bottom, the ~3 sectors facing a neighbour, the 20% of a bed
//                            under its shelf) and the product is remapped once (AO_CURVE), because wide windows
//                            multiplied together left the MEDIAN face at 0.47 and the whole cliff at half its tone.
//                            The shader then MULTIPLIES the body and tints only the deepest part with the piece's p10.
//          slope moss        green where the surface faces up, in noise patches - the same mask that plants the shrubs
//        WHICH measured tone is the rock matters: p90 is the pale lavender-white (wall_00 [194,180,211]), `other` the
//        mid tone ([131,118,146]) and p10 the crevice ([28,33,20]). The picture's median "all" is [90,92,79] - dark
//        only because the picture is mostly shade and foliage - and using it as the body tone is what made the old
//        domes read grey-green instead of pale. Every vertex carries its own pillar's tone (aRock), so neighbouring
//        pillars separate by a few percent of value with a little hue shift, never by an outline. aerial() (the shared
//        haze toward skyRadiance) is applied last, exactly as the rest of the built world does.
//        THE TARGET IS THE ORIGINAL'S OWN CLIFF TEXTURE (web/assets/battle/arenas/meft1002/wall.png): 68% of it is
//        the pale tone [199,191,215], 21% its cracks [38,38,41], 11% green, and it has NOT ONE blue-dominant pixel.
//        So the shade may not be a blue wash: the shade tint is normalised to unit brightness and pulled to a neutral
//        cool (ROCK_COOL/SHADE_WHITE), the shared sky-fill term is damped (SKY_FILL_K) and the rock keeps 90% of the
//        shared shade weight (SHADE_K). Measured on the built wall from the arena camera: 48-54% pale, 18% mid, 18-20%
//        dark, 12-15% green - the dark and green are the reference's, the pale is 20 points lower only because a 3D
//        cliff has shaded flanks where a painted card has none. verify_built_spires.mjs asserts the body is the
//        measured p90 tone, the deepest 10% is a real crevice and the shade keeps >= 75% of the body's value.
// VEGETATION  (P1 items 5-7) MeshSurfaceSampler is not needed: the ledges are known analytically, so bushes are
//        planted ON the lip of every bedding ledge (the outermost ring of a bed, NOT its foot ring - a shrub on the
//        foot sits under the overhang and is never seen) and in the joint cracks, sunk BUSH_SINK into the rock, from
//        exactly the vertices the mesh draws (so the checker can prove the fit). The geometry is ez-tree's own bush
//        (presets Bush 1..3, cut down to BUSH_LOD), baked to three variants and instanced (one InstancedMesh per
//        variant). The far islands, the mass's ridge and EVERY LEDGE LINE of the wall get alpha-tested BUSH CARDS (2
//        triangles each): the original paints its shrubs right across the cliff face, and the geometry shrubs alone
//        (31 of them) covered 1% of the frame where the reference texture is 11% green - with the ledge cards the
//        built wall lands at 11.9%.
// NAN INVARIANTS  every number that reaches a group is audited at build time (info.problems) and every position and
//        normal of every buffer is counted after each rebuild (info.nan), and the checker fails on either being
//        non-zero. Three NaNs got in here before: (a) MIN_PER_PANEL did not exist, so Math.max(undefined, n) was NaN
//        -> n, pitch, R, the axis and the mass's cols were all NaN and the rock buffer came out 0-length;
//        (b) the "crack" shrub index was tpl.sec / 4, which is 3.5 for 14 sectors - a fractional vertex index reads
//        past the buffer and every one of those instance matrices carried a NaN translation (42 of 61 shrubs were
//        silently invisible); (c) rockMesh.visible was tied to "some shrub has instances", so a shrub mistake took
//        the whole cliff out of the frame. Each mesh's visibility is its own now.
// KEEP-OUT  the trees' own test (ctx.keepOut.reject, web/arena-built.js) over each GROUP's bounding spheres; a group
//        is one wall panel (with its mass), or one sea island. A group that fails at its recipe spot is pushed
//        straight outward (PUSH steps, up to PUSH_MAX x R) and hidden if it still fails. Because the eye ring is swept
//        round the full circle (the idle camera spins) a group also has to clear max(fight radius + NEAR_CLEAR, the
//        farthest fighter's SURFACE + NEAR_CLEAR, the recipe's own rmin) - on meft1002 4111.5 > ~3930 (the farthest
//        fighter surface), which is the proof that no spire can stand in the fight or between the eye and a fighter,
//        independent of the sphere test. On top of that every pillar's footprint is laid so that its nearest vertex
//        clears that floor by construction (a panel's radius is pushed out until r - R >= the floor), so in practice
//        nothing ever moves.
//
// SOURCES  gl-rock (github.com/Erkaman/gl-rock, MIT) - the planar scrape: project a region's vertices onto a plane
//          set STRENGTH behind the surface, with a soft window instead of a flood fill.
//          maxliebscher/threejs-procedural-rocks-cliffs (MIT) - the limestone joint/bedding grammar (two warped
//          vertical joint families, bedding partings, drift with height) and the triplanar + strata + slope-mask
//          material, re-implemented for a raw ShaderMaterial with no textures and no PBR.
//          ez-tree (github.com/dgreenheck/ez-tree, MIT, (c) Daniel Greenheck) - bush branch/leaf geometry:
//          web/lib3d/ez-tree.es.js + ez-tree.LICENSE. Leaf-cluster alpha canvas: fluffytree-threejs (MIT, (c) 2025
//          Leonardo Soares Goncalves) web/lib3d/fluffytree/fluffy.js + LICENSE.
//          The shared light, the noise (GLSL + JS twin), the palette, the aerial haze, the keep-out cone test and
//          srgb(): web/built/shared.js. three.js (MIT) for geometry, instancing and merging. Nothing else is copied.
//          The SDF/marching option, smin and the erosion filter of the report are NOT used (its P2/P3: this is a
//          20-pillar backdrop, and a heightfield cannot make these shapes).
//
// VALUES MEASURED (read from the recipe at build time; nothing hardcoded): every card's base/dir/w/h/copies, every
//   piece's rmin/rmax/ymin/ymax and colours (p10/all/p90/green/other), each piece's wall lean (from the
//   minimum-radius envelope of its own triangles), the shore plateau top (273.3) and the sand top (4.5), the water
//   pieces' surface (waterTop 0) and floor (waterFloor -1192.8), the sea pieces' floor (-2150.4), and the nearest
//   water/sea triangle to each island card (<= 45 units on meft1002).
// VALUES PICKED (not measured) - every one is a named constant in SPIRE below, so the look tunes in one place: the
//   pillar profile (TAPER/STEM/TALUS/CROWN), the joints (FLUTE_N/JOINT_N/FLUTE_DEPTH/JOINT_DEPTH/JOINT_DRIFT), the
//   bedding (LEDGES/LEDGE_DEPTH/LEDGE_SHELF), the scrape (SCRAPES/SCRAPE_STRENGTH/SCRAPE_R), the baked AO (AO_* and
//   AO_CURVE), the material (GRAIN_*/STRATA_*/VSTRIPE*/AO_KEY/AO_SHADE/AO_DARK/P10_MIX/MOSS_* and the shade pair
//   SHADE_K/ROCK_COOL/SHADE_WHITE/SKY_FILL_K), the vegetation (BUSH_*/CARD_*/CARD_LEDGE_*), the mass behind
//   (DEPTH_BACK/BACK_TOP/BACK_JAG/BACK_TONE), the skirts (WALL_SKIRT/STACK_SKIRT_BURY/SKIRT_K) and the placement
//   (MIN_PER_PANEL/NEAR_CLEAR/PUSH/PUSH_MAX/BANDS).
import * as THREE from "../lib3d/three.module.js";
import * as S0 from "./shared.js";
import * as F from "../lib3d/fluffytree/fluffy.js";
import { Tree, TreePreset } from "../lib3d/ez-tree.es.js";

const TAU = Math.PI * 2;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);

export const SPIRE = {
  // ---------------- the pillars ----------------
  SECTORS: 14,              // around a wall pillar (18 was 28k triangles of wall on its own; at 14 a pillar is still
                            // round, and the scrape pass + the joints carry the facets)
  ISLAND_SECTORS: 8,        // the sea islands are small on screen
  LEDGES: 7,                // bedding bands up a wall pillar (7 over 3136 u = 448 u = 1.12 m apart)
  ISLAND_LEDGES: 4,
  BED_U0: 0.20,             // beds start above the stem
  LEDGE_DEPTH: 0.075,       // how far a bed's shelf stands out, as a share of R (0.075 x 165 u = 31 u = 8 cm)
  LEDGE_SHELF: 0.30,        // share of a bed's height over which the shelf grows out
  PILLAR_W_K: 0.12,         // pillar pitch = h x this = 376 u = 0.94 m (the recipe's own picture repeat: 340..393 u)
  PACK: 1.08,               // footprint radius vs the pillar's slot: neighbours overlap a little, so feet fuse
  TAPER: 0.11,              // the body narrows by this share from foot to shoulder
  STEM: 0.15, STEM_U: 0.075, STEM_W: 0.05,   // the undercut above the talus
  TALUS: 0.20, TALUS_U: 0.05,                // flare at the foot, buried in the beach
  CROWN_U: 0.84, CROWN_TOP: 0.42,            // domed shoulder, flat broken top
  TOP_VAR: 0.16,            // a pillar's crown sits up to this share of h below its card's top
  TONE_JIT: 0.05, TONE_HUE: 0.03,            // per-pillar value and hue spread (report 1.8: +-3-6 % value)
  FLUTE_N: 3,               // joint family A: thin columns around a pillar
  JOINT_N: 2,               // joint family B: a second set at another angle
  JOINT_DRIFT: 0.30,        // the joint planes drift with height (maxliebscher)
  FLUTE_DEPTH: 0.085, JOINT_DEPTH: 0.055,
  GRAIN: 0.020,             // micro noise on the radius
  SCRAPES: 18, SCRAPE_STRENGTH: 0.020, SCRAPE_R: 0.80,   // gl-rock scrape (window width in radians)
  LEAN_K: 1.0,              // share of the piece's measured wall lean
  DEPTH_BACK: 2.05,         // the mass behind the pillars, in pillar radii
  BACK_TOP: 0.97, BACK_JAG: 0.10,            // the mass's ridge (relative to h) and its jaggedness
  BACK_TONE: 0.86,          // the mass is a little darker than the pillars in front of it
  MARGIN: 40,               // clearance the pillars keep beyond the recipe's own rmin
  // ---------------- islands ----------------
  ISLAND_W_K: 0.32,         // island pillar pitch = h x this (chunkier than the wall's)
  ISLAND_TOP_VAR: 0.26, ISLAND_JITTER: 0.45, // a cluster's pillars differ in height and depth
  STACK_SKIRT_BURY: 250,    // how far an island's skirt reaches below the water pieces' measured floor
  WALL_SKIRT: 240,          // how far a wall pillar's skirt reaches below the shore plateau
  SKIRT_K: 0.98,            // the skirt's radius, as a share of the talus radius
  // ---------------- baked AO ----------------
  AO_GROOVE: 0.62, AO_JOINT: 0.34,          // groove bottom / joint bottom (both on the SQUARE of the groove depth)
  AO_CRACK: 0.85, AO_CRACK_P: 6,            // the gap between two pillars in a row: a near-black joint, the last ~3
                                            // sectors only (|sin|^6) - the reference texture is 21% dark in its cracks
  AO_LEDGE: 0.30, AO_LEDGE_K: 0.35,         // under every shelf / the crevice above it
  AO_BASE: 0.45, AO_BASE_U: 0.10,           // the foot of a pillar
  AO_BACK: 0.78, AO_CROWN: 0.85,            // the mass behind the pillars / a crown's top
  AO_CURVE: [0.10, 0.52],   // the occlusion is remapped once, at bake time, over this range: the raw terms multiply,
                            // so a bare sum left the MEDIAN face at 0.47 and the cliff at 0.54 of its pale tone. Remapped,
                            // the open faces sit at ~0.95 and only a real groove bottom drops below 0.3.
  // ---------------- the rock look ----------------
  GRAIN_SCALE: 0.020,       // 1/u of the triplanar grain (0.02 x 400 = 8 cycles per metre)
  GRAIN_AMP: 0.16,          // the grain's share of the albedo
  STRATA_FREQ: 0.0016,      // beds per unit of height (0.0016 x 448 = 0.72 per bedding band, so one band = one bed)
  STRATA_AMP: 0.060,        // value swing of the strata
  STRATA_MID: 0.24,         // share of the shift towards the piece's `other` tone (the reference cliff texture is 68%
                            // pale [199,191,215]: a heavier mix pulled the body down to a grey-mauve)
  STRATA_WARP: 2.4,         // how much the grain bends the bed boundaries
  VSTRIPE: 0.045, VSTRIPE_F: 0.00042,       // the long vertical striation (a cheap pair of sines)
  VSTRIPE2: 0.022, VSTRIPE2_F: 0.00135,
  AO_KEY: 0.62,             // AO's weight on the lit side (1 = none there, 0 = full)
  AO_SHADE: 0.26,           // AO's weight in the shade (a crevice keeps almost no ambient)
  AO_DARK: 0.20,            // a fully occluded pixel keeps this share of the body tone before the p10 tint
  P10_MIX: 0.75,            // how much of the piece's p10 tone a crevice takes (the p10 IS the crevice colour)
  SHADE_WHITE: 0.90,        // how far the rock's shade hue is pulled to the neutral cool pale stone takes from the sky
                            // (the arena's measured uShadowTint is a saturated blue: raw, it made the cliff violet)
  ROCK_COOL: [0.78, 0.80, 0.87],   // that neutral cool: the reference cliff texture has NO blue pixel at all (its
                            // cracks are [38,38,41]), so the shade may be a touch cool, never a blue wash
  SHADE_K: 1.60,            // the rock's own multiplier on the shared shade weight (uShadeK 0.62 -> 0.90). A pale
                            // limestone wall under a bright beach sky keeps most of its value in shade; at the plain
                            // uShadeK the shaded two thirds of the wall sat at 0.55 of the pale tone and read grey.
  SKY_FILL_K: 0.35,         // the rock's share of the shared sky-fill term. It is a blue-violet hue (the arena's own
                            // uSkyFill), which the whole world adds at 0.10: on a cliff that fills most of the frame that
                            // alone turned the shaded faces blue. The shade tint already carries the sky's cool.
  MOSS_LO: 0.30, MOSS_HI: 0.72,   // the slope mask: green only where the surface faces up
  MOSS_AMT: 0.80, MOSS_PATCH: 0.50,   // how green, and how patched
  LEAF_K: 1.08,             // bush albedo vs the piece's measured green (a leaf's own brightness - not measured)
  // ---------------- the bushes ----------------
  BUSH_LEDGE_P: 0.95,       // chance that a bedding ledge of a wall pillar carries a bush (only ~1 ledge vertex in 5
                            // faces up enough to plant on, so the chance has to be high to get ~2 shrubs per pillar)
  BUSH_CROWN_P: 1.0,        // chance that a pillar's crown carries one (the crown is flat: it always can)
  BUSH_K: [0.50, 1.00],     // bush HEIGHT, in pillar pitches (0.47-0.94 m on a 0.94 m pillar). The reference cliff
                            // texture is ~11% green; the geometry shrubs plus the ledge cards land the built wall at
                            // 15-20%, which reads lush without turning the cliff into a hedge
  BUSH_SINK: 0.34,          // share of the bush's height sunk into the rock
  BUSH_LOD: { branch: { levels: 2, children: { 0: 5, 1: 2, 2: 2 }, sections: { 0: 2, 1: 2, 2: 2, 3: 2 },
                        segments: { 0: 3, 1: 3, 2: 3, 3: 3 } }, leaves: { count: 2, size: 5 } },
  LEAF_ALPHA: 0.42,         // the leaf card's cut
  // ---------------- far cards ----------------
  CARD_ISLAND_R: 8200,      // islands farther than this get cards, not geometry
  CARD_PER_ISLAND: 8,       // cards on such an island
  CARD_MASS_K: 0.9,         // cards along the mass's ridge, per pillar
  CARD_K: [0.55, 1.15],     // card width, in pillar pitches
  CARD_LEDGE_KEEP: 0.32,    // share of the ledge slots that keep a shrub card (0.55 covered 26% of the wall,
  CARD_LEDGE_PITCH: 1.55,   // one ledge slot every this many pillar pitches along the panel (the reference
                          // cliff texture is 11% green: this pair lands the built wall at 10-12%)
  CARD_LEDGE_SINK: 0.22,    // how far below a shelf's lip the card's base sits (into the ledge, never in the air)
  // ---------------- placement ----------------
  MIN_PER_PANEL: 2,         // a panel never gets fewer pillars than this: a narrow card (666 u at the wall's flank)
                            // would otherwise round down to ONE pillar and read as a fat bollard, not a cut wall
  NEAR_CLEAR: 100, GROUND_TOL: 0.5, GROUND_PATCH: 600, WATER_PATCH: 600,
  PUSH: 0.15, PUSH_MAX: 0.9, BANDS: 4, SEED: 1002,
};

// ============================================================================================ one pillar's maths
/** A pillar's radius profile at height fraction u (0 = foot, 1 = crown), as a share of its radius R. */
export function profileAt(u) {
  const P = SPIRE;
  const talus = 1 + P.TALUS * (1 - smooth(0, P.TALUS_U, u));                 // the flare at the foot
  const stem = 1 - P.STEM * Math.exp(-(((u - P.STEM_U) / P.STEM_W) ** 2));   // the undercut above it
  const taper = 1 - P.TAPER * Math.min(u, P.CROWN_U);                        // the body narrows with height
  let crown = 1;
  if (u > P.CROWN_U) {
    const k = (u - P.CROWN_U) / (1 - P.CROWN_U);
    crown = P.CROWN_TOP + (1 - P.CROWN_TOP) * Math.sqrt(Math.max(0, 1 - k * k));
  }
  return talus * stem * taper * crown;
}

/** The bedding sawtooth at u: 0 just above a shelf, LEDGE_DEPTH x R just below it. So every shelf faces UP (and
 *  catches the light and holds the shrubs) and the step back down is the overhang that shades the band above it. */
export function beddingAt(u) {
  const P = SPIRE;
  if (u <= P.BED_U0 || u >= P.CROWN_U) return 0;
  const band = (P.CROWN_U - P.BED_U0) / P.LEDGES;
  return P.LEDGE_DEPTH * smooth(1 - P.LEDGE_SHELF, 1, fract((u - P.BED_U0) / band));
}

/** The two joint families at azimuth th (0..TAU) and height u: 1 on a ridge, 0 at the bottom of a groove. th = 0 is
 *  the pillar's outward direction, so the grooves facing +-PI/2 are the cracks towards its neighbours in the row. */
export function jointsAt(th, u, seed) {
  const P = SPIRE;
  const drift = u * P.JOINT_DRIFT + seed * 0.11;
  const a = Math.abs(Math.sin(((th / TAU) * P.FLUTE_N + drift * 0.55 + seed * 0.37) * Math.PI));
  const b = Math.abs(Math.sin(((th / TAU) * P.JOINT_N - drift * 0.35 + 0.31 + seed * 0.71) * Math.PI));
  return { jA: smooth(0.03, 0.60, a), jB: smooth(0.06, 0.55, b) };   // family A: 2-3 broad flutes
}

/** One pillar's unit template: every radius <= 1 (exactly, after normalisation), height 0..1, base at y 0, the cracks
 *  towards its neighbours at th = +-PI/2. Deterministic in `seed`; returns positions, baked AO, indices, the
 *  ring/sector grid, and the ring indices the bushes are planted on. */
export function makePillar(seed, kind = "wall") {
  const P = SPIRE;
  const sec = kind === "wall" ? P.SECTORS : P.ISLAND_SECTORS;
  const ledges = kind === "wall" ? P.LEDGES : P.ISLAND_LEDGES;
  const us = [];
  for (const u of [0, 0.012, 0.03, 0.05, 0.075, 0.11, 0.155, P.BED_U0]) us.push(u);   // foot: talus, stem, shoulder
  const band = (P.CROWN_U - P.BED_U0) / ledges;
  const shelfRings = [];
  for (let b = 0; b < ledges; b++) {                                                  // beds: shelf foot, band, lip
    const u0 = P.BED_U0 + b * band;
    shelfRings.push(us.length + 2);      // the LIP (the outermost ring, whose face points up), not the bed's foot ring:
                                         // a shrub planted on the foot sits under the overhang, inside the rock above it
    us.push(u0 + 1e-4, u0 + band * (1 - P.LEDGE_SHELF), u0 + band * (1 - 1e-4));
  }
  for (const u of [P.CROWN_U + 0.02, P.CROWN_U + 0.07, 0.96]) us.push(u);             // crown: shoulder, dome, rim
  const rings = us.length + 1;                 // + the flat top cap's centre vertex

  const R = new Float32Array(rings * sec), AO = new Float32Array(rings * sec);
  let maxR = 0;
  for (let i = 0; i < rings; i++) {
    const cap = i === rings - 1;
    const u = cap ? 1 : us[i];
    const f = u > P.BED_U0 && u < P.CROWN_U ? fract((u - P.BED_U0) / band) : 0;        // position within its bed
    for (let k = 0; k < sec; k++) {
      const th = (k / sec) * TAU;
      const j = jointsAt(th, u, seed);
      let r = 0;
      if (!cap) {
        const n = S0.noise3JS(th * 2.3 + seed * 5.1, u * 3.7, seed * 1.3) - 0.5;       // micro grain, 2 scales
        const n2 = S0.noise3JS(th * 6.1 + seed * 2.7, u * 11.0, 7.3) - 0.5;
        r = (profileAt(u) + beddingAt(u)) *
            (1 - P.FLUTE_DEPTH * (1 - j.jA) - P.JOINT_DEPTH * (1 - j.jB) + (n * 0.7 + n2 * 0.3) * P.GRAIN);
      }
      R[i * sec + k] = r; maxR = Math.max(maxR, r);
      // ---- baked AO: the groove's own bottom, its joint, the crack towards the neighbours, the band under a shelf,
      //      the crevice above it, and the foot. Every term is a NARROW window on the thing that actually occludes -
      //      a groove BOTTOM (squared, so the flanks stay pale), the ~3 sectors that face a neighbour in the row, the
      //      20% of a bed right under its shelf. The report's target is a median around 0.65 with groove bottoms at
      //      0.25-0.35; a wide window on each term instead darkens the whole pillar (the old wide `smooth(0,0.7,|sin|)`
      //      crack alone took 60% off half the circumference, and the cliff rendered at half its pale tone).
      const gA = 1 - j.jA, gB = 1 - j.jB;                        // 0 on a ridge, 1 at the bottom of the groove
      let ao = 1 - P.AO_GROOVE * gA * gA - P.AO_JOINT * gB * gB;
      // the crack towards the neighbours, broken up: a per-pillar strength and a slow variation with height, so the
      // joints do not run as unbroken vertical lines down every pillar (that reads as a picket fence, not a cliff)
      const crackK = P.AO_CRACK * (0.55 + 0.45 * S0.noise3JS(seed * 3.7, 1.3, 5.1)) * (0.60 + 0.40 * Math.sin(u * 13.0 + seed * 1.7));
      ao *= 1 - crackK * Math.pow(Math.abs(Math.sin(th)), P.AO_CRACK_P);
      ao *= 1 - P.AO_LEDGE * P.AO_LEDGE_K * (1 - smooth(0, 0.25, f));
      ao *= 1 - P.AO_LEDGE * (1 - smooth(0, 0.20, f));
      ao *= 1 - P.AO_BASE * (1 - smooth(0, P.AO_BASE_U, u));
      ao = smooth(P.AO_CURVE[0], P.AO_CURVE[1], ao);            // one remap: pale open faces, dark only in a groove
      AO[i * sec + k] = clamp01(cap ? P.AO_CROWN : ao);
    }
  }
  for (let i = 0; i < R.length; i++) R[i] /= maxR;     // R is the pillar's MAXIMUM radius, exactly

  const nv = rings * sec + 1;
  const pos = new Float32Array(nv * 3), ao = new Float32Array(nv), idx = [];
  for (let i = 0; i < rings; i++) for (let k = 0; k < sec; k++) {
    const th = (k / sec) * TAU, r = R[i * sec + k], o = (i * sec + k) * 3;
    pos[o] = Math.sin(th) * r; pos[o + 1] = i === rings - 1 ? 1 : us[i]; pos[o + 2] = Math.cos(th) * r;
    ao[i * sec + k] = AO[i * sec + k];
  }
  const capV = rings * sec;
  pos[capV * 3 + 1] = 1; ao[capV] = P.AO_CROWN;
  for (let i = 0; i < rings - 1; i++) for (let k = 0; k < sec; k++) {
    const k2 = (k + 1) % sec, a = i * sec + k, b = i * sec + k2, c = (i + 1) * sec + k2, d = (i + 1) * sec + k;
    idx.push(a, b, c, a, c, d);                       // outward winding (the checker proves it by signed volume)
  }
  const last = (rings - 2) * sec;
  for (let k = 0; k < sec; k++) idx.push(last + k, last + (k + 1) % sec, capV);   // the crown's cap, facing up

  // ---- the scrape pass (gl-rock): flatten SCRAPES near-vertical planes into the flanks, inward only ----
  const rnd = (i) => S0.noise3JS(i * 1.7 + seed * 3.1, i * 0.9 + seed, i * 2.3 + 0.5);
  for (let s = 0; s < P.SCRAPES; s++) {
    const a0 = rnd(s + 1), a1 = rnd(s + 41), a2 = rnd(s + 91);
    const i0 = Math.min(rings - 2, Math.max(1, Math.round((0.10 + 0.80 * a0) * (rings - 2))));
    const th0 = a1 * TAU, wA = 0.45 + a2 * 0.85;                 // the facet's half-width, radians
    const r0 = R[i0 * sec + Math.round((th0 / TAU) * sec) % sec], u0 = us[i0];
    const nx = Math.sin(th0), nz = Math.cos(th0), ny = (a2 - 0.5) * 0.22;
    const px = nx * r0, py = u0, pz = nz * r0;
    for (let i = 1; i < rings - 1; i++) {
      const wU = 1 - smooth(0.10, 0.34, Math.abs(us[i] - u0));
      if (wU <= 0) continue;
      for (let k = 0; k < sec; k++) {
        const th = (k / sec) * TAU;
        let dA = Math.abs(th - th0); dA = Math.min(dA, TAU - dA);
        const w = wU * (1 - smooth(wA * 0.45, wA, dA));
        if (w <= 0) continue;
        const o = (i * sec + k) * 3;
        const d = (pos[o] - px) * nx + (pos[o + 1] - py) * ny + (pos[o + 2] - pz) * nz + P.SCRAPE_STRENGTH;
        if (d <= 0) continue;                                     // already behind the plane: leave it
        pos[o] -= nx * d * w; pos[o + 1] -= ny * d * w; pos[o + 2] -= nz * d * w;
      }
    }
  }
  let m2 = 0;                                                     // the scrape only cuts inward: normalise again
  for (let v = 0; v < rings * sec; v++) m2 = Math.max(m2, Math.hypot(pos[v * 3], pos[v * 3 + 2]));
  const kk = m2 > 1e-6 ? 1 / m2 : 1;
  for (let v = 0; v < rings * sec; v++) { pos[v * 3] *= kk; pos[v * 3 + 2] *= kk; }

  return { pos, ao, idx: Uint16Array.from(idx), rings, sec, vcount: nv, icount: idx.length, shelfRings, capV,
           ringY: (i) => (i === rings - 1 ? 1 : us[i]) };
}

// ============================================================================================ the recipe layout
// ============================================================================================ the merged mesh
/** Vertex and index counts for the rock mesh (fixed once the layout is fixed). */
function planRock(groups) {
  let nv = 0, ni = 0;
  for (const g of groups) for (const p of g.parts) {
    if (p.type === "pillar") {
      p.nv = p.tpl.vcount + (p.skirt > 0 ? p.tpl.sec + 1 : 0);
      p.ni = p.tpl.icount + (p.skirt > 0 ? 9 * p.tpl.sec : 0);
    } else {
      p.nv = p.rows * p.cols;
      p.ni = (p.rows - 1) * (p.cols - 1) * 6;
    }
    nv += p.nv; ni += p.ni;
  }
  return { nv, ni };
}

/** Write every group's parts into the preallocated rock buffers, in world units, each group translated to where
 *  place() put it. Returns one record per pillar (vertex/index range and its footprint), for the checker. */
function emitRock(groups, buf) {
  const P = SPIRE;
  const pos = buf.pos, ao = buf.ao, rock = buf.rock, vv = buf.vvar, idx = buf.idx;
  let v = 0, ii = 0;
  const pillars = [];
  for (const g of groups) {
    const gv0 = v, gi0 = ii;
    for (const p of g.parts) {
      p.v0 = v; p.i0 = ii;
      const tone = p.tone;
      const put = (x, y, z, a) => {
        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
        ao[v] = a; vv[v] = p.vvar;
        rock[v * 3] = tone[0]; rock[v * 3 + 1] = tone[1]; rock[v * 3 + 2] = tone[2];
        buf.mid[v * 3] = tone[3]; buf.mid[v * 3 + 1] = tone[4]; buf.mid[v * 3 + 2] = tone[5];
        buf.dark[v * 3] = tone[6]; buf.dark[v * 3 + 1] = tone[7]; buf.dark[v * 3 + 2] = tone[8];
        buf.green[v * 3] = tone[9]; buf.green[v * 3 + 1] = tone[10]; buf.green[v * 3 + 2] = tone[11];
        v++;
      };
      if (p.type === "pillar") {
        const tpl = p.tpl, ax = Math.sin(p.az), az2 = Math.cos(p.az), tx = Math.cos(p.az), tz = -Math.sin(p.az);
        const cx = p.cx + g.dx, cz = p.cz + g.dz, R = p.R, H = p.H, y0 = p.y0, lean = p.lean;
        for (let i = 0; i < tpl.vcount; i++) {
          const lx = tpl.pos[i * 3], ly = tpl.pos[i * 3 + 1], lz = tpl.pos[i * 3 + 2];
          const rad = lz * R + lean * (ly * H), tan = lx * R;
          put(cx + rad * ax + tan * tx, y0 + ly * H, cz + rad * az2 + tan * tz, clamp01(tpl.ao[i] * p.aoK));
        }
        for (let i = 0; i < tpl.icount; i++) idx[ii++] = p.v0 + tpl.idx[i];
        if (p.skirt > 0) {                        // the buried skirt: the foot's own silhouette, straight down
          const foot = p.v0, skirtY = y0 - p.skirt, sec = tpl.sec, ring = v;
          for (let k = 0; k < sec; k++) {
            const lx = tpl.pos[k * 3], lz = tpl.pos[k * 3 + 2];
            const rad = lz * R * P.SKIRT_K, tan = lx * R * P.SKIRT_K;
            put(cx + rad * ax + tan * tx, skirtY, cz + rad * az2 + tan * tz, clamp01(tpl.ao[k] * p.aoK));
          }
          const ctr = v;
          put(cx, skirtY, cz, clamp01(tpl.ao[0] * p.aoK));
          for (let k = 0; k < sec; k++) {
            const k2 = (k + 1) % sec, A = foot + k, A2 = foot + k2, B = ring + k, B2 = ring + k2;
            idx[ii++] = A; idx[ii++] = B; idx[ii++] = B2;
            idx[ii++] = A; idx[ii++] = B2; idx[ii++] = A2;
            idx[ii++] = B; idx[ii++] = ctr; idx[ii++] = B2;   // the bottom cap, facing down
          }
        }
        pillars.push({ v0: p.v0, vn: p.nv, i0: p.i0, in: p.ni, group: g.id, kind: g.kind, R: p.R, H: p.H, y0: p.y0,
                       az: p.az, r: p.r, top: p.y0 + p.H });
      } else {
        const gx = g.dx, gz = g.dz, rowY = [0, 0.45, 0.80, 1.0];
        for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) {
          const t = p.cols > 1 ? c / (p.cols - 1) : 0.5;
          const az = p.az0 + p.span * (t - 0.5);
          const top = r === p.rows - 1;
          const jag = top ? (S0.noise3JS(c * 1.7 + p.seed * 3.1, 0.5, 2.5) - 0.5) * 2 * p.jag : 0;
          const y = p.y0 + p.H * Math.min(1, Math.max(0, rowY[r] * p.top + jag));
          const rad = p.r + p.lean * (y - p.y0);
          put(gx + Math.sin(az) * rad, y, gz + Math.cos(az) * rad, clamp01(p.aoK * (0.72 + 0.28 * rowY[r])));
        }
        for (let r = 0; r < p.rows - 1; r++) for (let c = 0; c < p.cols - 1; c++) {
          const a = p.v0 + r * p.cols + c, b2 = a + 1, c2 = a + p.cols + 1, d = a + p.cols;
          idx[ii++] = a; idx[ii++] = b2; idx[ii++] = c2;
          idx[ii++] = a; idx[ii++] = c2; idx[ii++] = d;
        }
      }
    }
    g.v0 = gv0; g.vn = v - gv0; g.i0 = gi0; g.in = ii - gi0;   // this group's own slice of the merged buffers
  }
  return pillars;
}

// ============================================================================================ vegetation
function setDeep(o, m) { for (const [k, v] of Object.entries(m)) (typeof v === "object" ? setDeep(o[k], v) : (o[k] = v)); }

/** ez-tree's own bush, baked to a unit geometry: height 1, base at y 0, xz centred, aLeaf = 1 on the leaf cards. The
 *  bush presets are 5k-16k triangles at full detail; BUSH_LOD cuts them to a few hundred, which is all a 15-40 pixel
 *  shrub can show. Returns the geometry plus its width (in units of its height). */
function bakeBush(preset, seed) {
  const t = new Tree();
  t.options.copy(structuredClone(TreePreset[preset]));
  setDeep(t.options, SPIRE.BUSH_LOD);
  t.options.seed = seed; t.options.bark.textured = false;
  t.generate();
  const bg = t.branchesMesh.geometry, lg = t.leavesMesh.geometry;
  const bp = bg.attributes.position.array, bn = bg.attributes.normal.array;
  const lp = lg.attributes.position.array, ln = lg.attributes.normal.array, lu = lg.attributes.uv.array;
  const nvb = bp.length / 3, nvl = lp.length / 3, nv = nvb + nvl;
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), leaf = new Float32Array(nv);
  pos.set(bp, 0); nor.set(bn, 0);
  if (bg.attributes.uv) uv.set(bg.attributes.uv.array, 0);
  pos.set(lp, bp.length); nor.set(ln, bp.length); uv.set(lu, nvb * 2);
  leaf.fill(0, 0, nvb); leaf.fill(1, nvb);
  const bi = bg.index ? bg.index.array : null, li = lg.index ? lg.index.array : null;
  const ni = (bi ? bi.length : nvb) + (li ? li.length : nvl);
  const idx = new Uint32Array(ni);
  let o = 0;
  if (bi) for (let i = 0; i < bi.length; i++) idx[o++] = bi[i];
  else for (let i = 0; i < nvb; i++) idx[o++] = i;
  if (li) for (let i = 0; i < li.length; i++) idx[o++] = li[i] + nvb;
  else for (let i = 0; i < nvl; i++) idx[o++] = nvb + i;
  // normalise: height 1, base y 0, xz centred on the bush's own middle
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity, mnz = Infinity, mxz = -Infinity;
  for (let i = 0; i < nv; i++) {
    mnx = Math.min(mnx, pos[i * 3]); mxx = Math.max(mxx, pos[i * 3]);
    mny = Math.min(mny, pos[i * 3 + 1]); mxy = Math.max(mxy, pos[i * 3 + 1]);
    mnz = Math.min(mnz, pos[i * 3 + 2]); mxz = Math.max(mxz, pos[i * 3 + 2]);
  }
  const H = Math.max(1e-6, mxy - mny), k = 1 / H, cxm = (mnx + mxx) / 2, czm = (mnz + mxz) / 2;
  for (let i = 0; i < nv; i++) {
    pos[i * 3] = (pos[i * 3] - cxm) * k; pos[i * 3 + 1] = (pos[i * 3 + 1] - mny) * k; pos[i * 3 + 2] = (pos[i * 3 + 2] - czm) * k;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("aLeaf", new THREE.BufferAttribute(leaf, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return { geo: g, w: Math.max(mxx - mnx, mxz - mnz) * k, tris: ni / 3, tris0: (bg.index ? bg.index.count : nvb) / 3, tris1: (lg.index ? lg.index.count : nvl) / 3 };
}

/** The far-card alpha: a clump of bush blobs drawn white on clear (no image file, our own code). */
function drawBushCard(doc, size = 128, seed = 7) {
  const c = doc.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d"), r = F.rng(seed);
  g.clearRect(0, 0, size, size);
  g.fillStyle = "#fff";
  for (let i = 0; i < 26; i++) {
    const a = r() * TAU, dd = Math.sqrt(r());
    const cx = size * 0.5 + Math.cos(a) * dd * size * 0.40;
    const cy = size * 0.62 - Math.sin(a) * dd * size * 0.30 - size * 0.06;
    g.beginPath(); g.arc(cx, cy, size * (0.07 + r() * 0.12), 0, TAU); g.fill();
  }
  g.fillRect(size * 0.46, size * 0.62, size * 0.08, size * 0.34);   // a short trunk, so the clump sits on the rock
  return c;
}

/** Every bush instance: planted on the exact vertices the rock mesh draws (a ledge's lip or a crown), sunk into it.
 *  Positions are stored relative to the group's axis so a moved group carries its plants along. */
function bushSpots(groups, rockGeo) {
  const P = SPIRE, pos = rockGeo.attributes.position.array, nor = rockGeo.attributes.normal.array;
  const spots = [], rnd = F.rng(P.SEED + 17);
  for (const g of groups) for (const p of g.parts) {
    if (p.type !== "pillar" || !p.bushP) continue;
    const tpl = p.tpl;
    for (const ring of tpl.shelfRings) {
      if (rnd() > P.BUSH_LEDGE_P * p.bushP) continue;
      // a third of them in the cracks between pillars: the sectors that face a neighbour (th = +-PI/2, i.e. a quarter
      // and three quarters of the way round). `tpl.sec / 4` is NOT an integer for every sector count (14 -> 3.5), and a
      // fractional vertex index reads past the buffer: that is the NaN that made 42 of 61 shrubs invisible - the
      // instance matrices carried NaN translations, so the leaves were never drawn and nothing looked wrong.
      const crack = rnd() < 0.35;
      let k;
      if (crack) {
        const c0 = Math.round(tpl.sec * 0.25), c1 = tpl.sec - c0;
        k = ((rnd() < 0.5 ? c0 : c1) + Math.round((rnd() - 0.5) * 2)) % tpl.sec;
        k = ((k % tpl.sec) + tpl.sec) % tpl.sec;
      } else k = Math.floor(rnd() * tpl.sec);
      const vi = p.v0 + ring * tpl.sec + k;
      if (!Number.isInteger(vi) || vi < p.v0 || vi >= p.v0 + p.nv) continue;   // never index outside the pillar
      if (nor[vi * 3 + 1] < P.MOSS_LO) continue;         // only upward faces
      spots.push(spot(g, p, vi, pos, nor, rnd));
    }
    if (rnd() < P.BUSH_CROWN_P * p.bushP) {
      const vi = p.v0 + tpl.capV;
      if (Number.isInteger(vi) && vi >= p.v0 && vi < p.v0 + p.nv) spots.push(spot(g, p, vi, pos, nor, rnd));
    }
  }
  return spots;
}

function spot(g, p, vi, pos, nor, rnd) {
  const P = SPIRE;
  return { g: g.id, vi, x: pos[vi * 3] - g.dx, y: pos[vi * 3 + 1], z: pos[vi * 3 + 2] - g.dz,
           s: p.pitch * (P.BUSH_K[0] + rnd() * (P.BUSH_K[1] - P.BUSH_K[0])), variant: Math.floor(rnd() * 3),
           yaw: rnd() * TAU, jit: 0.88 + rnd() * 0.24, ny: nor[vi * 3 + 1] };
}

/** The far cards: alpha-tested billboards on the mass's ridge, ALONG EVERY BEDDING LEDGE of a wall panel (the original
 *  paints its shrubs right across the cliff face, and a 2-triangle cut is how that density is affordable: the geometry
 *  bushes alone covered 3% of the frame, the reference cliff texture is 11% green), and on the islands too far out to
 *  be worth geometry. */
function cardSpots(groups) {
  const P = SPIRE, rnd = F.rng(P.SEED + 29), spots = [];
  const band = (P.CROWN_U - P.BED_U0) / P.LEDGES;
  for (const g of groups) {
    const mass = g.mass;
    if (mass) {
      const n = Math.max(2, Math.round(P.CARD_MASS_K * (g.parts.length - 1)));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const az = g.az + g.span * (t - 0.5) + (rnd() - 0.5) * g.span / n * 0.6;
        const rad = mass.r + (rnd() - 0.5) * mass.r * 0.02;
        const y = mass.y0 + mass.H * (P.BACK_TOP - 0.06 - rnd() * 0.10);
        spots.push(card(g, az, rad, y, rnd));
      }
      // the ledges: one row of shrub cards per bedding ledge, just in front of the nearest pillar face
      const rad = g.r0 - g.R * 1.02;
      for (let b = 0; b < P.LEDGES; b++) {
        const y = mass.y0 + mass.H * (P.BED_U0 + (b + 1) * band - P.CARD_LEDGE_SINK * band);
        const nL = Math.max(2, Math.round((g.span * g.r0) / (g.pitch * P.CARD_LEDGE_PITCH)));
        for (let i = 0; i < nL; i++) {
          if (rnd() > P.CARD_LEDGE_KEEP) continue;
          const t = (i + 0.5) / nL;
          const az = g.az + g.span * (t - 0.5) + (rnd() - 0.5) * g.span / nL * 0.7;
          spots.push(card(g, az, rad, y, rnd));
        }
      }
    }
    if (g.kind === "island" && g.rCard > P.CARD_ISLAND_R) {
      for (let i = 0; i < P.CARD_PER_ISLAND; i++) {
        const t = (i + 0.5) / P.CARD_PER_ISLAND;
        const az = g.az + g.span * (t - 0.5) + (rnd() - 0.5) * g.span / P.CARD_PER_ISLAND;
        const rad = g.r0 + (rnd() - 0.5) * g.R * 0.8;
        const y = g.baseY + g.H * (0.55 + rnd() * 0.38);
        spots.push(card(g, az, rad, y, rnd));
      }
    }
  }
  return spots;
}

function card(g, az, rad, y, rnd) {
  const P = SPIRE;
  const w = (g.pitch || 400) * (P.CARD_K[0] + rnd() * (P.CARD_K[1] - P.CARD_K[0]));
  const j = 0.86 + rnd() * 0.28;
  return { g: g.id, x: Math.sin(az) * rad, y, z: Math.cos(az) * rad, az, w, h: w / 1.25,
           tint: [g.tone0[0] * j, g.tone0[1] * j, g.tone0[2] * j] };
}

// ============================================================================================ the materials
/** The rock's albedo and shading. The albedo is what the report calls the triplanar + strata + slope-moss layer,
 *  re-expressed with the shared 3D noise instead of textures; the shading is a smooth key/ambient model over the
 *  SHARED light uniforms (so sun by day and moon by night keep working), not the toon ramp. */
export const ROCK_GLSL = /* glsl */`
  uniform float uGrainScale, uGrainAmp, uStrataFreq, uStrataAmp, uStrataMid, uStrataWarp, uVStripe, uVStripeF,
                uVStripe2, uVStripe2F, uAOKey, uAOShade, uAODark, uP10Mix, uMossLo, uMossHi, uMossAmt, uMossPatch,
                uShadeWhite, uSkyFillK, uShadeKRock;
  uniform vec3 uRockCool;
  /** pale = the piece's measured p90 tone (its own pale lavender-white), mid = its 'other', dark = its p10, green =
   *  its measured 'green'. ao is the baked occlusion, v the pillar's seed. */
  vec3 rockAlbedo(vec3 w, vec3 N, float ao, vec3 pale, vec3 mid, vec3 dark, vec3 green, float v) {
    vec3 an = abs(N);
    vec2 pl = an.x > max(an.y, an.z) ? w.zy : (an.y > an.z ? w.xz : w.xy);   // the dominant axis: one noise call
    float g = fbm3(vec3(pl * uGrainScale, v * 9.0));
    float grain = g - 0.5;
    float sideness = 1.0 - smoothstep(0.35, 0.85, N.y);                      // upward faces get no strata
    float layer = w.y * uStrataFreq + grain * uStrataWarp + sin(w.x * 0.0021) * 0.18 + sin(w.z * 0.0017) * 0.14;
    float band = sin(layer * 6.28318) * 0.62 + sin(layer * 12.566 + 1.7) * 0.38;
    vec3 c = mix(pale, mid, clamp(uStrataMid * (0.5 + 0.5 * band) * sideness, 0.0, 1.0));
    c *= 1.0 + band * uStrataAmp * sideness + grain * uGrainAmp;
    float st = sin((w.x * 0.83 + w.z * 0.55) * uVStripeF + grain * 5.0) * 0.6
             + sin((w.x * 0.31 - w.z * 0.95) * uVStripe2F + grain * 9.0) * 0.4;
    c *= 1.0 + st * (uVStripe + uVStripe2);                                   // the long vertical striation
    // baked AO: MULTIPLY the body, then tint the deepest part with the piece's p10 (which IS the crevice colour). A
    // plain lerp towards a darkened copy could never reach the measured dark: the reference cliff texture is 68% pale
    // [199,191,215] with 21% at [38,38,41] in its cracks, and a lerp left the darkest vertex at ~105 - a grey cliff.
    c *= mix(uAODark, 1.0, ao);
    c = mix(c, dark, (1.0 - ao) * uP10Mix);
    float up = smoothstep(uMossLo, uMossHi, N.y);                            // the slope mask
    float mossPatch = smoothstep(0.5 - uMossPatch * 0.5, 0.5 + uMossPatch * 0.5, g);
    c = mix(c, green * (0.75 + 0.55 * g), up * mossPatch * uMossAmt);
    return c;
  }
  /** smooth key + shade tint + sky fill + ground bounce + rim, all from the shared uniforms (toonLight's own inputs).
   *  The shade tint is NORMALISED to unit brightness and then pulled toward the same neutral cool the whole built
   *  world uses for bright, low-chroma albedos (toonLight's whiteK term). Without that pull, a pale limestone face in
   *  shade took uShadowTint raw — this arena's measured shade is a saturated blue whose blue channel is 4.75x its
   *  luma — and the whole cliff read violet-blue at half brightness instead of pale grey-lavender. */
  vec3 rockShade(vec3 albedo, vec3 N, vec3 V, float ao, float rimAmt) {
    vec3 tintN = uShadowTint / max(lumaB(uShadowTint), 1e-4);
    float al = lumaB(albedo);
    float chroma = max(albedo.r, max(albedo.g, albedo.b)) - min(albedo.r, min(albedo.g, albedo.b));
    float whiteK = max(smoothstep(0.35, 0.75, al) * (1.0 - smoothstep(0.12, 0.3, chroma)), uShadeWhite);
    vec3 shadeTint = mix(mix(vec3(1.0), tintN, uShadowMix), uRockCool, whiteK);
    float t = clamp(dot(N, uLightDir) * 0.5 + 0.5, 0.0, 1.0);
    float lit = smoothstep(0.40, 0.97, t);
    vec3 shade = albedo * shadeTint * (uShadeK * uShadeKRock) * uAmbient * mix(uAOShade, 1.0, ao);
    vec3 key = albedo * uLightColor * mix(uAOKey, 1.0, ao);
    vec3 col = mix(shade, key, lit);
    col += albedo * uSkyFill * 0.10 * uSkyFillK * (N.y * 0.5 + 0.5) * uAmbient * ao;
    col += albedo * uGroundBounce * (0.5 - N.y * 0.5) * (1.0 - lit) * ao;
    float fr = 1.0 - max(dot(N, V), 0.0);
    float sunSide = smoothstep(-0.2, 0.4, dot(N, uLightDir));
    col += uRimColor * albedo * smoothstep(0.58, 0.82, fr) * rimAmt * (0.15 + 0.85 * sunSide) * ao;
    return min(col, vec3(0.98));
  }
`;

export function rockMaterial(S) {
  const P = SPIRE;
  return new THREE.ShaderMaterial({
    uniforms: S.uniformsWith({
      uGrainScale: { value: P.GRAIN_SCALE }, uGrainAmp: { value: P.GRAIN_AMP },
      uStrataFreq: { value: P.STRATA_FREQ }, uStrataAmp: { value: P.STRATA_AMP }, uStrataMid: { value: P.STRATA_MID },
      uStrataWarp: { value: P.STRATA_WARP },
      uVStripe: { value: P.VSTRIPE }, uVStripeF: { value: P.VSTRIPE_F },
      uVStripe2: { value: P.VSTRIPE2 }, uVStripe2F: { value: P.VSTRIPE2_F },
      uAOKey: { value: P.AO_KEY }, uAOShade: { value: P.AO_SHADE }, uAODark: { value: P.AO_DARK }, uP10Mix: { value: P.P10_MIX },
      uMossLo: { value: P.MOSS_LO }, uMossHi: { value: P.MOSS_HI }, uMossAmt: { value: P.MOSS_AMT }, uMossPatch: { value: P.MOSS_PATCH },
      uShadeWhite: { value: P.SHADE_WHITE }, uRockCool: { value: new THREE.Color(...P.ROCK_COOL) },
      uSkyFillK: { value: P.SKY_FILL_K }, uShadeKRock: { value: P.SHADE_K },
    }),
    vertexShader: /* glsl */`
      attribute float aAO, aVar;
      attribute vec3 aRock, aMid, aDark, aGreen;
      varying vec3 vW, vN, vRock, vMid, vDark, vGreen;
      varying float vAO, vVar;
      void main() {
        #ifdef USE_INSTANCING
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        #else
        vec4 w = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        #endif
        vW = w.xyz;
        vRock = aRock; vMid = aMid; vDark = aDark; vGreen = aGreen; vAO = aAO; vVar = aVar;
        #ifdef USE_INSTANCING_COLOR
        vRock *= instanceColor; vMid *= instanceColor; vDark *= instanceColor; vGreen *= instanceColor;
        #endif
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vW, vN, vRock, vMid, vDark, vGreen;
      varying float vAO, vVar;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      ${ROCK_GLSL}
      void main() {
        vec3 N = normalize(gl_FrontFacing ? vN : -vN);
        vec3 V = normalize(cameraPosition - vW);
        vec3 albedo = rockAlbedo(vW, N, vAO, vRock, vMid, vDark, vGreen, vVar);
        vec3 col = rockShade(albedo, N, V, vAO, 0.55);
        gl_FragColor = vec4(aerial(col, vW), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
}

function bushMaterial(S, leafTex) {
  return new THREE.ShaderMaterial({
    uniforms: S.uniformsWith({
      uLeafTex: { value: leafTex }, uLeafAlpha: { value: SPIRE.LEAF_ALPHA },
      uBark: { value: new THREE.Color(0.09, 0.075, 0.055) }, uGreen: { value: new THREE.Color(0.06, 0.09, 0.04) },
    }),
    vertexShader: /* glsl */`
      attribute float aLeaf;
      uniform vec3 uGreen;
      varying vec3 vW, vN, vCol; varying vec2 vUv; varying float vLeaf;
      void main() {
        mat4 im = mat4(1.0);
        #ifdef USE_INSTANCING
          im = instanceMatrix;
        #endif
        vec4 w = modelMatrix * im * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * mat3(im) * normal);
        vCol = uGreen;
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #endif
        vUv = uv; vLeaf = aLeaf;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uLeafTex; uniform float uLeafAlpha; uniform vec3 uBark;
      varying vec3 vW, vN, vCol; varying vec2 vUv; varying float vLeaf;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      void main() {
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        vec3 base = mix(uBark, vCol, vLeaf);
        if (vLeaf > 0.5) {
          float a = texture2D(uLeafTex, vUv).a;
          vec2 tu = vUv * vec2(textureSize(uLeafTex, 0));
          float mip = max(0.0, 0.5 * log2(max(dot(dFdx(tu), dFdx(tu)), dot(dFdy(tu), dFdy(tu)))));
          a *= 1.0 + mip * 0.25;              // keep the clump's coverage in the small mips (as arena-built.js)
          if (a < uLeafAlpha) discard;
          N = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.5));   // a bush's leaves turn up, like the moss mask
        }
        vec3 V = normalize(cameraPosition - vW);
        vec3 col = toonLight(base, N, V, vW, 1.0, 0.12);
        gl_FragColor = vec4(aerial(col, vW), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, transparent: false,
  });
}

function cardMaterial(S, cardTex) {
  return new THREE.ShaderMaterial({
    uniforms: S.uniformsWith({ uCardTex: { value: cardTex }, uCardAlpha: { value: 0.5 } }),
    vertexShader: /* glsl */`
      attribute vec3 aTint;
      varying vec3 vW, vN, vCol; varying vec2 vUv;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vCol = aTint; vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uCardTex; uniform float uCardAlpha;
      varying vec3 vW, vN, vCol; varying vec2 vUv;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      void main() {
        if (texture2D(uCardTex, vUv).a < uCardAlpha) discard;
        vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
        vec3 V = normalize(cameraPosition - vW);
        vec3 col = toonLight(vCol, N, V, vW, 1.0, 0.1);
        gl_FragColor = vec4(aerial(col, vW), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, transparent: false,
  });
}

// ============================================================================================ the layer
/** Build the spires from ctx (the ctx doc is at the top of web/arena-built.js). Returns { meshes, place, info }. */
/** ASSET: the cliff from the slot's data (web/built/place/spires.js: groups, their pillars and keep-out offsets): one
 *  merged rock mesh (ROCK_GLSL), three instanced ez-tree shrubs on its ledges, far bush cards. inst.place(state, items)
 *  rebuilds the buffers when the keep-out moved a group. */
export function buildSpires(slot, ctx) {
  const S = ctx.S || S0, P = SPIRE;
  const t0 = performance.now();
  const L = slot.data;
  const { groups, walls, islands, skipped, recipeRmin, measured, problems } = L;
  // the pillar templates (four wall shapes, three island shapes), shared by every copy of them
  const tpls = { wall: [0, 1, 2, 3].map((i) => makePillar(P.SEED + i * 7.13, "wall")), island: [0, 1, 2].map((i) => makePillar(P.SEED + 101 + i * 5.71, "island")) };
  for (const g of groups) for (const p of g.parts) if (p.type === "pillar") p.tpl = tpls[p.tplKind][p.tplIdx];

  // ---- one geometry for the whole cliff: every pillar, every mass strip and every island, one draw call ----
  const plan = planRock(groups);
  const buf = { pos: new Float32Array(plan.nv * 3), ao: new Float32Array(plan.nv), rock: new Float32Array(plan.nv * 3),
                mid: new Float32Array(plan.nv * 3), dark: new Float32Array(plan.nv * 3), green: new Float32Array(plan.nv * 3),
                vvar: new Float32Array(plan.nv), idx: new Uint32Array(plan.ni) };
  const rockGeo = new THREE.BufferGeometry();
  const dyn = (name, arr, n) => { const a = new THREE.BufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); rockGeo.setAttribute(name, a); };
  dyn("position", buf.pos, 3); dyn("aAO", buf.ao, 1); dyn("aRock", buf.rock, 3); dyn("aMid", buf.mid, 3);
  dyn("aDark", buf.dark, 3); dyn("aGreen", buf.green, 3); dyn("aVar", buf.vvar, 1);
  rockGeo.setIndex(new THREE.BufferAttribute(buf.idx, 1));
  const rockMat = rockMaterial(S);
  const rockMesh = new THREE.Mesh(rockGeo, rockMat);
  rockMesh.name = "builtSpireRock"; rockMesh.userData.kind = "spire"; rockMesh.frustumCulled = false;

  // ---- vegetation: three ez-tree bushes, baked and instanced, then planted on the rock's own ledge vertices ----
  const bushs = ["Bush 1", "Bush 2", "Bush 3"].map((n, i) => bakeBush(n, P.SEED + 31 + i * 11));
  const leafTex = new THREE.CanvasTexture(F.drawLeafCluster(document, 256, 5));
  leafTex.colorSpace = THREE.NoColorSpace; leafTex.anisotropy = 1;
  const bushMat = bushMaterial(S, leafTex);
  let spots = [], cards = [];
  let bushMeshes = [];
  const cardTex = new THREE.CanvasTexture(drawBushCard(document, 128, 3));
  cardTex.colorSpace = THREE.NoColorSpace; cardTex.anisotropy = 1;
  const cardMat = cardMaterial(S, cardTex);
  const cardGeo = new THREE.BufferGeometry();
  const cardMesh = new THREE.Mesh(cardGeo, cardMat);
  cardMesh.name = "builtSpireCards"; cardMesh.userData.kind = "spire"; cardMesh.frustumCulled = false;
  ctx.materials?.push(rockMat, bushMat, cardMat);

  const V3 = new THREE.Vector3(), Q = new THREE.Quaternion(), SC = new THREE.Vector3(), M = new THREE.Matrix4();
  const Y = new THREE.Vector3(0, 1, 0), COL = new THREE.Color();

  // the first emit: positions and normals, so the bushes can be planted on the exact vertices the mesh draws (every
  // group at its recipe spot: the keep-out offsets are applied by the rebuild below)
  const off = groups.map((g) => [g.dx, g.dz]);
  for (const g of groups) { g.dx = 0; g.dz = 0; }
  let pillars = emitRock(groups, buf);
  rockGeo.attributes.position.needsUpdate = true;
  rockGeo.computeVertexNormals();
  spots = bushSpots(groups, rockGeo);
  groups.forEach((g, i) => { g.dx = off[i][0]; g.dz = off[i][1]; });
  const perVariant = [0, 0, 0];
  for (const s of spots) perVariant[s.variant]++;
  const bushPer = new Array(groups.length).fill(0);
  for (const s of spots) bushPer[s.g]++;
  bushMeshes = bushs.map((b, i) => {
    const m = new THREE.InstancedMesh(b.geo, bushMat, Math.max(1, perVariant[i]));
    m.name = `builtSpireBush${i}`; m.userData = { kind: "spire", variant: i, tris: b.tris, at: [], group: [], vertex: [], normal: [] };
    m.frustumCulled = false; m.count = 0;
    return m;
  });
  cards = cardSpots(groups);
  const cardPer = new Array(groups.length).fill(0);
  for (const c of cards) cardPer[c.g]++;
  const cardPos = new Float32Array(cards.length * 4 * 3), cardNor = new Float32Array(cards.length * 4 * 3),
        cardUv = new Float32Array(cards.length * 4 * 2), cardTint = new Float32Array(cards.length * 4 * 3),
        cardIdx = new Uint32Array(cards.length * 6);
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i], o = i * 4;
    cardUv.set([0, 0, 1, 0, 1, 1, 0, 1], o * 2);
    cardTint.set([...c.tint, ...c.tint, ...c.tint, ...c.tint], o * 3);
    cardIdx.set([o, o + 2, o + 1, o, o + 3, o + 2], i * 6);
  }
  cardGeo.setAttribute("position", new THREE.BufferAttribute(cardPos, 3).setUsage(THREE.DynamicDrawUsage));
  cardGeo.setAttribute("normal", new THREE.BufferAttribute(cardNor, 3).setUsage(THREE.DynamicDrawUsage));
  cardGeo.setAttribute("uv", new THREE.BufferAttribute(cardUv, 2));
  cardGeo.setAttribute("aTint", new THREE.BufferAttribute(cardTint, 3));
  cardGeo.setIndex(new THREE.BufferAttribute(cardIdx, 1));

  let buildMs = 0, rebuildMs = 0, rebuilds = 0, gemFirst = true;
  let nan = null;
  /** Non-finite vertices of a geometry's position (and normal): the numbers that used to slip through unseen.
   *  A NaN in `position` also makes computeBoundingSphere() return NaN, which is what the console reported. */
  function nanCount(geo) {
    const a = geo.attributes.position?.array, b = geo.attributes.normal?.array;
    let pos = 0, nor = 0;
    if (a) for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) pos++;
    if (b) for (let i = 0; i < b.length; i++) if (!Number.isFinite(b[i])) nor++;
    return { verts: geo.attributes.position?.count || 0, pos, nor,
             radius: geo.boundingSphere ? geo.boundingSphere.radius : null };
  }
  /** Re-emit every group at its current axis and refill the instances: the only work a keep-out change costs. */
  function rebuild() {
    const t = performance.now();
    pillars = emitRock(groups, buf);
    rockGeo.attributes.position.needsUpdate = true;
    rockGeo.attributes.aAO.needsUpdate = true;
    rockGeo.attributes.aRock.needsUpdate = true;
    rockGeo.attributes.aMid.needsUpdate = true;
    rockGeo.attributes.aDark.needsUpdate = true;
    rockGeo.attributes.aGreen.needsUpdate = true;
    rockGeo.attributes.aVar.needsUpdate = true;
    if (rockGeo.index) rockGeo.index.needsUpdate = true;
    rockGeo.computeVertexNormals();
    rockGeo.attributes.normal.needsUpdate = true;
    rockGeo.computeBoundingSphere();
    // bushes: the instance sits on its rock vertex, sunk BUSH_SINK of its own height into it
    const n = [0, 0, 0];
    for (const s of spots) {
      const g = groups[s.g], m = bushMeshes[s.variant];
      const k = s.s / bushs[s.variant].w;
      V3.set(g.dx + s.x, s.y - P.BUSH_SINK * k, g.dz + s.z);
      Q.setFromAxisAngle(Y, s.yaw); SC.setScalar(g.hidden ? 0 : k);
      m.setMatrixAt(n[s.variant], M.compose(V3, Q, SC));
      m.setColorAt(n[s.variant], COL.setRGB(g.green[0] * s.jit, g.green[1] * s.jit, g.green[2] * s.jit));
      m.userData.at[n[s.variant]] = [V3.x, V3.y, V3.z];
      m.userData.group[n[s.variant]] = s.g;
      m.userData.vertex[n[s.variant]] = s.vi;
      m.userData.normal[n[s.variant]] = s.ny;
      n[s.variant]++;
    }
    bushMeshes.forEach((m, i) => { m.count = perVariant[i]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    // far cards
    const cp = cardGeo.attributes.position.array, cn = cardGeo.attributes.normal.array;
    for (const [i, c] of cards.entries()) {
      const g = groups[c.g], tx = Math.cos(c.az), tz = -Math.sin(c.az);
      const x = g.hidden ? 0 : g.dx + c.x, z = g.hidden ? 0 : g.dz + c.z, y = g.hidden ? -1e6 : c.y;
      const w = c.w / 2, o = i * 12;
      cp[o] = x - tx * w; cp[o + 1] = y; cp[o + 2] = z - tz * w;
      cp[o + 3] = x + tx * w; cp[o + 4] = y; cp[o + 5] = z + tz * w;
      cp[o + 6] = x + tx * w; cp[o + 7] = y + c.h; cp[o + 8] = z + tz * w;
      cp[o + 9] = x - tx * w; cp[o + 10] = y + c.h; cp[o + 11] = z - tz * w;
      for (let v = 0; v < 4; v++) { cn[o + v * 3] = -Math.sin(c.az); cn[o + v * 3 + 1] = 0; cn[o + v * 3 + 2] = -Math.cos(c.az); }
    }
    cardGeo.attributes.position.needsUpdate = true;
    cardGeo.attributes.normal.needsUpdate = true;
    cardGeo.computeBoundingSphere();
    nan = { rock: nanCount(rockGeo), cards: nanCount(cardGeo) };   // 0 pos / 0 nor is the invariant, reported below
    // each group's own slice of the merged buffers, so a checker can bucket vertices to a panel / an island
    rockMesh.userData.ranges = groups.map((g) => ({ kind: g.kind, piece: g.piece, card: g.card, r: Math.round(g.r0),
      rockStart: g.v0, rockCount: g.vn, indexStart: g.i0, indexCount: g.in }));
    rebuilds++;
    rebuildMs = performance.now() - t;
  }

  // ---- keep-out: the trees' own rule, per group, plus the radial proof ----
  const info = {
    walls: [], islands: [], skipped, bushes: { ledger: 0 }, cards: 0, groups: groups.length,
    triangles: 0, meshes: 1 + bushMeshes.length + 1, ms: 0, values: P, measured: {},
  };
  // ---- option: Gemini spires (web/built/spires_gemini.js), OFF by default, built lazily on the first switch-on ----
  let gem = null, geminiOn = false, gemDirty = false, gemBusy = null;
  async function setGemini(on) {
    on = !!on;
    if (on && !gem) {
      gemBusy ||= import("./spires_gemini.js").then((m) => { gem = m.createGeminiSpires(ctx, groups); info.gemini = gem.stat; });
      await gemBusy;
    }
    geminiOn = on; gemDirty = true;
    if (gem) gem.root.visible = on;
    place(undefined, { ...lastItems, moved: false });
    return gem ? gem.stat : null;
  }
  let lastItems = slot.cur || slot.items;
  /** the placement's keep-out answer (items.stats, items.moved): rebuild what moved, then visibility and the numbers */
  function place(state, items = lastItems) {
    lastItems = items;
    const t = performance.now();
    const stats = { ...(items.stats || {}) }, moved = !!items.moved || gemFirst;
    gemFirst = false;
    if (moved) rebuild();
    const shownWalls = walls.filter((g) => !g.hidden), shownIsles = islands.filter((g) => !g.hidden);
    stats.accepted = shownWalls.length + shownIsles.length;
    stats.ms = Math.round(performance.now() - t);
    // each mesh's visibility is its OWN: the rock used to be shown only when some shrub had instances, so a
    // building mistake in the shrubs (v.nv vs v.nv, a fractional vertex index) silently took the whole cliff out
    rockMesh.visible = groups.some((g) => !g.hidden);
    cardMesh.visible = cards.length > 0;
    for (const m of bushMeshes) m.visible = m.count > 0;
    if (geminiOn) {                                  // option: the Gemini spires replace our rock, shrubs and cards
      rockMesh.visible = false; cardMesh.visible = false; for (const m of bushMeshes) m.visible = false;
      if (gem && (moved || gemDirty)) { gem.layout(); gemDirty = false; info.gemini = gem.stat; }
    }
    info.shown = stats.accepted; info.wallsShown = shownWalls.length; info.islandsShown = shownIsles.length;
    info.keepOut = stats;
    info.nan = nan;   // refilled by rebuild(): 0/0 on every build that went through
    info.walls.forEach((w, i) => { w.cx = walls[i].dx + walls[i].cx0; w.cz = walls[i].dz + walls[i].cz0; w.hidden = walls[i].hidden; w.push = walls[i].push; });
    info.islands.forEach((w, i) => { w.cx = islands[i].dx + islands[i].cx0; w.cz = islands[i].dz + islands[i].cz0; w.hidden = islands[i].hidden; w.push = islands[i].push; });
    return stats;
  }

  // ---- the numbers the checker and the viewer read ----
  const shapes = (g) => ({ piece: g.piece, card: g.card, az: +(g.az * 180 / Math.PI).toFixed(2), r: Math.round(g.r0),
                           baseY: +g.baseY.toFixed(2), h: +g.H.toFixed(1), pillars: g.parts.filter((p) => p.type === "pillar").length,
                           R: +g.R.toFixed(1), pitch: +g.pitch.toFixed(1), spanDeg: +(g.span * 180 / Math.PI).toFixed(2),
                           top: +(g.baseY + g.H).toFixed(1), lean: +(g.lean * 1000).toFixed(1), skirt: +g.skirt.toFixed(0),
                           cx: +g.cx0.toFixed(1), cz: +g.cz0.toFixed(1), hidden: false, push: 0 });
  info.walls = walls.map(shapes); info.islands = islands.map(shapes);
  // every group (panel or island) as the checker reads it: its own slice of the merged buffers, its pillars, its
  // plants and cards. `info.walls` / `info.islands` stay the display list; this is the proof list.
  info.groups = groups.map((g, i) => ({ i, kind: g.kind, piece: g.piece, card: g.card, az: +(g.az * 180 / Math.PI).toFixed(2),
    r: Math.round(g.r0), baseY: +g.baseY.toFixed(2), H: +g.H.toFixed(1), R: +g.R.toFixed(1), Rmax: +g.Rmax.toFixed(1),
    pillars: g.parts.filter((p) => p.type === "pillar").length, pitch: +g.pitch.toFixed(1), n: g.n,
    spanDeg: +(g.span * 180 / Math.PI).toFixed(2), top: +(g.baseY + g.H).toFixed(1), skirt: +g.skirt.toFixed(0),
    skirtY: +(g.baseY - g.skirt).toFixed(1), v0: g.v0 ?? 0, vn: g.vn ?? 0, i0: g.i0 ?? 0, in: g.in ?? 0,
    bushes: bushPer[i] || 0, cards: cardPer[i] || 0, hidden: !!g.hidden, push: g.push || 0 }));
  info.nan = nan;
  info.problems = problems;
  info.measured = { recipeRmin, cardBaseY: measured.waterTop, waterTop: measured.waterTop, waterFloor: measured.waterFloor,
                    seaFloor: measured.seaFloor, wallBase: walls.length ? walls[0].baseY : null,
                    wallHeight: walls.length ? walls[0].H : null };
  info.bushes = { count: spots.length, perVariant, tris: bushMeshes.reduce((s, m, i) => s + perVariant[i] * bushs[i].tris, 0),
                  trisPerBush: bushs.map((b) => b.tris), width: bushs.map((b) => +b.w.toFixed(3)) };
  info.cards = cards.length;
  info.triangles = plan.ni / 3 + info.bushes.tris + cards.length * 2;
  info.geometry = { verts: plan.nv, tris: plan.ni / 3 };
  if (ctx.info) ctx.info.spires = info;
  place(undefined, slot.cur || slot.items);
  info.ms = Math.round(performance.now() - t0);
  info.buildMs = Math.round(performance.now() - t0);
  const meshes = [rockMesh, ...bushMeshes, cardMesh];
  return { objects: meshes, meshes, place, info, setGemini, get gemini() { return gem; },
           dispose() { for (const m of meshes) m.geometry.dispose(); gem?.root?.parent?.remove(gem.root); },
           walls, islands, groups, rockMesh, bushMeshes, cardMesh, materials: [rockMat, bushMat, cardMat],
           ROCK_GLSL, makePillar, profileAt, bushGeo: bushs.map((b) => b.geo), cardSpots, bushSpots };
}

/** ASSET part for any slot: one wall pillar (template 0) in the SAME rock shader, instanced; tones = the given piece
 *  colours (sRGB 0-255), else neutral. Unit radius, 5 units tall. */
export function pillarPart(S = S0, colours = null) {
  const t = makePillar(SPIRE.SEED, "wall"), n = t.vcount, H = 5;
  const c = colours || {};
  const pale = S0.srgb(c.p90 || c.all || [194, 180, 211]), mid = S0.srgb(c.other || c.p90 || c.all || [131, 118, 146]);
  const dark = S0.srgb(c.p10 || c.all || [28, 33, 20]), green = S0.srgb(c.green || [55, 71, 36]);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = t.pos[i * 3]; pos[i * 3 + 1] = t.pos[i * 3 + 1] * H; pos[i * 3 + 2] = t.pos[i * 3 + 2]; }
  const g = new THREE.BufferGeometry();
  const fill = (col) => { const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3); return a; };
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aAO", new THREE.BufferAttribute(Float32Array.from(t.ao.subarray ? t.ao.subarray(0, n) : t.ao.slice(0, n)), 1));
  g.setAttribute("aVar", new THREE.BufferAttribute(new Float32Array(n), 1));
  g.setAttribute("aRock", new THREE.BufferAttribute(fill(pale), 3)); g.setAttribute("aMid", new THREE.BufferAttribute(fill(mid), 3));
  g.setAttribute("aDark", new THREE.BufferAttribute(fill(dark), 3)); g.setAttribute("aGreen", new THREE.BufferAttribute(fill(green), 3));
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(t.idx.subarray(0, t.icount)), 1));
  g.computeVertexNormals();
  return { geo: g, mat: rockMaterial(S) };
}
