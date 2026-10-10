// Browser adapter for the translated memory-card screen (pro/stgmcard): the SAVE /
// LOAD screen. The screen's logic runs in engine/dw3/ui (MemcardSession); this file
// loads its data, ticks it on the display clock, paints the picture calls, the text
// and the closing dim, serves the virtual card, and COMMITS the outcome to the
// walker's persistence once, after the screen has closed. It never executes original
// instructions and never requests an executable asset.
// `?nativeSave=1` keeps the original-code screen as a research reference
// (web/save-native.js); `?legacySave=1` keeps the hand-made screen (web/save.js).
//
// Card contract (web/memcard.js builds the directory block): the card is the walker's
// three localStorage slots. During the screen a written save image lands in a session
// card only (so the directory the screen re-reads shows it); nothing reaches
// localStorage, and nothing is restored, until the screen closes:
//   commit = { saved: [{slot, image}], loadedSlot }
//   * saved slots carry the resident image and browser-only companion state;
//   * loaded mapped fields are read from the image, then the page reloads.
// Unexplained resident data survives the next save via residentSaveImage.
import { ui, rosterSlotOfCharId, itemCountEntries, ROSTER_SLOT_CHARIDS } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { paintNativeSession, updateNativeSession } from "./native-session.js";
import { buildDirectoryBlock, slotForFile } from "./memcard.js";
import { buildRecord, readSlot, restoreSlotData, writeSlot } from "./save.js";
import { fetchBytes, fetchJson, loadResidentResources, loadProfileRecords } from "./resident-data.js";

/** The card art: 0x029D0000 is disc index 669 (STMCRDCS), 0x02860000 is 646 (CMFONT). */
const PACKS = { 669: "stmcrd", 646: "cmfont" };
/** Text families by offset and the data directory that ships them (language added). */
const BANKS = [[0x78, "memcard"], [0xa9, "memcard"], [0x94, "shop-banks"]];

const DATA_LABEL = "Memory card data";

