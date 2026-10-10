// Translated stage actors: the pieces a stage overlay builds for itself out of
// its own record table, ported in the engine and driven here.
//
// Today that is the falling/bouncing rock (engine/systems/falling-object.ts,
// decoded from wstag415 0x800a5fa8 / 0x800a5ee8). The tables come from
// tools/extract_falling_objects.py -> assets/data/falling_objects.json, which
// finds the actor by its own code in every wstag overlay and pairs each builder
// with the resident effect registry, so a stage that ships it needs no edit here.
//
// WHY THIS EXISTS ALONGSIDE web/native-stage.js: the MIPS interpreter can also
// run these objects, but production must not execute original machine code, and
// the interpreter's images are a research route (`?nativeStages`). Before this
// module the s415 crevice ride drew no boulders at all in the shipped game: the
// script's SETANIM 816..825 had nothing to construct them. The translated route
// is the one that plays in the game; the interpreter route still runs the same
// events when it is asked for.
//
// Fail-soft by construction: a stage with no table, an id no builder claims, or
// a table that will not parse is a no-op, and the stage plays as before.

import {
    createFallingObject,
    fallingObjectDraws,
    fallingObjectSlot,
    tickFallingObject,
    fireStreetBroadcast,
    tickStreetVehicles,
    streetVehicleDraws,
    streetPropDraws,
    clearStreetVehicles,
    fireStreetScreens,
    tickStreetScreens,
    streetScreenDraws,
    clearStreetScreens,
    fireStreetLights,
    tickStreetLights,
    streetGlowDraws,
    clearStreetLights,
    fireStingerPopup,
    tickStingerPopup,
    stingerPopupState,
    clearStingerPopup,
    POLE_RECORD_TYPES,
    fixedSpriteFor,
    createFixedSprite,
    tickFixedSprite,
    playFixedSpriteBuildSound,
    setFixedSpriteBuildSound,
    slotPlayerFor,
    createSlotPlayer,
    configureSlotPlayer,
    tickSlotPlayer,
    createS805Annotator,
    createS820Annotator,
    tickS805Annotator,
    tickS820Annotator,
    annotatorDraws,
    layerForField,
    annotatorLayerBounds,
    ANNOTATOR_PORTED_MEMBERS,
    annotatorShapeSetFor,
    ensembleFor,
    createEnsemble,
    configureEnsemble,
    tickEnsemble,
} from "./vendor/engine.js";
import { fireNativeEffect, nativeStage } from "./native-stage.js";
import {
    firePointRecordStageObject,
    tickPointRecordStageObjects,
    clearPointRecordStageObjects,
    setPointSlot,
    clearPointSlots,
    pictureStepDraws as pictureStepActorDraws,
} from "./effects.js";

let configs = null; // stageId -> FallingObjectConfig (null until loaded)
let fixed = null; // stageId -> FixedSpriteMember[] (null until loaded)
let slots = null; // stageId -> SlotPlayerMember[] (null until loaded)
let ensembles = null; // stageId -> the id -> member map (null until loaded)
let points = null; // point_sprites.json records, for the slot chain's tags
const live = {}; // stageId -> FallingObject[]
const fixedLive = {}; // stageId -> FixedSprite[]
const slotLive = {}; // stageId -> SlotPlayer[]
const ensembleLive = {}; // stageId -> Ensemble[]
const ensembleChains = {}; // stageId -> the display chain, loaded once per stage
const slotChains = {}; // stageId -> the chain records (loaded once per stage)
let playSound = null; // (packedWord) => void
let readOrdinal = () => 0; // () => master story ordinal
// `var`, not `let`: effects.js and this module import each other, and effects.js
// hands this over while this module is still initialising. A `let` is in its
// temporal dead zone at that point and the hand-over throws.
var poleRecords = null; // stageId -> [{type, size}], handed over by effects.js
const claimed = {}; // stageId -> the pole records have gone to the writer

/**
 * Remember that this stage's records have already reached the traffic-light
 * writer. `fireStreetLights` does the claim itself when the caller hands the
 * records over, and the original's writer searches them once in its state-0 arm,
 * so a second walk would be a second search.
 */
