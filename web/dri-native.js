// The Digimon Lab as a production native screen (Phase 6.3 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// The player meets the shipped pro/stgdglab overlay: the "Select Action" desk
// with Switch Digimon, Digivolve and the four-page Digivolve Chart. This module
// is only the state adapter between web/game.js and the screen's RAM contract;
// the screen itself runs through web/native-screen-host.js and engine/native.
//
// Contract (.dw3-research/dri-route/worker-lab.md, lead-verified against
// exe-decomp/stgdglab_c/** and the shipped assembly):
//   * root ctor F0x8008EFD0 / tick F0x8008ED0C. Back (the screen reads Cross)
//     starts a 30-frame fade; the root's action tick sets lifecycle 3 when the
//     fade finishes, which is the close signal (nativeScreenFinished).
//   * the lab writes exactly four save cells: the party map ctx+0x70 (Switch
//     confirm F0x8008B798 case 8), the roster's current form record+0x04 and
//     equipped-form triple record+0x50 (change-type grid F0x80085DD0 cases 1/4),
//     and one form-ledger entry record+0x58+i*0x14 (load-technique chooser
//     F0x8008C960 case 40). It never writes equipment, EXP, DVEXP or stats.
//   * id space: the save stores the profile table's value0 id (383 = Kotemon),
//     not the walker's 1-based digimon.json id. The table is resident at
//     0x8003EF5C, 55 rows of 0x58 bytes, value0 at +0x00; row i-1 = id i.
//   * the party map is packed by the screen itself (F0x8008EC50): non-negative
//     roster slots first, 0xFFFFFFFF = an empty pedestal. The walker's party is
//     dense, so the two agree.
//   * the roster record's ledger region (record+0x58, 44 x 0x14) holds
//     {value0 u16, formLevel u8, present u8, DVEXP u32, six flagged tech u16}.
//
// The hand-authored screen (web/dri.js) stays as the development rollback
// (?legacyDri=1); nothing here falls back to it.

import {
    maskFromButtons, ROSTER_SLOT_CHARIDS, rosterSlotDigimonId, syncWornFromEquipment,
} from "./vendor/engine.js";
import {
    openNativeScreen,
    preloadNativeScreens,
    nativeScreensReady,
} from "./native-screen-host.js";
import { RECORD_EQUIP_OFFSETS, encodeNativeScreenText } from "./native-screen.js";
import { baseStatsFor, CHARID_TO_DIGID } from "./party.js";
import { ensureFormLedger } from "./dri-model.js";
import { persistDriState } from "./dri.js";

const MODULE_ID = "pro/stgdglab";
const SAVE_CONTEXT = 0x80048d34;
const PARTY_MAP = SAVE_CONTEXT + 0x70;
const ROSTER = 0x80049494;
const STRIDE = 0x3dc;
const PROFILE_TABLE = 0x8003ef5c;
const PROFILE_STRIDE = 0x58;
const PROFILE_ROWS = 55;
const ROSTER_SLOTS = 8;
const LEDGER_ENTRIES = 44;
const LEDGER_STRIDE = 0x14;
const EQUIPPED = 0x50; // record+0x50..0x54, three u16 value0 (0xFFFF empty)
const CURRENT_FORM = 0x04;
const LEDGER = 0x58;
const EMPTY_SLOT = 0xffffffff;
/** Record offsets the shared party seeder writes (digimon-cur-stats-helpers.md). */
const REC = { exp: 0x20, level: 0x24, tp: 0x26, hp: 0x28, maxHp: 0x2a, mp: 0x2c, maxMp: 0x2e, core: 0x30, elements: 0x3c };

let TABLES = null;
let tablesPromise = null;
/** digimon.json: profiles for the base-stat fallback and species names. The
 *  screen's own chart tables are inside the overlay image, not here. */
function loadTables() {
    if (!tablesPromise) {
        tablesPromise = fetch("assets/data/digimon.json")
            .then((r) => r.json())
            .then((j) => {
                TABLES = { digimonById: Object.fromEntries(j.digimon.map((d) => [d.id, d])) };
                return TABLES;
            })
            .catch(() => null);
    }
    return tablesPromise;
}

function rosterSlotFor(charId) {
    const i = ROSTER_SLOT_CHARIDS.indexOf(String(charId));
    return i < 0 ? EMPTY_SLOT : i;
}

