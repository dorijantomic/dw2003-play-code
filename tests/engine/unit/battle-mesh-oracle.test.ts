// Oracle for the battle 3-D core's geometry ports.
//
// Standard used across this repo: run the ORIGINAL instruction words through the
// native interpreter (engine/native) and compare against the ported routine, with
// a negative control proving the comparison would catch a wrong transform. The
// instruction words come from the pinned RAM dump
// (~/.config/pcsx-redux/SLES03936_mem_wram.bin), captured live with
// the fightstg overlay resident — which is exactly where the coprocessor
// instruction words exist: the lifted C for F0x80084a54 has
// `M2C_ERROR(/* unknown instruction: c2 0x180001 */)` in place of every COP2
// word, while the dump keeps them.
//
//   F0x80084a54  the mesh interpreter's vertex projection (RTPS per vertex)
//   F0x80083e0c  the layer builder's parent-chain composition (three MVMVA
//                passes plus the translation pass)
//
// The dump is machine-local (8 MB, not committed); the test skips when absent.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { NativeMemory } from "../../../engine/native/memory.ts";
import { R3000 } from "../../../engine/native/mips.ts";
import { composeLayer, composeNodeView, createLayerFigure, layerFrameKind, layerLocalPose, onScreenTest, packLayerPacketA, packLayerPacketB, projectMeshNode, scaleMatrix, type LayerPacketFields, type MeshVertex, type ScreenBounds } from "../../../engine/dw3/battle-mesh.ts";
import { RCOSSIN, rotMatrixZYX, type RtpsView } from "../../../engine/dw3/gte-math.ts";

const DUMP = process.env.DW3_RAM_DUMP ?? join(homedir(), ".config/pcsx-redux/SLES03936_mem_wram.bin");
const available = existsSync(DUMP);
const SKIP = { skip: !available && "pinned RAM dump not present on this machine" };

const PROJECTION = 0x80084a54;
const LAYER_BUILDER_BLOCK = 0x800841e4; // .. 0x80084324 inclusive (81 words)

function loadDump(): NativeMemory {
  const raw = Uint8Array.from(readFileSync(DUMP).subarray(0, 0x200000));
  return NativeMemory.fromDump(raw);
}

/** Pack a row-major 3x3 of signed 16-bit values into the GTE's ctrl 0-4. */
function setRotation(cpu: R3000, rt: readonly number[]): void {
  const w = (a: number, b: number): number => ((a & 0xffff) | ((b & 0xffff) << 16)) | 0;
  cpu.writeGteCtrl(0, w(rt[0]!, rt[1]!));
  cpu.writeGteCtrl(1, w(rt[2]!, rt[3]!));
  cpu.writeGteCtrl(2, w(rt[4]!, rt[5]!));
  cpu.writeGteCtrl(3, w(rt[6]!, rt[7]!));
  cpu.writeGteCtrl(4, rt[8]!);
}

function setView(cpu: R3000, view: RtpsView): void {
  setRotation(cpu, view.rt);
  cpu.writeGteCtrl(5, view.tr.x);
  cpu.writeGteCtrl(6, view.tr.y);
  cpu.writeGteCtrl(7, view.tr.z);
  cpu.writeGteCtrl(24, view.ofx);
  cpu.writeGteCtrl(25, view.ofy);
  cpu.writeGteCtrl(26, view.h);
  cpu.writeGteCtrl(27, view.dqa);
  cpu.writeGteCtrl(28, view.dqb);
}

// ── the projection oracle ──────────────────────────────────────────────────

const NODE = 0x80100000;
const LIST = 0x80101000;
const SCREEN = 0x80102000;
const DEPTH = 0x80103000;
const ARG1 = 0x80104000;
const METHOD_STUB = 0x801f0000;

const VIEW: RtpsView = {
  // A non-trivial rotation so a wrong transform cannot pass by accident.
  rt: [0x0d24, 0x0b32, 0xf8a1, 0x0a00, 0x0e00, 0x0500, 0xf800, 0x0400, 0x0d00],
  tr: { x: 0x1200, y: -0x0800, z: 0x0400 },
  ofx: 160 << 16,
  ofy: 120 << 16,
  h: 0x01c0,
  dqa: 0,
  dqb: 0,
};

const VERTS: MeshVertex[] = [
  { x: 120, y: -60, z: 900 },
  { x: -300, y: 200, z: 1100 },
  { x: 45, y: 380, z: 700 },
  { x: -12, y: -410, z: 1500 },
  { x: 260, y: 90, z: 640 },
  { x: -180, y: -120, z: 2048 },
  { x: 500, y: 320, z: 512 },
];

