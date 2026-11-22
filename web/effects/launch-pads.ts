import { PAD_IDLE_SCRIPT, newPadCursor, advancePadScript } from "../vendor/engine.js";
import { pushComposite } from "../draw-order.js";
import { S } from "./state.js";
import type { LaunchPadRecord, LaunchPadState, PointStageData } from "../types/fx3d.js";
import { ensureSemiSheet, ensureSheet } from "./point-records.js";
import { drawSprite } from "./draw.js";

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
export function launchPads(stageId: string | number): LaunchPadRecord[] {
    return S.padData?.[String(stageId).replace(/^s/, "")]?.pads?.filter(
        (p: LaunchPadRecord) => p.enabled,
    ) ?? [];
}

/** Vertical offset of the strobe column (wstag735 0x800a609c: s1 -= 0x20). */
export const PAD_STROBE_DY = -0x20;

// Debug-only: lets the headless verifier take an A/B of the same frame with the
// pads drawn and not drawn, which is the only pad-presence check the stage's own
// background art cannot satisfy.
let padsEnabled = true;

export function setLaunchPadsEnabled(on: unknown) {
    padsEnabled = !!on;
}

/** Dev-only read of the last frame the pad layer drew: how many times
 *  drawLaunchPads ran and the CLUT-row offset each pad emitted. Exists so a
 *  headless verifier can read the idle pulse directly instead of inferring it
 *  from averaged canvas pixels (an averaged signature cannot tell a 3-row
 *  script from a 6-value alias). */
let padDebug: { calls: number; palette: number[] } = { calls: 0, palette: [] };

export function launchPadDebug() {
    return { calls: padDebug.calls, palette: padDebug.palette.slice() };
}

/** Per-stage idle cursors, one per pad — every pad runs its own copy of the
 *  looping idle script from the moment the stage loads (state 0 seeds the
 *  cursor at entry 0), so they pulse in step until a launch rewinds one. */
const padIdle: Record<string, { index: number; timer: number }[]> = {}; // stageId -> [PadCursor] parallel to launchPads(stageId)

function padIdleScript(stageId: string | number) {
    const entries = S.padData?.[String(stageId).replace(/^s/, "")]?.idleScript
        ?.entries;
    return entries?.length ? entries : PAD_IDLE_SCRIPT;
}

/** Advance every pad's idle colour cursor one rendered frame (= one tick). */
function tickPadIdle(stageId: string | number, pads: LaunchPadRecord[], launch: LaunchPadState | null | undefined) {
    const script = padIdleScript(stageId);
    let cur = padIdle[stageId];
    if (!cur || cur.length !== pads.length) {
        cur = pads.map(() => newPadCursor(script));
        padIdle[stageId] = cur;
    }
    const out = new Array(pads.length);
    for (let i = 0; i < pads.length; i++) {
        // ETS item 9: i is below pads.length, so pads[i] is there.
        // Entering state 2 rewinds this pad's cursor (the native stores 0 to
        // +0x60 and reloads +0x62 before it runs the animator that frame).
        if (
            launch?.padIdleReset &&
            pads[i]!.x === launch.padOriginX &&
            pads[i]!.y === launch.padOriginY
        ) {
            cur[i] = newPadCursor(script);
        }
        out[i] = advancePadScript(cur[i], script, false);
    }
    return out;
}

export function drawLaunchPads(ctx: CanvasRenderingContext2D | null, stageId: string, camX: number, camY: number, drawables: { y: number; draw: () => void; }[], launch: LaunchPadState | null | undefined) {
    if (!padsEnabled) return;
    const pads = launchPads(stageId);
    if (!pads.length) return;
    const s: PointStageData | undefined = S.data?.[stageId];
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
        // ETS item 9: i is below pads.length.
        const pad = pads[i]!;
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
