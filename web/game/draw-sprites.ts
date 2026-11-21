import type { WalkBlend } from "./types.js";
import { questGhostImage } from "../quest-ghost.js";
import { fieldShadowVisible, FIELD_IDLE_CLIP, clipFrame, FIELD_RUN_CLIP } from "../vendor/engine.js";
import { drawFieldShadow } from "../fieldcom.js";
import { walkBlendNext } from "../walk-blend.js";
import { _DIR_FALLBACK, battle, ctx, lastCam, state } from "./vars.js";
import { S } from "./state.js";

function drawSprite(meta, sheet, x, y, dir, frameIdx) {
    let row = meta.rows.indexOf(dir);
    if (row === -1) {
        const fallback = _DIR_FALLBACK[dir] ?? "down";
        row = meta.rows.indexOf(fallback);
        if (row === -1) row = 0;
    }
    const bottom = spriteBottomShift(meta, dir, row, frameIdx);
    // The row this frame's cell is drawn at, recorded for
    // tools/verify_field_billboard_anchor.mjs.
    const cellRow = Math.round(y - lastCam.y - meta.frameH) + bottom;
    S.billboardDraws.push({
        row: cellRow,
        shift: bottom,
        groundRow: Math.round(y - lastCam.y),
        screenX: Math.round(x - lastCam.x),
        cellH: meta.frameH,
        path: "sheet",
        frameIdx,
        dir,
    });
    // The frame itself: web/quest-ghost.js stands between this and ctx.drawImage so a `ghost`ed actor's frame can be
    // tinted; with no ghost on the field it is the plain call.
    questGhostImage(
        ctx,
        sheet,
        frameIdx * meta.frameW,
        row * meta.frameH,
        meta.frameW,
        meta.frameH,
        Math.round(x - lastCam.x - meta.frameW / 2),
        cellRow,
    );
}

// The field actor's own sprite is hung off a per-frame number the disc registers for
// that frame, not off the frame's own bounding box: the original draws the sprite's
// TOP row at the actor's screen row plus the frame's registered Y offset, so its bottom
// sits `yOffset + frameHeight` rows below that row (fieldstg.s:12919-12940,
// docs/research/field/field-actor-sprite-anchor-decoded-2026-08-17.md). The sheets are
// baked bottom-aligned on the actor's ground row, so that is the shift the draw applies.
// X needs nothing: build_assets bakes each frame's registered offset into the sheet
// (content left = cellW/2 + DC), which also makes the mirrored right-hand rows land on
// `screenX - (E4 + DC)` for free.
function spriteBottomShift(meta, dir, row, frameIdx) {
    const byDir = meta.frameBottomShift;
    if (!byDir) return 0;
    const shifts = byDir[dir] ?? byDir[meta.rows[row]];
    return (shifts && shifts[frameIdx]) || 0;
}

// Field character drop shadow (docs/research/field/character-drop-shadow-
// decoded-2026-07-27.md). The native renderer emits it per actor, immediately
// after that actor's own billboard and one OT bucket further back — so call
// this at the top of an actor's draw closure and the actor paints over it.
//
// `kind` is the field-entity constructor's first argument: 2 for the player,
// speciesId+3 for a party follower, npc_id for an NPC. The engine owns both the
// gate and the geometry; this only supplies the projection.
//
// `actorHeightFixed` is the 8.8 vertical lift the billboard was raised by. The
// walker has no airborne field actor today, so every caller is on the ground and
// passes 0; the parameter exists because the ground-pin is part of the decoded
// geometry, and the engine cancels exactly this term (and nothing horizontal) so
// a lifted actor's shadow stays on the ground while still tracking him across it.
export function drawActorShadow(x, y, kind, clipId, actorHeightFixed = 0, groundOffsetFixed = 0) {
    if (!fieldShadowVisible(kind, clipId)) return;
    drawFieldShadow(ctx, {
        screenX: x - lastCam.x,
        actorScreenY: y - lastCam.y,
        actorHeightFixed,
        // entity+0x90. SHDW-Q003 asked what writes it outside the scripted move
        // methods and the clip-0x17 ramp; the LADDER is one answer, and the only
        // one with a shadow consequence: the two mount methods write it
        // (bottom 0x8008f128 file 0xc4d4 `sw $zr,0x90`; top 0x8008f1d4 file
        // 0xc588 `sw $s0,0x90`), and the climb blocks add ±0x100 per tick
        // (up file 0xd858, down file 0xd8b8). The per-frame update subtracts it
        // from the actor's world y to place the BILLBOARD (file 0xe3d8-0xe3fc:
        // +0x5c = (+0x54 - +0x90) >> 8) and the renderer adds it back for the
        // shadow (file 0xcbf8, RAM 0x8008f8a8: shadowY += (+0x90) >> 8) — the
        // exact mirror of the +0x64 height undo, so the shadow stays pinned to
        // the ladder's FOOT while the sprite climbs away from it. The caller
        // supplies the climb offset here; 0 elsewhere reproduces the resting case.
        groundOffsetFixed,
    });
}

