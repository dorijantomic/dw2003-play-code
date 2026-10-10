import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { NativeMemory } from "../engine/native/memory.ts";
import { ShopTextBanks } from "../engine/dw3/ui/shop-text-banks.ts";

const dir = "web/assets/data/shop-banks/";
const manifest = JSON.parse(readFileSync(`${dir}manifest.json`, "utf8"));

test("all seven shop languages ship with the four indexed text families", () => {
  const families = [[0x63, 403], [0x6a, 403], [0x71, 43], [0x94, 68]];
  assert.deepEqual(manifest.banks.map(bank => bank.id),
    families.flatMap(([offset]) => Array.from({ length: 7 }, (_, language) => offset + language)));
  for (const bank of manifest.banks) {
    const data = readFileSync(`${dir}${bank.file}`);
    assert.equal(data.length, bank.size);
    assert.equal(createHash("sha256").update(data).digest("hex"), bank.sha256);
    const count = families.find(([offset]) => bank.id >= offset && bank.id < offset + 7)?.[1];
    assert.equal(data.readUInt32LE(0), count);
    assert.equal(data.readUInt32LE(4), 4 + count * 4);
    for (let i = 0; i < count; i++) {
      const begin = data.readUInt32LE(4 + i * 4);
      const end = i + 1 < count ? data.readUInt32LE(8 + i * 4) : data.length;
      assert.ok(begin < end && end <= data.length, `bank ${bank.id} string ${i}`);
      assert.ok(data.subarray(begin, end).includes(0), `bank ${bank.id} string ${i} terminator`);
    }
  }
  assert.deepEqual(readFileSync(`${dir}115.bin`), readFileSync("web/assets/native/screens/banks/115.bin"));
});

test("translated shop widgets can resolve the extracted bank strings", () => {
  const bytes = new Map(manifest.banks.map(bank => [bank.id, new Uint8Array(readFileSync(`${dir}${bank.file}`))]));
  const mem = new NativeMemory();
  const banks = new ShopTextBanks(mem, 2, bytes);
  for (const id of [101, 108, 115, 150]) {
    const source = banks.source(id);
    const index = id === 115 ? 17 : 1;
    const pointer = banks.stringById(mem, source, index);
    const original = bytes.get(id);
    const offset = original[4 + index * 4] | (original[5 + index * 4] << 8) |
      (original[6 + index * 4] << 16) | (original[7 + index * 4] << 24);
    assert.equal(pointer, source + offset);
    assert.equal(mem.read8(pointer), original[offset]);
  }
  assert.throws(() => banks.source(113), /Unloaded shop text bank/);

  const chars = JSON.parse(readFileSync("web/assets/ui/uifont.json", "utf8")).chars;
  const basic = new Map(), extended = new Map();
  for (const [character, glyph] of Object.entries(chars)) {
    (glyph.t === "b" ? basic : extended).set(glyph.i, character);
  }
  const decode = index => {
    const ptr = banks.stringById(mem, banks.source(115), index);
    let text = "";
    for (let p = ptr; mem.read8(p) !== 0; p++) {
      const byte = mem.read8(p);
      if (byte === 1) text += extended.get(mem.read8(++p) - 1) ?? "?";
      else text += basic.get(byte - 4) ?? "?";
    }
    return text;
  };
  assert.equal(decode(17), "How many?");
  assert.equal(decode(19), "Buy");
  assert.equal(decode(20), "No");
});
