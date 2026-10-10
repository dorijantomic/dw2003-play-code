// The two sustained sounds of a special attack, and the VAB alignment that used
// to hide seven of the eight element loops.
//
// fightstg F0x80086304 (the motion/effect-pack rebuild) case 0:
//   0x8008642c  li $v0, -0x1 / beq $a0, $v0   -- rec[+0x08] == -1 -> no sound
//   0x80086434  lui $v1, 0x800a / addiu $v1, 0x2498
//   0x8008643c  sll $v0, $a0, 0x2 / addu $v0, $v1 / lw $a0, ($v0)
//   0x80086454  jalr [0x80055c48]             -- play
//   0x8008645c  sh $v0, 0xe4($s1)             -- keep the voice handle
// and the teardown case re-derives the same word and calls the stop-by-(id,
// handle) entry [0x80055c50] at 0x8008689c. The eight words at 0x800a2498 are
// BT_LOOP0..BT_LOOP7, one per element.
//
// fightstg F0x8009b774 (the op10 sound player) tests two types before the
// 0x800a368c table lookup: 0x5a (90) replays the id saved at [0x80042b30], and
// 0x5b (91) calls the immediate-stop entry [0x80055c68] with a0 = 0x20040006 =
// EX_AT_LP -- the whirl that every signature clip 11 opens with op10 type 89.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SFX = "web/assets/sfx";
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

test("the eight element-loop ids are extracted from fightstg and named", () => {
  const sf = readJson("docs/research/fight-3d/data/sfstdata_effect_table.json");
  assert.equal(sf.soundTableAddr, "0x800a2498");
  assert.equal(sf.soundTable.length, 8);
  const expected = ["0xa004e03c", "0xa004e0bd", "0xa004e13e", "0xa004e1bf",
                    "0xa004e240", "0xa004e2c1", "0xa004e342", "0xa004e3c3"];
  assert.deepEqual(sf.soundTable.map((s) => s.packed), expected);
  sf.soundTable.forEach((s, i) => {
    assert.equal(s.name, `BT_LOOP${i}`);
    assert.equal(s.row, 28, "all eight address VAB program slot 28");
    assert.equal(s.tone, i, "tone index runs 0..7 across the slot's eight tones");
    assert.equal(s.note, 60 + i);
    assert.equal(s.positional, true, "bit 31 set -> the allocate-a-fresh-voice path");
    assert.equal(s.loop, true, "bit 29 set -> a looping sample");
  });
});

test("all eight element loops build to distinct WAVs", () => {
  const map = readJson(`${SFX}/special_loop_map.json`);
  const manifest = readJson(`${SFX}/manifest.json`);
  assert.deepEqual(Object.keys(map).sort(), ["0", "1", "2", "3", "4", "5", "6", "7"]);
  const sizes = new Set();
  for (const [idx, key] of Object.entries(map)) {
    assert.equal(key, `bt_loop${idx}`);
    assert.ok(manifest[key], `${key} missing from manifest.json`);
    assert.equal(manifest[key].positional, true);
    assert.ok(fs.existsSync(`${SFX}/${key}.wav`), `no WAV for ${key}`);
    sizes.add(fs.statSync(`${SFX}/${key}.wav`).size);
  }
  // Eight tones, eight different VAGs (20, 30, 26, 22, 96, 87, 37, 25) -- if the
  // resolver ever collapses them onto one sample this catches it.
  assert.ok(sizes.size >= 6, `element loops should be distinct samples, got ${sizes.size}`);
});

test("the sample resolver reads each program's real tone count from the VAB", () => {
  // common.toml pairs program-header slot k with tone BLOCK k, but the blocks are
  // stored present-programs-only. Above the first empty slot that pairing takes the
  // right block with the wrong count, which silently dropped every id addressing a
  // tone past it -- BT_LOOP1..7 among them. build_sfx now reads the header itself
  // and checks each tone's own program number at +0x14.
  const src = fs.readFileSync("build_sfx.py", "utf8");
  assert.ok(src.includes("def vab_program_tones()"), "header-driven tone table missing");
  assert.ok(src.includes("reports program"), "the per-tone program check must stay");
  assert.ok(src.includes("positional_resolve(packed, programs, row_to_packed, slot_tones)"),
    "the resolver must be handed the header-derived tones");
});

