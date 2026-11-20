// web/quest-props.js
// Props: our own effect-sheet art left on a map because of a quest's state -- the little thing that stays in the world
// after the player did something (a sign put up, a crate moved, a grave dug, a lamp lit, a bridge repaired).
//
// The art, the sheet format and the drawing are web/quest-fx.js's: a prop IS one of its effects (an fx object in the
// field's ONE y-sorted draw list, so it can stand behind or in front of the people), placed through its own exports
// (questFxSpawn / questFxGet / questFxRemove / questFxDrawables). Nothing is copied from it here. The difference from a
// scene's `fx` step is only who keeps it alive: a scene places an effect and questFxClear takes it away, while a prop is
// placed again every frame for as long as the quest state says the world is changed -- so a warp, a fight, a load, a map
// change or a scene can take it off for a moment and it is back on the next frame, on every visit, for good.
//
// Because of that, a prop lives in quest-fx's own live list under a "prop:" name: questFxClear() (every scene end, warp,
// battle, map change) empties it and the next tick re-places the prop. A test that asks "is anything left on screen after
// a scene" must therefore ignore names starting with "prop:" -- a prop is meant to be there. (A verifier can read
// window.__questProps.state() for what holds and what is drawn.)
//
// Quest data (docs/quests-fx-brief.md section 6, authored with dsl.py prop(...)):
//
//   "props": [ { "map": "s715", "sheet": "frame", "at": [x, y], "clip": "idle", "layer": "entity",
//                "after": "done" | "accepted", "solid": true } ]
//
//   after  "done" (the default): holds once the quest is handed in.  "accepted": from the moment it is taken.
//   sheet  web/extra_fx/<sheet>.png + .json (ours, never game art)
//   at     world pixels of the prop's feet (the sheet's own anchor decides where that lands in the cell)
//   layer  "entity" (default: sorted with the people), "behind" or "front"
//   solid  off by default. true adds a small box at its feet to the disc's standing-actor probe (the same one an NPC's
//          footprint feeds), so the player bumps into it and cannot walk through it -- see questPropSolidAt below.
//
// The condition is the SAVED quest state (web/quests.js questPropsOn reads it), so nothing new is stored: a prop holds on
// every visit, a state change while the player stands on that map shows or drops it on the next frame (no reload), and
// the whole layer is empty while F2 -> Quests is off.
//
// game.js calls questPropsTick() once a frame from the field update with the map the player is on, and
// questPropSolidAt() from fieldPointOccupied() (the disc's obstacle probe).

import {
    questFxSpawn, questFxGet, questFxRemove, questFxSheetInfo, loadQuestFxSheets,
} from "./quest-fx.js";

const LAYERS = ["entity", "behind", "front"];
/** Every prop's effect name carries this prefix, so it can never collide with a scene's effect name. */
const PREFIX = "prop:";
/** Default cell width while a sheet is not loaded yet (every sheet we ship is around this). */
const CELL_FALLBACK = 24;
/** The solid footprint: this share of a cell's width on each side of the anchor, and this deep above the feet line. */
const SOLID_WIDTH_SHARE = 0.32;
const SOLID_HALF_MIN = 4;
const SOLID_HALF_MAX = 12;
const SOLID_DEPTH = 10;

/** The props holding on the current map: [{ key, name, sheet, x, y, clip, layer, solid }]. */
let shown = [];
/** The solid foot boxes of those props (empty when none is solid). */
let boxes = [];
/** The map those boxes belong to, so a frame between a map change and the next tick cannot use another map's boxes. */
let boxesMap = null;
/** Sheets that were named but are not in web/extra_fx yet: asked for once each, never once per frame. */
const asked = new Set();

/**
 * Which props hold on `mapId` this frame, from the list web/quests.js has already filtered by quest state
 * (`questPropsOn`). Places any that are not on screen yet, takes away the ones that no longer hold, and rebuilds the
 * solid boxes. Entries that are not usable (no sheet, no finite place) are dropped rather than thrown, and a missing
 * list or a missing sheet is a no-op: the prop layer can never stop the field.
 *
 * Returns how many props are showing.
 */
export function questPropsTick(mapId, onThisMap) {
    const rows = normalize(onThisMap);
    const want = new Set(rows.map((r) => r.name));

    // Take away first, so a prop whose quest state just changed is gone even if the sheet list changed in the same frame.
    for (const p of shown) {
        if (want.has(p.name)) continue;
        if (questFxGet(p.name)) questFxRemove({ name: p.name });
    }

    const missing = [];
    const next = [];
    for (const r of rows) {
        if (!questFxGet(r.name)) {
            const fx = questFxSpawn({ name: r.name, sheet: r.sheet, x: r.x, y: r.y, clip: r.clip, layer: r.layer });
            if (!fx) {                                  // sheet not in yet: ask once, place it on a later frame
                if (!asked.has(r.sheet)) { asked.add(r.sheet); missing.push(r.sheet); }
                continue;
            }
        }
        next.push(r);
    }
    if (missing.length) loadQuestFxSheets(missing);     // async and cached; a later tick places them

    shown = next;
    boxes = next.filter((r) => r.solid).map((r) => propFootBox(r, sheetWidth(r.sheet)));
    boxesMap = mapId == null ? null : String(mapId);
    return shown.length;
}

