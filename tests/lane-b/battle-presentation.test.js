// Lane B oracle for engine/dw3/battle-presentation.ts — the 3-D battle's
// presentation pipeline (smdldata record loaders, arena placement, canned camera
// shots, texture-patch selection and packing).
//
// The original routines run here through engine/native on the shipped
// pro_fightstg.bin + resident.bin fixtures, over the real `pro/smdldata.s` image
// flattened to bytes. What is compared:
//
//   FIGHTSTG_F0x8009E994 (smdldata lookup)  — every index entry in the table.
//   FIGHTSTG_F0x8009EB94 (pool relocation)  — every key with a record.
//   FIGHTSTG_F0x80087F38 (arena placement)  — the slot resolver 0x80087E28 and the
//                                             record accessor cell 0x800A4570 are
//                                             stubbed; the placement arithmetic is
//                                             the routine's own.
//   FIGHTSTG_F0x8008B118 (eye override)     — the state-code mapping.
//   FIGHTSTG_F0x8008B160 (patch copy rect)  — the resident GP0(0x80) builder
//                                             F0x8002918C is stubbed to capture the
//                                             six-halfword descriptor it is handed.
//
// Decode: docs/research/battle/smdldata-container-2026-08-05.md (container + every
// field), docs/research/battle/3d-battle-complete-model-2026-08-19.md §6,
// pro/fightstg.s:28982 (E994), :29116 (EB94), :5417 (87F38), :8382 (B118),
// :8404 (B160), :8447 (B200), :8643 (B508). The blink jump table D0x80082E1C is at
// pro/fightstg.s:81-87.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    ARENA_BASE_Z, ARENA_NEAR_ROT_Y, BLINK_TABLE, BLINK_TABLE_ADDR, BLINK_TARGET_VARIANT,
    CYCLE_HOLD, CYCLE_PERIOD, SMDLDATA_RESOURCE, SMDLDATA_SECTION_SPLIT, SmdldataTable,
    blinkPause, blinkVariant, cycleVariant, eyePatchVariant, patchCopyRect,
} from "../../engine/dw3/battle-presentation.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const fight = new Uint8Array(readFileSync(join(dir, "pro_fightstg.bin")));
const entry = { size: fight.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const OVERLAY_BASE = 0x80082cb0;

const E994 = 0x8009e994;
const EB94 = 0x8009eb94;
const PLACE = 0x80087f38;
const SLOT_RESOLVER = 0x80087e28;
const RECORD_ACCESSOR = 0x800a4570;
const EYE_OVERRIDE = 0x8008b118;
const PATCH_RECT = 0x8008b160;
const PRIM_BUILDER = 0x8002918c;

const IMG_BASE = 0x80100000;
const RES_STUB = 0x0fdc1000;
const ACCESSOR_STUB = 0x0fdc1020;

/** Flatten the disassembler's `.word` rows back into the file image. */
function flattenWords(source) {
  const words = new Map();
  let cursor = null;
  for (const line of source.split("\n")) {
    const t = line.trim();
    const label = /^\.L0x([0-9a-fA-F]+):/.exec(t);
    if (label) cursor = parseInt(label[1], 16);
    const word = /\.word\s+D?(0x[0-9a-fA-F]+)/.exec(t);
    if (word && cursor !== null) { words.set(cursor, parseInt(word[1], 16) >>> 0); cursor += 4; }
  }
  let max = 0;
  for (const k of words.keys()) if (k > max) max = k;
  const image = new Uint8Array(max + 4);
  const dv = new DataView(image.buffer);
  for (const [off, val] of words) dv.setUint32(off, val, true);
  return image;
}

const SMDL_SRC = join(process.env.DDW3_DIR || join(homedir(), "ddw3"), "asm/dw2003/pro/smdldata.s");
const available = existsSync(SMDL_SRC);
const SKIP = { skip: !available && "ddw3 asm corpus not present on this machine (set DDW3_DIR or clone ddw3 to ~/ddw3)" };
const smdldata = available ? flattenWords(readFileSync(SMDL_SRC, "utf8")) : new Uint8Array(16);
const table = new SmdldataTable(smdldata);
const HEADER = table.header;

function runtime() {
  const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777, playPackedSound() {} };
  const rt = new NativeStageRuntime(fight, entry, host, undefined, undefined, OVERLAY_BASE, {
    image: resident, base: 0x80010000,
  });
  rt.mem.load(smdldata, IMG_BASE);
  // The resource-service slot the loader reaches through D0x80044F4C: hand back the
  // smdldata image base for resource 0x1CC.
  rt.cpu.setStub(RES_STUB, (c) => {
    assert.equal(c.reg(4) >>> 0, SMDLDATA_RESOURCE, "the loader asks for resource 0x1CC");
    return IMG_BASE;
  });
  rt.mem.write32(0x80044f4c, RES_STUB);
  return rt;
}

