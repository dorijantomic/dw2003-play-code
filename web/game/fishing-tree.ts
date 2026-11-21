import {
  fishingSpotAt,
  engageBlock,
  startFishing,
  FISHING_BUDGET,
  startFishingPose,
  playerPackForClip,
  POSE_CAST_CLIP,
  storeAddItem,
  ITEM_BY_ID,
  chapterNpcs,
  actorFootprintBlocked,
  npcHalfWidth,
  treeIndexAt,
  fieldProbePushback,
  fieldDirectionIndex,
  terrainGateBlocks,
  rectBlocked,
  relocateActiveTree,
  TREE_BOOTS_FLAG,
  treeActionPoint,
  startTreeKick,
  KICK_SOUND,
  tickTreeRadar,
  tickTreeKick,
  TREE_SPRITE_IDLE,
  treeKickHoldsInput,
  KICK_POSE_CLIP,
} from "../vendor/engine.js";
import { messageFor, rollExtra } from "../fishing-extras.js";
import { questPropSolidAt } from "../quest-props.js";
import { setPointSprite } from "../effects.js";
import { stepPlayback } from "./field-steps.js";
import {
  battle,
  choice,
  cutscene,
  fade,
  fishFinds,
  rand16,
  sfx,
  state,
  storyFlags,
  textbox,
} from "./vars.js";
import { currentMap } from "./session.js";
import { questSpeak } from "./quest-scenes.js";
import { gameOverToTitle, presentVictory, startFieldBattle } from "./battle-launch.js";

// ---------------------------------------------------------------------------
// Fishing (engine/systems/fishing.ts, tools/extract_fishing_spots.py).
//
// A fishing spot is an op-7 step record gated on FishingPole possession, so the
// spots simply are not there until you own the pole — the same read the step VM
// does. Standing on one and pressing the action key casts; pressing again while
// the marker is sweeping strikes.
//
// The original casts and strikes with the SAME pad bit: the cast is the confirm
// press the step VM's driver runs on (bit 0x2000, held), and the strike is that
// same bit read inside the bobber's own tick (file 0xa6f0-0xa700, the only pad
// read in all 306 instructions of it). Claim
// `a-fishing-strike-is-the-confirm-button-s-own-bit-2026-10-05`: what the pad
// calls circle sends 0x1000 and never strikes. The walker's confirm key carries
// that bit here too; the Back key (`x`) is a different bit and must not strike.
//
// While the cast runs the player is NOT Junior's ordinary sprite. Mode 0x48
// swaps him to P002PLYF and plays five clips off it (engine/systems/fishing.ts,
// "The angler"); the rod, the line and the float's flight are drawn into those
// frames, which is why the separate float object stays hidden until the cast has
// settled.

/**
 * The fishing spot under the player, or null.
 *
 * WHETHER a spot exists is the playback executor's answer, not a private reading:
 * an op-7 step is armed by the grid byte, the facing cone (fieldstg.s:5648-5680) and
 * the record's own two flag conditions (fieldstg.s:56d4-5738) — all three reproduced by
 * trigger-system's `playback()`. The rod requirement IS that flag condition: every op-7
 * record in the shipped corpus carries `cond_a = 0x8005 / arg_a = 1`, and 0x8005 is item
 * 5 (the FishingPole) in the bag, so standing on a spot with no rod leaves the tile dark
 * and the press does nothing.
 *
 * `fishing_spots.json` is left holding the float's landing offset and the two catch
 * parties — the encounter-block data, which is a different table from the step record.
 */
export function fishingSpotHere() {
    const pb = stepPlayback();
    const plan = pb?.effect?.actorAction;
    if (!pb || !pb.live || !plan || plan.kind !== "castPose") return null;
    return fishingSpotAt(state.fishingSpots?.[currentMap().id], pb.step);
}

