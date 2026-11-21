import { ownsItem, heldCount, storeAddItem, storeRemoveItem, rosterMaskForParty } from "../vendor/engine.js";
import { migrateVisitedMaps } from "../menu.js";
import { loadCharismaDb } from "../charisma.js";
import { createEngineBridge } from "../engine-bridge.js";
import { battle, choice, cutscene, engineEventDone, fade, sfx, state, storyFlags, textbox } from "./vars.js";
import { S } from "./state.js";
import {
  applyStoryCommand,
  buildScriptedBattleIndex,
  chainScriptedBattleFromPre,
  doStoryHandoff,
  healActiveParty,
  playStoryEvent,
} from "./story-events.js";
import { engineFlagSeen, refreshPartyCharisma } from "./map-load.js";
import { currentMap } from "./session.js";
import { gameOverToTitle, startFieldBattle } from "./battle-launch.js";
import { fieldcomTick } from "./field-fx.js";

// Construct the headless engine + its presentation bridge + OnStep trigger-system. Called
// once from init() (awaited) before the loop starts. Seeds the banked store + ordinal from
// localStorage and registers write-through persistence.
export async function initEngine() {
    const { GameEngine, createTriggerSystem } =
        await import("../vendor/engine.js");
    const content = await (await fetch("assets/engine-content.json")).json();
    try {
        for (const id of JSON.parse(localStorage.getItem("engineEvents") ?? "[]"))
            if (typeof id === "string") engineEventDone.add(id);
    } catch {
        /* corrupt save — start with nothing fired */
    }
    S.engine = new GameEngine(content, {
        storyCommand: applyStoryCommand,
        driven: true,
        screenTable: S.fieldScreenTable,
        healParty: healActiveParty,
        // Persist each row's once bit the moment EngineBridge/EventManager fires it,
        // so a reload does not replay an already-seen auto/talk cutscene.
        onceStore: {
            get: (id) => engineEventDone.has(id),
            set: (id) => {
                if (engineEventDone.has(id)) return;
                engineEventDone.add(id);
                localStorage.setItem(
                    "engineEvents",
                    JSON.stringify([...engineEventDone]),
                );
            },
        },
    });
    const engineParty = (state.party ?? []).map((_, i) => i + 1);
    S.engine!.state.party.load({ members: engineParty, lead: engineParty[0] });
    state.sbIndex = buildScriptedBattleIndex(content); // map→[{preKey,postKey,screenId,wonFlag,actor}]

    // UNIFY INVENTORY (single source of truth): replace the engine's private Inventory with an
    // adapter over the browser's state.inventory ([{id,qty}]). Now possession conditions (banks
    // 0x80–0x92, e.g. the Blue Card gate flag 0x818e) and GiveItem grants read/write the SAME bag
    // the menu/shop/save use — no second inventory to keep in sync. evalContext() reads
    // engine.state.inventory fresh each eval, so this takes effect immediately.
    S.engine!.state.inventory = {
        // The scene's possession gate is F0x80015F04's "do we have any" form, which
        // counts a WORN copy as having it; a script's larger `count` is the
        // walker's own shape and still answers from the carried count.
        has: (id, count = 1) =>
            (count <= 1 ? ownsItem(state, id) : heldCount(state, id) >= count),
        add: (id, n = 1) => {
            storeAddItem(state, id, n);
            localStorage.setItem("inventory", JSON.stringify(state.inventory));
        },
        remove: (id, n = 1) => {
            storeRemoveItem(state, id, n);
            localStorage.setItem("inventory", JSON.stringify(state.inventory));
        },
        toJSON: () => state.inventory.map((s) => [s.id, s.qty ?? 1]),
        load: () => {}, // state.inventory is loaded from localStorage during state init
    };

    // Seed the banked store + ordinal from persisted save, THEN register persistence so a seed
    // load doesn't echo back to storage. FlagManager.load only touches known banks; ignore junk.
    try {
        const savedFlags = localStorage.getItem("engineFlags");
        if (savedFlags) S.engine!.state.flags.load(JSON.parse(savedFlags));
    } catch {
        /* corrupt save — start clean */
    }
    // One-time save migration, AFTER persistence is registered below so the bits it
    // writes are stored: a save from the build that kept a parallel `visitedMaps` list
    // has its markers turned into the bits the field entry would have written, so an
    // old player's MAP page keeps its revealed places. Then the list is dropped — the
    // original never had one, and nothing writes it now.
    const migrateVisited = () => {
        if (!state.visitedMaps!.size) return;
        migrateVisitedMaps([...state.visitedMaps], S.fieldScreenTable, {
            get: engineFlagSeen,
            set: (id, value) => S.engine!.state.flags.set(id, value),
        });
        state.visitedMaps = new Set();
        localStorage.removeItem("visitedMaps");
    };
    S.engine!.state.vars.set(
        "$story.ordinal",
        Number(localStorage.getItem("progressOrdinal") ?? 0),
    );
    // Seed the chosen starter-pack selector (0/1/2) from the persisted pack, so the s212 download
    // gate (bank-0x70 op0x10 flags 0x7000/1/2) resolves to the right variant after a reload. null
    // until a pack is picked → gate dormant. Kept in sync at the pack pick + cleared on New Game.
    S.engine!.state.vars.set(
        "$party.pack",
        state.packId != null ? "ABC".indexOf(state.packId) : null,
    );
    // The engine evaluates bank 0x72 from $party.charisma (dw3-config registerVirtualBank),
    // the same ladder web/flag-store.js answers for NPC gating. Seed it once digimon.json is
    // in, and refresh it whenever the party or its stats could have moved, so both sides of
    // the walker agree about which tamers will duel you.
    loadCharismaDb().then(() => refreshPartyCharisma());
    S.engine!.state.flags.onChange(() =>
        localStorage.setItem(
            "engineFlags",
            JSON.stringify(S.engine!.state.flags.toJSON()),
        ),
    );
    migrateVisited();
    // The wallet is the engine's $party.bit from here on (see the state.bits accessor):
    // seed it from the persisted value before persistence is registered, so seeding does
    // not echo back to storage.
    S.engine!.state.vars.set("$party.bit", Number(state._bits) || 0);
    // Same for the obtained-partner set. A save written before the roster was modelled
    // has a deployed party and an empty mask; whoever is deployed is by definition
    // obtained, so the mask is repaired from the party instead of starting wrong.
    S.engine!.state.vars.set(
        "$roster.owned",
        rosterMaskForParty(Number(state._rosterOwned) || 0, state.party ?? []),
    );
    S.engine!.state.vars.onChange((n: string, _o, v) => {
        if (n === "$story.ordinal")
            localStorage.setItem("progressOrdinal", String(v));
        else if (n === "$party.bit") {
            state._bits = Number(v) || 0;
            localStorage.setItem("bits", String(state._bits));
        } else if (n === "$roster.owned") {
            state._rosterOwned = Number(v) || 0;
            localStorage.setItem("rosterOwned", String(state._rosterOwned));
        }
    });

    S.engineBridge = createEngineBridge({
        engine: S.engine,
        // resolve the event's flag_key → wstag bytecode, play it via the existing cutscene path;
        // report the handoff (with its event) so doStoryHandoff can route it.
        playCutscene: (flagKey, onDone) => {
            const ev = (state.wstag[currentMap().id] || []).find(
                (e) => e.flag_key === flagKey,
            );
            if (!ev) {
                console.warn(
                    "[engine] no wstag event for",
                    flagKey,
                    "on",
                    currentMap().id,
                );
                onDone(null);
                return;
            }
            playStoryEvent(ev, (handoff) =>
                onDone(handoff ? { ev, handoff } : null),
            );
        },
        startBattle: (screenId, onWin, onLose) => {
            const index = state.pendingStoryBattleIndex;
            state.pendingStoryBattleIndex = null;
            if (index != null) {
                const mapId = currentMap().id;
                // The queued original command selects the live record. Converted
                // rows consume the result; their fixed screen is not a second selector.
                battle.scriptedScreen(mapId, index).then((requestedScreen) => {
                    if (!requestedScreen) throw new Error(`scripted encounter ${mapId} index ${index} has no decoded screen`);
                    startFieldBattle(() => battle.startScreen(requestedScreen, onWin, onLose, gameOverToTitle, { mapId, lead: false }));
                });
                return;
            }
            const party = battle.partyForScreen(screenId);
            if (!party || !party.length) {
                console.warn("[engine] no party for screen", screenId);
                onLose();
                return;
            }
            startFieldBattle(() => battle.startParty(party, onWin, onLose, gameOverToTitle, { screenId, mapId: currentMap().id })); // flee → replayable; lose → title
        },
        doHandoff: (h) => {
            if (h) doStoryHandoff(h.ev, h.handoff);
        },
        // Non-blocking presentation ops. PlaySparkle(n) = bank-0x70 op-0x50: the original
        // calls setSub1(n) on the player's resident type-0x16 FIELDCOM sparkle actor, which
        // plays packed sound 0x00040009 (ITEM_GET) for programs 1 and 3 and animates the
        // flourish over the player. Only the ARMING lives here; the drawing is in the field
        // render pass off the player's own world position (see drawSparkleActor).
        onPresentation: (op, args) => {
            if (op !== "PlaySparkle") return;
            state.sparkleActor = { program: args[0] ?? 0, start: fieldcomTick() };
            if (args[0] === 1 || args[0] === 3) sfx.play!("item_get");
        },
    });

    // OnStep position cutscenes via the TS trigger-system (engine/systems/trigger-system.ts).
    // It applies erec.sets but NOT the ordinal, so the playEvent wrapper advances it (the
    // legacy storyVM relied on playStoryEvent doing this).
    S.engineTriggerSystem = createTriggerSystem({
        getProgram: (mapId: string) =>
            state.storySteps?.[mapId.replace(/^s/, "")] || null,
        getGrid: (mapId: string) => state.storyGrids?.[mapId.replace(/^s/, "")] || null,
        // The EXACT per-pixel zones (the disc's zonecheck(7,x,y), run-decimised).
        // When present the trigger system reads the step byte from the player's
        // PIXEL and never consults the 32 px grid above — that grid fires a step
        // up to a cell early, which put the Protocol Ruins tunnel hide before the
        // passage and its restore past where the original restores.
        getZoneRuns: (mapId: string) => state.storyZones?.[mapId.replace(/^s/, "")] || null,
        // The engine's StepEnableTable is {rows}; state.stepEnableTable holds the rows
        // themselves (web/game.js:1641). Handing the bare array over left the port's own
        // cone gate inert — it fell back to "live" for every facing and only the
        // renderer's private copy of the same table was enforcing ±1 (2026-10-03).
        getEnableTable: () =>
            state.stepEnableTable ? { rows: state.stepEnableTable } : null,
        // By ID, the way start_event is called: param@+0xa IS the event id. flag_key is
        // not unique inside a stage — the Master Room's records for events 965 and 1450
        // share 012e000a (wstag305.s:3699-3708), so the old flag_key lookup could hand the
        // step path the wrong scene. flag_key stays the fallback.
        getEventById: (mapId: string | number, id) =>
            (state.wstag[mapId] || []).find((e) => e.id === id) || null,
        getEventByKey: (mapId: string | number, fk) =>
            (state.wstag[mapId] || []).find((e) => e.flag_key === fk) || null,
        flags: storyFlags,
        hostCompletesEvent: true,
        done: (fk: string) => !!state.flags["evt_" + fk],
        markDone: (fk: string) => {
            state.flags["evt_" + fk] = true;
            localStorage.setItem("flags", JSON.stringify(state.flags));
        },
        playEvent: (ev, onDone: () => void) =>
            playStoryEvent(ev, (handoff) => {
                // The event's OWN on_complete, through the engine: it runs
                // `<stage>.event.<id>.oncomplete` (the flag writes read out of that
                // event's routine) and, when the stage has a decoded owner
                // (ordinal.byStageOwner, tools/extract_ordinal_owner.py), stores the
                // ordinal that event's routine stores — nothing else. The s820 Spy
                // Satellite finale (event 1080, wstag820.s .L0xa8c: ordinal 0x2b +
                // flag 0x7401) reaches the field ONLY through this trigger, so the
                // coarse per-stage ladder (advanceOrdinal) could not move the story
                // for it — and the ladder would move it on the WRONG event anyway.
                S.engine!.completeEvent(ev.id);
                onDone(); // host already ran the completion leaf; no duplicate command writes
                // A position-triggered scene's own HANDOFF warps, exactly like the other two
                // launch routes (the bridge's rows, web/engine-bridge.js:92, and the bank-0x90
                // talk launcher, playTalkEvent). HANDOFF is op 3.4 = `0x8008b770(id,-1,x<<8,
                // y<<8,p)` + the runner's own `vt+0x28(2)` (field-script-engine-verified.md
                // §3.4, file 0x25d0) — a screen transition wherever it sits. Measured 2026-10-05:
                // s410's event 90 ("who's in charge", started by this step) ends
                // `WALKTO 2 526 296 5 / HANDOFF 554 208 764 7`, and without this the scene ran
                // to its end and left the player standing in the station instead of outside it.
                if (handoff) doStoryHandoff(ev, handoff);
                // Position-triggered scripted-battle PRE → chain battle → POST in one flow.
                // Skip when the PRE itself warps us away (handoff).
                else chainScriptedBattleFromPre(ev);
            }),
        handoffPending: () =>
            // scene_struct+0x54 / +0x58 (fieldstg's handoff id and its argument).
            // The walker writes the equivalent facts in `fade`/`state.launch`/
            // `state.diveDemo`: while any of them owns the field, a step tile's press
            // must not also fire — that is the guard at fieldstg.s:5c54/:5c64/:5d10.
            fade.dir !== 0 ||
            !!state.launch ||
            !!state.handoffHold ||
            !!state.slope ||
            !!state.diveDemo ||
            !!state.iceSlide ||
            (S.engineBridge ? S.engineBridge.isBusy() : false) ||
            cutscene.isActive(),
        isBusy: () =>
            S.engineBridge!.isBusy() ||
            battle.isActive() ||
            cutscene.isActive() ||
            textbox.isOpen!() ||
            choice.isOpen!() ||
            fade.dir !== 0 ||
            !!state.diveDemo ||
            !!state.nameEntry ||
            !!state.packSelect ||
            !!state.endScreen ||
            !!state.titleScreen ||
            !!state.menuOpen,
    });
    window.__engine = S.engine;
    window.__engineBridge = S.engineBridge;
    window.__engineTriggerSystem = S.engineTriggerSystem;
    console.log(
        "%c[engine] ready — story driven by GameEngine",
        "color:#0a0;font-weight:bold",
    );
}
