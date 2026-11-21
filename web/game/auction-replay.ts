import { parseEntry, selectAuctionLot, runAuctionLot } from "../vendor/engine.js";
import { replayLadder, replayRows, replayRefused, replayOnMap } from "../replay-theatre.js";
import { AUCTION_STAGE, battle, choice, cutscene, fade, state, textbox } from "./vars.js";
import { S } from "./state.js";
import { doStoryHandoff, playStoryEvent, storyDbg } from "./story-events.js";
import { currentMap } from "./session.js";

/** A wstag-shaped row for one of the auction's events, so the ordinary cutscene
 *  path plays it: its disasm, its esdmg260 text entry, and the force-exit the
 *  answer scripts carry (HANDOFF 530 → the Water Tunnel). */
export function auctionScriptRow(eventId) {
    const au = state.auction;
    const e = au?.events?.[String(eventId)];
    if (!e) return null;
    const handoff = (e.disasm || []).find((l) => l.startsWith("HANDOFF"));
    const entry = e.entry;
    return {
        id: eventId,
        // The region<<16|entry convention: region 0x119 is ESDMG260.
        flag_key: "0119" + String(entry).padStart(4, "0"),
        esdmg_stage: "260",
        esdmg_entry: entry,
        disasm: e.disasm,
        ...(handoff ? { handoff_to: au.force_exit?.stage != null ? "s" + au.force_exit.stage : undefined } : {}),
    };
}

/** One line of an esdmg260 entry as plain text (markup stripped, player name
 *  substituted) — the question box draws text, not pack bytes. */
function auctionPlainLine(raw) {
    if (!raw) return null;
    const parsed = parseEntry(raw, state.playerName || "Junior");
    const line = parsed.pages.flat().join(" ");
    return line.length ? line : null;
}

/** The arrival gate: does a lot fire on this field load, and if so run it.
 *  Returns "fired" (the auction took over), "none" (nothing eligible) or "wait"
 *  (the field is busy right now — the caller retries next frame, exactly as the
 *  disc's own runStoryEvents tick does). */
export function runAuctionArrival(mapId) {
    if (mapId !== AUCTION_STAGE) return "none";
    const au = state.auction;
    if (!au?.lots?.length || !S.engine) return "none";
    // The disc asks once per field load, behind the same field-owned locks the
    // rest of the arrival work respects: no handoff in flight, no fade, no box.
    if (S.engineBridge?.isBusy() || state.handoffHold || fade.dir !== 0) return "wait";
    if (choice.isOpen!() || textbox.isOpen!() || cutscene.isActive()) return "wait";
    const ordinal = Number(S.engine.state.vars.get("$story.ordinal") ?? 0);
    const lot = selectAuctionLot(au.lots, ordinal, S.engine.state.flags);
    if (!lot) return "none";
    storyDbg("AUCTION", AUCTION_STAGE, "lot", lot.n, "bid", lot.bid, "item", lot.item);
    startAuctionLot(lot);
    return "fired";
}

/** One lot, start to finish, through the engine's own driver. */
function startAuctionLot(lot) {
    let answerRow = null;
    const host = {
        playScript: (eventId, onDone) => {
            const row = auctionScriptRow(eventId);
            if (!row) { onDone(null); return; }
            if (eventId === lot.events.accepted || eventId === lot.events.pass) answerRow = row;
            playStoryEvent(row, (handoff) => onDone(handoff ?? null));
        },
        askQuestion: (l, onAnswer) => {
            // The question and the two answers are the lot's esdmg260 choice entry
            // (FIELDSTG_choices[N].text, entry strings 0/1/2 — claim
            // fieldstg-auction-bid-questions-2026-10-09).  The box is the walker's
            // decoded question window; see the named gap above.
            const strings = state.events?.["260"]?.[String(l.entries.choice)]?.strings ?? [];
            const prompt = auctionPlainLine(strings[0]) ?? ("Bid at " + l.bid + " BIT?");
            const yes = auctionPlainLine(strings[1]) ?? "Yes, bid.";
            const no = auctionPlainLine(strings[2]) ?? "No, I'll pass.";
            storyDbg("AUCTION QUESTION", prompt, "yes:", yes, "no:", no);
            choice.open!(prompt, [yes, no], (idx) => onAnswer(idx === 0 ? "accept" : "pass"));
        },
        writeFlag: (id, value) => S.engine!.writeStoryFlag(id, value),
    };
    runAuctionLot(lot, host, (handoff) => {
        // The answer script's own HANDOFF is the tower's force-exit (530 → s275).
        if (handoff) doStoryHandoff(answerRow, handoff);
    });
}

// ---------------------------------------------------------------------------------------------
// EXPERIMENT (Replay theatre, web/replay-theatre.js): watch one of the disc's own story scenes again.
//
// The page lists the bytecode scenes of the room you are standing in whose beat you have reached (the
// master story ordinal), plus the scenes waiting in other rooms you have reached, greyed with their
// place name. Play hands the record to the SAME cutscene VM the story uses, with a completion that
// does nothing — so the scene's own staging, walks, camera and lines play, while the event's flag
// writes, step store, HANDOFF and battle never happen. Native events and the four mutating bytecode
// events are refused by the module itself (REPLAY_DENY): their effect lives inside playStoryEvent,
// where a no-op completion cannot stop it.

/** May the theatre open right now? A running scene, fight or screen is never replaced by a replay. */
export function replayFieldFree() {
    return !!state.started && !state.titleScreen && !state.endScreen
        && !battle.isActive() && !cutscene.isActive() && !textbox.isOpen!() && !choice.isOpen!()
        && !state.menuOpen && fade.dir === 0 && !state.diveDemo && !state.wipe28;
}

/**
 * The page's rows for this moment. The player-facing list is only the room you are standing in —
 * playStoryEvent stages a scene with currentMap()'s own cast, and loading another stage would run
 * its arrival chain — so scenes of other reached rooms come back separately, greyed.
 */
export function replayRowsNow() {
    const map = state.manifest ? currentMap() : null;
    if (!map || !state.wstag || !state.progressTable) return { place: map?.name ?? "", here: [], elsewhere: [] };
    state.replayLadder ||= replayLadder(state.progressTable, state.manifest);
    const ordinal = Number(S.engine?.state.vars.get("$story.ordinal") ?? 0);
    const rows = replayRows(map.id, state.wstag, state.replayLadder, ordinal);
    return {
        place: map.name,
        here: rows.filter((r) => r.mapId === currentMap().id),
        elsewhere: rows.filter((r) => r.elsewhere),
    };
}

/** A page row -> the event record itself, tagged with the room the row named. */
export function playReplayRow(row) {
    const ev = (state.wstag?.[row.mapId] ?? []).find((e) => Number(e.id) === Number(row.eventId));
    if (!ev) return false;
    ev.replayMap = row.mapId;   // replayScene's own room check (only the current map may play)
    return replayScene(ev);
}

/**
 * Play one of the disc's own scenes through the game's cutscene VM. The completion is a no-op on
 * purpose: the story's flag writes, step store, HANDOFF and battle all live in the CALLER's
 * completion (engine.completeEvent / doStoryHandoff), so an empty one plays the scene and changes
 * nothing. Only a scene of the room you are standing in may be played — another stage's scene would
 * need that stage loaded, and a load runs its arrival chain. Returns false for anything else.
 */
export function replayScene(ev) {
    const mapId = state.manifest ? currentMap().id : null;
    if (replayRefused(ev) || !replayOnMap(ev.replayMap, mapId)) return false;
    playStoryEvent(ev, () => {});
    return true;
}