test("F0x80084a54 projection: the interpreter's output equals the port's output", SKIP, () => {
  const mem = loadDump();
  const cpu = new R3000(mem);
  setView(cpu, VIEW);

  mem.write32(NODE + 0x60, LIST);
  mem.write32(NODE + 0x78, SCREEN);
  mem.write32(NODE + 0x7c, DEPTH);
  mem.write16(LIST, VERTS.length);
  VERTS.forEach((v, i) => {
    const at = LIST + 6 + 6 * i;
    mem.write16(at, v.x);
    mem.write16(at + 2, v.y);
    mem.write16(at + 4, v.z);
  });

  const method = 11; // depthShift = 0xE - 11 = 3
  mem.write32(ARG1 + 0x144, METHOD_STUB);
  cpu.setStub(METHOD_STUB, () => method);

  cpu.call(PROJECTION, [NODE, ARG1]);

  const gotScreen = VERTS.map((_, i) => mem.read32(SCREEN + 4 * i) | 0);
  const gotDepth = VERTS.map((_, i) => mem.read32(DEPTH + 4 * i) | 0);
  const port = projectMeshNode(VERTS, VIEW, 0x0e - method);

  assert.deepEqual(gotScreen, [...port.screenXY], "packed SXY2 per vertex");
  assert.deepEqual(gotDepth, [...port.depth], "scaled depth per vertex");
  // The projection really moved something: not every vertex collapsed to a point.
  assert.ok(new Set(gotScreen.map((s) => s >>> 0)).size > 1, "vertices are distinct");

  // Negative control: the SAME comparison must fail for a wrong transform.
  const wrong = projectMeshNode(VERTS, { ...VIEW, rt: [0x1000, 0, 0, 0, 0x1000, 0, 0, 0, 0x1000] }, 0x0e - method);
  assert.notDeepEqual([...wrong.screenXY], gotScreen, "an identity matrix must not match");
  const wrongDepth = projectMeshNode(VERTS, VIEW, 0x0e - method + 2);
  assert.notDeepEqual([...wrongDepth.depth], gotDepth, "a wrong depth shift must not match");
});

// ── the layer builder's three-pass oracle ──────────────────────────────────

const LAYER = 0x80110000;
const PARENT = 0x80111000;
const CODE = 0x80112000;

/** MIPS encoders for the tiny relocation wrapper around the original words. */
function encodeAddu(rd: number, rs: number, rt: number): number {
  return (((rs & 31) << 21) | ((rt & 31) << 16) | ((rd & 31) << 11) | 0x21) | 0;
}
function encodeAddiu(rt: number, rs: number, imm: number): number {
  return ((0x09 << 26) | ((rs & 31) << 21) | ((rt & 31) << 16) | (imm & 0xffff)) | 0;
}
function encodeLw(rt: number, rs: number, off: number): number {
  return ((0x23 << 26) | ((rs & 31) << 21) | ((rt & 31) << 16) | (off & 0xffff)) | 0;
}