// Draws a frame from a sprite's baked SETANIM clip strip (build_assets.py's
// `_build_clip_strip` — see docs/research/field/field-actor-anim-engine.md): a flat,
// deduped strip with no direction rows, so `col` alone (from `clipFrame`) picks the frame.
// `mirror` (from `clipFrame`'s result) flips it horizontally: the strip only ever bakes
// left-side frames (build_assets.py never emits a right-side clip frame), so right/
// down-right/up-right always resolve via a left-side mirror source and MUST be flipped at
// draw time — skipping this was the "dir says right, sprite visibly faces left" bug.
// `bottom` is the frame's vertical registration (the same shift `spriteBottomShift` applies
// to the sheet path); the original's Y math has no mirror branch, so it is the same number
// whichever way the sprite faces.
function drawClipFrame(meta, clipImg, x, y, col, mirror: boolean, bottom = 0, alpha = 1) {
    const sx = col * meta.clipFrameW;
    const drawY = Math.round(y - lastCam.y - meta.clipFrameH) + bottom;
    // alpha < 1 = the walk blend's fading-in next frame (web/walk-blend.js): same pixels, partial opacity.
    const prevAlpha = ctx!.globalAlpha;
    if (alpha < 1) ctx!.globalAlpha = prevAlpha * alpha;
    else S.billboardDraws.push({
        row: drawY, shift: bottom, groundRow: Math.round(y - lastCam.y),
        screenX: Math.round(x - lastCam.x), cellH: meta.clipFrameH, path: "clip", col,
    });
    if (!mirror) {
        questGhostImage(
            ctx,
            clipImg, sx, 0, meta.clipFrameW, meta.clipFrameH,
            Math.round(x - lastCam.x - meta.clipFrameW / 2), drawY,
        );
        ctx!.globalAlpha = prevAlpha;
        return;
    }
    const screenX = Math.round(x - lastCam.x);
    ctx!.save();
    ctx!.translate(screenX, 0);
    ctx!.scale(-1, 1);
    questGhostImage(
        ctx,
        clipImg, sx, 0, meta.clipFrameW, meta.clipFrameH,
        -meta.clipFrameW / 2, drawY,
    );
    ctx!.restore();
    ctx!.globalAlpha = prevAlpha;
}

// Clip "1" is the idle/breathing clip on every sprite that has clip data (verified
// game-wide, see docs/research/field/field-actor-anim-engine.md's clip-directory decode —
// clip 1 = idle for every checked sprite). Used as the default "just standing there" clip
// when nothing scripted (SETANIM) is overriding this entity.
function _idleClipId(meta) {
    return meta.clips && meta.clips[String(FIELD_IDLE_CLIP)]
        ? String(FIELD_IDLE_CLIP)
        : null;
}

// Renders a sprite's native clip animation when one applies; otherwise falls back to the
// legacy sheet (a clip id this sprite's pack doesn't define — same "no match, no override"
// behavior as the original engine's directory miss).
//
// Two clip sources, in priority order: `activeClip` (a cutscene-latched SETANIM, timed by
// `animTime` — cutscene beat timing) and, when nothing scripted applies, the sprite's own
// idle clip "1" (timed by `idleTime`) and `movementClip` (clip 5 for normal player/party
// movement, clip 4 for scripted walking). Movement wins over a lingering SETANIM latch.
// Returns {mode, clipId, frame, dir} describing what actually got drawn, for the "V" anim
// debug overlay below — computed from the exact same branch that rendered, so the overlay
// can never show a mode that doesn't match the screen.
// EXPERIMENT (ambience): the wet / dusty look and the reflection on water are applied here, so every
// body that goes through this function (leader, partners, NPCs, ambient villagers) gets them.
export function drawEntitySprite(meta, sheet, clipImg: HTMLImageElement | undefined, x, y, ...rest: SpriteFrameArgs) {
    const bf = window.__bodyFx;
    if (!bf) return _drawEntitySpriteRaw(meta, sheet, clipImg, x, y, ...rest);
    if (bf.reflect) {
        const a = bf.reflect(x, y);
        if (a > 0.02) {
            ctx!.save();
            ctx!.globalAlpha = a; if (!(window as any).__perfNoFilter) ctx!.filter = "brightness(0.78) saturate(0.85) blur(0.5px)";   // __perfNoFilter: dev-only, set by web/perf-test.js
            ctx!.translate(0, 2 * (y - lastCam.y + 4)); ctx!.scale(1, -1);
            _drawEntitySpriteRaw(meta, sheet, clipImg, x, y, ...rest);
            ctx!.restore();
        }
    }
    if (bf.filter) {
        ctx!.save(); if (!(window as any).__perfNoFilter) ctx!.filter = bf.filter;
        const r = _drawEntitySpriteRaw(meta, sheet, clipImg, x, y, ...rest);
        ctx!.restore();
        return r;
    }
    return _drawEntitySpriteRaw(meta, sheet, clipImg, x, y, ...rest);
}

