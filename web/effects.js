// Ambient point-sprite decorations — windmills, fans, torches, walk-behind
// props. The real per-stage system decoded in
// docs/research/field/point-sprite-ambient-system.md: 18-byte placement
// records embedded in each stage's wstag overlay (descriptor+0x10), rendered
// on PS1 by fieldstg F0x80089038. Data extracted by
// tools/extract_point_sprites.py -> assets/data/point_sprites.json +
// assets/effects/sNNN.png sheets.
//
// Faithful bits: per-frame timer = period<<8 decremented 0x100/frame (so the
// sprite advances every `period` rendered frames); mode 1 loops the sprite id
// min..max (the windmill spin). Modes 2/3 animate the ctr byte, which the PS1
// draw ADDS TO THE CLUT ROW (spA0(ctr) in F0x80089038 → F0x8001ed6c) — real
// palette-row cycling, the torch flicker. The extractor pre-cuts those
// palette variants as "sid@ctr" sprites; mode 2 loops ctr min..max, mode 3
// ping-pongs it (direction bit 0x8000 in the timer word on PS1). A missing
// variant falls back to the base sprite. Records with atlas "fieldcom" draw a
// FIELDCOM.BIN dir-0 clip at the record's raw (x,y) — the decompile's
// -(0x32,0x64) adjustment feeds only its camera-culling test (a wider
// off-screen margin for big sprites), NOT the draw position (user-verified:
// applying it at draw time put the palm trees ~(50,100) off).

// Native rebase: on stages whose original MIPS ambience code runs in the
// interpreter (web/native-stage.js), the point records ALSO live in overlay
// memory — native code pokes active/spriteId/ctr there (the s780 traffic
// lights). For those stages, mode-0 records read their state back from
// interpreter memory each frame; generically-animated records (modes 1-3)
// keep the JS tick (that's fieldstg F0x80089038's job on PS1, not the
// overlay's). Native draw intents (the cars) render via drawNativeIntents.

// THE point-record actors: all twenty-one field stage objects that claim their own
// stage's INACTIVE point-sprite records by their atlas byte and animate them --
// the Asuka City download halos (s212's 815/826/827 = the three download pads,
// s225's 838 = the login pad), the login flash on s225/s750/s925, the Kusanagi
// City and Undersea Base decor, the s805/s810/s820 picture drivers, and the two
// in-place shapes (s455's lit shrine row, s926's sliding row) and the two-slot
// writer on s261.  All twenty-one are ONE module (engine/systems/
// point-record-actor.ts) fed by ONE table (assets/data/
// point_record_actors.json, mined from the overlays by
// tools/extract_point_record_actors.py); `pointRecordHost` below is the ONE
// place their writes land, so the ordinary point renderer draws them with no
// second path.  The pad-flash arm also moves its three claimed records onto the
// pad the SETANIM operand names (X = padX, Y/ysort = padY + per-slot signed
// offsets), which is why the host records a position patch.

import { drawFieldcomIcon, fieldcomReady } from "./fieldcom.js";
import { nativeStage } from "./native-stage.js";
import { loadAssetImage } from "./assets.js";
import {
    pushComposite,
    IN_FRONT_OF_ENTITIES,
    BEHIND_ENTITIES,
    UNDER_MAP_BUCKET,
} from "./draw-order.js";
import {
    PAD_IDLE_SCRIPT,
    advancePadScript,
    newPadCursor,
    streetVehicleDraws,
    streetPropDraws,
    clearStreetVehicles,
    streetScreenDraws,
    clearPointRecordActors,
    loadPointRecordActors,
    loadChildPoolParents,
    fireChildPoolParent,
    constructPointRecordActors,
    firePointRecordActor,
    tickPointRecordActors,
    pointRecordActorState,
    pointRecordPadRun,
    pointRecordLive,
    pointRecordInView,
    tickPointSpriteRecords,
    applyPointModeGates,
    pointModeGatesFor,
    pictureStepDraws as enginePictureStepDraws,
    loadScrollLayers,
    setScrollLayerFlag,
    scrollLayerDraws as engineScrollLayerDraws,
    setPointRecordActorSound as setEnginePointRecordActorSound,
    setPointRecordActorMusic as setEnginePointRecordActorMusic,
    fieldCharY,
    fieldCharSetY,
    streetGlowDraws,
    streetLightWrites,
    stingerPopupDraws,
} from "./vendor/engine.js";
import { setStageObjectPoleRecords } from "./stage-objects.js";
import { sceneVariantSlotIndex, sceneVariantSlotActive } from "./ordinal-scene-variant.js";

let data = null; // point_sprites.json (null until loaded)
let overlayShapeData = null; // stage_overlay_shapes.json -- the overlay shape tables
let padData = null; // launch_pads.json
let actorData = null; // point_record_actors.json -- the ONE table
let parentData = null; // child_pool_parents.json -- the child-array parents
let playStageSound = null; // (packedWord) => void, wired once by the game loop
const sheets = {}; // stageId -> Image | "loading"
const sheetPromises = {}; // stageId -> in-flight load
const semiSheets = {}; // stageId -> Image | null | "loading" (STP texels only)
const semiSheetPromises = {}; // stageId -> in-flight load
const runtime = {}; // stageId -> [{sprite, timer}] parallel to records
// The traffic-light writer reads two bytes of each record: byte+1 is the pole
// type and byte+2 ends its walk when it is zero. The extractor carries byte+1 as
// `atlasFlag` and byte+2 as the record's texture `size`, so those are the names
// the engine gets. Registered once, here, because this module owns the table.
setStageObjectPoleRecords((stageId) => {
    const s = data?.[stageId];
    if (!s) return null;
    return s.records.map((r) => ({ type: r.atlasFlag, size: r.size }));
});
// Translated display-slot writers (engine/systems/stage-slot-player.ts): a
// stage object that owns a point record writes its live flag and sprite here,
// and `prepareEffects` reads the same arrays the interpreter bridge fills.
const slotWrites = {}; // stageId -> Map<recordIndex, {active, sprite}>
// The map setup's display-slot variant flag (fieldstg F0x80084B40): at every
// stage setup the walker writes the FIRST chain record whose tag byte (+1) is 1
// — the walk engine/systems/ordinal-scene-variant.ts `sceneVariantSlotIndex`
// ports — to 1 on the sixteen variant story beats and 0 otherwise. Written once
// per stage, at the point the original's own setup runs, so a per-frame stage
// actor (a slot player, a street light) still overrides it. stageId -> the
// ordinal already applied.
const variantSlotApplied = new Map();
// The master story ordinal, handed over by the game loop.  See
// `setPointRecordOrdinal` for why it is not read out of the story engine here.
let readOrdinal = () => 0;
// The flag reader, handed over by the game loop beside the ordinal (the same
// store `setPointRecordFlag` forwards to the engine's scroll layers).  The
// stage-entry mode gates (s421's windmill actor) read it.
let readFlag = null;
// The character anchor the `picture-steps` machine draws at, wired once by the
// game loop: `(stageId, type, p1, p2) -> live actor | null` and
// `(actor) -> {x, y} | null`.  See `setPointRecordAnchor`.
let anchorFind = null;
let anchorPos = null;

export async function loadPointSprites() {
    [data, actorData, padData, parentData, overlayShapeData] = await Promise.all([
        (await fetch("assets/data/point_sprites.json")).json(),
        (await fetch("assets/data/point_record_actors.json")).json(),
        (await fetch("assets/data/launch_pads.json")).json(),
        (await fetch("assets/data/child_pool_parents.json")).json(),
        // The stage overlays' per-frame shape tables (the second producer of an
        // over/under-entity drawable besides the point record and the map
        // foreground). Absent file -> an empty map, and no stage runs it.
        (await fetch("assets/data/stage_overlay_shapes.json"))
            .json()
            .catch(() => ({})),
    ]);
    if (actorData) loadPointRecordActors(actorData);
    // The child-pool parents (s545's `0x350`) are the SAME machine with a child
    // array, so they arrive beside the other point-record members rather than as
    // a second renderer.
    if (parentData) loadChildPoolParents(parentData);
    // The s415 Deeper Crevice scenery layer (engine/systems/point-record-actor.ts
    // `scroll-layer`): the SAME registry and tick loop, a different machine.  It
    // is a stage-built member, so it must be in the table before the stage's
    // first `prepareEffects` constructs it.  Absent file -> no scenery layers.
    try {
        const s = await (await fetch("assets/data/scroll_layers.json")).json();
        if (s?.stages) loadScrollLayers(s);
    } catch {
        /* no scroll-layer table: stages simply have no scenery layer */
    }
}

