// The item machine's THROW band — items 77-90 (2026-10-14).
//
// The item-use fix wired FIGHTSTG_F0x8008d3b4's DEFAULT arm (clip 10 + the 0x800a336c
// {item, effect, sound} table). It named this gap: ids 77-90 take the machine's TYPED arms via
// the 14-word jump table at 0x80082ee4 (pro/fightg.s .L0x8008d408-.L0x8008d430, table at
// fightstg.s:131-144). Each arm allocates a fresh action actor (FIGHTSTG_F0x8008c910) and
// writes its clip +0x54, motion +0x68, effect +0x6c and sound +0x70:
//
//   77-83  clip 15, motion 0x22+3*(id-77), effect 2, sound 0x39   (.L0x8008d434)
//   84     clip 15, motion 0x22+3*(rand_u16()%7), effect 2, 0x39  (.L0x8008d44c)
//   85     clip 14, motion -1, effect 0x1c, sound 0x27            (.L0x8008d714)
//   86     clip 17, motion -1, effect 0x15, sound 0x1b            (.L0x8008d4dc)
//   87     clip 17, motion -1, effect 0x27, sound 0x31            (.L0x8008d510)
//   88     clip 17, motion -1, effect/sound by ctx+0x7c           (.L0x8008d550)
//   89     clip 17, motion -1, effect 0x29, sound 0x31            (.L0x8008d52c)
//   90     clip 14, motion/effect/sound = resident 0x80043579/7a/7b (.L0x8008d7e8)
//
// This file pins four things:
//   1. the census — the extracted asset re-derived from the assembly source (~/ddw3, when
//      mounted) AND from the raw overlay bytes (web/assets/native/screens/pro_fightstg.bin,
//      always), site by site;
//   2. item 90's three bytes, re-read from the resident PS-X EXE image;
//   3. the fail-before/pass-after oracle at the action-VM level — an item played through the
//      old clip-10 entry spawns nothing; through the typed entry it plays the arm's clip and
//      spawns exactly the arm's effect type;
//   4. the wiring — battle.js routes 77-90 to the renderer's throw entry, and that entry feeds
//      setAnimByThrowItem/contactSoundType from the record.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ActorAnimator, clipTableSeq } from "../web/fight/actor-animator.js";
import {
  THROW_ITEM_BAND, setThrowItemEffects, throwItemEffect, isThrowItem,
} from "../web/fight/fight-tables.js";

const ROOT = new URL("..", import.meta.url).pathname;
const JSON_URL = new URL("../web/assets/data/throw_item_effects.json", import.meta.url);
const BIN = join(ROOT, "web/assets/native/screens/pro_fightstg.bin");
const RESIDENT = join(ROOT, "web/assets/native/screens/resident.bin");
const ASM = join(homedir(), "ddw3/asm/dw2003/pro/fightstg.s");
const RENA = JSON.parse(readFileSync(
  new URL("../web/assets/battle/models/m373rena/anim.json", import.meta.url), "utf8"));

// pro/fightstg.s:3 `.section "section_FIGHTSTG_00.0x80082cb0"`; the resident image loads at
// 0x80010000 (tools/extract_jogress_scripts.py RESIDENT_BASE).
const FIGHTSTG_BASE = 0x80082cb0;
const RESIDENT_BASE = 0x80010000;

const table = JSON.parse(readFileSync(JSON_URL, "utf8"));