function claimPoles(stageId) {
    claimed[stageId] = true;
}
const annotators = {}; // stageId -> the stage's draw-context annotator run
let annotatorRandom = () => 1; // the resident random the delay walk reads

/** Load the extracted per-stage tables. Non-fatal: stages simply stay quiet. */
export async function loadFallingObjects() {
    const [rocks, sprites, chain, walls] = await Promise.all([
        fetch("assets/data/falling_objects.json"),
        fetch("assets/data/stage_fixed_sprites.json"),
        fetch("assets/data/stage_slot_players.json"),
        fetch("assets/data/stage_slot_ensembles.json"),
    ]);
    if (!rocks.ok) throw new Error(`falling objects: HTTP ${rocks.status}`);
    configs = await rocks.json();
    if (sprites.ok) fixed = await sprites.json();
    if (chain.ok) slots = await chain.json();
    if (walls.ok) ensembles = (await walls.json()).stages ?? null;
    // The display chain the ensembles and the slot players claim out of. It is
    // loaded with the rest of the tables because a claim needs it: an object
    // built before the chain arrives would claim nothing and never be rebuilt.
    try {
        points = await (await fetch("assets/data/point_sprites.json")).json();
    } catch {
        points = {};
    }
    return configs;
}

/** The engine's packed-sound sink, wired once by the game loop. */
export function setStageObjectSound(fn) {
    playSound = fn;
    // One packed-sound sink for every actor this module owns: the rocks, the
    // fixed still sprites' builders and the street corner all hand the resident
    // player the same kind of word.
    setFixedSpriteBuildSound(fn);
}

/**
 * The master story ordinal, wired once by the game loop. The overlay's street
 * entry only builds the traffic-light corner in its ordinal-0x1B arm, so the
 * engine needs the same number the story engine holds.
 */
export function setStageObjectOrdinal(fn) {
    readOrdinal = typeof fn === "function" ? fn : () => 0;
}

/**
 * The stage's point records, in the two bytes the traffic-light writer reads:
 * `type` is record byte+1 (which pole it is) and `size` is byte+2, the field
 * whose zero value ends the original's walk. web/effects.js owns that table, so
 * it hands the shape over once instead of the two modules importing each other.
 */
export function setStageObjectPoleRecords(fn) {
    poleRecords = typeof fn === "function" ? fn : null;
}

/** The extracted table for a stage id ("s415" or "415"). */
function configFor(stageId) {
    return configs?.[String(stageId).replace(/^s/, "")] ?? null;
}

/** The fixed still-sprite family members a stage ships, same id spelling. */
function fixedFor(stageId) {
    return fixed?.[String(stageId).replace(/^s/, "")] ?? null;
}

/** The display-slot channel players a stage ships, same id spelling. */
function slotsFor(stageId) {
    return slots?.[String(stageId).replace(/^s/, "")] ?? null;
}

/** The six-slot display ensembles a stage ships, keyed by registry id. */
function ensemblesFor(stageId) {
    return ensembles?.[String(stageId).replace(/^s/, "")] ?? null;
}

/**
 * The stage's 18-byte display-slot chain as the writers see it: the tag byte at
 * +1 and the terminator at +2, which is all a claim needs. Loaded from the same
 * extracted table the renderer draws, so the writer and the reader cannot
 * disagree about which record a member owns.
 */
async function chainRecords(stageId) {
    if (!points) {
        try {
            points = await (await fetch("assets/data/point_sprites.json")).json();
        } catch {
            points = {};
        }
    }
    const recs = points?.[stageId]?.records ?? [];
    return recs.map((r) => ({ atlasFlag: r.atlasFlag, size: r.size }));
}

/**
 * The display chain an ensemble claims out of, by its id spelling. The claim
 * needs the chain's own bytes, so the first ensemble on a stage waits for them
 * exactly as the slot player does.
 */
function ensembleChain(stageId) {
    return ensembleChains[stageId];
}

/** The chain as it stands right now, from the table loaded beside the others. */
function ensembleChainNow(stageId) {
    if (ensembleChain(stageId) !== undefined) return ensembleChain(stageId);
    const recs = points?.[stageId]?.records ?? [];
    return recs.length ? recs.map((r) => ({ atlasFlag: r.atlasFlag, size: r.size })) : null;
}

