import { questDone } from "../quests.js";
import type { FieldMovieHost, FightReportOptions } from "../types/u-core.js";
import { FLY_QUEST, flyBlock, FLY_POINTS, flyCopyFor, arrivalSpot } from "../fly-points.js";
import {
  rosterSlotOfCharId,
  ITEM_BY_NAME,
  ITEM_BY_ID,
  savePointForStage,
  movieRow,
  movieReturnScreen,
} from "../vendor/engine.js";
import { itemForDropName } from "../drop-item.js";
import { partyRosterView } from "../party.js";
import { paidParticipants } from "../battle.js";
import {
  ENDING_CHAIN_MAX_STEPS,
  REPORT_CORE,
  books,
  cardDeck,
  fieldMovie,
  fightReportNative,
  flyAirNow,
  flyFree,
  flySeenAny,
  itemLog,
  menu,
  packSelectNative,
  pauseHome,
  saveScreen,
  state,
  statusOptions,
} from "./vars.js";
import { questSpeak } from "./quest-scenes.js";
import { S, screenRouterOptions } from "./state.js";
import { currentMap } from "./session.js";
import { warpToMap } from "./mp-chat.js";
import { startTransition } from "./transitions.js";

/** Open the starter-pack wizard. */
export function openPackSelect(opts = {}) {
    return packSelectNative.open({ state, ...opts });
}

// The shop's Edit Folder opens the SAME folder screen as the pause menu's Card
// Folders row. On the disc both routes hand off to launcher code 0x400 =
// pro/stcrddek (stcrdshp's option 3, "Edit Folder" —
// docs/research/ui/stcrdshp-decoded-2026-07-12.md §0; the pause page
// F0x80084A34 launches 0x400 too), so the shop route must not open a second,
// hand-authored editor. This opens the module's one `cardDeck` binding, which
// is the one binding both routes use.
// Leaving the screen returns to the field, where the hand-off left the player.
export function openCardShopFolder() {
    cardDeck.open();
}

export function openFly(row) {
    const block = !questDone(FLY_QUEST) ? "Not now." : flyBlock({ openAir: flyAirNow(), free: flyFree() });
    if (block) { questSpeak(null, "", block); return; }
    books.open("fly", () => {
        const chosen = S.flyChosen; S.flyChosen = null;
        if (!chosen) { pauseHome(row); return; }
        flyTo(chosen.id).then((r) => { if (r !== "ok") questSpeak(null, "", "Not now."); });
    }, state.keys as any);
}

/** Fly to a fly point: resolves "ok" or why not. Every rule is re-checked here, whoever asks (the book, the window.__fly hook). */
export async function flyTo(id) {
    if (!FLY_POINTS.includes(id) || !questDone(FLY_QUEST)) return "no";
    if (!flyFree() || state.menuOpen || books.isOpen()) return "busy";
    if (!flyAirNow()) return "air";
    if (!flySeenAny(id)) return "unseen";
    // The copy a door from here leads to on foot (the world this map is in); unresolved = refuse with the reason, never a guess.
    const copy = flyCopyFor({ maps: state.manifest?.maps ?? [], scenes: state.scenes, currentId: currentMap()?.id, id });
    if (copy.why) return copy.why;
    if (currentMap()?.id === copy.id) return "here";
    const spot = arrivalSpot(state.scenes, copy.id);
    if (!spot) return "nospot";
    return warpToMap(copy.id, spot.x, spot.y, () => flyFree() && !state.menuOpen && !books.isOpen(), spot.dir);
}

/** Open the post-fight results screen. The walker's report data (rows built by
 *  web/battle.js buildFightReportRows, plus pages) is translated into the
 *  overlay's RAM contract (the 0x80042b84 workspace + roster records). */
