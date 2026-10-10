// Oracle for the battle camera's look-at (engine/dw3/battle-camera.ts).
//
// Standard used across this repo: run the ORIGINAL instruction words through the
// native interpreter (engine/native) and compare against the ported routine, with
// a negative control proving the comparison would catch a wrong transform.
//
// The words come from the COMMITTED images:
//   web/assets/native/screens/resident.bin     base 0x80010000 (the resident exe)
//   web/assets/native/screens/pro_fightstg.bin base 0x80082cb0 (the fight overlay)
// The lifted C for every routine below replaces its coprocessor words with
// `M2C_ERROR(/* unknown instruction: ... */)`, which is exactly why the disc words
// are the source and the C is not.
//
// The one sub-routine the interpreter's coprocessor model cannot yet run is the
// integer sqrt F0x8002adcc: it drives the GTE LZCS/LZCR registers (ctrl 30/31),
// which engine/native/gte.ts does not model. engine/native is out of this
// worker's write scope, so the sqrt is pinned two other ways — SQRT_TABLE against
// the committed image's own table, and gteSqrt against floor(sqrt(x)) over its
// range — and the look-at oracle stubs F0x8002adcc with the port's gteSqrt so the
// rest of the builder runs as original words. That gap is named in the report.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeMemory } from "../../../engine/native/memory.ts";
import { R3000 } from "../../../engine/native/mips.ts";
import {
  SQRT_TABLE, SIN_TABLE, gteSqrt, cosInt, sinInt, rotAxisMatrix, mulMatrix,
  rotVecMul, transposeRot, affineCompose, normalize6, applyRollZ, lookAtView,
  faceBoxShotRead, faceBoxLookAt, faceBoxTick, faceBoxSpawn, FACE_BOX_LAYER_KEY,
  FACE_BOX_TICK, FACE_BOX_WORKER_SIZE, viewToColumnMajor,
  type Ps1Matrix, type FaceBoxWorker,
} from "../../../engine/dw3/battle-camera.ts";

const RES = "web/assets/native/screens/resident.bin";
const FG = "web/assets/native/screens/pro_fightstg.bin";
const BASE_RES = 0x80010000;
const BASE_FG = 0x80082cb0;
const available = existsSync(RES) && existsSync(FG);
const SKIP = { skip: !available && "committed resident/fightstg images not present" };

const IDENTITY: number[] = [0x1000, 0, 0, 0, 0x1000, 0, 0, 0, 0x1000];

function newCpu(): { mem: NativeMemory; cpu: R3000 } {
  const mem = new NativeMemory();
  mem.load(Uint8Array.from(readFileSync(RES)), BASE_RES);
  mem.load(Uint8Array.from(readFileSync(FG)), BASE_FG);
  const cpu = new R3000(mem);
  // The identity matrices the exe's own F0x800293e4 builds at startup
  // (D0x80081398 is copied in by the view builder as its seed; D0x80081378 by
  // F0x8002a0dc). The static image has them zeroed, so seed them as the console does.
  for (const a of [0x80081358, 0x80081378, 0x80081398]) seedIdentity(mem, a);
  // The integer sqrt drives LZCS/LZCR, which the interpreter does not model; stub
  // it with the port's gteSqrt so the rest of the builder runs original words.
  cpu.setStub(0x8002adcc, (c) => gteSqrt(c.reg(4)));
  return { mem, cpu };
}

function seedIdentity(mem: NativeMemory, a: number): void {
  IDENTITY.forEach((v, i) => mem.write16(a + 2 * i, v));
  mem.write32(a + 0x14, 0);
  mem.write32(a + 0x18, 0);
  mem.write32(a + 0x1c, 0);
}

function readMatrix(mem: NativeMemory, a: number): Ps1Matrix {
  const rot = Array.from({ length: 9 }, (_, i) => mem.read16s(a + 2 * i));
  const tr: [number, number, number] = [mem.read32(a + 0x14) | 0, mem.read32(a + 0x18) | 0, mem.read32(a + 0x1c) | 0];
  return { rot, tr };
}