function _drawEntitySpriteRaw(meta, sheet, clipImg, x, y, dir, activeClip, animTime, fallbackFrameIdx, isMoving, idleTime, movementClip = null, walkBlend: WalkBlend = false) {
    // walkBlend: false = off, else the seconds already elapsed inside the current field tick (walk-blend.js).
    if (clipImg) {
        const clipId = isMoving ? movementClip : (activeClip ?? _idleClipId(meta));
        const clipTime = isMoving || activeClip != null ? animTime : (idleTime ?? 0);
        const resolved = clipId != null ? clipFrame(meta.clips, clipId, dir, clipTime) : null;
        if (resolved != null) {
            drawClipFrame(meta, clipImg, x, y, resolved.col, resolved.mirror, resolved.bottom);
            // Leader / partners walking: fade the next walk frame in over the last part of this one.
            if (walkBlend !== false && isMoving && activeClip == null) {
                const nb = walkBlendNext(meta.clips, clipId, dir, clipTime, walkBlend as any);
                if (nb) drawClipFrame(meta, clipImg, x, y, nb.col, nb.mirror, nb.bottom, nb.w);
            }
            return {
                mode: isMoving ? (String(clipId) === String(FIELD_RUN_CLIP) ? "run" : "walk")
                    : activeClip != null ? "clip" : "idle",
                clipId,
                frame: resolved.col,
                dir,
            };
        }
    }
    drawSprite(meta, sheet, x, y, dir, fallbackFrameIdx);
    return { mode: isMoving ? "walk" : "static", clipId: null, frame: fallbackFrameIdx, dir };
}

// ── Dev toolset surface (web/devtools.html, tools/verify_devtools.mjs) ────────
// INTERNAL TOOLING. It composes the SAME functions the ordinary routes use
// (loadAndSetMap, battle.start/startScreen, playStoryEvent, applyStoryFlag) so
// the devtoolset never keeps a second copy of game logic and every jump, scene
// or battle it starts behaves exactly as the ordinary route does. It is NOT a
// player-facing screen and deliberately does NOT reproduce the retail disc's
// leftover debug screens (the stage-select launcher, the sound test, the
// shock/rumble test and the battle scene test): those are research tools we read
// on the rig but do not ship. See docs/workflow/devtools.md.
export function devSnapshot() {
    const map = state.manifest?.maps?.[state.mapIdx] ?? null;
    const party = Array.isArray(state.party) ? state.party : [];
    const stats = Array.isArray(state.partyStats) ? state.partyStats : [];
    const members = party.map((charId, i) => {
        const ch = (state.manifest?.characters ?? []).find((c) => c.id === charId);
        const s = stats[i];
        return {
            slot: i, charId, name: ch?.name ?? charId,
            formId: s?.digimonId ?? null, level: s?.level ?? null,
            hp: s?.hp ?? null, maxHp: s?.maxHp ?? null,
            mp: s?.mp ?? null, maxMp: s?.maxMp ?? null,
        };
    });
    return {
        map: map?.id ?? null,
        mapName: map?.name ?? null,
        x: Math.round(state.x), y: Math.round(state.y),
        chapter: state.chapter ?? null,
        ordinal: Number(state.progressOrdinal ?? 0) || 0,
        party: members,
        battle: battle?.isActive?.() ? battle.peek?.() ?? null : null,
        assetMode: document.documentElement.dataset.assetMode ?? null,
    };
}

// The trailing frame arguments drawEntitySprite forwards untouched: which clip a cutscene latched,
// how far into it the draw is, the fallback frame, whether the body is moving, its idle clock and
// the walk-blend seconds (false = off).
type SpriteFrameArgs = [dir?: any, activeClip?: any, animTime?: any, fallbackFrameIdx?: any, isMoving?: any, idleTime?: any, movementClip?: any, walkBlend?: WalkBlend];
