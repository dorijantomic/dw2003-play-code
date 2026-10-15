// Oracle: engine/systems/scene-completion.ts's collection arm must write what the disc's
// own F0x800161d8 writes, for every (id, value) pair the disc ships.
//
//   F0x800161d8 (exe/fns.s .L0x800161d8–.L0x80016310)  set_flag's `(bank-0x80) < 0xf` arm
//     value != 0 -> A[id] = min(A[id]+1, 99)          byte at 0x80048d34+0x7c+id
//     value == 0 -> A[id] = max(A[id]-1, 0)           and, only if the SECOND array
//                   B[id] (0x80048d34+0x20f+id) is non-zero, also pulls that id out of the
//                   party's item slots (f10, through the method at +0x2718) and takes one
//                   off B[id]
//
// The original runs out of the resident EXE image through engine/native; the byte it wrote is
// read straight back out of memory. The port side is `collectionWrite` over the walker's real
// Inventory, which is also what get_flag(0x80NN)'s possession handler reads.
//
// The B branch is deliberately not run here: the disc ships no scene-completion write with
// value 0 (all 45 are sets) and the walker keeps ONE count per id — its menu moves a copy
// between the bag and an equipped slot itself, the disc's own A-1/B+1 pair — so there is no
// second counter for that arm to move. That is stated, not hidden.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { Inventory } from "../../engine/core/state/inventory.ts";
import * as S from "../../engine/systems/scene-completion.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native");
const RESIDENT = new Uint8Array(readFileSync(join(dir, "screens/resident.bin")));
const SET_FLAG = 0x800161d8;
const BASE = 0x80048d34;      // the collection object's first byte
const A_OFF = 0x7c;           // first per-id array  (copies in the bag)
const B_OFF = 0x20f;          // second per-id array (copies in a party member's slots)

/** A runtime with the resident EXE loaded and nothing else in the way. */
function kit() {
  const overlay = new Uint8Array(16);
  const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
  const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
  return new NativeStageRuntime(overlay, entry, host(), undefined, undefined, undefined,
    { image: RESIDENT, base: 0x80010000 });
}

/** Run the disc's own routine and read both collection bytes back out. */
function original(rt, index, value, a0, b0) {
  rt.mem.write8(BASE + A_OFF + index, a0 & 0xff);
  rt.mem.write8(BASE + B_OFF + index, b0 & 0xff);
  rt.cpu.call(SET_FLAG, [index, value], 10000);
  return [rt.mem.read8(BASE + A_OFF + index), rt.mem.read8(BASE + B_OFF + index)];
}

/** Run the port over the walker's own store and read its count back out. */
function port(index, value, a0) {
  const inv = new Inventory();
  inv.load([[index, a0]]);
  S.collectionWrite(index, value, inv);
  return [inv.has(index, 1) ? readCount(inv, index) : 0, 0];
}

function readCount(inv, id) {
  for (const [k, v] of inv.toJSON()) if (k === id) return v;
  return 0;
}

test("the collection arm covers exactly the disc's banks 0x80..0x8e", () => {
  // The dispatcher's own test: `addiu $v0,$s3,-0x80` then `sltiu $v0,0xf` (the short form,
  // so it compares the DIFFERENCE). 0x90/0x92/0x94 are other banks entirely.
  const covered = [];
  for (let b = 0; b <= 0xfe; b += 2) if (S.isCollectionBank(b)) covered.push(b);
  assert.deepEqual(covered, [0x80, 0x82, 0x84, 0x86, 0x88, 0x8a, 0x8c, 0x8e]);
});