test("F0x80083e0c layer builder: three MVMVA passes reproduce the port's composition", SKIP, () => {
  const mem = loadDump();
  const cpu = new R3000(mem);

  // Relocate the original block 0x800841e4..0x80084324 into scratch with the
  // register setup the surrounding function supplies: s2 = layer, s0 = +0x28,
  // s1 = +0x60, a3 = *(layer+0x48). The block is 81 words: it ends with the
  // third SWC2 (MAC3), which the earlier copy at 80 words dropped.
  const wrapper = [
    encodeAddu(18, 4, 0), // addu $s2, $a0, $zero
    encodeAddiu(16, 18, 0x28), // addiu $s0, $s2, 0x28
    encodeAddiu(17, 18, 0x60), // addiu $s1, $s2, 0x60
    encodeLw(7, 18, 0x48), // lw $a3, 0x48($s2)
  ];
  const block: number[] = [];
  for (let i = 0; i < 81; i++) block.push(mem.read32(LAYER_BUILDER_BLOCK + 4 * i) | 0);
  const program = [...wrapper, ...block, 0x03e00008, 0]; // jr $ra; nop
  program.forEach((word, i) => mem.write32(CODE + 4 * i, word));

  // Parent pose (dereferenced through layer+0x48).
  mem.write32(LAYER + 0x48, PARENT);
  const parentRot = [0x0e00, 0x0200, 0xf900, 0xfc00, 0x0d00, 0x0300, 0x0100, 0xfe00, 0x0f00];
  parentRot.forEach((v, i) => mem.write16(PARENT + 2 * i, v));
  mem.write32(PARENT + 0x14, 0x00001234);
  mem.write32(PARENT + 0x18, 0xfffffedc);
  mem.write32(PARENT + 0x1c, 0x00000567);

  // Local matrix (contiguous 9 s16 at +0x28) and local vector (+0x3c, +0x40, +0x44).
  const localRot = [0x0d50, 0x0500, 0x0120, 0xfb00, 0x0e80, 0xfdf0, 0x02a0, 0x0110, 0x0c00];
  localRot.forEach((v, i) => mem.write16(LAYER + 0x28 + 2 * i, v));
  mem.write16(LAYER + 0x3c, 0x0100);
  mem.write16(LAYER + 0x40, 0xff00);
  mem.write16(LAYER + 0x44, 0x0200);

  cpu.call(CODE, [LAYER]);

  const gotRot = Array.from({ length: 9 }, (_, i) => mem.read16s(LAYER + 0x4c + 2 * i));
  const gotTr = [mem.read32(LAYER + 0x60), mem.read32(LAYER + 0x64), mem.read32(LAYER + 0x68)];

  const port = composeLayer(
    { rotation: parentRot, translation: { x: 0x1234, y: -0x0124, z: 0x0567 } },
    {
      rotation: localRot,
      translation: { x: 0x0100, y: -0x0100, z: 0x0200 },
      scale: { x: 0, y: 0, z: 0 },
    },
  );
  assert.deepEqual([...port.rotation], gotRot, "composed rotation (three MVMVA passes)");
  assert.deepEqual([port.translation.x, port.translation.y, port.translation.z], gotTr, "composed translation");

  // Negative control: dropping the rotation matrix from the port must diverge.
  const wrong = composeLayer(
    { rotation: [0x1000, 0, 0, 0, 0x1000, 0, 0, 0, 0x1000], translation: { x: 0x1234, y: -0x0124, z: 0x0567 } },
    {
      rotation: localRot,
      translation: { x: 0x0100, y: -0x0100, z: 0x0200 },
      scale: { x: 0, y: 0, z: 0 },
    },
  );
  assert.notDeepEqual([...wrong.rotation], gotRot, "an identity parent rotation must not match");
});

// ── ScaleMatrix (F0x8002b23c) ──────────────────────────────────────────────

const MAT = 0x80140000;
const SCALE = 0x80140100;

function readBytes(mem: NativeMemory, addr: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => mem.read8(addr + i));
}

test("F0x8002b23c ScaleMatrix: the original words equal the port", SKIP, () => {
  const mem = loadDump();
  const cpu = new R3000(mem);
  const mat = [0x0d50, 0x0500, 0x0120, 0xfb00, 0x0e80, 0xfdf0, 0x02a0, 0x0110, 0x0c00];
  const scale = [0x0800, 0x1000, 0xf400];
  mat.forEach((v, i) => mem.write16(MAT + 2 * i, v));
  // The layer builder sign-extends each s16 into a 32-bit word before the call.
  scale.forEach((v, i) => mem.write32(SCALE + 4 * i, (v << 16) >> 16));

  cpu.call(0x8002b23c, [MAT, SCALE]);
  const got = Array.from({ length: 9 }, (_, i) => mem.read16s(MAT + 2 * i));
  const port = scaleMatrix(mat, { x: scale[0]!, y: scale[1]!, z: scale[2]! });
  assert.deepEqual(port.map((v) => ((v << 16) >> 16)), got, "scaled matrix elements");

  // The scale really moved something.
  assert.notDeepEqual(got, mat, "non-unit scale changes the matrix");
  // Negative control: a wrong scale column order must diverge.
  const wrong = scaleMatrix(mat, { x: scale[1]!, y: scale[0]!, z: scale[2]! });
  assert.notDeepEqual(wrong.map((v) => ((v << 16) >> 16)), got, "swapped scale columns must not match");
});

// ── the display-list packet builders (F0x80084bc0 / F0x80084e0c) ────────────

const HDR = 0x80150000;
const PKT = 0x80151000;
const LINKCELL = 0x80152000;

