// Oracle for the effect-tint feed (engine/dw3/battle-effect-tint.ts).
//
// The strongest check runs the ORIGINAL instruction words of FIGHTSTG_F0x800861f4
// out of the committed fightstg overlay image (web/assets/native/screens/
// pro_fightstg.bin, base 0x80082cb0) through engine/native, stubbing the four
// externals it calls, and compares every argument it passes to the port, over a
// grid of tint bytes:
//   - [0x800a46a0]     the shared pose routine (called twice)
//   - w[holder]+0x262c the owner submit
//   - (0x8004df8c)(id) the arena view lookup
//   - view+0x12c       the view colour setter
// A negative control proves the comparison would catch a wrong default colour.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  ARENA_VIEW_ID, EFFECT_TINT_DEFAULT,
  effectTintColour, effectTintFeed,
  type EffectFeedObject, type EffectTintFeedSink,
} from "../../../engine/dw3/battle-effect-tint.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const available = existsSync(BIN);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const FEED = 0x800861f4;
const POSE_CELL = 0x800a46a0;
const VIEWFN_CELL = 0x8004df8c; // [0x8005 - 0x2074]

const OBJ = 0x80100000;
const HOLDER = 0x80100100;
const OWNER = 0x80100200;
const VIEW = 0x80100300;

const POSE_STUB = 0x801e0000;
const VIEWFN_STUB = 0x801e0004;
const SUBMIT_STUB = 0x801e0008;
const TINT_STUB = 0x801e000c;

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);

function runtime(): NativeStageRuntime {
  return new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    undefined, undefined, BASE,
  );
}

interface Config {
  a4: number;
  c4: number; c6: number; c8: number;
  dc: number; dd: number; de: number; df: number;
  e0: number; e1: number;
}

