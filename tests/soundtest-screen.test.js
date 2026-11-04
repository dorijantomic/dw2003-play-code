// The developers' own SOUND TEST screen, rebuilt from the decoded overlay
// (docs/research/audio/soundtst-full-decode-2026-08-05.md): 71 VAB categories,
// 231 sounds, an eight-row window, hold Circle to play, Square to stop, Cross
// back, Start to leave. This file proves the data catalogue the screen reads,
// the pure list helpers it draws from, the packed-sound lookup it plays
// through, and the F2 switch that keeps all of it off by default.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSoundTest, SOUNDTEST_ROWS, soundTestMove, soundTestPlayable, soundTestView } from "../web/soundtest.js";
import { packedIsMusicStart, packedSampleResolver } from "../web/packed-sound.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));

test("the built catalogue is the overlay's 71 categories and 231 sounds", () => {
    const catalogue = read("../web/assets/data/soundtst_catalogue.json");
    const categories = catalogue.categories;
    assert.equal(categories.length, 71, "71 VAB categories");
    assert.equal(catalogue.categoryCount, 71);
    const sounds = categories.flatMap((c) => c.sounds);
    assert.equal(sounds.length, 231, "231 sounds in the overlay's tables");
    assert.equal(catalogue.soundCount, 231);
    for (const c of categories) assert.equal(c.sounds.length, c.count, `${c.name} row count`);
    assert.equal(categories[0].name, "COMMON");
    assert.equal(categories[0].count, 113, "the always-resident common bank has 113 sounds");
    const last = categories.at(-1);
    assert.equal(last.category, 70);
    assert.equal(last.name, "TTLBGM");
    assert.equal(last.archive_id, 71);
    assert.equal(last.sounds[0].name, "TITLEBGM");
    assert.equal(last.sounds[0].id, "0x611c0000");
    const ids = sounds.map((s) => String(s.id).toLowerCase());
    assert.equal(new Set(ids).size, ids.length, "all 231 packed ids are distinct");
});

test("the eight-row window keeps an absolute cursor and slides", () => {
    const catalogue = read("../web/assets/data/soundtst_catalogue.json");
    assert.equal(SOUNDTEST_ROWS, 8, "the overlay's window is eight rows");

    const top = soundTestView(catalogue, 0, 0, 0);
    assert.equal(top.count, 113, "the common bank's 113 rows");
    assert.equal(top.rows.length, 8, "only the window is handed to the drawer");
    assert.equal(top.rows[0].text, "BT_LOOP0", "a sound row is the record name");
    assert.equal(top.rows[1].text, "BT_LOOP1");

    // The cursor is absolute: stepping from 0 to 8 pushes the window down one.
    let pos = { cursor: 0, scroll: 0 };
    for (let i = 0; i < 8; i++) pos = soundTestMove(pos.cursor, pos.scroll, 1, top.count);
    assert.deepEqual(pos, { cursor: 8, scroll: 1 });

    // At the end of the catalogue the cursor stops at its last row (230) and
    // the window shows that row's eight-row tail.
    const end = soundTestMove(0, 0, 9999, catalogue.soundCount);
    assert.equal(end.cursor, 230, "the last of the 231 sounds");
    assert.equal(end.scroll, 223);
    const tail = soundTestView(catalogue, 0, 112, 0);
    assert.equal(tail.rows.length, 8);
    assert.equal(tail.rows.at(-1).index, 112, "the common bank's last record");
    assert.equal(tail.rows.at(-1).text, "WNG_STEP");
});

test("the screen marks exactly the sample banks that were never extracted", () => {
    const catalogue = read("../web/assets/data/soundtst_catalogue.json");
    const area = read("../web/assets/sfx/area_manifest.json");
    // Compute the expectation from the two shipped lists, never from a list of
    // names in the screen: the built banks are area_manifest.json's own keys
    // (its "common" entry is the always-resident bank), and the one category
    // that is a music start instead of a sample -- the last one, TTLBGM -- is
    // not a missing sample.
    const built = new Set(Object.keys(area).map((k) => k.toLowerCase()));
    const last = catalogue.categories.at(-1);
    const expected = catalogue.categories
        .filter((c) => !built.has(c.name.toLowerCase()))
        .filter((c) => !(c === last && c.sounds.some((s) => packedIsMusicStart(parseInt(s.id, 16)))))
        .map((c) => c.name);
    assert.equal(expected.length, 12, "71 categories - 58 built banks - TTLBGM");

    const playable = soundTestPlayable(catalogue, Object.keys(area));
    assert.equal(playable.length, 71);
    assert.deepEqual(playable.filter((p) => !p.available).map((p) => p.name), expected);

    const ttl = playable.find((p) => p.name === "TTLBGM");
    assert.equal(ttl.available, true, "TTLBGM is playable as the music start");
    assert.equal(ttl.music, true);
});

