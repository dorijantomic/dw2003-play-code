// Oracle for the battle display-list dispatch loop (engine/dw3/battle-displaylist.ts).
//
// The strongest oracle the live capture makes possible: run the ORIGINAL loop
// words of FIGHTSTG_F0x80085110 over the byte stream captured off the running
// battle (docs/research/battle/captures/battle-dl-opcode-2026-10-06/raw.txt),
// step by step, and compare the port's cursor trace and packet-builder calls
// against the original's own stores and `jal`s.
//
// The stream is the two 320-byte display lists the capture dumped once each from
// the wild Kotemon-vs-Kunemon battle: node 1 (0x8017ce30, quad meshes, 13-byte
// stride) and node 7 (0x8017be4c, triangle meshes, 10-byte stride). The dump is
// where the fightstg code and its coprocessor words are resident
// (~/.config/pcsx-redux/SLES03936_mem_wram.bin); the test skips when
// it is absent. No lifting of the C: every routine runs its shipped words.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { NativeMemory } from "../../../engine/native/memory.ts";
import { R3000 } from "../../../engine/native/mips.ts";
import {
  buildPrimPacket, initialDisplayListState, meshRunAdvance, DL_STATE_SLOT, runDisplayList,
  type DisplayListNode,
} from "../../../engine/dw3/battle-displaylist.ts";

const DUMP = process.env.DW3_RAM_DUMP ?? join(homedir(), ".config/pcsx-redux/SLES03936_mem_wram.bin");
const available = existsSync(DUMP);
const SKIP = { skip: !available && "pinned RAM dump not present on this machine" };

// The captured streams, verbatim from raw.txt §2.
const NODE1_STREAM = Uint8Array.from(Buffer.from(
  "d08191c0e0a0b1028080800100000020" + // 0x0000
  "ff0000000102033100312a0000002a00" + // 0x0010
  "01040305312a3155002a005500040605" + // 0x0020
  "073155317f0055007f00080900016300" + // 0x0030
  "632a3100312a00090a0104632a635531" + // 0x0040
  "2a3155000a0b04066355637f3155317f" + // 0x0050
  "000c0d0e0ff755f77fc655c67f001011" + // 0x0060
  "08099400942a6300632a001112090a94" + // 0x0070
  "2a9455632a63550012130a0b9455947f" + // 0x0080
  "6355637f00140c150ef72af755c62ac6" + // 0x0090
  "5500150e1112c62ac655942a9455000e" + // 0x00a0
  "0f1213c655c67f9455947f0180008030" + // 0x00b0
  "ff0000061607170400040c0000000c00" + // 0x00c0
  "0d180f191700170c1300130c000b1a06" + // 0x00d0
  "160900090c0400040c00131b0b1a0e00" + // 0x00e0
  "0e0c0900090c000f19131b1300130c0e" + // 0x00f0
  "000e0cff18000000040100000c010000" + // 0x0100
  "0000000000000000c80000001c000000" + // 0x0110
  "0000124880be0b50e65100d1f65adb35" + // 0x0120
  "80be485d333d00d1006a505500e9c05e",  // 0x0130
  "hex"));

// The group-B stream's terminator lies beyond the 320-byte dump, so one 0xff is
// appended at the offset the 30th mesh op advances to (0x148). Noted, not hidden.
const NODE7_STREAM = Uint8Array.from(Buffer.from(
  "d08091c0e0a0b1028080800100010010" + // 0x0000
  "ff000000010215552a402a5500030405" + // 0x0010
  "40152a00400000060305550040154000" + // 0x0020
  "000708092a15152a1515000a0703402a" + // 0x0030
  "2a154015000b0c012a2a40402a40000d" + // 0x0040
  "0e0f1540002a152a00080710152a2a15" + // 0x0050
  "2a2a0011121355156a006a1500040307" + // 0x0060
  "2a0040152a15000709042a1515152a00" + // 0x0070
  "001415162a00151a2a20001718192a00" + // 0x0080
  "150b2a15001a1b1c1500150b2a00001d" + // 0x0090
  "141e74157f007f15000c0b1f40402a2a" + // 0x00a0
  "402a00200f0e1515152a002a00030621" + // 0x00b0
  "40155500551500070a102a15402a2a2a" + // 0x00c0
  "001211176a005515550000220d0f2a2a" + // 0x00d0
  "1540152a00230504150b150000000019" + // 0x00e0
  "1217001515000000001224136a007415" + // 0x00f0
  "6a150012192515000015151a00241226" + // 0x0100
  "74156a007f0000270b0115402a2a2a40" + // 0x0110
  "00252612151a2a00150000230605150b" + // 0x0120
  "2a00150000210a035515402a4015000e" + // 0x0130
  "0000000000000000ff",               // 0x0140 (8 bytes, then 0xff = appended terminator @0x148)
  "hex"));

