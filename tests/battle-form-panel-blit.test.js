// The battle Digivolve form list's selection bar is a GPU copy from the disc's
// own marker-strip rectangle, and the rectangle has to survive the screen's data
// load.
//
// The shared list model F0x8009AF4C slides one 12x12 marker beside the selected
// row with a vsync-time VRAM-to-VRAM copy whose source rectangle is the eight
// bytes at 0x800A3654 (the overlay's `blit-rect`, `fight-command-menu.ts`
// `COMMAND_BLIT_RECT`). Only the x halfword is written per blit — the counter's
// `*12` over the strip — so the rectangle's other three halfwords must still be
// the disc's own when the copy is made.
//
// Page zero's number table sits at 0x800A350C and the exe's technique icon table
// at 0x80042BDC, and `form-tables.bin` carries both: 40 bytes of triples, then the
// icon table. The Digivolve session used to write everything from offset 40 at
// 0x800A350C, which runs 0x148 bytes past the blit rectangle, so the icon bytes
// landed on it and the copy asked for a 514x366 rectangle at (84,130) — outside
// the strip, and the bar was never painted. This test builds the real session and
// reads the rectangle where the copy reads it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FightFormSession } from "../engine/dw3/ui/fight-form-session.ts";
import { FIGHT_FORM_ICON_TABLE_SIZE } from "../engine/dw3/ui/fight-form-session.ts";
import {
    FORM_PANEL_PAGE0_TABLE, FORM_ICON_TABLE, FORM_LIST_CONFIG,
} from "../engine/dw3/ui/native/digivolve-form-menu.ts";
import { COMMAND_BLIT_RECT } from "../engine/dw3/ui/native/fight-command-menu.ts";

const data = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/data");
const screens = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const bytes = (path) => new Uint8Array(readFileSync(join(data, path)));
const FIGHT_BASE = 0x80082cb0;
const overlay = new Uint8Array(readFileSync(join(screens, "pro_fightstg.bin")));

const TABLES = bytes("battlecmd/form-tables.bin");
const halfwords = (read, at) => [0, 1, 2, 3].map((i) => read(at + i * 2));
const inMemory = (mem) => (addr) => mem.read16(addr);
const inImage = (image) => (addr) => image[addr] | (image[addr + 1] << 8);

function openFormList() {
  const banks = new Map([0x4e, 0x7f, 0xa2].map((bank) => [bank + 2, bytes(`battlecmd/${bank + 2}.bin`)]));
  return new FightFormSession(2, {
    activeIndex: 0,
    slotIndex: 0,
    currentSpecies: 3,
    liveSpecies: 3,
    reservedForm: 0,
    rosterSlots: [0, 1, 2],
    options: [
      { species: 3, left: [10, 10, 10, 10, 10, 10], right: [1, 1, 1, 1, 1, 1, 1],
        techs: [0x8001, 0, 0, 0, 0, 0], level: 2, dvexp: 0 },
      { species: 9, left: [20, 20, 20, 20, 20, 20], right: [2, 2, 2, 2, 2, 2, 2],
        techs: [0x0041, 0x4035, 0x4040, 0, 0, 0], level: 4, dvexp: 90 },
      { species: 10, left: [30, 30, 30, 30, 30, 30], right: [3, 3, 3, 3, 3, 3, 3],
        techs: [0x4041, 0, 0, 0, 0, 0], level: 3, dvexp: 0 },
    ],
    equipped: [9, 10, -1],
    panelBlock: Array.from({ length: 22 }, (_, i) => 0x40 + i),
    preselected: 0x8001,
  }, {
    tables: TABLES,
    profiles: bytes("digimon_profiles.bin"),
    font: bytes("shop_font.bin"),
    banks,
  }, { playSound: () => {} });
}

test("the form list keeps the disc's marker rectangle, so the selection bar can be copied", () => {
  const session = openFormList();
  assert.deepEqual(halfwords(inMemory(session.mem), COMMAND_BLIT_RECT),
    halfwords(inImage(TABLES), 32),
    "the eight bytes at 0x800A3654 are the file's own blit-rect");
  assert.deepEqual(halfwords(inMemory(session.mem), COMMAND_BLIT_RECT), halfwords(inImage(overlay), COMMAND_BLIT_RECT - FIGHT_BASE),
    "and they are the overlay's own eight bytes (0, 244, 12, 12)");
});

test("each of the screen's three data blocks lands at its own address and nowhere else", () => {
  const session = openFormList();
  const at = (address, length) => Array.from({ length }, (_, i) => session.mem.read8(address + i) & 0xff);
  assert.deepEqual(at(FORM_LIST_CONFIG, 32), Array.from(TABLES.subarray(0, 32)));
  assert.deepEqual(at(FORM_PANEL_PAGE0_TABLE, 40), Array.from(TABLES.subarray(40, 80)));
  assert.deepEqual(at(FORM_ICON_TABLE, FIGHT_FORM_ICON_TABLE_SIZE),
    Array.from(TABLES.subarray(80, 80 + FIGHT_FORM_ICON_TABLE_SIZE)));
  // Nothing else is written past the number table. The stretch up to the blit
  // rectangle is the overlay's own unused data and must stay zero, and the
  // rectangle's own eight bytes are the file's.
  const gap = Array.from({ length: COMMAND_BLIT_RECT - (FORM_PANEL_PAGE0_TABLE + 40) },
    (_, i) => session.mem.read8(FORM_PANEL_PAGE0_TABLE + 40 + i) & 0xff);
  assert.deepEqual(gap, new Array(gap.length).fill(0));
});

test("the page-zero numbers the panel prints sit where the overlay's own table says", () => {
  const session = openFormList();
  session.tick([]);
  session.tick([]);
  const table = Array.from({ length: 13 }, (_, i) => [
    session.mem.read8(FORM_PANEL_PAGE0_TABLE + i * 3),
    session.mem.read8(FORM_PANEL_PAGE0_TABLE + i * 3 + 1),
    session.mem.read8(FORM_PANEL_PAGE0_TABLE + i * 3 + 2),
  ]);
  assert.deepEqual(table.slice(0, 6), [[60, 82, 6], [60, 96, 7], [60, 110, 8],
    [60, 124, 9], [60, 138, 10], [60, 152, 11]]);
  assert.deepEqual(table.slice(6), [[126, 82, 12], [126, 96, 13], [126, 110, 14],
    [126, 124, 15], [126, 138, 16], [126, 152, 17], [126, 166, 18]]);
});