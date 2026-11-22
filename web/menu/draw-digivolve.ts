import { drawClip } from "../screenpack.js";
import { drawText, drawCursor } from "../uifont.js";
import { formLedgerRecord } from "../dri-model.js";
import { rosterSlotOfCharId, ITEM_BY_ID, EQUIPMENT_BY_ID } from "../vendor/engine.js";
import { MS } from "./state.js";
import { EQUIP_SLOTS, EQUIP_SLOT_KEYS, RES_ROWS, STAT_ROWS, VSYNC, cmfont, ststat } from "./pure.js";
import { _drawCard, gold, valueText, white } from "./draw-common.js";
import {
  battleDigivolveLabel,
  ensureEquipment,
  formTechSlots,
  ownTechSlots,
  seeDigivolvePanelRes,
  seeDigivolvePanelStat,
  sheetResValue,
  sheetStatValue,
  techBadgeClip,
} from "./logic.js";
import type { MenuState } from "./types.js";

import type { GameState } from "../game/types.js";
import type { RosterMember } from "../types/battle.js";
type RosterDetailView = RosterMember & { xp?: number; tp?: number };

// SEE DIGIVOLVE — a screen of its own, not a panel on the status sheet. Every
// number here is read from UI.screens.see_digivolve (claim
// SEE-DIGIVOLVE-SCREEN-LAYOUT-001: pictures F0x800895c8, text F0x8008833c,
// states F0x80089bf0, panel filler F0x80088a44, list filler F0x8008865c,
// action filler F0x8008886c). Reference capture
// docs/research/ui/captures/original-status-2026-09-03/03-choose-digivolve.png.
//
// The panel below the list belongs to the PARTNER, not to the highlighted
// candidate. F0x80088a44 has two branches: with no candidate it fills the
// panel from the partner's own block and titles it with the partner's name;
// with one highlighted it adds that species record's per-stat and per-
// resistance fields on top of the partner's live numbers, clamps each to 999,
// and titles the panel with the candidate's name. The capture is the first
// branch — Kotemon's sheet numbers appear unchanged one screen later.
//
// The candidate's name at form_name is NOT on screen while the list is up:
// F0x8008886c fills and hides it in the same call as the two action rows.
export function _drawSeeDigivolve(ctx: CanvasRenderingContext2D, p, m: MenuState, state: GameState, t: number, fold = null) {
  const S = MS.UI.screens.see_digivolve;
  const evos = window.__battle?.availableEvolutions?.(state, m.detailIdx) ?? [];
  const step = m.detailStep;
  // Which of the two right-hand windows is up. The candidate list and the
  // action pair are DIFFERENT windows over the same corner (clips 0x24 and
  // 0x26); the screen shuts one before it opens the other.
  const win = (key: string, node, axis: string, fn) => (fold
    ? fold(key, node.pivot?.[0] ?? 0, node.pivot?.[1] ?? 0, axis ?? "x", fn)
    : (fn(), 1));
  // The whole lower panel — its band, its icon column and every widget on it —
  // rides a Y offset the screen tweens between 0 and -34 (F0x800891a4 re-lays
  // all of them at obj+0x8c each frame).
  const dy = m._slideY ?? 0;
  const sel = evos.length && !m.dvHome ? (evos[m.detailSel] ?? null) : null;
  const stats = m.detailIdx === 0 ? state.partnerStats : state.partyStats?.[m.detailIdx];

  // The footer plate belongs to the STATUS screen underneath and is up the
  // whole time; the digivolve screen's own footer window carries the technique
  // explanation and the "Turned on/off" message.
  drawClip(ctx, ststat, S.footer_bar.clip, S.footer_bar.x, S.footer_bar.y);
  // No footer STRING here. The two footer text widgets belong to the status
  // screen underneath and are hidden while a sub-screen is up — capture
  // 03-choose-digivolve.png has bare plate under the panel.

  // The partner card is the SHEET's, still open behind this screen; this
  // screen draws only its own name plate over the sheet's closed name tab.
  win("dvName", S.name_plate, "x",
    () => drawClip(ctx, cmfont, S.name_plate.clip, S.name_plate.x, S.name_plate.y));
  if (m._foldReady!("dvName") && m._isOpen!("dvName")) {
    drawText(ctx, "Choose digivolve", S.header.x, S.header.y);
  }

  // The lower panel: its band, its baked stat-icon column, then its header row
  // — the name of whatever it is showing, "Skill LV", and the level.
  const panelOpen = win("dvPanel", S.band, "x", () => {
    drawClip(ctx, ststat, S.band.clip, S.band.x, S.band.dy + dy);
    drawClip(ctx, cmfont, S.label.clip, S.label.x, S.label.dy + dy);
  }) >= 1;
  const formProf = sel ? m.digimonDB?.[sel.formId] : null;
  if (panelOpen) {
    drawText(ctx, (sel ? (sel.to ?? "") : (p?.name ?? "")),
      S.panel_row.name_x, S.panel_row.y + dy);
    drawText(ctx, S.panel_row.label, S.panel_row.label_x, S.panel_row.y + dy);
    // With a candidate highlighted the original always has a number here (the
    // digivolution record's field +2); a form the partner has never taken is a
    // fresh record, which the walker's own ledger defines as level 1.
    const formLevel = sel
      ? (formLedgerRecord(stats, sel.formId, m.digimonDB ?? {})?.formLevel ?? 1)
      : null;
    if (formLevel != null) valueText(ctx, String(formLevel), S.panel_row.level_x, S.panel_row.y + dy);
    else drawText(ctx, S.panel_row.level_none, S.panel_row.level_x, S.panel_row.y + dy);

    // The panel's numbers are WHITE, as they are on the status sheet — capture
    // 03-choose-digivolve.png. Only the card's LV/HP/MP and the technique names
    // are gold. The partner's part is its own LIVE block — the sheet's reader,
    // stored + chips + worn gear — not the raw stored stats: F0x80088A44 reads
    // the same F0x80017174 copy the sheet does, and folds the worn gear in.
    ensureEquipment(state);
    const wornSlots = state.equipment?.[m.detailIdx ?? 0] ?? {};
    const wornSlot = rosterSlotOfCharId(String(state.party?.[m.detailIdx ?? 0] ?? ""));
    STAT_ROWS.forEach((stat, i) => {
      const y = S.stat_values.y_base + i * S.stat_values.pitch + dy;
      valueText(ctx, String(seeDigivolvePanelStat(p, wornSlots, stat, wornSlot, formProf)),
        S.stat_values.x, y, white);
    });
    RES_ROWS.forEach((res, i) => {
      const y = S.res_values.y_base + i * S.res_values.pitch + dy;
      valueText(ctx, String(seeDigivolvePanelRes(p, wornSlots, res, formProf)),
        S.res_values.x, y, white);
    });

    // The six technique slots are on screen in EVERY state, with the element
    // icon of each beside it — the capture shows one filled slot while the
    // candidate list is up. They are the candidate's when one is highlighted and
    // the partner's own when none is.
    const slots = sel
      ? formTechSlots(stats, sel.formId, m.digimonDB)
      : ownTechSlots(p?.profile);
    slots.slice(0, S.tech_rows.n).forEach((id: string | number, i: number) => {
      if (!id) return;
      const tech = m.skillDB?.[id];
      const y = S.tech_rows.y_base + i * S.tech_rows.pitch + dy;
      const iy = S.tech_icons.y_base + i * S.tech_icons.pitch + dy;
      // The badge beside the slot is the technique record's +4 byte, not its
      // element — see techBadgeClip. Kotemon's "Hot Head" is clip 57, the red
      // triangle in capture 03-choose-digivolve.png.
      const badgeClip = techBadgeClip(tech);
      if (badgeClip != null) drawClip(ctx, cmfont, badgeClip, S.tech_icons.x, iy);
      if (step === "techinfo" && i === (m.techInfoSel ?? 0)) {
        drawCursor(ctx, t * VSYNC, S.tech_rows.cursor_x, y, gold);
      }
      drawText(ctx, tech?.name ?? "", S.tech_rows.x, y, gold);
    });
  }

  // The candidate list window (clip 0x24).
  if (win("dvList", S.window, "x",
      () => drawClip(ctx, ststat, S.window.clip, S.window.x, S.window.y)) >= 1
      && m._isOpen!("dvList")) {
    evos.slice(0, S.list_rows.n).forEach((e, i: number) => {
      const y = S.list_rows.y_base + i * S.list_rows.pitch;
      if (!m.dvHome && i === m.detailSel) drawCursor(ctx, t * VSYNC, S.list_rows.cursor_x, y, gold);
      // NOT gold for being the current form. Capture 03-choose-digivolve.png
      // shows Kotemon's only row -- which IS its current form -- in the white
      // face, beside "Hot Head" in the gold one. The walker coloured it gold
      // until 2026-09-04 on no evidence. Whether the original ever colours a
      // row, and on what test, is NOT established.
      drawText(ctx, e.to ?? "", S.list_rows.x, y);
    });
  }
  // The partner's own name, in the panel above the list. F0x8008865c fills it
  // from the partner record every time it fills the list, never a candidate.
  if (panelOpen) drawText(ctx, p?.name ?? "", S.partner_name.x, S.partner_name.y);
  // The cursor's HOME is here, beside that name — the solid triangle in the
  // capture that nothing used to draw.
  if (m.dvHome && step === "digivolve" && S.cursor_home) {
    drawCursor(ctx, t * VSYNC, S.cursor_home.x, S.cursor_home.y, gold);
  }

  // The action pair window (clip 0x26) — a different, shorter window in the
  // same corner, with the highlighted candidate's name over it.
  if (win("dvAct", S.window_alt, "x",
      () => drawClip(ctx, ststat, S.window_alt.clip, S.window_alt.x, S.window_alt.y)) >= 1
      && m._isOpen!("dvAct")) {
    const target = evos[m.detailSel];
    if (target) {
      drawText(ctx, target.to ?? "", S.form_name.x, S.form_name.y);
      [battleDigivolveLabel(p, target), S.action_rows.row1].forEach((label, i) => {
        const y = S.action_rows.y_base + i * S.action_rows.pitch;
        if (i === (m.dvAction ?? 0)) drawCursor(ctx, t * VSYNC, S.action_rows.cursor_x, y, gold);
        drawText(ctx, label, S.action_rows.x, y);
      });
    }
  }

  // This screen's OWN footer window: the technique explanation with its MP
  // cost, or the "Turned on/off Battle Digivolve" message (F0x8008933c and
  // states 0x1c/0x3f, both filling the widgets at the shared label-table
  // records +0x90, +0x9c and +0xa8).
  if (win("dvFoot", S.footer_bar, "x",
      () => drawClip(ctx, ststat, S.footer_bar.clip, S.footer_bar.x, S.footer_bar.y)) >= 1
      && m._isOpen!("dvFoot")) {
    if (step === "dvmessage" && m.dvMessage) {
      drawText(ctx, m.dvMessage, S.explanation.x, S.explanation.y);
    } else if (step === "techinfo") {
      const target = evos[m.detailSel];
      const slots = m.dvBackStep === "dvaction" && target
        ? formTechSlots(stats, target.formId, m.digimonDB)
        : ownTechSlots(p?.profile);
      const tech = m.skillDB?.[slots[m.techInfoSel ?? 0]];
      if (tech) {
        drawText(ctx, tech.desc || "", S.explanation.x, S.explanation.y);
        drawText(ctx, S.mp_label.str, S.mp_label.x, S.mp_label.y, gold);
        valueText(ctx, tech.mp_cost ?? 0, S.mp_value.x, S.mp_value.y);
      }
    }
  }
}