test("every shipped (id, value) pair writes the same byte as the original", () => {
  const raw = JSON.parse(readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/data/scene/scene_completion.json"), "utf8"));
  const pairs = [];
  for (const v of Object.values(raw.stages))
    for (const row of Object.values(v.events))
      for (const w of row.writes ?? [])
        if (w.op === "set_flag" && S.isCollectionBank((w.flag >> 8) & 0xfe)) pairs.push([w.flag, w.value]);
  assert.ok(pairs.length >= 40, `expected the shipped scene collection writes, got ${pairs.length}`);

  // Every starting value the game can actually hold: the routine's own set caps the byte at
  // 99 (`slti $v0,0x64` / `li $v0,0x63`, .L0x80016218–.L0x80016228), so 0..99 is closed under
  // both arms. `atOrAboveTheCap` below covers what the disc does past it.
  const rt = kit();
  const diffs = [];
  let runs = 0;
  for (const [flag, value] of pairs) {
    const index = flag & 0x1ff;                    // `andi $s0,$a0,0x1ff` — nine bits
    for (let start = 0; start <= 99; start++) {
      runs++;
      const [origA, origB] = original(rt, index, value, start, 0);
      const [portA, portB] = port(index, value, start);
      if (origA !== portA || origB !== portB)
        diffs.push(`0x${flag.toString(16)} value=${value} start=${start}: original A=${origA} B=${origB}` +
          ` port A=${portA} B=${portB}`);
    }
  }
  assert.deepEqual(diffs.slice(0, 8), [], `${diffs.length} of ${runs} runs differ`);
  assert.ok(runs > 4000, `too few runs: ${runs}`);
});

test("a clear takes one copy and floors at 0, like the original", () => {
  // No shipped scene write clears a collection bank, so this is the routine's own -1 arm
  // (value == 0) run from B = 0, which is the state after a give on a bag with no equipped
  // copy: the disc writes A-1 and then finds B == 0 and returns.
  const rt = kit();
  const diffs = [];
  for (const index of [4, 6, 17, 43, 116, 207, 242, 396]) {
    for (let start = 0; start <= 99; start++) {
      const [origA] = original(rt, index, 0, start, 0);
      const [portA] = port(index, 0, start);
      if (origA !== portA) diffs.push(`item ${index} from ${start}: original A=${origA} port A=${portA}`);
    }
  }
  assert.deepEqual(diffs, [], `${diffs.length} differ`);
});

test("a set at the cap stays at 99, and the store's own clamp is what holds it", () => {
  const rt = kit();
  const [origA] = original(rt, 9, 1, 99, 0);
  assert.equal(origA, 99, "the original re-clamps silently at 99");
  const inv = new Inventory();
  inv.load([[9, 99]]);
  S.collectionWrite(9, 1, inv);
  assert.equal(readCount(inv, 9), 99, "the port holds the same cap");
  inv.load([[9, 98]]);
  S.collectionWrite(9, 1, inv);
  assert.equal(readCount(inv, 9), 99, "98 + 1 lands on 99");
});

test("past the cap the disc's byte wraps; the walker's store floors instead", () => {
  // Named divergence, in a state the game cannot reach: this same routine caps the byte at
  // 99, so no write can lift it past there, and a save edited by hand is not a game state.
  // Read out of the disc so the numbers are on the record rather than assumed.
  //   set  : `lbu`+1, `sb`, then sign-extend and `slti 0x64` — so 100..127 clamp to 99 while
  //          a byte at 128 or above is negative and therefore KEPT (127->128, 129->130,
  //          254->255) and 255+1 wraps to 0.
  //   clear: `lb`, `beqz`, `sb` A-1, then sign-extend and `bgez` — so a result that lands
  //          above 127 is a NEGATIVE byte and is floored to 0 (129 -> 0, 255 -> 0).
  const rt = kit();
  assert.equal(original(rt, 9, 1, 100, 0)[0], 99, "disc: 100 + 1 clamps to 99");
  assert.equal(original(rt, 9, 1, 127, 0)[0], 128, "disc: 127 + 1 is a negative byte, kept as 128");
  assert.equal(original(rt, 9, 1, 129, 0)[0], 130, "disc: above 127 the byte is kept, not clamped");
  assert.equal(original(rt, 9, 1, 255, 0)[0], 0, "disc: 255 + 1 wraps to 0");
  assert.equal(original(rt, 9, 0, 129, 0)[0], 0, "disc: 129 - 1 is a negative byte, floored to 0");
  assert.equal(original(rt, 9, 0, 255, 0)[0], 0, "disc: 255 - 1 is a negative byte, floored to 0");

  const inv = new Inventory();
  inv.load([[9, 129]]);
  S.collectionWrite(9, 0, inv);
  assert.equal(readCount(inv, 9), 128, "port: the store floors at 0 instead — unreachable state");
});

// ── The game: a finished scene puts its item in the bag, once ────────────────────────
// s420's closing scene (event 71, shape "outside all five": two collection writes and THEN
// the story step, pro/wstag420.s .L0x0000013c) writes set_flag(0x8028,1) and set_flag(0x8009,1)
// — Silver ID (40) and Seiryu Badge (9). Driven through the real engine and the real bridge,
// the way a player reaches it: the stage opens at story step 4, the beat's closing scene
// plays, and its completion routine runs.
import { GameEngine } from "../../engine/index.ts";
import { createEngineBridge } from "../../web/engine-bridge.js";
import { carriesFolderBag } from "../../engine/dw3/item-store.ts";

const content = JSON.parse(readFileSync("web/assets/engine-content.json", "utf8"));

function driveS420() {
  const engine = new GameEngine(content, { driven: true });
  engine.state.vars.set("$story.ordinal", 4);
  for (const f of [16402, 29697]) { try { engine.state.flags.set(f, false); } catch { /* virtual */ } }
  const bridge = createEngineBridge({
    engine,
    playCutscene: (_fk, onDone) => onDone(null),
    startBattle: (_s, onWin) => onWin(),
    doHandoff: () => {},
  });
  bridge.onStageEnter("s420");
  for (const a of [60]) { if (!bridge.isBusy()) bridge.onTalk(a); }
  return engine;
}

const countOf = (engine, id) => {
  for (const [k, v] of engine.state.inventory.toJSON()) if (k === id) return v;
  return 0;
};

test("a finished scene adds its item to the bag, once, and the possession gate opens", () => {
  const engine = driveS420();
  // One copy each: the disc's set_flag(0x80NN,1) adds ONE to that id's count. (Two grants
  // used to land here — item_grants.json and native_item_grants.json both mined the same
  // scene write and each became a GiveItem row — so the player held two of every one of
  // 27 story items.)
  assert.equal(countOf(engine, 9), 1, "Seiryu Badge: one copy");
  assert.equal(countOf(engine, 40), 1, "Silver ID: one copy");
  // And get_flag(0x80NN) — the possession predicate over the same store — reads it back.
  const ctx = engine.state.evalContext();
  assert.equal(ctx.flags.get(0x8009, 1), true, "get_flag(0x8009) is set by the badge");
  assert.equal(ctx.flags.get(0x8028, 1), true, "get_flag(0x8028) is set by the Silver ID");
  assert.equal(ctx.flags.get(0x8009, 0), false, "and is not set when asked for the opposite");
  // A third grant of the same id counts up, which the disc does and a set/clear mirror did not.
  S.applySetFlag(0x8009, 1, { setFlag() {} }, {
    stored: () => false,
    collection: (i, v) => { S.collectionWrite(i, v, engine.state.inventory); return true; },
  });
  assert.equal(countOf(engine, 9), 2, "a second grant of the same id stacks");
});

test("the completion routine's own write list carries the collection writes", () => {
  // The engine runs the routine's data, not a converter row: s420/71 holds both writes in
  // the order the disc makes them, and neither is a stored bank.
  const raw = JSON.parse(readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/data/scene/scene_completion.json"), "utf8"));
  const row = raw.stages.s420.events["71"];
  const writes = row.writes.map((w) => [w.op, w.flag, w.value]);
  assert.deepEqual(writes, [
    ["set_flag", 0x8028, 1],
    ["set_flag", 0x8009, 1],
    ["set_ordinal", undefined, 5],
  ]);
  // …and the converted content no longer carries a second GiveItem for the same fact.
  const stage = content.stages.find((s) => s.mapId === "s420");
  const gives = stage.scripts.filter((s) => s.program.some((i) => i.op === "GiveItem"));
  assert.deepEqual(gives.map((s) => s.id), [], "no converted GiveItem row for a completion grant");
});

// ── The Folder Bag scene is what opens the CARD FOLDERS row ─────────────────────────
// The resident pause list's sixth row is gated on the byte D0x80048f42
// (exe/fns.s:3083-3086 `lb`/`beqz`), which is save+0x20E = carried[402] — the LAST
// carried byte of the per-id array (`base + 0x7C + id`). Item 402 is the key item
// "Folder Bag". Its grant is the s270 Yellow Cruiser cutscene's completion routine:
// set_flag(0x8192,1) (pro/wstag270.s .L0x00000cf4, event 1415, the Divermon Folder Bag
// scene). Driven through the real engine: the row's own predicate is false before the
// scene completes and true after, with no folders involved either way.
test("the Folder Bag scene's grant is what opens the CARD FOLDERS row", () => {
  const engine = new GameEngine(content, { driven: true });
  engine.loadStage("s270");
  // The predicate's own view of the store, the shape web/game.js passes
  // (state.inventory is [{id, qty}] there; the engine's Inventory serialises to it).
  const view = () => ({ inventory: engine.state.inventory.toJSON().map(([id, qty]) => ({ id, qty })) });
  assert.equal(carriesFolderBag(view()), false, "no Folder Bag before the scene");
  engine.completeEvent(1415);
  assert.equal(countOf(engine, 402), 1, "the scene's set_flag(0x8192,1) puts one Folder Bag in the bag");
  assert.equal(carriesFolderBag(view()), true, "and the row's own predicate reads that byte");
  // The original reads exactly that one carried byte: lose the copy and the row closes.
  S.collectionWrite(402, 0, engine.state.inventory);
  assert.equal(carriesFolderBag(view()), false, "the gate is the carried count itself");
});