/** Every index entry in the image, in file order. */
function indexEntries() {
  const out = [];
  const b = smdldata;
  let off = HEADER.indexOffset;
  while (off + 4 <= b.length) {
    const key = (b[off] | (b[off + 1] << 8)) << 16 >> 16;
    if (key === 0) break;
    out.push({ key, selfIndex: b[off + 2], slot: b[off + 3] });
    off += 4;
  }
  return out;
}

test("the image header is the file's own self-description", SKIP, () => {
  assert.equal(HEADER.base, 0x80082cb0, "word 0 is the base interior pointers resolve against");
  assert.equal(HEADER.indexOffset, 0x10);
  assert.equal(HEADER.section2, 0x2458);
  assert.equal(HEADER.section3, 0x4e74);
  assert.equal(SMDLDATA_RESOURCE, 0x1cc);
  assert.equal(SMDLDATA_SECTION_SPLIT, 0x3a);
});

test("the port's lookup matches FIGHTSTG_F0x8009E994 for every index entry", SKIP, () => {
  const rt = runtime();
  const entries = indexEntries();
  assert.equal(entries.length, 248, "the table carries 248 keys");
  for (const e of entries) {
    const ret = rt.cpu.call(E994, [e.key], 200000) >>> 0;
    assert.ok(ret !== 0, `the original resolves key ${e.key}`);
    const nativeOff = (ret - IMG_BASE) >>> 0;
    const port = table.lookup(e.key);
    assert.ok(port, `the port resolves key ${e.key}`);
    assert.equal(port.recordOffset, nativeOff, `key ${e.key} record offset`);
    assert.equal(port.selfIndex, e.selfIndex, `key ${e.key} self index`);
    assert.equal(port.slot, e.slot, `key ${e.key} slot`);
    assert.equal(port.far, e.slot >= SMDLDATA_SECTION_SPLIT, `key ${e.key} section split`);
    assert.equal(port.section, e.slot >= SMDLDATA_SECTION_SPLIT ? 3 : 2, `key ${e.key} section`);
    // The original's cache globals carry the same three fields.
    assert.equal(rt.mem.read16(0x800a4558), e.key, "cached key");
    assert.equal(rt.mem.read32(0x800a455c), port.far ? 1 : 0, "cached far flag");
    assert.equal(rt.mem.read32(0x800a4560), e.selfIndex, "cached self index");
    assert.equal(rt.mem.read32(0x800a4564), e.slot, "cached slot");
  }
});

test("an absent key returns null, like the routine returning zero", SKIP, () => {
  const rt = runtime();
  for (const missing of [1, 2, 999]) {
    assert.equal(table.lookup(missing), null, `key ${missing} is absent`);
    assert.equal(rt.cpu.call(E994, [missing], 200000) >>> 0, 0, `key ${missing} resolves to zero`);
  }
});

