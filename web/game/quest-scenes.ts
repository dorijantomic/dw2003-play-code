import { stageCast, fieldDirectionIndex, rectBlocked, parseEntry } from "../vendor/engine.js";
import type { SpeechBeat } from "./types.js";
import { mountActorHidden } from "../mount.js";
import { questNeededNpcs } from "../quests.js";
import { questStandFree, standInSpot, questWalkLegs } from "../quest-walk.js";
import { cutContentOpen } from "../cut-content.js";
import { blastOpen } from "../blast-ladder.js";
import { plannerOpen } from "../evolution-planner.js";
import { damageLabOpen } from "../damage-lab.js";
import { replayOpen } from "../replay-theatre.js";
import { encodeNativeScreenText } from "../native-screen.js";
import { paginate, buildPack } from "../dialogue-pack.js";
import { autoBalloonMode } from "../textbox.js";
import { castOf, compileScene } from "../quest-scenes.js";
import {
  loadQuestFxSheets,
  questFxSpawn,
  questFxPlay,
  questFxMove,
  questFxRemove,
  questFxWait,
  questFxDrivePlayer,
  questFxFade,
  questFxShake,
  questFxGet,
  questFxClear,
} from "../quest-fx.js";
import { questSceneCameraToPlayer, questGhostSet } from "../quest-ghost.js";
import { setAmbienceScene, ambienceLightning, clearAmbienceScene } from "../ambience.js";
import { loadPlaceCard } from "../placecard.js";
import { createQuestChase } from "../quest-chase.js";
import { ENTITY_BUCKET } from "../draw-order.js";
import {
  DIR8_CS,
  VIEW_H,
  VIEW_W,
  ZOOM,
  battle,
  books,
  cardAlbum,
  cardDeck,
  cardDuel,
  cardShop,
  choice,
  cntyselNative,
  cutscene,
  dialogueBox,
  driMenu,
  fallbackTextbox,
  fieldMovie,
  fightReport,
  gym,
  inn,
  lastCam,
  placeCard,
  saveScreen,
  sfx,
  shop,
  soundTest,
  stagslctMenu,
  state,
  status,
  storyFlags,
  textbox,
} from "./vars.js";
import { currentMap } from "./session.js";
import { S } from "./state.js";
import { resetFollowers } from "./followers.js";
import { gameOverToTitle, presentVictory, startFieldBattle } from "./battle-launch.js";
import { startTransition } from "./transitions.js";
interface QuestChaseEvent {
    kind: "chase";
    target?: string | number;
    speed?: number;
    lose?: number;
}

interface QuestSceneWarpEvent {
    kind: "warp";
    to?: string | number | null;
    at?: [number, number] | null;
    dir?: number;
}

type QuestSceneEvent =
    | { kind: "fx"; sheet: string }
    | { kind: "fxplay" }
    | { kind: "fxmove" }
    | { kind: "fxremove" }
    | { kind: "fxwait"; name: string }
    | { kind: "drop"; pixels: number; step: number }
    | { kind: "rise"; pixels: number; step: number }
    | { kind: "ghost" }
    | { kind: "bucket"; value: number }
    | { kind: "fade"; to: number; frames: number }
    | { kind: "shake" }
    | { kind: "weather" }
    | { kind: "time" }
    | { kind: "lightning"; count: number; force?: boolean }
    | { kind: "sfx"; name: string }
    | { kind: "placecard"; area: string; place: string }
    | { kind: "chase" }
    | { kind: "battle"; screen: number }
    | QuestSceneWarpEvent;