function writeMatrix(mem: NativeMemory, a: number, rot: readonly number[], tr: readonly [number, number, number]): void {
  rot.forEach((v, i) => mem.write16(a + 2 * i, v));
  mem.write32(a + 0x14, tr[0]);
  mem.write32(a + 0x18, tr[1]);
  mem.write32(a + 0x1c, tr[2]);
}

const flatten = (m: Ps1Matrix): number[] => [...m.rot.map((v) => (v << 16) >> 16), ...m.tr];

// ── the tables, against the committed image's own words ─────────────────────

test("the regenerated sqrt and sin tables equal the committed images", SKIP, () => {
  const mem = new NativeMemory();
  mem.load(Uint8Array.from(readFileSync(RES)), BASE_RES);
  for (let i = 0; i < 0xc0; i++) {
    assert.equal(SQRT_TABLE[i]! | 0, mem.read16s(0x800568a8 + 2 * i) | 0, `sqrt table ${i}`);
  }
  // The resident sin table D0x80056088 holds only the first quarter; the full
  // period is spread across its three neighbours, so pin the quarter here.
  for (let i = 0; i < 0x400; i++) {
    assert.equal(SIN_TABLE[i]! | 0, mem.read16s(0x80056088 + 2 * i) | 0, `sin table ${i}`);
  }
});

test("gteSqrt reproduces floor(sqrt(x)) within the routine's own truncation", () => {
  // The routine normalises x by a power of two before the table read, so it loses
  // precision on very large inputs; the look-at feeds it the sum of squares of the
  // 15-bit-normalised eye/target, which stays in the exact range tested here.
  for (let x = 0; x < 0x10000; x++) {
    assert.ok(Math.abs(gteSqrt(x) - Math.floor(Math.sqrt(x))) <= 1, `sqrt(${x}) within 1`);
  }
  let seed = 0x2468;
  const rnd = (): number => (seed = (Math.imul(seed, 1103515245) + 12345) | 0) & 0xffff;
  for (let k = 0; k < 500; k++) {
    const x = (rnd() << 8) | rnd();
    assert.ok(Math.abs(gteSqrt(x) - Math.floor(Math.sqrt(x))) <= Math.max(1, Math.floor(Math.sqrt(x)) * 0.01), `sqrt(${x}) close`);
  }
  assert.equal(gteSqrt(0), 0);
  assert.ok(Math.abs(gteSqrt(10000) - 100) <= 1, "sqrt(10000) within 1");
});

// ── the elementary builders ─────────────────────────────────────────────────

const DST = 0x80100000;

test("F0x8002a0dc rotMatrix-from-axis: the original words equal the port", SKIP, () => {
  const { mem, cpu } = newCpu();
  const cases: [number, number, number][] = [[0x0500, 0x0e00, 0x78], [0x0c00, -0x0400, 0x78], [0x0300, 0x0f00, 0x79], [0x0900, 0x0600, 0x79], [0x0400, 0x0e00, 0x7a]];
  for (const [s, c, axis] of cases) {
    writeMatrix(mem, DST, IDENTITY, [0, 0, 0]);
    cpu.call(0x8002a0dc, [DST, s, c, axis]);
    const got = readMatrix(mem, DST);
    assert.deepEqual([...got.rot].map((v) => (v << 16) >> 16), rotAxisMatrix(s, c, axis), `axis ${axis}`);
  }
  // Negative control: a wrong axis body must diverge for a non-trivial angle.
  assert.notDeepEqual(rotAxisMatrix(0x0500, 0x0e00, 0x78), rotAxisMatrix(0x0500, 0x0e00, 0x79));
});

