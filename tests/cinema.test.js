// The Cinema room: the five movie streams the disc ships, on one page, each
// played through the player the game already uses for it.
//
// The five streams and their launch codes are the disc's own:
//   * rows 0/1 — MOVIEOP2_STR / MOVIEOPN_STR, the two openings, launch codes
//     0xE01 / 0xE02, which the title screen's attract loop hands to the title
//     movie player (web/title-movie.js);
//   * row 9 — MOVIED08_STR, the ordinal-43 field movie, 0xE0A, the field movie
//     player (web/field-movie.js);
//   * rows 10/11 — MOVIEE01_STR / MOVIEE02_STR, the two ending streams, 0xE0B /
//     0xE0C, the same field player.
// The table is engine/dw3/movie-destinations.ts (pro/stdwtitl.s
// .L0x00004fe8-.L0x00005074, twelve 12-byte rows read by F0x80083CC0); the
// shipped streams are web/assets/movie/manifest.json.
//
// Two picture counts matter and the room lists both: the player ends on the
// ROW's count (the movie object's own counter, stdwtitl.s .L0x00000960-.L0x00000988),
// while the stream carries a few more pictures than that.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cinemaRows, rowFor } from "../web/cinema.js";
import { movieRow } from "../engine/index.ts";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const manifest = JSON.parse(read("../web/assets/movie/manifest.json"));

// The room's list, built the way web/cinema.html builds it: the disc's rows,
// named by the five launch codes, resolved against the shipped manifest.
const CODES = [0xe01, 0xe02, 0xe0a, 0xe0b, 0xe0c];
const rows = cinemaRows(manifest, CODES.map(movieRow));

const hex = (code) => `0x${code.toString(16)}`;

test("the room lists the disc's five streams, in the disc's order, each through its own player", () => {
    assert.equal(rows.length, 5, "five rows");
    assert.deepEqual(rows.map((r) => r.code), CODES, "the disc's launch codes, in order");
    assert.deepEqual(rows.map((r) => r.adapter), ["title", "title", "field", "field", "field"],
        "the openings play through the title player, the other three through the field player");
    assert.deepEqual(rows.map((r) => r.label), [
        "Opening — the first",
        "Opening — the second",
        "The field movie (ordinal 43)",
        "Ending — part one",
        "Ending — part two",
    ]);
    assert.deepEqual(rows.map((r) => r.key), ["movieop2", "movieopn", "movied08", "moviee01", "moviee02"],
        "the row is keyed by the manifest's own movie name");
    for (const row of rows) {
        assert.equal(typeof row.file, "string");
        assert.ok(row.file.endsWith(".mp4"), `${hex(row.code)} names an mp4`);
    }
});

test("the row's stop count and the stream's own count are both carried", () => {
    assert.deepEqual(rows.map((r) => r.rowFrames), [1776, 1776, 434, 655, 1649],
        "the counts the movie rows carry (engine/dw3/movie-destinations.ts)");
    assert.deepEqual(rows.map((r) => r.streamFrames), [1792, 1792, 450, 671, 1665],
        "the counts the shipped streams carry (web/assets/movie/manifest.json)");
    for (const row of rows) {
        assert.ok(row.streamFrames >= row.rowFrames,
            `${row.file}: the stream carries ${row.streamFrames} pictures, the player stops at ${row.rowFrames}`);
    }
});

test("every row resolves to the disc's own file index and a shipped stream", () => {
    const indices = [2380, 2036, 2032, 2035, 2213];
    assert.deepEqual(rows.map((r) => movieRow(r.code).fileIndex), indices,
        "each code names the movie row the disc's table holds");
    for (const row of rows) {
        const disc = movieRow(row.code);
        const record = manifest.movies[row.key];
        assert.ok(record, `${row.key} is a record of the shipped manifest`);
        assert.equal(record.index, disc.fileIndex, `${row.key}: the manifest record is the disc's file`);
        assert.equal(record.file, row.file, `${row.key}: the row plays the shipped file`);
        assert.equal(record.frames, row.streamFrames, `${row.key}: streamFrames is the stream's own count`);
    }
});

test("no row invents a stream: the five rows are exactly the manifest's five movies", () => {
    const shipped = Object.values(manifest.movies).map((m) => m.file).sort();
    assert.deepEqual(rows.map((r) => r.file).sort(), shipped, "the room lists every shipped stream and nothing else");
    assert.equal(Object.keys(manifest.movies).length, 5, "the disc ships five movie streams");
    for (const row of rows) assert.ok(shipped.includes(row.file), `${row.file} is shipped`);
});

