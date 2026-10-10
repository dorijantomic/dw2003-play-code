import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const MANIFEST_PATH = resolve(root, "web/assets/music-new/manifest.json");
const BUILT = existsSync(MANIFEST_PATH);
const manifest = BUILT ? JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) : null;
const sha256 = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

if (BUILT) {
test("Asuka variations are explicitly scored original companions", () => {
  assert.equal(manifest.profile, "original-composition");
  assert.equal(manifest.original_composition, true);
  assert.equal(manifest.not_original_game_audio, true);
  assert.deepEqual(manifest.design_reference, {
    source: "Asuka City role and verified tempo only",
    original_melody_reused: false,
    original_sequence_events_reused: false,
    original_samples_reused: false,
  });
  assert.equal(manifest.tempo_bpm, 128);
  assert.equal(manifest.key, "G major / Mixolydian");
  assert.equal(manifest.time_signature, "4/4");
  assert.equal(manifest.bars, 32);
  assert.equal(manifest.duration_seconds, 60);
  assert.deepEqual(manifest.structure, ["A", "A variation", "B", "A finale"]);
  assert.deepEqual(
    manifest.tracks.map((track) => track.slug),
    ["neon-promenade", "chrome-circuit", "pixel-skyline"],
  );
  assert.deepEqual(
    manifest.tracks.map((track) => track.arrangement.bass_style),
    ["syncopated", "slap", "pulse"],
  );
  assert.ok(manifest.style.includes("jazz-fusion"));
  assert.ok(manifest.style.includes("funk"));
  assert.equal(manifest.inspiration_analysis.source_sequence, "bgm001");
  assert.equal(manifest.inspiration_analysis.source_parts, 12);
  assert.equal(manifest.inspiration_analysis.copied_sequence_events, false);
});

test("all variation scores are scale-safe, paired, punchy, loop-locked, and hash-bound", () => {
  for (const track of manifest.tracks) {
    assert.equal(track.validation.out_of_scale_notes, 0);
    assert.equal(track.validation.hanging_or_overlapping_notes, 0);
    assert.equal(track.validation.end_tick, 32 * 4 * 480);
    assert.ok(track.validation.melodic_note_count > 500);
    assert.equal(track.loop.exact_bar_boundary, true);
    assert.equal(track.loop.end_fade_milliseconds, 10);
    assert.ok(track.loop.boundary_sample_jump < 0.001);
    assert.ok(
      track.instruments.some((item) => item.name.includes("Bass")),
    );
    assert.ok(track.instruments.some((item) => item.gm_percussion === true));

    for (const kind of ["audio", "midi"]) {
      const output = resolve(root, "web/assets/music-new", track[kind].file);
      assert.ok(existsSync(output));
      assert.equal(sha256(output), track[kind].sha256);
    }
    assert.equal(track.audio.seconds, 60);
    assert.equal(track.audio.sample_rate, 44100);
    assert.equal(track.audio.channels, 2);
    assert.ok(track.audio.peak_dbfs <= -0.9);
    assert.ok(track.audio.rms_dbfs > -18);
  }
});
} else {
  test("opt-in pack not built", { skip: true });
}
