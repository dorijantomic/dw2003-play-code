// Battle camera — port of the PS1 look-at + op5 camera op. Self-contained (no battle3d
// dependency; battle3d consumes this, per the web/fight/ architecture).
//
// The LOOK-AT and the face-box camera worker are the original's shared systems, so
// they are now the engine port engine/dw3/battle-camera.ts (F0x8002a1ac and the
// FIGHTSTG_F0x80091b8c family), and this file is the browser ADAPTER onto it — as
// web/fight/action-vm.js consumes engine/dw3/battle-slot-motion.ts. buildView stays
// the render-space CLOSED FORM of the same look-at (it is what battle3d.mat4LookAt
// compares against, not the original routine); faceBoxShot/faceBoxView now come from
// the port.
import {
  FACE_BOX_GROUPS as PORT_FACE_BOX_GROUPS,
  FACE_BOX_LAYER_KEY, FACE_BOX_TICK, FACE_BOX_WORKER_SIZE,
  faceBoxShotFromRows, faceBoxShotRead, faceBoxLookAt, faceBoxTick, faceBoxSpawn,
} from "../vendor/engine.js";

// camera_view_matrix ledger: F0x8002a1ac builds a STANDARD look-at view matrix (data-confirmed
// to ~0.3 deg), with the eye/target/H living in the live cam struct D0x800a46d8. buildView here
// reproduces that look-at exactly (== battle3d.mat4LookAt at roll=0), plus an optional roll.

const sub3   = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const cross3 = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot3   = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const norm3  = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };

// Right-handed, column-major view matrix (identical convention to battle3d.mat4LookAt).
export function buildView(eye, target, up = [0, 1, 0], roll = 0) {
  const z = norm3(sub3(eye, target));   // view backward
  let x = norm3(cross3(up, z));         // right
  let y = cross3(z, x);                 // up'
  if (roll) {                            // rotate the (x,y) basis about the view axis z
    const c = Math.cos(roll), s = Math.sin(roll);
    const xr = [x[0]*c + y[0]*s, x[1]*c + y[1]*s, x[2]*c + y[2]*s];
    const yr = [-x[0]*s + y[0]*c, -x[1]*s + y[1]*c, -x[2]*s + y[2]*c];
    x = xr; y = yr;
  }
  const m = new Float32Array(16);
  m[0]=x[0]; m[4]=x[1]; m[8]=x[2];  m[12]=-dot3(x, eye);
  m[1]=y[0]; m[5]=y[1]; m[9]=y[2];  m[13]=-dot3(y, eye);
  m[2]=z[0]; m[6]=z[1]; m[10]=z[2]; m[14]=-dot3(z, eye);
  m[15]=1;
  return m;
}

// PS1 GTE projection: horizontal FOV = 2*atan((screenW/2)/H). PS1 screen width = 320; H is the
// cam struct's projection distance (cam+0x30). fovFromH(280) ~= 59.5 deg (the ~60 deg idle FOV).
export function fovFromH(H, screenW = 320) {
  return 2 * Math.atan((screenW / 2) / H) * 180 / Math.PI;
}

// The same projection distance expressed as the VERTICAL fov, which is what a GL perspective
// matrix takes: the PS1 screen is 240 lines tall, so fovY = 2*atan(120/H). Feeding a GL
// projection the HORIZONTAL fov instead drew the arena at 240/320 = 0.75x of the screen scale
// the 2D effect layer draws in (effect-player.js maps a PSX px to canvasH/240), so every
// fighter sat pulled toward the screen centre and its screen-space tech effect stayed out to
// the side of it. With fovY, a widescreen canvas widens the view horizontally through the
// aspect term and the two layers agree exactly at any canvas size.
export function fovYFromH(H, screenH = 240) {
  return 2 * Math.atan((screenH / 2) / H) * 180 / Math.PI;
}

// op5 camera op (handler F0x8008c004). words[0]=mode(s3), words[1]=sub.
//  sub=1 -> a 14-field transform written to cam struct D0x800a46d8 (offsets 0x00..0x30) with the
//          handler's Y/Z negations (PS1 Y-down/Z), F0x8008c004 .L0x8008c0fc (fightstg.s
//          L9446-9497). Layout: +0x00 eye(i32x3), +0x0c target(i32x3), +0x18 ANCHOR(i32x3),
//          +0x24/+0x26/+0x28 three angles(u16), +0x2c roll, +0x30 H.
//
//          ⚠️ CORRECTED: +0x18 is not spare — it is the shot's WORLD ANCHOR, and the eye/target
//          pair is stated RELATIVE TO IT. The apply method F0x80092244 copies all 0x34 bytes into
//          the camera object at +0x54, and its update F0x80091df4 (L15612-15642) hands
//          F0x8002a1ac a PS1 MATRIX whose ROTATION is RotMatrix(the three angles) and whose
//          TRANSLATION is +0x18; the view builder composes that matrix into the look-at it made
//          from eye/target, so the anchor displaces the finished shot in world space. The canned-
//          shot loader F0x800923b4 fills only eye/target/H and explicitly zeroes +0x18, +0x24..
//          +0x28 and +0x2c (L15952-15960), which is why an absolute shot carries no anchor.
//
//          The shipped data is decisive: of the 283 sub=1 transforms across the 245 model packs,
//          80 have a zero target and a non-zero anchor, 202 the reverse, and NOT ONE has both —
//          and every anchor is a fighter's own arena slot (z ~ +-5700, y ~ -1024..-3456). Read
//          without the anchor, those 80 shots all aim at the arena origin, which left the caster
//          a quarter-screen off centre while its screen-space tech effect stayed dead centre:
//          Renamon's Diamond Storm burst hung out to her side instead of over her head.
//
//          The three angles at +0x24 ARE the anchor frame's ORIENTATION, and they are applied
//          (2026-08-19). The record is a GsCOORDINATE2 built on the stack by F0x80091df4
//          (.L0x80092128 zeroes its flg, .L0x80092130-.L0x80092138 its param/super), whose coord
//          matrix has rotation RotMatrix(+0x24 angles) and translation +0x18; F0x8002a1ac takes
//          it as arg field +0x1c and, when non-null (.L0x8002a46c), inverts it (.L0x8002a474-
//          .L0x8002a4c8) and composes it onto the look-at (.L0x8002a4c4 -> .L0x8002a4cc-
//          .L0x8002a508). So the finished view is V_local . W^-1, which places the shot at
//          W . eye = R.eye + anchor and turns its up vector with R. With zero angles R is the
//          identity and this is exactly the plain anchor add, which is why 40 of the 80 anchored
//          shots were already right.
//  sub=0 -> a preset jump via table 0x80082ea0[presetId] (preset bodies not yet decoded; id recorded).

