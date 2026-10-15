/**
 * battle3d.js — WebGL 3D skeletal renderer for DW2003 fight models.
 *
 * Implements PS1 GTE FK chain (Algorithm B, confirmed at disassembly level
 * from FIGHTSTG_F0x80085110 2026-06-18): ch1=translation, ch2=rotation,
 * ch3=scale (4096=1.0, default identity). Per-bone vertex pools with
 * LERP bridge zones at joint boundaries.
 */

"use strict";

import { ActorAnimator } from "./fight/actor-animator.js";
import { applyOp5, fovYFromH, createCameraRecord, fieldsFromShot,
  applyScreenRoll, rotMatrixYXZ, rotApply, faceBoxSource, faceBoxDraws, faceBoxFovY,
  faceBoxScene, FACE_BOX_ASPECT, CAMERA_FRAME_DELTA } from "./fight/battle-camera.js";
import { createIdleDirector, createIdleClock, idleDirectorTick } from "./fight/battle-idle-director.js";
import { FightCoordinator } from "./fight/fight-coordinator.js";
import { setMoveSpeed } from "./fight/action-vm.js";
import { EffectPlayer, loadEffectAssets } from "./fight/effect-player.js";
import { setTechTable, techRecord, REACTION_HIT_CLIP, REACTION_DEATH_CLIP, REACTION_EVADE_CLIP, setItemUseEffects, itemUseEffect,
         setThrowItemEffects, throwItemEffect } from "./fight/fight-tables.js";
import { setFallbackDonor } from "./fight/clip-fallback.js";
import { TexturePatchAnimator } from "./fight/texture-patch-animator.js";
import { mat4Identity, mat4Mul, mat4Translate, mat4Scale, mat4RotPSX,
         projLayerWorlds, clipFrameAt, meshAbrMode } from "./fight/proj-layers.js";
import { meshPrimitiveStates } from "./fight/display-list.js";
import { fetchAsset, loadAssetImage } from "./assets.js";
// The slow-motion clock (engine/dw3/battle-slow-motion.ts, F0x8009e428 / F0x8009e510):
// the ordinary route now steps through the PORT, not a hand-written copy of it.
// The actor teardown (engine/dw3/battle-actor-lifecycle.ts, FIGHTSTG_F0x8008606c): the
// per-actor resource release below runs through the PORT, so the state guard and the
// per-resource zero test are the original's, not a hand-written `if (tex) delete`.
import { ui, arenaPlacement, patchCopyRect, ARENA_BASE_Z,
  slowMotionStep, setSlowMotion as engineSetSlowMotion,
  SLOW_MO_PUBLISH_AT, SLOW_MO_ACCUM_COST,
  actorTeardown, ACTOR_RES_OFFSETS, ACTOR_TEARDOWN_STATE,
  RAND_U16,
  createBattleOpenCamera } from "./vendor/engine.js";
const { createBattleFaceBox, battleFaceBoxVisible } = ui;

// ─── Shader sources ───────────────────────────────────────────────────────────

const VERT_SRC = `
attribute vec3 aPos;
attribute vec2 aUV;
uniform mat4 uMVP;
varying vec2 vUV;
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  vUV = aUV;
}`;

const FRAG_SRC = `
precision mediump float;
uniform sampler2D uTex;
uniform float uAlpha;
uniform vec4 uTint;
varying vec2 vUV;
void main() {
  vec4 c = texture2D(uTex, vUV) * uTint;
  c.a *= uAlpha;
  if (c.a < 0.05) discard;
  gl_FragColor = c;
}`;

const VERT_COL_SRC = `
attribute vec3 aPos;
attribute vec4 aColor;
uniform mat4 uMVP;
varying vec4 vColor;
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  vColor = aColor;
}`;

const FRAG_COL_SRC = `
precision mediump float;
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
}`;

// ─── Math helpers ─────────────────────────────────────────────────────────────

// mat4Identity / mat4Mul / mat4Translate / mat4Scale / mat4RotPSX now live in
// ./fight/proj-layers.js alongside the op6 layer solver that needs them, so the matrix
// convention is stated once. Same column-major layout as before.

function mat4Perspective(fovY, aspect, near, far) {
  const f = 1.0 / Math.tan(fovY * 0.5);
  const nf = 1.0 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = (far + near) * nf; m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

function mat4LookAt(eye, center, up) {
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
function mat4RotateY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const m = mat4Identity();
  m[0]=c; m[2]=-s; m[8]=s; m[10]=c;
  return m;
}

// op5 sub=0 camera presets — CAPTURED LIVE from the game (2026-07-06, Renamon-vs-Woodmon
// savestate, RAM read of the fight camera-preset tables via the op5 handler F0x8008c004 →
// m104 F0x800923b4). Values are the final camera-struct fields (eye/target in PS1 world,
// Y-down; H = GTE projection distance / zoom). Dispatch: preset 0 = reset to default (null
// here — render falls back to the default battle cam); presets 1-4 = mode-0 table idx 8-11;
// presets 5-7 = mode-0x10 table idx 0-2. preset 5 validated against a Diamond Storm live
// capture.
//
// These seven shots are NOT global: they are Renamon's near-side shots 8-11 and Woodmon's
// far-side shots 0-2, because that is the fight they were captured from. Every Digimon
// carries its own table in smdldata (claim
// fight-camera-canned-shots-are-per-model-smdldata-arrays-2026-08-18), extracted to
// model_placement.json and used by cannedShot() below; all 21 numbers here are reproduced
// byte-for-byte by that extraction, which is what validates it. This table remains only as
// the fallback for a model whose record has not loaded.
// Full decode: docs/research/fight-3d/battle-camera.md.
export const OP5_PRESETS = {
  1: { eye: [-1216, -1152, -1408], target: [128, -1280, -5696], H: 280 },
  2: { eye: [0, -1408, -2048],     target: [0, -1088, -5696],   H: 280 },
  3: { eye: [0, -384, -1856],      target: [0, -1408, -6208],   H: 280 },
  4: { eye: [0, -4096, -3072],     target: [0, -512, -5056],    H: 280 },
  5: { eye: [-3840, -2432, 512],   target: [0, -2048, 5888],    H: 280 },
  6: { eye: [0, -2432, -384],      target: [0, -2048, 5888],    H: 280 },
  7: { eye: [0, -1280, -384],      target: [0, -2048, 5888],    H: 280 },
};

function centroid3(pts) {
  let x=0,y=0,z=0;
  for (const [px,py,pz] of pts) { x+=px; y+=py; z+=pz; }
  const n = pts.length;
  return [x/n, y/n, z/n];
}

function sub3(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function cross3(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function dot3(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function normalize(v) { const l = Math.sqrt(dot3(v,v)); return l<1e-6?[0,0,0]:[v[0]/l,v[1]/l,v[2]/l]; }

// mat3 multiply (column-major 9-element Float32Array)
function mat3Mul(a, b) {
  const o = new Float32Array(9);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++)
        o[c*3+r] += a[k*3+r] * b[c*3+k];
  return o;
}

// Convert PS1 angle units (4096 = 360°) to a bone rotation mat3.
// Verified against sstate1 dump (all 21 Renamon bones within 5 units, RMS 1.99).
// Call with ps1AnglesToMat3(c2[2], c2[1], c2[0]) — args are REVERSED from ch2 storage.
// Computes: Rz(ax) × Ry(ay) × Rx(az), column-major.
function ps1AnglesToMat3(ax, ay, az) {
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

// ─── Skeletal animation helpers ───────────────────────────────────────────────

// Interpolate a keyframe channel at the given frame number.
// channel: array of [x,y,z,frame] records. Sentinel frame=30000.
// Returns [x,y,z] linearly interpolated.
function interpChannel(channel, frame) {
  if (!channel || channel.length === 0) return [0, 0, 0];
  // Find surrounding keyframes
  let lo = channel[0], hi = channel[0];
  for (let i = 0; i < channel.length; i++) {
    if (channel[i][3] === 30000) break;
    if (channel[i][3] <= frame) lo = channel[i];
    else { hi = channel[i]; break; }
  }
  if (lo === hi || hi[3] === 30000 || hi[3] <= lo[3]) return [lo[0], lo[1], lo[2]];
  const t = (frame - lo[3]) / (hi[3] - lo[3]);
  return [
    lo[0] + t * (hi[0] - lo[0]),
    lo[1] + t * (hi[1] - lo[1]),
    lo[2] + t * (hi[2] - lo[2]),
  ];
}

// Build per-bone world mat4 arrays for a skeletal model at a given frame.
// Verified formula: Rz(c2[2])×Ry(c2[1])×Rx(c2[0]), sign-corrected ch1 translation.
// All 21 Renamon bones match sstate1 dump within 5 units (RMS 1.99).
// `blend` (optional) = { from, t }: a timeline blend segment eases the pose FROM the `from`
// frame TO `frame` by t∈[0,1] (the game's per-bone interpolation, FIGHTSTG_F0x80083c30: a
// value&0x8000 entry sets +0x94=1, frac=value&0x7fff /4096, from=aux). Without it, motions
// SNAP between disjoint phases (e.g. attack frame 765→1325). Channels are lerped at the sample
// level (a close approximation of the GTE matrix blend).
function buildBoneWorldMatrices(model, frame, blend = null) {
    const n = model.num_bones;
    const worldRot = new Array(n);
    const worldTrans = new Array(n);
    const worlds = new Array(n);

    function applyRot3x3(rot, v) {
        return [
            rot[0] * v[0] + rot[3] * v[1] + rot[6] * v[2],
            rot[1] * v[0] + rot[4] * v[1] + rot[7] * v[2],
            rot[2] * v[0] + rot[5] * v[1] + rot[8] * v[2],
        ];
    }

    function composeRot3x3(a, b) {
        const out = new Float32Array(9);
        for (let i = 0; i < 3; i++)
            for (let j = 0; j < 3; j++)
                for (let k = 0; k < 3; k++)
                    out[i * 3 + j] += a[k * 3 + j] * b[i * 3 + k];
        return out;
    }

    function toMat4(rot, trans) {
        const m = mat4Identity();
        m[0] = rot[0]; m[4] = rot[3]; m[8]  = rot[6]; m[12] = trans[0];
        m[1] = rot[1]; m[5] = rot[4]; m[9]  = rot[7]; m[13] = trans[1];
        m[2] = rot[2]; m[6] = rot[5]; m[10] = rot[8]; m[14] = trans[2];
        return m;
    }

    // Sample a keyframe channel at `frame`, or (during a blend segment) lerp the sample from
    // the `blend.from` frame toward `frame` by `blend.t`. This is what makes transitions fluid
    // instead of snapping between disjoint motion phases. See the header note.
    const sampleCh = (ch) => {
        const a = interpChannel(ch, frame);
        if (!blend || blend.from == null) return a;
        const b = interpChannel(ch, blend.from);
        const t = blend.t;
        return [b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t, b[2] + (a[2] - b[2]) * t];
    };

    function processBone(i) {
        const bone = model.bones[i];
        if (!bone || !bone.anim) {
            worldRot[i] = ps1AnglesToMat3(0, 0, 0);
            worldTrans[i] = [0, 0, 0];
            worlds[i] = mat4Identity();
            return;
        }
        const parentIdx = bone.parent_slot > 0 ? bone.parent_slot - 1 : -1;
        if (parentIdx >= 0 && !worlds[parentIdx]) processBone(parentIdx);

        const c2 = sampleCh(bone.anim.ch2);
        const localRot = ps1AnglesToMat3(c2[2], c2[1], c2[0]);
        const c1 = sampleCh(bone.anim.ch1);

        if (parentIdx < 0) {
            worldRot[i] = localRot;
            worldTrans[i] = [-c1[0], c1[1], -c1[2]];
        } else {
            worldRot[i] = composeRot3x3(worldRot[parentIdx], localRot);
            const rotatedT = applyRot3x3(worldRot[parentIdx], c1);
            worldTrans[i] = [
                worldTrans[parentIdx][0] - rotatedT[0],
                worldTrans[parentIdx][1] + rotatedT[1],
                worldTrans[parentIdx][2] - rotatedT[2],
            ];
        }
        worlds[i] = toMat4(worldRot[i], worldTrans[i]);
        // Apply ch3 scale if present (4096=1.0; defaults to identity when absent).
        // Applied to final matrix columns only — does not propagate to worldRot.
        if (bone.anim.ch3) {
            const c3 = sampleCh(bone.anim.ch3);
            const sx = c3[0] / 4096, sy = c3[1] / 4096, sz = c3[2] / 4096;
            worlds[i][0] *= sx; worlds[i][1] *= sx; worlds[i][2] *= sx;
            worlds[i][4] *= sy; worlds[i][5] *= sy; worlds[i][6] *= sy;
            worlds[i][8] *= sz; worlds[i][9] *= sz; worlds[i][10] *= sz;
        }
    }

    for (let i = 0; i < n; i++) {
        if (!worlds[i]) processBone(i);
        if (!worlds[i]) worlds[i] = mat4Identity();
    }
    return { mats: worlds, worldTrans };
}

// ─── Skeletal model cache ─────────────────────────────────────────────────────

const _skelCache = new Map(); // folder → Promise<model|null>

async function loadSkeletalModel(folder) {
  if (!folder) return null;
  if (_skelCache.has(folder)) return _skelCache.get(folder);
  const base = `assets/battle/models/${folder}`;
  const p = fetch(`${base}/anim.json`)
    .then(r => r.ok ? r.json() : null)
    .catch(() => null)
    .then(async (anim) => {
      if (!anim) return null;

      // Structural mirrorX detection: direct children of bone[0] with negative
      // ch1.x are the mirrored body half; their entire subtrees also need X flip.
      const mirrorBones = new Set();
      const queue = [];
      for (let i = 0; i < anim.bones.length; i++) {
        const b = anim.bones[i];
        if (b.parent_slot - 1 === 0) {  // direct child of bone[0]
          const ch1x = b.anim?.ch1?.[0]?.[0] ?? 0;
          if (ch1x < 0) { mirrorBones.add(i); queue.push(i); }
        }
      }
      while (queue.length) {
        const par = queue.shift();
        for (let i = 0; i < anim.bones.length; i++) {
          if (!mirrorBones.has(i) && anim.bones[i].parent_slot - 1 === par) {
            mirrorBones.add(i); queue.push(i);
          }
        }
      }
      anim.mirrorBones = mirrorBones;

      const slotMapRaw = await fetch(`${base}/slot_map.json`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null);
      anim.slotMap = slotMapRaw ? slotMapRaw.bones : null;

      anim.bridgeVertCapacity = anim.bones.length * 2;
      return anim;
    });
  _skelCache.set(folder, p);
  return p;
}

// ─── Skeletal GL buffer builder ───────────────────────────────────────────────

// Build static IBO + UV buffer from anim.json model. Called once after load.
// Returns { ibo, ubo, indexCount, totalVerts, boneOffsets, vbo:null }
// vbo is created dynamically each frame (DYNAMIC_DRAW) by updateSkeletalVBO.
function buildSkeletalGLBuffers(gl, model) {
  // One VBO/UBO slot per face corner (3 per face), not per unique vert.
  // This prevents UV overwrites when multiple faces share the same vertex index.
  const boneOffsets = [];
  let totalVerts = 0;
  for (const bone of model.bones) {
    boneOffsets.push(totalVerts);
    totalVerts += (bone.faces || []).length * 3;
  }

  // Sequential IBO: corner slot 0,1,2 for first face; 3,4,5 for second; etc.
  const indices = new Uint16Array(totalVerts);
  for (let i = 0; i < totalVerts; i++) indices[i] = i;

  const uvData = new Float32Array(totalVerts * 2);

  for (let b = 0; b < model.bones.length; b++) {
    const bone   = model.bones[b];
    const offset = boneOffsets[b];
    const faces  = bone.faces || [];
    for (let f = 0; f < faces.length; f++) {
      const face = faces[f];
      // face: [v0,v1,v2, u0,v0, u1,v1, u2,v2]
      for (let c = 0; c < 3; c++) {
        const slot = offset + f * 3 + c;
        // Texture is 4bpp-indexed 256x256 (session 15). UVs are baked from the
        // mesh cmd-0x01 base (byte1=U, byte3=V) + raw per-vertex u/v, so both
        // axes are 0..255 -> divide by 256.
        uvData[slot * 2]     = face[3 + c * 2]     / 256.0;
        uvData[slot * 2 + 1] = face[3 + c * 2 + 1] / 256.0;
      }
    }
  }

  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  const ubo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, ubo);
  gl.bufferData(gl.ARRAY_BUFFER, uvData, gl.STATIC_DRAW);

  return { ibo, ubo, indexCount: totalVerts, totalVerts, boneOffsets, vbo: null };
}

// Exported version: fills a pre-allocated Float32Array with un-scaled world positions.
// Signature matches what index.html expects: (model, frame, bwm, positions).
// Emits one position per face corner (3 per face) to match buildSkeletalGLBuffers layout.
// bwm = { mats, worldTrans } from buildBoneWorldMatrices.
function posedVertex(bone, vertexIndex, boneIndex, mats) {
  const influences = bone.skin?.[vertexIndex];
  if (!influences) {
    const [lx, ly, lz] = bone.verts[vertexIndex] || [0, 0, 0];
    const mat = mats[boneIndex];
    return [-(mat[0]*lx + mat[4]*ly + mat[8]*lz) + mat[12],
             mat[1]*lx + mat[5]*ly + mat[9]*lz  + mat[13],
            -(mat[2]*lx + mat[6]*ly + mat[10]*lz) + mat[14]];
  }
  let x = 0, y = 0, z = 0;
  for (const [part, weight, lx, ly, lz] of influences) {
    const mat = mats[part];
    x += weight * (-(mat[0]*lx + mat[4]*ly + mat[8]*lz) + mat[12]);
    y += weight * ( mat[1]*lx + mat[5]*ly + mat[9]*lz  + mat[13]);
    z += weight * (-(mat[2]*lx + mat[6]*ly + mat[10]*lz) + mat[14]);
  }
  return [x, y, z];
}

function updateSkeletalVBO(model, frame, bwm, positions) {
  const { mats } = (bwm && bwm.mats) ? bwm : { mats: bwm };

  // Mesh geometry = bone.faces indexed DIRECTLY into bone.verts × worldMat (3 corners/face).
  // The bin-0 "pool" / slotMap / LERP apparatus is the animation-channel keyframe sampler, NOT
  // mesh geometry (confirmed Task 9, session 14: DIRECT base `g0` is a frame index, not a vertex
  // index; joint visual check passed — pool rendering produced spikes, direct does not).
  let off = 0;
  for (let b = 0; b < model.bones.length; b++) {
    const bone    = model.bones[b];
    const mat     = mats[b];
    const faces   = bone.faces || [];
    for (let f = 0; f < faces.length; f++) {
      const face = faces[f];
      for (let c = 0; c < 3; c++) {
        if (bone.skin?.[face[c]]) {
          const point = posedVertex(bone, face[c], b, mats);
          positions[off++] = point[0];
          positions[off++] = point[1];
          positions[off++] = point[2];
        } else {
          const [lx, ly, lz] = (bone.verts || [])[face[c]] || [0, 0, 0];
          positions[off++] = -(mat[0]*lx + mat[4]*ly + mat[8]*lz) + mat[12];
          positions[off++] =  mat[1]*lx + mat[5]*ly + mat[9]*lz  + mat[13];
          positions[off++] = -(mat[2]*lx + mat[6]*ly + mat[10]*lz) + mat[14];
        }
      }
    }
  }
}

// Internal GL version used by createBattle3D.
// Emits one position per face corner (3 per face) to match buildSkeletalGLBuffers layout.
// bwm = { mats, worldTrans } from buildBoneWorldMatrices — both outputs consumed together.
function _updateSkeletalVBOGL(gl, model, buffers, bwm, worldPos, scale, flipX, yaw = 0) {
  const { mats } = bwm;
  const posData = new Float32Array(buffers.totalVerts * 3);
  // The posed vertex above is the PS1 battle world, so this is the ONE mapping
  // (PS1_RENDER_SIGN = [1,-1,-1]): +Y down -> render up, and +Z into the screen -> toward it,
  // which is the 180° rotation about X and so keeps handedness. `flipX` is the render-space
  // X flip some other path may still want; production passes false everywhere.
  const sx = flipX ? -scale : scale;
  const sy = -scale;
  const sz = -scale;
  const cy = Math.cos(yaw), syw = Math.sin(yaw);  // yaw rotation about world Y (facing)
  let minX =  Infinity, minY =  Infinity, minZ =  Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  // Mesh = bone.faces indexed DIRECTLY into bone.verts × worldMat (Task 9: pool/slotMap retired).
  for (let b = 0; b < model.bones.length; b++) {
    const bone    = model.bones[b];
    const mat     = mats[b];
    const offset  = buffers.boneOffsets[b];
    const faces   = bone.faces || [];
    for (let f = 0; f < faces.length; f++) {
      const face = faces[f];
      for (let c = 0; c < 3; c++) {
        let wx, wy, wz;
        if (bone.skin?.[face[c]]) {
          [wx, wy, wz] = posedVertex(bone, face[c], b, mats);
        } else {
          const [lx, ly, lz] = (bone.verts || [])[face[c]] || [0, 0, 0];
          wx = -(mat[0]*lx + mat[4]*ly + mat[8]*lz) + mat[12];
          wy =  mat[1]*lx + mat[5]*ly + mat[9]*lz  + mat[13];
          wz = -(mat[2]*lx + mat[6]*ly + mat[10]*lz) + mat[14];
        }
        const i = (offset + f * 3 + c) * 3;
        const sxw = wx * sx, syh = wy * sy, szw = wz * sz;
        const px = worldPos[0] + (sxw * cy + szw * syw);   // yaw about Y, then place
        const py = worldPos[1] + syh;
        const pz = worldPos[2] + (-sxw * syw + szw * cy);
        posData[i]     = px;
        posData[i + 1] = py;
        posData[i + 2] = pz;
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
        if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
      }
    }
  }

  if (!buffers.vbo) {
    buffers.vbo = gl.createBuffer();
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vbo);
  gl.bufferData(gl.ARRAY_BUFFER, posData, gl.DYNAMIC_DRAW);

  if (!isFinite(minX)) return null;
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

// A fighter's colour is its own texture's colour, and that is a decoded fact rather than a
// default. The fight-scene draw that submits a fighter's triangles is
// FIGHTSTG_F0x80085110 (~/ddw3/asm/dw2003/pro/fightstg.s:2382); it is reached only through
// the model object's +0xA4 method, installed once by FIGHTSTG_F0x8008610c (:3468), whose
// only caller is the fighter-model builder FIGHTSTG_F0x80083e0c (:1209). Its two arguments
// are the model object and an 8-word world matrix (F0x80085f3c, :3289-3299, copies the
// matrix into model+0x84..0xa0) -- there is no colour, alpha or blend parameter anywhere on
// the way in. Inside it nothing stores to a primitive's colour bytes: its per-frame writes
// are positions and texture coordinates (:2783-2812 copies u/v bytes from the model's table
// at model+0x80, each plus a u or v page offset); the descriptor byte carrying the semi-transparency flag is a constant picked
// by "is this primitive textured" (0x0c textured, 0x09 flat -- F0x80084bc0 :2057 and
// F0x80084e0c :2180), never by a frame or a damage state. Nor does anything on the hit path
// write one: op1 (FIGHTSTG_F0x8008b69c, :8769) stores only the child action actor's +0x50
// and +0x54, and the damage-reaction machine FIGHTSTG_F0x8008d3b4 (:10676) stores only the
// attack object's motion fields and the child actor's clip and motion fields.
//
// So what a struck Digimon shows IS its reaction clip, its eyes shutting
// (FIGHTSTG_F0x8008b118), the knockback distance on the child actor's +0x64, and the
// reaction script's own op10[99] impact sprite. Nothing modulates the body colour, so this
// is one untinted colour and it is the only one the fighter path has.
export const FIGHTER_TINT = [1, 1, 1, 1];

// `wire` draws the SAME index buffer as connected lines instead of filled
// triangles, which is how the Blast transformation shows the incoming form
// before it resolves (BLAST-C010 phase 4, "green wireframe of the new form").
// It reuses the model's own geometry, so the wireframe is the real silhouette
// of the Digimon being blasted into, not a stand-in shape.
function drawSkeletalMesh(gl, prog, mvp, buffers, tex, tint, alpha = 1.0, wire = false) {
  if (!buffers || buffers.indexCount === 0 || !buffers.vbo) return;

  gl.useProgram(prog.program);
  gl.uniformMatrix4fv(prog.uMVP, false, mvp);
  gl.uniform1f(prog.uAlpha, alpha);
  gl.uniform4fv(prog.uTint, tint || [1,1,1,1]);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(prog.uTex, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vbo);
  gl.enableVertexAttribArray(prog.aPos);
  gl.vertexAttribPointer(prog.aPos, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.ubo);
  gl.enableVertexAttribArray(prog.aUV);
  gl.vertexAttribPointer(prog.aUV, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.ibo);
  gl.drawElements(wire ? gl.LINE_STRIP : gl.TRIANGLES,
    buffers.indexCount, gl.UNSIGNED_SHORT, 0);
}

// ─── GL helpers ───────────────────────────────────────────────────────────────

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error("Shader: " + gl.getShaderInfoLog(s));
  return s;
}

function createProgram(gl, vsrc, fsrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vsrc));
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fsrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error("Link: " + gl.getProgramInfoLog(p));
  return p;
}

// The disc gives each Digimon spare rectangles on its own texture page holding the
// eye open, half closed and shut, and copies one over the eye whenever the state
// changes (GP0 0x80, a VRAM-to-VRAM blit — FIGHTSTG_F0x8008b160). texSubImage2D is
// the same operation, but it needs a source, so keep the page CPU-side as well.
// `scale` is 4 in HD asset mode, where every patch coordinate is 4x too.
function loadTexturePixels(url) {
  return fetchAsset(url)
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
    .then((blob) => createImageBitmap(blob))
    .then((bitmap) => {
      const { width, height } = bitmap;
      const canvas = typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement("canvas"), { width, height });
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      const { data } = ctx.getImageData(0, 0, width, height);
      return { data, width, height, scale: width / TEXTURE_PAGE_TEXELS };
    })
    .catch(() => null);
}

function loadTexture(gl, url, onLoad) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // 1×1 transparent placeholder
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([0,0,0,0]));
  // Use fetch + createImageBitmap so this works on both regular and OffscreenCanvas GL contexts.
  fetchAsset(url)
    .then(r => {
      if (!r.ok) throw new Error(r.status);
      const hd = new URL(r.url, location.href).pathname.includes("/assets-hd/");
      return r.blob().then(blob => ({ blob, hd }));
    })
    .then(({ blob, hd }) => createImageBitmap(blob).then(bitmap => ({ bitmap, hd })))
    .then(({ bitmap, hd }) => {
      const bw = bitmap.width, bh = bitmap.height;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, hd ? gl.LINEAR : gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      // WRAP_T = REPEAT: seam-unwrapped V coords (export_fight_anim.py) go
      // slightly <0 / >255 for primitives that straddle the 256-tall page seam;
      // REPEAT tiles them back into the texture instead of clamping to an edge.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      bitmap.close();
      if (onLoad) onLoad(tex, bw, bh);
    })
    .catch(() => {
      if (onLoad) onLoad(tex, 1, 1);
    });
  return tex;
}

function makeQuadBuffers(gl, verts, uvs) {
  // verts: 4×[x,y,z], uvs: 4×[u,v], two triangles (0,1,2, 0,2,3)
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts.flat()), gl.STATIC_DRAW);
  const ubo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, ubo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs.flat()), gl.STATIC_DRAW);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0,1,2, 0,2,3]), gl.STATIC_DRAW);
  return { vbo, ubo, ibo, count: 6 };
}

// ─── Billboard rendering ──────────────────────────────────────────────────────

// PS1 fight texture is 64×256. In battle the Digimon model looks roughly
// human-sized viewed at a slight upward angle. We display the texture on a
// quad scaled to the natural proportions of the model's bounding box.
// Without UV decode, we show the full texture page as a flat sprite.
// The 64×256 page is rendered at 1:4 aspect ratio — models that were taller
// look correct, while wider characters will appear stretched. This is improved
// when UV decoding is completed.

function drawBillboard(gl, prog, mvp, viewEye, worldPos,
                       widthUnits, heightUnits, tex, alpha, tint) {
  // Compute billboard right/up vectors (always face camera)
  const camRight = normalize([mvp[0], mvp[4], mvp[8]]);
  const worldUp = [0, 1, 0];
  const rx = camRight, ry = worldUp;

  const hw = widthUnits * 0.5;
  const hh = heightUnits * 0.5;
  const cx = worldPos[0], cy = worldPos[1] + hh, cz = worldPos[2];

  const tl = [cx - rx[0]*hw + ry[0]*hh, cy - rx[1]*hw + ry[1]*hh, cz - rx[2]*hw + ry[2]*hh];
  const tr = [cx + rx[0]*hw + ry[0]*hh, cy + rx[1]*hw + ry[1]*hh, cz + rx[2]*hw + ry[2]*hh];
  const br = [cx + rx[0]*hw - ry[0]*hh, cy + rx[1]*hw - ry[1]*hh, cz + rx[2]*hw - ry[2]*hh];
  const bl = [cx - rx[0]*hw - ry[0]*hh, cy - rx[1]*hw - ry[1]*hh, cz - rx[2]*hw - ry[2]*hh];

  const bufs = makeQuadBuffers(gl, [tl, tr, br, bl], [[0,0],[1,0],[1,1],[0,1]]);
  drawQuad(gl, prog, mvp, bufs, tex, alpha, tint);
  gl.deleteBuffer(bufs.vbo); gl.deleteBuffer(bufs.ubo); gl.deleteBuffer(bufs.ibo);
}

