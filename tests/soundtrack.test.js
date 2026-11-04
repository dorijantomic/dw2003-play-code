// The Soundtrack Room: the disc's whole soundtrack, grouped the way a fan
// thinks of it. Field themes are grouped by the places whose stage entry asks
// for them (map_sound_archives.json's play id — low 16 bits pick the sequence,
// docs/research/ui/music.md), battle themes by the stages whose encounter
// screens trigger them (battle_music.json), and the rest are the jingles and
// one-shots that are neither. This file proves the pure grouping, the stem
// naming, the play mode, and the F2 gate that keeps the page off by default.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { soundtrackRows, stemOfPlayId, playMode } from "../web/soundtrack.js";
import { packedArchive } from "../web/packed-sound.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const stems = read("../web/assets/music/index.json");
const mapArchives = read("../web/assets/data/map_sound_archives.json");
const battleMusic = read("../web/assets/data/battle_music.json");
const manifest = read("../web/assets/manifest.json");
const maps = manifest.maps || manifest;
const rows = soundtrackRows({ stems, mapArchives, maps, battleMusic });
const byKind = (kind) => rows.filter((r) => r.kind === kind);

// The archive number a play id addresses -> the bank name the disc gives that
// archive. Built here from the shipped data, never from a name list in the code.
const archiveToBank = {};
for (const e of Object.values(mapArchives)) archiveToBank[e.archive] = e.bank;

test("the disc's 77 stems are each one row, and the three kinds partition them", () => {
    assert.equal(stems.length, 77, "the built music index holds 77 stems");
    assert.equal(rows.length, 77, "one row per stem");
    const tracks = rows.map((r) => r.track);
    assert.equal(new Set(tracks).size, 77, "each track appears once");
    for (const t of tracks) assert.ok(stems.includes(t), `${t} is one of index.json's stems — no row invents a track`);
    assert.deepEqual([...new Set(rows.map((r) => r.kind))].sort(), ["battle", "field", "jingle"]);
    assert.equal(byKind("field").length + byKind("battle").length + byKind("jingle").length, 77);
    for (const r of rows) {
        assert.equal(typeof r.label, "string");
        assert.ok(r.label.length > 0, `${r.track} carries a label a fan can read`);
        assert.ok(Array.isArray(r.stages) && Array.isArray(r.screens), `${r.track} has both lists`);
    }
});

test("field rows: one per place theme, all 293 stage entries, real place names", () => {
    const field = byKind("field");
    assert.equal(field.length, 56, "56 tones play somewhere on the world map");
    assert.equal(field.reduce((n, r) => n + r.stages.length, 0), 293, "every stage archive entry lands on a row");
    assert.equal(field.reduce((n, r) => n + r.screens.length, 0), 0, "field rows carry no battle screens");

    const fieldRow = (stage) => rows.find((r) => r.kind === "field" && r.stages.includes(stage));
    const s200 = fieldRow("s200");
    assert.deepEqual({ track: s200.track, kind: s200.kind }, { track: "bgm001", kind: "field" });
    assert.match(s200.label, /Asuka City/, "s200's theme names its place");

    const s780 = fieldRow("s780");
    assert.deepEqual({ track: s780.track, kind: s780.kind }, { track: "env001", kind: "field" });
    assert.match(s780.label, /Kusanagi City/);

    const s212 = fieldRow("s212");
    assert.equal(s212.track, "env205_3");
    assert.equal(mapArchives.s212.play_id, "0x610c0003");
    assert.equal(parseInt(mapArchives.s212.play_id, 16) & 0xffff, 3, "the low 16 bits pick sequence 3");
    const rowOf = (stage) => fieldRow(stage);
    assert.equal(rowOf("s261").track, "env204_2");
    assert.equal(rowOf("s820").track, "env206_1");
    assert.equal(rowOf("s750").track, "env024_1");
    const env204 = rows.find((r) => r.track === "env204_2");
    const env206 = rows.find((r) => r.track === "env206_1");
    const env024 = rows.find((r) => r.track === "env024_1");
    assert.ok(env204.stages.includes("s261"));
    assert.ok(env206.stages.includes("s820"));
    assert.ok(env024.stages.includes("s750"));
    // Six stage entries play a non-zero sequence, but two sequence stems are
    // each shared by two stages (env204_2, env024_1) — 56 rows, not 58.
    assert.equal(Object.values(mapArchives).filter((e) => (parseInt(e.play_id, 16) & 0xffff) !== 0).length, 6);
});