// The cast of the CURRENT stage, built ONCE at stage entry.
//
// The disc's spawn loop (fieldstg.s file 0x83dc-0x8498, RAM 0x8008b09c-,
// F0x8009116c) runs when the stage's cast is built — stage load — and the actor
// list it constructs IS the live cast until the stage is left. A flag write during
// the stage does NOT add or remove an actor: the disc removes an actor only through
// the scene's own action (`SETPOS <actor> 0 0` parks it off-map — the Wind Prairie
// hide-and-seek setup does exactly this to Veemon, web/assets/events/wstag_events.json
// s395 event 1299) or the actor's own remove call (the block actors, E10). The scene
// resolver 0x80084d8c matches the live class-5 entity by kind, it never re-reads the
// gate (field-script-engine-verified.md §WS4.9).
//
// The walker used to re-evaluate the gate EVERY FRAME in the draw, the resolver and
// the talk probe. So a talk whose own on_close writes its speaker's spawn flag
// removed him the instant the box closed: Veemon's s395 dialogue state (npc 35 id 735,
// web/assets/data/npc_flag_sets.json:12999) sets 6693=0, his variant-A gate, so he
// vanished before the scene it launched had named him — and the resolver then
// conjured a phantom ephemeral at (-100,-100). Snapshot the built cast here; script
// -spawned (ephemeral) actors join it as the scene conjures them, exactly as the
// disc's `spawnActor` pushes onto scene.npcs.
export function sceneCast(sc) {
    if (!sc) return [];
    // The shared rule lives in engine/dw3/npc-manager.ts `stageCast`; this adds the
    // script-spawned (ephemeral) actors the scene conjures onto scene.npcs.
    // EXPERIMENT (mounts): a mount's quest character is off the map while F2 -> Extras -> Mount is off
    const built = stageCast(sc, sc.npcs, state.chapter, storyFlags.get!!!!!!).filter((n) => !mountActorHidden(n));
    const stand = questStandIns(sc, built);
    const eph = sc.npcs.filter((n) => n._ephemeral);
    if (!eph.length) return stand.length ? built.concat(stand) : built;
    const extra = eph.filter((e) => !built.includes(e));
    return extra.length || stand.length ? built.concat(extra, stand) : built;
}

// Optional quests (web/quests.js) can ask for one of the game's own characters on a map where the story has them away at
// the player's point in the story (their spawn flags say no). Then a copy of them stands at one of their own posts on this
// map, preferring a post nobody else is standing on, so the quest can go on. Only the current map, only while needed; the
// copies are kept on the scene so they keep their facing and state between frames. Quests off: none.
function questStandIns(sc, built) {
    const m = currentMap();
    if (!m || state.scenes[m.id] !== sc) return [];
    const need = questNeededNpcs(m.id);
    if (!need.length) { sc._standIns = null; return []; }
    sc._standIns ??= new Map();
    const grid = state.collision[m.id];
    const out = [];
    for (const npcId of need) {
        if (built.some((n) => n.npc_id === npcId)) continue;
        let s = sc._standIns.get(npcId);
        if (!s) {
            const posts = sc.npcs.filter((n) => n.npc_id === npcId && !n._ephemeral && !n._quest);
            if (!posts.length) continue;
            // The post itself is used as it stands (the game's own NPCs stand on counters and door cells). Only when
            // someone else is standing there is the copy nudged aside, and then it must land on walkable ground and clear
            // of everyone (web/quest-walk.js standInSpot tries a few nudges around the post, else keeps the post).
            const taken = (x, y) => built.some((n) => Math.abs(n.x - x) < 20 && Math.abs(n.y - y) < 20);
            const clear = (x: number, y: number) => !taken(x, y) && (!grid || questStandFree(grid, x, y));
            const post = posts.find((p) => !taken(p.x, p.y)) ?? posts[0];
            s = { ...post, id: "qstand_" + npcId, spawn_flags: [], _questStandIn: true };
            if (taken(post.x, post.y)) {
                const spot = standInSpot(post, clear);
                s.x = spot.x; s.y = spot.y;
            }
            sc._standIns.set(npcId, s);
        }
        out.push(s);
    }
    return out;
}

// A screen that owns the whole picture: the field stays where it is under it, and the wide sides are covered.
export function fieldFullScreenUiOpen() {
    return !!(state.menuOpen || status?.isOpen!() || inn.isOpen!() || shop.isOpen!() || driMenu.isOpen!()
        || gym.isOpen!() || cardShop.isOpen!() || cardAlbum.isOpen!() || cardDeck.isOpen!() || cardDuel.isOpen()
        || saveScreen.isOpen!() || fightReport.isOpen!() || fieldMovie.isOpen() || state.nameEntry || state.packSelect
        || state.endScreen || state.titleScreen || stagslctMenu.open || cutContentOpen() || soundTest.open || blastOpen() || plannerOpen() || damageLabOpen() || replayOpen() || books.isOpen()
        || cntyselNative.isOpen() || state.wipe28);
}

