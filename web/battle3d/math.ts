import { mat4Identity, mat4Scale } from "../fight/proj-layers.js";
import { patchCopyRect } from "../vendor/engine.js";
type Vec3Like = number[] | Float32Array;


// ─── Math helpers ─────────────────────────────────────────────────────────────

// mat4Identity / mat4Mul / mat4Translate / mat4Scale / mat4RotPSX now live in
// ./fight/proj-layers.js alongside the op6 layer solver that needs them, so the matrix
// convention is stated once. Same column-major layout as before.

export function mat4Perspective(fovY: number, aspect: number, near: number, far: number) {
  const f = 1.0 / Math.tan(fovY * 0.5);
  const nf = 1.0 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = (far + near) * nf; m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

export function mat4LookAt(eye: Vec3Like, center: Vec3Like, up: Vec3Like | undefined) {
  const z = normalize(sub3(eye, center));
  const x = normalize(cross3(up, z));
  const y = cross3(z, x);
  const m = new Float32Array(16);
  m[0]=x[0]; m[4]=x[1]; m[8]=x[2]; m[12]=-dot3(x,eye);
  m[1]=y[0]; m[5]=y[1]; m[9]=y[2]; m[13]=-dot3(y,eye);
  m[2]=z[0]; m[6]=z[1]; m[10]=z[2]; m[14]=-dot3(z,eye);
  m[15]=1;
  return m;
}

// Rotation about the Y axis (radians). Column-major, matching mat4Mul's convention.
export function mat4RotateY(a: number) {
  const c = Math.cos(a), s = Math.sin(a);
  const m = mat4Identity();
  m[0]=c; m[2]=-s; m[8]=s; m[10]=c;
  return m;
}

export function centroid3(pts) {
  let x=0,y=0,z=0;
  for (const [px,py,pz] of pts) { x+=px; y+=py; z+=pz; }
  const n = pts.length;
  return [x/n, y/n, z/n];
}

export function sub3(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }

export function cross3(a, b: number[]) { return [a[1]*b[2]!-a[2]*b[1]!, a[2]*b[0]!-a[0]*b[2]!, a[0]*b[1]!-a[1]*b[0]!]; }

export function dot3(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }

export function normalize(v) { const l = Math.sqrt(dot3(v,v)); return l<1e-6?[0,0,0]:[v[0]/l,v[1]/l,v[2]/l]; }

// mat3 multiply (column-major 9-element Float32Array)
function mat3Mul(a: Float32Array<ArrayBuffer>, b: Float32Array<ArrayBuffer>) {
  const o = new Float32Array(9);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++)
        o[c*3+r]! += a[k*3+r]! * b[c*3+k]!;
  return o;
}

// Convert PS1 angle units (4096 = 360°) to a bone rotation mat3.
// Verified against sstate1 dump (all 21 Renamon bones within 5 units, RMS 1.99).
// Call with ps1AnglesToMat3(c2[2], c2[1], c2[0]) — args are REVERSED from ch2 storage.
// Computes: Rz(ax) × Ry(ay) × Rx(az), column-major.
export function ps1AnglesToMat3(ax, ay, az) {
    const scale = (Math.PI * 2) / 4096;
    const cx = Math.cos(ax * scale), sx = Math.sin(ax * scale);
    const cy = Math.cos(ay * scale), sy = Math.sin(ay * scale);
    const cz = Math.cos(az * scale), sz = Math.sin(az * scale);

    const Rz = new Float32Array([cx, sx, 0, -sx, cx, 0, 0, 0, 1]);
    const Ry = new Float32Array([cy, 0, -sy,  0,  1, 0, sy, 0, cy]);
    const Rx = new Float32Array([1,  0,  0,   0, cz, sz, 0, -sz, cz]);

    return mat3Mul(Rz, mat3Mul(Ry, Rx));
}

// Embed mat3 into upper-left of mat4 (column-major)
function mat3ToMat4(m3) {
  const m4 = mat4Identity();
  m4[0]=m3[0]; m4[1]=m3[1]; m4[2]=m3[2];
  m4[4]=m3[3]; m4[5]=m3[4]; m4[6]=m3[5];
  m4[8]=m3[6]; m4[9]=m3[7]; m4[10]=m3[8];
  return m4;
}

