// op6 projectile-mesh layer transforms — the 3D mesh effect path (MEFT packs).
//
// This is the port of the original's per-frame layer builder. The chain, all read from
// `~/ddw3/asm/dw2003/pro/fightstg.s` and `~/ddw3/asm/dw2003/exe/fns.s`:
//
//   FIGHTSTG_F0x8008970c  the flight object's update. In state 0 it copies op6's two
//     vectors from +0x5c..0x60 and +0x64..0x68 to +0x90..0x94 and +0x96..0x9a, then builds
//     the mesh animator via FIGHTSTG_F0x800847c4, passing a pointer to flight+0x74 as the
//     animator's control block. flight+0x74+0x1c is exactly flight+0x90 and +0x22 is
//     flight+0x96, which is how op6's `from`/`to` reach the root layer below.
//
//   FIGHTSTG_F0x800847c4 -> FIGHTSTG_F0x80084560  the animator constructor. It reads the
//     program table's count at desc+0x4 and allocates `count + 1` layer blocks of 0x84
//     bytes each (`addiu $s4, $a2, 0x1` then `(s4*0x21)*4`). Layer 0 is an implicit ROOT:
//     its mesh and ctrl pointers are stored as zero (0x80084658, 0x80084640), its parent
//     matrix pointer is the fixed identity D0x8004dc20, its rotation/translation are zeroed
//     and its scale is set to 0x1000. The `count` program rows then fill layers 1..count,
//     each row's THREE words going to layer+0x00, +0x04, +0x08 — so the row's first u32,
//     long treated as a zero pad, is the layer's PARENT INDEX.
//
//   FIGHTSTG_F0x80083e0c  the per-frame builder. Order matters:
//     1. FIGHTSTG_F0x80083c30 -> FIGHTSTG_F0x800835f4 samples the three ctrl sub-tracks
//        into every layer at +0x10 (translation), +0x18 (rotation), +0x20 (scale). The
//        sampler scans keyframes for the first whose frame >= the target, copies it whole
//        on an exact hit, and otherwise linearly interpolates between it and its
//        predecessor with a GTE GPF at 12-bit fraction.
//     2. It then OVERWRITES the root layer's translation and rotation with the control
//        block's +0x1c and +0x22 (0x800840e0..0x80084154) — i.e. op6's `from` and `to`.
//        The root's own authored keyframes, if any, are discarded.
//     3. Per layer: the hide test, then rotation via F0x8002b45c, scale via F0x8002b23c,
//        the translation widened into the matrix's translation slot, and finally a
//        concatenation with the PARENT layer's matrix (three GTE MVMVA passes, one per
//        column, at 0x8008422c / 0x80084270 / 0x800842b4).
//
// Two rules in step 3 were previously ported wrongly and are the reason this module exists;
// both are covered by tests/proj-layer-transform.test.js.

// ─── Matrix helpers (column-major; element (row r, col c) is m[c*4 + r]) ──────────────

export function mat4Identity() {
  return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
}

export function mat4Mul(a, b) {
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++)
        out[c*4+r] += a[k*4+r] * b[c*4+k];
  return out;
}

export function mat4Translate(tx, ty, tz) {
  const m = mat4Identity();
  m[12]=tx; m[13]=ty; m[14]=tz;
  return m;
}

export function mat4Scale(sx, sy, sz) {
  const m = mat4Identity();
  m[0]=sx; m[5]=sy; m[10]=sz;
  return m;
}

/**
 * The mesh path's rotation matrix: EXE routine F0x8002b45c, angles in PS1 units
 * (4096 = one turn). fightstg calls it from exactly one site — 0x800841b4, inside the
 * per-frame layer builder.
 *
 * Its composition order was read off the matrix the routine actually emits, not assumed.
 * Two elements pin it: the store at 0x8002b600 writes m[2][0] from `neg $a3` where $a3
 * holds sin_y, giving m[2][0] = -sin_y; and the store at 0x8002b654 writes
 * m[1][1] = sx*sy*sz + cx*cz. Only one axis order satisfies both:
 *
 *     M = Rz * Ry * Rx        (rotate about X first, then Y, then Z)
 *
 * The walker previously used Rx*Ry*Rz — the exact reverse. The two agree whenever at most
 * one axis is nonzero, which is why single-axis spins looked correct, but 109 of the 572
 * shipped layers (across 61 of the 129 packs) author two or more nonzero rotation axes.
 *
 * This is NOT the same routine as the 2D sprite path's F0x8002b65c (Ry*Rx*Rz, shipped as
 * spriteMatrix2x2 in effect-player.js). The EXE has two distinct matrix builders and the
 * mesh path and the sprite path use different ones; do not unify them.
 */