/**
 * The stage overlays' own point-record actors, on the SETANIM >= 0x320 path.
 * ONE module (engine/systems/point-record-actor.ts) carries all seventeen of
 * them: the Asuka City download halos, the login flash, the Kusanagi City and
 * Undersea Base decor, the s805/s810/s820 picture drivers and the two in-place
 * shapes.  Each claims the
 * point table's atlas-tagged records and drives their active/spriteId/ctr
 * bytes, and here those writes land in the one runtime the point renderer
 * already draws from.  Returns true when the id was claimed, so
 * web/stage-objects.js skips the generic bubble.
 */
export function firePointRecordStageObject(stageId, id, sub) {
    if (actorData && firePointRecordActor(stageId, id, sub)) return true;
    if (parentData && fireChildPoolParent(stageId, id, sub)) return true;
    return false;
}

/**
 * Build the actors the stage creates for ITSELF at stage entry -- their
 * registry record has a null constructor, so they exist from the moment the
 * room loads (s795's 836 and s800's 837 already pulse).
 *
 * `ordinal` is the master story ordinal `[0x8004b370]`.  The two `triple`
 * parents are the gated kind: each owning stage builds its own parent at load
 * ONLY while the ordinal is below that stage's own bound (15 for s460's 830,
 * 30 for s526's 829), because the build sits behind one `slti` and the `beqz`
 * after it.  At or above the bound the stage builds nothing and the SETANIM
 * event constructs the parent itself -- unbuilt, and it draws nothing.
 */
export function constructPointRecordStageObjects(stageId, ordinal = 0) {
    return constructPointRecordActors(stageId, ordinal);
}

/**
 * The master story ordinal, wired once by the game loop beside
 * `setStageObjectOrdinal`.  `stage-objects.js` cannot be imported here (it
 * imports this module), so the same number is handed over twice rather than a
 * second copy of it being read out of the story engine.
 */
export function setPointRecordOrdinal(fn) {
    readOrdinal = typeof fn === "function" ? fn : () => 0;
}

/**
 * The character-anchor wiring for the `picture-steps` machine: the find the
 * overlay makes (`find(5, operand, -1)`) and the position read of what it
 * found.  web/game.js owns both because it owns the live cast; a game with no
 * wiring draws no anchored pictures rather than inventing a position.
 */
export function setPointRecordAnchor(find, position) {
    anchorFind = typeof find === "function" ? find : null;
    anchorPos = typeof position === "function" ? position : null;
}

/** The engine's packed-sound sink for these actors' own sounds. */
export function setPointRecordActorSound(fn) {
    playStageSound = fn;
    // Two channels, one sink. `playStageSound` above carries the cues a TICK
    // plays, because the tick is handed a per-stage host; the cues an actor
    // plays at build, fire or `single` time are played before any host exists,
    // so the module keeps its own sink for them (engine/systems/point-record-
    // actor.ts `setPointRecordActorSound`). Both were meant to be wired here:
    // without the second call the sink stayed null and s455's shrine cue, s805's
    // panel cue and s820's cue were silent in ordinary play while every unit
    // test passed, because the tests wire the engine's setter directly.
    setEnginePointRecordActorSound(fn);
}

/**
 * The engine's music-stem sink.  The pad flashes' cues (env205 digi_en0..2,
 * env011 login_dl) are sequenced music pieces, not samples, so web/game.js
 * hands them to the jingle player; the actor plays them at its own fire
 * (wstag212.s file 0x3e8-0x408 plays the slot's table word on every configure),
 * and this module only forwards the wiring.
 */
export function setPointRecordActorMusic(fn) {
    setEnginePointRecordActorMusic(fn);
}

/** Debug dump for `window.__pointRecordActors`. */
export function pointRecordActors(stageId) {
    return pointRecordActorState(stageId);
}

/**
 * Debug-only: what the stage's point records are showing right now, so a
 * headless verifier can read the frames a decor driver put there (the same rows
 * `eachRecord` paints from).
 */
export function pointSpriteProbe(stageId) {
    const s = data?.[stageId];
    if (!s) return [];
    const rt = stageRuntime(stageId, s.records);
    return rt.map((st, i) => ({
        index: i,
        atlasFlag: s.records[i].atlasFlag,
        active: st.active ?? s.records[i].active,
        sprite: st.sprite,
        ctr: st.ctr,
        x: st.x ?? s.records[i].x,
        y: st.y ?? s.records[i].y,
        ysort: st.ysort ?? s.records[i].ysort,
        drawn: Boolean(st.sprite in s.sprites || st.sprite in (s.sprites ?? {})),
    }));
}

/**
 * The packed id the original plays at the moment pad `cmd` fires, as the
 * "0x..." string form the jingle table is keyed by ("0x010c0000" = DIGI_EN0 on
 * s212's first download pad, "0x00cc0001" = env011 seq 1 on s225's login pad),
 * or null when no pad flash is running.  Sound only: the flash itself is armed
 * through web/stage-objects.js on the SETANIM registry route, so asking here
 * cannot start it twice.
 */
export function padRunSound(stageId) {
    return pointRecordPadRun(stageId)?.sound ?? null;
}

// Tree kicking (engine/systems/tree-kick.ts). The type-0x0B tree manager owns
// the FIELDCOM point records on the stage: every frame it writes the resting
// sprite 0x38 into all of them and the current shake-script cell into the one
// being kicked (fieldstg file 0x9f50-0x9fc0). Here that is one poke into the
// same runtime slot the point renderer draws from, so the kicked palm animates
// in place with no second renderer.
export function setPointSprite(stageId, recIndex, spriteId) {
    const s = data?.[stageId];
    if (!s || !s.records[recIndex]) return;
    stageRuntime(stageId, s.records)[recIndex].sprite = spriteId;
}

/** The record-position patches the pad-flash arm asked for this frame. */
const actorPositions = {}; // stageId -> { recordIndex: {x, y, ysort} }

/**
 * The host engine/systems/point-record-actor.ts drives: the three record bytes
 * the original writes (`active` +0, `spriteId` +4, `ctr` +9), the X halfword at
 * +0xc that s790's slide adds to, and the pad position the pad-flash arm
 * moves its three records onto -- plus a read side, because s790's reveal waits
 * on a record's live `ctr`.
 */
function pointRecordHost(stageId, records) {
    const rt = stageRuntime(stageId, records);
    return {
        write(index, patch) {
            const st = rt[index];
            if (!st) return;
            if (patch.active !== undefined) st.active = patch.active;
            if (patch.sprite !== undefined) st.sprite = patch.sprite;
            if (patch.ctr !== undefined) st.ctr = patch.ctr;
            if (patch.x !== undefined) st.x = patch.x;
            if (patch.y !== undefined) st.y = patch.y;
            if (patch.ysort !== undefined) st.ysort = patch.ysort;
            if (patch.y !== undefined || patch.ysort !== undefined) {
                (actorPositions[stageId] ??= {})[String(index)] = {
                    x: st.x, y: patch.y, ysort: patch.ysort,
                };
            }
        },
        read(index) {
            const st = rt[index];
            const rec = records[index];
            return {
                sprite: st?.sprite ?? 0,
                ctr: st?.ctr ?? 0,
                x: st?.x ?? rec?.x ?? 0,
                y: st?.y ?? rec?.y ?? 0,
                ysort: st?.ysort ?? rec?.ysort ?? 0,
            };
        },
        sound(packed) {
            playStageSound?.(packed, stageId);
        },
        // THE LIVE FIELD CHARACTER.  Three of these members write the world Y of
        // fieldstg's resident object registered as NAME 5 -- s926's rising row a
        // pixel a blank, s680's sub-891 drive, and s261's own six clips -- and
        // that word is the player's own position in 16.8 (see
        // engine/systems/field-character.ts).  The engine module owns the fixed
        // point; web/game.js folds the whole-pixel part into `state.y` once per
        // frame before the camera reads it, which is where the original's own
        // `+0x5c` split happens.
        charY() {
            return fieldCharY();
        },
        setCharY(fixed) {
            fieldCharSetY(fixed);
        },
        // THE CHARACTER ANCHOR.  The `picture-steps` member (s785's 0x327)
        // draws its pictures where the character the script's operand names is:
        // the overlay's own `find(5, operand, -1)` -- [0x8004b7bc] = EXE
        // F0x8001810c, the hundred-slot pool walk (wstag785 file 0x7f4-0x814).
        // The find and the position read are wired together from web/game.js
        // (`setPointRecordAnchor`), because only the game loop knows the live
        // cast: the find hands back the actor it found and the position call
        // re-reads its world pixels every blank, exactly as the original reads
        // the stored object's `+0x50`/`+0x54` at draw time.
        anchor(type, p1, p2) {
            return anchorFind?.(stageId, type, p1, p2) ?? null;
        },
        anchorPos(handle) {
            return anchorPos?.(handle) ?? null;
        },
    };
}

