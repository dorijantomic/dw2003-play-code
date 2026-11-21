import { fontReady as uiFontReady, drawText as uiDrawText } from "../../uifont.js";
import { hpBarColors, hpBarLength, hpPlateShown, hpBarFillRect } from "../hud.js";
import { FIGHT_UI_CLIPS } from "../layout.js";
import { partHook as uiCPart } from "../../ui-c/capture.js";
import { battleHudBarColors } from "../../battlehud-translated.js";
import { clipSize, drawClip } from "../../screenpack.js";
import { fightUiAtlas, pgfgc00 } from "../../battle.js";
import type { BattleContext } from "../../types/battle.js";
import type { NativeTextOptions } from "./types.js";

import type { BattleState } from "../../types/battle.js";
// moved by tools/rewrite/split-closure.mjs
export function makeNative(B: BattleContext) {
// The large battle panes are GPU polygons in the original overlay, not a
  // scalable bitmap window.  The atlas's 104x64 decoration was previously
  // nine-sliced here, which visibly stretched its diagonal ornament across
  // the list.  Draw the measured native polygons and reserve atlas sampling
  // for the actual textured widgets (buttons, selectors, HP and DV frames).
  function drawFightPane(x: number, y: number, w: number, h: number, angled: boolean = false) {
    const cut = angled ? 7 : 0;
    B.ctx!.save();
    B.ctx!.beginPath();
    B.ctx!.moveTo(x, y);
    B.ctx!.lineTo(x + w, y);
    B.ctx!.lineTo(x + w, y + h - cut);
    if (cut) B.ctx!.lineTo(x + w - cut, y + h);
    B.ctx!.lineTo(x, y + h);
    B.ctx!.closePath();
    B.ctx!.fillStyle = "#02063e";
    B.ctx!.fill();
    B.ctx!.strokeStyle = "#00d9ff";
    B.ctx!.lineWidth = 1;
    B.ctx!.stroke();
    B.ctx!.beginPath();
    B.ctx!.moveTo(x + 3, y + 3);
    B.ctx!.lineTo(x + w - 3, y + 3);
    B.ctx!.lineTo(x + w - 3, y + h - cut - 2);
    if (cut) B.ctx!.lineTo(x + w - cut - 2, y + h - 3);
    B.ctx!.lineTo(x + 3, y + h - 3);
    B.ctx!.closePath();
    B.ctx!.strokeStyle = "#10147a";
    B.ctx!.stroke();
    B.ctx!.restore();
  }
// ── Draw ──

  function nativeText(text, x: number, y: number, opts: NativeTextOptions = {}) {
    if (uiFontReady()) return uiDrawText(B.ctx, String(text), x, y, opts);
    B.ctx!.fillStyle = opts.color ?? "#f2f2f2";
    B.ctx!.font = `${opts.kind === 3 ? 8 : 10}px monospace`;
    B.ctx!.textAlign = opts.alignRight ? "right" : "left";
    B.ctx!.textBaseline = "top";
    B.ctx!.fillText(String(text), x, y);
  }
function nativePanelPath(x: number, y: number, w: number, h: number, notch: number = 5) {
    B.ctx!.beginPath();
    B.ctx!.moveTo(x, y);
    B.ctx!.lineTo(x + w - notch, y);
    B.ctx!.lineTo(x + w, y + notch);
    B.ctx!.lineTo(x + w, y + h - notch);
    B.ctx!.lineTo(x + w - notch, y + h);
    B.ctx!.lineTo(x, y + h);
    B.ctx!.closePath();
  }
function drawNativePanel(x: number, y: number, w: number, h: number, fill: string = "rgba(3,5,62,0.92)") {
    nativePanelPath(x, y, w, h);
    B.ctx!.fillStyle = fill;
    B.ctx!.fill();
    B.ctx!.strokeStyle = "#8af7ff";
    B.ctx!.lineWidth = 1;
    B.ctx!.stroke();
    nativePanelPath(x + 2, y + 2, w - 4, h - 4, 4);
    B.ctx!.strokeStyle = "#2459d8";
    B.ctx!.stroke();
  }
function fillHpBar(x: number, y: number, w: number, h: number, cur: number, max: number) {
    const [top, bottom] = hpBarColors(cur, max);
    const grad = B.ctx!.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, top!);
    grad.addColorStop(1, bottom!);
    B.ctx!.fillStyle = grad;
    B.ctx!.fillRect(x, y, Math.round(w * hpBarLength(cur, max) / 128), h);
  }