// Wide overworld menus (web/field-view.js wideMenuSides): the screens that only draw their own box over the field (pause list, status,
// inn, shop, dri lab, gym, save, the GLOSSARY / OPTIONS books) may show the world dimmed at the sides. These keep black sides: the card
// screens, the fight report and the movie fill the canvas, the name / pack / title / end / map-select screens and the stage wipe replace
// the picture, and the dev pages sit over everything. (Every screen of this list is also in fieldFullScreenUiOpen.)
export function fieldDrawsOverFieldUiOpen() {
    return !!(state.menuOpen || status?.isOpen!() || inn.isOpen!() || shop.isOpen!() || driMenu.isOpen!()
        || gym.isOpen!() || saveScreen.isOpen!() || books.isOpen());
}

export function fieldTakesOverUiOpen() {
    return !!(cardShop.isOpen!() || cardAlbum.isOpen!() || cardDeck.isOpen!() || cardDuel.isOpen()
        || fightReport.isOpen!() || fieldMovie.isOpen() || state.nameEntry || state.packSelect
        || state.endScreen || state.titleScreen || stagslctMenu.open || cutContentOpen() || soundTest.open || blastOpen() || plannerOpen() || damageLabOpen() || replayOpen()
        || cntyselNative.isOpen() || state.wipe28);
}

export function fieldStageFilled() {
    return !!(document.fullscreenElement || document.documentElement.classList.contains("window-fill"));
}

/**
 * Open an NPC talk line. estalkNN refs go to the translated box (raw pack, line = index, the NPC's
 * world position, native 0..7 facing, actor id, projector to the 320x240 screen); anything else, or a
 * failed load, uses web/textbox.js with `legacyAnchor`.
 */
export function openTalkLine(ref, onClose, npc, legacyAnchor: () => { x: number; y: number; mode: number; }) {
    const legacy = () => textbox.open!(getDialogue(ref), onClose, legacyAnchor);
    if (!npc || !/^estalk0\d$/.test(ref?.file ?? "")) return legacy();
    const project = (x, y) => ({
        sx: (x - lastCam.x) * ZOOM * (320 / VIEW_W),
        sy: (y - lastCam.y) * ZOOM * (240 / VIEW_H),
    });
    S.translatedDialogueText = getDialogue(ref);
    dialogueBox.open!(
        { file: ref.file, index: Number(ref.index) },
        { kind: "talk", npc: { x: Math.round(npc.x), y: Math.round(npc.y), facing: fieldDirectionIndex(npc.dir), actorId: npc.npc_id ?? 0 } },
        onClose,
        project,
        {
            playerNameBytes: encodeNativeScreenText(state.playerName),
            onFail: () => fallbackTextbox.open!(getDialogue(ref), onClose, legacyAnchor),
        },
    );
}

/**
 * Extra-quest speech: the same translated box an NPC's line uses, with the line built in the disc's own text format
 * (web/dialogue-pack.js). With the NPC on this map it is their balloon, otherwise the plain bottom window. Resolves on close.
 */
