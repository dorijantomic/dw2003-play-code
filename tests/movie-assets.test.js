// The shipped movie assets, by row: every movie row the walker's implemented
// launch codes can reach must resolve to a stream in
// web/assets/movie/manifest.json.
//
//   * rows 0/1 (MOVIEOP2/MOVIEOPN): the title's attract loop, launch codes
//     0xE01/0xE02;
//   * row 9 (MOVIED08_STR): the ordinal-43 field battle handoff, 0xE0A
//     (F0x8008B798; engine/dw3/screen-routing.ts battleHandoff);
//   * rows 10/11 (MOVIEE01_STR/MOVIEE02_STR): the finale's ending chain — the
//     kind-6 win exits 0xE0B = STTITL mode 11 = row 10, whose own return
//     selector 0xE0C is row 11, whose return selector is 0x2d7
//     (wfightmn.s:2165-2174; pro/stdwtitl.s:1069-1071 the mode-11 dispatch,
//     :212-218 the low-byte-minus-one row; web/game.js playEndingChain).
//
// The rows resolve through the one field movie adapter (web/field-movie.js
// movieRecordFor: by the row's disc file index first, by the row's filename
// second), so each manifest record must carry the same index/file the disc's
// movie table does (engine/dw3/movie-destinations.ts).
//
// The last test pins the STREAM the player counts against: the row ends the
// play on its own picture count (F0x80083944's end flag, stdwtitl.s
// .L0x00000960-.L0x00000988), so a shipped stream must carry at least that
// many pictures. MOVIEE02_STR's XA audio ends 2.95 s before its video
// (108.053 s vs 111.0 s), so an encode cut at the shortest stream drops the
// row's last 29 pictures and the ending freezes ~2 s before the warp — this
// test is the regression guard for that.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { movieRow } from "../engine/index.ts";
import { MOVIE_ROWS } from "../engine/dw3/movie-destinations.ts";

const manifest = JSON.parse(readFileSync("web/assets/movie/manifest.json", "utf8"));

/** The adapter's own resolution (web/field-movie.js movieRecordFor). */
function shippedRecord(row) {
  const movies = manifest?.movies ?? {};
  const byIndex = Object.values(movies).find((m) => m.index === row.fileIndex);
  if (byIndex) return byIndex;
  return movies[row.file.replace(/_STR$/, "").toLowerCase()] ?? null;
}

/** A clone without `git lfs pull` leaves pointer files where the streams go;
 *  the manifest is still the contract, but its size only matches the real
 *  stream. */
function isLfsPointer(path) {
  return readFileSync(path).subarray(0, 40).toString("utf8").startsWith("version https://git-lfs");
}

// The launch codes whose rows the walker plays: the two openings, the
// ordinal-43 field movie and the two ending rows.
const PLAYED_CODES = [0xe01, 0xe02, 0xe0a, 0xe0b, 0xe0c];

test("the finale's ending rows resolve to shipped streams", () => {
  for (const [code, index, file] of [[0xe0b, 10, "MOVIEE01_STR"], [0xe0c, 11, "MOVIEE02_STR"]]) {
    const row = movieRow(code);
    assert.ok(row, `0x${code.toString(16)} names a movie row`);
    assert.equal(row.index, index);
    assert.equal(row.file, file);
    const record = shippedRecord(row);
    assert.ok(record, `no shipped stream for ${row.file} (disc file ${row.fileIndex})`);
    assert.equal(record.index, row.fileIndex, "the record carries the row's disc file index");
    assert.equal(record.file, `${file.replace(/_STR$/, "").toLowerCase()}.mp4`);
    assert.equal(record.sectors, record.counts.video + record.counts.audio + record.counts.zero,
      "the whole stream was read");
    assert.equal(record.rawSha256.length, 64);
    const path = `web/assets/movie/${record.file}`;
    assert.ok(existsSync(path), `${path} is shipped`);
    if (!isLfsPointer(path)) assert.equal(statSync(path).size, record.size, path);
  }
});

test("every movie row a played launch code reaches has a shipped stream", () => {
  for (const code of PLAYED_CODES) {
    const row = movieRow(code);
    assert.ok(row, `0x${code.toString(16)} names a row`);
    assert.ok(shippedRecord(row), `0x${code.toString(16)} -> ${row.file} has no shipped stream`);
  }
});

test("the ending records are the disc's own rows", () => {
  // The table's rows 10/11: file 0x7F3 MOVIEE01_STR / 0x8A5 MOVIEE02_STR
  // (pro/stdwtitl.s .L0x00005060/.L0x0000506c; engine/dw3/movie-destinations.ts).
  assert.equal(MOVIE_ROWS[10].file, "MOVIEE01_STR");
  assert.equal(MOVIE_ROWS[10].fileIndex, 2035);
  assert.equal(MOVIE_ROWS[11].file, "MOVIEE02_STR");
  assert.equal(MOVIE_ROWS[11].fileIndex, 2213);
  assert.equal(shippedRecord(MOVIE_ROWS[10]).index, 2035);
  assert.equal(shippedRecord(MOVIE_ROWS[11]).index, 2213);
});

test("each shipped stream carries at least the pictures its row counts", () => {
  for (const code of PLAYED_CODES) {
    const row = movieRow(code);
    const record = shippedRecord(row);
    assert.ok(record.frames >= row.frames,
      `${row.file}: the stream carries ${record.frames} pictures, the row counts ${row.frames}`);
  }
  // The regression: MOVIEE02_STR's 1665 stream pictures must all be in the
  // derivative, so the row's 1649th picture exists when the count ends the
  // play (the extractor measures the frame numbers and cuts at the video's
  // end, not at the early-ending audio).
  const ending = shippedRecord(movieRow(0xe0c));
  assert.equal(ending.frames, 1665, "MOVIEE02_STR carries all 1665 stream pictures");
  assert.equal(shippedRecord(movieRow(0xe0b)).frames, 671, "MOVIEE01_STR carries all 671");
});