/** Resolve the chain if it has not arrived yet; returns whether it is ready. */
async function ensureEnsembleChain(stageId) {
    if (ensembleChain(stageId) !== undefined) return ensembleChain(stageId) != null;
    const recs = await chainRecords(stageId);
    ensembleChains[stageId] = recs.length ? recs : null;
    return ensembleChain(stageId) != null;
}

/** Per-stage sound hook, so a tick's bounce plays through the game's sfx. */
function soundFor(stageId) {
    return (word) => playSound?.(word >>> 0, stageId);
}

/**
 * SETANIM on a special object (>= 0x320). Returns true when this module
 * constructed the actor, which is the original's "the id was consumed by the
 * effect registry" answer. Constructing an id that is already live is a no-op,
 * exactly as fieldstg F0x80084dd0 looks the id up before constructing.
 */
export function fireStageObject(stageId, id, sub) {
    // THE point-record actors (engine/systems/point-record-actor.ts): all
    // fifteen members in one module -- the Asuka City download halos, the login
    // flash, the Kusanagi City / Undersea Base decor and the s805/s810/s820
    // picture drivers. Each claims the stage's own ambient point-sprite records
    // by their atlas byte and animates them. Under ?nativeStages the original
    // code owns those records, so the port stands down and none is driven twice.
    if (!nativeStage(stageId) && firePointRecordStageObject(stageId, id, sub)) {
        return true;
    }
    // The street broadcast (s780, engine/systems/street-vehicles.ts): SETANIM
    // 0x320 with sub 0x320/0x324 sets the broadcast object's sub-state, and its
    // tick puts the cars on the street. Under ?nativeStages the original code
    // owns that object itself, so the port stands down and no car is drawn twice.
    if (!nativeStage(stageId) && fireStreetBroadcast(stageId, id, sub)) return true;
    // The wall/column screens (s780, engine/systems/street-screens.ts): SETANIM
    // 801 802 is the announcement's "screens move to the news tiles" opcode.
    if (!nativeStage(stageId) && fireStreetScreens(stageId, id, sub, soundFor(stageId))) return true;
// The corner stinger (s780, engine/systems/stinger-popup.ts): SETANIM
    // 802 803 builds registry id 0x322. Its registry record has a NULL draw
    // word, so the sub id is accepted and dropped and the object animates
    // itself from its own tick.
    if (!nativeStage(stageId) && fireStingerPopup(stageId, id, readOrdinal())) {
        const p = stingerPopupState(stageId);
        if (p?.sound != null) soundFor(stageId)(p.sound);
        return true;
    }
    // The fixed still sprites (engine/systems/stage-fixed-sprite.ts): one
    // decoration pinned to a point in the room, drawn in two layers. SETANIM
    // with the member's registry id builds it; the stage scripts pass any
    // sub-operand and the original's configure handler is null, so it is only
    // ever a construct.
    const member = fixedSpriteFor(fixedFor(stageId), id);
    if (member) {
        if (!nativeStage(stageId)) {
            const list = (fixedLive[stageId] ??= []);
            if (!list.some((o) => o.id === id)) {
                list.push(createFixedSprite(member));
                // The builder plays its cue as it builds (wstag310 file 0x1534
                // `jalr $v0` with `ori $a0, 0x1d` in the delay slot), so this
                // is the sound of the machine appearing, not of its burst.
                playFixedSpriteBuildSound(member);
            }
        }
        return true;
    }
    // The display-slot channel players (engine/systems/stage-slot-player.ts):
    // one decoration the stage object owns in the field's own record chain. The
    // stage scripts pass the sub-operand, and it is the member's configure
    // handler that acts on it - it plays the voice and raises the counter - so
    // the sub-operand goes through here rather than being dropped.
    const slotMember = slotPlayerFor(slotsFor(stageId), id);
    if (slotMember) {
        if (nativeStage(stageId)) return true;
        const list = (slotLive[stageId] ??= []);
        let obj = list.find((o) => o.id === id);
        if (!obj) {
            obj = createSlotPlayer(slotMember);
            list.push(obj);
        }
        const word = configureSlotPlayer(obj, slotMember, sub ?? slotMember.subCommand);
        if (word !== null) soundFor(stageId)(word);
        return true;
    }
    // The two stage-owned annotators (the resident 2D draw-context service,
    // engine/systems/draw-context.ts): SETANIM 841 on s805 lights its ring of
    // twenty-seven markers, 845 on s820 builds the Spy Satellite's four. Both
    // are ordinary registry members, so they arrive here like any other.
    if (!nativeStage(stageId) && fireAnnotator(stageId, id)) return true;
    // The six-slot display ensembles (engine/systems/stage-slot-ensemble.ts):
    // one object claims a RUN of six tags in the field's own display chain and
    // gives each slot its own picture or clip run. SETANIM with the member's
    // sub-command (857) is the original's configure handler, so a live object
    // is configured rather than rebuilt and the sub-operand goes through here.
    const wall = ensembleFor(ensemblesFor(stageId), id);
    if (wall) {
        if (nativeStage(stageId)) return true;
        const list = (ensembleLive[stageId] ??= []);
        let obj = list.find((o) => o.id === id);
        if (obj) {
            configureEnsemble(obj, wall, sub ?? -1);
        } else {
            const chain = ensembleChainNow(stageId);
            if (chain) {
                list.push(createEnsemble(wall, chain));
            } else {
                // The chain has not arrived; claim when it does. The object is
                // the original's either way -- it cannot exist without the slots.
                void ensureEnsembleChain(stageId).then((late) => {
                    if (!late || nativeStage(stageId)) return;
                    if (!list.some((o) => o.id === id)) list.push(createEnsemble(wall, late));
                });
            }
        }
        return true;
    }
    const cfg = configFor(stageId);
    if (!cfg) return false;
    const slot = fallingObjectSlot(cfg, id);
    if (slot === null) return false;
    const list = (live[stageId] ??= []);
    if (list.some((o) => o.id === id)) return true;
    const obj = createFallingObject(cfg, id, slot);
    if (!obj) return false;
    list.push(obj);
    return true;
}

