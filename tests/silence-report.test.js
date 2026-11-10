// The Silence Report: what this build cannot sound, computed from the shipped
// tables and never hand-listed. The numbers are the ones measured on 2026-11-04
// (ideas/scout-audio-20261104-0313.md §C11, §D):
//
//   231 Sound-Test rows = 155 with a built common/area sample
//                       +  70 music starts with a stem (bank + sequence)
//                       +   1 playable only as its bank's theme (TRAINING -> bgm031)
//                       +   5 with no built audio at all (COM_CNFS, DIGM_DIG,
//                           BGM00001, BGM00002, EAUCTION; the game really fires
//                           the first and the last of those).
//
// This file proves the pure classification, the three gap lists, the movie rows
// and the alternates, the F2 switch that keeps the page off by default, and the
// printer tool. Every expected name is read back from the shipped data (the
// blurb above is the explanation, never the input).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
    altGaps, bankGaps, coverage, movieGaps, themeGaps,
    MOVIE_GAP_ROWS, MOVIE_VARIANTS, START_WORDS,
} from "../web/silence-report.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const text = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const ROOT = fileURLToPath(new URL("..", import.meta.url));

const catalogue = read("../web/assets/data/soundtst_catalogue.json");
const common = read("../web/assets/sfx/manifest.json");
const area = read("../web/assets/sfx/area_manifest.json");
const stems = read("../web/assets/music/index.json");
const archives = read("../web/assets/data/map_sound_archives.json");
const movies = read("../web/assets/movie/manifest.json").movies;
const manifest = read("../web/assets/manifest.json");
const maps = manifest.maps || manifest;

const cov = coverage({ catalogue, common, area, stems, startWords: START_WORDS });

// The archive number a play word addresses -> the bank name the disc gives it,
// derived from the catalogue's own archive_id column (never a name list).
const bankOfArchive = {};
for (const c of catalogue.categories) bankOfArchive[c.archive_id] = String(c.name).toLowerCase();

test("the 231 Sound-Test rows split 155 sample + 70 stem + 1 bank theme + 5 silent", () => {
    // The catalogue itself is the whole input: 71 categories, 231 rows.
    assert.equal(cov.rows, 231, "the overlay's 231 rows");
    assert.equal(cov.rows, catalogue.categories.reduce((n, c) => n + c.sounds.length, 0), "no row invented or dropped");
    assert.equal(cov.sample, 155, "rows whose own bank holds a built sample");
    assert.equal(cov.stem, 70, "music starts with a rendered stem by the bank+sequence rule");
    assert.equal(cov.bankTheme, 1, "one row playable only as its bank's theme");
    assert.equal(cov.silent.length, 5, "five rows with no built audio");
    assert.equal(cov.sample + cov.stem + cov.bankTheme + cov.silent.length, cov.rows, "the four marks partition the rows");
});

test("the five silent rows are exactly the ones the data leaves over", () => {
    assert.deepEqual(cov.silent.map((r) => r.name), ["COM_CNFS", "DIGM_DIG", "BGM00001", "BGM00002", "EAUCTION"]);
    assert.deepEqual(cov.silent.map((r) => r.id), ["0x60040000", "0x80045e48", "0x60a40001", "0x60a40002", "0x61080000"]);

    // Nothing that the sample manifests can answer may be called silent, and no
    // silent id may resolve through the one packed-sound lookup the screens use.
    const ids = new Set();
    for (const rows of Object.values(area)) for (const meta of Object.values(rows)) ids.add(String(meta.id).toLowerCase());
    for (const meta of Object.values(common)) ids.add(String(meta.id).toLowerCase());
    for (const row of cov.silent) assert.equal(ids.has(row.id), false, `${row.name} really has no built sample`);

    // Two of them are cues the original game really fires: the confusion swap
    // (live capture) and the auction (engine/systems/auction.ts asks for no
    // sound). Those are the only two the page may flag as "the game plays this".
    assert.deepEqual(cov.silent.filter((r) => r.fires).map((r) => r.name), ["COM_CNFS", "EAUCTION"]);
    for (const row of cov.silent) {
        assert.equal(typeof row.category, "string");
        assert.ok(row.why.length > 0, `${row.name} says why it is silent`);
        if (row.fires) assert.ok(row.how.trim(), `${row.name} says where the game fires it`);
    }
});

test("TRAINING is the one row served by its bank's theme, bgm031", () => {
    assert.equal(cov.bankTheme, 1);
    assert.equal(cov.themes.length, 1);
    const [theme] = cov.themes;
    assert.deepEqual({ category: theme.category, name: theme.name, id: theme.id, stem: theme.stem },
        { category: "BGM031", name: "TRAINING", id: "0x60840002", stem: "bgm031" });
    assert.ok(stems.includes(theme.stem), "the approximation names a stem that was really rendered");
    // It is not a sample row, and not one of the five with no sound at all.
    assert.equal(cov.silent.some((r) => r.name === "TRAINING"), false);
    // The stem naming is build_music.py's own: seq 0 keeps the plain bank name,
    // any other sequence gets "<bank>_<seq>".
    assert.equal(theme.stem, "bgm031", "the train bank's theme was rendered as the plain stem");
});

