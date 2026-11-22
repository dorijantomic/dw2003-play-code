import { drawText, drawCursor } from "../uifont.js";
import { drawClip, drawClipAtPaletteRow } from "../screenpack.js";
import { digivolveDemoOn } from "../blast-presentation.js";
import {
  CARD_FOLDER_ROWS,
  CARD_STAT_LABELS,
  DEMO_SETUP_ROWS,
  DEMO_SETUP_TITLE,
  VSYNC,
  cmfont,
  portraitSequenceFor,
  sheetDeltaClut,
  ststat,
  topItems,
} from "./pure.js";
import { MS } from "./state.js";
import { GREY } from "./draw-items.js";
import type { FoldFn, MenuDrawOpts, MenuState, RosterViewEntry } from "./types.js";

import type { GameState } from "../game/types.js";
// ── native drawing helpers (coordinates from status_ui.json / the decompile) ──

export const gold = { kind: 3 };

// Right-anchored value text (the ーー placeholder fields end AT their x —
// "150/ 150" lines up cur flush against the baked "/" at x=61).
export function valueText(ctx: CanvasRenderingContext2D | null | undefined, str: string | number | undefined, xEnd: number, y: number | undefined, opts = gold) {
  // alignRight: the same pixels (x = xEnd - width), and the run keeps its right edge (look C reads card numbers by it)
  drawText(ctx, String(str), xEnd, y, { ...opts, kind: opts.kind ?? 3, alignRight: true });
}

// The status sheet's stat and resistance numbers, and its TP pair, are built in
// the WHITE face, not the gold one: F0x8008b520 passes kind 1 to F0x8001ae38 for
// the widgets at x=0x32 (stats), x=0x5B (resistances) and (0x10,0xCB)/(0x2D,0xCB)
// (TP). Only the EXP pair at 0x42/0x46 is kind 3. Capture
// docs/research/ui/captures/original-status-2026-09-03/02-status-sheet.png shows
// exactly that: white numbers, gold "4 EXP".
export const SHEET_VALUE_KIND = 1;

export const white = { kind: SHEET_VALUE_KIND };

// F0x8008c1c0 sets every one of the thirteen stat/resistance widgets to palette
// 0, then raises three of them to palette 6. WHAT RAISES THEM IS NOT DECODED —
// the flags come out of the stat snapshot struct at +0x26/+0x28/+0x2A.
export const SHEET_CLUT_MARKED = 6;

// The palette a See Equipment preview number takes: F0x8008C460's own pair —
// palette 1 when the preview raised the value, 5 when it lowered it, and the
// face's own row when it did not move (the original then raises the unchanged
// STR/DEF/SPD widgets to the grey 6 only when the stat snapshot's flag is set,
// which the walker's data never sets). The grey SHEET_CLUT_MARKED is the sheet
// filler's mark, NOT the preview's colour: the preview passes 1 and 5 to the
// same thirteen widgets (ststatus F0x8008C460's six `li $a1, 0x1` / five
// `li $a1, 0x5` marks), so painting 6 for every change showed grey where the
// original shows the gym's rose/blue pair.
export function sheetPreviewFace(before: number, after: number) {
  const clut = sheetDeltaClut(before, after);
  return clut ? { kind: SHEET_VALUE_KIND, clut } : white;
}