/**
 * Start the special block actors' interaction (npc 328/351/352) — the engage
 * branch fieldstg F0x8008E2CC, called from the player's confirm path behind the
 * Submarimon depth gate. It refuses a target already in its 0x4e mode and
 * refuses anything but the three ids; the walker also refuses to start a
 * second scene while one runs, because the field lock is up for the first.
 * Returns true when the press was consumed.
 */
export function startBlockInteraction(npc) {
    if (state.blockEngage) return true;
    const ix = engageBlock(npc.npc_id);
    if (!ix) return false;
    state.blockEngage = { ix, npc };
    return true;
}

/** Cast at `spot`, spending one of this map's sixteen catches. */
export function startFishingCast(spot) {
    const r = startFishing(state.fishingBudget ?? FISHING_BUDGET, () =>
        Math.floor(Math.random() * 0x10000),
    );
    state.fishingBudget = r.budget;
    // The float lands at the spot's own offset from where you are standing —
    // params[0..1] of the step record, added to the controller's position by
    // F0x8008f304 (fieldstg file 0xc6c8).
    state.fishing = {
        run: r.state,
        x: state.x + spot.dx,
        y: state.y + spot.dy,
        strike: false,
        // The angler. `dir` is whatever Junior was facing — mode 0x48 never
        // touches the entity's facing field, and SETANIM's two-argument form
        // (the one that would) is not the one this mode calls.
        pose: startFishingPose(),
        poseT: 0,
        dir: state.dir,
        // The cast controller's own mode reaching 0 — what sub-state 3 waits on.
        castOver: false,
        // The result balloon sub-state 3 opens and sub-state 4 closes. It is the
        // same balloon actor the story bubbles use (F0x80088144(0, 1, 6), file
        // 0xdd54), so its lifetime is the only thing the pose has to supply: it
        // pops, holds, and — after the close command — plays its close out
        // before it stops drawing.
        result: null,
        // Band the cast resolved to, held until the angler has stood back up —
        // the original starts the fight after this whole sequence, not during it.
        pending: null,
    };
    state.moving = false;
    state.stopping = false;
}

/** The P002PLYF manifest record, or undefined if the pack did not load. */
export function fishingSpriteMeta() {
    return playerPackMeta(playerPackForClip(POSE_CAST_CLIP));
}

/**
 * The manifest record for whichever of the player's five packs a clip id
 * resolves through — the original's own rule (engine/systems/player-clip-packs.ts,
 * read out of FIELDSTG's clip resolver F0x8008F9C0). Every player mode that
 * latches a clip asks here, so the fishing cast, the ladder, the slope step and
 * the tree kick all reach their pack by the same table instead of by name.
 */
export function playerPackMeta(packId: string) {
    return state.manifest.npcs?.find((n) => n.id === packId);
}

/**
 * Pay a fishing extra: the game's own item store / bits, the "got it" sound
 * (item_get) and the game's own plain message box. Waits until the fight report,
 * fade and wipe are gone so the box is not drawn under them. Remembered in the
 * found-flags (dw.fishfinds.v1) for the Angler's almanac.
 */
function awardFishingExtra({ area: areaId, entry }) {
    const area = (state.fishingExtras.areas ?? []).find((a) => a.id === areaId);
    if (!area) return;
    let tries = 0;
    const go = () => {
        const busy = battle.isActive() || cutscene.isActive() || textbox.isOpen!() || choice.isOpen!() || state.menuOpen || fade.dir !== 0 || !!state.wipe28;
        if (busy && tries++ < 300) { setTimeout(go, 200); return; }
        let itemName = null;
        if (entry.kind === "item") {
            storeAddItem(state, entry.item, 1);
            localStorage.setItem("inventory", JSON.stringify(state.inventory));
            itemName = ITEM_BY_ID?.[entry.item]?.name ?? entry.name;
        } else if (entry.kind === "bits") {
            state.bits = Math.min((state.bits ?? 0) + entry.bits, 9999999);
            localStorage.setItem("bits", String(state.bits));
        }
        fishFinds.note(area.id, entry);
        sfx.play!("item_get");
        questSpeak(null, "", messageFor(state.fishingExtras, area, entry, itemName));
    };
    go();
}