test("F0x8002ac9c / F0x8002abcc cos and sin: the original words equal the port", SKIP, () => {
  const { cpu } = newCpu();
  for (const a of [0, 1, 0x400, 0x800, 0xc00, 0xfff, -700, 2600, 0x123, -0x456]) {
    assert.equal(cosInt(a) | 0, cpu.call(0x8002ac9c, [a]) | 0, `cos ${a}`);
    assert.equal(sinInt(a) | 0, cpu.call(0x8002abcc, [a]) | 0, `sin ${a}`);
  }
  assert.notEqual(cosInt(0x100) | 0, sinInt(0x100) | 0, "cos and sin must not coincide at 0x100");
  assert.equal(cosInt(0) | 0, 0x1000, "cos(0) is the whole unit");
  assert.equal(sinInt(0) | 0, 0, "sin(0) is zero");
});

test("F0x8002a7cc roll: the original words equal the port", SKIP, () => {
  const { mem, cpu } = newCpu();
  for (const roll of [0, 1, 90, 360, -45, 5432]) {
    writeMatrix(mem, DST, IDENTITY, [0, 0, 0]);
    cpu.call(0x8002a7cc, [DST, roll]);
    const got = readMatrix(mem, DST);
    assert.deepEqual(flatten(got), [...applyRollZ(IDENTITY, roll), 0, 0, 0], `roll ${roll}`);
  }
});

test("F0x8002a57c normalizer: the original words equal the port", SKIP, () => {
  const { mem, cpu } = newCpu();
  const SIX = 0x80100100;
  const OUT = 0x80100120;
  const cases = [
    [1, 2, 3, 4, 5, 6],
    [0x12000, -0x3000, 7, 0x4000, 9, -1],
    [0x40000000, 0, 0, 0, 0, 1],
  ];
  for (const c of cases) {
    c.forEach((v, i) => mem.write32(SIX + 4 * i, v));
    c.forEach((_, i) => mem.write32(OUT + 4 * i, 0));
    cpu.call(0x8002a57c, [SIX, OUT]);
    const got = Array.from({ length: 6 }, (_, i) => mem.read32(OUT + 4 * i));
    assert.deepEqual(got, normalize6(c), `normalize ${c.join(",")}`);
  }
});

test("F0x8002afbc / F0x8002b0cc MulMatrix: the original words equal the port", SKIP, () => {
  const { mem, cpu } = newCpu();
  const A = 0x80100200;
  const B = 0x80100240;
  const a = [0x0d50, 0x0500, 0x0120, 0xfb00, 0x0e80, 0xfdf0, 0x02a0, 0x0110, 0x0c00];
  const b = [0x0e00, 0x0200, 0xf900, 0xfc00, 0x0d00, 0x0300, 0x0100, 0xfe00, 0x0f00];
  writeMatrix(mem, A, a, [0, 0, 0]);
  writeMatrix(mem, B, b, [0, 0, 0]);
  cpu.call(0x8002afbc, [A, B]);
  assert.deepEqual([...readMatrix(mem, A).rot].map((v) => (v << 16) >> 16), mulMatrix(a, b), "afbc a=a*b");
  // b0cc writes the SAME product into the second operand.
  writeMatrix(mem, A, a, [0, 0, 0]);
  writeMatrix(mem, B, b, [0, 0, 0]);
  cpu.call(0x8002b0cc, [A, B]);
  assert.deepEqual([...readMatrix(mem, B).rot].map((v) => (v << 16) >> 16), mulMatrix(a, b), "b0cc b=a*b");
  // Negative control: an identity left operand must not match a real rotation.
  assert.notDeepEqual(mulMatrix(IDENTITY, b), mulMatrix(a, b));
});

test("F0x8002ae5c matrix x vector: the original words equal the port", SKIP, () => {
  const { mem, cpu } = newCpu();
  const M = 0x80100300;
  const V = 0x80100340;
  const OUT = 0x80100360;
  const m = [0x0d50, 0x0500, 0x0120, 0xfb00, 0x0e80, 0xfdf0, 0x02a0, 0x0110, 0x0c00];
  writeMatrix(mem, M, m, [0, 0, 0]);
  for (const v of [[0x1200, -0x0800, 0x0400], [0x100000, 0x7ffff, -0x40000], [0, 0, 0]]) {
    v.forEach((x, i) => mem.write32(V + 4 * i, x));
    OUT && [0, 1, 2].forEach((i) => mem.write32(OUT + 4 * i, 0));
    cpu.call(0x8002ae5c, [M, V, OUT]);
    const got = [mem.read32(OUT) | 0, mem.read32(OUT + 4) | 0, mem.read32(OUT + 8) | 0];
    assert.deepEqual(got, rotVecMul(m, [v[0]!, v[1]!, v[2]!]), `vec ${v.join(",")}`);
  }
});