/**
 * The street screens are built by their own tick (the original's street entry
 * calls the registry ctor on its first tick), so they are owned here whenever
 * the translated route owns the stage. Under ?nativeStages the interpreter runs
 * the original driver and publishes its own quads, and this one stands down.
 */
export function streetScreensActive(stageId) {
    return !nativeStage(stageId);
}

/** Per-frame: advance every live actor. Call once, before the draw passes. */
export function tickStageObjects(stageId, delta = 1, camX = 0, camY = 0) {
    // The street cars, the street screens and the pad halos count the same blanks as the rocks.
    tickStreetVehicles(stageId, delta);
    if (streetScreensActive(stageId)) tickStreetScreens(stageId, delta);
    // The point-record actors: one script step per PAL blank, and their writes
    // go straight into the point records the renderer draws from.
    tickPointRecordStageObjects(stageId, delta);
    // The stinger is its own object, counted the same way.
    if (!nativeStage(stageId)) tickStingerPopup(stageId, delta);
    // The traffic-light corner exists only at the later story beat: the overlay's
    // street entry builds it when the master ordinal is 0x1B, and the walker's
    // flag 0x601B is that same beat, so ask the ordinal here rather than
    // inventing a second trigger.
    if (
        !nativeStage(stageId) &&
        fireStreetLights(stageId, readOrdinal(), poleRecords?.(stageId))
    ) {
        claimPoles(stageId);
    }
    if (!nativeStage(stageId)) tickStreetLights(stageId, delta);
    // The display-slot chain needs the stage's point-sprite records, which load
    // beside the other tables; ask for them the first time a slot player lives.
    if (slotLive[stageId]?.length && slotChains[stageId] === undefined) {
        void chainRecords(stageId).then((recs) => {
            slotChains[stageId] = recs.length ? recs : null;
        });
    }
    // The fixed still sprites: two layers over one pinned map point, and the
    // visibility box is the camera's, so this one needs the scroll position.
    const members = fixedFor(stageId);
    const sprites = fixedLive[stageId];
    if (members && sprites?.length) {
        for (const o of sprites) {
            const m = fixedSpriteFor(members, o.id);
            if (m) o.jobs = tickFixedSprite(o, m, delta, camX, camY);
        }
    }
    // The display ensembles write into the same chain the renderer reads, so
    // their patches go through the same writer the slot players use.
    for (const o of ensembleLive[stageId] ?? []) {
        const m = ensembleFor(ensemblesFor(stageId), o.id);
        if (!m) continue;
        tickEnsemble(o, m, delta, (slot, patch) => {
            const rec = o.recs[slot];
            if (rec >= 0) setPointSlot(stageId, rec, patch);
        });
    }
    const chain = slotChains[stageId];
    for (const o of slotLive[stageId] ?? []) {
        const m = slotPlayerFor(slotsFor(stageId), o.id);
        if (!m || !chain) continue;
        const r = tickSlotPlayer(o, m, chain, delta);
        if (r.stopSound !== null) soundFor(stageId)(r.stopSound);
        if (o.rec >= 0) setPointSlot(stageId, o.rec, { active: o.active, sprite: o.clip });
    }
    tickAnnotator(stageId, delta);
    const cfg = configFor(stageId);
    const rocks = live[stageId];
    if (!cfg || !rocks?.length) return;
    const sound = soundFor(stageId);
    for (const o of rocks) tickFallingObject(o, cfg, delta, sound);
}