function seedHeader(mem: NativeMemory, f: LayerPacketFields, twoSided: boolean, flag18: boolean, linkPtr: number): void {
  mem.write32(HDR + 0x0c, twoSided ? 1 : 0);
  mem.write32(HDR + 0x18, flag18 ? 1 : 0);
  mem.write32(HDR + 0x74, f.vertex[0]);
  mem.write32(HDR + 0x78, f.vertex[1]);
  mem.write32(HDR + 0x7c, f.vertex[2]);
  mem.write32(HDR + 0x80, f.vertex3);
  mem.write32(HDR + 0x58, f.matrix[0]);
  mem.write32(HDR + 0x5c, f.matrix[1]);
  mem.write32(HDR + 0x60, f.matrix[2]);
  mem.write16(HDR + 0x6c, f.texCoord[0]);
  mem.write16(HDR + 0x6e, f.texCoord[1]);
  mem.write16(HDR + 0x70, f.texCoord[2]);
  mem.write16(HDR + 0x42, f.shade[0]);
  mem.write16(HDR + 0x40, f.shade[1]);
  mem.write32(HDR + 0x64, f.colour);
  mem.write16(HDR + 0x72, f.extra);
  mem.write32(HDR + 0x68, linkPtr);
}

const FIELDS: LayerPacketFields = {
  twoSided: true,
  flag18: true,
  vertex: [0x001a0f20, 0xffe41234, 0x0000c0de],
  vertex3: 0x00008040,
  matrix: [0x12340000, 0xffff00ff, 0x0abc0def],
  texCoord: [0x0010, 0x00f0, 0x0040],
  shade: [0x8080, 0x40c0],
  colour: 0x71234567,
  extra: 0x00ab,
};

function oraclePacker(name: string, entry: number, form: "A" | "B", twoSided: boolean, port: typeof packLayerPacketA): void {
  test(`${name} (form ${form}, twoSided=${twoSided}): the original words equal the port`, SKIP, () => {
    const mem = loadDump();
    const cpu = new R3000(mem);
    const f: LayerPacketFields = { ...FIELDS, twoSided };
    seedHeader(mem, f, twoSided, f.flag18, LINKCELL);
    mem.write32(HDR + 0x54, PKT);
    // Pre-existing packet and link words (the merge reads both).
    const seedPkt = [0x91aa55ee, 0x11223344, 0x55667788, 0x99aabbcc, 0xddeeff00, 0x01020304, 0x05060708, 0x090a0b0c];
    seedPkt.forEach((w, i) => mem.write32(PKT + 4 * i, w));
    mem.write32(LINKCELL, 0xdeadbeef);
    const before = readBytes(mem, PKT, 0x40);

    cpu.call(entry, [HDR]);
    const newCursor = mem.read32(HDR + 0x54) >>> 0;
    const size = newCursor - PKT;
    const gotBytes = readBytes(mem, PKT, size);
    const gotWord0 = mem.read32(PKT) | 0;
    const gotLink = mem.read32(LINKCELL) | 0;

    // Restore the packet buffer, then run the port against the same seed.
    before.forEach((b, i) => mem.write8(PKT + i, b));
    const out = Uint8Array.from(before);
    const res = port(out, PKT, f, 0xdeadbeef);
    assert.equal(res.size, size, "packet size");
    assert.deepEqual(Array.from(out.subarray(0, size)), gotBytes, "packet bytes");
    assert.equal(res.dstWord | 0, gotWord0, "chained word0");
    assert.equal(res.link | 0, gotLink, "chained link word");
    assert.equal(res.cursor, newCursor, "advanced cursor");

    // Negative control: the same comparison must fail for a wrong command form.
    const out2 = Uint8Array.from(before);
    const wrong = port(out2, PKT, { ...f, flag18: !f.flag18 }, 0xdeadbeef);
    assert.notDeepEqual(Array.from(out2.subarray(0, wrong.size)), gotBytes, "flipped flag must not match");
  });
}

oraclePacker("F0x80084bc0 packet builder", 0x80084bc0, "A", true, packLayerPacketA);
oraclePacker("F0x80084bc0 packet builder", 0x80084bc0, "A", false, packLayerPacketA);
oraclePacker("F0x80084e0c packet builder", 0x80084e0c, "B", true, packLayerPacketB);
oraclePacker("F0x80084e0c packet builder", 0x80084e0c, "B", false, packLayerPacketB);

// ── the interpreter's node-view prologue (composeNodeView) ──────────────────
//
// composeNodeView is composeLayer with the interpreter's field offsets; the
// three MVMVA passes are already proven by the layer-builder oracle above. This
// pins that the two share one arithmetic (no drift), on the constant matrix the
// interpreter loads from 0x80081358.

