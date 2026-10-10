// Browser adapter for the translated Digimon lab (pro/stgdglab): the desk where the player
// switches the standing partner, changes a partner's form and loaded techniques, and reads the
// Digivolve Chart. The screen's logic runs in engine/dw3/ui (LabSession); this file loads its
// data, seeds the walker's party into the session, ticks it on the display clock, paints the
// picture calls, the text and the closing dim, and commits what the screen changed to the walker's
// state once, after it has closed. It never executes original instructions and never requests an
// executable asset.
// `?nativeLab=1` keeps the original-code screen as a research reference (web/dri-native.js);
// `?legacyDri=1` keeps the hand-made screen (web/dri.js).
//
// State contract (who changes what, exactly once). The screen changes only four kinds of save cell
// (stgdglab-writes-only-four-save-cells-2026-09-21), and on close the adapter reads each once:
//   party map word        Switch Digimon: the roster slot standing at a party position. The party,
//                         its stats and gear are reordered to match and the displaced partner goes
//                         to the reserve with the block it left with.
//   current form          record+0x04: a profile value0 id (stgdglab-form-ids-are-profile-value0-
//                         2026-09-21), 0 = the starter's own form -> the partner's digimonId.
//   equipped-form triple  record+0x50 -> the partner's equippedForms.
//   one ledger entry      the loaded flag of a technique -> that entry's techSlots.
// Nothing else of the walker's model is touched: the lab never writes equipment, EXP, DVEXP or stats,
// and applies no digivolution (that is the fight report's). The walker's Back key is Triangle; the
// screen's Back row reads the Cross bit (stgdglab-closes-on-root-lifecycle-3-2026-09-21), so
// Triangle is delivered as Cross, as the interpreter route always did.
//
// Same public API as createDriNative: open/isOpen/handleKey/update/draw/close/diagnostics.
import {
    ROSTER_SLOT_CHARIDS, rosterSlotDigimonId, syncWornFromEquipment, ui,
} from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { paintNativeSession, updateNativeSession } from "./native-session.js";
import { baseStatsFor, CHARID_TO_DIGID } from "./party.js";
import { ensureFormLedger } from "./dri-model.js";
import { encodeGymName } from "./gym-translated.js";
import { fetchBytes, fetchJson, loadProfileRecords, loadResidentResources } from "./resident-data.js";

/** The lab's picture handles: the stdglabo archive (chrome and the chart's portraits) and CMFONT. */
const PACK_NAMES = { 0x02c50000: "stdglabo", 0x02c50001: "stdglabo_portraits", 0x02860000: "cmfont" };
const packName = (handle) => PACK_NAMES[handle >>> 0] ?? null;
const PARTY_SLOTS = 3;
const ROSTER_SLOTS = 8;
const LEDGER_ENTRIES = 44;
const EMPTY = 0xffff;
const EQUIPMENT_SLOTS = ["head", "body", "right", "left", "acc0", "acc1"];
/** The directory each shared text bank family lives in. */
const SHARED_DIRS = { wizard: "wizard", pause: "pause" };

const DATA_LABEL = "Lab data";

let sharedPromise = null;
const loadShared = () => {
    sharedPromise ??= (async () => {
        const manifest = await fetchJson("lab/manifest.json", DATA_LABEL);
        const [tables, resident, profiles, { font, cursorGlyphs }, catalog, itemRecords, main, extra, digimon] = await Promise.all([
            fetchBytes("lab/tables.bin", DATA_LABEL), fetchBytes("lab/resident.bin", DATA_LABEL),
            loadProfileRecords(DATA_LABEL), loadResidentResources(),
            fetchJson("shop_catalog.json", DATA_LABEL), fetchBytes("shop_item_records.bin", DATA_LABEL),
            fetchBytes("shop_descriptors_main.bin", DATA_LABEL), fetchBytes("shop_descriptors_extra.bin", DATA_LABEL),
            fetchJson("digimon.json", DATA_LABEL),
        ]);
        // Each row's own form id, out of the one shared cut: this is the lab's own id
        // bridge (value0 per row), read straight from the table's first halfword.
        const shared = manifest.sharedProfiles;
        if (profiles.length !== shared.rows * shared.stride) throw new Error(`${DATA_LABEL}: profile table`);
        const value0 = [];
        for (let row = 0; row < shared.rows; row++) {
            const at = row * shared.stride;
            value0.push(profiles[at] | (profiles[at + 1] << 8));
        }
        return {
            manifest, tables, resident, profiles, font, cursorGlyphs, catalog, itemRecords, descriptors: [main, extra],
            digimonById: Object.fromEntries(digimon.digimon.map((d) => [d.id, d])), value0,
        };
    })().catch((error) => { sharedPromise = null; throw error; });
    return sharedPromise;
};
const banksByLanguage = new Map();
const loadBanks = (manifest, language) => {
    if (!banksByLanguage.has(language)) {
        const wanted = [{ id: 0x39 + language, path: `lab/${0x39 + language}.bin` }];
        for (const { offset, dir } of manifest.sharedBanks) wanted.push({ id: offset + language, path: `${SHARED_DIRS[dir]}/${offset + language}.bin` });
        banksByLanguage.set(language, Promise.all(wanted.map(async ({ id, path }) => [id, await fetchBytes(path, DATA_LABEL)]))
            .then((entries) => new Map(entries))
            .catch((error) => { banksByLanguage.delete(language); throw error; }));
    }
    return banksByLanguage.get(language);
};

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

