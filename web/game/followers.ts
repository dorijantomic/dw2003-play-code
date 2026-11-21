import { createRetryLoader } from "../retry-loader.js";
import { loadItemsData } from "../glossary-items.js";
import { battleHudNameBank } from "../battlehud-translated.js";
import { ITEM_BY_ID, heldCount, seedFollowerHistory, rosterSlotOfCharId } from "../vendor/engine.js";
import { fieldPartySize, partyRosterView } from "../party.js";
import {
  MAX_FOLLOWERS,
  followers,
  glossaryLoader,
  itemLog,
  menu,
  partnerHistory,
  speciesLog,
  state,
} from "./vars.js";
import { S } from "./state.js";
import { manifestIndexOf } from "./session.js";

export function glossarySpecies() {             // null until the tables are in
    return glossaryLoader.get();
}

export function glossaryItems() {
    S.glossaryItemLoader ??= createRetryLoader(() => loadItemsData(undefined, battleHudNameBank));
    return {
        data: S.glossaryItemLoader.get(),
        info: (id) => ITEM_BY_ID[id] ?? null,                 // the real name and description the shop and the equip footer show
        ids: () => itemLog.knownIds(),
        held: (id) => heldCount(state, id),
    };
}

// How many downloaded Digimon trail the tamer right now. `charIdx` alone is
// never ownership; only the s212 download populates state.party.
export function activeFollowerCount() {
    // No party trail in a Digi-Egg section: the native cast rebuild's follower
    // loop applies the SAME [0x146,0x148) window test as the player scan and
    // SKIPS those ids (fieldstg 0x83fc-0x8408), so no field-party actor is
    // constructed for a screen whose player form is Submarimon or Digmon.
    if (state.diveForm) return 0;
    return fieldPartySize(state.party, MAX_FOLLOWERS);
}

// The manifest character record a follower renders with (party member, else the lead).
export function followerChar(i: number) {
    const id =
        Array.isArray(state.party) && state.party[i] != null
            ? state.party[i]
            : null;
    const idx = id != null ? manifestIndexOf(id) : state.charIdx;
    return idx >= 0 ? state.manifest.characters[idx] : null;
}

// Snap every follower onto the player and clear the trail (map load / cutscene end).
export function resetFollowers() {
    for (const f of followers) {
        f.x = state.x;
        f.y = state.y;
        f.parked = false;
        f.gathering = false;
        f.animTime = 0;
        f.stopping = false;
        f.stopTime = 0;
    }
    partnerHistory.splice(
        0,
        partnerHistory.length,
        ...seedFollowerHistory({ x: state.x, y: state.y, dir: state.dir }),
    );
    S.fieldTickAccumulator = 0;
    state.stopping = false;
    state.stopTime = 0;
}

// EXPERIMENT (mounts): the party steps back into the world next to the mount, at the spots web/mount.js found
// (walkable ground, nearest first) — never a snap across the map. The trail is re-seeded at the player so the
// followers blend back into the conga line as the player walks off.
export function placeFollowersAt(spots) {
    for (let i = 0; i < followers.length; i++) {
        const s = spots?.[i];
        if (!s) continue;
        followers[i].x = s.x;
        followers[i].y = s.y;
        followers[i].parked = false;
        followers[i].gathering = false;
        followers[i].animTime = 0;
        followers[i].stopping = false;
        followers[i].stopTime = 0;
    }
    partnerHistory.splice(
        0,
        partnerHistory.length,
        ...seedFollowerHistory({ x: state.x, y: state.y, dir: state.dir }),
    );
    S.fieldTickAccumulator = 0;
}

// After a party gather (story `SETANIM 813 823`) the followers' rings are all zero
// records: at script END, 0x80084ecc state 3 reinstalls the follower hook 0x8008eae8
// through resetHook 0x8008f004, but each follower keeps reading parked records until
// the player has moved its 9/18/27 ticks. Parked records carry `parked`, so the copy
// in the movement tick parks the follower until a real point reaches it.
export function parkGatheredFollowers() {
    resetFollowers();
    for (const p of partnerHistory) p.parked = true;
    for (const f of followers) f.parked = true;
}

// EXPERIMENT (Next forms planner): the party as the page reads it — each member's roster slot (the line the
// disc's unlock routine scans) and its live ledger, level and stat record. Exactly the records web/battle.js
// passes to engine/dw3/evo-trees.ts (statsRecord.formLedger, .level, .stats/.bonuses/.elemBonuses).
export function plannerPartyMembers() {
    const view = partyRosterView(state.party ?? [], state.partnerStats, state.partyStats, menu.digimonDB ?? {}, state.digimonNames);
    return view.slice(0, 3).map((row, i) => {
        const record = i === 0 ? state.partnerStats : state.partyStats?.[i];
        if (!record) return null;
        const slot = rosterSlotOfCharId(row.charId) ?? (Number(row.rookieId) - 1);
        return {
            slot,
            name: row.name,
            live: {
                formLevels: Object.fromEntries((record.formLedger ?? []).map((entry) => [Number(entry.id), Number(entry.formLevel ?? 1)])),
                level: Number(record.level ?? 1),
                stats: record,
            },
        };
    }).filter(Boolean);
}

// GLOSSARY > DIGIMON: every species the party wears now counts as owned (forms worn in battle arrive as `formWorn` events). Only
// the current party is read: no past history is invented. Lab evolutions and loaded saves are caught by the timer.
export function noteOwnedSpecies() {
    try { speciesLog.noteOwned(glossaryPartners().flatMap((p) => [p.rookie, p.form]).filter(Boolean)); } catch { /* the party is not ready yet */ }
}

// GLOSSARY > DIGIMON: the party as the glossary reads it. `rookie` is the starter species, `form` the species it wears now.
export function glossaryPartners() {
    const view = partyRosterView(state.party ?? [], state.partnerStats, state.partyStats, menu.digimonDB ?? {}, state.digimonNames);
    return view.slice(0, 3).map((row, i) => {
        const record = i === 0 ? state.partnerStats : state.partyStats?.[i];
        if (!record) return null;
        const slot = rosterSlotOfCharId(row.charId) ?? (Number(row.rookieId) - 1);
        return {
            slot,
            rookie: menu.digimonDB?.[row.rookieId]?.name ?? null,
            form: row.formName,
            formId: Number(row.digimonId),
            level: Number(record.level ?? 1),
            live: { formLevels: Object.fromEntries((record.formLedger ?? []).map((entry) => [Number(entry.id), Number(entry.formLevel ?? 1)])), level: Number(record.level ?? 1), stats: record },
        };
    }).filter(Boolean);
}
