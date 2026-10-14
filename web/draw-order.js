// web/draw-order.js
//
// ONE ordering rule for the field's drawables -- the port of the original's
// single y-sorted world list.
//
// The original draws the field through the resident 2D draw-context service
// (object 0x1002). Its ordering queue, method +0x14C (F0x8001E240,
// exe/fns.s:15593), inserts ONE 20-byte record per drawable into a list kept
// DESCENDING by the caller's key; the flush (+0x154, F0x8001E38C) walks the
// list and calls each record's callback. Equal keys keep arrival order. The
// same queue carries the entity bucket's y-sorted actors AND every y-sorted
// point record, and A COMPOSITE OBJECT'S SUB-PARTS ARE EMITTED BY THE OBJECT'S
// OWN DRAW ROUTINE -- so its parts are ONE record and can never re-order against
// each other (a lamp cannot sort behind its own housing).
// See docs/research/field/draw-context-service-2026-10-04.md sections 4-5 and
// docs/research/field/point-sprite-ambient-system.md: a point record's `layer`
// byte (+3) is its ordering bucket, and a layer-4 (entity-bucket) record is
// y-sorted at the record's `ysort` baseline (+0x14).
//
// A record's `layer` byte picks a fixed bucket, and LOWER means NEARER the
// camera -- the map's own tile layers ride the same ladder (ground 7,
// foreground 3, layer 2 at 11; docs/research/field/
// map-tile-draw-semitransparency-2026-08-20.md section 8). The walker's
// `drawables` list is the port of that one queue, and the two sentinels below
// stand for the buckets either side of the entity bucket.

/** Ordering bucket BELOW 4: in front of every entity. The street-prop drawer
 *  submits its lamp glows here -- `sp94(0x1002, 2, …)` at wstag780 file 0xd94. */
export const IN_FRONT_OF_ENTITIES = Infinity;
/** Ordering bucket ABOVE 4: over the map, behind every entity. The corner
 *  stinger submits at bucket 7 (wstag780 file 0x3d4). */
export const BEHIND_ENTITIES = -Infinity;

/**
 * The field's own ordering-table ladder, as numbers the map layers ride.
 *
 * The disc's one ordering table is indexed by a bucket; `OT[n-1]` is reached
 * first, so a LOWER number is NEARER the camera. The map's own tile layers and
 * the entities all land in the same table, and these are the disc's own words
 * (docs/research/field/map-tile-draw-semitransparency-2026-08-20.md section 8;
 * `pro/fieldstg.s` file 0x4180-0x4358 reads the depth words 7/3/11 into the
 * 0x1002 packet slots):
 *
 *   layer 2 (the tunnel/canopy fill)   -> OT[11]  furthest
 *   layer 0 (the ground)               -> OT[7]
 *   the entity pass                    -> OT[4]   (a field actor's default)
 *   layer 1 (the walk-behind overlay)  -> OT[3]   nearest
 *
 * `UNDER_MAP_BUCKET` is the first bucket behind the ground: a drawable that
 * lands there is painted BEFORE the ground image, so the map's own opaque art
 * covers it. It is the disc's own band — Protocol Ruins' overlay shapes ride
 * OT[12] and the point records at 8/10 (`web/effects.js bucketPass`).
 */
export const ENTITY_BUCKET = 4;
export const MAP_GROUND_BUCKET = 7;
export const UNDER_MAP_BUCKET = 8;
/** Map-tile layer 2's own bucket — the far layer (the tunnel/canopy fill). The
 *  field's map loop reads it from the depth table at 0x8009702c and emits the
 *  layer's primitives into this ordering-table slot (pro/fieldstg.s L4234-4236,
 *  `.L0x00004210 lw $a1,($t0)` / `.L0x00004214 lw $v0,0x138($a0)`). It is the
 *  bucket an under-map actor (8) is drawn IN FRONT OF. */
export const MAP_LAYER2_BUCKET = 11;
/** Map-tile layer 1's own bucket — the foreground drawn OVER sprites; the same
 *  depth table's second word (pro/fieldstg.s L4230, table 0x8009702c word 1). */