function drawQuad(gl, prog, mvp, bufs, tex, alpha, tint) {
  gl.useProgram(prog.program);
  gl.uniformMatrix4fv(prog.uMVP, false, mvp);
  gl.uniform1f(prog.uAlpha, alpha);
  gl.uniform4fv(prog.uTint, tint || [1,1,1,1]);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(prog.uTex, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, bufs.vbo);
  gl.enableVertexAttribArray(prog.aPos);
  gl.vertexAttribPointer(prog.aPos, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, bufs.ubo);
  gl.enableVertexAttribArray(prog.aUV);
  gl.vertexAttribPointer(prog.aUV, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.ibo);
  gl.drawElements(gl.TRIANGLES, bufs.count, gl.UNSIGNED_SHORT, 0);
}

// Draw one projectile mesh layer (interleaved static pos+uv buffers, non-indexed tris).
function drawProjLayer(gl, prog, mvp, layer, tex, alpha = 1.0) {
  gl.useProgram(prog.program);
  gl.uniformMatrix4fv(prog.uMVP, false, mvp);
  gl.uniform1f(prog.uAlpha, alpha);
  gl.uniform4fv(prog.uTint, [1, 1, 1, 1]);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(prog.uTex, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, layer.vbo);
  gl.enableVertexAttribArray(prog.aPos);
  gl.vertexAttribPointer(prog.aPos, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, layer.ubo);
  gl.enableVertexAttribArray(prog.aUV);
  gl.vertexAttribPointer(prog.aUV, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, layer.count);
}

// ─── The arena's own back-face cull (FIGHTSTG_F0x80085110's mesh arm) ──────────
//
// DECODED 2026-10-07 from the original's own display-list path, not guessed:
//
//   * The arena meshes are the SAME `0x18` battle bodies the character and effect
//     meshes are, walked by the SAME interpreter FIGHTSTG_F0x80085110 (wfightmn
//     builds the arena object from the arena id and the display-list loop emits
//     each mesh's primitives). So the arena uses the character meshes' view
//     space: the GTE's COP2 projection into screen space, Y increasing DOWNWARD.
//
//   * The mesh arm (0x8008555c..0x80085640, ported in
//     engine/dw3/battle-displaylist.ts buildMeshFields) runs ONE NCLIP on the
//     primitive's first three projected SXY and DROPS it when MAC0 <= 0 (or when
//     two SXY are equal). MAC0 = SX0*(SY1-SY2) + SX1*(SY2-SY0) + SX2*(SY0-SY1),
//     the signed area in that Y-down screen space.
//
//   * SIGN CONVENTION, pinned empirically from the ground truth: the arena's
//     POLY_FT4 packets in the live battle RAM are the POST-CULL set (the original
//     only packs what survived). Decoded with `.dw3-research/playtest-arena-palette-rig-2026-10-07/tools/
//     scan_packets.py`: on all four captured battles (arena ids 1, 5, 13, 20),
//     every arena packet (tpage 0x000a/0x000b) has NCLIP MAC0 > 0 on its first
//     three SXY — 196/196, 414/414, 487/487, 531/531 — none <= 0. So surviving =
//     MAC0 > 0 in PS1 screen space (Y down). The browser projects in NDC (Y up),
//     so the screen-Y is negated below; a NDC-Y-up cross product carries the
//     opposite sign, which is why the negation is there and not a sign flip on
//     the comparison.
//
//   * A quad is culled as ONE primitive: both split triangles share the first
//     triangle's sign (`cullRef`, emitted by tools/extract_arenas.py).
let arenaCullSign = 1;   // +1 = the decoded convention (survivor MAC0>0 in screen-Y-down space)
const arenaCullLog = { kept: 0, total: 0 };
function setArenaCullSign(s) { arenaCullSign = s < 0 ? -1 : 1; return arenaCullSign; }
function arenaCullIndices(mvp, layer) {
  const pos = layer.pos, ref = layer.cullRef;
  if (!pos) return null;
  const nt = (pos.length / 9) | 0;
  const out = [];
  arenaCullLog.total = nt;
  const cache = new Map();
  const projTri = (t) => {
    const b = t * 9;
    const xy = [];
    for (let k = 0; k < 3; k++) {
      const x = pos[b + k * 3], y = pos[b + k * 3 + 1], z = pos[b + k * 3 + 2];
      const cw = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
      if (!(cw > 1e-6)) return null;             // at/behind the eye: the original clips it away
      const cx = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
      const cy = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
      xy.push(cx / cw, cy / cw);
    }
    return xy;
  };
  for (let t = 0; t < nt; t++) {
    const rt = ref ? ref[t] : t;
    let s = cache.get(rt);
    if (s === undefined) { s = projTri(rt); cache.set(rt, s); }
    if (!s) continue;
    const [x0, y0, x1, y1, x2, y2] = s;
    // NCLIP in PS1 screen space (Y down): sy = -ndcY.
    const mac0 = x0 * (-y1 + y2) + x1 * (-y2 + y0) + x2 * (-y0 + y1);
    if (mac0 * arenaCullSign > 0) { out.push(t * 3, t * 3 + 1, t * 3 + 2); arenaCullLog.kept++; }
  }
  return out;
}

// Draw one arena layer through the ported cull: only the front-facing primitives
// are drawn (the original's own post-cull set). Uses a dynamic index buffer.
function drawProjLayerIndexed(gl, prog, mvp, layer, tex, idx) {
  if (!idx) { drawProjLayer(gl, prog, mvp, layer, tex, 1); return; }
  if (!layer.ibo) layer.ibo = gl.createBuffer();
  gl.useProgram(prog.program);
  gl.uniformMatrix4fv(prog.uMVP, false, mvp);
  gl.uniform1f(prog.uAlpha, 1.0);
  gl.uniform4fv(prog.uTint, [1, 1, 1, 1]);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(prog.uTex, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, layer.vbo);
  gl.enableVertexAttribArray(prog.aPos);
  gl.vertexAttribPointer(prog.aPos, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, layer.ubo);
  gl.enableVertexAttribArray(prog.aUV);
  gl.vertexAttribPointer(prog.aUV, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, layer.ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.DYNAMIC_DRAW);
  gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
}

// ─── Main factory ─────────────────────────────────────────────────────────────

/**
 * Create a 3D battle renderer.
 * @param {HTMLCanvasElement} canvas
 * @param {{playBattle: (name: string, side: string, durationFrames?: number) => void}|null} [sfx]
 * @returns {object} renderer API
 */
// ─── Arena placement (pro/smdldata.s, resource 0x1cc) ────────────────────────
// FIGHTSTG_F0x80087f38 places a fighter from its OWN record and the side nibble of
// its slot id (claim fight-arena-slot-is-per-model-standoff-and-hover-2026-08-18):
//   x = 0
//   y = -hover                       (record +0x18; 0 stands on the arena floor)
//   z = -+(0x1400 + standoff)        (record +0x10; near side negative, far positive)
// So the arena is symmetric about z = 0 and the two fighters stand at a distance that
// differs per matchup. The old fixed -5248 / +5888 were simply Renamon's stand-off of
// 128 and its opponent's of 768, read out of one capture.
export const PLACEMENT_URL = "assets/battle/model_placement.json";
// The arena base distance is the original routine's own constant, carried by the port
// (engine/dw3/battle-presentation.ts `ARENA_BASE_Z`); re-exported here for the renderer and
// its tests so the value cannot drift from the port.
export { ARENA_BASE_Z };

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
export function texturePatchRect(entry, scale) {
  const u = TEXELS_PER_PATCH_UNIT * scale;
  const variant = entry.src[entry.variant] ? entry.variant : 0;
  const r = patchCopyRect(entry, variant, 0, 0);
  return {
    x0: r.srcX * u, y0: r.srcY * scale,
    dx: r.dstX * u, dy: r.dstY * scale,
    w: r.width * u, h: r.height * scale,
  };
}

/**
 * The battle picture box (layer key 0x1009) shows the speaking Digimon. The
 * talk-system speaker id is 0 for the player side and 0x10 for the enemy side;
 * its high nibble selects the side (claim terra-037-speaker16-enemy-side-20260906).
 * Accepts the numeric id or the "player"/"enemy" side name.
 */
export function faceCamSideFor(speaker) {
  const id = typeof speaker === "number" ? speaker : (speaker === "enemy" ? 0x10 : 0);
  return (id & 0x10) ? "enemy" : "player";
}

export function modelKeyFromFolder(folder) {
  const m = /^m(\d{3})/.exec(String(folder || ""));
  return m ? String(Number(m[1])) : null;
}

/**
 * Which Digimon's camera table an op5 preset reads, and which shot of it.
 * The op5 handler passes a CONSTANT slot argument - 0 for presets 1-4 and 0x10 for
 * presets 5-7 - so the preset itself picks the side, not whoever issued it, and the
 * shot comes from the fighter standing in that slot.
 */
export function op5ShotSlot(preset) {
  const p = preset | 0;
  if (p >= 1 && p <= 4) return { side: "player", index: p + 7 };
  if (p >= 5 && p <= 7) return { side: "enemy", index: p - 5 };
  return null;   // preset 0 = reset to the default camera
}

/**
 * A model's own authored REACTION camera SCRIPT — every preset op5 in its clip-10 action script,
 * IN AUTHORED ORDER.
 *
 * The original installs no camera of its own when a clip authors no op5 (the handler
 * FIGHTSTG_F0x8008c004 runs only on an authored op5), and the reaction clip that carries the
 * impact camera is the damage-reaction default arm's clip 10 (`pro/fightstg.s:11008-11011`,
 * `.L0x8008d8e0: li $v0,0xa; sw $v0,0x54`). It is PER-MODEL data, enumerated over all 249
 * shipped packs by smdldata section (2 = near/player-side, 3 = far/enemy-side):
 *   • 53 of 56 near-side packs author `op5 [60, 0, 3]`;
 *   • the 16 far-side packs that author one use presets 7 / 6 / 1 (their own far-side shots);
 *   • the other 177 far-side packs author NONE, and the original then installs NO camera at all.
 *
 * The near-side clip-10 camera is not ONE op5 but a PAIR: `op5[60,0,3]` early and the restore
 * `op5[60,0,0]` late in the same clip (m003agum ops[1] and ops[12]; m383pken the same). Both run,
 * in order — the earlier worker picked only the first and so the camera glided out and never came
 * back. This returns the whole authored list, each entry `{ preset, duration }`; the record's
 * `sequence` runs them in order.
 *
 * The preset names a SLOT, not the model that authored it (`op5ShotSlot`, fightstg.s:9430-9445):
 * presets 1-4 are the NEAR fighter (slot 0), presets 5-7 the FAR one (slot 0x10). So a near-side
 * pack whose authored value is 3 aims at slot 0 whichever side it stands on — which is why this
 * pair is only ever a camera for the acting model itself (the item-use case, where the user IS the
 * slot the preset names), and why grafting it onto the OTHER fighter's hit framed the player's own
 * Digimon. Preset 0 (and >= 8) is the reset/default battle cam: it resolves to the arena shot
 * rather than a canned slot (the disc's m100), and its `preset` is left 0 here for the caller to
 * resolve.
 */
export function reactionCamFromActions(actions) {
  const ops = Array.isArray(actions) ? actions[10]?.ops : null;
  if (!Array.isArray(ops)) return [];
  const out = [];
  for (const o of ops) {
    if (!o || o.op !== 5) continue;
    const w = o.words || [];
    if (w[1] !== 0 || w[2] == null) continue;   // sub=1 is an explicit transform, not a preset
    out.push({ preset: w[2] | 0, duration: Math.max(0, w[0] | 0) });
  }
  return out;
}

// ─── The defeat camera (FIGHTSTG_F0x8008c93c, the loss-only effect) ────────────
// When the player loses, wfightmn's loss branch (0x800a9230) builds F0x8008cb44 ->
// object tick F0x8008c93c (the descriptor passed to the allocator F0x80014504 is
// `lui 0x8009 / addiu -0x36c4` = 0x8008c93c, which the allocator stores at object+0x48,
// the tick slot — so this is that object, not a shared method).
//
// Its first tick (phase 0, .L0x8008c988) does, in order:
//   1. `camMgr->[0x104](0, 0xb)` — the canned-shot selector F0x800923b4 with a1 = 0 and
//      a2 = 0xb, so the NEAR table of the acting fighter (a1 & 0xf0 == 0) at index 11.
//      It then zeroes the anchor (+0x18/+0x1c/+0x20) and the three frame angles
//      (+0x24/+0x26/+0x28), so the shot is absolute with the anchor at the arena origin.
//   2. `animMgr->[0xe8](0x17, 0x1e, 0x1e)` — motion 0x17 (SFSTDATA record 23) on a
//      manager built for this effect alone, not on either fighter. Not modelled here.
//   3. `[0x800a4548](2)` — slow motion. 0x800a4548 = F0x8009e510 (fightstg.s:34974),
//      which stores the level at 0x800a453c and calls F0x8009e428, the per-frame stepper.
//      It writes the delta the battle's animation clock reads from 0x800a4464; the orbit
//      below does not go through it, because the pointer at 0x8004df9c is never swapped.
//   4. `camMgr->[0x38](self)` — advance to phase 1.
// Every later tick (.L0x8008cad4, shared by phases 1 and 2) adds `delta * 2` to
// 0x800a46d8+0x26 — the shot frame's Y angle, 4096 to a turn — and re-applies the shot.
// Phase 1 also accumulates the delta at +0x10 and switches to phase 2 at >= 0xf0 (240
// frames at the real delta of 1, four seconds).
export const LOSS_CAM = {
  /** a2 of `camMgr->[0x104](0, 0xb)`: near-table shot 11 of the acting fighter. */
  shotIndex: 0xb,
  /** 0x800a46fe += delta * 2, and 0x1000 = one turn. */
  yawUnitsPerDelta: 2,
  turnUnits: 0x1000,
  /** The engine's per-frame delta, `[0x8004df9c]()`, and it is 1. The word it returns
   *  (0x8004de28) has exactly one writer, F0x8001d504 at .L0x8001d668, and it is
   *  `lw 0x1c($s0) sra 8` — the integer half of the 8.8 accumulator at 0x8004de2c. That
   *  accumulator's only other writer is the vblank handler F0x8001d3f4, which adds
   *  exactly 0x100 a call (.L0x8001d430; 0x133 on the 50 Hz branch, .L0x8001d460), so
   *  the published value rises by 1 per frame. Two independent checks agree: the 60-frame
   *  blend F0x800922b4 arms with a3 = 0x3c steps 68 a frame (0x100000/60 >> 8) and lands
   *  on 0x1000 in 60 frames only at delta 1, and a3 = 1 at .L0x80086f54 is a one-frame cut. */
  deltaPerFrame: 1,
  /** `[0x800a4548](2)`. The orbit does NOT run through it — F0x8008cad4 reads the raw
   *  delta from 0x8004df9c, and nothing in the game ever swaps that pointer (the table
   *  at 0x8004df98 is written nowhere), so slow motion slows the battle's animation
   *  clock at 0x800a4464 and leaves the camera at full speed. */
  slowMoLevel: 2,
  /** F0x8009e428 level 2, the slow-motion stepper `.L0x8009e428` runs every frame and the
   *  level `[0x800a4548]` arms: `published = 0; accumulator += delta;` then
   *  `while (accumulator >= 5) { published += 1; accumulator -= 4 }`
   *  (.L0x8009e4a8-.L0x8009e4d8). It writes `published` to 0x800a4464, which the BATTLE's
   *  animation clock reads: the model actor's frame counter `self+0x80 += 0x800a4464` at
   *  F0x80083d30, the second actor clock at .L0x80089614, and every op2 slot-motion blend
   *  and countdown (F0x8009b1fc / .L0x8009b380 / .L0x8009b520 / .L0x8009b5d4 / .L0x8009b720).
   *  So at the real rawDelta of 1 the battle animation advances ONE unit every FOUR frames
   *  for as long as the level stays at 2 — the fight's own clock, not the camera's, because
   *  the orbit reads `[0x8004df9c]()` directly (.L0x8008cad4). */
  // The step and its accumulator constants now come from the port
  // (engine/dw3/battle-slow-motion.ts): 5 publishes, 4 costs, so the average is exact.
  slowMoPublishAt: SLOW_MO_PUBLISH_AT,
  slowMoAccumCost: SLOW_MO_ACCUM_COST,
  /** Phase 2 at >= 0xf0 accumulated delta (F0x8008cac8) = 240 frames at delta 1. */
  phase2Delta: 0xf0,
};

/**
 * One frame of F0x8009e428, the slow-motion stepper that [0x800a4548] points at, writing
 * the delta the battle's animation and motion timers read from 0x800a4464. Level 0 passes
 * the frame's delta through, 1 freezes, 3 doubles, and 2 emits one unit per four
 * accumulated — a quarter of normal speed — keeping the 1..4 remainder so the average
 * stays exact. At the real delta of 1 that is one unit every fourth frame.
 *
 * This delegates to the port `slowMotionStep` (engine/dw3/battle-slow-motion.ts), whose
 * oracle drives the original words of F0x8009e428 per frame. The one behavioural
 * difference from the hand-written copy it replaces: the port CARRIES the accumulator
 * through levels 0/1/3 exactly as the original does (only level 2 ever advances it, and
 * the setter zeroes it), where the old copy reset it to 0 on those levels.
 */
export function slowMoStep(level, delta, acc = 0) {
  return slowMotionStep(level, delta, acc);
}

/**
 * The defeat camera's orbit in the game's own units: F0x8008cafc adds `delta * 2` to
 * the shot frame's Y angle, out of 4096 to a turn, and the delta there is the raw one
 * from `[0x8004df9c]()` — 1 a frame, 2 units, 0.176 degrees. `gameDelta` is the delta
 * the orbit has been given, so at full speed a frame's worth is one.
 */
export function lossCamYawUnits(gameDelta) {
  const n = (gameDelta | 0) * LOSS_CAM.yawUnitsPerDelta;
  return ((n % LOSS_CAM.turnUnits) + LOSS_CAM.turnUnits) % LOSS_CAM.turnUnits;
}

/** Rotate a shot about the arena origin (the anchor F0x800923b4 leaves zeroed) by the
 *  frame's Y angle, in PS1 units. eye and target are both relative to that frame, and the
 *  matrix is the game's own RotMatrixYXZ (F0x8002b65c) with the other two angles at zero,
 *  so the sign of the swing is the one the original uses and not a mirrored guess. */
export function rotateShotYaw(eye, target, yawUnits) {
  const R = rotMatrixYXZ(0, yawUnits, 0);
  return { eye: rotApply(R, eye), target: rotApply(R, target) };
}

/** One fighter's home slot in PS1 arena units, Y down. The arithmetic — x, -hover and the
 *  ±(0x1400+standoff) z with the near side negated — is the ported FIGHTSTG_F0x80087F38
 *  placement (engine/dw3/battle-presentation.ts `arenaPlacement`), not a second copy: the
 *  near slot id 0 and the far slot id 0x10 select the two sides. */
export function arenaSlot(record, side) {
  const standoff = record?.standoff | 0;
  const hover = record?.hover | 0;
  const far = side === "enemy";
  const p = arenaPlacement(hover, standoff, far ? 0x10 : 0);
  return { x: p.x, y: p.y, z: p.z, side: far ? "enemy" : "player" };
}

/** Same, looked up by pack folder. An absent record falls back to a bare stand-off of 0. */
export function arenaSlotFor(folder, side, table) {
  const key = modelKeyFromFolder(folder);
  return arenaSlot((key && table) ? table[key] : null, side);
}

/**
 * May the fight scene run its camera at all — i.e. are BOTH fighters' staging records in?
 *
 * This is the original's ORDER, and it is why a battle never opens on a camera that has no
 * shot. The fight's setup phase (phase 1, sub-state 2, `.L0x800927d0`) creates four objects in
 * one block, each only if its slot is still zero — the zero tests at :16134, :16141, :16149 and
 * :16156, the four creations at :16136-16160:
 *
 *   slot +0x00  F0x80093cc8              the fight object itself
 *   slot +0x04  F0x80093f9c(self+0x50, self+0x58)   the NEAR fighter's model object
 *   slot +0x08  F0x8009426c                          the FAR fighter's model object
 *   slot +0x18  F0x80087b84              THE IDLE CAMERA DIRECTOR  (its tick is F0x8008718c)
 *
 * So the director is created last, after the two records whose canned shots it reads — there is
 * no state in which it runs before they exist. Neither of its two shot loaders invents a shot
 * when a record is missing: `[0x100]` (F0x8009257c) returns the staging block's address untouched
 * on either of its two null checks (.L0x800925ac, .L0x800925c8) and `[0x104]` (F0x800923b4) does
 * the same on its one (.L0x800923f0), and no writer ever clears the record. So before this
 * predicate is true there is no record to draw through and nothing to fall back to.
 */
export function stagingRecordsReady(placementTable, playerFolder, enemyFolder) {
  const has = (folder) => {
    const key = modelKeyFromFolder(folder);
    return !!(key != null && placementTable && placementTable[key]);
  };
  return !!(playerFolder && enemyFolder && has(playerFolder) && has(enemyFolder));
}

/**
 * The arena shot `[0x100]` (F0x8009257c) as the walker reads it: the FAR fighter's own record
 * names a 1-based canned shot, and the shot is cut from the NEAR side's twelve.
 *
 * `F0x800925ec` reads the word at `farRecord+0x44` and passes `value - 1` to `[0x104]` with
 * `a1 = 0` (the near table). That word is a FIELD only in a 0x48 record — it sits immediately
 * after that layout's three far-side projection distances — and a 0xC4 record is full at +0xC4
 * with its twelve near-side shots, so `+0x44` lands inside `eye[7].x` there. tools/extract_smdldata.py
 * emits `shot` for the 0x48 records only, which is why the 193 wild Digimon (the ones the disc
 * puts on the far side) carry it and the 55 partners do not. A far-side 0xC4 record therefore has
 * no opening shot here: the console would read six halfwords before the record's own camera array
 * out of whatever the staging block's neighbours happen to hold, which is not a behaviour to
 * reproduce, so this returns null and the caller keeps the last record instead of cutting one.
 */
export function arenaShotFor(placementTable, playerFolder, enemyFolder) {
  const near = placementTable?.[modelKeyFromFolder(playerFolder)] ?? null;
  const far = placementTable?.[modelKeyFromFolder(enemyFolder)] ?? null;
  const index = (far?.shot | 0) - 1;
  if (index < 0 || !near?.camera) return null;
  const eye = near.camera.eye?.[index], look = near.camera.look?.[index];
  if (!eye || !look) return null;
  return { eye, target: look, H: near.camera.view?.[index] };
}

/**
 * The contact-marker sound substitution, read out of fightstg F0x8008c454 (the op10
 * handler, .L0x8008c4a0 / .L0x8008c4d4):
 *
 *   op10 98 (0x62) checks the per-contact record at ctx+0x58+4*[ctx+0x94];
 *   op10 99 (0x63) checks the contact's final result at ctx+0x64. When the check
 *   reads 3 — the evade result — both arms load $a0 = 0x38 (56) instead of the
 *   attack context's sound type (ctx+0x70) before falling into F0x8009b774, the
 *   packed-sound player. 0x38 is COMEX102 (0x8004413e): the cue a contact that
 *   EVADED makes, in place of the weapon's own contact sound.
 *
 * Pure and exported so the cue test can walk the resolution; the renderer's op10
 * hook calls it with the live contact state.
 */
export const CONTACT_EVADE_TYPE = 56;   // 0x38, COMEX102 0x8004413e
export function resolveContactSoundType(type, contactType, evaded) {
  if (type !== 98 && type !== 99) return type;
  return evaded ? CONTACT_EVADE_TYPE : contactType;
}