// ── The battle close-up face box (layer key 0x1009) ──────────────────────────
// The 100x60 box at the top right of a 3D battle shows the head of OUR OWN Digimon — the
// player partner, fighter slot 0 of the battle manager — whoever is speaking. Its camera is
// not one of ours: FIGHTSTG_F0x80091c1c (fightstg.s:15355-15409) reads it out of that
// fighter's own SMDLDATA record and FIGHTSTG_F0x80091b8c (:15316-15352) builds the look-at
// from it.
//
//   WHICH record — one place, and the speaker cannot move it. FIGHTSTG_F0x80091dac
//   (:15461-15478) allocates the box's framing object and stores its first argument at
//   self+0x50 (the record index) and its second at self+0x54 (the record). Its only caller,
//   the box driver FIGHTSTG_F0x80094064 (:17805-17840), takes the battle manager for scene
//   0x14 (:17810-17817), asks it for ONE fighter record (:17819-17823, manager+0x188 =
//   F0x80087e28, installed :5510-5512), and passes that record's +0x14 as the index and the
//   SAME pointer as the record (:17829). So index and record always agree, and neither
//   depends on who is speaking.
//
//   That index is the fighter's own model key, written once when the fighter is created:
//   the manager's +0x184 creator F0x80087d00 stores its third argument at +0x14
//   (:5287) and hands that same argument to the smdldata accessor [0x800A4570]
//   (:5275-5279), and its only caller F0x80086a00 passes the battle-entry descriptor's word
//   +0x04 (:4132-4134) — the fighter's value0, i.e. the same number as its smdldata key and
//   the same number as its model pack folder (docs/research/battle/
//   smdldata-container-2026-08-05.md:135).
//
//   Confirmed live, not inferred: docs/research/battle/captures/face-box-camera-2026-10-03/
//   read self+0x50 = 383 in a player line AND in an enemy line of a second battle against a
//   different opponent, and 383 is Kotemon's key (~/ddw3/data/digimon_profiles.toml row 0,
//   value0 = 383) — the player's fighter both times, whichever side spoke.
//
//   F0x80091c1c: the group is 6 when the fighter record's flag at +0x18 is zero and 7 when it
//   is not (0 = player side, 0x10 = enemy side, claim
//   terra-037-speaker16-enemy-side-20260906), so group 6 is the player framing and group 7
//   the enemy one — the ONLY thing the speaker chooses. It then reads three vectors at
//   record+0x1A+6g (eye), +0x62+6g (the point looked at) and +0xAA+2g (the projection
//   distance H), negating Y and Z of both vectors on the way in (:15380, :15390, :15398,
//   :153a8-153b0). tools/extract_smdldata.py reads the same offsets, so `record.face_box` in
//   model_placement.json already holds them in that stored form and nothing here negates
//   again.
//
//   F0x80091b8c: F0x8002b65c(self+0xCC, self+0x80) first — a libgte RotMatrixYXZ whose angle
//   triple (self+0xCC/+0xCE/+0xD0) F0x80091c1c zeroes and nothing else ever writes, so it is
//   the identity; then F0x8002a1ac(self+0x58), which is the ordinary look-at from the stored
//   eye (self+0x58..0x60) to the stored target (self+0x64..0x6C) and publishes it as the
//   view matrix. The offset triple at self+0xD4..0xDC that the routine copies into the view
//   is zeroed by the same descriptor read, so the shot carries no anchor. buildView() below
//   is that matrix.
//
//   H is the PS1 projection distance: the box's +0x15C method (F0x8001e404, exe/fns.s:15717)
//   stores it on the layer at view+0x88 and the layer's per-frame +0x158 (F0x8001e470,
//   exe/fns.s:15748) reads that word and does `ctc2 $a0, 26` through F0x8002998c ->
//   F0x8002b40c (exe/fns.s:29902). That the register is the focal length is the caller's own
//   evidence, not a register-number table: the SAME +0x15C method, with the SAME single
//   `ctc2` behind it, is how the main battle camera hands over its focal distance
//   (FIGHTSTG_F0x80092158, fightstg.s:157bc-157cc, `lw $a2, 0x84($s3)`), and that distance is
//   the one docs/research/fight-3d/battle-camera.md section 1 read off the live matrix. It is
//   the game's own focal length, in game pixels against the game's 320x240 frame.
//
//   The layer's own window is the box driver's: the rectangle 208,76,100,60 written to
//   0x800A4710 and registered as layer 0x1009 (fightstg.s:17781-17789), then +0x118(258,106)
//   at :17795. So the picture is the 320x240 projection taken about the box's own centre,
//   clipped to the box, which is why a 100x60 window shows a much tighter angle than the
//   battle view does: the visible half-angles are atan(50/H) across and atan(30/H) up, not
//   atan(160/H)/atan(120/H).
//   CORRECTION (2026-10-04, docs/research/battle/battle-hud-ownership-check-2026-10-03.md
//   §6.3): +0x148(50) at :17800 is NOT a half-width. `+0x148` is F0x8001e1e8, which stores the
//   argument at view+0x78 and allocates argument*20 bytes — it is the ordering table's DEPTH.
//   The window's width comes from the rectangle alone. FACE_BOX_HALF_W is kept as the 50 the
//   rectangle's width contributes to the horizontal half-angle, which is all it ever was used
//   for; nothing reads it as a window setter.
export const FACE_BOX_RECT = { x: 208, y: 76, w: 100, h: 60 };
export const FACE_BOX_CENTRE = { x: 258, y: 106 };   // fightstg.s:17795, +0x118(0x102, 0x6A)
export const FACE_BOX_HALF_W = FACE_BOX_RECT.w / 2;  // the RECTANGLE's half-width; see above
export const FACE_BOX_ORDERING_TABLE = 50;           // fightstg.s:17800, +0x148(0x32)
export const FACE_BOX_GROUPS = { player: PORT_FACE_BOX_GROUPS.player, enemy: PORT_FACE_BOX_GROUPS.enemy };