// ── tiny MIPS encoders, so every expected word is computed, not transcribed ───────────────
const encLI    = (imm) => (0x24020000 | (imm & 0xffff)) >>> 0;              // addiu $v0, $zero, imm
const encADDIU = (rt, rs, imm) => (0x24000000 | (rs << 21) | (rt << 16) | (imm & 0xffff)) >>> 0;
const encSW    = (rs, off, rt = V0) => (0xac000000 | (rs << 21) | (rt << 16) | (off & 0xffff)) >>> 0;
const encLBU   = (rs, off) => (0x90000000 | (rs << 21) | (2 << 16) | (off & 0xffff)) >>> 0;
const encLW    = (rt, rs, off) => (0x8c000000 | (rs << 21) | (rt << 16) | (off & 0xffff)) >>> 0;
const encLUI   = (rt, imm) => (0x3c000000 | (rt << 16) | (imm & 0xffff)) >>> 0;
const encORI   = (rt, imm, rs = 0) => (0x34000000 | (rs << 21) | (rt << 16) | (imm & 0xffff)) >>> 0;
const encSLL   = (rd, rt, sh) => ((rt << 16) | (rd << 11) | (sh << 6)) >>> 0;
const encADDU  = (rd, rs, rt) => ((rs << 21) | (rt << 16) | (rd << 11) | 0x21) >>> 0;
const encBNE   = (rs, rt, off) => (0x14000000 | (rs << 21) | (rt << 16) | (off & 0xffff)) >>> 0;

const V0 = 2, V1 = 3, A0 = 4, A1 = 5, S2 = 18;
const binWord = (buf, addr) => buf.readUInt32LE(addr - FIGHTSTG_BASE);

// The jump table: id - 77 -> arm target (fightstg.s:131-144).
const JUMP_TARGETS = [
  0x8008d434, 0x8008d434, 0x8008d434, 0x8008d434, 0x8008d434, 0x8008d434, 0x8008d434,
  0x8008d44c, 0x8008d714, 0x8008d4dc, 0x8008d510, 0x8008d550, 0x8008d52c, 0x8008d7e8,
];

