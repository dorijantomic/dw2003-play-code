import { padRepeatFires, isPartyWide } from "../vendor/engine.js";
import { loadPack, drawClip } from "../screenpack.js";
import { drawText, drawCursor } from "../uifont.js";
import { ITEM_CATS, VSYNC, mapHoldSpeed, ststat, topItems, visitedPs1Stages } from "./pure.js";
import { MS } from "./state.js";
import { gold } from "./draw-common.js";
import type { MapCursorConfig, MapSeenRow, MenuState } from "./types.js";
import type { SfxPlayerContext } from "../types/audio.js";

import type { GameState } from "../game/types.js";
// ── the world MAP screen (draw F0x80098b84, decoded + rig-verified 2026-07-11) ──
// Full-screen: dark base map (stwmp sub 0) + revealed-terrain patches per area
// in the ordinal-tier list (sub 1, clip = area-1 at map.area_positions[area]) +
// visited location markers (sub 2, flag 0x2000|(stage&0xff)) + current-location
// arrow, free/locked cursor and the hover name window. All geometry/timings
// from status_ui.json screens.map (tools/extract_status_ui.py header).

// Cursor/pan movement — transcription of F0x80098450: the cursor free-moves
// until it crosses the screen-centre pan pivot; ON the pivot the map scrolls
// instead, and hitting the scroll limit nudges the cursor past the pivot so
// it resumes free movement.
export function _mapMove(m: MenuState, C: MapCursorConfig, dx: number | undefined, dy: number | undefined) {
  const s = m.mapSpd;
  if (dx! < 0) {
    if (m.mapCX! > C.pan_x) m.mapCX = Math.max(C.pan_x, m.mapCX! - s!);
    else if (m.mapCX! < C.pan_x) m.mapCX = Math.max(C.x_min, m.mapCX! - s!);
    else { m.mapSX = Math.min(0, m.mapSX! + s!); if (m.mapSX === 0) m.mapCX = C.pan_x - 1; }
  } else if (dx! > 0) {
    if (m.mapCX! < C.pan_x) m.mapCX = Math.min(C.pan_x, m.mapCX! + s!);
    else if (m.mapCX! > C.pan_x) m.mapCX = Math.min(C.x_max, m.mapCX! + s!);
    else { m.mapSX = Math.max(C.scroll_x_min, m.mapSX! - s!); if (m.mapSX === C.scroll_x_min) m.mapCX = C.pan_x + 1; }
  }
  if (dy! < 0) {
    if (m.mapCY! > C.pan_y) m.mapCY = Math.max(C.pan_y, m.mapCY! - s!);
    else if (m.mapCY! < C.pan_y) m.mapCY = Math.max(C.y_min, m.mapCY! - s!);
    else { m.mapSY = Math.min(0, m.mapSY! + s!); if (m.mapSY === 0) m.mapCY = C.pan_y - 1; }
  } else if (dy! > 0) {
    if (m.mapCY! < C.pan_y) m.mapCY = Math.min(C.pan_y, m.mapCY! + s!);
    else if (m.mapCY! > C.pan_y) m.mapCY = Math.min(C.y_max, m.mapCY! + s!);
    else { m.mapSY = Math.max(C.scroll_y_min, m.mapSY! - s!); if (m.mapSY === C.scroll_y_min) m.mapCY = C.pan_y + 1; }
  }
}

export function _stepHeldLists(m: MenuState, state: GameState, sfx: { play: (arg0: string) => void; } | null) {
  const keys = state.keys;
  if (!keys) return;
  const vsync = 1 / VSYNC;
  const now = m.time ?? 0;
  const last = m.listStepT ?? now;
  let frames = Math.floor(now / vsync) - Math.floor(last / vsync);
  m.listStepT = now;
  if (frames <= 0) return;
  frames = Math.min(frames, 4);
  const up = keys.has("up") ? -1 : keys.has("down") ? 1 : 0;
  if (up === 0) { m.listHold = 0; return; }
  for (let i = 0; i < frames; i++) {
    m.listHold = (m.listHold ?? 0) + 1;
    if (!padRepeatFires(m.listHold)) continue;
    if (m.screen === "home") {
      const n = topItems(m).length;
      const next = Math.max(0, Math.min(n - 1, m.mainCursor + up));
      if (next !== m.mainCursor) { m.mainCursor = next; sfx?.play("system02"); }
    } else if (m.screen === "items" && (m.itemMode === "cats" || m.itemMode == null)) {
      const next = Math.max(0, Math.min(ITEM_CATS.length - 1, m.itemCat + up));
      if (next !== m.itemCat) { m.itemCat = next; m.itemCursor = 0; sfx?.play("system02"); }
    } else if (m.screen === "sort") {
      // Both picks repeat. The second one skips the slot already chosen, the
      // same wrap-and-skip the press path uses, so holding a direction on
      // "Switch with who?" moves the arrow instead of sticking. The repeat
      // carries the same party-card cursor word as the press path (0x4001B).
      const n = (state.party ?? []).length;
      if (n >= 2) {
        let i = m.statusCursor;
        do { i = (i + up + n) % n; } while (m.sortPick != null && i === m.sortPick);
        if (i !== m.statusCursor) { m.statusCursor = i; sfx?.play("system06"); }
      }
    } else if (m.screen === "status-list" || m.screen === "techniques-pick") {
      // The two partner-choosers repeat as well; they CLAMP rather than wrap,
      // matching their own press path, and play that path's party-card word.
      const n = (state.party ?? []).length;
      const next = Math.max(0, Math.min(n - 1, m.statusCursor + up));
      if (next !== m.statusCursor) { m.statusCursor = next; sfx?.play("system06"); }
    }
  }
}