// STATUS DETAIL (state3): single card + name tab 0x1f @ (20,13), EXP plate
// (cmfont 0x1a @ (0,61), value right-anchored at x=66), stat window 0x21 @
// (0,84) with the baked icon column (cmfont 0x0f @ (0,87)) and values at
// x=50/x=91 (y=91+14i), TP plate 0x3c @ (0,196) value @ (45,203), Digivolve
// window 0x22 @ (160,53) rows @ (178,71+14i), Equip window 0x23 @ (160,119)
// rows @ (192,137+14i). (F0x8008c954 / F0x8008b520.)
export function _drawDetail(ctx: CanvasRenderingContext2D, p: RosterDetailView | undefined, m: MenuState, state: GameState, t: number, fold = null) {
  const D = MS.UI.screens.detail;
  const sh = MS.UI.screens.shared;
  // Every panel on this sheet is its own folding window, opened in pairs by
  // F0x8008d684: card + name tab, then EXP plate + Digivolve panel, then stat
  // window + Equip panel. `win` draws one of them through its decoded pivot.
  const win = (key: string, node, fn) => (fold
    ? fold(key, node.pivot?.[0] ?? 0, node.pivot?.[1] ?? 0, "x", fn)
    : (fn(), 1));

  win("shName", D.name_tab, () => drawClip(ctx, ststat, D.name_tab.clip, D.name_tab.x, D.name_tab.y));
  _drawCard(ctx, p, 0, t, fold, fold ? "shCard" : null);
  // No selection ring here. The sheet shows ONE card and nothing to choose
  // between, and the original draws it in plain card chrome — capture
  // docs/research/ui/captures/original-status-2026-09-03/02-status-sheet.png.

  const expOpen = win("shExp", D.exp_plate,
    () => drawClip(ctx, cmfont, D.exp_plate.clip, D.exp_plate.x, D.exp_plate.y)) >= 1;
  if (expOpen) {
    valueText(ctx, p?.xp ?? 0, D.exp_value.x, D.exp_value.y);
    drawText(ctx, D.exp_label.str, D.exp_label.x, D.exp_label.y, gold);
  }

  const statOpen = win("shStat", D.stat_window, () => {
    drawClip(ctx, ststat, D.stat_window.clip, D.stat_window.x, D.stat_window.y);
    drawClip(ctx, cmfont, D.stat_icons.clip, D.stat_icons.x, D.stat_icons.y);
  }) >= 1;
  // What the sheet shows is the member's stats WITH what they are wearing. The
  // original reads them off the same display block the shop card fills: for a
  // Kotemon holding nothing the sheet said 48 / 1, and with the Asuka Armory
  // Short Sword worn it said POW 62 and CHR 16 -- base + that item's 14 attack
  // and 15 charisma (claims EQUIP-C018-pause-status-sheet-gear-inclusive and
  // EQUIP-C020-status-sheet-folds-gear-at-display, capture
  // docs/research/ui/captures/shop-gear-pause-menu-2026-09-09.md sections 3 and 7).
  // The resist column follows the same rule and is proven the same way: a Flame
  // Ring worn in the first accessory slot showed fire 105 there while the member
  // record still held 85, so the record stores no effective resist and adding the
  // worn item's value here cannot double-count.
  ensureEquipment(state);
  const wornSlots = state.equipment?.[m.detailIdx ?? 0] ?? {};
  // The signature-set bonus is keyed by the member's ROSTER slot (F0x80017174 indexes
  // 0x8004B53C by it), so the sheet resolves it from the party position it is showing.
  const wornSlot = rosterSlotOfCharId(String(state.party?.[m.detailIdx ?? 0] ?? ""));
  if (statOpen) {
  STAT_ROWS.forEach((stat, i) => {
    const y = D.stat_values.y_base + i * D.stat_values.pitch;
    // gear-inclusive, clamped at 999 like F0x80088a64, with the profile value as
    // fallback before any battle stats exist.
    // Right-anchored in the number font, as the original draws them: each value
    // ENDS at the decoded x so it never runs into the next baked icon column.
    valueText(ctx, String(sheetStatValue(p, wornSlots, stat, wornSlot!)), D.stat_values.x, y, white);
  });
  RES_ROWS.forEach((res, i) => {
    const y = D.res_values.y_base + i * D.res_values.pitch;
    valueText(ctx, String(sheetResValue(p, wornSlots, res)), D.res_values.x, y, white);
  });
  }

  // The bottom band holds ONE of two things, never both: the shared footer
  // plate sits at (0,194) and the TP plate at (0,196), so they cannot coexist.
  // The sheet shows TP — capture
  // docs/research/ui/captures/original-status-2026-09-03/02-status-sheet.png —
  // and its Equip rows run down through the same band, so the sheet's own
  // widgets go down last. The TP plate belongs to the STAT WINDOW's fold slot
  // and has its own hinge (F0x8008c954, guard unk100, pivot (0,0xd0)).
  const evos = window.__battle?.availableEvolutions?.(state, m.detailIdx) ?? [];
  if (win("shStat", D.tp_plate,
      () => drawClip(ctx, ststat, D.tp_plate.clip, D.tp_plate.x, D.tp_plate.y)) >= 1) {
    // Both TP widgets are kind 1 in F0x8008b520 — the capture shows "TP 0" white.
    drawText(ctx, D.tp_label.str, D.tp_label.x, D.tp_label.y, white);
    valueText(ctx, p?.tp ?? 0, D.tp_value.x, D.tp_value.y, white);
  }

  // Digivolve panel
  if (win("shDv", D.digivolve_window,
      () => drawClip(ctx, ststat, D.digivolve_window.clip, D.digivolve_window.x, D.digivolve_window.y)) >= 1) {
    drawText(ctx, "Digivolve", D.digivolve_header.x, D.digivolve_header.y);
    evos.slice(0, D.digivolve_rows.n).forEach((e, i: number) => {
      const y = D.digivolve_rows.y_base + i * D.digivolve_rows.pitch;
      drawText(ctx, e.to ?? "", D.digivolve_rows.x, y);   // see _drawSeeDigivolve: not gold
    });
  }

  // Equip panel
  if (win("shEq", D.equip_window,
      () => drawClip(ctx, ststat, D.equip_window.clip, D.equip_window.x, D.equip_window.y)) >= 1) {
    drawText(ctx, "Equip", D.equip_header.x, D.equip_header.y);
    ensureEquipment(state);
    const equipped = state.equipment[m.detailIdx] ?? {};
    EQUIP_SLOTS.forEach((slot, i) => {
      const y = D.equip_rows.y_base + i * D.equip_rows.pitch;
      const itemId = equipped[EQUIP_SLOT_KEYS[i]];
      const item = itemId != null ? (ITEM_BY_ID[itemId] ?? EQUIPMENT_BY_ID[itemId]) : null;
      // An empty slot shows its own name in the ordinary white face, exactly as a
      // filled one shows the item's name (capture 02-status-sheet.png).
      drawText(ctx, item ? item.name : slot, D.equip_rows.x, y);
    });
  }

  // The sheet's own two-row prompt (F0x8008bd70 / F0x8008d684 state 5): rows at
  // (172, 19+14i), cursor at (152, 19+14i). It is filled once the Digivolve
  // panel is up and hidden the moment the sheet starts to shut.
  if (m.detailStep === "prompt" && D.prompt && m._foldReady!("shDv")) {
    D.prompt.rows.forEach((label: string | undefined, i: number) => {
      const y = D.prompt.y_base + i * D.prompt.pitch;
      if (i === m.detailFocus) drawCursor(ctx, t * VSYNC, D.prompt.cursor_x, y, gold);
      drawText(ctx, label, D.prompt.x, y);
    });
  }
}