export function mat4RotPSX(ax, ay, az) {
  const q = (a) => (a / 4096) * Math.PI * 2;
  const [cx, sx] = [Math.cos(q(ax)), Math.sin(q(ax))];
  const [cy, sy] = [Math.cos(q(ay)), Math.sin(q(ay))];
  const [cz, sz] = [Math.cos(q(az)), Math.sin(q(az))];
  return new Float32Array([
    cy*cz,               cy*sz,              -sy,      0,
    sx*sy*cz - cx*sz,    sx*sy*sz + cx*cz,   sx*cy,    0,
    cx*sy*cz + sx*sz,    cx*sy*sz - sx*cz,   cx*cy,    0,
    0, 0, 0, 1,
  ]);
}

// ─── Track sampling ───────────────────────────────────────────────────────────────────

/**
 * Sample one ctrl sub-track at tick `t` (FIGHTSTG_F0x800835f4). Keyframes are
 * [frame, x, y, z]; values are linearly interpolated between the two bracketing frames and
 * held past the last one. Tracks terminate with a frame-30000 sentinel that repeats the
 * final value, so holding and interpolating into the sentinel agree.
 */
export function sampleTrack(keys, t, dflt) {
  if (!keys || !keys.length) return dflt;
  let prev = keys[0];
  if (t <= prev[0]) return [prev[1], prev[2], prev[3]];
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i];
    if (t <= k[0]) {
      const f = (t - prev[0]) / (k[0] - prev[0]);
      return [prev[1] + (k[1]-prev[1])*f, prev[2] + (k[2]-prev[2])*f, prev[3] + (k[3]-prev[3])*f];
    }
    prev = k;
  }
  return [prev[1], prev[2], prev[3]];
}

/**
 * The layer visibility test at 0x8008416c..0x80084194. The three scale components are read
 * with `lh` — SIGNED — bitwise-ORed together, and the result compared `slti 0x31`. A
 * negative component sets the sign bit of the OR and therefore hides the layer, so this is
 * emphatically not an absolute-value test; the walker used to take |s| first, which would
 * show a layer the game hides. When the test fails the original writes 0 to the layer's
 * visible flag at +0x0c and jumps past the whole matrix build.
 */
export function layerVisible(scale) {
  return (((scale[0] | 0) | (scale[1] | 0) | (scale[2] | 0)) >= 0x31);
}