export function startFishingCatch(mapId, slot) {
    const rec = state.fishingSpots?.[mapId]?.catch?.[String(slot)];
    if (!rec) return;
    // The disc catch above is untouched. On top of it, ONE separate roll against
    // this stage's small extras table (web/fishing-extras.js): drawn now, paid
    // only if the fight is won (a Digimon that flees pays nothing).
    const extra = state.fishingExtras ? rollExtra(state.fishingExtras, mapId, Math.random) : null;
    startFieldBattle(() => battle.startScreen(
        rec.screenId,
        (res) => presentVictory(res, () => { if (extra && !res?.enemyFled) awardFishingExtra(extra); }),
        null, // flee: the cast is already spent
        gameOverToTitle,
        { mapId },
    ));
}

/** This stage's tree table, or null. */
function treeStage(mapId = currentMap().id) {
    return state.treeStages?.[mapId] ?? null;
}

/**
 * The occupancy query at ONE probe point (F0x80092a90): occupied when the point
 * lies inside a standing field actor's footprint diamond `|dx| + 2|dy| <=
 * halfWidth` or within 10 px of a tree (F0x8008ce40, treeIndexAt). Reads the
 * same live NPC list and tree table the draw uses, so what blocks is what you
 * see. The player is never in the list.
 */
function fieldPointOccupied(m, px, py) {
    // A quest prop marked "solid" (the world a finished quest left changed) blocks like a standing actor -- it answers the
    // same occupancy query, so the disc's own pushback does the rest (web/quest-props.js).
    if (questPropSolidAt(m.id, px, py)) return true;
    const scene = state.scenes[m.id];
    const npcs = scene?.npcs
        ? chapterNpcs(scene.npcs, state.chapter, storyFlags.get!!!!!!)
        : [];
    if (actorFootprintBlocked(npcs, (n) => npcHalfWidth(n.npc_id), px, py)) return true;
    const trees = treeStage(m.id)?.trees ?? null;
    return !!(trees && treeIndexAt(trees, { x: px, y: py }) != null);
}

/**
 * The disc's obstacle response at a post-step position: F0x8008dfec's five
 * probes for the actor's CURRENT facing (`fieldProbePushback`), each BLOCKED
 * point pushing the actor back by its own (∓mag/2, ∓mag/4) — never a step
 * revert, and never a point behind the actor, so walking away from an obstacle
 * is always allowed. A point is blocked the way F0x8008de0c blocks it:
 * occupancy (F0x80092a90 actor diamonds + F0x8008ce40's ±10 box) OR the terrain
 * half — the zonemgr+0x44 typed-terrain byte at the point (F0x80092914, called
 * with the current-type word, 0 in every shipped stage) under the form's height
 * band (`terrainGateBlocks`; only Submarimon carries a height, actor+0x64).
 * Returns the vector to SUBTRACT (F0x8008de0c's arg3/arg4).
 */
export function fieldStepObstaclePush(m, grid, x: number, y: number, magnitudeFixed, heightFixed) {
    return fieldProbePushback(
        fieldDirectionIndex(state.dir),
        magnitudeFixed,
        x,
        y,
        (px, py) => fieldPointOccupied(m, px, py)
            || (grid ? terrainGateBlocks(grid, px, py, heightFixed) : false),
    );
}

/** Whether the player's 12×8 foot box at (x,y) overlaps a blocked walkmesh cell. */
export function boxStuck(grid, x, y) {
    return !!grid && rectBlocked(grid, x - 6, y - 8, x + 6, y);
}

/**
 * Re-roll the live tree, which the original does on ARRIVAL at a map whose id
 * differs from the one it last recorded (fieldstg file 0x4878: `[0x26dc]` holds
 * that id, and only a mismatch sets the re-roll flag `[0x26d8]`). Coming back to
 * the same map — walking in from a battle — keeps the marker where it was.
 */