test("a packed word plays through the extracted sample, but TITLEBGM is a music start", () => {
    const common = read("../web/assets/sfx/manifest.json");
    const area = read("../web/assets/sfx/area_manifest.json");
    const resolve = packedSampleResolver(common, area);
    // BT_LOOP1 is in the resident common bank, so the common manifest answers.
    assert.deepEqual(resolve(0xa004e0bd), { name: "bt_loop1", bank: null });
    // TITLEBGM (0x611c0000) has bits 30+29 set and bit 31 clear: the play
    // routine's SEP-sequence arm, not a sample, so the sample path is null and
    // the screen must start the music instead.
    assert.equal(packedIsMusicStart(0x611c0000), true);
    assert.equal(resolve(0x611c0000), null);
});

test("the screen ships behind F2 -> Extras -> Sound test and is off by default", () => {
    const ambience = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");
    assert.match(ambience, /\["soundtest", "Sound test \(dev\)"\]/);
    const experimental = ambience.match(/const EXPERIMENTAL = \[([^\]]*)\];/);
    assert.ok(experimental, "EXPERIMENTAL is still one array literal");
    assert.match(experimental[1], /"soundtest"/);

    const game = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
    assert.match(game, /window\.__fx\?\.soundtest/, "the screen opens on the toggle");
    assert.match(game, /if \(soundTestOn && !soundTestWasOn\) soundTest\.show\(\)/, "and only on its rising edge");
    assert.match(game, /if \(soundTest\.open\) \{\s*e\.preventDefault\(\);\s*soundTest\.handleKey\(k\);/, "the open screen owns the press");
    const gate = game.match(/function fieldFullScreenUiOpen\(\) \{\s*return !!\(([^;]*?)\);\s*\}/s);
    assert.ok(gate, "the full-screen gate is one boolean expression");
    assert.match(gate[1], /soundTest\.open/, "the screen covers the field like the other screens");
    assert.match(game, /soundTest\.draw\(ctx, VIEW_W, VIEW_H\)/, "and draws last, like its sibling debug screen");
});

test("the screen opens, holds a sound, and names the banks it cannot play", async () => {
    // The screen is a browser module, but its whole list/play flow is plain
    // logic: feed it the four files it fetches, a recording sfx and a recording
    // music player, and drive the same key names the game's dispatcher sends.
    const FILES = {
        "assets/data/soundtst_catalogue.json": "../web/assets/data/soundtst_catalogue.json",
        "assets/sfx/area_manifest.json": "../web/assets/sfx/area_manifest.json",
        "assets/sfx/manifest.json": "../web/assets/sfx/manifest.json",
        "assets/music/index.json": "../web/assets/music/index.json",
    };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        const path = FILES[String(url)];
        if (!path) return { ok: false, json: async () => null };
        const data = read(path);
        return { ok: true, json: async () => data };
    };
    const calls = [];
    const sfx = {
        playBankSound: (bank, name, opts) => {
            calls.push(["play", bank, name, opts?.sustain === true]);
            return bank ? `${bank}:${name}` : name;
        },
        stop: (name) => calls.push(["stop", name]),
        stopAll: () => calls.push(["stopAll"]),
    };
    const music = {
        play: (track) => calls.push(["music", track]),
        stop: () => calls.push(["musicStop"]),
    };
    try {
        const screen = createSoundTest({ sfx, music });
        screen.show();
        for (let i = 0; i < 50 && !screen.ready; i++) await new Promise((r) => setTimeout(r, 0));
        assert.equal(screen.ready, true, "the catalogue and both manifests loaded");

        // Category row 43 is ENV004: its VAB bank was never extracted, so the
        // screen refuses to open it and says why instead of going mute.
        for (let i = 0; i < 43; i++) screen.handleKey("down");
        screen.handleKey("circle");
        assert.equal(screen.stage, "categories");
        assert.equal(screen.status, "no sample in this build");

        // Back to COMMON, open it, and hold Circle on BT_LOOP0: the sample is
        // started with sustain, a held tick keeps it, releasing keys stops it.
        for (let i = 0; i < 43; i++) screen.handleKey("up");
        screen.handleKey("circle");
        assert.equal(screen.stage, "sounds");
        screen.handleKey("circle");
        assert.deepEqual(calls.at(-1), ["play", null, "bt_loop0", true]);
        screen.tick(new Set(["circle"]));
        assert.deepEqual(calls.at(-1), ["play", null, "bt_loop0", true], "still held");
        screen.tick(new Set());
        assert.deepEqual(calls.at(-1), ["stop", "bt_loop0"]);

        // The last category, TTLBGM: TITLEBGM is a music start, so Circle
        // starts the title track (hold and release stop it), not a sample.
        screen.handleKey("cross");
        for (let i = 0; i < 70; i++) screen.handleKey("down");
        screen.handleKey("circle");
        assert.equal(screen.stage, "sounds");
        screen.handleKey("circle");
        assert.deepEqual(calls.at(-1), ["music", "ttlbgm"]);
        screen.tick(new Set());
        assert.deepEqual(calls.at(-1), ["musicStop"]);

        // Cross then Start both leave it closed.
        screen.handleKey("start");
        assert.equal(screen.open, false);
        screen.handleKey("circle");
        assert.equal(screen.open, false, "closed means no key handling");
    } finally {
        globalThis.fetch = realFetch;
    }
});