/**
 * The mesh display list's `0xEn` state register is a ONE-BASED semi-transparency selector,
 * not the hardware blend mode. The interpreter is FIGHTSTG_F0x80085110: at 0x80085358 it
 * splits each opcode byte into nibbles, and a high nibble of 8..0xE indexes the jump table
 * at D0x80082cb0, whose seventh entry (0xE) is 0x800853c0 — `sw $a0, 0x48($sp)`, i.e. the
 * nibble is parked in a stack slot. That slot is read in exactly one place, 0x80085484,
 * while the tex-op assembles the texpage halfword:
 *
 *     lw    $v0, 0x48($sp)          the stored nibble n
 *     beqz  $v0, .L0x800854ac       n == 0 -> OR nothing in, leaving the field at 0
 *     addiu $v0, -0x1               n - 1
 *     andi  $v0, 0x3
 *     sll   $v0, 0x5                << 5 = the texpage's ABR field (bits 5-6)
 *
 * So the hardware mode is `(n - 1) & 3`, and the walker's old code fed `n` straight to the
 * blend switch — off by one. The shipped packs use only n = 0, 2 and 4:
 *
 *     n = 0  ->  ABR 0   0.5·B + 0.5·F      3,565 prims / 37 packs   (unchanged)
 *     n = 2  ->  ABR 1   B + F, additive   17,394 prims / 115 packs  (was drawn SUBTRACTIVE)
 *     n = 4  ->  ABR 3   B + 0.25·F           92 prims / 2 packs     (was drawn full additive)
 *
 * The n = 2 case is the visible one: it is most of the effect geometry in the game, and
 * subtracting a blue-white texture from the arena floor renders it as a dark red-brown
 * stain. Armormon's basic attack (pack 39) shows both errors at once — its ground arc is
 * n = 2 and its three upright rings are n = 4.
 *
 * n = 0 means OPAQUE, not "mode 0". The same slot gates the primitive's own semi-transparent
 * command bit in all four emit paths — FIGHTSTG_F0x80084bc0 (textured quad, command 0x3C),
 * F0x80084d74 (textured triangle, 0x34), F0x80084e0c (0x2C) and the fourth at 0x80084ec0 —
 * each of which writes its base command byte and then does
 *
 *     lw    $v0, 0x18($a3)         $a3 = sp+0x30, so this is the same sp+0x48 slot
 *     beqz  $v0, <skip>            zero -> the command stays opaque
 *     lbu   $v0, 0x7($v1)
 *     ori   $v0, 0x2               bit 1 = the GPU's semi-transparent flag
 *
 * So a nibble of 0 draws the primitive with no blending at all; the texpage ABR field is
 * left at 0 because the hardware never consults it. That is why this returns `null` rather
 * than 0 for n = 0 — 3,565 primitives across 37 packs are opaque, and the walker had been
 * blending them 50/50.
 *
 * Blending a whole draw group uniformly is EXACT for this artwork, not an approximation.
 * The hardware also carries a per-texel STP bit — inside a semi-transparent primitive, a
 * texel whose palette entry has bit 15 clear is drawn solid rather than blended — and that
 * would need a second pass to reproduce. It is never exercised: over the 18,120,302 texels
 * inside the 16,382 blended primitives of all 129 packs, 70.01% have STP set and 29.99% are
 * the transparent 0x0000 entry, and **not one** has STP clear. Zero primitives mix the two
 * classes. Measured, not assumed.
 */
export function meshAbrMode(n) {
  const v = n | 0;
  return v === 0 ? null : (v - 1) & 3;
}

// ─── Clip playback: how the effect's ticks become authored frames, and when it ends ───
//
// A projectile pack's META bin is its playback clip. FIGHTSTG_F0x80083a54 compiles that bin
// into a per-tick stream of frame numbers (stored at animator+0xa4, its length at +0xa0) and
// sets the playback cursor at +0x80 to **1**. Every tick FIGHTSTG_F0x80083c30 reads the
// entry under the cursor as the frame to sample the layer tracks at, advances the cursor,
// and then looks at the NEW entry: a 0xffff terminator sets the animator's finished flag and
// writes the end flag into the flight's control block at +0x10, and the flight's own update
// FIGHTSTG_F0x8008970c frees the object on its next tick when it sees that flag set.
//
// So the effect's lifetime is the CLIP, not how far its layer tracks happen to be authored.
// The walker used to run a flight for `dur`, the last authored keyframe, which disagrees
// with the clip for 17 of the 129 shipped packs. The clearest case is the Positron Laser
// (packs 108 and 109): its clip replays frames 36..80 four times over, so the beam sustains
// for 215 ticks, where `dur` would have stopped it at 94 after a single pass.
//
// The cursor advances by the global at D0x800a4464. That global is zero in the shipped data
// and nothing in fightstg writes it - it is installed at runtime, and its live value is NOT
// established here. These helpers assume one entry per logic tick, which is the only reading
// consistent with the packs' authored frame ranges; a different runtime step would rescale
// every effect's speed uniformly.

/** Total compiled stream length, terminator included - the original's animator+0xa0. */
export function clipStreamLength(clip) {
  if (!clip || !clip.segments) return 0;
  return clip.segments.reduce((n, [, count]) => n + count, 0) + 1;
}

/** Frame held at stream index `i`, or the terminator value past the end. */
function clipEntry(clip, i) {
  let k = i;
  for (const [first, count] of clip.segments) {
    if (k < count) return first + k;
    k -= count;
  }
  return clip.end;
}

/**
 * How many ticks the flight actually renders for. The cursor starts at 1 and the flight dies
 * on the tick after the cursor reaches the terminator, so this is two less than the stream
 * length.
 */
export function clipTicks(clip) {
  const n = clipStreamLength(clip);
  return n > 2 ? n - 2 : 0;
}

/**
 * The authored frame to sample the layer tracks at, on tick `t` of the flight. Held at the
 * last frame once the stream is exhausted rather than running off it, so a caller that
 * over-runs the lifetime degrades to a freeze instead of to garbage.
 */
