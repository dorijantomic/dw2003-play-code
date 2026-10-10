// Browser state and painting adapter for the translated partner-naming screen.
// The screen's logic runs in engine/dw3/ui (NameRootSession); this file loads
// its data, forwards the held buttons, paints the picture calls and text, and
// hands the confirmed names back to the walker's state. It never executes
// original instructions; `?nativeName=1` keeps the original-code screen as a
// research reference (web/nameentry-native.js).
import { ui, ROSTER_SLOT_CHARIDS } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { paintNativeSession } from "./native-session.js";
import { partyRosterView } from "./party.js";
import { fetchBytes, loadResidentResources } from "./resident-data.js";

// The picture handles the screen asks for: the keyboard art and the chooser art.
const PACKS = { 1904: "namedt", 648: "stdgnm" };
const NAME_BANKS = [0x40, 0x86];
const MAX_PARTNERS = 3;

const DATA_LABEL = "Naming data";

let sharedPromise = null;
const loadShared = () => {
    sharedPromise ??= Promise.all([fetchBytes("name/tables.bin", DATA_LABEL), loadResidentResources()])
        .then(([tables, { font }]) => ({ tables, font }))
        .catch((error) => { sharedPromise = null; throw error; });
    return sharedPromise;
};

/** The game's own letter codes: 0x04..0x0D digits, 0x0E..0x27 A-Z, 0x28..0x51 a-z. */
export function encodeGameName(text, limit) {
    const out = [];
    for (const ch of String(text ?? "")) {
        const code = ch.charCodeAt(0);
        if (ch >= "0" && ch <= "9") out.push(0x04 + code - 48);
        else if (ch >= "A" && ch <= "Z") out.push(0x0e + code - 65);
        else if (ch >= "a" && ch <= "z") out.push(0x28 + code - 97);
        else continue; // a character the keyboard cannot show is left out
        if (out.length >= limit) break;
    }
    return new Uint8Array(out);
}

export function decodeGameName(bytes) {
    let out = "";
    for (const b of bytes) {
        if (b === 0) break;
        if (b >= 0x04 && b <= 0x0d) out += String.fromCharCode(0x30 + (b - 0x04));
        else if (b >= 0x0e && b <= 0x27) out += String.fromCharCode(0x41 + (b - 0x0e));
        else if (b >= 0x28 && b <= 0x51) out += String.fromCharCode(0x61 + (b - 0x28));
        else out += " ";
    }
    return out.trim();
}

const rosterSlotFor = (charId) => {
    const i = ROSTER_SLOT_CHARIDS.indexOf(String(charId));
    return i < 0 ? null : i;
};

export function createNameEntryTranslated(sfx = null, options = {}) {
    const n = {
        _open: false, _session: null, _state: null, _clock: null, _error: null,
        _request: 0, _members: [], _initial: "", _results: [], _lastValue: "",
    };
    const renderer = createNativeScreenRenderer({ pack: "namedt", packs: PACKS },
        (directory) => PACKS[directory >>> 16] ?? null);

    /** The party the screen can name: the live party, else the opening's granted pack. */
    function members(state) {
        const live = Array.isArray(state?.party) ? state.party : [];
        const pending = Array.isArray(state?.pendingParty) ? state.pendingParty : [];
        const ids = (live.length ? live : pending).slice(0, MAX_PARTNERS);
        let view = [];
        try {
            view = partyRosterView(ids, state.partnerStats, state.partyStats,
                options.digimonDB?.() ?? {}, state.digimonNames);
        } catch { view = []; }
        return ids.map((charId, i) => ({
            charId,
            rosterSlot: rosterSlotFor(charId),
            name: state.digimonNames?.[charId] ?? view[i]?.name ?? "",
        })).filter((member) => member.rosterSlot !== null);
    }

    n.open = (opts = {}) => {
        n._open = true;
        n._state = opts.state ?? n._state;
        n._initial = typeof opts.initial === "string" ? opts.initial : "";
        n._results = [];
        n._lastValue = n._initial;
        n._error = null;
        n._session = null;
        n._clock = new ui.MenuDisplayClock();
        n._members = members(n._state ?? {});
        const request = ++n._request;
        if (!n._members.length) {
            n._error = new Error("Naming has no partner with a roster slot");
            return;
        }
        loadShared().then(async (shared) => {
            const selected = n._state?.languageByte;
            const language = Number.isInteger(selected) ? selected : 2;
            if (language < 0 || language > 6) throw new Error("Naming language index is invalid");
            const banks = new Map(await Promise.all(NAME_BANKS.map(async (offset) =>
                [offset + language, await fetchBytes(`name/${offset + language}.bin`, DATA_LABEL)])));
            if (!n._open || request !== n._request) return;
            const limit = language === 0 ? 5 : 8;
            n._session = new ui.NameRootSession(language,
                n._members.map((member) => ({
                    rosterSlot: member.rosterSlot,
                    nameBytes: encodeGameName(member.name, limit),
                })),
                { ...shared, banks },
                { playSound(id) {
                    sfx?.playPacked(id);

                } });
        }).catch((error) => {
            if (request !== n._request) return;
            n._error = error;
            console.error("Translated naming screen failed to open", error);
        });
    };

    n.isOpen = () => n._open;
    n.isDone = () => !n._open;
    n.handleKey = (_key, state) => { if (state) n._state = state; };
    n.value = () => n._lastValue;
    /** The last confirmed name in the shape the walker's callers read. */
    n.result = () => n._results.at(-1) ?? { accepted: false, memberId: null, value: n._initial };
    /** Every confirmed name, one per partner (the last confirmation wins). */
    n.results = () => n._results;

    n.update = (dt, state) => {
        if (state) n._state = state;
        if (!n._open || n._error) { if (n._error && n._open) n._finish(); return; }
        if (!n._session) return;
        for (const frame of n._clock.advance(dt)) {
            n._session.tick(n._state?.keys ?? [], frame.tick);
            if (n._session.finished()) { n._finish(); break; }
        }
    };

    n.draw = (ctx, viewW = 320) => {
        if (!n._open || !n._session) return;
        ctx.save();
        ctx.scale(viewW / 320, viewW / 320);
        paintNativeSession(ctx, renderer, n._session);
        ctx.restore();
    };

    n.close = () => { if (n._open) n._finish(false); };

    n._finish = (commit = true) => {
        if (!n._open) return;
        n._open = false;
        ++n._request;
        const session = n._session;
        n._session = null;
        if (commit && session) {
            const last = new Map();
            for (const entry of session.commits) last.set(entry.position, entry);
            for (const [position, entry] of last) {
                const member = n._members[position];
                if (!member) continue;
                const value = decodeGameName(entry.nameBytes);
                if (!value) continue;
                n._results.push({ accepted: true, memberId: member.charId, value });
                n._lastValue = value;
            }
        }
    };

    n.diagnostics = () => ({
        open: n._open, pending: n._open && !n._session, error: n._error?.message ?? null,
        tasks: n._session?.tree.tasks.size ?? 0, selected: n._session?.selectedPosition() ?? null,
        chooserSub: n._session?.chooserSubState() ?? null,
        chooserReadingPad: n._session?.chooserReadingPad() ?? false,
        commits: n._session?.commits.length ?? 0, results: n._results.length,
        renderer: renderer.stats,
    });
    return n;
}