// F0x800986c0, called every vsync from the map root: poll held left/right
// and up/down separately, 2 then 4 after MAP_HOLD_FRAMES, 0 on release.
function _stepMapHeld(m: MenuState, C: MapCursorConfig, state: GameState) {
  const keys = state.keys;
  if (!keys) return;
  const vsync = 1 / VSYNC;
  const now = m.time ?? 0;
  const last = m.mapStepT ?? now;
  let frames = Math.floor(now / vsync) - Math.floor(last / vsync);
  m.mapStepT = now;
  if (frames <= 0) return;
  frames = Math.min(frames, 4);
  const heldX = keys.has("left") ? -1 : keys.has("right") ? 1 : 0;
  const heldY = keys.has("up") ? -1 : keys.has("down") ? 1 : 0;
  for (let i = 0; i < frames; i++) {
    if (heldX === 0) m.mapHoldX = 0;
    else {
      m.mapHoldX = (m.mapHoldX ?? 0) + 1;
      m.mapSpd = mapHoldSpeed(m.mapHoldX, C);
      _mapMove(m, C, heldX, 0);
    }
    if (heldY === 0) m.mapHoldY = 0;
    else {
      m.mapHoldY = (m.mapHoldY ?? 0) + 1;
      m.mapSpd = mapHoldSpeed(m.mapHoldY, C);
      _mapMove(m, C, 0, heldY);
    }
  }
}

export function _drawMapPane(ctx: CanvasRenderingContext2D, state: GameState, m: MenuState, t: number, sfx: SfxPlayerContext | null = null) {
  const M = MS.UI.screens.map;
  const C = M.cursor;
  // walker map id -> {ps1, server, loc} (composed through screen_table).
  const walkerStage = String(Number(String(state.manifest?.maps?.[state.mapIdx]?.id ?? "").replace(/\D/g, "")) || 0);
  const wm = M.walker_map[walkerStage] ?? { ps1: 0x200, server: 0, loc: 0 };
  const server = wm.server; // F0x8009a670: PS1 stage < 0x270 = Asuka
  const pk = server ? "stwmp1" : "stwmp0";
  const mapPack = loadPack(`${pk}map`), areaPack = loadPack(`${pk}area`), iconPack = loadPack(`${pk}icon`);
  // reveal tier from the story ordinal (F0x80098b84 thresholds 7/0xF/0x1B/0x1E)
  const ord = state.progressOrdinal ?? 0;
  let tier = 0;
  for (const th of M.tier_thresholds) if (ord >= th) tier++;
  const areas = M.tier_area_lists[server * 5 + tier] ?? [];
  const cur = M.markers[wm.loc - 1];

  if (!m.mapInit) {
    // The native init loop pans until the cursor reaches the current-location
    // arrow (step fn 0x8009913c) — start at that end state.
    m.mapInit = true;
    const tx = (cur?.x ?? 0xA0) + C.lock_offset, ty = (cur?.y ?? 0x78) + C.lock_offset;
    m.mapSX = Math.max(C.scroll_x_min, Math.min(0, C.pan_x - tx));
    m.mapSY = Math.max(C.scroll_y_min, Math.min(0, C.pan_y - ty));
    m.mapCX = Math.max(C.x_min, Math.min(C.x_max, tx + m.mapSX));
    m.mapCY = Math.max(C.y_min, Math.min(C.y_max, ty + m.mapSY));
    m.mapSpd = C.speed_initial; m.mapHover = 0; m.mapHoverY = m.mapCY;
    m.mapHoldX = 0; m.mapHoldY = 0; m.mapStepT = m.time ?? 0;
  }
  _stepMapHeld(m, C, state);
  const ox = m.mapSX, oy = m.mapSY + M.origin_y;

  // visited location markers on THIS server: every place the flag store says you have
  // been composes to a {server, loc} via walker_map (native: flag 0x2000|(ps1&0xff)
  // per stage, filler F0x8009a6b8). The current map's own marker always shows.
  const seenPs1 = new Set(visitedPs1Stages(state, MS.UI, m.mapSeen));
  const vis = new Set();
  // ETS item 9: walker_map rows are {ps1, server, loc}; MS.UI is the untyped status_ui.json, so Object.values gives any.
  for (const row of Object.values(M.walker_map) as MapSeenRow[]) {
    if (seenPs1.has(row.ps1) && row.server === server && row.loc) vis.add(row.loc);
  }

  drawClip(ctx, mapPack, 0, ox, oy); // base map (16px banner strip above origin)
  for (const a of areas) {
    const p = M.area_positions[a];
    if (p) drawClip(ctx, areaPack, a - 1, p[0] + ox, p[1] + oy);
  }
  for (const r of M.markers) if (vis.has(r.loc)) drawClip(ctx, iconPack, r.clip, r.x + ox, r.y + oy);

  // hover test: 12px square at marker+(7..18) (F0x80098294), visited only
  const cmx = m.mapCX! - m.mapSX!, cmy = m.mapCY! - m.mapSY!;
  let hov = null;
  for (const r of M.markers) {
    if (!vis.has(r.loc)) continue;
    if (cmx > r.x + M.hover.box_min && cmx <= r.x + M.hover.box_max &&
        cmy > r.y + M.hover.box_min && cmy <= r.y + M.hover.box_max) { hov = r; break; }
  }
  if (hov && hov.loc !== m.mapHover) { sfx?.play("system07"); m.mapHoverY = m.mapCY; }
  m.mapHover = hov ? hov.loc : 0;

  // current-location arrow at marker+(12,12); flips when the cursor is left of it
  if (cur) {
    const A = M.current_arrow;
    const a3 = Math.floor(t * VSYNC / A.anim_vsync) % A.anim_frames;
    const ax = cur.x + A.offset[0], ay = cur.y + A.offset[1];
    const base = m.mapCX! < ax + m.mapSX ? A.clip_right : A.clip_left;
    drawClip(ctx, iconPack, base + a3, ax + ox, ay + oy);
  }

  // cursor: locked on a marker (clip 0x38+anim at marker+12) or free (0x32+anim)
  const anim = C.anim[Math.floor(t * VSYNC / C.anim_vsync) % C.anim.length];
  if (hov) drawClip(ctx, iconPack, C.lock_clip + anim, hov.x + C.lock_offset + ox, hov.y + C.lock_offset + oy);
  else drawClip(ctx, iconPack, C.free_clip + anim, m.mapCX, m.mapCY + M.origin_y);

  // hover name window (ststat clip 0x3b): bottom when the cursor is in the
  // top half of the screen, else top; string bank esaskmap/esamtmap[record #]
  if (hov) {
    const HV = M.hover;
    const bottom = m.mapHoverY! < 0x78;
    drawClip(ctx, ststat, HV.window.clip, 0, bottom ? HV.window.y_bottom : HV.window.y_top);
    const name = M.location_names[server ? "amaterasu" : "asuka"][hov.loc] ?? "";
    name.split("\\n").forEach((line: string | undefined, i: number) =>
      drawText(ctx, line, HV.text.x, (bottom ? HV.text.y_bottom : HV.text.y_top) + i * 11));
  }
}