export function createBattle3D(canvas, sfx = null) {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: true });
  if (!gl) return null;

  // Programs
  const texProg = createProgram(gl, VERT_SRC, FRAG_SRC);
  const texP = {
    program: texProg,
    aPos:  gl.getAttribLocation(texProg, "aPos"),
    aUV:   gl.getAttribLocation(texProg, "aUV"),
    uMVP:  gl.getUniformLocation(texProg, "uMVP"),
    uTex:  gl.getUniformLocation(texProg, "uTex"),
    uAlpha:gl.getUniformLocation(texProg, "uAlpha"),
    uTint: gl.getUniformLocation(texProg, "uTint"),
  };

  // World up axis. Eye/look are computed per-frame by the cinematic camera (see render()).
  const UP = [0, 1, 0];

  // Arena dimensions (world units). Large enough to read as a ground plane across the
  // deep player→enemy axis (player ~z+220, enemy ~z-360).
  // Floor extent in world units. The fighters stand at PS1 slots z=-5248/+5888
  // (× MODEL_SCALE 0.35 → z≈-1837/+2061), so the old 1400×1600 quad ended ~1200
  // units SHORT of the enemy: it stood on the void, and every camera pull-back
  // showed a horizontal black band where the floor stopped. Size the floor to
  // the real arena with generous margin (±12000 PS1 ≈ ±4200 world).
  const ARENA_W = 8400;
  const ARENA_D = 8400;

  // Digimon billboard dimensions (world units)
  // 64px wide × 256px tall at model scale. Real models are ~100-200 units tall.
  // We display at 120 units tall × 30 units wide to preserve 1:4 aspect of texture page.
  const DIGI_H = 140;
  const DIGI_W = DIGI_H * (64 / 256);  // 35 — preserve page aspect ratio

  // Textures
  let arenaTexture = null;
  let skyTexture   = null;
  let playerTex    = null;
  let enemyTex     = null;
  let whiteTex     = null;

  // White 1×1 texture
  whiteTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, whiteTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]));

  // Arena floor static geometry
  const floorVerts = [
    [-ARENA_W/2, 0, -ARENA_D/2],
    [ ARENA_W/2, 0, -ARENA_D/2],
    [ ARENA_W/2, 0,  ARENA_D/2],
    [-ARENA_W/2, 0,  ARENA_D/2],
  ];
  const floorUVs = [[0,0],[1,0],[1,1],[0,1]];
  const floorBufs = makeQuadBuffers(gl, floorVerts, floorUVs);

  // Sky background: a SCREEN-SPACE quad (clip coords, drawn with an identity MVP)
  // so the gradient covers the whole viewport from EVERY camera. The old version
  // was a world quad parked at z=-ARENA_D behind the player — the default battle
  // camera looks the other way, so the entire background rendered as the black
  // clear color ("black wall" bug). z=0.9999 keeps it behind all scene depth.
  const skyBufs = makeQuadBuffers(gl, [
    [-1, -1, 0.9999], [1, -1, 0.9999], [1, 1, 0.9999], [-1, 1, 0.9999],
  ], [[0,0],[1,0],[1,1],[0,1]]);
  const IDENT_MVP = mat4Identity();

  // Arena floor texture. The old asset (assets/battle/arena/f000com1.png) was WRONG on two
  // counts: F000COM1..4 are the common EFFECT texture atlases (bursts/rings/flames — see
  // tech-effects-decode.md), not a ground texture, and it was decoded as raw 16bpp when the
  // format is 4bpp+CLUT, so it rendered as rainbow noise. So we build a clean procedural
  // ground: a soft radial gradient in the sky palette with a faint grid.
  //
  // NOT ours, and NOT a permanent truth: the disc DOES have authentic per-area arena art. The
  // developers' battle scene test (pro/wfightts.s) labels a 55-pack range MFSTG001-029 then
  // MEFT0030-0055, and against SFSTDATA i -> MEFT10<i> that reads
  //   MEFT1001-1029 = battle STAGE packs  (the per-AREA arenas: grass/snow/desert/forest/tech)
  //   MEFT1030-1055 = battle EFFECT packs (the per-ELEMENT special-attack backdrops below)
  // The 17 packs under assets/battle/backdrops/ are the EFFECTS (meft1033-1055). The STAGE
  // packs were never extracted, and the disc's per-area SELECTION rule is not yet settled, so
  // the generated floor above stands in for them. Evidence:
  // .dw3-research/playtest-battle-backdrops-2026-10-07/results.md.
  {
    const N = 128;
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = (x / (N - 1) - 0.5) * 2, dy = (y / (N - 1) - 0.5) * 2;
        const r = Math.min(1, Math.hypot(dx, dy));
        const k = 1 - r * r;                              // bright centre, dark edges
        const grid = ((x % 4 === 0) || (y % 4 === 0)) ? 6 : 0;   // ~260 world units/cell on the 8400 floor
        const i = (y * N + x) * 4;
        data[i]   = Math.round(0x14 + (0x2e - 0x14) * k) + grid;
        data[i+1] = Math.round(0x14 + (0x30 - 0x14) * k) + grid;
        data[i+2] = Math.round(0x20 + (0x46 - 0x20) * k) + grid;
        data[i+3] = 255;
      }
    }
    arenaTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, arenaTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // Build a gradient sky texture (dark blue-grey → lighter) using raw pixel data
  // so it works on both regular and OffscreenCanvas WebGL contexts.
  {
    const H64 = 64;
    const skyData = new Uint8Array(H64 * 4);
    for (let i = 0; i < H64; i++) {
      const t = i / (H64 - 1);
      // #0a0a14 → #1a1a2e → #2a2a44
      skyData[i*4+0] = Math.round(t < 0.5 ? (0x0a + (0x1a - 0x0a) * t * 2) : (0x1a + (0x2a - 0x1a) * (t - 0.5) * 2));
      skyData[i*4+1] = skyData[i*4+0]; // same as R for the grey-blue tones
      skyData[i*4+2] = Math.round(t < 0.5 ? (0x14 + (0x2e - 0x14) * t * 2) : (0x2e + (0x44 - 0x2e) * (t - 0.5) * 2));
      skyData[i*4+3] = 255;
    }
    skyTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, skyTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, H64, 0, gl.RGBA, gl.UNSIGNED_BYTE, skyData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // ── Special-attack per-element BACKDROP (MEFT1033-1055) ──
  // When a tech fires a special, the environment is replaced by a full-screen backdrop =
  // MEFT10<tech.sigEffect> (fallback meft1055 "data-field" when sigEffect==0). Per-element,
  // sigEffect-driven — CONFIRMED live 2026-07-07 (Inferno→meft1034 fire, Thunder Bolt→meft1045).
  // The backdrop is a 3D scene: each pack's own MESHES (wall ring + floor) drawn ADDITIVELY (abr=1)
  // through the SAME battle camera as the fighters (proven: the captured screen quads = these meshes
  // projected through the default camera). So we render each element's meshes live — no baked image,
  // no per-element capture; the geometry+textures come from tools/extract_backdrops.py. Verts are in
  // fight-model space (× MODEL_SCALE through ps1ToRenderMatrix, like op6/effect meshes). See §11-13.
  const BD_DELAY_MS = 850;      // windup before the backdrop replaces the arena
  const BD_HOLD_MS  = 3800;     // sustained backdrop duration — lingers past the impact + spin
                                // (spin completes ~2 s in; hold keeps the scene a beat after the hit)
  const BD_FALLBACK = "meft1055";
  let backdropManifest = null;                 // { byTech, bySig, fallbackSig }
  const backdropPacks  = {};                   // packName -> { floorTex, wallTex, floor:{vbo,ubo,count}, wall:{...} }
  let activeBackdrop   = null;                  // the pack shown during the current window
  let dataFieldOnAt    = 0;                     // performance.now() window during which it shows
  let dataFieldOffAt   = 0;

  fetch("assets/battle/backdrops/manifest.json")
    .then(r => r.json()).then(m => { backdropManifest = m; loadBackdropPack(BD_FALLBACK); })
    .catch(() => { backdropManifest = { byTech: {}, bySig: {} }; });

  // 121 ctrl frames @ ~60fps ≈ 2.0 s to reach the target spin, then hold (matches the cast window).
  const BD_ROT_MS = 121 / 60 * 1000;

  function _bdGroupBuf(g) {   // {page, spinDeg, pos:[x,y,z...], uv:[u,v...]} → {page, spinDeg, vbo, ubo, count}
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.pos), gl.STATIC_DRAW);
    const ubo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ubo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.uv), gl.STATIC_DRAW);
    return { page: g.page, spinDeg: g.spinDeg || 0, vbo, ubo, count: g.pos.length / 3 };
  }

  function loadBackdropPack(packName) {
    if (!packName) return null;
    let pk = backdropPacks[packName];
    if (pk) return pk;
    pk = { floorTex: loadTexture(gl, `assets/battle/backdrops/${packName}/floor.png`),
           wallTex:  loadTexture(gl, `assets/battle/backdrops/${packName}/wall.png`),
           groups: null };
    backdropPacks[packName] = pk;
    fetch(`assets/battle/backdrops/${packName}/geometry.json`)
      .then(r => r.json())
      .then(g => { pk.groups = (g.groups || []).map(_bdGroupBuf); })
      .catch(() => { pk.groups = []; });
    return pk;
  }

  // Resolve a casting tech id → its backdrop pack name (via the manifest's byTech→sigEffect→bySig).
  // Returns null for a BASIC attack (not in byTech): basics keep the normal arena, no backdrop swap.
  // techId == null (manual/debug) → the data-field fallback.
  function backdropEntryForTech(techId) {
    if (techId == null) return { pack: BD_FALLBACK, sound: -1 };
    const m = backdropManifest;
    if (!m || !m.byTech) return null;
    const sig = m.byTech[String(techId)];
    if (sig == null) return null;                       // basic attack → no backdrop
    const entry = (m.bySig && m.bySig[String(sig)]) || null;
    return { pack: (entry && entry.pack) || BD_FALLBACK, // sig 0 → data-field; else element pack
             sound: entry && entry.sound != null ? entry.sound : -1 };
  }
  function backdropPackForTech(techId) {
    return backdropEntryForTech(techId)?.pack ?? null;
  }

  // The element loop the current backdrop owns, and whether it is running. The original
  // keeps one voice handle per effect object (+0xe4) and stops it by (id, handle) when the
  // pack tears down — so the loop is tied to the backdrop's own lifetime, not to a side.
  let specialLoopKey = null;
  let specialLoopOn  = false;

  // ── When the special backdrop appears: the clip's OWN play-motion op ──
  //
  // The original does NOT put the backdrop up on a timer. It is the technique's action script
  // that selects it: the play-motion op `FIGHTSTG_F0x8008c2cc` (op4, `fightstg.s:9566`) fetches
  // the class-0x15 scene object and calls its `+0xe8` selector `FIGHTSTG_F0x800868c0`
  // (`fightstg.s:3921`) with the op's motion id; the selector rebuilds the scene from
  // `SFSTDATA[motion]` (`FIGHTSTG_F0x80086304`, `fightstg.s:3552`), i.e. `MEFT10<motion>`.
  // `fightstg.s:0x8008c364 lw $v0, 0xe8($a0)` / `:0x8008c36c jalr $v0` / `:0x8008c370 move_ $a1, $s0`.
  // A later op4 naming motion 0 (the return-to-base every attack clip ends with) re-selects the
  // area arena, so the backdrop comes back down at the clip's own final op.
  //
  // The field technique (clip 15) is `op4[1,56] / op4[0,56,15,15] / wait 90 / op4[0,0,30,30] /
  // wait 60` in every model that ships it, so its backdrop switches in at the clip's SECOND op —
  // the cast's first frame. A wall-clock windup is therefore not the original's rule and put the
  // flame backdrop at the cast's end; `armDataField`/`dataFieldMotion` below wire the op instead.
  let dataFieldOn     = false;   // true while a clip's op4 has the element pack selected
  let dataFieldArmed  = false;   // true while the cast in flight has an element pack at all
  function armDataField(techId) {
    const entry = backdropEntryForTech(techId);
    dataFieldArmed = !!entry;                           // basic attack: keep the normal arena
    dataFieldOn = false;
    if (!entry) return;
    activeBackdrop = loadBackdropPack(entry.pack);
    // sound == -1 on the data-field fallback (SFSTDATA rec 55 carries no sound), so a
    // sig-0 special is silent on this path in the original too — do not invent one.
    specialLoopKey = entry.sound >= 0 ? (specialLoopMap[String(entry.sound)] || null) : null;
  }
  // The THROW band's element pack: the item arm's motion id IS the sig (34/37/40/43/46/49/52
  // for the seven field items), so the pack is bySig[motion] — the same MEFT10<motion> pack the
  // tech path shows for that element. Item 84 rolls its motion, so its pack follows the rolled
  // element. Clips 14/17 (items 85-90) carry no op4, so arming is a no-op for them.
  function backdropEntryForSig(sig) {
    const m = backdropManifest;
    if (!m || !m.bySig || sig == null) return null;
    const entry = m.bySig[String(sig)];
    return entry ? { pack: entry.pack, sound: entry.sound != null ? entry.sound : -1 } : null;
  }
  function armThrowBackdrop(sig) {
    const entry = backdropEntryForSig(sig);
    dataFieldArmed = !!entry;
    dataFieldOn = false;
    if (!entry) return;
    activeBackdrop = loadBackdropPack(entry.pack);
    specialLoopKey = entry.sound >= 0 ? (specialLoopMap[String(entry.sound)] || null) : null;
  }
  /** The acting clip's op4 motion, straight from the VM: 0 = return to the arena, else the pack. */
  function dataFieldMotion(motion) {
    if (!dataFieldArmed) return;
    const m = motion | 0;
    if (m === 0) { dataFieldOn = false; syncSpecialLoop(false); }
    else if (m > 0) { dataFieldOn = true; syncSpecialLoop(true); }
  }

  // Debug / lab entry: pin the backdrop open on a wall clock (never the attack path).
  function triggerDataField(techId, now = performance.now()) {
    const entry = backdropEntryForTech(techId);
    if (!entry) return;                                 // basic attack: keep the normal arena
    activeBackdrop = loadBackdropPack(entry.pack);
    dataFieldOnAt  = now + BD_DELAY_MS;
    dataFieldOffAt = now + BD_DELAY_MS + BD_HOLD_MS;
    // sound == -1 on the data-field fallback (SFSTDATA rec 55 carries no sound), so a
    // sig-0 special is silent on this path in the original too — do not invent one.
    specialLoopKey = entry.sound >= 0 ? (specialLoopMap[String(entry.sound)] || null) : null;
  }

  // Hold the element loop for exactly as long as the backdrop is up.
  function syncSpecialLoop(active) {
    if (active && specialLoopKey && !specialLoopOn) {
      specialLoopOn = true;
      sfx?.playEffectLoop?.(specialLoopKey);
    } else if (!active && specialLoopOn) {
      specialLoopOn = false;
      sfx?.stopEffectLoop?.();
    }
  }
  // Pinned = held open past the auto-expiry window (the DNA presentation runs the
  // digital void for its whole ~25s script; runtime capture 2026-07-14 dnau_0400+).
  let dataFieldPinned = false;
  function dataFieldIsActive(now = performance.now()) {
    return activeBackdrop && activeBackdrop.groups && activeBackdrop.groups.length
      && (dataFieldPinned || dataFieldOn || (now >= dataFieldOnAt && now < dataFieldOffAt));
  }

  // ── Per-AREA battle STAGE arena (MEFT1001-1029) ──
  // The ordinary battle's environment is the disc's own per-area arena, a 3D scene of wall+floor
  // meshes drawn through the battle camera — the SAME object and pack format as the per-element
  // special backdrop, selected by the battle descriptor's arena id instead of a tech's sigEffect.
  //
  // Id source, decoded 2026-10-07: the field's battle-trigger record carries the arena id in its
  // `param` (u16 @record+0x4); fieldstg fn 0x800925a8 (random) and fn 0x800927a0 (scripted) copy
  // it to 0x80042b28, and wfightmn (:1010) builds the backdrop object from it; fightstg
  // F0x80086304 indexes SFSTDATA with it, and SFSTDATA record i -> MEFT10<i>. So the arena pack =
  // `MEFT10<param>`, 1..29. The extractor `tools/extract_arenas.py` ships the packs AND the
  // stage/screen -> arena-id table (read from each wstag overlay's own trigger records), so the
  // page only has to say which area and which encounter it is. Evidence:
  // .dw3-research/playtest-battle-arena-selector-2026-10-07/results.md.
  const ARENA_FALLBACK_ID = 1;
  let arenaManifest   = null;   // { byArena: {id: {pack}}, byStage: {stage: {screen: id, _default}} }
  let arenaStageReq   = null;   // { mapId, screenId } the page asked for
  let activeArena     = null;   // the loaded arena pack drawn in an ordinary battle
  let arenaBg         = null;   // the arena view's background colour (SFSTDATA +0x0c), 0..255
  const arenaPacks    = {};     // packName -> { name, tex, groups, blend }
  let arenaLegacy     = false;  // debug/before-after only: one palette per page + alpha blend
  // Debug switches for before/after captures. Defaults are the shipped decode: per-prim
  // palette, the ported back-face cull, the decoded OPAQUE blend, and the arena self-sorted
  // by depth (the original's ordering table — see `depthWrite` below). `cull:false` drops
  // the cull; `opaque:false` composites with alpha (the pre-decode look); `legacy:true`
  // uses the one-palette-per-page textures; `depthWrite:false` reproduces the fixed fault
  // (the arena drawn in texture-group order with no depth writes); `depthClear:false` reproduces
  // the fighter-depth regression (the arena writes depth but does NOT release it, so the fighters
  // drawn after it are depth-rejected). `depthClear` ships true — the fix — see the arena branch.
  let arenaDebug = { legacy: false, cull: true, opaque: true, voidRaw: false, depthWrite: true, depthClear: true };

  function setArenaLegacy(on) { arenaLegacy = !!on; arenaDebug.legacy = !!on; return arenaLegacy; }
  function setArenaDebug(d) {
    if (d && typeof d === "object") {
      if ("legacy" in d) arenaLegacy = !!d.legacy;
      arenaDebug = { legacy: arenaLegacy, cull: d.cull !== false, opaque: d.opaque !== false,
                     voidRaw: !!d.voidRaw,
                     depthWrite: "depthWrite" in d ? !!d.depthWrite : arenaDebug.depthWrite,
                     depthClear: "depthClear" in d ? !!d.depthClear : arenaDebug.depthClear };
    }
    return arenaDebug;
  }

  fetch("assets/battle/arenas/manifest.json")
    .then(r => r.json()).then(m => { arenaManifest = m; resolveArenaStage(); })
    .catch(() => { arenaManifest = { byArena: {}, byStage: {} }; });

  function _arenaGroupBuf(g) {   // same shape as _bdGroupBuf (static spinDeg == 0)
    const b = _bdGroupBuf(g);
    b.clut = Array.isArray(g.clut) ? g.clut : null;   // the layer's palette group (col,row)
    b.degenerate = !!g.degenerate;     // blank CLUT slot: the original only culls these away
    b.pos = g.pos;                     // kept for the per-frame back-face cull (arenaCullIndices)
    b.cullRef = g.cullRef || null;     // triangle -> the triangle whose projected sign governs it
    return b;
  }
  // Lazy per-(page, CLUT) texture: one PNG per palette group the pack's meshes reference,
  // `{page}_c{col}_r{row}.png` (tools/extract_arenas.py). The group's page+clut name the file.
  function arenaTextureFor(pk, g) {
    if (arenaLegacy) {   // debug/before-after: one palette per page, the pre-decode render
      const leg = `${g.page || "wall"}.png`;
      if (!pk.tex) pk.tex = {};
      if (!pk.tex[leg]) pk.tex[leg] = loadTexture(gl, `assets/battle/arenas/${pk.name}/${leg}`);
      return pk.tex[leg];
    }
    const col = g.clut ? g.clut[0] : 0, row = g.clut ? g.clut[1] : 255;
    const key = `${g.page || "wall"}_c${col}_r${row}`;
    const file = arenaDebug.voidRaw ? `${key}_void.png` : `${key}.png`;
    if (!pk.tex) pk.tex = {};
    if (!pk.tex[file]) pk.tex[file] = loadTexture(gl, `assets/battle/arenas/${pk.name}/${file}`);
    return pk.tex[file];
  }
  function loadArenaPack(packName) {
    if (!packName) return null;
    let pk = arenaPacks[packName];
    if (pk) return pk;
    pk = { name: packName, tex: {}, groups: null, blend: "opaque" };
    arenaPacks[packName] = pk;
    fetch(`assets/battle/arenas/${packName}/geometry.json`)
      .then(r => r.json())
      .then(g => { pk.blend = g.blend || "opaque"; pk.groups = (g.groups || []).map(_arenaGroupBuf); })
      .catch(() => { pk.groups = []; });
    return pk;
  }
  // The arena id for a battle started on `mapId` with encounter `screenId`: the record's own
  // param, else the stage's default, else the fallback. null when the stage is unknown.
  function arenaIdFor(mapId, screenId) {
    if (!arenaManifest || mapId == null) return null;
    const stage = String(mapId).replace(/^s/, "");
    const e = arenaManifest.byStage?.[stage];
    if (!e) return null;
    if (screenId != null && e[String(screenId)] != null) return e[String(screenId)];
    return e._default ?? null;
  }
  function resolveArenaStage() {
    const id = arenaIdFor(arenaStageReq?.mapId, arenaStageReq?.screenId);
    // No field screen at all -> no disc arena (the debug entry clears it, so a before/after
    // capture can show the pre-change generated grid). An unknown-but-present screen keeps the
    // fallback pack so an ordinary battle always has the disc's environment.
    const use = arenaStageReq?.mapId == null ? null
      : (id == null ? ARENA_FALLBACK_ID : id);
    activeArena = use == null ? null : loadArenaPack(`meft10${String(use).padStart(2, "0")}`);
    const bg = use == null ? null : arenaManifest?.byArena?.[String(use)]?.bg ?? null;
    arenaBg = Array.isArray(bg)
      ? [Math.max(0, Math.min(255, bg[0] | 0)) / 255,
         Math.max(0, Math.min(255, bg[1] | 0)) / 255,
         Math.max(0, Math.min(255, bg[2] | 0)) / 255, 1]
      : null;
  }
  // Called by web/battle.js when a battle opens, with the field screen it started on and the
  // encounter id it rolled — the two values the original's battle descriptor carries.
  function setArenaStage(mapId, screenId) {
    arenaStageReq = { mapId: mapId ?? null, screenId: screenId ?? null };
    resolveArenaStage();
    return activeArena ? activeArena : null;
  }

  // State
  let playerFolder   = null;
  let enemyFolder    = null;
  let animTime       = 0;
  let playerAnim     = "idle";
  let enemyAnim      = "idle";

  // Skeletal model state
  let playerModel    = null;   // resolved anim.json or null
  let enemyModel     = null;
  let playerSkelBufs = null;   // GL buffers for skeletal mesh
  let enemySkelBufs  = null;
  // The close-up box's own position buffer (the same indices/UVs as the battle view's, its
  // own placement) plus the bone world matrices from this frame's skin pass, kept so the box
  // can reuse them. The box's subject is the player's fighter (faceBoxSource), so there is
  // one of these, not one per side.
  let playerBoxBufs  = null;
  let pBwm = null, eBwm = null;

  function _faceBoxBuffers(gl) {
    const src = playerSkelBufs;
    let box = playerBoxBufs;
    if (!src) return null;
    if (!box) {
      // Same UBO/IBO, a private VBO: _updateSkeletalVBOGL re-uploads positions into it.
      box = { ...src, vbo: gl.createBuffer() };
      playerBoxBufs = box;
    } else {
      box.ubo = src.ubo; box.ibo = src.ibo; box.indexCount = src.indexCount;
      box.totalVerts = src.totalVerts; box.boneOffsets = src.boneOffsets;
    }
    return box;
  }
  function _freeFaceBoxBuffers(gl) {
    if (playerBoxBufs?.vbo) gl.deleteBuffer(playerBoxBufs.vbo);
    playerBoxBufs = null;
  }
  let playerFrame    = 0;
  let enemyFrame     = 0;
  let playerAnim8r   = null;   // ActorAnimator: idle TimelinePlayer <-> action ActionVM
  let enemyAnim8r    = null;
  let playerVisible  = true;   // sequence 0x38 hides the outgoing actor before its prompt
  // Sequences attacker action -> defender reaction (flinch on each type-98 contact, fall/death on
  // the final type-99 strike). Owns per-tick stepping of both actors; its player/enemy refs are
  // re-synced whenever an animator is (re)created.
  const coordinator  = new FightCoordinator(null, null);
  let _coordWasActive = false;   // edge-detect attack end to key-off sustained battle voices

  // ── Visual effect system (op3) ─────────────────────────────────────────────
  // Decoded 2026-07-05 (docs/research/fight-3d/tech-effects-decode.md): op3 spawns registry
  // effects (eNNN pack programs over F000COM/per-model RLEN sprite sheets). The EffectPlayer
  // steps instances on the same fixed tick as the actors; battle.js composites the sprites
  // over the GL frame via getEffectDraw() (the sheets are 2D — the original draws them as
  // screen-space GPU sprites through F0x8008921c). The tech table load also feeds
  // fight-tables.techRecord (real clip + effect type per tech, replacing the range rule).
  let effectPlayer = null;
  let effectAssets = null;
  let screenOverlay = null; // op7 full-screen monochrome primitive (DNA result clip 12)
  fetch("assets/data/fight_tech_table.json")
    .then(r => (r.ok ? r.json() : null)).then(setTechTable).catch(() => {});
  // The donor for clips a model lacks (enemy-only species): a player species with the whole set. Greymon's pack.
  fetch("assets/battle/models/m005grey/anim.json")
    .then(r => (r.ok ? r.json() : null)).then(j => setFallbackDonor(j?.actions)).catch(() => {});
  // The item machine's use-effect table (fightstg 0x800a336c, tools/extract_item_use_effects.py):
  // the used item's op3 effect type and its op10 contact sound. Feeds playPlayerItemUse below.
  fetch("assets/data/item_use_effects.json")
    .then(r => (r.ok ? r.json() : null)).then(setItemUseEffects).catch(() => {});
  // The item machine's THROW-band table (fightstg 0x80082ee4's typed arms,
  // tools/extract_throw_item_effects.py): per item 77-90 the clip, motion, effect and sound its
  // arm writes. Feeds playPlayerThrowItem below.
  fetch("assets/data/throw_item_effects.json")
    .then(r => (r.ok ? r.json() : null)).then(setThrowItemEffects).catch(() => {});
  loadEffectAssets().then(a => {
    effectAssets = a;
    effectPlayer = new EffectPlayer(a.manifest);
  }).catch(() => {});

  // op10 battle-sound map (type -> sfx key), built by build_sfx.py from the
  // decoded 0x800a368c table. Played on every op10 via _fxHooks (both sides).
  let op10Map = {};
  fetch("assets/sfx/op10_map.json")
    .then((r) => (r.ok ? r.json() : {}))
    .then((m) => { op10Map = m || {}; })
    .catch(() => { op10Map = {}; });

  // Per-Digimon arena placement (pro/smdldata.s, resource 0x1cc), extracted by
  // tools/extract_smdldata.py. Both fighters' slot positions come from their OWN
  // record: neither the distance nor the height is an arena constant.
  let placementTable = {};
  // Animated texture patches: the CPU-side page and the variant selector, per fighter.
  let playerPatches = null, playerPage = null;
  let enemyPatches = null, enemyPage = null;
  // What F0x8008b118 reads to decide whether to hold a fighter's eyes: the model
  // actor's +0x78, which FIGHTSTG_F0x80083a54 keeps as the playing timeline table
  // plus one. Table 0 is the idle, so an idling Digimon sits at 1 and blinks — the
  // same value F0x80083f90 writes when it creates the object. `null` = follow the
  // animator; a number is the debug hold.
  let playerPatchHold = null, enemyPatchHold = null;
  function patchState(side) {
    const hold = side === "enemy" ? enemyPatchHold : playerPatchHold;
    if (hold !== null) return hold;
    const a = side === "enemy" ? enemyAnim8r : playerAnim8r;
    return a ? a.animationId : 1;
  }

  // Start (or clear) a fighter's patch animation. Both halves land asynchronously and
  // either may arrive first, so this is called again when the placement table lands.
  function setupTexturePatches(side, folder) {
    const entries = placementTable[modelKeyFromFolder(folder)]?.texture_anim;
    const animator = entries && entries.length ? new TexturePatchAnimator(entries) : null;
    if (side === "player") playerPatches = animator; else enemyPatches = animator;
    if (!animator) return;
    loadTexturePixels(`assets/battle/textures/${folder}.png`).then((page) => {
      if (side === "player" && folder === playerFolder) playerPage = page;
      else if (side === "enemy" && folder === enemyFolder) enemyPage = page;
    });
  }

  fetch(`${PLACEMENT_URL}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => {
      placementTable = m?.models || {};
      // A model can finish loading before this table does; re-seat whatever is already up.
      if (playerAnim8r) playerAnim8r.homeSlot = arenaSlotFor(playerFolder, "player", placementTable);
      if (enemyAnim8r)  enemyAnim8r.homeSlot  = arenaSlotFor(enemyFolder,  "enemy",  placementTable);
      for (const f of extras.values()) {   // (multiplayer fighters that loaded first)
        if (f.anim8r) f.anim8r.homeSlot = arenaSlotFor(f.folder, f.side, placementTable);
        if (f.model && !f.patches) _setupExtraPatches(f);
      }
      if (playerFolder && !playerPatches) setupTexturePatches("player", playerFolder);
      if (enemyFolder && !enemyPatches) setupTexturePatches("enemy", enemyFolder);
      if (introCamPending) applyArenaShot();
    })
    .catch(() => { placementTable = {}; });

  // One animated texture patch, copied from one of its three source rectangles over
  // its destination — the walker's stand-in for the original's per-frame VRAM copy.
  // Nothing is uploaded unless the chosen picture actually changed, which is also how
  // the original behaves: it caches the last variant per entry.
  function blitTexturePatch(tex, page, entry) {
    if (!tex || !page) return false;
    const r = texturePatchRect(entry, page.scale);
    if (r.w <= 0 || r.h <= 0 || r.x0 + r.w > page.width || r.y0 + r.h > page.height) return false;
    const rect = new Uint8Array(r.w * r.h * 4);
    for (let row = 0; row < r.h; row++) {
      const from = ((r.y0 + row) * page.width + r.x0) * 4;
      rect.set(page.data.subarray(from, from + r.w * 4), row * r.w * 4);
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, r.dx, r.dy, r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, rect);
    return true;
  }

  // An op5 canned shot, read from the record of the Digimon standing in the slot the
  // preset names. Falls back to the captured Renamon/Woodmon table if that record is not
  // loaded yet.
  function cannedShot(preset) {
    const sel = op5ShotSlot(preset);
    if (!sel) return null;
    const slot = cannedShotSlot(sel.side, sel.index);
    return slot || OP5_PRESETS[preset] || null;
  }

  // F0x800923b4 (the camera object's +0x104) as the idle director's arms call it: `a1` is
  // the side — 0 the NEAR table, 0x10 the FAR one — and `a2` the 0-based shot out of the
  // twelve (near) or three (far) that side's own Digimon record stores. This is the same
  // read `cannedShot` already made, named by slot instead of by op5 preset, because the
  // director passes the two arguments directly (fightstg.s:4766-4778, :4804-4812).
  function cannedShotSlot(side, index) {
    const key = modelKeyFromFolder(side === "player" ? playerFolder : enemyFolder);
    const cam = key ? placementTable[key]?.camera : null;
    const eye = cam?.eye?.[index], look = cam?.look?.[index];
    if (eye && look) return { eye, target: look, H: cam.view?.[index] };
    return null;
  }

  // F0x8008c93c's opening cut: `camMgr->[0x104](0, 0xb)`. F0x800923b4 reads a1 for the
  // side (0 = the near table) and a2 for the shot, so this is NEAR shot 11 out of OUR
  // own record — the same entry op5 preset 4 reads, since it is near index p + 7.
  function lossShot() {
    const key = modelKeyFromFolder(playerFolder);
    const cam = key ? placementTable[key]?.camera : null;
    const i = LOSS_CAM.shotIndex;
    const eye = cam?.eye?.[i], look = cam?.look?.[i];
    if (eye && look) return { eye, target: look, H: cam.view?.[i] };
    return null;
  }

  // FIGHTSTG_F0x800880f0 opens the fight, in its sub-state 0, by calling the camera
  // object's +0x100 method and applying the result instantly (+0xf8). That method,
  // FIGHTSTG_F0x8009257c, reads the FAR-side fighter's record for a 1-based canned shot
  // number and frames the NEAR side with it — the enemy chooses which of our Digimon's
  // twelve stored shots the battle opens on (claim
  // smdldata-record-0x44-is-the-far-side-canned-shot-number-2026-08-18). One read, one
  // place: arenaShotFor owns it, and returns null when the enemy's record carries no such
  // word, which is the case for every 0xC4 (partner) record.
  function introShot() {
    return arenaShotFor(placementTable, playerFolder, enemyFolder);
  }
  // The opening shot is the arena shot, installed as the record: FIGHTSTG_F0x800880f0 cuts it
  // with `[0xf8]` and the camera director then holds that same record, re-publishing it every
  // frame until its dwell runs out. So it goes through the one record owner like any other cut,
  // and the idle director takes the SAME `[0x100]` provider this does, so the shot it opens
  // on and the shot its arms re-take are the one the original would read.
  let introCamPending = false;
  function applyArenaShot() {
    const shot = introShot();
    introCamPending = !shot;
    if (!shot) return null;
    camRec.cut(fieldsFromShot(shot), { issuer: "battle" });
    return shot;
  }

  // op10 type 89 = EX_AT_LP (0x20040006), the sustained signature-attack whirl, and
  // type 91 = its stop. Held open by the explicit marker, not by a duration.
  const SUSTAINED_LOOP_TYPE = 89;
  const SUSTAINED_LOOP_KEY  = "ex_at_lp";

  // Per-element special-attack loop (SFSTDATA rec[+0x08] -> fightstg 0x800a2498).
  // sound index -> sfx key (bt_loop0..7), built by build_sfx.py.
  let specialLoopMap = {};
  fetch("assets/sfx/special_loop_map.json")
    .then((r) => (r.ok ? r.json() : {}))
    .then((m) => { specialLoopMap = m || {}; })
    .catch(() => { specialLoopMap = {}; });

  // Contact op10 types 98/99 are not table entries themselves. The real game
  // rewrites them through the action context's +0x70 field:
  //   F0x8008f1a8: context+0x70 = tech+0x0f; plain clip-5 basic -> 0x1e.
  //   F0x8008c454: op10 98/99 pass context+0x70 into F0x8009b774 —
  //   unless the contact evaded, in which case the substitute is COMEX102
  //   (type 0x38 = 56; see resolveContactSoundType at the top of this file).
  const contactSoundType = { player: null, enemy: null };
  // The live attack's evade state, so the contact markers know which sound this
  // contact makes. Set with contactSoundType by the attack entries below; the
  // original decides per contact result, our battle knows the whole-attack miss.
  const contactEvade = { player: false, enemy: false };
  function contactSoundTypeFor(techId) {
    const rec = techRecord(techId);
    if (!rec) return (techId >= 1 && techId <= 52) ? 30 : null;
    return (rec.effect === 0 && rec.clip === 5) ? 30 : rec.motion;
  }

  // ── op6 3D mesh effects (Pepper Breath fireball, Positron Laser, etc.) ─────
  // Decoded 2026-07-05/06: the MEFT 0x18 mesh body = SVECTOR verts + a GTE display list of
  // textured quads; atlas = 4bpp indexed 256×256 + embedded CLUT. Each layer additionally
  // carries a ctrl bin (fightstg F0x800835f4): keyframed translation/rotation/scale tracks
  // {frame,x,y,z} — the projectile's TRAVEL is the translation track (local z ramping across
  // the arena), oriented by the op6 root rotation (`to` angles; 180° yaw toward the enemy).
  // Extractor emits proj/{id}.json (+tracks) + per-CLUT atlas PNGs; we lazy-load per id,
  // build one static VBO per layer, and animate each layer's TRS from its tracks per frame.
  const projCache = new Map();   // id -> { tex, layers:[{vbo,ubo,count}] } | "loading" | null
  const PROJ_BASE = "assets/battle/effects/proj";
  function loadProjMesh(id) {
    if (projCache.has(id)) return;
    projCache.set(id, "loading");
    fetch(`${PROJ_BASE}/${id}.json`).then(r => (r.ok ? r.json() : null)).then(def => {
      if (!def) { projCache.set(id, null); return; }
      const [tw, th] = def.tex_size || [256, 256];      // 4bpp indexed VRAM page
      const layers = [];
      for (const L of def.layers) {
        // A layer's primitives do NOT all share one palette or one blend: the tex-op sets the
        // CLUT per primitive (183 of the 572 shipped layers name more than one), and the
        // `0xEn` state can change between primitives too. So the layer is split into draw
        // groups keyed by (palette, blend) and each group gets its own atlas and blend state.
        const groups = new Map();
        // When the layer carries its raw display list (layer.dl), the ported loop
        // F0x80085110 (engine/dw3/battle-displaylist.ts, via web/fight/display-list.js)
        // is the authority for each primitive's draw state — its s48 ABR nibble and
        // its s3c/s30/s40 flags. Without raw bytes the loader falls back to the
        // extractor's flattened per-primitive `abr`.
        const dlStates = Array.isArray(L.dl) ? meshPrimitiveStates(Uint8Array.from(L.dl)) : null;
        for (let pi = 0; pi < L.prims.length; pi++) {
          const pr = L.prims[pi];
          if (!pr.textured || !pr.uv) continue;          // color-only GTE prims: not drawn yet
          const clut = pr.clut ? `${pr.clut[0]}_${pr.clut[1]}` : "";
          // The extracted `abr` is the RAW `0xEn` nibble, a ONE-BASED selector; meshAbrMode
          // turns it into the hardware mode, or null when the primitive is opaque.
          const abr = meshAbrMode(dlStates && dlStates[pi] ? dlStates[pi].abr : (pr.abr ?? 2));
          const key = `${clut}|${abr}`;
          let g = groups.get(key);
          if (!g) {
            g = { pos: [], uv: [], abr, tex: L.tex_by_clut?.[clut] ?? L.tex ?? null };
            groups.set(key, g);
          }
          const tri = pr.idx.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2];
          for (const c of tri) {
            const v = L.verts[pr.idx[c]] || [0, 0, 0];
            g.pos.push(v[0], v[1], v[2]);
            g.uv.push(pr.uv[c][0] / tw, pr.uv[c][1] / th);
          }
        }
        const drawn = [];
        let total = 0;
        for (const g of groups.values()) {
          if (!g.pos.length) continue;
          const vbo = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.pos), gl.STATIC_DRAW);
          const ubo = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, ubo);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.uv), gl.STATIC_DRAW);
          const rec = { vbo, ubo, count: g.pos.length / 3, abr: g.abr,
                        texReady: !g.tex, tex: null };
          // `texReady` exists only so a headless capture can wait for the atlas: loadTexture
          // returns a 1x1 placeholder immediately and swaps the real image in later, so the
          // texture handle being non-null is not evidence that anything is drawable yet.
          if (g.tex) rec.tex = loadTexture(gl, `${PROJ_BASE}/${g.tex}`, () => { rec.texReady = true; });
          drawn.push(rec);
          total += rec.count;
        }
        // A geometry-less layer is still kept: it can be the PARENT of one that draws, and
        // the transform chain below indexes by position. `count === 0` means "transform
        // node only", which is also what the game's implicit root layer 0 is.
        //
        // `parent` is the program row's first u32 (FIGHTSTG_F0x80084560 copies it to
        // layer+0x00; F0x80083e0c turns it into the parent's matrix pointer). 0 = the
        // implicit root node, which is where op6's from/to are written each frame. Packs
        // extracted before the field was decoded have no `parent` — treat those as flat.
        layers.push({ groups: drawn, count: total, tracks: L.tracks || null,
                      parent: L.parent ?? 0 });
      }
      // The pack's playback clip decides which authored frame each tick samples, and how
      // long the flight lives. Null for a pack whose clip did not decode; clipFrameAt then
      // falls back to using the tick directly.
      projCache.set(id, { layers, clip: def.clip || null });
    }).catch(() => projCache.set(id, null));
  }
  // Warm the projectile-mesh cache for one model's actions so the bullet is ready at the
  // muzzle-exit frame (no async-load gap). Called when a model's anim.json actions load.
  function preloadModelProjectiles(actions) {
    if (!Array.isArray(actions)) return;
    for (const a of actions) {
      for (const o of a?.ops || []) {
        if (o.op === 6) { const id = o.words?.[1]; if (id != null) loadProjMesh(id); }
      }
    }
  }
  // Flight-space -> render world. op6's operands are y/z-negated by the VM, which reconciles
  // them to the SAME rendered frame op3 effects use — so this is exactly op3's worldToScreen
  // world computation, which is ps1ToRender. `from` coincides with the op3 muzzle
  // flash (verified on Armormon), so the bullet launches from the gun barrel. Enemy-issued
  // flights are NOT mirrored for the far side, as op3 is not: the op6 handler stores its
  // two triples with no side test, and the shipped root yaw is 2048 (180°) in 223 of the 224
  // player-side records and 0 in all 121 enemy-side ones — the data is authored per side.
  function projWorld(pos, side) {
    return ps1ToRender(pos, MODEL_SCALE);
  }

  // Effect-spawn hook for one side's action VM (op3 sub=0 → spawn at actor-relative pos).
  function _fxHooks(side, extra) {
    const e = extra || {};
    return {
      ...e,
      onEffect: (rec) => { effectPlayer?.spawn(rec.type, rec, side); e.onEffect?.(rec); },
      onHit: (rec) => {
        // Mapped op10s play common-bank sound table[type] (0x800a368c). Contact
        // markers 98/99 first resolve through the attack context's +0x70 value —
        // or through COMEX102 when the contact evaded (F0x8008c454, result 3).
        const t = resolveContactSoundType(rec.type, contactSoundType[side], contactEvade[side]);
        const key = (t != null) ? op10Map[String(t)] : null;
        // ExVeemon/Stingmon Jogress clip 12 emits op10 type 66.  The original
        // table entry is packed 0x41180000: area bank jog_00, JOGRESSE sample.
        if (t === 66 && sfx) sfx.playBank?.("jog_00", "jogresse");
        // Types 90 and 91 never reach the 0x800a368c table: F0x8009b774 tests
        // them first. 91 stops EX_AT_LP through the immediate-stop entry, which
        // is what closes the whirl every signature clip 11 opens with type 89.
        // 90 replays whatever id is saved at [0x80042b30] and is emitted once,
        // by the DNA Jogress clip 12 — but the only writer of that register
        // inside fightstg is one stage-specific case (F0x80086a00, 0x80086ea0),
        // so what it holds during a Jogress is not established and nothing is
        // wired for it. Do not guess a track here.
        else if (t === 91 && sfx) sfx.stopSustained?.(SUSTAINED_LOOP_KEY);
        else if (t === SUSTAINED_LOOP_TYPE && sfx) sfx.playSustained?.(SUSTAINED_LOOP_KEY);
        else if (key && sfx) sfx.playBattle(key, side, rec.words?.[1] ?? 0);
        e.onHit?.(rec);
      },
      // op6 = projectile flight (registry @0x800a2550 -> MEFT00xx mesh packs). sub=1 is
      // the readiness poll (F0x8008bea8 rewinds until the pack loads) — kick the async mesh
      // fetch there so the mesh is ready by the sub=0 spawn. sub=0 launches the flight.
      setLunge: (l) => {
        if (l && effectPlayer) {
          const id = l.id ?? l.words?.[1];
          if (l.sub === 1 && id != null) loadProjMesh(id);
          else if (l.sub === 0 && l.from) effectPlayer.spawnProjectile(id, l.from, l.to, side);
        }
        e.setLunge?.(l);
      },
    };
  }
  // Projection snapshot for getEffectDraw (written each render()).
  let _fxView = null;

  // Fixed PS1 logic tick: accumulate real dt, step the sim at STEP_HZ.
  // D0x800a4464 (the sampler's per-tick playhead step, read in FIGHTSTG_F0x80083c30) is NOT a fixed
  // animation speed: RAM dumps read it as 3 and 4 across battles (~/vm-spike/dumps; see
  // action-vm-dispatch.md §g.3), so it is a per-tick VSYNC/FRAME DELTA (frames elapsed this logic
  // update) — write-site is a vsync IRQ outside ddw3's asm. The earlier savestate "= 2" was one sample
  // of that dynamic value, NOT a constant.
  //
  // ⇒ At a steady frame rate the delta is ~1 frame/vsync, so the evidence-backed step is 1 at
  // STEP_HZ=60 ("fix A", user decision 2026-06-21): advance ONE table entry per 60 Hz tick → every
  // authored frame is drawn, no skipping. (The old GLOBAL_SPEED=2 @ STEP_HZ=30 skipped every other
  // entry — the visible frame-skip.) Sync-ramp release is delta-invariant (≈ 0x1000/speed real
  // frames), so this cadence is also correct for the op2 mode-5 waits. `let` so the Fight Action Lab
  // speed slider (debugSetSpeed) can A/B live.  The live walker uses 2 as a user-requested visual
  // preference (2026-07-17); this is deliberately not an original-game timing claim.
  const STEP_HZ = 60;
  // `let` (not const) so the Fight Action Lab's speed slider (debugSetSpeed) can A/B timing live.
  let GLOBAL_SPEED = 2;
  let _acc = 0;

  // ── Slow motion: `[0x800a4548](level)` (F0x8009e510 / F0x8009e428) ────────────
  // The level is a global in the original, read once a frame by the stepper and published
  // to 0x800a4464 — the per-frame delta the BATTLE's animation and motion timers consume.
  // Only the loss effect's phase 0 (F0x8008c93c .L0x8008ca48-.L0x8008ca58) ever sets 2 on the
  // loss path, so this is the whole of slow motion in a battle. The camera is NOT on this
  // clock: the orbit reads `[0x8004df9c]()` directly (.L0x8008cad4), and the pointer at
  // 0x8004df9c is never swapped.
  //
  // Arming mirrors F0x8009e510: it stores the level at 0x800a453c, ZEROES the accumulator
  // (0x800a4540) and calls the stepper once, so the first frame after arming already
  // publishes (level 2 with an empty accumulator publishes 0).
  let slowMoLevel   = 0;   // 0 = the raw frame delta, 1 = frozen, 2 = quarter, 3 = double
  let slowMoAcc     = 0;   // the stepper's remainder, 0x800a4540
  let slowMoDelta   = 1;   // the last value the stepper published to 0x800a4464
  let slowMoTickSpeed = GLOBAL_SPEED;  // the GLOBAL_SPEED the last logic tick actually ran at
  let slowMoTicks   = 0;   // logic ticks the stepper has run, and the units it has published
  let slowMoUnits   = 0;

  // Model scale: one global units-per-PS1-unit factor applied to every model, so relative
  // sizes are preserved (bigger Digimon render bigger — "scale-aware"). The camera frames
  // each model by its actual rendered height (see render()), so big models stay in frame.
  // The constant lives at module scope so a test can project through the real mapping.

  // ── Cinematic battle camera ────────────────────────────────────────────────
  // Mirrors the PS1 battle camera (D0x80081358, built by F0x8002a1ac): a look-at that
  // rotates around the target by an angle. It always frames OUR digimon.
  //   "behind" = over-the-shoulder, looking past our digimon toward the enemy (intro/attack)
  //   "orbit"  = slow sweep around our digimon while we idle / pick a command
  //   "defeat" = the loss effect's own shot: our Digimon's canned near shot 11, orbiting
  let camMode      = "director"; // "director" | "behind" | "orbit" | "game" | "tag" | "defeat"
  let camAz        = 0;          // current azimuth offset from straight-behind (rad)
  let orbitClock   = 0;          // drives the idle sweep
  // The defeat effect's own clock. F0x8008c93c adds the raw `[0x8004df9c]()` delta,
  // 1 a frame, times 2 to the shot frame's Y angle; slow motion never touches this path.
  let defeatDelta  = 0;          // raw game delta consumed since the shot was cut
  let defeatClock  = 0;          // seconds since the shot was cut
  // The idle director's clock, on the same footing: its dwell counter and its turn both run on
  // `[0x8004df9c]()` (fightstg.s:5149-5152 for the dwell, :5060-5072 for the turn), so the
  // seconds a render frame took are turned into the frames since the last tick here and
  // nowhere else — see createIdleClock for why that is the difference between the running total
  // and the per-frame delta.
  const idleClock = createIdleClock(LOSS_CAM.deltaPerFrame);
  // The 14 words the director last published while it was running (its held shot). While a script
  // owns the camera the director is NOT called, so its dwell is not spent and this record does not
  // move; the frame owner still cuts it, so the camera returns to the idle shot the moment the
  // script releases it. See the render camera block.
  let directorHeld = null;
  let pAABB        = null;       // player mesh world AABB this frame (scale-aware framing)
  let eAABBLast    = null;       // enemy mesh world AABB this frame (debug read-out only)
  let faceCamRect  = null;       // {x,y,w,h} in offscreen px — native battle portrait viewport
  // The close-up face box is NOT a flag: it is one object of the original's battle HUD
  // (engine/dw3/ui/native/battle-face-box.ts). The HUD's build arm allocates it, a battle
  // message line's owner sends it to its terminal state, the exe's child walk frees it and
  // empties the parent's child slot, and the next build arm allocates a fresh one — which
  // is why it is up at each round's command menu and gone while a line is up. battle.js
  // hands the rule the HUD's three facts each frame through syncFaceBox.
  const faceBox = createBattleFaceBox();
  let faceBoxOnScreen = false;   // the object's own answer, from the rule above
  // A presentation owns the whole screen (Blast, digivolve, the clip-12 Jogress), so the
  // inset is suppressed on top of the rule. That is the walker's own presentation gate,
  // not the original's on/off rule.
  let faceBoxSuppressed = false;
  // The 100x60 picture box (layer key 0x1009) shows the SPEAKING side's active
  // combatant. Speaker id 0 is the player side and 0x10 the enemy side (the id
  // byte's high nibble selects the side); battle.js sets this per actor beat.
  let faceCamSpeaker = "player";
  // Which model record the box took its close-up out of this frame, and both
  // fighters' own model keys beside it. The subject is the PLAYER's fighter
  // whatever the speaker is (F0x80094064 hands the box one fighter record and
  // its +0x14; docs/research/battle/battle-hud-ownership-check-2026-10-03.md
  // §6.2), so this is the read-out tools/verify_battle_face_speaker.mjs asserts
  // the rule on. Null until the renderer has drawn a frame.
  let faceBoxSubject = null;
  // "game" camera = the REAL PS1 battle camera (session-23 dump): absolute eye/target in PS1
  // world (through ps1ToRender). eye≈(-3840,-2432,-4608), target≈(0,-2048,768), FOV~60°.
  // Knobs: side=±1 mirror across the battle line, zoom=distance mult, height=eye/look Y mult.
  // fovDeg is a VERTICAL fov, like every other camera here: 2*atan(120/280) for the reset
  // shot's H=280. It read 60 - that shot's HORIZONTAL fov - which framed the debug camera
  // 0.75x off the screen scale the 2D effect layer draws in.
  const gameCam = { side: 1, zoom: 1.0, height: 1.0, fovDeg: 46.4 };
  // The battle's IDLE camera is the original's cut director, FIGHTSTG_F0x8008718c, ported in
  // web/fight/battle-idle-director.js: four fixed shot lists out of the table at 0x800a24b8,
  // one rand_u16 % 3 between them, and a dwell in RAW per-frame deltas. It asks this module
  // for the same two shots the original asks the camera object for — `[0x100]` the arena shot
  // and `[0x104](side, index)` a canned shot — and returns the 14-word record it cuts that
  // tick, which is published through the one record owner below.
  // The director OBJECT exists only while the command menu is up. The disc creates it on the
  // fightstg command-menu phase's "build a row's children" arm and FREES it on the command
  // screen's confirm edge (`.dw3-research/attack-camera-retire-2026-10-08/worker-bb.md`): the
  // confirm writes state 3, the exe runs one terminal tick that re-cuts the plain arena shot
  // and then destroys the object, and nothing re-publishes the record for the rest of the
  // attack. `makeIdleDirector` builds a FRESH one on the next turn, which opens on row 3's
  // plain arena shot again — the same shot the retire cut, because state 0 arms row 3 and the
  // state-3 recut takes the same `[0x100]` arena shot.
  function makeIdleDirector() {
    return createIdleDirector({
      arena: () => { const s = introShot(); return s ? fieldsFromShot(s) : null; },
      canned: (side, index) => {
        const s = cannedShotSlot(side, index);
        return s ? fieldsFromShot(s) : null;
      },
    });
  }
  // The live director, or null while it does not exist (before the first menu, and for the
  // whole attack after the confirm edge retires it).
  let idleDirector = null;
  // True while the director is GONE: the record holds whatever was last cut (the retire's arena
  // shot, or an action's own op5) and the battle's camera must not republish over it — which is
  // the disc's "nothing re-publishes while the object does not exist".
  let directorRetired = false;
  /** The confirm edge: run the director's terminal state-3 tick, cut its arena shot, free it. */
  function retireIdleDirector() {
    if (!idleDirector) return;             // never created this turn — nothing to retire
    const r = idleDirector.retire();
    idleDirector = null;
    directorRetired = true;
    if (r) { directorHeld = r; camRec.cut(r, { issuer: "battle" }); }
  }

  // ── The battle-open camera flourish ─────────────────────────────────────────
  // The disc opens a battle with a short random camera beat over the arena before the first
  // command menu: the object FIGHTSTG_F0x800a1fe0 (class 0x800a1fe0), the battle controller's
  // child slot 6, created ONCE per battle in the opening machine's phase-1 fighter-load body
  // (`wfightmn.s:1175-1178`). On its first tick it picks one of THREE rows with `rand_u16 & 3`
  // and plays it — row 0 a pan, rows 1/2 a cut to a far/near canned angle that glides back —
  // then re-cuts the plain arena shot and self-destructs. It is the SECOND camera-sequence
  // driver of the family whose first member is the idle director, and it OWNS the camera for
  // the whole opening until its row ends. Ported once in engine/dw3/battle-open-camera.ts; this
  // drives it through the one camera-record owner, exactly as the idle director drives its arms.
  function makeOpenCamera() {
    return createBattleOpenCamera({
      arena: () => { const s = introShot(); return s ? fieldsFromShot(s) : null; },
      canned: (side, index) => {
        const s = cannedShotSlot(side, index);
        return s ? fieldsFromShot(s) : null;
      },
    });
  }
  let openCamera = null;      // the actor, or null before its phase-1 create
  let openCameraGone = false; // true once its state-3 tick has run (the exe has freed it)
  let openCameraHeld = null;  // the record it last installed (the arena shot once gone)
  let openCameraArm = null;   // the sub-state arm the last tick dispatched on (for the debug readout)
  const openClock = createIdleClock();
  /**
   * The opening machine's phase-1 slot-6 create, called through the machine's port. Idempotent,
   * so the render tick can also call it when it runs first; the actor is created ONCE, exactly
   * as the disc creates it once per battle.
   */
  function beginOpeningCamera() {
    if (!openCamera) {
      openCamera = makeOpenCamera();
      openCameraGone = false;
      openCameraHeld = null;
      openClock.reset();
    }
    return openCamera;
  }
  // THE battle camera record: one owner, one live record, no expiry. See the decode block on
  // createCameraRecord (web/fight/battle-camera.js) — the original's camera object holds a
  // single 14-word record at +0x54 and NOTHING clears it: the op5 cut/move, the canned-shot
  // loader, the arena shot and the camera director's own per-frame re-cut all REPLACE it.
  // `camScriptOwned` is the original's one piece of camera arbitration, read off
  // F0x8008718c: the battle's camera director is not run while an action's script owns the
  // camera, so during the two action phases and the DNA presentation the battle's camera does
  // not touch the record and the last record installed stays on screen until the next cut.
  let camScriptOwned = false;
  const camRec = createCameraRecord((preset) => cannedShot(preset));
  // The arena shot: `camMgr->[0x100]` (F0x8009257c), the far side's own record naming a 1-based
  // shot out of the NEAR side's twelve. op5 preset 0 and every preset the eight-entry table does
  // not name (>= 8) both land here — F0x8008c004's dispatch is `sltiu $v0,$a2,0x8` with the
  // table at 0x80082ea0 whose entry 0 is the [0x100] call and whose fallthrough (>= 8) is the
  // same call again (fightstg.s:9414-9427 and :9424-9429). So preset 0 is a CUT to the arena
  // shot, not a reset to "no camera": the record is replaced, never emptied.
  function _arenaFields() {
    const shot = introShot();
    return shot ? fieldsFromShot(shot) : null;
  }
  // op5 camera hook for one side's VM. sub=1 explicit transforms are authored in the PLAYER
  // slot's world frame, so they are honored only for the player side (as before). sub=0 presets
  // are DECODED + CAPTURED (2026-07-06): preset 0 = the arena shot ([0x100]); presets 1-7 =
  // the real canned camera shots read live from the game's fight camera-preset tables
  // (OP5_PRESETS above). Reaction clips issue these presets — the real game's "cut to the
  // struck Digimon as the hit lands".
  function _camHookFor(side) {
    return (rec) => {
      const cs = applyOp5({}, rec);
      if (!cs.op5) return;
      // WHICH ACTION installed this shot. `issuer` alone names a SIDE, and the one shared camera
      // record keeps that label after the action that set it ends — so a later action can read
      // another action's label. Tag every install with the live action VM, so "did MY current
      // action set the record?" is answerable (cameraOwnedByAction).
      const installerVm = () => (side === "enemy" ? enemyAnim8r : playerAnim8r)?.vm;
      if (cs.op5.eye) {
        // A sub=1 explicit transform is ABSOLUTE op5 data authored PER SIDE — the "far-side
        // mirror across the arena mid-line" is FALSIFIED (docs/research/fight-3d/
        // tech-effects-decode.md §2026-08-18): the op5 handler stores its operands with no side
        // test, and far-side packs author their own transforms (clips 9 and 11 carry 51 sub=1
        // records in clip 11 alone). Both sides are therefore honoured; dropping the far side's
        // lost the camera of every enemy signature.
        const duration = Math.max(0, cs.op5.mode | 0);
        // duration > 0 arms the move ([0xfc] F0x800922b4, whose start block is the LIVE
        // record); duration 0 is the cut ([0xf8] F0x80092244). Either way the record is
        // REPLACED and outlives the script that installed it.
        if (duration > 0) camRec.move(cs.op5.fields, duration, { issuer: side, issuerVm: installerVm() });
        else camRec.cut(cs.op5.fields, { issuer: side, issuerVm: installerVm() });
        return;
      }
      if (cs.op5.preset != null) {
        const p = cs.op5.preset | 0;
        // op5's operand 0 is a MOVE DURATION, not a mode: F0x8008c004 keeps it in $s3 and, after
        // the arm fills the staging block, applies it through [0xf8] (the cut) when it is 0 and
        // through [0xfc] (the move, F0x800922b4, `a3 = $s3`) otherwise — the PRESET arm exactly
        // as the explicit-transform arm (.L0x8008c1cc). So a preset with a duration glides from
        // the live record over that many frames; a preset with 0 cuts. Both arms honour it, the
        // arena shot included. Dropping it made every authored preset glide an instant cut.
        const duration = Math.max(0, cs.op5.mode | 0);
        if (p === 0 || p >= 8) {
          const f = _arenaFields();
          if (f) {
            if (duration > 0) camRec.move(f, duration, { issuer: side, issuerVm: installerVm() });
            else camRec.cut(f, { issuer: side, issuerVm: installerVm() });
          }
          return;
        }
        // A canned shot goes through F0x800923b4, which fills only eye/target/H and explicitly
        // zeroes +0x18, +0x24..+0x28 and +0x2c — the record the walker resolves late, since the
        // model's own shot table can land after the op5. `duration` carries the [0xfc] glide.
        camRec.preset(p, { issuer: side, duration, issuerVm: installerVm() });
      }
    };
  }
  // The clip-10 op-5 pair for ONE model — the ITEM/USE close-up, NOT an attack's impact camera.
  //
  // The corrected reading (.dw3-research/attack-camera-rule-2026-10-08/worker-av.md;
  // attack-camera-timing-2026-10-08/worker-ax.md): clip 10 (`fightstg.s:11008-11011`,
  // `.L0x8008d8e0: li $v0,0xa; sw $v0,0x54`) is selected by the damage-reaction machine
  // FIGHTSTG_F0x8008d3b4's DEFAULT arm — its kind word at the command object's +0x70 outside
  // 0x4d..0x5a — and that machine's ONLY caller in the whole shipped corpus is the battle
  // item/command executor FIGHTSTG_F0x8008dac0 (`fightstg.s:11175`). An ordinary landed basic or
  // TECH hit selects the defender's reaction through the attacker's authored op-1 records
  // (FIGHTSTG_F0x8008b69c, `fightstg.s:8809-8813`) as clip 2 survive / 3 death / 4 evade, and
  // clips 2/3/4 author an op5 in 0 of the 249 shipped packs — so a landed attack installs NO
  // defender camera. Live confirmation (worker-ax): the op-5 handler ran 0 times across a landed
  // hit, a miss and a counter, while the same hook fired 5x on our TECH, which authors op5.
  //
  // A real item use plays this pair through the acting actor's OWN clip-10 script
  // (web/battle.js `playPlayerActionClip`), and that is where it still runs. Its per-model data:
  // 53 of 56 near-side packs author `op5 [60,0,3]` then the restore `op5 [60,0,0]`; the 16
  // far-side packs that author one use presets 7 / 6 / 1; the other 177 far-side packs author
  // none. The preset resolves against the SLOT it names, never against the model that authored
  // it (`op5ShotSlot`, `fightstg.s:9430-9445`): preset 3 is slot 0, the NEAR fighter, whatever
  // model wrote the word — which is exactly why grafting this pair onto an attacker-wards hit
  // framed the operator's OWN Digimon.
  //
  // This readout is what the probes and __dnaDebug report as each fighter's clip-10 camera; the
  // attack path no longer installs it.
  function _reactionCamFor(side) {
    const model = side === "enemy" ? enemyModel : playerModel;
    return reactionCamFromActions(model?.actions);
  }
  // At the type-99 strike, sync the bullet impact with the cut. This is the whole of the walker's
  // impact behaviour: it installs NO camera. The disc's clip-10 op-5 pair belongs to the item/use
  // and command path (`_reactionCamFor` above), not to the op-1 attack reaction, so an ordinary
  // landed hit leaves the camera alone — to the idle director, which re-publishes its own shot on
  // every tick it runs (`fightstg.s:5096-5105`, see the render camera block below).
  function _impactContact(extra) {
    const e = extra || {};
    return {
      ...e,
      onHit: (rec) => {
        e.onHit?.(rec);
        if (rec.type === 99) effectPlayer?.landProjectiles();   // bullet impact syncs with the cut
      },
    };
  }
  // Compose the internal camera hook with any caller hooks (coordinator passes onHit, etc.).
  function _playerHooks(extra) {
    const e = extra || {};
    const cam = _camHookFor("player");
    return { ...e, onCamera: (rec) => { cam(rec); e.onCamera?.(rec); } };
  }
  function _enemyHooks(extra) {
    const e = extra || {};
    const cam = _camHookFor("enemy");
    return { ...e, onCamera: (rec) => { cam(rec); e.onCamera?.(rec); } };
  }
  let lastCamInfo = null;        // {eye,look,fovDeg} readout for the debug page
  function setCameraMode(m, opts = {}) {
    // Who owns the camera this frame. `scriptOwnsCamera` is the original's own arbitration: the
    // battle's camera director (F0x8008718c) re-publishes its own record through the cut [0xf8]
    // on every tick it runs (fightstg.s:5096-5105), so while a script's op5 owns the record the
    // battle's camera must not cut over it. The director's EXISTENCE is the other half: on the
    // confirm edge the command screen writes state 3 and the exe FREES the object
    // (`exe/fns.s:8883`, `:8900-8905`), so for the rest of the attack nothing re-publishes —
    // `directorRetired` is that, and it replaces the old state-list freeze gate
    // (`web/battle.js` SCRIPT_OWNED_CAMERA_STATES).
    //
    // A glide the script armed is itself a script-owned camera move still in flight: the disc's
    // camera object interpolates the record every frame (FIGHTSTG_F0x80091df4) with no regard
    // for the script that armed it, and nothing expires the record. So while `isGliding()` the
    // director must not re-cut over it — otherwise an authored run (the item use's clip-10 op5
    // pair, `[60,0,preset]` then its `[60,0,0]` restore) is truncated mid-glide when the action
    // VM ends first.
    const valid = (m === "behind" || m === "orbit" || m === "game" || m === "director"
        || m === "tag" || m === "defeat" || m === "opening");
    // The disc's own camera edges, so the walker needs no state-list freeze:
    //   * the command menu opens -> a FRESH director is built (the phase's row-children arm);
    //   * the confirm is pressed -> the director's state-3 tick cuts the plain arena shot and
    //     the object is freed;
    //   * the victory / loss / tag cameras own the record for the rest of the fight, so the
    //     director is not brought back.
    if (valid) {
      if (m === "opening") {
        // The battle-open flourish runs BEFORE the first command menu, so the idle director does
        // not exist yet; a stale one from a previous turn must not re-publish over the opening,
        // and the flourish is created once (its port is idempotent, so this is only a safety net
        // for a render frame that runs before the opening machine's phase-1 create).
        idleDirector = null; directorRetired = false;
        beginOpeningCamera();
      } else if (m === "director") {
        if (camMode !== "director" || directorRetired) { idleDirector = null; directorRetired = false; }
      } else if (m === "behind") {
        if (camMode === "director") retireIdleDirector();
      } else {
        idleDirector = null; directorRetired = false;
      }
    }
    camScriptOwned = !!opts.scriptOwnsCamera || camRec.isGliding() || directorRetired;
    if (m === "defeat" && camMode !== "defeat") {
      defeatDelta = 0; defeatClock = 0;
      // F0x8008c93c's FIRST tick takes the camera with an explicit cut:
      // `camMgr->[0x104](0, 0xb)` fills eye/target/view-size and zeroes the anchor, the
      // three frame angles and the roll (.L0x80092530-.L0x80092548), and phases 1 and 2 then
      // re-apply that same record EVERY frame through `[0xf8]` with the Y angle grown by
      // `delta * 2` (.L0x8008cad4). The camera object holds ONE live record, so whatever was
      // on screen before the cut stops owning it the moment this cut lands — including an
      // action's own op5 shot and the battle's opening shot. The walker's defeat branch
      // re-publishes the same record every frame below, so nothing else is needed here.
    }
    if (valid) camMode = m;
  }
  function getCameraMode() { return camMode; }
  // `[0x800a4548](level)` — the original's slow-motion setter, F0x8009e510(level):
  // store the level at 0x800a453c, zero the accumulator at 0x800a4540, and step once.
  // 0 = normal (raw delta), 1 = frozen, 2 = one animation unit per four accumulated,
  // 3 = double. Only the loss effect's phase 0 uses 2, and nothing on the loss path
  // lowers it again (F0x8008c93c's phase 3 would, but no writer of phase 3 was found).
  function setSlowMotion(level) {
    const lv = level | 0;
    slowMoLevel = lv;
    slowMoAcc = 0;
    // F0x8009e510's arm: store the level, zero the accumulator, and step once — the port.
    const step = engineSetSlowMotion(lv, LOSS_CAM.deltaPerFrame);
    slowMoAcc = step.acc;
    slowMoDelta = step.delta;
    slowMoTickSpeed = GLOBAL_SPEED * (step.delta / LOSS_CAM.deltaPerFrame);
    return { level: slowMoLevel, delta: slowMoDelta, acc: slowMoAcc, tickSpeed: slowMoTickSpeed };
  }
  // What the loss beat is actually doing to the animation, in the original's own numbers:
  // the armed level, the delta the stepper last published to 0x800a4464, the accumulator
  // remainder, and the walker's table-step speed the last logic tick ran at, plus the
  // running totals (ticks and published units) a check measures the long-run rate from.
  // Plus which clip each fighter is playing — the walker's motion id IS the timeline table
  // index and its `animId` is that plus one (F0x80083a54 plays directory member animId - 1).
  function getAnimationReadout() {
    const side = (a) => (a ? {
      clip: a._clip | 0,
      table: a.timelineTable,
      animId: a.animationId,
      frame: a.frame,
      motion: a.vm?.lastMotion ?? null,
      vmRunning: !!(a.vm && !a.vm.ended),
      heldPose: !!a._heldPose,
    } : null);
    return {
      slowMoLevel, slowMoDelta, slowMoAcc, slowMoTickSpeed, globalSpeed: GLOBAL_SPEED,
      deltaPerFrame: LOSS_CAM.deltaPerFrame,
      slowMoTicks, slowMoUnits,
      slowMoRate: slowMoTicks ? slowMoUnits / slowMoTicks : null,
      player: side(playerAnim8r),
      enemy: side(enemyAnim8r),
    };
  }
  function setGameCamParam(k, v) { if (k in gameCam) { gameCam[k] = +v; return true; } return false; }
  function getCameraInfo() { return lastCamInfo ? { ...lastCamInfo, params: { ...gameCam } } : null; }
  function getFaceCamRect() { return faceCamRect; }
  /** A presentation owns the screen: suppress the inset until it says otherwise. The
   *  object rule still decides whether the box exists; this only covers it. */
  function setFaceCamVisible(visible) { faceBoxSuppressed = !visible; }
  /** Feed the object rule this frame's three HUD facts. Returns whether the box is up. */
  function syncFaceBox(events) {
    faceBoxOnScreen = battleFaceBoxVisible(faceBox, events);
    return faceBoxOnScreen;
  }

  const _rotY = (v, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
  };
  const _lerp = (a, b, t) => a + (b - a) * t;

  function freeSkelBufs(bufs) {
    if (!bufs) return;
    if (bufs.ibo) gl.deleteBuffer(bufs.ibo);
    if (bufs.ubo) gl.deleteBuffer(bufs.ubo);
    if (bufs.vbo) gl.deleteBuffer(bufs.vbo);
  }

  // FIGHTSTG_F0x8008606c, the actor teardown, ported (engine/dw3/battle-actor-lifecycle.ts).
  // A fightstg fighter actor holds three resource words at +0x78/+0x7c/+0x80; the original's
  // teardown runs only at state 3 and frees each pointer only when it is non-zero. The
  // browser's three resources are the texture (+0x78), the skeleton GL buffers (+0x7c) and
  // the model data (+0x80); the release now runs THROUGH the port rather than a hand-written
  // `if (tex) deleteTexture; freeSkelBufs; null`, so the guard and the zero test are the
  // original's. `free` does the browser-side release — that half is genuinely browser-side.
  function releaseActorResources(resources) {
    const slots = resources.slice();
    actorTeardown({
      // The browser tears its actor down when it is replaced, which is the original's state 3.
      getState: () => ACTOR_TEARDOWN_STATE,
      getResource: (off) => slots[ACTOR_RES_OFFSETS.indexOf(off)] ?? 0,
    }, (ptr) => {
      const i = slots.indexOf(ptr);
      if (i < 0) return;
      slots[i] = 0;
      if (i === 0) gl.deleteTexture(ptr);   // actor +0x78: the texture
      else if (i === 1) freeSkelBufs(ptr);   // actor +0x7c: the skeleton GL buffers
      // i === 2: actor +0x80 is plain JS model data — dropping the reference frees it.
    });
  }

  // Warm the model + texture caches ahead of a presentation model swap (the DNA
  // flow swaps actors at every segment boundary; fetching there stalls the show).
  function preloadDigimon(folder) {
    if (!folder) return Promise.resolve(false);
    loadAssetImage(`assets/battle/textures/${folder}.png`).catch(() => null);
    return loadSkeletalModel(folder).then((m) => !!m);
  }

  function setPlayerDigimon(folder) {
    if (folder === playerFolder) return Promise.resolve(!!playerModel);
    playerFolder = folder;
    playerPatches = null; playerPage = null;
    // The actor teardown, ported: free the three resource words through FIGHTSTG_F0x8008606c.
    releaseActorResources([playerTex, playerSkelBufs, playerModel]);
    playerTex = null; playerSkelBufs = null; playerModel = null;
    _freeFaceBoxBuffers(gl);
    playerAnim8r = null; coordinator.player = null;
    if (!folder) return Promise.resolve(true);
    playerTex = loadTexture(gl, `assets/battle/textures/${folder}.png`);
    setupTexturePatches("player", folder);
    return loadSkeletalModel(folder).then(m => {
      if (m && folder === playerFolder) {
        playerModel = m;
        playerSkelBufs = buildSkeletalGLBuffers(gl, m);
        playerFrame = m.clips?.[0]?.start_frame ?? 0;
        // ActorAnimator owns idle (TimelinePlayer over the idle position table) and actions
        // (ActionVM over model.actions[clip]). Models without a timeline fall back to advanceFrame.
        playerAnim8r = new ActorAnimator(m);
        playerAnim8r.resetSlotPlacement(arenaSlotFor(folder, "player", placementTable));
        coordinator.player = playerAnim8r;
        preloadModelProjectiles(m.actions);
        return true;
      }
      return false;
    });
  }

  // The fighter's BASE idle table (anim object +0x18): 0 = the normal idle, 1 = the low-HP stance
  // the original plays for a badly hurt Digimon. Every action script's trailing "return to base"
  // record and every action->idle return play this table, so setting it here is what makes the
  // hurt stance appear ONLY while the Digimon is actually hurt.
  function setFighterBaseIdle(side, low) {
    const a = side === "enemy" ? enemyAnim8r : playerAnim8r;
    if (a) a.baseTable = low ? 1 : 0;
  }

  function setPlayerVisible(visible) { playerVisible = !!visible; }
  // DNA clip 12 hides the enemy for the void sequence (op2 [2,4] / [1,4]; slot 4 = enemy).
  let enemyVisible = true;
  function setEnemyVisible(visible) { enemyVisible = !!visible; }

  function setEnemyDigimon(folder) {
    if (folder === enemyFolder) return;
    enemyFolder = folder;
    enemyPatches = null; enemyPage = null;
    // The actor teardown, ported: free the three resource words through FIGHTSTG_F0x8008606c.
    releaseActorResources([enemyTex, enemySkelBufs, enemyModel]);
    enemyTex = null; enemySkelBufs = null; enemyModel = null;
    _freeFaceBoxBuffers(gl);
    enemyAnim8r = null; coordinator.enemy = null;
    if (!folder) return;
    enemyTex = loadTexture(gl, `assets/battle/textures/${folder}.png`);
    setupTexturePatches("enemy", folder);
    loadSkeletalModel(folder).then(m => {
      if (m && folder === enemyFolder) {
        enemyModel = m;
        enemySkelBufs = buildSkeletalGLBuffers(gl, m);
        enemyFrame = m.clips?.[0]?.start_frame ?? 0;
        enemyAnim8r = new ActorAnimator(m);
        enemyAnim8r.resetSlotPlacement(arenaSlotFor(folder, "enemy", placementTable));
        coordinator.enemy = enemyAnim8r;
        preloadModelProjectiles(m.actions);
      }
    });
  }

  // Named anim -> action-clip index. CONFIRMED (anim_loop_and_action_vm): basic attack = clip 5
  // (corrects the old wrong CLIP_NAMES attack:6), signature = clip 11. The others are tentative
  // indices for the debug viewer only; setAction falls back to idle if that clip has no script.
  const NAMED_CLIP = { attack: 5, signature: 11, walk: 1, run: 2, hit: 10, win: 16, lose: 17 };
  function _applyNamed(anim8r, name, hooks) {
    if (!anim8r) return;
    if (name === "idle" || name == null) anim8r.setIdle();
    else anim8r.setAction(NAMED_CLIP[name] ?? null, hooks || {});
  }
  function setPlayerAnim(anim) {
    screenOverlay = null;   // safety: a persistent op7 type-0 white-out never outlives the presentation
    dnaOrbs = null;         // same safety for the DNA orb overlay
    _applyNamed(playerAnim8r, anim, _playerHooks(_fxHooks("player")));
  }

  // ── DNA orb overlay ──────────────────────────────────────────────────────────
  // The clip-12 "parent orb" starbursts. Runtime ground truth (2026-07-15, state-9
  // replay): the op3 1005/1006 effect objects are only 42-tick IGNITION bursts that
  // die (state 3) right after growing to clip 6 @ 2.5x — the long-lived orbs that fly
  // for the rest of the presentation are drawn by presentation code, not the effect
  // system, and during the seg-2 camera hold they ORBIT each other ~2 revolutions,
  // spiralling in to the fusion flare (orbpath_0690..0980 centroid captures). We
  // reproduce its motion with the captured screen-space orbit path (authored data
  // in dna_clip12.json), while retaining the native ignition/core pixels.
  const DNA_ORB_ARCH = 5;
  const DNA_ORB_CLIPS = { A: 11, B: 10 };          // needle-star cores: yellow A, blue B
  const DNA_ORB_CLUT = { A: 4, B: 5 };             // yellow / blue native palette phases
  const DNA_ORB_SCALE = { A: 0.42, B: 0.38 };      // base core size (centre-origin px sprite)
  // Real-game choreography (user description 2026-07-15): the two parent orbs start on
  // opposite sides of a static wider shot and orbit an invisible centre CLOCKWISE, spiralling
  // inward over ~2.5 fast turns (~2s) until they collide dead-centre and fuse. Yellow orb
  // (Imperialdramon family) starts right, blue orb (Diaboromon family) starts left.
  const DNA_ORB_START_ANGLE = { A: 0, B: Math.PI };
  const DNA_ORB_RADIUS = 72;                        // start half-separation, centre-relative px
  const DNA_ORB_TURNS = 2.5;                        // clockwise revolutions before collision
  const DNA_ORB_TICKS = 132;                        // ~2.2s @ 60Hz to complete the spiral
  let dnaOrbs = null;   // { orbs:{A:{},B:{}}, u, dur, orbiting }
  let dnaPresentation = null; // {tick,fusionTick}: registry-owner 0x33 state
  function dnaPresentationStart() { dnaPresentation = { tick: 0, fusionTick: null }; }
  function dnaFusionStart() {
    if (!dnaPresentation) dnaPresentationStart();
    dnaPresentation.fusionTick = 0;
  }
  function dnaPresentationStop() { dnaPresentation = null; dnaOrbs = null; }

  // ── Blast digivolution presentation (sequence 0x61) ─────────────────────────
  // Same shape as the DNA presentation above: battle.js owns the frame counter
  // and the decoded timeline (engine/systems/blast-presentation.ts); the
  // renderer is told the current state and only reacts to it. What the renderer
  // contributes that 2D cannot: the black void, the camera dolly, hiding the
  // original model at the captured swap frame, and drawing the incoming form as
  // a green WIREFRAME built from that model's own geometry.
  let blastState = null;
  // The arena view's (0x1000) background colour (view+0x12C). In the original this colour
  // is written by the effect-tint feed FIGHTSTG_F0x800861f4 from the effect object's own
  // element colour, and the resident display-environment builder (F0x800266b4) composes it
  // into the view's background fill. The port is engine/dw3/battle-effect-tint.ts, run by
  // engine/dw3/battle-effect-driver-host.ts#createTransformationSchedule's `arenaTint` sink
  // on the ordinary transformation route. The renderer paints it as the arena background
  // quad (the sky when the arena is up, the void when a signature/transformation replaces
  // it). `null` = no colour set, so each background keeps its own default.
  let arenaTint = null;
  /** The renderer's arenaTint sink: r,g,b are PS1 view-colour bytes (0..255). */
  function setArenaTint(r, g, b) {
    if (r == null) { arenaTint = null; return null; }
    const c = (v) => Math.max(0, Math.min(1, (v | 0) / 255));
    arenaTint = [c(r), c(g), c(b), 1];
    return arenaTint.slice();
  }
  function blastPresentationSet(state) { blastState = state || null; }
  function blastPresentationStop() { blastState = null; effectPlayer?.clear(); }

  /**
   * Spawn one of the transformation's REAL effect types on the fighter.
   *
   * `FIGHTSTG_F0x80089cd8` spawns these by id through `F0x80089be4`: 0x3E8,
   * 0x3E9, 0x3EA and 0x3EB for manual DV, 0x3EF and 0x3F0 for Blast — decimal
   * 1000-1003, 1007, 1008, every one of them file E000EVOL archive 6 in the
   * extracted manifest (claim blast-dv-visuals-are-e000evol-effects-2026-08-13).
   * This is the same EffectPlayer the action VM's op3 uses, so the art, the
   * channel defaults and the draw path are the shipped ones.
   */
  function blastSpawnEffect(type, pos) {
    if (!effectPlayer?.hasType(type)) return 0;
    // The position is DECODED: F0x80089be4 copies the 8-byte {x,y,z,w} record it
    // is handed straight into the effect object, and the three records fightstg
    // uses are (0,0,32767), (160,120,32767) and (-160,-120,-1). z 32767 and -1
    // are the effect player's own screen-space markers.
    if (pos) return effectPlayer.spawn(type, { x: pos.x, y: pos.y, z: pos.z }, "player");
    // Fallback only; every shipped caller passes the decoded record above.
    return effectPlayer.spawn(type, { x: 160, y: 120, z: 32767 }, "player");
  }
  function dnaOrbIgnite(key) {
    // Register a parent orb (1005/1006 ignitions during the parent phase). The converging
    // orbit itself starts when dnaOrbsPath() is called at the fusion segment.
    if (!dnaOrbs) dnaOrbs = { orbs: {}, u: 0, dur: DNA_ORB_TICKS, orbiting: false };
    dnaOrbs.orbs[key] = { tick: 0 };
  }
  // Begin the clockwise inward spiral that ends in the central collision. (Kept named
  // dnaOrbsPath for the battle.js call site; the old captured screen-path was replaced by
  // this procedural orbit — the capture never engaged and did not match the real motion.)
  function dnaOrbsPath(_path, _durTicks) {
    if (!dnaOrbs) dnaOrbs = { orbs: {}, u: 0, dur: DNA_ORB_TICKS, orbiting: false };
    dnaOrbs.orbs.A ||= { tick: 0 };   // ensure both cores exist even if an ignite was missed
    dnaOrbs.orbs.B ||= { tick: 0 };
    dnaOrbs.orbiting = true;
    dnaOrbs.u = 0;
    dnaOrbs.dur = DNA_ORB_TICKS;
  }
  function dnaOrbsClear() { dnaOrbs = null; }
  // Sample an authored program record without creating an op3 object. The DNA
  // presentation owner uses this to restart its looping backdrop and to place
  // its fusion pair at the native screen sentinel.
  function _sampleEffectRecord(type, recordIndex, tick, pos, loop = false) {
    const typeRec = effectAssets?.manifest?.types?.[String(type)];
    const rec = typeRec?.records?.[recordIndex];
    if (!rec || rec.duration <= 0) return null;
    let t = Math.max(0, Math.floor(tick));
    if (loop) t %= Math.max(1, rec.duration - 1);
    else if (t >= rec.duration) return null;
    const chans = rec.defaults.slice();
    const last = Math.min(t, rec.frames.length - 1);
    for (let f = 0; f <= last; f++) {
      const row = rec.frames[f];
      let k = 0;
      for (let c = 0; c < 9; c++) if (rec.mask & (1 << c)) chans[c] = row[k++];
    }
    const [frame, clutShift, dx, dy, sx, sy, c6, c7, angle] = chans;
    if (!sx || !sy || frame === 255) return null;
    return {
      arch: typeRec.arch, frame: frame | 0, clutShift: clutShift | 0,
      side: "player", screen: true, pos,
      dx: dx | 0, dy: dy | 0, sx: sx / 0x1000, sy: sy / 0x1000,
      rot: (angle | 0) * Math.PI * 2 / 4096, c6: c6 | 0, c7: c7 | 0,
    };
  }
  function setEnemyAnim(anim)  { enemyAnim = anim;  _applyNamed(enemyAnim8r, anim, _fxHooks("enemy")); }
  function playPlayerVictory() {
    const table = playerModel?.timeline?.[44]?.table;
    if (!playerAnim8r || !table || !table.length) return false;
    playerAnim = "win";
    playerAnim8r.playTimelineTable(table);
    return true;
  }
  function playPlayerActionClip(clip, hooks = {}) {
    playerAnim = `clip:${clip}`;
    return playerAnim8r
      ? playerAnim8r.setAction(clip, _playerHooks(_fxHooks("player", hooks)))
      : false;
  }
  // The item machine's own entry (FIGHTSTG_F0x8008d3b4's default arm, fightstg.s:11008-11030):
  // clip 10 plus the used item's record fields from the 0x800a336c table — effect -> actor+0x6c
  // (clip 10's op3 9999 spawn resolves it) and sound -> actor+0x70 (the item's op10 99 strike
  // reads it; the attack path's own writer .L0x8008f21c-.L0x8008f234 is what contactSoundTypeFor
  // ports). An item with no table record writes neither field, exactly as the disc's scan falls
  // through — so contactSoundType is cleared rather than left holding the previous attack's.
  function playPlayerItemUse(itemId, hooks = {}) {
    const rec = itemUseEffect(itemId);
    playerAnim = `item:${itemId}`;
    contactSoundType.player = rec ? rec.sound : null;
    contactEvade.player = false;   // no accuracy roll on the item path
    return playerAnim8r
      ? playerAnim8r.setAnimByItem(itemId, _playerHooks(_fxHooks("player", hooks)))
      : false;
  }
  // The item machine's THROW entry (FIGHTSTG_F0x8008d3b4's state-0 typed arms, ids 77-90): the
  // item's record names the clip and the fresh action actor's motion (+0x68), effect (+0x6c) and
  // sound (+0x70) — tools/extract_throw_item_effects.py. The clip plays with the record's effect
  // as its current effect (op3's 9999 sentinel) and its motion as the actor's current motion
  // (op4's 0x38 sentinel); the record's sound is the op10 99 strike's contact-sound type. The
  // clip-15 items (77-84) are the element fields: their motion is the element's sig, so the pack
  // MEFT10<motion> is armed for the clip's own op4 to switch in and out — exactly the tech
  // backdrop's rule (armDataField above). `branch` picks item 88's STR/DEF effect/sound pair;
  // `elementIndex` supplies item 84's rolled element (the draw the engine's handler already made)
  // so the motion, the pack and the field all agree on one roll.
  function playPlayerThrowItem(itemId, { branch = null, elementIndex = null, hooks = {} } = {}) {
    const rec = throwItemEffect(itemId);
    if (!rec) return false;   // table not loaded -> the caller keeps the default clip-10 entry
    playerAnim = `throw:${itemId}`;
    contactSoundType.player = (branch != null && rec.sound_branch && rec.sound_branch[branch] != null)
      ? rec.sound_branch[branch]
      : rec.sound;
    contactEvade.player = false;   // no accuracy roll on the item path
    let motion = rec.motion;
    if (rec.motion_random) {
      const count = rec.motion_random.count | 0;
      const k = (elementIndex != null ? elementIndex | 0 : (RAND_U16() % count)) % count;
      motion = rec.motion_random.base + rec.motion_random.step * k;
    }
    armThrowBackdrop(motion);      // the clip's op4 switches the element pack in and out
    const h = { ...hooks, onMotion: (m) => { dataFieldMotion(m); hooks.onMotion?.(m); } };
    return playerAnim8r
      ? playerAnim8r.setAnimByThrowItem(itemId, _playerHooks(_fxHooks("player", h)), { branch, motion })
      : false;
  }
  // A presentation plays as several successive scripts — the DNA cut-in is split at its op0
  // barriers — and NOTHING here touches the camera record. The record outlives the script that
  // installed it (there is no expiry anywhere in the original), so a segment's op5 carries into
  // the next segment on its own and this needs no per-presentation flag.
  function playPlayerScript(script, {
    initialTable = null, motionTables = {}, rotationBase = 0, ...hooks
  } = {}) {
    playerAnim = "external-script";
    const overlayHooks = {
      ...hooks,
      onOverlay: (rec) => {
        screenOverlay = { type: rec.type, duration: Math.max(1, rec.duration), t: 0 };
        hooks.onOverlay?.(rec);
      },
      onMotion: (motion) => { hooks.onMotion?.(motion); },
    };
    if (!playerAnim8r) return false;
    playerAnim8r.rotationBase = rotationBase;
    return playerAnim8r.setScript(script, _playerHooks(_fxHooks("player", overlayHooks)), {
      initialTable, motionTables,
    });
  }
  // Real, confirmed path (technique id -> clip via techToClip). hooks = { onHit, onCamera, setLunge }.
  // The player's action drives the script camera (op5); the enemy's does not.
  function setPlayerAnimByTech(techId, hooks) {
    playerAnim = `tech:${techId}`;
    contactSoundType.player = contactSoundTypeFor(techId);
    contactEvade.player = false;   // no accuracy roll on this path
    // The backdrop follows the clip's own op4 (see armDataField above), not a timer.
    armDataField(techId);
    const h = { ...(hooks || {}), onMotion: (m) => { dataFieldMotion(m); hooks?.onMotion?.(m); } };
    return playerAnim8r ? playerAnim8r.setAnimByTech(techId, _playerHooks(_fxHooks("player", h))) : false;
  }
  function setEnemyAnimByTech(techId, hooks) {
    enemyAnim = `tech:${techId}`;
    contactSoundType.enemy = contactSoundTypeFor(techId);
    contactEvade.enemy = false;
    armDataField(techId);
    const h = { ...(hooks || {}), onMotion: (m) => { dataFieldMotion(m); hooks?.onMotion?.(m); } };
    return enemyAnim8r ? enemyAnim8r.setAnimByTech(techId, _enemyHooks(_fxHooks("enemy", h))) : false;
  }
  // Coordinated attacks (Phase E entry points for battle.js): the attacker plays techId's clip;
  // on its type-99 strike the defender plays its hit-reaction. The PLAYER attacker also drives the
  // op5 script camera (_playerHooks). hooks = optional extra (e.g. a hit-spark/sound onHit).
  function playerAttack(techId, opts = {}) {
    if (!playerAnim8r || !enemyAnim8r) return false;
    playerAnim = `tech:${techId}`; enemyAnim = `hit`;
    if (sfx) { sfx.stopBattle("player"); sfx.stopBattle("enemy"); }   // clear any sustained voice from the last attack
    contactSoundType.player = contactSoundTypeFor(techId);
    armDataField(techId);   // the backdrop follows the clip's own op4, not a timer
    const { lethal = false, miss = false, ...hooks } = opts;   // lethal -> death reaction (clip 3); miss -> no recoil
    contactEvade.player = miss;   // an evaded contact cues COMEX102, not the weapon's id
    return coordinator.attack(playerAnim8r, enemyAnim8r, techId,
      _playerHooks(_fxHooks("player", _impactContact({ ...hooks, onMotion: dataFieldMotion }))),
      { lethal, miss, defenderHooks: _enemyHooks(_fxHooks("enemy")) });
  }
  function enemyAttack(techId, opts = {}) {
    if (!playerAnim8r || !enemyAnim8r) return false;
    enemyAnim = `tech:${techId}`; playerAnim = "hit";
    if (sfx) { sfx.stopBattle("player"); sfx.stopBattle("enemy"); }   // clear any sustained voice from the last attack
    contactSoundType.enemy = contactSoundTypeFor(techId);
    armDataField(techId);
    const { lethal = false, miss = false, ...hooks } = opts;
    contactEvade.enemy = miss;
    return coordinator.attack(enemyAnim8r, playerAnim8r, techId,
      _enemyHooks(_fxHooks("enemy", _impactContact({ ...hooks, onMotion: dataFieldMotion }))),
      { lethal, miss, defenderHooks: _playerHooks(_fxHooks("player")) });
  }
  // ── EXTRA FIGHTERS (multiplayer many-vs-many, web/mpbattle.js) ───────────────────────────────────────
  // A normal fight has two models, "player" and "enemy". Multiplayer needs more of them in the SAME arena, so this adds any
  // number of extra fighters, each with its own model, texture, skeleton buffers and ActorAnimator, standing in a lane beside
  // the others (`dx`, PS1 units sideways). They are drawn, animated, framed and sequenced by the same code as the two main
  // fighters: attacks run through the SAME FightCoordinator (it already takes any two animators), the effects and projectiles
  // are the same op3 / op6 records, shifted into the right lane. Nothing here runs unless addFighter() is called.
  const extras = new Map();          // id -> fighter
  let multiCam = false;
  const fighterScreen = new Map();   // id -> { x, topY, footY } in 0..1 of the canvas, written every render
  coordinator.extraActors = () => { const out = []; for (const f of extras.values()) if (f.anim8r) out.push(f.anim8r); return out; };
  const laneOf = (f) => f.dx + f.lat;

  function addFighter(id, side, folder, dx = 0) {
    removeFighter(id);
    const f = { id, side, folder, dx, lat: 0, latT: 0, model: null, bufs: null, tex: null, anim8r: null, frame: 0,
      visible: true, phase: Math.random() * 6.28, pos: [0, 0, 0], aabb: null };
    extras.set(id, f);
    f.tex = loadTexture(gl, `assets/battle/textures/${folder}.png`);
    return loadSkeletalModel(folder).then((m) => {
      if (!m || extras.get(id) !== f) return false;
      f.model = m;
      f.bufs = buildSkeletalGLBuffers(gl, m);
      f.frame = m.clips?.[0]?.start_frame ?? 0;
      f.anim8r = new ActorAnimator(m);
      f.anim8r.resetSlotPlacement(arenaSlotFor(folder, side, placementTable));
      preloadModelProjectiles(m.actions);
      _setupExtraPatches(f);
      return true;
    });
  }
  // the eyes and looping body textures of an extra fighter, the same animator the two main ones use
  function _setupExtraPatches(f) {
    const entries = placementTable[modelKeyFromFolder(f.folder)]?.texture_anim;
    f.patches = entries && entries.length ? new TexturePatchAnimator(entries) : null;
    if (f.patches) loadTexturePixels(`assets/battle/textures/${f.folder}.png`).then((page) => { if (extras.get(f.id) === f) f.page = page; });
  }
  function removeFighter(id) {
    const f = extras.get(id);
    if (!f) return;
    extras.delete(id); fighterScreen.delete(id);
    releaseActorResources([f.tex, f.bufs, f.model]);
  }
  function clearFighters(side = null) { for (const f of [...extras.values()]) if (!side || f.side === side) removeFighter(f.id); }
  function setFighterLane(id, dx) { const f = extras.get(id); if (f) f.dx = dx; }
  function setFighterVisible(id, v) { const f = extras.get(id); if (f) f.visible = !!v; }
  function setMultiCamera(on) { multiCam = !!on; }
  function fightersReady() { for (const f of extras.values()) if (!f.anim8r) return false; return true; }
  function fightersBusy() { return coordinator.active; }
  function getFighterScreen(id) { return fighterScreen.get(id) ?? null; }

  // A hurt Digimon stands in its low-HP stance (the same base idle table the main fighters use).
  function setFighterHurt(id, low) { const f = extras.get(id); if (f?.anim8r) f.anim8r.baseTable = low ? 1 : 0; }
  function fighterVictory(id) {
    const f = extras.get(id);
    const table = f?.model?.timeline?.[44]?.table;
    if (!f?.anim8r || !table || !table.length) return false;
    f.anim8r.playTimelineTable(table);
    return true;
  }
  /** A fighter plays one technique's own motion with nobody on the receiving end (a heal, a buff). */
  function fighterTech(id, techId) {
    const f = extras.get(id);
    if (!f?.anim8r) return false;
    if (sfx) { sfx.stopBattle("player"); sfx.stopBattle("enemy"); }
    contactSoundType[f.side] = contactSoundTypeFor(techId);
    return f.anim8r.setAnimByTech(techId, _fxHooks(f.side, { onMotion: dataFieldMotion }));
  }
  /** A fighter plays a raw action clip (10 = the item-use motion). */
  function fighterAction(id, clip) {
    const f = extras.get(id);
    return f?.anim8r ? f.anim8r.setAction(clip, _fxHooks(f.side)) : false;
  }
  /** A bystander's reaction (a spread attack hits several): the same op1 reaction clips the coordinator picks. */
  function fighterReact(id, { lethal = false, miss = false } = {}) {
    const f = extras.get(id);
    if (!f?.anim8r) return false;
    const clip = lethal ? REACTION_DEATH_CLIP : miss ? REACTION_EVADE_CLIP : REACTION_HIT_CLIP;
    return f.anim8r.setAction(clip, _fxHooks(f.side), { holdFinalPose: clip === REACTION_DEATH_CLIP });
  }

  // The attacker plays techId's clip; at its strike the defender plays its reaction (survive / die / dodge), exactly as in the
  // two-fighter attack. Positions in the action records are absolute arena coordinates authored for ONE fighter per side, so
  // the ones that land in a lane other than the middle one are shifted sideways into the right lane here.
  function fighterAttack(attId, defId, techId, opts = {}) {
    const A = extras.get(attId), D = extras.get(defId);
    if (!A?.anim8r || !D?.anim8r) return false;
    const { lethal = false, miss = false, ...hooks } = opts;
    if (sfx) { sfx.stopBattle("player"); sfx.stopBattle("enemy"); }
    contactSoundType[A.side] = contactSoundTypeFor(techId);
    contactEvade[A.side] = miss;
    armDataField(techId);                      // a special's element backdrop, same as in a one-on-one fight
    A.latT = D.dx - A.dx;                      // run along the lane that leads to the target, and come back afterwards
    const aLane = A.dx + A.latT, dLane = D.dx;
    // an effect whose z is on the defender's side of the arena is at the defender; otherwise it is at the attacker
    const atDefender = (z, defSide) => (defSide === "enemy" ? z > 0 : z < 0);
    const shiftFx = (h, laneNear, laneFar, defSide) => ({
      ...h,
      onEffect: (rec) => h.onEffect?.({ ...rec, x: (rec.x | 0) + (atDefender(rec.z | 0, defSide) ? laneFar : laneNear) }),
      setLunge: (l) => h.setLunge?.(l && l.sub === 0 && l.from ? { ...l, from: [l.from[0] + laneNear, ...l.from.slice(1)] } : l),
    });
    const attHooks = shiftFx(_fxHooks(A.side, _impactContact({ ...hooks, onMotion: dataFieldMotion })), aLane, dLane, D.side);
    const defHooks = shiftFx(_fxHooks(D.side), dLane, dLane, D.side);
    return coordinator.attack(A.anim8r, D.anim8r, techId, attHooks, { lethal, miss, defenderHooks: defHooks });
  }

  // Per frame: pose every extra fighter into its own skeleton buffer (before the camera, so it can frame them).
  function _updateExtras(alpha, ARENA) {
    for (const f of extras.values()) {
      if (!f.model || !f.bufs || !f.anim8r) { f.aabb = null; continue; }
      const a = f.anim8r;
      const home = a.homeSlot || arenaSlot(null, f.side);
      const mv = a.moveDelta();
      const pos = ps1ToRender([home.x + mv[0] + f.dx + f.lat, home.y + mv[1], home.z + mv[2]], ARENA);
      pos[1] += Math.sin(animTime * 3 + f.phase) * 2;
      const yaw = f.side === "player" ? -(((a.rotation?.()[1] || 0) - (a.rotationBase || 0)) * Math.PI * 2 / 4096) : Math.PI;
      const sample = a.isActive ? a.renderSample(alpha) : null;
      if (sample) f.frame = sample.frame;
      const bwm = buildBoneWorldMatrices(f.model, f.frame, sample ? sample.blend : null);
      f.pos = pos;
      f.aabb = _updateSkeletalVBOGL(gl, f.model, f.bufs, bwm, pos, MODEL_SCALE, false, yaw);
    }
  }
  function _drawExtras(pv) {
    for (const f of extras.values()) {
      if (!f.visible || !f.model || !f.bufs) continue;
      drawSkeletalMesh(gl, texP, pv, f.bufs, f.tex || whiteTex, FIGHTER_TINT);
      drawShadow(gl, texP, pv, f.pos, 20, 8);
    }
  }
  function _projectExtras(pv, W, H) {
    const proj = (x, y, z) => {
      const cx = pv[0] * x + pv[4] * y + pv[8] * z + pv[12], cy = pv[1] * x + pv[5] * y + pv[9] * z + pv[13], cw = pv[3] * x + pv[7] * y + pv[11] * z + pv[15];
      return cw > 0 ? { x: cx / cw * 0.5 + 0.5, y: 1 - (cy / cw * 0.5 + 0.5) } : null;
    };
    for (const f of extras.values()) {
      if (!f.aabb) continue;
      const cx = (f.aabb.min[0] + f.aabb.max[0]) / 2, cz = (f.aabb.min[2] + f.aabb.max[2]) / 2;
      const top = proj(cx, f.aabb.max[1], cz), foot = proj(cx, f.aabb.min[1], cz);
      if (top && foot) fighterScreen.set(f.id, { x: top.x, topY: top.y, footY: foot.y });
    }
  }
  // The wide camera: behind the near line, a little to the side, looking at the middle of everybody.
  function _multiCameraShot() {
    const fs = [...extras.values()].filter((f) => f.model && f.visible && f.aabb);
    if (!fs.length) return null;
    const near = fs.filter((f) => f.side === "player"), far = fs.filter((f) => f.side === "enemy");
    const avg = (list) => list.length ? [list.reduce((s, f) => s + f.pos[0], 0) / list.length, list.reduce((s, f) => s + f.pos[2], 0) / list.length] : null;
    const nc = avg(near) ?? avg(far), fc = avg(far) ?? avg(near);
    let minX = Infinity, maxX = -Infinity, tall = 60;
    for (const f of fs) { minX = Math.min(minX, f.aabb.min[0]); maxX = Math.max(maxX, f.aabb.max[0]); tall = Math.max(tall, f.aabb.max[1] - f.aabb.min[1]); }
    let dir = [fc[0] - nc[0], fc[1] - nc[1]];
    const dl = Math.hypot(dir[0], dir[1]);
    dir = dl > 1 ? [dir[0] / dl, dir[1] / dl] : [0, 1];
    const side = [-dir[1], dir[0]];
    const W = Math.max(260, maxX - minX), depth = dl;
    // a three-quarter view from beside the near line: both lines read side by side, and an attacker running at the far line stays in shot
    const sway = Math.sin(orbitClock * 0.4) * W * 0.06;
    const back = Math.max(520, W * 0.55 + depth * 0.30) + tall * 0.9;
    const lateral = W * 0.55 + tall * 0.5 + sway;
    const eye = [nc[0] - dir[0] * back + side[0] * lateral, tall * 1.5 + W * 0.14, nc[1] - dir[1] * back + side[1] * lateral];
    const look = [(nc[0] + fc[0]) / 2, tall * 0.3, (nc[1] + fc[1]) / 2];
    return { eye, look, fov: Math.PI / 3.6 };
  }

  function render(dt) {
    animTime += dt;

    const W = canvas.width, H = canvas.height;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0.04, 0.04, 0.08, 1);   // #0a0a14 = the sky gradient's bottom stop
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // ── Digimon world placement ──
    // Like the real game: our digimon in the foreground, the enemy far down-field near the
    // horizon (small via perspective). Big depth separation so they never overlap.
    // REAL PS1 arena layout: each fighter's slot comes from its OWN smdldata record —
    // x=0, y=-hover, z=-+(0x1400+standoff), near side negative — so the two are symmetric
    // about z=0 and stand at a distance that differs per matchup. See arenaSlot() above.
    // The slot plus the action VM's movement delta are one PS1 coordinate, and ps1ToRender is
    // the ONE mapping into render world; the bob is the walker's own render-space hover.
    const ARENA = MODEL_SCALE;
    const pBob = Math.sin(animTime * 3) * 2;
    const eBob = Math.sin(animTime * 3 + Math.PI) * 2;
    // Slot position + the action VM's movement delta (op2 modes 3/7/8: dash to contact,
    // signature leap, return home). Delta is PS1 units, same frame as the slot.
    const pMove = playerAnim8r ? playerAnim8r.moveDelta() : [0, 0, 0];
    const eMove = enemyAnim8r  ? enemyAnim8r.moveDelta()  : [0, 0, 0];
    // The VM's op2 movement is a delta from the home slot on every axis, so the home slot
    // is added on every axis. (This retires the DNA-only Y compensation that used to sit
    // here: it existed solely because home Y was the one axis the placement did not re-add.)
    const pHome = playerAnim8r?.homeSlot || arenaSlot(null, "player");
    const eHome = enemyAnim8r?.homeSlot  || arenaSlot(null, "enemy");
    const playerPos = ps1ToRender([pHome.x + pMove[0], pHome.y + pMove[1], pHome.z + pMove[2]],
                                  ARENA);
    const enemyPos  = ps1ToRender([eHome.x + eMove[0], eHome.y + eMove[1], eHome.z + eMove[2]],
                                  ARENA);
    playerPos[1] += pBob;
    enemyPos[1]  += eBob;
    // Facing: the renderer bakes the D-flip (180° about Y) into every model. The game's player
    // root rot = that flip (faces +Z, toward the enemy) → yaw 0; the game's enemy root rot =
    // identity → +π so it faces back (−Z, toward the player). They square off.
    // The yaw is applied in RENDER space, and the mapping flips Z, so a PS1 yaw of θ comes
    // out as −θ: M·Ry(θ)·M⁻¹ = Ry(−θ) for M = diag(1,−1,−1). The enemy's ±π is its own
    // mirror image, so only the player's needs the sign.
    const playerYaw  = -(((playerAnim8r?.rotation?.()[1] || 0) - (playerAnim8r?.rotationBase || 0))
      * Math.PI * 2 / 4096);
    const enemyYaw   = Math.PI;

    // Advance frame counters (60 fps target) — constrained to named clip ranges
    const CLIP_NAMES = {idle:0, walk:1, run:2, attack:6, hit:10, win:16, lose:17};

    function advanceInRange(frame, dt, start, end) {
      const range = end - start;
      if (range <= 0) return start;
      let f = frame + dt * 60;
      if (f > end) f = start + ((f - start) % range);
      if (f < start) f = start;
      return f;
    }

    function advanceFrame(frame, dt, model, animName) {
      if (!model || !model.clips) return (frame + dt * 60) % (model?.total_frames || 200);
      const clipIdx = CLIP_NAMES[animName] ?? 0;
      const clip = model.clips[clipIdx];
      if (!clip || !clip.present) {
        const c0 = model.clips[0];
        if (c0 && c0.present) return advanceInRange(frame, dt, c0.start_frame, c0.end_frame);
        return (frame + dt * 60) % (model.total_frames || 200);
      }
      return advanceInRange(frame, dt, clip.start_frame, clip.end_frame);
    }

    // ActorAnimator drives both idle (TimelinePlayer over the idle position table) and actions
    // (ActionVM over model.actions[clip]). It's "active" while a VM runs OR while idle has a
    // timeline; only models lacking a timeline (no VM) fall back to the legacy advanceFrame.
    const usePlayerA = !!(playerAnim8r && playerAnim8r.isActive);
    const useEnemyA  = !!(enemyAnim8r  && enemyAnim8r.isActive);

    // The coordinator owns per-tick stepping of both actors (it gates on isActive internally),
    // so attacker->defender reaction sequencing stays consistent with the live render tick.
    function tickSim(speed) {
      // The camera record runs on the RAW per-frame delta, never on `speed`. F0x80091df4's
      // tween multiplies its step by `[0x8004df9c]()` — the same word the op11 wait decrements
      // (F0x8008c220 .L0x8008c26c) and the same one the defeat orbit reads (.L0x8008cad4) — and
      // never by 0x800a4464, which is the word slow motion moves. `speed` IS that published
      // word scaled by the walker's tempo, so at slow-motion level 2 it drops to 0 on three
      // logic ticks in four. The camera's delta is ONE 60 Hz frame (CAMERA_FRAME_DELTA = 1):
      // with the authored 60-tick ramp (`(0x100000/60)>>8 = 68` per frame) that lands on
      // 0x1000 in ~61 ticks = ~1.0 s, the disc's own 60 frames at 60 Hz. It used to be handed
      // GLOBAL_SPEED (the walker's 2x animation tempo, a visual preference), which halved the
      // glide to ~0.5 s and read as a fast zoom rather than the original's slow one.
      camRec.tick(CAMERA_FRAME_DELTA);
      coordinator.tick(speed);
      for (const f of extras.values()) {   // (multiplayer) slide sideways into the target's lane for an attack, and back
        f.lat += (f.latT - f.lat) * Math.min(1, 0.12 * speed);
        if (f.latT !== 0 && !(f.anim8r?.vm && !f.anim8r.vm.ended)) f.latT = 0;
      }
      // Eyes and looping body textures. `speed` is the same per-tick frame delta the
      // original's blink timer counts down by (D0x800a4464), so the blink keeps the
      // cadence the record was authored for.
      for (const patch of playerPatches?.update(speed, patchState("player")) || [])
        blitTexturePatch(playerTex, playerPage, patch);
      for (const patch of enemyPatches?.update(speed, patchState("enemy")) || [])
        blitTexturePatch(enemyTex, enemyPage, patch);
      for (const f of extras.values()) {   // (multiplayer) the extra fighters' eyes
        if (!f.patches || !f.page) continue;
        for (const patch of f.patches.update(speed, f.anim8r ? f.anim8r.animationId : 1)) blitTexturePatch(f.tex, f.page, patch);
      }
      effectPlayer?.step(speed);
      if (dnaOrbs) {
        for (const o of Object.values(dnaOrbs.orbs)) o.tick += speed;
        if (dnaOrbs.orbiting) dnaOrbs.u = Math.min(1, dnaOrbs.u + speed / dnaOrbs.dur);
      }
      if (dnaPresentation) {
        dnaPresentation.tick += speed;
        if (dnaPresentation.fusionTick != null) dnaPresentation.fusionTick += speed;
      }
      if (screenOverlay) {
        screenOverlay.t += speed;
        // op7 type 0 RAMPS UP and persists at full until a type-1 op frees it (fightstg
        // barrier decode 2026-07-14): the DNA script white-outs in one segment and fades
        // in the next. Type 1 (and legacy types) self-clear when the ramp completes.
        if (screenOverlay.t >= screenOverlay.duration && screenOverlay.type !== 0) screenOverlay = null;
      }
    }
    _acc += dt;
    const stepDur = 1 / STEP_HZ;
    // DNA clip 12 plays at the same rate as every other action/tech animation (GLOBAL_SPEED);
    // speeding it up made the models animate comically fast.
    //
    // One slow-motion step per logic tick: F0x8009e428 runs once a frame off the RAW delta
    // `[0x8004df9c]()` and publishes to 0x800a4464, and everything on tickSim's `speed` reads
    // that word in the original (the model actor's frame counter at F0x80083d30, the second
    // actor clock at .L0x80089614, every op2 slot-motion blend at .L0x8009b1fc/.L0x8009b380).
    // At level 2 the published value is 1 on every fourth tick and 0 on the other three, so
    // the pose freezes for three frames and steps one on the fourth — the original's stutter
    // is preserved rather than smoothed into a constant quarter speed.
    while (_acc >= stepDur) {
      _acc -= stepDur;
      if (slowMoLevel) {
        const step = slowMoStep(slowMoLevel, LOSS_CAM.deltaPerFrame, slowMoAcc);
        slowMoAcc = step.acc;
        slowMoDelta = step.delta;
        slowMoTickSpeed = GLOBAL_SPEED * (step.delta / LOSS_CAM.deltaPerFrame);
        slowMoTicks += 1;
        slowMoUnits += step.delta;
      } else {
        slowMoDelta = LOSS_CAM.deltaPerFrame;
        slowMoTickSpeed = GLOBAL_SPEED;
      }
      tickSim(slowMoTickSpeed);
    }

    // Key-off sustained battle voices when the attack finishes (the effect objects
    // are freed): a looping op10 sound plays for the attack, then stops. Edge-triggered.
    const coordActive = coordinator.active;
    if (_coordWasActive && !coordActive && sfx) {
      sfx.stopBattle("player"); sfx.stopBattle("enemy");
      // A clip cut short before its op10 type 91 would otherwise leave the whirl ringing.
      sfx.stopSustained?.(SUSTAINED_LOOP_KEY);
    }
    _coordWasActive = coordActive;

    // Render interpolation: the 60Hz logic tick stays the faithful fixed step, but draw the pose
    // between the previous and current tick by the leftover accumulator fraction. Without this the
    // pose snaps to the latest tick, and when the render rate isn't phase-locked to STEP_HZ the
    // 0-tick/2-tick beat shows as an occasional stutter/hitch. renderSample() suppresses the lerp
    // across phase cuts/loop-backs so only genuinely continuous motion is smoothed.
    const alpha = stepDur > 0 ? Math.min(1, _acc / stepDur) : 0;
    const pSample = usePlayerA ? playerAnim8r.renderSample(alpha) : null;
    const eSample = useEnemyA  ? enemyAnim8r.renderSample(alpha)  : null;

    playerFrame = pSample ? pSample.frame
      : advanceFrame(playerFrame, dt, playerModel, playerAnim);
    enemyFrame = eSample ? eSample.frame
      : advanceFrame(enemyFrame, dt, enemyModel, enemyAnim);
    // Per-frame pose blend (timeline blend segments) — null when not transitioning.
    const playerBlend = pSample ? pSample.blend : null;
    const enemyBlend  = eSample ? eSample.blend : null;

    // ── Skin meshes FIRST (world space, camera-independent) so the camera can frame
    //    our digimon by its actual rendered size (scale-aware). ──
    pAABB = null;
    let eAABB = null;
    if (playerVisible && playerModel && playerSkelBufs) {
      const bwm = buildBoneWorldMatrices(playerModel, playerFrame, playerBlend);
      pBwm = bwm;
      pAABB = _updateSkeletalVBOGL(gl, playerModel, playerSkelBufs, bwm, playerPos, MODEL_SCALE, false, playerYaw);
    }
    if (enemyModel && enemySkelBufs) {
      const bwm = buildBoneWorldMatrices(enemyModel, enemyFrame, enemyBlend);
      eBwm = bwm;
      eAABB = _updateSkeletalVBOGL(gl, enemyModel, enemySkelBufs, bwm, enemyPos, MODEL_SCALE, false, enemyYaw);
      eAABBLast = eAABB;
    }
    if (extras.size) _updateExtras(alpha, ARENA);

    // ── Cinematic camera: rotate-around-target look-at on our digimon ──
    const pCenter = pAABB
      ? [(pAABB.min[0]+pAABB.max[0])/2, (pAABB.min[1]+pAABB.max[1])/2, (pAABB.min[2]+pAABB.max[2])/2]
      : [playerPos[0], playerPos[1] + DIGI_H/2, playerPos[2]];
    const pH = pAABB ? Math.max(40, pAABB.max[1] - pAABB.min[1]) : DIGI_H;
    // Battle axis from the stable placements (not the pose-dependent AABB centres).
    let fwd = [enemyPos[0]-playerPos[0], 0, enemyPos[2]-playerPos[2]];
    const fl = Math.hypot(fwd[0], fwd[2]) || 1; fwd = [fwd[0]/fl, 0, fwd[2]/fl];

    orbitClock += dt;
    const azTarget = camMode === "orbit" ? Math.sin(orbitClock * 0.5) * 1.15 : 0; // ±66° sweep
    camAz += (azTarget - camAz) * Math.min(1, dt * 2.5);  // smooth toward target
    const behindDir = _rotY([-fwd[0], 0, -fwd[2]], camAz);

    const groundY = pAABB ? pAABB.min[1] : 0;  // feet of our digimon

    let eye, look;
    let up = UP;                 // world up, unless an op5 shot's +0x24 angles turn it
    let rollDeg = 0;             // the shot's +0x2c roll, in degrees (0 for every other camera)
    let fovRad = Math.PI/4;
    // The idle director's OWN record for this tick, when the battle's camera is the one
    // running. It is the 14 words FIGHTSTG_F0x8008718c re-cuts through [0xf8] every tick it
    // runs (fightstg.s:5115-5125) — including the yaw at +0x26, which is what turns the held
    // shot about the arena origin. Its dwell and its turn run on the RAW per-frame delta
    // `[0x8004df9c]()`, so the walker's seconds are converted the same way the loss orbit
    // does it: whole 60 Hz frames, never the slow-motion-published delta (LOSS_CAM's note).
    let directorFields = null;
    // The director's idle shot owns the frame in BOTH idle-camera modes, not only "director" (the
    // command-picking states). "behind" is everything else the battle flow hands this camera once
    // the walker's own modes are excluded — the acting phases, RESULT_MSG, the intro. While the
    // menu is up the director runs and re-cuts its record through [0xf8] every tick
    // (fightstg.s:5096-5105); on the confirm edge the command screen retires it (state 3, then
    // the object is freed), so for the whole attack the frame owner holds the shot the retire
    // cut — the plain arena shot — instead of the walker's computed over-the-shoulder shot.
    // `directorHeld` is only the fallback before the first menu. The tag/game/defeat/orbit modes
    // below keep their own cameras.
    if (camMode === "director" || camMode === "behind") {
      if (camMode === "director") {
        // The director exists while the menu is up; a fresh one is built on the first menu and
        // after every retire. Its row-3 opening shot is only ticked once both fighters' staging
        // records exist — the fight's setup block creates it after them (fightstg.s:16136-16162,
        // see stagingRecordsReady) — so its dwell is not burnt on a page with nothing to show.
        if (!idleDirector) idleDirector = makeIdleDirector();
        const f = idleDirectorTick(idleDirector, idleClock, dt,
          stagingRecordsReady(placementTable, playerFolder, enemyFolder));
        if (f) directorHeld = f;
        directorFields = f;
      } else {
        // "behind": the director is RETIRED (gone), so there is nothing to tick — the record
        // owner holds the shot the retire cut. That is what re-homes the camera for the next
        // turn, and why the camera does not restart its walk mid-attack.
        directorFields = directorHeld;
      }
      if (camMode === "behind") {
        // The walker's own over-the-shoulder shot. It is now only a FALLBACK: the record owner
        // cuts it while the director's held record has not resolved yet (before both staging
        // records land).
        const radius = Math.max(140, pH * 1.7);
        eye  = [ pCenter[0] + behindDir[0]*radius, pCenter[1] + pH*0.75, pCenter[2] + behindDir[2]*radius ];
        look = [ pCenter[0] + fwd[0]*pH*3.0,
                 groundY + pH*0.55,
                 pCenter[2] + fwd[2]*pH*3.0 ];
      }
    } else if (camMode === "tag") {
      // Sequence 0x38's captured arrival is a frontal full-body shot. Reuse
      // the game's decoded high-front canned camera (op5 preset 3).
      const p = OP5_PRESETS[3];
      eye  = ps1ToRender(p.eye, MODEL_SCALE);
      look = ps1ToRender(p.target, MODEL_SCALE);
      fovRad = fovYFromH(p.H) * Math.PI / 180;
    } else if (camMode === "game") {
      // REAL PS1 battle camera (session-23 dump): absolute eye/target in PS1 world × MODEL_SCALE,
      // mapped by ps1ToRender. eye=(-3840,-2432,-4608), target=(0,-2048,768).
      const s = MODEL_SCALE;
      const look0 = ps1ToRender([0, -2048 * gameCam.height, 768], s);
      const eye0  = ps1ToRender([-3840 * gameCam.side, -2432 * gameCam.height, -4608], s);
      // zoom = slide the eye along (eye → look)
      eye  = [ look0[0] + (eye0[0]-look0[0])*gameCam.zoom,
               look0[1] + (eye0[1]-look0[1])*gameCam.zoom,
               look0[2] + (eye0[2]-look0[2])*gameCam.zoom ];
      look = look0;
      fovRad = gameCam.fovDeg * Math.PI / 180;
    } else if (camMode === "defeat") {
      // F0x8008c93c: the cut to OUR digimon's canned near shot 11, then the shot frame's
      // Y angle gains `delta * 2` every frame. Phase 1 also adds the same delta to +0x10
      // and switches to phase 2 at >= 0xf0. The delta here is the RAW one from 0x8004df9c,
      // which the orbit reads directly — the slow-motion level 2 the effect sets applies
      // to the battle's animation clock, not to the camera. The anchor F0x800923b4 leaves
      // zeroed is the arena origin, so both the eye and the look-at swing around it.
      // One delta per 60 Hz frame, from the real elapsed time, so a faster display
      // does not turn the camera faster.
      defeatClock += dt;
      defeatDelta = Math.floor(defeatClock * 60) * LOSS_CAM.deltaPerFrame;
      const p = lossShot() || OP5_PRESETS[4];
      const turned = rotateShotYaw(p.eye, p.target, lossCamYawUnits(defeatDelta));
      eye  = ps1ToRender(turned.eye, MODEL_SCALE);
      look = ps1ToRender(turned.target, MODEL_SCALE);
      fovRad = fovYFromH(p.H) * Math.PI / 180;
    } else if (camMode === "orbit") {
      // Sweep around OUR digimon, framing its full body (scale-aware on pH).
      const radius = Math.max(180, pH * 2.4);
      eye  = [ pCenter[0] + behindDir[0]*radius, pCenter[1] + pH*0.30, pCenter[2] + behindDir[2]*radius ];
      look = [ pCenter[0], pCenter[1], pCenter[2] ];
    } else if (camMode === "opening") {
      // The battle-open camera flourish OWNS the camera for the whole opening. Tick the actor on
      // the RAW per-frame delta (its dwell is `[0x8004df9c]()`, 1 a frame) and install the record
      // it names — a cut ([0xf8]) or a glide ([0xfc]) — through the one record owner. It starts
      // only once both fighters' staging records exist, exactly as the disc creates it after the
      // fighters are placed, so its dwell is not burnt on a page with nothing to show.
      if (!openCamera) beginOpeningCamera();
      if (openCamera && !openCameraGone
          && stagingRecordsReady(placementTable, playerFolder, enemyFolder)) {
        const out = openCamera.update(openClock.tick(dt));
        openCameraArm = out.arm;
        if (out.action) {
          openCameraHeld = out.action.fields;
          if (out.action.kind === "move") camRec.move(out.action.fields, out.action.duration, { issuer: "battle" });
          else camRec.cut(out.action.fields, { issuer: "battle" });
        }
        if (out.gone) openCameraGone = true;
      }
    }
    // No trailing catch-all: the director/behind arms above are the battle's idle camera and its
    // over-the-shoulder fallback, and `setCameraMode` only ever installs those six modes.

    // THE camera record, and who owns it. The original's camera object holds one live record
    // (F0x80092244 / F0x800922b4 / F0x80091df4) and NOTHING clears it, so the record drawn this
    // frame is the last one any writer installed. There is no third state to fall back from: if
    // there is no record yet, the shot this branch just computed is the record.
    //
    // `camScriptOwned` is the original's own arbitration and the ONLY thing that stops the
    // battle's camera from touching the record. It is true while an action's script owns the
    // record (a running VM, or a glide still in flight) AND while the director is RETIRED
    // (`directorRetired`) — the disc's confirm edge frees the director, so for the rest of the
    // attack nothing re-publishes over the record. So:
    //   * script owns the camera, or the director is gone -> the record stands (an op5 outlives
    //     its own script), and
    //   * the battle's camera owns it -> it CUTS its own shot into the record now, which is
    //     what retires a stale action shot, and what the loss beat and the idle director do.
    //
    // The retire cut itself is applied by `retireIdleDirector` on the confirm edge, not here.
    const modeH = 120 / Math.tan(fovRad / 2);
    // The defeat shot is the ONE exception to the script gate: F0x8008C93C's entry tick cuts
    // `camMgr->[0x104](0, 0xB)` and its phases re-apply that record through [0xf8] every
    // frame with no test of any script — and the loss branch fires while the enemy's own
    // action script is still running (the controller's step runs before its children's), so
    // gating this cut on `camScriptOwned` left the retire shot on screen for the whole loss
    // beat and the defeat shot was never seen. The loss camera takes the one live record,
    // exactly as `setCameraMode`'s own note says the victory / loss / tag cameras do.
    if (!camScriptOwned || camMode === "defeat") {
      // The opening flourish installed its own record in the "opening" arm above — a cut or a
      // glide — and once it self-destructs the record holds the plain arena re-cut it left. The
      // battle's generic behind/over-the-shoulder shot must not overwrite it.
      if (camMode === "opening") {
        // nothing to do here: the actor owns the record
      } else if (directorFields) {
        // The record lives in the PS1 battle world (it is the original's cam struct), so the
        // cut hands it renderToPs1 and the read below hands it back ps1ToRender.
        //
        // The idle director brings its OWN 14 words — eye, target, anchor, the three frame
        // angles, roll and H, already in PS1 units — because in the original that record is
        // edited in place and re-cut, and the yaw at +0x26 is what the arm's turn writes. A
        // null director record means its canned shot has not resolved yet, and then the record
        // stands, exactly as it does while a script owns the camera.
        camRec.cut(directorFields, { issuer: "battle" });
      } else if (camMode !== "director") {
        const s = MODEL_SCALE;
        camRec.cut([
          ...renderToPs1(eye, s), ...renderToPs1(look, s),
          0, 0, 0,                          // +0x18 anchor — an absolute shot has none
          0, 0, 0,                          // +0x24/+0x26/+0x28 frame angles
          rollDeg, modeH,                   // +0x2c roll, +0x30 projection distance
        ], { issuer: "battle" });
      }
    }
    const shot = camRec.sample();
    if (shot) {
      const s = MODEL_SCALE;
      eye  = ps1ToRender(shot.eye, s);
      look = ps1ToRender(shot.target, s);
      // The +0x24 angles turn the shot's frame, so its up vector is no longer world up.
      // PS1 -> render is the same one mapping the eye and target take.
      if (shot.up) up = ps1ToRender(shot.up, 1);
      rollDeg = shot.roll || 0;
      if (shot.H) fovRad = fovYFromH(shot.H) * Math.PI / 180;
    } else if (!(multiCam && extras.size)) {
      // The frame is drawn THROUGH the record, or not at all. `sample()` is null in exactly one
      // situation — no writer has installed a record yet — and then there is no view matrix to
      // build: `eye`/`look` were never computed for this mode, because a camera mode that computes
      // its own shot has already cut one and a director that cannot resolve its arm has not.
      //
      // The original has no such frame to get wrong. Its camera object holds the record from the
      // moment it is built, and the fight's FIRST cut is the arena shot — taken in the setup
      // phase, after both fighters' records exist (fightstg.s:16136-16162), with the loaders
      // leaving the staging block untouched when a record is missing (F0x8009257c
      // .L0x800925ac/.L0x800925c8, F0x800923b4 .L0x800923f0). So on the console this is the frame
      // the fight has not started on yet, and the disc's answer is that the arena is not up.
      //
      // It used to reach mat4LookAt with `eye` undefined and throw out of render(), which killed
      // the page's own frame loop on frame one (the Battle Lab has no state that cuts a record
      // before the director's first arm resolves). The canvas is already cleared to the sky's
      // bottom stop above, so holding the frame here is that dark screen — and nothing invents a
      // camera to fill it.
      return;
    }

    if (multiCam && extras.size) {   // (multiplayer) the wide shot of everybody owns the camera
      const c = _multiCameraShot();
      if (c) { eye = c.eye; look = c.look; up = UP; rollDeg = 0; fovRad = c.fov; } else if (!shot) return;
    }

    // DNA clip 12's verified explicit cameras sit ~9.1–9.6k render units from
    // their target (raw PS1 eye/target values reach 28,204).  The old generic
    // 8k far plane therefore clipped the entire authored Paildramon shot even
    // though its camera transform was correct.  Widen only explicit op5 shots;
    // normal battle/preset framing keeps the tighter arena depth range.
    const liveRec = camRec.get();
    const explicitShot = liveRec?.kind === "move"
      || (liveRec?.kind === "cut" && liveRec.issuer !== "battle");
    const farPlane = explicitShot ? 60000 : 8000;
    const proj = mat4Perspective(fovRad, W/H, 1, farPlane);
    // Blast phase 1 is a camera PUSH-IN on the fighter (captured f24-f180) and
    // phase 8 returns it (f800-f880). Dolly the eye toward the player along its
    // own view ray rather than narrowing the fov, so the framing changes the way
    // a moving camera does and the backdrop parallax comes with it.
    // WALKER VISUAL: the capture fixes that it pushes in and how far it reads,
    // not the exact eye path.
    let camEye = eye, camLook = look, camUp = up;
    if (blastState && blastState.cameraPush > 0) {
      // FIT the shot to the model rather than dollying a fixed fraction. Three
      // hand-tuned fractions (0.42, 0.22, 0.12) all cropped the figure, because
      // the INCOMING form is usually a far bigger Digimon than the one being
      // blasted, so any constant framed for one model fails for the next. Solve
      // for the distance at which this frame's actual mesh height fills the
      // target share of the view, and ease into it.
      // WALKER VISUAL: the capture fixes that the camera pushes in and that the
      // whole figure stays in shot, not the eye path that achieves it.
      // 0.52 leaves headroom: the fit is solved against the mesh's REST bounds,
      // and the revealed form animates past them (arms raised), which clipped
      // its head at 0.62.
      const FILL = 0.52;                                // share of frame height
      const dx = eye[0] - pCenter[0], dy = eye[1] - pCenter[1], dz = eye[2] - pCenter[2];
      const len = Math.hypot(dx, dy, dz) || 1;
      const fit = (pH / FILL) / (2 * Math.tan(fovRad / 2));
      const g = blastState.cameraPush;
      const d = len + (fit - len) * g;
      camEye = [pCenter[0] + (dx / len) * d, pCenter[1] + (dy / len) * d,
        pCenter[2] + (dz / len) * d];
      // Centre the aim on the fighter's own mesh centre, so the framing does not
      // depend on which way this scene's model space runs.
      camLook = [
        look[0] + (pCenter[0] - look[0]) * g,
        look[1] + (pCenter[1] - look[1]) * g,
        look[2] + (pCenter[2] - look[2]) * g,
      ];
    }
    // The +0x2c roll turns the finished SCREEN, so it is applied last, to the render-space up
    // vector, after the blast dolly has settled camEye/camLook. 7 shipped packs author it.
    if (rollDeg) camUp = applyScreenRoll(camUp, camEye, camLook, rollDeg);
    const view = mat4LookAt(camEye, camLook, camUp);
    const pv   = mat4Mul(proj, view);
    if (extras.size) _projectExtras(pv, W, H);
    lastCamInfo = {
      eye, look, fovDeg: fovRad * 180 / Math.PI,
      // PS1 convention, matching the record's own frame.
      up: renderToPs1(up, 1), roll: rollDeg,
      // fovRad is the VERTICAL fov (fovYFromH), so the projection distance comes back through
      // the screen's 240-line half-height. Reading it back through 160 reported an H a third
      // too large, and the record owner feeds this number to real camera paths.
      H: 120 / Math.tan(fovRad / 2),
      // The defeat effect's own numbers, so a check can read the orbit straight off the
      // camera instead of inferring it from the eye: 0x800a46d8+0x26 out of 4096, and the
      // raw game delta the orbit has consumed so far.
      defeatYaw: lossCamYawUnits(defeatDelta), defeatDelta,
    };
    // Snapshot for getEffectDraw (battle.js composites the op3 sprites over this frame).
    _fxView = { pv, w: W, h: H, playerPos: playerPos.slice(), enemyPos: enemyPos.slice() };

    const dfActive = dataFieldIsActive();
    syncSpecialLoop(dfActive);   // the pack's own BT_LOOP voice lives exactly as long as the pack
    // The Blast vortex replaces the arena with the same black void the DNA
    // presentation uses, from its captured f180 fade onward.
    const blastVoid = !!blastState && blastState.voidAlpha >= 1;
    const dnaVoidActive = !!dnaPresentation || blastVoid;
    // The ordinary battle's per-area arena (MEFT10<trigger param>), when one is loaded. It is
    // drawn the same way as the special backdrop — a scene of wall+floor meshes through this
    // frame's camera — but it is the environment for the WHOLE fight, not a cast window.
    const arenaActive = !dfActive && !dnaVoidActive
      && !!(activeArena && activeArena.groups && activeArena.groups.length);

    // Sky background (draw first, no depth write). During a special the per-element backdrop
    // replaces the arena environment: black void + the MEFT10<sigEffect> wall+floor meshes drawn
    // ADDITIVELY (abr=1) through this frame's camera — the same 3D scene the real game renders.
    gl.depthMask(false);
    // The arena view's background colour, when the ported effect-tint feed has set one
    // (view+0x12C); otherwise each branch keeps its own default (black void / sky).
    const bgTint = arenaTint;
    if (dnaVoidActive) {
      drawQuad(gl, texP, IDENT_MVP, skyBufs, whiteTex, 1, bgTint || [0, 0, 0, 1]);
    } else if (dfActive) {
      drawQuad(gl, texP, IDENT_MVP, skyBufs, whiteTex, 1, bgTint || [0, 0, 0, 1]);   // black void (full screen)
      // Backdrop shares the live battle camera, but with a FAR clip plane pushed way out: the mesh
      // spans ±20479×MODEL_SCALE (≈±7168 world) and its far edge exceeds the scene's 8000 far plane
      // at wide shots → far triangles clipped to black holes. A 60000 far plane keeps it all in.
      const bdPV = mat4Mul(mat4Perspective(fovRad, W / H, 1, 60000), view);
      const world = ps1ToRenderMatrix(MODEL_SCALE);   // fight-model → world, the one mapping
      // Spin phase: each group lerps 0→spinDeg over BD_ROT_MS from when the backdrop appeared, then
      // holds (the real ctrl reaches its target at frame 121 then sentinel-holds).
      const spinT = Math.min(1, Math.max(0, (performance.now() - dataFieldOnAt) / BD_ROT_MS));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);                                 // additive (abr=1)
      for (const g of activeBackdrop.groups) {
        if (!g.count) continue;
        // Y-axis spin about the arena centre (X,Z scaled equally, so it commutes with `world`).
        const mvp = g.spinDeg
          ? mat4Mul(mat4Mul(bdPV, world), mat4RotateY(g.spinDeg * spinT * Math.PI / 180))
          : mat4Mul(bdPV, world);
        drawProjLayer(gl, texP, mvp, g, g.page === "floor" ? activeBackdrop.floorTex : activeBackdrop.wallTex, 1);
      }
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);           // restore normal alpha blend
    } else if (arenaActive) {
      // Ordinary battle: the per-area arena scene over the arena view's own background colour —
      // SFSTDATA[arenaId]+0x0c is the sky (record 1 = (59,115,233), matching the captured
      // grassland sky), the same view+0x12C the effect-tint feed writes; the fight's setup
      // default is black. Each group carries its own CLUT palette, so its texture is the one
      // resolved for that palette group (decoded live 2026-10-07).
      //
      // BLEND, DECODED LIVE 2026-10-07, NOW APPLIED — see
      // .dw3-research/playtest-arena-palette-rig-2026-10-07/results.md §5: the arena's textured
      // quads are cmd 0x2C (POLY_FT4, texpage semi bits 0), i.e. the GPU draws them OPAQUE
      // (no blending). Applied here only because the SAME display-list interpreter's back-face
      // cull is now run on the arena draw (`arenaCullIndices`): painting the UNCULLED set opaque
      // blackened the forest (14% black vs the rig frame's 4%) because the pack's back-facing
      // primitives — which the original drops before packing — covered the scene. With the cull
      // the surviving set is the original's own post-cull set, so opaque paints the scene the
      // original shows. `arenaLegacy` keeps the pre-decode alpha/one-palette render for captures.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      drawQuad(gl, texP, IDENT_MVP, skyBufs, whiteTex, 1, arenaBg || bgTint || [0, 0, 0, 1]);   // the arena view's sky colour
      const bdPV = mat4Mul(mat4Perspective(fovRad, W / H, 1, 60000), view);
      const world = ps1ToRenderMatrix(MODEL_SCALE);
      const mvp = mat4Mul(bdPV, world);
      arenaCullLog.kept = 0; arenaCullLog.total = 0; arenaCullLog.groups = [];
      if (arenaDebug.opaque) gl.disable(gl.BLEND);         // OPAQUE: the decoded arena blend (cmd 0x2C)
      else { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
      // DEPTH-SORT THE ARENA — the original's ordering table, ported by the SAME display-list
      // interpreter. Each arena primitive carries an OT Z the walker already decodes
      // (`engine/dw3/battle-displaylist.ts#buildMeshFields`: `fields.otz = avsz(...)`, read off
      // node+0x7c) and the original inserts its quads into that table, so the GPU draws them
      // back-to-front by depth. Our arena draw instead emits one drawElements per (page, CLUT)
      // TEXTURE group, which reorders the primitives relative to the display list; with depth
      // writes off (the frame sets depthMask(false)), the last group drawn wins, so a far
      // sky/backdrop group painted over the near ground — the operator's "flat blue rectangular
      // patches / disconnected chunks". Writing depth restores the original's depth order: the
      // render becomes independent of the grouping, exactly as the OT makes it independent of
      // the emit order. Decoded + measured 2026-10-07,
      // .dw3-research/arena-construction-2026-10-07/worker-e.md.
      if (arenaDebug.depthWrite) gl.depthMask(true);
      for (const g of activeArena.groups) {
        if (!g.count) continue;
        const tex = arenaTextureFor(activeArena, g);
        const idx = arenaDebug.cull ? arenaCullIndices(mvp, g) : null;
        if (idx) arenaCullLog.groups.push({ page: g.page, clut: g.clut, kept: idx.length / 3, total: (g.count / 3) | 0 });
        if (arenaDebug.cull) drawProjLayerIndexed(gl, texP, mvp, g, tex, idx);
        else drawProjLayer(gl, texP, mvp, g, tex, 1);
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      // THE ARENA IS A BACKGROUND LAYER — its own pass must not reject the entities drawn after
      // it. The arena writes depth above so its (page,CLUT) groups depth-sort like the original's
      // ordering table (the flat-blue-patch fix), but the Digimon and the effects are drawn AFTER
      // this branch and depth-test with LEQUAL. The arena is drawn through a 60000-far projection
      // and the ordinary fighters through an 8000-far one, so at the same world point the
      // fighter's window depth is a hair LARGER (farther) than the arena's and LEQUAL throws the
      // fighter fragment away: a standing fighter lost its legs and a DOWNED fighter (flat at
      // floor level) vanished entirely — the operator's "monsters falling through the ground /
      // downed Minotarumon almost invisible". MEASURED 2026-10-07 on the live renderer: enemy
      // silhouette 5148 -> 20770 px with the arena write off, downed enemy 0 -> 10986 px.
      // .dw3-research/fighter-depth-regression-2026-10-07/worker-u.md.
      //
      // The original has no z-buffer here: it sorts whole primitives back-to-front in its ordering
      // table, so the arena background is painted and the entities are painted over it — no
      // fighter is ever depth-rejected by the background. Reproduce that: the arena's own order is
      // already resolved on the colour buffer, so CLEAR the depth it wrote and let the
      // fighters/effects start from a clean buffer. This is the treatment the sky (depthMask
      // false) and the face box (its own depth clear) already get, and it cannot regress the
      // flat-patch fix, which lives in the colour buffer now, not the depth buffer.
      if (arenaDebug.depthWrite && arenaDebug.depthClear) gl.clear(gl.DEPTH_BUFFER_BIT);
    } else {
      drawQuad(gl, texP, IDENT_MVP, skyBufs, skyTexture, 1, bgTint || [1,1,1,1]);
    }
    gl.depthMask(true);

    // Arena floor (skipped during the special: the backdrop is a full-screen 2D scene; and skipped
    // when the disc's own per-area arena is loaded, which supplies its own ground).
    if (!dfActive && !dnaVoidActive && !arenaActive)
      drawQuad(gl, texP, pv, floorBufs, arenaTexture || whiteTex, 1, [0.8,0.8,0.85,1]);

    // ── Digimon rendering (skeletal if loaded, billboard fallback) ──
    // Blast transformation: past the captured swap frame the fighter is the
    // INCOMING form, drawn first as a green wireframe and then as the solid
    // model, cross-fading on the decoded schedule. Between the swap and the
    // wireframe materializing (f312-f360) neither is drawn — the capture has the
    // old model whited out and the flames covering that gap, and those are
    // painted by web/blast-presentation.js over this frame.
    if (blastState && blastState.showNewModel && playerModel && playerSkelBufs) {
      if (blastState.solidAlpha > 0) {
        drawSkeletalMesh(gl, texP, pv, playerSkelBufs, playerTex || whiteTex, FIGHTER_TINT,
          blastState.solidAlpha);
      }
      if (blastState.wireframeAlpha > 0) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);                    // additive: it glows
        drawSkeletalMesh(gl, texP, pv, playerSkelBufs, whiteTex,
          [0.18, 1.0, 0.28, 1], blastState.wireframeAlpha, true);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
    } else if (playerVisible && playerModel && playerSkelBufs) {
      drawSkeletalMesh(gl, texP, pv, playerSkelBufs, playerTex || whiteTex, FIGHTER_TINT);
    } else if (playerVisible) {
      // The billboard quad's normal is render +Z, which under the one mapping is the PS1
      // screen's own toward-the-viewer, so the page reads the same way the console draws it.
      // The player's old flipX=true was a compensation for the mirrored world and goes with it.
      drawDigimonBillboard(gl, texP, pv, playerPos, DIGI_W, DIGI_H,
        playerTex || whiteTex, 1, FIGHTER_TINT, false);
    }
    if (enemyVisible && enemyModel && enemySkelBufs) {
      drawSkeletalMesh(gl, texP, pv, enemySkelBufs, enemyTex || whiteTex, FIGHTER_TINT);
    } else if (enemyVisible) {
      drawDigimonBillboard(gl, texP, pv, enemyPos, DIGI_W, DIGI_H,
        enemyTex || whiteTex, 1, FIGHTER_TINT, false);
    }

    if (extras.size) _drawExtras(pv);

    // Floor shadow ellipses. The Blast vortex has no floor to cast onto — the
    // capture is a black void from f180 — so both shadows drop with it.
    if (playerVisible && !blastVoid) drawShadow(gl, texP, pv, playerPos, 20, 8);
    if (enemyVisible && !blastVoid)  drawShadow(gl, texP, pv, enemyPos,  20, 8);

    // ── op6 flight meshes: root at the muzzle, per-layer ctrl-track TRS animation ──
    // The original builds a layer array of count+1 blocks (FIGHTSTG_F0x80084560): index 0 is
    // an implicit ROOT with no mesh, and the program rows fill 1..count. Every frame
    // FIGHTSTG_F0x80083e0c runs, in this order:
    //   1. sample all three ctrl sub-tracks for every layer (F0x800835f4 → +0x10 T,
    //      +0x18 R, +0x20 S, lerped between bracketing keyframes);
    //   2. OVERWRITE the root layer's translation and rotation with op6's from/to
    //      (ctrl+0x1c → layer0+0x10, ctrl+0x22 → layer0+0x18, at 0x800840e0..0x80084154) —
    //      which is why the root's placement is op6 data and not authored keyframes;
    //   3. per layer: hide test, then matrix = R(F0x8002b45c, Rz·Ry·Rx) scaled by S
    //      (F0x8002b23c is M·diag(s), i.e. R·S) with T widened into the matrix's translation,
    //      then CONCATENATED WITH THE PARENT LAYER'S matrix (GTE MVMVA per column at
    //      0x8008422c/0x80084270/0x800842b4).
    // So a layer's world transform is the product down its parent chain, not root·local.
    // 184 of the 572 shipped layer rows name a non-root parent.
    //
    // Hide rule (0x8008416c..0x80084194): the three scale components are read with `lh`
    // (SIGNED) and bitwise-ORed, then compared `slti 0x31`. A negative component sets the
    // sign bit, so ANY negative scale hides the layer — this is not an absolute-value test.
    // That is how staged effects reveal the bullet late.
    if (effectPlayer) {
      const flights = effectPlayer.projectileList();
      for (const fl of flights) {
        loadProjMesh(fl.id);
        const entry = projCache.get(fl.id);
        if (!entry || entry === "loading") continue;
        const s = MODEL_SCALE;
        // flight space -> render world as a matrix (the one mapping, ps1ToRenderMatrix —
        // and no per-side mirror: the packs are authored per side).
        const world = ps1ToRenderMatrix(s);
        const root = mat4Mul(mat4Translate(fl.pos.x, fl.pos.y, fl.pos.z),
                             mat4RotPSX(fl.rot?.x || 0, fl.rot?.y || 0, fl.rot?.z || 0));
        const base = mat4Mul(pv, mat4Mul(world, root));
        gl.depthMask(false);
        // Sample at the CLIP's frame for this tick, not at the raw tick: a clip can hold,
        // and packs 108/109 replay their beam segment four times, which a raw tick cannot
        // express.
        const frame = clipFrameAt(entry.clip, fl.t);
        const { world: layerWorld, shown } = projLayerWorlds(entry.layers, frame, base);
        for (let li = 0; li < entry.layers.length; li++) {
          const L = entry.layers[li];
          if (!L.count || !shown[li + 1]) continue;
          for (const g of L.groups) {
            // PS1 semi-transparency, already converted from the one-based `0xEn` state nibble
            // by meshAbrMode. `null` means the primitive carries no semi-transparent bit at
            // all and is drawn OPAQUE; otherwise the hardware mode is
            //   0 = 0.5·B + 0.5·F,  1 = B + F (additive glow),
            //   2 = B − F (subtractive),  3 = B + 0.25·F (faint additive).
            // After the conversion nothing in the shipped packs uses mode 2 — the subtract
            // path stays only because the hardware has it.
            if (g.abr === null) {
              // Opaque. The texel still drops out where its palette entry is 0x0000, which
              // the atlas bakes as alpha 0, so this is a straight cut-out draw.
              gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            } else if (g.abr === 2) {
              gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
              gl.blendFunc(gl.ONE, gl.ONE);
            } else if (g.abr === 0) {
              gl.blendColor(0, 0, 0, 0.5);
              gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
            } else if (g.abr === 3) {
              gl.blendColor(0, 0, 0, 0.25);
              gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE);
            } else {
              gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
            }
            drawProjLayer(gl, texP, layerWorld[li + 1], g, g.tex, 1.0);
            gl.blendEquation(gl.FUNC_ADD);
          }
        }
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(true);
      }
    }

    // ── Face-cam: OUR OWN Digimon's head in the box, whoever is speaking ──────────
    // Layer key 0x1009 shows a close-up of the player's partner (fighter slot 0 of the
    // battle manager). Speaker id 0 is the player side, 0x10 the enemy side
    // (terra-037-speaker16-enemy-side-20260906) and it chooses only WHICH of the record's
    // two framings is used (group 6 = player line, group 7 = enemy line).
    // WHETHER it is up at all is the box object's own rule (see faceBox below): up while
    // this side's command menu is up, down from the moment a battle message line is up,
    // back at the next menu. A presentation (Blast / digivolve / clip-12) covers it.
    faceCamRect = null;
    // The Blast transformation suppresses the face-cam inset, the way clip-12
    // Jogress does. Gated on the renderer's own state rather than a one-shot
    // call from battle.js: the 3D context is built asynchronously, so a call
    // made at trigger time can land before this renderer exists.
    const enemySpeaks = faceCamSpeaker === "enemy";
    // The box's camera is the PLAYER'S OWN stored framing, not a camera of ours, and the
    // record it comes out of is the player's fighter's — never the speaker's.
    // FIGHTSTG_F0x80094064 (fightstg.s:17805-17840) asks the battle manager for ONE fighter
    // record and hands the box both that record and its +0x14, so the speaker cannot move
    // either; F0x80091c1c (:15355-15409) then reads group 6 or 7 out of that record by the
    // speaker's side and F0x80091b8c (:15316-15352) builds the look-at from it. See
    // web/fight/battle-camera.js (faceBoxSource) for the full read, and
    // docs/research/battle/captures/face-box-camera-2026-10-03/ for the live capture that
    // shows the same record (383) for a player line and for an enemy line. Same PS1 ->
    // render mapping as every other shot here: ps1ToRender, the one mapping.
    const fb = faceBoxSource(placementTable, modelKeyFromFolder(playerFolder),
                             enemySpeaks ? "enemy" : "player");
    const faceShot = fb.shot;
    // Whether this record's own projection distance can put a picture in the box. It is the
    // console's arithmetic (see faceBoxDraws), not a judgement about the record: a record with
    // no projection distance shows the battle view's own picture through the window, because
    // every vertex it would submit lands on the same point.
    const boxDraws = faceBoxDraws(faceShot);
    faceBoxSubject = {
      key: fb.key, side: fb.side, group: fb.group,
      // Both fighters' own model keys, so a headless check can prove the box's
      // record is the PLAYER's and not the enemy's (the capture that settles it
      // reads 383 for both a player line and an enemy line).
      playerKey: modelKeyFromFolder(playerFolder),
      enemyKey: modelKeyFromFolder(enemyFolder),
      framed: boxDraws,
      // What the console read for this record, projection distance included, so a headless
      // check can see a neighbour read rather than a filter's verdict. null only for the two
      // records whose read leaves the SMDLDATA block (model keys 70 and 177).
      shot: faceShot,
    };
    // The subject is drawn in the player's own arena slot, which is where the box's stored
    // eye and target already point, so this is the plain player placement (arenaSlot).
    const boxSlot = arenaSlot(fb.record, "player");
    const boxPos = ps1ToRender(boxSlot, ARENA);
    if (faceBoxOnScreen && !faceBoxSuppressed && !blastState
        && playerVisible && playerSkelBufs && pAABB) {
      // Inner face TIM/viewport: 100×60 at (208, 76). The 104×64 bezel around
      // it is PGFGTC00 cel 0xA, drawn in battle.js.
      const uiScale = Math.min(W / 320, H / 240);
      const uiX = (W - 320 * uiScale) * 0.5;
      const uiY = (H - 240 * uiScale) * 0.5;
      const fw = Math.round(100 * uiScale);
      const fh = Math.round(60 * uiScale);
      const fx = Math.round(uiX + 208 * uiScale);
      const fyTop = Math.round(uiY + 76 * uiScale);
      const glY = H - fyTop - fh;    // GL viewport origin is bottom-left

      // The box is a WINDOW ONTO THE SAME 3D SCENE, not a portrait on a blank card. In the
      // original it is a view in its own right: rectangle 208,76,100,60 registered as layer
      // key 0x1009, window centre 258,106 (+0x118 at fightstg.s:17795), and an ordering
      // table of 50 entries (+0x148 at :17800 — F0x8001e1e8 stores the count at view+0x78 and
      // allocates count*20, so 0x32 is the table's depth, NOT a half-width). The console's
      // render pass walks all 30 views and runs each enabled view's own table
      // (F0x8001d504 -> view->0x154 = F0x8001e38c), so the box is a second view of the same
      // scene, and the reference frame shows the stage in it — cloud sky across the top third,
      // the arena floor and the far cliff below the head
      // (docs/research/battle/captures/face-box-rounds-2026-10-03/1-round1-menu-box-up.png).
      //
      // So the box draws the SAME stage objects this frame already drew for the battle view —
      // the sky quad and the arena floor, no second load — but through the BOX camera. Only
      // the sky quad is screen-space (identity MVP, so it covers whatever viewport it is
      // drawn into); the floor and the head go through the record's own shot. faceBoxScene
      // is that list, in one place, with the battle view's own backdrop rule folded in.
      //
      // WHEN THE RECORD'S PROJECTION DISTANCE IS NOT ONE, the original draws nothing here.
      // F0x80091c1c reads H out of the record and hands it over with no test at all
      // (fightstg.s:153cc4 -> :153ce0 -> :153bf0), and H reaches the GTE through one
      // `ctc2` (exe/fns.s:29902). With H == 0 the PS1's RotTransPers scale
      // ((H*0x20000/SZ3)+1)/2 is zero, so every vertex of every polygon submitted into this
      // view lands on the same point — the drawing offset, which the vertex loop adds to a
      // point's own window centre (fightstg.s:838dc-83920) — and a triangle whose three
      // vertices coincide has no area, so the GPU fills nothing. Nothing skips the draw
      // either: the view is still enabled, its table still runs, and its depth sort still
      // orders the polygons. The list is therefore EMPTY, and because this view has no
      // background colour of its own (the box driver never calls +0x12C, the view
      // constructor never writes view+0x18, and F0x800266b4 skips the fill when that flag is
      // clear — exe/fns.s:24595-24601) the window is left showing the battle view's own
      // picture, un-zoomed, behind the bezel. Which is why nothing here clears the window
      // when the list is empty.
      const scene = faceBoxScene({
        backdropOnly: dfActive || dnaVoidActive, draws: boxDraws,
      });
      if (scene.length) {
        gl.enable(gl.SCISSOR_TEST);
        gl.viewport(fx, glY, fw, fh);
        gl.scissor(fx, glY, fw, fh);
        gl.clearColor(0.04, 0.05, 0.09, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        const boxBufs = _faceBoxBuffers(gl);
        const s = MODEL_SCALE;
        const boxWorld = (v) => ps1ToRender(v, s);
        _updateSkeletalVBOGL(gl, playerModel, boxBufs, pBwm, boxPos, MODEL_SCALE,
                             false, playerYaw);
        // The picture inside the box is the 320x240 projection taken about the box's OWN
        // centre (258,106) and clipped to the 100x60 window, at the record's own projection
        // distance H. So the visible half-angles are atan(30/H) up and atan(50/H) across —
        // the window's size in game pixels over the same focal length the battle camera uses,
        // which is what faceBoxFovY returns. The window's aspect is the window's (100:60),
        // not the screen's, or the horizontal angle would come out 4/3 too wide.
        const fEye = boxWorld(faceShot.eye);
        const fLook = boxWorld(faceShot.target);
        const fProj = mat4Perspective(faceBoxFovY(faceShot.H) * Math.PI / 180,
                                      FACE_BOX_ASPECT, 1, 8000);
        const boxPV = mat4Mul(fProj, mat4LookAt(fEye, fLook, UP));
        for (const item of scene) {
          const mvp = item.mvp === "identity" ? IDENT_MVP : boxPV;
          if (item.what === "sky") {
            // No depth write: the sky is behind everything and must not occlude the head.
            gl.depthMask(false);
            drawQuad(gl, texP, mvp, skyBufs,
                     item.tex === "void" ? whiteTex : skyTexture, 1, item.tint);
            gl.depthMask(true);
          } else if (item.what === "floor") {
            drawQuad(gl, texP, mvp, floorBufs, arenaTexture || whiteTex, 1, [0.8,0.8,0.85,1]);
          } else {
            drawSkeletalMesh(gl, texP, mvp, boxBufs, playerTex || whiteTex, FIGHTER_TINT);
          }
        }
        gl.disable(gl.SCISSOR_TEST);
      }
      gl.viewport(0, 0, W, H);
      faceCamRect = { x: fx, y: fyTop, w: fw, h: fh };
    }
  }

  function drawDigimonBillboard(gl, prog, mvp, worldPos, w, h, tex, alpha, tint, flipX) {
    const hw = w * 0.5;
    // billboard always faces camera — use camera right from view matrix
    // For simplicity use fixed right/up since camera is fixed
    const cx = worldPos[0], cy = worldPos[1], cz = worldPos[2];
    // slight angle toward center of arena
    const lean = worldPos[0] < 0 ? -0.05 : 0.05;

    const tl = [cx - hw, cy + h, cz + lean * h];
    const tr = [cx + hw, cy + h, cz - lean * h];
    const br = [cx + hw, cy,     cz];
    const bl = [cx - hw, cy,     cz];

    const u0 = flipX ? 1 : 0;
    const u1 = flipX ? 0 : 1;
    const bufs = makeQuadBuffers(gl, [tl, tr, br, bl], [[u0,0],[u1,0],[u1,1],[u0,1]]);
    drawQuad(gl, prog, mvp, bufs, tex, alpha, tint);
    gl.deleteBuffer(bufs.vbo); gl.deleteBuffer(bufs.ubo); gl.deleteBuffer(bufs.ibo);
  }

  function drawShadow(gl, prog, mvp, pos, rx, ry) {
    // Flat ellipse on floor (y=0) as a dark transparent quad
    const cx = pos[0], cz = pos[2];
    const verts = [
      [cx-rx, 0.2, cz-ry], [cx+rx, 0.2, cz-ry],
      [cx+rx, 0.2, cz+ry], [cx-rx, 0.2, cz+ry],
    ];
    const bufs = makeQuadBuffers(gl, verts, [[0,0],[1,0],[1,1],[0,1]]);
    drawQuad(gl, prog, mvp, bufs, whiteTex, 0.35, [0,0,0,1]);
    gl.deleteBuffer(bufs.vbo); gl.deleteBuffer(bufs.ubo); gl.deleteBuffer(bufs.ibo);
  }

  function destroy() {
    clearFighters();
    for (const pk of Object.values(backdropPacks)) {
      if (pk.floorTex) gl.deleteTexture(pk.floorTex);
      if (pk.wallTex) gl.deleteTexture(pk.wallTex);
      for (const g of pk.groups || [])
        if (g && g.vbo) { gl.deleteBuffer(g.vbo); gl.deleteBuffer(g.ubo); }
    }
    [arenaTexture, skyTexture, playerTex, enemyTex, whiteTex].forEach(t => {
      if (t) gl.deleteTexture(t);
    });
    gl.deleteBuffer(floorBufs.vbo); gl.deleteBuffer(floorBufs.ubo);
    gl.deleteBuffer(floorBufs.ibo);
    gl.deleteBuffer(skyBufs.vbo); gl.deleteBuffer(skyBufs.ubo);
    gl.deleteBuffer(skyBufs.ibo);
    freeSkelBufs(playerSkelBufs);
    freeSkelBufs(enemySkelBufs);
    gl.deleteProgram(texProg);
  }

  return {
    setPlayerDigimon,
    preloadDigimon,
    setPlayerVisible,
    setEnemyVisible,
    setFighterBaseIdle,
    dnaOrbIgnite, dnaOrbsPath, dnaOrbsClear,
    dnaPresentationStart, dnaFusionStart, dnaPresentationStop,
    blastPresentationSet, blastPresentationStop, blastSpawnEffect,
    // The arena view's background colour (view+0x12C), the sink for the ported effect-tint
    // feed FIGHTSTG_F0x800861f4. Pass (r,g,b) in PS1 view-colour bytes (0..255), or no
    // argument to clear it back to the renderer's own defaults.
    setArenaTint,
    // The per-area ordinary-battle arena (MEFT10<trigger param>). Call with the field screen the
    // fight started on and the encounter id it rolled; the arena table (from the stage's own
    // battle-trigger records) resolves the id. Returns the loaded arena pack or null.
    setArenaStage,
    // Debug/before-after only: fall back to the pre-decode arena render — one palette per atlas
    // page (floor.png/wall.png) composited with alpha — so a capture can show the palette+blend
    // change side by side. Production always uses the decoded per-CLUT palette + opaque blend.
    setArenaLegacy,
    // Debug/before-after only: select the arena draw. Default is the shipped decode (per-prim
    // palette + the ported back-face cull + the OPAQUE blend). `{cull:false, opaque:true}` shows
    // the opaque blend without the cull (the 14%-black regression); `{cull:true, opaque:false}`
    // shows the cull composited with alpha; `{legacy:true}` is the pre-decode render.
    setArenaDebug,
    // Debug only: flip the back-face cull sign (default +1 = decoded). Returns the sign.
    setArenaCullSign,
    // Debug/diagnostics: the arena pack currently selected for the ordinary battle (pack, id).
    get arenaStage() {
      const id = arenaIdFor(arenaStageReq?.mapId, arenaStageReq?.screenId);
      return { mapId: arenaStageReq?.mapId ?? null, screenId: arenaStageReq?.screenId ?? null,
               arenaId: id, pack: id == null ? null : `meft10${String(id).padStart(2, "0")}`,
               bg: arenaBg ? arenaBg.slice(0, 3).map((v) => Math.round(v * 255)) : null,
               loadedGroups: activeArena?.groups?.length ?? 0,
               cull: { keptTri: arenaCullLog.kept, totalTri: arenaCullLog.total, sign: arenaCullSign, groups: arenaCullLog.groups } };
    },
    setEnemyDigimon,
    // (multiplayer many-vs-many, web/mpbattle.js)
    addFighter, removeFighter, clearFighters, setFighterLane, setFighterVisible, setFighterHurt, setMultiCamera,
    fighterAttack, fighterReact, fighterVictory, fighterTech, fighterAction, fightersReady, fightersBusy, getFighterScreen,
    setPlayerAnim,
    setEnemyAnim,
    playPlayerVictory,
    playPlayerActionClip,
    playPlayerItemUse,
    playPlayerThrowItem,
    playPlayerScript,
    setPlayerAnimByTech,
    setEnemyAnimByTech,
    playerAttack,
    enemyAttack,
    coordinator,
    get playerAnimator() { return playerAnim8r; },
    get enemyAnimator()  { return enemyAnim8r; },
    get playerVictoryComplete() { return !!playerAnim8r?.timelineCycleComplete; },
    // Debug (motion browser): play raw timeline table `idx` on the player; list non-empty tables.
    debugPlayPlayerTable(idx) {
      const t = playerModel?.timeline?.[idx]?.table;
      if (!playerAnim8r || !t || !t.length) return false;
      playerAnim8r.debugPlayTable(t);
      return true;
    },
    debugTimelineTables() {
      return (playerModel?.timeline || []).map((p, i) => ({ idx: i, len: p.table?.length || 0 }))
        .filter(x => x.len > 0);
    },
    // Debug (fight-action-lab): play an ORDERED SEQUENCE of timeline tables back-to-back on the
    // player (the assembled action the user composes), looping by default so it can be studied.
    debugPlayPlaylist(tableIndices, opts) {
      if (!playerAnim8r || !playerModel) return false;
      const tables = (tableIndices || [])
        .map(i => playerModel.timeline?.[i]?.table)
        .filter(t => t && t.length);
      if (!tables.length) return false;
      playerAnim8r.debugPlayPlaylist(tables, opts || {});
      return true;
    },
    // Debug (fight-action-lab): set the global per-tick table step (GLOBAL_SPEED) to judge timing.
    debugSetSpeed(n) { GLOBAL_SPEED = Math.max(1, n | 0); return GLOBAL_SPEED; },
    // Debug (tools/verify_texture_patches.mjs): hold a fighter's eyes at one state and
    // blit immediately. The blink itself is six ticks long at GLOBAL_SPEED 2, so a
    // wall-clock screenshot can never be relied on to catch it; F0x8008b118's state
    // override is the deterministic way in. State 1 = the blink runs (open), 2 = half,
    // 4..11 = shut. Returns how many patches were re-blitted.
    debugHoldPatchState(side, state) {
      const patches = side === "enemy" ? enemyPatches : playerPatches;
      const tex = side === "enemy" ? enemyTex : playerTex;
      const page = side === "enemy" ? enemyPage : playerPage;
      if (!patches) return 0;
      // Latch it, or the next sim tick puts the eye straight back. Pass null to hand
      // the fighter back to its own animation.
      const held = state === null ? null : state | 0;
      if (side === "enemy") enemyPatchHold = held; else playerPatchHold = held;
      if (held === null) return 0;
      let blitted = 0;
      for (const patch of patches.update(0, held))
        if (blitTexturePatch(tex, page, patch)) blitted++;
      return blitted;
    },
    // Debug (tools/verify_texture_patches.mjs): read one patch's DESTINATION rectangle
    // back off the live GPU texture and compare it with the source rectangle the current
    // variant should have put there. This is the end-to-end proof that the blit happened:
    // a screenshot cannot show it, because the eye is a handful of pixels on screen and
    // the idle animation moves every frame regardless.
    debugReadPatchPixels(side, index = 0) {
      const patches = side === "enemy" ? enemyPatches : playerPatches;
      const tex = side === "enemy" ? enemyTex : playerTex;
      const page = side === "enemy" ? enemyPage : playerPage;
      const entry = patches?.entries[index];
      if (!entry || !tex || !page) return null;
      const r = texturePatchRect(entry, page.scale);
      const w = r.w, h = r.h;
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const got = new Uint8Array(w * h * 4);
      const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      if (complete) {
        gl.readPixels(r.dx, r.dy, w, h,
                      gl.RGBA, gl.UNSIGNED_BYTE, got);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
      if (!complete) return null;

      let mismatched = 0;
      for (let row = 0; row < h; row++) {
        const from = ((r.y0 + row) * page.width + r.x0) * 4;
        for (let i = 0; i < w * 4; i++)
          if (page.data[from + i] !== got[row * w * 4 + i]) mismatched++;
      }
      // Hand the pixels back as an image so a capture can show the actual eye.
      const canvas = typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement("canvas"), { width: w, height: h });
      const ctx = canvas.getContext("2d");
      ctx.putImageData(new ImageData(new Uint8ClampedArray(got), w, h), 0, 0);
      return {
        width: w, height: h, variant: entry.variant, mismatched,
        canvas: typeof canvas.convertToBlob === "function" ? null : canvas.toDataURL(),
        rgba: Array.from(got),
      };
    },
    // Debug: is a fighter's patch animation actually up (table row + page pixels)?
    debugPatchState(side) {
      const patches = side === "enemy" ? enemyPatches : playerPatches;
      const page = side === "enemy" ? enemyPage : playerPage;
      const a = side === "enemy" ? enemyAnim8r : playerAnim8r;
      return {
        entries: patches ? patches.entries.length : 0,
        variants: patches ? patches.entries.map((e) => e.variant) : [],
        page: page ? { width: page.width, height: page.height, scale: page.scale } : null,
        timelineTable: a ? a.timelineTable : null,
        animationId: patchState(side),
      };
    },
    // Debug (tools/verify_proj_layers.mjs): put ONE op6 flight mesh on screen at an EXACT
    // tick and render a single frame of it. The lab's animation is wall-clock driven, so
    // two ordinary runs never land on the same frame and their screenshots cannot be
    // compared; this pins the tick so a before/after capture is the same moment of the same
    // effect. It spawns through the real EffectPlayer and renders through the real
    // render(), so it exercises the shipped path rather than a stand-in.
    // `from`/`to` default to Armormon's basic-attack record `[0,39, 0,0,5120, 0,2048,0]`
    // AFTER the op6 handler's Y/Z negation (ActionVM._lunge) — the same vectors the live
    // attack passes, i.e. the muzzle at our own slot, not the raw words.
    debugRenderProjectileAt(id, tick, { side = "player", from = [0, 0, -5120],
                                        to = [0, -2048, 0] } = {}) {
      if (!effectPlayer) return false;
      effectPlayer.projectiles.length = 0;
      if (!effectPlayer.spawnProjectile(id, from, to, side)) return false;
      effectPlayer.projectiles[0].t = tick;
      render(0);
      return true;
    },
    // Debug (tools/verify_proj_layers.mjs): the frame that render() just produced, as a PNG
    // data URL. Captures read this instead of screenshotting the page, because the host page
    // blits the offscreen canvas on its own animation frame and would otherwise overwrite a
    // pinned frame before it could be photographed.
    async debugCaptureFrame() {
      if (canvas.convertToBlob) {
        const blob = await canvas.convertToBlob({ type: "image/png" });
        return await new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.readAsDataURL(blob);
        });
      }
      return canvas.toDataURL("image/png");
    },
    // Debug: is the pack's geometry loaded and ready to draw? The mesh cache is lazy and
    // async, so a capture taken before it resolves is a blank frame, not a result.
    debugProjectileReady(id) {
      loadProjMesh(id);
      const e = projCache.get(id);
      return !!(e && e !== "loading" && e.layers.length &&
                e.layers.every((L) => !L.count || L.groups.every((g) => g.texReady)));
    },
    // Debug: set the move-back sync-ramp rate (MOVE_SPEED). Lower = longer move-back. Takes effect on
    // the NEXT attack (the VM reads it at construction). Tune to match the real game, then we lock it.
    debugSetMoveSpeed(n) { return setMoveSpeed(n); },
    // Debug (headless verification): each fighter's live arena offset from its home slot, in PS1
    // units. The op2 mode-5 motion object writes z here as an attacker steps toward its target, so
    // a capture script can measure the approach instead of eyeballing a screenshot.
    debugMoveDelta() {
      return {
        player: playerAnim8r ? playerAnim8r.moveDelta().slice() : null,
        enemy: enemyAnim8r ? enemyAnim8r.moveDelta().slice() : null,
      };
    },
    // Both fighters' home slots in PS1 arena units, for on-screen verification: they come
    // from each Digimon's own smdldata record, so they differ per matchup.
    debugArenaSlots() {
      return {
        player: playerAnim8r?.homeSlot || arenaSlotFor(playerFolder, "player", placementTable),
        enemy: enemyAnim8r?.homeSlot || arenaSlotFor(enemyFolder, "enemy", placementTable),
      };
    },
    // Special-attack per-element backdrop. Auto-fires on setPlayer/EnemyAnimByTech; exposed for the
    // battle lab / manual control. on=true shows it now (optional techId picks the element pack,
    // default = data-field fallback); on=false hides it.
    // Open the battle on the shot the enemy's record names. Returns the shot, or null
    // when either record is not loaded yet — in which case it is applied as soon as the
    // placement table lands.
    applyIntroCamera() { return applyArenaShot(); },
    /** The opening machine's phase-1 slot-6 create: build the battle-open camera actor once. */
    beginOpeningCamera,
    setDataField(on, techId) {
      dataFieldPinned = !!on;                            // hold until explicitly turned off
      if (on) triggerDataField(techId, performance.now() - BD_DELAY_MS);   // show immediately
      else dataFieldOffAt = 0;
    },
    get dataFieldActive() { return dataFieldIsActive(); },
    setCameraMode,
    getCameraMode,
    setSlowMotion,
    getAnimationReadout,
    setGameCamParam,
    getCameraInfo,
    getFaceCamRect,
    setFaceCamVisible,
    syncFaceBox,
    /** Whether the close-up box object is on screen right now (the rule's own answer). */
    getFaceBoxOnScreen() { return faceBoxOnScreen && !faceBoxSuppressed; },
    getFaceCamSpeaker() { return faceCamSpeaker; },
    setFaceCamSpeaker(speaker) { faceCamSpeaker = faceCamSideFor(speaker); },
    /** Which model record the box drew this frame, and both fighters' own keys. */
    getFaceBoxSubject() { return faceBoxSubject ? { ...faceBoxSubject } : null; },
    __dnaDebug() {
      return {
        playerVisible, hasModel: !!playerModel, hasSkel: !!playerSkelBufs,
        playerPos: _fxView ? _fxView.playerPos.slice() : null,
        pAABB: pAABB ? JSON.parse(JSON.stringify(pAABB)) : null,
        eAABB: eAABBLast ? JSON.parse(JSON.stringify(eAABBLast)) : null,
        cam: lastCamInfo ? { eye: lastCamInfo.eye.map(Math.round), look: lastCamInfo.look.map(Math.round), H: lastCamInfo.H } : null,
        camScriptOwned,
        camMode,
        // The battle-open camera flourish's existence and walk, so a probe can see the row it
        // picked, the arm it ran and the frame it self-destructed (the object gone, the record
        // held on the plain arena shot).
        openCamera: {
          exists: !!openCamera, gone: openCameraGone,
          row: openCamera?.state().row ?? null,
          index: openCamera?.state().index ?? null,
          sub: openCamera?.state().sub ?? null,
          arm: openCameraArm,
          dwell: openCamera?.state().dwell ?? null,
          held: openCameraHeld ? openCameraHeld.slice() : null,
        },
        // The idle director's existence and walk, so a probe can see the retire edge (the object
        // gone, the record held on the retire shot) and the next-turn create (a fresh walk).
        director: {
          exists: !!idleDirector, retired: directorRetired,
          row: idleDirector?.state().row ?? null,
          index: idleDirector?.state().index ?? null,
          sub: idleDirector?.state().sub ?? null,
          dwell: idleDirector?.state().dwell ?? null,
          held: directorHeld ? directorHeld.slice() : null,
        },
        // The disc's own reaction camera for each fighter — its clip-10 op5 (see `_reactionCamFor`).
        // Null when the model authors none, which is the original's "no impact camera" case.
        playerFolder, enemyFolder,
        playerReactionCam: _reactionCamFor("player"),
        enemyReactionCam: _reactionCamFor("enemy"),
        camRecord: camRec.get() ? { kind: camRec.get().kind, issuer: camRec.get().issuer ?? null,
          preset: camRec.get().preset ?? null, fields: camRec.live(),
          progress: camRec.get().progress ?? null, duration: camRec.get().duration ?? null,
          gliding: camRec.isGliding() } : null,
        moveDelta: playerAnim8r?.moveDelta ? playerAnim8r.moveDelta().map(Math.round) : null,
        dnaPresentation: !!dnaPresentation,
        enemyVisible, enemyAnim,
        orbs: dnaOrbs ? { keys: Object.keys(dnaOrbs.orbs), orbiting: dnaOrbs.orbiting, u: dnaOrbs.u } : null,
      };
    },
    getScreenOverlay() {
      if (!screenOverlay) return null;
      // FIGHTSTG_F0x80092e18/F0x800930c0: monochrome 320x240 primitive;
      // argument 20 sets a 255/20 alpha ramp. DNA capture confirms white-out.
      // Type 0 ramps up (and holds at full — see tickSim); type 1 ramps back down.
      const a = screenOverlay.t / screenOverlay.duration;
      return { alpha: screenOverlay.type === 1 ? Math.max(0, 1 - a) : Math.min(1, a) };
    },
    // op3 visual effects: everything battle.js needs to composite this tick's sprites over
    // the GL frame (see fight/effect-player.js drawEffects). null when nothing is active.
    getEffectDraw() {
      if (!effectPlayer || !effectAssets || !_fxView) return null;
      const list = effectPlayer.renderList();
      const { pv, w, h, playerPos, enemyPos } = _fxView;
      // Registry owner 0x33 creates 1000 + 1001 at (0,0,32767). Program
      // 1000 is its 42-tick lead-in; 1001 is the looping DIGIMON/glyph field.
      if (dnaPresentation) {
        const centre = { x: 0, y: 0, z: 32767 };
        const intro = _sampleEffectRecord(1000, 0, dnaPresentation.tick, centre);
        if (intro) list.push(intro);
        // Program 1001 is a framebuffer-building sequence: clips 10..28 add one
        // four-tick digital layer apiece. State-8 proves the completed layers
        // remain together behind the actor, rather than replacing one another.
        const builtThrough = Math.min(72, Math.floor(dnaPresentation.tick / 4) * 4);
        for (let phase = 0; phase <= builtThrough; phase += 4) {
          const glyphLayer = _sampleEffectRecord(1001, 0, phase, centre);
          if (glyphLayer) list.push(glyphLayer);
        }
        if (dnaPresentation.fusionTick != null) {
          // The owner spawns 1003 at (-160,-120,-1). Its (+160,+120)
          // defaults center both counter-rotating records exactly.
          const corner = { x: -160, y: -120, z: -1 };
          for (let i = 0; i < 2; i++) {
            const burst = _sampleEffectRecord(1003, i, dnaPresentation.fusionTick, corner);
            if (burst) list.push(burst);
          }
        }
      }
      // DNA orb overlay sprites (see dnaOrbIgnite/dnaOrbsPath above). Emitted as
      // screen-space descriptors in PSX centre-origin px, same as op3 z=32767 sprites.
      if (dnaOrbs?.orbiting) {
        // Clockwise inward spiral (screen y-down ⇒ increasing angle = clockwise). Radius
        // shrinks from DNA_ORB_RADIUS to 0 as u→1, so both cores collide dead-centre; the
        // cores swell as they close in, and the op7 fusion white-out takes over at u≈1.
        const u = dnaOrbs.u;
        const radius = DNA_ORB_RADIUS * (1 - u);
        const swell = 1 + u * 0.35;
        for (const key of Object.keys(dnaOrbs.orbs)) {
          const angle = DNA_ORB_START_ANGLE[key] + u * DNA_ORB_TURNS * 2 * Math.PI;
          const sc = DNA_ORB_SCALE[key] * swell;
          list.push({
            arch: DNA_ORB_ARCH, frame: DNA_ORB_CLIPS[key],
            clutShift: DNA_ORB_CLUT[key],
            side: "player",
            screen: true,
            pos: { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z: -1 },
            dx: 0, dy: 0, sx: sc, sy: sc, rot: 0, c6: 0, c7: 0,
          });
        }
      }
      if (!list.length) return null;
      const view = {
        centerX: w / 2, centerY: h / 2,
        pxScale: h / 240,                       // PSX 240-line screen -> canvas px
        worldToScreen(pos, side) {
          // op3 world coords are ABSOLUTE PS1 arena coordinates (Y down), and they are NOT
          // mirrored for the far-side fighter: claim
          // fight-world-effect-coordinates-are-not-mirrored-per-side-2026-08-18 reads the
          // operands from F0x8008bc80 to the projector F0x8009e53c without a single side
          // test, and the shipped data is authored per side instead (player-side packs put
          // 677 attack spawns at +z against 1 at -z; enemy packs 153 at -z against 65 at +z).
          // The old x'=-x, z'=640-z mirror was inferred from two slot positions in one
          // capture, and those are per-Digimon stand-offs, not arena constants.
          const [wx, wy, wz] = ps1ToRender(pos, MODEL_SCALE);
          const cx = pv[0]*wx + pv[4]*wy + pv[8]*wz  + pv[12];
          const cy = pv[1]*wx + pv[5]*wy + pv[9]*wz  + pv[13];
          const cw = pv[3]*wx + pv[7]*wy + pv[11]*wz + pv[15];
          if (cw <= 0) return null;
          return { x: (cx / cw * 0.5 + 0.5) * w, y: (1 - (cy / cw * 0.5 + 0.5)) * h };
        },
      };
      return { list, manifest: effectAssets.manifest, images: effectAssets.images, view };
    },
    get effectPlayer() { return effectPlayer; },
    render,
    destroy,
    setPlayerFrame: f => { playerFrame = f; },
    setEnemyFrame:  f => { enemyFrame  = f; },
    get gl() { return gl; },
  };
}

// ─── Name → folder resolution ─────────────────────────────────────────────────

let _modelMap = null;
export function canonicalModelName(name) {
  return ({
    "BK WarGreymon": "BKWarGreymon",
    "Imperialdramon-F": "ImperialdramonFM",
    "Imperialdramon-P": "ImperialdramonPM",
  })[name] ?? name;
}

// ─── Pure function exports (used by tests and model-viewer) ─────────────────
export {
  ps1AnglesToMat3, buildBoneWorldMatrices, interpChannel,
  mat4Identity, mat4Mul, mat4Perspective, mat4LookAt, mat4Translate, mat4Scale,
  normalize, sub3, cross3, dot3, centroid3,
  compileShader, createProgram, loadTexture,
  loadSkeletalModel, buildSkeletalGLBuffers, updateSkeletalVBO, drawSkeletalMesh,
  VERT_SRC, FRAG_SRC,
};

export async function resolveModelFolder(digimonName) {
  if (!_modelMap) {
    try {
      const r = await fetch("assets/battle/model_map.json");
      _modelMap = await r.json();
    } catch (e) {
      _modelMap = {};
    }
  }
  return _modelMap[canonicalModelName(digimonName)] || null;
}
