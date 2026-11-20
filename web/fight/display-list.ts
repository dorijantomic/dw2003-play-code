// The battle display-list decoder for the browser route.
//
// The interpreter that walks every model's and effect mesh's byte stream is
// FIGHTSTG_F0x80085110. Its dispatch loop — the opcode reader, the seven state
// registers, the per-opcode advance and the packet-builder choice — is ported
// once in engine/dw3/battle-displaylist.ts and reaches the browser through the
// built bundle ../vendor/engine.js. This module is the route's consumer of it,
// so the ordinary battle path runs the port instead of a second hand-written
// walk.
//
// What it replaces: the effect-mesh loader used to read only the extractor's
// flattened per-primitive `abr` nibble (proj-layers.js `meshAbrMode`). When a
// layer carries the raw display-list bytes (`layer.dl`, the byte array the
// extractor emits once the tool ships it), the loader calls `walkMeshDisplayList`
// here and takes each primitive's state — the s3c quad flag, s30 UV run, s40 lit,
// s48 ABR selector and s44 builder — straight from the ported loop.
//
// What it does NOT do: the mesh arm's packet-field build (reading the UV/shade
// bytes and running COP2) and the colour path F0x800847f4 are still not ported.
// The ported loop reports each mesh step's index list, state and selected
// builder; the geometry itself still comes from the layer's decoded verts.

import { runDisplayList } from "../vendor/engine.js";

/**
 * Walk one display-list byte stream (the node's +0x68 bytes) and return the
 * ported loop's full step trace. `node` is the same field block the engine uses
 * (colour override, texpage bases) when the caller has it.
 */
export function walkMeshDisplayList(bytes, node) {
  return runDisplayList(bytes, node ? { node } : {});
}

/**
 * The per-primitive draw state the loop selects, in emission order — one entry
 * per 0x00 mesh opcode: its vertex-index list, the quad/UV/lit flags and the
 * one-based ABR selector s48 (the value `meshAbrMode` turns into a hardware blend
 * mode). A caller holding the raw stream drives its draw groups from this instead
 * of the extractor's flat `pr.abr`.
 */
export function meshPrimitiveStates(bytes, node) {
  const { steps } = runDisplayList(bytes, node ? { node } : {});
  return steps
    .filter((s) => s.kind === "mesh" && s.mesh)
    .map((s) => ({
      offset: s.offset,
      indices: s.mesh.indices,
      quad: s.mesh.quad,
      uv: s.mesh.uv,
      lit: s.mesh.lit,
      abr: s.mesh.abr,
      builder: s.mesh.packer,
    }));
}

export { DL_STATE_SLOT, DL_TERMINATOR } from "../vendor/engine.js";
