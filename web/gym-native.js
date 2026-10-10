// The training gym as a production native screen (Phase 6.3 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// The player meets the shipped pro/stgtrain overlay: the "Train which Digimon"
// pod select, the per-partner HUD (LV / HP / MP / TP), the drill list for the
// gym's rank group, the session animation and the result panel. This module is
// only the state adapter between web/game.js and the screen's RAM contract; the
// screen itself runs through web/native-screen-host.js and engine/native.
//
// Contract (docs/research/overlays/stgtrain.md, docs/todo/2026-07-26-gym-rank
// -chain-rig-residues.md and engine/dw3/party-context.ts):
//   * 0x8004b404 = the rank group the greeter's bank-0x94 write carries (the
//     same parameter cell the item shop uses for its shop id);
//   * 0x80049494 + slot*0x3DC = the roster record the HUD and the rolls read:
//     +0x24 level, +0x26 TP, +0x28/+0x2A HP, +0x2C/+0x2E MP, +0x30 six core
//     stats, +0x3C seven element points;
//   * 0x80048d34 + 0x70 = the party position map (position -> roster slot);
//   * the root object's lifecycle (+0xC) reaching 3 is the player leaving.
//
// The old hand-authored screen (web/gym.js) stays as the development rollback
// until this route is accepted; nothing here falls back to it.

import { elementValue, maskFromButtons, ROSTER_SLOT_CHARIDS } from "./vendor/engine.js";
import {
    openNativeScreen,
    preloadNativeScreens,
    nativeScreensReady,
} from "./native-screen-host.js";
import { seedNativeScreenParty } from "./native-screen.js";
import { driStatsAt } from "./dri-model.js";
import { ensureStoredStats, gymRepPercent, gymRepResults } from "./battle.js";
import { drawClip, loadPack, packReady } from "./screenpack.js";
import { gymGroupFor } from "./gym.js";
// The workout scene inside the session viewport. The screen's own overlay does
// not draw it (stgtrain owns only the window clip; walker note 2026-08-05), and
// the original plays it from the resident anim-actor system, which the field
// screen runtime does not run for this overlay. The scene below is the same
// decoded implementation the hand-authored gym uses (web/gym.js, user-confirmed
// on the PS1): TRANIN per-drill-family packs, six native anim scripts, the
// per-clip scene offsets, and the actor grow-in.
import {
    drawTraninScene, traninEntry, traninFamily, traninAnchors, traninScriptMs,
    TR_INTRO, TR_WINDUP, TR_HIT, TR_MISS, TR_WIN, TR_LOSE, TRAIN_CATEGORY_BY_NAME,
} from "./gym.js";

const SCENE_VSYNC_MS = 20;
const ACTOR_SCALE_UNITY = 0x1000;
const ACTOR_SCALE_IN_DELTA = 0x199; // F0x8008a200 unk68
const SCENE_VIEWPORT = { x0: 114, y0: 75 };
// The rep feedback row (stgtrain_ui.json rep_row, F0x80086c0c): one marker per
// rep, a ring for a hit and an X for a miss; the marker appears when its rep
// resolves. Geometry comes from the same decoded file the hand-authored screen
// reads; the defaults below are that file's values.
const REP_ROW_FALLBACK = { x: 128, y: 88, stepX: 17, count: 5, iconOk: 69, iconFail: 70 };
const CHROME_PACK = loadPack("sttrng3");
let REP_ROW = REP_ROW_FALLBACK;
fetch("assets/data/stgtrain_ui.json").then((r) => r.json())
    .then((j) => { if (j?.rep_row) REP_ROW = j.rep_row; })
    .catch(() => {});
const SCENE_FALLBACK = { [TR_INTRO]: 450, [TR_WINDUP]: 360, [TR_HIT]: 520, [TR_MISS]: 560, [TR_WIN]: 700, [TR_LOSE]: 700 };