/**
 * The close-up framing for `side` out of a model_placement record — what the console reads,
 * unfiltered — or null when that read leaves the file.
 *
 * F0x80091c1c (fightstg.s:15355-15409) takes no branch on what it finds. It forms
 * `record + 0x1A + 6*g` (the eye), `record + 0x62 + 6*g` (the point looked at) and
 * `record + 0xAA + 2*g` (the projection distance H) from the record pointer the smdldata
 * accessor returned, `lh`s all three, negates the second and third component of each vector,
 * stores the three vectors at self+0x58..0x6C and H at self+0x78, and zeroes the angle triple
 * and the offset triple (fightstg.s:153c6c-153ce0). A 0x48 record is three shots long, so for
 * groups 6 and 7 those addresses fall past the record and the console reads its neighbour's
 * bytes — tools/extract_smdldata.py reproduces that read exactly, neighbours and all, so this
 * returns it rather than filtering it out. Only model keys 70 and 177 have the H read itself
 * past the end of the 33,980-byte SMDLDATA block, and those rows are `null`.
 *
 * Nothing here decides whether the shot produces a picture — that is `faceBoxDraws`, and it is
 * the console's own arithmetic, not a judgement about the record.
 */
export function faceBoxShot(record, side) {
  // The group rule and the shot read are the port's (engine/dw3/battle-camera.ts,
  // FIGHTSTG_F0x80091c1c / faceBoxShotFromRows): this adapter only hands the parsed
  // placement rows over, so no caller can pick a different group.
  return faceBoxShotFromRows(record?.face_box, side === "enemy" ? "enemy" : "player");
}

/**
 * Whether this shot can put a picture in the box — i.e. whether the console's projection
 * distance is one.
 *
 * Nothing between the record and the GTE tests it: F0x80091b8c hands self+0x78 straight to the
 * view (fightstg.s:153bf0/153bf4), F0x8001e404 stores it at view+0x88 (exe/fns.s:157410), and
 * the view's per-frame +0x158 writes it into the GTE with the single instruction
 * `ctc2 $a0, 26` (F0x8001e470 exe/fns.s:157480 -> F0x8002998c -> F0x8002b40c exe/fns.s:29902).
 * The same view method carries the main battle camera's focal distance
 * (FIGHTSTG_F0x80092158, fightstg.s:157bc-157cc), so that register is the game's projection
 * distance. There is no SetGeomScreen and no BIOS call on this path, and no branch anywhere on
 * the value.
 *
 * With H == 0 the PS1's RotTransPers scale factor is ((H*0x20000/SZ3)+1)/2 = 0, so every
 * vertex of every polygon submitted to that view lands on the same screen point — the drawing
 * offset, which this game adds to a point's own window centre (FIGHTSTG_F0x80083854,
 * fightstg.s:838dc-83920) — and a triangle whose three vertices coincide has no area, so the
 * GPU rasterises nothing. A negative H is the same read with the 16-bit register's high bit
 * set: the divide saturates and the coordinate leaves the +/-1024 range the GPU renders. Either
 * way the box's view contributes no pixel, and because that view has no background colour of
 * its own (the box driver never calls +0x12C and the view constructor never writes view+0x18,
 * and F0x800266b4 skips the fill when the flag is clear, exe/fns.s:24595-24601) the window is
 * left showing the battle view's own picture.
 */
export function faceBoxDraws(shot) {
  return !!shot && shot.H > 0;
}

/**
 * Which model record the close-up box reads, and which of its two shots it takes.
 *
 * This is the whole rule, in one place, so no caller can pick the record from the speaker:
 * the box's subject is the PLAYER's fighter (fighter slot 0 of the battle manager, whose
 * record the original reaches by one lookup at fightstg.s:17819-17829 and whose model key
 * that record carries at +0x14), and `side` only selects group 6 (player line) or group 7
 * (enemy line). See the section comment above for the read.
 *
 * `playerModelKey` is the model key of the player's active Digimon — the numeric prefix of
 * its pack folder, the number `modelKeyFromFolder` returns. `side` is the speaker's side.
 */
export function faceBoxSource(placementTable, playerModelKey, side) {
  const s = side === "enemy" ? "enemy" : "player";
  const key = playerModelKey == null ? null : String(playerModelKey);
  const record = (key != null && placementTable) ? (placementTable[key] ?? null) : null;
  return { key, record, side: s, group: FACE_BOX_GROUPS[s], shot: faceBoxShot(record, s) };
}

/** The box window's own vertical field of view, from the projection distance H. */
export function faceBoxFovY(H, screenH = FACE_BOX_RECT.h) {
  return 2 * Math.atan((screenH / 2) / H) * 180 / Math.PI;
}