test("every stem row names a stem the build really has", () => {
    const have = new Set(stems.map((s) => String(s).toLowerCase()));
    const stemRows = cov.marks.filter((m) => m.kind === "stem");
    assert.equal(stemRows.length, 70);
    for (const row of stemRows) assert.ok(have.has(row.stem), `${row.name} -> ${row.stem} is in music/index.json`);
    // And every other mark is one of the four kinds — nothing falls through.
    for (const row of cov.marks) assert.ok(["sample", "stem", "bankTheme", "silent"].includes(row.kind), `${row.name}: ${row.kind}`);
});

test("bankGaps names the 13 catalogue categories with no built bank; 12 are stage banks", () => {
    const gaps = bankGaps(archives, area, catalogue);
    const built = new Set(Object.keys(area).map((k) => k.toLowerCase()));
    const expected = catalogue.categories.map((c) => String(c.name).toLowerCase()).filter((n) => !built.has(n));
    assert.equal(expected.length, 13, "the shipped manifests leave exactly 13 categories unbanked");
    assert.deepEqual([...gaps.missing].sort(), [...expected].sort(), "every unbanked category and nothing else");
    assert.deepEqual([...gaps.missing].sort(), ["env004", "env005", "env007", "env008", "env009", "env012",
        "env014", "env015", "env016", "env020", "env022", "env023", "ttlbgm"]);

    // 12 of the 13 are stage archives: a stage really loads that bank.
    const stageBanks = new Set(Object.values(archives).map((r) => String(r.bank).toLowerCase()));
    assert.equal(gaps.stageBanks.length, 12);
    assert.deepEqual([...gaps.stageBanks].sort(), [...expected].filter((n) => stageBanks.has(n)).sort());
    assert.deepEqual(gaps.stageBanks.slice().sort(), ["env004", "env005", "env007", "env008", "env009", "env012",
        "env014", "env015", "env016", "env020", "env022", "env023"]);
    // ttlbgm is the one that is not a stage bank: its theme is a music stem.
    assert.deepEqual(gaps.other, ["ttlbgm"]);
    assert.ok(stems.includes("ttlbgm"));

    // Every other category has a bank of its own.
    assert.equal(gaps.banked, 71 - 13);
    for (const c of catalogue.categories) {
        const name = String(c.name).toLowerCase();
        if (gaps.missing.includes(name)) continue;
        assert.ok(built.has(name), `${name} has a built bank`);
    }
});

test("themeGaps is exactly s260", () => {
    assert.deepEqual(themeGaps(archives, maps), ["s260"]);
    const s260 = maps.find((m) => m.id === "s260");
    assert.ok(s260, "the map is shipped");
    assert.equal(s260.music ?? null, null, "its manifest row carries music: null");
    assert.equal(archives.s260, undefined, "and no stage archive record names a theme for it");
    // Every other map has both a record and a theme name.
    for (const m of maps) {
        if (m.id === "s260") continue;
        assert.ok(archives[m.id], `${m.id} has a stage sound archive`);
        assert.ok(m.music, `${m.id} names a theme`);
    }
});

test("movieGaps: 5 shipped of 12 rows, MOVIED01-07 missing, MOVIEE03/04 are language variants", () => {
    assert.deepEqual(MOVIE_GAP_ROWS, ["MOVIED01", "MOVIED02", "MOVIED03", "MOVIED04", "MOVIED05", "MOVIED06", "MOVIED07"]);
    assert.deepEqual(MOVIE_VARIANTS, ["MOVIEE03", "MOVIEE04"]);
    const gaps = movieGaps(MOVIE_GAP_ROWS, movies);
    assert.equal(gaps.rows, 12, "the title overlay's 12-row movie table");
    assert.equal(gaps.shipped, 5, "five streams ship");
    assert.deepEqual(gaps.shippedRows.slice().sort(), ["MOVIED08", "MOVIEE01", "MOVIEE02", "MOVIEOP2", "MOVIEOPN"]);
    assert.deepEqual(gaps.missing, MOVIE_GAP_ROWS, "the seven D rows have no stream");
    assert.deepEqual(gaps.variants, MOVIE_VARIANTS, "E03/E04 are language variants of E02's row, not rows");
    // Every shipped stream is one of the rows the table names, and every row is
    // either shipped or missing — the two lists partition the table.
    const rowNames = new Set([...gaps.shippedRows.map((n) => n.toLowerCase()), ...gaps.missing.map((n) => n.toLowerCase())]);
    for (const key of Object.keys(movies)) assert.ok(rowNames.has(key.toLowerCase()), `${key} is a row of the table`);
    assert.equal(gaps.shippedRows.length + gaps.missing.length, gaps.rows);
});