export function openFightReport(opts: FightReportOptions = {}) {
    const rows = opts.rows ?? [];
    const party = Array.isArray(state.party) ? state.party : [];
    const partySlots = rows.map((row) => rosterSlotOfCharId(party[row.index ?? 0]));
    const rewardXp = Number(opts.rewardXp ?? 0);
    const participants = rows.map((row) => ({
        pos: row.index ?? 0,
        rosterSlot: (partySlots[row.index ?? 0] ?? 0) >>> 0,
        // The walker's row xp already carries this battle's share; the native
        // screen counts up from the pre-battle total, so subtract it back out.
        preExp: Math.max(0, Number(row.xp ?? 0) - rewardXp),
        level: Number(row.level ?? 1),
        name: row.name,
        forms: state.partyStats?.[row.index ?? 0],
        participated: true,
        formFlags: [0, 0, 0],
    }));
    const dropItemId = opts.dropItemId
        ?? (opts.droppedItem ? (itemForDropName(opts.droppedItem, ITEM_BY_NAME, ITEM_BY_ID)?.id ?? 0) : 0);
    if (dropItemId > 0) itemLog.noteSeen([dropItemId]);   // GLOSSARY > ITEMS: the win screen names this drop
    fightReportNative.open({
        gameState: state,
        battleId: opts.battleId ?? 0,
        dropItemId,
        activePos: rows[0]?.index ?? 0,
        partySlots,
        participants,
        onClose: opts.onClose ?? null,
    });
}

// Inns are DW3's save points, and the memory-card file record's "place" field
// indexes esshpnam — a bank whose tail is exactly the inn list ("Asuka Inn",
// "Suzaku Inn", "Amaterasu Inn", ...). The original's caller is now DECODED
// (2026-09-22): each save-point map carries a "PREPARE TO SAVE." event whose
// HANDOFF operand is the resident launcher's code `0xC00 | slot`, which loads
// pro/stgmcard with that slot and the save-mode value word. The slot's place is
// `esshpnam[42 + slot]` — engine/dw3/save-points.ts carries the 25 entries, and
// the walker now writes that exact place index instead of name-matching the
// walker map title. The LOAD direction's caller is the title's Continue choice,
// which launches the same code family with value 0
// (docs/research/ui/stdwtitl-title-menu-2026-08-14.md — 0x2D7 = Start,
// 0xC00 = Continue), handled at the title below.
export function openMemoryCard(mode, onClose = null, atSavePoint = undefined) {
    const map = currentMap();
    // The caller may name the save point explicitly (the decoded HANDOFF);
    // otherwise the map decides, so the inn-zone save and the lab behave as
    // before.
    const savePoint = atSavePoint !== undefined
        ? (atSavePoint ?? null)
        : savePointForStage(map?.id ?? null);
    saveScreen.open(state, mode, onClose, {
        areaName: map?.name ?? "",
        placeName: savePoint?.place ?? map?.name ?? "",
        // The original's record carries the save point's own esshpnam index.
        placeIndex: savePoint?.placeIndex,
        savePointSlot: savePoint?.slot,
        playSeconds: state.playSeconds,
        roster: statusOptions.roster,
        reserveRoster: (id, stats) => partyRosterView([id], stats, [stats], menu.digimonDB ?? {}, state.digimonNames)[0],
    });
}

// The movie rows' return chain, shared by every host path that reaches the
// title overlay's player (the finale's ending hand-off below and a story
// HANDOFF that names a movie row in doStoryHandoff): play each row the launch
// code names on the one field movie adapter, and step to the row's own return
// selector until a selector names no movie — movie row 2's own 0x207 is
// re-pointed to 0x276 at master ordinal 0x2d (engine/dw3/screen-routing.ts
// movieReturnScreen, the same rule the router applies below). Returns the
// first selector that is not a movie (0 when the chain is malformed).
export async function playMovieChain(launchCode) {
    let selector = launchCode | 0;
    for (let step = 0; step < ENDING_CHAIN_MAX_STEPS; step++) {
        if (movieRow(selector) == null) break;
        await new Promise<void>((resolve) => {
            (S as FieldMovieHost).fieldMovieDone = resolve;
            fieldMovie.open(selector).then((row) => {
                if (!row) { S.fieldMovieDone = null; resolve(); } // unknown code: never strand
            });
        });
        // The ordinal predicate is the router's own (state.progressOrdinal
        // proxies the engine's $story.ordinal — one source of truth).
        selector = movieReturnScreen(selector, screenRouterOptions.useAlt()) ?? 0;
    }
    return selector;
}