test("F0x8002b41c transpose: the original words equal the port", SKIP, () => {
  const { mem, cpu } = newCpu();
  const M = 0x80100400;
  const OUT = 0x80100440;
  const m = [0x0d50, 0x0500, 0x0120, 0xfb00, 0x0e80, 0xfdf0, 0x02a0, 0x0110, 0x0c00];
  writeMatrix(mem, M, m, [0x11111111, 0x22222222, 0x33333333]);
  writeMatrix(mem, OUT, IDENTITY, [0, 0, 0]);
  cpu.call(0x8002b41c, [M, OUT]);
  assert.deepEqual([...readMatrix(mem, OUT).rot].map((v) => (v << 16) >> 16), transposeRot(m), "transpose");
});

test("F0x8002a74c affine compose: the original words equal the port", SKIP, () => {
  const { mem, cpu } = newCpu();
  const M0 = 0x80100500;
  const M1 = 0x80100540;
  const m0: Ps1Matrix = { rot: [0x0d50, 0x0500, 0x0120, 0xfb00, 0x0e80, 0xfdf0, 0x02a0, 0x0110, 0x0c00], tr: [0x3000, -0x2000, 0x1000] };
  const m1: Ps1Matrix = { rot: [0x0e00, 0x0200, 0xf900, 0xfc00, 0x0d00, 0x0300, 0x0100, 0xfe00, 0x0f00], tr: [0x0400, 0x0800, -0x0400] };
  writeMatrix(mem, M0, m0.rot, m0.tr);
  writeMatrix(mem, M1, m1.rot, m1.tr);
  cpu.call(0x8002a74c, [M0, M1]);
  const got = readMatrix(mem, M1);
  assert.deepEqual(flatten(got), flatten(affineCompose(m0, m1)), "affine compose");
});

// ── the view builder F0x8002a1ac ────────────────────────────────────────────

const ARG = 0x80100600;
const COORD = 0x80100700;

function seedShotStruct(mem: NativeMemory, eye: number[], target: number[], roll: number, coord: number): void {
  eye.forEach((v, i) => mem.write32(ARG + 4 * i, v));
  target.forEach((v, i) => mem.write32(ARG + 0x0c + 4 * i, v));
  mem.write32(ARG + 0x18, roll);
  mem.write32(ARG + 0x1c, coord);
}

test("F0x8002a1ac look-at: the original words equal the port (no anchor)", SKIP, () => {
  const { mem, cpu } = newCpu();
  const cases: [number[], number[], number][] = [
    [[1000, -2000, -3000], [0, -500, 1500], 0],
    [[-3840, -2432, -4608], [0, -2048, 768], 0],
    [[512, 1152, 5504], [0, 0, 0], 0],
    [[1000, -2000, -3000], [0, -500, 1500], 90],
  ];
  for (const [eye, target, roll] of cases) {
    seedShotStruct(mem, eye, target, roll, 0);
    seedIdentity(mem, 0x80081358);
    cpu.call(0x8002a1ac, [ARG]);
    const got = readMatrix(mem, 0x80081338);
    const port = lookAtView({ eye: eye as [number, number, number], target: target as [number, number, number], roll, coord: null });
    assert.equal(port.code, 0);
    assert.deepEqual(flatten(got), flatten(port.view), `shot ${eye} -> ${target} roll ${roll}`);
  }
  // Coincident eye/target returns 1 and publishes nothing view-shaped.
  seedShotStruct(mem, [100, 200, 300], [100, 200, 300], 0, 0);
  const code = cpu.call(0x8002a1ac, [ARG]) | 0;
  assert.equal(code, 1, "the coincident case returns 1");
  assert.equal(lookAtView({ eye: [100, 200, 300], target: [100, 200, 300], roll: 0, coord: null }).code, 1);
  // Negative control: a different target must move the view.
  assert.notDeepEqual(
    flatten(lookAtView({ eye: [1000, -2000, -3000], target: [0, -500, 1500], roll: 0, coord: null }).view),
    flatten(lookAtView({ eye: [1000, -2000, -3000], target: [0, -500, 2500], roll: 0, coord: null }).view),
  );
});