test("altGaps: 62 alternates nothing plays, 61 bgm029 + 1 env001_3, every stem present", () => {
    // The alternates are the second play id 62 stage writers carry.
    const alts = [];
    for (const [stage, rec] of Object.entries(archives)) for (const alt of rec.alt_play_ids ?? []) alts.push([stage, alt]);
    assert.equal(alts.length, 62);
    assert.deepEqual([...new Set(alts.map(([, a]) => a))].sort(), ["0x607c0000", "0x60a40003"]);

    const gaps = altGaps(archives, catalogue, stems);
    assert.equal(gaps.count, 62, "one row per alternate play id");
    assert.deepEqual(gaps.byStem, { bgm029: 61, env001_3: 1 });
    assert.deepEqual(gaps.missing, [], "every alternate names a stem the build has");
    for (const row of gaps.rows) {
        assert.ok(stems.includes(row.stem), `${row.stage}: ${row.word} -> ${row.stem} exists`);
        assert.equal(row.present, true);
        assert.equal(row.stem, row.word === "0x607c0000" ? "bgm029" : "env001_3");
        assert.equal(bankOfArchive[(parseInt(row.word, 16) >>> 18) & 0x7f] !== undefined, true);
    }
});

test("the printer reads the same shipped tables and prints one labelled line per number", () => {
    assert.ok(existsSync("tools/check_sound_coverage.mjs"), "the printer exists");
    const tool = fileURLToPath(new URL("../tools/check_sound_coverage.mjs", import.meta.url));
    const r = spawnSync(process.execPath, [tool], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const out = r.stdout;
    for (const line of [
        /^rows 231$/m, /^sample 155$/m, /^stem 70$/m, /^bank-theme 1$/m, /^silent 5$/m,
        /^no-bank categories 13$/m, /^unbuilt stage banks 12$/m, /^no-theme maps 1$/m, /^missing movie rows 7$/m,
    ]) assert.match(out, line, `the printer prints ${line}`);

    const json = spawnSync(process.execPath, [tool, "--json"], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
    assert.equal(json.status, 0, json.stderr || json.stdout);
    const report = JSON.parse(json.stdout);
    assert.equal(report.rows, 231);
    assert.equal(report.sample, 155);
    assert.equal(report.stem, 70);
    assert.equal(report.bankTheme, 1);
    assert.equal(report.silent, 5);
    assert.equal(report.noBankCategories, 13);
    assert.equal(report.stageBanks, 12);
    assert.equal(report.noThemeMaps, 1);
    assert.equal(report.missingMovieRows, 7);

    // The printer and the page only read: no write call anywhere in the silence files.
    const sources = [text("../tools/check_sound_coverage.mjs"), text("../web/silence-report.js"), text("../web/silence-report.html")];
    for (const src of sources) assert.doesNotMatch(src, /writeFile|appendFile|createWriteStream|mkdirSync|unlinkSync|localStorage/,
        "nothing in the report writes an asset or storage");
});

test("the page fetches only web/assets and never the walker folder", () => {
    assert.ok(existsSync("web/silence-report.html"));
    const html = text("../web/silence-report.html");
    assert.match(html, /from "\.\/silence-report\.js"/, "the page draws from the pure module");
    assert.match(html, /Silence Report/);
    for (const file of ["assets/data/soundtst_catalogue.json", "assets/sfx/manifest.json", "assets/sfx/area_manifest.json",
        "assets/music/index.json", "assets/data/map_sound_archives.json", "assets/movie/manifest.json", "assets/manifest.json"]) {
        assert.ok(html.includes(file), `the page reads ${file}`);
    }
    const fetches = [...html.matchAll(/"([^"\s]+\.json)"/g)].map((m) => m[1]);
    assert.ok(fetches.length >= 7, "seven shipped files");
    for (const url of fetches) assert.match(url, /^assets\//, `${url} is a shipped asset, not a folder on this machine`);
    assert.doesNotMatch(html, /ddw3-walker|\/home\/dorij|\/mnt\/[a-z]/, "the page never reaches the walker or the disc");
    // A printer: the page can be printed on paper.
    assert.match(html, /window\.print\(\)/);
});

test("the F2 pair and the gated page branch (off by default, no URL flag)", () => {
    const ambience = text("../web/ambience.js");
    assert.ok(ambience.includes('["silence", "Silence report (dev)"]'), "the Extras row has the pair");
    assert.match(ambience, /const EXPERIMENTAL = \[[^\]]*"silence"/, "silence is off until switched on");
    const devModel = text("../web/dev-panel-model.js"), devPanel = text("../web/dev-panel.js");
    assert.match(devModel, /silence: P\("silence-report\.html"/, "the Open button's page is in the F2 page model");
    assert.match(ambience, /if \(!o \|\| !fx\[key\]\) return;/, "opened only behind the switch (the Open guard)");
    assert.match(devPanel, /b\.disabled = !fx\[/, "the Open button is disabled while the switch is off");
    assert.doesNotMatch(ambience, /q\.(has|get)\("silence"\)/, "never a URL flag");
    assert.doesNotMatch(text("../web/silence-report.html"), /location\.search/, "the page has no flag of its own");
});