export function createLabTranslated(sfx = null) {
    const g = {
        _open: false, _pending: false, _failed: false, _error: null, _session: null, _data: null, _state: null,
        _onClose: null, _clock: null, _ticks: 0, _request: 0, _members: [], _seededParty: [], _summary: null,
        _lastDiagnostic: null, _committed: 0, _banks: null, _packed: {},
    };
    const renderer = createNativeScreenRenderer(
        { pack: "stdglabo", packs: { "709:0": "stdglabo", "709:1": "stdglabo_portraits", "646:0": "cmfont" } }, packName);

    const playSound = (id) => {
        const key = id >>> 0;
        g._packed[key] = (g._packed[key] ?? 0) + 1;
        sfx?.playPacked(key);
    };

    const slotOfChar = (charId) => ROSTER_SLOT_CHARIDS.indexOf(String(charId));
    const ownedSlots = (state) => {
        const mask = Number(state?.rosterOwned) || 0;
        const slots = new Set();
        for (let s = 0; s < ROSTER_SLOTS; s++) if (mask & (1 << s)) slots.add(s);
        for (const charId of state?.party ?? []) { const s = slotOfChar(charId); if (s >= 0) slots.add(s); }
        return [...slots].sort((a, b) => a - b);
    };
    /** The walker's stats object for a roster slot: the deployed party's live block, or the reserve store. */
    const slotStats = (state, slot) => {
        const charId = ROSTER_SLOT_CHARIDS[slot];
        const pos = (state.party ?? []).indexOf(charId);
        if (pos === 0) return state.partnerStats ?? null;
        if (pos > 0) return state.partyStats?.[pos] ?? null;
        return state.reserveStats?.[charId] ?? null;
    };
    const slotEquipment = (state, slot) => {
        const charId = ROSTER_SLOT_CHARIDS[slot];
        const pos = (state.party ?? []).indexOf(charId);
        if (pos >= 0) return state.equipment?.[pos] ?? null;
        return state.reserveEquipment?.[charId] ?? null;
    };

    /** Walker state -> the session's seed (the RAM contract of the disc's screen). */
    function buildSeed(language) {
        const state = g._state ?? {};
        const { digimonById: db, value0 } = g._data;
        const v0ById = new Map();
        value0.forEach((v, row) => { if (v) v0ById.set(row + 1, v); });
        const party = Array.from({ length: PARTY_SLOTS }, (_, i) => (state.party?.[i] ? slotOfChar(state.party[i]) : -1));
        g._seededParty = party.slice();
        g._members = [];
        const members = ownedSlots(state).map((slot) => {
            const charId = ROSTER_SLOT_CHARIDS[slot];
            const starterId = rosterSlotDigimonId(slot);
            const stats = slotStats(state, slot) ?? baseStatsFor(db[starterId]) ?? {};
            ensureFormLedger(stats, db);
            const form = Number(stats.digimonId);
            const equipment = slotEquipment(state, slot) ?? {};
            const equipped = Array.from({ length: 3 }, (_, i) => {
                const id = Number(stats.equippedForms?.[i]) || 0;
                return id > 0 ? (v0ById.get(id) ?? EMPTY) : EMPTY;
            });
            const ledger = Array.from({ length: LEDGER_ENTRIES }, (_, i) => {
                const entry = stats.formLedger?.[i];
                const value = entry ? v0ById.get(Number(entry.id)) : 0;
                if (!entry || !value) return null;
                return {
                    value, formLevel: Math.max(1, Number(entry.formLevel) || 1), present: 1, dvexp: Number(entry.dvexp) || 0,
                    techniques: Array.from({ length: 6 }, (_, j) => (Number(entry.techSlots?.[j]) || 0) & 0xffff),
                };
            });
            const member = {
                slot, nameBytes: encodeGymName(state.digimonNames?.[charId] ?? db[starterId]?.name ?? charId),
                exp: Number(stats.xp) || 0, level: Number(stats.level) || 0, tp: Number(stats.tp) || 0,
                hp: Number(stats.hp) || 0, maxHp: Number(stats.maxHp) || 0, mp: Number(stats.mp) || 0, maxMp: Number(stats.maxMp) || 0,
                core: Array.from({ length: 6 }, (_, i) => Number(stats.core?.[i]) || 0),
                elements: Array.from({ length: 7 }, (_, i) => Number(stats.elements?.[i]) || 0),
                equipment: Object.fromEntries(EQUIPMENT_SLOTS.map((k) => [k, Number(equipment[k]) || 0])),
                currentForm: form > 8 ? (v0ById.get(form) ?? 0) : 0,
                equipped, ledger,
            };
            g._members.push({ slot, stats, equipment, starterId, member });
            return member;
        });
        return { language, party, members, returnSelector: Number(g._returnSelector) || 0 };
    }

    function fail(error) {
        g._error = error;
        g._failed = true;
        g._lastDiagnostic = `translated lab failed: ${error?.message ?? error}`;
        console.error("Translated lab failed", error);
    }

    function startSession() {
        const state = g._state;
        const language = Number.isInteger(state?.languageByte) ? state.languageByte : 2;
        const data = g._data;
        const resources = {
            tables: data.tables, resident: data.resident, ranges: data.manifest.resident.ranges,
            profiles: data.profiles,
            textButtons: Uint8Array.from(data.manifest.textButtons.bytes), font: data.font, cursorGlyphs: data.cursorGlyphs,
            banks: g._banks,
            catalog: data.catalog, itemRecords: data.itemRecords, descriptors: data.descriptors,
        };
        g._session = new ui.LabSession(buildSeed(language), resources, { playSound });
        g._clock = new ui.MenuDisplayClock();
    }

    function persist(state) {
        if (typeof localStorage === "undefined") return;
        localStorage.setItem("party", JSON.stringify(state.party ?? []));
        localStorage.setItem("partyStats", JSON.stringify(state.partyStats ?? []));
        localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats ?? {}));
        localStorage.setItem("equipment", JSON.stringify(state.equipment ?? []));
        localStorage.setItem("reserveStats", JSON.stringify(state.reserveStats ?? {}));
        localStorage.setItem("reserveEquipment", JSON.stringify(state.reserveEquipment ?? {}));
        if (state.charId) localStorage.setItem("charId", state.charId);
    }

    /** The screen's four save cells -> the walker's state (once). */
    function commit() {
        const session = g._session;
        const state = g._state;
        if (!session || !state || g._committed) return;
        g._committed++;
        const { value0 } = g._data;
        const idByV0 = new Map();
        value0.forEach((v, row) => { if (v) idByV0.set(v, row + 1); });
        let changed = false;
        // The current form, the equipped triple and the ledger entries, per roster record.
        for (const { slot, stats, starterId, member } of g._members) {
            const record = session.record(slot);
            if (record.currentForm !== member.currentForm) {
                if (record.currentForm === 0) stats.digimonId = starterId;
                else if (idByV0.has(record.currentForm)) stats.digimonId = idByV0.get(record.currentForm);
                changed = true;
            }
            if (!sameList(record.equipped, member.equipped)) {
                stats.equippedForms = record.equipped.map((v) => (v === EMPTY ? 0 : (idByV0.get(v) ?? 0)));
                changed = true;
            }
            record.ledger.forEach((entry, i) => {
                const before = member.ledger[i];
                if (!entry || !before || sameList(entry.techniques, before.techniques)) return;
                if (stats.formLedger?.[i]) { stats.formLedger[i].techSlots = entry.techniques.slice(); changed = true; }
            });
        }
        // The party map: reorder the party to the map; a partner that left keeps its block in the reserve.
        const map = session.partyMap();
        if (!sameList(map, g._seededParty)) {
            const statBySlot = new Map(g._members.map((m) => [m.slot, m.stats]));
            const equipBySlot = new Map(g._members.map((m) => [m.slot, m.equipment]));
            const slots = map.filter((s) => s >= 0);
            const party = slots.map((s) => ROSTER_SLOT_CHARIDS[s]);
            if (party.length) {
                state.party = party;
                state.partyStats = slots.map((s) => statBySlot.get(s));
                state.equipment = slots.map((s) => equipBySlot.get(s));
                syncWornFromEquipment(state); // same gear, different records
                state.partnerStats = state.partyStats[0];
                state.charId = party[0];
                const charIndex = state.manifest?.characters?.findIndex((c) => c.id === state.charId) ?? -1;
                if (charIndex >= 0) state.charIdx = charIndex;
                const char = state.manifest?.characters?.[state.charIdx];
                if (char && state.partnerStats?.digimonId) char.digimonId = state.partnerStats.digimonId;
            }
            const deployed = new Set(slots);
            state.reserveStats ??= {};
            state.reserveEquipment ??= {};
            for (const charId of Object.keys(state.reserveStats)) if (party.includes(charId)) delete state.reserveStats[charId];
            for (const charId of Object.keys(state.reserveEquipment)) if (party.includes(charId)) delete state.reserveEquipment[charId];
            for (const { slot } of g._members) {
                if (deployed.has(slot)) continue;
                const charId = ROSTER_SLOT_CHARIDS[slot];
                state.reserveStats[charId] = statBySlot.get(slot);
                state.reserveEquipment[charId] = equipBySlot.get(slot);
            }
            changed = true;
        }
        if (changed) persist(state);
    }

    g.open = async (state, onClose = null, selector = 0) => {
        g._open = true;
        g._pending = true;
        g._failed = false;
        g._error = null;
        g._session = null;
        g._ticks = 0;
        g._summary = null;
        g._committed = 0;
        g._onClose = onClose;
        g._state = state ?? null;
        g._returnSelector = selector;
        g._lastDiagnostic = null;
        g._packed = {};
        const request = ++g._request;
        const language = Number.isInteger(state?.languageByte) ? state.languageByte : 2;
        try {
            const data = await loadShared();
            const banks = await loadBanks(data.manifest, language);
            if (request !== g._request) return;
            g._data = data;
            g._banks = banks;
        } catch (error) {
            if (request === g._request) fail(error);
        }
    };

    g.isOpen = () => g._open;

    // The screen reads the pad service's held words once per frame (state.keys carries every
    // held button), so a key event only keeps the state pointer fresh.
    g.handleKey = (_k, state) => {
        if (state && !g._state) g._state = state;
    };

    const padKeys = () => (g._state?.keys ? [...g._state.keys] : []);

    g.update = (dt) => updateNativeSession(g, dt, {
        ready: () => g._data && g._banks,
        start: () => startSession(),
        held: () => padKeys(),
        fail,
    });

    g.draw = (ctx, viewW = 320, viewH = 240) => {
        if (!g._open || !g._session) return;
        const s = Math.max(1, Math.min(viewW / 320, viewH / 240));
        ctx.save();
        ctx.scale(s, s);
        paintNativeSession(ctx, renderer, g._session);
        ctx.restore();
    };

    g.close = () => {
        if (g._open) g._finish();
    };

    g._finish = () => {
        if (!g._open) return;
        g._open = false;
        g._pending = false;
        ++g._request;
        const session = g._session;
        if (session) {
            const finished = session.finished();
            // Read every private value while the session is alive.
            g._summary = {
                finished, ticks: g._ticks, transition: session.transition(), party: session.partyMap(),
                sounds: session.sounds.slice(), displayCalls: session.displayCalls.map((c) => ({ ...c })),
            };
            commit();
            if (!finished) session.dispose();
        }
        g._session = null;
        const cb = g._onClose;
        g._onClose = null;
        cb?.();
    };

    /** The live text widgets (for focused checks that read what the screen says). */
    g.textWidgets = () => (g._session ? g._session.widgets.textWidgets() : []);

    /** Diagnostics for the lab and focused browser checks. */
    g.diagnostics = () => ({
        execution: "translated",
        open: g._open,
        pending: g._pending,
        failed: g._failed,
        error: g._error?.message ?? null,
        ticks: g._ticks,
        traps: 0,
        host: null,
        packed: { ...g._packed },
        screen: g._session ? {
            ...g._session.state(), names: g._session.taskNames(), pane: g._session.panePhase(), child: g._session.childScreen(), childPhase: g._session.childPhase(),
            childLifecycle: g._session.childLifecycle(), party: g._session.partyMap(),
        } : null,
        tasks: g._session?.tree.tasks.size ?? 0,
        sounds: g._session ? g._session.sounds.slice() : (g._summary?.sounds ?? []),
        displayCalls: g._session ? g._session.displayCalls.map((c) => ({ ...c })) : (g._summary?.displayCalls ?? []),
        summary: g._summary,
        renderer: renderer.stats,
        lastDiagnostic: g._lastDiagnostic,
    });

    /** The walker-state write of the last close, for focused checks. */
    g.writeMemory = null;

    return g;
}
