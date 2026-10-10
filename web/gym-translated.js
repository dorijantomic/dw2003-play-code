// Browser adapter for the translated training gym (pro/stgtrain): the screen where a partner
// trains its statistics. The screen's logic runs in engine/dw3/ui (GymSession); this file loads
// its data, seeds the walker's party into the session, ticks it on the display clock, paints the
// picture calls, the text, the sprite actors' VRAM primitives and the closing dim, and commits
// what the screen changed to the walker's state once, after it has closed. It never executes
// original instructions and never requests an executable asset.
// `?nativeGym=1` keeps the original-code screen as a research reference (web/gym-native.js);
// `?legacyGym=1` keeps the hand-made screen (web/gym.js).
//
// State contract (who changes what, exactly once). The screen changes only the partner's private
// roster record: the TP cost (charged when the player answers Yes), the six core stats, the seven
// element points, max HP and max MP, and the remembered Ultra Training drill. On close the adapter
// reads the record once and commits the DIFFERENCE to the walker's partner block:
//   tp / maxHp / maxMp / core stats      the record's values (the screen's stores are absolute)
//   element points                       the walker stores trained points on top of the species'
//                                        base resistances, so the change is applied as a delta
//   lastUltraDrill                       the record's byte (0 = none -> null)
// Nothing else of the walker's model is touched; the screen pays no money and moves no day.
//
// Same public API as createGymNative: open/isOpen/handleKey/update/draw/close/diagnostics.
import { elementValues, ROSTER_SLOT_CHARIDS, ui } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { paintNativeSession, updateNativeSession } from "./native-session.js";
import { driStatsAt } from "./dri-model.js";
import { ensureStoredStats } from "./battle.js";
import { createGymPrimPainter } from "./gym-vram-paint.js";
import { fetchBytes, fetchJson, loadProfileRecords, loadResidentResources } from "./resident-data.js";

/** The gym's picture handles: STTRNGCS sub-directories 0 (drill pictures) and 3 (chrome) and CMFONT. */
const PACK_NAMES = { 0x028c0000: "sttrng0", 0x028c0003: "sttrng3", 0x02860000: "cmfont" };
const packName = (handle) => PACK_NAMES[handle >>> 0] ?? null;
const CORE = ["str", "def", "spt", "wis", "spd", "chr"];
const ELEMENTS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];
const PARTY_SLOTS = 3;

const DATA_LABEL = "Gym data";

let sharedPromise = null;
const loadShared = () => {
    sharedPromise ??= (async () => {
        const manifest = await fetchJson("gym/manifest.json", DATA_LABEL);
        const [tables, profiles, signature, { font, cursorGlyphs }, catalog, itemRecords, main, extra, digimon, ranks, ...packs] = await Promise.all([
            fetchBytes("gym/tables.bin", DATA_LABEL), loadProfileRecords(DATA_LABEL),
            fetchBytes("gym/signature.bin", DATA_LABEL), loadResidentResources(),
            fetchJson("shop_catalog.json", DATA_LABEL), fetchBytes("shop_item_records.bin", DATA_LABEL),
            fetchBytes("shop_descriptors_main.bin", DATA_LABEL), fetchBytes("shop_descriptors_extra.bin", DATA_LABEL),
            fetchJson("digimon.json", DATA_LABEL), fetchJson("gym_ranks.json", DATA_LABEL),
            ...manifest.packs.map((pack) => fetchBytes(`gym/${pack.file}`, DATA_LABEL)),
        ]);
        return {
            manifest, tables, profiles, signature, font, cursorGlyphs, catalog, itemRecords, descriptors: [main, extra],
            packs: new Map(manifest.packs.map((pack, i) => [pack.id, { id: pack.id, sectors: pack.sectors, data: packs[i] }])),
            digimonById: Object.fromEntries(digimon.digimon.map((d) => [d.id, d])), ranks,
        };
    })().catch((error) => { sharedPromise = null; throw error; });
    return sharedPromise;
};
const banksByLanguage = new Map();
const loadBank = (language) => {
    const id = 0x10b + language;
    if (!banksByLanguage.has(id)) {
        banksByLanguage.set(id, fetchBytes(`gym/${id}.bin`, DATA_LABEL).catch((error) => { banksByLanguage.delete(id); throw error; }));
    }
    return banksByLanguage.get(id);
};

