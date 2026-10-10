// web/placecard.js — the stage-entry LOCATION TITLE CARD.
//
// Walk into a screen and the game tells you where you are: an area name typed
// out near the top, a place name below it, both over coloured bars that slide
// in from the right and down the left edge. It holds for a second once the
// stage is ready, then a horizontal slit closes over the screen and takes it.
//
// All of the behaviour lives in engine/systems/location-card.ts, which carries
// the decode. This file is the renderer and the bridge: it picks this map's two
// names out of web/assets/data/place_card.json (tools/extract_place_card.py)
// and paints the frame the engine hands back.
//
// COORDINATES. The original draws on a 320x240 field framebuffer; the walker's
// field viewport is 320x224 of logical pixels blown up by the same integer
// scale. The card is anchored top-left at native coordinates so its pixel grid
// lines up with the field behind it, which puts the bottom 16 native rows of
// the two full-height bars off the bottom of the view. Nothing the card
// actually writes to — both labels and all four panels sit in the top half.

import {
    createLocationCard,
    stepLocationCard,
    releaseLocationCard,
    locationCardFrame,
    locationCardActive,
} from "./vendor/engine.js";
import { drawText, fontReady } from "./uifont.js";

const DATA_URL = "assets/data/place_card.json";
/** The framebuffer the card's coordinates are authored in. */
const NATIVE_W = 320;

let data = null;

/** Load the bar templates and the per-stage names. Safe to call repeatedly. */
export async function loadPlaceCard() {
    if (!data) data = await (await fetch(DATA_URL)).json();
    return data;
}

/** The two names for a walker map id, or null if the table does not name it. */
export function placeCardNames(mapId) {
    return data?.stages?.[mapId] ?? null;
}

export function createPlaceCard() {
    const card = {
        _st: null,
        _acc: 0,
        /** Set while the walker is still getting the stage on screen. */
        _held: false,
    };

    /** Live state, for tests and the UI lab. */
    card.state = () => card._st;
    card.isActive = () => !!card._st && locationCardActive(card._st);

    /**
     * Start the card for an arrival. Returns false — and shows nothing — for a
     * map the shipped table has no record for, which is what the original does
     * when its scan falls off the end of the table.
     */
    card.begin = (mapId) => {
        const names = placeCardNames(mapId);
        if (!names) {
            card._st = null;
            return false;
        }
        card._st = createLocationCard(data.bars, names.area, names.place);
        card._acc = 0;
        card._held = false;
        return true;
    };

    card.cancel = () => {
        card._st = null;
    };

    /**
     * Hold the finished card on screen instead of letting it close — the
     * original's own release is "the field's stage-entry sequence has finished"
     * and this is the walker's hook for it.
     */
    card.hold = (on) => {
        card._held = !!on;
    };

    /** Advance by `dt` seconds of the 60Hz frames the tables are authored in. */
    card.step = (dt) => {
        if (!card._st) return;
        card._acc += dt * 60;
        let whole = Math.floor(card._acc);
        card._acc -= whole;
        // A long stall must not run the whole card off in one frame.
        if (whole > 8) whole = 8;
        for (let i = 0; i < whole; i++) {
            if (!card._held) releaseLocationCard(card._st);
            stepLocationCard(card._st);
        }
        if (!locationCardActive(card._st)) card._st = null;
    };

    card.draw = (ctx, viewW, viewH) => {
        if (!card._st) return;
        const f = locationCardFrame(card._st);
        if (f.done) return;
        const s = viewW / NATIVE_W;

        ctx.save();
        ctx.beginPath();
        ctx.rect(f.clip.x * s, f.clip.y * s, f.clip.w * s, f.clip.h * s);
        ctx.clip();
        ctx.scale(s, s);
        ctx.imageSmoothingEnabled = false;

        for (const b of f.bars) {
            if (b.w <= 0 || b.h <= 0) continue;
            ctx.fillStyle = `rgb(${b.color[0]},${b.color[1]},${b.color[2]})`;
            ctx.fillRect(b.x, b.y, b.w, b.h);
        }
        if (fontReady()) {
            if (f.area.text) drawText(ctx, f.area.text, f.area.x, f.area.y);
            if (f.place.text) drawText(ctx, f.place.text, f.place.x, f.place.y);
        }
        ctx.restore();
    };

    return card;
}