test("every element backdrop carries its SFSTDATA sound index", () => {
  const bd = readJson("web/assets/battle/backdrops/manifest.json");
  const sf = readJson("docs/research/fight-3d/data/sfstdata_effect_table.json");
  const rec = Object.fromEntries(sf.records.map((r) => [r.index, r]));
  for (const [sig, entry] of Object.entries(bd.bySig)) {
    const idx = Number(sig) === 0 ? 55 : Number(sig);
    assert.equal(entry.sound, rec[idx].sound,
      `sig ${sig} sound should mirror SFSTDATA record ${idx}`);
  }
  // The data-field fallback (record 55) carries no sound, so a sigEffect-0 special
  // is silent on this path in the original too.
  assert.equal(bd.bySig["0"].sound, -1);
  // One index per element pair, exactly as the 16 themed packs are authored.
  assert.equal(bd.bySig["33"].sound, bd.bySig["34"].sound, "fire pair shares its loop");
  assert.equal(bd.bySig["45"].sound, 4, "thunder -> BT_LOOP4");
  assert.equal(bd.bySig["51"].sound, 6, "dark -> BT_LOOP6");
});

test("battle3d holds the element loop for exactly the backdrop's lifetime", () => {
  const src = fs.readFileSync("web/battle3d.js", "utf8");
  assert.ok(src.includes("assets/sfx/special_loop_map.json"), "loop map not loaded");
  assert.ok(src.includes("function syncSpecialLoop(active)"), "no on/off edge handler");
  assert.ok(src.includes("syncSpecialLoop(dfActive)"), "loop not tied to the backdrop");
  assert.ok(src.includes("sfx?.playEffectLoop?.(specialLoopKey)"));
  assert.ok(src.includes("sfx?.stopEffectLoop?.()"));
  // sound == -1 must stay silent rather than falling back to some other loop.
  assert.ok(src.includes("entry.sound >= 0 ? (specialLoopMap[String(entry.sound)] || null) : null"));
});

test("the signature whirl is closed by op10 type 91, not by a duration", () => {
  const src = fs.readFileSync("web/battle3d.js", "utf8");
  assert.ok(src.includes("const SUSTAINED_LOOP_TYPE = 89;"));
  assert.ok(src.includes('const SUSTAINED_LOOP_KEY  = "ex_at_lp";'));
  assert.ok(src.includes("t === 91 && sfx) sfx.stopSustained?.(SUSTAINED_LOOP_KEY)"));
  assert.ok(src.includes("t === SUSTAINED_LOOP_TYPE && sfx) sfx.playSustained?.(SUSTAINED_LOOP_KEY)"));
  const audio = fs.readFileSync("web/audio.js", "utf8");
  assert.ok(audio.includes("player.playSustained = (name) =>"));
  assert.ok(audio.includes("player.stopSustained = (name) =>"));
});

test("every shipped clip that opens the whirl also closes it", () => {
  const root = "web/assets/battle/models";
  let pairs = 0;
  for (const m of fs.readdirSync(root)) {
    const p = path.join(root, m, "anim.json");
    if (!fs.existsSync(p)) continue;
    for (const [ai, act] of (readJson(p).actions || []).entries()) {
      const types = (act?.ops || []).filter((o) => o.op === 10).map((o) => (o.words || [])[0]);
      const starts = types.filter((t) => t === 89).length;
      const stops = types.filter((t) => t === 91).length;
      assert.equal(starts, stops, `${m} action ${ai}: ${starts} whirl starts, ${stops} stops`);
      pairs += starts;
    }
  }
  assert.ok(pairs >= 60, `expected the signature clips to carry the pair, got ${pairs}`);
});

test("the Blast revert plays its captured PLAYER11 cue", () => {
  // Authority 1: captures/blast-presentation-2026-07-14/README.md records
  // 0xa0045ec9 = PLAYER11 at revert. It was left silent while the resolver could
  // not reach program slot 11 tone 13.
  const manifest = readJson(`${SFX}/manifest.json`);
  assert.ok(manifest.player11, "player11 missing from manifest.json");
  assert.equal(manifest.player11.id, "0xa0045ec9");
  assert.ok(fs.existsSync(`${SFX}/player11.wav`));
  const src = fs.readFileSync("web/battle.js", "utf8");
  assert.ok(src.includes('sfx?.play("player11")'), "revert cue not wired");
});

test("no invented heal cue survives in the battle item path", () => {
  const src = fs.readFileSync("web/battle.js", "utf8");
  assert.ok(!src.includes('sfx?.play("recovery")'),
    "RECOVERY has no call site in the battle overlay and no action script emits op10 type 7");
  const trig = readJson("docs/research/audio/sfx-triggers.json");
  const rec = trig.find((t) => t.name === "RECOVERY");
  assert.equal(rec.walker_hook, "", "the RECOVERY battle hook is retracted");
});