test("composeNodeView shares the layer builder's arithmetic", () => {
  const parent = { rotation: [0x0000eff9, 0, 0, 0x00000f92, 0x0fc5, 0x0000fc55, 0, 0x0fc5, 0x0000f067], translation: { x: 0, y: -0x35, z: -0x76a } };
  const local = { rotation: [0x0d50, 0x0500, 0x0120, 0xfb00, 0x0e80, 0xfdf0, 0x02a0, 0x0110, 0x0c00], translation: { x: 0x0100, y: -0x0100, z: 0x0200 }, scale: { x: 0x1000, y: 0x1000, z: 0x1000 } };
  assert.deepEqual(composeNodeView(parent, local), composeLayer(parent, local));
});


// ── RotMatrixZYX (F0x8002b45c) ─────────────────────────────────────────────
//
// The resident libgte builder: three angles (at r) → a 3x3 matrix (at m). It
// drives GPF as a fixed-point multiplier over the rcossin table at 0x80056a28.
// The oracle runs the original words through the interpreter against the ported
// `rotMatrixZYX`, and first proves the regenerated table equals the dump's.

const ANG = 0x80130000;
const OUT = 0x80131000;

test("the regenerated rcossin table equals the pinned dump (all 0x1000 words)", SKIP, () => {
  const mem = loadDump();
  for (let i = 0; i < 0x1000; i++) {
    assert.equal(RCOSSIN[i]! | 0, mem.read32(0x80056a28 + 4 * i) | 0, `rcossin word ${i}`);
  }
});

function runRotMatrixZYX(cpu: R3000, mem: NativeMemory, rx: number, ry: number, rz: number): number[] {
  mem.write16(ANG, rx); mem.write16(ANG + 2, ry); mem.write16(ANG + 4, rz);
  for (let i = 0; i < 9; i++) mem.write16(OUT + 2 * i, 0);
  cpu.call(0x8002b45c, [ANG, OUT]);
  return Array.from({ length: 9 }, (_, i) => mem.read16s(OUT + 2 * i));
}

test("F0x8002b45c RotMatrixZYX: the original words equal the port", SKIP, () => {
  const mem = loadDump();
  const cpu = new R3000(mem);
  const fixed: [number, number, number][] = [
    [0, 0, 0], [0x400, 0, 0], [0, 0x400, 0], [0, 0, 0x400],
    [0x400, 0x400, 0], [0x400, 0, 0x400], [0, 0x400, 0x400],
    [700, 1500, 2600], [0x123, -0x456, 0x789], [-0x400, 0x800, -0xc00],
  ];
  for (const [a, b, c] of fixed) {
    assert.deepEqual([...rotMatrixZYX(a, b, c)], runRotMatrixZYX(cpu, mem, a, b, c), `angles ${a},${b},${c}`);
  }
  // 500 random triples, including negative and wrapped angles.
  let seed = 0x12345678;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) | 0) & 0xffff;
  for (let k = 0; k < 500; k++) {
    const a = (rnd() << 16) >> 16, b = (rnd() << 16) >> 16, c = (rnd() << 16) >> 16;
    assert.deepEqual([...rotMatrixZYX(a, b, c)], runRotMatrixZYX(cpu, mem, a, b, c), `random ${a},${b},${c}`);
  }

  // The rotation really moved: a multi-axis rotation is not the identity.
  assert.notDeepEqual([...rotMatrixZYX(700, 1500, 2600)], identity9(), "not identity");
  // Negative control: swapping the y and z columns' roles must diverge.
  const swapped = [...rotMatrixZYX(700, 2600, 1500)];
  assert.notDeepEqual(swapped, [...rotMatrixZYX(700, 1500, 2600)], "swapped axes must not match");
});

function identity9(): number[] {
  return [0x1000, 0, 0, 0, 0x1000, 0, 0, 0, 0x1000];
}

// ── the layer builder's local pose (RotMatrix then ScaleMatrix) ─────────────
//
// F0x80083e0c step 2: `jal F0x8002b45c` (angles at +0x18 → matrix at +0x28)
// then `jal F0x8002b23c` (scale). The oracle runs exactly that two-call
// sequence over a real layer block and compares to `layerLocalPose`.

const LAYER2 = 0x80160000;