/** The box window's aspect ratio. Not the screen's: the window is 100x60, not 320x240. */
export const FACE_BOX_ASPECT = FACE_BOX_RECT.w / FACE_BOX_RECT.h;

/** The look-at F0x8002a1ac builds from a face-box shot, as a render-space view matrix. */
export function faceBoxView(shot) {
  // The render-space CLOSED FORM of the console's look-at — the same basis the port's
  // lookAtView builds (the ledger's own shader: F0x8002a1ac is a standard look-at,
  // data-confirmed to ~0.3 deg), on the renderer's axes and units. Kept as the
  // renderer's helper so the drawn framing is byte-for-byte what it was.
  return buildView(shot.eye, shot.target);
}

/**
 * The console's own view matrix for a face-box shot — the port's output
 * (F0x80091b8c -> F0x8002a1ac), a PS1 MATRIX (9 signed-16 rotation halves and a
 * 32-bit translation). This is what the emulator would hand the GTE; faceBoxView
 * above is the render-space equivalent the walker actually draws with.
 */
export function faceBoxPs1View(shot) {
  const built = faceBoxLookAt(shot);
  return built ? built.view : null;
}

// ── The face-box worker (FIGHTSTG_F0x80091cf4 / F0x80091dac) ─────────────────
// The per-tick state machine and the allocation, straight from the port. The
// browser's box driver supplies the console services (+0x38, +0x40, the 0x1009
// layer lookup) and the record bytes; nothing here re-implements the worker.
export { faceBoxTick as faceBoxWorkerTick, faceBoxSpawn as faceBoxWorkerSpawn,
  faceBoxShotRead as faceBoxShotBytes, FACE_BOX_LAYER_KEY, FACE_BOX_TICK, FACE_BOX_WORKER_SIZE };

/**
 * What the close-up box draws, and in what order.
 *
 * The box is not a portrait card with a head pasted on it. In the original it is a whole 3D
 * view: the box driver writes the rectangle 208,76,100,60 and registers layer key 0x1009
 * with it (fightstg.s:17774-17781), sets the window's centre to 258,106 with +0x118
 * (:17795), and gives that view an ordering table of 50 entries with +0x148 (:17800) —
 * `+0x148` is F0x8001e1e8, which stores the count at `view+0x78` and allocates count*20
 * bytes, so 0x32 is the table's DEPTH, not a half-width; the window's size comes from the
 * rectangle alone. The console's render pass then walks all 30 views and, for each one that
 * is enabled, pushes its projection distance (`+0x158`, F0x8001e470, which is the GTE
 * register 26 write) and RUNS that view's own ordering table (`+0x154`, F0x8001e38c, which
 * walks the depth-sorted list and calls each submitted entry). Box and battle view are two
 * separate views with two separate tables, so the box is a second view of the SAME scene.
 *
 * That is what the reference frame shows, and it is why the backdrop is in here rather than
 * being an invention: docs/research/battle/captures/face-box-rounds-2026-10-03/
 * 1-round1-menu-box-up.png has the battle stage's cloud sky across the top third of the box
 * and its grass floor and far cliff below the head, with the horizon where the box
 * camera's own projection puts it (game y 94-95; see the projection check in
 * tests/battle-face-box-camera.test.js). The picture request that turns the box on is
 * written into the PLAYER's fighter record as `+0x40 = 1`, `+0x44 = 0x1009`, `+0x48 = 0`
 * (fightstg.s:17824-17827; the same three fields with key 0x1003 at :18068-18076).
 *
 * So the box draws the stage objects the battle view already has — the walker's sky quad
 * and its arena floor — through the BOX camera, and then the head. Nothing is loaded twice:
 * these are the buffers and textures render() already built for the main view.
 *
 * `backdropOnly` is the battle view's own rule, not a new one: while a special attack has
 * replaced the arena with its backdrop the floor is not drawn and the background is the flat
 * void (web/battle3d.js, the sky/floor block of render()). The box follows it rather than
 * keeping a floor the main view no longer has.
 *
 * `mvp` says which projection an item goes through: "identity" for the screen-space sky
 * quad, which covers whatever viewport it is drawn into, and "box" for everything in the
 * world, which must go through the record's own shot.
 *
 * `draws` is the record's own projection distance, and the list is EMPTY when it is not one.
 * The console submits the same stage and the same fighter into that view whatever H is — it
 * tests nothing — and then projects them all through the GTE, so with H <= 0 every one of
 * those vertices lands on the same point and no triangle has any area to fill. The stage goes
 * with them: in the original the sky and the ground in this window are scene geometry in the
 * same view, not a screen-space card (see
 * docs/research/battle/battle-stage-backdrop-decode-2026-10-04.md section 1, which rules a
 * clip-space quad out because the ground occludes the sky in the capture). So this walker's
 * clip-space sky quad is dropped too, rather than being the one thing that survives a
 * projection the console never had. See `faceBoxDraws`.
 */
export function faceBoxScene({ backdropOnly = false, draws = true } = {}) {
  if (!draws) return [];
  const scene = [{
    what: "sky", mvp: "identity",
    tex: backdropOnly ? "void" : "sky",
    tint: backdropOnly ? [0, 0, 0, 1] : [1, 1, 1, 1],
  }];
  if (!backdropOnly) scene.push({ what: "floor", mvp: "box" });
  scene.push({ what: "subject", mvp: "box" });
  return scene;
}

// ── The +0x24 angle triple ──────────────────────────────────────────────────
// F0x8002b65c is libgte RotMatrixYXZ. Its sin/cos table D0x80056a28 is indexed with
// (|angle| * 4) & 0x3ffc, i.e. 4096 entries, so ONE FULL TURN = 4096 units; the low halfword of
// an entry is the odd term (it is the one conditionally negated for a negative angle at
// .L0x8002b6d0-.L0x8002b6e8), so low = sin and high = cos.
export const ROT_UNIT = 4096;

