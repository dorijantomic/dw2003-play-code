// Task 5/6 of docs/superpowers/plans/2026-07-02-authentic-sfx-wiring.md:
// the generated web/assets/sfx/ manifest must cover every disasm-decoded
// trigger that has a walker hook, with packed-id bit fields decoded per
// docs/research/audio/sound-system.md (category=bits 18-24, dedup=bit 30).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const PLAIN_NAME = /^[A-Z0-9_]+$/; // skip aggregate rows like "SYSTEM07/SYSTEM08 (...)"

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function webJsFiles(dir = "web") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "vendor") out.push(...webJsFiles(p));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      out.push(p);
    }
  }
  return out;
}

function triggerRows() {
  const rows = loadJson("docs/research/audio/sfx-triggers.json");
  // Newly decoded call sites staged by the phrase-gap pass (2026-10-05), same row
  // shape; read tolerantly so folding them into sfx-triggers.json is safe.
  if (fs.existsSync("data/sfx-call-sites.json")) rows.push(...loadJson("data/sfx-call-sites.json").rows);
  return rows;
}

test("sfx manifest covers every decoded trigger with a walker hook", () => {
  const trig = triggerRows();
  const man = loadJson("web/assets/sfx/manifest.json");
  for (const t of trig) {
    if (t.status !== "decoded" || !t.walker_hook) continue;
    if (!PLAIN_NAME.test(t.name)) continue;
    const key = t.name.toLowerCase();
    const m = man[key];
    assert.ok(m, `${key} missing from manifest`);
    assert.strictEqual(m.id, t.id);
    assert.strictEqual(m.category, (parseInt(t.id, 16) >> 18) & 0x7f);
    assert.strictEqual(m.dedup, Boolean((parseInt(t.id, 16) >> 30) & 1));
    assert.ok(fs.existsSync(`web/assets/sfx/${key}.wav`), `${key}.wav missing`);
  }
});

test("confirmed UI blips and the two originally wired sounds are present", () => {
  const man = loadJson("web/assets/sfx/manifest.json");
  const sem = loadJson("docs/research/audio/system-blip-semantics.json");
  for (const [name, entry] of Object.entries(sem)) {
    if (name.startsWith("_")) continue;
    const wireable = ["cursor_move", "confirm", "cancel", "open", "close"];
    if (entry.confidence === "confirmed" && wireable.includes(entry.action)) {
      assert.ok(man[name.toLowerCase()], `${name} (${entry.action}) missing from manifest`);
    }
  }
  // canonical names for the two pre-existing sounds
  assert.ok(man["system03"], "system03 (window blip, id 0x00040019) missing");
  assert.ok(man["player01"], "player01 (ladder creak, id 0x800458bd) missing");
});

test("every wired trigger is played by a web/ call site or the shared packed sink", () => {
  const trig = triggerRows();
  const files = webJsFiles().map((p) => [p, fs.readFileSync(p, "utf8")]);
  // DELIBERATE WIDENING (2026-10-06): PIYOPIYO (0x00040013) is played by the
  // disc's own packed id through the shared sink, not by a `play("piyopiyo")`
  // literal. The emote dispatcher resolves the word from the walker's emote
  // table (engine/systems/emote-sounds.ts) and web/game.js's emoteSound hands it
  // to sfx.playPacked. So a cue is wired when its packed id is in that table AND
  // web/ plays the shared sink -- the by-name forms stay as they were.
  const emoteTable = fs.readFileSync("engine/systems/emote-sounds.ts", "utf8");
  const sinkInWeb = files.some(([, src]) => /sfx\s*\??\.\s*playPacked/.test(src));
  for (const t of trig) {
    if (t.status !== "decoded" || !t.walker_hook) continue;
    if (!PLAIN_NAME.test(t.name)) continue;
    const key = t.name.toLowerCase();
    // A cue is wired by playing it; a sustained cue (SUB_MOVE's thrust loop) by
    // the sustained-voice entry point, whose voice the caller then keys off.
    const byName = files.some(([, src]) =>
      [`play("${key}")`, `playSustained("${key}")`].some((n) => src.includes(n)));
    const byPackedSink = sinkInWeb && emoteTable.includes(t.id.toLowerCase());
    assert.ok(byName || byPackedSink,
      `${t.name} decoded+hooked but neither played by name in web/ nor resolved by the shared packed sink`);
  }
});
