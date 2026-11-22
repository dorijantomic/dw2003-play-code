import { prepareModelDonors } from "../fight/clip-fallback.js";
import type { SkelBufs } from '../types/battle3d.js';
interface SkeletalGLBone {
  faces?: number[][];
}


interface SkeletalGLModel {
  bones: SkeletalGLBone[];
}

interface SkelBone {
  parent_slot: number;
  anim?: { ch1?: number[][] };
}

interface SkelModel {
  bones: SkelBone[];
  mirrorBones?: Set<number>;
  slotMap?: number[][] | null;
  bridgeVertCapacity?: number;
}


// ─── Skeletal model cache ─────────────────────────────────────────────────────

const _skelCache = new Map(); // folder → Promise<model|null>

export async function loadSkeletalModel(folder: string) {
  if (!folder) return null;
  if (_skelCache.has(folder)) return _skelCache.get(folder);
  const base = `assets/battle/models/${folder}`;
  const p = fetch(`${base}/anim.json`)
    .then(r => r.ok ? r.json() : null)
    .catch(() => null)
    .then(async (anim): Promise<SkelModel | null> => {
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
      // The clips this model lacks are built from the A2 donor plan (fight/clip-fallback.js): attach the
      // donor clips now, while the model is being loaded, so resolveClipScript stays synchronous. A twin's
      // timeline tables are merged into `anim.timeline` in memory here (disc data, never written to disk).
      await prepareModelDonors(anim);
      return anim;
    });
  _skelCache.set(folder, p);
  return p;
}

// ─── Skeletal GL buffer builder ───────────────────────────────────────────────

// Build static IBO + UV buffer from anim.json model. Called once after load.
// Returns { ibo, ubo, indexCount, totalVerts, boneOffsets, vbo:null }
// vbo is created dynamically each frame (DYNAMIC_DRAW) by updateSkeletalVBO.
export function buildSkeletalGLBuffers(gl: WebGLRenderingContext, model): SkelBufs {
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
        const slot = offset! + f * 3 + c;
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
export function posedVertex(bone, vertexIndex, boneIndex: number, mats) {
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

export function updateSkeletalVBO(model, frame: number, bwm, positions: Float32Array | number[]) {
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
export function _updateSkeletalVBOGL(gl: WebGLRenderingContext, model, buffers: SkelBufs, bwm, worldPos: readonly number[], scale: number, flipX: boolean, yaw = 0) {
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
// SCENE-LIGHT-BEGIN (Arena Viewer built look only: setSceneLight; strip these blocks = the game's own code)
  buffers.lastPos = posData;
// SCENE-LIGHT-END

  if (!isFinite(minX)) return null;
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}