/**
 * One browser frame of the stage's own actors: one `tickStageObjects` call per
 * PAL blank in `deltas`, the list web/native-stage.js advanceFieldBlanks()
 * returned for this frame (the render loop reads it once and hands the same
 * list to the native stage runtime). Returns the number of blanks run.
 */
export function paceStageObjects(stageId, deltas, camX = 0, camY = 0) {
    for (const delta of deltas) tickStageObjects(stageId, delta, camX, camY);
    return deltas.length;
}

/** This frame's draw entries: {id, clip, x, y} for each rock still falling. */
export function stageObjectDraws(stageId) {
    const out = [];
    const list = live[stageId];
    if (list?.length) out.push(...fallingObjectDraws(list));
    for (const o of fixedLive[stageId] ?? []) out.push(...(o.jobs ?? []));
    // The `picture-steps` member's own pictures (s785's 0x327): {clip, x, y}
    // entries the same `drawStageObjectSprites` pass resolves against the
    // stage's sheet.
    out.push(...pictureStepActorDraws(stageId));
    return out;
}

/**
 * This frame's wall/column screen quads (engine/systems/street-screens.ts). The
 * driver builds itself on the first tick, so an ordinary visit to the street
 * corner already carries them; the A.O.A announcement's SETANIM 801 802 is what
 * moves them onto the news tiles.
 */
export function streetScreenQuads(stageId) {
    if (!streetScreensActive(stageId)) return [];
    return streetScreenDraws(stageId);
}

/** Live actor list for a stage (tests and the native screen lab read this). */
export function liveStageObjects(stageId) {
    return live[stageId] ?? [];
}

/**
 * Force one id down the MIPS interpreter's registry route instead
 * (`?nativeStages` research path). Only the rockfall oracle uses this, to run
 * the original machine code and the translated port side by side; the game
 * itself never calls it, so the two routes cannot both own an id in play.
 */
export function fireNativeStageObject(stageId, id) {
    return fireNativeEffect(id, 821, id);
}

/** Drop every actor on a stage — on stage change, and when a test resets. */
export function clearStageObjects(stageId) {
    clearStreetVehicles(stageId);
    clearStreetScreens(stageId);
    clearPointRecordStageObjects(stageId);
    clearStreetLights(stageId);
    clearStingerPopup(stageId);
    clearPointSlots(stageId);
    if (stageId === undefined) {
        for (const k of Object.keys(claimed)) delete claimed[k];
    } else {
        delete claimed[stageId];
    }
    if (stageId === undefined) {
        for (const k of Object.keys(live)) delete live[k];
        for (const k of Object.keys(fixedLive)) delete fixedLive[k];
        for (const k of Object.keys(slotLive)) delete slotLive[k];
        for (const k of Object.keys(slotChains)) delete slotChains[k];
        for (const k of Object.keys(annotators)) delete annotators[k];
        for (const k of Object.keys(ensembleLive)) delete ensembleLive[k];
        for (const k of Object.keys(ensembleChains)) delete ensembleChains[k];
    } else {
        delete live[stageId];
        delete fixedLive[stageId];
        delete slotLive[stageId];
        delete slotChains[stageId];
        delete annotators[stageId];
        delete ensembleLive[stageId];
        delete ensembleChains[stageId];
    }
}