function drawNativeBar(x: number, y: number, w: number, h: number, cur: number, max: number) {
    B.ctx!.fillStyle = "#d8d8d8";
    B.ctx!.fillRect(x, y, w, h);
    B.ctx!.fillStyle = "#060812";
    B.ctx!.fillRect(x + 2, y + 2, w - 4, h - 4);
    fillHpBar(x + 3, y + 3, w - 6, Math.max(1, h - 6), cur, max);
  }
function drawPips(def: { count: number; x: number; step: number; y: number; }, active: number = 0) {
    for (let i = 0; i < def.count; i++) {
      const x = def.x + i * def.step;
      B.ctx!.fillStyle = "#061139";
      B.ctx!.fillRect(x, def.y, 12, 9);
      B.ctx!.strokeStyle = "#9dfcff";
      B.ctx!.strokeRect(x + 0.5, def.y + 0.5, 11, 8);
      B.ctx!.fillStyle = i === active ? "#11e4d0" : "#f3f6f8";
      B.ctx!.fillRect(x + 3, def.y + 3, 6, 3);
    }
  }
function chromeReady() {
    return !!fightUiAtlas;
  }
function drawChrome(name: string | number, x: number, y: number, w: number = null, h: number = null) {
    const clip = FIGHT_UI_CLIPS[name];
    if (!fightUiAtlas || !clip) return false;
    const [sx, sy, sw, sh] = clip;
    B.ctx!.drawImage(fightUiAtlas, sx, sy, sw, sh, x, y, w ?? sw, h ?? sh);
    return true;
  }
/**
   * The eased HP the player's plate is showing. The original reads ONE word for both
   * the bar and the HP number -- the plate object's +0x60 -- so the number counts down
   * with the bar on the same poll and the same tween
   * (fightstg.s:17068 for the number, :17112 for the bar).
   */
  function pDispShown(cur: BattleState) {
    return cur._hpPlate ? hpPlateShown(cur._hpPlate, 0) : Number(cur.player?.hp ?? 0);
  }
function paintHpBar(x: number, y: number, w: number, h: number, cur: number, max: number, side: number = 0) {
    // Look C (web/ui-c/battlehud.js): the bar is a C part -- its length against the full length, and the game's own two colours.
    const sideName = side ? "enemy" : "player";
    if (uiCPart(B.ctx, { part: "hpBar", side: sideName, x, y, w: Math.max(0, w), h, full: hpBarFillRect(sideName, max, max).w,
      colors: battleHudBarColors(cur, max, side) })) return;
    if (w <= 0) return;
    // The original's bar is one untextured POLY_G4 whose four vertex colours ramp
    // ACROSS the bar (word 0 on vertices 0 and 2, word 1 on 1 and 3), so the
    // gradient runs left to right — the enemy's quad lists vertex 0 on the right,
    // which battleHudBarColors already accounts for.
    const [left, right] = battleHudBarColors(cur, max, side);
    const grad = B.ctx!.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, left!);
    grad.addColorStop(1, right!);
    B.ctx!.fillStyle = grad;
    B.ctx!.fillRect(x, y, w, h);
  }
/** Draw a cel of the battle chrome pack and record it for the frame read-out. */
  function hudClip(cel, x: number, y: number) {
    B.hudCels!.push({ cel: Number(cel), x, y, known: B.HUD_CELS_DECODED!.has(Number(cel)),
                   size: clipSize(pgfgc00, String(cel)) });
    return drawClip(B.ctx, pgfgc00, String(cel), x, y);
  }
  return { drawFightPane, nativeText, nativePanelPath, drawNativePanel, fillHpBar, drawNativeBar, drawPips, chromeReady, drawChrome, pDispShown, paintHpBar, hudClip };
}