export function reseedLiveTree(mapId) {
    const stage = treeStage(mapId);
    if (!stage) {
        state.treeLive = null;
        return;
    }
    if (state.treeLive?.stage === mapId) return;
    state.treeLive = {
        stage: mapId,
        index: relocateActiveTree(stage.trees.length, rand16),
    };
}

/** Kick the tree in front of the player, if there is one. */
export function tryTreeKick() {
    if (state.treeKick || storyFlags.get(TREE_BOOTS_FLAG) === 0) return false;
    const stage = treeStage();
    if (!stage) return false;
    // setMap can run before tree_kick.json has landed; seeding here as well
    // keeps the very first map's live tree from staying unset.
    reseedLiveTree(currentMap().id);
    const facing = fieldDirectionIndex(state.dir);
    const index = treeIndexAt(stage.trees, treeActionPoint(state.x, state.y, facing));
    if (index == null) return false;
    state.treeKick = { run: startTreeKick(index, facing), rec: stage.trees[index].rec };
    state.moving = false;
    state.stopping = false;
    sfx.playPacked!(KICK_SOUND, { overlap: true });
    return true;
}

/**
 * Advance the kick (and the radar card, which outlives it) by `ticks` frames.
 * Returns true while Junior's own kick ANIMATION is still playing — leader mode
 * 0x49 owns his input for exactly as long as clip 8 runs (31 ticks authored;
 * see the unresolved 31/28/27 note in engine/systems/tree-kick.ts).
 */
export function advanceTreeKick(ticks: number) {
    const mapId = currentMap().id;
    const stage = treeStage(mapId);
    for (let t = 0; t < ticks; t++) {
        if (state.treeRadar && !tickTreeRadar(state.treeRadar)) state.treeRadar = null;
        const k = state.treeKick;
        if (!k || !stage) continue;
        const live = state.treeLive?.index ?? 0;
        const tree = stage.trees[k.run.index];
        const liveTree = stage.trees[live] ?? tree;
        const cue = tickTreeKick(k.run, {
            count: stage.trees.length,
            liveIndex: live,
            liveX: liveTree.x,
            liveY: liveTree.y,
            kickedX: tree.x,
            kickedY: tree.y,
        }, rand16);
        // The manager pokes the kicked tree's point record every frame; every
        // other tree is held on its resting cell, which it already is here.
        setPointSprite(mapId, k.rec, k.run.shake.sprite);
        if (cue.kind === "radar") {
            state.treeRadar = cue.radar;
        } else if (cue.kind === "encounter") {
            // The live marker moves BEFORE the fight loads, so it is already
            // somewhere else when you walk back in.
            state.treeLive = { stage: mapId, index: cue.relocateTo };
            setPointSprite(mapId, k.rec, TREE_SPRITE_IDLE);
            state.treeKick = null;
            // The field (radar card included) tears down as the fight loads.
            state.treeRadar = null;
            startTreeEncounter(mapId, cue.slot);
            return false;
        }
        if (k.run.done) {
            setPointSprite(mapId, k.rec, TREE_SPRITE_IDLE);
            state.treeKick = null;
        }
    }
    return treeKickHoldsInput(state.treeKick?.run);
}

/** The P002PLYK manifest record, or undefined if the pack did not load. */
function treeKickSpriteMeta() {
    return playerPackMeta(playerPackForClip(KICK_POSE_CLIP));
}

/**
 * What fell out of the live tree — a battle out of the stage's own scripted
 * (rate-0) encounter block, the same block the ambush tiles and fishing read.
 * Slot 3 is the near roll (102/128), slot 6 the far one (26/128).
 */
function startTreeEncounter(mapId, slot) {
    const rec = state.treeStages?.[mapId]?.encounters?.[String(slot)];
    if (!rec) return;
    startFieldBattle(() => battle.startScreen(
        rec.screenId,
        (res) => presentVictory(res),
        null, // flee: the tree has already dropped it
        gameOverToTitle,
        { mapId },
    ));
}