const s16 = (v) => ((v | 0) << 16) >> 16;          // the record stores the angles with `sh`,
                                                    // and RotMatrix reads them back with `lh`.
/** The `lhu`/`subu`/`sh`/`lhu` round trip of the interpolator: every field is 16 bits wide and
 *  the subtraction wraps before it is read back signed. */
const wrap16 = (v) => (v << 16) >> 16;

/**
 * R = Ry(vy) . Rx(vx) . Rz(vz), row-major 3x3 — the exact matrix F0x8002b65c writes.
 * Every element below was read off the store sites rather than assumed from the libgte name:
 *   m[0][0]/m[0][1] .L0x8002b820, m[0][2]/m[1][0] .L0x8002b838, m[1][1]/m[1][2] .L0x8002b7fc,
 *   m[2][2] .L0x8002b794. (The original works in 1/4096 fixed point and truncates each product
 *   with `sra 0xc`; this uses doubles, so it differs from the console by well under one unit.)
 */
export function rotMatrixYXZ(vx, vy, vz) {
  const k = 2 * Math.PI / ROT_UNIT;
  const a = s16(vx) * k, b = s16(vy) * k, c = s16(vz) * k;
  const sA = Math.sin(a), cA = Math.cos(a);
  const sB = Math.sin(b), cB = Math.cos(b);
  const sC = Math.sin(c), cC = Math.cos(c);
  return [
    [cB*cC + sB*sA*sC,  -cB*sC + sB*sA*cC,  sB*cA],
    [cA*sC,              cA*cC,            -sA   ],
    [-sB*cC + cB*sA*sC,  sB*sC + cB*sA*cC,  cB*cA],
  ];
}

/** M . v for the row-major 3x3 above. */
export function rotApply(m, v) {
  return [
    m[0][0]*v[0] + m[0][1]*v[1] + m[0][2]*v[2],
    m[1][0]*v[0] + m[1][1]*v[1] + m[1][2]*v[2],
    m[2][0]*v[0] + m[2][1]*v[1] + m[2][2]*v[2],
  ];
}

// PS1 screen Y runs DOWN, so the up vector of an unrotated shot is -Y in this frame (battle3d
// negates Y again on its way to render space, where up is +Y).
export const PS1_UP = [0, -1, 0];

// ── The roll word at +0x2c ──────────────────────────────────────────────────
// It is in DEGREES, not in the 4096-unit angle the +0x24 triple uses. F0x80091df4 shifts it left
// 12 and hands it to F0x8002a1ac as argument field +0x18; F0x8002a1ac negates it into F0x8002a7cc
// (.L0x8002a220-.L0x8002a22c), and F0x8002a7cc divides by 360 (the magic multiply by 0xb60b60b7
// at .L0x8002a7d8-.L0x8002a804) before indexing the 4096-unit cos/sin tables F0x8002ac9c /
// F0x8002abcc. (roll << 12) / 360 == roll * 4096/360, so the field is degrees.
//
// The matrix it builds (.L0x8002a82c-.L0x8002a854) is a pure Z rotation, and MulMatrix
// F0x8002afbc computes m0 = m0 x m1, so it PRE-multiplies the pitch/yaw look-at:
//   V.R = Rz(roll) . Rx(pitch) . Ry(yaw),  Rz(roll) = [[cos,sin,0],[-sin,cos,0],[0,0,1]].
// That is a rotation of the finished SCREEN, which is why it is applied here as a turn of the up
// vector rather than as another world rotation.
//
// SIGN. Working in screen terms avoids the PS1/render handedness bookkeeping entirely. On the
// PS1, screen v runs DOWN, and Rz(roll) sends (u,v) to (cos.u + sin.v, -sin.u + cos.v). The
// renderer's screen w runs UP (w = -v), so the same map reads w' = sin.u + cos.w. Turning a
// look-at's up vector about its backward axis by phi instead gives u' = cos.u + sin.w and
// w' = -sin.u + cos.w. Matching the two needs sin(phi) = -sin(roll), so the renderer applies
// MINUS the roll. This relies only on the un-rolled framing already agreeing between the 3D
// layer and the 2D screen-space effect layer, which the 19 px effect alignment measures.
export const ROLL_IS_DEGREES = true;

/** Rodrigues: turn `v` about unit-ish `axis` by `rad` (right-hand rule). */
export function rotateAboutAxis(v, axis, rad) {
  const k = norm3(axis), c = Math.cos(rad), s = Math.sin(rad);
  const kv = dot3(k, v), kxv = cross3(k, v);
  return [
    v[0]*c + kxv[0]*s + k[0]*kv*(1 - c),
    v[1]*c + kxv[1]*s + k[1]*kv*(1 - c),
    v[2]*c + kxv[2]*s + k[2]*kv*(1 - c),
  ];
}

/**
 * Apply a shot's +0x2c roll to a RENDER-space (screen-up) look-at basis: turn `up` about the
 * backward axis eye-target by MINUS the roll, per the sign derivation above. rollDeg = 0 returns
 * `up` untouched, so every shot that authors no roll is bit-identical to before.
 */
export function applyScreenRoll(up, eye, target, rollDeg) {
  if (!rollDeg) return up;
  return rotateAboutAxis(up, sub3(eye, target), -rollRadians(rollDeg));
}

/**
 * Degrees -> radians THROUGH the original's integer angle, so the port lands on the same angle the
 * console does. F0x8002a7cc divides (roll << 12) by 360 with a truncating signed division and then
 * indexes a 4096-unit table, so roll 15 becomes 170 units = 14.941 deg, not 15. What is NOT
 * reproduced is the table's own 1/4096 fixed-point rounding of the sine, worth about 0.014 deg.
 */
export function rollRadians(rollDeg) {
  const units = Math.trunc((rollDeg * ROT_UNIT) / 360);
  return units * 2 * Math.PI / ROT_UNIT;
}

