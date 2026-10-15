// The item-use effect — closing the battle-FX audit's named gap (2026-10-14).
//
// The audit left this: the item machine FIGHTSTG_F0x8008d3b4's default arm (the clip-10
// item-use motion) scans the 6-byte table at fightstg 0x800a336c {item, effect, sound} and
// writes the matching record's effect to actor+0x6c and sound to actor+0x70
// (.L0x8008d8fc-.L0x8008d934 scan, apply arm .L0x8008d8c0-.L0x8008d8dc; the walker's item path
// passed no current effect, so clip 10's own op3 9999 spawn at (0,0,32767) was skipped).
//
// This file pins three things:
//   1. the census — the extracted asset re-derived from BOTH the assembly source (~/ddw3, when
//      mounted) and the raw overlay bytes (web/assets/native/screens/pro_fightstg.bin, always);
//   2. the fail-before/pass-after oracle at the action-VM level — clip 10 with no current
//      effect spawns NOTHING (what shipped on the parent tip), with the item's record effect it
//      spawns exactly that effect (item 43 -> effect 33);
//   3. the wiring — battle.js's item branch reaches the renderer's item entry, and that entry
//      feeds setAnimByItem/contactSoundType from the table record.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ActorAnimator } from "../web/fight/actor-animator.js";
import {
  ITEM_USE_CLIP, setItemUseEffects, itemUseEffect,
} from "../web/fight/fight-tables.js";

const ROOT = new URL("..", import.meta.url).pathname;
const JSON_URL = new URL("../web/assets/data/item_use_effects.json", import.meta.url);
const BIN = join(ROOT, "web/assets/native/screens/pro_fightstg.bin");
const ASM = join(homedir(), "ddw3/asm/dw2003/pro/fightstg.s");
const RENA = JSON.parse(readFileSync(
  new URL("../web/assets/battle/models/m373rena/anim.json", import.meta.url), "utf8"));

// fightstg's RAM base (pro/fightstg.s:3 `.section "section_FIGHTSTG_00.0x80082cb0"`), so the
// table at RAM 0x800a336c is file offset 0x206bc of the raw overlay.
const FIGHTSTG_BASE = 0x80082cb0;
const TABLE_BASE = 0x800a336c;

const table = JSON.parse(readFileSync(JSON_URL, "utf8"));

/** Decode 6-byte {item, effect, sound} records until the item == -1 terminator. */
function decodeRecords(buf, offset) {
  const recs = [];
  for (let i = offset; ; i += 6) {
    const item = buf.readUInt16LE(i);
    if (item === 0xffff) return { records: recs, end: i };
    recs.push({ item, effect: buf.readUInt16LE(i + 2), sound: buf.readUInt16LE(i + 4) });
  }
}

test("the census re-derives from the raw overlay bytes, byte for byte", () => {
  assert.equal(table.table_base, "0x800a336c");
  assert.equal(table.stride, 6);
  const bin = readFileSync(BIN);
  const { records, end } = decodeRecords(bin, TABLE_BASE - FIGHTSTG_BASE);
  assert.deepEqual(table.records, records,
    "item_use_effects.json must match pro_fightstg.bin at file 0x206bc");
  assert.equal(end, TABLE_BASE - FIGHTSTG_BASE + 6 * 15,
    "15 records, terminator on the 16th record boundary");

  // The named anchors of the census (the audit's own list, confirmed against the bytes).
  assert.deepEqual(records.slice(0, 4),
    [{ item: 43, effect: 33, sound: 31 }, { item: 44, effect: 33, sound: 31 },
     { item: 45, effect: 33, sound: 31 }, { item: 46, effect: 33, sound: 31 }]);
  assert.deepEqual(records.find((r) => r.item === 66), { item: 66, effect: 34, sound: 31 });
  assert.deepEqual(records.find((r) => r.item === 75), { item: 75, effect: 46, sound: 30 });
  assert.deepEqual(records.find((r) => r.item === 76), { item: 76, effect: 46, sound: 30 });
  // The item ids are exactly the audit's set — 43-46 and 66-76, nothing else.
  assert.deepEqual(records.map((r) => r.item),
    [43, 44, 45, 46, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76]);
});