test("the port relocates the pool pointer the way FIGHTSTG_F0x8009EB94 does", SKIP, () => {
  const rt = runtime();
  for (const [key, expected] of [[3, 0x428], [373, 0xae8], [469, 0x5dc]]) {
    const ret = rt.cpu.call(EB94, [key], 200000) >>> 0;
    const nativeOff = (ret - IMG_BASE) >>> 0;
    const rec = table.lookup(key);
    assert.ok(rec, `key ${key} resolves`);
    assert.equal(table.poolOffset(rec.recordOffset), nativeOff, `key ${key} pool offset`);
    assert.equal(table.poolOffset(rec.recordOffset), expected, `key ${key} matches the decode`);
    assert.ok(nativeOff >= 0x3f0 && nativeOff < 0x2458, "the pool slot is inside section 1");
  }
});

test("the port's arena placement matches FIGHTSTG_F0x80087F38 on both sides", SKIP, () => {
  const rt = runtime();
  const OBJ = 0x80200000;
  rt.cpu.setStub(ACCESSOR_STUB, () => {
    const key = rt.mem.read32(OBJ + 0x14);
    return IMG_BASE + table.lookup(key).recordOffset;
  });
  rt.cpu.setStub(SLOT_RESOLVER, () => OBJ);
  rt.mem.write32(RECORD_ACCESSOR, ACCESSOR_STUB);

  for (const key of [3, 222, 373]) {
    const rec = table.lookup(key);
    for (const slotId of [0, 0x0f, 0x10, 0x14]) {
      for (let i = 0x1c; i <= 0x32; i += 2) rt.mem.write16(OBJ + i, 0xdead);
      rt.mem.write32(OBJ + 0x14, key);
      rt.cpu.call(PLACE, [0x80000000, slotId], 200000);
      const port = table.placement(rec.recordOffset, slotId);
      assert.equal(rt.mem.read16s(OBJ + 0x1c), 0, `key ${key} slot ${slotId} live x`);
      assert.equal(rt.mem.read16s(OBJ + 0x1e), port.y, `key ${key} slot ${slotId} live y`);
      assert.equal(rt.mem.read16s(OBJ + 0x20), port.z, `key ${key} slot ${slotId} live z`);
      assert.equal(rt.mem.read16s(OBJ + 0x24), port.rotY, `key ${key} slot ${slotId} rotation.y`);
      // The home copy is the live triple.
      assert.equal(rt.mem.read16s(OBJ + 0x28), 0, `key ${key} slot ${slotId} home x`);
      assert.equal(rt.mem.read16s(OBJ + 0x2a), port.y, `key ${key} slot ${slotId} home y`);
      assert.equal(rt.mem.read16s(OBJ + 0x2c), port.z, `key ${key} slot ${slotId} home z`);
    }
  }
});

test("the port's eye override matches FIGHTSTG_F0x8008B118 across the state band", SKIP, () => {
  const rt = runtime();
  const OBJ = 0x80210000;
  const FIGHTER = 0x80220000;
  rt.mem.write32(OBJ + 0x50, FIGHTER);
  for (let state = 0; state < 16; state++) {
    rt.mem.write32(FIGHTER + 0x78, state);
    const native = rt.cpu.call(EYE_OVERRIDE, [OBJ], 20000) >>> 0;
    assert.equal(native, eyePatchVariant(state), `state ${state}`);
  }
  assert.equal(eyePatchVariant(1), 0);
  assert.equal(eyePatchVariant(2), 1);
  assert.ok([4, 5, 6, 7, 8, 9, 10, 11].every((s) => eyePatchVariant(s) === 2), "states 4..11 shut");
  assert.equal(eyePatchVariant(3), 0);
  assert.equal(eyePatchVariant(12), 0);
});