/** The stage's point-sprite records, for an actor claiming them by atlas byte. */
export function pointSpriteRecords(stageId) {
    return data?.[stageId]?.records ?? null;
}

/**
 * Advance every live actor on this stage one PAL blank.  Called from
 * web/stage-objects.js, which owns the blank clock -- the same clock the
 * falling rocks and the street cars use, so a script's hold counts blanks
 * exactly as it did on the console.
 */
export function tickPointRecordStageObjects(stageId, delta = 1) {
    const records = pointSpriteRecords(stageId);
    if (!actorData || !records) return 0;
    return tickPointRecordActors(stageId, pointRecordHost(stageId, records), delta);
}

/**
 * The pictures the stage's `picture-steps` member (s785's 0x327) drew this
 * blank, as the stage-object draw pass reads them: `{clip, x, y}` -- `clip` is
 * an id in the stage's own sprite directory and `y` already carries the draw
 * helper's `-0x18`, so the existing `drawStageObjectSprites` path resolves it
 * against the same sheet everything else draws from.
 */
export function pictureStepDraws(stageId) {
    return enginePictureStepDraws(stageId).map((d) => ({
        clip: d.pic, x: d.x, y: d.y,
    }));
}

// ── the s415 Deeper Crevice scenery layer (its own sheet) ──────────────────
//
// The engine computes WHERE the layer sits; the SHEET is cut by
// tools/extract_scroll_layers.py and its tiles are already placed, so one frame
// is two blits of the same 512x768 strip: at (x, y) and at (x, y + 0x100).  The
// strip is the stage's own background art (the rock wall with its pipes, rails
// and struts), and it belongs to a fixed-viewport stage, so it draws in SCREEN
// coordinates.
const scrollSheets = {}; // sheet path -> Image | null

function ensureScrollSheet(rel) {
    if (rel in scrollSheets) return scrollSheets[rel];
    loadAssetImage(`assets/effects/${rel}`)
        .then((img) => (scrollSheets[rel] = img))
        .catch(() => (scrollSheets[rel] = null));
    scrollSheets[rel] = null; // in flight; next frame
    return null;
}

/**
 * The story-flag reader the scenery layer's visit gate uses.  Wired once by the
 * game loop to the SAME flag store every other gate reads, so the layer takes a
 * first visit / revisit branch exactly as the disc's scene entry does.
 */
export function setPointRecordFlag(fn) {
    readFlag = typeof fn === "function" ? fn : null;
    setScrollLayerFlag(typeof fn === "function" ? (id) => (fn(id) ? 1 : 0) : null);
}

/** The live scenery layer's position this blank, for the debug hook/verifier. */
export function scrollLayerEntries(stageId) {
    return engineScrollLayerDraws(stageId);
}

/**
 * Draw the stage's scenery layer(s): the stage's OWN sliding backdrop.  Screen
 * coordinates, drawn over the base backdrop and under the props/entities so the
 * platform and the point sprites stay in front of it.
 */
export function drawScrollLayers(ctx, stageId) {
    for (const d of engineScrollLayerDraws(stageId)) {
        const img = scrollSheets[d.sheet] ?? ensureScrollSheet(d.sheet);
        if (!(img instanceof Image)) continue;
        ctx.drawImage(img, d.x, d.y);
        ctx.drawImage(img, d.x, d.y + d.wrapY);
    }
}

/** Drop every actor on a stage (or everywhere) -- on a stage change, and by tests. */
export function clearPointRecordStageObjects(stageId) {
    clearPointRecordActors(stageId);
    delete actorPositions[stageId];
}

/**
 * Dev-only read of what the point renderer would draw for this stage's records
 * this frame: the live sprite id and palette row per record, and whether the
 * record is drawing.  A headless verifier reads the pulse straight out of this
 * instead of inferring a clip cycle from averaged canvas pixels, which cannot
 * tell one script from another.
 */
export function pointRecordProbe(stageId) {
    const records = data?.[stageId]?.records;
    if (!records) return null;
    const rt = stageRuntime(stageId, records);
    return {
        records: records.map((r, i) => ({
            i,
            atlasFlag: r.atlasFlag,
            at: [r.x, r.y],
            // where the record is drawn from, which a pad flash has moved
            x: rt[i].x ?? r.x,
            y: rt[i].y ?? r.y,
            ysort: rt[i].ysort ?? r.ysort,
            // The record's own ROM byte until an actor writes over it, so a
            // record the original never touches reads dark here.
            active: rt[i].active ?? r.active,
            sprite: rt[i].sprite,
            ctr: rt[i].ctr,
        })),
    };
}

/**
 * Write one display slot from translated code — the writer half of the chain the
 * interpreter bridge already fills from `native.pointTable`. `sprite` is the
 * record's +4 sprite and `active` its +0 live flag; either may be omitted to
 * leave that field to whatever else owns the record this frame. Absent a write
 * the record renders exactly as before, so a member that never fires changes
 * nothing.
 */
export function setPointSlot(stageId, recIndex, patch) {
    if (!(recIndex >= 0)) return;
    let m = slotWrites[stageId];
    if (!m) m = slotWrites[stageId] = new Map();
    const cur = m.get(recIndex) ?? {};
    if (patch.active !== undefined) cur.active = patch.active;
    if (patch.sprite !== undefined) cur.sprite = patch.sprite;
    if (patch.ctr !== undefined) cur.ctr = patch.ctr;
    m.set(recIndex, cur);
}

/** Drop every translated slot write for a stage (or all stages). */
export function clearPointSlots(stageId) {
    if (stageId === undefined) {
        for (const k of Object.keys(slotWrites)) delete slotWrites[k];
    } else {
        delete slotWrites[stageId];
    }
}

function ensureSheet(stageId) {
    if (sheets[stageId]) return sheets[stageId];
    sheets[stageId] = "loading";
    sheetPromises[stageId] = loadAssetImage(`assets/effects/${stageId}.png`)
        .then((img) => (sheets[stageId] = img))
        .catch(() => (sheets[stageId] = null))
        .finally(() => delete sheetPromises[stageId]);
    return "loading";
}

// The blended half of a stage's sprites: every texel whose CLUT entry has the
// STP bit, over the same rect as its plain layer. Drawn under the clip's ABR
// mode by drawSprite; stages with none (hasSemi false) never fetch.
function ensureSemiSheet(stageId) {
    if (stageId in semiSheets) return semiSheets[stageId];
    if (!data?.[stageId]?.hasSemi) {
        semiSheets[stageId] = null;
        return null;
    }
    semiSheets[stageId] = "loading";
    semiSheetPromises[stageId] = loadAssetImage(`assets/effects/${stageId}_semi.png`)
        .then((img) => (semiSheets[stageId] = img))
        .catch(() => (semiSheets[stageId] = null))
        .finally(() => delete semiSheetPromises[stageId]);
    return "loading";
}

// Baked screen-texture pages (tools/extract_screen_pages.py): the wall screens
// are 40 textured quads the stage's own code submits straight to the GPU, so
// they never appear as point records or sprite ids. The interpreter captures
// the quads (engine/native/runtime.ts screenQuads); these pages give them
// pixels. Keyed per stage, fetched lazily; absence just means no quads drawn.
const screenAtlases = {}; // stageId -> {data, img} | null
const screenAtlasPromises = {};