// Every instruction site each record depends on, as [addr, expected word, note].
const SITES = [
  // arm 77-83
  [0x8008d438, encLI(0xf), "77-83 clip 15"], [0x8008d43c, encSW(V1, 0x54), "77-83 sw clip"],
  [0x8008d448, encADDIU(V0, V0, -0x4d), "77-83 id - 77"],
  [0x8008d4ac, encSLL(V1, V0, 1), "77-83 x3"], [0x8008d4b0, encADDU(V1, V1, V0), "77-83 x3"],
  [0x8008d4b8, encADDIU(V1, V1, 0x22), "77-83 motion base 0x22"],
  [0x8008d4bc, encSW(V0, 0x68, V1), "77-83 sw motion"],   // sw $v1, 0x68($v0)
  [0x8008d4c4, encLI(2), "77-83 effect 2"], [0x8008d4c8, encSW(V1, 0x6c), "77-83 sw effect"],
  [0x8008d4d0, encLI(0x39), "77-83 sound 0x39"], [0x8008d4d8, encSW(V1, 0x70), "77-83 sw sound"],
  // arm 84
  [0x8008d44c, encLUI(V0, 0x8005), "84 rand fn ptr"], [0x8008d450, encLW(V0, V0, -0x23f4), "84 rand fn ptr"],
  [0x8008d460, encLUI(V1, 0x9249), "84 /7 magic"], [0x8008d464, encORI(V1, 0x2493, V1), "84 /7 magic"],
  [0x8008d48c, encADDIU(V0, V0, 2), "84 rand%7 + 2"], [0x8008d490, encSW(S2, 0x74), "84 sw ctx+0x74"],
  [0x8008d4a8, encADDIU(V0, V0, -2), "84 - 2"],
  // arm 85
  [0x8008d718, encLI(0xe), "85 clip 14"], [0x8008d71c, encSW(V1, 0x54), "85 sw clip"],
  [0x8008d724, encLI(-1), "85 motion -1"], [0x8008d728, encSW(V1, 0x68), "85 sw motion"],
  [0x8008d730, encLI(0x1c), "85 effect 0x1c"], [0x8008d734, encSW(V1, 0x6c), "85 sw effect"],
  [0x8008d73c, encLI(0x27), "85 sound 0x27"], [0x8008d740, encSW(V1, 0x70), "85 sw sound"],
  // arm 86
  [0x8008d4e0, encLI(0x11), "86 clip 17"], [0x8008d4e4, encSW(V1, 0x54), "86 sw clip"],
  [0x8008d4ec, encLI(-1), "86 motion -1"], [0x8008d4f0, encSW(V1, 0x68), "86 sw motion"],
  [0x8008d4f8, encLI(0x15), "86 effect 0x15"], [0x8008d4fc, encSW(V1, 0x6c), "86 sw effect"],
  [0x8008d504, encLI(0x1b), "86 sound 0x1b"], [0x8008d50c, encSW(V1, 0x70), "86 sw sound"],
  // arm 87
  [0x8008d514, encLI(0x11), "87 clip 17"], [0x8008d518, encSW(V1, 0x54), "87 sw clip"],
  [0x8008d520, encLI(-1), "87 motion -1"], [0x8008d528, encSW(V1, 0x68), "87 sw motion"],
  [0x8008d6e0, encLI(0x27), "87 effect 0x27"], [0x8008d6e4, encSW(V1, 0x6c), "87 sw effect"],
  [0x8008d6ec, encLI(0x31), "87 sound 0x31"], [0x8008d6f4, encSW(V1, 0x70), "87 sw sound"],
  // arm 88 (producer entry + the shared tail's flag dispatch)
  [0x8008d550, encADDIU(A0, 0, 0x10), "88 producer entry"], [0x8008d558, encADDIU(V1, V1, 0x4460), "88 producer table"],
  [0x8008d6a4, encLI(0x11), "88 clip 17"], [0x8008d6a8, encSW(V1, 0x54), "88 sw clip"],
  [0x8008d6b0, encLI(-1), "88 motion -1"], [0x8008d6b4, encSW(V1, 0x68), "88 sw motion"],
  [0x8008d6b8, encLW(V1, S2, 0x7c), "88 flag read"], [0x8008d6bc, encLI(1), "88 flag 1"],
  [0x8008d6c0, encBNE(V1, V0, 4), "88 bne flag1"], [0x8008d6d0, encLI(0x25), "88 flag1 effect 0x25"],
  [0x8008d6d4, encBNE(V1, V0, 8), "88 bne flag2"], [0x8008d6e0, encLI(0x27), "88 flag2 effect 0x27"],
  [0x8008d6ec, encLI(0x31), "88 flag sound 0x31"], [0x8008d6f4, encSW(V1, 0x70), "88 sw sound"],
  [0x8008d6d8, encLI(0x2e), "88 else effect 0x2e"], [0x8008d700, encSW(V1, 0x6c), "88 else sw effect"],
  [0x8008d708, encLI(0x1e), "88 else sound 0x1e"], [0x8008d710, encSW(V1, 0x70), "88 else sw sound"],
  // arm 89
  [0x8008d530, encLI(0x11), "89 clip 17"], [0x8008d534, encSW(V1, 0x54), "89 sw clip"],
  [0x8008d53c, encLI(-1), "89 motion -1"], [0x8008d540, encSW(V1, 0x68), "89 sw motion"],
  [0x8008d54c, encLI(0x29), "89 effect 0x29"], [0x8008d6e4, encSW(V1, 0x6c), "89 sw effect"],
  [0x8008d6ec, encLI(0x31), "89 sound 0x31"], [0x8008d6f4, encSW(V1, 0x70), "89 sw sound"],
  // arm 90
  [0x8008d7ec, encLI(0xe), "90 clip 14"], [0x8008d7f0, encSW(V1, 0x54), "90 sw clip"],
  [0x8008d7f4, encLUI(V1, 0x8004), "90 resident base"], [0x8008d7f8, encADDIU(V1, V1, 0x356c), "90 + 0x356c"],
  [0x8008d800, encLBU(V1, 0xd), "90 motion byte"], [0x8008d808, encSW(A0, 0x68), "90 sw motion"],
  [0x8008d810, encLBU(V1, 0xe), "90 effect byte"], [0x8008d818, encSW(A0, 0x6c), "90 sw effect"],
  [0x8008d820, encLBU(V1, 0xf), "90 sound byte"], [0x8008d828, encSW(A1, 0x70), "90 sw sound"],
  // item 85's state-1 fallback
  [0x8008da18, encLW(V1, S2, 0x70), "state1 id"], [0x8008da1c, encLI(0x55), "state1 item 85"],
  [0x8008da3c, encLBU(V0, 0x2b5f), "state1 gate byte"],
  [0x8008da60, encLI(0xa), "state1 clip 10"], [0x8008da6c, encLI(0x21), "state1 effect 0x21"],
  [0x8008da78, encLI(0x1f), "state1 sound 0x1f"],
];