test("the port's patch copy rect matches FIGHTSTG_F0x8008B160", SKIP, () => {
  const rt = runtime();
  const OBJ = 0x80230000;
  const DEST = 0x80240000;
  const captured = [];
  rt.cpu.setStub(PRIM_BUILDER, (c) => {
    // a0 = the dest buffer, a1 = the six-halfword descriptor on the stack.
    const p = c.reg(5) >>> 0;
    captured.push([
      c.mem.read16(p), c.mem.read16(p + 2), c.mem.read16(p + 4),
      c.mem.read16(p + 6), c.mem.read16(p + 8), c.mem.read16(p + 0xc),
    ]);
    return 0;
  });
  rt.mem.write16(OBJ + 0x54, 832);  // strip origin x, from D0x800A2530 slot 0
  rt.mem.write16(OBJ + 0x58, 0);    // strip origin y

  const entry = { slot: 0, dst: [50, 0], size: [8, 24], src: [[0, 32], [8, 32], [16, 32]] };
  for (const slot of [0, 2, 5]) {
    const base = OBJ + 0x14 * slot + 0x60;
    rt.mem.write8(base + 0x08, entry.dst[0]);
    rt.mem.write8(base + 0x09, entry.dst[1]);
    rt.mem.write8(base + 0x0a, entry.size[0]);
    rt.mem.write8(base + 0x0b, entry.size[1]);
    for (let v = 0; v < 3; v++) {
      rt.mem.write8(base + 0x0c + 2 * v, entry.src[v][0]);
      rt.mem.write8(base + 0x0d + 2 * v, entry.src[v][1]);
    }
    for (const variant of [0, 1, 2]) {
      captured.length = 0;
      rt.cpu.call(PATCH_RECT, [OBJ, DEST, slot, variant], 200000);
      assert.equal(captured.length, 1, "the resident builder was handed one descriptor");
      const [srcX, srcY, w, h, dstX, dstY] = captured[0];
      const port = patchCopyRect(entry, variant, 832, 0);
      assert.equal(srcX, port.srcX, `slot ${slot} variant ${variant} srcX`);
      assert.equal(srcY, port.srcY, `slot ${slot} variant ${variant} srcY`);
      assert.equal(w, port.width, `slot ${slot} variant ${variant} width`);
      assert.equal(h, port.height, `slot ${slot} variant ${variant} height`);
      assert.equal(dstX, port.dstX, `slot ${slot} variant ${variant} dstX`);
      assert.equal(dstY, port.dstY, `slot ${slot} variant ${variant} dstY`);
    }
  }
});

test("the blink jump table the port mirrors is the original's own", SKIP, () => {
  const rt = runtime();
  // D0x80082E1C is data in the overlay; read it through the runtime's memory so the
  // constant cannot drift from the disassembly.
  for (let i = 0; i < BLINK_TABLE.length; i++) {
    assert.equal(rt.mem.read32(BLINK_TABLE_ADDR + 4 * i) >>> 0, BLINK_TABLE[i], `blink table entry ${i}`);
  }
  // Entries 1..6 in time order (timer falling from index 6 to 0) give 1,1,2,2,1,1.
  assert.deepEqual([6, 5, 4, 3, 2, 1].map((i) => BLINK_TARGET_VARIANT[BLINK_TABLE[i]]), [1, 1, 2, 2, 1, 1]);
  assert.equal(BLINK_TARGET_VARIANT[BLINK_TABLE[0]], 0, "entry 0 is the reload arm (variant 0)");
  assert.equal(blinkVariant(0).reload, true, "a zero timer reloads the pause");
  assert.equal(blinkVariant(0).variant, 0);
  assert.equal(blinkVariant(20).variant, 0, "a long timer sits open");
  assert.equal(blinkVariant(20).reload, false);
  assert.equal(blinkPause(0), 60);
  assert.equal(blinkPause(0x7f), 187);
  assert.equal(cycleVariant(0), 0);
  assert.equal(cycleVariant(CYCLE_HOLD), 1);
  assert.equal(cycleVariant(2 * CYCLE_HOLD), 2);
  assert.equal(cycleVariant(CYCLE_PERIOD), 0);
});

// The constants the placement and packing reference must be the decoded ones.
test("the port carries the decoded constants", () => {
  assert.equal(ARENA_BASE_Z, 0x1400);
  assert.equal(ARENA_NEAR_ROT_Y, 0x800);
});