function ensureScreenAtlas(stageId) {
    if (stageId in screenAtlases) return screenAtlases[stageId];
    if (screenAtlasPromises[stageId]) return null; // in flight; next frame
    screenAtlasPromises[stageId] = (async () => {
        try {
            const r = await fetch(`assets/data/${stageId}_screens.json`);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            const img = await loadAssetImage(`assets/effects/${data.sheet}`);
            screenAtlases[stageId] = { data, img };
        } catch {
            screenAtlases[stageId] = null;
        }
        return screenAtlases[stageId];
    })();
    return null;
}

/** Warm one stage's ambient atlas before a field transition completes. */
export function preloadPointSpriteStage(stageId) {
    const stage = data?.[stageId];
    if (!stage || !Object.keys(stage.sprites ?? {}).length) return Promise.resolve();
    const sheet = ensureSheet(stageId);
    ensureSemiSheet(stageId);
    return sheet === "loading" ? sheetPromises[stageId] : Promise.resolve(sheet);
}

/** Release decoded atlases/runtimes outside the current stage neighborhood. */
export function retainPointSpriteStages(stageIds) {
    const keep = new Set(stageIds);
    for (const id of Object.keys(sheets)) {
        if (!keep.has(id)) {
            delete sheets[id];
            delete semiSheets[id];
            delete runtime[id];
            delete screenAtlases[id];
            delete slotWrites[id];
            variantSlotApplied.delete(id);
            clearStreetVehicles(id);
            clearPointRecordStageObjects(id);
        }
    }
}

/**
 * One write of the map setup's display-slot variant flag, port of fieldstg
 * F0x80084B40's store: the FIRST chain record whose tag byte (+1) is 1 gets its
 * live byte (+0) set to 1 on a variant beat, 0 otherwise. Recorded once per
 * stage (the original writes at stage setup, not per frame), so a per-frame
 * stage actor still wins. `records` is the stage's point_sprites.json array in
 * memory order; `rt` is its runtime array.
 */
function applySceneVariantSlot(stageId, records, rt) {
    const ordinal = readOrdinal();
    if (variantSlotApplied.get(stageId) === ordinal) return;
    variantSlotApplied.set(stageId, ordinal);
    const idx = sceneVariantSlotIndex(records);
    if (idx < 0 || idx >= rt.length) return;
    rt[idx].active = sceneVariantSlotActive(ordinal);
}

function stageRuntime(stageId, records) {
    let rt = runtime[stageId];
    if (!rt) {
        rt = records.map((r) => ({
            sprite: r.spriteId, ctr: 0, dir: 1, timer: 0,
            // `active`/`x`/`y`/`ysort` are undefined until a stage actor writes
            // them: the original's record+0, the X halfword at record+0xc, and
            // the Y and y-sort halfwords a pad flash moves its records onto.
            // `mode` stays undefined until a stage-entry gate writes it (s421).
            active: undefined, x: undefined, y: undefined, ysort: undefined,
            mode: undefined,
        }));
        runtime[stageId] = rt;
    }
    return rt;
}

// One animation step per rendered frame (call once per frame for the current
// stage).  The step itself is the engine's `tickPointSpriteRecords` --
// F0x80089038's per-record body including its two gates (the live active byte
// and the camera cull), so the browser wrapper owns only the freeze hook.
function tick(records, rt, f) {
    // Verification hook, same family as window.__hideProps: freeze every record
    // on the frame it is showing. A capture of an animated scene is otherwise
    // dominated by animation phase, which makes a before/after pixel diff
    // meaningless (tools/verify_under_map_props.mjs relies on this).
    if (typeof window !== "undefined" && window.__freezeProps) return;
    tickPointSpriteRecords(records, rt, f);
}

// Dest must share the map's camera phase. These sprites fill transparent
// cut-outs in the stitched map (chain posts, railings); rounding here while
// the map drew at (-camX, -camY) left a visible join that crawled on move.
//
// `semiSheet` is the same stage's STP-only sheet (ensureSemiSheet). PS1 ABR is
// per TEXEL, not per sprite: the plain pass writes every non-STP texel opaque
// (that is what stops the cars looking like glass), and only the STP texels
// are re-drawn under the clip's blend mode. semi == -1 means no blend at all.
function drawSprite(ctx, sheet, layers, x, y, semiSheet) {
    for (const l of layers) {
        ctx.drawImage(sheet, l.x, l.y, l.w, l.h,
            x + l.dx, y + l.dy, l.w, l.h);
    }
    if (!(semiSheet instanceof Image)) return;
    const mode = layers[0]?.semi;
    if (!(mode >= 0)) return;
    // Blend modes: 0 = B/2+F/2, 1 = B+F (the lit lamps/screens), 2 = B-F
    // ('difference' is the closest canvas op; no s780 clip uses it),
    // 3 = B+F/4.
    ctx.save();
    if (mode === 1) {
        ctx.globalCompositeOperation = "lighter";
    } else if (mode === 2) {
        ctx.globalCompositeOperation = "difference";
    } else if (mode === 3) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.25;
    } else {
        ctx.globalAlpha = 0.5;
    }
    for (const l of layers) {
        if (l.semi < 0) continue;
        ctx.drawImage(semiSheet, l.x, l.y, l.w, l.h,
            x + l.dx, y + l.dy, l.w, l.h);
    }
    ctx.restore();
}

// The ordering-table bucket at or above which a record draws BEHIND the ground
// map-tile layer, which the field submits at bucket 7. Records at or above this
// belong in the under-map pass; everything below it draws over the map. Defined
// once, in the ordering-rule module, and re-exported here for the callers that
// import it from this file.
export { UNDER_MAP_BUCKET };

/**
 * Which of our four render passes a record's ordering-table bucket belongs to.
 * One place, so the two passes cannot disagree about where a record goes.
 *
 *   "under-map"      behind the ground map-tile layer (bucket 7): painted
 *                    before the base map, which then covers it
 *   "over-map"       over the map but behind every entity
 *   "sorted"         the entity bucket, y-sorted among the player and NPCs
 *   "over-entities"  in front of every entity
 */
export function bucketPass(layer) {
    if (layer >= UNDER_MAP_BUCKET) return "under-map";
    if (layer < 4) return "over-entities";
    if (layer === 4) return "sorted";
    return "over-map";
}

// One frame's resolved record state, handed from the under-map pass to the
// over-map pass so the animation is ticked exactly once per frame. Consumed
// (and cleared) by drawEffects; a caller that skips the under-map pass, like
// the UI lab, still gets a correct frame because drawEffects prepares its own.
let preparedFrame = null;