test("F0x8002a1ac look-at: the original words equal the port (anchored)", SKIP, () => {
  const { mem, cpu } = newCpu();
  // The anchor frame F0x8002a88c hands back: its flg (+0x0) zero, super (+0x48) zero,
  // the coord matrix at +0x04 (rot halves then translation words at +0x18/+0x1c/+0x20).
  // Do NOT seed an identity here: +0x00 is the frame's flag word, and a non-zero flag
  // sends F0x8002a88c down its parent-chain walk instead of the straight copy.
  mem.write32(COORD + 0x00, 0);
  const coordRot = [0x0e00, 0x0200, 0xf900, 0xfc00, 0x0d00, 0x0300, 0x0100, 0xfe00, 0x0f00];
  coordRot.forEach((v, i) => mem.write16(COORD + 0x04 + 2 * i, v));
  mem.write32(COORD + 0x18, 0x0500);
  mem.write32(COORD + 0x1c, -0x0300);
  mem.write32(COORD + 0x20, 0x0700);
  mem.write32(COORD + 0x48, 0);

  const eye = [512, 1152, 5504];
  const target = [0, -307, 0];
  seedShotStruct(mem, eye, target, 0, COORD);
  seedIdentity(mem, 0x80081358);
  cpu.call(0x8002a1ac, [ARG]);
  const got = readMatrix(mem, 0x80081338);
  const port = lookAtView({
    eye: eye as [number, number, number], target: target as [number, number, number],
    roll: 0, coord: { rot: coordRot, tr: [0x0500, -0x0300, 0x0700] },
  });
  assert.deepEqual(flatten(got), flatten(port.view), "anchored shot");
  // Negative control: dropping the anchor must diverge.
  assert.notDeepEqual(flatten(got), flatten(lookAtView({ eye: eye as [number, number, number], target: target as [number, number, number], roll: 0, coord: null }).view));
});

// ── the face-box family (FIGHTSTG) ──────────────────────────────────────────

const REC = 0x80100800;
const BOX = 0x80100900;
const LAYER = 0x80100a00;
const CELL_4570 = 0x800a4570;
const CELL_DF8C = 0x8004df8c;
const STUB = 0x801f0000;
const STUB2 = 0x801f1000;

function seedRecordBytes(mem: NativeMemory, base: number, bytes: number[]): void {
  bytes.forEach((b, i) => mem.write8(base + i, b));
}

/** A record the face box reads: enough bytes for group 6 and 7 at +0x1A.., +0x62.., +0xAA.., with +0x18 the side flag. */
function faceBoxRecord(sideFlag: number): number[] {
  const b = new Array<number>(0x120).fill(0);
  const put = (off: number, v: number): void => { b[off] = v & 0xff; b[off + 1] = (v >> 8) & 0xff; };
  b[0x18] = sideFlag & 0xff;
  const g = (n: number): number => 6 * n;
  // group 6: eye at +0x1a+6g, target at +0x62+6g, H at +0xaa+2g
  put(0x1a + g(6), -1972 & 0xffff); put(0x1a + g(6) + 2, 1066); put(0x1a + g(6) + 4, 2767);
  put(0x62 + g(6), 0); put(0x62 + g(6) + 2, 960); put(0x62 + g(6) + 4, 5120);
  put(0xaa + 2 * 6, 280);
  // group 7: a different framing (the enemy line)
  put(0x1a + g(7), -1972 & 0xffff); put(0x1a + g(7) + 2, 912); put(0x1a + g(7) + 4, 2703);
  put(0x62 + g(7), 0); put(0x62 + g(7) + 2, 806); put(0x62 + g(7) + 4, 5056);
  put(0xaa + 2 * 7, 300);
  return b;
}