test("F0x80083e0c local pose: RotMatrix+ScaleMatrix equal layerLocalPose", SKIP, () => {
  const mem = loadDump();
  const cpu = new R3000(mem);
  const cases: { angles: [number, number, number]; scale: [number, number, number] }[] = [
    { angles: [700, 1500, 2600], scale: [0x1000, 0x1000, 0x1000] },
    { angles: [0x400, 0, 0], scale: [0x0800, 0x1000, 0x0400] },
    { angles: [-0x9ab, 0x456, 0x123], scale: [0x2000, 0x0800, 0x0400] },
  ];
  for (const { angles, scale } of cases) {
    // The builder reads angles at +0x18 (3 s16) and scale at +0x20 (3 s16).
    angles.forEach((v, i) => mem.write16(LAYER2 + 0x18 + 2 * i, v));
    scale.forEach((v, i) => mem.write16(LAYER2 + 0x20 + 2 * i, v));
    for (let i = 0; i < 9; i++) mem.write16(LAYER2 + 0x28 + 2 * i, 0);
    // Run the two original calls with the registers the builder sets up:
    // a0 = layer+0x18, a1 = layer+0x28 for RotMatrix; then a0 = layer+0x28,
    // a1 = sp+0x48 (the sign-extended scale words the builder stashed).
    mem.write32(LAYER2 + 0x50, 0); mem.write32(LAYER2 + 0x54, 0); mem.write32(LAYER2 + 0x58, 0);
    cpu.call(0x8002b45c, [LAYER2 + 0x18, LAYER2 + 0x28]);
    // ScaleMatrix reads three 32-bit words; emulate the lh/sw sign-extension.
    for (let i = 0; i < 3; i++) mem.write32(LAYER2 + 0x50 + 4 * i, ((scale[i]! << 16) >> 16) | 0);
    cpu.call(0x8002b23c, [LAYER2 + 0x28, LAYER2 + 0x50]);
    const got = Array.from({ length: 9 }, (_, i) => mem.read16s(LAYER2 + 0x28 + 2 * i));

    const port = layerLocalPose({
      angles: { x: angles[0], y: angles[1], z: angles[2] },
      scale: { x: scale[0], y: scale[1], z: scale[2] },
      translation: { x: 0, y: 0, z: 0 },
    });
    assert.deepEqual([...port.rotation].map((v) => (v << 16) >> 16), got, `pose ${angles} ${scale}`);
  }
  // Negative control: a hidden layer (negative scale component) must not match.
  const hidden = layerLocalPose({ angles: { x: 700, y: 1500, z: 2600 }, scale: { x: 0x1000, y: -8, z: 0x1000 }, translation: { x: 0, y: 0, z: 0 } });
  assert.equal(hidden.visible, false, "a negative scale component hides the layer");
});

// ── the on-screen test (F0x80085000) ────────────────────────────────────────

const NODE2 = 0x80170000;
const LIST2 = 0x80171000;
const BOUNDS = 0x80172000;
const RELEASE_STUB = 0x801f1000;

const BOUNDS_OBJ: ScreenBounds = { x: 160, y: 120, w: 320, h: 240, insetX: 0, insetY: 0 };

function seedBounds(mem: NativeMemory, b: ScreenBounds): void {
  mem.write16(BOUNDS + 0x00, b.x); mem.write16(BOUNDS + 0x02, b.y);
  mem.write16(BOUNDS + 0x04, b.w); mem.write16(BOUNDS + 0x06, b.h);
  mem.write16(BOUNDS + 0x6c, b.insetX); mem.write16(BOUNDS + 0x6e, b.insetY);
}

function seedVertices(mem: NativeMemory, verts: MeshVertex[]): void {
  mem.write32(NODE2 + 0x6c, LIST2);
  verts.forEach((v, i) => {
    mem.write16(LIST2 + 6 * i, v.x);
    mem.write16(LIST2 + 6 * i + 2, v.y);
    mem.write16(LIST2 + 6 * i + 4, v.z);
  });
}