function runFeed(cfg: Config) {
  const rt = runtime();
  const m = rt.mem;
  m.write32(POSE_CELL, POSE_STUB);
  m.write32(VIEWFN_CELL, VIEWFN_STUB);
  m.write32(HOLDER, OWNER);
  m.write32(OWNER + 0x262c, SUBMIT_STUB);
  m.write32(VIEW + 0x12c, TINT_STUB);

  const poses: number[][] = [];
  rt.cpu.setStub(POSE_STUB, (c) => { poses.push([(c.reg(4) | 0) >>> 0, (c.reg(5) | 0) >>> 0, (c.reg(6) | 0) >>> 0, (c.reg(7) | 0) >>> 0]); return 0; });
  const submits: { target: number; sel: number; rgb: number[] }[] = [];
  rt.cpu.setStub(SUBMIT_STUB, (c) => {
    const p = c.reg(6) | 0;
    submits.push({ target: (c.reg(4) | 0) >>> 0, sel: c.reg(5) | 0, rgb: [c.mem.read8(p), c.mem.read8(p + 1), c.mem.read8(p + 2)] });
    return 0;
  });
  const views: number[] = [];
  rt.cpu.setStub(VIEWFN_STUB, (c) => { views.push((c.reg(4) | 0) >>> 0); return VIEW; });
  const tints: number[][] = [];
  rt.cpu.setStub(TINT_STUB, (c) => { tints.push([c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return 0; });

  m.write32(OBJ + 0xa4, cfg.a4);
  m.write8(OBJ + 0xc4, cfg.c4); m.write8(OBJ + 0xc6, cfg.c6); m.write8(OBJ + 0xc8, cfg.c8);
  m.write8(OBJ + 0xdc, cfg.dc); m.write8(OBJ + 0xdd, cfg.dd); m.write8(OBJ + 0xde, cfg.de); m.write8(OBJ + 0xdf, cfg.df);
  m.write8(OBJ + 0xe0, cfg.e0); m.write8(OBJ + 0xe1, cfg.e1);

  rt.cpu.call(FEED, [OBJ, HOLDER], 100000);

  const orig = { poses, submits, views, tints };

  // The port over a matching sink reading the same memory.
  const obj: EffectFeedObject = {
    base: OBJ,
    readWord: (off) => m.read32(OBJ + off),
    readByte: (off) => m.read8(OBJ + off),
    readCell: (addr) => m.read32(addr),
  };
  const portPoses: number[][] = [];
  const portSubmits: typeof submits = [];
  const portTints: number[][] = [];
  const sink: EffectTintFeedSink = {
    pose: (d0, d1, s, d2) => portPoses.push([d0, d1, s, d2]),
    submit: (target, sel, rgb) => portSubmits.push({ target: target >>> 0, sel, rgb: [...rgb] }),
    view: (id) => { assert.equal(id, ARENA_VIEW_ID); return { setTint: (r, g, b) => portTints.push([r, g, b]) }; },
  };
  effectTintFeed(obj, HOLDER, sink);
  const port = { poses: portPoses, submits: portSubmits, views: [ARENA_VIEW_ID], tints: portTints };
  return { orig, port };
}

// ── 1. the colour rule, isolated ────────────────────────────────────────────

test("F0x800861f4 tint colour: word/ halfword presence selects bytes or white", SKIP, () => {
  const cases: { cfg: Config; want: number[] }[] = [
    { cfg: { a4: 0, c4: 0, c6: 0, c8: 0, dc: 0x40, dd: 0, de: 0x80, df: 0, e0: 0xc0, e1: 0 }, want: [0x40, 0x80, 0xc0] },
    // word at +0xdc zero, halfword at +0xe0 non-zero -> bytes.
    { cfg: { a4: 0, c4: 0, c6: 0, c8: 0, dc: 0, dd: 0, de: 0, df: 0, e0: 0x05, e1: 0 }, want: [0, 0, 0x05] },
    // both zero -> the (1,1,1) default.
    { cfg: { a4: 0, c4: 0, c6: 0, c8: 0, dc: 0, dd: 0, de: 0, df: 0, e0: 0, e1: 0 }, want: [1, 1, 1] },
    // the word at +0xdc is non-zero only through its high byte (+0xdd).
    { cfg: { a4: 0, c4: 0, c6: 0, c8: 0, dc: 0, dd: 0x7, de: 0x33, df: 0, e0: 0, e1: 0 }, want: [0, 0x33, 0] },
  ];
  for (const { cfg, want } of cases) {
    const { orig } = runFeed(cfg);
    assert.deepEqual(orig.tints[0], want, JSON.stringify(cfg));
    const obj: EffectFeedObject = {
      base: 0,
      readWord: (off) => (off === 0xdc
        ? (cfg.dc | (cfg.dd << 8) | (cfg.de << 16) | (cfg.df << 24))
        : (off === 0xe0 ? (cfg.e0 | (cfg.e1 << 8)) : 0)),
      readByte: (off) => (off === 0xdc ? cfg.dc : off === 0xde ? cfg.de : off === 0xe0 ? cfg.e0 : 0),
      readCell: () => 0,
    };
    assert.deepEqual(effectTintColour(obj), want, "port grid");
  }
  assert.equal(EFFECT_TINT_DEFAULT, 1);
});

// ── 2. the full feed against the original words ─────────────────────────────

test("F0x800861f4 full feed: pose, submit, view and tint all match the port", SKIP, () => {
  const cfg: Config = { a4: 0x1234, c4: 0x11, c6: 0x22, c8: 0x33, dc: 0x40, dd: 0, de: 0x80, df: 0, e0: 0xc0, e1: 0 };
  const { orig, port } = runFeed(cfg);
  assert.deepEqual(orig, port, "the original's full effect equals the port");
  assert.equal(orig.poses.length, 2);
  assert.deepEqual(orig.poses[0], [OBJ + 0xb4, OBJ + 0xbc, 0x1234, OBJ + 0xc4]);
  assert.deepEqual(orig.poses[1], [OBJ + 0xcc, OBJ + 0xd4, 0x1234, OBJ + 0xdc]);
  assert.deepEqual(orig.submits, [{ target: OWNER, sel: 1, rgb: [0x11, 0x22, 0x33] }]);
  assert.deepEqual(orig.views, [ARENA_VIEW_ID]);
  assert.deepEqual(orig.tints, [[0x40, 0x80, 0xc0]]);
});

test("F0x800861f4 full feed: an all-zero object yields the white default", SKIP, () => {
  const cfg: Config = { a4: 0, c4: 0, c6: 0, c8: 0, dc: 0, dd: 0, de: 0, df: 0, e0: 0, e1: 0 };
  const { orig, port } = runFeed(cfg);
  assert.deepEqual(orig, port);
  assert.deepEqual(orig.tints, [[1, 1, 1]]);
  // Negative control: the default is NOT black (a port that reused wfightmn's
  // black fill would write 0,0,0), and NOT the bytes branch.
  assert.notDeepEqual(orig.tints[0], [0, 0, 0]);
});