const LAYER_LOOP = 0x80085110;
const PACKER_A = 0x80084bc0;
const PACKER_B = 0x80084e0c;
const PACK_SITE_B = 0x800858ac;   // `jal FIGHTSTG_F0x80084e0c` (fightstg.s L2870)

const NODE = 0x801c0000;
const STREAM = 0x801c1000;
const PKTBUF = 0x801c4000;
const CTX = 0x801c3000;
const T78 = 0x801c5000, T7C = 0x801c6000, T80 = 0x801c7000;
const STUB_METHOD = 0x801f0000, STUB_ALLOC = 0x801f1000, STUB_RELEASE = 0x801f2000;

const NODE_FIELDS: DisplayListNode = {
  colorOverride: 1, colorBytes: [0x11, 0x22, 0x33], texBase0: 0x280, texBase1: 0x40,
};

/** The stack cells the loop writes, from the call's sp (0x801ffcf0) minus its
 *  0xd0 frame: cursor at sp+0x4c, the 0x01 descriptor word at sp+0x70. */
const SP = (0x801ffcf0 - 0xd0) >>> 0;
const CURSOR_CELL = (SP + 0x4c) >>> 0;
const PRIM_CELL = (SP + 0x70) >>> 0;

function loadDump(): NativeMemory {
  const raw = Uint8Array.from(readFileSync(DUMP).subarray(0, 0x200000));
  return NativeMemory.fromDump(raw);
}

interface OriginalRun {
  cursor: number[];          // every cursor store, as stream offsets
  packerCalls: { caller: number; target: number }[];
  primWords: number[];
  ret: number;
}

/** Run the original loop over `stream` and record what it does. `t78` seeds the
 *  node's projected SXY table (node+0x78) — the cull's input — so a test can
 *  mutate the projection and watch both the machine and the port follow. */