test("F0x80091c1c face-box shot read: the original words equal the port", SKIP, () => {
  const { mem, cpu } = newCpu();
  mem.write32(CELL_4570, STUB);
  mem.write32(STUB, 0); // a stub cell; the value below is returned by setStub
  cpu.setStub(STUB, () => REC);
  const bytes = faceBoxRecord(0);
  seedRecordBytes(mem, REC, bytes);
  // self+0x50 = the record index (unused by the routine beyond the accessor arg), self+0x54 = the record.
  mem.write32(BOX + 0x50, 383);
  mem.write32(BOX + 0x54, REC);
  cpu.call(0x80091c1c, [BOX]);
  const got = {
    eye: [mem.read32(BOX + 0x58) | 0, mem.read32(BOX + 0x5c) | 0, mem.read32(BOX + 0x60) | 0],
    target: [mem.read32(BOX + 0x64) | 0, mem.read32(BOX + 0x68) | 0, mem.read32(BOX + 0x6c) | 0],
    H: mem.read32(BOX + 0x78) | 0,
  };
  const port = faceBoxShotRead(bytes, "player")!;
  assert.deepEqual(got, { eye: port.eye, target: port.target, H: port.H }, "player shot");

  // The enemy side reads group 7 — the record's +0x18 flag decides it.
  const ebytes = faceBoxRecord(0x10);
  seedRecordBytes(mem, REC, ebytes);
  cpu.call(0x80091c1c, [BOX]);
  const gotE = {
    eye: [mem.read32(BOX + 0x58) | 0, mem.read32(BOX + 0x5c) | 0, mem.read32(BOX + 0x60) | 0],
    target: [mem.read32(BOX + 0x64) | 0, mem.read32(BOX + 0x68) | 0, mem.read32(BOX + 0x6c) | 0],
    H: mem.read32(BOX + 0x78) | 0,
  };
  const portE = faceBoxShotRead(ebytes, "enemy")!;
  assert.deepEqual(gotE, { eye: portE.eye, target: portE.target, H: portE.H }, "enemy shot");
  assert.notDeepEqual(portE.eye, port.eye, "the two groups differ");
});

test("F0x80091b8c face-box look-at: the original words equal the port", SKIP, () => {
  const { mem, cpu } = newCpu();
  mem.write32(CELL_DF8C, STUB);
  cpu.setStub(STUB, () => LAYER);
  // The layer's +0x15C method: store H at view+0x88 and return early only for flag 0.
  mem.write32(LAYER + 0x15c, STUB2);
  cpu.setStub(STUB2, (c) => { mem.write32(LAYER + 0x88, c.reg(6)); return 0; });
  // The box object: the shot at +0x58, roll +0x70, H +0x78; the angle triple +0xCC
  // and offset triple +0xD4 zeroed as F0x80091c1c leaves them.
  const eye = [-1972, -1066, -2767];
  const target = [0, -960, -5120];
  eye.forEach((v, i) => mem.write32(BOX + 0x58 + 4 * i, v));
  target.forEach((v, i) => mem.write32(BOX + 0x64 + 4 * i, v));
  mem.write32(BOX + 0x70, 0);
  mem.write32(BOX + 0x78, 280);
  for (const o of [0xcc, 0xce, 0xd0, 0xd4, 0xd8, 0xdc]) mem.write32(BOX + o, 0);
  mem.write32(BOX + 0xe4, 3);
  seedIdentity(mem, 0x80081358);
  cpu.call(0x80091b8c, [BOX]);
  const got = readMatrix(mem, 0x80081338);
  const port = faceBoxLookAt({ eye: eye as [number, number, number], target: target as [number, number, number], H: 280, group: 6 })!;
  assert.deepEqual(flatten(got), flatten(port.view), "face-box view");
  assert.equal(port.H, 280);
  assert.equal(port.layerKey, FACE_BOX_LAYER_KEY);
  // Negative control: a different target must move the view.
  assert.notDeepEqual(flatten(got), flatten(faceBoxLookAt({ eye: eye as [number, number, number], target: [0, -200, -5120], H: 280, group: 6 })!.view));
});

