import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SFX = "web/assets/sfx";

test("op10_map.json exists and maps types to built WAVs", () => {
  const map = JSON.parse(fs.readFileSync(`${SFX}/op10_map.json`, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(`${SFX}/manifest.json`, "utf8"));
  const keys = Object.keys(map);
  assert.ok(keys.length >= 20, `expected many op10 sounds, got ${keys.length}`);
  for (const [type, key] of Object.entries(map)) {
    assert.match(String(type), /^\d+$/, `type ${type} not numeric`);
    assert.ok(manifest[key], `op10 type ${type} -> ${key} missing from manifest.json`);
    assert.ok(fs.existsSync(`${SFX}/${key}.wav`), `no WAV for ${key}`);
  }
});

test("op10_map covers the known attack/impact sounds", () => {
  const map = JSON.parse(fs.readFileSync(`${SFX}/op10_map.json`, "utf8"));
  // type 20 = COMAT102 (a common attack sound); type 11 = MID_STEP (impact/landing)
  assert.ok(map["20"] === "comat102", `type 20 -> ${map["20"]}`);
  assert.ok(map["11"] === "mid_step", `type 11 -> ${map["11"]}`);
});

test("op10_map covers the decoded battle movement step sounds", () => {
  const map = JSON.parse(fs.readFileSync(`${SFX}/op10_map.json`, "utf8"));
  assert.ok(map["10"] === "sht_step", `type 10 -> ${map["10"]}`);
  assert.ok(map["11"] === "mid_step", `type 11 -> ${map["11"]}`);
  assert.ok(map["12"] === "lrg_step", `type 12 -> ${map["12"]}`);
  assert.ok(map["13"] === "wng_step", `type 13 -> ${map["13"]}`);
});

test("op10_map covers the decoded hit/down reaction sounds", () => {
  const map = JSON.parse(fs.readFileSync(`${SFX}/op10_map.json`, "utf8"));
  assert.ok(map["14"] === "sht_down", `type 14 -> ${map["14"]}`);
  assert.ok(map["15"] === "mid_down", `type 15 -> ${map["15"]}`);
  assert.ok(map["16"] === "lrg_down", `type 16 -> ${map["16"]}`);
  assert.ok(map["17"] === "mtl_down", `type 17 -> ${map["17"]}`);
});

test("op10_map covers every named battle sound table entry", () => {
  const fx = JSON.parse(fs.readFileSync("web/assets/battle/effects/manifest.json", "utf8"));
  const map = JSON.parse(fs.readFileSync(`${SFX}/op10_map.json`, "utf8"));
  const missing = [];
  for (const type of Object.keys(fx.op10_sounds)) {
    // Type 66 IS a real packed id (0x41180000), but its archive field is 70 =
    // jog_00, not the common bank, so it has no common-bank name and battle3d
    // plays it through playBank("jog_00", "jogresse") instead. (The older note
    // here called it a "non-packed sentinel/float word" — wrong: it decodes the
    // same way 0x41140000 = archive 69 = evo_00 = EVOLUTIO does.) 98/99 are
    // runtime contact markers resolved from the current tech record.
    if (type === "66" || type === "98" || type === "99") continue;
    if (!map[type]) missing.push(type);
  }
  assert.deepEqual(missing, []);
});

test("op10_map leaves runtime contact markers unmapped", () => {
  const map = JSON.parse(fs.readFileSync(`${SFX}/op10_map.json`, "utf8"));
  assert.equal(map["98"], undefined, "type 98 is a runtime contact marker, not a static sound");
  assert.equal(map["99"], undefined, "type 99 is a runtime contact marker, not a static sound");
});

test("battle3d remaps contact markers through the decoded runtime contact id", () => {
  const src = fs.readFileSync("web/battle3d.js", "utf8");
  assert.ok(src.includes("contactSoundTypeFor"), "contact id resolver should be present");
  // The marker gate now lives in resolveContactSoundType (both markers, with the
  // evade substitute — pinned in tests/battle-missing-cues.test.js), and the op10
  // hook resolves through it with the live contact type and evade state.
  assert.ok(src.includes("type !== 98 && type !== 99"),
    "contact marker types should resolve through context +0x70");
  assert.ok(src.includes("resolveContactSoundType(rec.type, contactSoundType[side], contactEvade[side])"),
    "the op10 hook should resolve contacts through the shared substitution");
  assert.ok(src.includes("tech+0x0f") && src.includes("plain clip-5 basic -> 0x1e"),
    "contact resolver should cite the decoded fightstg source fields");
});

test("battle op10 playback receives the decoded sound-object duration word", () => {
  const src = fs.readFileSync("web/battle3d.js", "utf8");
  assert.ok(src.includes("sfx.playBattle(key, side, rec.words?.[1] ?? 0)"),
    "op10 word[1] must drive direct-vs-timed battle sound playback");
});

test("battle lab logging wrapper preserves the op10 duration word", () => {
  const src = fs.readFileSync("web/battle-lab.html", "utf8");
  assert.ok(src.includes("sfx.playBattle = (name, side, durationFrames = 0)"));
  assert.ok(src.includes("return playBattle(name, side, durationFrames);"));
});

test("battle step/down sounds are phrase-rendered, distinct WAVs (2026-07-08 seq decode)", () => {
  // 2D-path ids are SEQ PHRASES (mpcommon 1.seq/2.seq), rendered offline through
  // the VAB at true pitch -> rate 1.0, no battleRate hack, and each size class is
  // its own mix (the old flat-slot rule collapsed SHT_DOWN/SHT_STEP/WNG_STEP onto
  // one sample and mapped LRG_DOWN onto the field SWITCH03 blip -- user-reported).
  const manifest = JSON.parse(fs.readFileSync(`${SFX}/manifest.json`, "utf8"));
  for (const key of ["sht_down", "mid_down", "lrg_down", "mtl_down",
                     "sht_step", "mid_step", "lrg_step", "wng_step"]) {
    assert.equal(manifest[key].battleRate, undefined, `${key} still carries the battleRate hack`);
    assert.equal(manifest[key].rate, 1.0, `${key} should be rendered at true pitch`);
    assert.equal(manifest[key].positional, false, `${key} is a 2D-path phrase sound`);
    assert.ok(fs.existsSync(`${SFX}/${key}.wav`), `no WAV for ${key}`);
  }
  // distinct mixes: the eight step/down WAVs must not all be one file's bytes
  const sizes = new Set(["sht_down", "lrg_down", "sht_step", "lrg_step"]
    .map((k) => fs.statSync(`${SFX}/${k}.wav`).size));
  assert.ok(sizes.size >= 3, "step/down renders should differ per size class");
});

test("battle SFX playback prefers the battle-specific tone rate", () => {
  const src = fs.readFileSync("web/audio.js", "utf8");
  assert.ok(src.includes("const rate = meta.battleRate ?? meta.rate"));
});

// Replaces the old "keeps packed-sound category arbitration" pin. Bits 18-24
// are the ARCHIVE id that F0x80020030 uses to find the channel holding that
// archive — not a mixer category, and nothing in the driver stops a sound
// because another sound shares it (sound-system.md retracted that reading on
// 2026-07-03b). What the driver really does is keyed off two mechanisms.
test("packed-sound arbitration is per-slot self-cut, never per-archive", () => {
  const src = fs.readFileSync("web/audio.js", "utf8");
  // No archive-keyed cutting survives anywhere in the module.
  assert.ok(!src.includes("stopCategory"), "the retracted category cut is gone");
  assert.ok(!/meta\.category/.test(src), "meta.category no longer arbitrates");
  // F0x800335b4 -> F0x8003340c -> F0x800375ec(bank | slot<<8): a 2D sound keys
  // off only voices owned by its own (bank, slot).
  assert.ok(src.includes("function slotKeyFor("));
  assert.ok(src.includes("if (slotKey) stopVoice(slotKey);"));
  // The bit-31 path (F0x8003432c) allocates a fresh voice and keys nothing off.
  assert.ok(src.includes("if (meta.positional) return null;"));
  // Bit 30 is the single exclusive-track register D0x80055c34 — ONE instance
  // shared by both players (createExclusiveRegister, wired in web/game.js);
  // its begin() is the same-id guard of the play path.
  assert.ok(src.includes("export function createExclusiveRegister()"));
  assert.ok(src.includes("if (held && held.key === key) return false;"));
});