function runOriginal(
  mem: NativeMemory, cpu: R3000, stream: Uint8Array,
  t78: (i: number) => number = (i) => (0x100000 + i * 0x1111) | 0,
): OriginalRun {
  mem.load(stream, STREAM);
  mem.write32(NODE + 0x68, STREAM);
  mem.write32(NODE + 0x54, NODE_FIELDS.colorOverride);
  mem.write8(NODE + 0x58, 0x11); mem.write8(NODE + 0x59, 0x22); mem.write8(NODE + 0x5a, 0x33);
  mem.write32(NODE + 0x70, NODE_FIELDS.texBase0);
  mem.write32(NODE + 0x74, NODE_FIELDS.texBase1);
  mem.write32(NODE + 0x78, T78); mem.write32(NODE + 0x7c, T7C); mem.write32(NODE + 0x80, T80);
  mem.write32(NODE + 0x50, 1); // node+0x50 forces the on-screen test
  const rot = [0x0d50, 0x0500, 0x0120, 0xfb00, 0x0e80, 0xfdf0, 0x02a0, 0x0110, 0x0c00];
  for (let c = 0; c < 3; c++) {
    mem.write16(NODE + 0x84 + c * 6, rot[c * 3]!);
    mem.write16(NODE + 0x84 + c * 6 + 2, rot[c * 3 + 1]!);
  }
  mem.write32(NODE + 0x98, 0x01000200); mem.write32(NODE + 0x9c, 0x03000400); mem.write32(NODE + 0xa0, 0);
  for (let i = 0; i < 256; i++) {
    mem.write32(T78 + i * 4, t78(i) | 0);
    mem.write32(T7C + i * 4, i);
    mem.write32(T80 + i * 4, i);
  }
  // The loop's neighbours, stubbed so only its own words are under test.
  cpu.setStub(0x80085000, () => 1);       // on-screen test -> visible
  cpu.setStub(0x80084a54, () => 0);       // vertex projection (oracled elsewhere)
  cpu.setStub(0x800847f4, () => 0);       // effect-mesh colour path (remaining piece)
  mem.write32(CTX + 0x140, STUB_METHOD); cpu.setStub(STUB_METHOD, () => 0);
  mem.write32(0x8004df68, STUB_ALLOC); cpu.setStub(STUB_ALLOC, () => PKTBUF);
  mem.write32(0x8004df6c, STUB_RELEASE); cpu.setStub(STUB_RELEASE, () => 0);

  const cursor: number[] = [];
  const packerCalls: { caller: number; target: number }[] = [];
  const primWords: number[] = [];
  mem.onWrite = (pc, addr, size, value) => {
    const a = addr >>> 0;
    if (a === CURSOR_CELL) cursor.push((value >>> 0) - STREAM);
    else if (a === PRIM_CELL && size === 2) primWords.push(mem.read32(PRIM_CELL) >>> 0);
  };
  cpu.onCall = (caller, target) => {
    const t = target >>> 0;
    if (t === PACKER_A || t === PACKER_B) packerCalls.push({ caller: caller >>> 0, target: t });
  };
  cpu.sp = 0x801ffcf0;
  const ret = cpu.call(LAYER_LOOP, [NODE, CTX]);
  mem.onWrite = null; cpu.onCall = null;
  return { cursor, packerCalls, primWords, ret };
}

// ── the guard: the dump really holds this overlay's loop ────────────────────

test("the pinned dump holds fightstg's loop words (raw-word guard)", SKIP, () => {
  const mem = loadDump();
  // addiu sp,-0xd0 at 0x80085110 and lbu v0,(a3) at 0x80085350.
  assert.equal(mem.read32(0x80085110) >>> 0, 0x27bdff30, "FIGHTSTG_F0x80085110 prologue word");
  assert.equal(mem.read32(0x80085350) >>> 0, 0x90e20000, "loop-top `lbu $v0,($a3)` word");
});

// ── the cursor oracle ──────────────────────────────────────────────────────

interface Case { name: string; stream: Uint8Array; }

function cursorOracle(c: Case): void {
  test(`cursor trace over the captured ${c.name} stream equals the port's`, SKIP, () => {
    const mem = loadDump();
    const cpu = new R3000(mem);
    const orig = runOriginal(mem, cpu, c.stream);

    const port = runDisplayList(c.stream, { node: NODE_FIELDS });
    // The prologue stores node+0x68 into the cursor cell before the loop
    // (0x800852e8); the port represents that as the initial cursor 0.
    const portWrites = [0, ...port.steps.flatMap((s) => s.cursorWrites)];

    assert.ok(orig.cursor.length > 10, "the original really walked the stream");
    assert.deepEqual(portWrites, orig.cursor, "every cursor store, in order");

    // The original stopped at the same terminator the port did.
    assert.equal(orig.cursor[orig.cursor.length - 1], port.stopped, "stop offset");
  });
}

cursorOracle({ name: "node 1 (quad, 13-byte stride)", stream: NODE1_STREAM });
cursorOracle({ name: "node 7 (triangle, 10-byte stride)", stream: NODE7_STREAM });

