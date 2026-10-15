// Browser adapter for the translated fight report (pro/stfgtrep): the post-fight
// results screen. The screen's logic runs in engine/dw3/ui (FightReportSession);
// this file loads its data, ticks it on the display clock, paints the picture
// calls, the text and the closing dim, and commits what the disc's screen itself
// pays (the BIT and the dropped item) to the walker's state. It never executes
// original instructions and never requests an executable asset.
// `?nativeReport=1` keeps the original-code screen as a research reference
// (web/fightreport-native.js); `?legacyReport=1` keeps the hand-made screen.
//
// State contract (who changes what, exactly once):
//   * EXP, levels, the form ledger, techniques and stats are applied ONCE by
//     web/battle.js applyParticipantProgress before this screen opens. The screen
//     is seeded with each partner's PRE-battle snapshot and replays the disc's own
//     rules on a private roster record, so it shows the same outcome; those private
//     values are never read back.
//   * The BIT total and the dropped item's held count are what the disc's screen
//     pays, and it pays them INSIDE the page that shows them: stfgtrep F0x80084EC4
//     case 0x14 (stfgtrep.s file 0x2664-0x2798) adds word 2 of the reward record
//     into the wallet D0x80048DA0 (`D0x80048D34 + 0x6C`, clamped at 9,999,999) in the
//     same block that draws the "BIT gained" row, and case 0x15 (file 0x279C-0x28E8)
//     increments the bag count `D0x80048D34 + 0x7C + item` (capped at 99) in the
//     "Item gained" block. So payout() mirrors the session's save context into
//     walker state the frame it changes — not when the screen closes, which is a
//     different moment and can be skipped entirely. web/battle.js endBattle then
//     skips paying them again (`_reportNative`), so it is still exactly once.
//
// Same public API as createFightReportNative: open/isOpen/handleKey/update/draw/
// close/diagnostics.
import { heldCount, itemCountEntries, setHeldCount, setReportOwnedForms, ui } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { paintNativeSession, updateNativeSession } from "./native-session.js";
import { fitNativeScreen } from "./canvas-resolution.js";
import { fetchBytes, fetchJson, loadProfileRecords, loadResidentResources } from "./resident-data.js";

/** The report art: 0x079F0000 is disc index 1951 (STFRPT), 0x02860000 is 646 (CMFONT, the banner). */
const PACKS = { 1951: "stfrpt", 646: "cmfont" };
/** Text families by offset and the data directory that ships them (language added). */
const BANKS = [[0x55, "report"], [0x4e, "wizard"], [0x6a, "shop-banks"], [0xa2, "pause"]];
const BIT_CAP = 9_999_999;

const DATA_LABEL = "Fight report data";

const dataByLanguage = new Map();
function loadData(language) {
    if (!dataByLanguage.has(language)) {
        dataByLanguage.set(language, Promise.all([
            fetchJson("report/manifest.json", DATA_LABEL),
            fetchBytes("report/tables.bin", DATA_LABEL),
            loadProfileRecords(DATA_LABEL),
            loadResidentResources().then((shared) => ({ font: shared.font, cursorGlyphs: shared.cursorGlyphs })),
            ...BANKS.map(([offset, dir]) => fetchBytes(`${dir}/${offset + language}.bin`, DATA_LABEL)),
        ]).then(([manifest, tables, profiles, shared, ...banks]) => ({
            manifest, tables, profiles, font: shared.font, cursorGlyphs: shared.cursorGlyphs,
            textButtons: Uint8Array.from(manifest.textButtons.bytes),
            banks: new Map(banks.map((data, i) => [BANKS[i][0] + language, data])),
        })).catch((error) => { dataByLanguage.delete(language); throw error; }));
    }
    return dataByLanguage.get(language);
}

/** The screen's text codec: 0x04+d digits, 0x0E+n capitals, 0x28+n lower case, else an extended space. */
function encodeName(name) {
    const bytes = [];
    for (const ch of String(name ?? "")) {
        const code = ch.charCodeAt(0);
        if (ch >= "0" && ch <= "9") bytes.push(4 + code - 48);
        else if (ch >= "A" && ch <= "Z") bytes.push(14 + code - 65);
        else if (ch >= "a" && ch <= "z") bytes.push(40 + code - 97);
        else bytes.push(1, 1);
        if (bytes.length >= 23) break;
    }
    return bytes.slice(0, 23);
}