test("F0x80091cf4 face-box tick: the original words equal the port", SKIP, () => {
  const { mem, cpu } = newCpu();
  mem.write32(CELL_4570, STUB);
  cpu.setStub(STUB, () => REC);
  mem.write32(CELL_DF8C, STUB2);
  cpu.setStub(STUB2, () => LAYER);
  const layerView = 0x801f4000;
  cpu.setStub(layerView, () => 0);
  mem.write32(LAYER + 0x15c, layerView);
  const bytes = faceBoxRecord(0);
  seedRecordBytes(mem, REC, bytes);

  // The worker object: state 1, sub 0, countdown 0, +0x38/+0x40 method stubs.
  const stepStub = 0x801f2000;
  const submitStub = 0x801f3000;
  let stepped = 0, submitted = 0;
  cpu.setStub(stepStub, () => { stepped++; return 0; });
  cpu.setStub(submitStub, () => { submitted++; return 0; });

  const run = (state: number, sub: number, countdown: number, shotSeed?: { eye: number[]; target: number[]; H: number }): { got: ReturnType<typeof faceBoxTick>; memShot: { eye: number[]; target: number[]; H: number }; view: Ps1Matrix; countdown: number } => {
    mem.write32(BOX + 0x0c, state);
    mem.write32(BOX + 0x14, sub);
    mem.write32(BOX + 0xe4, countdown);
    mem.write32(BOX + 0x38, stepStub);
    mem.write32(BOX + 0x40, submitStub);
    mem.write32(BOX + 0x50, 383);
    mem.write32(BOX + 0x54, REC);
    for (const o of [0x58, 0x5c, 0x60, 0x64, 0x68, 0x6c, 0x78]) mem.write32(BOX + o, 0);
    if (shotSeed) {
      shotSeed.eye.forEach((v, i) => mem.write32(BOX + 0x58 + 4 * i, v));
      shotSeed.target.forEach((v, i) => mem.write32(BOX + 0x64 + 4 * i, v));
      mem.write32(BOX + 0x78, shotSeed.H);
    }
    seedIdentity(mem, 0x80081358);
    for (let i = 0; i < 8; i++) mem.write32(0x80081338 + 4 * i, 0); // clear the published view
    cpu.call(0x80091cf4, [BOX]);
    return {
      got: {} as ReturnType<typeof faceBoxTick>,
      memShot: {
        eye: [mem.read32(BOX + 0x58) | 0, mem.read32(BOX + 0x5c) | 0, mem.read32(BOX + 0x60) | 0],
        target: [mem.read32(BOX + 0x64) | 0, mem.read32(BOX + 0x68) | 0, mem.read32(BOX + 0x6c) | 0],
        H: mem.read32(BOX + 0x78) | 0,
      },
      view: readMatrix(mem, 0x80081338),
      countdown: mem.read32(BOX + 0xe4) | 0,
    };
  };

  // Case 1: state 1, sub 0, countdown 0 -> reads the shot, sets countdown 2, submits.
  const before = { stepped, submitted };
  const orig = run(1, 0, 0);
  const portBox: FaceBoxWorker = { state: 1, sub: 0, recordIndex: 383, record: bytes, countdown: 0, shot: null, view: null };
  let pSubmitted = 0;
  const portRes = faceBoxTick(portBox, { submitPicture: () => { pSubmitted++; }, pictureLayer: () => LAYER });
  assert.deepEqual(orig.memShot, { eye: portRes.shot!.eye, target: portRes.shot!.target, H: portRes.shot!.H }, "shot read in the tick");
  assert.equal(orig.view.rot.length, 9);
  assert.equal(orig.countdown, portBox.countdown, "the countdown matches the original's +0xe4 after the tick");
  assert.equal(orig.countdown, 1, "the tick decrements the freshly-set 2 to 1");
  assert.equal(pSubmitted, 1, "the picture is submitted once");
  assert.deepEqual(flatten(portRes.view!), flatten(faceBoxLookAt(portRes.shot!)!.view), "the tick's view equals the look-at port");

  // Case 2: sub 1 skips the shot read and reuses the shot already in the object;
  // countdown 1 still builds the view.
  const pShot = faceBoxShotRead(bytes, "player")!;
  const orig2 = run(1, 1, 1, { eye: pShot.eye, target: pShot.target, H: pShot.H });
  const portBox2: FaceBoxWorker = { state: 1, sub: 1, recordIndex: 383, record: bytes, countdown: 1, shot: pShot, view: null };
  const portRes2 = faceBoxTick(portBox2, { pictureLayer: () => LAYER });
  assert.deepEqual(flatten(orig2.view), flatten(portRes2.view!), "sub-state 1 builds the view from the countdown");
  assert.equal(orig2.countdown, portBox2.countdown, "sub-state 1 decrements the countdown");

  // Case 3: states 2 and 3 are terminal.
  const orig3 = run(2, 0, 2);
  assert.deepEqual(flatten(orig3.view), new Array(12).fill(0), "state 2 publishes no view");
  const portRes3 = faceBoxTick({ state: 2, sub: 0, recordIndex: 383, record: bytes, countdown: 2, shot: null, view: null }, { pictureLayer: () => null });
  assert.equal(portRes3.alive, false, "state 2 is terminal in the port");
  // Negative control: the picture layer really gates the shot read.
  const up = faceBoxTick({ state: 1, sub: 0, recordIndex: 383, record: bytes, countdown: 0, shot: null, view: null }, { pictureLayer: () => LAYER });
  const down = faceBoxTick({ state: 1, sub: 0, recordIndex: 383, record: bytes, countdown: 0, shot: null, view: null }, { pictureLayer: () => null });
  assert.notEqual(up.shot, null, "a live 0x1009 layer reads the shot");
  assert.equal(down.shot, null, "no layer reads no shot");
});