/**
 * Compose one op5 record (the 14-field layout above) into a world-space shot.
 *
 * This is the whole of what the original's view builder does with the record, in one place, so
 * that a camera MOVE can be produced the way the original produces it: interpolate the RECORD,
 * then compose — never interpolate the composed result. The difference is not cosmetic. When a
 * move changes the +0x24 angles, composing per frame swings the eye around the anchor on an ARC
 * at constant radius, which is what an authored 180-degree yaw means; interpolating the finished
 * world position instead cuts the chord straight through the fighter.
 */
export function composeShot(fields) {
  const anchor = [fields[6], fields[7], fields[8]];
  const angles = [s16(fields[9]), s16(fields[10]), s16(fields[11])];
  // W = T(anchor) . R(angles) is the shot's own coordinate frame; eye/target are stated inside
  // it. R is the identity for a shot that authors no angles, so this reduces to the anchor add.
  const R = (angles[0] || angles[1] || angles[2]) ? rotMatrixYXZ(...angles) : null;
  const place = (v) => {
    const p = R ? rotApply(R, v) : v;
    return [p[0] + anchor[0], p[1] + anchor[1], p[2] + anchor[2]];
  };
  return {
    fields,
    anchor,
    angles,
    eye:    place([fields[0], fields[1], fields[2]]),
    target: place([fields[3], fields[4], fields[5]]),
    // The angle frame turns the camera's up vector with it, so a shot with a non-zero vz or vx
    // tilts the horizon. Consumers must feed this to the look-at instead of a constant up.
    up:     R ? rotApply(R, PS1_UP) : PS1_UP.slice(),
    roll:   fields[12],
    H:      fields[13],
  };
}

/**
 * Interpolate one record toward another, the way FIGHTSTG_F0x80091df4 does — component by
 * component, as SIGNED 16-BIT values, in the ORIGINAL'S INTEGER ARITHMETIC.
 *
 * The interpolator is FIGHTSTG_F0x800a1e8c (fightstg.s:32482-32571), called five times per
 * tweened frame with (from, to, t, out):
 *
 *   lhu/subu/sh/lhu   .L0x800a1e94-.L0x800a1ecc   v = the 16-bit WRAPPED difference to - from
 *   mtc2 t, 0x8                                  the 0..0x1000 accumulator, 4.12
 *   mtc2 v, 0x9/0xa/0xb                           the three differences
 *   c2 0x198003d                                  three signed 4.12 products
 *   sh / lhu / addu / lh  .L0x800a1f18-.L0x800a1f68   out = from + the products, re-signed
 *
 * So each component is `wrap16(from + floor(t * wrap16(to - from) / 4096))`, and the shift
 * is an ARITHMETIC one: a falling component truncates DOWN, never toward zero. Both matter:
 * the DNA staging glide's eye Z falls, and the console's live block at t=39 reads -23059, which
 * is -23040 + floor(39 * -1967 / 4096) and not the -23058 a truncating divide would give.
 *
 * A float lerp is not merely a rounding difference here. The accumulator lands on 13 * 310 =
 * 4030 before the reveal glide replaces it, and 7168 + 5107 * 4030/4096 = 12192.66 float against
 * the console's 12192 — so a float port reads the camera half a unit past it at every frame of
 * the tween, and hands the NEXT glide a start block the console never had.
 *
 * `t` runs 0..1 here (the original's 0..0x1000 accumulator); it is taken back to that integer
 * scale, which is exact for every caller that divides the accumulator by 0x1000.
 */
export function lerpFields(from, to, t) {
  const acc = Math.round(t * 0x1000);
  const out = new Array(14);
  for (let i = 0; i < 14; i++) {
    const a = s16(from[i]);
    const d = s16(wrap16(s16(to[i]) - a));
    out[i] = s16(a + wrap16(Math.floor(acc * d / 0x1000)));
  }
  return out;
}

// ── The op5 glide's clock (FIGHTSTG_F0x800922b4 arms it, F0x80091df4 runs it) ───
//
// `F0x800922b4` stores `0x100000 / duration` at cam+0xf4 with a signed truncating division
// (`lui $v0,0x10` / `div $zr,$v0,$a3` / `mflo`, fightstg.s .L0x80092378-.L0x80092390) and zeroes
// the accumulator cam+0xf0. The updater then adds `((cam+0xf4) >> 8) * delta` per frame
// (fightstg.s .L0x80091ebc `sra $v1,0x8` / .L0x80091ec8 `mult $v1,$v0` / .L0x80091ed4 `addu $s4`),
// where `delta` is the RAW per-frame delta read through the pointer at 0x8004df9c — the same word
// the op11 wait decrements (FIGHTSTG_F0x8008c220 .L0x8008c26c/.L0x8008c284) and the same word the
// defeat orbit reads (.L0x8008cad4). It is 1 a frame, so a glide lasts D frames and the `>> 8`
// truncation makes it land a few frames AFTER D, never before. Past 0x1000 the updater copies the
// target block into the live one and parks t at 0x1000 (.L0x800920bc-.L0x800920f8).
//
// The camera is therefore NOT on the battle's slow-motion clock: 0x800a4464 is what the animation
// and op2 slot-motion timers read, and the tween never touches it.
export const CAMERA_FRAME_DELTA = 1;

/** cam+0xf4: the per-frame step the updater shifts right by 8 before adding. */
export function op5GlideRate(duration) {
  const D = duration | 0;
  return D ? (Math.trunc(0x100000 / D) >> 8) : 0x1000;
}

/** One frame of the tween: `t += rate * delta`, clamped at 0x1000. `delta` is the raw
 *  per-frame delta, NOT the walker's slow-motion-published animation delta. */
export function op5GlideT(t, rate, delta) {
  return Math.min(0x1000, (t | 0) + rate * delta);
}