test("F0x80085000 on-screen test: the original words equal the port", SKIP, () => {
  const mem = loadDump();
  const cpu = new R3000(mem);
  const verts: MeshVertex[] = [
    { x: 120, y: -60, z: 900 }, { x: -300, y: 200, z: 1100 }, { x: 45, y: 380, z: 700 },
    { x: -12, y: -410, z: 1500 }, { x: 260, y: 90, z: 640 }, { x: -180, y: -120, z: 2048 },
    { x: 500, y: 320, z: 512 }, { x: 0, y: 0, z: 800 }, { x: 60, y: -30, z: 1000 },
  ];
  seedVertices(mem, verts);
  setView(cpu, VIEW);

  // Case 1: the normal bounds (vertices project near the screen centre).
  mem.write32(NODE2 + 0x50, 0);
  seedBounds(mem, BOUNDS_OBJ);
  const got1 = cpu.call(0x80085000, [NODE2, BOUNDS]) | 0;
  const port1 = onScreenTest(0, verts, BOUNDS_OBJ, VIEW);
  assert.equal(got1 !== 0, port1, "in-bounds test");

  // Case 2: node+0x50 forces the answer regardless of the vertices.
  mem.write32(NODE2 + 0x50, 1);
  const got2 = cpu.call(0x80085000, [NODE2, BOUNDS]) | 0;
  assert.equal(got2 !== 0, onScreenTest(1, verts, BOUNDS_OBJ, VIEW), "forced-on test");
  mem.write32(NODE2 + 0x50, 0);

  // Case 3: a far-away rectangle empties the test.
  const far: ScreenBounds = { x: 900, y: 800, w: 4, h: 4, insetX: 0, insetY: 0 };
  seedBounds(mem, far);
  const got3 = cpu.call(0x80085000, [NODE2, BOUNDS]) | 0;
  assert.equal(got3 !== 0, onScreenTest(0, verts, far, VIEW), "out-of-bounds test");

  // Negative control: the far rectangle must differ from the near one for a
  // vertex set that the near one accepts.
  if (port1) assert.notEqual(got3 | 0, got1 | 0, "far rectangle must not agree with near");
});

// ── the layer builder's frame-type dispatch (F0x80083e0c, entry) ─────────────
//
// The dispatch is observable at its two ends: type 3 calls the release pointer
// at [0x8004b5ec] with node+0x54, and type 2 returns without calling anything.
// The oracle stubs that pointer and checks which types reach it.

test("F0x80083e0c frame-type dispatch: type 3 releases, type 2 idles", SKIP, () => {
  const mem = loadDump();
  const cpu = new R3000(mem);
  let releases = 0;
  mem.write32(0x8004b5ec, RELEASE_STUB);
  cpu.setStub(RELEASE_STUB, () => { releases++; return 0; });

  const seed = (type: number): void => {
    mem.write32(NODE2 + 0x0c, type);
    mem.write32(NODE2 + 0x54, 0x80173000); // a nonzero layer-array pointer
  };

  seed(3);
  cpu.call(0x80083e0c, [NODE2, 0]);
  assert.equal(releases, 1, "type 3 must call the release pointer once");
  assert.equal(layerFrameKind(3), "release");

  seed(2);
  cpu.call(0x80083e0c, [NODE2, 0]);
  assert.equal(releases, 1, "type 2 must not call the release pointer");
  assert.equal(layerFrameKind(2), "idle");

  // Negative control: the classification must not be constant.
  assert.notEqual(layerFrameKind(3), layerFrameKind(2));
  assert.equal(layerFrameKind(0), "walk");
  assert.equal(layerFrameKind(1), "rebuild");
  assert.equal(layerFrameKind(9), "walk");
});

// ── the layer-figure allocation (F0x80084560) ───────────────────────────────
//
// The original calls the resident object factory F0x800143dc and two allocator
// cells; the oracle stubs the context getter and both allocator cells (so the
// real factory runs against a scratch arena), then compares every field
// F0x80084560 itself writes against the ported `createLayerFigure`.

const CTX = 0x80180000;
const OBJ = 0x80181000;
const OBJ2 = 0x80195000;
const LAYERARR = 0x801b0000;
const LAYERARR2 = 0x801b4000;
const STUB_CTX = 0x801f2000;
const STUB_ALLOC = 0x801f3000;
const STUB_FACTORY_ALLOC = 0x801f4000;
const STUB_INIT = 0x801f5000;

const ALLOC_CELL = 0x8004b5f4;
const CTX_CELL = 0x80044f5c;
const FACTORY_ALLOC_CELL = 0x8004b5fc; // [0x8004b5dc + 0x20]
const FACTORY_INIT_CELL = 0x8004b7b4;

