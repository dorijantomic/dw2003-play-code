// web/soundtest.js — the developers' own SOUND TEST screen (overlay soundtst).
//
// Decode: docs/research/audio/soundtst-full-decode-2026-08-05.md. The overlay
// carries three tables that tile exactly: 71 VAB categories (category 0 is the
// always-resident COMMON bank with 113 sounds; 231 sounds in all), an
// eight-row window moved by one shared list mover, and the screen flow category
// list -> load -> sound list. The layout numbers below are the decode's own:
// title (16,30), heading (32,50), eight rows at (48, 70 + 16*i), cursor at
// (32, 70 + 16*(cursor-scroll)); Circle plays and holds, releasing stops,
// Square stops everything, Cross goes back, Start leaves.
//
// The catalogue is built by tools/build_soundtst_catalogue.py from the decoded
// tables; it lives under web/assets (git-ignored, like every extracted asset).
// The screen is only reachable through F2 -> Extras -> Sound test: while
// window.__fx.soundtest is off it never opens and its keys never run.
//
// Which sounds a build can actually PLAY is not a list in this file: the
// sample banks that were extracted are area_manifest.json's own keys (its
// "common" entry is the resident bank), and packed-sound.js answers which
// sample a packed word means. A category with no extracted bank is drawn with
// "no sample in this build" instead of going silently mute. The one exception
// is the last category, TTLBGM (archive 71): TITLEBGM is a SEP sequence, a
// music start, not a sample, so that one plays through the music player.

import { drawText } from "./uifont.js";
import { packedIsMusicStart, packedSampleResolver } from "./packed-sound.js";

/** The overlay's window height (F0x8008443c, eight rows). */
export const SOUNDTEST_ROWS = 8;

/** Layout in the overlay's own pixels (11 class-A widgets, decode § Layout). */
export const SOUNDTEST_LAYOUT = Object.freeze({
    title: { x: 16, y: 30 },
    heading: { x: 32, y: 50 },
    rowsX: 48,
    rowsY: 70,
    pitch: 16,
    cursorX: 32,
});

const CATALOGUE_URL = "assets/data/soundtst_catalogue.json";
const AREA_MANIFEST_URL = "assets/sfx/area_manifest.json";
const COMMON_MANIFEST_URL = "assets/sfx/manifest.json";
const MUSIC_INDEX_URL = "assets/music/index.json";

/**
 * The shared list mover F0x8008443c: the cursor is an ABSOLUTE row index
 * clamped to 0..count-1, and the scroll slides so the cursor stays inside the
 * eight-row window (`scroll = cursor - 7` when it passes the bottom,
 * `scroll = cursor` when it passes the top). Returns the new pair.
 */
export function soundTestMove(cursor, scroll, delta, count) {
    if (!(count > 0)) return { cursor: 0, scroll: 0 };
    const c = Math.max(0, Math.min(count - 1, (cursor | 0) + (delta | 0)));
    let s = Math.max(0, scroll | 0);
    if (c < s) s = c;
    if (c >= s + SOUNDTEST_ROWS) s = c - SOUNDTEST_ROWS + 1;
    s = Math.max(0, Math.min(Math.max(0, count - SOUNDTEST_ROWS), s));
    return { cursor: c, scroll: s };
}

/**
 * The eight rows the drawer sees for a category: the record names, the
 * absolute window, and the clamped cursor. `catalogue` is the built
 * soundtst_catalogue.json; `category` is its index.
 */
export function soundTestView(catalogue, category, cursor, scroll) {
    const cat = catalogue?.categories?.[category];
    if (!cat) return null;
    const sounds = cat.sounds ?? [];
    const count = sounds.length;
    const pos = soundTestMove(cursor, scroll, 0, count);
    const rows = [];
    for (let i = 0; i < SOUNDTEST_ROWS && pos.scroll + i < count; i++) {
        const index = pos.scroll + i;
        const sound = sounds[index];
        rows.push({ index, name: sound.name, id: sound.id, text: sound.name });
    }
    return {
        category: cat.category ?? category,
        name: cat.name,
        archiveId: cat.archive_id,
        count,
        cursor: pos.cursor,
        scroll: pos.scroll,
        rows,
    };
}

/**
 * Which categories this build can sound. A bank is available when its name is
 * one of the extracted sample banks (area_manifest.json's keys, case-
 * insensitive; "common" is the resident bank). The last category is the
 * overlay's TTLBGM record: its sound is a music start, not a sample, so it is
 * available through the music player and is not marked missing.
 */