test("rowFor names one of the five by its launch code", () => {
    const field = rowFor(0xe0a);
    assert.deepEqual({ key: field.key, label: field.label, code: field.code, adapter: field.adapter },
        { key: "movied08", label: "The field movie (ordinal 43)", code: 0xe0a, adapter: "field" },
        "the room's own row, without the data looked up");
    assert.equal(rowFor(0xe0c, rows).file, "moviee02.mp4", "the full row when the list is given");
    assert.equal(rowFor(0xe0c, rows).streamFrames, 1665);
    assert.equal(rowFor(0xe99), null, "a code the room does not list names no row");
});

test("the page plays through both existing players and stays on the page at the end", () => {
    const page = read("../web/cinema.html");
    assert.match(page, /import\s*\{[^}]*createTitleMoviePlayer[^}]*\}\s*from\s*"\.\/title-movie\.js"/,
        "the openings play through the title player");
    assert.match(page, /import\s*\{[^}]*createFieldMoviePlayer[^}]*\}\s*from\s*"\.\/field-movie\.js"/,
        "the field movie and the endings play through the field player");
    assert.match(page, /import\s*\{[^}]*cinemaRows[^}]*\}\s*from\s*"\.\/cinema\.js"/, "the list is the pure module");
    assert.match(page, /movieRow/, "the disc's row table comes through web/vendor/engine.js");
    assert.match(page, /open\(code\)/, "a launch code is opened by the code the row carries");
    assert.match(page, /draw\(ctx, 960, 672\)/, "the page draws the movie into its own canvas");
    assert.match(page, /requestAnimationFrame/, "one animation loop draws the picture");
    // The end stays on the page: the row's return selector is never followed and
    // nothing navigates away.
    assert.doesNotMatch(page, /destination/, "the row's return selector is not read");
    assert.doesNotMatch(page, /location\.(href|assign|replace)|window\.close/, "nothing navigates or closes");
    // START and Back both end the movie early, back to the list.
    assert.match(page, /skip\(\)/, "START / Back end the movie through the player's own skip");
});

test("the page and the module write nothing and touch no flag", () => {
    for (const [name, text] of [["cinema.html", read("../web/cinema.html")], ["cinema.js", read("../web/cinema.js")]]) {
        assert.doesNotMatch(text, /localStorage|sessionStorage/, `${name} stores nothing`);
        assert.doesNotMatch(text, /__story|storyFlag|S\.flags|__state/, `${name} sets no game flag`);
        assert.doesNotMatch(text, /method:\s*["'](POST|PUT|DELETE)["']/i, `${name} posts nothing`);
    }
});

test("the F2 Extras row is off by default and the page is only linked behind it", () => {
    const ambience = read("../web/ambience.js");
    assert.match(ambience, /\["cinema", "Cinema"\]/, "the Extras row");
    const experimental = ambience.match(/const EXPERIMENTAL = \[([^\]]*)\];/);
    assert.ok(experimental, "EXPERIMENTAL is still one array literal");
    assert.match(experimental[1], /"cinema"/, "off until the player switches it on");

    const refs = ambience.split("cinema.html").length - 1;
    assert.equal(refs, 1, "one reference to the page, no other link into it");
    assert.match(ambience, /if \(fx\.cinema\)[^;{}]*window\.open\("cinema\.html"/, "opened only behind the toggle's guard");
    assert.doesNotMatch(ambience, /(get|has)\("cinema"\)/, "never a URL flag");
    assert.match(ambience, /#fx-cinema/, "the gated button row");
    assert.match(ambience, /id="fx-cinema" hidden/, "the button row starts hidden, as the toggle does");
    assert.match(ambience, /const cinema = panel\.querySelector\("#fx-cinema"\); if \(cinema\) cinema\.hidden = !fx\.cinema;/,
        "refreshPanel follows the toggle");
    // `hidden` only hides an element while no stylesheet gives it a display
    // again: the panel styles its rows as flex, so the row's own rule must hand
    // a hidden row back to display:none (the label rows already do the same).
    assert.match(ambience, /#fx-panel \.row \{ display:flex/, "rows are laid out as flex");
    assert.match(ambience, /#fx-panel \.row\[hidden\] \{ display:none; \}/,
        "a hidden row is really hidden, so the toggle off leaves no button");
});