const rand16 = () => (Math.random() * 0x10000) | 0;

export function createFightReportTranslated(sfx = null, options = {}) {
    const r = {
        _open: false, _pending: false, _failed: false, _error: null, _session: null, _data: null,
        _state: null, _onClose: null, _opts: null, _clock: null, _ticks: 0, _request: 0,
        _summary: null, _lastDiagnostic: null,
        _seedBits: null, _seedHeld: null,
    };
    const renderer = createNativeScreenRenderer({ pack: "stfrpt", packs: PACKS },
        (directory) => PACKS[directory >>> 16] ?? null);

    const playSound = (id) => { sfx?.playPacked(id); };

    /** Walker state -> the session's seed (the RAM contract of the disc's screen). */
    function buildSeed(language) {
        const o = r._opts;
        const state = r._state ?? {};
        const members = (o.participants ?? []).slice()
            .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))
            .map((p) => {
                // the record has 44 ledger cells; the unlock routine must still know every form this partner owns
                setReportOwnedForms(p.rosterSlot ?? 0, new Map((p.forms?.formLedger ?? []).map((e) => [Number(e.id), Number(e.formLevel ?? 1)])));
                return p;
            })
            .map((p) => ({
                position: p.pos ?? 0,
                rosterSlot: p.rosterSlot ?? 0,
                nameBytes: encodeName(p.name),
                exp: Number(p.preExp) || 0,
                level: Number(p.level) || 1,
                tp: p.tp, hp: p.hp, maxHp: p.maxHp, mp: p.mp, maxMp: p.maxMp,
                core: p.core, elements: p.elements,
                equipment: p.equipment,
                forms: p.forms ? {
                    digimonId: p.forms.digimonId,
                    equippedForms: p.forms.equippedForms,
                    formLedger: p.forms.formLedger,
                } : undefined,
                participated: !!p.participated,
                formFlags: p.formFlags,
            }));
        return {
            language,
            battleId: o.battleId ?? 0,
            dropItemId: o.dropItemId ?? 0,
            activePosition: o.activePos ?? 0,
            bits: Number(state.bits) || 0,
            // Both item count arrays for every id 1..402, straight from the shared
            // store. The payout reads ctx+0x7C+id with the full id, so an id past 255
            // is a real byte and not a masked alias of a low one.
            bag: itemCountEntries(state),
            members,
        };
    }

    function fail(error) {
        r._error = error;
        r._failed = true;
        r._lastDiagnostic = `translated fight report failed: ${error?.message ?? error}`;
        console.error("Translated fight report failed", error);
    }

    function startSession() {
        const selected = r._state?.languageByte;
        const language = Number.isInteger(selected) ? selected : 2;
        r._session = new ui.FightReportSession(buildSeed(language), r._data,
            { playSound, rand: rand16 });
        r._clock = new ui.MenuDisplayClock();
        // What the walker was carrying when the screen opened: the screen's own
        // save context starts from these, so a change from them IS its payout.
        r._seedBits = r._session.bits();
        r._seedHeld = r._session.heldCount(r._opts?.dropItemId ?? 0);
    }

    /** The screen's payout -> walker state (BIT and the dropped item only). */
    function commit() {
        const session = r._session;
        const state = r._state;
        if (!session || !state) return;
        state.bits = Math.max(0, Math.min(BIT_CAP, session.bits()));
        // The dropped item's count goes through the shared store as an add/remove
        // (F0x800161D8): the 99 cap and the 0 floor are the store's.
        const itemId = r._opts?.dropItemId ?? 0;
        if (itemId > 0) {
            setHeldCount(state, itemId, session.heldCount(itemId), heldCount(state, itemId));
        }
        if (typeof localStorage !== "undefined") {
            localStorage.setItem("bits", String(state.bits));
            localStorage.setItem("inventory", JSON.stringify(state.inventory));
        }
    }

    /**
     * The same read-back as commit(), run on every frame instead of only on close.
     * Both write the screen's ABSOLUTE wallet and bag totals rather than a delta, so
     * calling it once per frame and again at close still pays exactly once — and it
     * pays while the page is up, which is where the disc's case 0x14 / 0x15 blocks
     * put the money in (see the header). It only touches state once the session has
     * actually moved a total away from the value it was seeded with.
     */
    function payout(session) {
        if (!r._open || !r._state) return;
        const bits = session.bits();
        const held = session.heldCount(r._opts?.dropItemId ?? 0);
        if (bits === r._seedBits && held === r._seedHeld) return;
        commit();
        r._seedBits = bits;
        r._seedHeld = held;
    }

    r.open = (opts = {}) => {
        r._open = true;
        r._pending = true;
        r._failed = false;
        r._error = null;
        r._session = null;
        r._ticks = 0;
        r._summary = null;
        r._seedBits = null;
        r._seedHeld = null;
        r._onClose = opts.onClose ?? null;
        r._state = opts.gameState ?? null;
        r._opts = opts;
        r._lastDiagnostic = null;
        const selected = r._state?.languageByte;
        const language = Number.isInteger(selected) ? selected : 2;
        const request = ++r._request;
        loadData(language).then((data) => {
            if (request === r._request) r._data = data;
        }).catch((error) => {
            if (request === r._request) fail(error);
        });
    };

    r.isOpen = () => r._open;

    // Input arrives as key events, but the screen reads the pad service's held
    // words once per frame (state.keys carries every held button).
    r.handleKey = (_k, state) => {
        if (state && !r._state) r._state = state;
    };

    r.update = (dt) => updateNativeSession(r, dt, {
        ready: () => r._data,
        start: () => startSession(),
        held: () => r._state?.keys ? [...r._state.keys] : [],
        fail,
        onFrame: (session) => payout(session),
    });

    // The report is a framebuffer takeover: it fills the whole canvas, at
    // device resolution when the battle owns a fullscreen canvas, exactly like
    // every other battle surface. `fitNativeScreen` is the shared rule (fit the
    // native 320x240 image to the canvas, resetting the caller's transform).
    r.draw = (ctx, _viewW = 320) => {
        if (!r._open || !r._session) return;
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        fitNativeScreen(ctx);
        paintNativeSession(ctx, renderer, r._session);
        ctx.restore();
    };

    r.close = () => {
        if (r._open) r._finish();
    };

    r._finish = () => {
        if (!r._open) return;
        r._open = false;
        r._pending = false;
        ++r._request;
        const session = r._session;
        if (session) {
            const finished = session.finished();
            // Read every private and paid value while the session is alive.
            const positions = (r._opts?.participants ?? []).map((p) => p.pos ?? 0);
            r._summary = {
                finished, ticks: r._ticks, bits: session.bits(),
                heldDrop: (r._opts?.dropItemId ?? 0) > 0 ? session.heldCount(r._opts.dropItemId) : null,
                transition: session.transition(),
                records: positions.map((pos) => { try { return { pos, ...session.record(pos) }; } catch { return null; } }),
                sounds: session.sounds.slice(), loadedBanks: session.loadedBanks.slice(),
                displayCalls: session.displayCalls.map((c) => ({ ...c })),
            };
            if (finished) commit();
            else session.dispose();
        }
        r._session = null;
        const cb = r._onClose;
        r._onClose = null;
        cb?.();
    };

    /** The live text widgets (for focused checks that read what the screen says). */
    r.textWidgets = () => (r._session ? r._session.widgets.textWidgets() : []);

    /** Diagnostics for the lab and focused browser checks. */
    r.diagnostics = () => ({
        execution: "translated",
        open: r._open,
        pending: r._pending,
        failed: r._failed,
        error: r._error?.message ?? null,
        ticks: r._ticks,
        traps: 0,
        host: null,
        state: r._session?.state() ?? null,
        rows: r._session?.rows() ?? [],
        tasks: r._session?.tree.tasks.size ?? 0,
        sounds: r._session ? r._session.sounds.slice() : (r._summary?.sounds ?? []),
        loadedBanks: r._session ? r._session.loadedBanks.slice() : (r._summary?.loadedBanks ?? []),
        displayCalls: r._session ? r._session.displayCalls.map((c) => ({ ...c })) : (r._summary?.displayCalls ?? []),
        records: r._session
            ? (r._opts?.participants ?? []).map((p) => { try { return { pos: p.pos ?? 0, ...r._session.record(p.pos ?? 0) }; } catch { return null; } })
            : (r._summary?.records ?? []),
        summary: r._summary,
        renderer: renderer.stats,
        lastDiagnostic: r._lastDiagnostic,
    });

    return r;
}