// TECHNIQUES list: ststat window 0x3a @ (168,40), header @ (178,42),
// rows @ (197, 58+14i), cursor x=184 (ctor F0x80083680).
// The rows are the Digimon's field-usable HEALING techniques only — ids
// 0xB8..0xBC, de-duplicated, at most five (F0x800937a4) — drawn from the same
// reader the input machine walks (m.techRows: the three EQUIPPED forms' ledger
// slots; the species' own list is NOT what the original reads). A Digimon that
// knows none gets the real "Hasn't learned a technique." line, not a blank
// window.
export function _drawTechniques(ctx: CanvasRenderingContext2D, rows: number[], m: MenuState, t: number) {
  const T = MS.UI.screens.techniques;
  // The window RESIZES with the row count: F0x800946bc picks its clip from the
  // 0x8009a950 table indexed by (rows - 1), so one to five heals get five
  // different window heights. An empty list keeps the smallest.
  const clips = MS.UI.menu_window_clips;
  const winClip = clips[Math.max(0, Math.min(rows.length, clips.length) - 1)];
  drawClip(ctx, ststat, winClip, T.menu_window.x, T.menu_window.y);
  drawText(ctx, m.techMode === "use_target" ? "Use it on who?" : "Choose a technique",
    T.menu_header.x, T.menu_header.y);
  if (!rows.length) {
    drawText(ctx, "Hasn't learned", T.menu_rows.x, T.menu_rows.y_base);
    drawText(ctx, "a technique.", T.menu_rows.x, T.menu_rows.y_base + T.menu_rows.pitch);
    return;
  }
  rows.forEach((techId: string | number, i: number) => {
    const skill = m.skillDB?.[techId];
    const y = T.menu_rows.y_base + i * T.menu_rows.pitch;
    if (i === m.techCursor) drawCursor(ctx, t * VSYNC, T.cursor_x, y, gold);
    drawText(ctx, skill?.name ?? `Tech ${techId}`, T.menu_rows.x, y);
  });
  const sel = m.skillDB?.[rows[m.techCursor]];
  if (sel) {
    const scope = isPartyWide(rows[m.techCursor]) ? "All" : "One";
    drawText(ctx, `MP ${sel.mp_cost ?? 0}  ${scope}`,
      T.menu_rows.x, T.menu_rows.y_base + rows.length * T.menu_rows.pitch + 6, gold);
  }
}
