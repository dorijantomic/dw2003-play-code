import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const MANIFEST_PATH = resolve(root, "web/assets/music-hd/manifest.json");
const BUILT = existsSync(MANIFEST_PATH);
const manifest = BUILT ? JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) : null;

const sha256 = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

if (BUILT) {
test("Asuka HD is a source-level restoration with locked musical data", () => {
  assert.equal(manifest.profile, "source-level-hd");
  assert.equal(manifest.bank, "bgm001");
  assert.equal(manifest.sample_count, 16);
  assert.deepEqual(manifest.invariants, {
    sequence_unchanged: true,
    sample_counts_unchanged: true,
    vab_metadata_unchanged: true,
    decoded_frames_unchanged: true,
  });
  assert.ok(manifest.samples.every((sample) => sample.samples > 0));
  assert.ok(
    manifest.samples.every(
      (sample) =>
        sample.loop_start == null ||
        (sample.loop_start >= 0 &&
          sample.loop_end > sample.loop_start &&
          sample.loop_end <= sample.samples),
    ),
  );
});

test("Asuka HD output is hash-bound, duration-locked, and recognizably related", () => {
  const output = resolve(root, "web/assets/music-hd/bgm001.ogg");
  assert.ok(existsSync(output));
  assert.equal(sha256(output), manifest.output_sha256);
  assert.equal(manifest.before.seconds, manifest.after.seconds);
  assert.equal(manifest.before.sample_rate, manifest.after.sample_rate);
  assert.equal(manifest.before.channels, manifest.after.channels);
  assert.ok(manifest.comparison.waveform_correlation > 0.9);
  assert.ok(manifest.comparison.waveform_correlation < 0.995);
});
} else {
  test("opt-in pack not built", { skip: true });
}