/** How many frames of `delta` the glide actually takes for `duration`. */
export function op5GlideFrames(duration, delta = CAMERA_FRAME_DELTA) {
  const r = op5GlideRate(duration);
  let t = 0, n = 0;
  while (t < 0x1000 && n < 1e6) { t = op5GlideT(t, r, delta); n++; }
  return n;
}

export function applyOp5(camState, op5rec) {
  const w = op5rec.words || [];
  const n0 = (v) => (v === 0 ? 0 : v);   // normalize -0
  if (w[1] === 1) {
    const fields = [
      n0(w[2]),  n0(-w[3]),  n0(-w[4]),    // 0x00, 0x04, 0x08  (eye)
      n0(w[5]),  n0(-w[6]),  n0(-w[7]),    // 0x0c, 0x10, 0x14  (target)
      n0(w[8]),  n0(-w[9]),  n0(-w[10]),   // 0x18, 0x1c, 0x20
      n0(w[11]), n0(-w[12]), n0(-w[13]),   // 0x24, 0x26, 0x28
      n0(w[14]), n0(w[15]),                // 0x2c, 0x30        (H = w15)
    ];
    camState.op5 = { mode: w[0], ...composeShot(fields) };
  } else if (w[1] === 0) {
    camState.op5 = { mode: w[0], preset: w[2] };
  }
  return camState;
}

// ── The idle camera's director is NOT here ───────────────────────────────────
// It was, from 2026-07-06 until 2026-10-04: a weighted-random pick over five hand-typed
// shots with a dwell drawn from a band tuned to a 134 s RAM poll. That was a stand-in for the
// original's data table, and the table is static data in the disc. The director now lives in
// web/fight/battle-idle-director.js, which is the port of FIGHTSTG_F0x8008718c: the four
// fixed shot lists at 0x800a24b8, the three-byte-per-row walk at 0x800a2518 driven by one
// `rand_u16() % 3`, the dwell in raw per-frame deltas, and the ten sub-state arms that turn
// the held shot about the arena origin. This file keeps the camera RECORD — the one live
// 14-word record, its cut / move / canned-shot / arena writers and the view builder.

// ── THE battle camera record ────────────────────────────────────────────────────
//
// The original's camera object — class 0x12, built by FIGHTSTG_F0x80092618
// (fightstg.s:16017-16045), whose slots +0xf8..+0x104 are the cut, the move, the arena shot
// and the canned-shot loader — holds ONE live record: 14 words at object+0x54 (eye, target,
// anchor, three frame angles, roll, H), with the target block at +0x88, the start block at
// +0xbc, the 0..0x1000 accumulator at +0xf0 and the per-frame step at +0xf4
// (FIGHTSTG_F0x80091df4 :15481-15758).
//
// The installers fill a staging block — the global at 0x800a46d8 — and hand it over, and they
// are the only things that write the record:
//
//   cut    [0xf8]  F0x80092244 :15760-15789  copy the block to +0x54, park t at 0x1000
//   move   [0xfc]  F0x800922b4 :15791-15856  start block = the LIVE record (a1 == 0),
//                                                target block = the staging block,
//                                                +0xf4 = 0x100000/duration, +0xf0 = 0
//   canned [0x104] F0x800923b4 :15858-15973  eye/target/H from the acting Digimon's own shot
//                                                table, then +0x18..+0x2c ZEROED (:15952-15961)
//                                                so the shot is absolute
//   arena  [0x100] F0x8009257c :15975-16015  the far side's record picks the near side's shot
//
// Nothing clears it. No writer zeroes +0x54, and no "the script ended" path touches the camera
// object at all: the op5 handler (F0x8008c004) and the loss effect (F0x8008c93c .L0x8008c988 /
// .L0x8008cad4, which re-applies its record through [0xf8] every frame) are the only two
// callers of a camera slot outside the director's own re-cut, and every one of them REPLACES
// the record. So the record's life is: it lives until another cut, move or canned shot
// replaces it. There is no expiry, which is why this owner has no `clear()` and nothing in the
// port may add one.
//
// `resolvePreset(presetId)` reads a canned shot out of the acting Digimon's own record; it is
// late-bound because the placement table can land after the op5 that named the shot.
export function fieldsFromShot(shot) {
  // The record a composed shot installs: eye, target, H, and NOTHING else — the anchor, the
  // three angles and the roll stay zeroed exactly as the canned-shot loader leaves them
  // (F0x800923b4 .L0x80092530-.L0x80092548), so the shot is absolute about the arena origin.
  return [
    shot.eye[0] | 0, shot.eye[1] | 0, shot.eye[2] | 0,
    shot.target[0] | 0, shot.target[1] | 0, shot.target[2] | 0,
    0, 0, 0,                            // +0x18 anchor
    0, 0, 0,                            // +0x24/+0x26/+0x28 frame angles
    shot.roll | 0,                      // +0x2c roll
    shot.H | 0,                         // +0x30 projection distance
  ];
}

/**
 * Did `rec` get installed by the action running on `vm` for `side`?
 *
 * The camera object holds ONE record and `issuer` names only a SIDE, so the record keeps that
 * label after the action that set it ends. A test that asks "did the attacker frame its own
 * strike?" with the side label alone therefore reads a PREVIOUS action's shot as the current
 * one — the case that made an attack skip its impact camera and leave the shot where it was.
 * `issuerVm` is the live action VM tagged onto every op5 install (`web/battle3d.js _camHookFor`),
 * so identity — not the sticky label — answers the question.
 */
export function cameraOwnedByAction(rec, side, vm) {
  return !!rec && rec.issuer === side && !!vm && rec.issuerVm === vm;
}