test("the census re-derives from the raw overlay bytes, site by site", () => {
  const bin = readFileSync(BIN);
  for (let i = 0; i < JUMP_TARGETS.length; i++) {
    assert.equal(binWord(bin, 0x80082ee4 + 4 * i), JUMP_TARGETS[i],
      `jump table word ${i} (item ${77 + i})`);
  }
  for (const [addr, word, note] of SITES) {
    assert.equal(binWord(bin, addr), word, `0x${addr.toString(16)}: ${note}`);
  }
  // The /7 magic is exactly the signed-division constant for 7: mult by 0x92492493 (the
  // SIGNED value -1840700269), hi + n, >>2, minus the sign — then n - 7q is the remainder.
  const M = 0x92492493 - 2 ** 32;
  for (const n of [0, 1, 8, 34, 40, 4095, 65535, 987654321]) {
    const P = n * M;
    const hi = Math.floor(P / 2 ** 32);                  // mfhi (arithmetic high word)
    const q = ((((hi + n) | 0) >> 2) - (n >> 31));
    assert.equal(q, Math.floor(n / 7), `0x92492493 divides by 7 (n=${n})`);
    assert.equal(n - 7 * q, n % 7, `and the tail is n mod 7 (n=${n})`);
  }
});

test("the census re-derives from the assembly source", { skip: existsSync(ASM) ? false
  : `${ASM} is not present; the raw-overlay check above still ran` }, () => {
  const insn = new Map();
  for (const line of readFileSync(ASM, "utf8").split("\n")) {
    const m = /^\.L0x(800[0-9a-f]{5}):\s+(\S+)\s*(.*)$/.exec(line);
    if (m) insn.set(parseInt(m[1], 16), `${m[2]} ${m[3].split("#")[0].trim()}`.trim());
  }
  const text = (addr) => insn.get(addr) ?? null;
  // The jump table's own .word lines.
  for (let i = 0; i < JUMP_TARGETS.length; i++) {
    assert.equal(text(0x80082ee4 + 4 * i), `.word 0x${JUMP_TARGETS[i].toString(16)}`,
      `table word ${i}`);
  }
  // The arm anchors the extractor walks, as the assembly spells them.
  const EXPECT = [
    [0x8008d438, "li $v0, 0xf"], [0x8008d43c, "sw $v0, 0x54($v1)"],
    [0x8008d448, "addiu $v0, -0x4d"],
    [0x8008d4ac, "sll $v1, $v0, 0x1"], [0x8008d4b0, "addu $v1, $v0"],
    [0x8008d4b8, "addiu $v1, 0x22"], [0x8008d4bc, "sw $v1, 0x68($v0)"],
    [0x8008d4c4, "li $v0, 0x2"], [0x8008d4c8, "sw $v0, 0x6c($v1)"],
    [0x8008d4d0, "li $v0, 0x39"], [0x8008d4d8, "sw $v0, 0x70($v1)"],
    [0x8008d44c, "lui $v0, 0x8005"], [0x8008d450, "lw $v0, -0x23f4($v0)"],
    [0x8008d458, "jalr $v0"], [0x8008d460, "lui $v1, 0x9249"], [0x8008d464, "ori $v1, 0x2493"],
    [0x8008d48c, "addiu $v0, 0x2"], [0x8008d490, "sw $v0, 0x74($s2)"], [0x8008d4a8, "addiu $v0, -0x2"],
    [0x8008d718, "li $v0, 0xe"], [0x8008d724, "li $v0, -0x1"], [0x8008d730, "li $v0, 0x1c"],
    [0x8008d73c, "li $v0, 0x27"],
    [0x8008d4e0, "li $v0, 0x11"], [0x8008d4f8, "li $v0, 0x15"], [0x8008d504, "li $v0, 0x1b"],
    [0x8008d514, "li $v0, 0x11"], [0x8008d6e0, "li $v0, 0x27"], [0x8008d6ec, "li $v0, 0x31"],
    [0x8008d550, "li $a0, 0x10"], [0x8008d6b8, "lw $v1, 0x7c($s2)"], [0x8008d6c0, "bne $v1, $v0, .L0x8008d6d4"],
    [0x8008d6d4, "bne $v1, $v0, .L0x8008d6f8"], [0x8008d6d0, "li $v0, 0x25"],
    [0x8008d6e0, "li $v0, 0x27"], [0x8008d6d8, "li $v0, 0x2e"], [0x8008d708, "li $v0, 0x1e"],
    [0x8008d530, "li $v0, 0x11"], [0x8008d54c, "li $v0, 0x29"],
    [0x8008d7ec, "li $v0, 0xe"], [0x8008d7f4, "lui $v1, 0x8004"], [0x8008d7f8, "addiu $v1, 0x356c"],
    [0x8008d800, "lbu $v0, 0xd($v1)"], [0x8008d810, "lbu $v0, 0xe($v1)"], [0x8008d820, "lbu $v0, 0xf($v1)"],
    [0x8008d808, "sw $v0, 0x68($a0)"], [0x8008d818, "sw $v0, 0x6c($a0)"], [0x8008d828, "sw $v0, 0x70($a1)"],
    [0x8008da18, "lw $v1, 0x70($s2)"], [0x8008da1c, "li $v0, 0x55"], [0x8008da3c, "lbu $v0, 0x2b5f($v0)"],
    [0x8008da60, "li $v0, 0xa"], [0x8008da6c, "li $v0, 0x21"], [0x8008da78, "li $v0, 0x1f"],
  ];
  for (const [addr, want] of EXPECT) {
    assert.equal(text(addr), want, `fightstg.s 0x${addr.toString(16)}`);
  }
  // rand_u16's address, the function pointer arm 84 loads (fns.s .section "fns3_00.0x8001933c").
  assert.equal(0x8004dc0c, 0x80050000 - 0x23f4, "arm 84's lui/lw pair reads 0x8004dc0c");
});