export function clipFrameAt(clip, t) {
  if (!clip || !clip.segments || !clip.segments.length) return t;   // undecoded clip: 1:1
  const last = clipStreamLength(clip) - 2;                          // index of the final frame
  const i = Math.min(Math.max(0, Math.floor(t)) + 1, Math.max(0, last));
  return clipEntry(clip, i);
}

function localMatrix(layer, t) {
  const tr = layer.tracks || {};
  const sc = sampleTrack(tr.s, t, [0x1000, 0x1000, 0x1000]);
  const tl = sampleTrack(tr.t, t, [0, 0, 0]);
  const ro = sampleTrack(tr.r, t, [0, 0, 0]);
  // Rotation, then scale, then translation. F0x8002b23c multiplies m[i][j] by s[j] — it
  // scales by COLUMN, i.e. it forms M*diag(s), so the local transform is T * (R * S).
  return mat4Mul(mat4Translate(tl[0], tl[1], tl[2]),
                 mat4Mul(mat4RotPSX(ro[0], ro[1], ro[2]),
                         mat4Scale(sc[0]/4096, sc[1]/4096, sc[2]/4096)));
}

/**
 * World matrices for every program layer of one flight at tick `t`.
 *
 * `layers` are the extractor's program rows in order, so `layers[i]` is the original's
 * layer i+1 and `layers[i].parent` indexes the same 1-based space, with 0 meaning the
 * implicit root. `root` is the root layer's matrix — T(from) * R(to) already multiplied by
 * whatever view/world transform the caller wants in front of it.
 *
 * Returns `{ world, shown }`, both 1-based to match the original's indexing: `world[i+1]`
 * and `shown[i+1]` belong to `layers[i]`, and index 0 is the root.
 *
 * Hidden layers and the stale-matrix rule: when the hide test fails, the original skips the
 * matrix build entirely, so the layer's concatenated matrix at +0x4c keeps whatever it held
 * on the last frame the layer WAS visible. A child parented to a hidden layer therefore
 * stays at the parent's last pose rather than collapsing. That matters in the shipped data:
 * three packs (301, 329, 367) extinguish a parent while a child is still alive, and pack
 * 367's halo lingers for twenty ticks after its core has gone. Recomputing the parent
 * fresh would multiply the child by a zero-scale matrix and make it vanish. This is
 * reproduced here as a pure function of `t` — a hidden layer resolves to the most recent
 * earlier tick at which it was visible — so the result does not depend on frame pacing.
 */
export function projLayerWorlds(layers, t, root) {
  const n = layers.length;
  const world = new Array(n + 1);
  const shown = new Array(n + 1);
  world[0] = root;
  shown[0] = true;

  const tick = Math.max(0, Math.floor(t));
  const visibleAt = (i, k) =>
    layerVisible(sampleTrack((layers[i].tracks || {}).s, k, [0x1000, 0x1000, 0x1000]));

  // Matrix of layer index `idx` (1-based; 0 = root) as of tick `k`, following the stale
  // rule for any hidden layer on the way up. Parents always precede their children in the
  // table (verified: 0 forward references across all 572 shipped rows), so a plain
  // walk up the chain terminates.
  const matrixAt = (idx, k) => {
    if (idx === 0) return root;
    const L = layers[idx - 1];
    let eff = k;
    while (eff > 0 && !visibleAt(idx - 1, eff)) eff--;
    // `eff` is now the last tick at which this layer was written, or 0 if it was never
    // visible — in which case the original would be reading an uninitialised matrix, which
    // is not behaviour worth imitating, so fall back to its pose at tick 0.
    const p = (L.parent > 0 && L.parent < idx) ? L.parent : 0;
    return mat4Mul(matrixAt(p, eff), localMatrix(L, eff));
  };

  for (let i = 0; i < n; i++) {
    const L = layers[i];
    const sc = sampleTrack((L.tracks || {}).s, tick, [0x1000, 0x1000, 0x1000]);
    shown[i + 1] = layerVisible(sc);
    const p = (L.parent > 0 && L.parent < i + 1) ? L.parent : 0;
    // The common case — every ancestor visible at this tick — needs no back-scan, and
    // `world[p]` is already built because parents precede children.
    world[i + 1] = shown[i + 1]
      ? mat4Mul(world[p], localMatrix(L, tick))
      : matrixAt(i + 1, tick);
  }
  return { world, shown };
}