// ─── THE PS1 battle world → render world mapping. There is exactly one. ───────
//
// The PS1 battle world is X right, Y DOWN, Z away from the viewer, and the console's view
// matrix takes screen-right as cross(+Y, forward) (docs/research/fight-3d/battle-camera.md §1),
// the left-handed-camera convention in which right × up is the AWAY-from-viewer axis. The
// renderer's look-at takes the opposite convention, cross(up, backward), where right × up points
// AT the viewer. The obvious Y-up translation (x·s, −y·s, z·s) is a REFLECTION (det −1), and a
// reflection mismatched with the other convention draws every battle point on the wrong side:
// the two differ by a sign, and the whole battle — models, cameras, effects, the face box, the
// DNA presentation — comes out mirrored.
//
// Negating Z as well makes the map diag(1, −1, −1): the 180° rotation about X. It preserves
// handedness, so the walker's view-matrix row 0 IS the console's row 0 and every shot frames
// the way the console frames it. Proof: docs/research/battle/captures/face-box-rounds-2026-10-03/
// 1-round1-menu-box-up.png — the enemy at the LEFT, our own Digimon at the lower RIGHT.
export const PS1_RENDER_SIGN = [1, -1, -1];

/** One PS1 battle coordinate → render world, scaled by `s`. The one mapping, in one place.
 *  Accepts an [x,y,z] triple or an {x,y,z} slot, because both spellings are in the data. */
export function ps1ToRender(p, s = 1) {
  const x = p[0] !== undefined ? p[0] : p.x;
  const y = p[1] !== undefined ? p[1] : p.y;
  const z = p[2] !== undefined ? p[2] : p.z;
  return [x * s, -y * s, -z * s];
}

/** The same mapping as a matrix, for the paths that transform a whole mesh by one. */
export function ps1ToRenderMatrix(s = 1) {
  return mat4Scale(s, -s, -s);
}

/** The inverse: render world back to the PS1 battle world, for a camera record. */
export function renderToPs1(p, s = 1) {
  const x = p[0] !== undefined ? p[0] : p.x;
  const y = p[1] !== undefined ? p[1] : p.y;
  const z = p[2] !== undefined ? p[2] : p.z;
  return [x / s, -y / s, -z / s];
}

// The battle display height of a Digimon, in render units (the billboard's and the camera's
// "how big is this thing" constant). Model scale is DIGI_H/400 PS1 units → render units.
export const MODEL_SCALE = 140 / 400;

/** Pack folder ("m003agum") -> smdldata key (3). The key IS the model number. */
// The baked texture page is one PS1 4bpp page: 256x256 texels. A record's patch
// coordinates are in 16-bit VRAM units against the fighter's 64-wide strip, so one
// unit is exactly four texels across and one row down.
export const TEXTURE_PAGE_TEXELS = 256;

export const TEXELS_PER_PATCH_UNIT = 4;

/**
 * The source/destination texel rectangle of one animated texture patch, built by the ported
 * FIGHTSTG_F0x8008B160 copy builder (engine/dw3/battle-presentation.ts `patchCopyRect`, the
 * descriptor the resident GP0(0x80) primitive builder is handed). The browser's texture page IS
 * the fighter's own 64x256 strip and model_placement.json's patch coordinates are already
 * strip-relative, so the copy's VRAM strip origin is zero; the port's rect is then scaled from
 * VRAM units into the page's texels (four texels across per unit, one row down).
 */
export function texturePatchRect(entry, scale: number) {
  const u = TEXELS_PER_PATCH_UNIT * scale;
  const variant = entry.src[entry.variant] ? entry.variant : 0;
  const r = patchCopyRect(entry, variant, 0, 0);
  return {
    x0: r.srcX * u, y0: r.srcY * scale,
    dx: r.dstX * u, dy: r.dstY * scale,
    w: r.width * u, h: r.height * scale,
  };
}