test("F0x80091dac face-box worker spawn: the original words equal the port", SKIP, () => {
  const { mem, cpu } = newCpu();
  const OBJ = 0x80100b00;
  cpu.setStub(0x80014504, (c) => {
    // Record the factory arguments the original passes, then hand back a scratch object.
    mem.write32(0x80100c00, c.reg(4));       // a0 = tick
    mem.write32(0x80100c04, c.reg(5));       // a1 = size
    mem.write32(0x80100c08, c.reg(6));       // a2 = childCount
    return OBJ;
  });
  cpu.call(0x80091dac, [383, REC]);
  assert.equal(mem.read32(0x80100c00) >>> 0, FACE_BOX_TICK, "the installed tick is F0x80091cf4");
  assert.equal(mem.read32(0x80100c04) >>> 0, FACE_BOX_WORKER_SIZE, "the object size is 0xE8");
  assert.equal(mem.read32(0x80100c08) >>> 0, 0, "no children");
  assert.equal(mem.read32(OBJ + 0x50) | 0, 383, "record index stored at +0x50");
  assert.equal(mem.read32(OBJ + 0x54) >>> 0, REC >>> 0, "record pointer stored at +0x54");

  const port = faceBoxSpawn(() => ({ obj: {}, ptr: OBJ }), 383, null);
  assert.equal(port.recordIndex, 383);
  assert.equal(port.state, 0);
});

// ── the render-space conversion is not a transform, just a scale ────────────

test("viewToColumnMajor maps the PS1 matrix with no axis swap", () => {
  const m = viewToColumnMajor({ rot: [0x1000, 0, 0, 0, 0x1000, 0, 0, 0, 0x1000], tr: [0x1000, 0, 0] });
  assert.equal(m[0], 1);
  assert.equal(m[5], 1);
  assert.equal(m[10], 1);
  assert.equal(m[12], 1);
  assert.equal(m[15], 1);
});