export function questSpeak(npcId, name, text) {
    return new Promise<void>((resolve) => {
        const pages = paginate(text);
        const scene = state.scenes[currentMap()?.id];
        const npc = npcId != null && scene ? sceneCast(scene).find((n) => n.npc_id === npcId && !n.cutsceneOnly) : null;
        const anchor = npc
            ? (() => {
                const mode = autoBalloonMode(npc.dir, (npc.x - lastCam.x) * ZOOM, (npc.y - lastCam.y) * ZOOM, VIEW_W, VIEW_H);
                return () => ({ x: (npc.x - lastCam.x) * ZOOM, y: (npc.y - lastCam.y) * ZOOM, mode });
            })()
            : null;
        const fallback = () => fallbackTextbox.open!({ name, pages }, resolve, anchor);
        const project = (x, y) => ({
            sx: (x - lastCam.x) * ZOOM * (320 / VIEW_W),
            sy: (y - lastCam.y) * ZOOM * (240 / VIEW_H),
        });
        S.translatedDialogueText = { name, pages };
        const opts = { playerNameBytes: encodeNativeScreenText(state.playerName), onFail: fallback };
        const mode = npc
            ? { kind: "talk", npc: { x: Math.round(npc.x), y: Math.round(npc.y), facing: fieldDirectionIndex(npc.dir), actorId: npc.npc_id ?? 0 } }
            : { kind: "say", plain: true, balloonMode: 0, actor: null };
        dialogueBox.open!({ pack: buildPack(name, pages), index: 0 }, mode, resolve, project, opts);
    });
}

export async function playQuestScene(steps) {
    const mapId = currentMap()?.id;
    const scene = state.scenes[mapId];
    if (!scene || cutscene.isActive() || textbox.isOpen!() || battle.isActive()) {
        console.warn(`[quest scene] game busy: scene=${!!scene} cutscene=${cutscene.isActive()} textbox=${textbox.isOpen!()} battle=${battle.isActive()}`);
        questSceneFxReset();
        return null;
    }
    const here = (id) => id === "player" || sceneCast(scene).some((n) => n.npc_id === Number(id) && !n.cutsceneOnly) || !!state.npcSprites?.[Number(id)];
    const need = castOf(steps).filter((id) => !here(id));
    if (need.length) { console.warn(`[quest scene] ${need.join(", ")} not on ${mapId}; skipped`); questSceneFxReset(); return null; }
    const playerId = state.playerCharOne ? 1 : 2;
    const pos = (id) => (id === playerId ? { x: state.x, y: state.y } : (() => { const n = sceneCast(scene).find((c) => c.npc_id === id); return n ? { x: n.x, y: n.y } : null; })());
    const grid = state.collision[mapId];
    // walkable ground by the player's own foot-box test, and clear of every character the scene is not moving
    const cast = new Set(castOf(steps));
    const others = sceneCast(scene).filter((n) => !cast.has(n.npc_id) && !n._ephemeral && (n.x || n.y));
    const free = grid ? (x, y) => !rectBlocked(grid, x - 6, y - 8, x + 6, y) && !others.some((n) => Math.hypot(n.x - x, n.y - y) < 30) : null;
    // a scripted walk steps straight at its target with no collision test (the VM's own walk driver), so the compiler asks
    // this for the legs to walk instead when the straight line crosses a wall (web/quest-walk.js over the same grid)
    const walk = grid ? (ax, ay, bx, by) => questWalkLegs(grid, ax, ay, bx, by) : null;
    const { opcodes, speech, events, errors } = compileScene(steps, { playerId, pos, free, walk, paths: S.questPaths });
    if (errors.length) { console.warn("[quest scene]", errors.join("; ")); questSceneFxReset(); return null; }
    // our own effect sheets, before the first frame that could use one; a missing sheet only makes its step skip
    const sheets = events.filter((e) => e?.kind === "fx").map((e) => e.sheet).filter(Boolean);
    if (sheets.length) { try { await loadQuestFxSheets(sheets); } catch { /* a sheet that will not load is skipped */ } }
    return new Promise((resolve) => {
        for (const npc of scene.npcs) if (!npc._ephemeral) { npc._origX = npc.x; npc._origY = npc.y; }
        const hooks = { afterSay: {}, sceneEvent: (index, resume) => runQuestSceneEvent(S.questSceneEvents[index], resume) };
        let answer = null;
        for (const [n, s] of Object.entries(speech) as [string, SpeechBeat][]) {
            hooks.afterSay[n] = s.ask
                ? (resume: () => void) => choice.open!(s.ask!, s.options!, (i) => { answer = i; resume(); })
                : (resume) => { questSpeak(s.who === "player" ? null : s.who, s.name || (s.who === "player" ? String(state.playerName || "") : ""), s.text).then(resume); };
        }
        S.cutsceneEsdmgRef = null;
        state._questScene = true;
        S.questSceneEvents = events;
        S.questSceneAnswerSet = (v) => { answer = v; };
        cutscene.start(opcodes, null, () => {
            state._questScene = false;
            S.questSceneEvents = [];
            S.questSceneAnswerSet = null;
            questSceneFxReset();       // no effect art or a scene's sky may stay on the map once the scene is over
            for (const npc of scene.npcs) {
                if (npc._origX !== undefined) { npc.x = npc._origX; npc.y = npc._origY; }
                delete npc._origX; delete npc._origY; delete npc._inCutscene; delete npc.activeClip; delete npc._cutTarget;
            }
            scene.npcs = scene.npcs.filter((n) => !n._ephemeral);
            delete state._inCutscene; delete state._cutTarget; delete state.activeClip;
            state._animTime = 0;
            resetFollowers();
            // A scene that ended on a lost fight (the title screen) is not a scene the quest finished: the quest layer
            // reads `failed` and neither accepts nor pays out on it.
            const failed = !!state._questSceneFailed;
            delete state._questSceneFailed;
            resolve({ answer, failed });
        }, hooks);
    });
}