test("F0x80084560 layer-figure allocation: the original writes equal the port", SKIP, () => {
  const mem = loadDump();
  const cpu = new R3000(mem);

  // Context: flags at +0, count at +4, then 3 words per layer.
  const count = 2;
  const words = [0x11111111, 0x22222222, 0x33333333, 0x44444444, 0x55555555, 0x66666666];
  const flags = 0x0abc0000;
  mem.write32(CTX + 0x00, flags);
  mem.write32(CTX + 0x04, count);
  words.forEach((w, i) => mem.write32(CTX + 0x08 + 4 * i, w));

  mem.write32(CTX_CELL, STUB_CTX);
  cpu.setStub(STUB_CTX, () => CTX);
  mem.write32(ALLOC_CELL, STUB_ALLOC);
  cpu.setStub(STUB_ALLOC, () => LAYERARR);
  mem.write32(FACTORY_ALLOC_CELL, STUB_FACTORY_ALLOC);
  let factoryAllocs = 0;
  cpu.setStub(STUB_FACTORY_ALLOC, () => (factoryAllocs++ === 0 ? OBJ : OBJ + 0x3000));
  mem.write32(FACTORY_INIT_CELL, STUB_INIT);
  cpu.setStub(STUB_INIT, () => 0);

  const args = { arg0: 0x80000000, arg1: 0x00ab, arg2: 0x00cd, arg3: 0x00ef, arg4: 0x1234, arg5: 0x5678 };
  mem.write32(cpu.sp + 0x10, args.arg4);
  mem.write32(cpu.sp + 0x14, args.arg5);
  const obj = cpu.call(0x80084560, [args.arg0, args.arg1, args.arg2, args.arg3]) >>> 0;
  assert.equal(obj, OBJ >>> 0, "object pointer");
  assert.equal(factoryAllocs, 2, "the factory allocated the object and its word buffer");
  const records = mem.read32(obj + 0x54) >>> 0;
  assert.equal(records, LAYERARR >>> 0, "layer record array");

  // Now the port, into a fresh arena. The factory is the SAME original routine.
  mem.write32(cpu.sp + 0x10, args.arg4);
  mem.write32(cpu.sp + 0x14, args.arg5);
  let factoryAllocs2 = 0;
  const host = {
    context: () => ({ flags, count, words }),
    createBuilder: (a0: number, a1: number, a2: number, a3: number) =>
      cpu.call(0x800143dc, [a0, a1, a2, a3]) | 0,
    allocate: () => LAYERARR2,
  };
  // Redirect the factory's allocator to the fresh arena for this run.
  cpu.setStub(STUB_FACTORY_ALLOC, () => (factoryAllocs2++ === 0 ? OBJ2 : OBJ2 + 0x3000));
  const memory = {
    write32: (a: number, v: number) => mem.write32(a, v),
    write16: (a: number, v: number) => mem.write16(a, v),
  };
  const obj2 = createLayerFigure(host, memory, args);

  const objOffsets = [0x50, 0x54, 0x60, 0x64, 0x68, 0x6c, 0x70, 0x74, 0x2624, 0x2628, 0x262c, 0x2630];
  for (const off of objOffsets) {
    const got = mem.read32(obj + off) | 0;
    const want = mem.read32(obj2 + off) | 0;
    if (off === 0x54) {
      // The record pointers differ by arena; compare their content below.
      continue;
    }
    assert.equal(want, got, `object+0x${off.toString(16)}`);
  }
  const rec0 = records2();
  const l0Words = [0x0, 0x4, 0x8, 0x48];
  const recHalfs = [0x10, 0x12, 0x14, 0x18, 0x1a, 0x1c, 0x20, 0x22, 0x24];
  for (const off of l0Words) {
    assert.equal(mem.read32(records + off) | 0, mem.read32(rec0 + off) | 0, `layer0+0x${off.toString(16)}`);
  }
  for (const off of recHalfs) {
    assert.equal(mem.read16(records + off), mem.read16(rec0 + off), `layer0+0x${off.toString(16)}`);
  }
  for (let i = 1; i <= count; i++) {
    for (const off of [0x0, 0x4, 0x8]) {
      assert.equal(mem.read32(records + i * 0x84 + off) | 0, mem.read32(rec0 + i * 0x84 + off) | 0, `layer${i}+0x${off.toString(16)}`);
    }
  }

  // Negative control: the high-half mask really reached the OR'd words (had the
  // port used a zero mask, layer1+0x4 would be the bare context word).
  assert.equal(mem.read32(rec0 + 0x84 + 0x4) | 0, (words[1]! | 0x80000000) | 0, "layer1+0x4 OR'd with the mask");
  assert.notEqual(mem.read32(rec0 + 0x84 + 0x4) | 0, words[1]! | 0, "the mask changed the word");

  function records2(): number {
    return mem.read32(obj2 + 0x54) >>> 0;
  }
});