const MODULE_ID = "pro/stgtrain";
const GYM_GROUP_CELL = 0x8004b404;
const RECORDS = 0x80049494;
const STRIDE = 0x3dc;
const REC = {
    level: 0x24, tp: 0x26, hp: 0x28, maxHp: 0x2a, mp: 0x2c, maxMp: 0x2e,
    core: 0x30, elements: 0x3c,
};
const CORE = ["str", "def", "spt", "wis", "spd", "chr"];
const ELEMENTS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];
const PARTY_SLOTS = 3;

/** Roster slot for a manifest party char id, or -1 when it is not a roster
 *  species (the packed party keeps the standing partners at the front). */
function rosterSlotFor(charId) {
    const i = ROSTER_SLOT_CHARIDS.indexOf(String(charId));
    return i < 0 ? 0xffffffff : i;
}

export function createGymNative(sfx = null) {
    const g = {
        _open: false,
        _pending: false,
        _host: null,
        _state: null,
        _onClose: null,
        _group: 0,
        _tables: null,
        _lastDiagnostic: null,
    };

    async function loadTables() {
        if (g._tables) return g._tables;
        const [dj, ranks] = await Promise.all([
            fetch("assets/data/digimon.json").then((r) => r.json()),
            fetch("assets/data/gym_ranks.json").then((r) => r.json()),
        ]);
        g._tables = {
            digimonById: Object.fromEntries(dj.digimon.map((d) => [d.id, d])),
            gymRanks: ranks,
        };
        return g._tables;
    }

    /** Walker state -> the RAM the screen reads. */
    function seed({ write }) {
        const state = g._state ?? {};
        const tables = g._tables;
        write(GYM_GROUP_CELL, g._group | 0, 4);
        // The HUD's name line is filled with the stats block ADDRESS itself
        // (F0x800194E8 takes seq = -1 and installs the pointer as the string;
        // the party accessor unk2750 returns the block at record + 0x08), so the
        // block's leading bytes ARE the display name. The walker's legacy HUD
        // prints the species name; write the same bytes here.
        // The block stores the game's own glyph ids, not ASCII: the decoder maps
        // 4..13 to 0-9, 14..39 to A-Z and 40..65 to a-z (web/native-screen-text.js
        // decodeNativeText). Ids outside those ranges render as blank/replacement.
        const glyphId = (ch) => {
            const c = ch.charCodeAt(0);
            if (c >= 0x30 && c <= 0x39) return c - 0x30 + 4;
            if (c >= 0x41 && c <= 0x5a) return c - 0x41 + 14;
            if (c >= 0x61 && c <= 0x7a) return c - 0x61 + 40;
            return 0;
        };
        const writeName = (slot, name) => {
            const base = RECORDS + slot * STRIDE + 0x08;
            const text = String(name ?? "").slice(0, 0x1b);
            for (let i = 0; i < text.length; i++) write(base + i, glyphId(text[i]), 1);
            write(base + text.length, 0, 1);
        };
        const party = Array.isArray(state.party) ? state.party : [];
        const positions = [];
        const stats = [];
        for (let i = 0; i < PARTY_SLOTS; i++) {
            if (i >= party.length) {
                positions.push(0xffffffff);
                continue;
            }
            const slot = rosterSlotFor(party[i]);
            positions.push(slot);
            if (slot === 0xffffffff) continue;
            const ps = driStatsAt(state, i, tables?.digimonById ?? {}) ?? {};
            const profile = tables?.digimonById?.[ps.digimonId ?? 0];
            const core = profile ? ensureStoredStats(ps, profile) : (ps.stats ?? {});
            writeName(slot, profile?.name ?? ps.name ?? "");
            stats.push({
                slot,
                level: Number(ps.level) || 1,
                tp: Number(ps.tp) || 0,
                hp: Number(ps.hp) || 0,
                maxHp: Number(ps.maxHp) || 0,
                mp: Number(ps.mp) || 0,
                maxMp: Number(ps.maxMp) || 0,
                exp: Number(ps.xp) || 0,
                core: CORE.map((k) => Number(core?.[k]) || 0),
                // The roster record carries the STORED element halfwords — the species
                // base plus every trained point (F0x80017174 copies them
                // verbatim) — and the session's own original-code fill adds the
                // worn gear's resist on top, because that is what F0x80017174
                // does. One shared helper for the stored half, so no screen
                // re-adds it by hand.
                elements: ELEMENTS.map((k) => elementValue(profile, ps.elemBonuses, k)),
            });
        }
        seedNativeScreenParty({ positions, stats });
    }

    /** HOST-SERVED BOUNDARY (load-bearing; proven by tools/verify_native_gym.mjs).
     *  The result window (F0x800897B8) waits for its two local message widgets
     *  (class ctor F0x80083880) to report "finished typing" through method
     *  +0x104 (F0x8008310C: the widget's own +0x78 word). That word is set by
     *  the widget's typing animation, which needs the screen's per-drill
     *  message records (accessors 0x8008C0C0/0x8008C0E4/0x8008C12C read
     *  0x8008CE3C + id*0x10 and 0x8008CFCC + id*0x50); measured in this host
     *  they are all zero, so the widgets never report done and the whole result
     *  path (F0x800866CC's stat roll, the window's result text, the panel's
     *  dismissal) never runs. The workout itself is played by the host
     *  (drawWorkoutScene) because the overlay only owns the viewport window, so
     *  this gate is the hold point that keeps the screen's result dialog behind
     *  the animation: it reports not-done while the reps play and done for a
     *  couple of frames at the win pose, after which the window writes its
     *  result, folds and hands control to the panel. Without the hold the
     *  screen runs to the result in ~200 ms (the 2026-09-21 "training finishes
     *  immediately" report); holding it closed mid-sequence dead-ends the
     *  window's message fold (its fold delta is armed by the message path), so
     *  the gate opens once, at the win pose, and stays open. */
    function seedHostServed({ write, rt }) {
        seed({ write });
        rt?.cpu?.setStub(0x8008310c, () => (scene.gateOpen ? 1 : 0));
    }

    function boot() {
        const host = openNativeScreen(MODULE_ID, {
            seed: seedHostServed,
            // The overlay's rep-marker row only lands at the end of the session
            // and would double the host's progressive row (the 2026-09-21
            // "overlapping rings" report); the host draws the same row from the
            // same decoded geometry, so the overlay's copy is suppressed. Clips
            // 0x45 (ring) and 0x46 (X) are the rep row and nothing else
            // (docs/research/ui/stgtrain-decoded-2026-07-11.md).
            skipClip: (name, id) => name === "sttrng3" && (id === 0x45 || id === 0x46),
        });
        if (!host) return false;
        g._host = host;
        return true;
    }

    /** The trained record -> walker state. The screen writes the roster record
     *  in place; copy every field it can touch back. */
    function commit() {
        const host = g._host;
        const state = g._state;
        if (!host || !state) return;
        const tables = g._tables;
        const party = Array.isArray(state.party) ? state.party : [];
        for (let i = 0; i < Math.min(PARTY_SLOTS, party.length); i++) {
            const slot = rosterSlotFor(party[i]);
            if (slot === 0xffffffff) continue;
            const ps = driStatsAt(state, i, tables?.digimonById ?? {});
            if (!ps) continue;
            const base = RECORDS + slot * STRIDE;
            const r16 = (off) => host.read(base + off, 2);
            const r32 = (off) => host.read(base + off, 4);
            ps.level = r16(REC.level) || ps.level;
            ps.tp = r16(REC.tp);
            ps.hp = r16(REC.hp);
            ps.maxHp = r16(REC.maxHp);
            ps.mp = r16(REC.mp);
            ps.maxMp = r16(REC.maxMp);
            const core = {};
            CORE.forEach((k, j) => { core[k] = r16(REC.core + j * 2); });
            ps.stats = core;
            const elems = {};
            ELEMENTS.forEach((k, j) => { elems[k] = r16(REC.elements + j * 2); });
            ps.elemBonuses = elems;
            void r32;
        }
    }

    g.open = async (state, onClose = null, group = null, stage = null) => {
        if (!g._tables) {
            try {
                await loadTables();
            } catch (e) {
                g._lastDiagnostic = `gym tables failed: ${e?.message ?? e}`;
                return;
            }
        }
        g._open = true;
        g._onClose = onClose;
        g._state = state ?? null;
        // The real route carries the greeter's bank-0x94 group; the debug/lab
        // path passes the stage and resolves the same group from the decoded
        // table (web/gym.js#gymGroupFor). No option satisfied means the
        // original would not have opened training at all.
        let resolved = group;
        if (resolved == null && stage != null)
            resolved = gymGroupFor(stage, state?.inventory, g._tables?.gymRanks) ?? null;
        g._group = Number.isInteger(resolved) ? resolved : 0;
        g._lastDiagnostic = Number.isInteger(resolved) ? null : "gym.open without a greeter group";
        g._bootFrames = 0;
        preloadNativeScreens().catch((e) => {
            g._lastDiagnostic = `native screen preload failed: ${e?.message ?? e}`;
        });
        if (!boot()) g._pending = true;
    };

    g.isOpen = () => g._open;

    // Input arrives as key events, but the native screen reads the pad service's
    // held word once per frame (state.keys carries every held button).
    g.handleKey = (_k, state) => {
        if (state && !g._state) g._state = state;
    };

    g.update = (dt) => {
        if (!g._open) return;
        if (g._pending) {
            if (!nativeScreensReady()) {
                preloadNativeScreens().catch(() => {});
                return;
            }
            if (!boot()) {
                g._lastDiagnostic = "native gym boot failed (manifest/overlay missing)";
                return;
            }
            g._pending = false;
        }
        const keys = g._state?.keys;
        g._host.setPad(keys ? maskFromButtons(keys) : 0);
        if (g._host.tick(dt)) g._finish();
    };

    g.draw = (ctx, viewW, viewH) => {
        if (!g._open || !g._host) return;
        g._host.draw(ctx, viewW, viewH);
        drawWorkoutScene(ctx, viewW, viewH);
    };

    // ── the workout scene (host-served presentation) ────────────────────────
    // Armed when the rep session's window object appears; the stage sequence is
    // the walker's decoded one (intro -> per-rep wind-up -> hit/miss -> win/lose
    // pose), timed by each TRANIN script's own vsync durations.
    const scene = {
        armed: false, stage: "intro", t0: 0, idx: 0, script: TR_INTRO,
        scaleT0: 0, digi: null, props: null, anchor: [0, 0], reps: 3, win: 0,
        drill: 1, gateOpen: false, results: [true, true, true], shown: 0,
    };

    /** The round's rep count. The rep task that owns the live value (+0x18:
     *  2 = three reps, 4 = five after a super drill misses the sweep,
     *  F0x80087110/F0x800871FC) does not run in this host, so the decoded rule
     *  from web/battle.js gymRepResults is applied instead: basic drills always
     *  three, supers five. */
    function sceneReps() {
        return scene.drill >= 13 ? 5 : 3;
    }

    function sceneReset() {
        scene.armed = false;
        scene.stage = "intro";
        scene.idx = 0;
        scene.shown = 0;
        scene.script = TR_INTRO;
        scene.digi = null;
        scene.props = null;
    }

    function sceneArm(drill, winAddr) {
        const ps = g._state?.partnerStats ?? {};
        const profile = g._tables?.digimonById?.[ps.digimonId ?? 0];
        const cat = TRAIN_CATEGORY_BY_NAME[profile?.name];
        if (cat == null) return false;
        const fam = traninFamily(drill || 1);
        scene.digi = traninEntry(`${fam}_s${cat}`);
        scene.props = traninEntry(`${fam}_s8`);
        scene.anchor = traninAnchors(fam);
        scene.drill = drill || 1;
        // The per-rep outcomes, rolled by the game's own rule and rand table
        // (web/battle.js gymRepResults: rand%100 <= the equipment's rep percent;
        // basic drills three reps, supers five). They drive the hit/miss poses
        // and the marker row, exactly like the hand-authored screen.
        const equip = g._state?.equipment?.[0] ?? null;
        scene.results = gymRepResults(gymRepPercent(equip), scene.drill >= 13);
        scene.reps = scene.results.length;
        scene.shown = 0;
        scene.stage = "intro";
        scene.idx = 0;
        scene.script = TR_INTRO;
        const now = performance.now();
        scene.t0 = now;
        scene.scaleT0 = now;
        scene.gateOpen = false;
        scene.win = winAddr >>> 0;
        scene.reps = sceneReps();
        scene.armed = true;
        return true;
    }

    /** A beat lasts as long as the TRAINEE's own script for it. Taking the max
     *  of trainee and props froze the Digimon at its last frame while a longer
     *  props script (the bag's swing) finished, which reads as a mid-punch
     *  stutter; the trainee is what the player watches, so its script bounds the
     *  beat and a longer props animation is cut by the next beat instead. */
    function sceneDur(idx) {
        return traninScriptMs(scene.digi, idx) || traninScriptMs(scene.props, idx)
            || SCENE_FALLBACK[idx] || 450;
    }

    function drawWorkoutScene(ctx, viewW, viewH) {
        const rt = g._host?.rt;
        if (!rt) return;
        const find = (cb) => rt.world.objects.find((o) => o.alive && (o.cb >>> 0) === cb);
        const window_ = find(0x800897b8);
        const train = find(0x80089698);
        // The training object owns the whole session (the window object comes and
        // goes with the message phases), so the scene is armed once per session
        // and only reset when the training object is gone. Re-arming on a window
        // address change restarted the grow-in mid-punch and read as a stutter.
        if (!train) { sceneReset(); return; }
        if (!scene.armed) {
            if (!window_) return;
            const root = rt.world.objects[0];
            const drill = root ? (rt.mem.read32(root.addr + 0x78) >>> 0) : 0;
            if (!sceneArm(drill, window_.addr)) return;
        }
        const now = performance.now();
        const el = now - scene.t0;
        // A beat is drawn with the script and start time it was entered with, and
        // a transition decided here takes effect NEXT frame. Mutating scene.t0 and
        // scene.script in the same frame the beat began left `el` carrying the
        // PREVIOUS beat's elapsed time into the new script, so the new script's
        // resolver clamped to its last frame for one frame — a one-frame flash of
        // a wrong pose (the tail visibly jumping mid-punch).
        const pending = { stage: scene.stage, script: scene.script, idx: scene.idx, shown: scene.shown, t0: scene.t0, gate: scene.gateOpen };
        {
            switch (scene.stage) {
                case "intro":
                    scene.script = TR_INTRO;
                    if (el >= sceneDur(TR_INTRO)) { pending.idx = 0; pending.stage = "windup"; pending.t0 = now; }
                    break;
                case "windup":
                    scene.script = TR_WINDUP;
                    if (el >= sceneDur(TR_WINDUP)) {
                        pending.script = scene.results[scene.idx] ? TR_HIT : TR_MISS;
                        pending.stage = "resolve";
                        pending.t0 = now;
                    }
                    break;
                case "resolve":
                    scene.script = scene.results[scene.idx] ? TR_HIT : TR_MISS;
                    if (el >= sceneDur(scene.script)) {
                        pending.idx = scene.idx + 1;
                        pending.shown = scene.idx + 1;
                        const last = scene.results[scene.results.length - 1];
                        if (pending.idx >= scene.reps) { pending.script = last ? TR_WIN : TR_LOSE; pending.stage = "endpose"; pending.gate = true; }
                        else pending.stage = "windup";
                        pending.t0 = now;
                    }
                    break;
                case "endpose":
                    scene.script = scene.results[scene.results.length - 1] ? TR_WIN : TR_LOSE;
                    if (el >= sceneDur(scene.script)) { pending.stage = "hold"; pending.t0 = now; }
                    break;
                case "hold":
                default:
                    break;
            }
        }
        const sc = Math.min(1, Math.max(0, Math.floor((now - scene.scaleT0) / SCENE_VSYNC_MS) * ACTOR_SCALE_IN_DELTA) / ACTOR_SCALE_UNITY);
        if (sc <= 0) return;
        const s = Math.max(1, Math.min(viewW / 320, viewH / 240));
        ctx.save();
        ctx.scale(s, s);
        if (sc < 1) {
            ctx.translate(scene.anchor[0], scene.anchor[1]);
            ctx.scale(sc, sc);
            ctx.translate(-scene.anchor[0], -scene.anchor[1]);
        }
        const drew = drawTraninScene(ctx, scene.digi, scene.props, scene.script, el, scene.anchor[0], scene.anchor[1], false);
        // Diagnostics: which step of the beat is on screen, so a verifier can
        // assert every beat opens on its own step 0 (see the stale-`el` note above).
        const steps = scene.digi?.meta?.anims?.[scene.script] ?? [];
        scene.beat = {
            script: scene.script, stage: scene.stage, el,
            step: drew.digiF ? steps.indexOf(drew.digiF) : -1,
            clip: drew.digiF?.clip ?? null,
        };
        drawRepMarkers(ctx, now);
        ctx.restore();
        // The transition decided above starts the next beat on the next frame.
        scene.stage = pending.stage;
        scene.script = pending.script;
        scene.idx = pending.idx;
        scene.shown = pending.shown;
        scene.t0 = pending.t0;
        scene.gateOpen = pending.gate;
    }

    /** The rep feedback row: one marker per resolved rep, the newest pulsing —
     *  ring for a hit, X for a miss (rep_row, F0x80086c0c). */
    function drawRepMarkers(ctx, now) {
        if (!scene.shown || !packReady(CHROME_PACK)) return;
        const rr = REP_ROW;
        for (let i = 0; i < scene.shown && i < (rr.count ?? 5); i++) {
            const x = rr.x + i * rr.stepX, y = rr.y;
            ctx.save();
            if (i === scene.shown - 1) ctx.globalAlpha = 0.55 + 0.45 * (Math.floor(now / 60) % 2);
            drawClip(ctx, CHROME_PACK, scene.results[i] ? rr.iconOk : rr.iconFail, x - 8, y - 8);
            ctx.restore();
        }
    }

    g.close = () => {
        if (g._open) g._finish();
    };

    g._finish = () => {
        if (!g._open) return;
        g._open = false;
        g._pending = false;
        const host = g._host;
        if (host) {
            commit(); // reads the roster through g._host, so it must run first
            host.teardown();
        }
        g._host = null;
        const cb = g._onClose;
        g._onClose = null;
        cb?.();
    };

    /** Diagnostics for the lab and focused browser checks. */
    g.diagnostics = () => ({
        open: g._open,
        pending: g._pending,
        group: g._group,
        scene: { armed: scene.armed, stage: scene.stage, script: scene.script, reps: scene.reps,
            shown: scene.shown, results: [...scene.results], beat: scene.beat ?? null,
            digi: !!scene.digi, props: !!scene.props, anchor: scene.anchor },
        host: g._host?.state() ?? null,
        renderer: g._host?.renderer
            ? (() => {
                const r = g._host.renderer.stats;
                return {
                    frames: r.frames, clips: r.clips, skipped: r.skipped,
                    byPack: { ...r.byPack }, seen: [...r.seen], last: r.last,
                };
            })()
            : null,
        lastDiagnostic: g._lastDiagnostic,
    });

    return g;
}