// Advance one frame of the stage's records and resolve where each one is and
// which sprite it shows. Ticks animation, so call it once per frame. `view` is
// the camera rect ({x, y, w, h}, map pixels) the disc's cull tests against;
// a caller with no camera passes nothing and no record is culled.
function prepareEffects(stageId, view = null) {
    const s = data?.[stageId];
    if (!s) return null;
    const rt = stageRuntime(stageId, s.records);
    // The stage builds its own actors at stage entry when the registry's
    // construct pointer is null, so nothing waits for a SETANIM.  The two
    // `triple` parents wait for their ORDINAL instead, which is why the number
    // is read here and not cached at load.
    constructPointRecordStageObjects(stageId, readOrdinal());

    // Rebase onto interpreter memory: 18-byte records at the table the stage
    // init registered (active=+0, mode=+5, spriteId=+4, ctr=+9 — the exact
    // bytes the native writers poke).  Built BEFORE the tick, because
    // F0x80089038 dispatches on these live bytes: on a native stage the
    // overlay's own actor can switch a record off or re-mode it (the s421
    // windmill actor writes record+5).
    const native = nativeStage(stageId);
    // The map setup's own display-slot write (fieldstg F0x80084B40): the walker
    // applies it off the native research route, which runs the original's setup
    // itself and whose rebase below reads the byte straight out of memory.
    if (!native) applySceneVariantSlot(stageId, s.records, rt);
    // The stage-entry MODE writer (wstag421's actor, mined into
    // point_record_actors.json `modeGates`): mode = get_flag(flag) on every
    // tagged record.  The disc runs it in the actor's state 0, i.e. once at
    // stage entry; the walker applies it on every prepared frame instead, which
    // is the same thing within a visit (the flag's only producer runs in
    // another stage) and still honours a flag set while away when the stage's
    // runtime is retained.  Native stages skip it: the interpreter's own actor
    // writes the live byte, which the tick reads through `liveMode`.
    if (!native) {
        const gates = pointModeGatesFor(stageId);
        if (gates.length) applyPointModeGates(s.records, rt, gates, readFlag);
    }
    const activeOverride = new Array(s.records.length).fill(null);
    const nativePos = new Array(s.records.length).fill(null);
    const actorPos = new Array(s.records.length).fill(null);
    const liveMode = new Array(s.records.length).fill(null);
    if (native?.pointTable) {
        const m = native.rt.mem;
        for (let i = 0; i < s.records.length; i++) {
            const rec = native.pointTable + i * 18;
            // The live bytes the tick and the draw both read: `active` and the
            // animation `mode` for every record, then the mode-0 records'
            // sprite/ctr/position.
            activeOverride[i] = m.read8(rec);
            liveMode[i] = m.read8(rec + 5);
            if (s.records[i].mode !== 0) continue; // modes 1-3: JS tick owns them
            rt[i].sprite = m.read8(rec + 4);
            rt[i].ctr = m.read8(rec + 9);
            nativePos[i] = {
                x: m.read16s(rec + 10),
                y: m.read16s(rec + 12),
                ysort: m.read16s(rec + 14),
            };
            // s415 object 811 is constructed/prewarmed by SETANIM 816 at the
            // start of the ride, but the Bulbmon record is not presented until
            // the later 817 roll-in command. The native record itself is active
            // while parked off-stage; its renderer has this choreography gate.
            if (
                stageId === "s415" && s.records[i].atlasFlag === 1 &&
                (native.effects.get(811) ?? 816) === 816
            ) activeOverride[i] = 0;
        }
    }

    // The traffic-light corner's own writer (engine/systems/street-lights.ts,
    // the overlay's 0x800a67a4): it publishes active / sprite id / ctr into the
    // two pole records exactly as it pokes the interpreter's memory, so the
    // translated route takes the same rebase. Absent unless the corner is
    // running, which needs the master story ordinal 0x1B.
    const lampWrites = nativeStage(stageId) ? [] : streetLightWrites(stageId);
    for (const w of lampWrites) {
        if (s.records[w.index]?.mode !== 0) continue;
        activeOverride[w.index] = w.active;
        rt[w.index].sprite = w.sprite;
        rt[w.index].ctr = w.ctr;
    }

    // Translated display-slot writers (engine/systems/stage-slot-player.ts): a
    // ported stage object that owns a point record writes its live flag and
    // sprite here. Applied after the interpreter rebasing, and only for records
    // that rebasing left alone, so ?nativeStages still stands down in favour of
    // the original's own writes.
    const sw = slotWrites[stageId];
    if (sw) {
        for (const [i, w] of sw) {
            if (i >= s.records.length) continue;
            if (nativePos && nativePos[i]) continue;
            if (w.active !== undefined) activeOverride[i] = w.active;
            if (w.sprite !== undefined) rt[i].sprite = w.sprite;
            if (w.ctr !== undefined) rt[i].ctr = w.ctr;
        }
    }

    // The point-record actor arm that MOVES its claimed records (the pad flash
    // onto the pad the command names, the rising copy up the screen) writes the
    // record's position itself, so the draw position comes from the actor's own
    // write and not from the table. Every other arm leaves the record where the
    // disc put it, which is why the position patch is optional.
    for (const [key, patch] of Object.entries(actorPositions[stageId] ?? {})) {
        const idx = Number(key);
        if (!s.records[idx]) continue;
        rt[idx].x = patch.x;
        actorPos[idx] = patch;
    }

    const f = {
        stageId, s, rt, activeOverride, nativePos, actorPos, liveMode,
        view: view ?? null,
        sheet: Object.keys(s.sprites).length ? ensureSheet(stageId) : null,
        semiSheet: Object.keys(s.sprites).length ? ensureSemiSheet(stageId) : null,
    };
    tick(s.records, rt, f);
    return f;
}

/** The cull rect for a draw call's camera: the visible map-pixel window, the
 *  walker's stand-in for the 0x1002 layer's screen rect (ctx+0x128).  No view
 *  dimensions (a caller without a camera) -> null, and nothing is culled. */
function viewRect(camX, camY, viewW, viewH) {
    return viewW > 0 && viewH > 0
        ? { x: camX, y: camY, w: viewW, h: viewH }
        : null;
}

// Paint the records that draw BEHIND the ground map-tile layer -- ordering-table
// buckets 8 and above. Call this immediately BEFORE the base map is drawn; the
// map art then covers them, which is what the console does. It also ticks the
// frame, so drawEffects must follow it on the same frame.
export function drawEffectsUnderMap(ctx, stageId, camX, camY, viewW, viewH) {
    const f = prepareEffects(stageId, viewRect(camX, camY, viewW, viewH));
    preparedFrame = f;
    if (!f) return;
    eachRecord(f, ctx, camX, camY, (r, draw) => {
        if (bucketPass(r.layer) === "under-map") draw();
    });
}

// Draw the current stage's effects. Fixed-layer records (ysort==0) paint
// immediately (call this right after the map background); records with a
// y-sort baseline are pushed into `drawables` so the player/NPCs sort around
// them. Coordinates are map-space; ctx is already camera-translated by the
// caller passing camX/camY. Records at UNDER_MAP_BUCKET and above were already
// painted by drawEffectsUnderMap and are skipped here.
export function drawEffects(ctx, stageId, camX, camY, drawables, viewW, viewH) {
    const f = preparedFrame?.stageId === stageId
        ? preparedFrame
        : prepareEffects(stageId, viewRect(camX, camY, viewW, viewH));
    preparedFrame = null; // one frame's preparation is good for one frame
    if (!f) return;
    eachRecord(f, ctx, camX, camY, (r, draw, py, pysort) => {
        // The record's `layer` byte (record byte+3) is the GPU ordering-table
        // BUCKET the draw is submitted to, and LOWER means NEARER the camera.
        //
        // The bucket ladder, from fieldstg call sites that all reach vtable
        // slot +0x7C (F0x8001ed34 -> F0x8001ecf8): 0 = the HUD digits and
        // gauges drawn at fixed screen coords (F0x8008c6b8, and F0x8008d27c
        // which draws its world sprite at 4 and its own gauge at 0), 1 = the
        // icon above an actor's head (F0x80087e7c, actorY-0x1B), 2 = the
        // message strip at screen y 0xAC (F0x80084200), 4 = world entities
        // (literal `li $a1, 0x4` in the y-sorted world-object callback,
        // fieldstg file 0xa374), 7 = the fullscreen backdrop (F0x80085590).
        //
        // The map's three tile layers ride the same ladder -- ground 7,
        // foreground 3, layer 2 at 11 (the three words at 0x8009702c, each
        // handed to the same slot 0x138 these records reach; see
        // docs/research/field/map-tile-draw-semitransparency-2026-08-20.md
        // section 8). So bucket 2 draws over entities, 4 sorts among them, 6
        // draws under them but still over the ground, and 8 and 10 draw behind
        // the ground -- those were painted before the map by drawEffectsUnderMap.
        //
        // The shipped records agree that 4 is the entity bucket: a y-sort key
        // is only meaningful there, and that is where it appears -- 2541/2545
        // bucket-4 records carry one, while 1692/1693 bucket-2, 4651/4655
        // bucket-6 and 647/647 bucket-10 records do not.
        //
        // This is the reverse of the 2026-07-04 census reading (2 background,
        // 6/10 foreground), which cut the Asuka-plaza tree canopy in half:
        // the canopy is authored partly as tile foreground (`sNNN_fg.png`,
        // over entities) and partly as bucket-2 point records filling cut-outs
        // in the stitched base map, so demoting bucket 2 opened a rectangular
        // window in the leaves that the player showed through.
        switch (bucketPass(r.layer)) {
            case "under-map":
                return; // already painted, before the base map
            case "over-entities":
                drawables.push({ y: Infinity, draw });
                return;
            case "sorted":
                drawables.push({ y: pysort || py, draw });
                return;
            default:
                draw(); // over the map, behind every entity
        }
    });
}