function ownedSlots(state) {
    const mask = Number(state?.rosterOwned) || 0;
    const slots = [];
    for (let s = 0; s < ROSTER_SLOTS; s++) if (mask & (1 << s)) slots.push(s);
    return slots;
}

/** The walker's stats object for a roster slot: the deployed party's live
 *  block, or the reserve store keyed by character id. */
function slotStats(state, slot) {
    const charId = ROSTER_SLOT_CHARIDS[slot];
    const pos = (state.party ?? []).indexOf(charId);
    if (pos === 0) return state.partnerStats ?? null;
    if (pos > 0) return state.partyStats?.[pos] ?? null;
    return state.reserveStats?.[charId] ?? null;
}

function slotEquipment(state, slot) {
    const charId = ROSTER_SLOT_CHARIDS[slot];
    const pos = (state.party ?? []).indexOf(charId);
    if (pos >= 0) return state.equipment?.[pos] ?? null;
    return state.reserveEquipment?.[charId] ?? null;
}

/** The runtime's own profile table, both directions. */
function profileMaps(read) {
    const v0ById = new Map();
    const idByV0 = new Map();
    for (let id = 1; id <= PROFILE_ROWS; id++) {
        const v = Number(read(PROFILE_TABLE + (id - 1) * PROFILE_STRIDE, 2)) & 0xffff;
        if (!v) continue;
        v0ById.set(id, v);
        idByV0.set(v, id);
    }
    return { v0ById, idByV0 };
}