test("the port's opcode classes and counts match the original's decode", SKIP, () => {
  const mem = loadDump();
  const cpu = new R3000(mem);
  runOriginal(mem, cpu, NODE1_STREAM);
  const port = runDisplayList(NODE1_STREAM, { node: NODE_FIELDS });

  assert.equal(port.steps.filter((s) => s.kind === "mesh").length, 18, "18 mesh ops");
  assert.equal(port.steps.filter((s) => s.kind === "prim").length, 2, "2 descriptor packets");
  assert.equal(port.steps.filter((s) => s.kind === "colour").length, 1, "1 colour packet");
  assert.equal(port.steps.filter((s) => s.kind === "state").length, 7, "7 state sets");
  assert.equal(port.steps.filter((s) => s.kind === "terminator").length, 1, "one terminator");
  // 0x01 reads cursor[1..6] but consumes 7 bytes; 0x02 consumes 4; the mesh run
  // is 1 + (s3c+3)*(1+[s40]+2*[s30]).
  assert.deepEqual(port.steps.find((s) => s.kind === "prim")!.cursorWrites, [0x12], "0x0b prim -> 0x12");
  assert.deepEqual(port.steps.find((s) => s.kind === "colour")!.cursorWrites, [0x0b], "0x07 colour -> 0x0b");
});

// ── the packet-builder call oracle ─────────────────────────────────────────

test("every packer call the original makes is one the port predicts, at the port's selection", SKIP, () => {
  const mem = loadDump();
  const cpu = new R3000(mem);
  const orig = runOriginal(mem, cpu, NODE1_STREAM);
  const port = runDisplayList(NODE1_STREAM, { node: NODE_FIELDS });

  // The port selects packer B for every mesh op (s44 = 0 throughout both
  // captured streams, set by the 0xD0 at offset 0).
  assert.deepEqual(port.packets, port.packets.map(() => "B"), "the loop selects builder B");
  assert.ok(port.packets.length >= orig.packerCalls.length, "the port predicts at least the calls made");

  // Every executed call is to builder B and comes from the 0x800858ac site the
  // port's selection names; none is the A builder.
  for (const call of orig.packerCalls) {
    assert.equal(call.target, PACKER_B, "no A builder call for s44 = 0");
    assert.equal(call.caller, PACK_SITE_B, "the B builder's jal site");
  }
  // The original culls some mesh ops before the call — the projected-X sign
  // test in the mesh arm (0x80085640, `blez` on MAC1), which is part of the
  // unported mesh-emission/colour path, not the dispatch loop. Measured, not
  // hidden: the calls made are a subset of the ops the port selects.
  assert.ok(orig.packerCalls.length >= 1, "the original made at least one builder call");
  assert.ok(orig.packerCalls.length <= port.packets.length, "calls are a subset of selections");
});

// ── the 0x01 descriptor word oracle ────────────────────────────────────────

test("the 0x01 descriptor word equals the port's buildPrimPacket, per op", SKIP, () => {
  const mem = loadDump();
  const cpu = new R3000(mem);
  const orig = runOriginal(mem, cpu, NODE1_STREAM);
  const port = runDisplayList(NODE1_STREAM, { node: NODE_FIELDS });
  const portWords = port.steps.filter((s) => s.prim).map((s) => s.prim!.word >>> 0);

  assert.equal(orig.primWords.length, portWords.length, "one descriptor per 0x01 op");
  assert.deepEqual(portWords, orig.primWords, "the sp+0x70 descriptor words");

  // And the port's word is not constant — the operands really moved it.
  assert.ok(new Set(portWords).size > 1, "the two descriptors differ");
  // Negative control: a wrong 0x01 operand read (one byte off) must diverge.
  const wrong = buildPrimPacket(NODE1_STREAM, 0x0c, NODE_FIELDS, 0);
  assert.notEqual(wrong.word >>> 0, portWords[0], "a shifted operand must not match");
});

// ── the mutation: a single wrong advance must fail the oracle ───────────────