// One party card: CMFONTCS chrome (LV/HP/MP letters baked in), animated
// pedestal portrait, name + values at the decoded label-table positions.
// Cards fold open around (0x7c, card center) — F0x800946bc sp9C(v,v)/spA4.
export function _drawCard(ctx: CanvasRenderingContext2D | null | undefined, p: RosterViewEntry | undefined, y0: number, t: number, fold: FoldFn | null = null, key: string | null = null, opts: MenuDrawOpts | null = null) {
  const sh = MS.UI.screens.shared;
  // The card is NOT one folding sprite. F0x8008c954 draws it under two
  // different scale/pivot pairs: the frame pieces (clips 0x15/0x17) unroll
  // SIDEWAYS from x=0 about (0, y+37), while the portrait plate (clip 0x16)
  // and the picture on it grow on BOTH axes about (124, y+39). See
  // screens.shared.card_fold.
  const CF = sh.card_fold ?? {
    side: { pivot_x: 0, dy: 0x25, axis: "x" },
    plate: { pivot_x: sh.card_pivot_x ?? 0x7C, dy: 0x27, axis: "xy" },
  };
  const piece = (i: number) => () => {
    const c = sh.card_chrome[i];
    // First START has no glass pedestal (cmfont 22/23). Overlay home keeps them.
    if (!c || (opts?.skipPortrait && (c.clip === 22 || c.clip === 23))) return;
    drawClip(ctx, c.pack === "cmfont" ? cmfont : ststat, c.clip, c.x, c.y + y0);
  };
  const picture = () => {
    // portrait: real animation sequence (13-vsync step, table 0x8009a9c0).
    // Champion ids are not in the extracted 8-rookie table — fall back to
    // that partner's rookie sequence rather than leaving the pedestal blank.
    if (opts?.skipPortrait) return;
    const seq = portraitSequenceFor(p, MS.UI.portrait_sequences);
    if (seq?.length) {
      const fi = Math.floor(t * VSYNC / MS.UI.timings_vsync.portrait_step) % seq.length;
      drawClip(ctx, ststat, seq[fi], sh.portrait.x, sh.portrait.y + y0);
    }
  };
  let done = 1;
  if (fold && key) {
    const side = (fn: () => void) => fold(key, CF.side.pivot_x, y0 + CF.side.dy, CF.side.axis, fn);
    const plate = (fn: () => void) => fold(key, CF.plate.pivot_x, y0 + CF.plate.dy, CF.plate.axis, fn);
    done = side(piece(0));
    plate(piece(1));
    side(piece(2));
    plate(picture);
  } else { piece(0)(); piece(1)(); piece(2)(); picture(); }
  if (done < 1) return;
  const L = MS.UI.card_labels;
  drawText(ctx, p?.name ?? "", L.name.x, L.name.y + y0);
  // F0x80093e84: names kind 1, LV/HP/MP/"/" kind 3 (9px pitch).
  for (const lab of L.static ?? []) {
    const text = CARD_STAT_LABELS[lab.str];
    if (text) drawText(ctx, text, lab.x, lab.y + y0, gold);
  }
  const vals = [p?.level ?? 1, p?.hp ?? 0, p?.maxHp ?? 0, p?.mp ?? 0, p?.maxMp ?? 0];
  L.values.forEach((v: { x: number; y: number; }, i: number) => valueText(ctx, vals[i], v.x, v.y + y0));
}

// The orange selection corners: CLUT-row-cycled ststat clip 0x1e ("30#k").
function _drawSelection(ctx: CanvasRenderingContext2D | null | undefined, idx: number, t: number, locked = false) {
  const sel = MS.UI.screens.shared.selection;
  const k = locked ? 8 : Math.floor(t * VSYNC / MS.UI.timings_vsync.selection_clut_cycle) % 8;
  drawClipAtPaletteRow(ctx, ststat, sel.clip, k, sel.x, sel.y_base + idx * sel.pitch);
}

// SORT's swap bracket (F0x80096988 .L0x000145c0..0x00014768). While the second
// pick is open the screen draws one ststat clip beside the party column at
// x=147, CLUT-cycled 0..7 every 11 vsync. The original states it as six
// (pick, cursor) cases; all six reduce to one bracket spanning the pair:
// it is drawn on the UPPER of the two rows, clip 41 when the rows are
// neighbours and the taller clip 40 when they are two apart.
export function sortSwapBracket(pick: number | null, cursor: number | null) {
  const S = MS.UI.screens.sort.swap_marker;
  if (pick == null || cursor == null || pick === cursor) return null;
  const top = Math.min(pick, cursor);
  const clip = Math.abs(pick - cursor) === 1 ? S.clip_b : S.clip_a;
  return { clip, x: S.x, y: top === 0 ? S.y_high : S.y_low };
}

export function _drawSwapBracket(ctx: CanvasRenderingContext2D, m: MenuState, t: number) {
  const b = sortSwapBracket(m.sortPick, m.statusCursor);
  if (!b) return;
  const S = MS.UI.screens.sort.swap_marker;
  const k = Math.floor(t * VSYNC / S.clut_cycle_vsync) % 8;
  drawClipAtPaletteRow(ctx, ststat, b.clip, k, b.x, b.y);
}

