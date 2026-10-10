// The battle arena's per-layer palette, its back-face cull and its blend are DECODED, not approximate.
//
// Measured live 2026-10-07 on the operator's BizHawk rig (authorised): freeze an ordinary-battle
// frame, dump MainRAM, and read each POLY_FT4 packet's texpage/CLUT/blend/XY out of RAM. Every arena
// quad is cmd 0x2C (POLY_FT4) with texpage semi bits 0 -> the GPU draws the arena OPAQUE; each
// primitive's CLUT field selects one of the pack's four palette groups (page0 rows 254/255,
// halfword cols 0/16/32/48). See
// .dw3-research/playtest-arena-palette-rig-2026-10-07/results.md.
//
// This test fails on the pre-change tree (no cull, no per-mesh page table, opaque NOT applied).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARENAS = join(ROOT, "web/assets/battle/arenas");
const B3D = readFileSync(join(ROOT, "web/battle3d.js"), "utf8");

/** Minimal 8-bit RGBA (colour type 6, no interlace) PNG reader — our own extractor's output.
 *  No image dependency exists in this repo, so the test decodes the shipped texture itself so it
 *  can assert on real pixels (a source-text check alone cannot see the discolouration). */
function readPngRGBA(path) {
  const buf = readFileSync(path);
  let off = 8, w = 0, h = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      assert.equal(data[8], 8, "8-bit"); assert.equal(data[9], 6, "RGBA");
      assert.equal(data[12], 0, "no interlace");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4, out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const o = y * stride, prev = (y > 0) ? (y - 1) * stride : -1;
    for (let x = 0; x < stride; x++) {
      const A = x >= 4 ? out[o + x - 4] : 0;
      const B = prev >= 0 ? out[prev + x] : 0;
      const C = (x >= 4 && prev >= 0) ? out[prev + x - 4] : 0;
      let v = raw[p++];
      if (f === 1) v = (v + A) & 255;
      else if (f === 2) v = (v + B) & 255;
      else if (f === 3) v = (v + ((A + B) >> 1)) & 255;
      else if (f === 4) {
        const pp = A + B - C, pa = Math.abs(pp - A), pb = Math.abs(pp - B), pc = Math.abs(pp - C);
        v = (v + (pa <= pb && pa <= pc ? A : pb <= pc ? B : C)) & 255;
      } else assert.equal(f, 0, `filter ${f}`);
      out[o + x] = v;
    }
  }
  return { w, h, data: out };
}

/** Fraction of pixels within `tol` of an RGB colour. */
function colourFrac(img, rgb, tol = 4) {
  let n = 0;
  for (let i = 0; i < img.w * img.h; i++) {
    const o = i * 4;
    if (Math.abs(img.data[o] - rgb[0]) <= tol && Math.abs(img.data[o + 1] - rgb[1]) <= tol &&
        Math.abs(img.data[o + 2] - rgb[2]) <= tol) n++;
  }
  return n / (img.w * img.h);
}


test("arena geometry carries the decoded OPAQUE blend and a per-group CLUT", () => {
  const g = JSON.parse(readFileSync(join(ARENAS, "meft1001", "geometry.json"), "utf8"));
  assert.equal(g.blend, "opaque", "arena quads are cmd 0x2C — GPU-opaque, not additive/alpha");
  assert.ok(g.groups.length > 0, "groups present");
  for (const grp of g.groups) {
    assert.ok(Array.isArray(grp.clut) && grp.clut.length === 2,
      `group names its CLUT palette group: ${JSON.stringify(grp.clut)}`);
  }
});

test("every arena group carries the per-primitive cull grouping (cullRef)", () => {
  for (const pack of ["meft1001", "meft1013"]) {
    const g = JSON.parse(readFileSync(join(ARENAS, pack, "geometry.json"), "utf8"));
    for (const grp of g.groups) {
      const tris = grp.pos.length / 9;
      assert.equal(grp.cullRef.length, tris, `${pack}: one cullRef per triangle`);
      // each ref is a valid triangle index; both triangles of a quad share their quad's first tri
      for (const r of grp.cullRef) assert.ok(Number.isInteger(r) && r >= 0 && r < tris, "valid cullRef");
    }
  }
});