/**
 * Do one of a quest scene's own events (web/quest-scenes.js, the `SCENEEVENT <n>` opcodes): the steps that need something
 * the wstag vocabulary has no opcode for. Each either completes at once and lets the scene go on, or calls `resume` when it
 * is really done. An event that cannot run here (no such sheet, no such map) is skipped, never waited on: a scene must not
 * block on art or a place the game does not have. Reused mechanisms only: the field's y-sorted draw list and its own
 * sprite scale for effects, the s680 +0x54 drive for the player, the story's battle handoff for a fight, and HANDOFF's
 * routing plus the ordinary stage transition for a warp.
 */
export function runQuestSceneEvent(ev: QuestSceneEvent | null | undefined, resume: (() => void) | undefined): void {
    const done = typeof resume === "function" ? resume : () => {};
    if (!ev || typeof ev !== "object") return done();
    switch (ev.kind) {
        case "fx":
            if (!questFxSpawn(ev)) console.warn(`[quest scene] effect sheet "${ev.sheet}" not loaded; the step is skipped`);
            return done();
        case "fxplay": questFxPlay(ev); return done();
        case "fxmove": questFxMove(ev); return done();
        case "fxremove": questFxRemove(ev); return done();
        case "fxwait": questFxWait(ev.name).then(() => done()); return;
        case "drop":
        case "rise":
            // The camera belongs on the player while they fall: an earlier `pan` to a point is released before the first
            // pixel moves, so the room scrolls with the player (web/quest-ghost.js, the camera half of this task).
            questSceneCameraToPlayer();
            questFxDrivePlayer(ev.pixels, ev.step).then(() => done());
            return;
        case "ghost":
            // A memory replay: that actor draws faded and tinted from now on (the renderer asks web/quest-ghost.js per
            // actor); "off" puts them back, and questFxClear puts every one of them back on any exit.
            questGhostSet(ev);
            return done();
        case "bucket":
            // The PLAYER's draw-layer word for the rest of the scene (the `bucket` step): 8 draws them behind the map
            // band, so the ground covers them as they walk (the Protocol Ruins tunnel), and 4 back in front. The value
            // is kept as `_questBucket` because stepSetupBucketTick applies it every frame: a tile's own op-5 record
            // would otherwise take the player back out. questSceneFxReset restores 4 and drops the override on exit.
            state._questBucket = ev.value;
            state.playerDrawBucket = ev.value;
            return done();
        case "fade": questFxFade(ev.to, ev.frames).then(() => done()); return;
        case "shake": questFxShake(ev).then(() => done()); return;
        case "weather": setAmbienceScene(ev).then(() => done()); return;
        case "time": setAmbienceScene(ev).then(() => done()); return;
        case "lightning": ambienceLightning(ev.count, ev.force).then(() => done()); return;
        case "sfx":                                        // a sound cue by name; never blocks the scene
            try { sfx.play!(String(ev.name)); } catch (e) { console.warn(`[quest scene] sound ${JSON.stringify(ev.name)} did not play:`, e?.message ?? e); }
            return done();
        case "placecard":
            // The quest's own place card: the field's blue stage-entry card, typed with two names the quest wrote
            // (web/placecard.js beginText). It closes by itself, so the scene goes straight on without waiting.
            loadPlaceCard().then(() => {
                if (!placeCard.beginText!(ev.area, ev.place)) console.warn(`[quest scene] place card ${JSON.stringify(ev.area)} / ${JSON.stringify(ev.place)} did not start`);
            }).catch((e) => console.warn(`[quest scene] the place card data did not load: ${e?.message ?? e}`));
            return done();
        case "chase": return startQuestChase(ev, done);
        case "battle": {
            // The story's own scripted-fight route: the screen's party behind the field's battle handoff. A WIN (or a
            // flee, as in the story's fights) and the scene goes on; a LOSS takes the game to the title, so the scene
            // ends there -- it must never run its remaining steps over the title screen.
            questSceneFxReset();
            const mapId = currentMap().id;
            let settled = false;
            const goOn = () => { if (!settled) { settled = true; done(); } };
            startFieldBattle(() => Promise.resolve(battle.startScreen(Number(ev.screen), (res) => {
                presentVictory(res);
                goOn();
            }, goOn, () => {
                settled = true;
                state._questSceneFailed = true;   // the quest layer must not pay out a scene that ended on the title
                gameOverToTitle();
                cutscene.abort();
            }, { mapId, lead: false })).then((ok) => {
                // startScreen returns false when it cannot put the screen up (no such screen, no party): the scene goes on
                // rather than waiting forever for a fight that never started.
                if (ok === false) {
                    console.warn(`[quest scene] battle screen ${ev.screen} did not start; the step is skipped`);
                    goOn();
                }
            }).catch(() => goOn()));
            return;
        }
        case "warp": {
            // HANDOFF's own route: a screen id goes through the game's screen table, a map id is used as given; then the
            // ordinary stage transition (fade, setMap). The scene ends at the warp, exactly as HANDOFF ends a story scene.
            questSceneFxReset();
            const from = currentMap().id;
            let to = ev.to;
            if (typeof to === "number") {
                const routed = S.screenRouter.route(to, from);
                to = routed?.kind === "warp" ? routed.to : null;
            }
            const idx = to != null && state.manifest.maps.some((m) => m.id === String(to))
                ? state.manifest.maps.findIndex((m) => m.id === String(to))
                : -1;
            if (idx < 0) { console.warn(`[quest scene] no map for warp ${JSON.stringify(ev.to)}; skipped`); return done(); }
            startTransition({
                to: String(to),
                spawnX: ev.at?.[0] ?? null,
                spawnY: ev.at?.[1] ?? null,
                dir: DIR8_CS[(ev.dir ?? 0) & 7],
                scripted: true,
            });
            if (cutscene.isActive()) cutscene.abort(); else done();
            return;
        }
        default:
            return done();
    }
}

