import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "web/assets/music-remastered");
const MANIFEST_PATH = resolve(output, "manifest.json");
const BUILT = existsSync(MANIFEST_PATH);
const manifest = BUILT ? JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) : null;

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// Read an Ogg Vorbis file's channel count, sample rate and total sample count without
// decoding it: the first page carries the identification header, and the last page's
// granule position IS the sample count.
function probeOgg(path) {
  const b = readFileSync(path);
  let id = null;
  let granule = 0n;
  for (let i = 0; i + 27 <= b.length; ) {
    if (b.readUInt32BE(i) !== 0x4f676753) { i++; continue; }        // "OggS"
    const segments = b[i + 26];
    const table = b.subarray(i + 27, i + 27 + segments);
    const body = i + 27 + segments;
    const g = b.readBigInt64LE(i + 6);
    if (g >= 0n) granule = g;
    if (!id && b[body] === 1 && b.subarray(body + 1, body + 7).toString("latin1") === "vorbis") {
      id = { channels: b[body + 11], sampleRate: b.readUInt32LE(body + 12) };
    }
    i = body + table.reduce((a, n) => a + n, 0);
  }
  return { ...id, samples: Number(granule) };
}

if (BUILT) {
test("prototype keeps authentic and remastered music as separate assets", () => {
  assert.equal(manifest.authentic, false);
  assert.equal(manifest.profile, "hybrid");
  assert.deepEqual(
    manifest.tracks.map((track) => track.stem),
    ["bgm001", "bgm007", "bgm010", "bgm016", "batl00", "batl10"],
  );
});

test("every remaster is hash-bound and preserves decoded duration", () => {
  for (const track of manifest.tracks) {
    const source = resolve(root, "web/assets/music", `${track.stem}.ogg`);
    const remaster = resolve(output, track.output);
    assert.ok(existsSync(source), `missing authentic ${track.stem}`);
    assert.ok(existsSync(remaster), `missing remaster ${track.stem}`);
    // The remaster is committed, so it is bound by its exact bytes.
    assert.equal(sha256(remaster), track.output_sha256);
    // The authentic render is NOT: `web/assets/music/` is gitignored and rebuilt locally
    // by build_music.py, and the Ogg container it writes carries the encoder's own vendor
    // string, so its bytes differ between machines while the music is the same. Bind it by
    // what the render actually is instead -- channels, sample rate and sample count, read
    // out of the container without decoding. (This proves the local render is the same
    // length and shape as the one the remaster was made from; it does not re-prove the
    // samples, which the manifest's own before/after measurements cover.)
    const probed = probeOgg(source);
    assert.equal(probed.channels, track.before.channels, `${track.stem} channels changed`);
    assert.equal(probed.sampleRate, track.before.sample_rate, `${track.stem} sample rate changed`);
    assert.equal(
      Number((probed.samples / probed.sampleRate).toFixed(6)), track.before.seconds,
      `${track.stem} render length changed`,
    );
    assert.equal(track.reimagined, null);
    assert.equal(track.before.seconds, track.after.seconds);
    assert.equal(track.before.channels, track.after.channels);
    assert.equal(track.before.sample_rate, track.after.sample_rate);
    assert.ok(
      Math.abs(track.before.rms_dbfs - track.after.rms_dbfs) <= 0.4,
      `${track.stem} is not loudness-matched`,
    );
    assert.ok(
      Math.abs(track.comparison.waveform_correlation) < 0.98,
      `${track.stem} hybrid remaster is too similar to the authentic render`,
    );
  }
});
} else {
  test("opt-in pack not built", { skip: true });
}