test("each arena pack ships the per-CLUT palette textures its groups name", () => {
  for (const pack of ["meft1001", "meft1013", "meft1005"]) {
    const g = JSON.parse(readFileSync(join(ARENAS, pack, "geometry.json"), "utf8"));
    const seen = new Set();
    for (const grp of g.groups) {
      const key = `${grp.page}_c${grp.clut[0]}_r${grp.clut[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      assert.ok(existsSync(join(ARENAS, pack, `${key}.png`)), `${pack}/${key}.png present`);
      // the pack's transparent colour key is resolved to the arena background; a debug "raw" copy
      // (the key left as index-0/black) ships beside it for the before/after capture.
      assert.ok(existsSync(join(ARENAS, pack, `${key}_void.png`)), `${pack}/${key}_void.png present`);
    }
    assert.ok(seen.size >= 2, `${pack} uses more than one palette group`);
  }
});

test("MEFT1001 references exactly the four documented palette groups", () => {
  const g = JSON.parse(readFileSync(join(ARENAS, "meft1001", "geometry.json"), "utf8"));
  const cols = new Set(g.groups.filter((x) => x.clut[1] === 255 && x.clut[0] !== 16).map((x) => x.clut[0]));
  const all = new Set(g.groups.map((x) => `${x.clut[0]},${x.clut[1]}`));
  assert.equal(all.size, 4, `four CLUT groups, got ${[...all].join(" | ")}`);
  assert.ok(cols.size >= 3, "the wall groups are distinct palettes");
});

test("the arena render binds the group's own palette texture and records the decoded blend", () => {
  assert.match(B3D, /function arenaTextureFor\(/, "renderer resolves a texture per group");
  assert.match(B3D, /assets\/battle\/arenas\/\$\{pk\.name\}\/\$\{file\}/,
    "the per-CLUT texture URL is derived from the group's page+clut");
  const branch = B3D.slice(B3D.indexOf("} else if (arenaActive) {"));
  const slice = branch.slice(0, branch.indexOf("} else {\n      drawQuad"));
  assert.match(slice, /arenaTextureFor\(activeArena, g\)/, "each group draws with its own palette texture");
  // The decoded GPU blend is OPAQUE (cmd 0x2C) and is APPLIED (blending disabled).
  assert.match(slice, /NOW APPLIED/, "the branch records the decoded opaque blend as applied");
  assert.match(slice, /gl\.disable\(gl\.BLEND\)/, "the arena is drawn opaque (blending off)");
});

// ── The back-face cull: the original's own NCLIP MAC0<=0 test, ported to the arena draw ──

test("the arena draw runs the ported back-face cull on each group", () => {
  assert.match(B3D, /function arenaCullIndices\(/, "the cull is a named function");
  assert.match(B3D, /function drawProjLayerIndexed\(/, "culled layers draw through an index buffer");
  const branch = B3D.slice(B3D.indexOf("} else if (arenaActive) {"));
  const slice = branch.slice(0, branch.indexOf("} else {\n      drawQuad"));
  assert.match(slice, /drawProjLayerIndexed\(gl, texP, mvp, g, tex, idx\)/,
    "each group is drawn through the cull");
});

test("the cull is the original's NCLIP MAC0>0 keep rule in PS1 screen space (Y down)", () => {
  const fn = B3D.slice(B3D.indexOf("function arenaCullIndices("));
  const body = fn.slice(0, fn.indexOf("\n}", 0) + 2);
  // The signed area is evaluated with screen-Y negated (NDC is Y-up; PS1 screen Y is down), and the
  // primitive survives only when MAC0 > 0 — the DECODED convention (results.md: 196/196, 414/414,
  // 487/487, 531/531 surviving arena packets have MAC0 > 0, none <= 0).
  assert.match(body, /const mac0 = x0 \* \(-y1 \+ y2\)/, "NCLIP signed area, screen-Y down");
  assert.match(body, /mac0 \* arenaCullSign > 0/, "survivor rule: MAC0 > 0");
  // The cull reads each quad's governing triangle from cullRef, so both split triangles share the
  // primitive's facing.
  assert.match(body, /ref\[t\]/, "per-primitive cull grouping");
});

test("the sign convention and the quad grouping are pinned in the extractor and the derive tool", () => {
  const ex = readFileSync(join(ROOT, "tools/extract_arenas.py"), "utf8");
  assert.match(ex, /"cullRef": \[\]/, "geometry carries the per-primitive cull grouping");
  assert.match(ex, /g\["cullRef"\] \+= \[first\] \* \(len\(tri\) \/\/ 3\)/,
    "both split triangles of a quad share the first triangle's cull");
  const drv = readFileSync(join(ROOT, "tools/derive_arena_mesh_pages.py"), "utf8");
  assert.match(drv, /def page_uv_counts\(/, "per-page packet UV multiset from a live RAM dump");
  assert.match(drv, /def mesh_pages\(/, "per-mesh page by UV-set match");
  assert.ok(existsSync(join(ROOT, "tools/arena_mesh_pages.json")), "the captured mesh->page table ships");
});

// ── The per-mesh atlas page (page 0 floor / page 1 wall) is the captured decode, not the col rule ──

test("the extractor assigns each mesh its captured page, not the wrong col==16 rule", () => {
  const ex = readFileSync(join(ROOT, "tools/extract_arenas.py"), "utf8");
  assert.match(ex, /def mesh_page\(pack: str, row: int, clut_col: int\)/, "a per-mesh page resolver");
  assert.match(ex, /MESH_PAGE_TABLE\.get\(pack\)/, "reads the captured table");
  // The old single-rule heuristic survives only as the fallback for an uncaptured pack.
  assert.doesNotMatch(ex, /page = "floor" if c\[0\] == 16 else "wall"/,
    "the arena no longer picks the page from the CLUT column alone");
  const table = JSON.parse(readFileSync(join(ROOT, "tools/arena_mesh_pages.json"), "utf8"));
  // MEFT1001's col-16 prims are the WALL (page1), not the floor — the predecessor's rule was wrong.
  assert.equal(table.meft1001["6"], "p1", "MEFT1001 mesh 6 is page1 (wall)");
});

test("the arena no longer picks a single best palette per page", () => {
  const ex = readFileSync(join(ROOT, "tools/extract_arenas.py"), "utf8");
  assert.match(ex, /def palette_at\(/, "palette lookup by (col,row)");
  assert.match(ex, /def arena_geometry\(/, "arena geometry groups by (page, clut)");
  assert.doesNotMatch(ex, /eb\.best_clut\(clut_page, void\)/,
    "the arena no longer picks a single best palette per page");
});

// ── The colour key is the CLUT ENTRY, not an index (the discolouration fix, 2026-10-07) ──
//
// The bug: page_rgba voided index 0 AND the page-dominant index and painted them with the arena
// background `bg`. The PS1 rule is the CLUT ENTRY (`cl[idx] == 0`) — the repo's own
// extract_fight_effects.py:decode_atlas documents it. Two rig-grounded consequences:
//   * meft1013 wall_c32_r255 — entry 0 is a real GREEN (80,112,48) and index 0 is ~48% of the
//     page; the index rule painted half the atlas the arena background (101,88,206) violet.
//   * meft1001 floor_c32_r255 — the page-dominant index 15 is the WHITE cloud step (240,240,240),
//     entry 0x7bde; the index rule painted every cloud flat blue.
// These assertions read the shipped PNGs, so they fail on the pre-fix assets (0% cloud / 52% bg).

test("the extractor voids by the CLUT 0x0000 entry, not by index 0 / the page-dominant index", () => {
  const ex = readFileSync(join(ROOT, "tools/extract_arenas.py"), "utf8");
  assert.match(ex, /clut\[idx\] == 0/, "the PS1 entry rule is the void test");
  assert.doesNotMatch(ex, /voids = \{0,/, "no index-based void set");
  assert.doesNotMatch(ex, /eb\._dominant\(page\)/, "the page-dominant index is not a void key");
});

test("meft1013 wall_c32_r255 keeps its real green background (entry 0 is not transparent)", () => {
  // palette (32,255): entry 0 = (80,112,48), a real GREEN; the atlas's fill index 15 = (104,168,48).
  const img = readPngRGBA(join(ARENAS, "meft1013", "wall_c32_r255.png"));
  const bg = colourFrac(img, [101, 88, 206]);          // the arena background it used to be painted
  const green = colourFrac(img, [80, 112, 48]);        // entry 0 — index 0's real colour, 24% of it
  assert.ok(bg < 0.01, `no arena-background fill in the texture, got ${(bg * 100).toFixed(1)}%`);
  assert.ok(green > 0.20, `index 0's real green survives, got ${(green * 100).toFixed(1)}%`);
});

test("meft1001 floor_c32_r255 keeps its white clouds (the dominant index is a colour)", () => {
  // palette (32,255): entry 15 = (240,240,240) white, entry 0x7bde — the white cloud step, and the
  // page-dominant index. Painting it with the bg destroyed the clouds.
  const img = readPngRGBA(join(ARENAS, "meft1001", "floor_c32_r255.png"));
  const cloud = colourFrac(img, [240, 240, 240]);
  assert.ok(cloud > 0.40, `the white cloud step survives, got ${(cloud * 100).toFixed(1)}%`);
  // The blue sky of arena 1 IS the arena background, and it must still appear where entry 0 is.
  const sky = colourFrac(img, [59, 115, 233]);
  assert.ok(sky > 0.10 && sky < 0.25, `entry-0 texels show the background, got ${(sky * 100).toFixed(1)}%`);
});

// ── The atlas page is a property of the CLUT GROUP, not the mesh ──
//
// Crossing each pack quad-prim's CLUT group against the live packet's texpage is unanimous for
// every group of every captured pack (28 packs, 0 conflicts). The old per-mesh table sent
// meft1001's (0,255) group and meft1013's (16,255) group to the wrong atlas page.

test("the atlas page is decoded per CLUT group, not per mesh", () => {
  const ex = readFileSync(join(ROOT, "tools/extract_arenas.py"), "utf8");
  assert.match(ex, /def group_page\(/, "a per-CLUT-group page resolver");
  assert.match(ex, /CLUT_PAGE_TABLE\.get\(pack\)/, "reads the captured CLUT->page map");
  assert.ok(existsSync(join(ROOT, "tools/arena_clut_pages.json")), "the CLUT->page map ships");
  const t = JSON.parse(readFileSync(join(ROOT, "tools/arena_clut_pages.json"), "utf8"));
  assert.equal(t.meft1001["0,255"], "p0", "meft1001 (0,255) is drawn from page0");
  assert.equal(t.meft1013["16,255"], "p0", "meft1013 (16,255) is drawn from page0");
  const g = JSON.parse(readFileSync(join(ARENAS, "meft1001", "geometry.json"), "utf8"));
  const grp = g.groups.find((x) => x.clut[0] === 0 && x.clut[1] === 255);
  assert.equal(grp.page, "floor", "the group's texture is the page0 atlas");
});

// ── The background sky colour is the original's 5-bit value ──
//
// The rig frame's sky is the SFSTDATA param's bytes with the low three bits dropped: arena 1
// shows exactly (56,112,232) (20436 pixels) and arena 13 exactly (96,88,200) (19220 pixels),
// while the full-byte values (59,115,233)/(101,88,206) appear ZERO times in either frame.

test("the arena background is the original's 5-bit sky, not the full param byte", () => {
  const m = JSON.parse(readFileSync(join(ARENAS, "manifest.json"), "utf8")).byArena;
  assert.deepEqual(m["1"].bg, [56, 112, 232], "arena 1 sky matches the rig frame");
  assert.deepEqual(m["13"].bg, [96, 88, 200], "arena 13 sky matches the rig frame");
  const ex = readFileSync(join(ROOT, "tools/extract_arenas.py"), "utf8");
  assert.match(ex, /& 0xF8/, "background bytes are truncated to 5 bits per channel");
});

// ── The colour-key texel is SKIPPED (alpha 0), not an opaque fill — the "flat blue patches" ──
//
// The PS1 GPU SKIPS a POLY_FT4 texel whose CLUT entry is 0x0000: it writes neither colour nor
// depth, so whatever is already in the framebuffer (the arena's sky quad, or geometry drawn
// behind) shows through. Worker A's fix painted those texels the arena background OPAQUELY, which
// made them OCCLUDE the ground behind them — the operator's "flat blue rectangular patches where
// rock should be" on meft1004 (arena 4, Tyrano Valley). MEASURED 2026-10-07: of arena 4's enclosed
// background pixels, 9815 render BLACK under the debug `voidRaw` (opaque key) capture, i.e. they
// are colour-key texels over real geometry. The shipped proj shader already discards (`FRAG_SRC:
// if (c.a < 0.05) discard;`), so the key texel must ship at alpha 0.
// See .dw3-research/arena-construction-2026-10-07/worker-e.md.

function alphaZeroFrac(img) {
  let n = 0;
  for (let i = 0; i < img.w * img.h; i++) if (img.data[i * 4 + 3] === 0) n++;
  return n / (img.w * img.h);
}

test("the arena colour-key texels ship transparent (alpha 0), so the shader skips them", () => {
  // meft1004 (arena 4) is the pack the operator saw broken; its (32,255) group carries the key.
  const meft1004 = readPngRGBA(join(ARENAS, "meft1004", "wall_c32_r255.png"));
  assert.ok(alphaZeroFrac(meft1004) > 0.02,
    `meft1004 wall_c32_r255 key is transparent, got ${(alphaZeroFrac(meft1004) * 100).toFixed(2)}%`);
  // meft1001's sky group likewise.
  const meft1001 = readPngRGBA(join(ARENAS, "meft1001", "floor_c32_r255.png"));
  assert.ok(alphaZeroFrac(meft1001) > 0.10,
    `meft1001 floor_c32_r255 key is transparent, got ${(alphaZeroFrac(meft1001) * 100).toFixed(2)}%`);
  // …and it must still be alpha-0, never an opaque background fill: the RGB stays the bg for the
  // debug capture, but no key texel may be opaque at that RGB.
  const ex = readFileSync(join(ROOT, "tools/extract_arenas.py"), "utf8");
  assert.match(ex, /\(vf\[0\], vf\[1\], vf\[2\], 0\)/,
    "the shipped texture writes the key texel at alpha 0");
  assert.doesNotMatch(ex, /\(vf\[0\], vf\[1\], vf\[2\], 255\)/,
    "the key texel is never shipped as an opaque background fill");
});

// ── The arena is DEPTH-SORTED (the original's ordering table), not left in texture-group order ──
//
// Every arena primitive carries an OT Z the walker already decodes with the SAME display-list
// interpreter (engine/dw3/battle-displaylist.ts#buildMeshFields: `fields.otz = avsz(...)` off
// node+0x7c), and the original draws the ordering table back-to-front. Our arena draw emits one
// drawElements per (page, CLUT) texture group — a REORDER of the display list — so with no depth
// writes the last group wins and a far sky group paints over the near ground. MEASURED 2026-10-07:
// enclosed-background holes in arena 4's viewport fall 6.66% -> 3.29% with depth writes alone.

test("the arena draw depth-sorts — it writes depth like the original's ordering table", () => {
  const branch = B3D.slice(B3D.indexOf("} else if (arenaActive) {"));
  const slice = branch.slice(0, branch.indexOf("} else {\n      drawQuad"));
  assert.match(slice, /depthMask\(true\)/, "the arena writes depth (the OT sort)");
  assert.match(slice, /arenaDebug\.depthWrite/, "the OT sort is a tracked decode switch");
  assert.match(B3D, /depthWrite: true/, "the OT depth sort ships ON by default");
  // The decode it reproduces is the display-list interpreter's ordering value.
  assert.match(slice, /ordering table/i, "the branch records the ordering-table decode");
});