export function createDriNative(sfx = null) {
    const d = {
        _open: false,
        _pending: false,
        _host: null,
        _state: null,
        _onClose: null,
        _packed: {},
        _lastDiagnostic: null,
    };
    loadTables().catch(() => {});
    const playPackedSound = (id) => {
        const key = id >>> 0;
        d._packed[key] = (d._packed[key] ?? 0) + 1;
        sfx?.playPacked(key);
    };

    function boot() {
        const state = d._state ?? {};
        const host = openNativeScreen(MODULE_ID, {
            playPackedSound,
            seed: ({ read, write }) => seed(read, write, state),
        });
        if (!host) return false;
        d._host = host;
        return true;
    }

    /** Walker state -> the save cells the lab reads. Every owned roster slot
     *  gets a full record: owned marker, name, stats, gear, current form,
     *  equipped triple and its form ledger. */
    function seed(read, write, state) {
        const db = TABLES?.digimonById ?? {};
        const { v0ById } = profileMaps(read);
        const w16 = (addr, v) => write(addr, (Number(v) || 0) & 0xffff, 2);
        const party = Array.isArray(state.party) ? state.party : [];
        for (let i = 0; i < 3; i++) {
            const slot = party[i] ? rosterSlotFor(party[i]) : EMPTY_SLOT;
            write(PARTY_MAP + i * 4, slot >>> 0, 4);
        }
        for (const slot of ownedSlots(state)) {
            const rec = ROSTER + slot * STRIDE;
            const charId = ROSTER_SLOT_CHARIDS[slot];
            const starterId = rosterSlotDigimonId(slot);
            const stats = slotStats(state, slot) ?? baseStatsFor(db[starterId]) ?? {};
            ensureFormLedger(stats, db);
            write(rec + 0x00, (slot + 3) >>> 0, 4);
            const form = Number(stats.digimonId);
            write(rec + CURRENT_FORM, (form > 8 ? (v0ById.get(form) ?? 0) : 0) >>> 0, 4);
            const name = state.digimonNames?.[charId] ?? db[starterId]?.name ?? charId;
            const bytes = encodeNativeScreenText(name);
            bytes.forEach((b, i) => write(rec + 0x08 + i, b, 1));
            write(rec + 0x08 + bytes.length, 0, 1);
            write(rec + REC.exp, Number(stats.xp) || 0, 4);
            w16(rec + REC.level, stats.level);
            w16(rec + REC.tp, stats.tp);
            w16(rec + REC.hp, stats.hp);
            w16(rec + REC.maxHp, stats.maxHp);
            w16(rec + REC.mp, stats.mp);
            w16(rec + REC.maxMp, stats.maxMp);
            (stats.core ?? []).forEach((v, i) => w16(rec + REC.core + i * 2, v));
            (stats.elements ?? []).forEach((v, i) => w16(rec + REC.elements + i * 2, v));
            const eq = slotEquipment(state, slot) ?? {};
            for (const [name_, off] of RECORD_EQUIP_OFFSETS) w16(rec + off, eq[name_]);
            const equipped = Array.isArray(stats.equippedForms) ? stats.equippedForms : [];
            for (let i = 0; i < 3; i++) {
                const id = Number(equipped[i]) || 0;
                w16(rec + EQUIPPED + i * 2, id > 8 ? (v0ById.get(id) ?? 0xffff) : 0xffff);
            }
            const ledger = Array.isArray(stats.formLedger) ? stats.formLedger : [];
            for (let i = 0; i < LEDGER_ENTRIES; i++) {
                const base = rec + LEDGER + i * LEDGER_STRIDE;
                const entry = ledger[i];
                const value = entry ? v0ById.get(Number(entry.id)) : 0;
                if (!entry || !value) {
                    for (let o = 0; o < LEDGER_STRIDE; o += 4) write(base + o, 0, 4);
                    continue;
                }
                w16(base + 0x00, value);
                write(base + 0x02, Math.max(1, Number(entry.formLevel) || 1) & 0xff, 1);
                write(base + 0x03, 1, 1);
                write(base + 0x04, Number(entry.dvexp) || 0, 4);
                for (let j = 0; j < 6; j++) w16(base + 0x08 + j * 2, entry.techSlots?.[j]);
            }
        }
    }

    d.open = (state, onClose = null) => {
        d._open = true;
        d._state = state ?? d._state ?? null;
        d._onClose = onClose;
        d._lastDiagnostic = null;
        preloadNativeScreens().catch((e) => {
            d._lastDiagnostic = `native screen preload failed: ${e?.message ?? e}`;
        });
        if (!boot()) d._pending = true;
    };

    d.isOpen = () => d._open;

    /** The native lab polls the pad itself, so the walker's key handler only
     *  keeps the state pointer fresh (the pad is read from state.keys). */
    d.handleKey = (_k, state) => {
        if (state && !d._state) d._state = state;
    };

    d.update = (dt) => {
        if (!d._open) return;
        if (d._pending) {
            if (!nativeScreensReady() || !TABLES) {
                if (nativeScreensReady()) loadTables().catch(() => {});
                preloadNativeScreens().catch(() => {});
                return;
            }
            if (!boot()) {
                d._lastDiagnostic = "native lab boot failed (manifest/overlay missing)";
                return;
            }
            d._pending = false;
        }
        const keys = d._state?.keys;
        // The pad word goes over as it stands: this screen reads confirm on
        // 0x2000 and back on 0x4000, the bits the walker now sends.
        d._host.setPad(keys ? maskFromButtons(keys) : 0);
        if (d._host.tick(dt)) d._finish();
    };

    d.draw = (ctx, viewW, viewH) => {
        if (!d._open || !d._host) return;
        d._host.draw(ctx, viewW, viewH);
    };

    d.close = () => {
        if (!d._open) return;
        d._finish();
    };

    d._finish = () => {
        if (!d._open) return;
        d._open = false;
        d._pending = false;
        const host = d._host;
        d._host = null;
        if (host) {
            readBack(host);
            host.teardown();
        }
        const cb = d._onClose;
        d._onClose = null;
        cb?.();
    };

    /** Apply the four cells the lab writes. The screen packs the party map
     *  itself (F0x8008EC50), so the non-negative slots in order are the party
     *  and the rest of the owned slots are the reserve. Each member keeps its
     *  own stats/equipment object, so a switched-out partner returns with the
     *  same block it left with. */
    function readBack(host) {
        const state = d._state;
        if (!state) return;
        const read = (a, s) => host.read(a, s);
        const { idByV0 } = profileMaps(read);
        const slots = [];
        for (let i = 0; i < 3; i++) {
            const v = read(PARTY_MAP + i * 4, 4) >>> 0;
            if (v !== EMPTY_SLOT && v < ROSTER_SLOTS) slots.push(v);
        }
        const owned = ownedSlots(state);
        const statBySlot = new Map();
        const equipBySlot = new Map();
        for (const slot of owned) {
            statBySlot.set(slot, slotStats(state, slot) ?? {});
            equipBySlot.set(slot, slotEquipment(state, slot) ?? {});
        }
        for (const slot of owned) {
            const stats = statBySlot.get(slot);
            const rec = ROSTER + slot * STRIDE;
            const form = read(rec + CURRENT_FORM, 4) >>> 0;
            const starterId = CHARID_TO_DIGID[ROSTER_SLOT_CHARIDS[slot]];
            if (form === 0) stats.digimonId = starterId;
            else if (idByV0.has(form)) stats.digimonId = idByV0.get(form);
            stats.equippedForms = [0, 1, 2].map((i) => {
                const v = read(rec + EQUIPPED + i * 2, 2) & 0xffff;
                return v === 0xffff ? 0 : (idByV0.get(v) ?? 0);
            });
            const ledger = [];
            for (let i = 0; i < LEDGER_ENTRIES; i++) {
                const base = rec + LEDGER + i * LEDGER_STRIDE;
                const value = read(base + 0x00, 2) & 0xffff;
                if (!value || !idByV0.has(value)) continue;
                ledger.push({
                    id: idByV0.get(value),
                    formLevel: read(base + 0x02, 1) & 0xff,
                    dvexp: read(base + 0x04, 4) >>> 0,
                    techSlots: Array.from({ length: 6 }, (_, j) => read(base + 0x08 + j * 2, 2) & 0xffff),
                });
            }
            stats.formLedger = ledger;
        }
        const party = [];
        const partyStats = [];
        const equipment = [];
        for (const slot of slots) {
            party.push(ROSTER_SLOT_CHARIDS[slot]);
            partyStats.push(statBySlot.get(slot));
            equipment.push(equipBySlot.get(slot));
        }
        if (party.length) {
            state.party = party;
            state.partyStats = partyStats;
            state.equipment = equipment;
            // A formation change moves gear between records; the worn byte counts
            // every record's gear, so it is recomputed rather than carried over.
            syncWornFromEquipment(state);
            state.partnerStats = partyStats[0];
            state.charId = party[0];
            const charIndex = state.manifest?.characters?.findIndex((c) => c.id === state.charId) ?? -1;
            if (charIndex >= 0) state.charIdx = charIndex;
            const char = state.manifest?.characters?.[state.charIdx];
            if (char && state.partnerStats?.digimonId) char.digimonId = state.partnerStats.digimonId;
        }
        const deployed = new Set(slots);
        if (!state.reserveStats) state.reserveStats = {};
        if (!state.reserveEquipment) state.reserveEquipment = {};
        for (const charId of Object.keys(state.reserveStats)) {
            if (party.includes(charId)) delete state.reserveStats[charId];
        }
        for (const charId of Object.keys(state.reserveEquipment)) {
            if (party.includes(charId)) delete state.reserveEquipment[charId];
        }
        for (const slot of owned) {
            if (deployed.has(slot)) continue;
            const charId = ROSTER_SLOT_CHARIDS[slot];
            state.reserveStats[charId] = statBySlot.get(slot);
            state.reserveEquipment[charId] = equipBySlot.get(slot);
        }
        persistDriState(state);
    }

    /** Focused-verification hook: write into the running screen's RAM. */
    d.writeMemory = (addr, value, size = 4) => d._host?.write?.(addr, value, size) ?? null;

    d.diagnostics = () => ({
        open: d._open,
        pending: d._pending,
        packed: { ...d._packed },
        host: d._host?.state() ?? null,
        screen: (() => {
            const rt = d._host?.rt;
            if (!rt) return null;
            const read = (a) => d._host.read(a, 4) >>> 0;
            const root = rt.world.objects[0]?.addr ?? 0;
            const aux = root ? read(root + 0x24) : 0;
            return {
                root, aux,
                objects: rt.world.objects.map((o) => ({ addr: o.addr >>> 0, cb: o.cb >>> 0, alive: o.alive })),
                rootState: root ? read(root + 0xc) : null,
                rootUnk10: root ? read(root + 0x10) : null,
                auxChild: aux ? read(aux + 4) : null,
                party: [0, 1, 2].map((i) => read(PARTY_MAP + i * 4)),
            };
        })(),
        renderer: d._host?.renderer
            ? (() => {
                const r = d._host.renderer.stats;
                return {
                    frames: r.frames, clips: r.clips, skipped: r.skipped,
                    byPack: { ...r.byPack }, seen: [...r.seen], last: r.last,
                };
            })()
            : null,
        lastDiagnostic: d._lastDiagnostic,
    });

    return d;
}