/**
 * Start the `chase` step (web/quest-chase.js): the target -- an NPC on this map, or one of our own effects -- runs the
 * path at `speed` while the PLAYER keeps the controls and must stay within `lose` px of it. It is the one scene step that
 * hands the field back to the player: `state._questChase` lets the ordinary field update (movement, collision, the party
 * following) through the cutscene's input gate while the VM waits on this event, and the camera is already on the player
 * (compileScene emits FN6A before it). The result becomes the scene's answer, exactly as an "ask" step's does.
 */
function startQuestChase(ev: QuestChaseEvent, done: () => void): void {
    const scene = state.scenes[currentMap()?.id];
    const fxTarget = typeof ev.target === "string";
    const npc = fxTarget ? null : scene ? sceneCast(scene).find((n) => n.npc_id === Number(ev.target)) : null;
    const fx = fxTarget ? questFxGet(ev.target) : null;
    if (!npc && !fx) {
        console.warn(`[quest scene] chase target ${JSON.stringify(ev.target)} is not here; the step is skipped`);
        return done();
    }
    const machine = createQuestChase(ev, { x: npc ? npc.x : fx.x, y: npc ? npc.y : fx.y });
    if (S.questChase) clearQuestChase();                 // defensive: one chase at a time
    S.questChase = { machine, npc, fx, resolve: done, settled: false };
    state._questChase = true;
    state._questChaseTarget = ev.target;
    if (machine.state.over) endQuestChase(machine.state.result);   // an empty path is not a chase: the step is skipped
}