test("the census re-derives from the assembly source", { skip: existsSync(ASM) ? false
  : `${ASM} is not present; the raw-overlay check above still ran` }, () => {
  // The disassembly's own .word labels: RAM address -> word.
  const words = new Map();
  for (const line of readFileSync(ASM, "utf8").split("\n")) {
    const m = /^\.L0x(800[0-9a-f]{5}):\s+\.word\s+(0x[0-9a-fA-F]+|\S+)/.exec(line);
    if (m && m[2].startsWith("0x")) words.set(parseInt(m[1], 16), parseInt(m[2], 16));
  }
  const u16 = (addr) => {
    const w = words.get((addr & ~3) >>> 0);   // >>> 0: 0x800a336c & ~3 is negative as int32
    assert.notEqual(w, undefined, `no .word at RAM 0x${addr.toString(16)}`);
    return (addr & 2) === 0 ? (w & 0xffff) : (w >>> 16);
  };
  const recs = [];
  for (let addr = TABLE_BASE; u16(addr) !== 0xffff; addr += 6) {
    recs.push({ item: u16(addr), effect: u16(addr + 2), sound: u16(addr + 4) });
  }
  assert.deepEqual(table.records, recs,
    "item_use_effects.json must match the fightstg.s words at .L0x800a336c");
});

test("the VM oracle: clip 10 spawns the record's effect only when one is set (fail-before/pass-after)", () => {
  // PASS-AFTER: the item entry resolves the used item's record and passes its effect as the
  // actor's current effect. Clip 10's op3 9999 spawn must fire with exactly effect 33 at
  // (0,0,32767) — the screen-space spawn the audit named.
  setItemUseEffects(table);
  assert.deepEqual(itemUseEffect(43), { effect: 33, sound: 31 });
  assert.equal(itemUseEffect(47), null, "items outside the table have no record");
  assert.equal(itemUseEffect(90), null, "the 77-90 throw band is not in this table");

  const after = new ActorAnimator(RENA);
  const spawned = [];
  assert.equal(after.setAnimByItem(43, { onEffect: (rec) => spawned.push(rec) }), true);
  assert.equal(after._clip, ITEM_USE_CLIP, "the item entry plays clip 10");
  assert.equal(after.vm.currentEffect, 33, "actor+0x6c carries the record's effect");
  for (let i = 0; i < 900 && after.vm; i++) after.tick(1);
  assert.deepEqual(spawned.filter((r) => r.z === 32767),
    [{ type: 33, x: 0, y: 0, z: 32767 }],
    "clip 10's op3 9999 spawn fires with the item's mapped effect");

  // FAIL-BEFORE (the shipped behaviour this closes): the same clip with NO current effect —
  // what playPlayerActionClip(10) produced before this change — spawns nothing.
  const before = new ActorAnimator(RENA);
  const beforeSpawns = [];
  assert.equal(before.setAction(ITEM_USE_CLIP, { onEffect: (rec) => beforeSpawns.push(rec) }), true);
  assert.equal(before.vm.currentEffect, null);
  for (let i = 0; i < 900 && before.vm; i++) before.tick(1);
  assert.deepEqual(beforeSpawns, [],
    "without a current effect the 9999 sentinel is a faithful skip (parent-tip behaviour)");

  // A different item resolves a different effect through the same entry (66 -> 34).
  const other = new ActorAnimator(RENA);
  const otherSpawns = [];
  other.setAnimByItem(66, { onEffect: (rec) => otherSpawns.push(rec) });
  assert.equal(other.vm.currentEffect, 34);
  for (let i = 0; i < 900 && other.vm; i++) other.tick(1);
  assert.deepEqual(otherSpawns.filter((r) => r.z === 32767),
    [{ type: 34, x: 0, y: 0, z: 32767 }]);

  setItemUseEffects(null);   // leave no global behind for other test files
});

test("the wiring: the item branch reaches the item entry, and the entry feeds the actor's fields", () => {
  const battleJs = readFileSync(join(ROOT, "web/battle.js"), "utf8");
  const battle3dJs = readFileSync(join(ROOT, "web/battle3d.js"), "utf8");

  const branch = battleJs.slice(battleJs.indexOf('action.type === "item"'));
  assert.match(branch, /renderer3d\?\.playPlayerItemUse\(item\.id\)/,
    "the item branch starts the item machine's entry with the used item's id");

  // The renderer loads the extracted table and the item entry consumes it.
  assert.match(battle3dJs, /assets\/data\/item_use_effects\.json[\s\S]*setItemUseEffects/,
    "battle3d loads item_use_effects.json into fight-tables");
  const entry = battle3dJs.slice(battle3dJs.indexOf("function playPlayerItemUse"));
  assert.match(entry, /itemUseEffect\(itemId\)/, "the entry resolves the used item's record");
  assert.match(entry, /setAnimByItem\(itemId/, "and plays the item clip through setAnimByItem");
  assert.match(entry, /contactSoundType\.player = rec \? rec\.sound : null/,
    "actor+0x70's value (the record sound) reaches the op10 contact-sound resolution");
});