export const MAP_FOREGROUND_BUCKET = 3;

/**
 * Whether a field actor's own ordering bucket puts it BEHIND the ground.
 *
 * A type-5 field actor draws through the ordering-table slot named by its
 * draw-layer word (`actor+0x78`, `F0x8008F52C` -> the 0x1002 service's `+0x138`;
 * default 4). The position step's SETUP opcode 5 overwrites that word from a
 * step record (`pro/fieldstg.s:5605-5615`, ported as `StepOpEffect.actor78`), so
 * a stage's own step program can move the player behind the ground. This is the
 * one rule that decides which side of the ground the actor lands on.
 */
export function actorDrawsUnderMap(bucket) {
    return bucket >= UNDER_MAP_BUCKET;
}

// Debug-only: producers record what they submit when a verifier arms the log,
// so an assertion can read the band each producer chose without pixel-probing.
let orderLog = null;
export function beginDrawOrderLog() { orderLog = []; }
export function takeDrawOrderLog() { const l = orderLog; orderLog = null; return l; }

/**
 * The one composite-aware push into the ordering list.
 *
 * `key` is the OBJECT's single ordering key -- a baseline number for the entity
 * bucket (an actor's y, or a point record's `ysort`), or one of the two
 * sentinels above. `parts` are the object's draw functions, drawn in the order
 * the object emits them: the base sprite first, its sub-parts after.
 *
 * Submitting a base and its sub-parts through ONE call is what keeps them
 * together. A producer that submits each part separately lets the parts
 * interleave with other objects -- the fault this replaces, where six
 * hand-written producers each pushed their sub-parts at an invented y.
 */
export function pushComposite(drawables, key, parts, tag = null) {
    const draws = (Array.isArray(parts) ? parts : [parts]).filter((d) => typeof d === "function");
    if (!draws.length) return;
    if (orderLog) orderLog.push({ key, tag, parts: draws.length });
    drawables.push({
        y: key,
        draw: () => { for (const d of draws) d(); },
    });
}

/**
 * Order the frame's drawables the way the disc's queue and its ordering-table
 * prepend order them, and hand the list back for the draw loop.
 *
 * Ascending key, because the flush walks its DESCENDING list head->tail and
 * every callback PREPENDS its primitive into its bucket — `prim->next = old
 * head; entry = prim`. The field actor's own billboard does it at
 * `exe-decomp/fieldstg_c/F0x8008f52c.c:69-70` and the map-tile draw at
 * `pro/fieldstg.s .L0x000043a4-0x43d0` — so the LAST callback's primitive is
 * the bucket head, drawn first, and a LARGER key renders in FRONT. `|| 0`
 * guards the Infinity band (Infinity - Infinity is NaN; 0 keeps the stable
 * insertion order, map fg overlay first, then point-sprite fg records).
 *
 * EQUAL KEYS: the queue keeps arrival order among them, and its head-most
 * record is called first — and the first call is the deepest in the bucket
 * list, drawn last, ON TOP. So among equal keys the EARLIER arrival renders on
 * top. The sort above is stable, so each equal-key run is reversed to put the
 * earlier arrival last (drawn on top). The two sentinel bands are the walker's
 * own collapse of the buckets above and below the entity bucket; their
 * producers already submit in bucket order (the map fg at 3 before the
 * bucket-2 records and glows), so they are left in insertion order.
 */
export function sortDrawables(drawables) {
    drawables.sort((a, b) => (a.y - b.y) || 0);
    for (let i = 0, n = drawables.length; i < n; ) {
        let j = i + 1;
        while (j < n && drawables[j].y === drawables[i].y) j += 1;
        if (j - i > 1 && Number.isFinite(drawables[i].y)) {
            for (let k = i, m = j - 1; k < m; k += 1, m -= 1) {
                const swap = drawables[k];
                drawables[k] = drawables[m];
                drawables[m] = swap;
            }
        }
        i = j;
    }
    return drawables;
}