const dataByLanguage = new Map();
function loadData(language) {
    if (!dataByLanguage.has(language)) {
        dataByLanguage.set(language, Promise.all([
            fetchJson("memcard/manifest.json", DATA_LABEL),
            fetchBytes("memcard/tables.bin", DATA_LABEL),
            loadResidentResources().then((shared) => ({ font: shared.font, cursorGlyphs: shared.cursorGlyphs })),
            loadProfileRecords(DATA_LABEL),
            ...BANKS.map(([offset, dir]) => fetchBytes(`${dir}/${offset + language}.bin`, DATA_LABEL)),
        ]).then(([manifest, tables, resident, profiles, ...banks]) => ({
            tables, font: resident.font, cursorGlyphs: resident.cursorGlyphs, profiles,
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
    }
    return bytes;
}

export function createSaveTranslated(sfx = null) {
    const r = {
        _open: false, _pending: false, _failed: false, _error: null, _session: null, _data: null,
        _state: null, _mode: "save", _opts: {}, _onClose: null, _clock: null, _ticks: 0, _request: 0,
        _card: null, _commit: null, _summary: null, _lastDiagnostic: null,
    };
    const renderer = createNativeScreenRenderer({ pack: "stmcrd", packs: PACKS },
        (directory) => PACKS[directory >>> 16] ?? null);
    const playSound = (id) => { sfx?.playPacked(id); };

    /** The session card: a copy of the walker's slots; writes stay here until the commit. */
    function makeCard() {
        const slots = [0, 1, 2].map((i) => {
            const slot = readSlot(i);
            if (!slot?.record) return null;
            return { record: slot.record, image: Array.isArray(slot.image) ? Uint8Array.from(slot.image) : null };
        });
        const saved = [];
        return {
            slots, saved,
            present: () => true,
            directory: (file) => buildDirectoryBlock(slots.map((s) => s?.record ?? null), slotForFile(file)),
            image: (file) => {
                const image = slots[slotForFile(file)]?.image;
                return image ? Uint8Array.from(image) : null;
            },
            // The directory block is rebuilt from the slot records, so its write carries nothing new.
            writeDirectory: () => {},
            writeImage: (file, bytes) => {
                const slot = slotForFile(file);
                const opts = { ...(r._opts ?? {}) };
                const seconds = Math.max(0, Math.floor(opts.playSeconds ?? r._state?.playSeconds ?? 0));
                slots[slot] = {
                    record: buildRecord(r._state, { ...opts, playSeconds: seconds }),
                    image: Uint8Array.from(bytes),
                };
                saved.push({ slot, image: Uint8Array.from(bytes), playSeconds: seconds });
                sfx?.play("system01");
            },
        };
    }

    /** Walker state -> the session's seed (the RAM contract of the disc's screen). */
    function buildSeed(language) {
        const state = r._state ?? {};
        const party = Array.isArray(state.party) ? state.party : [];
        const slots = r._opts?.partySlots ?? party.map((id) => rosterSlotOfCharId(id) ?? 0xffffffff);
        const view = typeof r._opts.roster === "function" ? r._opts.roster(state) : [];
        const members = [];
        for (let i = 0; i < 3; i++) {
            if (!party[i] || slots[i] === 0xffffffff) break;
            const st = (state.partyStats ?? [])[i] ?? {};
            const shown = view[i] ?? st;
            members.push({
                position: i, rosterSlot: slots[i] ?? i,
                nameBytes: encodeName(state.digimonNames?.[party[i]] ?? shown.name),
                exp: Number(st.xp) || 0, level: Number(st.level) || 1,
                lastUltraDrill: st.lastUltraDrill,
                tp: st.tp, hp: st.hp, maxHp: st.maxHp, mp: st.mp, maxMp: st.maxMp,
                forms: { digimonId: st.digimonId, equippedForms: st.equippedForms, formLedger: st.formLedger, rawLedger: st.rawLedger },
                core: shown.core, elements: shown.elements, equipment: state.equipment?.[i],
            });
        }
        const reserves = [];
        for (let slot = 0; slot < ROSTER_SLOT_CHARIDS.length; slot++) {
            const id = ROSTER_SLOT_CHARIDS[slot];
            if (party.includes(id)) continue;
            const st = state.reserveStats?.[id];
            if (!st && !(state.rosterOwned & (1 << slot))) continue;
            const rec = st ?? {};
            const shown = r._opts.reserveRoster?.(id, rec) ?? rec;
            reserves.push({ position: -1, rosterSlot: slot, nameBytes: encodeName(state.digimonNames?.[id] ?? shown.name),
                exp: rec.xp ?? 0, level: rec.level ?? 1, lastUltraDrill: rec.lastUltraDrill, tp: rec.tp, hp: rec.hp, maxHp: rec.maxHp, mp: rec.mp, maxMp: rec.maxMp,
                core: shown.core, elements: shown.elements, equipment: state.reserveEquipment?.[id],
                forms: { digimonId: rec.digimonId, equippedForms: rec.equippedForms, formLedger: rec.formLedger, rawLedger: rec.rawLedger } });
        }
        let residentImage;
        try { residentImage = JSON.parse(localStorage.getItem("residentSaveImage") ?? "null") ?? undefined; } catch {}
        let cards;
        try {
            const c = JSON.parse(localStorage.getItem("cardCollection") ?? "null");
            if (c) cards = { ...c, folders: (c.folders ?? []).map(f => ({ cards: f.cards })) };
        } catch {}
        return {
            reserves, residentImage, cards,
            storedFlags: JSON.parse(localStorage.getItem("engineFlags") ?? "{}"),
            progressOrdinal: state.progressOrdinal ?? 0,
            packId: ({A:0,B:1,C:2})[state.packId] ?? 0,
            language, mode: r._mode, savePointSlot: r._opts?.savePointSlot,
            bits: Number(state.bits) || 0,
            // Both item count arrays for every id 1..402, straight from the shared
            // store: state 0x33 copies the whole 0x26C4-byte block onto the card.
            // The old `id < 256` filter dropped every accessory from SniperSuit up.
            bag: itemCountEntries(state),
            playSeconds: Math.max(0, Math.floor(r._opts?.playSeconds ?? state.playSeconds ?? 0)),
            playerNameBytes: encodeName(state.playerName),
            members,
        };
    }

    function fail(error) {
        r._error = error;
        r._failed = true;
        r._lastDiagnostic = `translated save screen failed: ${error?.message ?? error}`;
        console.error("Translated save screen failed", error);
    }

    function language() {
        const selected = r._state?.languageByte;
        return Number.isInteger(selected) ? selected : 2;
    }

    function startSession() {
        r._card = makeCard();
        r._session = new ui.MemcardSession(buildSeed(language()), r._data, { playSound, card: r._card });
        r._clock = new ui.MenuDisplayClock();
    }

    /** The single commit, after the screen closed: what the card took and which slot was loaded. */
    function commit() {
        const card = r._card;
        const session = r._session;
        const result = { saved: [], loadedSlot: null };
        if (!card || !session) return result;
        for (const item of card.saved) {
            writeSlot(item.slot, {
                record: card.slots[item.slot]?.record, image: item.image, data: null, state: r._state, playSeconds: item.playSeconds, residentImageVersion: 1,
            });
            result.saved.push(item.slot);
        }
        const restored = session.services.restored;
        if (restored.length) {
            result.loadedSlot = restored[restored.length - 1];
            restoreSlotData(result.loadedSlot, r._data.profiles);
            if (typeof localStorage !== "undefined") {
                try { localStorage.setItem("mcardLastSlot", String(result.loadedSlot)); } catch { /* storage blocked */ }
            }
            if (!r._noReload && typeof location !== "undefined") {
                // The page reloads into the loaded slot: the boot skips the language and
                // title screens once (web/game.js "resumeAfterLoad"), as the original goes
                // straight to the field after a load.
                try { sessionStorage.setItem("resumeAfterLoad", "1"); } catch { /* storage blocked */ }
                location.reload();
            }
        }
        return result;
    }

    r.open = (gameState, mode = "save", onClose = null, opts = {}) => {
        r._open = true;
        r._pending = true;
        r._failed = false;
        r._error = null;
        r._session = null;
        r._ticks = 0;
        r._summary = null;
        r._commit = null;
        r._mode = mode === "load" ? "load" : "save";
        r._state = gameState ?? null;
        r._opts = opts ?? {};
        r._onClose = onClose;
        r._lastDiagnostic = null;
        const request = ++r._request;
        loadData(language()).then((data) => {
            if (request === r._request) r._data = data;
        }).catch((error) => {
            if (request === r._request) fail(error);
        });
    };

    r.isOpen = () => r._open;

    // Input arrives as key events, but the screen reads the pad service's words once
    // per frame (state.keys carries every held button).
    r.handleKey = (_k, state) => {
        if (state && !r._state) r._state = state;
    };

    r.update = (dt) => updateNativeSession(r, dt, {
        ready: () => r._data,
        start: () => startSession(),
        held: () => r._state?.keys ? [...r._state.keys] : [],
        fail,
    });

    r.draw = (ctx, viewW = 320) => {
        if (!r._open || !r._session) return;
        const s = viewW / 320;
        ctx.save();
        ctx.scale(s, s);
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
        let result = { saved: [], loadedSlot: null };
        if (session) {
            r._summary = {
                finished: session.finished(), ticks: r._ticks,
                transition: session.transition(), sounds: session.sounds.slice(),
                transfers: session.services.transfers.map((t) => ({ ...t })),
                displayCalls: session.displayCalls.map((c) => ({ ...c })),
                soundArchives: session.soundArchives.slice(),
            };
            result = commit();
            session.dispose();
        }
        r._commit = result;
        r._session = null;
        const cb = r._onClose;
        r._onClose = null;
        // A load replaces the page; the caller's continuation would resume a game that is gone.
        if (result.loadedSlot === null) cb?.();
    };

    r.textWidgets = () => (r._session ? r._session.widgets.textWidgets() : []);

    /** Diagnostics for the lab and focused browser checks. */
    r.diagnostics = () => ({
        execution: "translated",
        open: r._open, pending: r._pending, failed: r._failed, error: r._error?.message ?? null,
        mode: r._mode, ticks: r._ticks, traps: 0, host: null,
        state: r._session?.state() ?? null,
        tasks: r._session?.tree.tasks.size ?? 0,
        savedSlot: r._commit?.saved?.length ? r._commit.saved[r._commit.saved.length - 1] : null,
        loadedSlot: r._commit?.loadedSlot ?? null,
        commit: r._commit,
        stores: r._card?.saved.map((s) => ({ slot: s.slot })) ?? [],
        transfers: r._session ? r._session.services.transfers.map((t) => ({ ...t })) : (r._summary?.transfers ?? []),
        sounds: r._session ? r._session.sounds.slice() : (r._summary?.sounds ?? []),
        summary: r._summary,
        renderer: renderer.stats,
        lastDiagnostic: r._lastDiagnostic,
    });

    /** Test seam: skip the page reload a load performs (the verifier reads the restored storage instead). */
    r._setNoReload = (v) => { r._noReload = !!v; };

    return r;
}
