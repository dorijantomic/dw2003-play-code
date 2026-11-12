// The shipped movie assets, by row: every movie row the walker's implemented
// launch codes can reach must resolve to a stream in
// web/assets/movie/manifest.json.
//
//   * rows 0/1 (MOVIEOP2/MOVIEOPN): the title's attract loop, launch codes
//     0xE01/0xE02;
//   * row 2 (MOVIED01_STR): the post-game story handoff — the s780 reunion's
//     event 1500 hands off 0xE03 = STTITL mode 3 = row 2, whose return 0x207
//     is re-pointed to 0x276 at master ordinal 0x2d (web/game.js
//     doStoryHandoff plays it through the shared field movie chain);
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
import { FieldMoviePlayer, movieReturnScreen, movieRow, movieRowForLanguage } from "../engine/index.ts";
import { movieRecordFor } from "../web/field-movie.js";
import { MOVIE_ROWS } from "../engine/dw3/movie-destinations.ts";

const manifest = JSON.parse(readFileSync("web/assets/movie/manifest.json", "utf8"));

const shippedRecord = (row) => movieRecordFor(manifest, row);

/** A clone without `git lfs pull` leaves pointer files where the streams go;
 *  the manifest is still the contract, but its size only matches the real
 *  stream. */
function isLfsPointer(path) {
  return readFileSync(path).subarray(0, 40).toString("utf8").startsWith("version https://git-lfs");
}

// The launch codes whose rows the walker plays: the two openings, the
// post-game story handoff, the ordinal-43 field movie and the two ending rows.
const PLAYED_CODES = [0xe01, 0xe02, 0xe03, 0xe0a, 0xe0b, 0xe0c];

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

// The story handoffs 0xE04-0xE09 (wstag s805, s295, s206, s311, s815) play rows
// 3-8 = MOVIED02..MOVIED07 (disc files 2034, 2027-2031).
test("story handoffs 0xE04-0xE09 resolve to MOVIED02-07, no 'No shipped asset' skip", () => {
  const files = [2034, 2027, 2028, 2029, 2030, 2031];
  for (let i = 0; i < 6; i++) {
    const code = 0xe04 + i;
    const row = movieRow(code);
    assert.ok(row, `0x${code.toString(16)} names a row`);
    assert.equal(row.index, 3 + i);
    assert.equal(row.fileIndex, files[i]);
    assert.equal(row.file, `MOVIED0${2 + i}_STR`);
    const record = shippedRecord(row);
    assert.ok(record, `No shipped asset for ${row.file} (disc file ${row.fileIndex})`);
    assert.equal(record.file, `movied0${2 + i}.mp4`);
    assert.ok(existsSync(`web/assets/movie/${record.file}`));
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

test("the post-game story handoff's row ships and resolves where the disc sends it", () => {
  // The s780 reunion (event 1500) hands off 0xE03 = STTITL mode 3 = movie row
  // 2 = MOVIED01_STR (pro/stdwtitl.s .L0x00005000; web/game.js doStoryHandoff
  // plays it through the shared field movie chain before routing). Below the
  // post-game marker the row's own return 0x207 stands; at master ordinal 0x2d
  // it is re-pointed to 0x276 = screen 630 = the {226, alt 925} row — the
  // alias stage s925 (engine/dw3/screen-routing.ts).
  const row = movieRow(0xe03);
  assert.ok(row, "0xE03 names a movie row");
  assert.equal(row.index, 2, "the launch code's low byte minus one");
  assert.equal(row.file, "MOVIED01_STR");
  assert.equal(row.fileIndex, 2026, "the row's own disc file index");
  assert.equal(row.frames, 465, "row 2's own picture count");
  assert.equal(row.destination, 0x207, "the row's tabled return selector");
  assert.equal(movieReturnScreen(0xe03, false), 0x207);
  assert.equal(movieReturnScreen(0xe03, true), 0x276, "the post-game re-pointing");
  const record = shippedRecord(row);
  assert.ok(record, "no shipped stream for MOVIED01_STR (disc file 2026)");
  assert.equal(record.index, 2026, "the record carries the row's disc file index");
  assert.equal(record.file, "movied01.mp4");
  assert.equal(record.sectors, record.counts.video + record.counts.audio + record.counts.zero,
    "the whole stream was read");
  assert.equal(record.rawSha256.length, 64);
  const path = `web/assets/movie/${record.file}`;
  assert.ok(existsSync(path), `${path} is shipped`);
  if (!isLfsPointer(path)) assert.equal(statSync(path).size, record.size, path);
  // The player counts the row's 465 pictures against the stream; an encode cut
  // before that (the MOVIEE02 tail regression's class) would stall the movie.
  assert.ok(record.frames >= row.frames,
    `movied01.mp4 carries ${record.frames} pictures, the row counts ${row.frames}`);
});

test("row 11 loads the file the language byte picks: 0 jpn 02, 1 usa 03, anything else 04", () => {
  // F0x80083cc0's mode-11 switch on D0x8005CCA8 (exe-decomp/stdwtitl_c/
  // F0x80083cc0.c; stdwtitl.norm.s .L0x0000506c-.L0x0000508c): three triples,
  // the same 0x671 = 1649 frames and the same return 0x2d7 in each. Driven
  // through the real player's open(), then each pick must resolve to a shipped stream.
  const expected = [[0, 2213, "MOVIEE02_STR", "moviee02.mp4"], [1, 2071, "MOVIEE03_STR", "moviee03.mp4"],
    [2, 2070, "MOVIEE04_STR", "moviee04.mp4"], [5, 2070, "MOVIEE04_STR", "moviee04.mp4"]];
  for (const [language, fileIndex, file, mp4] of expected) {
    const player = new FieldMoviePlayer();
    const row = player.open(0xe0c, language);
    assert.equal(row.index, 11);
    assert.equal(row.fileIndex, fileIndex, `language ${language}`);
    assert.equal(row.file, file, `language ${language}`);
    assert.equal(row.frames, 1649);
    assert.equal(row.destination, 0x2d7);
    assert.equal(movieRowForLanguage(movieRow(0xe0c), language).file, file);
    const record = shippedRecord(row);
    assert.equal(record.file, mp4, `language ${language} ships ${mp4}`);
    assert.ok(record.frames >= row.frames);
    assert.ok(existsSync(`web/assets/movie/${mp4}`));
  }
  // The default (no byte given) is English = MOVIEE04.
  assert.equal(new FieldMoviePlayer().open(0xe0c).file, "MOVIEE04_STR");
  // No other row has a language arm: every other row is itself.
  for (let code = 0xe01; code <= 0xe0b; code++) {
    for (const language of [0, 1, 2, 5]) {
      assert.equal(new FieldMoviePlayer().open(code, language), movieRow(code), `row of 0x${code.toString(16)}`);
    }
  }
});