/**
 * The two stage users of the resident 2D draw-context service. One member each:
 * s805's 0x349 (841) is the twenty-seven-marker ring the delay walk lights, and
 * s820's 0x34d (845) is the Spy Satellite's four markers. The layer the
 * service hands back is positioned from the field's own camera words, so the
 * markers move with the view exactly as the layer's `+0x128` rect says.
 *
 * Each request carries the shape id and CLUT row the shape routine hands the
 * emitter, the position, the stage's own sprite directory, and the rectangles
 * the emitter reads out of it. `web/effects.js drawAnnotatorShapes` draws those
 * rectangles from the same per-stage sheet the scenery and the launch pads use.
 * Decode: docs/research/field/draw-context-service-2026-10-04.md
 */
export function setAnnotatorRandom(fn) {
    annotatorRandom = fn ?? (() => 1);
}

function annotatorLayer(stageId) {
    // The layer the service owns is sized by the stage, not by the screen: its
    // cull is a rectangle test against the layer's own window, so a 320x240 one
    // would hide every marker. The bounds come from the member's own children.
    const key = String(stageId).replace(/^s/, "");
    const box = annotatorLayerBounds(key);
    return layerForField(box.x, box.y, box.w, box.h, box.x, box.y, 0, 0);
}

function fireAnnotator(stageId, id) {
    const key = String(stageId).replace(/^s/, "");
    const member = ANNOTATOR_PORTED_MEMBERS.find((m) => m.stage === key && m.id === id);
    if (!member) return false;
    if (annotators[stageId]) return true;
    const layer = annotatorLayer(stageId);
    annotators[stageId] = member.id === 841 ? createS805Annotator(layer) : createS820Annotator(layer);
    return true;
}

function tickAnnotator(stageId, delta = 1) {
    const run = annotators[stageId];
    if (!run) return;
    if (run.config.delay) {
        // The delay walk adds a resident random of 0..4 a blank; the walker runs
        // one tick per PAL blank, so that random is drawn once per blank here.
        for (let i = 0; i < Math.max(1, delta); i += 1) {
            tickS805Annotator(run, Math.floor(annotatorRandom() * 5));
        }
    } else {
        for (let i = 0; i < Math.max(1, delta); i += 1) {
            tickS820Annotator(run, Math.floor(annotatorRandom() * 5));
        }
    }
    // The service's flush empties its list, so the flush happens here on the
    // blank and the draw pass reads what it produced. Reading it twice would
    // return nothing the second time, which is exactly as on the disc.
    run.marks = annotatorDraws(run, annotatorShapeSet(stageId));
}

/**
 * The sprite directory this stage's shapes live in: the decoded member 0 of the
 * stage's own TMPK pack (engine/dw3/annotator-shapes.ts). Null for a stage that
 * is not one of the family's, which is how the draw pass knows to draw nothing.
 */
export function annotatorShapeSet(stageId) {
    return annotatorShapeSetFor(String(stageId)) ??
        annotatorShapeSetFor(String(stageId).replace(/^s/, "")) ?? null;
}

/**
 * This blank's shape requests, in the order the service's flush hands them over
 * (descending y, first-in wins on a tie). Each names the shape id, the CLUT row,
 * the position, the directory and the shape's rectangles.
 */
export function annotatorMarkers(stageId) {
    return annotators[stageId]?.marks ?? [];
}

/** True when this stage's annotator is live, so the draw pass asks for it. */
export function annotatorActive(stageId) {
    return !!annotators[stageId] && !nativeStage(stageId);
}

/** The directory's own header words, for the debug dump and the check. */
function shapeSetMeta(set) {
    if (!set) return null;
    return {
        resource: set.resource, frames: set.frames, members: set.members,
        bytes: set.bytes, ids: set.ids.length,
    };
}