export function _drawSidebar(ctx: CanvasRenderingContext2D, roster: RosterViewEntry[], m: MenuState, t: number, selIdx = -1, lockedIdx: number | null = null, fold: FoldFn | null = null, opts: MenuDrawOpts | null = null) {
  const pitch = MS.UI.screens.shared.card_pitch;
  roster.forEach((p, i) => _drawCard(ctx, p, i * pitch, t, fold, `card${i}`, opts));
  const cardReady = (i: number) => (m._animP?.(`card${i}`) ?? 1) >= 1;
  if (lockedIdx != null && cardReady(lockedIdx)) _drawSelection(ctx, lockedIdx, t, true);
  if (selIdx >= 0 && selIdx < roster.length && cardReady(selIdx)) _drawSelection(ctx, selIdx, t);
}

export function _drawHeader(ctx: CanvasRenderingContext2D, text: string, fold: FoldFn | null = null) {
  const h = MS.UI.screens.shared.header;
  const [px, py] = h.pivot ?? [0x140, 0x19];
  const plate = () => drawClip(ctx, cmfont, h.clip, h.x, h.y);
  const p = fold
    ? fold("header", px, py, "x", plate)
    : (plate(), 1);
  if (p < 1) return;
  // Label-table +0x84 widget at (152, 19), kind 1.
  if (text) {
    const t = MS.UI.screens.shared.header_text ?? { x: 0x98, y: 0x13 };
    drawText(ctx, text, t.x, t.y);
  }
}

// Footer plate (ststat 0x20 @ (0,194)): two text lines at (20,198)/(20,212),
// BIT count right-anchored before the "BIT" label at (300,212), and the
// CLUT-blinking page arrow (cmfont 0x0a) at (291,214). Overlay SORT /
// TECHNIQUES / STATUS-pick have no footer BIT (pause-sort-who-2026-08-20).
export function _drawFooter(ctx: CanvasRenderingContext2D, state: GameState, t: number, line1: string | undefined, line2: string | null, fold: FoldFn | null = null, opts: MenuDrawOpts | null = null) {
  const sh = MS.UI.screens.shared;
  const [fpx, fpy] = sh.footer.pivot ?? [0, 0xD3];
  const p = fold
    ? fold("footer", fpx, fpy, "x", () => drawClip(ctx, ststat, sh.footer.clip, sh.footer.x, sh.footer.y))
    : (drawClip(ctx, ststat, sh.footer.clip, sh.footer.x, sh.footer.y), 1);
  if (p < 1) return;
  const F = MS.UI.footer_labels;
  if (line1) drawText(ctx, line1, F.line1.x, F.line1.y);
  if (line2) drawText(ctx, line2, F.line1.x, F.line1.y + 0xE);
  if (!opts?.hideBit) {
    valueText(ctx, state.bits ?? 0, F.bit_label.x - 4, F.bit_value.y);
    drawText(ctx, "BIT", F.bit_label.x, F.bit_label.y, gold);
  }
  const k = Math.floor(t * VSYNC / MS.UI.timings_vsync.footer_arrow_blink) % 5;
  drawClip(ctx, cmfont, k === 0 ? "10" : `10#${k}`, sh.footer_arrow.x, sh.footer_arrow.y);
}

// Resident/overlay home BIT sits at the foot of the card stack
// (status_ui.json topmenu.bit_*; rig d2_home.png / s6_home.png).
export function _drawHomeBit(ctx: CanvasRenderingContext2D, state: GameState) {
  const TM = MS.UI.screens.topmenu;
  if (!TM?.bit_value) return;
  valueText(ctx, state.bits ?? 0, TM.bit_value.x, TM.bit_value.y);
  drawText(ctx, "BIT", TM.bit_label.x, TM.bit_label.y, gold);
}