// Walk one prepared frame's live records, handing each one a painter bound to
// this context and camera. Both passes share it so they cannot disagree about
// which records are live or where they are.
function eachRecord(f, ctx, camX, camY, visit) {
    const { s, rt, sheet, semiSheet } = f;
    for (let i = 0; i < s.records.length; i++) {
        const r = s.records[i];
        // The disc's two draw gates, resolved exactly as the tick resolves
        // them: the live active byte (`lbu $v0, ($s1)` / `beqz`, file 0x64bc)
        // and the camera cull (file 0x64f4-0x6550) -- a culled record is not
        // drawn, so a tall sprite does not pop in from an off-screen anchor.
        const live = pointRecordLive(r, rt[i], f, i);
        if (!live.active) continue;
        if (!pointRecordInView(r, live.x, live.y, f.view)) continue;
        const px = live.x;
        const py = live.y;
        const pysort = live.ysort;
        const draw = () => {
            if (r.atlas === "fieldcom") {
                if (fieldcomReady()) {
                    drawFieldcomIcon(ctx, 0, rt[i].sprite, px - camX, py - camY);
                }
                return;
            }
            const st = rt[i];
            const layers =
                (st.ctr ? s.sprites[`${st.sprite}@${st.ctr}`] : null) ??
                s.sprites[String(st.sprite)];
            if (layers && sheet instanceof Image) {
                drawSprite(ctx, sheet, layers, px - camX, py - camY, semiSheet);
            }
        };
        // Both consumers pass the bucket to the same context setter: the fixed
        // pass in fieldstg F0x80089038 (`sp94(0x1002, byte+3, …)`) and the
        // y-sorted callback F0x80088eec (`lbu $a1, 0x3($s0)`, fieldstg file
        // 0x6294) — so the bucket applies whether or not the record has a
        // baseline. What each bucket means is documented at the call in
        // drawEffects.
        visit(r, draw, py, pysort);
    }
}

// Fire Dungeon trap explosions. Each live burst draws its two components from
// the SAME stage atlas the point sprites use (the explosion runs 50..67 are cut
// into every s740/s741 sheet already, unused by any point record). The layers
// are y-sorted, not painted flat: the controller gives each component its own
// baseline offset — one 240px ABOVE the Digimon, so it sorts behind everything,
// and one +20 below, so it sorts in front. See engine/systems/fire-trap.ts.
export function drawFireTrapBursts(ctx, stageId, camX, camY, drawables, trap) {
    const s = data?.[stageId];
    if (!s || !trap) return;
    const sheet = ensureSheet(stageId);
    if (!(sheet instanceof Image)) return;
    const semiSheet = ensureSemiSheet(stageId);
    for (const burst of trap.run.bursts) {
        // Each component carries its OWN decoded y-sort baseline (one 240px
        // above the Digimon, one +20 below), so the two are separate ordering
        // keys -- submit each through the one push at its own key.
        burst.sprites.forEach((sprite, i) => {
            if (sprite == null) return;
            const layers = s.sprites[String(sprite)];
            if (!layers) return;
            pushComposite(drawables, burst.y + (trap.cfg.layers[i]?.ysortDy ?? 0), [
                () => drawSprite(ctx, sheet, layers, burst.x - camX, burst.y - camY, semiSheet),
            ], "fire-trap");
        });
    }
}

// Draw a translated stage actor's clip (web/stage-objects.js) out of the same
// stage atlas the point records use, so a rock is blitted with the same blend
// handling and y-sorts at its own y exactly as the native drawSprite path did.
// `entries` are {clip, x, y} in map coordinates.
export function drawStageObjectSprites(ctx, stageId, camX, camY, drawables, entries) {
    const s = data?.[stageId];
    if (!s || !entries?.length) return;
    const sheet = Object.keys(s.sprites).length ? ensureSheet(stageId) : null;
    if (!(sheet instanceof Image)) return;
    const semiSheet = ensureSemiSheet(stageId);
    for (const e of entries) {
        // `ctr` is the palette byte the original's draw callback submits beside
        // the sprite (fixed still sprites, engine/systems/stage-fixed-sprite.ts);
        // entries without one — the rockfall — keep the plain lookup.
        const layers =
            (e.ctr ? s.sprites[`${e.clip}@${e.ctr}`] : null) ?? s.sprites[String(e.clip)];
        if (!layers) continue;
        const sx = e.x - camX;
        const sy = e.y - camY;
        drawables.push({
            y: e.y,
            draw: () => drawSprite(ctx, sheet, layers, sx, sy, semiSheet),
        });
    }
}

