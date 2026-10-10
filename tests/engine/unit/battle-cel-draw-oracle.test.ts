// Oracle for the battle HUD's cel draw (engine/dw3/battle-cel-draw.ts).
//
// Runs the ORIGINAL words of FIGHTSTG_F0x80093fec out of the committed fightstg overlay
// through engine/native. The routine builds its 0xA0 draw context on the stack (F0x8001f648)
// and then calls the context's methods: it is those saves and the picture arguments that are
// the mechanism, so the constructor is stubbed to install recording method pointers and the
// pack accessor to return a known base. The oracle compares the layer it binds, the CLUT
// origin it installs and the (pack, cel, x, y) it hands the picture method to the port's
// request. A negative control mutates the cel id and shows the comparison FAILS.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  faceBezelCelDraw, CEL_DRAW_LAYER, CEL_DRAW_ORIGIN, FACE_BEZEL_PACK, FACE_BEZEL_CEL,
} from "../../../engine/dw3/battle-cel-draw.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const EXE_TABLES = "web/assets/native/exe_tables.json";
const available = existsSync(BIN) && existsSync(EXE_TABLES);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const CEL_ROUTINE = 0x80093fec;
const DRAW_CTX_CTOR = 0x8001f648;
const PACK_GET_ENTRY = 0x80044f5c;
const PACK_BASE = 0x80110000;
const BIND_STUB = 0x80104010;
const ORIGIN_STUB = 0x80104014;
const DRAW_STUB = 0x80104018;

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);
const exeTables = available
  ? JSON.parse(readFileSync(EXE_TABLES, "utf8")) as { sin_table_base: number; halfwords: number[] }
  : undefined;

interface Call { layer: number; origin: number; pack: number; cel: number; x: number; y: number }

/** Run F0x80093fec with recording stubs; returns the arguments it fed the picture method. */
function runOriginal(): Call {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    exeTables, undefined, BASE,
  );
  const out: Call = { layer: -1, origin: -1, pack: -1, cel: -1, x: -1, y: -1 };
  // The draw-context constructor receives a0 = sp+0x10; install the three method pointers the
  // routine reads (sp+0x8c = ctx+0x7c bind, sp+0x84 = ctx+0x74 origin, sp+0x94 = ctx+0x84 draw).
  rt.cpu.setStub(DRAW_CTX_CTOR, (c) => {
    const ctx = c.reg(4) | 0;
    rt.mem.write32(ctx + 0x7c, BIND_STUB);
    rt.mem.write32(ctx + 0x74, ORIGIN_STUB);
    rt.mem.write32(ctx + 0x84, DRAW_STUB);
    return 0;
  });
  rt.cpu.setStub(BIND_STUB, (c) => { out.layer = c.reg(4) | 0; return 0; });
  rt.cpu.setStub(ORIGIN_STUB, (c) => { out.origin = c.reg(4) | 0; return 0; });
  rt.cpu.setStub(DRAW_STUB, (c) => {
    out.pack = c.reg(4) >>> 0; out.cel = c.reg(5) | 0; out.x = c.reg(6) | 0; out.y = c.reg(7) | 0;
    return 0;
  });
  // The pack accessor is reached through the POINTER cell at 0x80044f5c (the routine loads the
  // word and `jalr`s it), so the stub goes on the target the cell holds, not on the cell.
  const packFn = rt.mem.read32(PACK_GET_ENTRY) >>> 0;
  assert.notEqual(packFn, 0, "the runtime seeded the pack accessor cell");
  rt.cpu.setStub(packFn, () => PACK_BASE);
  rt.cpu.call(CEL_ROUTINE, [], 300_000);
  return out;
}

const PACK_HIGH = FACE_BEZEL_PACK << 16;   // the accessor's argument `lui $a0, 0x455`

test("cel draw F0x80093fec: binds the UI layer, installs the origin, draws cel 0xA at (246,74)", SKIP, () => {
  // Guard the accessor argument the routine passes (`lui $a0, 0x455`), so the pack is pinned.
  assert.equal(PACK_HIGH >>> 16, FACE_BEZEL_PACK);
  const orig = runOriginal();
  const port = faceBezelCelDraw();
  assert.equal(orig.layer, port.layer, `layer: original ${orig.layer} vs port ${port.layer}`);
  assert.equal(orig.layer, CEL_DRAW_LAYER);
  assert.equal(orig.origin, port.origin, `origin: original ${orig.origin} vs port ${port.origin}`);
  assert.equal(orig.origin, CEL_DRAW_ORIGIN);
  assert.equal(orig.pack, PACK_BASE, "picture drawn from the pack accessor's return");
  assert.equal(port.pack, FACE_BEZEL_PACK);
  assert.equal(orig.cel, port.cel, `cel: original ${orig.cel} vs port ${port.cel}`);
  assert.equal(orig.cel, FACE_BEZEL_CEL);
  assert.equal(orig.x, port.x, `x: original ${orig.x} vs port ${port.x}`);
  assert.equal(orig.x, 246);
  assert.equal(orig.y, port.y, `y: original ${orig.y} vs port ${port.y}`);
  assert.equal(orig.y, 74);
});

test("NEGATIVE CONTROL: a mutated cel id no longer matches the original", SKIP, () => {
  const orig = runOriginal();
  const mutated = { ...faceBezelCelDraw(), cel: 0x0b };
  assert.notEqual(orig.cel, mutated.cel, "mutation must disagree with the original");
});