/** One frame of a running chase: move the target, judge the gap, and let it blink when it is about to be lost. */
export function tickQuestChase(dt: number) {
    const c = S.questChase;
    if (!c) return;
    const s = c.machine.tick(state.x, state.y, dt);
    if (c.npc) {
        c.npc.x = s.x; c.npc.y = s.y; c.npc.dir = s.dir;
        c.npc._chasing = s.moving;
        c.npc._chaseWarn = s.warn;
        if (s.moving) c.npc._animTime = (c.npc._animTime ?? 0) + Math.min(dt, 0.25);
    } else if (c.fx) {
        c.fx.x = s.x; c.fx.y = s.y;
        if (c.fx.layer === "entity") c.fx.ysort = s.y;
    }
    if (s.over) endQuestChase(s.result);
}

/** The chase is decided: the result is the scene's answer, and a loss ends the rest of the scene right here. */
function endQuestChase(result) {
    const c = S.questChase;
    if (!c || c.settled) return;
    c.settled = true;
    S.questChase = null;
    state._questChase = false;
    state._questChaseTarget = null;
    if (c.npc) { c.npc._chasing = false; c.npc._chaseWarn = false; }
    // What the run came to, kept where a test (or the quest lab) can read it after the step has been cleaned up.
    state._questChaseLast = {
        result,
        target: c.npc ? c.npc.npc_id : (c.fx ? c.fx.name : null),
        distance: Math.round(c.machine.state.distance),
        seconds: Math.round(c.machine.state.elapsed * 10) / 10,
    };
    if (S.questSceneAnswerSet) S.questSceneAnswerSet(result);      // the scene's answer, exactly like an "ask"
    if (result === 1 && cutscene.isActive()) { cutscene.abort(); return; }   // the words after a failed chase never play
    c.resolve();
}

/** Nothing of a chase may outlive the scene (any exit): the target goes back to its idle pose. */
export function clearQuestChase() {
    const c = S.questChase;
    const pending = !!c && !c.settled;                 // still running, so the scene is blocked on it
    if (c) {
        c.settled = true;
        if (c.npc) { c.npc._chasing = false; c.npc._chaseWarn = false; }
    }
    S.questChase = null;
    state._questChase = false;
    state._questChaseTarget = null;
    if (!pending) return;
    // Clearing a chase that was still running (F2 -> Quests switched off mid-run, a save loaded, a stage entry that ended
    // the VM) must not leave the cutscene waiting on an answer it can never get: an interrupted run counts as lost, so the
    // step it sits in stays open, and the scene ends so its own finish path can do the rest.
    if (S.questSceneAnswerSet) S.questSceneAnswerSet(1);
    if (cutscene.isActive()) cutscene.abort();
}

/**
 * Everything a quest scene may have put on the map, back to nothing: our effect art and a scene's weather / time of day.
 * Called whenever a scene ends, is skipped, fights or warps, and on every stage entry -- so a map change can never inherit
 * another map's sky. (Other quest-scene features hook their own cleanup into questFxClear.)
 */
export function questSceneFxReset() {
    questFxClear();
    clearAmbienceScene();
    clearQuestChase();
    // The player's own draw layer goes back to the entity bucket (4) on every exit, and the scene's override with it:
    // a scene that put the player behind the map band must never leave them there (web/quest-scenes.js `bucket`).
    delete state._questBucket;
    state.playerDrawBucket = ENTITY_BUCKET;
}

function getDialogue(ref) {
    return parseEntry(
        state.dialogues[ref.file][String(ref.index)],
        state.playerName,
    );
}