/** The screen's text codec for the roster record's name: 0x04+d digits, 0x0E+n capitals, 0x28+n lower case. */
export function encodeGymName(text, maxBytes = 23) {
    const out = [];
    for (const ch of String(text ?? "")) {
        const code = ch.charCodeAt(0);
        if (ch >= "0" && ch <= "9") out.push(0x04 + code - 0x30);
        else if (ch >= "A" && ch <= "Z") out.push(0x0e + code - 0x41);
        else if (ch >= "a" && ch <= "z") out.push(0x28 + code - 0x61);
        else out.push(0x01, 0x01);
        if (out.length >= maxBytes) break;
    }
    return out.slice(0, maxBytes);
}

/** The rank group a greeter's ID-card gates give (GYM-C010), for the lab path that has no greeter. */
export function gymGroupForStage(stage, inventory, ranks) {
    const has = (id) => !!inventory?.some((s) => s.id === id && s.qty > 0);
    const gym = ranks?.gyms?.find((g) => g.stage === stage);
    if (!gym) return null;
    for (const opt of gym.options) if (opt.requires.every((r) => has(r.item) === r.owned)) return opt.group;
    return null;
}

const rand16 = () => (Math.random() * 0x10000) | 0;

export function createGymTranslated(sfx = null) {
    const g = {
        _open: false, _pending: false, _failed: false, _error: null, _session: null, _data: null, _state: null,
        _onClose: null, _group: 0, _stage: null, _clock: null, _ticks: 0, _request: 0, _seeded: [], _summary: null,
        _lastDiagnostic: null, _committed: 0,
    };
    let painter = null;
    const renderer = createNativeScreenRenderer({ pack: "sttrng3", packs: { "652:0": "sttrng0", "652:3": "sttrng3", "646:0": "cmfont" } },
        packName, { paintPrim: (ctx, call) => painter?.paint(ctx, call) });

    const playSound = (id) => { sfx?.playPacked(id); };

    const rosterSlotFor = (charId) => ROSTER_SLOT_CHARIDS.indexOf(String(charId));

    /** Walker state -> the session's seed (the RAM contract of the disc's screen). */
    function buildSeed(language) {
        const state = g._state ?? {};
        const party = Array.isArray(state.party) ? state.party : [];
        const members = [];
        g._seeded = [];
        for (let i = 0; i < Math.min(PARTY_SLOTS, party.length); i++) {
            const slot = rosterSlotFor(party[i]);
            if (slot < 0) break; // a pod is only ever shown for a roster species, and positions stay contiguous
            const ps = driStatsAt(state, i, g._data.digimonById) ?? {};
            const profile = g._data.digimonById[ps.digimonId ?? 0];
            const core = profile ? ensureStoredStats(ps, profile) : (ps.stats ?? {});
            const bonus = ELEMENTS.map((k) => Number(ps.elemBonuses?.[k]) || 0);
            const member = {
                position: i,
                rosterSlot: slot,
                nameBytes: encodeGymName(profile?.name ?? ps.name ?? ""),
                level: Number(ps.level) || 1,
                tp: Number(ps.tp) || 0,
                hp: Number(ps.hp) || 0,
                maxHp: Number(ps.maxHp) || 0,
                mp: Number(ps.mp) || 0,
                maxMp: Number(ps.maxMp) || 0,
                core: CORE.map((k) => Number(core?.[k]) || 0),
                // The roster record's STORED element halfwords: the species base
                // plus every trained point, through the one shared helper. The
                // session's own F0x80017174 fill adds the worn gear's resist on
                // top, exactly as the original does.
                elements: elementValues(profile, ps.elemBonuses),
                equipment: Array.isArray(state.equipment) ? (state.equipment[i] ?? undefined) : undefined,
                lastUltraDrill: Number.isInteger(ps.lastUltraDrill) ? ps.lastUltraDrill & 0xff : 0,
            };
            members.push(member);
            g._seeded.push({ ps, member, bonus });
        }
        if (members.length === 0) throw new Error("The gym needs a partner in the party");
        return { language, group: g._group, previousScreen: Number.isInteger(g._stage) ? g._stage : 0, members };
    }

    function fail(error) {
        g._error = error;
        g._failed = true;
        g._lastDiagnostic = `translated gym failed: ${error?.message ?? error}`;
        console.error("Translated gym failed", error);
    }

    function startSession(bank) {
        const selected = g._state?.languageByte;
        const language = Number.isInteger(selected) ? selected : 2;
        const data = g._data;
        const resources = {
            tables: data.tables, profiles: data.profiles, signature: data.signature, signatureBase: data.manifest.signature.base,
            textButtons: Uint8Array.from(data.manifest.textButtons.bytes), font: data.font, cursorGlyphs: data.cursorGlyphs,
            banks: new Map([[0x10b + language, bank]]), packs: data.packs,
            catalog: data.catalog, itemRecords: data.itemRecords, descriptors: data.descriptors,
        };
        g._session = new ui.GymSession(buildSeed(language), resources, { playSound, rand: rand16 });
        painter = createGymPrimPainter(() => g._session?.vram ?? null);
        g._clock = new ui.MenuDisplayClock();
    }

    /** The screen's record -> the walker's partner blocks (once). */
    function commit() {
        const session = g._session;
        if (!session || g._committed) return;
        g._committed++;
        const touched = new Set();
        g._seeded.forEach(({ ps, member, bonus }, i) => {
            const rec = session.record(i);
            ps.tp = rec.tp;
            ps.maxHp = rec.maxHp;
            ps.maxMp = rec.maxMp;
            ps.stats = Object.fromEntries(CORE.map((k, j) => [k, rec.core[j]]));
            ps.elemBonuses = Object.fromEntries(ELEMENTS.map((k, j) => [k, bonus[j] + (rec.elements[j] - member.elements[j])]));
            if (rec.lastUltraDrill !== member.lastUltraDrill) ps.lastUltraDrill = rec.lastUltraDrill !== 0 ? rec.lastUltraDrill : null;
            touched.add(i === 0 ? "partnerStats" : "partyStats");
        });
        const state = g._state;
        if (typeof localStorage !== "undefined" && state) {
            for (const key of touched) localStorage.setItem(key, JSON.stringify(state[key]));
        }
    }

    g.open = async (state, onClose = null, group = null, stage = null) => {
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
        g._stage = stage;
        g._lastDiagnostic = null;
        const request = ++g._request;
        const selected = state?.languageByte;
        const language = Number.isInteger(selected) ? selected : 2;
        try {
            const [data, bank] = await Promise.all([loadShared(), loadBank(language)]);
            if (request !== g._request) return;
            g._data = data;
            let resolved = group;
            // The real route carries the greeter's bank-0x94 group; the debug/lab path passes the
            // stage and resolves the same group from the decoded table. No option satisfied means
            // the original would not have opened training at all.
            if (resolved == null && stage != null) resolved = gymGroupForStage(stage, state?.inventory, data.ranks) ?? null;
            g._group = Number.isInteger(resolved) ? resolved : 0;
            g._lastDiagnostic = Number.isInteger(resolved) ? null : "gym.open without a greeter group";
            g._bank = bank;
        } catch (error) {
            if (request === g._request) fail(error);
        }
    };

    g.isOpen = () => g._open;

    // Input arrives as key events, but the screen reads the pad service's held words once per
    // frame (state.keys carries every held button).
    g.handleKey = (_k, state) => {
        if (state && !g._state) g._state = state;
    };

    g.update = (dt) => updateNativeSession(g, dt, {
        ready: () => g._data && g._bank,
        start: () => startSession(g._bank),
        held: () => g._state?.keys ? [...g._state.keys] : [],
        fail,
    });

    g.draw = (ctx, viewW = 320, viewH = 240) => {
        if (!g._open || !g._session) return;
        const s = Math.max(1, Math.min(viewW / 320, viewH / 240));
        ctx.save();
        ctx.scale(s, s);
        painter.beginFrame();
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
                finished, ticks: g._ticks, transition: session.transition(),
                records: g._seeded.map((_, i) => session.record(i)),
                sounds: session.sounds.slice(), displayCalls: session.displayCalls.map((c) => ({ ...c })),
                uploads: session.uploads.length,
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
        group: g._group,
        state: g._session?.state() ?? null,
        training: g._session?.training() ?? null,
        tasks: g._session?.tree.tasks.size ?? 0,
        sounds: g._session ? g._session.sounds.slice() : (g._summary?.sounds ?? []),
        displayCalls: g._session ? g._session.displayCalls.map((c) => ({ ...c })) : (g._summary?.displayCalls ?? []),
        uploads: g._session ? g._session.uploads.length : (g._summary?.uploads ?? 0),
        records: g._session ? g._seeded.map((_, i) => g._session.record(i)) : (g._summary?.records ?? []),
        summary: g._summary,
        renderer: renderer.stats,
        primitives: painter ? { ...painter.stats } : null,
        lastDiagnostic: g._lastDiagnostic,
    });

    return g;
}