test("the census: item 90's three bytes come from the resident image", () => {
  const resident = readFileSync(RESIDENT);
  const byte = (addr) => resident[addr - RESIDENT_BASE];
  assert.equal(byte(0x80043579), 33, "motion byte 0x21");
  assert.equal(byte(0x8004357a), 4, "effect byte 0x04");
  assert.equal(byte(0x8004357b), 25, "sound byte 0x19");
  const rec = table.records.find((r) => r.item === 90);
  assert.deepEqual({ clip: rec.clip, motion: rec.motion, effect: rec.effect, sound: rec.sound },
    { clip: 14, motion: 33, effect: 4, sound: 25 });
});

test("the extracted table is the decoded census, record for record", () => {
  assert.deepEqual(table.band, [77, 90]);
  assert.equal(table.jump_table, "0x80082ee4");
  assert.deepEqual(table.records.map((r) => r.item),
    [77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90]);
  const byId = (id) => table.records.find((r) => r.item === id);
  for (const id of [77, 78, 79, 80, 81, 82, 83]) {
    assert.deepEqual(byId(id), { item: id, clip: 15, motion: 34 + 3 * (id - 77), effect: 2, sound: 57 });
  }
  assert.deepEqual(byId(84), { item: 84, clip: 15, motion: null,
    motion_random: { base: 34, step: 3, count: 7 }, effect: 2, sound: 57 });
  assert.deepEqual(byId(85), { item: 85, clip: 14, motion: -1, effect: 28, sound: 39 });
  assert.deepEqual(byId(86), { item: 86, clip: 17, motion: -1, effect: 21, sound: 27 });
  assert.deepEqual(byId(87), { item: 87, clip: 17, motion: -1, effect: 39, sound: 49 });
  assert.deepEqual(byId(88), { item: 88, clip: 17, motion: -1, effect: 46, sound: 30,
    effect_branch: { str: 37, def: 39, none: 46 }, sound_branch: { str: 49, def: 49, none: 30 } });
  assert.deepEqual(byId(89), { item: 89, clip: 17, motion: -1, effect: 41, sound: 49 });
  assert.deepEqual(byId(90), { item: 90, clip: 14, motion: 33, effect: 4, sound: 25 });
  assert.deepEqual(table.state1_fallback,
    { item: 85, clip: 10, effect: 33, sound: 31,
      when: "actor == null && ctx+0x18 == 0 && byte[0x80042b5f] == 0" });
});