/**
 * The field's stage ambience, as the ordinary route runs it: OUR translated
 * code. This is the adapter's own statement of its execution mode, the same
 * mark every converted screen carries (web/shop-translated.js,
 * web/lab-translated.js). The original overlay's ambience runs only under the
 * explicit ?nativeStages research route, so `nativeOverlay` is false with no
 * flag; tools/verify_translated_field_ambience.mjs refuses any other mark and
 * aborts every assets/native/** request, and
 * tests/stage-ambience-execution-forbidden.test.js bundles the engine modules
 * below it and requires them to reach no interpreter.
 *
 * The actors themselves: engine/systems/point-record-actor.ts (the ambient
 * decorations and the stage-owned registry members, built in web/effects.js
 * prepareEffects and ticked by tickStageObjects) and the sibling stage-object
 * modules (falling-object, street-vehicles, street-screens, street-lights,
 * stinger-popup, stage-fixed-sprite, stage-slot-player, stage-slot-ensemble,
 * shape-annotator, draw-context, field-character).
 */
export const STAGE_AMBIENCE_EXECUTION = "translated";

/** Debug/diagnostics: `window.__stageAmbience.diagnostics(mapId)`. */
export function stageAmbienceDiagnostics(stageId) {
    return {
        execution: "translated",
        stage: stageId ?? null,
        // True only on the explicit research route; with no flag the ordinary
        // route never boots the overlay, so the translated actors own the stage.
        nativeOverlay: stageId ? nativeStage(stageId) !== null : false,
        loaded: configs !== null,
    };
}

/** Debug/state dump for `window.__stageObjects`. */
export function stageObjectState(stageId) {
    const cfg = configFor(stageId);
    return {
        stage: stageId ?? null,
        loaded: configs !== null,
        hasConfig: !!cfg,
        objects: (live[stageId] ?? []).map((o) => ({
            id: o.id, slot: o.slot, state: o.state, clip: o.clip, x: o.x, y: o.y,
            bounced: o.bounced,
        })),
        cars: streetVehicleDraws(stageId),
        props: streetPropDraws(stageId),
        glows: streetGlowDraws(stageId),
        stinger: stingerPopupState(stageId),
        slotsLoaded: slots !== null,
        slotChain: (slotChains[stageId] ?? []).length,
        slotPlayers: (slotLive[stageId] ?? []).map((o) => ({
            id: o.id, state: o.state, counter: o.counter, rec: o.rec,
            active: o.active, clip: o.clip, ended: o.ended,
            soundHandle: o.soundHandle,
        })),
        ensemblesLoaded: ensembles !== null,
        ensembles: (ensembleLive[stageId] ?? []).map((o) => ({
            id: o.id, mode: o.mode, phase: o.phase, done: o.done,
            recs: o.recs.slice(),
            clips: (o.recs ?? []).map((rec, i) => ({
                rec, active: o.last[i]?.active ?? null,
                sprite: o.last[i]?.sprite ?? null, ctr: o.last[i]?.ctr ?? null,
            })),
        })),
        fixedLoaded: fixed !== null,
        fixedSprites: (fixedLive[stageId] ?? []).map((o) => ({
            id: o.id, state: o.state, x: o.x, y: o.y, baseClip: o.baseClip,
            frontClip: o.frontClip, ctr: o.ctr, burstClip: o.burstClip,
            ended: o.ended, jobs: (o.jobs ?? []).length,
        })),
        annotator: annotators[stageId]
            ? {
                stage: annotators[stageId].config.stage,
                children: annotators[stageId].states.length,
                hold: annotators[stageId].hold ?? null,
                index: annotators[stageId].index ?? null,
                done: annotators[stageId].done ?? false,
                shapeSet: shapeSetMeta(annotatorShapeSet(stageId)),
                shapes: (annotators[stageId].marks ?? []).map((m) => ({
                    pass: m.pass, shape: m.shape, clutRow: m.clutRow, x: m.x, y: m.y,
                    key: m.key, rects: m.clip ? m.clip.layers.length : 0,
                })),
            }
            : null,
    };
}