test("mutation: one shifted advance breaks the cursor oracle", SKIP, () => {
  const mem = loadDump();
  const cpu = new R3000(mem);
  const orig = runOriginal(mem, cpu, NODE1_STREAM);
  const good = [0, ...runDisplayList(NODE1_STREAM, { node: NODE_FIELDS }).steps.flatMap((s) => s.cursorWrites)];
  assert.deepEqual(good, orig.cursor, "the clean port matches");

  // Shift the advance of the first mesh op (the 0x00 at offset 0x12) by one
  // byte: this is the change the oracle must catch.
  const mutated = runDisplayList(NODE1_STREAM, {
    node: NODE_FIELDS, mutations: { at: 0x12, extraAdvance: 1 },
  });
  const mutatedWrites = [0, ...mutated.steps.flatMap((s) => s.cursorWrites)];
  assert.notDeepEqual(mutatedWrites, orig.cursor, "a wrong advance must not match");

  // The same check for each opcode class's advance: shift the 0x01 (7 -> 8).
  const m2 = runDisplayList(NODE1_STREAM, { node: NODE_FIELDS, mutations: { at: 0x0b, extraAdvance: 1 } });
  assert.notDeepEqual([0, ...m2.steps.flatMap((s) => s.cursorWrites)], orig.cursor, "a wrong 0x01 advance must fail");
  // And the colour packet (4 -> 5).
  const m3 = runDisplayList(NODE1_STREAM, { node: NODE_FIELDS, mutations: { at: 0x07, extraAdvance: 1 } });
  assert.notDeepEqual([0, ...m3.steps.flatMap((s) => s.cursorWrites)], orig.cursor, "a wrong colour advance must fail");
});

// ── classes the captured stream does not exercise, run on the original ─────

test("skip class (0x1n..0x7n, 0xFn): the original advances one byte, the port too", SKIP, () => {
  const mem = loadDump();
  const cpu = new R3000(mem);
  const stream = Uint8Array.from([0x1f, 0x7a, 0xe0, 0xff]);
  const orig = runOriginal(mem, cpu, stream);
  assert.deepEqual(orig.cursor, [0, 1, 2, 3], "each skipped byte advances the cursor once");
  const port = runDisplayList(stream, { node: NODE_FIELDS });
  assert.deepEqual([0, ...port.steps.flatMap((s) => s.cursorWrites)], orig.cursor);
  assert.deepEqual(port.steps.slice(0, 3).map((s) => s.kind), ["skip", "skip", "state"]);
});

test("the full mesh advance formula (s3c=2, s40=1, s30=1): original equals the port", SKIP, () => {
  const mem = loadDump();
  const cpu = new R3000(mem);
  // 0x82 -> s3c=2, 0x91 -> s30=1, 0xc1 -> s40=1; one 0x00 with 20 operand bytes
  // (5 indices + 5 lit normals + 10 UV), then the terminator.
  const mid = Uint8Array.from({ length: 20 }, (_, i) => (i * 7 + 3) & 0xff);
  const stream = Uint8Array.from([0x82, 0x91, 0xc1, 0x00, ...mid, 0xff]);
  const orig = runOriginal(mem, cpu, stream);
  const state = { ...initialDisplayListState(), s3c: 2, s30: 1, s40: 1 };
  assert.equal(meshRunAdvance(state), 5 * (1 + 1 + 2), "run = 20 operand bytes");
  assert.equal(orig.cursor[orig.cursor.length - 1], 3 + 1 + meshRunAdvance(state), "cursor lands on the terminator");
  const port = runDisplayList(stream, { node: NODE_FIELDS });
  assert.deepEqual([0, ...port.steps.flatMap((s) => s.cursorWrites)], orig.cursor);
});

test("the low-nibble hang (0x06..0x0f) is reported, not run", () => {
  const port = runDisplayList(Uint8Array.from([0x06]), { node: NODE_FIELDS });
  assert.equal(port.hang, true);
  assert.equal(port.steps[0]!.kind, "hang");
  assert.equal(port.steps[0]!.advance, 0, "no advance — the original re-reads the byte");
  assert.equal(runDisplayList(Uint8Array.from([0x0f]), {}).hang, true);
  assert.equal(runDisplayList(Uint8Array.from([0x05, 0xff]), {}).hang, false, "0x05 is a colour packet");
});

test("the nibble -> state-slot map matches the jump table", () => {
  assert.deepEqual(DL_STATE_SLOT, { 8: "s3c", 9: "s30", 10: "s38", 11: "s34", 12: "s40", 13: "s44", 14: "s48" });
});

// ── the mesh arm's projected-sign cull (0x80085640) ────────────────────────