test("the VM oracle: the typed entry plays the arm's clip and spawns its effect (fail-before/pass-after)", () => {
  setThrowItemEffects(table);
  assert.deepEqual(throwItemEffect(86), table.records.find((r) => r.item === 86));
  assert.equal(throwItemEffect(76), null, "items outside the band have no typed record");
  assert.equal(throwItemEffect(91), null);
  assert.equal(isThrowItem(77) && isThrowItem(90), true);
  assert.equal(isThrowItem(76) || isThrowItem(91), false);
  assert.deepEqual(THROW_ITEM_BAND, [77, 90]);

  // FAIL-BEFORE (the shipped behaviour this closes): the same item through the clip-10
  // default entry — no current effect — spawns nothing, because clip 10's op3 9999 is a
  // faithful skip and the typed arm's effect was never written.
  const before = new ActorAnimator(RENA);
  const beforeSpawns = [];
  assert.equal(before.setAction(10, { onEffect: (rec) => beforeSpawns.push(rec) }), true);
  assert.equal(before._clip, 10, "the old entry plays the item-use clip 10");
  for (let i = 0; i < 600 && before.vm; i++) before.tick(1);
  assert.deepEqual(beforeSpawns, [], "clip 10 with no current effect spawns nothing");

  // PASS-AFTER: item 86 (ChaosWave) -> clip 17, effect 21, exactly one 9999 spawn.
  const a = new ActorAnimator(RENA);
  const spawned = [];
  assert.equal(a.setAnimByThrowItem(86, { onEffect: (rec) => spawned.push(rec) }), true);
  assert.equal(a._clip, 17, "item 86 plays its typed clip 17");
  assert.equal(a.vm.currentEffect, 21, "actor+0x6c carries the arm's effect");
  assert.equal(a.vm.currentMotion, -1, "actor+0x68 carries the arm's motion");
  for (let i = 0; i < 600 && a.vm; i++) a.tick(1);
  assert.deepEqual(spawned.filter((r) => r.z === 32767),
    [{ type: 21, x: 0, y: 0, z: 32767 }], "clip 17's 9999 spawn fires with effect 21");
  assert.equal(a.vm, null, "and the action releases the actor (no HOLD_CAP pin)");

  // Item 90 (TNTBall) -> clip 14: the clip's own hardcoded type-2 spawn AND the arm's 4.
  const b = new ActorAnimator(RENA);
  const bSpawns = [];
  b.setAnimByThrowItem(90, { onEffect: (rec) => bSpawns.push(rec) });
  assert.equal(b._clip, 14);
  assert.equal(b.vm.currentEffect, 4);
  for (let i = 0; i < 600 && b.vm; i++) b.tick(1);
  assert.deepEqual(bSpawns.filter((r) => r.z === 32767),
    [{ type: 2, x: 0, y: 0, z: 32767 }, { type: 4, x: 0, y: 0, z: 32767 }]);

  // Item 77 (FlameField) -> clip 15, effect 2, motion 34: the clip is the pure motion
  // envelope (no op3), so nothing spawns — its presentation is the element pack its op4
  // motion selects (MEFT10<motion>; armed by battle3d's playPlayerThrowItem).
  const c = new ActorAnimator(RENA);
  const cSpawns = [];
  assert.equal(c.setAnimByThrowItem(77, { onEffect: (rec) => cSpawns.push(rec) }), true);
  assert.equal(c._clip, 15);
  assert.equal(c.vm.currentEffect, 2);
  assert.equal(c.vm.currentMotion, 34);
  assert.deepEqual(clipTableSeq(RENA, 15), [], "clip 15 binds no op2 tables — motion only");
  for (let i = 0; i < 600 && c.vm; i++) c.tick(1);
  assert.deepEqual(cSpawns, []);
  assert.equal(c.vm, null, "clip 15 ends at its own terminator");

  // Item 84's rolled motion is supplied by the caller (the element draw); the override path.
  const d = new ActorAnimator(RENA);
  d.setAnimByThrowItem(84, {}, { motion: 40 });
  assert.equal(d._clip, 15);
  assert.equal(d.vm.currentMotion, 40);

  // Item 88 (CursedPuppet): the effect/sound pair follows the STR/DEF branch.
  const branchFx = { str: 37, def: 39, none: 46 };
  for (const [branch, effect] of Object.entries(branchFx)) {
    const e = new ActorAnimator(RENA);
    const eSpawns = [];
    e.setAnimByThrowItem(88, { onEffect: (rec) => eSpawns.push(rec) }, { branch });
    assert.equal(e.vm.currentEffect, effect, `item 88 branch ${branch}`);
    for (let i = 0; i < 600 && e.vm; i++) e.tick(1);
    assert.deepEqual(eSpawns.filter((r) => r.z === 32767), [{ type: effect, x: 0, y: 0, z: 32767 }]);
  }

  setThrowItemEffects(null);   // leave no global behind for other test files
  assert.equal(throwItemEffect(86), null);
});