// Replay this frame's native draw intents (web/native-stage.js tick). The
// overlay's per-object draw fns fill a draw context (EXE F0x8001f648) and call
// its methods; the interpreter records them. We honor the sprite path:
//   setScale(-0x1000, ...)  → x-flip until the next drawSprite
//   drawSprite(sub, spriteId, x, y) → stage-atlas sprite at map coords (x,y)
// (the s780 cars). Sprites y-sort at their own y so entities walk around them.
export function drawNativeIntents(ctx, stageId, camX, camY, drawables) {
    const native = nativeStage(stageId);
    const s = data?.[stageId];
    if (!native || !s) return;
    const sheet = Object.keys(s.sprites).length ? ensureSheet(stageId) : null;
    if (!(sheet instanceof Image)) return;
    const semiSheet = ensureSemiSheet(stageId);
    let flip = false;
    for (const call of native.rt.drawCalls) {
        if (call.method === "setScale") {
            flip = call.args[1] < 0;
        } else if (call.method === "drawSprite") {
            const [, spriteId, x, y] = call.args;
            // s415 sprite 0 is already the live gondola point record. The
            // stage controller also submits its internal tiled copies through
            // the layer runner; replaying those as independent world sprites
            // creates duplicate gondolas. Its visible falling-rock jobs are
            // the decoded 70..77 family.
            if (stageId === "s415" && spriteId < 70) continue;
            const layers = s.sprites[String(spriteId)];
            if (!layers) continue;
            const flipNow = flip;
            drawables.push({
                y,
                draw: () => {
                    if (flipNow) {
                        ctx.save();
                        ctx.translate(x - camX, 0);
                        ctx.scale(-1, 1);
                        ctx.translate(-(x - camX), 0);
                        drawSprite(ctx, sheet, layers, x - camX, y - camY, semiSheet);
                        ctx.restore();
                    } else {
                        drawSprite(ctx, sheet, layers, x - camX, y - camY, semiSheet);
                    }
                },
            });
            flip = false;
        }
    }
    // Wall-screen quads (the decoded 40-quad builder). One quad batch per
    // driver; the walker can boot the driver twice, so identical quads are
    // deduped. The quad carries page-relative texture coords; the sheet combo
    // supplies the page image and the palette's ABR mode.
    ensureScreenAtlas(stageId);
    const screen = screenAtlases[stageId];
    if (screen && native.rt.screenQuads?.length) {
        const seen = new Set();
        for (const q of native.rt.screenQuads) {
            const combo = screen.data.combos[`${q.texpage}:${q.clut}`];
            if (!combo) continue;
            const key = `${q.texpage}:${q.clut}:${q.x.join()}:${q.y.join()}:${q.u.join()}:${q.v.join()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            drawables.push({
                y: Math.max(q.y[0], q.y[1], q.y[2], q.y[3]),
                draw: () => drawScreenQuad(ctx, screen.img, combo, q, camX, camY),
            });
        }
    }
}

// Street vehicles — the cars that drive across the street during a broadcast
// (engine/systems/street-vehicles.ts, translated from wstag780's broadcast
// object 0x800a6dc4 and car tick 0x800a5ec0). One frame of movement per
// rendered frame; the draw reuses the stage's own TMPK clips, which is what
// the original's draw callback resolves too (a car sprite id IS a TMPK clip
// id). Decode:
// docs/research/field/asuka-city-cars-and-news-screens-2026-10-04.md
/** Verification hook: the live cars on a stage (sprite id + map pixel). */
export function streetVehicleProbe(stageId) {
    return streetVehicleDraws(stageId);
}

// Street screens — the wall and column screens a stage overlay builds for
// itself (engine/systems/street-screens.ts, translated from wstag780's
// screen-content driver 0x800a72b0 and its 40-quad builder 0x800a6fbc). Each
// screen is two quads: a lit frame drawn semi-transparent and the animated
// content inside it. The quads carry page-relative texture coords, so the baked
// page sheet (tools/extract_screen_pages.py) supplies the pixels and each quad's
// palette supplies the blending mode — the same two steps drawNativeIntents takes
// for the interpreter's capture of the original driver.
// Decode: docs/research/field/asuka-city-cars-and-news-screens-2026-10-04.md
export function streetScreenProbe(stageId) {
    return streetScreenDraws(stageId);
}

export function drawStreetScreens(ctx, stageId, camX, camY, drawables, quads) {
    if (!quads?.length) return;
    ensureScreenAtlas(stageId);
    const screen = screenAtlases[stageId];
    if (!screen) return;
    for (const q of quads) {
        const combo = screen.data.combos[`${q.texpage}:${q.clut}`];
        if (!combo) continue;
        drawables.push({
            y: Math.max(q.y[0], q.y[1], q.y[2], q.y[3]),
            draw: () => drawScreenQuad(ctx, screen.img, combo, q, camX, camY),
        });
    }
}

// The traffic-light glows a street overlay builds for itself
// (engine/systems/street-lights.ts: the overlay's glow object 0x800a652c and its
// traffic-light writer 0x800a67a4) and the three lamp glows the broadcast object
// draws above the street (engine/systems/street-vehicles.ts, the overlay's
// street-prop drawer 0x800a6b4c). Both use the stage's own TMPK clips, which is
// what the original's draw resolves too — a clip id IS a TMPK clip id.
// Decode: docs/research/field/asuka-city-cars-and-news-screens-2026-10-04.md
export function streetGlowProbe(stageId) {
    return { glows: streetGlowDraws(stageId), props: streetPropDraws(stageId) };
}

/** One clip at one map pixel, on the shared point-sprite sheet. */
function drawClip(ctx, sheet, semiSheet, layers, x, y) {
    drawSprite(ctx, sheet, layers, x, y, semiSheet);
}

export function drawStreetGlows(ctx, stageId, camX, camY, drawables) {
    if (nativeStage(stageId)) return;
    const s = data?.[stageId];
    if (!s) return;
    const sheet = ensureSheet(stageId);
    if (!(sheet instanceof Image)) return;
    const semiSheet = ensureSemiSheet(stageId);
    // The six corner glows ARE y-sorted: the overlay queues each through the
    // draw-context's own ordering list at the glow's y (wstag780 file 0x864,
    // slot +0x14c, a3 = obj+0x58), exactly as a point record with an `ysort`
    // baseline does -> key = the glow's own y.
    const glows = streetGlowDraws(stageId).map((g) => ({
        clip: g.clip, x: g.x, y: g.y, key: g.y, tag: "corner-glow",
    }));
    // The broadcast's street-prop drawer (0x800a6b4c) is a FIXED-bucket draw:
    // `sp94(0x1002, 2, …)` at file 0xd94, ordering bucket 2 = IN FRONT of every
    // entity. The walker used to y-sort these at their own y (179..268), which
    // put the lamp glows behind their own pole housing (ysort 231/303) -- a lamp
    // re-ordering against its own housing -- and let a glow sort around the
    // entering actors.
    const props = streetPropDraws(stageId).map((p) => ({
        ...p, key: IN_FRONT_OF_ENTITIES, tag: "street-prop",
    }));
    for (const e of [...glows, ...props]) {
        const layers = s.sprites[String(e.clip)];
        if (!layers) continue;
        pushComposite(drawables, e.key, [
            () => drawClip(ctx, sheet, semiSheet, layers, e.x - camX, e.y - camY),
        ], e.tag);
    }
}

// The corner stinger (engine/systems/stinger-popup.ts, the overlay's popup
// object 0x800a61c8 and its draw 0x800a6130): one TMPK clip at a fixed map
// pixel, on ordering-table bucket 7 — over the map, behind the entities.
export function stingerPopupProbe(stageId) {
    return stingerPopupDraws(stageId);
}

export function drawStingerPopup(ctx, stageId, camX, camY, drawables) {
    if (nativeStage(stageId)) return;
    const entries = stingerPopupDraws(stageId);
    if (!entries?.length) return;
    const s = data?.[stageId];
    if (!s) return;
    const sheet = ensureSheet(stageId);
    if (!(sheet instanceof Image)) return;
    const semiSheet = ensureSemiSheet(stageId);
    for (const e of entries) {
        const layers = s.sprites[String(e.clip)];
        if (!layers) continue;
        // The corner stinger submits on ordering bucket 7 -- over the map,
        // behind every entity (wstag780 file 0x3d4). The walker used to y-sort
        // it at its own y among the entities.
        pushComposite(drawables, BEHIND_ENTITIES, [
            () => drawClip(ctx, sheet, semiSheet, layers, e.x - camX, e.y - camY),
        ], "stinger");
    }
}

// ── the resident 2D draw-context service's markers ──────────────────────────
//
// s805's ring of twenty-seven markers and s820's four are the two stage users of
// the 0x1002 draw-context service the walker can drive (engine/systems/
// draw-context.ts, engine/systems/shape-annotator.ts). The service hands each one
// a shape request -- a shape id, a CLUT row, a position and a draw order -- and
// the shape is a rectangle out of the stage's own sprite directory, the TMPK
// member 0 every ambient point sprite and launch pad also reads
// (docs/research/field/point-sprite-ambient-system.md). `annotatorShapeQuads`
// resolves the id to its rectangles and their palettes; the texels of every id
// the two members ask for are already cut into `assets/effects/sNNN.png` by
// `tools/extract_point_sprites.py`, with the `sid@ctr` palette variants the disc
// pass's CLUT row selects. So this is the same sheet, the same drawSprite and
// the same semi sheet the pads and the scenery use -- one atlas, one draw path.
//
// Nothing here invents a primitive: GP0(64h)/GP0(66h) is a rectangle whose size
// and texels are the frame's own words, which is why the first pass of this work
// drew a flat tinted box and had to be removed. A shape whose id is not in the
// directory draws nothing at all, exactly as the emitter's id search failing
// leaves the packet list untouched.
//
// Decode: docs/research/field/draw-context-service-2026-10-04.md
export function drawAnnotatorShapes(ctx, stageId, camX, camY, drawables, requests) {
    if (!requests?.length) return;
    const s = data?.[stageId];
    if (!s) return;
    const sheet = ensureSheet(stageId);
    if (!(sheet instanceof Image)) return;
    const semiSheet = ensureSemiSheet(stageId);
    for (const r of requests) {
        // The disc pass's CLUT row picks a palette variant when the extractor cut
        // one; a row with no variant draws on the shape's own palette, which is
        // what the pads do for the same reason.
        const base = String(r.shape);
        const sprite = (r.clutRow ? s.sprites[`${base}@${r.clutRow}`] : null) ?? s.sprites[base];
        if (!sprite) continue;
        pushComposite(drawables, r.y, [
            () => drawSprite(ctx, sheet, sprite, r.x - camX, r.y - camY, semiSheet),
        ], "annotator");
    }
}

// ── the stage overlay's own per-frame shape table ────────────────────────────
//
// A stage whose base tick builds the transient draw-context block
// (`F0x8001f648`) and then loops the SHARED shape emitter `F0x8001ED6C` -- the
// block's `+0x84` slot -- over an authored 8-byte {x, y} position table paints
// those shapes every frame. The emitter resolves each shape's pixels from the
// stage's own TMPK sprite directory, member 0 (the same directory the point
// sprites, launch pads and annotators read), and the block's `+0x7C` publish
// (`F0x8001ed34` -> the context's `+0x138` ordering-table accessor) links them
// into an ordering-table bucket. The table and the bucket are AUTHORED DATA,
// not per-stage code, so ONE shared draw runs them all:
// `tools/extract_stage_overlay_shapes.py` -> assets/data/stage_overlay_shapes.json.
//
// Protocol Ruins (`s375`, alias `s949`) is the first stage: 36 stamps of
// directory clip 0 on ordering bucket 12, i.e. behind the ground map-tile layer
// (bucket 7) and behind every entity, so this is the under-map pass (painted
// before the base map). The parallax term is the base tick's own:
// `(context scroll - base) >> shift`, scroll in whole pixels.
export function stageOverlayShapeProbe(stageId) {
    return overlayShapeData?.[stageId] ?? null;
}

export function drawStageOverlayShapes(ctx, stageId, camX, camY) {
    const info = overlayShapeData?.[stageId];
    if (!info) return;
    const s = data?.[stageId];
    if (!s) return;
    const sheet = ensureSheet(stageId);
    if (!(sheet instanceof Image)) return;
    const semiSheet = ensureSemiSheet(stageId);
    // `sra` (arithmetic shift) in JS `>>`, so a negative scroll reads the same.
    const dx = (camX - info.baseX) >> info.shift;
    const dy = (camY - info.baseY) >> info.shift;
    for (const sh of info.shapes) {
        const layers = s.sprites[String(sh.id)];
        if (!layers) continue;
        drawSprite(ctx, sheet, layers, sh.x + dx - camX, sh.y + dy - camY, semiSheet);
    }
}

export function drawStreetVehicles(ctx, stageId, camX, camY, drawables) {
    const draws = streetVehicleDraws(stageId);
    if (!draws.length) return;
    const s = data?.[stageId];
    if (!s) return;
    const sheet = ensureSheet(stageId);
    if (!(sheet instanceof Image)) return;
    const semiSheet = ensureSemiSheet(stageId);
    for (const car of draws) {
        const layers = s.sprites[String(car.spriteId)];
        if (!layers) continue;
        pushComposite(drawables, car.y, [
            () => drawSprite(ctx, sheet, layers, car.x - camX, car.y - camY, semiSheet),
        ], "car");
    }
}

/** One captured GPU quad: map texture (u,v) to the quad's screen parallelogram
 *  and blit the baked page under the primitive's ABR mode (cmd 0x2E = ABR on;
 *  the texpage word's bits 5-6 select the mode, 0 = B/2+F/2). */
function drawScreenQuad(ctx, sheet, combo, q, camX, camY) {
    const du = q.u[1] - q.u[0];
    const dv = q.v[2] - q.v[0];
    if (!du || !dv) return;
    const a = (q.x[1] - q.x[0]) / du;
    const b = (q.y[1] - q.y[0]) / du;
    const c = (q.x[2] - q.x[0]) / dv;
    const d = (q.y[2] - q.y[0]) / dv;
    const e = (q.x[0] - camX) - a * q.u[0] - c * q.v[0];
    const f = (q.y[0] - camY) - b * q.u[0] - d * q.v[0];
    ctx.save();
    if (q.cmd === 0x2e) {
        const abr = combo.abr & 3;
        if (abr === 1) ctx.globalCompositeOperation = "lighter";
        else if (abr === 2) ctx.globalCompositeOperation = "difference";
        else if (abr === 3) { ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.25; }
        else ctx.globalAlpha = 0.5;
    }
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(
        sheet,
        combo.x + q.u[0], combo.y + q.v[0], du, dv,
        q.u[0], q.v[0], du, dv,
    );
    ctx.restore();
}

// ── launch pads (type-0x17 stage actors) ─────────────────────────────────────
//
// Each stage overlay builds its own pads from a 12-byte record table
// (tools/extract_launch_pads.py); their clip ids come out of the same per-stage
// TMPK sprite directory as the point sprites above, so they share the sheet.
//
// wstag735 F0x800a620c draws each pad in TWO passes:
//   index 0 — the idle disc, clip = padClipBase, at the pad origin;
//   index 1 — the strobe column, clip = padClipBase + script value, at
//             (x, y - 0x20), i.e. 32px HIGHER, and only while the pad is in
//             state 2 (obj+0x68 nonzero).
// Both y-sort at the pad's own y, which is what the native passes as the
// display-list sort key (a3 = [obj+0x58], +0x12 for the strobe pass).

/** The stage's pad records, or [] — used by game.js to pick the nearest pad. */
export function launchPads(stageId) {
    return padData?.[String(stageId).replace(/^s/, "")]?.pads?.filter(
        (p) => p.enabled,
    ) ?? [];
}

/** Vertical offset of the strobe column (wstag735 0x800a609c: s1 -= 0x20). */
export const PAD_STROBE_DY = -0x20;

// Debug-only: lets the headless verifier take an A/B of the same frame with the
// pads drawn and not drawn, which is the only pad-presence check the stage's own
// background art cannot satisfy.
let padsEnabled = true;
export function setLaunchPadsEnabled(on) {
    padsEnabled = !!on;
}

/** Dev-only read of the last frame the pad layer drew: how many times
 *  drawLaunchPads ran and the CLUT-row offset each pad emitted. Exists so a
 *  headless verifier can read the idle pulse directly instead of inferring it
 *  from averaged canvas pixels (an averaged signature cannot tell a 3-row
 *  script from a 6-value alias). */
let padDebug = { calls: 0, palette: [] };
export function launchPadDebug() {
    return { calls: padDebug.calls, palette: padDebug.palette.slice() };
}

/** Per-stage idle cursors, one per pad — every pad runs its own copy of the
 *  looping idle script from the moment the stage loads (state 0 seeds the
 *  cursor at entry 0), so they pulse in step until a launch rewinds one. */
const padIdle = {}; // stageId -> [PadCursor] parallel to launchPads(stageId)

function padIdleScript(stageId) {
    const entries = padData?.[String(stageId).replace(/^s/, "")]?.idleScript
        ?.entries;
    return entries?.length ? entries : PAD_IDLE_SCRIPT;
}

/** Advance every pad's idle colour cursor one rendered frame (= one tick). */
function tickPadIdle(stageId, pads, launch) {
    const script = padIdleScript(stageId);
    let cur = padIdle[stageId];
    if (!cur || cur.length !== pads.length) {
        cur = pads.map(() => newPadCursor(script));
        padIdle[stageId] = cur;
    }
    const out = new Array(pads.length);
    for (let i = 0; i < pads.length; i++) {
        // Entering state 2 rewinds this pad's cursor (the native stores 0 to
        // +0x60 and reloads +0x62 before it runs the animator that frame).
        if (
            launch?.padIdleReset &&
            pads[i].x === launch.padOriginX &&
            pads[i].y === launch.padOriginY
        ) {
            cur[i] = newPadCursor(script);
        }
        out[i] = advancePadScript(cur[i], script, false);
    }
    return out;
}

export function drawLaunchPads(ctx, stageId, camX, camY, drawables, launch) {
    if (!padsEnabled) return;
    const pads = launchPads(stageId);
    if (!pads.length) return;
    const s = data?.[stageId];
    if (!s) return;
    // Tick before the sheet check so the colour cycle keeps native time while
    // the stage's sprite sheet is still loading.
    const palette = tickPadIdle(stageId, pads, launch);
    padDebug = { calls: padDebug.calls + 1, palette };
    const sheet = ensureSheet(stageId);
    if (!(sheet instanceof Image)) return;
    const semiSheet = ensureSemiSheet(stageId);

    // Only the pad the controller latched onto strobes; every other pad on the
    // screen keeps drawing its idle disc.
    const liveX = launch?.padOriginX;
    const liveY = launch?.padOriginY;
    for (let i = 0; i < pads.length; i++) {
        const pad = pads[i];
        // The idle value is a CLUT-row offset on the pad's own disc, pre-cut by
        // the extractor as "clip@ctr" (a missing row falls back to the base
        // palette, exactly as the mode-2/3 point sprites do).
        const ctr = palette[i];
        const idle =
            (ctr ? s.sprites[`${pad.clip}@${ctr}`] : null) ??
            s.sprites[String(pad.clip)];
        // The strobe column is never given a CLUT offset (obj+0x6a is left at
        // 0), so it always draws on its base palette row.
        const strobe =
            launch?.padClip &&
            pad.x === liveX &&
            pad.y === liveY
                ? s.sprites[String(launch.padClip)]
                : null;
        if (!idle && !strobe) continue;
        // The pad is ONE object: its idle disc and its strobe column are the
        // object's own two passes, emitted together at the pad's single y-sort
        // baseline (launch-pad-actor-decoded.md section 2: both passes y-sort at
        // the pad's own y; the strobe column is drawn at y - 0x20).
        pushComposite(drawables, pad.y, [
            () => {
                if (idle) drawSprite(ctx, sheet, idle, pad.x - camX, pad.y - camY, semiSheet);
                if (strobe) {
                    drawSprite(ctx, sheet, strobe,
                        pad.x - camX, pad.y + PAD_STROBE_DY - camY, semiSheet);
                }
            },
        ], "launch-pad");
    }
}