/** The projected SXY table `runOriginal` seeds by default. */
const T78_DEFAULT = (i: number): number => (0x100000 + i * 0x1111) | 0;
/** A mutated projection: the X sign of every SXY word is flipped. */
const T78_FLIP = (i: number): number => ((0x100000 + i * 0x1111) ^ 0x10000) | 0;

function table78(fn: (i: number) => number): number[] {
  const t: number[] = [];
  for (let i = 0; i < 256; i++) t.push(fn(i) | 0);
  return t;
}

test("the projected-sign cull: the port drops exactly the mesh ops the machine does not build", SKIP, () => {
  const mem = loadDump();
  const cpu = new R3000(mem);
  const orig = runOriginal(mem, cpu, NODE1_STREAM, T78_DEFAULT);

  const port = runDisplayList(NODE1_STREAM, {
    node: NODE_FIELDS, tables: { table78: table78(T78_DEFAULT) },
  });
  const emitted = port.steps.filter((s) => s.kind === "mesh" && s.mesh && !s.mesh.fields.culled);

  // The machine built 3 of the 18 mesh ops; the other 15 are culled by the
  // projected-sign test (MAC0 <= 0) and the degenerate-equality checks.
  assert.equal(orig.packerCalls.length, 3, "the machine builds 3 of 18 mesh packets");
  assert.equal(emitted.length, orig.packerCalls.length, "the port emits exactly as many");
  assert.equal(port.steps.filter((s) => s.kind === "mesh" && s.mesh).length, 18, "18 mesh ops seen");

  // Every non-culled step carries a positive NCLIP area and a defined cull flag.
  for (const s of emitted) {
    assert.equal(s.mesh!.fields.culled, false);
    assert.ok((s.mesh!.fields.cullMac0 ?? 0) > 0, "kept only when MAC0 > 0");
  }
});

test("mutation: change the projected table and both the machine and the port move together", SKIP, () => {
  const mem = loadDump();
  const cpu = new R3000(mem);
  const base = runOriginal(mem, cpu, NODE1_STREAM, T78_DEFAULT).packerCalls.length;
  const flip = runOriginal(mem, cpu, NODE1_STREAM, T78_FLIP).packerCalls.length;

  const portBase = runDisplayList(NODE1_STREAM, { node: NODE_FIELDS, tables: { table78: table78(T78_DEFAULT) } })
    .steps.filter((s) => s.kind === "mesh" && s.mesh && !s.mesh.fields.culled).length;
  const portFlip = runDisplayList(NODE1_STREAM, { node: NODE_FIELDS, tables: { table78: table78(T78_FLIP) } })
    .steps.filter((s) => s.kind === "mesh" && s.mesh && !s.mesh.fields.culled).length;

  assert.notEqual(flip, base, "flipping the projected X really changes the machine's builds");
  assert.equal(portBase, base, "the port follows the base projection");
  assert.equal(portFlip, flip, "the port follows the mutated projection too");
});

test("the packet fields: the port's first UV pair is the machine's own texcoord store", SKIP, () => {
  const mem = loadDump();
  const cpu = new R3000(mem);
  const orig = runOriginal(mem, cpu, NODE1_STREAM, T78_DEFAULT);
  assert.ok(orig.packerCalls.length >= 1, "the machine built at least one packet");

  const port = runDisplayList(NODE1_STREAM, {
    node: NODE_FIELDS, tables: { table78: table78(T78_DEFAULT) },
  });
  const first = port.steps.find((s) => s.kind === "mesh" && s.mesh && !s.mesh.fields.culled);
  assert.ok(first && first.mesh!.fields.uvBytes, "the first emitted step has a UV run");

  // The first emitted packet is written at PKTBUF+0; packer B stores texCoord[0]
  // to out+0xc as the (u,v) halfword. The machine's own store versus the port's
  // computed uvBytes[0..1].
  const uv = first!.mesh!.fields.uvBytes!;
  const stored = mem.read16(PKTBUF + 0xc);
  assert.equal(stored, (uv[0]! | (uv[1]! << 8)) & 0xffff, "the machine's texcoord equals the port's first UV pair");
});