test("the wiring: the item branch routes 77-90 to the throw entry, which feeds the actor's fields", () => {
  const battleJs = readFileSync(join(ROOT, "web/battle.js"), "utf8");
  const battle3dJs = readFileSync(join(ROOT, "web/battle3d.js"), "utf8");
  const tablesJs = readFileSync(join(ROOT, "web/fight/fight-tables.js"), "utf8");

  const branch = battleJs.slice(battleJs.indexOf('action.type === "item"'));
  // The default arm keeps its clip-10 item-use entry for every id outside the band (the
  // sibling item-use fix's playPlayerItemUse: clip 10 plus the 0x800a336c record's effect).
  assert.match(branch, /if \(!isThrowItem\(item\.id\)\) renderer3d\?\.playPlayerItemUse\(item\.id\)/,
    "non-throw items keep the default arm's clip-10 entry");
  // The throw band's own entry starts with the item's id and the handler's branch/element.
  assert.match(branch, /renderer3d\?\.playPlayerThrowItem\(item\.id, \{\s*branch: r\.statBranch \?\? null,\s*elementIndex: r\.elementIndex \?\? null,/,
    "the throw band starts the machine's typed entry with the handler's branch/element");
  // When the extracted table has not loaded yet the entry declines, and the caller keeps the
  // default-arm clip-10 entry rather than leaving the actor standing.
  assert.match(branch, /!renderer3d\?\.playPlayerThrowItem\(item\.id, \{[\s\S]*?\}\)\) \{\s*renderer3d\?\.playPlayerItemUse\(item\.id\);/,
    "an unloaded throw table falls back to the default-arm clip-10 entry");

  // The renderer loads the extracted table and the throw entry consumes it.
  assert.match(battle3dJs, /assets\/data\/throw_item_effects\.json[\s\S]*setThrowItemEffects/,
    "battle3d loads throw_item_effects.json into fight-tables");
  const entry = battle3dJs.slice(battle3dJs.indexOf("function playPlayerThrowItem"));
  assert.match(entry, /throwItemEffect\(itemId\)/, "the entry resolves the used item's record");
  assert.match(entry, /setAnimByThrowItem\(itemId/, "and plays the typed clip through setAnimByThrowItem");
  assert.match(entry, /contactSoundType\.player = /,
    "actor+0x70's value (the record sound) reaches the op10 contact-sound resolution");
  assert.match(entry, /armThrowBackdrop\(motion\)/,
    "the clip-15 band arms the element pack its op4 motion selects");
  assert.match(entry, /dataFieldMotion\(m\)/,
    "and the clip's own op4 switches it in and out");

  // The table's own shape: band, lookup and the async setter.
  assert.match(tablesJs, /export const THROW_ITEM_BAND = \[77, 90\]/);
  assert.match(tablesJs, /export function setThrowItemEffects/);
  assert.match(tablesJs, /export function throwItemEffect/);
});
