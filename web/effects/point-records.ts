import {
  loadPointRecordActors,
  loadChildPoolParents,
  loadScrollLayers,
  firePointRecordActor,
  fireChildPoolParent,
  constructPointRecordActors,
  setPointRecordActorSound as setEnginePointRecordActorSound,
  setPointRecordActorMusic as setEnginePointRecordActorMusic,
  pointRecordActorState,
  pointRecordPadRun,
  fieldCharY,
  fieldCharSetY,
  tickPointRecordActors,
  pictureStepDraws as enginePictureStepDraws,
  setScrollLayerFlag,
  scrollLayerDraws as engineScrollLayerDraws,
  clearPointRecordActors,
  clearStreetVehicles,
} from "../vendor/engine.js";
import { loadAssetImage } from "../assets.js";
import { sceneVariantSlotIndex, sceneVariantSlotActive } from "../ordinal-scene-variant.js";
import { S } from "./state.js";
interface PointSpriteRecord {
    readonly atlas: number;
    readonly x: number;
    readonly y: number;
    readonly z?: number;
    readonly width?: number;
    readonly height?: number;
    readonly scale?: number;
    readonly rotation?: number;
    readonly flipX?: boolean;
    readonly flipY?: boolean;
    readonly palette?: number;
    readonly tile?: number;
    readonly layer?: number;
    readonly blend?: number;
    readonly hidden?: boolean;
}


let actorData = null; // point_record_actors.json -- the ONE table

let parentData = null; // child_pool_parents.json -- the child-array parents

let playStageSound = null; // (packedWord) => void, wired once by the game loop

const sheets = {}; // stageId -> Image | "loading"

const sheetPromises = {}; // stageId -> in-flight load

const semiSheets = {}; // stageId -> Image | null | "loading" (STP texels only)

const semiSheetPromises = {}; // stageId -> in-flight load

const runtime = {}; // stageId -> [{sprite, timer}] parallel to records

// Translated display-slot writers (engine/systems/stage-slot-player.ts): a
// stage object that owns a point record writes its live flag and sprite here,
// and `prepareEffects` reads the same arrays the interpreter bridge fills.
export const slotWrites = {}; // stageId -> Map<recordIndex, {active, sprite}>

// The map setup's display-slot variant flag (fieldstg F0x80084B40): at every
// stage setup the walker writes the FIRST chain record whose tag byte (+1) is 1
// — the walk engine/systems/ordinal-scene-variant.ts `sceneVariantSlotIndex`
// ports — to 1 on the sixteen variant story beats and 0 otherwise. Written once
// per stage, at the point the original's own setup runs, so a per-frame stage
// actor (a slot player, a street light) still overrides it. stageId -> the
// ordinal already applied.
const variantSlotApplied = new Map();

// The character anchor the `picture-steps` machine draws at, wired once by the
// game loop: `(stageId, type, p1, p2) -> live actor | null` and
// `(actor) -> {x, y} | null`.  See `setPointRecordAnchor`.
let anchorFind = null;

let anchorPos = null;

export async function loadPointSprites() {
    [S.data, actorData, S.padData, parentData, S.overlayShapeData] = await Promise.all([
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
export function constructPointRecordStageObjects(stageId: string, ordinal = 0) {
    return constructPointRecordActors(stageId, ordinal);
}

/**
 * The master story ordinal, wired once by the game loop beside
 * `setStageObjectOrdinal`.  `stage-objects.js` cannot be imported here (it
 * imports this module), so the same number is handed over twice rather than a
 * second copy of it being read out of the story engine.
 */
export function setPointRecordOrdinal(fn: { (): number; (): number; }) {
    S.readOrdinal = typeof fn === "function" ? fn : () => 0;
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
export function pointRecordActors(stageId: number) {
    return pointRecordActorState(stageId);
}

/**
 * Debug-only: what the stage's point records are showing right now, so a
 * headless verifier can read the frames a decor driver put there (the same rows
 * `eachRecord` paints from).
 */
export function pointSpriteProbe(stageId: number) {
    const s = S.data?.[stageId];
    if (!s) return [];
    const rt = stageRuntime(stageId, s.records);
    return rt.map((st, i: string | number) => ({
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
export function setPointSprite(stageId: string | number, recIndex: string | number, spriteId: number) {
    const s = S.data?.[stageId];
    if (!s || !s.records[recIndex]) return;
    stageRuntime(stageId, s.records)[recIndex].sprite = spriteId;
}

/** The record-position patches the pad-flash arm asked for this frame. */
export const actorPositions = {}; // stageId -> { recordIndex: {x, y, ysort} }

/**
 * The host engine/systems/point-record-actor.ts drives: the three record bytes
 * the original writes (`active` +0, `spriteId` +4, `ctr` +9), the X halfword at
 * +0xc that s790's slide adds to, and the pad position the pad-flash arm
 * moves its three records onto -- plus a read side, because s790's reveal waits
 * on a record's live `ctr`.
 */
function pointRecordHost(stageId: string | number, records) {
    const rt = stageRuntime(stageId, records);
    return {
        write(index: string | number, patch: { active: undefined; sprite: undefined; ctr: undefined; x: undefined; y: undefined; ysort: undefined; }) {
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
        read(index: string | number) {
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
export function pointSpriteRecords(stageId: string | number): PointSpriteRecord[] | null {
    return S.data?.[stageId]?.records ?? null;
}

/**
 * Advance every live actor on this stage one PAL blank.  Called from
 * web/stage-objects.js, which owns the blank clock -- the same clock the
 * falling rocks and the street cars use, so a script's hold counts blanks
 * exactly as it did on the console.
 */
export function tickPointRecordStageObjects(stageId: string | number, delta = 1) {
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

function ensureScrollSheet(rel: string) {
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
    S.readFlag = typeof fn === "function" ? fn : null;
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
export function drawScrollLayers(ctx: CanvasRenderingContext2D | null, stageId) {
    for (const d of engineScrollLayerDraws(stageId)) {
        const img = scrollSheets[d.sheet] ?? ensureScrollSheet(d.sheet);
        if (!(img instanceof Image)) continue;
        ctx!.drawImage(img, d.x, d.y);
        ctx!.drawImage(img, d.x, d.y + d.wrapY);
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
export function pointRecordProbe(stageId: string | number) {
    const records = S.data?.[stageId]?.records;
    if (!records) return null;
    const rt = stageRuntime(stageId, records);
    return {
        records: records.map((r, i: string | number) => ({
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
export function setPointSlot(stageId: string | number, recIndex: number, patch) {
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
export function clearPointSlots(stageId: string | number | undefined) {
    if (stageId === undefined) {
        for (const k of Object.keys(slotWrites)) delete slotWrites[k];
    } else {
        delete slotWrites[stageId];
    }
}

export function ensureSheet(stageId: string | number) {
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
export function ensureSemiSheet(stageId) {
    if (stageId in semiSheets) return semiSheets[stageId];
    if (!S.data?.[stageId]?.hasSemi) {
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
export const screenAtlases = {}; // stageId -> {data, img} | null

const screenAtlasPromises = {};

export function ensureScreenAtlas(stageId: string) {
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
    const stage = S.data?.[stageId];
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
export function applySceneVariantSlot(stageId: string, records, rt) {
    const ordinal = S.readOrdinal();
    if (variantSlotApplied.get(stageId) === ordinal) return;
    variantSlotApplied.set(stageId, ordinal);
    const idx = sceneVariantSlotIndex(records);
    if (idx < 0 || idx >= rt.length) return;
    rt[idx].active = sceneVariantSlotActive(ordinal);
}

export function stageRuntime(stageId: string | number, records) {
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