/**
 * The props a raw quest-data list turns into: usable ones only, each with a stable key and its effect name. Pure, so a
 * test can drive it without the browser.
 */
export function normalize(onThisMap) {
    const out = [];
    const seen = new Set();
    for (const p of Array.isArray(onThisMap) ? onThisMap : []) {
        if (!p || typeof p !== "object") continue;
        const sheet = typeof p.sheet === "string" ? p.sheet : "";
        if (!sheet) continue;
        const x = Number(p.x), y = Number(p.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const key = String(p.key ?? `${sheet}@${Math.round(x)},${Math.round(y)}`);
        if (seen.has(key)) continue;                    // one place per key: a duplicate can never stack
        seen.add(key);
        const r = { key, name: PREFIX + key, sheet, x, y };
        if (p.clip != null && p.clip !== "") r.clip = String(p.clip);
        if (LAYERS.includes(p.layer)) r.layer = p.layer;
        if (p.solid === true) r.solid = true;
        out.push(r);
    }
    return out;
}

/** A sheet's frame width, for the solid box: from the loaded sheet, else the default every sheet we ship is near. */
function sheetWidth(sheet) {
    const info = questFxSheetInfo(sheet);
    const w = Number(info?.frame?.[0]);
    return w > 0 ? w : CELL_FALLBACK;
}

/**
 * The solid footprint of one prop: a small box centred on its feet, SOLID_DEPTH px deep (the player's own foot box is
 * 12 x 8, so a prop blocks like a person standing there). Exported pure for the lab and the tests.
 */
export function propFootBox(prop, frameW = CELL_FALLBACK) {
    const w = Number(frameW) > 0 ? Number(frameW) : CELL_FALLBACK;
    const halfW = Math.max(SOLID_HALF_MIN, Math.min(SOLID_HALF_MAX, Math.round(w * SOLID_WIDTH_SHARE)));
    return { x: Number(prop?.x) || 0, y: Number(prop?.y) || 0, halfW, depth: SOLID_DEPTH };
}

/** True when a world point lies inside a box (`y` is its feet line; the box stands up from there). */
export function boxHolds(box, px, py) {
    return px >= box.x - box.halfW && px <= box.x + box.halfW && py <= box.y + 2 && py >= box.y - box.depth;
}

/**
 * The disc's obstacle probe (web/game.js fieldPointOccupied, F0x80092a90) asks whether ONE point is occupied. A solid
 * prop answers yes inside its feet box, so the player is pushed back exactly like they are by a standing NPC
 * (F0x8008dfec's five probes) and can always back away. Nothing else about movement changes: the walkmesh still decides
 * what the map itself is, and a prop never traps the player -- it is a bump, not a wall.
 *
 * A map id that is not the map the props belong to answers no: a frame that runs between a map change and the next tick
 * must not use the old map's boxes. (A night/story variant of a place is its own map id here, and the tick uses whichever
 * one the player is standing on -- quests.js has already matched the prop to it.)
 */
export function questPropSolidAt(mapId, px, py) {
    if (!boxes.length) return false;
    if (mapId != null && boxesMap != null && String(mapId) !== boxesMap) return false;
    for (const b of boxes) if (boxHolds(b, px, py)) return true;
    return false;
}

/** The solid boxes on the current map, for the quest lab / a verifier. */
export const questPropBoxes = () => boxes.map((b) => ({ ...b }));

/** What props are showing, for the quest lab and a verifier (a moving frame proves the clip clock is running). */
export const questPropsState = () => shown.map((r) => {
    const fx = questFxGet(r.name);
    return {
        key: r.key, sheet: r.sheet, x: Math.round(r.x), y: Math.round(r.y),
        clip: r.clip ?? null, layer: r.layer ?? "entity", solid: !!r.solid,
        frame: fx ? fx.frameIdx : null, onScreen: !!fx,
    };
});

/** How many props the layer has showing (0 when the quest layer is off). */
export const questPropCount = () => shown.length;

/** Drop every prop at once (a full reset; the normal path is the next tick with an empty list, e.g. Quests off). */
export function questPropsReset() {
    for (const r of shown) if (questFxGet(r.name)) questFxRemove({ name: r.name });
    shown = [];
    boxes = [];
    boxesMap = null;
    asked.clear();
}

// Debug / test hooks: the quest lab and tools/verify_quest_props.mjs read what is on the map and where the boxes are.
if (typeof window !== "undefined") {
    window.__questProps = {
        count: questPropCount,
        state: questPropsState,
        boxes: questPropBoxes,
        solidAt: questPropSolidAt,
        reset: questPropsReset,
    };
}