export async function playEndingChain(launchCode) {
    const selector = await playMovieChain(launchCode);
    const routed = S.screenRouter.route(selector, currentMap().id);
    if (routed?.kind === "warp") {
        startTransition({ to: routed.to, spawnX: null, spawnY: null, dir: "down", scripted: true });
    } else {
        console.warn("[battle] the finale's ending chain did not resolve to a field screen:", selector);
    }
}

// (shared with the multiplayer fight: `onClose` is what runs when the player leaves the screen)
export function openNativeReport(b, onClose) {
        const rows = b._winReportRows ?? [];
        const progress = b._winProgress ?? [];
        const party = Array.isArray(state.party) ? state.party : [];
        const partySlots = rows.map((row) => rosterSlotOfCharId(party[row.index ?? 0]));
        const firstDrop = (b._loot?.drops ?? []).find(Boolean) ?? null;
        const dropItemId = firstDrop ? (itemForDropName(firstDrop, ITEM_BY_NAME, ITEM_BY_ID)?.id ?? 0) : 0;
        b._reportPaidItemId = dropItemId;
        fightReportNative.open({
            gameState: state,
            battleId: b.screenId ?? 0,
            dropItemId,
            // The BIT payout reads this partner's worn BIT Adapter (workspace +4).
            activePos: b.activePlayerIndex ?? rows[0]?.index ?? 0,
            // read-only look data for the victory screen (web/ui-c/vic.js): the battle's own progress and reward records
            view: { progress: b._winProgress ?? [], reward: b._winReward ?? null },
            partySlots,
            participants: rows.map((row) => {
                const pos = row.index ?? 0;
                const pr = progress.find((p) => p.index === row.index);
                // The partner as it stood BEFORE the battle's rewards were applied
                // (web/battle.js applyParticipantProgress applies them once, ahead of
                // this screen); the screen replays the disc's rules from that snapshot
                // on a private record and never writes EXP/level back.
                const ps = pr?.before ?? b.playerRecords?.[pos]?.statsRecord ?? {};
                // The row flag byte at workspace +6 for this position. A position the
                // outcome knocked out had it cleared (pro/wfightmn.s .L0x00002070),
                // so it goes to the screen unflagged even though it still has a row.
                const participated = paidParticipants(b).includes(row.index);
                return {
                    pos,
                    rosterSlot: (partySlots[pos] ?? 0) >>> 0,
                    preExp: Math.max(0, Number(ps.xp ?? pr?.oldXp ?? row.xp ?? 0)),
                    level: Number(ps.level ?? row.level ?? 1),
                    tp: ps.tp, hp: ps.hp, maxHp: ps.maxHp, mp: ps.mp, maxMp: ps.maxMp,
                    core: ps.stats ? REPORT_CORE.map((k) => (Number(ps.stats[k]) || 0) + (Number(ps.bonuses?.[k]) || 0)) : undefined,
                    equipment: state.equipment?.[pos] ?? {},
                    name: row.name,
                    forms: ps.digimonId != null ? ps : (state.partyStats?.[pos] ?? b.playerRoster?.[pos]?.stats),
                    participated,
                    // Which of the three equipped forms fought: the DVEXP goes to that form.
                    formFlags: [0, 1, 2].map((v) => (participated && pr?.formId != null
                        && ps.equippedForms?.[v] === pr.formId ? 1 : 0)),
                };
            }),
            onClose,
        });
        return fightReportNative.isOpen();
}