export function createCameraRecord(resolvePreset) {
  let rec = null;
  // The authored op5 LIST a clip runs, in order (see `sequence`). `pending` holds the entries
  // not yet armed; `seqMeta` is the installer tag every entry of the run carries.
  let pending = [];
  let seqMeta = {};

  const owner = {
    get: () => rec,

    // F0x80092244, the cut: the staging block becomes the live record and the tween parks at
    // 0x1000, so the next frame composes this record rather than moving toward it.
    cut(fields, meta) {
      rec = { kind: "cut", fields, ...meta };
      return rec;
    },

    // F0x800922b4, the move: the start block is the LIVE record unless the caller names
    // another, the target block is the staging block, and t starts at 0.
    move(toFields, duration, meta) {
      const D = duration | 0;
      rec = {
        kind: "move",
        fromFields: owner.live() || toFields,
        toFields,
        duration: D,
        progress: 0,
        rate: op5GlideRate(D),
        ...meta,
      };
      return rec;
    },

    // F0x800923b4, the canned shot: resolved late, because the model's own shot table can land
    // after the op5 that named the index.
    //
    // `meta.duration` is op5's operand 0 (see applyOp5): the op5 handler applies its staged block
    // through [0xf8] (the cut) when it is 0 and through [0xfc] (the move, F0x800922b4) over that
    // many frames when it is not — for the PRESET arm exactly as for the explicit-transform arm
    // (F0x8008c004 .L0x8008c1cc: `beqz $s3` → cut, else `a3 = $s3` into the move). So a preset
    // with a duration GLIDES from the live record to the resolved canned shot; without one it
    // cuts. The start block is the live record at the moment the move is armed, as F0x800922b4
    // takes it when the caller's `a1` is null.
    preset(presetId, meta) {
      const m = meta || {};
      const D = m.duration | 0;
      rec = D > 0
        ? { kind: "preset", preset: presetId | 0, ...m,
            fromFields: owner.live(), duration: D, progress: 0, rate: op5GlideRate(D) }
        : { kind: "preset", preset: presetId | 0, ...m };
      return rec;
    },

    // The authored op5 LIST a clip runs, IN ORDER — the disc executes each op5 as its script
    // reaches it (FIGHTSTG_F0x8008c004's only caller is the opcode dispatcher's op5 arm), and a
    // clip like the near-side packs' clip 10 authors a PAIR: the impact shot `op5[60,0,3]` and
    // later the restore `op5[60,0,0]`. This arms the whole run rather than one picked entry.
    //
    // Entry 0 arms now, from the live record; each later entry arms when the previous glide
    // reaches 0x1000. Every op5 starts its glide from the camera's CURRENT record — the handler
    // always passes a1 = 0 (fightstg.s:9498-9505) and the installer copies object+0x54 into the
    // start block when it does (fightstg.s:15812-15828) — so the restore glides back from the
    // impact shot it replaced, exactly as the outward glide left it.
    //
    // A spec is `{ preset, duration }` (the preset arm) or `{ fields, duration }` (a shot whose
    // record is not a preset, e.g. preset 0's arena/default battle cam). A duration of 0 cuts.
    sequence(specs, meta) {
      pending = (specs || []).filter(Boolean).slice();
      seqMeta = meta || {};
      if (pending.length) drain();
      return rec;
    },

    // Is a script-armed glide still running? While true the record is being driven by the op5
    // run, so the battle's own camera must not re-cut over it (battle3d's script-owned
    // arbitration ORs this in). False once the last glide lands.
    isGliding() {
      return !!(rec && rec.duration && rec.progress < 0x1000);
    },

    // F0x80091df4's per-frame step, on the RAW delta through 0x8004df9c. It advances the move's
    // accumulator AND a preset glide's — both are the same [0xfc] move on the console.
    tick(delta) {
      if (rec?.duration && rec.progress < 0x1000) {
        rec.progress = op5GlideT(rec.progress, rec.rate, delta);
        // The clip's playback moves on: the next authored op5 arms from the shot just reached.
        if (rec.progress >= 0x1000 && pending.length) drain();
      }
      return rec;
    },

    /** The live record: what the frame draws, and what a move starts from. */
    live() {
      if (!rec) return null;
      if (rec.kind === "move") {
        return rec.progress >= 0x1000
          ? rec.toFields
          : lerpFields(rec.fromFields, rec.toFields, rec.progress / 0x1000);
      }
      if (rec.kind === "preset") {
        const shot = resolvePreset?.(rec.preset);
        if (!shot) return null;
        const to = fieldsFromShot(shot);
        // A preset glide (op5 operand 0 != 0) tweens the live record toward the resolved shot,
        // exactly as the move branch below does; at progress 0 it still IS the start record.
        if (rec.duration && rec.progress < 0x1000) {
          const from = rec.fromFields || to;
          return lerpFields(from, to, rec.progress / 0x1000);
        }
        return to;
      }
      return rec.fields;
    },

    /** The composed shot, or null while a canned shot's own record has not loaded yet. */
    sample() {
      const fields = owner.live();
      return fields ? composeShot(fields) : null;
    },
  };

  // Arm one authored op5 entry. `fields` (when present) is a shot record the caller resolved
  // itself — the arena/default battle cam of preset 0 — and goes through the same cut/move the
  // op5 handler uses; otherwise the entry is a preset and resolves late through `resolvePreset`.
  function armSpec(spec) {
    if (spec.fields) {
      return (spec.duration | 0) > 0
        ? owner.move(spec.fields, spec.duration, seqMeta)
        : owner.cut(spec.fields, seqMeta);
    }
    return owner.preset(spec.preset, { ...seqMeta, duration: spec.duration | 0 });
  }

  // Arm entries in order, skipping past any that are instant cuts (they have no glide to wait
  // on), and stop as soon as a glide is running — the rest wait for their turn in `tick`.
  function drain() {
    let guard = 0;
    while (pending.length && guard++ < 64) {
      const spec = pending.shift();
      armSpec(spec);
      if (owner.isGliding()) return;
    }
  }

  return owner;
}