test("stemOfPlayId names a sequence from the archive's bank and the low bits", () => {
    assert.equal(stemOfPlayId(0x60100000, archiveToBank), "bgm001", "sequence 0 is the bank itself");
    assert.equal(stemOfPlayId(0x60a40000, archiveToBank), "env001");
    assert.equal(packedArchive(0x610c0003), 67);
    assert.equal(stemOfPlayId(0x610c0003, archiveToBank), "env205_3", "sequence 3 of env205");
});

test("battle rows: one per battle bank, 310 screens across 128 stages", () => {
    const battle = byKind("battle");
    assert.equal(battle.length, 7, "batl00, batl10 and boss00..04");
    assert.deepEqual(battle.map((r) => r.track).sort(), ["batl00", "batl10", "boss00", "boss01", "boss02", "boss03", "boss04"]);
    assert.equal(battle.reduce((n, r) => n + r.screens.length, 0), 310, "every battle-trigger record lands on a row");
    assert.equal(Object.keys(battleMusic).length, 128);
    const stages = new Set(battle.flatMap((r) => r.stages));
    assert.equal(stages.size, 128, "the stages holding those screens");
    for (const r of battle) {
        for (const s of r.screens) {
            assert.equal(typeof s.stage, "string");
            assert.equal(typeof s.screen, "number");
        }
        assert.equal(new Set(r.stages).size, r.stages.length, "stage list is unique");
        for (const s of r.screens) assert.ok(r.stages.includes(s.stage), "a screen's stage is on the row");
    }

    const batl00 = battle.find((r) => r.track === "batl00");
    const batl10 = battle.find((r) => r.track === "batl10");
    assert.deepEqual(batl00.screens.filter((s) => s.stage === "s200").map((s) => s.screen), [188, 200]);
    assert.deepEqual(batl10.screens.filter((s) => s.stage === "s200").map((s) => s.screen), [272]);
    assert.ok(!batl00.screens.some((s) => s.stage === "s200" && s.screen === 272), "the boss screen stays on batl10");
});

test("the leftovers are the 14 jingles and one-shots", () => {
    const jingle = byKind("jingle");
    assert.equal(jingle.length, 14, "77 - 56 field - 7 battle");
    for (const t of ["confus", "ttlbgm", "gameover", "bgm030", "bgm031"]) {
        assert.ok(jingle.some((r) => r.track === t), `${t} is a jingle`);
    }
    for (const r of jingle) {
        assert.equal(r.stages.length, 0);
        assert.equal(r.screens.length, 0);
        assert.ok(!byKind("field").some((f) => f.track === r.track), "a jingle is not also a field theme");
        assert.ok(!byKind("battle").some((b) => b.track === r.track), "a jingle is not also a battle theme");
    }
});

test("field and battle themes loop; jingles ring once", () => {
    assert.equal(playMode("field"), "loop");
    assert.equal(playMode("battle"), "loop");
    assert.equal(playMode("jingle"), "jingle");
});

test("the page plays through the game's own bgm player and is only linked from the gated F2 row", () => {
    const page = readFileSync(new URL("../web/soundtrack.html", import.meta.url), "utf8");
    assert.match(page, /import\s*\{[^}]*createBgmPlayer[^}]*\}\s*from\s*"\.\/audio\.js"/, "the page plays through web/audio.js");
    assert.match(page, /import\s*\{[^}]*soundtrackRows[^}]*\}\s*from\s*"\.\/soundtrack\.js"/);
    assert.match(page, /playJingle/, "jingles ring through the one-shot path");
    assert.match(page, /playMode/, "the row's own kind picks play or playJingle");

    const ambience = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");
    assert.match(ambience, /\["soundtrack", "Soundtrack room"\]/, "the F2 Extras row");
    const experimental = ambience.match(/const EXPERIMENTAL = \[([^\]]*)\];/);
    assert.ok(experimental, "EXPERIMENTAL is still one array literal");
    assert.match(experimental[1], /"soundtrack"/, "off until the player switches it on");

    const refs = ambience.split("soundtrack.html").length - 1;
    assert.equal(refs, 1, "one reference to the page, no other link into it");
    assert.match(ambience, /if \(fx\.soundtrack\)[^;{}]*window\.open\("soundtrack\.html"/, "opened only behind the toggle's guard");
    assert.doesNotMatch(ambience, /(get|has)\("soundtrack"\)/, "never a URL flag");
    assert.match(ambience, /#fx-soundtrack/, "the gated button row");
});