// The TOP-LEVEL menu. Its rows and cursor are the decoded RESIDENT geometry
// (F0x800121b4: rows x=189 from y=49 at pitch 14, cursor x=176) — the list is
// not in the ststatus overlay at all. The window sprite behind them is not
// decoded, so it reuses the overlay's right-pane window and its clip table.
export function _drawHome(ctx: CanvasRenderingContext2D, m: MenuState, t: number, fold: FoldFn | null = null, labels: string[] | null = null) {
  const H = MS.UI.screens.techniques;
  const TM = MS.UI.screens.topmenu;
  const rows = labels ?? topItems(m);
  // The 0x8009a950 clip table holds exactly FIVE entries and then a zero
  // terminator (verified with overlay_scan), so a six-row menu has no window
  // clip of its own in the decoded data. Which entry the original drops to stay
  // within five is NOT established — the row count is read per-menu from a
  // record field, not hardcoded — so the six-row case reuses the widest clip
  // rather than inventing one. This is the single unresolved presentation
  // detail of the CARD FOLDERS entry.
  const winClip = MS.UI.menu_window_clips[Math.min(rows.length, MS.UI.menu_window_clips.length) - 1];
  const [px, py] = H.menu_window.pivot ?? [0x140, 0x63];
  const win = () => drawClip(ctx, ststat, winClip, H.menu_window.x, H.menu_window.y);
  const p = fold ? fold("homeWin", px, py, "x", win) : (win(), 1);
  if (p < 1) return;
  rows.forEach((label, i) => {
    const y = TM.rows.y_base + i * TM.rows.pitch;
    const dim = labels == null && label === "MAP" && m.mapUnavailable;
    if (i === m.mainCursor) drawCursor(ctx, t * VSYNC, TM.cursor_x, y, dim ? GREY : gold);
    drawText(ctx, label, TM.rows.x, y, dim ? GREY : {});
  });
}

// CARD FOLDERS panel — its own decoded geometry (ststat clip 0x3a @ (168,40),
// header (178,42), rows (197, 58+14i), cursor x=184: F0x80083c94 / F0x80083680,
// cursor placement confirmed by F0x80084238 state 0xA).
export function _drawCardFolder(ctx: CanvasRenderingContext2D, m: MenuState, t: number, fold: FoldFn | null = null) {
  const C = MS.UI.screens.cardfolder;
  const win = () => drawClip(ctx, ststat, C.window.clip, C.window.x, C.window.y);
  const [cpx, cpy] = C.window.pivot ?? [0x140, 0x40];
  const p = fold ? fold("cardFolderWin", cpx, cpy, "x", win) : (win(), 1);
  if (p < 1) return;
  drawText(ctx, "CARD FOLDERS", C.header.x, C.header.y);
  CARD_FOLDER_ROWS.forEach((label, i) => {
    const y = C.rows.y_base + i * C.rows.pitch;
    if (i === m.cardFolderCursor) drawCursor(ctx, t * VSYNC, C.cursor_x, y, gold);
    drawText(ctx, label, C.rows.x, y);
  });
}

// Digivolve Demo setup. Two rows in the small right-hand panel, like Card
// Folders. The original's own geometry for this screen is NOT decoded — nothing
// reaches it, so no capture of it exists — so it borrows that panel's.
export function _drawDemoSetup(ctx: CanvasRenderingContext2D, m: MenuState, t: number, fold: FoldFn | null = null) {
  const C = MS.UI.screens.cardfolder;
  const win = () => drawClip(ctx, ststat, C.window.clip, C.window.x, C.window.y);
  const [dpx, dpy] = C.window.pivot ?? [0x140, 0x40];
  const p = fold ? fold("demoSetupWin", dpx, dpy, "x", win) : (win(), 1);
  if (p < 1) return;
  drawText(ctx, DEMO_SETUP_TITLE, C.header.x, C.header.y);
  DEMO_SETUP_ROWS.forEach((label, i) => {
    const y = C.rows.y_base + i * C.rows.pitch;
    if (i === m.demoCursor) drawCursor(ctx, t * VSYNC, C.cursor_x, y, gold);
    // The setting in force is marked, so the screen reads as a state, not a menu.
    const inForce = (i === 0) === digivolveDemoOn();
    drawText(ctx, label, C.rows.x, y, inForce ? gold : {});
  });
}