export function soundTestPlayable(catalogue, builtBanks = []) {
    const built = new Set([...builtBanks].map((k) => String(k).toLowerCase()));
    const categories = catalogue?.categories ?? [];
    const last = categories.length - 1;
    return categories.map((c, index) => {
        const sounds = c.sounds ?? [];
        const hasBank = built.has(String(c.name).toLowerCase());
        const music = index === last && sounds.length > 0
            && sounds.every((s) => packedIsMusicStart(parseInt(s.id, 16)));
        return {
            category: c.category ?? index,
            name: c.name,
            archiveId: c.archive_id,
            count: sounds.length,
            hasBank,
            music: music && !hasBank,
            available: hasBank || music,
        };
    });
}

/**
 * The screen. `sfx` is web/audio.js's createSfxPlayer (it grows playBankSound
 * here); `music` is the bgm player's play/stop pair. Both are optional so the
 * pure helpers above stay importable under node --test.
 */
export function createSoundTest({ sfx = null, music = null } = {}) {
    const d = {
        open: false, stage: "categories", cursor: 0, scroll: 0,
        soundCursor: 0, soundScroll: 0, status: "", playing: null, ready: false,
    };
    let catalogue = null;
    let playable = null;
    let resolvePacked = null;
    const musicTracks = new Set();
    let loading = null;
    let failed = false;

    const fetchJson = (url) => (typeof fetch === "undefined"
        ? Promise.resolve(null)
        : fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null));

    function ensureLoaded() {
        if (catalogue || loading) return loading;
        loading = Promise.all([
            fetchJson(CATALOGUE_URL),
            fetchJson(AREA_MANIFEST_URL),
            fetchJson(COMMON_MANIFEST_URL),
            fetchJson(MUSIC_INDEX_URL),
        ]).then(([cat, area, common, tracks]) => {
            if (!cat || !Array.isArray(cat.categories)) { failed = true; return; }
            catalogue = cat;
            playable = soundTestPlayable(cat, Object.keys(area ?? {}));
            resolvePacked = packedSampleResolver(common ?? {}, area ?? {});
            for (const t of Array.isArray(tracks) ? tracks : []) musicTracks.add(String(t).toLowerCase());
            d.ready = true;
        }).catch(() => { failed = true; });
        return loading;
    }

    const categoryNow = () => catalogue?.categories?.[d.cursor] ?? null;

    function musicTrackOf(category) {
        const name = String(category?.name ?? "").toLowerCase();
        return musicTracks.has(name) ? name : null;
    }

    function stopPlaying() {
        const p = d.playing;
        d.playing = null;
        if (!p) return;
        if (p.kind === "music") music?.stop?.();
        else if (p.name != null) sfx?.stop?.(p.name);
    }

    function stopEverything() {
        stopPlaying();
        sfx?.stopAll?.();
        music?.stop?.();
        d.status = "stopped";
    }

    function openCategory() {
        const entry = playable?.[d.cursor];
        if (!entry) return;
        if (!entry.available) { d.status = "no sample in this build"; return; }
        d.stage = "sounds";
        d.soundCursor = 0;
        d.soundScroll = 0;
        d.status = "";
    }

    function playSelected() {
        const category = categoryNow();
        if (!category) return;
        stopPlaying();
        const sound = category.sounds?.[d.soundCursor];
        if (!sound) return;
        const packed = parseInt(sound.id, 16) >>> 0;
        const hit = resolvePacked ? resolvePacked(packed) : null;
        if (hit && typeof sfx?.playBankSound === "function") {
            const key = sfx.playBankSound(hit.bank, hit.name, { sustain: true });
            if (key) {
                d.playing = { kind: "sample", name: hit.name, key };
                d.status = "playing " + sound.name;
                return;
            }
        }
        if (packedIsMusicStart(packed)) {
            const track = musicTrackOf(category);
            if (track && music?.play) {
                music.play(track);
                d.playing = { kind: "music", track };
                d.status = "playing " + sound.name + " (music)";
                return;
            }
        }
        d.status = "no sample in this build";
    }

    d.show = () => {
        d.open = true;
        d.stage = "categories";
        d.cursor = 0;
        d.scroll = 0;
        d.soundCursor = 0;
        d.soundScroll = 0;
        d.status = "";
        d.playing = null;
        ensureLoaded();
    };

    d.hide = () => {
        stopPlaying();
        d.open = false;
        d.stage = "categories";
        d.status = "";
    };

    d.handleKey = (k) => {
        if (!d.open) return false;
        const key = String(k ?? "").toLowerCase();
        if (key === "start") { d.hide(); return true; }
        if (!catalogue) {
            if (key === "cross") d.hide();
            return true;
        }
        if (d.stage === "categories") {
            if (key === "up" || key === "down") {
                const pos = soundTestMove(d.cursor, d.scroll, key === "up" ? -1 : 1, catalogue.categories.length);
                d.cursor = pos.cursor;
                d.scroll = pos.scroll;
                d.status = "";
            } else if (key === "circle") {
                openCategory();
            } else if (key === "cross") {
                d.hide();
            }
            return true;
        }
        if (key === "up" || key === "down") {
            stopPlaying();
            const pos = soundTestMove(d.soundCursor, d.soundScroll, key === "up" ? -1 : 1,
                categoryNow()?.sounds?.length ?? 0);
            d.soundCursor = pos.cursor;
            d.soundScroll = pos.scroll;
            d.status = "";
        } else if (key === "circle") {
            playSelected();
        } else if (key === "square") {
            stopEverything();
        } else if (key === "cross") {
            stopPlaying();
            d.stage = "categories";
            d.status = "";
        }
        return true;
    };

    // Hold Circle to play, release to stop: the original keys the voice off
    // through D0x80055c50 when the held Circle bit clears.
    d.tick = (held) => {
        if (!d.open || !d.playing) return;
        if (!held?.has?.("circle")) stopPlaying();
    };

    function drawCategories(ctx, H) {
        const L = SOUNDTEST_LAYOUT;
        drawText(ctx, "Select the VAB to transfer", L.heading.x, L.heading.y, { kind: 1 });
        for (let i = 0; i < SOUNDTEST_ROWS; i++) {
            const index = d.scroll + i;
            const cat = catalogue.categories[index];
            if (!cat) break;
            const y = L.rowsY + i * L.pitch;
            const entry = playable?.[index];
            const text = entry && !entry.available ? cat.name + "  no sample in this build" : cat.name;
            drawText(ctx, text, L.rowsX, y, { kind: 1 });
            if (index === d.cursor) drawText(ctx, ">", L.cursorX, y, { kind: 3 });
        }
        drawText(ctx, "Up/Down select  Circle open", 16, H - 32, { kind: 3 });
        drawText(ctx, "Cross close  Start close", 16, H - 16, { kind: 3 });
    }

    function drawSounds(ctx, H) {
        const L = SOUNDTEST_LAYOUT;
        const view = soundTestView(catalogue, d.cursor, d.soundCursor, d.soundScroll);
        if (!view) return;
        const entry = playable?.[d.cursor];
        const heading = entry && !entry.available ? view.name + "  no sample in this build" : view.name;
        drawText(ctx, heading, L.heading.x, L.heading.y, { kind: 1 });
        for (let i = 0; i < view.rows.length; i++) {
            const row = view.rows[i];
            const y = L.rowsY + i * L.pitch;
            // A music-start record is a SEP sequence, not a sample; say so,
            // because the original plays it through the same Circle press.
            const suffix = packedIsMusicStart(parseInt(row.id, 16)) ? "  (music)" : "";
            drawText(ctx, row.text + suffix, L.rowsX, y, { kind: 1 });
            if (row.index === view.cursor) drawText(ctx, ">", L.cursorX, y, { kind: 3 });
        }
        drawText(ctx, "Circle hold to play  Square stop", 16, H - 32, { kind: 3 });
        drawText(ctx, "Cross back  Start close", 16, H - 16, { kind: 3 });
    }

    d.draw = (ctx, W, H) => {
        if (!d.open) return;
        const L = SOUNDTEST_LAYOUT;
        ctx.save();
        // The original overlay loads no screen pack (its own decode says there
        // is no art to reproduce); this dim fill is walker-added legibility.
        ctx.fillStyle = "rgba(8,12,24,0.92)";
        ctx.fillRect(0, 0, W, H);
        drawText(ctx, "SOUND TEST", L.title.x, L.title.y, { kind: 1 });
        if (!catalogue) {
            drawText(ctx, failed ? "catalogue missing" : "loading...", L.heading.x, L.heading.y, { kind: 1 });
            drawText(ctx, "Start close", 16, H - 16, { kind: 3 });
            ctx.restore();
            return;
        }
        if (d.stage === "categories") drawCategories(ctx, H);
        else drawSounds(ctx, H);
        if (d.status) drawText(ctx, d.status, L.rowsX, 198, { kind: 1 });
        ctx.restore();
    };

    return d;
}
