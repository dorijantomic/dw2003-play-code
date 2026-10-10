// Decode one MEFT `0x18` mesh body through the PORTED display-list loop.
//
// The asset extractor (tools/extract_fight_effects.py) used to hand-write the
// display-list walk in `decode_mesh`. That walk is FIGHTSTG_F0x80085110, ported
// once in engine/dw3/battle-displaylist.ts; this tool runs that port over a mesh's
// raw bytes and prints the primitives (and the raw display list, so the shipped
// `proj/*.json` can carry the exact bytes the port needs at runtime).
//
// usage: node tools/decode_fight_mesh_dl.mjs <mesh-bin-path>
// out:   {"verts":[..],"dl":[..],"prims":[..]} to stdout
import { readFileSync } from "node:fs";
import { readMeshBlob, decodeMeshPrims } from "../engine/dw3/battle-mesh.ts";

const path = process.argv[2];
if (!path) {
  process.stderr.write("usage: node tools/decode_fight_mesh_dl.mjs <mesh-bin-path>\n");
  process.exit(2);
}
const blob = new Uint8Array(readFileSync(path));
const { verts, dl, normals } = readMeshBlob(blob);
const prims = decodeMeshPrims(dl);
process.stdout.write(JSON.stringify({ verts, dl: Array.from(dl), prims, normals }));
