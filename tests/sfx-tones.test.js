// common-tones-full.json coverage contract (Task 1, authentic-sfx-wiring plan).
//
// docs/research/audio/decode_vag_loops.py parses the raw common-bank VAB header
// byte-exactly (independent of common.toml's 198-tone flattening) and emits every
// slot the sequential tone-load loop can reach, plus the slots referenced by named
// sound-test ids that fall PAST the real tone table (198-203) — those are recorded
// honestly as {"status":"unresolvable"} rather than a fabricated mapping (see the
// "198-vs-202 diagnosis" comment block in decode_vag_loops.py for why: the VAB file's
// tone_headers section is sized for exactly programs_len=48 programs / 198 tones;
// the header's tones_len=202 field and the 4 extra program_headers entries beyond
// programs_len have no backing ToneHeader storage in the file at all).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";

test("common-tones-full covers every named slot", () => {
  const tones = JSON.parse(
    fs.readFileSync("docs/research/audio/common-tones-full.json", "utf8"),
  );
  const ids = JSON.parse(
    fs.readFileSync("docs/research/audio/soundtst-common-ids.json", "utf8"),
  );
  const bySlot = new Map(tones.map((t) => [t.slot, t]));

  // The honest-failure set: slots referenced by a name but with no real ToneHeader
  // backing (see decode_vag_loops.py's diagnosis comment). Every other named slot
  // must resolve to a real integer vag.
  const UNRESOLVABLE = new Set([198, 199, 200, 201, 202, 203]);

  for (const e of ids) {
    const t = bySlot.get(e.slot);
    assert.ok(t, `slot ${e.slot} (${e.name}) missing from tone table`);
    if (UNRESOLVABLE.has(e.slot)) {
      assert.strictEqual(
        t.status,
        "unresolvable",
        `slot ${e.slot} (${e.name}) expected to be documented unresolvable`,
      );
      assert.strictEqual(
        t.vag,
        null,
        `slot ${e.slot} (${e.name}) should not have a fabricated vag`,
      );
    } else {
      assert.ok(
        Number.isInteger(t.vag),
        `slot ${e.slot} (${e.name}) has no vag`,
      );
      assert.strictEqual(t.status, "ok");
    }
  }
});

test("common-tones-full is internally consistent", () => {
  const tones = JSON.parse(
    fs.readFileSync("docs/research/audio/common-tones-full.json", "utf8"),
  );
  assert.ok(Array.isArray(tones) && tones.length > 0);
  for (const t of tones) {
    assert.ok(Number.isInteger(t.slot));
    assert.ok(t.status === "ok" || t.status === "unresolvable");
    if (t.status === "ok") {
      assert.ok(Number.isInteger(t.program));
      assert.ok(Number.isInteger(t.tone));
      assert.ok(Number.isInteger(t.vag));
      assert.ok(t.loop === null || (Number.isInteger(t.loop.start) && Number.isInteger(t.loop.end)));
    }
  }
  // No duplicate slots.
  const slots = tones.map((t) => t.slot);
  assert.strictEqual(new Set(slots).size, slots.length);
});
